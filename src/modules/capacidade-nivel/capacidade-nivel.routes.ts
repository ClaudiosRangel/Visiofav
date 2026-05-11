import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { calcularOcupacaoNivel } from '../endereco/ocupacao-nivel.service'
import { classificarAlertaNivel } from '../endereco/alert-nivel.service'

export async function capacidadeNivelRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // POST / — criar configuração de capacidade por nível
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = z.object({
      estruturaId: z.string().uuid(),
      codigoNivel: z.string().min(1).max(10),
      pesoMaximo: z.number().nullable().optional(),
      volumeMaximo: z.number().nullable().optional(),
      paletesMaximo: z.number().int().nullable().optional(),
      status: z.boolean().default(true),
    }).parse(request.body)

    // Validate at least one limit > 0
    const peso = body.pesoMaximo ?? 0
    const volume = body.volumeMaximo ?? 0
    const paletes = body.paletesMaximo ?? 0
    if (peso <= 0 && volume <= 0 && paletes <= 0) {
      return reply.status(422).send({ message: 'Pelo menos um limite (peso, volume ou paletes) deve ser maior que zero' })
    }

    // Verify estrutura exists and belongs to empresa
    const estrutura = await prisma.estrutura.findFirst({
      where: { id: body.estruturaId, empresaId: user.empresaId },
    })
    if (!estrutura) {
      return reply.status(404).send({ message: 'Estrutura não encontrada' })
    }

    try {
      const config = await prisma.capacidadeNivel.create({
        data: {
          empresaId: user.empresaId,
          estruturaId: body.estruturaId,
          codigoNivel: body.codigoNivel,
          pesoMaximo: body.pesoMaximo ?? undefined,
          volumeMaximo: body.volumeMaximo ?? undefined,
          paletesMaximo: body.paletesMaximo ?? undefined,
          status: body.status,
        },
      })
      return reply.status(201).send(config)
    } catch (err: any) {
      if (err.code === 'P2002') {
        return reply.status(409).send({ message: `Já existe configuração para o nível ${body.codigoNivel} nesta estrutura` })
      }
      throw err
    }
  })

  // GET / — listar configurações por estrutura
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { estruturaId } = z.object({
      estruturaId: z.string().uuid(),
    }).parse(request.query)

    const configs = await prisma.capacidadeNivel.findMany({
      where: { estruturaId, empresaId: user.empresaId },
      orderBy: { codigoNivel: 'asc' },
    })

    return { data: configs, total: configs.length }
  })

  // PUT /:id — atualizar configuração
  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      codigoNivel: z.string().min(1).max(10).optional(),
      pesoMaximo: z.number().nullable().optional(),
      volumeMaximo: z.number().nullable().optional(),
      paletesMaximo: z.number().int().nullable().optional(),
      status: z.boolean().optional(),
    }).parse(request.body)

    // Verify config exists and belongs to empresa
    const existing = await prisma.capacidadeNivel.findFirst({
      where: { id, empresaId: user.empresaId },
    })
    if (!existing) {
      return reply.status(404).send({ message: 'Configuração não encontrada' })
    }

    // Validate at least one limit > 0 (considering merged values)
    const peso = body.pesoMaximo !== undefined ? (body.pesoMaximo ?? 0) : Number(existing.pesoMaximo ?? 0)
    const volume = body.volumeMaximo !== undefined ? (body.volumeMaximo ?? 0) : Number(existing.volumeMaximo ?? 0)
    const paletes = body.paletesMaximo !== undefined ? (body.paletesMaximo ?? 0) : (existing.paletesMaximo ?? 0)
    if (peso <= 0 && volume <= 0 && paletes <= 0) {
      return reply.status(422).send({ message: 'Pelo menos um limite (peso, volume ou paletes) deve ser maior que zero' })
    }

    try {
      const updated = await prisma.capacidadeNivel.update({
        where: { id },
        data: {
          codigoNivel: body.codigoNivel,
          pesoMaximo: body.pesoMaximo !== undefined ? body.pesoMaximo : undefined,
          volumeMaximo: body.volumeMaximo !== undefined ? body.volumeMaximo : undefined,
          paletesMaximo: body.paletesMaximo !== undefined ? body.paletesMaximo : undefined,
          status: body.status,
        },
      })
      return updated
    } catch (err: any) {
      if (err.code === 'P2002') {
        return reply.status(409).send({ message: `Já existe configuração para o nível ${body.codigoNivel} nesta estrutura` })
      }
      throw err
    }
  })

  // DELETE /:id — excluir configuração
  app.delete('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const existing = await prisma.capacidadeNivel.findFirst({
      where: { id, empresaId: user.empresaId },
    })
    if (!existing) {
      return reply.status(404).send({ message: 'Configuração não encontrada' })
    }

    await prisma.capacidadeNivel.delete({ where: { id } })
    return reply.status(204).send()
  })

  // GET /ocupacao — ocupação atual de todos os níveis de uma estrutura
  app.get('/ocupacao', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { estruturaId } = z.object({
      estruturaId: z.string().uuid(),
    }).parse(request.query)

    // Verify estrutura belongs to empresa
    const estrutura = await prisma.estrutura.findFirst({
      where: { id: estruturaId, empresaId: user.empresaId },
    })
    if (!estrutura) {
      return reply.status(404).send({ message: 'Estrutura não encontrada' })
    }

    // Get all addresses for this structure grouped by nivel
    const enderecos = await prisma.endereco.findMany({
      where: { estruturaId, status: true },
      select: { id: true, codigoNivel: true },
    })

    // Group address IDs by nivel
    const niveisMapa = new Map<string, string[]>()
    for (const end of enderecos) {
      const nivel = end.codigoNivel || '000'
      if (!niveisMapa.has(nivel)) niveisMapa.set(nivel, [])
      niveisMapa.get(nivel)!.push(end.id)
    }

    // Get all capacity configs for this structure
    const configs = await prisma.capacidadeNivel.findMany({
      where: { estruturaId, empresaId: user.empresaId },
    })
    const configMap = new Map(configs.map((c) => [c.codigoNivel, c]))

    // For each nivel, calculate occupancy
    const resultado = []
    for (const [nivel, enderecoIds] of niveisMapa) {
      // Get saldos with SKU data
      const saldos = await prisma.saldoEndereco.findMany({
        where: { enderecoId: { in: enderecoIds }, quantidade: { gt: 0 } },
        include: { produto: { select: { id: true } } },
      })

      // For each saldo, get SKU data
      const saldosComSku = await Promise.all(
        saldos.map(async (s) => {
          const sku = await prisma.sku.findFirst({
            where: { produtoId: s.produtoId },
            select: { pesoBruto: true, volume: true },
          })
          return {
            quantidade: Number(s.quantidade),
            pesoBruto: sku?.pesoBruto ? Number(sku.pesoBruto) : null,
            volume: sku?.volume ? Number(sku.volume) : null,
          }
        })
      )

      const ocupacao = calcularOcupacaoNivel(saldosComSku)
      const config = configMap.get(nivel)

      const pesoMaximo = config?.pesoMaximo ? Number(config.pesoMaximo) : null
      const volumeMaximo = config?.volumeMaximo ? Number(config.volumeMaximo) : null
      const paletesMaximo = config?.paletesMaximo ?? null

      const percentualPeso = pesoMaximo && pesoMaximo > 0 ? (ocupacao.pesoTotal / pesoMaximo) * 100 : 0
      const percentualVolume = volumeMaximo && volumeMaximo > 0 ? (ocupacao.volumeTotal / volumeMaximo) * 100 : 0
      const percentualPaletes = paletesMaximo && paletesMaximo > 0 ? (ocupacao.paletesTotal / paletesMaximo) * 100 : 0

      const maxPercentual = Math.max(percentualPeso, percentualVolume, percentualPaletes)

      resultado.push({
        codigoNivel: nivel,
        pesoAtual: ocupacao.pesoTotal,
        pesoMaximo,
        percentualPeso: Math.round(percentualPeso * 100) / 100,
        volumeAtual: ocupacao.volumeTotal,
        volumeMaximo,
        percentualVolume: Math.round(percentualVolume * 100) / 100,
        paletesAtual: ocupacao.paletesTotal,
        paletesMaximo,
        percentualPaletes: Math.round(percentualPaletes * 100) / 100,
        alertLevel: classificarAlertaNivel(maxPercentual),
      })
    }

    return { data: resultado.sort((a, b) => a.codigoNivel.localeCompare(b.codigoNivel)) }
  })
}
