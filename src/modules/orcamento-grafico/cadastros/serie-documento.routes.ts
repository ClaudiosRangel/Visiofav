import { FastifyInstance, FastifyReply } from 'fastify'
import { z, ZodError } from 'zod'
import { prisma } from '../../../lib/prisma'
import { authenticate } from '../../../middleware/authenticate'

/**
 * Cadastro de Séries de numeração (`SerieDocumento`), hoje usado pelo Orçamento
 * Gráfico (origem ORCAMENTO; OP/PEDIDO previstos). Registrado em
 * cadastros-graficos/index.ts → /api/orcamento-grafico/cadastros/series.
 *
 * - empresaId EXPLÍCITO em toda query (não confiar só no prismaScoped).
 * - Nome vazio ('') = série padrão sem nome. Nome único por empresa/origem (409).
 * - Uma única série padrão por empresa/origem (troca em transação).
 */

const ORIGENS = ['ORCAMENTO', 'OP', 'PEDIDO'] as const
const origemSchema = z.enum(ORIGENS, { errorMap: () => ({ message: `deve ser ${ORIGENS.join(', ')}` }) })

const nomeSchema = z
  .string({ invalid_type_error: 'deve ser texto', required_error: 'é obrigatório' })
  .trim()
  .max(10, 'deve ter no máximo 10 caracteres')
const descricaoSchema = z
  .string({ invalid_type_error: 'deve ser texto' })
  .trim()
  .max(100, 'deve ter no máximo 100 caracteres')
  .nullable()
  .optional()
const proximoSchema = z
  .number({ invalid_type_error: 'deve ser número' })
  .int('deve ser inteiro')
  .min(1, 'deve ser maior ou igual a 1')
  .max(2_000_000_000, 'valor muito alto')

const listaQuerySchema = z.object({
  origem: origemSchema.optional(),
  situacao: z.enum(['ativa', 'inativa', 'todas'], { errorMap: () => ({ message: 'deve ser ativa, inativa ou todas' }) }).optional(),
})

const criarSchema = z.object({
  origem: origemSchema.optional(),
  nome: nomeSchema,
  descricao: descricaoSchema,
  proximoNumero: proximoSchema.optional(),
  ativo: z.boolean({ invalid_type_error: 'deve ser verdadeiro/falso' }).optional(),
  padrao: z.boolean({ invalid_type_error: 'deve ser verdadeiro/falso' }).optional(),
})

const atualizarSchema = z.object({
  nome: nomeSchema.optional(),
  descricao: descricaoSchema,
  proximoNumero: proximoSchema.optional(),
})

const idSchema = z.object({ id: z.string().uuid('id inválido') })

/** "campo: motivo" a partir do ZodError. */
export function mensagemZod(err: ZodError): string {
  return err.errors
    .map((e) => (e.path.length ? `${e.path.join('.')}: ${e.message}` : e.message))
    .join('; ')
}

function erro400(reply: FastifyReply, err: ZodError) {
  return reply.status(400).send({ message: mensagemZod(err) })
}

function nomeDuplicado(nome: string) {
  return nome ? `nome: já existe uma série "${nome}"` : 'nome: já existe uma série sem nome (padrão)'
}

const selectSerie = {
  id: true,
  empresaId: true,
  origem: true,
  nome: true,
  descricao: true,
  ativo: true,
  padrao: true,
  proximoNumero: true,
  codigoLegado: true,
  criadoEm: true,
  atualizadoEm: true,
} as const

type Usuario = { id: string; empresaId: string }

