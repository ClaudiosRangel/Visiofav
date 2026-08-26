/**
 * popular-demo-visiofab.ts
 *
 * Script de seed que popula dados de demonstração realistas de uma indústria
 * gráfica de embalagens de papelão na empresa VizioFab Demo
 * (59512845-a692-4429-ace4-627566065fd4).
 *
 * Consolida em um único ponto tudo que o antigo `teste-fluxo-representante-e2e.ts`
 * cobria (Portal Representante, Orçamento Gráfico, Pedidos de Venda, Ordens de
 * Produção) e adiciona os demais módulos-chave (Clientes, Vendedores, Produtos,
 * Cadastros Base do PCP).
 *
 * Princípios: seguro por construção (só a empresa demo, dupla guarda
 * anti-Carton Wega), idempotente (localizar-ou-criar por chave @@unique),
 * determinístico (CNPJ/preços derivados por hash) e transparente (feedback no
 * console + resumo por módulo).
 *
 * ⚠️  Idempotente: verifica existência antes de criar, re-execuções são seguras.
 * ⚠️  Nunca roda na Carton Wega (guarda de segurança aborta a execução).
 *
 * Uso: $env:DATABASE_URL="<connection_string>"; npx tsx scripts/popular-demo-visiofab.ts
 */

import { prisma } from '../src/lib/prisma'
import bcrypt from 'bcryptjs'

// ─── Constantes de configuração ─────────────────────────────────────────────────

/** ID da empresa VizioFab Demo — único alvo permitido para este script. */
const EMPRESA_ID = '59512845-a692-4429-ace4-627566065fd4'

/** UUID placeholder para campos `*PorId`/`usuarioId` obrigatórios sem usuário real (seed). */
const USUARIO_SEED_ID = '00000000-0000-0000-0000-000000000001'

// ─── Tipos ───────────────────────────────────────────────────────────────────────

/** Contador de registros processados por um módulo. */
interface ContadorModulo {
  criados: number
  pulados: number
}

/**
 * Resumo acumulado da execução — contagem de criados/pulados por módulo.
 * Preenchido pelas funções de módulo e impresso no resumo final.
 */
interface Resumo {
  clientesCriados: number
  clientesPulados: number
  vendedoresCriados: number
  vendedoresPulados: number
  representantesCriados: number
  representantesPulados: number
  produtosCriados: number
  produtosPulados: number
  tiposEmbalagemCriados: number
  tiposEmbalagemPulados: number
  orcamentosCriados: number
  orcamentosPulados: number
  pedidosCriados: number
  pedidosPulados: number
  opsCriadas: number
  opsPuladas: number
  etapasCriadas: number
  itensOpCriados: number
  apontamentosCriados: number
  logsCriados: number
  solicitacoesCriados: number
  solicitacoesPulados: number
  cadastrosBaseCriados: number
  cadastrosBasePulados: number
  materiaPrimaCriados: number
  materiaPrimaPulados: number
  enderecosCriados: number
  enderecosPulados: number
  saldosCriados: number
  saldosPulados: number
  bomsCriadas: number
  bomsPuladas: number
  roteirosCriados: number
  roteirosPulados: number
}

/**
 * Contexto acumulado ao longo do pipeline. Cada módulo lê as dependências já
 * resolvidas (FKs) e grava os identificadores que produziu para os módulos
 * seguintes consumirem.
 */
interface Contexto {
  empresaId: string
  vendedores: { id: string; nome: string }[]
  representantes: { id: string; email: string; senha: string; vendedorId: string }[]
  clientes: Map<string, string> // nome → clienteId
  produtos: Map<string, { id: string; nome: string; preco: number }> // codigo → dados
  tabelaPrecoId: string
  tipoEmbalagemIds: string[]
  centros: { cortadeira?: string; impressao?: string; acabamento?: string }
  orcamentosAprovados: string[] // ids de orçamentos APROVADO (p/ vincular pedidos)
  materiaPrimaIds: { id: string; codigo: string; nome: string }[]
  enderecoIds: { id: string; enderecoCompleto: string }[]
  resumo: Resumo
}

export { EMPRESA_ID, USUARIO_SEED_ID }
export type { ContadorModulo, Resumo, Contexto }
// ─── Helpers puros (reaproveitados de teste-fluxo-representante-e2e.ts) ───────────

/** Timestamp legível (YYYY-MM-DD HH:MM:SS) para prefixar linhas de log. */
function ts(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

/** Log padrão com timestamp e emoji. */
function log(emoji: string, msg: string): void {
  console.log(`[${ts()}] ${emoji} ${msg}`)
}

/** Log de erro com timestamp, emoji e a mensagem do erro (Error ou valor cru). */
function logErro(emoji: string, msg: string, err: unknown): void {
  console.error(`[${ts()}] ${emoji} ${msg}`, err instanceof Error ? err.message : err)
}

/**
 * Gera um CNPJ determinístico baseado no nome (para servir de chave de
 * idempotência de Cliente). Não é um CNPJ válido — apenas único e reproduzível
 * para o mesmo nome, e sempre casando com a máscara `XX.XXX.XXX/XXXX-XX`.
 */
function gerarCnpjDeterministico(nome: string): string {
  let hash = 0
  for (let i = 0; i < nome.length; i++) {
    hash = ((hash << 5) - hash + nome.charCodeAt(i)) | 0
  }
  const base = Math.abs(hash).toString().padStart(12, '0').slice(0, 12)
  // Dígitos verificadores simplificados (não precisam ser válidos, só estáveis).
  const d1 = (parseInt(base.slice(0, 4)) % 10).toString()
  const d2 = (parseInt(base.slice(4, 8)) % 10).toString()
  return `${base.slice(0, 2)}.${base.slice(2, 5)}.${base.slice(5, 8)}/${base.slice(8, 12)}-${d1}${d2}`
}

/**
 * Gera um preço determinístico (2 casas efetivas em [min, max]) a partir de uma
 * seed textual (ex.: código do produto). A mesma seed sempre produz o mesmo valor.
 */
function precoAleatorio(seed: string, min = 1.5, max = 15.0): number {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0
  }
  const frac = (Math.abs(hash) % 10000) / 10000
  return +(min + frac * (max - min)).toFixed(4)
}

/** Retorna a data atual acrescida de `dias` dias. */
function diasNoFuturo(dias: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + dias)
  return d
}

/** Retorna a data atual subtraída de `dias` dias. */
function diasNoPassado(dias: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return d
}

// ─── Dados de domínio (indústria gráfica) ─────────────────────────────────────────

/**
 * Clientes/produtos reais de indústria gráfica reaproveitados do script antigo.
 * Inclui os clientes obrigatórios do design: SOL & NEVE, CAFÉ 3 CORAÇÕES e
 * CERVEJARIA CIDADE IMPERIAL PETROPOLIS.
 */
const DADOS_REAIS: { codigo: string; produto: string; cliente: string }[] = [
  { codigo: '4758', produto: 'STORA ENZO 181 - 700X960', cliente: 'Acimpel Embalagens' },
  { codigo: '4575', produto: 'BOARDONE 230 - 1130X770', cliente: 'Acimpel Embalagens' },
  { codigo: '3021', produto: 'ETIQUETA EMBAL RODEIO 100M', cliente: 'BELGO BEKAERT ARAMES LTDA.' },
  { codigo: '2709', produto: 'CAIXA DE PAPELÃO P/5KG DE ELETRODO SERRALHEIRO', cliente: 'ESAB INDÚSTRIA E COMÉRCIO LTDA' },
  { codigo: '4528', produto: 'CARTUCHO KIT BEST SELLERS CÓD. 1020100094', cliente: 'FARMATIVA INDUSTRIA E COMERCIO LTDA' },
  { codigo: '4041217', produto: 'CART. MAE PREMIUM INTENSE FRAGANCE 08 UNID 100ML', cliente: 'ESTACAO Y' },
  { codigo: '1041607', produto: 'Lâmina Cola Rato Letal', cliente: 'LAIPPE' },
  { codigo: '1041592', produto: 'Lâmina Cola Rato Ligeirinho / Cola Mosca - KAOCID', cliente: 'LAIPPE' },
  { codigo: '4718', produto: 'Cartucho Eletrodo Ok Cód. 1001376', cliente: 'ESAB INDÚSTRIA E COMÉRCIO LTDA' },
  { codigo: '1051976', produto: 'Caixa Papelão Cicione Vaquinha - Cod: 8522731', cliente: 'SOL & NEVE' },
  { codigo: '1041535', produto: 'CARTUCHO HAMB TRADICIONAL CARAPRETA', cliente: 'CARAPRETA' },
  { codigo: '1021057', produto: 'RÓTULO P/FARPADO GIR 500', cliente: 'GERDAU ACOS LONGOS S.A.' },
  { codigo: '4707', produto: 'PROVA IMPRESSÃO CAIXA IMPÉRIO ULTRA ZERO 275ML 12', cliente: 'CERVEJARIA CIDADE IMPERIAL PETROPOLIS' },
  { codigo: '3570', produto: 'Cartucho Display para 50 sachês de 20g', cliente: 'CAFÉ 3 CORAÇÕES' },
  { codigo: '3231', produto: 'Caixa Garrafa Império Gold 210ml 610040039', cliente: 'CERVEJARIA CIDADE IMPERIAL PETROPOLIS' },
]

// ─── Exports das funções puras (para testes isolados) ─────────────────────────────

export {
  ts,
  log,
  logErro,
  diasNoFuturo,
  diasNoPassado,
  gerarCnpjDeterministico,
  precoAleatorio,
  DADOS_REAIS,
}

// ─── Guarda de segurança (anti-Carton Wega) ──────────────────────────────────────

/**
 * Regra de decisão PURA da guarda de segurança (testável sem banco).
 *
 * Retorna `true` se e somente se a empresa existe (não é `null`) E nem
 * `razaoSocial` nem `nomeFantasia` contêm a substring "carton"
 * (case-insensitive). Em qualquer outro caso retorna `false`.
 *
 * Espelha a dupla verificação de `scripts/limpar-demo-visiofab.ts`.
 */
function empresaAprovada(
  empresa: { razaoSocial: string; nomeFantasia?: string | null } | null,
): boolean {
  if (!empresa) return false
  const razao = (empresa.razaoSocial || '').toLowerCase()
  const fantasia = (empresa.nomeFantasia || '').toLowerCase()
  return !razao.includes('carton') && !fantasia.includes('carton')
}

/**
 * Confirma que o alvo do script é a empresa VizioFab Demo e não a Carton Wega.
 *
 * - Busca a empresa por `EMPRESA_ID` (`prisma.empresa.findUnique`).
 * - Lança erro fatal se não existir (capturado pelo `catch` global do `main()`,
 *   que encerra com `process.exit(1)`).
 * - Lança erro fatal se `razaoSocial` ou `nomeFantasia` contiverem "carton"
 *   (case-insensitive), explicitando que o script não pode rodar na Carton Wega.
 * - Retorna `{ id, nome }` da empresa validada.
 */
async function confirmarEmpresaDemo(): Promise<{ id: string; nome: string }> {
  const empresa = await prisma.empresa.findUnique({
    where: { id: EMPRESA_ID },
    select: { razaoSocial: true, nomeFantasia: true },
  })

  if (!empresa) {
    throw new Error(
      `Empresa ${EMPRESA_ID} (VizioFab Demo) não encontrada no banco! ` +
        'Verifique a DATABASE_URL e se a empresa existe antes de rodar o seed.',
    )
  }

  if (!empresaAprovada(empresa)) {
    throw new Error(
      'ABORTADO: a empresa alvo parece ser a Carton Wega (razaoSocial/nomeFantasia ' +
        'contém "carton"). Este script só pode rodar na VizioFab Demo.',
    )
  }

  const nome = empresa.nomeFantasia || empresa.razaoSocial
  return { id: EMPRESA_ID, nome }
}

export { empresaAprovada, confirmarEmpresaDemo }

// ─── Padrão "localizar-ou-criar" (upsert lógico genérico) ─────────────────────────

/**
 * Repositório abstrato mínimo sobre o qual a lógica de "localizar-ou-criar"
 * opera. Um delegate do Prisma (ex.: `prisma.cliente`) satisfaz este contrato
 * naturalmente — `findFirst` e `create` têm assinaturas compatíveis. A abstração
 * existe para permitir testar a decisão "existe? pula : cria" com um repositório
 * em memória (ver Property 2), sem depender do banco.
 *
 * `TWhere` é o tipo do filtro pela chave `@@unique` da entidade; `TData` é o
 * payload de criação. Ambos ficam genéricos porque cada entidade tem sua própria
 * chave e seus próprios campos.
 */
export interface RepositorioUpsert<TWhere, TData> {
  findFirst(args: { where: TWhere; select: { id: true } }): Promise<{ id: string } | null>
  create(args: { data: TData }): Promise<{ id: string }>
}

/** Resultado da resolução: o id resolvido e se foi criado agora ou já existia. */
export interface ResultadoUpsert {
  id: string
  criado: boolean
}

/**
 * Núcleo puro da resolução "localizar-ou-criar", desacoplado do Prisma e de
 * qualquer contador. Dado um repositório (real ou em memória), um `where`
 * ancorado na chave `@@unique` da entidade, e uma função que produz os dados de
 * criação:
 *
 * 1. `findFirst({ where, select: { id: true } })` — se encontrar, retorna o id
 *    existente com `criado: false` (não cria nada);
 * 2. caso contrário, `create({ data: criarDados() })` e retorna o novo id com
 *    `criado: true`.
 *
 * A decisão nunca cria quando já existe — é o que garante a idempotência
 * (Property 2). `criarDados` é uma função (lazy) para que o payload só seja
 * montado quando a criação de fato ocorre.
 */
export async function localizarOuCriar<TWhere, TData>(
  repo: RepositorioUpsert<TWhere, TData>,
  where: TWhere,
  criarDados: () => TData,
): Promise<ResultadoUpsert> {
  const existente = await repo.findFirst({ where, select: { id: true } })
  if (existente) {
    return { id: existente.id, criado: false }
  }
  const novo = await repo.create({ data: criarDados() })
  return { id: novo.id, criado: true }
}

/**
 * Chaves do `Resumo` que são pares de contadores `<algo>Criados`/`<algo>Pulados`.
 * Usado para incrementar o contador correto de forma type-safe sem repetir o
 * bloco `if (criado) ... else ...` em cada módulo.
 */
export type ParContador =
  | 'clientes'
  | 'vendedores'
  | 'representantes'
  | 'produtos'
  | 'tiposEmbalagem'
  | 'orcamentos'
  | 'pedidos'
  | 'solicitacoes'
  | 'cadastrosBase'

/**
 * Incrementa `<par>Criados` ou `<par>Pulados` no `Resumo` conforme o resultado
 * da resolução. Mantém a invariante `criados + pulados == definições
 * processadas` (Property 9) desde que chamada uma vez por definição resolvida.
 */
export function contabilizar(resumo: Resumo, par: ParContador, criado: boolean): void {
  const chave = `${par}${criado ? 'Criados' : 'Pulados'}` as keyof Resumo
  resumo[chave] = (resumo[chave] as number) + 1
}

/**
 * Açúcar que combina `localizarOuCriar` (efeito no repositório) com
 * `contabilizar` (atualização do `Resumo`). É o ponto de reuso pelos módulos de
 * seed: passa o delegate do Prisma como repositório, o `where` da chave única, a
 * fábrica de dados e o par de contador do módulo. Retorna o id resolvido.
 *
 * Ex.: `await resolverContando(prisma.cliente, ctx.resumo, 'clientes',
 *   { empresaId, cpfCnpj }, () => ({ empresaId, cpfCnpj, razaoSocial, ... }))`
 */
export async function resolverContando<TWhere, TData>(
  repo: RepositorioUpsert<TWhere, TData>,
  resumo: Resumo,
  par: ParContador,
  where: TWhere,
  criarDados: () => TData,
): Promise<string> {
  const { id, criado } = await localizarOuCriar(repo, where, criarDados)
  contabilizar(resumo, par, criado)
  return id
}

// ─── Módulo: cadastros base do PCP (auto-criação/reuso) ───────────────────────────

/**
 * Definição mínima de um Tipo de Processo produtivo a localizar-ou-criar.
 * `posicao` define a ordem das abas no painel de Programação.
 */
interface DefTipoProcesso {
  codigo: string
  descricao: string
  posicao: number
}

/**
 * Definição mínima de um Centro de Produção a localizar-ou-criar. `tipoCodigo`
 * amarra o centro ao seu TipoProcesso (FK obrigatória `tipoProcessoId`).
 */
interface DefCentro {
  codigo: string
  descricao: string
  tipo: string // MAQUINA | SETOR | LINHA
  tipoCodigo: string // código do TipoProcesso ao qual o centro pertence
}

/** Os 3 tipos de processo mínimos usados pela demo (cortadeira/impressão/acabamento). */
const TIPOS_PROCESSO_BASE: DefTipoProcesso[] = [
  { codigo: 'CORTADEIRA', descricao: 'Cortadeira', posicao: 0 },
  { codigo: 'IMPRESSAO', descricao: 'Impressão', posicao: 1 },
  { codigo: 'ACABAMENTO', descricao: 'Acabamento', posicao: 2 },
]

/** Um centro de produção por tipo de processo (cortadeira/impressão/acabamento). */
const CENTROS_BASE: DefCentro[] = [
  { codigo: 'CORT-01', descricao: 'Cortadeira Coin', tipo: 'MAQUINA', tipoCodigo: 'CORTADEIRA' },
  { codigo: 'IMP-01', descricao: 'Impressão Heidelberg CD', tipo: 'MAQUINA', tipoCodigo: 'IMPRESSAO' },
  { codigo: 'ACAB-01', descricao: 'Acabamento / Colagem', tipo: 'SETOR', tipoCodigo: 'ACABAMENTO' },
]

/**
 * Localiza-ou-cria os cadastros base do PCP necessários para os demais módulos
 * (Ordens de Produção e Pedidos de Venda) rodarem numa base zerada ou parcial:
 *
 * - **TipoProcesso** (CORTADEIRA/IMPRESSAO/ACABAMENTO) — dedupe por
 *   `[empresaId, codigo]`. Criados primeiro pois `CentroProducao.tipoProcessoId`
 *   é FK obrigatória.
 * - **CentroProducao** (cortadeira/impressão/acabamento) — dedupe por
 *   `[empresaId, codigo]`, cada um vinculado ao seu TipoProcesso.
 * - **TurnoProducao** (turno comercial padrão) — dedupe por `[empresaId, codigo]`.
 * - **TabelaPreco** — sem chave única natural: localiza o primeiro registro da
 *   empresa e cria se ausente (Requirement 10.3 / 7.6).
 *
 * Preenche `ctx.centros` (cortadeira/impressao/acabamento com ids) e
 * `ctx.tabelaPrecoId` para os módulos seguintes.
 *
 * Cada resolução conta no par `cadastrosBase` do resumo. Erros na criação de um
 * cadastro individual são não-fatais (logados, seguem para o próximo).
 *
 * _Requirements: 10.1, 10.2, 10.3, 7.6_
 */
