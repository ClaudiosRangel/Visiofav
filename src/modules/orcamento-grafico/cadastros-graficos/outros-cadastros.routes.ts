import { FastifyInstance, FastifyReply } from 'fastify'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { authenticate } from '../../../middleware/authenticate'

/**
 * Cadastros do orçamento gráfico (fase 1): Itens Diversos, Campos Livres,
 * Ajustes de Produtividade, Quebras (com limites), Limites de Montagem e
 * Parâmetros gerais do orçamento.
 *
 * - empresaId EXPLÍCITO (de user.empresaId) em toda query e criação.
 * - Ajustes, Quebras e Limites de Montagem são SOMENTE cadastro/visualização:
 *   nenhuma rota do motor de cálculo nem do PCP os consulta.
 * - Parâmetros ficam na tabela `Parametro` com prefixo `orc.`; o motor atual
 *   segue com os valores que já usa (leitura pelo motor é da Fase 2).
 */

type UserToken = { id: string; empresaId: string; perfil?: string }

const ID = z.string().uuid('Identificador inválido')
const idParams = z.object({ id: ID })

function msgZod(error: z.ZodError): string {
  const i = error.errors[0]
  if (!i) return 'Dados inválidos'
  const campo = i.path.join('.')
  return campo ? `${campo}: ${i.message}` : i.message
}

function bad(reply: FastifyReply, error: z.ZodError) {
  return reply.status(400).send({ message: msgZod(error) })
}

const num = (v: z.ZodNumber) => v.finite()
const decOpt = z.number().finite().nullable().optional()
const statusFiltro = z.enum(['ativo', 'inativo', 'todos']).optional()

function filtroStatus(status: 'ativo' | 'inativo' | 'todos' | undefined): { status?: boolean } {
  if (status === 'todos') return {}
  if (status === 'inativo') return { status: false }
  return { status: true }
}

function paginacao(q: { pagina?: number; limite?: number }) {
  const limite = q.limite ?? 50
  const pagina = q.pagina ?? 1
  return { take: limite, skip: (pagina - 1) * limite, pagina, limite }
}

const paginaSchema = {
  pagina: z.coerce.number().int().min(1).optional(),
  limite: z.coerce.number().int().min(1).max(500).optional(),
}

// ---------------------------------------------------------------------------
// Parâmetros gerais do orçamento (prefixo orc.) — lista fechada
// ---------------------------------------------------------------------------

interface DefParametro {
  chave: string
  descricao: string
  padrao: number
  min: number
  max: number
  inteiro?: boolean
}

export const PARAMETROS_ORCAMENTO: readonly DefParametro[] = [
  { chave: 'orc.refileFolhaInteira', descricao: 'Refile de folha inteira (mm)', padrao: 2, min: 0, max: 100 },
  { chave: 'orc.contraPinca', descricao: 'Contra-pinça (mm)', padrao: 8, min: 0, max: 100 },
  { chave: 'orc.refileFinal', descricao: 'Refile final (mm)', padrao: 1, min: 0, max: 100 },
  { chave: 'orc.corteDuplo', descricao: 'Corte duplo (mm)', padrao: 0, min: 0, max: 100 },
  { chave: 'orc.partidaTintaGramas', descricao: 'Partida de consumo de tinta (g)', padrao: 200, min: 0, max: 100000 },
  { chave: 'orc.jurosAplicacaoMes', descricao: 'Juros de aplicação (% ao mês)', padrao: 2, min: 0, max: 100 },
  { chave: 'orc.jurosBancariosMes', descricao: 'Juros bancários (% ao mês)', padrao: 2, min: 0, max: 100 },
  { chave: 'orc.aplicarJurosPrazo', descricao: 'Aplicar juros pelo prazo de pagamento no preço (1 = sim, 0 = não)', padrao: 1, min: 0, max: 1, inteiro: true },
  { chave: 'orc.margemMinimaPerc', descricao: 'Margem mínima entre custo e preço (%)', padrao: 30, min: 0, max: 100 },
  { chave: 'orc.valorMinimoParcelamento', descricao: 'Valor total mínimo para parcelar o pagamento (R$; 0 = sem limite)', padrao: 0, min: 0, max: 1000000000 },
  { chave: 'orc.prazoMedioProducaoDias', descricao: 'Prazo médio de produção (dias)', padrao: 2, min: 0, max: 3650, inteiro: true },
  { chave: 'orc.diasRecusado', descricao: 'Dias para tratar como recusado', padrao: 210, min: 0, max: 3650, inteiro: true },
] as const

const DEF_POR_CHAVE = new Map(PARAMETROS_ORCAMENTO.map((p) => [p.chave, p]))

/** Lê os parâmetros da empresa aplicando os valores padrão quando a chave não existe. */
export async function lerParametrosOrcamento(empresaId: string): Promise<Record<string, number>> {
  const registros = await prisma.parametro.findMany({
    where: { empresaId, chave: { startsWith: 'orc.' } },
    select: { chave: true, valor: true },
  })
  const salvos = new Map(registros.map((r) => [r.chave, r.valor]))
  const out: Record<string, number> = {}
  for (const def of PARAMETROS_ORCAMENTO) {
    const bruto = salvos.get(def.chave)
    const n = bruto === undefined ? NaN : Number(bruto)
    out[def.chave.slice('orc.'.length)] = Number.isFinite(n) ? n : def.padrao
  }
  return out
}

