/**
 * Helpers do teste de integração do FLUXO EXISTENTE do Orçamento Gráfico
 * (spec orcamento-grafico-hierarquia-item-plano, tarefa 1.10 — Req 19.6 / 19.10).
 *
 * Fluxo coberto (precisa continuar funcionando em TODAS as fases):
 *   criar orçamento → puxar cálculo → editar item → calcular → salvar item
 *   → enviar proposta → aprovar → Pedido de Venda.
 *
 * Os checkpoints das fases importam daqui (`criarOrcamento`, `puxarCalculo`,
 * `editarItem`, `calcular`, `salvarItem`, `enviar`, `aprovar`, `gerarPedidoVenda`).
 * Este arquivo NÃO importa Prisma/rotas de forma estática: importar o módulo é
 * seguro mesmo sem banco (a coleta do vitest nunca toca em banco).
 *
 * SEGURANÇA — o teste só roda com banco LOCAL/descartável:
 *   - exige `FLUXO_TEST_DATABASE_URL` (nunca lê `DATABASE_URL`);
 *   - recusa qualquer host que não seja localhost / 127.0.0.1 / ::1;
 *   - cria a própria empresa `QA-FLUXO-*` e remove tudo ao final;
 *   - toda chamada leva `empresaId` EXPLÍCITO (token assinado com ele).
 */
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'

export const PREFIXO_QA = 'QA-FLUXO'
export const PREFIXO_ROTA = '/api/orcamento-grafico'
const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const SEGREDO_JWT_TESTE = 'qa-fluxo-segredo-somente-teste'

// ── Configuração / guarda de segurança ──────────────────────────────────────

export type ConfigBancoTeste =
  | { habilitado: true; url: string }
  | { habilitado: false; motivo: string }

export function lerConfigBancoTeste(env: NodeJS.ProcessEnv = process.env): ConfigBancoTeste {
  const url = env.FLUXO_TEST_DATABASE_URL?.trim()
  if (!url) {
    return { habilitado: false, motivo: 'sem banco local de teste (defina FLUXO_TEST_DATABASE_URL apontando para um Postgres local/descartável)' }
  }
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return { habilitado: false, motivo: 'FLUXO_TEST_DATABASE_URL inválida (não é uma URL de conexão)' }
  }
  if (!HOSTS_LOCAIS.has(host)) {
    return {
      habilitado: false,
      motivo: `FLUXO_TEST_DATABASE_URL recusada: host "${host}" não é local (só localhost/127.0.0.1/::1)`,
    }
  }
  return { habilitado: true, url }
}

/** `empresaId` nunca pode ser implícito/vazio nos helpers. */
export function exigirEmpresaId(empresaId: string | null | undefined): string {
  if (!empresaId || typeof empresaId !== 'string') {
    throw new Error('empresaId explícito é obrigatório nos helpers do fluxo existente')
  }
  return empresaId
}

// ── Montagem do app em memória ──────────────────────────────────────────────

export interface AmbienteFluxo {
  app: FastifyInstance
  prisma: any
  /** Token JWT real (@fastify/jwt) com `empresaId` explícito. */
  tokenPara: (empresaId: string) => string
  encerrar: () => Promise<void>
}

/**
 * Monta o app Fastify em memória com as rotas reais do orçamento gráfico, a
 * autenticação REAL (hook `authenticate` + @fastify/jwt com segredo de teste) e o
 * Prisma apontando SÓ para o banco de teste informado.
 */