export async function seedCadastrosBase(ctx: Contexto): Promise<ContadorModulo> {
  const antesCriados = ctx.resumo.cadastrosBaseCriados
  const antesPulados = ctx.resumo.cadastrosBasePulados

  // 1) Tipos de processo (FK obrigatória de CentroProducao) — criar primeiro.
  const tipoProcessoIdPorCodigo = new Map<string, string>()
  for (const def of TIPOS_PROCESSO_BASE) {
    try {
      const id = await resolverContando(
        prisma.tipoProcesso,
        ctx.resumo,
        'cadastrosBase',
        { empresaId: ctx.empresaId, codigo: def.codigo },
        () => ({
          empresaId: ctx.empresaId,
          codigo: def.codigo,
          descricao: def.descricao,
          posicao: def.posicao,
          status: true,
        }),
      )
      tipoProcessoIdPorCodigo.set(def.codigo, id)
    } catch (err) {
      logErro('⚠️', `Falha ao resolver TipoProcesso ${def.codigo}:`, err)
    }
  }

  // 2) Centros de produção — cada um vinculado ao seu TipoProcesso.
  const centroIdPorTipo: Record<string, string | undefined> = {}
  for (const def of CENTROS_BASE) {
    const tipoProcessoId = tipoProcessoIdPorCodigo.get(def.tipoCodigo)
    if (!tipoProcessoId) {
      logErro(
        '⚠️',
        `Centro ${def.codigo} não pôde ser criado: TipoProcesso ${def.tipoCodigo} indisponível.`,
        new Error('tipoProcessoId ausente'),
      )
      continue
    }
    try {
      const id = await resolverContando(
        prisma.centroProducao,
        ctx.resumo,
        'cadastrosBase',
        { empresaId: ctx.empresaId, codigo: def.codigo },
        () => ({
          empresaId: ctx.empresaId,
          codigo: def.codigo,
          descricao: def.descricao,
          tipo: def.tipo,
          tipoProcessoId,
          status: true,
        }),
      )
      centroIdPorTipo[def.tipoCodigo] = id
    } catch (err) {
      logErro('⚠️', `Falha ao resolver CentroProducao ${def.codigo}:`, err)
    }
  }

  ctx.centros = {
    cortadeira: centroIdPorTipo['CORTADEIRA'],
    impressao: centroIdPorTipo['IMPRESSAO'],
    acabamento: centroIdPorTipo['ACABAMENTO'],
  }

  // 3) Turno de produção comercial padrão (seg-sex, 08:00–17:00).
  try {
    await resolverContando(
      prisma.turnoProducao,
      ctx.resumo,
      'cadastrosBase',
      { empresaId: ctx.empresaId, codigo: 'COM' },
      () => ({
        empresaId: ctx.empresaId,
        codigo: 'COM',
        descricao: 'Turno Comercial',
        horaInicio: '08:00',
        horaFim: '17:00',
        diasSemana: [1, 2, 3, 4, 5],
        duracaoMinutos: 540,
        status: true,
      }),
    )
  } catch (err) {
    logErro('⚠️', 'Falha ao resolver TurnoProducao COM:', err)
  }

  // 4) Tabela de preço — sem chave única natural: localiza o 1º registro da
  //    empresa e cria se ausente (Requirement 10.3 / 7.6).
  try {
    ctx.tabelaPrecoId = await resolverContando(
      prisma.tabelaPreco,
      ctx.resumo,
      'cadastrosBase',
      { empresaId: ctx.empresaId },
      () => ({
        empresaId: ctx.empresaId,
        nome: 'Tabela Padrão',
        status: true,
      }),
    )
  } catch (err) {
    logErro('⚠️', 'Falha ao resolver TabelaPreco padrão:', err)
  }

  const criados = ctx.resumo.cadastrosBaseCriados - antesCriados
  const pulados = ctx.resumo.cadastrosBasePulados - antesPulados
  log('🏭', `Cadastros base: criados: ${criados} | pulados: ${pulados}`)
  return { criados, pulados }
}

// ─── Módulo: vendedores e credenciais de representante ────────────────────────────

/**
 * Definição mínima de um vendedor da demo, base tanto para o `Vendedor` quanto
 * para sua `RepresentanteCredencial` (login do Portal Representante).
 */
interface DefVendedor {
  nome: string
  cpf: string
  comissao: number
  email: string
  senha: string
}

/**
 * Os 2-3 vendedores/representantes da demo. As senhas ficam em texto claro
 * (impressas no console) porque o objetivo é permitir login imediato no Portal
 * Representante durante a demonstração — é uma base de demo, não de produção.
 */
const VENDEDORES_BASE: DefVendedor[] = [
  { nome: 'Marina Alves', cpf: '111.444.777-35', comissao: 3.5, email: 'marina.alves@viziofab.demo', senha: 'Demo@2025' },
  { nome: 'Carlos Prado', cpf: '222.555.888-46', comissao: 4.0, email: 'carlos.prado@viziofab.demo', senha: 'Demo@2025' },
  { nome: 'Renata Souza', cpf: '333.666.999-57', comissao: 5.0, email: 'renata.souza@viziofab.demo', senha: 'Demo@2025' },
]

/** Payload de criação de `Vendedor` (campos do model). */
interface DadosVendedor {
  empresaId: string
  nome: string
  cpf: string
  comissao: number
  status: boolean
}

/** Payload de criação de `RepresentanteCredencial` (campos do model). */
interface DadosRepresentanteCredencial {
  empresaId: string
  vendedorId: string
  email: string
  senhaHash: string
  senhaTemporaria: boolean
  status: string
}

/**
 * Builder PURO do `Vendedor` (sem I/O) — a partir do `empresaId` e de uma
 * definição, produz o payload de criação com todos os campos obrigatórios do
 * model: `empresaId`, `nome`, `cpf`, `comissao` e `status` (ativo).
 *
 * Separado da função de efeito para permitir testar o contrato de campos
 * (Property 4) sem tocar no banco.
 */
export function buildVendedor(empresaId: string, def: DefVendedor): DadosVendedor {
  return {
    empresaId,
    nome: def.nome,
    cpf: def.cpf,
    comissao: def.comissao,
    status: true,
  }
}

/**
 * Builder PURO da `RepresentanteCredencial` (sem I/O de banco) — gera o
 * `senhaHash` com `bcrypt.hashSync(senha, 10)` (custo/salt rounds 10, exigência
 * do Requirement 4.3) e fixa `status: 'ATIVO'` e `senhaTemporaria: false` para
 * que o login funcione imediatamente após a execução.
 *
 * Separado da função de efeito para permitir o round-trip do bcrypt (Property 5)
 * e o contrato de campos (Property 4) em testes isolados.
 */
export function buildRepresentanteCredencial(
  empresaId: string,
  vendedorId: string,
  def: { email: string; senha: string },
): DadosRepresentanteCredencial {
  return {
    empresaId,
    vendedorId,
    email: def.email,
    senhaHash: bcrypt.hashSync(def.senha, 10),
    senhaTemporaria: false,
    status: 'ATIVO',
  }
}

export { VENDEDORES_BASE }
export type { DefVendedor, DadosVendedor, DadosRepresentanteCredencial }

/**
 * Cria (ou reutiliza) os 2-3 vendedores da demo e, para cada um, sua
 * `RepresentanteCredencial` de acesso ao Portal Representante:
 *
 * - **Vendedor** — dedupe por `[empresaId, cpf]`. Payload montado por
 *   `buildVendedor`.
 * - **RepresentanteCredencial** — dedupe por `[empresaId, email]` (o
 *   `senhaHash` bcrypt custo 10, `status: 'ATIVO'` e `senhaTemporaria: false`
 *   vêm de `buildRepresentanteCredencial`).
 *
 * Preenche `ctx.vendedores` (id + nome) e `ctx.representantes`
 * (id + email + senha em texto claro + vendedorId) para os módulos seguintes
 * (Clientes, Orçamentos, Pedidos, Solicitações do Portal).
 *
 * Imprime email + senha em texto claro (🔑) por representante — Requirement 4.4.
 *
 * Cada vendedor conta no par `vendedores` e cada credencial no par
 * `representantes` do resumo. Erros na criação de um item individual são
 * não-fatais (logados, segue para o próximo).
 *
 * _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
 */
export async function seedVendedoresERepresentantes(ctx: Contexto): Promise<ContadorModulo> {
  const antesVendCriados = ctx.resumo.vendedoresCriados
  const antesVendPulados = ctx.resumo.vendedoresPulados
  const antesRepCriados = ctx.resumo.representantesCriados
  const antesRepPulados = ctx.resumo.representantesPulados

  for (const def of VENDEDORES_BASE) {
    try {
      // 1) Vendedor — dedupe por [empresaId, cpf].
      const vendedorId = await resolverContando(
        prisma.vendedor,
        ctx.resumo,
        'vendedores',
        { empresaId: ctx.empresaId, cpf: def.cpf },
        () => buildVendedor(ctx.empresaId, def),
      )
      ctx.vendedores.push({ id: vendedorId, nome: def.nome })

      // 2) Credencial de representante — dedupe por [empresaId, email].
      const representanteId = await resolverContando(
        prisma.representanteCredencial,
        ctx.resumo,
        'representantes',
        { empresaId: ctx.empresaId, email: def.email },
        () => buildRepresentanteCredencial(ctx.empresaId, vendedorId, def),
      )
      ctx.representantes.push({
        id: representanteId,
        email: def.email,
        senha: def.senha,
        vendedorId,
      })

      // 3) Credenciais em texto claro para login imediato na demo.
      log('🔑', `Representante: ${def.email} | senha: ${def.senha}`)
    } catch (err) {
      logErro('⚠️', `Falha ao resolver vendedor/representante ${def.nome}:`, err)
    }
  }

  const criados =
    ctx.resumo.vendedoresCriados - antesVendCriados + (ctx.resumo.representantesCriados - antesRepCriados)
  const pulados =
    ctx.resumo.vendedoresPulados - antesVendPulados + (ctx.resumo.representantesPulados - antesRepPulados)
  log('🧑\u200d💼', `Vendedores + representantes: criados: ${criados} | pulados: ${pulados}`)
  return { criados, pulados }
}

// ─── Módulo: clientes ─────────────────────────────────────────────────────────────

/** Payload de criação de `Cliente` (campos do model relevantes para a demo). */
interface DadosCliente {
  empresaId: string
  razaoSocial: string
  cpfCnpj: string
  vendedorId?: string
  status: boolean
}

/**
 * Nomes obrigatórios de clientes exigidos pelo design/Requirement 3.2. Devem
 * estar sempre presentes na lista final, com o nome exato como aparece em
 * `DADOS_REAIS`.
 */
const CLIENTES_OBRIGATORIOS = [
  'SOL & NEVE',
  'CAFÉ 3 CORAÇÕES',
  'CERVEJARIA CIDADE IMPERIAL PETROPOLIS',
]

/**
 * Extrai a lista de nomes distintos de clientes a partir de `DADOS_REAIS`,
 * garantindo que os 3 nomes obrigatórios apareçam e limitando o total à faixa
 * de 5 a 8 clientes (Requirement 3.1).
 *
 * Estratégia: começa pelos obrigatórios (na ordem definida em
 * `CLIENTES_OBRIGATORIOS`), depois completa com os demais nomes distintos de
 * `DADOS_REAIS` (preservando a ordem de primeira ocorrência) até atingir o teto
 * de 8. Função PURA e determinística — a mesma entrada produz sempre a mesma
 * lista, servindo de base estável para a idempotência da criação.
 */
export function extrairNomesClientes(
  dados: { cliente: string }[] = DADOS_REAIS,
  obrigatorios: string[] = CLIENTES_OBRIGATORIOS,
  max = 8,
): string[] {
  const nomes: string[] = []
  const vistos = new Set<string>()

  // 1) Obrigatórios primeiro (garante presença mesmo se a lista for cortada).
  for (const nome of obrigatorios) {
    if (!vistos.has(nome)) {
      vistos.add(nome)
      nomes.push(nome)
    }
  }

  // 2) Completa com os demais nomes distintos de DADOS_REAIS, até o teto.
  for (const { cliente } of dados) {
    if (nomes.length >= max) break
    if (!vistos.has(cliente)) {
      vistos.add(cliente)
      nomes.push(cliente)
    }
  }

  return nomes
}

/**
 * Builder PURO do `Cliente` (sem I/O) — a partir do `empresaId`, do nome
 * (`razaoSocial`) e de um `vendedorId` opcional, produz o payload de criação com
 * todos os campos obrigatórios do model: `empresaId`, `razaoSocial`, `cpfCnpj`
 * (determinístico via `gerarCnpjDeterministico`, servindo de chave de
 * idempotência) e `status` (ativo). Quando um vendedor está disponível, vincula
 * via `vendedorId` (Requirement 3.5).
 *
 * Separado da função de efeito para permitir testar o contrato de campos
 * (Property 4) sem tocar no banco.
 *
 * _Requirements: 3.3, 3.4, 3.5_
 */
export function buildCliente(
  empresaId: string,
  razaoSocial: string,
  vendedorId?: string,
): DadosCliente {
  const dados: DadosCliente = {
    empresaId,
    razaoSocial,
    cpfCnpj: gerarCnpjDeterministico(razaoSocial),
    status: true,
  }
  if (vendedorId) {
    dados.vendedorId = vendedorId
  }
  return dados
}

export { CLIENTES_OBRIGATORIOS }
export type { DadosCliente }

/**
 * Cria (ou reutiliza) entre 5 e 8 clientes de indústria gráfica na Empresa_Demo,
 * incluindo obrigatoriamente SOL & NEVE, CAFÉ 3 CORAÇÕES e CERVEJARIA CIDADE
 * IMPERIAL (Requirement 3.2). Os nomes são extraídos de `DADOS_REAIS` por
 * `extrairNomesClientes`.
 *
 * - **Cliente** — dedupe por `[empresaId, cpfCnpj]` (o `cpfCnpj` determinístico
 *   por nome garante que reexecuções resolvam o mesmo registro). Payload montado
 *   por `buildCliente`.
 * - Vincula `vendedorId` quando há vendedores disponíveis em `ctx.vendedores`,
 *   distribuindo os clientes entre eles de forma round-robin (Requirement 3.5).
 *
 * Preenche `ctx.clientes` (Map nome → clienteId) para os módulos seguintes
 * (Orçamentos, Pedidos, Ordens de Produção, Solicitações do Portal).
 *
 * Cada cliente conta no par `clientes` do resumo. Erros na criação de um cliente
 * individual são não-fatais (logados, segue para o próximo).
 *
 * _Requirements: 3.1, 3.2, 3.3, 3.5_
 */
export async function seedClientes(ctx: Contexto): Promise<ContadorModulo> {
  const antesCriados = ctx.resumo.clientesCriados
  const antesPulados = ctx.resumo.clientesPulados

  const nomes = extrairNomesClientes()

  let indiceVendedor = 0
  for (const razaoSocial of nomes) {
    try {
      // Distribui o vendedor de forma round-robin quando houver algum disponível.
      const vendedorId =
        ctx.vendedores.length > 0
          ? ctx.vendedores[indiceVendedor % ctx.vendedores.length].id
          : undefined

      const cpfCnpj = gerarCnpjDeterministico(razaoSocial)
      const clienteId = await resolverContando(
        prisma.cliente,
        ctx.resumo,
        'clientes',
        { empresaId: ctx.empresaId, cpfCnpj },
        () => buildCliente(ctx.empresaId, razaoSocial, vendedorId),
      )
      ctx.clientes.set(razaoSocial, clienteId)

      // Atualizar vendedorId se o cliente já existia sem vínculo (ou com outro).
      if (vendedorId) {
        await prisma.cliente.updateMany({
          where: { id: clienteId, vendedorId: { not: vendedorId } },
          data: { vendedorId },
        })
      }

      indiceVendedor++
    } catch (err) {
      logErro('⚠️', `Falha ao resolver cliente ${razaoSocial}:`, err)
    }
  }

  const criados = ctx.resumo.clientesCriados - antesCriados
  const pulados = ctx.resumo.clientesPulados - antesPulados
  log('🏢', `Clientes: criados: ${criados} | pulados: ${pulados}`)
  return { criados, pulados }
}

// ─── Módulo: produtos ─────────────────────────────────────────────────────────────

/** Payload de criação de `Produto` (campos do model relevantes para a demo). */
interface DadosProduto {
  empresaId: string
  codigo: string
  nome: string
  precoBase: number
  classificacaoPcp: string
  tipoFisico: string
  status: boolean
}

/**
 * Classificação PCP padrão dos produtos da demo. Valor válido do enum textual
 * de `Produto.classificacaoPcp` (MATERIA_PRIMA | INTERMEDIARIO | PRODUTO_ACABADO
 * | EMBALAGEM | INSUMO) — embalagens de papelão prontas são produto acabado.
 */
const CLASSIFICACAO_PCP_PADRAO = 'PRODUTO_ACABADO'

/**
 * Tipo físico padrão dos produtos da demo. Valor válido do enum textual de
 * `Produto.tipoFisico` (UNIDADE_PADRAO | FISICO_LINEAR | FISICO_SUPERFICIAL |
 * LIQUIDO | PESO) — embalagens contadas por unidade.
 */
const TIPO_FISICO_PADRAO = 'UNIDADE_PADRAO'

/**
 * Builder PURO do `Produto` (sem I/O) — a partir do `empresaId`, do `codigo` e
 * do `nome`, produz o payload de criação com todos os campos obrigatórios e os
 * campos gráficos do model: `empresaId`, `codigo`, `nome`, `precoBase`
 * (determinístico via `precoAleatorio`, seed = código), `classificacaoPcp`
 * (`PRODUTO_ACABADO`), `tipoFisico` (`UNIDADE_PADRAO`) e `status` (ativo).
 *
 * Separado da função de efeito para permitir testar o contrato de campos
 * (Property 4) sem tocar no banco.
 *
 * _Requirements: 5.2, 5.3, 5.4_
 */
export function buildProduto(empresaId: string, codigo: string, nome: string): DadosProduto {
  return {
    empresaId,
    codigo,
    nome,
    precoBase: precoAleatorio(codigo),
    classificacaoPcp: CLASSIFICACAO_PCP_PADRAO,
    tipoFisico: TIPO_FISICO_PADRAO,
    status: true,
  }
}

