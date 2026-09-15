/**
 * Financeiro — cálculo puro do valor líquido de uma baixa (liquidação).
 * Sem I/O, sem Prisma. Testável (unit + property-based).
 *
 * Semântica da tarifa:
 *  - PAGAR:   a tarifa é um custo do pagamento → aumenta o desembolso.
 *             liquido = valor + juros + multa − desconto + tarifa
 *  - RECEBER: a tarifa é descontada do que entra → reduz o recebido.
 *             liquido = valor + juros + multa − desconto − tarifa
 */

export type TipoTitulo = 'RECEBER' | 'PAGAR'

export interface ComponentesBaixa {
  valor: number
  juros?: number
  multa?: number
  desconto?: number
  tarifa?: number
}

export interface ResultadoBaixa {
  acrescimos: number // juros + multa
  desconto: number
  tarifa: number
  liquido: number
  valido: boolean // false se líquido < 0
}

function num(v: number | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function centavos(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100
}

export function calcularLiquido(tipo: TipoTitulo, c: ComponentesBaixa): ResultadoBaixa {
  const valor = num(c.valor)
  const juros = num(c.juros)
  const multa = num(c.multa)
  const desconto = num(c.desconto)
  const tarifa = num(c.tarifa)

  const acrescimos = centavos(juros + multa)
  const base = valor + acrescimos - desconto
  const liquido = centavos(tipo === 'PAGAR' ? base + tarifa : base - tarifa)

  return {
    acrescimos,
    desconto: centavos(desconto),
    tarifa: centavos(tarifa),
    liquido,
    valido: liquido >= 0,
  }
}
