/**
 * Importador dos CADASTROS do Orçamento Gráfico (produtos, planos, atividades,
 * materiais, relações, roteiros, defaults, campos livres, ajustes, quebras,
 * limites de montagem e parâmetros) do legado → Vizor.
 *
 * Spec: orcamento-grafico-cadastros-relacoes (tarefa 7.2; Req 14.1, 14.2, 14.7).
 *
 * ORQUESTRAÇÃO FINA: toda a regra (mapeamento, casamento, plano, relatório) vive nos
 * módulos puros em `src/modules/orcamento-grafico/cadastros-graficos/importacao/`.
 * Este script só (1) lê o JSON exportado, (2) carrega os existentes do Prisma com
 * `empresaId` explícito, (3) mapeia, (4) planeja, (5) executa com um executor Prisma
 * (ou nada, em `--dry-run`), (6) acumula os ids para as fases seguintes e (7) imprime
 * e grava o relatório.
 *
 * REGRAS
 *  - Idempotente por `codigoOrigem` (e chave natural nas fases sem código); nunca apaga;
 *    só preenche campo VAZIO de registro existente; ambíguo/sem equivalente = "não casado".
 *  - Toda query e toda escrita levam `empresaId` explícito (nunca confiar só no tenant).
 *  - Conexão SOMENTE pelo `DATABASE_URL` do ambiente (nada embutido aqui).
 *  - NÃO cria empresa: `--empresa` é obrigatória e precisa existir.
 *
 * USO
 *   npx tsx scripts/importar-cadastros-orcamento.ts --empresa <id> [--dry-run]
 *     [--arquivo cartoon/export/CadastrosOrcamento.json] [--fase <nome>]
 *     [--relatorio cartoon/export/relatorio-importacao-cadastros.json]
 *
 *   Fases (ordem padrão): catalogos, produtos, planos, atividades, materiais,
 *   materiais-tipo-param (moda de TipoParamAcab por CodMaterial; só campo vazio), itens-diversos, relacoes, roteiros, defaults, campos-livres, ajustes, quebras,
 *   limites-montagem, parametros.
 *
 *   `--fase` isolada funciona: os ids das fases anteriores vêm do banco (por
 *   `codigoOrigem`). Num dry-run completo, os registros que seriam criados entram
 *   com id sintético `dry:<fase>:<codigo>` só para encadear as fases.
 */
import { PrismaClient } from '@prisma/client'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { flag, normalizarNome, numero } from '../src/modules/orcamento-grafico/cadastros-graficos/importacao/normalizar'
import {
  executarPlano,
  planejarPorChaveNatural,
  planejarPorOrigem,
  type Campos,
  type ExecutorCadastro,
  type ExistenteCadastro,
  type ItemLegado,
  type OpcoesPlanejamento,
  type ResultadoExecucao,
} from '../src/modules/orcamento-grafico/cadastros-graficos/importacao/planejador'
import {
  chaveAjuste,
  chaveLimiteMontagem,
  lerRelacionamentosCampos,
  materiaisComMedidaLinear,
  mapearAjustes,
  mapearAtividades,
  mapearCamposLivres,
  mapearCoberturas,
  mapearDefaults,
  mapearItensDiversos,
  mapearLimitesMontagem,
  mapearLimitesQuebra,
  mapearLinhas,
  mapearMateriais,
  mapearOpcoesCampo,
  mapearParametros,
  mapearPlanos,
  mapearProcessos,
  mapearProdutos,
  mapearQuebras,
  mapearRestricoes,
  planejarCopiaCampos,
  type LinhaBruta,
} from '../src/modules/orcamento-grafico/cadastros-graficos/importacao/mapeamento'
import {
  codigosAcondicionamento,
  planejarRelacoes,
  relatorioDeRelacoes,
  type PlanoRelacoes,
  type ResolvedorRelacoes,
} from '../src/modules/orcamento-grafico/cadastros-graficos/importacao/relacoes-plano'
import {
  traduzirRelTabelas,
  type LinhaRelTabelas,
} from '../src/modules/orcamento-grafico/cadastros-graficos/importacao/tabelas-relacao'
import {
  aplicarRoteiro,
  planejarOrdens,
  type LinhaRoteiro,
  type RelacaoParaOrdem,
} from '../src/modules/orcamento-grafico/cadastros-graficos/importacao/roteiro'
import { modaTipoParamPorMaterial } from '../src/modules/orcamento-grafico/cadastros-graficos/importacao/tipo-param'
import {
  formatarRelatorio,
  relatorioVazio,
  totalizar,
  type RelatorioFase,
} from '../src/modules/orcamento-grafico/cadastros-graficos/importacao/relatorio'

const prisma = new PrismaClient()

const EXPORT_DIR = join('cartoon', 'export')
const ARQUIVO_PADRAO = join(EXPORT_DIR, 'CadastrosOrcamento.json')
const RELATORIO_PADRAO = join(EXPORT_DIR, 'relatorio-importacao-cadastros.json')
const TAMANHO_LOTE = 500

const FASES_ORDEM = [
  'catalogos',
  'produtos',
  'planos',
  'atividades',
  'materiais',
  'materiais-tipo-param',
  'itens-diversos',
  'relacoes',
  'roteiros',
  'defaults',
  'campos-livres',
  'ajustes',
  'quebras',
  'limites-montagem',
  'parametros',
] as const
type NomeFase = (typeof FASES_ORDEM)[number]

// ============================================================================
// CLI
// ============================================================================

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const flagCli = (nome: string) => process.argv.includes(`--${nome}`)

/** Aceita caminho completo, ou só o nome (resolvido em cartoon/export, com .json). */
function resolverArquivo(valor: string | undefined): string {
  if (!valor) return ARQUIVO_PADRAO
  if (/[\\/]/.test(valor) || valor.toLowerCase().endsWith('.json')) return valor
  return join(EXPORT_DIR, `${valor}.json`)
}

