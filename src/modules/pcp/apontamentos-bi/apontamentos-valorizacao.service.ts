/**
 * Motor PURO de valorização e metas dos Apontamentos (spec
 * pcp-apontamentos-dashboards-relatorios). SEM Prisma — recebe números já
 * materializados e devolve resultados determinísticos, para permitir testes
 * golden + property-based (fast-check).
 *
 * Regra de valorização (Req 2): o valor em R$ da produção de um centro é, por
 * padrão, `tempoProdutivoHoras × custoHora`. Quando um `valorUnitario` é
 * informado (R$ por unidade produzida), usa-se `valorUnitario × quantidade`.
 * Se nenhuma base de valor existir, o valor é 0 (nunca erro) — a quantidade
 * continua sendo exibida.
 */

export interface EntradaValorizacao {
  /** Tempo produtivo apontado no período, em HORAS (>= 0). */
  tempoProdutivoHoras: number
  /** Custo/hora do centro (R$); null/undefined = sem base de tempo. */
  custoHora?: number | null
  /** Valor unitário por quantidade produzida (R$); tem prioridade quando > 0. */
  valorUnitario?: number | null
  /** Quantidade produzida (na base de contagem do centro, >= 0). */
  quantidade: number
}

/**
 * Calcula o valor em R$ da produção. Determinístico e não-negativo.
 * Prioridade: valorUnitario (quando > 0) → custoHora×tempo → 0.
 */
export function valorizar(e: EntradaValorizacao): number {
  const tempo = Number.isFinite(e.tempoProdutivoHoras) && e.tempoProdutivoHoras > 0 ? e.tempoProdutivoHoras : 0
  const qtd = Number.isFinite(e.quantidade) && e.quantidade > 0 ? e.quantidade : 0
  const custo = e.custoHora != null && Number.isFinite(e.custoHora) && e.custoHora > 0 ? e.custoHora : 0
  const unit = e.valorUnitario != null && Number.isFinite(e.valorUnitario) && e.valorUnitario > 0 ? e.valorUnitario : 0

  if (unit > 0) return arred2(unit * qtd)
  if (custo > 0) return arred2(custo * tempo)
  return 0
}

/**
 * Percentual atingido (realizado/meta × 100). Retorna null quando a meta é
 * ausente ou <= 0 (nunca divide por zero). Nunca negativo.
 */
export function percentualAtingido(realizado: number, meta?: number | null): number | null {
  if (meta == null || !Number.isFinite(meta) || meta <= 0) return null
  const r = Number.isFinite(realizado) && realizado > 0 ? realizado : 0
  return arred2((r / meta) * 100)
}

/**
 * Chave de mês civil no fuso America/Sao_Paulo (-3h), estável e idempotente.
 * Retorna "YYYY-MM". Base do agrupamento mensal de produtividade (Req 4.4),
 * consistente com o reset diário do contador no restante do PCP.
 */
export function mesCivilBrasilia(date: Date): string {
  if (!date || Number.isNaN(date.getTime())) return 'invalida'
  const br = new Date(date.getTime() - 3 * 60 * 60 * 1000)
  const ano = br.getUTCFullYear()
  const mes = String(br.getUTCMonth() + 1).padStart(2, '0')
  return `${ano}-${mes}`
}

/** Data civil (YYYY-MM-DD) no fuso -3h — usada no agrupamento diário. */
export function dataCivilBrasilia(date: Date): string {
  if (!date || Number.isNaN(date.getTime())) return 'invalida'
  const br = new Date(date.getTime() - 3 * 60 * 60 * 1000)
  const ano = br.getUTCFullYear()
  const mes = String(br.getUTCMonth() + 1).padStart(2, '0')
  const dia = String(br.getUTCDate()).padStart(2, '0')
  return `${ano}-${mes}-${dia}`
}

/** Arredonda para 2 casas (R$ e percentuais). */
function arred2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
