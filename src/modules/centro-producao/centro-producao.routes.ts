import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { ordenarBodySchema } from './centro-producao.schemas'
import { calcularNovaPosicao, validarEmpresaCentros } from './ordenacao.utils'

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

const tipoMaquinaSchema = z.enum(['IMPRESSAO', 'ACABAMENTO', 'CORTADEIRA', 'COLAGEM', 'VERNIZ'])

const centroProducaoBodySchema = z.object({
  codigo: z.string().min(1, 'Código é obrigatório').max(20),
  descricao: z.string().min(1, 'Descrição é obrigatória').max(200),
  tipo: z.enum(['MAQUINA', 'SETOR', 'LINHA']),
  tipoMaquina: tipoMaquinaSchema.nullable().optional(),
  capacidadeHora: z.number().min(0).optional().nullable(),
  custoHora: z.number().min(0).optional().nullable(),
})

const listQuerySchema = z.object({
  busca: z.string().optional(),
  tipo: z.enum(['MAQUINA', 'SETOR', 'LINHA']).optional(),
  tipoMaquina: tipoMaquinaSchema.optional(),
  status: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
})

export async function centroProducaoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  /**
   * GET /api/centros-producao
   * Lista paginada de centros de produção.
   */
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { busca, tipo, tipoMaquina, status, page, limit } = listQuerySchema.parse(request.query)

    const where: any = { empresaId: user.empresaId }

    if (busca) {
      where.OR = [
        { codigo: { contains: busca, mode: 'insensitive' } },
        { descricao: { contains: busca, mode: 'insensitive' } },
      ]
    }

    if (tipo) {
      where.tipo = tipo
    }

    if (tipoMaquina) {
      where.tipoMaquina = tipoMaquina
    }

    if (status !== undefined) {
      where.status = status === 'true'
    }

    const [data, total] = await Promise.all([
      prisma.centroProducao.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ posicao: 'asc' }, { codigo: 'asc' }],
      }),
      prisma.centroProducao.count({ where }),
    ])

    return { data, total, page, limit }
  })

  /**
   * PATCH /api/centros-producao/ordenar
   * Atualiza posições dos centros de produção em batch.
   */
  app.patch('/ordenar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { itens } = ordenarBodySchema.parse(request.body)

    // Buscar IDs dos centros da empresa do usuário
    const centrosEmpresa = await prisma.centroProducao.findMany({
      where: { empresaId: user.empresaId },
      select: { id: true },
    })

    const idsCentrosEmpresa = centrosEmpresa.map((c) => c.id)
    const idsRequisicao = itens.map((item) => item.id)

    // Validar que todos os IDs pertencem à empresa
    if (!validarEmpresaCentros(idsRequisicao, idsCentrosEmpresa)) {
      return reply.status(403).send({ message: 'Um ou mais centros não pertencem à sua empresa' })
    }

    // Atualizar posições em transação
    await prisma.$transaction(
      itens.map((item) =>
        prisma.centroProducao.update({
          where: { id: item.id },
          data: { posicao: item.posicao },
        })
      )
    )

    return { message: 'Ordem atualizada com sucesso', count: itens.length }
  })

  /**
   * GET /api/centros-producao/:id
   * Busca um centro de produção por ID.
   */
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const centro = await prisma.centroProducao.findFirst({
      where: { id, empresaId: user.empresaId },
      include: {
        recursos: { where: { status: true }, orderBy: { codigo: 'asc' } },
      },
    })

    if (!centro) {
      return reply.status(404).send({ message: 'Centro de produção não encontrado' })
    }

    return centro
  })

  /**
   * POST /api/centros-producao
   * Cria um novo centro de produção.
   */
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = centroProducaoBodySchema.parse(request.body)

    const existente = await prisma.centroProducao.findUnique({
      where: {
        empresaId_codigo: {
          empresaId: user.empresaId,
          codigo: body.codigo,
        },
      },
    })

    if (existente) {
      return reply.status(409).send({ message: `Código '${body.codigo}' já existe para esta empresa` })
    }

    const tipoMaquina = body.tipo === 'MAQUINA' ? (body.tipoMaquina ?? null) : null

    // Calcular próxima posição disponível
    const centrosEmpresa = await prisma.centroProducao.findMany({
      where: { empresaId: user.empresaId },
      select: { posicao: true },
    })
    const posicao = calcularNovaPosicao(centrosEmpresa.map(c => c.posicao))

    const centro = await prisma.centroProducao.create({
      data: {
        empresaId: user.empresaId,
        codigo: body.codigo,
        descricao: body.descricao,
        tipo: body.tipo,
        tipoMaquina,
        capacidadeHora: body.capacidadeHora ?? undefined,
        custoHora: body.custoHora ?? undefined,
        posicao,
      },
    })

    return reply.status(201).send(centro)
  })

  /**
   * PUT /api/centros-producao/:id
   * Atualiza um centro de produção.
   */
  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = centroProducaoBodySchema.parse(request.body)

    const centro = await prisma.centroProducao.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!centro) {
      return reply.status(404).send({ message: 'Centro de produção não encontrado' })
    }

    // Verifica duplicidade de código se mudou
    if (body.codigo !== centro.codigo) {
      const existente = await prisma.centroProducao.findUnique({
        where: {
          empresaId_codigo: {
            empresaId: user.empresaId,
            codigo: body.codigo,
          },
        },
      })

      if (existente && existente.id !== id) {
        return reply.status(409).send({ message: `Código '${body.codigo}' já existe para esta empresa` })
      }
    }

    const tipoMaquina = body.tipo === 'MAQUINA' ? (body.tipoMaquina ?? null) : null

    const atualizado = await prisma.centroProducao.update({
      where: { id },
      data: {
        codigo: body.codigo,
        descricao: body.descricao,
        tipo: body.tipo,
        tipoMaquina,
        capacidadeHora: body.capacidadeHora ?? null,
        custoHora: body.custoHora ?? null,
      },
    })

    return atualizado
  })

  /**
   * PATCH /api/centros-producao/:id/inativar
   * Inativa um centro de produção.
   */
  app.patch('/:id/inativar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const centro = await prisma.centroProducao.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!centro) {
      return reply.status(404).send({ message: 'Centro de produção não encontrado' })
    }

    const inativado = await prisma.centroProducao.update({
      where: { id },
      data: { status: false },
    })

    return inativado
  })

  /**
   * PATCH /api/centros-producao/:id/ativar
   * Reativa um centro de produção.
   */
  app.patch('/:id/ativar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const centro = await prisma.centroProducao.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!centro) {
      return reply.status(404).send({ message: 'Centro de produção não encontrado' })
    }

    const ativado = await prisma.centroProducao.update({
      where: { id },
      data: { status: true },
    })

    return ativado
  })
}
