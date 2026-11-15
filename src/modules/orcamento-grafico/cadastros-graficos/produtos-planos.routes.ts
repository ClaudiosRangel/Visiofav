import { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { authenticate } from '../../../middleware/authenticate'
import { validarPar, ehTipoRelacao, type TipoRelacao } from './relacoes-permitidas'

/**
 * Produto Gráfico, Tipo de Plano, Defaults do produto por plano e Relações
 * (spec orcamento-grafico-cadastros-relacoes, tarefas 3.1 a 3.3).
 * empresaId EXPLÍCITO em TODA query e create (não confiar só no prismaScoped).
 */

type UserToken = { id: string; empresaId: string }

function erroZod(reply: FastifyReply, error: z.ZodError) {
  const msg = error.errors
    .map((e) => (e.path.length ? `${e.path.join('.')}: ${e.message}` : e.message))
    .join('; ')
  return reply.status(400).send({ message: `Dados inválidos — ${msg}` })
}

const situacaoSchema = z.enum(['ativo', 'inativo', 'todos']).optional()

const decimalOpc = z.number().nullable().optional()
const textoOpc = (max: number) => z.string().trim().max(max).nullable().optional()

// ─────────────────────────────── Produto ───────────────────────────────

const produtoBase = z.object({
  codigo: z.string().trim().min(1, 'Código é obrigatório').max(60),
  nome: z.string().trim().min(1, 'Nome é obrigatório').max(200),
  linhaProdutoId: z.string().nullable().optional(),
  codigoOrigem: z.number().int().nullable().optional(),
  status: z.boolean().optional(),
  tributacao2026: textoOpc(60),
  tributacao2027: textoOpc(60),
  classificacaoFiscal: textoOpc(60),
  fechamentoId: z.string().nullable().optional(),
  baseUnidadePreco: z.string().trim().min(1).max(20).optional(),
  unidadeId: z.string().nullable().optional(),
  prazoProducaoDias: z.number().int().min(0).optional(),
  faturamentoMinimo: z.boolean().optional(),
  valorFaturamentoMinimo: decimalOpc,
  tipoCartucho: textoOpc(60),
  modoFormato: z
    .enum(['TRES_DIMENSOES', 'DUAS_DIMENSOES', 'ABERTO_FECHADO', 'SANFONA_ABAS', 'PAGINA'])
    .optional(),
  formatoPadraoLargura: decimalOpc,
  formatoPadraoAltura: decimalOpc,
  exibeRestricoes: z.boolean().optional(),
  exibeInformacoesComplementares: z.boolean().optional(),
  semImpressao: z.boolean().optional(),
})
const produtoCriarSchema = produtoBase
const produtoAtualizarSchema = produtoBase.partial()

// ──────────────────────────── Tipo de Plano ────────────────────────────

const planoBase = z.object({
  codigo: z.string().trim().min(1, 'Código é obrigatório').max(60),
  nome: z.string().trim().min(1, 'Nome é obrigatório').max(200),
  linhaProdutoId: z.string().nullable().optional(),
  codigoOrigem: z.number().int().nullable().optional(),
  fixo: z.boolean().optional(),
  status: z.boolean().optional(),
  miolo: z.boolean().optional(),
  calculoAutomaticoFormato: z.enum(['SIM', 'NAO', 'OPCIONAL']).optional(),
  primeiraMedida: z.enum(['LF', 'LFX2', 'LOMBADA']).optional(),
  somarOrelhas: z.boolean().optional(),
  somarLombada: z.boolean().optional(),
  ocorrencias: z.enum(['UMA', 'DUAS', 'LIVRE']).optional(),
  quebraPadrao: decimalOpc,
  corteDuploMin: decimalOpc,
  suportePadraoId: z.string().nullable().optional(),
  gramaturaPadrao: decimalOpc,
  montagemId: z.string().nullable().optional(),
  usarPinca: z.boolean().optional(),
  fibraDefault: textoOpc(20),
  frenteIgualVerso: z.boolean().optional(),
  caderno: z.boolean().optional(),
  margem1Mm: z.number().min(0).optional(),
  margem2Mm: z.number().min(0).optional(),
  formato: textoOpc(60),
})
const planoCriarSchema = planoBase
const planoAtualizarSchema = planoBase.partial()

const listaQuerySchema = z.object({
  situacao: situacaoSchema,
  busca: z.string().trim().optional(),
  linhaProdutoId: z.string().optional(),
})

function filtroStatus(situacao: 'ativo' | 'inativo' | 'todos' | undefined): Record<string, unknown> {
  if (situacao === 'todos') return {}
  if (situacao === 'inativo') return { status: false }
  return { status: true }
}

// ───────────────────────────── Defaults ────────────────────────────────

const defaultSchema = z.object({
  semImpressao: z.boolean().optional(),
  processoImpressaoId: z.string().nullable().optional(),
  coberturaTintaId: z.string().nullable().optional(),
  coresFrente: z.number().int().min(0).optional(),
  coresVerso: z.number().int().min(0).optional(),
  areaTintaPerc: z.number().min(0).max(100).optional(),
  fabricanteSuporte: textoOpc(120),
  atividadesPreMarcadas: z.array(z.string()).optional(),
})

// ───────────────────────────── Relações ────────────────────────────────

const relacaoPutSchema = z.object({
  tipoOrigem: z.string().trim().min(1),
  idOrigem: z.string().trim().min(1),
  tipoDestino: z.string().trim().min(1),
  ids: z.array(z.string().trim().min(1)),
  /** Subconjunto de `ids` marcado como padrão. Se omitido, preserva o valor atual. */
  padroes: z.array(z.string()).optional(),
})

const relacaoListaQuery = z.object({
  tipoOrigem: z.string().trim().optional(),
  idOrigem: z.string().trim().optional(),
  tipoDestino: z.string().trim().optional(),
})

/** Devolve o conjunto de ids que existem NA EMPRESA para o tipo de cadastro informado. */
async function idsExistentes(tipo: TipoRelacao, ids: string[], empresaId: string): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const where = { id: { in: ids }, empresaId }
  const select = { id: true } as const
  let rows: { id: string }[] = []
  switch (tipo) {
    case 'PRODUTO':
      rows = await prisma.produtoGrafico.findMany({ where, select })
      break
    case 'PLANO':
      rows = await prisma.tipoPlanoGrafico.findMany({ where, select })
      break
    case 'ATIVIDADE':
    case 'ACONDICIONAMENTO':
      rows = await prisma.acabamentoGrafico.findMany({ where, select })
      break
    case 'MATERIAL':
      rows = await prisma.materialAcabamento.findMany({ where, select })
      break
    case 'SUPORTE':
      rows = await prisma.suporteGrafico.findMany({ where, select })
      break
    case 'CENTRO':
      rows = await prisma.centroProducao.findMany({ where, select })
      break
    case 'LINHA':
      rows = await prisma.linhaProduto.findMany({ where, select })
      break
    case 'COBERTURA_TINTA':
      rows = await prisma.coberturaTinta.findMany({ where, select })
      break
    case 'ITEM_DIVERSO':
      rows = await prisma.itemDiversoGrafico.findMany({ where, select })
      break
    case 'TINTA':
    case 'MATRIZ':
      rows = await prisma.precoMateriaPrima.findMany({ where, select })
      break
  }
  return new Set(rows.map((r) => r.id))
}