/** Valida valores recebidos (chave sem prefixo) contra lista fechada e faixa. */
function validarParametros(body: Record<string, unknown>): { ok: true; itens: { chave: string; valor: number }[] } | { ok: false; message: string } {
  const itens: { chave: string; valor: number }[] = []
  for (const [k, v] of Object.entries(body)) {
    const chave = k.startsWith('orc.') ? k : `orc.${k}`
    const def = DEF_POR_CHAVE.get(chave)
    if (!def) return { ok: false, message: `Parâmetro "${k}" não é permitido` }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return { ok: false, message: `${def.descricao}: informe um número válido` }
    }
    if (def.inteiro && !Number.isInteger(v)) {
      return { ok: false, message: `${def.descricao}: informe um número inteiro` }
    }
    if (v < def.min || v > def.max) {
      return { ok: false, message: `${def.descricao}: valor deve estar entre ${def.min} e ${def.max}` }
    }
    itens.push({ chave, valor: v })
  }
  return { ok: true, itens }
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const itemDiversoBase = z.object({
  codigoOrigem: z.number().int().nullable().optional(),
  nome: z.string().trim().min(1, 'Nome é obrigatório').max(200),
  origem: z.enum(['CENTRO_DE_CUSTO', 'SERVICO_EXTERNO', 'PRE_IMPRESSAO', 'TINTA', 'MATRIZ_IMPRESSAO']),
  automatico: z.boolean().optional(),
  tipoCalculo: z.string().trim().max(30).nullable().optional(),
  aplicadoSobre: z.string().trim().max(30).nullable().optional(),
  quantidadeAceite: decOpt,
  quantidadePorUnidade: decOpt,
  quantidadeMinima: decOpt,
  porCaderno: z.boolean().optional(),
  custoInformado: decOpt,
  calculoPorQtdCores: z.boolean().optional(),
  acompanhaMontImpressao: z.boolean().optional(),
  itemRevenda: z.boolean().optional(),
  quebraPerc: decOpt,
  textoProposta: z.string().nullable().optional(),
  sigla: z.string().trim().max(30).nullable().optional(),
  pendenciaAutomaticaPcp: z.boolean().optional(),
  status: z.boolean().optional(),
  /** Vínculo com atividades (relação ITEM_DIVERSO → ATIVIDADE). Substitui o conjunto quando enviado. */
  atividadeIds: z.array(ID).max(500).optional(),
})
const itemDiversoCriar = itemDiversoBase
const itemDiversoAtualizar = itemDiversoBase.partial()

const opcaoSchema = z.object({
  valor: z.string().trim().min(1, 'Valor da opção é obrigatório').max(200),
  padrao: z.boolean().optional(),
  ordem: z.number().int().optional(),
})

function validarUmPadrao(opcoes: { padrao?: boolean }[] | undefined): string | null {
  if (!opcoes) return null
  return opcoes.filter((o) => o.padrao).length > 1 ? 'Só pode haver uma opção padrão por campo' : null
}

const campoLivreBase = z.object({
  proprietario: z.enum(['SOLICITACAO', 'PEDIDO', 'RECUSA', 'INSUMO']),
  codigoOrigem: z.number().int().nullable().optional(),
  nome: z.string().trim().min(1, 'Nome é obrigatório').max(120),
  tipo: z.enum(['TEXTO', 'LISTA']).optional(),
  obrigatorio: z.boolean().optional(),
  ordem: z.number().int().optional(),
  status: z.boolean().optional(),
  copiaParaPedidoCampoId: ID.nullable().optional(),
  opcoes: z.array(opcaoSchema).max(200).optional(),
})
const campoLivreAtualizar = campoLivreBase.partial()

const ajusteBase = z.object({
  acabamentoId: ID,
  centroProducaoId: ID.nullable().optional(),
  dadoAjustar: z.enum(['ACERTO', 'PRODUCAO_HORA', 'CONSUMO_MATERIAL', 'INCONDICIONAL']),
  funcao: z.enum(['RESTRICAO_MANUAL', 'ATIVIDADE', 'FORMATO_PROCESSO']),
  operador: z.string().trim().max(20).nullable().optional(),
  valor: z.string().trim().max(120).nullable().optional(),
  fator: num(z.number()).optional(),
  fatorPositivo: z.boolean().optional(),
  impedeMontagemCadernos: z.boolean().optional(),
  restricaoId: ID.nullable().optional(),
})
const ajusteAtualizar = ajusteBase.partial()

const limiteSchema = z.object({
  tiragemAte: z.number().int().min(0),
  quebraPerc: z.number().finite().min(0).max(1000),
})

const quebraBase = z.object({
  codigoOrigem: z.number().int().nullable().optional(),
  nome: z.string().trim().min(1, 'Nome é obrigatório').max(200),
  tipoAtividade: z.enum(['IMPRESSAO', 'ACABAMENTO']).optional(),
  pedacosPorAcerto: decOpt,
  pedacosPorPlano: decOpt,
  pedacosPorTipoPlano: decOpt,
  pedacosOcorrencias: decOpt,
  pedacosMinimoPerc: decOpt,
  interpolar: z.boolean().optional(),
  status: z.boolean().optional(),
  limites: z.array(limiteSchema).max(500).optional(),
})
const quebraAtualizar = quebraBase.partial()

