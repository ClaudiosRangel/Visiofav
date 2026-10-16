/**
 * Funções PURAS de montagem do roteiro de OP do Calcgraf (Fase 2).
 *
 * Separadas do `calcgraf-reader.ts` (que faz I/O SQL) para serem testáveis sem
 * conexão. Convertem linhas cruas de `CalculoAtividades` (etapas) e
 * `CalculoPlanos`/`CalculoTintas`/`CalculoMatAcabamento` em pedaços do
 * `OpOrigemDTO` espelhado do backend.
 *
 * Referência: docs/calcgraf-mapeamento-roteiro-op.md (golden case OP 3000).
 */

// ===========================================================================
// Tipos de linha crua (subconjunto das colunas do Calcgraf que usamos)
// ===========================================================================

/** Linha de `CalculoAtividades` já com nomes de atividade/centro resolvidos. */
export interface AtividadeRow {
  tipo?: string // 'I' (impressão) | 'A' (acabamento)
  itemSeq1?: number
  itemSeq2?: number
  atividadeNome?: string // Atividades.Nome
  centroNome?: string // CentrosProducao.Nome
  quantAcertos?: number
  tempoPorAcerto?: number
  tempoPrimeiroAcerto?: number
  producaoHora?: number
  tiragem?: number
}

/** Linha de `CalculoPlanos` já com nome do suporte (papel) resolvido. */
export interface PlanoRow {
  Ordem?: number
  codPlano?: string | number
  nomePlano?: string
  suporteNome?: string // nome do papel resolvido de codSuporte
  gramatura?: number
  dimensao1?: number
  dimensao2?: number
  aproveitamento?: number
  tiragem?: number
}

/** Linha de `CalculoTintas` já com nome da tinta/Pantone. */
export interface TintaRow {
  codTinta?: string | number
  areaTinta?: number // % de cobertura
  ComplementoNome?: string // nome Pantone (ex.: "AMARELO - 123C")
}

// ===========================================================================
// DTO (espelho do backend — subconjunto montado aqui)
// ===========================================================================

export interface EtapaDTO {
  sequencia?: number
  centro?: string
  descricao?: string
  tipo?: string
  setupMinutos?: number
  operacaoMinutos?: number
}

export interface VariacaoDTO {
  sequencia?: number
  codigoPlano?: string
  nome?: string
  quantidade?: number
  suporte?: string
  gramatura?: number
  dimensao?: string
  aproveitamento?: number
}

// ===========================================================================
// Helpers numéricos
// ===========================================================================

/** Converte um valor desconhecido para número finito; 0 se inválido. */
export function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

// ===========================================================================
// Cálculo de tempos (Requisito 2)
// ===========================================================================

/**
 * Setup (min) = quantAcertos * tempoPorAcerto + tempoPrimeiroAcerto.
 * Valores ausentes/inválidos contam como 0.
 */
export function calcularSetupMin(r: {
  quantAcertos?: number
  tempoPorAcerto?: number
  tempoPrimeiroAcerto?: number
}): number {
  return num(r.quantAcertos) * num(r.tempoPorAcerto) + num(r.tempoPrimeiroAcerto)
}

/**
 * Operação (min) = tiragem / producaoHora * 60.
 * Retorna 0 quando `producaoHora <= 0` (sem divisão por zero / sem Infinity).
 */
export function calcularOperacaoMin(r: { producaoHora?: number; tiragem?: number }): number {
  const ph = num(r.producaoHora)
  if (ph <= 0) return 0
  return (num(r.tiragem) / ph) * 60
}

/**
 * Nome/descrição da etapa = "<Atividade> <Centro>" (com trim). Cai para o que
 * estiver disponível quando um dos dois faltar; '' quando ambos faltam.
 */
export function montarNomeEtapa(atividadeNome?: string, centroNome?: string): string {
  const a = (atividadeNome ?? '').trim()
  const c = (centroNome ?? '').trim()
  if (a && c) return `${a} ${c}`
  return a || c || ''
}

// ===========================================================================
// Montagem de DTOs a partir das linhas cruas
// ===========================================================================

/** Converte uma linha de CalculoAtividades em EtapaDTO. `indice` é fallback de sequência. */
export function montarEtapaDTO(r: AtividadeRow, indice: number): EtapaDTO {
  // sequência estável: itemSeq1*1000 + itemSeq2 quando presentes; senão o índice.
  const temSeq = r.itemSeq1 != null || r.itemSeq2 != null
  const sequencia = temSeq ? num(r.itemSeq1) * 1000 + num(r.itemSeq2) : indice
  return {
    sequencia,
    centro: (r.centroNome ?? '').trim() || undefined,
    descricao: montarNomeEtapa(r.atividadeNome, r.centroNome) || undefined,
    tipo: (r.tipo ?? '').trim() || undefined,
    setupMinutos: calcularSetupMin(r),
    operacaoMinutos: calcularOperacaoMin(r),
  }
}

/** Converte uma linha de CalculoPlanos em VariacaoDTO. */
export function montarVariacaoDTO(r: PlanoRow, indice: number): VariacaoDTO {
  const d1 = num(r.dimensao1)
  const d2 = num(r.dimensao2)
  const dimensao = d1 > 0 || d2 > 0 ? `${d1}x${d2}` : undefined
  return {
    sequencia: r.Ordem != null ? num(r.Ordem) : indice,
    codigoPlano: r.codPlano != null ? String(r.codPlano) : undefined,
    nome: (r.nomePlano ?? '').trim() || undefined,
    quantidade: num(r.tiragem),
    suporte: (r.suporteNome ?? '').trim() || undefined,
    gramatura: r.gramatura != null ? num(r.gramatura) : undefined,
    dimensao,
    aproveitamento: r.aproveitamento != null ? num(r.aproveitamento) : undefined,
  }
}

/**
 * Monta o texto resumido das tintas para a tag [Cores] (decisão 2 — tintas NÃO
 * viram item). Ex.: "AMARELO 123C (85%), VERDE CW0138 (15%)". Normaliza o
 * ComplementoNome (remove " - " para ficar "AMARELO 123C"). '' quando vazio.
 */
export function montarTextoTintas(tintas: TintaRow[]): string {
  const partes: string[] = []
  for (const t of tintas) {
    const nome = (t.ComplementoNome ?? '').replace(/\s*-\s*/g, ' ').trim()
    const base = nome || (t.codTinta != null ? `Tinta ${t.codTinta}` : 'Tinta')
    const area = t.areaTinta != null && Number.isFinite(Number(t.areaTinta)) ? ` (${num(t.areaTinta)}%)` : ''
    partes.push(`${base}${area}`)
  }
  return partes.join(', ')
}
