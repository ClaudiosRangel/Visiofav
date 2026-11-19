// Funções PURAS do Plano_Base (somente exibição) e da regra da sigla.
//
// Spec: orcamento-grafico-paridade-fluxo-legado (tarefa 2.5).
// Req 4.9, 6.9, 6.10, 8.1, 8.2, 8.5.
//
// O Plano_Base é a linha "Base" de `PlanoCalculoGrafico` gravada na cópia de um
// cálculo para o item. Ele só EXIBE a engenharia do cálculo: não tem resultado
// nem colunas `custo*`, e a reconsolidação por somaPlanos o ignora
// (`especificacao.somenteExibicao === true`).
//
// Regra de ouro (Req 8.5): campo ausente na origem fica `null` ou lista vazia.
// Sem default, sem zero, sem inferência. Não toca banco, não chama o motor.

import type { FotoRicaCalculo } from './foto-rica.types'

export const NOME_PLANO_BASE = 'Base'
export const SIGLA_VARIOS = '(vários)'

/**
 * Subconjunto de `CalculoGrafico` que o Plano_Base lê (engenharia). Aceita os
 * tipos do Prisma (Decimal/Json) e valores `null`/ausentes.
 */
export interface CalculoParaPlanoBase {
  papelDescricao?: string | null
  gramatura?: unknown
  formatoCorteLarguraMm?: unknown
  formatoCorteAlturaMm?: unknown
  /** Json: `[{ nome, coberturaPercent, ... }]` (shape de CorInput). */
  cores?: unknown
  /** Json: `[{ nome, ... }]` (shape de AcabamentoRicoInput). */
  acabamentosRicos?: unknown
}

export interface PlanoBaseCor {
  nome: string
  cobertura: number | null
}

export interface PlanoBase {
  nome: typeof NOME_PLANO_BASE
  suporte: { nome: string | null; gramatura: number | null } | null
  formatoCorte: { larguraMm: number; alturaMm: number } | null
  cores: PlanoBaseCor[]
  coberturaTinta: number | null
  atividades: string[]
  /** R$ com 2 casas, ou null quando a Foto não traz o custo. */
  custoPlano: number | null
}

/** Valor gravado em `PlanoCalculoGrafico.especificacao` do Plano_Base. */
export interface EspecificacaoPlanoBase {
  versao: 1
  base: true
  somenteExibicao: true
  suporte: PlanoBase['suporte']
  formatoCorte: PlanoBase['formatoCorte']
  cores: PlanoBaseCor[]
  coberturaTinta: number | null
  atividades: string[]
  custoPlano: number | null
}

