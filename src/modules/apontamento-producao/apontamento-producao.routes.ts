import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const idParamsSchema = z.object({ id: z.string().uuid() })

const criarApontamentoSchema = z.object({
  ordemProducaoId: z.string().uuid(),
  etapaOrdemProducaoId: z.string().uuid().optional().nullable(),
  centroProducaoId: z.string().uuid(),
  quantidadeProduzida: z.number().positive(),
  quantidadeRejeitada: z.number().min(0).optional().default(0),
  dataInicio: z.string().datetime({ offset: true }),
  dataFim: z.string().datetime({ offset: true }),
  funcionarioId: z.string().uuid().optional().nullable(),
  observacoes: z.string().optional().nullable(),
})

const registrarConsumoSchema = z.object({
  consumos: z.array(z.object({
    produtoId: z.string().uuid(),
    quantidadeConsumida: z.number().positive(),
    lote: z.string().optional().nullable(),
    motivoDiferenca: z.string().optional().nullable(),
  })).min(1),
})

const registrarPerdaSchema = z.object({
  perdas: z.array(z.object({
    produtoId: z.string().uuid(),
    quantidade: z.number().positive(),
    tipoPerda: z.enum(['ACERTO_MAQUINA', 'REFUGO', 'APARA', 'DEFEITO', 'VENCIDO', 'OUTRO']),
    centroProducaoId: z.string().uuid(),
    observacoes: z.string().min(1),
  })).min(1),
})

const listQuerySchema = z.object({
  ordemProducaoId: z.string().uuid().optional(),
  centroProducaoId: z.string().uuid().optional(),
  dataDe: z.string().optional(),
  dataAte: z.string().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
})

