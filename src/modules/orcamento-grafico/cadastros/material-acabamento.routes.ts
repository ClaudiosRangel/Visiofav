import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { authenticate } from '../../../middleware/authenticate'

/**
 * CRUD de Material de Acabamento (catálogo com preço de referência — paridade
 * Calcgraf, Req 6/7). empresaId EXPLÍCITO em TODA query (multi-tenant; não
 * confiar só no prismaScoped — bypass SUPER_ADMIN).
 */
const situacaoEnum = z.enum(['ativa', 'inativa', 'todas'])

const listaQuerySchema = z.object({
  situacao: situacaoEnum.optional(),
  busca: z.string().trim().optional(),
})

const criarSchema = z.object({
  codigo: z.string().trim().min(1, 'Código é obrigatório').max(60, 'Código deve ter no máximo 60 caracteres'),
  nome: z.string().trim().min(1, 'Nome é obrigatório').max(200, 'Nome deve ter no máximo 200 caracteres'),
  valorReferencia: z.number().min(0, 'Valor de referência não pode ser negativo').optional(),
  ativo: z.boolean().optional(),
})

const atualizarSchema = z.object({
  codigo: z.string().trim().min(1, 'Código é obrigatório').max(60, 'Código deve ter no máximo 60 caracteres').optional(),
  nome: z.string().trim().min(1, 'Nome é obrigatório').max(200, 'Nome deve ter no máximo 200 caracteres').optional(),
  valorReferencia: z.number().min(0, 'Valor de referência não pode ser negativo').optional(),
  ativo: z.boolean().optional(),
})

export async function materialAcabamentoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // GET / — lista (default: só ativas)
  app.get('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const parsed = listaQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.errors[0]?.message ?? 'Parâmetros inválidos' })
    }
    const { situacao, busca } = parsed.data

    const where: Record<string, unknown> = { empresaId: user.empresaId }
    if (situacao === 'ativa' || situacao === undefined) where.ativo = true
    else if (situacao === 'inativa') where.ativo = false
    // 'todas' → sem filtro de ativo

    if (busca) {
      where.OR = [
        { codigo: { contains: busca, mode: 'insensitive' } },
        { nome: { contains: busca, mode: 'insensitive' } },
      ]
    }

    return prisma.materialAcabamento.findMany({ where, orderBy: { nome: 'asc' } })
  })

  // POST / — cria
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const parsed = criarSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.errors[0]?.message ?? 'Dados inválidos' })
    }
    const { codigo, nome, valorReferencia, ativo } = parsed.data

    const existente = await prisma.materialAcabamento.findFirst({
      where: { empresaId: user.empresaId, codigo },
      select: { id: true },
    })
    if (existente) {
      return reply.status(409).send({ message: `Já existe um material de acabamento com o código "${codigo}"` })
    }

    const criado = await prisma.materialAcabamento.create({
      data: {
        empresaId: user.empresaId,
        codigo,
        nome,
        valorReferencia: valorReferencia ?? 0,
        ativo: ativo ?? true,
      },
    })
    return reply.status(201).send(criado)
  })

  // PUT /:id — atualiza (parcial)
  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = request.params as { id: string }
    const parsed = atualizarSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.errors[0]?.message ?? 'Dados inválidos' })
    }
    const dados = parsed.data

    const registro = await prisma.materialAcabamento.findFirst({
      where: { id, empresaId: user.empresaId },
    })
    if (!registro) {
      return reply.status(404).send({ message: 'Material de acabamento não encontrado' })
    }

    if (dados.codigo && dados.codigo !== registro.codigo) {
      const conflito = await prisma.materialAcabamento.findFirst({
        where: { empresaId: user.empresaId, codigo: dados.codigo },
        select: { id: true },
      })
      if (conflito) {
        return reply.status(409).send({ message: `Já existe um material de acabamento com o código "${dados.codigo}"` })
      }
    }

    return prisma.materialAcabamento.update({
      where: { id: registro.id },
      data: {
        ...(dados.codigo !== undefined ? { codigo: dados.codigo } : {}),
        ...(dados.nome !== undefined ? { nome: dados.nome } : {}),
        ...(dados.valorReferencia !== undefined ? { valorReferencia: dados.valorReferencia } : {}),
        ...(dados.ativo !== undefined ? { ativo: dados.ativo } : {}),
      },
    })
  })
}