/**
 * Seleciona entre 5 e 10 produtos (pares `codigo`/`produto`) de `DADOS_REAIS`
 * para popular a demo, preservando a ordem de primeira ocorrência de cada código
 * e descartando eventuais códigos duplicados. Função PURA e determinística — a
 * mesma entrada produz sempre a mesma lista, servindo de base estável para a
 * idempotência da criação (dedupe por `[empresaId, codigo]`).
 *
 * _Requirements: 5.1_
 */
export function extrairProdutos(
  dados: { codigo: string; produto: string }[] = DADOS_REAIS,
  max = 10,
): { codigo: string; nome: string }[] {
  const produtos: { codigo: string; nome: string }[] = []
  const vistos = new Set<string>()

  for (const { codigo, produto } of dados) {
    if (produtos.length >= max) break
    if (!vistos.has(codigo)) {
      vistos.add(codigo)
      produtos.push({ codigo, nome: produto })
    }
  }

  return produtos
}

export { CLASSIFICACAO_PCP_PADRAO, TIPO_FISICO_PADRAO }
export type { DadosProduto }

/**
 * Cria (ou reutiliza) entre 5 e 10 produtos de embalagens de papelão na
 * Empresa_Demo, extraídos dos pares `codigo`/`produto` de `DADOS_REAIS` por
 * `extrairProdutos`.
 *
 * - **Produto** — dedupe por `[empresaId, codigo]`. Payload montado por
 *   `buildProduto` (preço determinístico por código, `classificacaoPcp:
 *   PRODUTO_ACABADO`, `tipoFisico: UNIDADE_PADRAO`).
 *
 * Preenche `ctx.produtos` (Map codigo → `{ id, nome, preco }`) para os módulos
 * seguintes (Pedidos de Venda e Ordens de Produção).
 *
 * Cada produto conta no par `produtos` do resumo. Erros na criação de um produto
 * individual são não-fatais (logados, segue para o próximo).
 *
 * _Requirements: 5.1, 5.2, 5.3, 5.4_
 */
export async function seedProdutos(ctx: Contexto): Promise<ContadorModulo> {
  const antesCriados = ctx.resumo.produtosCriados
  const antesPulados = ctx.resumo.produtosPulados

  const produtos = extrairProdutos()

  for (const { codigo, nome } of produtos) {
    try {
      const dados = buildProduto(ctx.empresaId, codigo, nome)
      const produtoId = await resolverContando(
        prisma.produto,
        ctx.resumo,
        'produtos',
        { empresaId: ctx.empresaId, codigo },
        () => dados,
      )
      ctx.produtos.set(codigo, { id: produtoId, nome, preco: dados.precoBase })
    } catch (err) {
      logErro('⚠️', `Falha ao resolver produto ${codigo} (${nome}):`, err)
    }
  }

  const criados = ctx.resumo.produtosCriados - antesCriados
  const pulados = ctx.resumo.produtosPulados - antesPulados
  log('📦', `Produtos: criados: ${criados} | pulados: ${pulados}`)
  return { criados, pulados }
}

// ─── Módulo: tipos de embalagem ───────────────────────────────────────────────────

/**
 * Um parâmetro exigido pelo wizard de cálculo de um `TipoEmbalagem` (item do
 * array Json `parametros`). Modelado conforme o comentário do schema
 * (`[{nome, label, unidade, obrigatorio, default}]`).
 */
interface ParametroEmbalagem {
  nome: string
  label: string
  unidade: string
  obrigatorio: boolean
}

/**
 * Payload de criação de `TipoEmbalagem` (campos do model). Os defaults numéricos
 * (`abaColagemMm`, `sangriaMm`, `pincaMm`) e `status` têm valor padrão no schema,
 * então não precisam ser informados aqui — mantemos apenas os obrigatórios sem
 * default: `empresaId`, `codigo`, `descricao`, `formulaLargura`, `formulaAltura`,
 * `parametros` (Json array) e `processosObrigatorios` (String[]).
 */
interface DadosTipoEmbalagem {
  empresaId: string
  codigo: string
  descricao: string
  formulaLargura: string
  formulaAltura: string
  parametros: ParametroEmbalagem[]
  processosObrigatorios: string[]
}

/**
 * Definição mínima de um tipo de embalagem da demo (sem `empresaId`, que é
 * injetado pelo builder). Serve de fonte estável para a idempotência da criação
 * (dedupe por `[empresaId, codigo]`).
 */
interface DefTipoEmbalagem {
  codigo: string
  descricao: string
  formulaLargura: string
  formulaAltura: string
  parametros: ParametroEmbalagem[]
  processosObrigatorios: string[]
}

/**
 * Os tipos de embalagem da demo (caixa padrão + cartucho), com fórmulas de
 * planificação e parâmetros realistas de indústria gráfica. Valores extraídos do
 * exemplo de default válido do design (Requirement 6.5 / 10.4).
 */
const TIPOS_EMBALAGEM_BASE: DefTipoEmbalagem[] = [
  {
    codigo: 'CAIXA-STD',
    descricao: 'Caixa padrão',
    formulaLargura: '(L + P) * 2 + abaColagem',
    formulaAltura: 'A + P + sangria',
    parametros: [
      { nome: 'L', label: 'Largura', unidade: 'mm', obrigatorio: true },
      { nome: 'A', label: 'Altura', unidade: 'mm', obrigatorio: true },
      { nome: 'P', label: 'Profundidade', unidade: 'mm', obrigatorio: true },
    ],
    processosObrigatorios: ['IMPRESSAO', 'CORTE_VINCO', 'COLAGEM'],
  },
  {
    codigo: 'CARTUCHO-STD',
    descricao: 'Cartucho padrão',
    formulaLargura: '(L + P) * 2 + abaColagem',
    formulaAltura: 'A + 2 * P + sangria',
    parametros: [
      { nome: 'L', label: 'Largura', unidade: 'mm', obrigatorio: true },
      { nome: 'A', label: 'Altura', unidade: 'mm', obrigatorio: true },
      { nome: 'P', label: 'Profundidade', unidade: 'mm', obrigatorio: true },
    ],
    processosObrigatorios: ['IMPRESSAO', 'CORTE_VINCO', 'COLAGEM'],
  },
]

/**
 * Builder PURO do `TipoEmbalagem` (sem I/O) — a partir do `empresaId` e de uma
 * definição, produz o payload de criação com todos os campos obrigatórios do
 * model (sem default no schema): `empresaId`, `codigo`, `descricao`,
 * `formulaLargura`, `formulaAltura`, `parametros` (Json array) e
 * `processosObrigatorios` (String[]). Os defaults numéricos (`abaColagemMm`,
 * `sangriaMm`, `pincaMm`) e `status` são resolvidos pelo próprio schema.
 *
 * Separado da função de efeito para permitir testar o contrato de campos
 * (Property 4) sem tocar no banco.
 *
 * _Requirements: 6.5, 10.4_
 */
export function buildTipoEmbalagem(empresaId: string, def: DefTipoEmbalagem): DadosTipoEmbalagem {
  return {
    empresaId,
    codigo: def.codigo,
    descricao: def.descricao,
    formulaLargura: def.formulaLargura,
    formulaAltura: def.formulaAltura,
    parametros: def.parametros,
    processosObrigatorios: def.processosObrigatorios,
  }
}

export { TIPOS_EMBALAGEM_BASE }
export type { DefTipoEmbalagem, DadosTipoEmbalagem, ParametroEmbalagem }

/**
 * Localiza-ou-cria os tipos de embalagem da demo (caixa padrão + cartucho) na
 * Empresa_Demo, servindo de referência (`tipoEmbalagemId`) para os orçamentos
 * gráficos do módulo seguinte.
 *
 * - **TipoEmbalagem** — dedupe por `[empresaId, codigo]`. Payload montado por
 *   `buildTipoEmbalagem` (fórmulas de planificação, `parametros` Json array e
 *   `processosObrigatorios` String[]; os defaults numéricos e `status` vêm do
 *   schema).
 *
 * Preenche `ctx.tipoEmbalagemIds` (array de ids) para o módulo de orçamentos.
 *
 * Cada tipo conta no par `tiposEmbalagem` do resumo. Erros na criação de um tipo
 * individual são não-fatais (logados, segue para o próximo).
 *
 * _Requirements: 6.5, 10.4_
 */
export async function seedTiposEmbalagem(ctx: Contexto): Promise<ContadorModulo> {
  const antesCriados = ctx.resumo.tiposEmbalagemCriados
  const antesPulados = ctx.resumo.tiposEmbalagemPulados

  for (const def of TIPOS_EMBALAGEM_BASE) {
    try {
      const tipoEmbalagemId = await resolverContando(
        prisma.tipoEmbalagem,
        ctx.resumo,
        'tiposEmbalagem',
        { empresaId: ctx.empresaId, codigo: def.codigo },
        () => buildTipoEmbalagem(ctx.empresaId, def),
      )
      ctx.tipoEmbalagemIds.push(tipoEmbalagemId)
    } catch (err) {
      logErro('⚠️', `Falha ao resolver tipo de embalagem ${def.codigo}:`, err)
    }
  }

  const criados = ctx.resumo.tiposEmbalagemCriados - antesCriados
  const pulados = ctx.resumo.tiposEmbalagemPulados - antesPulados
  log('📐', `Tipos de embalagem: criados: ${criados} | pulados: ${pulados}`)
  return { criados, pulados }
}

// ─── Módulo: orçamentos gráficos ──────────────────────────────────────────────────

/**
 * Status possíveis de um OrcamentoGrafico no schema:
 * RASCUNHO | ENVIADO | APROVADO | RECUSADO | VENCIDO
 */
type StatusOrcamento = 'RASCUNHO' | 'ENVIADO' | 'APROVADO' | 'RECUSADO' | 'VENCIDO'

/**
 * Definição mínima de um orçamento gráfico a criar na demo. `status` determina
 * se `resultadoCalculo`, `aprovadoEm`, `precoUnitario` e `precoVenda` serão
 * preenchidos (somente quando APROVADO).
 */
interface DefOrcamentoGrafico {
  numero: number
  status: StatusOrcamento
  quantidade: number
  medidas: Record<string, number>
}

/**
 * Payload de criação de `OrcamentoGrafico` gerado pelo builder. Inclui todos os
 * campos obrigatórios (sem default) do model e os campos condicionais de
 * aprovação.
 */
interface DadosOrcamentoGrafico {
  empresaId: string
  numero: number
  versao: number
  tipoEmbalagemId: string
  medidas: Record<string, number>
  quantidade: number
  criadoPorId: string
  status: StatusOrcamento
  resultadoCalculo?: { precoUnitario: number; valorTotal: number; custoTotal: number; margemReal: number }
  aprovadoEm?: Date
  precoUnitario?: number
  precoVenda?: number
}

/**
 * Os 5 orçamentos da demo — distribuição exata: 1 RASCUNHO, 1 ENVIADO, 3 APROVADO
 * (Requirement 6.1, 6.2). Medidas variadas para simular caixas de tamanhos
 * diferentes. `numero` sequencial (901-905) evita conflito com dados reais.
 */
const ORCAMENTOS_BASE: DefOrcamentoGrafico[] = [
  { numero: 901, status: 'RASCUNHO', quantidade: 5000, medidas: { L: 150, A: 200, P: 80 } },
  { numero: 902, status: 'ENVIADO', quantidade: 10000, medidas: { L: 200, A: 300, P: 100 } },
  { numero: 903, status: 'APROVADO', quantidade: 20000, medidas: { L: 250, A: 180, P: 60 } },
  { numero: 904, status: 'APROVADO', quantidade: 15000, medidas: { L: 120, A: 250, P: 90 } },
  { numero: 905, status: 'APROVADO', quantidade: 8000, medidas: { L: 300, A: 200, P: 120 } },
]

/**
 * Builder PURO do `OrcamentoGrafico` (sem I/O) — a partir do `empresaId`,
 * `tipoEmbalagemId` e de uma definição, produz o payload de criação com todos os
 * campos obrigatórios do model: `empresaId`, `numero`, `versao` (1),
 * `tipoEmbalagemId`, `medidas` (Json), `quantidade`, `criadoPorId`
 * (`USUARIO_SEED_ID`) e `status`.
 *
 * Quando `status === 'APROVADO'`, preenche:
 * - `resultadoCalculo` (Json com `precoUnitario` e `valorTotal` positivos) —
 *   exigência da Property 6.
 * - `aprovadoEm` (data no passado — simulando aprovação recente).
 * - `precoUnitario` e `precoVenda` (Decimal, extraídos do cálculo).
 *
 * Separado da função de efeito para permitir testar o contrato de campos
 * (Property 4) e a Property 6 sem tocar no banco.
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.4_
 */
export function buildOrcamentoGrafico(
  empresaId: string,
  tipoEmbalagemId: string,
  def: DefOrcamentoGrafico,
): DadosOrcamentoGrafico {
  const dados: DadosOrcamentoGrafico = {
    empresaId,
    numero: def.numero,
    versao: 1,
    tipoEmbalagemId,
    medidas: def.medidas,
    quantidade: def.quantidade,
    criadoPorId: USUARIO_SEED_ID,
    status: def.status,
  }

  if (def.status === 'APROVADO') {
    // Preço unitário determinístico e positivo, baseado na seed `numero`.
    const unitario = precoAleatorio(`orc-${def.numero}`, 2.0, 12.0)
    const valorTotal = +(unitario * def.quantidade).toFixed(2)

    dados.resultadoCalculo = {
      precoUnitario: unitario,
      valorTotal,
      custoTotal: +(valorTotal * 0.65).toFixed(2), // margem ~35%
      margemReal: 35,
    }
    dados.aprovadoEm = diasNoPassado(Math.max(3, def.numero - 900))
    dados.precoUnitario = unitario
    dados.precoVenda = valorTotal
  }

  return dados
}

export { ORCAMENTOS_BASE }
export type { StatusOrcamento, DefOrcamentoGrafico, DadosOrcamentoGrafico }

/**
 * Cria (ou reutiliza) exatamente 5 orçamentos gráficos na Empresa_Demo:
 * 1 RASCUNHO, 1 ENVIADO e 3 APROVADO (Requirement 6.1, 6.2).
 *
 * - **OrcamentoGrafico** — dedupe por `[empresaId, numero, versao]`. Payload
 *   montado por `buildOrcamentoGrafico` (medidas Json, `criadoPorId` =
 *   USUARIO_SEED_ID, `versao: 1`; quando APROVADO, preenche `resultadoCalculo`,
 *   `aprovadoEm`, `precoUnitario` e `precoVenda`).
 *
 * Utiliza `ctx.tipoEmbalagemIds[0]` como `tipoEmbalagemId` para todos os
 * orçamentos (FK obrigatória).
 *
 * Preenche `ctx.orcamentosAprovados` (ids dos 3 orçamentos APROVADO) para o
 * módulo de Pedidos de Venda vincular via `orcamentoOrigemId`.
 *
 * Cada orçamento conta no par `orcamentos` do resumo. Erros na criação de um
 * orçamento individual são não-fatais (logados, segue para o próximo).
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.4_
 */
export async function seedOrcamentosGraficos(ctx: Contexto): Promise<ContadorModulo> {
  const antesCriados = ctx.resumo.orcamentosCriados
  const antesPulados = ctx.resumo.orcamentosPulados

  // FK obrigatória — usa o primeiro tipo de embalagem criado/resolvido.
  const tipoEmbalagemId = ctx.tipoEmbalagemIds[0]
  if (!tipoEmbalagemId) {
    logErro('⚠️', 'Nenhum TipoEmbalagem disponível — módulo de orçamentos pulado.', new Error('tipoEmbalagemId ausente'))
    return { criados: 0, pulados: 0 }
  }

  for (const def of ORCAMENTOS_BASE) {
    try {
      const dados = buildOrcamentoGrafico(ctx.empresaId, tipoEmbalagemId, def)

      const orcamentoId = await resolverContando(
        prisma.orcamentoGrafico,
        ctx.resumo,
        'orcamentos',
        { empresaId: ctx.empresaId, numero: def.numero, versao: 1 },
        () => ({
          empresaId: dados.empresaId,
          numero: dados.numero,
          versao: dados.versao,
          tipoEmbalagemId: dados.tipoEmbalagemId,
          medidas: dados.medidas,
          quantidade: dados.quantidade,
          criadoPorId: dados.criadoPorId,
          status: dados.status,
          resultadoCalculo: dados.resultadoCalculo ?? undefined,
          aprovadoEm: dados.aprovadoEm ?? undefined,
          precoUnitario: dados.precoUnitario ?? undefined,
          precoVenda: dados.precoVenda ?? undefined,
        }),
      )

      // Acumula os APROVADO para vincular a pedidos de venda no módulo seguinte.
      if (def.status === 'APROVADO') {
        ctx.orcamentosAprovados.push(orcamentoId)
      }
    } catch (err) {
      logErro('⚠️', `Falha ao resolver orçamento gráfico #${def.numero}:`, err)
    }
  }

  const criados = ctx.resumo.orcamentosCriados - antesCriados
  const pulados = ctx.resumo.orcamentosPulados - antesPulados
  log('📋', `Orçamentos gráficos: criados: ${criados} | pulados: ${pulados}`)
  return { criados, pulados }
}

// ─── Módulo: ordens de produção — builders puros (tarefa 12.1) ────────────────────

/**
 * Estados da máquina de estados da OrdemProducao, na ordem canônica do caminho
 * "feliz" (do rascunho até a conclusão). Espelha `TRANSICOES_VALIDAS` de
 * `ordem-producao.service.ts`:
 *
 *   RASCUNHO → PLANEJADA → PROGRAMADA → LIBERADA → EM_PRODUCAO → CONCLUIDA
 *
 * O status alvo de uma OP da demo é sempre um elemento deste caminho, e a
 * sequência de logs gerada é o prefixo do caminho que termina nesse alvo.
 */
export const CAMINHO_STATUS_OP = [
  'RASCUNHO',
  'PLANEJADA',
  'PROGRAMADA',
  'LIBERADA',
  'EM_PRODUCAO',
  'CONCLUIDA',
] as const

/** Status válido de uma OrdemProducao (elemento do caminho da máquina de estados). */
export type StatusOp = (typeof CAMINHO_STATUS_OP)[number]

/** Prioridade válida de uma OrdemProducao (`Produto.prioridade` no schema). */
export type PrioridadeOp = 'BAIXA' | 'NORMAL' | 'ALTA' | 'URGENTE'

/**
 * Payload de criação de `OrdemProducao` produzido pelo builder. Contém todos os
 * campos obrigatórios do model sem default relevantes à demo: `empresaId`,
 * `numero`, `produtoId`, `clienteId`, `quantidade`, `unidadeMedida`, `status`,
 * `prioridade` e `dataEntregaPrevista`.
 *
 * `produtoId`/`clienteId` são opcionais no schema (`String?`), mas o design
 * exige preenchê-los na demo — por isso o builder os recebe como obrigatórios.
 */