export async function produtosPlanosRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // ═════════════════════════ PRODUTOS ═════════════════════════

  app.get('/produtos', async (request, reply) => {
    const user = request.user as UserToken
    const parsed = listaQuerySchema.safeParse(request.query)
    if (!parsed.success) return erroZod(reply, parsed.error)
    const { situacao, busca, linhaProdutoId } = parsed.data

    const where: Record<string, unknown> = { empresaId: user.empresaId, ...filtroStatus(situacao) }
    if (linhaProdutoId) where.linhaProdutoId = linhaProdutoId
    if (busca) {
      where.OR = [
        { codigo: { contains: busca, mode: 'insensitive' } },
        { nome: { contains: busca, mode: 'insensitive' } },
      ]
    }
    return prisma.produtoGrafico.findMany({ where, orderBy: { nome: 'asc' } })
  })

  app.get('/produtos/:id', async (request, reply) => {
    const user = request.user as UserToken
    const { id } = request.params as { id: string }
    const produto = await prisma.produtoGrafico.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!produto) return reply.status(404).send({ message: 'Produto não encontrado' })
    return produto
  })

  app.post('/produtos', async (request, reply) => {
    const user = request.user as UserToken
    const parsed = produtoCriarSchema.safeParse(request.body)
    if (!parsed.success) return erroZod(reply, parsed.error)
    const dados = parsed.data

    const existente = await prisma.produtoGrafico.findFirst({
      where: { empresaId: user.empresaId, codigo: dados.codigo },
      select: { id: true },
    })
    if (existente) return reply.status(409).send({ message: `Já existe um produto com o código "${dados.codigo}"` })

    const criado = await prisma.produtoGrafico.create({ data: { ...dados, empresaId: user.empresaId } })
    return reply.status(201).send(criado)
  })

  app.patch('/produtos/:id', async (request, reply) => {
    const user = request.user as UserToken
    const { id } = request.params as { id: string }
    const parsed = produtoAtualizarSchema.safeParse(request.body)
    if (!parsed.success) return erroZod(reply, parsed.error)
    const dados = parsed.data

    const registro = await prisma.produtoGrafico.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!registro) return reply.status(404).send({ message: 'Produto não encontrado' })

    if (dados.codigo && dados.codigo !== registro.codigo) {
      const conflito = await prisma.produtoGrafico.findFirst({
        where: { empresaId: user.empresaId, codigo: dados.codigo },
        select: { id: true },
      })
      if (conflito) return reply.status(409).send({ message: `Já existe um produto com o código "${dados.codigo}"` })
    }

    return prisma.produtoGrafico.update({ where: { id: registro.id }, data: dados })
  })

  // Exclusão lógica (inativa): mantém os itens já criados.
  app.delete('/produtos/:id', async (request, reply) => {
    const user = request.user as UserToken
    const { id } = request.params as { id: string }
    const registro = await prisma.produtoGrafico.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!registro) return reply.status(404).send({ message: 'Produto não encontrado' })
    await prisma.produtoGrafico.update({ where: { id: registro.id }, data: { status: false } })
    return reply.status(204).send()
  })

  // ═════════════════════ DEFAULTS DO PRODUTO POR PLANO ═════════════════════

  app.get('/produtos/:id/defaults', async (request, reply) => {
    const user = request.user as UserToken
    const { id } = request.params as { id: string }
    const produto = await prisma.produtoGrafico.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!produto) return reply.status(404).send({ message: 'Produto não encontrado' })

    return prisma.defaultProdutoPlano.findMany({
      where: { empresaId: user.empresaId, produtoId: id },
      include: { tipoPlano: { select: { id: true, codigo: true, nome: true, fixo: true } } },
      orderBy: { criadoEm: 'asc' },
    })
  })

  app.put('/produtos/:id/defaults/:tipoPlanoId', async (request, reply) => {
    const user = request.user as UserToken
    const { id, tipoPlanoId } = request.params as { id: string; tipoPlanoId: string }
    const parsed = defaultSchema.safeParse(request.body)
    if (!parsed.success) return erroZod(reply, parsed.error)
    const dados = parsed.data

    const produto = await prisma.produtoGrafico.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!produto) return reply.status(404).send({ message: 'Produto não encontrado' })

    const plano = await prisma.tipoPlanoGrafico.findFirst({
      where: { id: tipoPlanoId, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!plano) return reply.status(404).send({ message: 'Tipo de plano não encontrado' })

    const relacionado = await prisma.relacaoCadastroGrafico.findFirst({
      where: {
        empresaId: user.empresaId,
        tipoOrigem: 'PRODUTO',
        idOrigem: id,
        tipoDestino: 'PLANO',
        idDestino: tipoPlanoId,
      },
      select: { id: true },
    })
    if (!relacionado) {
      return reply
        .status(422)
        .send({ message: 'Este tipo de plano não está relacionado ao produto. Relacione o plano ao produto antes de definir os padrões.' })
    }

    if (dados.processoImpressaoId) {
      const ok = await prisma.processoImpressao.findFirst({
        where: { id: dados.processoImpressaoId, empresaId: user.empresaId },
        select: { id: true },
      })
      if (!ok) return reply.status(422).send({ message: 'Processo de impressão inexistente na empresa' })
    }
    if (dados.coberturaTintaId) {
      const ok = await prisma.coberturaTinta.findFirst({
        where: { id: dados.coberturaTintaId, empresaId: user.empresaId },
        select: { id: true },
      })
      if (!ok) return reply.status(422).send({ message: 'Cobertura de tinta inexistente na empresa' })
    }

    const data = {
      ...dados,
      atividadesPreMarcadas: dados.atividadesPreMarcadas ?? undefined,
    }
    const salvo = await prisma.defaultProdutoPlano.upsert({
      where: { produtoId_tipoPlanoId: { produtoId: id, tipoPlanoId } },
      create: { ...data, empresaId: user.empresaId, produtoId: id, tipoPlanoId },
      update: data,
    })
    return salvo
  })

  app.delete('/produtos/:id/defaults/:tipoPlanoId', async (request, reply) => {
    const user = request.user as UserToken
    const { id, tipoPlanoId } = request.params as { id: string; tipoPlanoId: string }
    const resultado = await prisma.defaultProdutoPlano.deleteMany({
      where: { empresaId: user.empresaId, produtoId: id, tipoPlanoId },
    })
    if (resultado.count === 0) return reply.status(404).send({ message: 'Padrão não encontrado' })
    return reply.status(204).send()
  })

  // ═════════════════════════ TIPOS DE PLANO ═════════════════════════

  app.get('/tipos-plano', async (request, reply) => {
    const user = request.user as UserToken
    const parsed = listaQuerySchema.safeParse(request.query)
    if (!parsed.success) return erroZod(reply, parsed.error)
    const { situacao, busca, linhaProdutoId } = parsed.data

    const where: Record<string, unknown> = { empresaId: user.empresaId, ...filtroStatus(situacao) }
    if (linhaProdutoId) where.linhaProdutoId = linhaProdutoId
    if (busca) {
      where.OR = [
        { codigo: { contains: busca, mode: 'insensitive' } },
        { nome: { contains: busca, mode: 'insensitive' } },
      ]
    }
    return prisma.tipoPlanoGrafico.findMany({ where, orderBy: { nome: 'asc' } })
  })

  app.get('/tipos-plano/:id', async (request, reply) => {
    const user = request.user as UserToken
    const { id } = request.params as { id: string }
    const plano = await prisma.tipoPlanoGrafico.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!plano) return reply.status(404).send({ message: 'Tipo de plano não encontrado' })
    return plano
  })

  app.post('/tipos-plano', async (request, reply) => {
    const user = request.user as UserToken
    const parsed = planoCriarSchema.safeParse(request.body)
    if (!parsed.success) return erroZod(reply, parsed.error)
    const dados = parsed.data

    const existente = await prisma.tipoPlanoGrafico.findFirst({
      where: { empresaId: user.empresaId, codigo: dados.codigo },
      select: { id: true },
    })
    if (existente) return reply.status(409).send({ message: `Já existe um tipo de plano com o código "${dados.codigo}"` })

    const criado = await prisma.tipoPlanoGrafico.create({ data: { ...dados, empresaId: user.empresaId } })
    return reply.status(201).send(criado)
  })

  app.patch('/tipos-plano/:id', async (request, reply) => {
    const user = request.user as UserToken
    const { id } = request.params as { id: string }
    const parsed = planoAtualizarSchema.safeParse(request.body)
    if (!parsed.success) return erroZod(reply, parsed.error)
    const dados = parsed.data

    const registro = await prisma.tipoPlanoGrafico.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!registro) return reply.status(404).send({ message: 'Tipo de plano não encontrado' })

    if (dados.codigo && dados.codigo !== registro.codigo) {
      const conflito = await prisma.tipoPlanoGrafico.findFirst({
        where: { empresaId: user.empresaId, codigo: dados.codigo },
        select: { id: true },
      })
      if (conflito) {
        return reply.status(409).send({ message: `Já existe um tipo de plano com o código "${dados.codigo}"` })
      }
    }

    return prisma.tipoPlanoGrafico.update({ where: { id: registro.id }, data: dados })
  })

  // Plano fixo não pode ser excluído; os demais são inativados (exclusão lógica).
  app.delete('/tipos-plano/:id', async (request, reply) => {
    const user = request.user as UserToken
    const { id } = request.params as { id: string }
    const registro = await prisma.tipoPlanoGrafico.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true, fixo: true },
    })
    if (!registro) return reply.status(404).send({ message: 'Tipo de plano não encontrado' })
    if (registro.fixo) {
      return reply.status(409).send({ message: 'Plano fixo não pode ser excluído' })
    }
    await prisma.tipoPlanoGrafico.update({ where: { id: registro.id }, data: { status: false } })
    return reply.status(204).send()
  })

  // ═════════════════════════ RELAÇÕES ═════════════════════════

  // Lista (filtros opcionais)
  app.get('/relacoes', async (request, reply) => {
    const user = request.user as UserToken
    const parsed = relacaoListaQuery.safeParse(request.query)
    if (!parsed.success) return erroZod(reply, parsed.error)
    const { tipoOrigem, idOrigem, tipoDestino } = parsed.data

    return prisma.relacaoCadastroGrafico.findMany({
      where: {
        empresaId: user.empresaId,
        ...(tipoOrigem ? { tipoOrigem } : {}),
        ...(idOrigem ? { idOrigem } : {}),
        ...(tipoDestino ? { tipoDestino } : {}),
      },
      orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }],
    })
  })

  // Verificação de relações órfãs (origem ou destino inexistente na empresa)
  app.get('/relacoes/verificar', async (request) => {
    const user = request.user as UserToken
    const todas = await prisma.relacaoCadastroGrafico.findMany({
      where: { empresaId: user.empresaId },
      select: { id: true, tipoOrigem: true, idOrigem: true, tipoDestino: true, idDestino: true },
    })

    const porTipo = new Map<TipoRelacao, Set<string>>()
    for (const r of todas) {
      for (const [tipo, id] of [
        [r.tipoOrigem, r.idOrigem],
        [r.tipoDestino, r.idDestino],
      ] as const) {
        if (!ehTipoRelacao(tipo)) continue
        if (!porTipo.has(tipo)) porTipo.set(tipo, new Set())
        porTipo.get(tipo)!.add(id)
      }
    }
    const existentes = new Map<TipoRelacao, Set<string>>()
    for (const [tipo, ids] of porTipo) {
      existentes.set(tipo, await idsExistentes(tipo, [...ids], user.empresaId))
    }

    const orfas = todas.filter((r) => {
      const origemOk = ehTipoRelacao(r.tipoOrigem) && existentes.get(r.tipoOrigem)?.has(r.idOrigem)
      const destinoOk = ehTipoRelacao(r.tipoDestino) && existentes.get(r.tipoDestino)?.has(r.idDestino)
      return !(origemOk && destinoOk)
    })
    return { total: todas.length, totalOrfas: orfas.length, orfas }
  })

  // Substitui o conjunto de destinos de uma origem + par (idempotente)
  app.put('/relacoes', async (request, reply) => {
    const user = request.user as UserToken
    const parsed = relacaoPutSchema.safeParse(request.body)
    if (!parsed.success) return erroZod(reply, parsed.error)
    const { tipoOrigem, idOrigem, tipoDestino, padroes } = parsed.data
    const ids = [...new Set(parsed.data.ids)]

    const par = validarPar(tipoOrigem, tipoDestino)
    if (!par.ok) return reply.status(400).send({ message: par.mensagem })

    const origemOk = await idsExistentes(tipoOrigem as TipoRelacao, [idOrigem], user.empresaId)
    if (!origemOk.has(idOrigem)) {
      return reply.status(422).send({ message: 'Item de origem inexistente na empresa', idsInvalidos: [idOrigem] })
    }
    const destinosOk = await idsExistentes(tipoDestino as TipoRelacao, ids, user.empresaId)
    const invalidos = ids.filter((i) => !destinosOk.has(i))
    if (invalidos.length > 0) {
      return reply
        .status(422)
        .send({ message: 'Alguns itens de destino não existem na empresa', idsInvalidos: invalidos })
    }

    const padraoSet = padroes ? new Set(padroes) : null

    await prisma.$transaction(async (tx) => {
      await tx.relacaoCadastroGrafico.deleteMany({
        where: {
          empresaId: user.empresaId,
          tipoOrigem,
          idOrigem,
          tipoDestino,
          ...(ids.length > 0 ? { idDestino: { notIn: ids } } : {}),
        },
      })
      for (const [indice, idDestino] of ids.entries()) {
        await tx.relacaoCadastroGrafico.upsert({
          where: {
            empresaId_tipoOrigem_idOrigem_tipoDestino_idDestino: {
              empresaId: user.empresaId,
              tipoOrigem,
              idOrigem,
              tipoDestino,
              idDestino,
            },
          },
          create: {
            empresaId: user.empresaId,
            tipoOrigem,
            idOrigem,
            tipoDestino,
            idDestino,
            ordem: indice,
            padrao: padraoSet ? padraoSet.has(idDestino) : false,
          },
          update: {
            ordem: indice,
            ...(padraoSet ? { padrao: padraoSet.has(idDestino) } : {}),
          },
        })
      }
    })

    return prisma.relacaoCadastroGrafico.findMany({
      where: { empresaId: user.empresaId, tipoOrigem, idOrigem, tipoDestino },
      orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }],
    })
  })
}
