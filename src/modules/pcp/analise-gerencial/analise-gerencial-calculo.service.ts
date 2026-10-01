import { Decimal } from '@prisma/client/runtime/library'

/**
 * Motor de cálculo da Análise Gerencial RKW (Bloco 4 — spec analise-gerencial-rkw).
 *
 * PURO e testável: recebe os orçamentos do período (resumidos) e o Custo Fixo
 * mensal (do MapaCusto/Bloco 3) e devolve os indicadores gerenciais — sem
 * nenhum acesso a banco. A persistência/carga fica na rota.
 *
 * Consome dados que JÁ existem:
 *   - Contribuição Marginal por orçamento (motor do Bloco 1, em resultadoCalculo)
 *   - Custo Fixo mensal (MapaCusto.custoFixoTotal, Bloco 3)
 *
 * Indicadores:
 *   - CM consolidada dos orçamentos ganhos + CM% média PONDERADA pelo preço
 *   - Ponto de Equilíbrio = CF ÷ (CM%/100)  (indefinido se CM% ≤ 0)
 *   - Cobertura do CF = Σ CM ÷ CF ; faltante = max(0, CF − Σ CM)
 *   - Resultado do período = Σ CM − CF
 *   - Simulação de faturamento × cobertura (cenários)
 *
 * Todos os cálculos em Decimal (nunca number) para precisão monetária.
 */

// ── Constantes ──────────────────────────────────────────────────────────────
/** Status do OrcamentoGrafico que representa venda ganha (confirmado no enum). */
export const STATUS_GANHO_DEFAULT = ['APROVADO'] as const

const ZERO = new Decimal(0)
const CEM = new Decimal(100)

function toDec(v: Decimal | number | string | null | undefined): Decimal {
  if (v === null || v === undefined) return ZERO
  return v instanceof Decimal ? v : new Decimal(v)
}

// ── Tipos de entrada ──────────────────────────────────────────────────────────
export interface OrcamentoResumo {
  id: string
  status: string
  precoVenda: Decimal | number | null
  custoTotal: Decimal | number | null
  /** CM em valor, vinda do resultadoCalculo do Bloco 1 (quando houver). */
  cmValor?: Decimal | number | null
  /** CM em %, vinda do resultadoCalculo do Bloco 1 (quando houver). */
  cmPerc?: Decimal | number | null
  /** true quando o orçamento gerou pedido de venda (sinal adicional de ganho). */
  temPedido?: boolean
}

export interface CenarioSimulacao {
  faturamento: Decimal | number
  /** CM% do cenário; se omitida, o chamador usa a CM% média do período. */
  cmPerc?: Decimal | number | null
}

// ── Tipos de saída ──────────────────────────────────────────────────────────
export interface ConsolidadoCM {
  totalOrcamentos: number
  fechados: number
  taxaConversao: Decimal // fechados / total (0..1)
  somaPrecoVendaFechados: Decimal
  somaCMFechados: Decimal
  cmMediaPerc: Decimal // ponderada pelo preço de venda
  algumFallback: boolean // true se algum orçamento usou CM aproximada (preço − custo)
}

export interface IndicadoresPeriodo {
  consolidado: ConsolidadoCM
  custoFixo: Decimal
  pontoEquilibrio: Decimal | null // faturamento p/ break-even; null se CM% ≤ 0
  coberturaPerc: Decimal // Σ CM ÷ CF × 100 (0 se CF = 0)
  faltanteParaEquilibrio: Decimal // max(0, CF − Σ CM)
  resultadoPeriodo: Decimal // Σ CM − CF (lucro/prejuízo gerencial)
}

export interface ResultadoCenario {
  faturamento: Decimal
  cmPerc: Decimal
  cmProjetada: Decimal
  coberturaPerc: Decimal
  resultado: Decimal // cmProjetada − CF
}

// ── Funções ───────────────────────────────────────────────────────────────────

/**
 * CM de um orçamento: usa a CM já calculada (Bloco 1) quando presente; senão
 * cai no fallback `precoVenda − custoTotal`. Retorna também se foi fallback.
 */
export function cmDoOrcamento(o: OrcamentoResumo): { valor: Decimal; fallback: boolean } {
  if (o.cmValor !== null && o.cmValor !== undefined) {
    return { valor: toDec(o.cmValor), fallback: false }
  }
  // fallback aproximado
  return { valor: toDec(o.precoVenda).minus(toDec(o.custoTotal)), fallback: true }
}

