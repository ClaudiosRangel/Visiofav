/**
 * Seleção de material de acabamento por atividade — regra PURA de preço.
 *
 * Sem Prisma/Fastify. Reaproveita apenas `consumoVerniz` e `consumoCaixa`
 * (fórmulas já validadas no cálculo 15.086). Ver design §5 e Requisito 7.
 *
 * Regras por `tipoParam`:
 *  • 0 — Acondicionamento. CAIXA: `consumoCaixa` (ceil(tiragem/pecasPorCaixa)) × preço.
 *        Demais naturezas (kraft/embalar, 'OUTRO' ou ausente): DECISÃO — consumo =
 *        ceil(tiragem / pecasPorCaixa) quando `pecasPorCaixa > 0` (uma unidade de
 *        embalagem por lote de peças); sem `pecasPorCaixa` → consumo 0 e A_VERIFICAR.
 *  • 1 — Cobertura: área × (param1 + param2)/100, cobertura efetiva limitada a 0..2
 *        (frente + verso). M2 → custo = área coberta × preço/m² (BOPP).
 *        KG → `consumoVerniz` com gramatura (kg/m²) × preço/kg; sem gramatura →
 *        custo 0 e A_VERIFICAR.
 *  • 4 — Proporcional à tiragem: param1 × tiragem × preço unitário.
 *  • 2 e 3 — Informativos: NUNCA alteram custo (custo 0, aplicaNoPreco false,
 *        A_VERIFICAR, consumo null).
 *
 * Preço ausente/nulo, entradas negativas ou NaN → tratados sem erro, com
 * custo 0 / A_VERIFICAR conforme o caso. Itens puxados do acervo nunca aplicam no preço.
 */

import { consumoCaixa, consumoVerniz } from '../consumo-material-acabamento'

export type TipoParamMaterial = 0 | 1 | 2 | 3 | 4
export type UnidadeCustoMaterial = 'KG' | 'M2' | 'UN' | 'M'
export type NaturezaSelecaoMaterial = 'VERNIZ' | 'COLA' | 'CAIXA' | 'OUTRO'
export type SituacaoParametro = 'VALIDADO' | 'A_VERIFICAR'

export interface EntradaSelecaoMaterial {
  tipoParam: number
  param1?: number | null
  param2?: number | null
  tiragem: number
  areaImpressaM2: number
  /** Preço do material (`MaterialAcabamento.valorReferencia`); pode ser nulo. */
  precoUnitario?: number | null
  unidadeCusto: UnidadeCustoMaterial
  natureza?: NaturezaSelecaoMaterial
  gramaturaKgM2?: number | null
  pecasPorCaixa?: number | null
  /** Item puxado do acervo (`calculoGraficoOrigemId` preenchido). */
  itemPuxado: boolean
}

export interface SaidaSelecaoMaterial {
  consumo: number | null
  unidadeConsumo: string
  valorUnitario: number | null
  custo: number
  aplicaNoPreco: boolean
  situacaoParametro: SituacaoParametro
  motivo?: string
}

const MOTIVO_TIPOS_INFORMATIVOS = 'funcionamento exato a verificar'

/** Arredonda a 4 casas (mesma estratégia Math.round dos módulos de consumo). */
function arred4(n: number): number {
  return Math.round(n * 10000) / 10000
}

/** Número finito e não negativo; caso contrário 0 e marca como inválido. */
function sane(v: number | null | undefined): { valor: number; invalido: boolean } {
  if (v === null || v === undefined) return { valor: 0, invalido: false }
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return { valor: 0, invalido: true }
  return { valor: v, invalido: false }
}

