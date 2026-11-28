/**
 * Editor do Cálculo — serviço (spec orcamento-editor-calculo, design §3–§5).
 *
 * - Lê os Tipos de Plano do item (planos do item ou o plano implícito do produto de plano único),
 *   gera/regera as folhas (`gerarFolhas`) e grava em `folha_calculo_grafico` / `atividade_folha_grafico`.
 * - Calcula cada folha com o motor atual (`montarParamsDoPlano` → `calcularPlano`), sem alterá-lo.
 * - Item sem folhas não passa por aqui (cálculo de hoje). `empresaId` explícito em toda consulta.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '../../../lib/prisma'
import {
  montarParamsDoPlano,
  type AcabamentoRicoInput,
  type CorInput,
  type ItemOrcamentoInput,
  type PlanoCalculoInput,
} from '../orcamento-grafico-item.service'
import type { ParamsOrcamento, ResultadoOrcamento } from '../orcamento-grafico-calculo.service'
import { calcularPlano } from '../plano-calculo.service'
import {
  CAMPOS_GERADOS,
  classeDaAtividade,
  gerarFolhas,
  modeloDaLinha,
  nomeExibido,
  type FolhaExistente,
  type ImpressaoEntrada,
  type ModeloLinha,
  type PapelFolha,
  type TipoPlanoEntrada,
} from './gerar-folhas'

export class EditorCalculoError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
  }
}

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const r2 = (x: number) => Math.round(x * 100) / 100

// ============================================================================
// Leitura
// ============================================================================

export async function modeloDoItem(empresaId: string, itemId: string): Promise<{ modelo: ModeloLinha; linha: string | null }> {
  const item = await prisma.itemOrcamentoGrafico.findFirst({
    where: { id: itemId, empresaId },
    select: { produtoGraficoId: true, orcamento: { select: { linhaProdutoId: true } } },
  })
  let linhaId: string | null = item?.orcamento?.linhaProdutoId ?? null
  if (item?.produtoGraficoId) {
    const p = await prisma.produtoGrafico.findFirst({
      where: { id: item.produtoGraficoId, empresaId },
      select: { linhaProdutoId: true },
    })
    linhaId = p?.linhaProdutoId ?? linhaId
  }
  if (!linhaId) return { modelo: 'SIMPLES', linha: null }
  const linha = await prisma.linhaProduto.findFirst({ where: { id: linhaId, empresaId }, select: { nome: true, modelo: true } })
  return { modelo: modeloDaLinha(linha?.modelo), linha: linha?.nome ?? null }
}

interface EspecSuporte { suporteId?: unknown; fornecido?: unknown; cores?: unknown; processoImpressao?: unknown; coberturaTinta?: unknown }

function suporteDaEspec(b: unknown): { suporteId: string | null; fornecido: boolean } | null {
  if (!b || typeof b !== 'object') return null
  const e = b as EspecSuporte
  return { suporteId: typeof e.suporteId === 'string' && e.suporteId ? e.suporteId : null, fornecido: e.fornecido === true }
}

function impressaoDoPlano(p: { numCores: number; cores: unknown; maquinaId: string | null }, esp: Record<string, unknown>): ImpressaoEntrada | null {
  const cores = Array.isArray(p.cores) ? p.cores : []
  if (p.numCores <= 0 && cores.length === 0) return null
  return {
    cores: typeof esp.cores === 'string' ? esp.cores : null,
    processoImpressao: typeof esp.processoImpressao === 'string' ? esp.processoImpressao : null,
    coberturaTinta: (esp.coberturaTinta as number | string | null | undefined) ?? null,
    maquinaId: p.maquinaId,
    numCores: p.numCores,
    tintas: cores,
  }
}

/** Ids das atividades em `acabamentosRicos` (lista do plano ou do item). */
function idsDeAcabamentos(json: unknown): string[] {
  if (!Array.isArray(json)) return []
  const ids: string[] = []
  for (const a of json) {
    const id = (a as { acabamentoId?: unknown })?.acabamentoId
    if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

async function classesDasAtividades(empresaId: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, ReturnType<typeof classeDaAtividade>>()
  const acab = await prisma.acabamentoGrafico.findMany({
    where: { empresaId, id: { in: ids } },
    select: { id: true, nome: true, centroProducao: { select: { tipoProcesso: { select: { codigo: true } } } } },
  })
  return new Map(acab.map((a) => [a.id, classeDaAtividade({ nome: a.nome, tipoProcessoCodigo: a.centroProducao?.tipoProcesso?.codigo ?? null })]))
}

/** Tipos de Plano do item + atividades do produto (item de vários planos). */
export async function tiposDoItem(empresaId: string, itemId: string): Promise<{ tipos: TipoPlanoEntrada[]; atividadesProduto: string[] }> {
  const item = await prisma.itemOrcamentoGrafico.findFirst({
    where: { id: itemId, empresaId },
    select: {
      descricao: true, papelId: true, gramatura: true, cores: true, maquinaId: true, acabamentosRicos: true,
      formatoCorteLarguraMm: true, formatoCorteAlturaMm: true, microondulado: true, microSuporteId: true,
    },
  })
  if (!item) throw new EditorCalculoError(404, 'Item de orçamento não encontrado')
  const planos = (
    await prisma.planoCalculoGrafico.findMany({
      where: { itemId, empresaId },
      orderBy: { sequencia: 'asc' },
      select: {
        id: true, nome: true, suporteId: true, gramatura: true, formatoLarguraMm: true, formatoAlturaMm: true,
        numCores: true, cores: true, maquinaId: true, acabamentosRicos: true, especificacao: true,
      },
    })
  ).filter((p) => (p.especificacao as { somenteExibicao?: unknown } | null)?.somenteExibicao !== true)

  if (planos.length === 0) {
    // Plano único: o item é o plano implícito.
    const ids = idsDeAcabamentos(item.acabamentosRicos)
    const classes = await classesDasAtividades(empresaId, ids)
    const cores = Array.isArray(item.cores) ? item.cores : []
    return {
      atividadesProduto: [],
      tipos: [
        {
          planoId: null,
          nome: (item.descricao ?? '').trim().slice(0, 60) || 'Plano',
          tiragem: null,
          ocorrencias: 1,
          formatoLarguraMm: null,
          formatoAlturaMm: null,
          formatoFolhaLarguraMm: num(item.formatoCorteLarguraMm),
          formatoFolhaAlturaMm: num(item.formatoCorteAlturaMm),
          capa: { suporteId: item.papelId, gramatura: num(item.gramatura) },
          impressao: cores.length > 0
            ? { cores: null, processoImpressao: null, coberturaTinta: null, maquinaId: item.maquinaId, numCores: cores.length, tintas: cores }
            : null,
          // Microondulado do item de plano único (combo "Microondulado" da tela do item).
          micro: item.microSuporteId ? { suporteId: item.microSuporteId } : null,
          atividades: ids.map((id) => ({ acabamentoId: id, classe: classes.get(id) ?? 'OUTRA' })),
        },
      ],
    }
  }

  const todosIds = [...new Set(planos.flatMap((p) => idsDeAcabamentos(p.acabamentosRicos)))]
  const classes = await classesDasAtividades(empresaId, todosIds)
  const tipos: TipoPlanoEntrada[] = planos.map((p) => {
    const esp = (p.especificacao ?? {}) as Record<string, unknown>
    const aberto = esp.formatoAberto as { largura?: unknown; altura?: unknown } | null | undefined
    const capaInt = suporteDaEspec(esp.capaInterna)
    const ci = (esp.capaInterna ?? {}) as EspecSuporte
    return {
      planoId: p.id,
      nome: p.nome,
      tiragem: num(esp.tiragem),
      ocorrencias: num(esp.ocorrencias) ?? 1,
      formatoLarguraMm: num(aberto?.largura),
      formatoAlturaMm: num(aberto?.altura),
      formatoFolhaLarguraMm: num(p.formatoLarguraMm),
      formatoFolhaAlturaMm: num(p.formatoAlturaMm),
      capa: { suporteId: p.suporteId, gramatura: num(p.gramatura) },
      impressao: impressaoDoPlano(p, esp),
      micro: suporteDaEspec(esp.microondulado),
      capaInterna: capaInt
        ? {
            ...capaInt,
            impressao: typeof ci.cores === 'string' && /[1-9]/.test(ci.cores)
              ? {
                  cores: ci.cores,
                  processoImpressao: typeof ci.processoImpressao === 'string' ? ci.processoImpressao : null,
                  coberturaTinta: (ci.coberturaTinta as number | null | undefined) ?? null,
                  numCores: (ci.cores.match(/\d+/g) ?? []).reduce((s, n) => s + Number(n), 0),
                }
              : null,
          }
        : null,
      atividades: idsDeAcabamentos(p.acabamentosRicos).map((id) => ({ acabamentoId: id, classe: classes.get(id) ?? 'OUTRA' })),
    }
  })
  return { tipos, atividadesProduto: idsDeAcabamentos(item.acabamentosRicos) }
}

export type FolhaRegistro = Awaited<ReturnType<typeof listarFolhas>>[number]

export function listarFolhas(empresaId: string, itemId: string) {
  return prisma.folhaCalculoGrafico.findMany({ where: { itemId, empresaId }, orderBy: { sequencia: 'asc' } })
}

export function listarAtividades(empresaId: string, itemId: string) {
  return prisma.atividadeFolhaGrafico.findMany({ where: { itemId, empresaId }, orderBy: { sequencia: 'asc' } })
}

/** O item tem Planos do Cálculo? Falha de leitura = não (o item segue o cálculo de hoje). */
export async function itemTemFolhas(empresaId: string, itemId: string): Promise<boolean> {
  try {
    return (await prisma.folhaCalculoGrafico.count({ where: { itemId, empresaId } })) > 0
  } catch {
    return false
  }
}

const lista = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** Marca em `camposManuais` da atividade: o "Aplicado sobre" foi definido no Editor. */
export const MARCA_APLICADO_SOBRE = 'aplicadoSobre'

// ============================================================================
// Geração / regeração
// ============================================================================

/** Gera (ou regera) as folhas do item. Preserva avulsas, campos digitados e detalhes das atividades. */
export async function gerarFolhasDoItem(empresaId: string, itemId: string): Promise<void> {
  const { modelo } = await modeloDoItem(empresaId, itemId)
  const { tipos, atividadesProduto } = await tiposDoItem(empresaId, itemId)
  const existentes = await listarFolhas(empresaId, itemId)
  const ativExistentes = await listarAtividades(empresaId, itemId)

  const paraGerador: FolhaExistente[] = existentes.map((f) => ({
    id: f.id,
    planoId: f.planoId,
    papel: f.papel as PapelFolha,
    sequencia: f.sequencia,
    camposManuais: lista(f.camposManuais),
    valores: {
      nome: f.nome, tiragem: f.tiragem, ocorrencias: f.ocorrencias,
      formatoLarguraMm: num(f.formatoLarguraMm), formatoAlturaMm: num(f.formatoAlturaMm),
      formatoFolhaLarguraMm: num(f.formatoFolhaLarguraMm), formatoFolhaAlturaMm: num(f.formatoFolhaAlturaMm),
      suporteId: f.suporteId, gramatura: num(f.gramatura), impressao: f.impressao,
    },
  }))
  const gerado = gerarFolhas(modelo, tipos, paraGerador)

  // Detalhes digitados das atividades, por (folha antiga, atividade).
  const detalhePorChave = new Map(
    ativExistentes.map((a) => [`${a.folhaId ?? 'produto'}|${a.acabamentoId}`, a]),
  )

  await prisma.$transaction(async (tx) => {
    const manter = new Set(gerado.folhas.map((f) => f.idExistente).filter((x): x is string => !!x))
    await tx.folhaCalculoGrafico.deleteMany({ where: { itemId, empresaId, id: { notIn: [...manter] } } })
    // Sequências temporárias negativas para não bater no unique (itemId, sequencia).
    await tx.folhaCalculoGrafico.updateMany({ where: { itemId, empresaId }, data: { sequencia: { multiply: -1 } } })
    const idDaFolha: string[] = []
    for (const f of gerado.folhas) {
      const dados = {
        planoId: f.planoId, papel: f.papel, sequencia: f.sequencia, nome: f.nome.slice(0, 60), tiragem: f.tiragem,
        ocorrencias: f.ocorrencias, formatoLarguraMm: f.formatoLarguraMm, formatoAlturaMm: f.formatoAlturaMm,
        formatoFolhaLarguraMm: f.formatoFolhaLarguraMm, formatoFolhaAlturaMm: f.formatoFolhaAlturaMm,
        suporteId: f.suporteId, gramatura: f.gramatura,
        impressao: (f.impressao ?? undefined) as Prisma.InputJsonValue | undefined,
        camposManuais: f.camposManuais as unknown as Prisma.InputJsonValue,
        alteradaNoEditor: f.alteradaNoEditor,
      }
      if (f.idExistente) {
        // AVULSO não é tocada pela geração (só a posição).
        const data = f.papel === 'AVULSO' ? { sequencia: f.sequencia } : dados
        await tx.folhaCalculoGrafico.updateMany({ where: { id: f.idExistente, empresaId }, data })
        idDaFolha.push(f.idExistente)
      } else {
        const criada = await tx.folhaCalculoGrafico.create({ data: { ...dados, empresaId, itemId } })
        idDaFolha.push(criada.id)
      }
    }
    // "Aplicado sobre" já ajustado no Editor: mantém a distribuição feita à mão (as atividades de folhas
    // removidas caem junto com a folha) e só acrescenta as atividades novas marcadas no Tipo de Plano.
    if (ativExistentes.some((a) => lista(a.camposManuais).includes(MARCA_APLICADO_SOBRE))) {
      const restantes = await tx.atividadeFolhaGrafico.findMany({ where: { itemId, empresaId }, select: { acabamentoId: true, sequencia: true } })
      const jaTem = new Set(restantes.map((a) => a.acabamentoId))
      let seqM = restantes.reduce((m, a) => Math.max(m, a.sequencia), 0)
      const novos = new Set<string>()
      for (const a of gerado.atividades) {
        if (jaTem.has(a.acabamentoId) || novos.has(`${a.folha}|${a.acabamentoId}`)) continue
        novos.add(`${a.folha}|${a.acabamentoId}`)
        seqM++
        await tx.atividadeFolhaGrafico.create({
          data: { empresaId, itemId, folhaId: a.folha === null ? null : idDaFolha[a.folha], acabamentoId: a.acabamentoId, sequencia: seqM },
        })
      }
      return
    }
    // Atividades: as das folhas geradas são recriadas (com os detalhes antigos); as das avulsas ficam.
    const idsAvulsas = gerado.folhas.filter((f) => f.papel === 'AVULSO').map((f) => f.idExistente!)
    await tx.atividadeFolhaGrafico.deleteMany({
      where: { itemId, empresaId, OR: [{ folhaId: null }, { folhaId: { notIn: idsAvulsas } }] },
    })
    let seq = 0
    const criar = async (folhaId: string | null, acabamentoId: string) => {
      const antiga = detalhePorChave.get(`${folhaId ?? 'produto'}|${acabamentoId}`)
      seq++
      await tx.atividadeFolhaGrafico.create({
        data: {
          empresaId, itemId, folhaId, acabamentoId, sequencia: seq,
          detalhes: (antiga?.detalhes ?? undefined) as Prisma.InputJsonValue | undefined,
          camposManuais: (antiga?.camposManuais ?? undefined) as Prisma.InputJsonValue | undefined,
          materiais: (antiga?.materiais ?? undefined) as Prisma.InputJsonValue | undefined,
          infoComplementar: antiga?.infoComplementar ?? null,
        },
      })
    }
    for (const a of gerado.atividades) await criar(a.folha === null ? null : idDaFolha[a.folha], a.acabamentoId)
    for (const id of atividadesProduto) await criar(null, id)
  })
}

// ============================================================================
// Cálculo das folhas
// ============================================================================

export interface DetalhesAtividade {
  tiragem?: number | null
  producaoHora?: number | null
  entradas?: number | null
  repeticoes?: string | null
  tempoPrimeiroAcertoMin?: number | null
  quantAcertos?: number | null
  tempoPorAcertoMin?: number | null
  quebraFixa?: number | null
  quebraVariavel?: number | null
  formatoCorte?: string | null
  centroProducaoId?: string | null
  restricaoIds?: string[]
}

export interface OpcoesFolha {
  naoCalcular?: boolean
  naoCobrarImpressao?: boolean
  naoExibirProposta?: boolean
  tiraRetira?: boolean
  pinca?: boolean
  refileFolha?: number | null
  refileFinal?: number | null
  contraPinca?: number | null
  corteDuplo?: number | null
}

/** Acabamentos do motor para a folha: base do item/plano + detalhes digitados no Editor. */
function acabamentosDaFolha(
  base: Map<string, AcabamentoRicoInput>,
  atividades: Array<{ acabamentoId: string; detalhes: unknown }>,
): AcabamentoRicoInput[] {
  return atividades.map((a) => {
    const d = (a.detalhes ?? {}) as DetalhesAtividade
    const b = base.get(a.acabamentoId) ?? { acabamentoId: a.acabamentoId }
    return {
      ...b,
      acabamentoId: a.acabamentoId,
      ...(num(d.producaoHora) != null ? { producaoHora: Number(d.producaoHora) } : {}),
      ...(num(d.quantAcertos) != null ? { quantAcertos: Number(d.quantAcertos) } : {}),
      ...(num(d.tempoPorAcertoMin) != null ? { tempoPorAcertoMin: Number(d.tempoPorAcertoMin) } : {}),
      ...(num(d.tempoPrimeiroAcertoMin) != null ? { tempoPrimeiroAcertoMin: Number(d.tempoPrimeiroAcertoMin) } : {}),
    }
  })
}

/** Folha sem impressão (micro, impressão vazia ou "não cobrar impressão"): tira máquina e tinta do custo. */
function semImpressao(r: ResultadoOrcamento): ResultadoOrcamento {
  const maq = Number(r.maquinas?.custoTotal ?? 0)
  const tinta = Number(r.tinta?.custoTotal ?? 0)
  if (maq <= 0 && tinta <= 0) return r
  const custoAntes = Number(r.custoProducao) || 0
  r.custoTransformacao = r2(Math.max(0, r.custoTransformacao - maq))
  r.materialDireto = r2(Math.max(0, r.materialDireto - tinta))
  r.custoProducao = r2(r.materialDireto + r.custoTransformacao + r.servicoExterno)
  r.custoTotal = r2(Math.max(0, r.custoTotal - maq - tinta))
  if (custoAntes > 0) r.precoVenda = r2(r.precoVenda * (r.custoProducao / custoAntes))
  r.maquinas = { ...r.maquinas, custoTotal: 0 }
  r.tinta = { ...r.tinta, custoTotal: 0 }
  return r
}

export interface FolhaCalculada {
  folhaId: string
  sequencia: number
  resultado: ResultadoOrcamento | null
  params: ParamsOrcamento | null
}

/**
 * Calcula as folhas do item na `quantidade` informada (tiragem do item quando omitida). Não grava.
 * `inputBase` = input do item já montado pela rota (`reconstruirInputBaseDoItem`).
 */
export async function calcularFolhas(
  empresaId: string,
  itemId: string,
  inputBase: ItemOrcamentoInput,
  quantidade?: number,
): Promise<FolhaCalculada[]> {
  const folhas = await listarFolhas(empresaId, itemId)
  const atividades = await listarAtividades(empresaId, itemId)
  const planos = await prisma.planoCalculoGrafico.findMany({
    where: { itemId, empresaId },
    select: { id: true, acabamentosRicos: true },
  })
  const base = new Map<string, AcabamentoRicoInput>()
  const juntar = (json: unknown) => {
    if (!Array.isArray(json)) return
    for (const a of json as AcabamentoRicoInput[]) if (a?.acabamentoId && !base.has(a.acabamentoId)) base.set(a.acabamentoId, a)
  }
  for (const p of planos) juntar(p.acabamentosRicos)
  juntar(inputBase.acabamentosRicos)

  const produto = atividades.filter((a) => a.folhaId === null)
  const saida: FolhaCalculada[] = []
  for (const f of folhas) {
    const opcoes = (f.opcoes ?? {}) as OpcoesFolha
    if (opcoes.naoCalcular) {
      saida.push({ folhaId: f.id, sequencia: f.sequencia, resultado: null, params: null })
      continue
    }
    const daFolha = atividades.filter((a) => a.folhaId === f.id)
    // Atividades do produto entram uma vez, na 1ª folha calculada.
    const comProduto = saida.every((s) => s.resultado === null) ? [...daFolha, ...produto] : daFolha
    const impressoes = (Array.isArray(f.impressao) ? f.impressao : []) as unknown as ImpressaoEntrada[]
    const imp = impressoes[0]
    const tintas = (Array.isArray(imp?.tintas) ? imp?.tintas : []) as CorInput[]
    const nc = (f.suporteNc ?? null) as { custoKg?: unknown; gramatura?: unknown } | null
    const qtdBase = quantidade ?? f.tiragem ?? inputBase.quantidade
    const input: ItemOrcamentoInput = {
      ...inputBase,
      quantidade: Math.max(1, Math.round(qtdBase * (f.ocorrencias > 0 ? f.ocorrencias : 1))),
      ...(f.aproveitamento && f.aproveitamento > 0 ? { aproveitamentoManual: f.aproveitamento, montagemLinhas: null, montagemColunas: null } : {}),
      ...(num(f.quebraVariavel) != null
        ? { perdasOverride: { ...(inputBase.perdasOverride ?? {}), impressaoPercent: Number(f.quebraVariavel) } }
        : {}),
    }
    const plano: PlanoCalculoInput = {
      nome: f.nome,
      suporteId: nc && num(nc.custoKg) ? null : f.suporteId,
      gramatura: num(nc?.gramatura) ?? num(f.gramatura) ?? undefined,
      precoKgPapel: num(nc?.custoKg) ?? undefined,
      formatoLarguraMm: num(f.formatoFolhaLarguraMm) ?? undefined,
      formatoAlturaMm: num(f.formatoFolhaAlturaMm) ?? undefined,
      numCores: tintas.length,
      cores: tintas,
      maquinaId: imp?.maquinaId ?? null,
      acabamentosRicos: acabamentosDaFolha(base, comProduto),
    }
    const params = await montarParamsDoPlano(empresaId, input, plano)
    let resultado = calcularPlano(params)
    if (f.papel === 'MICRO' || !imp || tintas.length === 0 || opcoes.naoCobrarImpressao) resultado = semImpressao(resultado)
    saida.push({ folhaId: f.id, sequencia: f.sequencia, resultado, params })
  }
  return saida
}

/** Calcula e grava o resultado de cada folha. */
export async function recalcularEGravarFolhas(empresaId: string, itemId: string, inputBase: ItemOrcamentoInput) {
  const calculadas = await calcularFolhas(empresaId, itemId, inputBase)
  for (const c of calculadas) {
    await prisma.folhaCalculoGrafico.updateMany({
      where: { id: c.folhaId, empresaId },
      data: {
        resultadoCalculo: (c.resultado ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
        custoTotal: c.resultado ? r2(Number(c.resultado.custoProducao) || 0) : 0,
      },
    })
  }
  return calculadas
}

// ============================================================================
// Visão do Editor
// ============================================================================

export async function montarVisaoEditor(empresaId: string, orcamentoId: string, itemId: string) {
  const item = await prisma.itemOrcamentoGrafico.findFirst({
    where: { id: itemId, orcamentoId, empresaId },
    select: {
      id: true, descricao: true, quantidade: true, siglaAcabado: true, medidas: true, custoProducao: true, valorTotal: true,
      calculoGraficoId: true, calculoGraficoOrigemId: true,
      orcamento: { select: { numero: true, status: true } },
    },
  })
  if (!item) throw new EditorCalculoError(404, 'Item de orçamento não encontrado')
  const idCalculo = item.calculoGraficoId ?? item.calculoGraficoOrigemId
  const calculoDoItem = idCalculo
    ? await prisma.calculoGrafico.findFirst({ where: { id: idCalculo, empresaId }, select: { numero: true, numeroCalcgraf: true } })
    : null
  const numeroCalculo = calculoDoItem ? (calculoDoItem.numeroCalcgraf ?? calculoDoItem.numero ?? null) : null
  const { modelo, linha } = await modeloDoItem(empresaId, itemId)
  let calculoOrigem: number | null = null
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: number | null }>>(
      `SELECT COALESCE(c.numero_calcgraf, c.numero) AS n FROM item_orcamento_grafico i
         JOIN calculo_grafico c ON c.id = i.calculo_grafico_origem_id AND c.empresa_id = i.empresa_id
        WHERE i.id = $1 AND i.empresa_id = $2`,
      itemId,
      empresaId,
    )
    calculoOrigem = rows[0]?.n != null ? Number(rows[0].n) : null
  } catch {
    calculoOrigem = null
  }
  const folhas = await listarFolhas(empresaId, itemId)
  const atividades = await listarAtividades(empresaId, itemId)
  const ids = [...new Set(atividades.map((a) => a.acabamentoId))]
  const nomes = ids.length
    ? new Map((await prisma.acabamentoGrafico.findMany({ where: { empresaId, id: { in: ids } }, select: { id: true, nome: true } })).map((a) => [a.id, a.nome]))
    : new Map<string, string>()
  const suporteIds = [...new Set(folhas.map((f) => f.suporteId).filter((x): x is string => !!x))]
  const suportes = suporteIds.length
    ? new Map((await prisma.precoMateriaPrima.findMany({ where: { empresaId, id: { in: suporteIds } }, select: { id: true, descricao: true } })).map((p) => [p.id, p.descricao]))
    : new Map<string, string>()
  return {
    item: {
      id: item.id,
      descricao: item.descricao,
      tiragem: item.quantidade,
      siglaAcabado: item.siglaAcabado,
      medidas: item.medidas,
      custoProducao: num(item.custoProducao),
      valorTotal: num(item.valorTotal),
      numeroOrcamento: item.orcamento?.numero ?? null,
      editavel: item.orcamento?.status === 'RASCUNHO',
    },
    linhaProduto: linha,
    modelo,
    numeroCalculo,
    calculoOrigem,
    gerado: folhas.length > 0,
    folhas: folhas.map((f) => ({
      ...f,
      nomeExibido: nomeExibido({ nome: f.nome, papel: f.papel as PapelFolha }),
      suporteNome: f.suporteId ? suportes.get(f.suporteId) ?? null : null,
      camposManuais: lista(f.camposManuais),
      formatoLarguraMm: num(f.formatoLarguraMm),
      formatoAlturaMm: num(f.formatoAlturaMm),
      formatoFolhaLarguraMm: num(f.formatoFolhaLarguraMm),
      formatoFolhaAlturaMm: num(f.formatoFolhaAlturaMm),
      gramatura: num(f.gramatura),
      quebraFixa: num(f.quebraFixa),
      quebraVariavel: num(f.quebraVariavel),
      apara: num(f.apara),
      custoTotal: num(f.custoTotal),
    })),
    atividades: atividades.map((a) => ({ ...a, nome: nomes.get(a.acabamentoId) ?? 'Atividade', camposManuais: lista(a.camposManuais) })),
    custoFolhas: r2(folhas.reduce((s, f) => s + (num(f.custoTotal) ?? 0), 0)),
  }
}

// ============================================================================
// Edição
// ============================================================================

const CAMPOS_EDITAVEIS = [
  ...CAMPOS_GERADOS,
  'fibra', 'suporteNc', 'aproveitamento', 'quebraFixa', 'quebraVariavel', 'apara', 'opcoes',
] as const
type CampoEditavel = (typeof CAMPOS_EDITAVEIS)[number]

/** Grava a alteração de uma folha. Campos gerados digitados entram em `camposManuais`. */
export async function atualizarFolha(empresaId: string, itemId: string, folhaId: string, dados: Partial<Record<CampoEditavel, unknown>>) {
  const f = await prisma.folhaCalculoGrafico.findFirst({ where: { id: folhaId, itemId, empresaId } })
  if (!f) throw new EditorCalculoError(404, 'Plano do cálculo não encontrado')
  const manuais = new Set(lista(f.camposManuais))
  const data: Record<string, unknown> = {}
  for (const campo of CAMPOS_EDITAVEIS) {
    if (!(campo in dados)) continue
    data[campo] = dados[campo] ?? null
    if ((CAMPOS_GERADOS as readonly string[]).includes(campo) && f.papel !== 'AVULSO') manuais.add(campo)
  }
  if ('nome' in data && typeof data.nome === 'string') data.nome = data.nome.slice(0, 60)
  await prisma.folhaCalculoGrafico.updateMany({
    where: { id: folhaId, empresaId },
    data: { ...data, camposManuais: [...manuais] as unknown as Prisma.InputJsonValue, alteradaNoEditor: manuais.size > 0 || f.papel === 'AVULSO' } as Prisma.FolhaCalculoGraficoUpdateManyMutationInput,
  })
}

/** "Voltar ao calculado": tira o campo da lista de manuais (a próxima geração repõe o valor do Tipo de Plano). */
export async function limparCampoManual(empresaId: string, itemId: string, folhaId: string, campo: string) {
  const f = await prisma.folhaCalculoGrafico.findFirst({ where: { id: folhaId, itemId, empresaId }, select: { camposManuais: true } })
  if (!f) throw new EditorCalculoError(404, 'Plano do cálculo não encontrado')
  const manuais = lista(f.camposManuais).filter((c) => c !== campo)
  await prisma.folhaCalculoGrafico.updateMany({
    where: { id: folhaId, empresaId },
    data: { camposManuais: manuais as unknown as Prisma.InputJsonValue, alteradaNoEditor: manuais.length > 0 },
  })
}

async function proximaSequencia(tx: Prisma.TransactionClient, empresaId: string, itemId: string) {
  const ult = await tx.folhaCalculoGrafico.findFirst({ where: { itemId, empresaId }, orderBy: { sequencia: 'desc' }, select: { sequencia: true } })
  return (ult?.sequencia ?? 0) + 1
}

/** Inclui um plano à mão (AVULSO), com os padrões de folha do sistema de referência. */
export async function incluirFolha(empresaId: string, itemId: string, nome: string) {
  return prisma.$transaction(async (tx) => {
    const sequencia = await proximaSequencia(tx, empresaId, itemId)
    return tx.folhaCalculoGrafico.create({
      data: {
        empresaId, itemId, papel: 'AVULSO', sequencia, nome: (nome || 'Plano').slice(0, 60), alteradaNoEditor: true,
        opcoes: { tiraRetira: true, pinca: true, refileFolha: 2, refileFinal: 1, contraPinca: 8, corteDuplo: 0 },
      },
    })
  })
}

/** Copia uma folha (vira AVULSO) com as atividades dela. */
export async function copiarFolha(empresaId: string, itemId: string, folhaId: string) {
  const f = await prisma.folhaCalculoGrafico.findFirst({ where: { id: folhaId, itemId, empresaId } })
  if (!f) throw new EditorCalculoError(404, 'Plano do cálculo não encontrado')
  const ativ = await prisma.atividadeFolhaGrafico.findMany({ where: { folhaId, empresaId } })
  return prisma.$transaction(async (tx) => {
    const sequencia = await proximaSequencia(tx, empresaId, itemId)
    const { id: _id, criadoEm: _c, atualizadoEm: _a, resultadoCalculo: _r, ...resto } = f
    const nova = await tx.folhaCalculoGrafico.create({
      data: {
        ...(resto as unknown as Prisma.FolhaCalculoGraficoUncheckedCreateInput),
        papel: 'AVULSO', sequencia, nome: `${f.nome} (cópia)`.slice(0, 60), alteradaNoEditor: true,
        impressao: (f.impressao ?? undefined) as Prisma.InputJsonValue | undefined,
        suporteNc: (f.suporteNc ?? undefined) as Prisma.InputJsonValue | undefined,
        opcoes: (f.opcoes ?? undefined) as Prisma.InputJsonValue | undefined,
        camposManuais: (f.camposManuais ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    })
    for (const a of ativ) {
      await tx.atividadeFolhaGrafico.create({
        data: {
          empresaId, itemId, folhaId: nova.id, acabamentoId: a.acabamentoId, sequencia: a.sequencia,
          detalhes: (a.detalhes ?? undefined) as Prisma.InputJsonValue | undefined,
          camposManuais: (a.camposManuais ?? undefined) as Prisma.InputJsonValue | undefined,
          materiais: (a.materiais ?? undefined) as Prisma.InputJsonValue | undefined,
          infoComplementar: a.infoComplementar,
        },
      })
    }
    return nova
  })
}

export async function excluirFolha(empresaId: string, itemId: string, folhaId: string) {
  const r = await prisma.folhaCalculoGrafico.deleteMany({ where: { id: folhaId, itemId, empresaId } })
  if (r.count === 0) throw new EditorCalculoError(404, 'Plano do cálculo não encontrado')
}

/** Reordena as folhas na ordem dos ids informados (todos os do item). */
export async function reordenarFolhas(empresaId: string, itemId: string, ids: string[]) {
  const folhas = await prisma.folhaCalculoGrafico.findMany({ where: { itemId, empresaId }, select: { id: true } })
  const doItem = new Set(folhas.map((f) => f.id))
  if (ids.length !== doItem.size || ids.some((id) => !doItem.has(id))) {
    throw new EditorCalculoError(400, 'Informe todos os planos do cálculo do item, uma vez cada.')
  }
  await prisma.$transaction(async (tx) => {
    await tx.folhaCalculoGrafico.updateMany({ where: { itemId, empresaId }, data: { sequencia: { multiply: -1 } } })
    for (let i = 0; i < ids.length; i++) {
      await tx.folhaCalculoGrafico.updateMany({ where: { id: ids[i], empresaId }, data: { sequencia: i + 1 } })
    }
  })
}

/**
 * Atividades do Editor: lista completa com "Aplicado sobre". Mantém os detalhes de (folha, atividade)
 * que já existiam. `folhaIds` vazio = atividade do produto.
 */
export async function definirAtividades(
  empresaId: string,
  itemId: string,
  entrada: Array<{ acabamentoId: string; folhaIds: string[] }>,
) {
  const folhas = new Set((await prisma.folhaCalculoGrafico.findMany({ where: { itemId, empresaId }, select: { id: true } })).map((f) => f.id))
  const acabIds = [...new Set(entrada.map((e) => e.acabamentoId))]
  const validos = new Set(
    (await prisma.acabamentoGrafico.findMany({ where: { empresaId, id: { in: acabIds } }, select: { id: true } })).map((a) => a.id),
  )
  for (const e of entrada) {
    if (!validos.has(e.acabamentoId)) throw new EditorCalculoError(422, 'Atividade não encontrada no cadastro.')
    if (e.folhaIds.some((id) => !folhas.has(id))) throw new EditorCalculoError(422, 'Plano do cálculo inválido em "Aplicado sobre".')
  }
  const antigas = await listarAtividades(empresaId, itemId)
  const porChave = new Map(antigas.map((a) => [`${a.folhaId ?? 'produto'}|${a.acabamentoId}`, a]))
  await prisma.$transaction(async (tx) => {
    await tx.atividadeFolhaGrafico.deleteMany({ where: { itemId, empresaId } })
    let seq = 0
    for (const e of entrada) {
      const alvos: Array<string | null> = e.folhaIds.length > 0 ? e.folhaIds : [null]
      for (const folhaId of alvos) {
        const antiga = porChave.get(`${folhaId ?? 'produto'}|${e.acabamentoId}`)
        const manuais = [...new Set([...lista(antiga?.camposManuais), MARCA_APLICADO_SOBRE])]
        seq++
        await tx.atividadeFolhaGrafico.create({
          data: {
            empresaId, itemId, folhaId, acabamentoId: e.acabamentoId, sequencia: seq,
            detalhes: (antiga?.detalhes ?? undefined) as Prisma.InputJsonValue | undefined,
            camposManuais: manuais as unknown as Prisma.InputJsonValue,
            materiais: (antiga?.materiais ?? undefined) as Prisma.InputJsonValue | undefined,
            infoComplementar: antiga?.infoComplementar ?? null,
          },
        })
      }
    }
  })
}

/** Detalhes, materiais e informação complementar de uma atividade (por folha). */
export async function atualizarAtividade(
  empresaId: string,
  itemId: string,
  atividadeId: string,
  dados: { detalhes?: DetalhesAtividade; materiais?: unknown[]; infoComplementar?: string | null },
) {
  const a = await prisma.atividadeFolhaGrafico.findFirst({ where: { id: atividadeId, itemId, empresaId } })
  if (!a) throw new EditorCalculoError(404, 'Atividade não encontrada')
  const detalhes = dados.detalhes !== undefined ? dados.detalhes : a.detalhes
  const marca = lista(a.camposManuais).includes(MARCA_APLICADO_SOBRE) ? [MARCA_APLICADO_SOBRE] : []
  const manuais = dados.detalhes
    ? [...marca, ...Object.entries(dados.detalhes).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k]) => k)]
    : lista(a.camposManuais)
  await prisma.atividadeFolhaGrafico.updateMany({
    where: { id: atividadeId, empresaId },
    data: {
      detalhes: (detalhes ?? undefined) as Prisma.InputJsonValue | undefined,
      camposManuais: manuais as unknown as Prisma.InputJsonValue,
      ...(dados.materiais !== undefined ? { materiais: dados.materiais as Prisma.InputJsonValue } : {}),
      ...(dados.infoComplementar !== undefined ? { infoComplementar: dados.infoComplementar } : {}),
    },
  })
}