/**
 * Task 1.2 — consolida a Contribuição Marginal dos orçamentos do período.
 * "Fechado/ganho" = status ∈ statusGanho OU temPedido = true.
 * CM% média é PONDERADA pelo preço de venda (Σ CM ÷ Σ preço), não média das %.
 */
export function consolidarCM(
  orcamentos: OrcamentoResumo[],
  statusGanho: readonly string[] = STATUS_GANHO_DEFAULT,
): ConsolidadoCM {
  const setGanho = new Set(statusGanho.map((s) => s.toUpperCase()))
  const ganho = (o: OrcamentoResumo) => setGanho.has((o.status || '').toUpperCase()) || o.temPedido === true

  let fechados = 0
  let somaPreco = ZERO
  let somaCM = ZERO
  let algumFallback = false

  for (const o of orcamentos) {
    if (!ganho(o)) continue
    fechados += 1
    somaPreco = somaPreco.plus(toDec(o.precoVenda))
    const cm = cmDoOrcamento(o)
    somaCM = somaCM.plus(cm.valor)
    if (cm.fallback) algumFallback = true
  }

  const total = orcamentos.length
  const taxaConversao = total > 0 ? new Decimal(fechados).dividedBy(total) : ZERO
  const cmMediaPerc = somaPreco.greaterThan(0) ? somaCM.dividedBy(somaPreco).times(CEM) : ZERO

  return {
    totalOrcamentos: total,
    fechados,
    taxaConversao,
    somaPrecoVendaFechados: somaPreco,
    somaCMFechados: somaCM,
    cmMediaPerc,
    algumFallback,
  }
}

/**
 * Task 1.3 — Ponto de Equilíbrio em faturamento = CF ÷ (CM%/100).
 * Retorna null quando CM% ≤ 0 (indefinido — evita divisão por zero).
 */
export function pontoEquilibrio(custoFixo: Decimal | number, cmMediaPerc: Decimal | number): Decimal | null {
  const cf = toDec(custoFixo)
  const cm = toDec(cmMediaPerc)
  if (cm.lessThanOrEqualTo(0)) return null
  return cf.dividedBy(cm.dividedBy(CEM))
}

/**
 * Task 1.4 — cobertura do custo fixo e resultado do período.
 */
export function cobertura(
  somaCM: Decimal | number,
  custoFixo: Decimal | number,
): { coberturaPerc: Decimal; faltante: Decimal; resultado: Decimal } {
  const cm = toDec(somaCM)
  const cf = toDec(custoFixo)
  const coberturaPerc = cf.greaterThan(0) ? cm.dividedBy(cf).times(CEM) : ZERO
  const faltanteRaw = cf.minus(cm)
  const faltante = faltanteRaw.greaterThan(0) ? faltanteRaw : ZERO
  return { coberturaPerc, faltante, resultado: cm.minus(cf) }
}

/**
 * Task 1.2+1.3+1.4 — monta o pacote completo de indicadores do período.
 */
export function calcularIndicadores(
  orcamentos: OrcamentoResumo[],
  custoFixo: Decimal | number,
  statusGanho: readonly string[] = STATUS_GANHO_DEFAULT,
): IndicadoresPeriodo {
  const consolidado = consolidarCM(orcamentos, statusGanho)
  const cf = toDec(custoFixo)
  const pe = pontoEquilibrio(cf, consolidado.cmMediaPerc)
  const cob = cobertura(consolidado.somaCMFechados, cf)
  return {
    consolidado,
    custoFixo: cf,
    pontoEquilibrio: pe,
    coberturaPerc: cob.coberturaPerc,
    faltanteParaEquilibrio: cob.faltante,
    resultadoPeriodo: cob.resultado,
  }
}

/**
 * Task 1.5 — simula cenários de faturamento × cobertura do custo fixo.
 * Para cada cenário: cmProjetada = faturamento × cmPerc/100 ;
 * cobertura = cmProjetada ÷ CF ; resultado = cmProjetada − CF.
 * Se o cenário não trouxer cmPerc, usa `cmPercPadrao` (ex.: a CM% média do período).
 */
