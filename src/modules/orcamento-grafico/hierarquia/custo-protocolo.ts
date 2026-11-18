/**
 * Helper do protocolo de igualdade de custo (spec orcamento-grafico-hierarquia-item-plano,
 * tarefa 1.9; Req. 15.1, 15.2, 15.7, 15.8, 15.9).
 *
 * `executarProtocolo(item, passos)` percorre, por tiragem, os passos (a) a (f) NA ORDEM.
 * Cada passo é PLUGÁVEL: uma função que devolve o custo/preço medidos naquele passo.
 * Passo ausente = PENDENTE (registrado, não falha). Passo presente é comparado com o
 * baseline em CENTAVOS INTEIROS; na primeira divergência lança `DivergenciaCustoError`
 * com item, passo, tiragem, campo, valor esperado e valor obtido (R15.9).
 *
 * Nada aqui acessa banco, rede ou o motor: os passos que precisam deles vêm de fora.
 */
import { centavos, type ItemBaseline, type TiragemBaseline } from './custo-baseline.fixture'

export type PassoId = 'a' | 'b' | 'c' | 'd' | 'e' | 'f'

export const ORDEM_PASSOS: readonly PassoId[] = ['a', 'b', 'c', 'd', 'e', 'f']

export const NOME_PASSO: Readonly<Record<PassoId, string>> = {
  a: 'abrir',
  b: 'salvar sem alteração',
  c: 'calcular',
  d: 'gravar campos informativos',
  e: 'copiar',
  f: 'Fechamento',
}

export interface MedidaCusto {
  custoProducao: number
  /** null = o passo não mede este campo. */
  precoVenda?: number | null
  valorTotal?: number | null
}

export interface ContextoPasso {
  item: ItemBaseline
  tiragem: TiragemBaseline
  /** Medida do passo anterior executado (undefined no primeiro). */
  anterior?: MedidaCusto
}

export type Passo = (ctx: ContextoPasso) => MedidaCusto | Promise<MedidaCusto>
export type PassosProtocolo = Partial<Record<PassoId, Passo>>

export class DivergenciaCustoError extends Error {
  constructor(
    public readonly itemId: string,
    public readonly passo: PassoId,
    public readonly tiragem: number,
    public readonly campo: 'custoProducao' | 'precoVenda' | 'valorTotal',
    public readonly esperadoCentavos: number,
    public readonly obtidoCentavos: number,
  ) {
    super(
      `Divergência de custo no item ${itemId}, passo (${passo}) ${NOME_PASSO[passo]}, tiragem ${tiragem}: ` +
        `${campo} esperado ${esperadoCentavos} centavos, obtido ${obtidoCentavos} centavos`,
    )
    this.name = 'DivergenciaCustoError'
  }
}

export interface ResultadoProtocolo {
  itemId: string
  executados: PassoId[]
  pendentes: PassoId[]
  /** Quantidade de comparações em centavos que passaram. */
  comparacoes: number
}

function comparar(
  item: ItemBaseline,
  passo: PassoId,
  t: TiragemBaseline,
  medida: MedidaCusto,
): number {
  const pares: Array<['custoProducao' | 'precoVenda' | 'valorTotal', number | null | undefined, number | null]> = [
    ['custoProducao', medida.custoProducao, t.custoProducao],
    ['precoVenda', medida.precoVenda, t.precoVenda],
    ['valorTotal', medida.valorTotal, t.valorTotal],
  ]
  let n = 0
  for (const [campo, obtido, esperado] of pares) {
    if (obtido == null || esperado == null) continue
    if (centavos(obtido) !== centavos(esperado)) {
      throw new DivergenciaCustoError(item.id, passo, t.tiragem, campo, centavos(esperado), centavos(obtido))
    }
    n++
  }
  return n
}

export async function executarProtocolo(
  item: ItemBaseline,
  passos: PassosProtocolo,
): Promise<ResultadoProtocolo> {
  const executados = new Set<PassoId>()
  let comparacoes = 0
  for (const tiragem of item.tiragens) {
    let anterior: MedidaCusto | undefined
    for (const id of ORDEM_PASSOS) {
      const passo = passos[id]
      if (!passo) continue
      const medida = await passo({ item, tiragem, anterior })
      comparacoes += comparar(item, id, tiragem, medida)
      executados.add(id)
      anterior = medida
    }
  }
  return {
    itemId: item.id,
    executados: ORDEM_PASSOS.filter((p) => executados.has(p)),
    pendentes: ORDEM_PASSOS.filter((p) => !executados.has(p)),
    comparacoes,
  }
}

/** Medição de R-ANC ("gravar plano em item ancorado"): registrada, nunca exige igualdade. */
export interface MedicaoRAnc {
  itemId: string
  status: 'MEDIDO' | 'NAO_MEDIDO'
  custoAntes?: number
  custoDepois?: number
  diferencaCentavos?: number
  motivo?: string
}

export async function medirRAnc(
  item: ItemBaseline,
  gravarPlanoEmItemAncorado?: Passo,
): Promise<MedicaoRAnc> {
  if (!gravarPlanoEmItemAncorado) {
    return {
      itemId: item.id,
      status: 'NAO_MEDIDO',
      motivo: 'depende de banco/rota (gravar PlanoCalculoGrafico em item com calculoGraficoOrigemId); sem passo plugado',
    }
  }
  const t = item.tiragens[0]
  const depois = await gravarPlanoEmItemAncorado({ item, tiragem: t })
  return {
    itemId: item.id,
    status: 'MEDIDO',
    custoAntes: t.custoProducao,
    custoDepois: depois.custoProducao,
    diferencaCentavos: centavos(depois.custoProducao) - centavos(t.custoProducao),
  }
}