export function calcularSelecaoMaterial(entrada: EntradaSelecaoMaterial): SaidaSelecaoMaterial {
  const motivos: string[] = []
  const marcar = (invalido: boolean, nome: string) => {
    if (invalido) motivos.push(`${nome} inválido (negativo ou NaN) tratado como 0`)
  }

  const p1 = sane(entrada.param1)
  const p2 = sane(entrada.param2)
  const tir = sane(entrada.tiragem)
  const area = sane(entrada.areaImpressaM2)
  const gram = sane(entrada.gramaturaKgM2)
  const ppc = sane(entrada.pecasPorCaixa)
  marcar(p1.invalido, 'param1')
  marcar(p2.invalido, 'param2')
  marcar(tir.invalido, 'tiragem')
  marcar(area.invalido, 'área impressa')
  marcar(gram.invalido, 'gramatura')
  marcar(ppc.invalido, 'peças por caixa')

  const precoBruto = entrada.precoUnitario
  const precoSane = sane(precoBruto)
  const precoAusente = precoBruto === null || precoBruto === undefined || precoSane.invalido
  const preco = precoAusente ? 0 : precoSane.valor
  if (precoSane.invalido) motivos.push('preço inválido (negativo ou NaN) tratado como ausente')
  else if (precoAusente) motivos.push('preço do material ausente')
  const valorUnitario = precoAusente ? null : preco

  const entradaInvalida =
    p1.invalido || p2.invalido || tir.invalido || area.invalido || gram.invalido || ppc.invalido

  const montar = (
    consumo: number | null,
    unidadeConsumo: string,
    calculavel: boolean,
    aplicavel: boolean,
  ): SaidaSelecaoMaterial => {
    const custoOk = calculavel && !precoAusente && !entradaInvalida
    const custo = custoOk && consumo !== null ? arred4(consumo * preco) : 0
    const situacao: SituacaoParametro = custoOk ? 'VALIDADO' : 'A_VERIFICAR'
    return {
      consumo,
      unidadeConsumo,
      valorUnitario,
      custo,
      aplicaNoPreco: !entrada.itemPuxado && aplicavel && custoOk,
      situacaoParametro: situacao,
      ...(motivos.length > 0 ? { motivo: motivos.join('; ') } : {}),
    }
  }

  switch (entrada.tipoParam) {
    case 0: {
      const temPpc = ppc.valor > 0
      if (entrada.natureza === 'CAIXA') {
        const consumo = consumoCaixa({
          tiragem: tir.valor,
          pecasPorCaixa: entrada.pecasPorCaixa == null ? undefined : ppc.valor,
        })
        return montar(consumo, 'UN', true, true)
      }
      if (!temPpc) {
        motivos.push('peças por caixa não informadas para acondicionamento')
        return montar(0, 'UN', false, true)
      }
      return montar(consumoCaixa({ tiragem: tir.valor, pecasPorCaixa: ppc.valor }), 'UN', true, true)
    }

    case 1: {
      const cobertura = Math.min(2, Math.max(0, (p1.valor + p2.valor) / 100))
      if (entrada.unidadeCusto === 'M2') {
        return montar(arred4(area.valor * cobertura), 'M2', true, true)
      }
      if (entrada.unidadeCusto === 'KG') {
        if (!(gram.valor > 0)) {
          motivos.push('gramatura (kg/m²) não informada')
          return montar(null, 'KG', false, true)
        }
        const kg = consumoVerniz({
          areaImpressaM2: area.valor,
          cobertura,
          gramaturaKgM2: gram.valor,
        })
        return montar(kg, 'KG', true, true)
      }
      motivos.push(`unidade de custo ${entrada.unidadeCusto} não suportada para cobertura`)
      return montar(null, entrada.unidadeCusto, false, true)
    }

    case 4:
      return montar(arred4(p1.valor * tir.valor), 'UN', true, true)

    case 2:
    case 3: {
      const motivo = [MOTIVO_TIPOS_INFORMATIVOS, ...motivos].join('; ')
      return {
        consumo: null,
        unidadeConsumo: entrada.unidadeCusto,
        valorUnitario,
        custo: 0,
        aplicaNoPreco: false,
        situacaoParametro: 'A_VERIFICAR',
        motivo,
      }
    }

    default:
      motivos.push(`tipoParam ${String(entrada.tipoParam)} desconhecido`)
      return {
        consumo: null,
        unidadeConsumo: entrada.unidadeCusto,
        valorUnitario,
        custo: 0,
        aplicaNoPreco: false,
        situacaoParametro: 'A_VERIFICAR',
        motivo: motivos.join('; '),
      }
  }
}
