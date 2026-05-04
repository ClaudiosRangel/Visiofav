import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const criarSchema = z.object({
  tipo: z.enum(['GERAL', 'PARCIAL', 'CICLICO']).default('GERAL'),
  zonaId: z.string().uuid().optional(),
  rua: z.string().optional(),
  observacao: z.string().optional(),
})

const contarItemSchema = z.object({
  itemId: z.string().uuid(),
  saldoContado: z.number().min(0),
})

const contarTodosSchema = z.object({
  itens: z.array(z.object({
    itemId: z.string().uuid(),
    saldoContado: z.number().min(0),
  })),
})

export async function inventarioRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // GET / — listar inventários
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { page, limit, status } = z.object({
      page: z.coerce.number().default(1),
      limit: z.coerce.number().default(20),
      status: z.string().optional(),
    }).parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (status) where.status = status

    const [data, total] = await Promise.all([
      prisma.inventario.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { criadoEm: 'desc' },
        include: { _count: { select: { itens: true } } },
      }),
      prisma.inventario.count({ where }),
    ])

    const dataComStats = data.map((inv) => {
      return { ...inv, totalItens: inv._count.itens }
    })

    return { data: dataComStats, total }
  })

  // POST / — criar inventário (gera itens a partir dos saldos)
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = criarSchema.parse(request.body)

    // Buscar saldos para inventariar
    const saldoWhere: any = { quantidade: { gt: 0 } }
    if (body.zonaId) saldoWhere.endereco = { zonaId: body.zonaId }
    if (body.rua) saldoWhere.endereco = { ...saldoWhere.endereco, codigoRua: body.rua }

    const saldos = await prisma.saldoEndereco.findMany({
      where: saldoWhere,
      include: { endereco: { select: { id: true, enderecoCompleto: true } }, produto: { select: { id: true, nome: true, codigo: true } } },
    })

    if (saldos.length === 0) {
      return reply.status(422).send({ message: 'Nenhum saldo encontrado para inventariar' })
    }

    // Próximo número
    const ultimo = await prisma.inventario.findFirst({
      where: { empresaId: user.empresaId },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    })

    const inventario = await prisma.inventario.create({
      data: {
        empresaId: user.empresaId,
        numero: (ultimo?.numero ?? 0) + 1,
        tipo: body.tipo,
        status: 'ABERTO',
        zonaId: body.zonaId,
        rua: body.rua,
        observacao: body.observacao,
        criadoPorId: user.id,
        itens: {
          create: saldos.map((s) => ({
            enderecoId: s.enderecoId,
            produtoId: s.produtoId,
            saldoSistema: Number(s.quantidade),
            status: 'PENDENTE',
          })),
        },
      },
      include: { itens: true },
    })

    return reply.status(201).send({
      ...inventario,
      totalItens: inventario.itens.length,
    })
  })

  // GET /:id — detalhe do inventário com itens
  app.get('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const inventario = await prisma.inventario.findUnique({
      where: { id },
      include: { itens: true },
    })

    if (!inventario) return reply.status(404).send({ message: 'Inventário não encontrado' })

    // Enriquecer itens com nomes
    const produtoIds = [...new Set(inventario.itens.map((i) => i.produtoId))]
    const enderecoIds = [...new Set(inventario.itens.map((i) => i.enderecoId))]

    const [produtos, enderecos] = await Promise.all([
      prisma.produto.findMany({ where: { id: { in: produtoIds } }, select: { id: true, codigo: true, nome: true } }),
      prisma.endereco.findMany({ where: { id: { in: enderecoIds } }, select: { id: true, enderecoCompleto: true } }),
    ])

    const produtoMap = Object.fromEntries(produtos.map((p) => [p.id, p]))
    const enderecoMap = Object.fromEntries(enderecos.map((e) => [e.id, e]))

    const itensEnriquecidos = inventario.itens.map((item) => ({
      ...item,
      saldoSistema: Number(item.saldoSistema),
      saldoContado: item.saldoContado !== null ? Number(item.saldoContado) : null,
      divergencia: item.divergencia !== null ? Number(item.divergencia) : null,
      produto: produtoMap[item.produtoId] || null,
      endereco: enderecoMap[item.enderecoId] || null,
    }))

    const contados = itensEnriquecidos.filter((i) => i.saldoContado !== null).length
    const conformes = itensEnriquecidos.filter((i) => i.status === 'CONFORME').length
    const divergentes = itensEnriquecidos.filter((i) => i.status === 'DIVERGENTE').length

    return {
      ...inventario,
      itens: itensEnriquecidos,
      resumo: { total: itensEnriquecidos.length, contados, conformes, divergentes, pendentes: itensEnriquecidos.length - contados },
    }
  })

  // PATCH /:id/contar — registrar contagem de um item
  app.patch('/:id/contar', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = contarItemSchema.parse(request.body)

    const inventario = await prisma.inventario.findUnique({ where: { id } })
    if (!inventario) return reply.status(404).send({ message: 'Inventário não encontrado' })
    if (!['ABERTO', 'EM_CONTAGEM'].includes(inventario.status)) {
      return reply.status(422).send({ message: 'Inventário não está aberto para contagem' })
    }

    const item = await prisma.itemInventario.findUnique({ where: { id: body.itemId } })
    if (!item) return reply.status(404).send({ message: 'Item não encontrado' })

    const divergencia = body.saldoContado - Number(item.saldoSistema)
    const status = divergencia === 0 ? 'CONFORME' : 'DIVERGENTE'

    const atualizado = await prisma.itemInventario.update({
      where: { id: body.itemId },
      data: { saldoContado: body.saldoContado, divergencia, status, contadoEm: new Date() },
    })

    // Atualizar status do inventário para EM_CONTAGEM
    if (inventario.status === 'ABERTO') {
      await prisma.inventario.update({ where: { id }, data: { status: 'EM_CONTAGEM' } })
    }

    return { ...atualizado, saldoSistema: Number(atualizado.saldoSistema), saldoContado: Number(atualizado.saldoContado), divergencia: Number(atualizado.divergencia) }
  })

  // PATCH /:id/contar-todos — registrar contagem de todos os itens
  app.patch('/:id/contar-todos', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = contarTodosSchema.parse(request.body)

    const inventario = await prisma.inventario.findUnique({ where: { id } })
    if (!inventario) return reply.status(404).send({ message: 'Inventário não encontrado' })

    let conformes = 0
    let divergentes = 0

    for (const contagem of body.itens) {
      const item = await prisma.itemInventario.findUnique({ where: { id: contagem.itemId } })
      if (!item) continue

      const divergencia = contagem.saldoContado - Number(item.saldoSistema)
      const status = divergencia === 0 ? 'CONFORME' : 'DIVERGENTE'
      if (status === 'CONFORME') conformes++; else divergentes++

      await prisma.itemInventario.update({
        where: { id: contagem.itemId },
        data: { saldoContado: contagem.saldoContado, divergencia, status, contadoEm: new Date() },
      })
    }

    await prisma.inventario.update({ where: { id }, data: { status: 'EM_CONTAGEM' } })

    return { message: 'Contagem registrada', total: body.itens.length, conformes, divergentes }
  })

  // PATCH /:id/aplicar-ajustes — aplicar ajustes de divergência
  app.patch('/:id/aplicar-ajustes', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const inventario = await prisma.inventario.findUnique({
      where: { id },
      include: { itens: { where: { status: 'DIVERGENTE', ajusteAplicado: false } } },
    })

    if (!inventario) return reply.status(404).send({ message: 'Inventário não encontrado' })

    let ajustesAplicados = 0

    await prisma.$transaction(async (tx) => {
      for (const item of inventario.itens) {
        if (item.divergencia === null || item.saldoContado === null) continue

        const divergencia = Number(item.divergencia)

        // Atualizar saldo
        const saldo = await tx.saldoEndereco.findFirst({
          where: { enderecoId: item.enderecoId, produtoId: item.produtoId },
        })

        const saldoAnterior = saldo ? Number(saldo.quantidade) : 0
        const novoSaldo = Number(item.saldoContado)

        if (saldo) {
          await tx.saldoEndereco.update({ where: { id: saldo.id }, data: { quantidade: novoSaldo } })
        }

        // Atualizar estoque consolidado
        await tx.estoque.upsert({
          where: { empresaId_produtoId: { empresaId: user.empresaId, produtoId: item.produtoId } },
          update: { quantidade: { increment: divergencia } },
          create: { empresaId: user.empresaId, produtoId: item.produtoId, quantidade: Math.max(0, novoSaldo) },
        })

        // Log
        await tx.logMovimentacao.create({
          data: {
            empresaId: user.empresaId,
            produtoId: item.produtoId,
            enderecoId: item.enderecoId,
            tipo: 'INVENTARIO',
            quantidade: divergencia,
            saldoAnterior,
            saldoNovo: novoSaldo,
            motivo: `Ajuste inventário #${inventario.numero} — Sistema: ${saldoAnterior}, Contado: ${novoSaldo}`,
            usuarioId: user.id,
          },
        })

        await tx.itemInventario.update({ where: { id: item.id }, data: { ajusteAplicado: true } })
        ajustesAplicados++
      }

      // Concluir inventário
      await tx.inventario.update({ where: { id }, data: { status: 'CONCLUIDO', concluidoEm: new Date() } })
    })

    return { message: 'Ajustes aplicados e inventário concluído', ajustesAplicados }
  })

  // PATCH /:id/concluir — concluir sem ajustes (tudo conforme)
  app.patch('/:id/concluir', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    await prisma.inventario.update({ where: { id }, data: { status: 'CONCLUIDO', concluidoEm: new Date() } })
    return { message: 'Inventário concluído' }
  })
}
