/**
 * Núcleo PURO das várias tiragens por item (spec orcamento-grafico-tiragens-por-item, tarefa 2).
 *
 * Sem Prisma e sem motor: recebe os custos já calculados de cada tiragem (soma dos planos) e forma
 * valor, margem e contribuição marginal. `calcularOrcamentoGrafico` e `ancorarCustoCalcgraf` não
 * são tocados; quem calcula cada tiragem (motor ou custo ancorado) é o chamador.
 *
 * Fórmula (igual ao motor, divisor único):
 *   custoProducao = MD + CT + SE
 *   custoTotal    = custoProducao − créditos + custoProducao × encargoFinanceiro%
 *   valorTotal    = custoTotal / (1 − (CEV% + markup%)/100)         [valor calculado]
 *   markup%       = (1 − custoTotal/valor) × 100 − CEV%              [valor digitado, margem de volta]
 *   CM$           = valor − (MD + valor × CEV%/100)
 */
import { formarPrecoVenda, type ParamsOrcamento } from '../orcamento-grafico-calculo.service'
import { somaPlanos, type FechamentoPlano } from '../plano-calculo.service'
import { HierarquiaError } from './hierarquia-common'

export type ParamsMargemTiragem = ParamsOrcamento['margem']

/** Limite de tiragens por item (o mesmo de `simular-tiragens`). */
export const MAX_TIRAGENS_POR_ITEM = 20

/** Custos de uma tiragem, já somados sobre os planos (ou do item achatado, em plano único). */
export interface CustosBrutosTiragem {
  materialDireto: number
  custoTransformacao: number
  servicoExterno: number
}

/** Parâmetros do ITEM, comuns a todas as tiragens. */
export interface ContextoPrecoTiragem {
  /** Margem do item (markup e CEV por componente). */
  margem: ParamsMargemTiragem
  /** CEV total em % (a soma que entra no divisor). Padrão: impostos + comissão + despAdm. */
  cevPerc?: number
  creditosFiscais?: number
  encargoFinanceiroPerc?: number
}

/** Decisão do usuário para UMA tiragem. */
export interface EntradaTiragem {
  /** Valor total digitado; a margem é calculada de volta. Tem precedência sobre o markup. */
  valorInformado?: number | null
  /** Markup (%) escolhido para a tiragem (ex.: uma das 3 faixas). */
  margemPerc?: number | null
  /** Faixa escolhida (0, 1 ou 2), só informativa. */
  faixaMargem?: number | null
}

export interface LinhaTiragem {
  /** 0 = tiragem de referência (a que o item espelha). */
  ordem: number
  quantidade: number
  custoProducao: number
  materialDireto: number
  custoTransformacao: number
  servicoExterno: number
  margemPerc: number
  faixaMargem: number | null
  valorTotal: number
  valorInformado: boolean
  cmValor: number
  cmPerc: number
  /** Contexto de preço usado; guardado para refazer o valor sem recalcular o item. */
  contexto: ContextoPrecoTiragem
}

const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100
const r4 = (x: number) => Math.round((x + Number.EPSILON) * 10000) / 10000

/**
 * Valida a lista de tiragens do item: de 1 a 20 inteiros positivos, sem repetição.
 * Devolve em ordem crescente (a grade do Fechamento é ordenada por quantidade).
 */
export function validarTiragens(entrada: unknown): number[] {
  if (!Array.isArray(entrada) || entrada.length === 0) {
    throw new HierarquiaError(400, 'Informe ao menos uma tiragem.')
  }
  if (entrada.length > MAX_TIRAGENS_POR_ITEM) {
    throw new HierarquiaError(400, `Informe no máximo ${MAX_TIRAGENS_POR_ITEM} tiragens.`)
  }
  const vistos = new Set<number>()
  for (const v of entrada) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
      throw new HierarquiaError(400, 'Cada tiragem deve ser um número inteiro maior que zero.')
    }
    if (vistos.has(v)) {
      throw new HierarquiaError(400, `A tiragem ${v} está repetida.`)
    }
    vistos.add(v)
  }
  return [...vistos].sort((a, b) => a - b)
}

/** Soma os planos de UMA tiragem (MD/CT/SE). Plano único = 1 elemento. */
export function brutoDePlanos(planos: readonly FechamentoPlano[]): CustosBrutosTiragem {
  const s = somaPlanos([...planos])
  return { materialDireto: s.materialDireto, custoTransformacao: s.custoTransformacao, servicoExterno: s.servicoExterno }
}