export function simular(
  custoFixo: Decimal | number,
  cenarios: CenarioSimulacao[],
  cmPercPadrao: Decimal | number,
): ResultadoCenario[] {
  const cf = toDec(custoFixo)
  const padrao = toDec(cmPercPadrao)
  return cenarios.map((c) => {
    const faturamento = toDec(c.faturamento)
    const cmPerc = c.cmPerc !== null && c.cmPerc !== undefined ? toDec(c.cmPerc) : padrao
    const cmProjetada = faturamento.times(cmPerc.dividedBy(CEM))
    const coberturaPerc = cf.greaterThan(0) ? cmProjetada.dividedBy(cf).times(CEM) : ZERO
    return { faturamento, cmPerc, cmProjetada, coberturaPerc, resultado: cmProjetada.minus(cf) }
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// PÓS-CÁLCULO (previsto × realizado) — Req 4
// ═══════════════════════════════════════════════════════════════════════════
//
// HONESTIDADE SOBRE O DADO: o PCP registra quantidade produzida/rejeitada e
// tempos reais das etapas, mas NÃO persiste custo realizado por OP. Portanto o
// pós-cálculo compara com confiança a QUANTIDADE (prevista × produzida) e o
// VALOR previsto ajustado à quantidade real; o custo realizado é marcado como
// "não disponível" em vez de ser inventado. OPs sem produção viram "sem
// realizado" (não quebram).

export interface ItemPrevistoRealizado {
  /** identificação para exibição (nº OP / orçamento / produto) */
  referencia: string
  quantidadePrevista: Decimal | number | null
  quantidadeProduzida: Decimal | number | null
  quantidadeRejeitada?: Decimal | number | null
  /** valor/preço previsto do orçamento (quando houver vínculo) */
  valorPrevisto?: Decimal | number | null
  /** true quando a OP ainda não tem produção apontada */
  semRealizado: boolean
}

export interface ResultadoPosCalculo {
  referencia: string
  quantidadePrevista: Decimal
  quantidadeProduzida: Decimal
  quantidadeRejeitada: Decimal
  desvioQuantidade: Decimal // produzida − prevista
  desvioQuantidadePerc: Decimal // desvio ÷ prevista × 100 (0 se prevista = 0)
  valorPrevisto: Decimal
  /** valor previsto ajustado à quantidade produzida (proporcional) */
  valorProporcionalRealizado: Decimal
  semRealizado: boolean
}

/**
 * Task 5.1 — compara previsto × realizado por item.
 * desvioQuantidade = produzida − prevista ; % sobre a prevista (0 se prevista=0).
 * valorProporcionalRealizado = valorPrevisto × (produzida ÷ prevista) — uma
 * aproximação, já que o custo realizado não é persistido. semRealizado passa
 * direto (item sem OP concluída não é penalizado como desvio negativo).
 */
export function calcularPosCalculo(itens: ItemPrevistoRealizado[]): ResultadoPosCalculo[] {
  return itens.map((i) => {
    const prevista = toDec(i.quantidadePrevista)
    const produzida = toDec(i.quantidadeProduzida)
    const rejeitada = toDec(i.quantidadeRejeitada)
    const valorPrevisto = toDec(i.valorPrevisto)
    const desvio = produzida.minus(prevista)
    const desvioPerc = prevista.greaterThan(0) ? desvio.dividedBy(prevista).times(CEM) : ZERO
    const proporcional = prevista.greaterThan(0)
      ? valorPrevisto.times(produzida.dividedBy(prevista))
      : ZERO
    return {
      referencia: i.referencia,
      quantidadePrevista: prevista,
      quantidadeProduzida: produzida,
      quantidadeRejeitada: rejeitada,
      desvioQuantidade: desvio,
      desvioQuantidadePerc: desvioPerc,
      valorPrevisto,
      valorProporcionalRealizado: proporcional,
      semRealizado: i.semRealizado,
    }
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFRONTO GERENCIAL × CONTÁBIL (DRE) — Req 5
// ═══════════════════════════════════════════════════════════════════════════

export interface ConfrontoDRE {
  resultadoGerencial: Decimal // CM − CF (do painel)
  resultadoContabil: Decimal | null // Σ RECEITA − Σ DESPESA da DRE (null se indisponível)
  diferenca: Decimal | null // gerencial − contábil (null se contábil indisponível)
  contabilDisponivel: boolean
}

/**
 * Task 5.2 — confronta o resultado gerencial (CM − CF) com o contábil (DRE).
 * Se o contábil não estiver disponível, retorna só o gerencial + aviso.
 */
export function confrontarDRE(
  resultadoGerencial: Decimal | number,
  resultadoContabil: Decimal | number | null | undefined,
): ConfrontoDRE {
  const ger = toDec(resultadoGerencial)
  if (resultadoContabil === null || resultadoContabil === undefined) {
    return { resultadoGerencial: ger, resultadoContabil: null, diferenca: null, contabilDisponivel: false }
  }
  const cont = toDec(resultadoContabil)
  return { resultadoGerencial: ger, resultadoContabil: cont, diferenca: ger.minus(cont), contabilDisponivel: true }
}