export interface DadosOrdemProducao {
  empresaId: string
  numero: number
  produtoId: string
  clienteId: string
  quantidade: number
  unidadeMedida: string
  status: StatusOp
  prioridade: PrioridadeOp
  dataEntregaPrevista: Date
}

/**
 * Payload de criação de `EtapaOrdemProducao` produzido pelo builder. NÃO inclui
 * `empresaId` — o model não tem esse campo; a etapa herda o isolamento
 * multi-tenant via `ordemProducao.empresaId`. Campos: `sequencia`, `descricao`,
 * `centroProducaoId` (opcional no schema, sempre preenchido aqui), `status` e
 * `posicaoFila`.
 */
export interface DadosEtapaOp {
  sequencia: number
  descricao: string
  centroProducaoId: string
  status: string
  posicaoFila: number
}

/**
 * Payload de criação de `ItemOrdemProducao` produzido pelo builder. Inclui
 * `empresaId` (opcional no schema, mas preenchido por consistência com o
 * `empresaId` da OP). O campo de descrição do model é `descricaoProduto`.
 */
export interface DadosItemOp {
  descricaoProduto: string
  quantidade: number
  unidadeMedida: string
  tipoMaterial: string
  empresaId: string
}

/**
 * Payload de criação de `ApontamentoEtapa` produzido pelo builder. `empresaId`
 * é OBRIGATÓRIO no model e deve receber o mesmo `empresaId` da OP. `tipo` é
 * sempre `PRODUCAO` na demo (contagem de produção boa).
 */
export interface DadosApontamentoOp {
  empresaId: string
  tipo: string
  quantidadeProduzida: number
}

/**
 * Payload de criação de `LogOrdemProducao` produzido pelo builder de caminho.
 * Cada log é uma transição `statusAnterior → statusNovo` com `usuarioId`
 * (`USUARIO_SEED_ID`).
 */
export interface DadosLogOp {
  statusAnterior: string
  statusNovo: string
  usuarioId: string
}

/**
 * Builder PURO da `OrdemProducao` (sem I/O) — a partir do `empresaId` e de uma
 * definição, produz o payload de criação com todos os campos exigidos pelo
 * design/Requirement 8.3: `empresaId`, `numero`, `produtoId`, `clienteId`,
 * `quantidade`, `unidadeMedida`, `status`, `prioridade` e `dataEntregaPrevista`.
 *
 * A OP é criada diretamente no status alvo (é seed — não passa pela validação
 * de transição das rotas). `unidadeMedida` default `UN` (embalagens contadas por
 * unidade) e `prioridade` default `NORMAL`, ambos sobrescrevíveis pela definição.
 *
 * Separado da função de efeito para permitir testar o contrato de campos
 * (Property 4) e a estrutura da OP (Property 8) sem tocar no banco.
 *
 * _Requirements: 8.3_
 */
export function buildOrdemProducao(
  empresaId: string,
  def: {
    numero: number
    produtoId: string
    clienteId: string
    quantidade: number
    status: StatusOp
    unidadeMedida?: string
    prioridade?: PrioridadeOp
    dataEntregaPrevista?: Date
  },
): DadosOrdemProducao {
  return {
    empresaId,
    numero: def.numero,
    produtoId: def.produtoId,
    clienteId: def.clienteId,
    quantidade: def.quantidade,
    unidadeMedida: def.unidadeMedida ?? 'UN',
    status: def.status,
    prioridade: def.prioridade ?? 'NORMAL',
    dataEntregaPrevista: def.dataEntregaPrevista ?? diasNoFuturo(15),
  }
}

/**
 * Roteiro-modelo mínimo de etapas de uma embalagem de papelão, na ordem
 * produtiva típica: corte → impressão → acabamento/colagem. Cada etapa aponta
 * para o tipo de centro (`cortadeira`/`impressao`/`acabamento`) resolvido em
 * `ctx.centros`. Usado por `buildEtapasOp` para gerar ≥2 etapas por OP,
 * distribuídas em centros diferentes (Requirement 8.4, 8.8).
 */
const ROTEIRO_ETAPAS_OP: { descricao: string; tipoCentro: keyof Contexto['centros'] }[] = [
  { descricao: 'Corte e vinco', tipoCentro: 'cortadeira' },
  { descricao: 'Impressão', tipoCentro: 'impressao' },
  { descricao: 'Acabamento e colagem', tipoCentro: 'acabamento' },
]

/**
 * Builder PURO das `EtapaOrdemProducao` de uma OP (sem I/O). Gera ≥2 etapas
 * distribuídas em centros de produção diferentes (Requirement 8.4, 8.8) a partir
 * do roteiro-modelo `ROTEIRO_ETAPAS_OP`, usando o mapa `centros`
 * (tipoCentro → centroProducaoId). Etapas cujo centro não está disponível em
 * `centros` são descartadas.
 *
 * As etapas recebem `sequencia`/`posicaoFila` sequenciais (1..N) e um `status`:
 * quando a OP está `EM_PRODUCAO`, a primeira etapa entra `EM_ANDAMENTO` (para
 * hospedar o apontamento de produção) e as demais `PENDENTE`; caso contrário
 * todas `PENDENTE`.
 *
 * NÃO inclui `empresaId` — o model `EtapaOrdemProducao` não tem esse campo
 * (herda o isolamento via `ordemProducao`).
 *
 * _Requirements: 8.4, 8.8_
 */
export function buildEtapasOp(
  centros: Contexto['centros'],
  statusOp: StatusOp,
): DadosEtapaOp[] {
  const etapas: DadosEtapaOp[] = []
  let seq = 1
  for (const modelo of ROTEIRO_ETAPAS_OP) {
    const centroProducaoId = centros[modelo.tipoCentro]
    if (!centroProducaoId) continue
    // Na OP em produção a 1ª etapa está em andamento (hospeda o apontamento).
    const status = statusOp === 'EM_PRODUCAO' && seq === 1 ? 'EM_ANDAMENTO' : 'PENDENTE'
    etapas.push({
      sequencia: seq,
      descricao: modelo.descricao,
      centroProducaoId,
      status,
      posicaoFila: seq,
    })
    seq++
  }
  return etapas
}

/**
 * Builder PURO dos `ItemOrdemProducao` de uma OP (sem I/O). Gera ≥1 item de
 * material (Requirement 8.5) com `empresaId` herdado da OP. Usa a descrição do
 * produto acabado como base e adiciona o papel/matéria-prima principal, de forma
 * que a OP tenha ao menos um item de material.
 *
 * Campos por item: `descricaoProduto` (nome do model — não é `descricao`),
 * `quantidade`, `unidadeMedida`, `tipoMaterial` (PAPEL) e `empresaId`.
 *
 * _Requirements: 8.5_
 */
export function buildItensOp(
  empresaId: string,
  def: { descricaoProduto: string; quantidade: number; unidadeMedida?: string },
): DadosItemOp[] {
  return [
    {
      descricaoProduto: `Papel/cartão para ${def.descricaoProduto}`,
      quantidade: def.quantidade,
      unidadeMedida: def.unidadeMedida ?? 'KG',
      tipoMaterial: 'PAPEL',
      empresaId,
    },
  ]
}

/**
 * Builder PURO dos `ApontamentoEtapa` de uma OP (sem I/O). Gera apontamentos de
 * produção APENAS quando a OP está `EM_PRODUCAO` — nesse caso, ≥1 apontamento
 * tipo `PRODUCAO` (Requirement 8.6). Para os demais status, retorna lista vazia.
 *
 * `empresaId` é OBRIGATÓRIO no model `ApontamentoEtapa` e recebe o mesmo
 * `empresaId` da OP. A quantidade apontada é uma fração (~30%) da quantidade da
 * OP, simulando produção parcial em andamento.
 *
 * _Requirements: 8.6_
 */
export function buildApontamentosOp(
  empresaId: string,
  statusOp: StatusOp,
  quantidadeOp: number,
): DadosApontamentoOp[] {
  if (statusOp !== 'EM_PRODUCAO') return []
  return [
    {
      empresaId,
      tipo: 'PRODUCAO',
      quantidadeProduzida: +(quantidadeOp * 0.3).toFixed(4),
    },
  ]
}

/**
 * Monta o caminho de status da máquina de estados da OP, do início (`RASCUNHO`)
 * até o `statusAlvo` (inclusive). É o PREFIXO do caminho canônico
 * `CAMINHO_STATUS_OP` que termina no alvo — ex.: alvo `LIBERADA` produz
 * `['RASCUNHO', 'PLANEJADA', 'PROGRAMADA', 'LIBERADA']`.
 *
 * Função PURA — base para gerar a sequência de `LogOrdemProducao` (Property 8:
 * logs = prefixo válido do caminho terminando no alvo).
 */
export function caminhoStatusAte(statusAlvo: StatusOp): StatusOp[] {
  const idx = CAMINHO_STATUS_OP.indexOf(statusAlvo)
  if (idx < 0) return []
  return CAMINHO_STATUS_OP.slice(0, idx + 1)
}

/**
 * Builder PURO dos `LogOrdemProducao` de uma OP (sem I/O). Gera a sequência de
 * transições de status da máquina de estados, do estado inicial até o
 * `statusAlvo`: para o caminho `[RASCUNHO, PLANEJADA, PROGRAMADA]`, produz os
 * logs `RASCUNHO→PLANEJADA` e `PLANEJADA→PROGRAMADA`.
 *
 * Ou seja, gera `N-1` logs para um caminho de `N` estados — cada log é uma
 * transição consecutiva, com `usuarioId = USUARIO_SEED_ID`. Quando o alvo é o
 * próprio `RASCUNHO` (nenhuma transição), retorna lista vazia; para qualquer
 * status ≥ `PLANEJADA` há ao menos 1 log (satisfazendo, junto com o apontamento,
 * o Requirement 8.6 quando `EM_PRODUCAO`).
 *
 * _Requirements: 8.6, 8.8_
 */
export function buildLogsOp(statusAlvo: StatusOp): DadosLogOp[] {
  const caminho = caminhoStatusAte(statusAlvo)
  const logs: DadosLogOp[] = []
  for (let i = 1; i < caminho.length; i++) {
    logs.push({
      statusAnterior: caminho[i - 1],
      statusNovo: caminho[i],
      usuarioId: USUARIO_SEED_ID,
    })
  }
  return logs
}

export { ROTEIRO_ETAPAS_OP }

// ─── Módulo: solicitações do portal representante ──────────────────────────────────

/** Definição de uma solicitação de orçamento do representante a criar na demo. */
interface DefSolicitacaoRep {
  tipoEmbalagem: string
  quantidade: number
  clienteNome: string
  clienteCpfCnpj: string
  medidaLargura: number
  medidaAltura: number
  medidaComprimento: number
  acabamentos: string
  observacoes?: string
}

/** Payload de criação de `SolicitacaoOrcamentoRep` (campos do model). */
interface DadosSolicitacaoRep {
  empresaId: string
  representanteId: string
  vendedorId: string
  tipoEmbalagem: string
  quantidade: number
  status: string
  clienteNome?: string
  clienteCpfCnpj?: string
  medidaLargura?: number
  medidaAltura?: number
  medidaComprimento?: number
  acabamentos?: string
  observacoes?: string
}

/**
 * Dados realistas de solicitações de orçamento — simulam pedidos de cotação
 * enviados por representantes de uma indústria gráfica de embalagens de papelão.
 */
const SOLICITACOES_BASE: DefSolicitacaoRep[] = [
  {
    tipoEmbalagem: 'Caixa micro-ondulado para cosméticos',
    quantidade: 5000,
    clienteNome: 'Natura Cosméticos S.A.',
    clienteCpfCnpj: '71.673.990/0001-77',
    medidaLargura: 120,
    medidaAltura: 180,
    medidaComprimento: 80,
    acabamentos: 'Impressão offset 4x0, laminação fosca, hot stamping ouro na logo',
    observacoes: 'Cliente precisa de prova de cor antes da produção. Entrega em 15 dias.',
  },
  {
    tipoEmbalagem: 'Cartucho para sachês de café',
    quantidade: 20000,
    clienteNome: 'Torrefação Vale do Café Ltda',
    clienteCpfCnpj: '33.456.789/0001-22',
    medidaLargura: 200,
    medidaAltura: 280,
    medidaComprimento: 60,
    acabamentos: 'Impressão flexo 6 cores, verniz UV localizado, janela acetato',
    observacoes: 'Referência: display similar ao da Café 3 Corações. Tiragem mensal recorrente.',
  },
  {
    tipoEmbalagem: 'Display de chão para bebidas',
    quantidade: 500,
    clienteNome: 'Distribuidora Atlântica Bebidas',
    clienteCpfCnpj: '12.987.654/0001-88',
    medidaLargura: 400,
    medidaAltura: 1600,
    medidaComprimento: 350,
    acabamentos: 'Impressão digital, faca especial, montagem colada com reforço interno',
    observacoes: 'Ação promocional de verão. Precisa de mockup 3D para aprovação.',
  },
]

/**
 * Builder PURO da `SolicitacaoOrcamentoRep` (sem I/O de banco) — a partir do
 * `empresaId`, `representanteId`, `vendedorId` e de uma definição descritiva,
 * produz o payload de criação com todos os campos obrigatórios do model
 * (`empresaId`, `representanteId`, `vendedorId`, `tipoEmbalagem`, `quantidade`)
 * e `status: 'PENDENTE'`. Campos descritivos opcionais (`clienteNome`,
 * `clienteCpfCnpj`, medidas, `acabamentos`, `observacoes`) são preenchidos
 * quando disponíveis na definição.
 *
 * Separado da função de efeito para permitir testar o contrato de campos
 * obrigatórios (Property 4) sem tocar no banco.
 *
 * _Requirements: 9.1, 9.2, 9.3, 9.4_
 */
export function buildSolicitacaoOrcamentoRep(
  empresaId: string,
  representanteId: string,
  vendedorId: string,
  def: DefSolicitacaoRep,
): DadosSolicitacaoRep {
  return {
    empresaId,
    representanteId,
    vendedorId,
    tipoEmbalagem: def.tipoEmbalagem,
    quantidade: def.quantidade,
    status: 'PENDENTE',
    clienteNome: def.clienteNome,
    clienteCpfCnpj: def.clienteCpfCnpj,
    medidaLargura: def.medidaLargura,
    medidaAltura: def.medidaAltura,
    medidaComprimento: def.medidaComprimento,
    acabamentos: def.acabamentos,
    observacoes: def.observacoes,
  }
}

export { SOLICITACOES_BASE }
export type { DefSolicitacaoRep, DadosSolicitacaoRep }

/**
 * Cria (ou reutiliza) 2-3 solicitações de orçamento no Portal Representante,
 * vinculadas aos representantes criados no módulo 5 (`ctx.representantes`).
 *
 * **Idempotência**: `SolicitacaoOrcamentoRep` não possui `@@unique` natural no
 * schema. A dedupe é feita via `findFirst` pelo critério estável
 * `[empresaId, representanteId, tipoEmbalagem]` — cada representante só recebe
 * uma solicitação de cada tipo de embalagem, evitando duplicação em reexecuções.
 *
 * Distribuição: as solicitações são distribuídas ciclicamente entre os
 * representantes disponíveis em `ctx.representantes` (round-robin).
 *
 * Cada resolução conta no par `solicitacoes` do resumo. Erros na criação de uma
 * solicitação individual são não-fatais (logados, segue para a próxima).
 *
 * _Requirements: 9.1, 9.2, 9.3, 9.4_
 */
export async function seedSolicitacoesPortal(ctx: Contexto): Promise<ContadorModulo> {
  const antesCriados = ctx.resumo.solicitacoesCriados
  const antesPulados = ctx.resumo.solicitacoesPulados

  if (ctx.representantes.length === 0) {
    log('⚠️', 'Nenhum representante disponível — pulando solicitações do portal.')
    return { criados: 0, pulados: 0 }
  }

  for (let i = 0; i < SOLICITACOES_BASE.length; i++) {
    const def = SOLICITACOES_BASE[i]
    const rep = ctx.representantes[i % ctx.representantes.length]

    try {
      // Dedupe por [empresaId, representanteId, tipoEmbalagem] via findFirst.
      const existente = await prisma.solicitacaoOrcamentoRep.findFirst({
        where: {
          empresaId: ctx.empresaId,
          representanteId: rep.id,
          tipoEmbalagem: def.tipoEmbalagem,
        },
        select: { id: true },
      })

      if (existente) {
        contabilizar(ctx.resumo, 'solicitacoes', false)
      } else {
        const dados = buildSolicitacaoOrcamentoRep(ctx.empresaId, rep.id, rep.vendedorId, def)
        await prisma.solicitacaoOrcamentoRep.create({ data: dados })
        contabilizar(ctx.resumo, 'solicitacoes', true)
      }
    } catch (err) {
      logErro('⚠️', `Falha ao resolver solicitação "${def.tipoEmbalagem}" para ${rep.email}:`, err)
    }
  }

  const criados = ctx.resumo.solicitacoesCriados - antesCriados
  const pulados = ctx.resumo.solicitacoesPulados - antesPulados
  log('📋', `Solicitações portal representante: criados: ${criados} | pulados: ${pulados}`)
  return { criados, pulados }
}

// ─── Módulo: pedidos de venda ─────────────────────────────────────────────────────

/**
 * Tipo de origem de um pedido de venda. `ORCAMENTO_GRAFICO` implica
 * `orcamentoOrigemId` preenchido; `MANUAL` implica ausência desse vínculo.
 * Coerência entre origem e vínculo validada pela Property 7.
 */
type OrigemPedido = 'ORCAMENTO_GRAFICO' | 'MANUAL'

/**
 * Status possíveis de um PedidoVenda no schema (campo `status` VarChar(20),
 * default `RASCUNHO`). A distribuição alvo da demo: 1 RASCUNHO, 2 CONFIRMADO,
 * 1 EM_PRODUCAO, 1 FATURADO (Requirement 7.2).
 */
type StatusPedidoVenda = 'RASCUNHO' | 'CONFIRMADO' | 'EM_PRODUCAO' | 'FATURADO' | 'CANCELADO'

/**
 * Payload de criação de `PedidoVenda` produzido pelo builder. Contém todos os
 * campos obrigatórios: `empresaId`, `numero`, `clienteId`, `tabelaPrecoId`,
 * `status`, `origemPedido` e, quando originado de orçamento gráfico,
 * `orcamentoOrigemId`.
 */
export interface DadosPedidoVenda {
  empresaId: string
  numero: number
  clienteId: string
  tabelaPrecoId: string
  status: StatusPedidoVenda
  origemPedido: OrigemPedido
  orcamentoOrigemId?: string
}

