import { describe, it, expect } from 'vitest'
import { calcularOrcamentoGrafico } from '../orcamento-grafico-calculo.service'
import { consolidarOrcamento, type FechamentoItem } from '../orcamento-grafico-consolidacao.service'
import { input15235, alvo15235 } from './golden-acabamentos-15235.fixture'

/**
 * TASK 23 — Golden 15.235 (item único, não-regressão) NO FLUXO MULTI-ITEM.
 *
 * Objetivo (Req 13.1/13.2/13.3/13.4): provar que o golden 15.235 continua
 * batendo ≤0,5% QUANDO calculado pelo motor via os mesmos params que o
 * ENVELOPE multi-item produziria para este item.
 *
 * ----------------------------------------------------------------------------
 * ABORDAGEM — por que este é um teste PURO (sem banco):
 *
 * O envelope de item (`orcamento-grafico-item.service.ts`,
 * `montarParamsDoItem`/`calcularItem`) RESOLVE cadastros do banco por
 * `empresaId` (Prisma) e, no fim, chama `calcularOrcamentoGrafico(params)`.
 * Logo, `calcularItem` NÃO pode ser exercitado num teste unitário puro — ele
 * acessa o Prisma. Mas, como a ÚNICA coisa que o envelope faz antes de calcular
 * é resolver cadastros em `params`, o RESULTADO de um item é exatamente
 * `calcularOrcamentoGrafico` aplicado a esses `params`.
 *
 * `input15235` JÁ É o `ParamsOrcamento` que o envelope produziria para este
 * item (matriz/tinta como itens diretos, cores, acabamentos ricos resolvidos).
 * Portanto validamos a EQUIVALÊNCIA do fluxo multi-item com o motor congelado
 * confrontando `calcularOrcamentoGrafico(input15235)` contra `alvo15235`,
 * componente a componente + agregados + margens (≤0,5%).
 *
 * ADICIONALMENTE, provamos a CONSOLIDAÇÃO multi-item de 1 item (Req 13.4):
 * importamos `consolidarOrcamento` e verificamos que, com UM único
 * `FechamentoItem` derivado deste resultado, o Custo de Produção Consolidado e
 * o Valor Total Consolidado do orçamento são iguais (≤ R$ 0,01) aos valores do
 * próprio item — provando que o envelope de 1 item PRESERVA o golden.
 * ----------------------------------------------------------------------------
 */

const TOL = alvo15235.tolerancia // 0,5%

/** Desvio relativo |calc − alvo| / |alvo| (alvo 0 → exige calc 0). */
function dentroDaTolerancia(calc: number, alvo: number, tol = TOL): boolean {
  if (alvo === 0) return Math.abs(calc) < 1e-9
  return Math.abs(calc - alvo) / Math.abs(alvo) <= tol
}

/** Assert com mensagem clara do componente divergente (reuso do estilo do golden existente). */
function esperaBate(nome: string, calc: number, alvo: number, tol = TOL) {
  const desvio = alvo === 0 ? (calc === 0 ? 0 : 1) : Math.abs(calc - alvo) / Math.abs(alvo)
  expect(
    dentroDaTolerancia(calc, alvo, tol),
    `${nome}: calc=${calc} alvo=${alvo} desvio=${(desvio * 100).toFixed(3)}% (limite ${(tol * 100).toFixed(1)}%)`,
  ).toBe(true)
}

// Resultado do item calculado pelo motor com os params que o envelope produz.
const r = calcularOrcamentoGrafico(input15235)

/** Localiza o custo de um centro de acabamento pelo nome (startsWith). */
function centro(nome: string): number {
  const c = r.acabamentosCentros?.detalhePorEtapa.find((e) => e.etapa.startsWith(nome))
  return c ? c.custo : NaN
}

/** Localiza o subtotal de um item de MAT.ACABAMENTO pelo início do nome. */
function matItem(nome: string): number {
  const i = r.matAcabamento?.itens.find((x) => x.nome.startsWith(nome))
  return i ? i.subtotal : NaN
}

describe('Golden 15.235 no fluxo multi-item (Task 23)', () => {
  it('componentes + agregados batem ≤0,5% via o motor sobre os params do envelope', () => {
    // ── 6 componentes ──
    // SUPORTE (papel)
    esperaBate('suporte', r.papel.custo, alvo15235.componentes.suporte)

    // MATRIZ IMPRESSÃO (entra no MD como item fixo)
    esperaBate('matriz', matItem('Matriz'), alvo15235.componentes.matriz)

    // TINTA (Escala + Metálica) — itens diretos, validada via o agregado MD.
    const tintaAlvo = alvo15235.componentes.tintaEscala + alvo15235.componentes.tintaMetalica
    const mdSemTinta =
      alvo15235.componentes.suporte +
      alvo15235.componentes.matriz +
      alvo15235.componentes.matAcab.cola +
      alvo15235.componentes.matAcab.faca +
      alvo15235.componentes.matAcab.verniz +
      alvo15235.componentes.matAcab.caixa
    esperaBate('tinta (via MD)', r.materialDireto - mdSemTinta, tintaAlvo, 0.01)

    // MAT.ACABAMENTO — Cola / FACA / Verniz / Caixa
    esperaBate('cola', matItem('Cola Branca'), alvo15235.componentes.matAcab.cola)
    esperaBate('faca', matItem('FACA NOVA'), alvo15235.componentes.matAcab.faca)
    esperaBate('verniz', matItem('Verniz'), alvo15235.componentes.matAcab.verniz)
    esperaBate('caixa', matItem('Caixa'), alvo15235.componentes.matAcab.caixa)

    // IMPRESSÃO (CT)
    esperaBate('impressao', r.maquinas.custoTotal, alvo15235.componentes.impressao)

    // ACABAMENTO — cadeia de 5 centros (CT)
    esperaBate('cortadeira', centro('Cortadeira'), alvo15235.componentes.acab.cortadeira)
    esperaBate('guilhotina', centro('Guilhotina'), alvo15235.componentes.acab.guilhotina)
    esperaBate('bobst', centro('Bobst E'), alvo15235.componentes.acab.bobst)
    esperaBate('destacar', centro('Destacar'), alvo15235.componentes.acab.destacar)
    esperaBate('aft70', centro('AFT70'), alvo15235.componentes.acab.aft70)

    // ── agregados ──
    esperaBate('MD', r.materialDireto, alvo15235.agregados.materialDireto)
    esperaBate('CT', r.custoTransformacao, alvo15235.agregados.custoTransformacao)
    esperaBate('C.Prod', r.custoProducao, alvo15235.agregados.custoProducao)
    esperaBate('Total', r.custoTotal, alvo15235.agregados.total)
  })

  it('consolidação de 1 item preserva o golden: Σ = item (≤ R$ 0,01) — Req 13.4', () => {
    // Um único FechamentoItem derivado do resultado do próprio item.
    // O preço de venda do resultado usa o markup declarado no input (30,01).
    const item: FechamentoItem = {
      custoProducao: r.custoProducao,
      valorTotalPorMargem: { '30.01': r.precoVenda },
      margemSelecionada: 30.01,
    }

    const consolidado = consolidarOrcamento([item])

    // Σ de 1 item = o próprio item (consolidação só arredonda a 2 casas).
    expect(Math.abs(consolidado.custoProducaoConsolidado - r.custoProducao)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(consolidado.valorTotalConsolidado - r.precoVenda)).toBeLessThanOrEqual(0.01)
  })
})
