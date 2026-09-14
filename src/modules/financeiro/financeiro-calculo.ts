/**
 * Financeiro Operacional Completo (Bloco F1) — núcleo puro de cálculo.
 *
 * Funções determinísticas, SEM I/O (sem Prisma, sem relógio global). Todas as
 * datas e o "agora" vêm por parâmetro, viabilizando testes property-based.
 * `Decimal` do Prisma deve ser convertido para `number` na borda (antes de
 * chamar estas funções).
 */
import type {
  MovimentoConta,
  TituloFluxo,
  LancamentoFluxo,
  BucketFluxo,
  TituloAging,
  ResumoAging,
  TituloDre,
  LinhaDre,
  ParteRateio,
  FaixaAging,
  Granularidade,
} from './financeiro.types'

/** Arredonda para 2 casas evitando erro de ponto flutuante. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Saldo de uma conta = saldo inicial + Σ entradas realizadas − Σ saídas
 * realizadas. Movimentos não realizados (previstos) não entram no saldo.
 */
export function calcularSaldoConta(saldoInicial: number, movimentos: MovimentoConta[]): number {
  let saldo = saldoInicial
  for (const m of movimentos) {
    if (!m.realizado) continue
    saldo += m.tipo === 'ENTRADA' ? m.valor : -m.valor
  }
  return round2(saldo)
}

/** Competência "YYYY-MM" de uma data (mês local baseado em UTC do Date). */
export function competenciaDe(data: Date): string {
  const ano = data.getUTCFullYear()
  const mes = String(data.getUTCMonth() + 1).padStart(2, '0')
  return `${ano}-${mes}`
}

/** Início do bucket que contém `data`, conforme granularidade (UTC). */
function inicioBucket(data: Date, g: Granularidade): Date {
  const d = new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate()))
  if (g === 'MES') return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
  if (g === 'SEMANA') {
    const dow = d.getUTCDay() // 0=dom
    d.setUTCDate(d.getUTCDate() - dow)
    return d
  }
  return d // DIA
}

/** Avança um bucket a partir do início dado. */
function proximoBucket(inicio: Date, g: Granularidade): Date {
  const d = new Date(inicio)
  if (g === 'MES') d.setUTCMonth(d.getUTCMonth() + 1)
  else if (g === 'SEMANA') d.setUTCDate(d.getUTCDate() + 7)
  else d.setUTCDate(d.getUTCDate() + 1)
  return d
}

/**
 * Projeta o fluxo de caixa em buckets (dia/semana/mês) entre `de` e `ate`.
 * Cada bucket carrega o saldo inicial (final do anterior), entradas, saídas e
 * saldo final. Títulos contam pela data de vencimento; lançamentos pela data.
 * Property: saldoFinal == saldoInicial + entradas − saídas (por bucket).
 */
export function projetarFluxoCaixa(input: {
  saldoInicial: number
  titulos: TituloFluxo[]
  lancamentos: LancamentoFluxo[]
  de: Date
  ate: Date
  granularidade: Granularidade
}): BucketFluxo[] {
  const { saldoInicial, titulos, lancamentos, de, ate, granularidade } = input
  const buckets: BucketFluxo[] = []
  let saldo = saldoInicial

  let inicio = inicioBucket(de, granularidade)
  const limite = ate.getTime()

  // proteção contra laço infinito em intervalos absurdos
  let guarda = 0
  while (inicio.getTime() <= limite && guarda < 100000) {
    guarda++
    const fim = proximoBucket(inicio, granularidade)
    const ini = inicio.getTime()
    const fimMs = fim.getTime()

    let entradas = 0
    let saidas = 0

    for (const t of titulos) {
      const v = t.vencimento.getTime()
      if (v >= ini && v < fimMs) {
        if (t.origem === 'RECEBER') entradas += t.valor
        else saidas += t.valor
      }
    }
    for (const l of lancamentos) {
      const v = l.data.getTime()
      if (v >= ini && v < fimMs) {
        if (l.tipo === 'ENTRADA') entradas += l.valor
        else saidas += l.valor
      }
    }

    entradas = round2(entradas)
    saidas = round2(saidas)
    const saldoFinal = round2(saldo + entradas - saidas)
    buckets.push({ inicio: new Date(inicio), fim: new Date(fim), saldoInicial: round2(saldo), entradas, saidas, saldoFinal })
    saldo = saldoFinal
    inicio = fim
  }

  return buckets
}

/**
 * Classifica títulos em aberto por faixa de atraso relativa a `agora`.
 * Faixas mutuamente exclusivas e exaustivas.
 */
export function classificarAging(titulos: TituloAging[], agora: Date): ResumoAging {
  const resumo: ResumoAging = { A_VENCER: 0, D1_30: 0, D31_60: 0, D61_90: 0, D90_MAIS: 0 }
  const hoje = agora.getTime()
  const DIA = 24 * 60 * 60 * 1000

  for (const t of titulos) {
    const diasAtraso = Math.floor((hoje - t.vencimento.getTime()) / DIA)
    let faixa: FaixaAging
    if (diasAtraso <= 0) faixa = 'A_VENCER'
    else if (diasAtraso <= 30) faixa = 'D1_30'
    else if (diasAtraso <= 60) faixa = 'D31_60'
    else if (diasAtraso <= 90) faixa = 'D61_90'
    else faixa = 'D90_MAIS'
    resumo[faixa] = round2(resumo[faixa] + t.valor)
  }
  return resumo
}

/**
 * DRE gerencial: agrupa títulos por categoria dentro do período [de, ate]
 * (inclusive), somando por competência. Uma linha por categoria/tipo.
 */
export function montarDreGerencial(titulos: TituloDre[], de: Date, ate: Date): LinhaDre[] {
  const deMs = de.getTime()
  const ateMs = ate.getTime()
  const mapa = new Map<string, LinhaDre>()

  for (const t of titulos) {
    const c = t.competencia.getTime()
    if (c < deMs || c > ateMs) continue
    const chave = `${t.tipo}::${t.categoriaId ?? 'SEM_CATEGORIA'}`
    const atual = mapa.get(chave)
    if (atual) atual.total = round2(atual.total + t.valor)
    else mapa.set(chave, { categoriaId: t.categoriaId, tipo: t.tipo, total: round2(t.valor) })
  }
  return Array.from(mapa.values())
}

/**
 * Valida rateio: a soma das partes deve ser igual ao valor total (tolerância
 * de 0,01 para arredondamento). Partes vazias => inválido.
 */
export function validarRateio(valorTotal: number, partes: ParteRateio[]): boolean {
  if (partes.length === 0) return false
  const soma = partes.reduce((acc, p) => acc + p.valor, 0)
  // tolerância de 1 centavo; usa comparação em inteiros de centavos para
  // evitar resíduo de ponto flutuante na fronteira exata (ex.: 99,99 vs 100).
  const diffCentavos = Math.abs(Math.round(soma * 100) - Math.round(valorTotal * 100))
  return diffCentavos <= 1
}