/**
 * Payload de criação de `ItemPedidoVenda` produzido pelo builder. Contém os
 * campos exigidos pelo design: `produtoId`, `quantidade`, `precoBase`,
 * `precoFinal`, `valorTotal` (= quantidade * precoFinal) e `unidade`.
 */
export interface DadosItemPedidoVenda {
  produtoId: string
  quantidade: number
  precoBase: number
  precoFinal: number
  valorTotal: number
  unidade: string
}

/**
 * Builder PURO do `PedidoVenda` (sem I/O) — a partir do `empresaId` e de uma
 * definição, produz o payload de criação com todos os campos obrigatórios do
 * model: `empresaId`, `numero`, `clienteId`, `tabelaPrecoId`, `status` e
 * `origemPedido`. Quando `origemPedido === 'ORCAMENTO_GRAFICO'`, exige
 * `orcamentoOrigemId` (Property 7: vínculo preenchido sse origem é orçamento).
 *
 * Separado da função de efeito para permitir testar o contrato de campos
 * (Property 4) e a coerência origem↔vínculo (Property 7) sem tocar no banco.
 *
 * _Requirements: 7.1, 7.3, 7.4, 7.5, 7.7_
 */
export function buildPedidoVenda(def: {
  empresaId: string
  numero: number
  clienteId: string
  tabelaPrecoId: string
  status: StatusPedidoVenda
  origemPedido: OrigemPedido
  orcamentoOrigemId?: string
}): DadosPedidoVenda {
  const dados: DadosPedidoVenda = {
    empresaId: def.empresaId,
    numero: def.numero,
    clienteId: def.clienteId,
    tabelaPrecoId: def.tabelaPrecoId,
    status: def.status,
    origemPedido: def.origemPedido,
  }
  if (def.origemPedido === 'ORCAMENTO_GRAFICO' && def.orcamentoOrigemId) {
    dados.orcamentoOrigemId = def.orcamentoOrigemId
  }
  return dados
}

/**
 * Builder PURO do `ItemPedidoVenda` (sem I/O) — a partir de uma definição,
 * produz o payload com os campos exigidos pelo design: `produtoId`, `quantidade`,
 * `precoBase`, `precoFinal`, `valorTotal` (calculado como `quantidade *
 * precoFinal`) e `unidade`.
 *
 * A invariante `valorTotal === quantidade * precoFinal` é garantida pela
 * construção (Property 7) — o campo `valorTotal` é sempre derivado, nunca
 * informado manualmente.
 *
 * Separado da função de efeito para permitir testar o contrato de campos
 * (Property 4) e a Property 7 sem tocar no banco.
 *
 * _Requirements: 7.4_
 */
export function buildItemPedidoVenda(def: {
  produtoId: string
  quantidade: number
  precoBase: number
  precoFinal: number
  unidade?: string
}): DadosItemPedidoVenda {
  return {
    produtoId: def.produtoId,
    quantidade: def.quantidade,
    precoBase: def.precoBase,
    precoFinal: def.precoFinal,
    valorTotal: +(def.quantidade * def.precoFinal).toFixed(2),
    unidade: def.unidade ?? 'UN',
  }
}

export type { OrigemPedido, StatusPedidoVenda }

/**
 * Definição de um pedido de venda a criar na demo, incluindo a definição de seus
 * itens. Centraliza todos os dados necessários para que `seedPedidosVenda` monte
 * o pedido e seus itens de forma determinística e idempotente.
 */
interface DefPedidoVenda {
  numero: number
  status: StatusPedidoVenda
  origemPedido: OrigemPedido
  /** Índice no array ctx.orcamentosAprovados (só quando origemPedido === 'ORCAMENTO_GRAFICO'). */
  orcamentoAprovadoIdx?: number
}

/**
 * Os 5 pedidos de venda da demo — distribuição exata: 1 RASCUNHO, 2 CONFIRMADO,
 * 1 EM_PRODUCAO, 1 FATURADO (Requirement 7.2). Os 2 CONFIRMADO usam
 * `origemPedido: 'ORCAMENTO_GRAFICO'` vinculados aos 2 primeiros IDs de
 * `ctx.orcamentosAprovados`; os demais usam `origemPedido: 'MANUAL'`.
 * Numeração sequencial 801-805 para evitar conflito com dados reais.
 */
const PEDIDOS_BASE: DefPedidoVenda[] = [
  { numero: 801, status: 'RASCUNHO', origemPedido: 'MANUAL' },
  { numero: 802, status: 'CONFIRMADO', origemPedido: 'ORCAMENTO_GRAFICO', orcamentoAprovadoIdx: 0 },
  { numero: 803, status: 'CONFIRMADO', origemPedido: 'ORCAMENTO_GRAFICO', orcamentoAprovadoIdx: 1 },
  { numero: 804, status: 'EM_PRODUCAO', origemPedido: 'MANUAL' },
  { numero: 805, status: 'FATURADO', origemPedido: 'MANUAL' },
]

/**
 * Cria (ou reutiliza) entre 3 e 5 pedidos de venda na Empresa_Demo:
 * 1 RASCUNHO, 2 CONFIRMADO (vinculados a orçamentos APROVADO via
 * `orcamentoOrigemId`), 1 EM_PRODUCAO e 1 FATURADO (Requirement 7.2).
 *
 * - **PedidoVenda** — dedupe por `[empresaId, numero]`. Payload montado por
 *   `buildPedidoVenda`.
 * - **ItemPedidoVenda** — criado SOMENTE quando o pedido pai é criado nesta
 *   execução (não quando é pulado/existente), evitando duplicação (entidades
 *   filhas não têm chave de dedupe natural). Payload montado por
 *   `buildItemPedidoVenda`.
 *
 * Usa `ctx.clientes` (Map nome → clienteId), `ctx.produtos` (Map codigo → dados),
 * `ctx.tabelaPrecoId`, `ctx.orcamentosAprovados` (ids de orçamentos APROVADO).
 *
 * Cada pedido conta no par `pedidos` do resumo. Erros na criação de um pedido
 * individual são não-fatais (logados, segue para o próximo).
 *
 * _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.7_
 */
export async function seedPedidosVenda(ctx: Contexto): Promise<ContadorModulo> {
  const antesCriados = ctx.resumo.pedidosCriados
  const antesPulados = ctx.resumo.pedidosPulados

  // Preparar arrays de clientes e produtos disponíveis para distribuir entre pedidos.
  const clienteIds = Array.from(ctx.clientes.values())
  const produtosArr = Array.from(ctx.produtos.entries()) // [codigo, { id, nome, preco }]

  if (clienteIds.length === 0 || produtosArr.length === 0) {
    logErro('⚠️', 'Clientes ou produtos insuficientes — módulo de pedidos pulado.', new Error('dependências ausentes'))
    return { criados: 0, pulados: 0 }
  }

  for (let i = 0; i < PEDIDOS_BASE.length; i++) {
    const def = PEDIDOS_BASE[i]
    try {
      // Resolve orcamentoOrigemId quando a origem é ORCAMENTO_GRAFICO.
      let orcamentoOrigemId: string | undefined
      if (def.origemPedido === 'ORCAMENTO_GRAFICO' && def.orcamentoAprovadoIdx != null) {
        orcamentoOrigemId = ctx.orcamentosAprovados[def.orcamentoAprovadoIdx]
        if (!orcamentoOrigemId) {
          logErro('⚠️', `Orçamento aprovado idx=${def.orcamentoAprovadoIdx} indisponível para pedido #${def.numero}.`, new Error('orcamentoOrigemId ausente'))
          continue
        }
      }

      // Distribui clientes round-robin.
      const clienteId = clienteIds[i % clienteIds.length]

      const dadosPedido = buildPedidoVenda({
        empresaId: ctx.empresaId,
        numero: def.numero,
        clienteId,
        tabelaPrecoId: ctx.tabelaPrecoId,
        status: def.status,
        origemPedido: def.origemPedido,
        orcamentoOrigemId,
      })

      // Localizar-ou-criar por [empresaId, numero].
      const existente = await prisma.pedidoVenda.findFirst({
        where: { empresaId: ctx.empresaId, numero: def.numero },
        select: { id: true },
      })

      if (existente) {
        contabilizar(ctx.resumo, 'pedidos', false)
        continue
      }

      // Criar pedido.
      const pedido = await prisma.pedidoVenda.create({
        data: {
          empresaId: dadosPedido.empresaId,
          numero: dadosPedido.numero,
          clienteId: dadosPedido.clienteId,
          tabelaPrecoId: dadosPedido.tabelaPrecoId,
          status: dadosPedido.status,
          origemPedido: dadosPedido.origemPedido,
          orcamentoOrigemId: dadosPedido.orcamentoOrigemId,
        },
      })
      contabilizar(ctx.resumo, 'pedidos', true)

      // Criar itens SOMENTE quando o pai é criado (evita duplicação em reexecuções).
      // Usa 1-2 produtos diversos do ctx.produtos, com preço derivado via precoAleatorio.
      const numItens = Math.min(2, produtosArr.length)
      for (let j = 0; j < numItens; j++) {
        const [codigo, prodInfo] = produtosArr[(i * 2 + j) % produtosArr.length]
        const quantidade = (j + 1) * 500 // 500, 1000
        const preco = precoAleatorio(`ped-${def.numero}-${codigo}`, 2.0, 12.0)

        const itemDados = buildItemPedidoVenda({
          produtoId: prodInfo.id,
          quantidade,
          precoBase: preco,
          precoFinal: preco, // sem desconto na demo
        })

        await prisma.itemPedidoVenda.create({
          data: {
            pedidoVendaId: pedido.id,
            produtoId: itemDados.produtoId,
            quantidade: itemDados.quantidade,
            precoBase: itemDados.precoBase,
            precoFinal: itemDados.precoFinal,
            valorTotal: itemDados.valorTotal,
            unidade: itemDados.unidade,
          },
        })
      }
    } catch (err) {
      logErro('⚠️', `Falha ao resolver pedido de venda #${def.numero}:`, err)
    }
  }

  const criados = ctx.resumo.pedidosCriados - antesCriados
  const pulados = ctx.resumo.pedidosPulados - antesPulados
  log('🛒', `Pedidos de venda: criados: ${criados} | pulados: ${pulados}`)
  return { criados, pulados }
}

// ─── Módulo: ordens de produção — efeito Prisma (tarefa 12.3) ─────────────────────

/**
 * Definição de uma OP a criar na demo. Combina os dados necessários para o
 * builder da OP com informações para localizar produto/cliente no contexto.
 */
interface DefOrdemProducaoSeed {
  numero: number
  status: StatusOp
  prioridade: PrioridadeOp
  quantidade: number
  /** Código do produto em `ctx.produtos`. */
  produtoCodigo: string
  /** Nome do cliente em `ctx.clientes`. */
  clienteNome: string
  dataEntregaPrevista: Date
}

/**
 * As 4 OPs da demo — distribuição: 1 PLANEJADA, 1 PROGRAMADA, 1 LIBERADA,
 * 1 EM_PRODUCAO (Requirements 8.1, 8.2). Numeração 701-704 para evitar conflito
 * com dados reais (OPs manuais usam números baixos, importações PDF usam
 * números altos ~2000+). Ao menos 1 OP terá etapas em centros diferentes (todas
 * terão, dado que `buildEtapasOp` distribui por cortadeira/impressão/acabamento).
 */
const OPS_BASE: DefOrdemProducaoSeed[] = [
  {
    numero: 701,
    status: 'PLANEJADA',
    prioridade: 'NORMAL',
    quantidade: 5000,
    produtoCodigo: '4758',
    clienteNome: 'Acimpel Embalagens',
    dataEntregaPrevista: diasNoFuturo(20),
  },
  {
    numero: 702,
    status: 'PROGRAMADA',
    prioridade: 'ALTA',
    quantidade: 10000,
    produtoCodigo: '3021',
    clienteNome: 'BELGO BEKAERT ARAMES LTDA.',
    dataEntregaPrevista: diasNoFuturo(15),
  },
  {
    numero: 703,
    status: 'LIBERADA',
    prioridade: 'NORMAL',
    quantidade: 8000,
    produtoCodigo: '1051976',
    clienteNome: 'SOL & NEVE',
    dataEntregaPrevista: diasNoFuturo(10),
  },
  {
    numero: 704,
    status: 'EM_PRODUCAO',
    prioridade: 'URGENTE',
    quantidade: 15000,
    produtoCodigo: '4707',
    clienteNome: 'CERVEJARIA CIDADE IMPERIAL PETROPOLIS',
    dataEntregaPrevista: diasNoFuturo(7),
  },
]

/**
 * Cria (ou reutiliza) entre 3 e 5 ordens de produção na Empresa_Demo, cada uma
 * com etapas em centros diferentes, itens de material, logs de transição e
 * (quando EM_PRODUCAO) apontamentos de produção.
 *
 * **Idempotência**: dedupe por `[empresaId, numero]` via `findFirst`. Entidades
 * filhas (etapas, itens, apontamentos, logs) são criadas SOMENTE quando a OP pai
 * é criada nesta execução — se a OP já existia, é pulada integralmente (filhas
 * já foram criadas na execução anterior).
 *
 * **Contadores**: usa `opsCriadas`/`opsPuladas` (não passa por `resolverContando`
 * pois o par 'ops' não existe em `ParContador`). Sub-contadores:
 * `etapasCriadas`, `itensOpCriados`, `apontamentosCriados`, `logsCriados`.
 *
 * **Distribuição**: ≥1 PLANEJADA, ≥1 PROGRAMADA, demais LIBERADA/EM_PRODUCAO
 * (Requirement 8.2). Todas as OPs têm etapas distribuídas em centros diferentes
 * (cortadeira/impressão/acabamento) satisfazendo Requirement 8.8.
 *
 * _Requirements: 8.1, 8.2, 8.7_
 */
export async function seedOrdensProducao(ctx: Contexto): Promise<ContadorModulo> {
  const antesCriadas = ctx.resumo.opsCriadas
  const antesPuladas = ctx.resumo.opsPuladas

  // Fallbacks: se produto/cliente não estiver no contexto, usa o primeiro disponível.
  const primeiroProduto = ctx.produtos.values().next().value as { id: string; nome: string; preco: number } | undefined
  const primeiroClienteId = ctx.clientes.values().next().value as string | undefined

  if (!primeiroProduto || !primeiroClienteId) {
    logErro('⚠️', 'Produtos ou clientes insuficientes — módulo de OPs pulado.', new Error('dependências ausentes'))
    return { criados: 0, pulados: 0 }
  }

  for (const def of OPS_BASE) {
    try {
      // Resolver produtoId e clienteId a partir do contexto.
      const produtoInfo = ctx.produtos.get(def.produtoCodigo) ?? primeiroProduto
      const clienteId = ctx.clientes.get(def.clienteNome) ?? primeiroClienteId

      // 1) Localizar-ou-criar por [empresaId, numero] (upsert manual).
      const existente = await prisma.ordemProducao.findFirst({
        where: { empresaId: ctx.empresaId, numero: def.numero },
        select: { id: true },
      })

      if (existente) {
        ctx.resumo.opsPuladas++
        continue
      }

      // 2) Construir dados da OP via builder puro.
      const dadosOp = buildOrdemProducao(ctx.empresaId, {
        numero: def.numero,
        produtoId: produtoInfo.id,
        clienteId,
        quantidade: def.quantidade,
        status: def.status,
        prioridade: def.prioridade,
        dataEntregaPrevista: def.dataEntregaPrevista,
      })

      // 3) Criar a OP.
      const op = await prisma.ordemProducao.create({
        data: {
          empresaId: dadosOp.empresaId,
          numero: dadosOp.numero,
          produtoId: dadosOp.produtoId,
          clienteId: dadosOp.clienteId,
          quantidade: dadosOp.quantidade,
          unidadeMedida: dadosOp.unidadeMedida,
          status: dadosOp.status,
          prioridade: dadosOp.prioridade,
          dataEntregaPrevista: dadosOp.dataEntregaPrevista,
          origemImportacao: 'MANUAL',
        },
      })
      ctx.resumo.opsCriadas++

      // 4) Criar etapas (≥2, em centros diferentes — Requirement 8.4, 8.8).
      const etapas = buildEtapasOp(ctx.centros, def.status)
      let primeiraEtapaId: string | undefined
      for (const etapa of etapas) {
        const etapaCriada = await prisma.etapaOrdemProducao.create({
          data: {
            ordemProducaoId: op.id,
            sequencia: etapa.sequencia,
            descricao: etapa.descricao,
            centroProducaoId: etapa.centroProducaoId,
            status: etapa.status,
            posicaoFila: etapa.posicaoFila,
          },
        })
        if (!primeiraEtapaId) primeiraEtapaId = etapaCriada.id
        ctx.resumo.etapasCriadas++
      }

      // 5) Criar itens de material (≥1 — Requirement 8.5).
      const itens = buildItensOp(ctx.empresaId, {
        descricaoProduto: produtoInfo.nome,
        quantidade: def.quantidade,
      })
      for (const item of itens) {
        await prisma.itemOrdemProducao.create({
          data: {
            ordemProducaoId: op.id,
            descricaoProduto: item.descricaoProduto,
            quantidade: item.quantidade,
            unidadeMedida: item.unidadeMedida,
            tipoMaterial: item.tipoMaterial,
            empresaId: item.empresaId,
          },
        })
        ctx.resumo.itensOpCriados++
      }

      // 6) Criar logs de transição (caminho da máquina de estados — Property 8).
      const logs = buildLogsOp(def.status)
      for (const logEntry of logs) {
        await prisma.logOrdemProducao.create({
          data: {
            ordemProducaoId: op.id,
            statusAnterior: logEntry.statusAnterior,
            statusNovo: logEntry.statusNovo,
            usuarioId: logEntry.usuarioId,
          },
        })
        ctx.resumo.logsCriados++
      }

      // 7) Criar apontamentos (somente EM_PRODUCAO — Requirement 8.6).
      const apontamentos = buildApontamentosOp(ctx.empresaId, def.status, def.quantidade)
      if (apontamentos.length > 0 && primeiraEtapaId) {
        for (const apto of apontamentos) {
          await prisma.apontamentoEtapa.create({
            data: {
              etapaOrdemProducaoId: primeiraEtapaId,
              empresaId: apto.empresaId,
              tipo: apto.tipo,
              quantidadeProduzida: apto.quantidadeProduzida,
            },
          })
          ctx.resumo.apontamentosCriados++
        }
      }
    } catch (err) {
      logErro('⚠️', `Falha ao resolver OP #${def.numero}:`, err)
    }
  }

  const criadas = ctx.resumo.opsCriadas - antesCriadas
  const puladas = ctx.resumo.opsPuladas - antesPuladas
  log('🏭', `Ordens de produção: criadas: ${criadas} | puladas: ${puladas}`)
  if (criadas > 0) {
    log(
      '  ',
      `  ↳ etapas: ${ctx.resumo.etapasCriadas} | itens: ${ctx.resumo.itensOpCriados} | logs: ${ctx.resumo.logsCriados} | apontamentos: ${ctx.resumo.apontamentosCriados}`,
    )
  }
  return { criados: criadas, pulados: puladas }
}