const limiteMontagemBase = z
  .object({
    formatoFinalLargura: z.number().finite().positive('Largura deve ser maior que zero'),
    formatoFinalAltura: z.number().finite().positive('Altura deve ser maior que zero'),
    minimo: z.number().int().min(0),
    maximo: z.number().int().min(0),
  })
  .refine((v) => v.maximo >= v.minimo, { message: 'Máximo deve ser maior ou igual ao mínimo', path: ['maximo'] })
const limiteMontagemAtualizar = z
  .object({
    formatoFinalLargura: z.number().finite().positive().optional(),
    formatoFinalAltura: z.number().finite().positive().optional(),
    minimo: z.number().int().min(0).optional(),
    maximo: z.number().int().min(0).optional(),
  })

// ---------------------------------------------------------------------------
// Helpers de acesso
// ---------------------------------------------------------------------------

/** Remove undefined e converte números para o formato aceito pelo Prisma. */
function limpar<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T
}

function ehViolacaoUnica(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
}

/** Confere que todos os ids existem como atividade da empresa; devolve os inválidos. */
async function idsAtividadeInvalidos(empresaId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const achados = await prisma.acabamentoGrafico.findMany({
    where: { empresaId, id: { in: ids } },
    select: { id: true },
  })
  const ok = new Set(achados.map((a) => a.id))
  return ids.filter((i) => !ok.has(i))
}

