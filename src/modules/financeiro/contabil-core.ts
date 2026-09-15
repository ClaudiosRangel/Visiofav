/**
 * Financeiro D4 (Contabilidade) — núcleo puro de partidas dobradas.
 * Sem I/O, sem Prisma. Testável (unit + property-based).
 *
 * Invariante central da contabilidade: em todo lançamento, a soma dos débitos
 * é igual à soma dos créditos (tolerância de R$ 0,01 para ruído de ponto
 * flutuante).
 */

const TOLERANCIA = 0.01

export type TipoPartida = 'DEBITO' | 'CREDITO'
export type NaturezaConta = 'DEVEDORA' | 'CREDORA'

export interface PartidaInput {
  contaId: string
  tipo: TipoPartida
  valor: number
}

/** Arredonda para 2 casas (centavos). */
function centavos(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100
}

/**
 * Valida se um conjunto de partidas está balanceado (Σ débitos = Σ créditos).
 * Retorna também os totais para exibição em mensagens de erro.
 */
export function validarPartidasDobradas(partidas: PartidaInput[]): {
  balanceado: boolean
  totalDebito: number
  totalCredito: number
} {
  let totalDebito = 0
  let totalCredito = 0
  for (const p of partidas) {
    const v = Number(p.valor) || 0
    if (p.tipo === 'DEBITO') totalDebito += v
    else if (p.tipo === 'CREDITO') totalCredito += v
  }
  totalDebito = centavos(totalDebito)
  totalCredito = centavos(totalCredito)
  const balanceado = Math.abs(totalDebito - totalCredito) <= TOLERANCIA
  return { balanceado, totalDebito, totalCredito }
}

/**
 * Monta as duas partidas de um lançamento simples a partir de um de/para
 * (conta de débito + conta de crédito) e um valor. Por construção, sempre
 * balanceado (um débito e um crédito de mesmo valor).
 */
export function montarPartidas(debitoId: string, creditoId: string, valor: number): PartidaInput[] {
  const v = centavos(Math.abs(Number(valor) || 0))
  return [
    { contaId: debitoId, tipo: 'DEBITO', valor: v },
    { contaId: creditoId, tipo: 'CREDITO', valor: v },
  ]
}

/**
 * Saldo de uma conta a partir dos totais de débito/crédito, respeitando a
 * natureza: conta DEVEDORA (ativo/despesa) tem saldo = débitos − créditos;
 * conta CREDORA (passivo/PL/receita) tem saldo = créditos − débitos.
 */
export function saldoPorNatureza(natureza: NaturezaConta, totalDebito: number, totalCredito: number): number {
  const d = Number(totalDebito) || 0
  const c = Number(totalCredito) || 0
  return centavos(natureza === 'DEVEDORA' ? d - c : c - d)
}

/** Confere se ao menos um débito e um crédito existem (lançamento mínimo válido). */
export function temDebitoECredito(partidas: PartidaInput[]): boolean {
  const temD = partidas.some((p) => p.tipo === 'DEBITO' && (Number(p.valor) || 0) > 0)
  const temC = partidas.some((p) => p.tipo === 'CREDITO' && (Number(p.valor) || 0) > 0)
  return temD && temC
}