// ─── Módulo: matéria-prima (produtos de classificação MP/INSUMO) ─────────────────

/**
 * Definição mínima de um produto de matéria-prima/insumo da demo.
 */
interface DefMateriaPrima {
  codigo: string
  nome: string
  classificacaoPcp: 'MATERIA_PRIMA' | 'INSUMO'
  tipoFisico: string
  unidade: string
}

/**
 * Matérias-primas e insumos realistas de uma indústria gráfica de embalagens:
 * papéis, tintas offset CMYK, verniz UV e cola PVA.
 */
const MATERIAS_PRIMAS_BASE: DefMateriaPrima[] = [
  { codigo: 'MP-001', nome: 'Stora Enzo 181g 700x960', classificacaoPcp: 'MATERIA_PRIMA', tipoFisico: 'PESO', unidade: 'KG' },
  { codigo: 'MP-002', nome: 'Duplex 250g 660x960', classificacaoPcp: 'MATERIA_PRIMA', tipoFisico: 'PESO', unidade: 'KG' },
  { codigo: 'MP-003', nome: 'Triplex 350g 760x1040', classificacaoPcp: 'MATERIA_PRIMA', tipoFisico: 'PESO', unidade: 'KG' },
  { codigo: 'MP-004', nome: 'Tinta Offset Ciano CMYK', classificacaoPcp: 'INSUMO', tipoFisico: 'PESO', unidade: 'KG' },
  { codigo: 'MP-005', nome: 'Tinta Offset Magenta CMYK', classificacaoPcp: 'INSUMO', tipoFisico: 'PESO', unidade: 'KG' },
  { codigo: 'MP-006', nome: 'Tinta Offset Amarelo CMYK', classificacaoPcp: 'INSUMO', tipoFisico: 'PESO', unidade: 'KG' },
  { codigo: 'MP-007', nome: 'Tinta Offset Preto CMYK', classificacaoPcp: 'INSUMO', tipoFisico: 'PESO', unidade: 'KG' },
  { codigo: 'MP-008', nome: 'Verniz UV Brilho', classificacaoPcp: 'INSUMO', tipoFisico: 'PESO', unidade: 'KG' },
  { codigo: 'MP-009', nome: 'Cola PVA Branca', classificacaoPcp: 'INSUMO', tipoFisico: 'PESO', unidade: 'KG' },
]

/**
 * Builder PURO de produto de matéria-prima/insumo (sem I/O).
 */
export function buildMateriaPrima(empresaId: string, def: DefMateriaPrima) {
  return {
    empresaId,
    codigo: def.codigo,
    nome: def.nome,
    unidade: def.unidade,
    precoBase: precoAleatorio(def.codigo, 5, 80),
    classificacaoPcp: def.classificacaoPcp,
    tipoFisico: def.tipoFisico,
    status: true,
  }
}

export { MATERIAS_PRIMAS_BASE }
export type { DefMateriaPrima }

/**
 * Cria (ou reutiliza) produtos de matéria-prima e insumos na Empresa_Demo.
 * Usa o par de contadores `produtos` do Resumo (matérias-primas são produtos)
 * e dedupe por `[empresaId, codigo]`.
 *
 * Preenche `ctx.materiaPrimaIds` com os ids/codigos/nomes resolvidos para o
 * módulo de saldos de estoque consumir.
 */
export async function seedMateriaPrima(ctx: Contexto): Promise<ContadorModulo> {
  const antesCriados = ctx.resumo.materiaPrimaCriados
  const antesPulados = ctx.resumo.materiaPrimaPulados

  for (const def of MATERIAS_PRIMAS_BASE) {
    try {
      const { id, criado } = await localizarOuCriar(
        prisma.produto,
        { empresaId: ctx.empresaId, codigo: def.codigo },
        () => buildMateriaPrima(ctx.empresaId, def),
      )
      ctx.materiaPrimaIds.push({ id, codigo: def.codigo, nome: def.nome })

      // Contabiliza tanto no par 'produtos' (global) quanto no resumo de MP
      contabilizar(ctx.resumo, 'produtos', criado)
      if (criado) {
        ctx.resumo.materiaPrimaCriados++
      } else {
        ctx.resumo.materiaPrimaPulados++
      }
    } catch (err) {
      logErro('⚠️', `Falha ao resolver matéria-prima ${def.codigo} (${def.nome}):`, err)
    }
  }

  const criados = ctx.resumo.materiaPrimaCriados - antesCriados
  const pulados = ctx.resumo.materiaPrimaPulados - antesPulados
  log('🧪', `Matéria-prima/insumos: criados: ${criados} | pulados: ${pulados}`)
  return { criados, pulados }
}

// ─── Módulo: atualizar preços e classificação dos produtos ─────────────────────────

/**
 * Atualiza precoBase, classificacaoPcp e tipoFisico dos 10 produtos acabados e
 * das 9 matérias-primas para valores realistas de mercado. Roda DEPOIS de
 * seedMateriaPrima (todos os produtos já existem) e ANTES de seedEstruturasProduto.
 *
 * É um updateMany simples — não cria registros. Erros em produtos individuais são
 * não-fatais (logados e seguem adiante).
 */
export async function seedAtualizarPrecos(ctx: Contexto): Promise<void> {
  const PRECOS_PRODUTOS_ACABADOS: { codigo: string; precoBase: number; classificacaoPcp: string; tipoFisico: string }[] = [
    { codigo: '4758', precoBase: 8.50, classificacaoPcp: 'PRODUTO_ACABADO', tipoFisico: 'UNIDADE_PADRAO' },
    { codigo: '4575', precoBase: 9.20, classificacaoPcp: 'PRODUTO_ACABADO', tipoFisico: 'UNIDADE_PADRAO' },
    { codigo: '3021', precoBase: 0.45, classificacaoPcp: 'PRODUTO_ACABADO', tipoFisico: 'UNIDADE_PADRAO' },
    { codigo: '2709', precoBase: 3.80, classificacaoPcp: 'PRODUTO_ACABADO', tipoFisico: 'UNIDADE_PADRAO' },
    { codigo: '4528', precoBase: 2.90, classificacaoPcp: 'PRODUTO_ACABADO', tipoFisico: 'UNIDADE_PADRAO' },
    { codigo: '4041217', precoBase: 4.50, classificacaoPcp: 'PRODUTO_ACABADO', tipoFisico: 'UNIDADE_PADRAO' },
    { codigo: '1041607', precoBase: 0.35, classificacaoPcp: 'PRODUTO_ACABADO', tipoFisico: 'UNIDADE_PADRAO' },
    { codigo: '1041592', precoBase: 0.32, classificacaoPcp: 'PRODUTO_ACABADO', tipoFisico: 'UNIDADE_PADRAO' },
    { codigo: '4718', precoBase: 3.20, classificacaoPcp: 'PRODUTO_ACABADO', tipoFisico: 'UNIDADE_PADRAO' },
    { codigo: '1051976', precoBase: 5.60, classificacaoPcp: 'PRODUTO_ACABADO', tipoFisico: 'UNIDADE_PADRAO' },
  ]

  const PRECOS_MATERIAS_PRIMAS: { codigo: string; precoBase: number }[] = [
    { codigo: 'MP-001', precoBase: 4.80 },
    { codigo: 'MP-002', precoBase: 5.50 },
    { codigo: 'MP-003', precoBase: 7.20 },
    { codigo: 'MP-004', precoBase: 85.00 },
    { codigo: 'MP-005', precoBase: 92.00 },
    { codigo: 'MP-006', precoBase: 78.00 },
    { codigo: 'MP-007', precoBase: 65.00 },
    { codigo: 'MP-008', precoBase: 32.00 },
    { codigo: 'MP-009', precoBase: 12.50 },
  ]

  let totalAtualizado = 0

  // Produtos acabados: atualiza precoBase + classificacaoPcp + tipoFisico
  for (const def of PRECOS_PRODUTOS_ACABADOS) {
    try {
      const result = await prisma.produto.updateMany({
        where: { empresaId: ctx.empresaId, codigo: def.codigo },
        data: {
          precoBase: def.precoBase,
          classificacaoPcp: def.classificacaoPcp,
          tipoFisico: def.tipoFisico,
        },
      })
      totalAtualizado += result.count
    } catch (err) {
      logErro('⚠️', `Falha ao atualizar preço do produto ${def.codigo}:`, err)
    }
  }

  // Matérias-primas: atualiza apenas precoBase (classificacaoPcp/tipoFisico já estão corretos)
  for (const def of PRECOS_MATERIAS_PRIMAS) {
    try {
      const result = await prisma.produto.updateMany({
        where: { empresaId: ctx.empresaId, codigo: def.codigo },
        data: { precoBase: def.precoBase },
      })
      totalAtualizado += result.count
    } catch (err) {
      logErro('⚠️', `Falha ao atualizar preço da MP ${def.codigo}:`, err)
    }
  }

  log('💰', `Preços e classificação atualizados: ${totalAtualizado} produtos`)
}

// ─── Módulo: endereços de armazenagem WMS ─────────────────────────────────────────

/**
 * Definição mínima de um endereço de armazenagem da demo.
 */
interface DefEndereco {
  enderecoCompleto: string
  tipo: string
  areaArmazenagem: string
}

/**
 * Endereços de armazenagem realistas para a empresa demo:
 * 2 pulmões para matéria-prima, 1 picking para produto acabado, 1 expedição.
 */
const ENDERECOS_BASE: DefEndereco[] = [
  { enderecoCompleto: 'A-01-01-01', tipo: 'ARMAZENAGEM', areaArmazenagem: 'PULMAO' },
  { enderecoCompleto: 'A-01-02-01', tipo: 'ARMAZENAGEM', areaArmazenagem: 'PULMAO' },
  { enderecoCompleto: 'B-01-01-01', tipo: 'ARMAZENAGEM', areaArmazenagem: 'PICKING' },
  { enderecoCompleto: 'EXP-01', tipo: 'PICKING', areaArmazenagem: 'PICKING' },
]

/**
 * Builder PURO do `Endereco` de armazenagem (sem I/O).
 */
export function buildEndereco(empresaId: string, def: DefEndereco) {
  return {
    enderecoCompleto: def.enderecoCompleto,
    tipo: def.tipo,
    areaArmazenagem: def.areaArmazenagem,
    empresaId,
    status: true,
  }
}

export { ENDERECOS_BASE }
export type { DefEndereco }

/**
 * Cria (ou reutiliza) endereços de armazenagem na Empresa_Demo.
 * Dedupe por `[empresaId, enderecoCompleto]` via findFirst (sem @@unique formal).
 *
 * Preenche `ctx.enderecoIds` para o módulo de saldos consumir.
 */
export async function seedEnderecos(ctx: Contexto): Promise<ContadorModulo> {
  const antesCriados = ctx.resumo.enderecosCriados
  const antesPulados = ctx.resumo.enderecosPulados

  for (const def of ENDERECOS_BASE) {
    try {
      const existente = await prisma.endereco.findFirst({
        where: { empresaId: ctx.empresaId, enderecoCompleto: def.enderecoCompleto },
        select: { id: true },
      })

      if (existente) {
        ctx.enderecoIds.push({ id: existente.id, enderecoCompleto: def.enderecoCompleto })
        ctx.resumo.enderecosPulados++
      } else {
        const dados = buildEndereco(ctx.empresaId, def)
        const novo = await prisma.endereco.create({ data: dados })
        ctx.enderecoIds.push({ id: novo.id, enderecoCompleto: def.enderecoCompleto })
        ctx.resumo.enderecosCriados++
      }
    } catch (err) {
      logErro('⚠️', `Falha ao resolver endereço ${def.enderecoCompleto}:`, err)
    }
  }

  const criados = ctx.resumo.enderecosCriados - antesCriados
  const pulados = ctx.resumo.enderecosPulados - antesPulados
  log('📍', `Endereços armazenagem: criados: ${criados} | pulados: ${pulados}`)
  return { criados, pulados }
}

// ─── Módulo: saldo em estoque (SaldoEndereco) ─────────────────────────────────────

/**
 * Definição de um saldo a criar: referencia endereço por código e produto por
 * código, com quantidade e unidade.
 */
interface DefSaldoEstoque {
  enderecoCompleto: string
  produtoCodigo: string
  quantidade: number
}

/**
 * Saldos realistas de matéria-prima nos endereços de pulmão e de produtos
 * acabados no endereço de picking.
 */
const SALDOS_MATERIA_PRIMA: DefSaldoEstoque[] = [
  { enderecoCompleto: 'A-01-01-01', produtoCodigo: 'MP-001', quantidade: 2500 },
  { enderecoCompleto: 'A-01-01-01', produtoCodigo: 'MP-002', quantidade: 1800 },
  { enderecoCompleto: 'A-01-02-01', produtoCodigo: 'MP-003', quantidade: 900 },
  { enderecoCompleto: 'A-01-02-01', produtoCodigo: 'MP-004', quantidade: 50 },
  { enderecoCompleto: 'A-01-02-01', produtoCodigo: 'MP-005', quantidade: 45 },
  { enderecoCompleto: 'A-01-02-01', produtoCodigo: 'MP-006', quantidade: 55 },
  { enderecoCompleto: 'A-01-02-01', produtoCodigo: 'MP-007', quantidade: 70 },
  { enderecoCompleto: 'A-01-02-01', produtoCodigo: 'MP-008', quantidade: 120 },
  { enderecoCompleto: 'A-01-02-01', produtoCodigo: 'MP-009', quantidade: 80 },
]

export { SALDOS_MATERIA_PRIMA }
export type { DefSaldoEstoque }

/**
 * Cria saldos de estoque (SaldoEndereco) para matérias-primas nos endereços de
 * pulmão e para 2-3 produtos acabados no endereço de picking.
 *
 * Dedupe por `[enderecoId, produtoId, lote: null]` (chave @@unique do model)
 * via findFirst — se já existir, pula sem atualizar a quantidade (idempotência).
 */
export async function seedSaldoEstoque(ctx: Contexto): Promise<ContadorModulo> {
  const antesCriados = ctx.resumo.saldosCriados
  const antesPulados = ctx.resumo.saldosPulados

  // Helper: resolver enderecoId por enderecoCompleto
  const enderecoMap = new Map(ctx.enderecoIds.map(e => [e.enderecoCompleto, e.id]))

  // Helper: resolver produtoId por codigo (matérias-primas + produtos acabados)
  const produtoMpMap = new Map(ctx.materiaPrimaIds.map(mp => [mp.codigo, mp.id]))

  // 1) Saldos de matéria-prima
  for (const def of SALDOS_MATERIA_PRIMA) {
    try {
      const enderecoId = enderecoMap.get(def.enderecoCompleto)
      const produtoId = produtoMpMap.get(def.produtoCodigo)

      if (!enderecoId || !produtoId) {
        logErro(
          '⚠️',
          `Saldo ${def.produtoCodigo}@${def.enderecoCompleto} não criado: endereço ou produto ausente.`,
          new Error('FK ausente'),
        )
        continue
      }

      const existente = await prisma.saldoEndereco.findFirst({
        where: { enderecoId, produtoId, lote: null },
        select: { id: true },
      })

      if (existente) {
        ctx.resumo.saldosPulados++
      } else {
        await prisma.saldoEndereco.create({
          data: {
            enderecoId,
            produtoId,
            quantidade: def.quantidade,
            lote: null,
            empresaId: ctx.empresaId,
          },
        })
        ctx.resumo.saldosCriados++
      }
    } catch (err) {
      logErro('⚠️', `Falha ao criar saldo ${def.produtoCodigo}@${def.enderecoCompleto}:`, err)
    }
  }

  // 2) Saldos de produtos acabados (primeiros 3 do ctx.produtos) no endereço B-01-01-01
  const enderecoPickingId = enderecoMap.get('B-01-01-01')
  if (enderecoPickingId) {
    const produtosAcabados = Array.from(ctx.produtos.entries()).slice(0, 3)
    const quantidadesAcabados = [500, 1200, 300]

    for (let i = 0; i < produtosAcabados.length; i++) {
      const [, { id: produtoId }] = produtosAcabados[i]
      const quantidade = quantidadesAcabados[i]

      try {
        const existente = await prisma.saldoEndereco.findFirst({
          where: { enderecoId: enderecoPickingId, produtoId, lote: null },
          select: { id: true },
        })

        if (existente) {
          ctx.resumo.saldosPulados++
        } else {
          await prisma.saldoEndereco.create({
            data: {
              enderecoId: enderecoPickingId,
              produtoId,
              quantidade,
              lote: null,
              empresaId: ctx.empresaId,
            },
          })
          ctx.resumo.saldosCriados++
        }
      } catch (err) {
        logErro('⚠️', `Falha ao criar saldo produto acabado ${produtoId}@B-01-01-01:`, err)
      }
    }
  } else {
    log('⚠️', 'Endereço B-01-01-01 não disponível — pulando saldos de produto acabado.')
  }

  const criados = ctx.resumo.saldosCriados - antesCriados
  const pulados = ctx.resumo.saldosPulados - antesPulados
  log('📊', `Saldos estoque: criados: ${criados} | pulados: ${pulados}`)
  return { criados, pulados }
}

// ─── Módulo: estruturas de produto (BOM) ─────────────────────────────────────────

/**
 * Definição de um item de estrutura (componente de BOM) para o seed.
 */
interface DefItemEstrutura {
  mpCodigo: string
  quantidade: number
  unidadeMedida: string
  percentualPerda: number
  aproveitamento?: number
  coberturaPercent?: number
  tipoComponente: string
}

/**
 * Definição de uma BOM completa a ser criada para um produto acabado.
 */
interface DefEstruturaProduto {
  produtoCodigo: string
  versao: number
  descricao: string
  rendimento: number
  status: string
  itens: DefItemEstrutura[]
}

/**
 * BOMs dos 10 produtos acabados da demo — quantidades realistas de consumo
 * de matéria-prima por unidade produzida numa indústria gráfica de embalagens.
 */
