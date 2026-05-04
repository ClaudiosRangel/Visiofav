import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

const vendedorBodySchema = z.object({
  nome: z.string().min(1, 'Nome é obrigatório').max(150, 'Nome deve ter no máximo 150 caracteres'),
  cpf: z.string().min(1, 'CPF é obrigatório'),
  comissao: z.number().min(0, 'Comissão mínima é 0').max(100, 'Comissão máxima é 100'),
})

const listQuerySchema = z.object({
  busca: z.string().optional(),
  status: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
})

export async function vendedorRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('VENDAS'))

  /**
   * GET /api/vendedores
   * Lista paginada de vendedores com busca por nome e filtro por status.
   */
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { busca, status, page, limit } = listQuerySchema.parse(request.query)

    const where: any = { empresaId: user.empresaId }

    if (busca) {
      where.nome = { contains: busca, mode: 'insensitive' }
    }

    if (status !== undefined) {
      where.status = status === 'true'
    }

    const [data, total] = await Promise.all([
      prisma.vendedor.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { nome: 'asc' },
      }),
      prisma.vendedor.count({ where }),
    ])

    return { data, total }
  })

  /**
   * POST /api/vendedores
   * Cria um novo vendedor. Retorna 409 se CPF já existe para vendedor ativo na mesma empresa.
   */
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = vendedorBodySchema.parse(request.body)

    const existente = await prisma.vendedor.findUnique({
      where: {
        empresaId_cpf: {
          empresaId: user.empresaId,
          cpf: body.cpf,
        },
      },
    })

    if (existente && existente.status) {
      return reply.status(409).send({ message: 'CPF já cadastrado para um vendedor ativo nesta empresa' })
    }

    const vendedor = await prisma.vendedor.create({
      data: {
        empresaId: user.empresaId,
        nome: body.nome,
        cpf: body.cpf,
        comissao: body.comissao,
      },
    })

    return reply.status(201).send(vendedor)
  })

  /**
   * PUT /api/vendedores/:id
   * Edita um vendedor existente.
   */
  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = vendedorBodySchema.parse(request.body)

    const vendedor = await prisma.vendedor.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!vendedor) {
      return reply.status(404).send({ message: 'Vendedor não encontrado' })
    }

    // Verifica se o CPF já pertence a outro vendedor ativo na mesma empresa
    if (body.cpf !== vendedor.cpf) {
      const existente = await prisma.vendedor.findUnique({
        where: {
          empresaId_cpf: {
            empresaId: user.empresaId,
            cpf: body.cpf,
          },
        },
      })

      if (existente && existente.status && existente.id !== id) {
        return reply.status(409).send({ message: 'CPF já cadastrado para um vendedor ativo nesta empresa' })
      }
    }

    const atualizado = await prisma.vendedor.update({
      where: { id },
      data: {
        nome: body.nome,
        cpf: body.cpf,
        comissao: body.comissao,
      },
    })

    return atualizado
  })

  /**
   * PATCH /api/vendedores/:id/inativar
   * Inativa um vendedor (mantém vínculos históricos).
   */
  app.patch('/:id/inativar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const vendedor = await prisma.vendedor.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!vendedor) {
      return reply.status(404).send({ message: 'Vendedor não encontrado' })
    }

    const inativado = await prisma.vendedor.update({
      where: { id },
      data: { status: false },
    })

    return inativado
  })
}