export async function apontamentoProducaoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  // =========================================================================
  // GET /api/apontamentos-producao — Listagem
  // =========================================================================
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const query = listQuerySchema.parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (query.ordemProducaoId) where.ordemProducaoId = query.ordemProducaoId
    if (query.centroProducaoId) where.centroProducaoId = query.centroProducaoId
    if (query.dataDe || query.dataAte) {
      where.dataInicio = {}
      if (query.dataDe) where.dataInicio.gte = new Date(query.dataDe)
      if (query.dataAte) where.dataInicio.lte = new Date(query.dataAte)
    }

    const [data, total] = await Promise.all([
      prisma.apontamentoProducao.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { criadoEm: 'desc' },
        include: {
          ordemProducao: { select: { numero: true, produtoId: true } },
          centroProducao: { select: { codigo: true, descricao: true } },
        },
      }),
      prisma.apontamentoProducao.count({ where }),
    ])

    return { data, total, page: query.page, limit: query.limit }
  })

  // =========================================================================
  // POST /api/apontamentos-producao — Registrar apontamento
  // =========================================================================
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = criarApontamentoSchema.parse(request.body)

    // Valida OP
    const op = await prisma.ordemProducao.findFirst({
      where: { id: body.ordemProducaoId, empresaId: user.empresaId },
    })

    if (!op) {
      return reply.status(404).send({ message: 'Ordem de produção não encontrada' })
    }

    if (!['LIBERADA', 'EM_PRODUCAO'].includes(op.status)) {
      return reply.status(400).send({ message: `OP deve estar LIBERADA ou EM_PRODUCAO. Status atual: ${op.status}` })
    }

    // Valida centro
    const centro = await prisma.centroProducao.findFirst({
      where: { id: body.centroProducaoId, empresaId: user.empresaId },
    })
    if (!centro) {
      return reply.status(400).send({ message: 'Centro de produção não encontrado' })
    }

    // Calcula tempo
    const inicio = new Date(body.dataInicio)
    const fim = new Date(body.dataFim)
    const tempoMinutos = Math.round(((fim.getTime() - inicio.getTime()) / 60000) * 100) / 100

    // Cria apontamento
    const apontamento = await prisma.apontamentoProducao.create({
      data: {
        empresaId: user.empresaId,
        ordemProducaoId: body.ordemProducaoId,
        etapaOrdemProducaoId: body.etapaOrdemProducaoId ?? undefined,
        centroProducaoId: body.centroProducaoId,
        quantidadeProduzida: body.quantidadeProduzida,
        quantidadeRejeitada: body.quantidadeRejeitada,
        dataInicio: inicio,
        dataFim: fim,
        tempoProducaoMinutos: tempoMinutos,
        funcionarioId: body.funcionarioId ?? undefined,
        observacoes: body.observacoes ?? undefined,
      },
    })

    // Atualiza OP — acumula quantidade produzida
    const opAtualizada = await prisma.ordemProducao.update({
      where: { id: body.ordemProducaoId },
      data: {
        quantidadeProduzida: { increment: body.quantidadeProduzida },
        quantidadeRejeitada: { increment: body.quantidadeRejeitada },
      },
    })

    // Transiciona para EM_PRODUCAO se era LIBERADA
    if (op.status === 'LIBERADA') {
      await prisma.ordemProducao.update({
        where: { id: body.ordemProducaoId },
        data: { status: 'EM_PRODUCAO', dataInicioReal: new Date() },
      })

      await prisma.logOrdemProducao.create({
        data: {
          ordemProducaoId: body.ordemProducaoId,
          statusAnterior: 'LIBERADA',
          statusNovo: 'EM_PRODUCAO',
          usuarioId: user.id,
          observacao: 'Primeiro apontamento registrado',
        },
      })
    }

    // Atualiza etapa se vinculada
    if (body.etapaOrdemProducaoId) {
      await prisma.etapaOrdemProducao.update({
        where: { id: body.etapaOrdemProducaoId },
        data: {
          status: 'EM_ANDAMENTO',
          dataInicioReal: inicio,
        },
      })
    }

    return reply.status(201).send(apontamento)
  })

  // =========================================================================
  // POST /api/apontamentos-producao/:id/consumos — Registrar consumo real
  // =========================================================================
  app.post('/:id/consumos', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = registrarConsumoSchema.parse(request.body)

    const apontamento = await prisma.apontamentoProducao.findFirst({
      where: { id, empresaId: user.empresaId },
      include: { ordemProducao: { include: { itens: true } } },
    })

    if (!apontamento) {
      return reply.status(404).send({ message: 'Apontamento não encontrado' })
    }

    const resultados: Array<{ produtoId: string; quantidadeConsumida: number; status: string }> = []

    for (const consumo of body.consumos) {
      // Busca item da OP correspondente
      const itemOp = apontamento.ordemProducao.itens.find(
        (i) => i.produtoComponenteId === consumo.produtoId,
      )

      if (itemOp) {
        await prisma.itemOrdemProducao.update({
          where: { id: itemOp.id },
          data: { quantidadeConsumida: { increment: consumo.quantidadeConsumida } },
        })
      }

      resultados.push({
        produtoId: consumo.produtoId,
        quantidadeConsumida: consumo.quantidadeConsumida,
        status: itemOp ? 'registrado' : 'item_nao_encontrado_na_op',
      })
    }

    return { apontamentoId: id, consumos: resultados }
  })

  // =========================================================================
  // POST /api/apontamentos-producao/:id/perdas — Registrar perdas/refugo
  // =========================================================================
  app.post('/:id/perdas', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = registrarPerdaSchema.parse(request.body)

    const apontamento = await prisma.apontamentoProducao.findFirst({
      where: { id, empresaId: user.empresaId },
      include: { ordemProducao: { include: { itens: true } } },
    })

    if (!apontamento) {
      return reply.status(404).send({ message: 'Apontamento não encontrado' })
    }

    const resultados: Array<{ produtoId: string; quantidade: number; tipoPerda: string }> = []

    for (const perda of body.perdas) {
      // Atualiza quantidadePerda no item da OP
      const itemOp = apontamento.ordemProducao.itens.find(
        (i) => i.produtoComponenteId === perda.produtoId,
      )

      if (itemOp) {
        await prisma.itemOrdemProducao.update({
          where: { id: itemOp.id },
          data: { quantidadePerda: { increment: perda.quantidade } },
        })
      }

      resultados.push({
        produtoId: perda.produtoId,
        quantidade: perda.quantidade,
        tipoPerda: perda.tipoPerda,
      })
    }

    return { apontamentoId: id, perdas: resultados }
  })
}