// ============================================================================
// Retry (o pooler do Neon derruba conexão em loop longo)
// ============================================================================

const ERRO_DE_CONEXAO = /ECONNRESET|ETIMEDOUT|EPIPE|P1001|P1002|P1008|P1017|Connection|terminat|timed out|closed/i

async function comRetry<T>(fn: () => Promise<T>, tentativas = 3): Promise<T> {
  let ultimo: unknown
  for (let i = 1; i <= tentativas; i++) {
    try {
      return await fn()
    } catch (err) {
      ultimo = err
      const msg = err instanceof Error ? err.message : String(err)
      // Só repete erro de conexão: repetir um erro de dados (ex.: unicidade) não resolve nada.
      if (!ERRO_DE_CONEXAO.test(msg) || i === tentativas) throw err
      console.warn(`  ⚠ tentativa ${i}/${tentativas} falhou (${msg.split('\n').pop()}) — aguardando 1s…`)
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  throw ultimo
}

// ============================================================================
// Contexto da execução e ids acumulados entre as fases
// ============================================================================

type Ids = Map<number, string>

/** codigoOrigem (legado) → id do Vizor, por entidade. Alimentado do banco e depois pelas fases. */
interface IdsState {
  linha: Ids
  cobertura: Ids
  processo: Ids
  suporte: Ids
  centro: Ids
  produto: Ids
  plano: Ids
  atividade: Ids
  restricao: Ids
  material: Ids
  itemDiverso: Ids
  campo: Ids
  quebra: Ids
}

interface Ctx {
  empresaId: string
  dryRun: boolean
  dados: Record<string, LinhaBruta[]>
  ids: IdsState
  /** Plano de relações da fase `relacoes` (usado pelo dry-run das `roteiros`). */
  relacoesPlanejadas?: PlanoRelacoes
}

/** Delegate Prisma genérico (cada fase escolhe o model; o contrato é o mesmo). */
interface Delegate {
  findMany(args: unknown): Promise<Array<Record<string, unknown>>>
  create(args: unknown): Promise<{ id: string }>
  createMany(args: unknown): Promise<{ count: number }>
  updateMany(args: unknown): Promise<{ count: number }>
}
const delegate = (d: unknown) => d as Delegate

function tabela(c: Ctx, nome: string): LinhaBruta[] {
  const t = c.dados[nome]
  if (!Array.isArray(t)) {
    console.warn(`  ⚠ tabela "${nome}" ausente no arquivo exportado (tratada como vazia).`)
    return []
  }
  return t
}

const codigoInteiro = (v: unknown): number | null => {
  const n = numero(v)
  return n !== null && Number.isInteger(n) ? n : null
}

/** Códigos cancelados no legado (campo de situação = CANCELADO). */
function canceladosDe(linhas: readonly LinhaBruta[], campoCodigo: string, campoAtivo: string): Set<number> {
  const out = new Set<number>()
  for (const l of linhas) {
    if (normalizarNome(l[campoAtivo]) !== 'cancelado') continue
    const c = codigoInteiro(l[campoCodigo])
    if (c !== null) out.add(c)
  }
  return out
}

function mesclar(destino: Ids, origem: ReadonlyMap<number, string>) {
  for (const [k, v] of origem) destino.set(k, v)
}

/** Carrega do banco o mapa `codigoOrigem → id` de uma entidade (empresaId explícito). */
async function idsDoBanco(model: unknown, empresaId: string): Promise<Ids> {
  const linhas = await comRetry(() =>
    delegate(model).findMany({ where: { empresaId, codigoOrigem: { not: null } }, select: { id: true, codigoOrigem: true } }),
  )
  const mapa: Ids = new Map()
  for (const l of linhas) if (typeof l.codigoOrigem === 'number') mapa.set(l.codigoOrigem, String(l.id))
  return mapa
}

async function carregarIds(empresaId: string): Promise<IdsState> {
  const [linha, cobertura, processo, suporte, centro, produto, plano, atividade, restricao, material, itemDiverso, campo, quebra] =
    await Promise.all([
      idsDoBanco(prisma.linhaProduto, empresaId),
      idsDoBanco(prisma.coberturaTinta, empresaId),
      idsDoBanco(prisma.processoImpressao, empresaId),
      idsDoBanco(prisma.suporteGrafico, empresaId),
      idsDoBanco(prisma.centroProducao, empresaId),
      idsDoBanco(prisma.produtoGrafico, empresaId),
      idsDoBanco(prisma.tipoPlanoGrafico, empresaId),
      idsDoBanco(prisma.acabamentoGrafico, empresaId),
      idsDoBanco(prisma.restricaoAcabamento, empresaId),
      idsDoBanco(prisma.materialAcabamento, empresaId),
      idsDoBanco(prisma.itemDiversoGrafico, empresaId),
      idsDoBanco(prisma.campoLivre, empresaId),
      idsDoBanco(prisma.quebraGrafica, empresaId),
    ])
  return { linha, cobertura, processo, suporte, centro, produto, plano, atividade, restricao, material, itemDiverso, campo, quebra }
}

// ============================================================================
// Empresa (EXIGE que exista; este script nunca cria empresa)
// ============================================================================

async function garantirEmpresaId(): Promise<string> {
  const id = arg('empresa')
  if (!id) throw new Error('Informe --empresa <id> (obrigatória).')
  const e = await comRetry(() => prisma.empresa.findUnique({ where: { id } }))
  if (!e) throw new Error(`Empresa ${id} não encontrada. Este script não cria empresa.`)
  console.log(`Empresa alvo: ${e.razaoSocial} (${e.id})`)
  return e.id
}

// ============================================================================
// Runners genéricos: planejam e executam uma entidade (por origem ou por chave natural)
// ============================================================================

interface CfgOrigem {
  fase: string
  model: unknown
  itens: ItemLegado[]
  /** Campo do nome no Vizor (`nome` por padrão; `descricao` em Suportes e Centros). */
  campoNome?: string
  /** Campo da chave textual (`codigo`), quando existe. */
  campoChave?: string
  /** Campo de situação gravado ao criar (`ativo` ou `status`). */
  campoStatus?: string
  where?: Record<string, unknown>
  /** Nome do existente para o casamento, quando difere do campo nome (ex.: `acabamentoId|nome`). */
  nomeExistente?: (row: Record<string, unknown>) => string
  opcoes?: OpcoesPlanejamento
  /** `false` para entidades que o importador não cria (Centros, Suportes). */
  cria?: boolean
}

const textoDe = (v: unknown) => (v === null || v === undefined ? '' : String(v))

/** Valor "vazio" para preenchimento de Decimal numérico: null ou 0. */
const zeroOuVazio = (v: unknown) => v === null || v === undefined || Number(v) === 0

async function rodarPorOrigem(c: Ctx, cfg: CfgOrigem): Promise<ResultadoExecucao> {
  const d = delegate(cfg.model)
  const campoNome = cfg.campoNome ?? 'nome'
  const linhas = await comRetry(() => d.findMany({ where: { empresaId: c.empresaId, ...(cfg.where ?? {}) } }))
  const existentes: ExistenteCadastro[] = linhas.map((r) => ({
    id: String(r.id),
    codigoOrigem: typeof r.codigoOrigem === 'number' ? r.codigoOrigem : null,
    nome: cfg.nomeExistente ? cfg.nomeExistente(r) : textoDe(r[campoNome]),
    chave: cfg.campoChave ? (r[cfg.campoChave] as string | null) ?? null : null,
    campos: r as Campos,
  }))
  const plano = planejarPorOrigem(cfg.fase, cfg.itens, existentes, {
    ...(cfg.opcoes ?? {}),
    criaQuandoSemEquivalente: cfg.cria ?? true,
  })
  const executor: ExecutorCadastro = {
    criar: async (item) => {
      const data: Record<string, unknown> = {
        empresaId: c.empresaId,
        [campoNome]: item.nome,
        ...(item.codigoOrigem !== null ? { codigoOrigem: item.codigoOrigem } : {}),
        ...(cfg.campoChave && item.chave ? { [cfg.campoChave]: item.chave } : {}),
        ...(cfg.campoStatus ? { [cfg.campoStatus]: true } : {}),
        ...item.dados,
      }
      const r = await comRetry(() => d.create({ data, select: { id: true } }))
      return r.id
    },
    atualizar: async (id, patch) => {
      await comRetry(() => d.updateMany({ where: { id, empresaId: c.empresaId }, data: patch }))
    },
  }
  return executarPlano(plano, executor, { dryRun: c.dryRun })
}

interface CfgChave {
  fase: string
  model: unknown
  itens: ItemLegado[]
  where?: Record<string, unknown>
  /** Chave natural de um registro existente (a mesma regra usada no mapeamento). */
  chaveExistente: (row: Record<string, unknown>) => string | undefined
  opcoes?: OpcoesPlanejamento
  /** Campos extras no create (ex.: `chave` do parâmetro). */
  criarExtra?: (item: ItemLegado) => Record<string, unknown>
}

async function rodarPorChave(c: Ctx, cfg: CfgChave): Promise<ResultadoExecucao> {
  const d = delegate(cfg.model)
  const linhas = await comRetry(() => d.findMany({ where: { empresaId: c.empresaId, ...(cfg.where ?? {}) } }))
  const existentes: ExistenteCadastro[] = linhas.map((r) => ({
    id: String(r.id),
    codigoOrigem: null,
    nome: '',
    chaveNatural: cfg.chaveExistente(r),
    campos: r as Campos,
  }))
  const plano = planejarPorChaveNatural(cfg.fase, cfg.itens, existentes, cfg.opcoes)
  const executor: ExecutorCadastro = {
    criar: async (item) => {
      const data = { empresaId: c.empresaId, ...item.dados, ...(cfg.criarExtra ? cfg.criarExtra(item) : {}) }
      const r = await comRetry(() => d.create({ data, select: { id: true } }))
      return r.id
    },
    atualizar: async (id, patch) => {
      await comRetry(() => d.updateMany({ where: { id, empresaId: c.empresaId }, data: patch }))
    },
  }
  return executarPlano(plano, executor, { dryRun: c.dryRun })
}

/** Traduz a RelTabelas bruta (números garantidos) — usada por atividades, relações e roteiros. */
function linhasRelTabelas(c: Ctx): LinhaRelTabelas[] {
  return tabela(c, 'RelTabelas').map((l) => ({
    CodTabela1: Number(l.CodTabela1),
    CodItem1: Number(l.CodItem1),
    CodTabela2: Number(l.CodTabela2),
    CodItem2: Number(l.CodItem2),
    descartar: flag(l.descartar),
  }))
}


// ============================================================================
// FASE catalogos — Linhas, Coberturas, Processos + casamento de Suportes e Centros
// ============================================================================

/** Itens só com código + nome (Suportes e Centros: o importador só grava `codigoOrigem`). */
function itensPorNome(linhas: readonly LinhaBruta[]): ItemLegado[] {
  const out: ItemLegado[] = []
  for (const l of linhas) {
    const codigo = codigoInteiro(l.Codigo)
    const nome = textoDe(l.Nome).replace(/\s+/g, ' ').trim()
    if (codigo === null || !nome) continue
    out.push({ codigoOrigem: codigo, nome, dados: {}, cancelado: normalizarNome(l.Ativo) === 'cancelado' })
  }
  return out
}

async function faseCatalogos(c: Ctx): Promise<RelatorioFase[]> {
  const out: RelatorioFase[] = []
  const simples = async (
    fase: string,
    model: unknown,
    itens: ItemLegado[],
    destino: Ids,
  ) => {
    const r = await rodarPorOrigem(c, { fase, model, itens, campoChave: 'codigo', campoStatus: 'ativo' })
    mesclar(destino, r.idsPorCodigo)
    out.push(r.relatorio)
  }
  await simples('catalogos:linhas', prisma.linhaProduto, mapearLinhas(tabela(c, 'Linhas')), c.ids.linha)
  await simples('catalogos:coberturas', prisma.coberturaTinta, mapearCoberturas(tabela(c, 'CoberturasTinta')), c.ids.cobertura)
  await simples('catalogos:processos', prisma.processoImpressao, mapearProcessos(tabela(c, 'Processos')), c.ids.processo)

  // Suportes e Centros já existem no Vizor: só casa por nome e grava `codigoOrigem` (nunca cria).
  const suportes = await rodarPorOrigem(c, {
    fase: 'catalogos:suportes',
    model: prisma.suporteGrafico,
    itens: itensPorNome(tabela(c, 'Suportes')),
    campoNome: 'descricao',
    cria: false,
  })
  mesclar(c.ids.suporte, suportes.idsPorCodigo)
  out.push(suportes.relatorio)

  const centros = await rodarPorOrigem(c, {
    fase: 'catalogos:centros',
    model: prisma.centroProducao,
    itens: itensPorNome(tabela(c, 'CentrosProducao')),
    campoNome: 'descricao',
    cria: false,
  })
  mesclar(c.ids.centro, centros.idsPorCodigo)
  out.push(centros.relatorio)
  return out
}

// ============================================================================
// FASE produtos — ProdutoGrafico
// ============================================================================

async function faseProdutos(c: Ctx): Promise<RelatorioFase[]> {
  const tributacoes: Ids = new Map()
  for (const t of tabela(c, 'TributacaoVenda')) {
    const cod = codigoInteiro(t.Codigo)
    if (cod !== null) tributacoes.set(cod, textoDe(t.Nome))
  }
  const itens = mapearProdutos(tabela(c, 'Produtos'), { idsLinha: c.ids.linha, tributacoes })
  const r = await rodarPorOrigem(c, {
    fase: 'produtos',
    model: prisma.produtoGrafico,
    itens,
    campoChave: 'codigo',
    campoStatus: 'status',
  })
  mesclar(c.ids.produto, r.idsPorCodigo)
  return [r.relatorio]
}

// ============================================================================
// FASE planos — TipoPlanoGrafico (junta `CaracteristicasPlano`)
// ============================================================================

async function fasePlanos(c: Ctx): Promise<RelatorioFase[]> {
  const itens = mapearPlanos(tabela(c, 'Planos'), tabela(c, 'CaracteristicasPlano'), {
    idsLinha: c.ids.linha,
    idsSuporte: c.ids.suporte,
  })
  const r = await rodarPorOrigem(c, {
    fase: 'planos',
    model: prisma.tipoPlanoGrafico,
    itens,
    campoChave: 'codigo',
    campoStatus: 'status',
    // margens guardam 0 como "não informado".
    opcoes: { tratarComoVazio: { margem1Mm: zeroOuVazio, margem2Mm: zeroOuVazio } },
  })
  mesclar(c.ids.plano, r.idsPorCodigo)
  return [r.relatorio]
}

// ============================================================================
// FASE atividades — AcabamentoGrafico + RestricaoAcabamento
// ============================================================================

async function faseAtividades(c: Ctx): Promise<RelatorioFase[]> {
  const linhasAtividades = tabela(c, 'Atividades')
  const acond = codigosAcondicionamento(traduzirRelTabelas(linhasRelTabelas(c)).relacoes)
  const atividades = await rodarPorOrigem(c, {
    fase: 'atividades',
    model: prisma.acabamentoGrafico,
    itens: mapearAtividades(linhasAtividades, { codigosAcondicionamento: acond }),
    campoChave: 'codigo',
    campoStatus: 'status',
  })
  mesclar(c.ids.atividade, atividades.idsPorCodigo)

  // Restrições: o casamento por nome é `acabamentoId|nome` (mesma atividade).
  const restricoes = await rodarPorOrigem(c, {
    fase: 'atividades:restricoes',
    model: prisma.restricaoAcabamento,
    itens: mapearRestricoes(tabela(c, 'Restricoes'), {
      idsAtividade: c.ids.atividade,
      atividadesCanceladas: canceladosDe(linhasAtividades, 'Codigo', 'Ativo'),
    }),
    nomeExistente: (r) => `${textoDe(r.acabamentoGraficoId)}|${textoDe(r.nome)}`,
  })
  mesclar(c.ids.restricao, restricoes.idsPorCodigo)
  return [atividades.relatorio, restricoes.relatorio]
}

// ============================================================================
// FASE materiais — MaterialAcabamento (preço da tabela de custo vigente, coluna 1)
// ============================================================================

async function faseMateriais(c: Ctx): Promise<RelatorioFase[]> {
  const itens = mapearMateriais(tabela(c, 'Materiais'), {
    codigosMedidaLinear: materiaisComMedidaLinear(tabela(c, 'Atividades')),
  })
  const r = await rodarPorOrigem(c, {
    fase: 'materiais',
    model: prisma.materialAcabamento,
    itens,
    campoChave: 'codigo',
    campoStatus: 'ativo',
    // valorReferencia 0 conta como vazio (padrão do schema).
    opcoes: { tratarComoVazio: { valorReferencia: zeroOuVazio } },
  })
  mesclar(c.ids.material, r.idsPorCodigo)
  return [r.relatorio]
}

// ============================================================================
// FASE materiais-tipo-param — MaterialAcabamento.tipoParam (moda de TipoParamAcab
// por CodMaterial). Só preenche campo VAZIO; respeita --dry-run. Spec
// orcamento-grafico-catalogo-no-editor, tarefa 1.6.
// ============================================================================

async function faseMateriaisTipoParam(c: Ctx): Promise<RelatorioFase[]> {
  const rel = relatorioVazio('materiais-tipo-param')
  const modas = modaTipoParamPorMaterial(tabela(c, 'MateriaisTipoParam'))
  const d = delegate(prisma.materialAcabamento)
  const linhas = await comRetry(() =>
    d.findMany({ where: { empresaId: c.empresaId, codigoOrigem: { not: null } }, select: { id: true, codigoOrigem: true, nome: true, tipoParam: true } }),
  )
  const porOrigem = new Map<number, Record<string, unknown>>()
  for (const l of linhas) if (typeof l.codigoOrigem === 'number') porOrigem.set(l.codigoOrigem, l)

  const ignorar = (motivo: string) => {
    rel.ignorados++
    rel.ignoradosPorMotivo[motivo] = (rel.ignoradosPorMotivo[motivo] ?? 0) + 1
  }
  for (const [cod, moda] of modas) {
    const mat = porOrigem.get(cod)
    if (!mat) {
      rel.naoCasados.push({ codigoOrigem: cod, nome: `material ${cod}`, motivo: 'MATERIAL_NAO_ENCONTRADO', detalhe: `tipoParam ${moda.tipoParam} sem MaterialAcabamento com este codigoOrigem` })
      continue
    }
    if (mat.tipoParam !== null && mat.tipoParam !== undefined) {
      ignorar('JA_PREENCHIDO')
      continue
    }
    if (moda.empate) {
      rel.naoCasados.push({ codigoOrigem: cod, nome: textoDe(mat.nome), motivo: 'EMPATE_NA_MODA', detalhe: `gravado o menor tipo (${moda.tipoParam}); revisar` })
    }
    if (!c.dryRun) {
      // `tipoParam: null` no where: nunca sobrescreve valor já preenchido.
      await comRetry(() => d.updateMany({ where: { id: String(mat.id), empresaId: c.empresaId, tipoParam: null }, data: { tipoParam: moda.tipoParam } }))
    }
    rel.atualizados++
  }
  const semUso = [...porOrigem.keys()].filter((cod) => !modas.has(cod)).length
  if (semUso > 0) {
    rel.ignorados += semUso
    rel.ignoradosPorMotivo.SEM_USO_NO_CALCGRAF = semUso
  }
  return [rel]
}

// ============================================================================
// FASE itens-diversos — ItemDiversoGrafico
// ============================================================================

async function faseItensDiversos(c: Ctx): Promise<RelatorioFase[]> {
  const r = await rodarPorOrigem(c, {
    fase: 'itens-diversos',
    model: prisma.itemDiversoGrafico,
    itens: mapearItensDiversos(tabela(c, 'ItensDiversos')),
    campoStatus: 'status',
  })
  mesclar(c.ids.itemDiverso, r.idsPorCodigo)
  return [r.relatorio]
}

// ============================================================================
// FASE relacoes — RelacaoCadastroGrafico (tradução código a código da RelTabelas)
// ============================================================================

async function faseRelacoes(c: Ctx): Promise<RelatorioFase[]> {
  const resolvedor: ResolvedorRelacoes = {
    ids: {
      SUPORTE: c.ids.suporte,
      ITEM_DIVERSO: c.ids.itemDiverso,
      PLANO: c.ids.plano,
      COBERTURA_TINTA: c.ids.cobertura,
      ATIVIDADE: c.ids.atividade,
      ACONDICIONAMENTO: c.ids.atividade, // destino do acondicionamento é uma atividade
      LINHA: c.ids.linha,
      CENTRO: c.ids.centro,
      PRODUTO: c.ids.produto,
      MATERIAL: c.ids.material,
      // TINTA e MATRIZ não têm cadastro com `codigoOrigem` no Vizor: viram "não casados".
    },
    cancelados: {
      SUPORTE: canceladosDe(tabela(c, 'Suportes'), 'Codigo', 'Ativo'),
      ITEM_DIVERSO: canceladosDe(tabela(c, 'ItensDiversos'), 'Codigo', 'Ativo'),
      PLANO: canceladosDe(tabela(c, 'Planos'), 'CODIGO', 'ATIVO'),
      COBERTURA_TINTA: canceladosDe(tabela(c, 'CoberturasTinta'), 'Codigo', 'Ativo'),
      ATIVIDADE: canceladosDe(tabela(c, 'Atividades'), 'Codigo', 'Ativo'),
      ACONDICIONAMENTO: canceladosDe(tabela(c, 'Atividades'), 'Codigo', 'Ativo'),
      LINHA: canceladosDe(tabela(c, 'Linhas'), 'Codigo', 'Ativo'),
      CENTRO: canceladosDe(tabela(c, 'CentrosProducao'), 'Codigo', 'Ativo'),
      PRODUTO: canceladosDe(tabela(c, 'Produtos'), 'Codigo', 'Ativo'),
      MATERIAL: canceladosDe(tabela(c, 'Materiais'), 'Codigo', 'Ativo'),
    },
  }
  const existentes = (await comRetry(() =>
    delegate(prisma.relacaoCadastroGrafico).findMany({
      where: { empresaId: c.empresaId },
      select: { tipoOrigem: true, idOrigem: true, tipoDestino: true, idDestino: true },
    }),
  )) as unknown as { tipoOrigem: string; idOrigem: string; tipoDestino: string; idDestino: string }[]

  const plano = planejarRelacoes(linhasRelTabelas(c), resolvedor, existentes)
  c.relacoesPlanejadas = plano

  if (!c.dryRun) {
    const criar = plano.operacoes.flatMap((op) => (op.tipo === 'CRIAR' ? [op.relacao] : []))
    for (let i = 0; i < criar.length; i += TAMANHO_LOTE) {
      const lote = criar.slice(i, i + TAMANHO_LOTE).map((r) => ({
        empresaId: c.empresaId,
        tipoOrigem: r.tipoOrigem,
        idOrigem: r.idOrigem,
        tipoDestino: r.tipoDestino,
        idDestino: r.idDestino,
      }))
      await comRetry(() => delegate(prisma.relacaoCadastroGrafico).createMany({ data: lote, skipDuplicates: true }))
    }
  }
  return [relatorioDeRelacoes(plano)]
}

// ============================================================================
// FASE roteiros — `ordem` das relações PLANO→ATIVIDADE e PRODUTO→ATIVIDADE
// ============================================================================

async function faseRoteiros(c: Ctx): Promise<RelatorioFase[]> {
  const roteiros: LinhaRoteiro[] = tabela(c, 'Roteiros').map((l) => ({
    CodLinhaProduto: Number(l.CodLinhaProduto),
    CodPlanoCad: Number(l.CodPlanoCad),
    Ordem: Number(l.Ordem),
    CodAtividade: Number(l.CodAtividade),
    FlagCheck: l.FlagCheck === undefined ? undefined : Number(l.FlagCheck),
  }))
  const linhaDoPlano = new Map<number, number>()
  for (const p of tabela(c, 'Planos')) {
    const cod = codigoInteiro(p.CODIGO)
    const linha = codigoInteiro(p.CODLINHAPRODUTO)
    if (cod !== null && linha !== null) linhaDoPlano.set(cod, linha)
  }
  const linhaDoProduto = new Map<number, number>()
  for (const p of tabela(c, 'Produtos')) {
    const cod = codigoInteiro(p.Codigo)
    const linha = codigoInteiro(p.CodLinhaProduto)
    if (cod !== null && linha !== null) linhaDoProduto.set(cod, linha)
  }

  const traducao = traduzirRelTabelas(linhasRelTabelas(c))
  const resultado = aplicarRoteiro({ roteiros, relacoes: traducao.relacoes, linhaDoPlano, linhaDoProduto })

  // Relações do Vizor que podem receber ordem (PLANO/PRODUTO → ATIVIDADE).
  const linhas = (await comRetry(() =>
    delegate(prisma.relacaoCadastroGrafico).findMany({
      where: { empresaId: c.empresaId, tipoOrigem: { in: ['PLANO', 'PRODUTO'] }, tipoDestino: 'ATIVIDADE' },
      select: { id: true, tipoOrigem: true, idOrigem: true, tipoDestino: true, idDestino: true, ordem: true },
    }),
  )) as unknown as { id: string; tipoOrigem: string; idOrigem: string; tipoDestino: string; idDestino: string; ordem: number | null }[]
  const relacoes: RelacaoParaOrdem[] = linhas.map((r) => ({ ...r, ordem: r.ordem ?? null }))

  // Em dry-run as relações da fase anterior ainda não existem no banco: entram com id nulo.
  if (c.dryRun && c.relacoesPlanejadas) {
    const jaTem = new Set(relacoes.map((r) => `${r.tipoOrigem}|${r.idOrigem}|${r.tipoDestino}|${r.idDestino}`))
    for (const op of c.relacoesPlanejadas.operacoes) {
      if (op.tipo !== 'CRIAR') continue
      const r = op.relacao
      if (!['PLANO', 'PRODUTO'].includes(r.tipoOrigem) || r.tipoDestino !== 'ATIVIDADE') continue
      const chave = `${r.tipoOrigem}|${r.idOrigem}|${r.tipoDestino}|${r.idDestino}`
      if (!jaTem.has(chave)) relacoes.push({ id: null, tipoOrigem: r.tipoOrigem, idOrigem: r.idOrigem, tipoDestino: r.tipoDestino, idDestino: r.idDestino, ordem: null })
    }
  }

  const ops = planejarOrdens(resultado.ordens, c.ids.plano, c.ids.produto, c.ids.atividade, relacoes)
  const rel = relatorioVazio('roteiros')
  const ignorar = (motivo: string, n = 1) => {
    rel.ignorados += n
    rel.ignoradosPorMotivo[motivo] = (rel.ignoradosPorMotivo[motivo] ?? 0) + n
  }
  for (const op of ops) {
    if (op.tipo === 'IGNORAR') {
      ignorar(op.motivo)
      continue
    }
    if (!c.dryRun && op.id) {
      // `ordem: null` no where: nunca sobrescreve uma ordem já preenchida.
      await comRetry(() =>
        delegate(prisma.relacaoCadastroGrafico).updateMany({ where: { id: op.id, empresaId: c.empresaId, ordem: null }, data: { ordem: op.ordem } }),
      )
    }
    rel.atualizados++
  }
  if (resultado.semOrdem > 0) ignorar('SEM_ORDEM_999', resultado.semOrdem)
  for (const dv of resultado.divergencias) {
    rel.naoCasados.push({ codigoOrigem: null, nome: dv.descricao, motivo: dv.tipo, detalhe: 'divergência com a RelTabelas (só informativa; nada foi alterado)' })
  }
  return [rel]
}

// ============================================================================
// FASE defaults — DefaultProdutoPlano (produto × plano)
// ============================================================================

async function faseDefaults(c: Ctx): Promise<RelatorioFase[]> {
  const itens = mapearDefaults(tabela(c, 'ProdutosPlanos'), tabela(c, 'ProdutosAtividades'), {
    idsProduto: c.ids.produto,
    idsPlano: c.ids.plano,
    idsProcesso: c.ids.processo,
    idsCobertura: c.ids.cobertura,
    idsAtividade: c.ids.atividade,
    produtosCancelados: canceladosDe(tabela(c, 'Produtos'), 'Codigo', 'Ativo'),
  })
  const r = await rodarPorChave(c, {
    fase: 'defaults',
    model: prisma.defaultProdutoPlano,
    itens,
    chaveExistente: (row) => `${textoDe(row.produtoId)}|${textoDe(row.tipoPlanoId)}`,
    // 0 é o valor padrão do schema (não informado).
    opcoes: { tratarComoVazio: { coresFrente: zeroOuVazio, coresVerso: zeroOuVazio, areaTintaPerc: zeroOuVazio } },
  })
  return [r.relatorio]
}

// ============================================================================
// FASE campos-livres — CampoLivre + CampoLivreOpcao + cópia solicitação → pedido
// (sem os valores preenchidos: `ConteudoCl` não é importado)
// ============================================================================

async function faseCamposLivres(c: Ctx): Promise<RelatorioFase[]> {
  const linhasCampos = tabela(c, 'CamposLivres')
  const campos = await rodarPorOrigem(c, {
    fase: 'campos-livres',
    model: prisma.campoLivre,
    itens: mapearCamposLivres(linhasCampos),
    campoStatus: 'status',
    // O casamento por nome é `proprietário|nome` (o mesmo nome existe em proprietários diferentes).
    nomeExistente: (r) => `${textoDe(r.proprietario)}|${textoDe(r.nome)}`,
  })
  mesclar(c.ids.campo, campos.idsPorCodigo)

  const opcoes = await rodarPorChave(c, {
    fase: 'campos-livres:opcoes',
    model: prisma.campoLivreOpcao,
    itens: mapearOpcoesCampo(tabela(c, 'CamposLivresLista'), c.ids.campo, canceladosDe(linhasCampos, 'CodChave', 'Ativo')),
    chaveExistente: (r) => `${textoDe(r.campoLivreId)}|${normalizarNome(r.valor)}`,
  })

  // Cópia do valor da solicitação para o pedido: só preenche `copiaParaPedidoCampoId` vazio.
  const atuais = new Map<string, string | null>()
  const existentes = await comRetry(() =>
    delegate(prisma.campoLivre).findMany({ where: { empresaId: c.empresaId }, select: { id: true, copiaParaPedidoCampoId: true } }),
  )
  for (const r of existentes) atuais.set(String(r.id), (r.copiaParaPedidoCampoId as string | null) ?? null)
  const copia = planejarCopiaCampos(lerRelacionamentosCampos(tabela(c, 'CamposLivresRelacionamentos')), c.ids.campo, atuais)
  const relCopia = relatorioVazio('campos-livres:copia-para-pedido')
  for (const d of copia.definir) {
    if (!c.dryRun) {
      await comRetry(() =>
        delegate(prisma.campoLivre).updateMany({
          where: { id: d.id, empresaId: c.empresaId, copiaParaPedidoCampoId: null },
          data: { copiaParaPedidoCampoId: d.destinoId },
        }),
      )
    }
    relCopia.atualizados++
  }
  if (copia.ignorados > 0) {
    relCopia.ignorados = copia.ignorados
    relCopia.ignoradosPorMotivo.JA_COMPLETO = copia.ignorados
  }
  for (const n of copia.naoCasados) {
    relCopia.naoCasados.push({ codigoOrigem: n.origem, nome: `campo ${n.origem} → campo ${n.destino}`, motivo: 'DEPENDENCIA_SEM_EQUIVALENTE', detalhe: n.detalhe })
  }
  return [campos.relatorio, opcoes.relatorio, relCopia]
}

// ============================================================================
// FASE ajustes — AjusteProdutividade (só cadastro; não entra no motor)
// ============================================================================

async function faseAjustes(c: Ctx): Promise<RelatorioFase[]> {
  const idsRestricaoPorNome = new Map<string, string>()
  for (const l of tabela(c, 'Restricoes')) {
    const cod = codigoInteiro(l.Codigo)
    const atividade = codigoInteiro(l.CodAtividade)
    const id = cod !== null ? c.ids.restricao.get(cod) : undefined
    if (id && atividade !== null) idsRestricaoPorNome.set(`${atividade}|${normalizarNome(l.Nome)}`, id)
  }
  const nomesCentro: Ids = new Map()
  for (const l of tabela(c, 'CentrosProducao')) {
    const cod = codigoInteiro(l.Codigo)
    if (cod !== null) nomesCentro.set(cod, textoDe(l.Nome))
  }
  const itens = mapearAjustes(tabela(c, 'AjustesProdutividade'), {
    idsAtividade: c.ids.atividade,
    idsCentro: c.ids.centro,
    atividadesCanceladas: canceladosDe(tabela(c, 'Atividades'), 'Codigo', 'Ativo'),
    idsRestricaoPorNome,
    nomesCentro,
  })
  const r = await rodarPorChave(c, {
    fase: 'ajustes',
    model: prisma.ajusteProdutividade,
    itens,
    chaveExistente: (row) =>
      chaveAjuste({
        acabamentoId: textoDe(row.acabamentoId),
        centroProducaoId: (row.centroProducaoId as string | null) ?? null,
        dadoAjustar: textoDe(row.dadoAjustar),
        funcao: textoDe(row.funcao),
        operador: (row.operador as string | null) ?? null,
        valor: (row.valor as string | null) ?? null,
        fator: Number(row.fator),
      }),
  })
  return [r.relatorio]
}

// ============================================================================
// FASE quebras — QuebraGrafica + QuebraGraficaLimite (só cadastro; não altera o motor)
// ============================================================================

async function faseQuebras(c: Ctx): Promise<RelatorioFase[]> {
  const linhasQuebras = tabela(c, 'Quebras')
  const quebras = await rodarPorOrigem(c, {
    fase: 'quebras',
    model: prisma.quebraGrafica,
    itens: mapearQuebras(linhasQuebras),
    campoStatus: 'status',
  })
  mesclar(c.ids.quebra, quebras.idsPorCodigo)

  const limites = await rodarPorChave(c, {
    fase: 'quebras:limites',
    model: prisma.quebraGraficaLimite,
    itens: mapearLimitesQuebra(tabela(c, 'QuebrasLimites'), c.ids.quebra, canceladosDe(linhasQuebras, 'Codigo', 'Ativo')),
    chaveExistente: (r) => `${textoDe(r.quebraId)}|${textoDe(r.tiragemAte)}`,
  })
  return [quebras.relatorio, limites.relatorio]
}

// ============================================================================
// FASE limites-montagem — LimiteMontagem (formato final → mínimo e máximo)
// ============================================================================

async function faseLimitesMontagem(c: Ctx): Promise<RelatorioFase[]> {
  const r = await rodarPorChave(c, {
    fase: 'limites-montagem',
    model: prisma.limiteMontagem,
    itens: mapearLimitesMontagem(tabela(c, 'LimitesMontagem')),
    chaveExistente: (row) => chaveLimiteMontagem(Number(row.formatoFinalLargura), Number(row.formatoFinalAltura)),
    opcoes: { tratarComoVazio: { minimo: zeroOuVazio, maximo: zeroOuVazio } },
  })
  return [r.relatorio]
}

// ============================================================================
// FASE parametros — Parametro `orc.*` (só a lista fechada de chaves)
// ============================================================================

async function faseParametros(c: Ctx): Promise<RelatorioFase[]> {
  const r = await rodarPorChave(c, {
    fase: 'parametros',
    model: prisma.parametro,
    itens: mapearParametros(tabela(c, 'Parametros')),
    where: { chave: { startsWith: 'orc.' } },
    chaveExistente: (row) => textoDe(row.chave),
    criarExtra: (item) => ({ chave: item.chaveNatural }),
  })
  return [r.relatorio]
}

// ============================================================================
// MAIN
// ============================================================================

const FASES: Record<NomeFase, (c: Ctx) => Promise<RelatorioFase[]>> = {
  catalogos: faseCatalogos,
  produtos: faseProdutos,
  planos: fasePlanos,
  atividades: faseAtividades,
  materiais: faseMateriais,
  'materiais-tipo-param': faseMateriaisTipoParam,
  'itens-diversos': faseItensDiversos,
  relacoes: faseRelacoes,
  roteiros: faseRoteiros,
  defaults: faseDefaults,
  'campos-livres': faseCamposLivres,
  ajustes: faseAjustes,
  quebras: faseQuebras,
  'limites-montagem': faseLimitesMontagem,
  parametros: faseParametros,
}

function gravarRelatorioJson(caminho: string, conteudo: unknown) {
  mkdirSync(dirname(caminho), { recursive: true })
  writeFileSync(caminho, JSON.stringify(conteudo, null, 2), 'utf8')
}

async function main() {
  const dryRun = flagCli('dry-run')
  const faseArg = arg('fase')
  if (faseArg && !(FASES_ORDEM as readonly string[]).includes(faseArg)) {
    throw new Error(`Fase "${faseArg}" desconhecida. Válidas: ${FASES_ORDEM.join(', ')}.`)
  }
  const fases: NomeFase[] = faseArg ? [faseArg as NomeFase] : [...FASES_ORDEM]

  const empresaId = await garantirEmpresaId()

  const caminhoArquivo = resolverArquivo(arg('arquivo'))
  if (!existsSync(caminhoArquivo)) throw new Error(`Arquivo ${caminhoArquivo} não encontrado.`)
  console.log(`Lendo ${caminhoArquivo} …`)
  const dados = JSON.parse(readFileSync(caminhoArquivo, 'utf8').replace(/^\uFEFF/, '')) as Record<string, LinhaBruta[]>

  const caminhoRelatorio = arg('relatorio') ?? RELATORIO_PADRAO
  if (dryRun) console.log('*** DRY-RUN: nada será gravado no banco. ***')

  // Ids já existentes no banco (por codigoOrigem): permitem rodar uma fase isolada.
  const ctx: Ctx = { empresaId, dryRun, dados, ids: await carregarIds(empresaId) }

  const relatorios: RelatorioFase[] = []
  const erros: { fase: string; erro: string }[] = []
  const salvar = () =>
    gravarRelatorioJson(caminhoRelatorio, {
      geradoEm: new Date().toISOString(),
      empresaId,
      dryRun,
      arquivo: caminhoArquivo,
      fasesSolicitadas: fases,
      totais: totalizar(relatorios),
      erros,
      relatorios,
    })

  for (const fase of fases) {
    console.log(`\n▶ Fase ${fase}${dryRun ? ' (dry-run)' : ''}`)
    try {
      const rels = await FASES[fase](ctx)
      for (const r of rels) {
        relatorios.push(r)
        console.log(
          `  [${r.fase}] criados=${r.criados} atualizados=${r.atualizados} ignorados=${r.ignorados} não-casados=${r.naoCasados.length}`,
        )
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`  ✖ Fase ${fase} falhou: ${msg}`)
      erros.push({ fase, erro: msg })
      process.exitCode = 1
      salvar()
      break // fases seguintes dependem dos ids desta
    }
    salvar() // grava após cada fase: se a execução cair, o que já foi feito fica registrado
  }

  console.log('\n' + formatarRelatorio(relatorios, { dryRun }))
  salvar()
  console.log(`\nRelatório JSON: ${caminhoRelatorio}`)
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