export async function montarAmbienteFluxo(urlBancoTeste: string): Promise<AmbienteFluxo> {
  const cfg = lerConfigBancoTeste({ FLUXO_TEST_DATABASE_URL: urlBancoTeste } as NodeJS.ProcessEnv)
  if (!cfg.habilitado) throw new Error(cfg.motivo)

  // Antes de qualquer import que instancie o PrismaClient.
  process.env.DATABASE_URL = cfg.url
  process.env.NODE_ENV = process.env.NODE_ENV ?? 'test'

  const { default: Fastify } = await import('fastify')
  const { default: jwt } = await import('@fastify/jwt')
  const { prisma } = await import('../../../lib/prisma')
  const { orcamentoGraficoRoutes } = await import('../orcamento-grafico.routes')

  const app = Fastify()
  // Espelha o handler global do server: ZodError → 400.
  app.setErrorHandler((err: any, _req, reply) => {
    reply.status(err?.name === 'ZodError' ? 400 : (err?.statusCode ?? 500)).send({ message: err?.message })
  })
  await app.register(jwt, { secret: SEGREDO_JWT_TESTE })
  await app.register(orcamentoGraficoRoutes, { prefix: PREFIXO_ROTA })
  await app.ready()

  return {
    app,
    prisma,
    tokenPara: (empresaId) =>
      app.jwt.sign({ id: randomUUID(), nome: `${PREFIXO_QA} usuario`, perfil: 'ADMIN', empresaId: exigirEmpresaId(empresaId) }),
    encerrar: async () => {
      await app.close()
      await prisma.$disconnect()
    },
  }
}

// ── Cenário (dados próprios do teste) ───────────────────────────────────────

export interface CenarioFluxo {
  empresaId: string
  clienteId: string
  clienteCnpj: string
  tipoEmbalagemId: string
  calculoId: string
  tabelaPrecoId: string
}

function digitos(n: number): string {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('')
}

/** Cria empresa `QA-FLUXO-*` e o mínimo de cadastros para o fluxo rodar. */
export async function semearCenario(prisma: any): Promise<CenarioFluxo> {
  const sufixo = Date.now().toString(36)
  const cnpjEmpresa = digitos(14)
  const clienteCnpj = digitos(14)

  const empresa = await prisma.empresa.create({
    data: { razaoSocial: `${PREFIXO_QA}-${sufixo}`, cnpj: cnpjEmpresa },
  })
  const empresaId: string = empresa.id

  const tipoProcesso = await prisma.tipoProcesso.create({
    data: { empresaId, codigo: 'IMPRESSAO', descricao: `${PREFIXO_QA} Impressão`, posicao: 1 },
  })
  await prisma.centroProducao.create({
    data: {
      empresaId,
      codigo: `${PREFIXO_QA}-IMP`,
      descricao: `${PREFIXO_QA} Impressora`,
      tipo: 'MAQUINA',
      tipoProcessoId: tipoProcesso.id,
      velocidade: 6000,
      unidadeVelocidade: 'FOLHAS_HORA',
      custoHora: 250,
      formatoFolhaLargura: 660,
      formatoFolhaAltura: 960,
      pincaMm: 10,
    },
  })
  await prisma.parametroPerda.create({
    data: { empresaId, perdaFixaFolhas: 50, perdaVariavel: 5 },
  })
  const tipoEmbalagem = await prisma.tipoEmbalagem.create({
    data: {
      empresaId,
      codigo: `${PREFIXO_QA}-EMB`,
      descricao: `${PREFIXO_QA} Rótulo`,
      formulaLargura: 'L',
      formulaAltura: 'A',
      parametros: [],
      processosObrigatorios: ['IMPRESSAO'],
    },
  })
  const cliente = await prisma.cliente.create({
    data: { empresaId, razaoSocial: `${PREFIXO_QA} Cliente ${sufixo}`, cpfCnpj: clienteCnpj },
  })
  const tabela = await prisma.tabelaPreco.create({
    data: { empresaId, nome: `${PREFIXO_QA} Tabela`, status: true },
  })
  // Cálculo da biblioteca (origem do "puxar cálculo"): foto com custo/valor reais.
  const calculo = await prisma.calculoGrafico.create({
    data: {
      empresaId,
      numero: 1,
      origem: 'VIZOR',
      status: 'ATIVO',
      clienteId: cliente.id,
      clienteNome: cliente.razaoSocial,
      clienteDoc: clienteCnpj,
      produto: `${PREFIXO_QA} produto`,
      descricao: `${PREFIXO_QA} cálculo`,
      tipoEmbalagemId: tipoEmbalagem.id,
      medidas: { L: 100, A: 200, largura: 100, altura: 200 },
      gramatura: 250,
      numCores: 0,
      quantidade: 1000,
      resultadoCalculo: { custos: { custoProducao: 1000 }, custoProducao: 1000, precoVenda: 1500 },
      custoProducao: 1000,
      valorTotal: 1500,
      margemSelecionada: 30,
    },
  })

  return {
    empresaId,
    clienteId: cliente.id,
    clienteCnpj,
    tipoEmbalagemId: tipoEmbalagem.id,
    calculoId: calculo.id,
    tabelaPrecoId: tabela.id,
  }
}

