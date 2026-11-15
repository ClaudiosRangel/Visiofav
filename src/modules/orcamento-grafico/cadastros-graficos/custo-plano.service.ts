/**
 * Custo por plano e total do item (regra de coerência 5 do design, Req 8).
 *
 * Módulo PURO: sem Prisma, sem Fastify, sem efeitos colaterais.
 *
 * - Item NOVO/recalculado (itemPuxado = false):
 *     custoPlano = soma(atividades) + soma(materiais)
 *     totalItem  = soma dos custoPlano
 * - Item PUXADO do acervo (itemPuxado = true):
 *     todos os custoPlano = 0, totalPlanos = 0 e
 *     totalItem = custoAncoradoItem ?? 0 (custo ancorado preservado).
 *
 * Valores não numéricos, negativos ou NaN/Infinity são tratados como 0.
 * Arredondamento a 2 casas apenas no custo de cada plano e nos totais.
 */

export interface PlanoCustoEntrada {
  planoId: string
  custosAtividades: number[]
  custosMateriais: number[]
}

export interface SomarCustoPlanosEntrada {
  itemPuxado: boolean
  custoAncoradoItem?: number
  planos: PlanoCustoEntrada[]
}

export interface CustoPorPlano {
  planoId: string
  custoAtividades: number
  custoMateriais: number
  custoPlano: number
}

export interface SomarCustoPlanosSaida {
  custoPorPlano: CustoPorPlano[]
  totalPlanos: number
  totalItem: number
}

function arredondar2(x: number): number {
  return Math.round(x * 100) / 100
}

/** Converte para número finito e não negativo; qualquer outra coisa vira 0. */
function valorSeguro(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
}

function somar(lista: unknown): number {
  if (!Array.isArray(lista)) return 0
  let total = 0
  for (const v of lista) total += valorSeguro(v)
  return total
}

export function somarCustoPlanos(entrada: SomarCustoPlanosEntrada): SomarCustoPlanosSaida {
  const planos = Array.isArray(entrada.planos) ? entrada.planos : []

  if (entrada.itemPuxado) {
    return {
      custoPorPlano: planos.map((p) => ({
        planoId: p.planoId,
        custoAtividades: 0,
        custoMateriais: 0,
        custoPlano: 0,
      })),
      totalPlanos: 0,
      totalItem: arredondar2(valorSeguro(entrada.custoAncoradoItem)),
    }
  }

  const custoPorPlano = planos.map((p) => {
    const custoAtividades = somar(p.custosAtividades)
    const custoMateriais = somar(p.custosMateriais)
    return {
      planoId: p.planoId,
      custoAtividades,
      custoMateriais,
      custoPlano: arredondar2(custoAtividades + custoMateriais),
    }
  })

  const totalPlanos = arredondar2(custoPorPlano.reduce((acc, p) => acc + p.custoPlano, 0))

  return { custoPorPlano, totalPlanos, totalItem: totalPlanos }
}