/** Plano_Base pronto para gravar: colunas `custo*` e resultado ficam nulos. */
export interface PlanoBaseParaGravar {
  nome: typeof NOME_PLANO_BASE
  especificacao: EspecificacaoPlanoBase
  resultadoCalculo: null
  custoSuporte: null
  custoImpressao: null
  custoAcabamento: null
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Número finito a partir de number/string/Decimal; null caso contrário. */
function num(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() === '') return null
  const n = Number(typeof v === 'object' ? (v as { toString(): string }).toString() : v)
  return Number.isFinite(n) ? n : null
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function arredonda2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Interpreta "L x A" (aceita vírgula decimal). Sem match → null. */
function parseFormatoTexto(
  t: string | null | undefined,
): { larguraMm: number; alturaMm: number } | null {
  if (!t) return null
  const m = String(t).match(/(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)/i)
  if (!m) return null
  const l = Number(m[1].replace(',', '.'))
  const a = Number(m[2].replace(',', '.'))
  return Number.isFinite(l) && Number.isFinite(a) ? { larguraMm: l, alturaMm: a } : null
}

// ── montagem ─────────────────────────────────────────────────────────────────

/**
 * Monta o Plano_Base a partir da engenharia do cálculo e da Foto.
 * Precedência por campo: engenharia do cálculo primeiro; se ausente, o dado
 * equivalente da Foto (primeiro plano, tintas, acabamentos). Ausente nos dois
 * lados → null / lista vazia.
 */
export function montarPlanoBase(
  calc: CalculoParaPlanoBase,
  foto: FotoRicaCalculo | null | undefined,
): PlanoBase {
  const planoFoto = foto?.planos?.[0]

  // Suporte (nome + gramatura)
  const suporteNome = texto(calc.papelDescricao) ?? texto(planoFoto?.suporte)
  const suporteGram = num(calc.gramatura) ?? num(planoFoto?.gramatura)
  const suporte =
    suporteNome == null && suporteGram == null
      ? null
      : { nome: suporteNome, gramatura: suporteGram }

  // Formato de corte (largura x altura em mm)
  const l = num(calc.formatoCorteLarguraMm)
  const a = num(calc.formatoCorteAlturaMm)
  const formatoCorte =
    l != null && a != null
      ? { larguraMm: l, alturaMm: a }
      : parseFormatoTexto(planoFoto?.formatoCorte)

  // Cores (nome + cobertura)
  let cores: PlanoBaseCor[] = arr(calc.cores)
    .map((c) => {
      const o = (c ?? {}) as Record<string, unknown>
      const nome = texto(o.nome)
      return nome ? { nome, cobertura: num(o.coberturaPercent) } : null
    })
    .filter((c): c is PlanoBaseCor => c !== null)
  if (cores.length === 0) {
    cores = arr(foto?.tintas)
      .map((t) => {
        const o = (t ?? {}) as Record<string, unknown>
        const nome = texto(o.nome)
        return nome ? { nome, cobertura: num(o.coberturaPercent) } : null
      })
      .filter((c): c is PlanoBaseCor => c !== null)
  }

  // Cobertura de tinta: só quando todas as cores trazem a MESMA cobertura.
  // Sem consenso (ou sem dado) fica null — não se calcula média nem se infere.
  let coberturaTinta: number | null = null
  const cobs = cores.map((c) => c.cobertura)
  if (cobs.length > 0 && cobs.every((c) => c != null && c === cobs[0])) {
    coberturaTinta = cobs[0]
  }

  // Atividades de acabamento (nome de cada)
  let atividades = arr(calc.acabamentosRicos)
    .map((x) => texto(((x ?? {}) as Record<string, unknown>).nome))
    .filter((n): n is string => n !== null)
  if (atividades.length === 0) {
    atividades = arr(foto?.acabamentos)
      .map((x) => texto(((x ?? {}) as Record<string, unknown>).descricao))
      .filter((n): n is string => n !== null)
  }

  // Custo do plano (R$, 2 casas) — da Foto
  const custoBruto = num(foto?.custos?.custoProducao)
  const custoPlano = custoBruto == null ? null : arredonda2(custoBruto)

  return {
    nome: NOME_PLANO_BASE,
    suporte,
    formatoCorte,
    cores,
    coberturaTinta,
    atividades,
    custoPlano,
  }
}

/**
 * Converte o Plano_Base no registro a gravar em `PlanoCalculoGrafico`:
 * `especificacao = { versao: 1, base: true, somenteExibicao: true, ... }`,
 * `resultadoCalculo = null` e colunas `custo*` nulas.
 */
export function planoBaseParaGravar(plano: PlanoBase): PlanoBaseParaGravar {
  return {
    nome: plano.nome,
    especificacao: {
      versao: 1,
      base: true,
      somenteExibicao: true,
      suporte: plano.suporte,
      formatoCorte: plano.formatoCorte,
      cores: plano.cores,
      coberturaTinta: plano.coberturaTinta,
      atividades: plano.atividades,
      custoPlano: plano.custoPlano,
    },
    resultadoCalculo: null,
    custoSuporte: null,
    custoImpressao: null,
    custoAcabamento: null,
  }
}

// ── sigla ────────────────────────────────────────────────────────────────────

/**
 * Regra da sigla: mais de uma sigla distinta → "(vários)"; exatamente uma → a
 * própria sigla; nenhuma → null. Siglas vazias/brancas são desconsideradas.
 */
export function resolverSigla(
  siglas: ReadonlyArray<string | null | undefined>,
): string | null {
  const distintas = new Set<string>()
  for (const s of siglas) {
    const t = texto(s)
    if (t) distintas.add(t)
  }
  if (distintas.size === 0) return null
  if (distintas.size === 1) return [...distintas][0]
  return SIGLA_VARIOS
}