export async function serieDocumentoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // GET /series — lista por origem (default ORCAMENTO; situação default: todas)
  app.get('/series', async (request, reply) => {
    const user = request.user as Usuario
    const parsed = listaQuerySchema.safeParse(request.query)
    if (!parsed.success) return erro400(reply, parsed.error)
    const { origem = 'ORCAMENTO', situacao = 'todas' } = parsed.data

    const where: Record<string, unknown> = { empresaId: user.empresaId, origem }
    if (situacao === 'ativa') where.ativo = true
    else if (situacao === 'inativa') where.ativo = false

    return prisma.serieDocumento.findMany({
      where,
      orderBy: [{ padrao: 'desc' }, { nome: 'asc' }],
      select: selectSerie,
    })
  })

  // POST /series — cria
  app.post('/series', async (request, reply) => {
    const user = request.user as Usuario
    const parsed = criarSchema.safeParse(request.body ?? {})
    if (!parsed.success) return erro400(reply, parsed.error)
    const { origem = 'ORCAMENTO', nome, descricao, proximoNumero, ativo = true, padrao = false } = parsed.data
    if (padrao && !ativo) return reply.status(400).send({ message: 'padrao: a série padrão precisa estar ativa' })

    const existente = await prisma.serieDocumento.findFirst({
      where: { empresaId: user.empresaId, origem, nome },
      select: { id: true },
    })
    if (existente) return reply.status(409).send({ message: nomeDuplicado(nome) })

    try {
      const criada = await prisma.$transaction(async (tx) => {
        if (padrao) {
          await tx.serieDocumento.updateMany({
            where: { empresaId: user.empresaId, origem, padrao: true },
            data: { padrao: false },
          })
        }
        return tx.serieDocumento.create({
          data: {
            empresaId: user.empresaId,
            origem,
            nome,
            descricao: descricao ?? null,
            proximoNumero: proximoNumero ?? 1,
            ativo,
            padrao,
          },
          select: selectSerie,
        })
      })
      return reply.status(201).send(criada)
    } catch (err: any) {
      if (err?.code === 'P2002') return reply.status(409).send({ message: nomeDuplicado(nome) })
      throw err
    }
  })

  // PUT /series/:id — atualiza nome/descrição/próximo número
  app.put('/series/:id', async (request, reply) => {
    const user = request.user as Usuario
    const params = idSchema.safeParse(request.params)
    if (!params.success) return erro400(reply, params.error)
    const parsed = atualizarSchema.safeParse(request.body ?? {})
    if (!parsed.success) return erro400(reply, parsed.error)
    const dados = parsed.data

    const atual = await prisma.serieDocumento.findFirst({
      where: { id: params.data.id, empresaId: user.empresaId },
      select: { id: true, origem: true, nome: true },
    })
    if (!atual) return reply.status(404).send({ message: 'Série não encontrada' })

    if (dados.nome !== undefined && dados.nome !== atual.nome) {
      const conflito = await prisma.serieDocumento.findFirst({
        where: { empresaId: user.empresaId, origem: atual.origem, nome: dados.nome, NOT: { id: atual.id } },
        select: { id: true },
      })
      if (conflito) return reply.status(409).send({ message: nomeDuplicado(dados.nome) })
    }

    try {
      return await prisma.serieDocumento.update({
        where: { id: atual.id },
        data: {
          ...(dados.nome !== undefined ? { nome: dados.nome } : {}),
          ...(dados.descricao !== undefined ? { descricao: dados.descricao } : {}),
          ...(dados.proximoNumero !== undefined ? { proximoNumero: dados.proximoNumero } : {}),
        },
        select: selectSerie,
      })
    } catch (err: any) {
      if (err?.code === 'P2002') return reply.status(409).send({ message: nomeDuplicado(dados.nome ?? '') })
      throw err
    }
  })

  // PATCH /series/:id/ativar | /inativar
  for (const acao of ['ativar', 'inativar'] as const) {
    app.patch(`/series/:id/${acao}`, async (request, reply) => {
      const user = request.user as Usuario
      const params = idSchema.safeParse(request.params)
      if (!params.success) return erro400(reply, params.error)

      const atual = await prisma.serieDocumento.findFirst({
        where: { id: params.data.id, empresaId: user.empresaId },
        select: { id: true, padrao: true },
      })
      if (!atual) return reply.status(404).send({ message: 'Série não encontrada' })
      if (acao === 'inativar' && atual.padrao) {
        return reply
          .status(400)
          .send({ message: 'ativo: a série padrão não pode ser inativada; defina outra série como padrão antes' })
      }
      return prisma.serieDocumento.update({
        where: { id: atual.id },
        data: { ativo: acao === 'ativar' },
        select: selectSerie,
      })
    })
  }

  // PATCH /series/:id/padrao — define como padrão (única por empresa/origem)
  app.patch('/series/:id/padrao', async (request, reply) => {
    const user = request.user as Usuario
    const params = idSchema.safeParse(request.params)
    if (!params.success) return erro400(reply, params.error)

    const atual = await prisma.serieDocumento.findFirst({
      where: { id: params.data.id, empresaId: user.empresaId },
      select: { id: true, origem: true, ativo: true },
    })
    if (!atual) return reply.status(404).send({ message: 'Série não encontrada' })
    if (!atual.ativo) return reply.status(400).send({ message: 'padrao: ative a série antes de defini-la como padrão' })

    return prisma.$transaction(async (tx) => {
      await tx.serieDocumento.updateMany({
        where: { empresaId: user.empresaId, origem: atual.origem, padrao: true, NOT: { id: atual.id } },
        data: { padrao: false },
      })
      return tx.serieDocumento.update({
        where: { id: atual.id },
        data: { padrao: true },
        select: selectSerie,
      })
    })
  })
}