async function atividadesDoItem(empresaId: string, itemId: string): Promise<string[]> {
  const rels = await prisma.relacaoCadastroGrafico.findMany({
    where: { empresaId, tipoOrigem: 'ITEM_DIVERSO', idOrigem: itemId, tipoDestino: 'ATIVIDADE' },
    orderBy: [{ ordem: 'asc' }],
    select: { idDestino: true },
  })
  return rels.map((r) => r.idDestino)
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export async function outrosCadastrosRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // ========================= ITENS DIVERSOS =================================
  const listaItens = z.object({
    busca: z.string().trim().optional(),
    origem: z.string().trim().optional(),
    status: statusFiltro,
    ...paginaSchema,
  })

  app.get('/itens-diversos', async (request, reply) => {
    const user = request.user as UserToken
    const q = listaItens.safeParse(request.query)
    if (!q.success) return bad(reply, q.error)
    const { busca, origem, status } = q.data
    const where: Prisma.ItemDiversoGraficoWhereInput = {
      empresaId: user.empresaId,
      ...filtroStatus(status),
      ...(origem ? { origem } : {}),
      ...(busca
        ? { OR: [{ nome: { contains: busca, mode: 'insensitive' } }, { sigla: { contains: busca, mode: 'insensitive' } }] }
        : {}),
    }
    const { take, skip, pagina, limite } = paginacao(q.data)
    const [total, itens] = await Promise.all([
      prisma.itemDiversoGrafico.count({ where }),
      prisma.itemDiversoGrafico.findMany({ where, orderBy: { nome: 'asc' }, take, skip }),
    ])
    return { total, pagina, limite, itens }
  })

  app.get('/itens-diversos/:id', async (request, reply) => {
    const user = request.user as UserToken
    const p = idParams.safeParse(request.params)
    if (!p.success) return bad(reply, p.error)
    const item = await prisma.itemDiversoGrafico.findFirst({ where: { id: p.data.id, empresaId: user.empresaId } })
    if (!item) return reply.status(404).send({ message: 'Item diverso não encontrado' })
    return { ...item, atividadeIds: await atividadesDoItem(user.empresaId, item.id) }
  })

  async function gravarVinculoAtividades(tx: Prisma.TransactionClient, empresaId: string, itemId: string, ids: string[]) {
    await tx.relacaoCadastroGrafico.deleteMany({
      where: { empresaId, tipoOrigem: 'ITEM_DIVERSO', idOrigem: itemId, tipoDestino: 'ATIVIDADE' },
    })
    const unicos = [...new Set(ids)]
    if (unicos.length > 0) {
      await tx.relacaoCadastroGrafico.createMany({
        data: unicos.map((idDestino, ordem) => ({
          empresaId,
          tipoOrigem: 'ITEM_DIVERSO',
          idOrigem: itemId,
          tipoDestino: 'ATIVIDADE',
          idDestino,
          ordem,
        })),
      })
    }
  }

  app.post('/itens-diversos', async (request, reply) => {
    const user = request.user as UserToken
    const p = itemDiversoCriar.safeParse(request.body)
    if (!p.success) return bad(reply, p.error)
    const { atividadeIds, ...dados } = p.data

    if (dados.codigoOrigem != null) {
      const dup = await prisma.itemDiversoGrafico.findFirst({
        where: { empresaId: user.empresaId, codigoOrigem: dados.codigoOrigem },
        select: { id: true },
      })
      if (dup) return reply.status(409).send({ message: `Já existe um item diverso com o código de origem ${dados.codigoOrigem}` })
    }
    if (atividadeIds) {
      const invalidos = await idsAtividadeInvalidos(user.empresaId, atividadeIds)
      if (invalidos.length) return reply.status(422).send({ message: 'Atividades inexistentes nesta empresa', idsInvalidos: invalidos })
    }

    try {
      const criado = await prisma.$transaction(async (tx) => {
        const item = await tx.itemDiversoGrafico.create({ data: { ...limpar(dados), empresaId: user.empresaId } })
        if (atividadeIds) await gravarVinculoAtividades(tx, user.empresaId, item.id, atividadeIds)
        return item
      })
      return reply.status(201).send({ ...criado, atividadeIds: atividadeIds ? [...new Set(atividadeIds)] : [] })
    } catch (e) {
      if (ehViolacaoUnica(e)) return reply.status(409).send({ message: 'Já existe um item diverso com este código de origem' })
      throw e
    }
  })

  app.patch('/itens-diversos/:id', async (request, reply) => {
    const user = request.user as UserToken
    const pp = idParams.safeParse(request.params)
    if (!pp.success) return bad(reply, pp.error)
    const p = itemDiversoAtualizar.safeParse(request.body)
    if (!p.success) return bad(reply, p.error)
    const { atividadeIds, ...dados } = p.data

    const atual = await prisma.itemDiversoGrafico.findFirst({ where: { id: pp.data.id, empresaId: user.empresaId } })
    if (!atual) return reply.status(404).send({ message: 'Item diverso não encontrado' })

    if (dados.codigoOrigem != null && dados.codigoOrigem !== atual.codigoOrigem) {
      const dup = await prisma.itemDiversoGrafico.findFirst({
        where: { empresaId: user.empresaId, codigoOrigem: dados.codigoOrigem, NOT: { id: atual.id } },
        select: { id: true },
      })
      if (dup) return reply.status(409).send({ message: `Já existe um item diverso com o código de origem ${dados.codigoOrigem}` })
    }
    if (atividadeIds) {
      const invalidos = await idsAtividadeInvalidos(user.empresaId, atividadeIds)
      if (invalidos.length) return reply.status(422).send({ message: 'Atividades inexistentes nesta empresa', idsInvalidos: invalidos })
    }

    const atualizado = await prisma.$transaction(async (tx) => {
      const item = await tx.itemDiversoGrafico.update({ where: { id: atual.id }, data: limpar(dados) })
      if (atividadeIds) await gravarVinculoAtividades(tx, user.empresaId, atual.id, atividadeIds)
      return item
    })
    return { ...atualizado, atividadeIds: await atividadesDoItem(user.empresaId, atual.id) }
  })

  // DELETE lógico (status = false)
  app.delete('/itens-diversos/:id', async (request, reply) => {
    const user = request.user as UserToken
    const p = idParams.safeParse(request.params)
    if (!p.success) return bad(reply, p.error)
    const r = await prisma.itemDiversoGrafico.updateMany({
      where: { id: p.data.id, empresaId: user.empresaId },
      data: { status: false },
    })
    if (r.count === 0) return reply.status(404).send({ message: 'Item diverso não encontrado' })
    return reply.status(204).send()
  })

  // ========================= CAMPOS LIVRES ==================================
  const listaCampos = z.object({
    proprietario: z.enum(['SOLICITACAO', 'PEDIDO', 'RECUSA', 'INSUMO']).optional(),
    status: statusFiltro,
  })

  app.get('/campos-livres', async (request, reply) => {
    const user = request.user as UserToken
    const q = listaCampos.safeParse(request.query)
    if (!q.success) return bad(reply, q.error)
    return prisma.campoLivre.findMany({
      where: {
        empresaId: user.empresaId,
        ...filtroStatus(q.data.status),
        ...(q.data.proprietario ? { proprietario: q.data.proprietario } : {}),
      },
      orderBy: [{ proprietario: 'asc' }, { ordem: 'asc' }, { nome: 'asc' }],
      include: { opcoes: { where: { empresaId: user.empresaId }, orderBy: [{ ordem: 'asc' }, { valor: 'asc' }] } },
    })
  })

  app.get('/campos-livres/:id', async (request, reply) => {
    const user = request.user as UserToken
    const p = idParams.safeParse(request.params)
    if (!p.success) return bad(reply, p.error)
    const campo = await prisma.campoLivre.findFirst({
      where: { id: p.data.id, empresaId: user.empresaId },
      include: { opcoes: { where: { empresaId: user.empresaId }, orderBy: [{ ordem: 'asc' }, { valor: 'asc' }] } },
    })
    if (!campo) return reply.status(404).send({ message: 'Campo livre não encontrado' })
    return campo
  })

  /** O campo de pedido de cópia deve existir na empresa e ser do proprietário PEDIDO. */
  async function copiaPedidoInvalida(empresaId: string, id: string | null | undefined): Promise<boolean> {
    if (!id) return false
    const alvo = await prisma.campoLivre.findFirst({ where: { id, empresaId, proprietario: 'PEDIDO' }, select: { id: true } })
    return !alvo
  }

  app.post('/campos-livres', async (request, reply) => {
    const user = request.user as UserToken
    const p = campoLivreBase.safeParse(request.body)
    if (!p.success) return bad(reply, p.error)
    const { opcoes, ...dados } = p.data

    const erroPadrao = validarUmPadrao(opcoes)
    if (erroPadrao) return reply.status(400).send({ message: erroPadrao })
    if (opcoes?.length && (dados.tipo ?? 'TEXTO') !== 'LISTA') {
      return reply.status(400).send({ message: 'Opções só são permitidas em campos do tipo LISTA' })
    }
    if (dados.codigoOrigem != null) {
      const dup = await prisma.campoLivre.findFirst({
        where: { empresaId: user.empresaId, codigoOrigem: dados.codigoOrigem },
        select: { id: true },
      })
      if (dup) return reply.status(409).send({ message: `Já existe um campo livre com o código de origem ${dados.codigoOrigem}` })
    }
    if (await copiaPedidoInvalida(user.empresaId, dados.copiaParaPedidoCampoId)) {
      return reply.status(422).send({ message: 'Campo de pedido para cópia não encontrado nesta empresa' })
    }

    try {
      const criado = await prisma.campoLivre.create({
        data: {
          ...limpar(dados),
          empresaId: user.empresaId,
          ...(opcoes?.length
            ? {
                opcoes: {
                  create: opcoes.map((o, i) => ({
                    empresaId: user.empresaId,
                    valor: o.valor,
                    padrao: o.padrao ?? false,
                    ordem: o.ordem ?? i,
                  })),
                },
              }
            : {}),
        },
        include: { opcoes: { orderBy: [{ ordem: 'asc' }] } },
      })
      return reply.status(201).send(criado)
    } catch (e) {
      if (ehViolacaoUnica(e)) return reply.status(409).send({ message: 'Já existe um campo livre com este código de origem' })
      throw e
    }
  })

  app.patch('/campos-livres/:id', async (request, reply) => {
    const user = request.user as UserToken
    const pp = idParams.safeParse(request.params)
    if (!pp.success) return bad(reply, pp.error)
    const p = campoLivreAtualizar.safeParse(request.body)
    if (!p.success) return bad(reply, p.error)
    const { opcoes, ...dados } = p.data

    const atual = await prisma.campoLivre.findFirst({ where: { id: pp.data.id, empresaId: user.empresaId } })
    if (!atual) return reply.status(404).send({ message: 'Campo livre não encontrado' })

    const erroPadrao = validarUmPadrao(opcoes)
    if (erroPadrao) return reply.status(400).send({ message: erroPadrao })
    const tipoFinal = dados.tipo ?? atual.tipo
    if (opcoes?.length && tipoFinal !== 'LISTA') {
      return reply.status(400).send({ message: 'Opções só são permitidas em campos do tipo LISTA' })
    }
    if (dados.codigoOrigem != null && dados.codigoOrigem !== atual.codigoOrigem) {
      const dup = await prisma.campoLivre.findFirst({
        where: { empresaId: user.empresaId, codigoOrigem: dados.codigoOrigem, NOT: { id: atual.id } },
        select: { id: true },
      })
      if (dup) return reply.status(409).send({ message: `Já existe um campo livre com o código de origem ${dados.codigoOrigem}` })
    }
    if (dados.copiaParaPedidoCampoId && (await copiaPedidoInvalida(user.empresaId, dados.copiaParaPedidoCampoId))) {
      return reply.status(422).send({ message: 'Campo de pedido para cópia não encontrado nesta empresa' })
    }

    const atualizado = await prisma.$transaction(async (tx) => {
      await tx.campoLivre.update({ where: { id: atual.id }, data: limpar(dados) })
      // Quando enviadas, as opções substituem o conjunto (transação).
      if (opcoes) {
        await tx.campoLivreOpcao.deleteMany({ where: { campoLivreId: atual.id, empresaId: user.empresaId } })
        if (opcoes.length) {
          await tx.campoLivreOpcao.createMany({
            data: opcoes.map((o, i) => ({
              empresaId: user.empresaId,
              campoLivreId: atual.id,
              valor: o.valor,
              padrao: o.padrao ?? false,
              ordem: o.ordem ?? i,
            })),
          })
        }
      }
      return tx.campoLivre.findFirst({
        where: { id: atual.id, empresaId: user.empresaId },
        include: { opcoes: { orderBy: [{ ordem: 'asc' }] } },
      })
    })
    return atualizado
  })

  app.delete('/campos-livres/:id', async (request, reply) => {
    const user = request.user as UserToken
    const p = idParams.safeParse(request.params)
    if (!p.success) return bad(reply, p.error)
    const r = await prisma.campoLivre.updateMany({
      where: { id: p.data.id, empresaId: user.empresaId },
      data: { status: false },
    })
    if (r.count === 0) return reply.status(404).send({ message: 'Campo livre não encontrado' })
    return reply.status(204).send()
  })

  // ========================= AJUSTES DE PRODUTIVIDADE =======================
  const listaAjustes = z.object({
    acabamentoId: ID.optional(),
    centroProducaoId: ID.optional(),
    dadoAjustar: z.enum(['ACERTO', 'PRODUCAO_HORA', 'CONSUMO_MATERIAL', 'INCONDICIONAL']).optional(),
    funcao: z.enum(['RESTRICAO_MANUAL', 'ATIVIDADE', 'FORMATO_PROCESSO']).optional(),
    ...paginaSchema,
  })

  async function validarRefsAjuste(
    empresaId: string,
    d: { acabamentoId?: string; centroProducaoId?: string | null; restricaoId?: string | null },
  ): Promise<string | null> {
    if (d.acabamentoId) {
      const a = await prisma.acabamentoGrafico.findFirst({ where: { id: d.acabamentoId, empresaId }, select: { id: true } })
      if (!a) return 'Atividade não encontrada nesta empresa'
    }
    if (d.centroProducaoId) {
      const c = await prisma.centroProducao.findFirst({ where: { id: d.centroProducaoId, empresaId }, select: { id: true } })
      if (!c) return 'Centro de produção não encontrado nesta empresa'
    }
    if (d.restricaoId) {
      const r = await prisma.restricaoAcabamento.findFirst({ where: { id: d.restricaoId, empresaId }, select: { id: true } })
      if (!r) return 'Restrição não encontrada nesta empresa'
    }
    return null
  }

  app.get('/ajustes-produtividade', async (request, reply) => {
    const user = request.user as UserToken
    const q = listaAjustes.safeParse(request.query)
    if (!q.success) return bad(reply, q.error)
    const { acabamentoId, centroProducaoId, dadoAjustar, funcao } = q.data
    const where: Prisma.AjusteProdutividadeWhereInput = {
      empresaId: user.empresaId,
      ...(acabamentoId ? { acabamentoId } : {}),
      ...(centroProducaoId ? { centroProducaoId } : {}),
      ...(dadoAjustar ? { dadoAjustar } : {}),
      ...(funcao ? { funcao } : {}),
    }
    const { take, skip, pagina, limite } = paginacao(q.data)
    const [total, itens] = await Promise.all([
      prisma.ajusteProdutividade.count({ where }),
      prisma.ajusteProdutividade.findMany({ where, orderBy: [{ acabamentoId: 'asc' }, { criadoEm: 'asc' }], take, skip }),
    ])
    return { total, pagina, limite, itens }
  })

  /** Visão "Restrições Automáticas": ajustes INCONDICIONAIS (tipo Incompatível). */
  app.get('/ajustes-produtividade/restricoes-automaticas', async (request) => {
    const user = request.user as UserToken
    const itens = await prisma.ajusteProdutividade.findMany({
      where: { empresaId: user.empresaId, dadoAjustar: 'INCONDICIONAL' },
      orderBy: { criadoEm: 'asc' },
    })
    return { total: itens.length, itens: itens.map((i) => ({ ...i, tipoRestricao: 'INCOMPATIVEL' })) }
  })

  app.get('/ajustes-produtividade/:id', async (request, reply) => {
    const user = request.user as UserToken
    const p = idParams.safeParse(request.params)
    if (!p.success) return bad(reply, p.error)
    const a = await prisma.ajusteProdutividade.findFirst({ where: { id: p.data.id, empresaId: user.empresaId } })
    if (!a) return reply.status(404).send({ message: 'Ajuste não encontrado' })
    return a
  })

  app.post('/ajustes-produtividade', async (request, reply) => {
    const user = request.user as UserToken
    const p = ajusteBase.safeParse(request.body)
    if (!p.success) return bad(reply, p.error)
    const erro = await validarRefsAjuste(user.empresaId, p.data)
    if (erro) return reply.status(422).send({ message: erro })
    const criado = await prisma.ajusteProdutividade.create({ data: { ...limpar(p.data), empresaId: user.empresaId } })
    return reply.status(201).send(criado)
  })

  app.patch('/ajustes-produtividade/:id', async (request, reply) => {
    const user = request.user as UserToken
    const pp = idParams.safeParse(request.params)
    if (!pp.success) return bad(reply, pp.error)
    const p = ajusteAtualizar.safeParse(request.body)
    if (!p.success) return bad(reply, p.error)
    const atual = await prisma.ajusteProdutividade.findFirst({ where: { id: pp.data.id, empresaId: user.empresaId }, select: { id: true } })
    if (!atual) return reply.status(404).send({ message: 'Ajuste não encontrado' })
    const erro = await validarRefsAjuste(user.empresaId, p.data)
    if (erro) return reply.status(422).send({ message: erro })
    return prisma.ajusteProdutividade.update({ where: { id: atual.id }, data: limpar(p.data) })
  })

  app.delete('/ajustes-produtividade/:id', async (request, reply) => {
    const user = request.user as UserToken
    const p = idParams.safeParse(request.params)
    if (!p.success) return bad(reply, p.error)
    const r = await prisma.ajusteProdutividade.deleteMany({ where: { id: p.data.id, empresaId: user.empresaId } })
    if (r.count === 0) return reply.status(404).send({ message: 'Ajuste não encontrado' })
    return reply.status(204).send()
  })

  // ========================= QUEBRAS ========================================
  const listaQuebras = z.object({
    tipoAtividade: z.enum(['IMPRESSAO', 'ACABAMENTO']).optional(),
    busca: z.string().trim().optional(),
    status: statusFiltro,
  })

  app.get('/quebras', async (request, reply) => {
    const user = request.user as UserToken
    const q = listaQuebras.safeParse(request.query)
    if (!q.success) return bad(reply, q.error)
    return prisma.quebraGrafica.findMany({
      where: {
        empresaId: user.empresaId,
        ...filtroStatus(q.data.status),
        ...(q.data.tipoAtividade ? { tipoAtividade: q.data.tipoAtividade } : {}),
        ...(q.data.busca ? { nome: { contains: q.data.busca, mode: 'insensitive' } } : {}),
      },
      orderBy: { nome: 'asc' },
      include: { limites: { where: { empresaId: user.empresaId }, orderBy: { tiragemAte: 'asc' } } },
    })
  })

  app.get('/quebras/:id', async (request, reply) => {
    const user = request.user as UserToken
    const p = idParams.safeParse(request.params)
    if (!p.success) return bad(reply, p.error)
    const q = await prisma.quebraGrafica.findFirst({
      where: { id: p.data.id, empresaId: user.empresaId },
      include: { limites: { where: { empresaId: user.empresaId }, orderBy: { tiragemAte: 'asc' } } },
    })
    if (!q) return reply.status(404).send({ message: 'Quebra não encontrada' })
    return q
  })

  function limitesDuplicados(limites: { tiragemAte: number }[] | undefined): boolean {
    if (!limites) return false
    return new Set(limites.map((l) => l.tiragemAte)).size !== limites.length
  }

  app.post('/quebras', async (request, reply) => {
    const user = request.user as UserToken
    const p = quebraBase.safeParse(request.body)
    if (!p.success) return bad(reply, p.error)
    const { limites, ...dados } = p.data
    if (limitesDuplicados(limites)) return reply.status(400).send({ message: 'Há limites com a mesma tiragem' })

    if (dados.codigoOrigem != null) {
      const dup = await prisma.quebraGrafica.findFirst({
        where: { empresaId: user.empresaId, codigoOrigem: dados.codigoOrigem },
        select: { id: true },
      })
      if (dup) return reply.status(409).send({ message: `Já existe uma quebra com o código de origem ${dados.codigoOrigem}` })
    }

    try {
      const criada = await prisma.$transaction(async (tx) => {
        const quebra = await tx.quebraGrafica.create({ data: { ...limpar(dados), empresaId: user.empresaId } })
        if (limites?.length) {
          await tx.quebraGraficaLimite.createMany({
            data: limites.map((l) => ({ empresaId: user.empresaId, quebraId: quebra.id, tiragemAte: l.tiragemAte, quebraPerc: l.quebraPerc })),
          })
        }
        return tx.quebraGrafica.findFirst({
          where: { id: quebra.id, empresaId: user.empresaId },
          include: { limites: { orderBy: { tiragemAte: 'asc' } } },
        })
      })
      return reply.status(201).send(criada)
    } catch (e) {
      if (ehViolacaoUnica(e)) return reply.status(409).send({ message: 'Já existe uma quebra com este código de origem' })
      throw e
    }
  })

  app.patch('/quebras/:id', async (request, reply) => {
    const user = request.user as UserToken
    const pp = idParams.safeParse(request.params)
    if (!pp.success) return bad(reply, pp.error)
    const p = quebraAtualizar.safeParse(request.body)
    if (!p.success) return bad(reply, p.error)
    const { limites, ...dados } = p.data
    if (limitesDuplicados(limites)) return reply.status(400).send({ message: 'Há limites com a mesma tiragem' })

    const atual = await prisma.quebraGrafica.findFirst({ where: { id: pp.data.id, empresaId: user.empresaId } })
    if (!atual) return reply.status(404).send({ message: 'Quebra não encontrada' })

    if (dados.codigoOrigem != null && dados.codigoOrigem !== atual.codigoOrigem) {
      const dup = await prisma.quebraGrafica.findFirst({
        where: { empresaId: user.empresaId, codigoOrigem: dados.codigoOrigem, NOT: { id: atual.id } },
        select: { id: true },
      })
      if (dup) return reply.status(409).send({ message: `Já existe uma quebra com o código de origem ${dados.codigoOrigem}` })
    }

    // Quando enviados, os limites substituem o conjunto, tudo na mesma transação.
    return prisma.$transaction(async (tx) => {
      await tx.quebraGrafica.update({ where: { id: atual.id }, data: limpar(dados) })
      if (limites) {
        await tx.quebraGraficaLimite.deleteMany({ where: { quebraId: atual.id, empresaId: user.empresaId } })
        if (limites.length) {
          await tx.quebraGraficaLimite.createMany({
            data: limites.map((l) => ({ empresaId: user.empresaId, quebraId: atual.id, tiragemAte: l.tiragemAte, quebraPerc: l.quebraPerc })),
          })
        }
      }
      return tx.quebraGrafica.findFirst({
        where: { id: atual.id, empresaId: user.empresaId },
        include: { limites: { orderBy: { tiragemAte: 'asc' } } },
      })
    })
  })

  app.delete('/quebras/:id', async (request, reply) => {
    const user = request.user as UserToken
    const p = idParams.safeParse(request.params)
    if (!p.success) return bad(reply, p.error)
    const r = await prisma.quebraGrafica.updateMany({
      where: { id: p.data.id, empresaId: user.empresaId },
      data: { status: false },
    })
    if (r.count === 0) return reply.status(404).send({ message: 'Quebra não encontrada' })
    return reply.status(204).send()
  })

  // ========================= LIMITES DE MONTAGEM ============================
  app.get('/limites-montagem', async (request, reply) => {
    const user = request.user as UserToken
    const q = z.object({ ...paginaSchema }).safeParse(request.query)
    if (!q.success) return bad(reply, q.error)
    const where = { empresaId: user.empresaId }
    const { take, skip, pagina, limite } = paginacao(q.data)
    const [total, itens] = await Promise.all([
      prisma.limiteMontagem.count({ where }),
      prisma.limiteMontagem.findMany({
        where,
        orderBy: [{ formatoFinalLargura: 'asc' }, { formatoFinalAltura: 'asc' }],
        take,
        skip,
      }),
    ])
    return { total, pagina, limite, itens }
  })

  app.get('/limites-montagem/:id', async (request, reply) => {
    const user = request.user as UserToken
    const p = idParams.safeParse(request.params)
    if (!p.success) return bad(reply, p.error)
    const l = await prisma.limiteMontagem.findFirst({ where: { id: p.data.id, empresaId: user.empresaId } })
    if (!l) return reply.status(404).send({ message: 'Limite de montagem não encontrado' })
    return l
  })

  app.post('/limites-montagem', async (request, reply) => {
    const user = request.user as UserToken
    const p = limiteMontagemBase.safeParse(request.body)
    if (!p.success) return bad(reply, p.error)
    const dup = await prisma.limiteMontagem.findFirst({
      where: { empresaId: user.empresaId, formatoFinalLargura: p.data.formatoFinalLargura, formatoFinalAltura: p.data.formatoFinalAltura },
      select: { id: true },
    })
    if (dup) return reply.status(409).send({ message: 'Já existe um limite de montagem para este formato final' })
    const criado = await prisma.limiteMontagem.create({ data: { ...p.data, empresaId: user.empresaId } })
    return reply.status(201).send(criado)
  })

  app.patch('/limites-montagem/:id', async (request, reply) => {
    const user = request.user as UserToken
    const pp = idParams.safeParse(request.params)
    if (!pp.success) return bad(reply, pp.error)
    const p = limiteMontagemAtualizar.safeParse(request.body)
    if (!p.success) return bad(reply, p.error)
    const atual = await prisma.limiteMontagem.findFirst({ where: { id: pp.data.id, empresaId: user.empresaId } })
    if (!atual) return reply.status(404).send({ message: 'Limite de montagem não encontrado' })

    const largura = p.data.formatoFinalLargura ?? Number(atual.formatoFinalLargura)
    const altura = p.data.formatoFinalAltura ?? Number(atual.formatoFinalAltura)
    const minimo = p.data.minimo ?? atual.minimo
    const maximo = p.data.maximo ?? atual.maximo
    if (maximo < minimo) return reply.status(400).send({ message: 'maximo: Máximo deve ser maior ou igual ao mínimo' })

    const dup = await prisma.limiteMontagem.findFirst({
      where: { empresaId: user.empresaId, formatoFinalLargura: largura, formatoFinalAltura: altura, NOT: { id: atual.id } },
      select: { id: true },
    })
    if (dup) return reply.status(409).send({ message: 'Já existe um limite de montagem para este formato final' })
    return prisma.limiteMontagem.update({ where: { id: atual.id }, data: limpar(p.data) })
  })

  app.delete('/limites-montagem/:id', async (request, reply) => {
    const user = request.user as UserToken
    const p = idParams.safeParse(request.params)
    if (!p.success) return bad(reply, p.error)
    const r = await prisma.limiteMontagem.deleteMany({ where: { id: p.data.id, empresaId: user.empresaId } })
    if (r.count === 0) return reply.status(404).send({ message: 'Limite de montagem não encontrado' })
    return reply.status(204).send()
  })

  // ========================= PARÂMETROS (orc.*) =============================
  const respostaParametros = async (empresaId: string) => ({
    empresaId,
    parametros: await lerParametrosOrcamento(empresaId),
    definicoes: PARAMETROS_ORCAMENTO.map((d) => ({
      chave: d.chave.slice('orc.'.length),
      descricao: d.descricao,
      padrao: d.padrao,
      min: d.min,
      max: d.max,
      inteiro: d.inteiro ?? false,
    })),
  })

  app.get('/parametros', async (request) => {
    const user = request.user as UserToken
    return respostaParametros(user.empresaId)
  })

  app.put('/parametros', async (request, reply) => {
    const user = request.user as UserToken
    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
      return reply.status(400).send({ message: 'Informe os parâmetros como objeto' })
    }
    // Só administradores alteram (mesmo critério de configuracao-pcp).
    const usuario = await prisma.usuario.findUnique({ where: { id: user.id }, select: { perfil: true } })
    if (!usuario || !['SUPER_ADMIN', 'ADMIN'].includes(usuario.perfil)) {
      return reply.status(403).send({ message: 'Apenas administradores podem alterar os parâmetros do orçamento' })
    }
    const v = validarParametros(request.body as Record<string, unknown>)
    if (!v.ok) return reply.status(400).send({ message: v.message })

    await prisma.$transaction(
      v.itens.map((i) =>
        prisma.parametro.upsert({
          where: { empresaId_chave: { empresaId: user.empresaId, chave: i.chave } },
          create: { empresaId: user.empresaId, chave: i.chave, valor: String(i.valor) },
          update: { valor: String(i.valor) },
        }),
      ),
    )
    return respostaParametros(user.empresaId)
  })
}