const ESTRUTURAS_BASE: DefEstruturaProduto[] = [
  {
    produtoCodigo: '2709',
    versao: 1,
    descricao: 'BOM Caixa Papelão 5KG Eletrodo Serralheiro',
    rendimento: 1,
    status: 'ATIVA',
    itens: [
      { mpCodigo: 'MP-001', quantidade: 0.85, unidadeMedida: 'KG', percentualPerda: 5, aproveitamento: 4, tipoComponente: 'MATERIA_PRIMA' },
      { mpCodigo: 'MP-007', quantidade: 0.003, unidadeMedida: 'KG', percentualPerda: 10, coberturaPercent: 15, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-009', quantidade: 0.005, unidadeMedida: 'KG', percentualPerda: 3, tipoComponente: 'INSUMO' },
    ],
  },
  {
    produtoCodigo: '3570',
    versao: 1,
    descricao: 'BOM Cartucho Display 50 sachês 20g',
    rendimento: 1,
    status: 'ATIVA',
    itens: [
      { mpCodigo: 'MP-002', quantidade: 0.52, unidadeMedida: 'KG', percentualPerda: 8, aproveitamento: 6, tipoComponente: 'MATERIA_PRIMA' },
      { mpCodigo: 'MP-004', quantidade: 0.002, unidadeMedida: 'KG', percentualPerda: 12, coberturaPercent: 25, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-005', quantidade: 0.0015, unidadeMedida: 'KG', percentualPerda: 12, coberturaPercent: 18, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-006', quantidade: 0.002, unidadeMedida: 'KG', percentualPerda: 12, coberturaPercent: 20, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-007', quantidade: 0.001, unidadeMedida: 'KG', percentualPerda: 12, coberturaPercent: 10, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-008', quantidade: 0.008, unidadeMedida: 'KG', percentualPerda: 5, coberturaPercent: 100, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-009', quantidade: 0.004, unidadeMedida: 'KG', percentualPerda: 3, tipoComponente: 'INSUMO' },
    ],
  },
  {
    produtoCodigo: '4707',
    versao: 1,
    descricao: 'BOM Prova Impressão Caixa Império Ultra Zero 275ml',
    rendimento: 1,
    status: 'ATIVA',
    itens: [
      { mpCodigo: 'MP-003', quantidade: 1.2, unidadeMedida: 'KG', percentualPerda: 6, aproveitamento: 2, tipoComponente: 'MATERIA_PRIMA' },
      { mpCodigo: 'MP-004', quantidade: 0.004, unidadeMedida: 'KG', percentualPerda: 10, coberturaPercent: 30, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-005', quantidade: 0.003, unidadeMedida: 'KG', percentualPerda: 10, coberturaPercent: 22, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-006', quantidade: 0.0035, unidadeMedida: 'KG', percentualPerda: 10, coberturaPercent: 25, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-007', quantidade: 0.002, unidadeMedida: 'KG', percentualPerda: 10, coberturaPercent: 12, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-008', quantidade: 0.01, unidadeMedida: 'KG', percentualPerda: 5, coberturaPercent: 100, tipoComponente: 'INSUMO' },
    ],
  },
  {
    produtoCodigo: '4758',
    versao: 1,
    descricao: 'BOM STORA ENZO 181 - Papel para impressão',
    rendimento: 1,
    status: 'ATIVA',
    itens: [
      { mpCodigo: 'MP-001', quantidade: 1.0, unidadeMedida: 'KG', percentualPerda: 3, aproveitamento: 1, tipoComponente: 'MATERIA_PRIMA' },
      { mpCodigo: 'MP-007', quantidade: 0.001, unidadeMedida: 'KG', percentualPerda: 8, coberturaPercent: 5, tipoComponente: 'INSUMO' },
    ],
  },
  {
    produtoCodigo: '4575',
    versao: 1,
    descricao: 'BOM BOARDONE 230 - Papelão',
    rendimento: 1,
    status: 'ATIVA',
    itens: [
      { mpCodigo: 'MP-002', quantidade: 1.1, unidadeMedida: 'KG', percentualPerda: 4, aproveitamento: 1, tipoComponente: 'MATERIA_PRIMA' },
      { mpCodigo: 'MP-004', quantidade: 0.002, unidadeMedida: 'KG', percentualPerda: 10, coberturaPercent: 20, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-007', quantidade: 0.001, unidadeMedida: 'KG', percentualPerda: 10, coberturaPercent: 8, tipoComponente: 'INSUMO' },
    ],
  },
  {
    produtoCodigo: '3021',
    versao: 1,
    descricao: 'BOM Etiqueta Embal Rodeio 100M',
    rendimento: 1,
    status: 'ATIVA',
    itens: [
      { mpCodigo: 'MP-001', quantidade: 0.15, unidadeMedida: 'KG', percentualPerda: 10, aproveitamento: 20, tipoComponente: 'MATERIA_PRIMA' },
      { mpCodigo: 'MP-004', quantidade: 0.001, unidadeMedida: 'KG', percentualPerda: 15, coberturaPercent: 30, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-005', quantidade: 0.001, unidadeMedida: 'KG', percentualPerda: 15, coberturaPercent: 25, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-006', quantidade: 0.001, unidadeMedida: 'KG', percentualPerda: 15, coberturaPercent: 20, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-007', quantidade: 0.0005, unidadeMedida: 'KG', percentualPerda: 15, coberturaPercent: 10, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-008', quantidade: 0.002, unidadeMedida: 'KG', percentualPerda: 5, coberturaPercent: 100, tipoComponente: 'INSUMO' },
    ],
  },
  {
    produtoCodigo: '4528',
    versao: 1,
    descricao: 'BOM Cartucho Kit Best Sellers',
    rendimento: 1,
    status: 'ATIVA',
    itens: [
      { mpCodigo: 'MP-002', quantidade: 0.35, unidadeMedida: 'KG', percentualPerda: 6, aproveitamento: 8, tipoComponente: 'MATERIA_PRIMA' },
      { mpCodigo: 'MP-004', quantidade: 0.0025, unidadeMedida: 'KG', percentualPerda: 12, coberturaPercent: 35, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-005', quantidade: 0.002, unidadeMedida: 'KG', percentualPerda: 12, coberturaPercent: 28, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-006', quantidade: 0.002, unidadeMedida: 'KG', percentualPerda: 12, coberturaPercent: 22, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-007', quantidade: 0.001, unidadeMedida: 'KG', percentualPerda: 12, coberturaPercent: 10, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-008', quantidade: 0.005, unidadeMedida: 'KG', percentualPerda: 5, coberturaPercent: 100, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-009', quantidade: 0.003, unidadeMedida: 'KG', percentualPerda: 3, tipoComponente: 'INSUMO' },
    ],
  },
  {
    produtoCodigo: '4041217',
    versao: 1,
    descricao: 'BOM Cart. Mãe Premium Intense Fragance',
    rendimento: 1,
    status: 'ATIVA',
    itens: [
      { mpCodigo: 'MP-003', quantidade: 0.65, unidadeMedida: 'KG', percentualPerda: 5, aproveitamento: 4, tipoComponente: 'MATERIA_PRIMA' },
      { mpCodigo: 'MP-004', quantidade: 0.003, unidadeMedida: 'KG', percentualPerda: 10, coberturaPercent: 40, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-005', quantidade: 0.003, unidadeMedida: 'KG', percentualPerda: 10, coberturaPercent: 35, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-006', quantidade: 0.002, unidadeMedida: 'KG', percentualPerda: 10, coberturaPercent: 25, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-007', quantidade: 0.001, unidadeMedida: 'KG', percentualPerda: 10, coberturaPercent: 8, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-008', quantidade: 0.012, unidadeMedida: 'KG', percentualPerda: 5, coberturaPercent: 100, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-009', quantidade: 0.004, unidadeMedida: 'KG', percentualPerda: 3, tipoComponente: 'INSUMO' },
    ],
  },
  {
    produtoCodigo: '1041607',
    versao: 1,
    descricao: 'BOM Lâmina Cola Rato Letal',
    rendimento: 1,
    status: 'ATIVA',
    itens: [
      { mpCodigo: 'MP-001', quantidade: 0.08, unidadeMedida: 'KG', percentualPerda: 12, aproveitamento: 30, tipoComponente: 'MATERIA_PRIMA' },
      { mpCodigo: 'MP-006', quantidade: 0.001, unidadeMedida: 'KG', percentualPerda: 15, coberturaPercent: 50, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-007', quantidade: 0.001, unidadeMedida: 'KG', percentualPerda: 15, coberturaPercent: 40, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-009', quantidade: 0.015, unidadeMedida: 'KG', percentualPerda: 2, tipoComponente: 'INSUMO' },
    ],
  },
  {
    produtoCodigo: '1041592',
    versao: 1,
    descricao: 'BOM Lâmina Cola Rato Ligeirinho',
    rendimento: 1,
    status: 'ATIVA',
    itens: [
      { mpCodigo: 'MP-001', quantidade: 0.08, unidadeMedida: 'KG', percentualPerda: 12, aproveitamento: 30, tipoComponente: 'MATERIA_PRIMA' },
      { mpCodigo: 'MP-004', quantidade: 0.0008, unidadeMedida: 'KG', percentualPerda: 15, coberturaPercent: 20, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-006', quantidade: 0.001, unidadeMedida: 'KG', percentualPerda: 15, coberturaPercent: 45, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-007', quantidade: 0.0008, unidadeMedida: 'KG', percentualPerda: 15, coberturaPercent: 30, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-009', quantidade: 0.015, unidadeMedida: 'KG', percentualPerda: 2, tipoComponente: 'INSUMO' },
    ],
  },
  {
    produtoCodigo: '4718',
    versao: 1,
    descricao: 'BOM Cartucho Eletrodo Ok',
    rendimento: 1,
    status: 'ATIVA',
    itens: [
      { mpCodigo: 'MP-002', quantidade: 0.45, unidadeMedida: 'KG', percentualPerda: 5, aproveitamento: 6, tipoComponente: 'MATERIA_PRIMA' },
      { mpCodigo: 'MP-004', quantidade: 0.002, unidadeMedida: 'KG', percentualPerda: 10, coberturaPercent: 25, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-005', quantidade: 0.001, unidadeMedida: 'KG', percentualPerda: 10, coberturaPercent: 15, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-007', quantidade: 0.002, unidadeMedida: 'KG', percentualPerda: 10, coberturaPercent: 20, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-009', quantidade: 0.004, unidadeMedida: 'KG', percentualPerda: 3, tipoComponente: 'INSUMO' },
    ],
  },
  {
    produtoCodigo: '1051976',
    versao: 1,
    descricao: 'BOM Caixa Papelão Ciclone Vaquinha',
    rendimento: 1,
    status: 'ATIVA',
    itens: [
      { mpCodigo: 'MP-003', quantidade: 0.95, unidadeMedida: 'KG', percentualPerda: 5, aproveitamento: 3, tipoComponente: 'MATERIA_PRIMA' },
      { mpCodigo: 'MP-004', quantidade: 0.003, unidadeMedida: 'KG', percentualPerda: 10, coberturaPercent: 30, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-005', quantidade: 0.003, unidadeMedida: 'KG', percentualPerda: 10, coberturaPercent: 28, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-006', quantidade: 0.003, unidadeMedida: 'KG', percentualPerda: 10, coberturaPercent: 25, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-007', quantidade: 0.001, unidadeMedida: 'KG', percentualPerda: 10, coberturaPercent: 8, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-008', quantidade: 0.008, unidadeMedida: 'KG', percentualPerda: 5, coberturaPercent: 100, tipoComponente: 'INSUMO' },
      { mpCodigo: 'MP-009', quantidade: 0.005, unidadeMedida: 'KG', percentualPerda: 3, tipoComponente: 'INSUMO' },
    ],
  },
]

export { ESTRUTURAS_BASE }
export type { DefEstruturaProduto, DefItemEstrutura }

/**
 * Cria (ou reutiliza) Estruturas de Produto (BOMs) para 3 produtos acabados da
 * demo, vinculando-os às matérias-primas já cadastradas em `ctx.materiaPrimaIds`.
 *
 * - **EstruturaProduto** — dedupe por `[empresaId, produtoId, versao]` via findFirst.
 * - **ItemEstrutura** — criados APENAS quando a EstruturaProduto é nova nesta
 *   execução (padrão idempotente igual a seedOrdensProducao com filhas).
 * - `quantidadeLiquida` é calculada como `quantidade * (1 + percentualPerda / 100)`.
 *
 * Preenche os contadores `bomsCriadas`/`bomsPuladas` no resumo.
 */
export async function seedEstruturasProduto(ctx: Contexto): Promise<ContadorModulo> {
  const antesCriadas = ctx.resumo.bomsCriadas
  const antesPuladas = ctx.resumo.bomsPuladas

  for (const def of ESTRUTURAS_BASE) {
    try {
      // Resolver produtoId do produto acabado (ctx.produtos ou fallback no banco)
      let produtoId: string | undefined = ctx.produtos.get(def.produtoCodigo)?.id
      if (!produtoId) {
        const prodBanco = await prisma.produto.findFirst({
          where: { empresaId: ctx.empresaId, codigo: def.produtoCodigo },
          select: { id: true },
        })
        produtoId = prodBanco?.id
      }
      if (!produtoId) {
        logErro('⚠️', `BOM ${def.produtoCodigo}: produto acabado não encontrado no contexto.`, new Error('produtoId ausente'))
        continue
      }

      // Dedupe por [empresaId, produtoId, versao]
      const existente = await prisma.estruturaProduto.findFirst({
        where: { empresaId: ctx.empresaId, produtoId, versao: def.versao },
        select: { id: true },
      })

      if (existente) {
        ctx.resumo.bomsPuladas++
        continue
      }

      // Criar EstruturaProduto
      const estrutura = await prisma.estruturaProduto.create({
        data: {
          empresaId: ctx.empresaId,
          produtoId,
          versao: def.versao,
          descricao: def.descricao,
          rendimento: def.rendimento,
          status: def.status,
        },
      })
      ctx.resumo.bomsCriadas++

      // Criar ItemEstrutura para cada componente
      for (let i = 0; i < def.itens.length; i++) {
        const itemDef = def.itens[i]

        // Resolver produtoComponenteId via código da matéria-prima
        const mpInfo = ctx.materiaPrimaIds.find(mp => mp.codigo === itemDef.mpCodigo)
        if (!mpInfo) {
          logErro('⚠️', `BOM ${def.produtoCodigo} item ${itemDef.mpCodigo}: matéria-prima não encontrada.`, new Error('componenteId ausente'))
          continue
        }

        const quantidadeLiquida = itemDef.quantidade * (1 + itemDef.percentualPerda / 100)

        await prisma.itemEstrutura.create({
          data: {
            estruturaProdutoId: estrutura.id,
            produtoComponenteId: mpInfo.id,
            quantidade: itemDef.quantidade,
            unidadeMedida: itemDef.unidadeMedida,
            percentualPerda: itemDef.percentualPerda,
            quantidadeLiquida,
            sequencia: i + 1,
            ...(itemDef.aproveitamento != null && { aproveitamento: itemDef.aproveitamento }),
            ...(itemDef.coberturaPercent != null && { coberturaPercent: itemDef.coberturaPercent }),
            tipoComponente: itemDef.tipoComponente,
          },
        })
      }
    } catch (err) {
      logErro('⚠️', `Falha ao resolver BOM do produto ${def.produtoCodigo}:`, err)
    }
  }

  const criadas = ctx.resumo.bomsCriadas - antesCriadas
  const puladas = ctx.resumo.bomsPuladas - antesPuladas
  log('📦', `Estruturas de produto (BOM): criadas: ${criadas} | puladas: ${puladas}`)
  return { criados: criadas, pulados: puladas }
}

// ─── Módulo: roteiros de produção ─────────────────────────────────────────────────

/**
 * Definição de uma etapa de roteiro para o seed.
 */
interface DefEtapaRoteiro {
  sequencia: number
  descricao: string
  centroTipo: 'cortadeira' | 'impressao' | 'acabamento'
  tempoSetupMinutos: number
  tempoOperacaoMinutos: number
  tempoEsperaMinutos: number
}

/**
 * Definição de um roteiro de produção completo.
 */
interface DefRoteiroProducao {
  produtoCodigo: string
  versao: number
  descricao: string
  status: string
  etapas: DefEtapaRoteiro[]
}

/**
 * Roteiro padrão de embalagem de papelão: Corte e vinco → Impressão → Acabamento/Colagem.
 * Aplicado aos mesmos 3 produtos da BOM.
 */
const ETAPAS_ROTEIRO_PADRAO: DefEtapaRoteiro[] = [
  { sequencia: 1, descricao: 'Corte e vinco', centroTipo: 'cortadeira', tempoSetupMinutos: 30, tempoOperacaoMinutos: 0.5, tempoEsperaMinutos: 0 },
  { sequencia: 2, descricao: 'Impressão', centroTipo: 'impressao', tempoSetupMinutos: 45, tempoOperacaoMinutos: 0.8, tempoEsperaMinutos: 0 },
  { sequencia: 3, descricao: 'Acabamento / Colagem', centroTipo: 'acabamento', tempoSetupMinutos: 15, tempoOperacaoMinutos: 0.3, tempoEsperaMinutos: 0 },
]

const ROTEIROS_BASE: DefRoteiroProducao[] = [
  { produtoCodigo: '2709', versao: 1, descricao: 'Roteiro Caixa Papelão 5KG Eletrodo', status: 'ATIVO', etapas: ETAPAS_ROTEIRO_PADRAO },
  { produtoCodigo: '3570', versao: 1, descricao: 'Roteiro Cartucho Display 50 sachês', status: 'ATIVO', etapas: ETAPAS_ROTEIRO_PADRAO },
  { produtoCodigo: '4707', versao: 1, descricao: 'Roteiro Prova Impressão Império Ultra Zero', status: 'ATIVO', etapas: ETAPAS_ROTEIRO_PADRAO },
  { produtoCodigo: '4758', versao: 1, descricao: 'Roteiro STORA ENZO 181', status: 'ATIVO', etapas: ETAPAS_ROTEIRO_PADRAO },
  { produtoCodigo: '4575', versao: 1, descricao: 'Roteiro BOARDONE 230', status: 'ATIVO', etapas: ETAPAS_ROTEIRO_PADRAO },
  { produtoCodigo: '3021', versao: 1, descricao: 'Roteiro Etiqueta Embal Rodeio 100M', status: 'ATIVO', etapas: ETAPAS_ROTEIRO_PADRAO },
  { produtoCodigo: '4528', versao: 1, descricao: 'Roteiro Cartucho Kit Best Sellers', status: 'ATIVO', etapas: ETAPAS_ROTEIRO_PADRAO },
  { produtoCodigo: '4041217', versao: 1, descricao: 'Roteiro Cart. Mãe Premium Intense', status: 'ATIVO', etapas: ETAPAS_ROTEIRO_PADRAO },
  { produtoCodigo: '1041607', versao: 1, descricao: 'Roteiro Lâmina Cola Rato Letal', status: 'ATIVO', etapas: ETAPAS_ROTEIRO_PADRAO },
  { produtoCodigo: '1041592', versao: 1, descricao: 'Roteiro Lâmina Cola Rato Ligeirinho', status: 'ATIVO', etapas: ETAPAS_ROTEIRO_PADRAO },
  { produtoCodigo: '4718', versao: 1, descricao: 'Roteiro Cartucho Eletrodo Ok', status: 'ATIVO', etapas: ETAPAS_ROTEIRO_PADRAO },
  { produtoCodigo: '1051976', versao: 1, descricao: 'Roteiro Caixa Papelão Ciclone Vaquinha', status: 'ATIVO', etapas: ETAPAS_ROTEIRO_PADRAO },
]

export { ROTEIROS_BASE, ETAPAS_ROTEIRO_PADRAO }
export type { DefRoteiroProducao, DefEtapaRoteiro }

/**
 * Cria (ou reutiliza) Roteiros de Produção para os mesmos 3 produtos acabados da
 * BOM, com 3 etapas cada (Corte e vinco → Impressão → Acabamento/Colagem).
 *
 * - **RoteiroProducao** — dedupe por `[empresaId, produtoId, versao]` via findFirst.
 * - **EtapaRoteiro** — criadas APENAS quando o RoteiroProducao é novo nesta
 *   execução (padrão idempotente igual a seedOrdensProducao com filhas).
 * - `tempoTotalMinutos` é calculado como `tempoSetup + tempoOperacao + tempoEspera`.
 *
 * Preenche os contadores `roteirosCriados`/`roteirosPulados` no resumo.
 */
export async function seedRoteirosProduto(ctx: Contexto): Promise<ContadorModulo> {
  const antesCriados = ctx.resumo.roteirosCriados
  const antesPulados = ctx.resumo.roteirosPulados

  for (const def of ROTEIROS_BASE) {
    try {
      // Resolver produtoId do produto acabado (ctx.produtos ou fallback no banco)
      let produtoId: string | undefined = ctx.produtos.get(def.produtoCodigo)?.id
      if (!produtoId) {
        const prodBanco = await prisma.produto.findFirst({
          where: { empresaId: ctx.empresaId, codigo: def.produtoCodigo },
          select: { id: true },
        })
        produtoId = prodBanco?.id
      }
      if (!produtoId) {
        logErro('⚠️', `Roteiro ${def.produtoCodigo}: produto acabado não encontrado no contexto.`, new Error('produtoId ausente'))
        continue
      }

      // Dedupe por [empresaId, produtoId, versao]
      const existente = await prisma.roteiroProducao.findFirst({
        where: { empresaId: ctx.empresaId, produtoId, versao: def.versao },
        select: { id: true },
      })

      if (existente) {
        ctx.resumo.roteirosPulados++
        continue
      }

      // Criar RoteiroProducao
      const roteiro = await prisma.roteiroProducao.create({
        data: {
          empresaId: ctx.empresaId,
          produtoId,
          versao: def.versao,
          descricao: def.descricao,
          status: def.status,
        },
      })
      ctx.resumo.roteirosCriados++

      // Criar EtapaRoteiro para cada etapa do roteiro
      for (const etapaDef of def.etapas) {
        const centroProducaoId = ctx.centros[etapaDef.centroTipo]
        if (!centroProducaoId) {
          logErro('⚠️', `Roteiro ${def.produtoCodigo} etapa ${etapaDef.sequencia}: centro ${etapaDef.centroTipo} ausente.`, new Error('centroId ausente'))
          continue
        }

        const tempoTotalMinutos = etapaDef.tempoSetupMinutos + etapaDef.tempoOperacaoMinutos + etapaDef.tempoEsperaMinutos

        await prisma.etapaRoteiro.create({
          data: {
            roteiroProducaoId: roteiro.id,
            sequencia: etapaDef.sequencia,
            descricao: etapaDef.descricao,
            centroProducaoId,
            tempoSetupMinutos: etapaDef.tempoSetupMinutos,
            tempoOperacaoMinutos: etapaDef.tempoOperacaoMinutos,
            tempoEsperaMinutos: etapaDef.tempoEsperaMinutos,
            tempoTotalMinutos,
          },
        })
      }
    } catch (err) {
      logErro('⚠️', `Falha ao resolver roteiro do produto ${def.produtoCodigo}:`, err)
    }
  }

  const criados = ctx.resumo.roteirosCriados - antesCriados
  const pulados = ctx.resumo.roteirosPulados - antesPulados
  log('🔄', `Roteiros de produção: criados: ${criados} | pulados: ${pulados}`)
  return { criados, pulados }
}

// ─── Módulo: cenário integrado (fluxo ponta a ponta) ──────────────────────────────

/**
 * Cria um cenário COMPLETO de ponta a ponta simulando o fluxo:
 *
 *   Representante solicita → Orçamento calculado → Aprovado → Pedido CONFIRMADO → Aguardando gerar OP
 *
 * Marina Alves (ctx.representantes[0]) solicita orçamento para SOL & NEVE.
 * Produto: Caixa Papelão Ciclone Vaquinha (código 1051976) com BOM completa
 * (Triplex 350g + tintas + verniz + cola).
 *
 * Entidades criadas (encadeadas):
 * 1. OrcamentoGrafico (910/v1, APROVADO, com resultadoCalculo completo)
 * 2. PedidoVenda (810, CONFIRMADO, origem ORCAMENTO_GRAFICO vinculado)
 *    + 1 ItemPedidoVenda (produto 1051976, 3000un × R$5.60)
 * 3. SolicitacaoOrcamentoRep (PROCESSADA, vinculada ao orçamento)
 *
 * Idempotência:
 * - Orçamento: dedupe por [empresaId, numero=910, versao=1]
 * - Pedido: dedupe por [empresaId, numero=810]
 * - Solicitação: dedupe por [empresaId, representanteId, tipoEmbalagem]
 * - Filhas/vínculos só são criados quando o pai é criado nesta execução.
 */
export async function seedCenarioIntegrado(ctx: Contexto): Promise<void> {
  if (ctx.representantes.length === 0) {
    log('⚠️', 'Nenhum representante disponível — cenário integrado pulado.')
    return
  }

  const rep = ctx.representantes[0] // Marina Alves
  const clienteId = ctx.clientes.get('SOL & NEVE')
  if (!clienteId) {
    log('⚠️', 'Cliente SOL & NEVE não encontrado — cenário integrado pulado.')
    return
  }

  const tipoEmbalagemId = ctx.tipoEmbalagemIds[0]
  if (!tipoEmbalagemId) {
    log('⚠️', 'Nenhum TipoEmbalagem disponível — cenário integrado pulado.')
    return
  }

  // Resolver produtoId do 1051976 via ctx.produtos ou fallback no banco
  let produtoId: string | undefined = ctx.produtos.get('1051976')?.id
  if (!produtoId) {
    const prodBanco = await prisma.produto.findFirst({
      where: { empresaId: ctx.empresaId, codigo: '1051976' },
      select: { id: true },
    })
    produtoId = prodBanco?.id
  }
  if (!produtoId) {
    log('⚠️', 'Produto 1051976 (Caixa Papelão Ciclone Vaquinha) não encontrado — cenário integrado pulado.')
    return
  }

  const TIPO_EMBALAGEM_SOLICIT = 'Caixa para produto lácteo Ciclone Vaquinha'

  try {
    // ──── 1) OrcamentoGrafico (910/v1, APROVADO) ────────────────────────────────

    const orcamentoExistente = await prisma.orcamentoGrafico.findFirst({
      where: { empresaId: ctx.empresaId, numero: 910, versao: 1 },
      select: { id: true },
    })

    let orcamentoId: string
    let orcamentoCriado = false

    if (orcamentoExistente) {
      orcamentoId = orcamentoExistente.id
    } else {
      const orcamento = await prisma.orcamentoGrafico.create({
        data: {
          empresaId: ctx.empresaId,
          numero: 910,
          versao: 1,
          clienteId,
          clienteNome: 'SOL & NEVE',
          vendedorId: rep.vendedorId,
          tipoEmbalagemId,
          medidas: { L: 250, A: 180, P: 120 },
          quantidade: 3000,
          criadoPorId: USUARIO_SEED_ID,
          status: 'APROVADO',
          aprovadoEm: diasNoPassado(5),
          precoUnitario: 5.60,
          precoVenda: 16800.00,
          resultadoCalculo: {
            precoUnitario: 5.60,
            valorTotal: 16800.00,
            custoTotal: 10920.00,
            margemReal: 35,
            custoMaterial: {
              papel: { descricao: 'Triplex 350g 760x1040', qtdKg: 3600, precoKg: 7.20, total: 25920.00, porUnidade: 8.64 },
              tinta: { descricao: 'CMYK offset', qtdKg: 39, total: 3120.00, porUnidade: 1.04 },
              verniz: { descricao: 'Verniz UV Brilho', qtdKg: 24, precoKg: 32.00, total: 768.00, porUnidade: 0.256 },
              cola: { descricao: 'Cola PVA Branca', qtdKg: 15, precoKg: 12.50, total: 187.50, porUnidade: 0.0625 },
            },
            custoProducao: {
              corte: { tempo: '30min setup + 25h operação', custoHora: 85, total: 2167.50 },
              impressao: { tempo: '45min setup + 40h operação', custoHora: 120, total: 4890.00 },
              acabamento: { tempo: '15min setup + 15h operação', custoHora: 65, total: 1001.25 },
            },
            impostos: 12,
            comissaoRep: 5,
            despesasAdmin: 3,
          },
        },
      })
      orcamentoId = orcamento.id
      orcamentoCriado = true
      contabilizar(ctx.resumo, 'orcamentos', true)
    }

    if (!orcamentoCriado) {
      contabilizar(ctx.resumo, 'orcamentos', false)
    }

    // ──── 2) PedidoVenda (810, CONFIRMADO, origem ORCAMENTO_GRAFICO) ────────────

    const pedidoExistente = await prisma.pedidoVenda.findFirst({
      where: { empresaId: ctx.empresaId, numero: 810 },
      select: { id: true },
    })

    if (pedidoExistente) {
      contabilizar(ctx.resumo, 'pedidos', false)
    } else {
      const pedido = await prisma.pedidoVenda.create({
        data: {
          empresaId: ctx.empresaId,
          numero: 810,
          clienteId,
          tabelaPrecoId: ctx.tabelaPrecoId,
          status: 'CONFIRMADO',
          origemPedido: 'ORCAMENTO_GRAFICO',
          orcamentoOrigemId: orcamentoId,
          valorTotal: 16800.00,
        },
      })
      contabilizar(ctx.resumo, 'pedidos', true)

      // ItemPedidoVenda — criado somente quando o pedido é criado (idempotência)
      await prisma.itemPedidoVenda.create({
        data: {
          pedidoVendaId: pedido.id,
          produtoId,
          quantidade: 3000,
          precoBase: 5.60,
          precoFinal: 5.60,
          valorTotal: 16800.00,
          unidade: 'UN',
        },
      })
    }

    // ──── 3) SolicitacaoOrcamentoRep (PROCESSADA, vinculada ao orçamento) ───────

    const solicitExistente = await prisma.solicitacaoOrcamentoRep.findFirst({
      where: {
        empresaId: ctx.empresaId,
        representanteId: rep.id,
        tipoEmbalagem: TIPO_EMBALAGEM_SOLICIT,
      },
      select: { id: true },
    })

    if (solicitExistente) {
      contabilizar(ctx.resumo, 'solicitacoes', false)
    } else {
      await prisma.solicitacaoOrcamentoRep.create({
        data: {
          empresaId: ctx.empresaId,
          representanteId: rep.id,
          vendedorId: rep.vendedorId,
          clienteId,
          clienteNome: 'SOL & NEVE',
          tipoEmbalagem: TIPO_EMBALAGEM_SOLICIT,
          quantidade: 3000,
          medidaLargura: 250,
          medidaAltura: 180,
          medidaComprimento: 120,
          acabamentos: 'Impressão offset 4x0 + verniz UV brilho total + colagem',
          status: 'PROCESSADA',
          orcamentoGraficoId: orcamentoId,
        },
      })
      contabilizar(ctx.resumo, 'solicitacoes', true)
    }

    log('🔗', 'Cenário integrado ponta a ponta: Solicitação → Orçamento → Pedido CONFIRMADO ✓')
  } catch (err) {
    logErro('⚠️', 'Falha ao criar cenário integrado:', err)
  }
}

// ─── Orquestração: main() ─────────────────────────────────────────────────────────

/**
 * Função principal do script de seed — orquestra todos os módulos na ordem de
 * dependências (respeitando FKs) e imprime o resumo final com contagem total por
 * módulo e credenciais do Portal Representante.
 *
 * Fluxo:
 * 1. Guarda de segurança (confirmarEmpresaDemo) — aborta se empresa não existe
 *    ou é Carton Wega.
 * 2. Executa módulos na ordem: cadastrosBase → vendedores → clientes → produtos →
 *    tiposEmbalagem → orçamentos → pedidos → OPs → solicitações.
 * 3. Imprime resumo geral por módulo e credenciais de representante.
 *
 * Erros não-fatais (criação de item individual) são tratados por try/catch dentro
 * de cada módulo. Erros fatais (empresa ausente, Carton Wega, falha de conexão)
 * propagam para o catch global que encerra com process.exit(1).
 *
 * _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 12.1, 12.3_
 */
async function main(): Promise<void> {
  // 1) Guarda de segurança — primeira operação obrigatória.
  const empresa = await confirmarEmpresaDemo()
  log('🏢', `Empresa: ${empresa.nome} (${empresa.id})`)

  // 2) Inicializar contexto com todos os campos vazios/zerados.
  const resumo: Resumo = {
    clientesCriados: 0,
    clientesPulados: 0,
    vendedoresCriados: 0,
    vendedoresPulados: 0,
    representantesCriados: 0,
    representantesPulados: 0,
    produtosCriados: 0,
    produtosPulados: 0,
    tiposEmbalagemCriados: 0,
    tiposEmbalagemPulados: 0,
    orcamentosCriados: 0,
    orcamentosPulados: 0,
    pedidosCriados: 0,
    pedidosPulados: 0,
    opsCriadas: 0,
    opsPuladas: 0,
    etapasCriadas: 0,
    itensOpCriados: 0,
    apontamentosCriados: 0,
    logsCriados: 0,
    solicitacoesCriados: 0,
    solicitacoesPulados: 0,
    cadastrosBaseCriados: 0,
    cadastrosBasePulados: 0,
    materiaPrimaCriados: 0,
    materiaPrimaPulados: 0,
    enderecosCriados: 0,
    enderecosPulados: 0,
    saldosCriados: 0,
    saldosPulados: 0,
    bomsCriadas: 0,
    bomsPuladas: 0,
    roteirosCriados: 0,
    roteirosPulados: 0,
  }

  const ctx: Contexto = {
    empresaId: empresa.id,
    vendedores: [],
    representantes: [],
    clientes: new Map(),
    produtos: new Map(),
    tabelaPrecoId: '',
    tipoEmbalagemIds: [],
    centros: {},
    orcamentosAprovados: [],
    materiaPrimaIds: [],
    enderecoIds: [],
    resumo,
  }

  // 3) Executar módulos na ordem de dependências de FK.
  log('🚀', 'Iniciando seed dos módulos...')

  await seedCadastrosBase(ctx)
  await seedVendedoresERepresentantes(ctx)
  await seedClientes(ctx)
  await seedProdutos(ctx)
  await seedTiposEmbalagem(ctx)
  await seedOrcamentosGraficos(ctx)
  await seedPedidosVenda(ctx)
  await seedOrdensProducao(ctx)
  await seedMateriaPrima(ctx)
  await seedAtualizarPrecos(ctx)
  await seedEnderecos(ctx)
  await seedSaldoEstoque(ctx)
  await seedEstruturasProduto(ctx)
  await seedRoteirosProduto(ctx)
  await seedCenarioIntegrado(ctx)
  await seedSolicitacoesPortal(ctx)

  // 4) Resumo final por módulo.
  log('📊', '═══════════════════════════════════════════════════')
  log('📊', '               RESUMO FINAL                       ')
  log('📊', '═══════════════════════════════════════════════════')
  log('📊', `Cadastros base:       criados ${resumo.cadastrosBaseCriados} | pulados ${resumo.cadastrosBasePulados}`)
  log('📊', `Vendedores:           criados ${resumo.vendedoresCriados} | pulados ${resumo.vendedoresPulados}`)
  log('📊', `Representantes:       criados ${resumo.representantesCriados} | pulados ${resumo.representantesPulados}`)
  log('📊', `Clientes:             criados ${resumo.clientesCriados} | pulados ${resumo.clientesPulados}`)
  log('📊', `Produtos:             criados ${resumo.produtosCriados} | pulados ${resumo.produtosPulados}`)
  log('📊', `Tipos embalagem:      criados ${resumo.tiposEmbalagemCriados} | pulados ${resumo.tiposEmbalagemPulados}`)
  log('📊', `Orçamentos:           criados ${resumo.orcamentosCriados} | pulados ${resumo.orcamentosPulados}`)
  log('📊', `Pedidos:              criados ${resumo.pedidosCriados} | pulados ${resumo.pedidosPulados}`)
  log('📊', `Ordens de produção:   criadas ${resumo.opsCriadas} | puladas ${resumo.opsPuladas}`)
  log('📊', `  ↳ Etapas: ${resumo.etapasCriadas} | Itens: ${resumo.itensOpCriados} | Logs: ${resumo.logsCriados} | Apontamentos: ${resumo.apontamentosCriados}`)
  log('📊', `Matéria-prima:        criados ${resumo.materiaPrimaCriados} | pulados ${resumo.materiaPrimaPulados}`)
  log('📊', `Endereços WMS:        criados ${resumo.enderecosCriados} | pulados ${resumo.enderecosPulados}`)
  log('📊', `Saldos estoque:       criados ${resumo.saldosCriados} | pulados ${resumo.saldosPulados}`)
  log('📊', `Estruturas (BOM):     criadas ${resumo.bomsCriadas} | puladas ${resumo.bomsPuladas}`)
  log('📊', `Roteiros produção:    criados ${resumo.roteirosCriados} | pulados ${resumo.roteirosPulados}`)
  log('📊', `Cenário integrado:    Solicit→Orçamento→Pedido (fluxo ponta a ponta)`)
  log('📊', `Solicitações portal:  criados ${resumo.solicitacoesCriados} | pulados ${resumo.solicitacoesPulados}`)
  log('📊', '═══════════════════════════════════════════════════')

  // 5) Reimprimir credenciais do Portal Representante no resumo final.
  if (ctx.representantes.length > 0) {
    log('🔑', 'Credenciais do Portal Representante:')
    for (const rep of ctx.representantes) {
      log('🔑', `  ${rep.email} | senha: ${rep.senha}`)
    }
  }

  log('✅', 'Seed concluído com sucesso!')
}

// ─── Entrypoint ───────────────────────────────────────────────────────────────────

main()
  .catch((err) => {
    logErro('💥', 'Erro fatal:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