/**
 * Remove TUDO o que o cenário criou. Só age em empresa cuja razão social começa
 * com `QA-FLUXO` (trava contra apagar dado real por engano).
 */
export async function limparCenario(prisma: any, empresaId: string): Promise<void> {
  exigirEmpresaId(empresaId)
  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { razaoSocial: true } })
  if (!empresa) return
  if (!String(empresa.razaoSocial).startsWith(PREFIXO_QA)) {
    throw new Error(`limparCenario recusou: empresa ${empresaId} não é de QA (${PREFIXO_QA})`)
  }

  // Filhos sem empresa_id próprio (ex.: item_pedido_venda) caem em cascata.
  // Todas as tabelas com empresa_id, em passes (resolve a ordem das FKs).
  const tabelas: Array<{ table_name: string }> = await prisma.$queryRawUnsafe(
    `SELECT DISTINCT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'empresa_id'
        AND table_name NOT IN ('empresa')`,
  )
  let pendentes = tabelas.map((t) => t.table_name)
  for (let passe = 0; passe < 8 && pendentes.length > 0; passe++) {
    const falharam: string[] = []
    for (const t of pendentes) {
      try {
        await prisma.$executeRawUnsafe(`DELETE FROM "${t}" WHERE empresa_id = $1`, empresaId)
      } catch {
        falharam.push(t)
      }
    }
    if (falharam.length === pendentes.length) break
    pendentes = falharam
  }
  await prisma.empresa.delete({ where: { id: empresaId } })
}

// ── Passos do fluxo (reutilizáveis pelos checkpoints) ───────────────────────

export interface Ctx {
  app: FastifyInstance
  /** Token com o empresaId explícito (ver `AmbienteFluxo.tokenPara`). */
  token: string
  empresaId: string
}

export interface Resposta<T = any> {
  status: number
  corpo: T
}

async function chamar<T = any>(
  ctx: Ctx,
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  payload?: unknown,
): Promise<Resposta<T>> {
  exigirEmpresaId(ctx.empresaId)
  const res = await ctx.app.inject({
    method,
    url: `${PREFIXO_ROTA}${url}`,
    headers: { authorization: `Bearer ${ctx.token}` },
    ...(payload !== undefined ? { payload: payload as any } : {}),
  })
  let corpo: any
  try {
    corpo = res.json()
  } catch {
    corpo = res.body
  }
  return { status: res.statusCode, corpo }
}

/** Corpo mínimo e válido de um item (usado em editar/calcular/salvar). */
export function corpoItemBase(cenario: Pick<CenarioFluxo, 'tipoEmbalagemId'>, extra: Record<string, unknown> = {}) {
  return {
    tipoEmbalagemId: cenario.tipoEmbalagemId,
    medidas: { L: 100, A: 200 },
    gramatura: 250,
    precoKgPapel: 8,
    numCores: 0,
    quantidade: 1000,
    ...extra,
  }
}

