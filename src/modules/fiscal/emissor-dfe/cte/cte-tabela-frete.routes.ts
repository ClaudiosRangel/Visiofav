/**
 * Rotas de Tabela de Frete para CT-e
 * CRUD completo de tabelas de composição de frete
 *
 * Endpoints:
 * - GET    /cte/tabelas-frete       — Listar tabelas
 * - GET    /cte/tabelas-frete/:id   — Detalhe
 * - POST   /cte/tabelas-frete       — Criar tabela
 * - PUT    /cte/tabelas-frete/:id   — Atualizar tabela
 * - DELETE /cte/tabelas-frete/:id   — Excluir tabela
 * - POST   /cte/tabelas-frete/calcular — Calcular frete a partir de tabela
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../../lib/prisma'

const tabelaFreteSchema = z.object({
  nome: z.string().min(1).max(100),
  descricao: z.string().max(300).optional(),
  ufOrigem: z.string().length(2).optional(),
  ufDestino: z.string().length(2).optional(),
  valorFixo: z.number().min(0).optional(),
  valorFretePeso: z.number().min(0).optional(),
  valorFreteVolume: z.number().min(0).optional(),
  valorAdValorem: z.number().min(0).max(1).optional(),
  valorGris: z.number().min(0).max(1).optional(),
  valorPedagio: z.number().min(0).optional(),
  valorDespacho: z.number().min(0).optional(),
  valorTDE: z.number().min(0).optional(),
  valorSuframa: z.number().min(0).optional(),
  pesoMinimo: z.number().min(0).optional(),
  freteMinimo: z.number().min(0).optional(),
  status: z.boolean().default(true),
})

const calcularFreteSchema = z.object({
  tabelaId: z.string().uuid(),
  pesoBruto: z.number().min(0),
  cubagem: z.number().min(0).optional(),
  valorCarga: z.number().min(0),
})

export async function cteTabelaFreteRoutes(app: FastifyInstance) {
  // GET /cte/tabelas-frete — Listar
  app.get('/cte/tabelas-frete', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(403).send({ message: 'Sem empresa' })

    const filtros = z.object({
      ufOrigem: z.string().length(2).optional(),
      ufDestino: z.string().length(2).optional(),
      status: z.coerce.boolean().optional(),
    }).parse(request.query || {})

    const where: any = { empresaId: user.empresaId }
    if (filtros.ufOrigem) where.ufOrigem = filtros.ufOrigem
    if (filtros.ufDestino) where.ufDestino = filtros.ufDestino
    if (filtros.status != null) where.status = filtros.status

    const tabelas = await prisma.tabelaFreteCte.findMany({
      where,
      orderBy: { nome: 'asc' },
    })
    return tabelas
  })

  // GET /cte/tabelas-frete/:id — Detalhe
  app.get('/cte/tabelas-frete/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(403).send({ message: 'Sem empresa' })

    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const tabela = await prisma.tabelaFreteCte.findFirst({
      where: { id, empresaId: user.empresaId },
    })
    if (!tabela) return reply.status(404).send({ message: 'Tabela não encontrada' })
    return tabela
  })

  // POST /cte/tabelas-frete — Criar
  app.post('/cte/tabelas-frete', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(403).send({ message: 'Sem empresa' })

    const body = tabelaFreteSchema.parse(request.body)

    const tabela = await prisma.tabelaFreteCte.create({
      data: {
        empresaId: user.empresaId,
        nome: body.nome,
        descricao: body.descricao,
        ufOrigem: body.ufOrigem,
        ufDestino: body.ufDestino,
        valorFixo: body.valorFixo,
        valorFretePeso: body.valorFretePeso,
        valorFreteVolume: body.valorFreteVolume,
        valorAdValorem: body.valorAdValorem,
        valorGris: body.valorGris,
        valorPedagio: body.valorPedagio,
        valorDespacho: body.valorDespacho,
        valorTDE: body.valorTDE,
        valorSuframa: body.valorSuframa,
        pesoMinimo: body.pesoMinimo,
        freteMinimo: body.freteMinimo,
        status: body.status,
      },
    })
    return reply.status(201).send(tabela)
  })

  // PUT /cte/tabelas-frete/:id — Atualizar
  app.put('/cte/tabelas-frete/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(403).send({ message: 'Sem empresa' })

    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = tabelaFreteSchema.parse(request.body)

    const existe = await prisma.tabelaFreteCte.findFirst({
      where: { id, empresaId: user.empresaId },
    })
    if (!existe) return reply.status(404).send({ message: 'Tabela não encontrada' })

    const tabela = await prisma.tabelaFreteCte.update({
      where: { id },
      data: body,
    })
    return tabela
  })

  // DELETE /cte/tabelas-frete/:id — Excluir
  app.delete('/cte/tabelas-frete/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(403).send({ message: 'Sem empresa' })

    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const existe = await prisma.tabelaFreteCte.findFirst({
      where: { id, empresaId: user.empresaId },
    })
    if (!existe) return reply.status(404).send({ message: 'Tabela não encontrada' })

    await prisma.tabelaFreteCte.delete({ where: { id } })
    return { sucesso: true }
  })

  // POST /cte/tabelas-frete/calcular — Calcular frete a partir de tabela
  app.post('/cte/tabelas-frete/calcular', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(403).send({ message: 'Sem empresa' })

    const body = calcularFreteSchema.parse(request.body)

    const tabela = await prisma.tabelaFreteCte.findFirst({
      where: { id: body.tabelaId, empresaId: user.empresaId },
    })
    if (!tabela) return reply.status(404).send({ message: 'Tabela não encontrada' })

    // Peso cubado (fator 300 padrão rodoviário)
    const pesoCubado = body.cubagem ? body.cubagem * 300 : 0
    const pesoCalculo = Math.max(body.pesoBruto, pesoCubado, Number(tabela.pesoMinimo || 0))

    // Componentes do frete
    const fretePeso = pesoCalculo * Number(tabela.valorFretePeso || 0)
    const freteVolume = (body.cubagem || 0) * Number(tabela.valorFreteVolume || 0)
    const adValorem = body.valorCarga * Number(tabela.valorAdValorem || 0)
    const gris = body.valorCarga * Number(tabela.valorGris || 0)
    const pedagio = Number(tabela.valorPedagio || 0)
    const despacho = Number(tabela.valorDespacho || 0)
    const tde = Number(tabela.valorTDE || 0)

    let totalFrete = Math.max(fretePeso, freteVolume) + adValorem + gris + pedagio + despacho + tde
    const freteMin = Number(tabela.freteMinimo || 0)
    if (freteMin > 0 && totalFrete < freteMin) {
      totalFrete = freteMin
    }

    return {
      pesoCalculo,
      pesoCubado,
      componentes: [
        { nome: 'FRETE PESO', valor: fretePeso },
        { nome: 'FRETE VOLUME', valor: freteVolume },
        { nome: 'AD VALOREM', valor: adValorem },
        { nome: 'GRIS', valor: gris },
        { nome: 'PEDAGIO', valor: pedagio },
        { nome: 'DESPACHO', valor: despacho },
        { nome: 'TDE', valor: tde },
      ].filter(c => c.valor > 0),
      totalFrete: Math.round(totalFrete * 100) / 100,
      freteMinimo: freteMin,
      aplicouMinimo: freteMin > 0 && (fretePeso + freteVolume + adValorem + gris + pedagio + despacho + tde) < freteMin,
    }
  })
}
