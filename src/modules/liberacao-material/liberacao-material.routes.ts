import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const idParamsSchema = z.object({ id: z.string().uuid() })

const criarLiberacaoSchema = z.object({
  ordemProducaoId: z.string().uuid(),
  centroProducaoDestinoId: z.string().uuid(),
  tipo: z.enum(['TOTAL', 'PARCIAL']),
  itens: z.array(z.object({
    itemOrdemProducaoId: z.string().uuid(),
    quantidadeSolicitada: z.number().positive(),
  })).optional(),
  observacoes: z.string().optional().nullable(),
})

const listQuerySchema = z.object({
  ordemProducaoId: z.string().uuid().optional(),
  status: z.string().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
})

async function proximoNumeroLiberacao(empresaId: string): Promise<number> {
  const ultima = await prisma.liberacaoMaterial.findFirst({
    where: { empresaId },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  })
  return (ultima?.numero ?? 0) + 1
}

export async function liberacaoMaterialRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  // =========================================================================
  // GET /api/liberacoes-material — Listagem
  // =========================================================================
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const query = listQuerySchema.parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (query.ordemProducaoId) where.ordemProducaoId = query.ordemProducaoId
    if (query.status) where.status = query.status

    const [data, total] = await Promise.all([
      prisma.liberacaoMaterial.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { criadoEm: 'desc' },
        include: {
          itens: true,
          ordemProducao: { select: { numero: true, produtoId: true } },
        },
      }),
      prisma.liberacaoMaterial.count({ where }),
    ])

    return { data, total, page: query.page, limit: query.limit }
  })

  // =========================================================================
  // GET /api/liberacoes-material/:id — Detalhe
  // =========================================================================
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const liberacao = await prisma.liberacaoMaterial.findFirst({
      where: { id, empresaId: user.empresaId },
      include: {
        itens: true,
        ordemProducao: { select: { numero: true, produtoId: true, status: true } },
      },
    })

    if (!liberacao) {
      return reply.status(404).send({ message: 'Liberação não encontrada' })
    }

    return liberacao
  })

  // =========================================================================
  // POST /api/liberacoes-material — Criar liberação (PCP → WMS)
  // =========================================================================
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = criarLiberacaoSchema.parse(request.body)

    // Valida OP
    const op = await prisma.ordemProducao.findFirst({
      where: { id: body.ordemProducaoId, empresaId: user.empresaId },
      include: { itens: true },
    })

    if (!op) {
      return reply.status(404).send({ message: 'Ordem de produção não encontrada' })
    }

    if (!['LIBERADA', 'EM_PRODUCAO'].includes(op.status)) {
      return reply.status(400).send({ message: `OP deve estar com status LIBERADA ou EM_PRODUCAO. Status atual: ${op.status}` })
    }

    // Valida centro destino
    const centro = await prisma.centroProducao.findFirst({
      where: { id: body.centroProducaoDestinoId, empresaId: user.empresaId },
    })
    if (!centro) {
      return reply.status(400).send({ message: 'Centro de produção destino não encontrado' })
    }

    // Determina itens a liberar
    let itensParaLiberar: Array<{ itemOrdemProducaoId: string; quantidadeSolicitada: number; produtoId: string }>

    if (body.tipo === 'TOTAL') {
      // Libera todos os itens com quantidade pendente
      itensParaLiberar = op.itens
        .filter((item) => {
          const pendente = Number(item.quantidade) - Number(item.quantidadeLiberada)
          return pendente > 0
        })
        .map((item) => ({
          itemOrdemProducaoId: item.id,
          quantidadeSolicitada: Number(item.quantidade) - Number(item.quantidadeLiberada),
          produtoId: item.produtoComponenteId,
        }))
    } else {
      // Parcial — usa itens informados
      if (!body.itens || body.itens.length === 0) {
        return reply.status(400).send({ message: 'Para liberação PARCIAL, informe os itens' })
      }

      itensParaLiberar = []
      for (const itemReq of body.itens) {
        const itemOp = op.itens.find((i) => i.id === itemReq.itemOrdemProducaoId)
        if (!itemOp) {
          return reply.status(400).send({ message: `Item ${itemReq.itemOrdemProducaoId} não encontrado na OP` })
        }

        const pendente = Number(itemOp.quantidade) - Number(itemOp.quantidadeLiberada)
        if (itemReq.quantidadeSolicitada > pendente) {
          return reply.status(400).send({
            message: `Quantidade solicitada (${itemReq.quantidadeSolicitada}) excede pendente (${pendente}) para item ${itemOp.descricaoProduto}`,
          })
        }

        itensParaLiberar.push({
          itemOrdemProducaoId: itemReq.itemOrdemProducaoId,
          quantidadeSolicitada: itemReq.quantidadeSolicitada,
          produtoId: itemOp.produtoComponenteId,
        })
      }
    }

    if (itensParaLiberar.length === 0) {
      return reply.status(400).send({ message: 'Nenhum item com quantidade pendente para liberar' })
    }

    const numero = await proximoNumeroLiberacao(user.empresaId)

    // Cria liberação com itens
    const liberacao = await prisma.liberacaoMaterial.create({
      data: {
        empresaId: user.empresaId,
        numero,
        ordemProducaoId: body.ordemProducaoId,
        centroProducaoDestinoId: body.centroProducaoDestinoId,
        tipo: body.tipo,
        usuarioId: user.id,
        observacoes: body.observacoes ?? undefined,
        itens: {
          create: itensParaLiberar.map((item) => ({
            itemOrdemProducaoId: item.itemOrdemProducaoId,
            produtoId: item.produtoId,
            quantidadeSolicitada: item.quantidadeSolicitada,
          })),
        },
      },
      include: { itens: true },
    })

    // Atualiza quantidadeLiberada nos itens da OP
    for (const item of itensParaLiberar) {
      await prisma.itemOrdemProducao.update({
        where: { id: item.itemOrdemProducaoId },
        data: {
          quantidadeLiberada: { increment: item.quantidadeSolicitada },
          status: 'PARCIAL',
        },
      })
    }

    // =========================================================================
    // INTEGRAÇÃO WMS: Cria Onda de Separação para o almoxarifado
    // =========================================================================
    let ondaSeparacaoId: string | null = null
    try {
      const empresa = await prisma.empresa.findUnique({ where: { id: user.empresaId } })

      if (empresa?.usaWms) {
        // Busca próximo número de onda
        const ultimaOnda = await prisma.ondaSeparacao.findFirst({
          where: { empresaId: user.empresaId },
          orderBy: { numero: 'desc' },
          select: { numero: true },
        })
        const proximoNumero = (ultimaOnda?.numero ?? 0) + 1

        // Busca uma doca disponível
        const doca = await prisma.doca.findFirst({
          where: { empresaId: user.empresaId, status: true },
          select: { id: true },
        })

        if (doca) {
          // Cria a onda de separação tipo PRODUCAO
          const onda = await prisma.ondaSeparacao.create({
            data: {
              empresaId: user.empresaId,
              numero: proximoNumero,
              prioridade: 'ALTA',
              status: 'PENDENTE',
              docaId: doca.id,
              criadoPorId: user.id,
            },
          })
          ondaSeparacaoId = onda.id

          // Cria OS WMS vinculada
          const ultimaOs = await prisma.ordemServicoWms.findFirst({
            where: { empresaId: user.empresaId },
            orderBy: { numero: 'desc' },
            select: { numero: true },
          })

          await prisma.ordemServicoWms.create({
            data: {
              empresaId: user.empresaId,
              numero: (ultimaOs?.numero ?? 0) + 1,
              tipo: 'SAIDA',
              operacao: 'SEPARACAO',
              status: 'ABERTO',
              ondaSeparacaoId: onda.id,
              observacao: `Separação de materiais para OP #${op.numero} - Liberação #${numero}`,
            },
          })

          // Atualiza status da liberação
          await prisma.liberacaoMaterial.update({
            where: { id: liberacao.id },
            data: { status: 'SEPARANDO' },
          })
        }
      }
    } catch (err) {
      // Se falhar a integração WMS, não bloqueia a liberação
      console.error('[PCP→WMS] Erro ao criar onda de separação:', err)
    }

    return reply.status(201).send({ ...liberacao, ondaSeparacaoId })
  })

  // =========================================================================
  // PATCH /api/liberacoes-material/:id/status — Atualizar status
  // =========================================================================
  app.patch('/:id/status', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = z.object({
      status: z.enum(['SEPARANDO', 'SEPARADA', 'ENTREGUE', 'CANCELADA']),
    }).parse(request.body)

    const liberacao = await prisma.liberacaoMaterial.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!liberacao) {
      return reply.status(404).send({ message: 'Liberação não encontrada' })
    }

    const data: any = { status: body.status }
    if (body.status === 'ENTREGUE') {
      data.dataEntrega = new Date()
    }

    const atualizada = await prisma.liberacaoMaterial.update({
      where: { id },
      data,
    })

    return atualizada
  })
}