function cevDe(ctx: ContextoPrecoTiragem): number {
  if (ctx.cevPerc !== undefined && Number.isFinite(ctx.cevPerc)) return ctx.cevPerc
  const m = ctx.margem
  return m.impostos + m.comissao + m.despAdm
}

/**
 * Deriva o contexto de preço a partir dos `ParamsOrcamento` que o motor usou. Replica a regra do
 * motor: com `cev` detalhado, o divisor usa impostos = icms + juros + pisCofins e comissão =
 * comissões (despAdm = 0), e o markup vem da margem resolvida; sem `cev`, usa a margem como está.
 */
export function contextoDePrecoDeParams(
  params: Pick<ParamsOrcamento, 'margem' | 'cev' | 'creditosFiscais' | 'encargoFinanceiroPerc'>,
): ContextoPrecoTiragem {
  const c = params.cev
  if (c) {
    return {
      margem: {
        impostos: c.icms + c.juros + c.pisCofins,
        comissao: c.comissoes,
        despAdm: 0,
        markup: params.margem.markup,
      },
      cevPerc: c.icms + c.juros + c.pisCofins + c.comissoes,
      creditosFiscais: params.creditosFiscais,
      encargoFinanceiroPerc: params.encargoFinanceiroPerc,
    }
  }
  const m = params.margem
  return {
    margem: { ...m },
    cevPerc: m.impostos + m.comissao + m.despAdm,
    creditosFiscais: params.creditosFiscais,
    encargoFinanceiroPerc: params.encargoFinanceiroPerc,
  }
}

/** Forma valor, margem e CM de UMA tiragem a partir dos custos já somados. */
export function formarLinhaTiragem(
  quantidade: number,
  bruto: CustosBrutosTiragem,
  ctx: ContextoPrecoTiragem,
  entrada: EntradaTiragem = {},
): Omit<LinhaTiragem, 'ordem'> {
  const cev = cevDe(ctx)
  const custoProducao = r2(bruto.materialDireto + bruto.custoTransformacao + bruto.servicoExterno)
  const custoTotal = r2(custoProducao - (ctx.creditosFiscais ?? 0) + custoProducao * ((ctx.encargoFinanceiroPerc ?? 0) / 100))

  const informado = entrada.valorInformado != null && entrada.valorInformado > 0
  let valorTotal: number
  let margemPerc: number
  if (informado) {
    valorTotal = r2(entrada.valorInformado as number)
    margemPerc = r4((1 - custoTotal / valorTotal) * 100 - cev)
  } else {
    margemPerc = entrada.margemPerc != null ? entrada.margemPerc : ctx.margem.markup
    valorTotal = formarPrecoVenda(custoTotal, { ...ctx.margem, markup: margemPerc })
  }

  const cevValor = r2(valorTotal * (cev / 100))
  const cmValor = r2(valorTotal - (bruto.materialDireto + cevValor))
  const cmPerc = valorTotal > 0 ? r2((cmValor / valorTotal) * 100) : 0

  return {
    quantidade,
    custoProducao,
    materialDireto: r2(bruto.materialDireto),
    custoTransformacao: r2(bruto.custoTransformacao),
    servicoExterno: r2(bruto.servicoExterno),
    margemPerc,
    faixaMargem: informado ? null : entrada.faixaMargem ?? null,
    valorTotal,
    valorInformado: informado,
    cmValor,
    cmPerc,
    contexto: ctx,
  }
}

/**
 * Escolhe a tiragem de referência (espelhada no item): a quantidade atual do item, se ela estiver
 * na lista; senão a primeira (menor).
 */
export function escolherReferencia(tiragens: readonly number[], quantidadeAtual?: number | null): number {
  if (quantidadeAtual != null && tiragens.includes(quantidadeAtual)) return quantidadeAtual
  return tiragens[0]
}

/** Numera `ordem`: 0 para a referência e 1..N, em ordem crescente de quantidade, para as demais. */
export function numerarOrdem<T extends { quantidade: number }>(
  linhas: readonly T[],
  referencia: number,
): Array<T & { ordem: number }> {
  const outras = linhas.filter((l) => l.quantidade !== referencia).sort((a, b) => a.quantidade - b.quantidade)
  const ref = linhas.filter((l) => l.quantidade === referencia)
  return [...ref, ...outras].map((l, i) => ({ ...l, ordem: i }))
}
