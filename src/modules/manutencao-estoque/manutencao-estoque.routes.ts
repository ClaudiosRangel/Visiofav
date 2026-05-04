import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const ajusteSchema = z.object({
  produtoId: z.string().uuid(),
  enderecoId: z.string().uuid(),
  quantidade: z.number(), // positivo = entrada, negativo = saída
  motivo: z.string().min(1, 'Motivo é obrigatório'),
  tipo: z.enum(['AJUSTE_ENTRADA', 'AJUSTE_SAIDA', 'INVENTARIO', 'AVARIA', 'VENCIMENTO']),
})

const historicoQuerySchema = z.object({
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(50),
  produtoId: z.string().uuid().optional(),
  enderecoId: z.string().uuid().optional(),
  tipo: z.string().optional(),
  dataInicio: z.string().optional(),
  dataFim: z.string().optional(),
})

export async function manutencaoEstoqueRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // POST /ajuste — realizar ajuste manual de estoque
  app.post('/ajuste', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = ajusteSchema.parse(request.body)

    const endereco = await prisma.endereco.findUnique({ where: { id: body.enderecoId } })
    if (!endereco) return reply.status(404).send({ message: 'Endereço não encontrado' })

    const produto = await prisma.produto.findFirst({ where: { id: body.produtoId, empresaId: user.empresaId } })
    if (!produto) return reply.status(404).send({ message: 'Produto não encontrado' })

    const resultado = await prisma.$transaction(async (tx) => {
      // Buscar saldo atual
      const saldo = await tx.saldoEndereco.findFirst({
        where: { enderecoId: body.enderecoId, produtoId: body.produtoId },
      })

      const saldoAnterior = saldo ? Number(saldo.quantidade) : 0
      const novaQtd = saldoAnterior + body.quantidade

      if (novaQtd < 0) throw { status: 422, message: 'Saldo ficaria negativo' }

      // Atualizar SaldoEndereco
      if (saldo) {
        await tx.saldoEndereco.update({
          where: { id: saldo.id },
          data: { quantidade: novaQtd },
        })
      } else if (body.quantidade > 0) {
        await tx.saldoEndereco.create({
          data: { enderecoId: body.enderecoId, produtoId: body.produtoId, quantidade: body.quantidade },
        })
      } else {
        throw { status: 422, message: 'Não há saldo para ajustar neste endereço' }
      }

      // Atualizar Estoque consolidado
      await tx.estoque.upsert({
        where: { empresaId_produtoId: { empresaId: user.empresaId, produtoId: body.produtoId } },
        update: { quantidade: { increment: body.quantidade } },
        create: { empresaId: user.empresaId, produtoId: body.produtoId, quantidade: Math.max(0, body.quantidade) },
      })

      // Registrar log de movimentação
      await tx.logMovimentacao.create({
        data: {
          empresaId: user.empresaId,
          produtoId: body.produtoId,
          enderecoId: body.enderecoId,
          tipo: body.tipo,
          quantidade: body.quantidade,
          saldoAnterior,
          saldoNovo: novaQtd,
          motivo: body.motivo,
          usuarioId: user.id,
        },
      })

      return { saldoAnterior, saldoNovo: novaQtd }
    })

    return {
      message: 'Ajuste realizado',
      tipo: body.tipo,
      quantidade: body.quantidade,
      saldoAnterior: resultado.saldoAnterior,
      saldoNovo: resultado.saldoNovo,
    }
  })

  // GET /historico — histórico de movimentações de estoque
  app.get('/historico', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const query = historicoQuerySchema.parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (query.produtoId) where.produtoId = query.produtoId
    if (query.enderecoId) where.enderecoId = query.enderecoId
    if (query.tipo) where.tipo = query.tipo
    if (query.dataInicio || query.dataFim) {
      where.criadoEm = {}
      if (query.dataInicio) where.criadoEm.gte = new Date(query.dataInicio)
      if (query.dataFim) where.criadoEm.lte = new Date(query.dataFim + 'T23:59:59.999Z')
    }

    const [data, total] = await Promise.all([
      prisma.logMovimentacao.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { criadoEm: 'desc' },
      }),
      prisma.logMovimentacao.count({ where }),
    ])

    // Enriquecer com nomes de produto e endereço
    const produtoIds = [...new Set(data.map((d) => d.produtoId))]
    const enderecoIds = [...new Set(data.map((d) => d.enderecoId))]

    const [produtos, enderecos] = await Promise.all([
      prisma.produto.findMany({ where: { id: { in: produtoIds } }, select: { id: true, codigo: true, nome: true } }),
      prisma.endereco.findMany({ where: { id: { in: enderecoIds } }, select: { id: true, enderecoCompleto: true } }),
    ])

    const produtoMap = Object.fromEntries(produtos.map((p) => [p.id, p]))
    const enderecoMap = Object.fromEntries(enderecos.map((e) => [e.id, e]))

    const dataEnriquecida = data.map((d) => ({
      ...d,
      quantidade: Number(d.quantidade),
      saldoAnterior: Number(d.saldoAnterior),
      saldoNovo: Number(d.saldoNovo),
      produto: produtoMap[d.produtoId] || null,
      endereco: enderecoMap[d.enderecoId] || null,
    }))

    return {
      data: dataEnriquecida,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    }
  })

  // POST /transferencia — transferir estoque entre endereços
  app.post('/transferencia', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = z.object({
      produtoId: z.string().uuid(),
      enderecoOrigemId: z.string().uuid(),
      enderecoDestinoId: z.string().uuid(),
      quantidade: z.number().positive(),
      motivo: z.string().optional(),
    }).parse(request.body)

    if (body.enderecoOrigemId === body.enderecoDestinoId) {
      return reply.status(422).send({ message: 'Endereço de origem e destino devem ser diferentes' })
    }

    const [endOrigem, endDestino, produto] = await Promise.all([
      prisma.endereco.findUnique({ where: { id: body.enderecoOrigemId } }),
      prisma.endereco.findUnique({ where: { id: body.enderecoDestinoId } }),
      prisma.produto.findFirst({ where: { id: body.produtoId, empresaId: user.empresaId } }),
    ])

    if (!endOrigem) return reply.status(404).send({ message: 'Endereço de origem não encontrado' })
    if (!endDestino) return reply.status(404).send({ message: 'Endereço de destino não encontrado' })
    if (!produto) return reply.status(404).send({ message: 'Produto não encontrado' })

    const resultado = await prisma.$transaction(async (tx) => {
      // Verificar saldo na origem
      const saldoOrigem = await tx.saldoEndereco.findFirst({
        where: { enderecoId: body.enderecoOrigemId, produtoId: body.produtoId },
      })

      if (!saldoOrigem || Number(saldoOrigem.quantidade) < body.quantidade) {
        throw { status: 422, message: `Saldo insuficiente na origem. Disponível: ${saldoOrigem ? Number(saldoOrigem.quantidade) : 0}` }
      }

      const saldoAnteriorOrigem = Number(saldoOrigem.quantidade)
      const novoSaldoOrigem = saldoAnteriorOrigem - body.quantidade

      // Debitar origem
      await tx.saldoEndereco.update({
        where: { id: saldoOrigem.id },
        data: { quantidade: novoSaldoOrigem },
      })

      // Creditar destino
      const saldoDestino = await tx.saldoEndereco.findFirst({
        where: { enderecoId: body.enderecoDestinoId, produtoId: body.produtoId },
      })

      const saldoAnteriorDestino = saldoDestino ? Number(saldoDestino.quantidade) : 0
      const novoSaldoDestino = saldoAnteriorDestino + body.quantidade

      if (saldoDestino) {
        await tx.saldoEndereco.update({
          where: { id: saldoDestino.id },
          data: { quantidade: novoSaldoDestino },
        })
      } else {
        await tx.saldoEndereco.create({
          data: { enderecoId: body.enderecoDestinoId, produtoId: body.produtoId, quantidade: body.quantidade },
        })
      }

      const motivoTransf = body.motivo || `Transferência de ${endOrigem.enderecoCompleto} para ${endDestino.enderecoCompleto}`

      // Log saída da origem
      await tx.logMovimentacao.create({
        data: {
          empresaId: user.empresaId,
          produtoId: body.produtoId,
          enderecoId: body.enderecoOrigemId,
          tipo: 'TRANSFERENCIA',
          quantidade: -body.quantidade,
          saldoAnterior: saldoAnteriorOrigem,
          saldoNovo: novoSaldoOrigem,
          motivo: motivoTransf,
          usuarioId: user.id,
        },
      })

      // Log entrada no destino
      await tx.logMovimentacao.create({
        data: {
          empresaId: user.empresaId,
          produtoId: body.produtoId,
          enderecoId: body.enderecoDestinoId,
          tipo: 'TRANSFERENCIA',
          quantidade: body.quantidade,
          saldoAnterior: saldoAnteriorDestino,
          saldoNovo: novoSaldoDestino,
          motivo: motivoTransf,
          usuarioId: user.id,
        },
      })

      return { saldoAnteriorOrigem, novoSaldoOrigem, saldoAnteriorDestino, novoSaldoDestino }
    })

    return {
      message: 'Transferência realizada',
      origem: { endereco: endOrigem.enderecoCompleto, saldoAnterior: resultado.saldoAnteriorOrigem, saldoNovo: resultado.novoSaldoOrigem },
      destino: { endereco: endDestino.enderecoCompleto, saldoAnterior: resultado.saldoAnteriorDestino, saldoNovo: resultado.novoSaldoDestino },
    }
  })
}