/** 1) Criar orçamento (POST /). Em branco, RASCUNHO, `empresaId` do token. */
export function criarOrcamento(ctx: Ctx, cenario: CenarioFluxo, extra: Record<string, unknown> = {}) {
  return chamar(ctx, 'POST', '/', {
    clienteId: cenario.clienteId,
    clienteNome: `${PREFIXO_QA} Cliente`,
    tipoEmbalagemId: cenario.tipoEmbalagemId,
    medidas: { L: 100, A: 200 },
    numCores: 0,
    quantidade: 1000,
    observacoes: `${PREFIXO_QA} orçamento em branco`,
    ...extra,
  })
}

/** 2) Puxar cálculo da biblioteca (POST /de-calculo) → orçamento de repetição. */
export function puxarCalculo(ctx: Ctx, calculoId: string, novaQuantidade?: number) {
  return chamar(ctx, 'POST', '/de-calculo', { calculoId, ...(novaQuantidade ? { novaQuantidade } : {}) })
}

/** Lê o orçamento (GET /:id) com itens. */
export function obterOrcamento(ctx: Ctx, orcamentoId: string) {
  return chamar(ctx, 'GET', `/${orcamentoId}`)
}

/**
 * 3) Editar item: devolve o corpo do item com as alterações aplicadas (a edição em
 * si é só montar o payload; a persistência é `salvarItem`, o recálculo é `calcular`).
 */
export function editarItem(
  cenario: Pick<CenarioFluxo, 'tipoEmbalagemId'>,
  alteracoes: Record<string, unknown> = { quantidade: 1200 },
) {
  return corpoItemBase(cenario, alteracoes)
}

/** 4) Calcular o item (POST /:id/itens/:itemId/calcular) — prévia + grava resultado. */
export function calcular(ctx: Ctx, orcamentoId: string, itemId: string, corpo: Record<string, unknown>) {
  return chamar(ctx, 'POST', `/${orcamentoId}/itens/${itemId}/calcular`, corpo)
}

/** 5) Salvar item (PUT /:id/itens/:itemId) — recalcula, ancora e reconsolida. */
export function salvarItem(ctx: Ctx, orcamentoId: string, itemId: string, corpo: Record<string, unknown>) {
  return chamar(ctx, 'PUT', `/${orcamentoId}/itens/${itemId}`, corpo)
}

/** 6) Enviar proposta (POST /:id/enviar): RASCUNHO → ENVIADO. */
export function enviar(ctx: Ctx, orcamentoId: string) {
  return chamar(ctx, 'POST', `/${orcamentoId}/enviar`)
}

/** 7) Aprovar (POST /:id/aprovar): ENVIADO → APROVADO (+ Pedido de Venda). */
export function aprovar(ctx: Ctx, orcamentoId: string) {
  return chamar(ctx, 'POST', `/${orcamentoId}/aprovar`)
}

/**
 * 8) Pedido de Venda gerado pela aprovação. Lê direto do banco, filtrando por
 * `empresaId` explícito, e devolve `null` se não foi gerado.
 */
export async function gerarPedidoVenda(prisma: any, empresaId: string, orcamentoId: string) {
  exigirEmpresaId(empresaId)
  return prisma.pedidoVenda.findFirst({
    where: { empresaId, orcamentoOrigemId: orcamentoId },
    select: { id: true, numero: true, status: true, origemPedido: true, valorTotal: true, clienteId: true, empresaId: true },
  })
}

/** Primeiro item do orçamento (leitura no banco, `empresaId` explícito). */
export async function primeiroItemId(prisma: any, empresaId: string, orcamentoId: string): Promise<string | null> {
  exigirEmpresaId(empresaId)
  const item = await prisma.itemOrcamentoGrafico.findFirst({
    where: { empresaId, orcamentoId },
    orderBy: { sequencia: 'asc' },
    select: { id: true },
  })
  return item?.id ?? null
}
