import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../../../lib/prisma'
import { authenticate } from '../../../middleware/authenticate'

/**
 * CRUD de Cobertura de Tinta (cadastro novo do orçamento gráfico — paridade
 * Calcgraf, Req 10). empresaId EXPLÍCITO em TODA query (multi-tenant; não
 * confiar só no prismaScoped — bypass SUPER_ADMIN).
 */
const situacaoEnum = z.enum(['ativa', 'inativa', 'todas'])

const listaQuerySchema = z.object({
  situacao: situacaoEnum.optional(),
  busca: z.string().trim().optional(),
})

/** Tinta da composição padrão: nome da tinta do cadastro + % (0,01 a 100). */
const tintaPadraoSchema = z.object({
  tinta: z.string().trim().min(1, 'Tinta é obrigatória').max(120, 'Tinta deve ter no máximo 120 caracteres'),
  perc: z.number().gt(0, 'Percentual deve ser maior que 0').max(100, 'Percentual deve ser no máximo 100'),
})

/** Composição padrão: 1 cor usa `umaCor`; N cores, as N primeiras de `cores` (até 12). */
export const tintasPadraoSchema = z.object({
  umaCor: tintaPadraoSchema.nullable().optional(),
  cores: z.array(tintaPadraoSchema).max(12, 'No máximo 12 tintas').default([]),
})

const criarSchema = z.object({
  codigo: z.string().trim().min(1, 'Código é obrigatório').max(60, 'Código deve ter no máximo 60 caracteres'),
  nome: z.string().trim().min(1, 'Nome é obrigatório').max(120, 'Nome deve ter no máximo 120 caracteres'),
  ativo: z.boolean().optional(),
  tintasPadrao: tintasPadraoSchema.nullable().optional(),
})

const atualizarSchema = z.object({
  codigo: z.string().trim().min(1, 'Código é obrigatório').max(60, 'Código deve ter no máximo 60 caracteres').optional(),
  nome: z.string().trim().min(1, 'Nome é obrigatório').max(120, 'Nome deve ter no máximo 120 caracteres').optional(),
  ativo: z.boolean().optional(),
  tintasPadrao: tintasPadraoSchema.nullable().optional(),
})

/** Composição para gravar: null limpa (Prisma.DbNull); composição vazia também vira null. */
function tintasParaGravar(t: z.infer<typeof tintasPadraoSchema> | null | undefined) {
  if (t === undefined) return undefined
  if (t === null || (!t.umaCor && t.cores.length === 0)) return Prisma.DbNull
  return { umaCor: t.umaCor ?? null, cores: t.cores }
}

export async function coberturaTintaRoutes(app: FastifyInstance) {
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

    return prisma.coberturaTinta.findMany({ where, orderBy: { nome: 'asc' } })
  })

  // POST / — cria
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const parsed = criarSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.errors[0]?.message ?? 'Dados inválidos' })
    }
    const { codigo, nome, ativo, tintasPadrao } = parsed.data
    const tintas = tintasParaGravar(tintasPadrao)

    const existente = await prisma.coberturaTinta.findFirst({
      where: { empresaId: user.empresaId, codigo },
      select: { id: true },
    })
    if (existente) {
      return reply.status(409).send({ message: `Já existe uma cobertura de tinta com o código "${codigo}"` })
    }

    const criado = await prisma.coberturaTinta.create({
      data: { empresaId: user.empresaId, codigo, nome, ativo: ativo ?? true, ...(tintas !== undefined ? { tintasPadrao: tintas } : {}) },
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

    const registro = await prisma.coberturaTinta.findFirst({
      where: { id, empresaId: user.empresaId },
    })
    if (!registro) {
      return reply.status(404).send({ message: 'Cobertura de tinta não encontrada' })
    }

    if (dados.codigo && dados.codigo !== registro.codigo) {
      const conflito = await prisma.coberturaTinta.findFirst({
        where: { empresaId: user.empresaId, codigo: dados.codigo },
        select: { id: true },
      })
      if (conflito) {
        return reply.status(409).send({ message: `Já existe uma cobertura de tinta com o código "${dados.codigo}"` })
      }
    }

    return prisma.coberturaTinta.update({
      where: { id: registro.id },
      data: {
        ...(dados.codigo !== undefined ? { codigo: dados.codigo } : {}),
        ...(dados.nome !== undefined ? { nome: dados.nome } : {}),
        ...(dados.ativo !== undefined ? { ativo: dados.ativo } : {}),
        ...(dados.tintasPadrao !== undefined ? { tintasPadrao: tintasParaGravar(dados.tintasPadrao) } : {}),
      },
    })
  })
}
