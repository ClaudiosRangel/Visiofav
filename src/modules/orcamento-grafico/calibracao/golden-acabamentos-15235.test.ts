import { describe, it, expect } from 'vitest'
import { calcularOrcamentoGrafico, formarPrecoVenda } from '../orcamento-grafico-calculo.service'
import { input15235, alvo15235 } from './golden-acabamentos-15235.fixture'

/**
 * GOLDEN 15.235 — Cartucho "Kit Intense Fragrance" (ESTAÇÃO Y, 20.000 un).
 *
 * Congela a paridade do Vizor com o pré-cálculo do Calcgraf/G-Print
 * (docs/calcgraf-golden-15235-acabamentos.md) para trabalhos COM ACABAMENTOS:
 * reproduz cada componente (suporte, matriz, tinta, MAT.ACABAMENTO, impressão,
 * cadeia de centros de acabamento) e os agregados (MD/CT/C.Prod/Total) e as 3
 * margens, com desvio ≤ 0,5%. Qualquer regressão futura no cálculo de
 * acabamentos FALHA a suíte (Req 6.5).
 *
 * Nota de modelagem (ver fixture): a TINTA deste caso é representada como itens
 * diretos de material (entram no MD) — o consumo fino de tinta já é calibrado
 * no golden 15185. Aqui o foco é o relatório de acabamentos. Assim, o alvo de
 * tinta é validado via o agregado MD (que já o inclui), não via `tinta.custoTotal`.
 */

const TOL = alvo15235.tolerancia // 0,5%

/** Desvio relativo |calc − alvo| / |alvo| (alvo 0 → exige calc 0). */
function dentroDaTolerancia(calc: number, alvo: number, tol = TOL): boolean {
  if (alvo === 0) return Math.abs(calc) < 1e-9
  return Math.abs(calc - alvo) / Math.abs(alvo) <= tol
}

/** Assert com mensagem clara do componente divergente (Req 6.5). */
function esperaBate(nome: string, calc: number, alvo: number, tol = TOL) {
  const desvio = alvo === 0 ? (calc === 0 ? 0 : 1) : Math.abs(calc - alvo) / Math.abs(alvo)
  expect(
    dentroDaTolerancia(calc, alvo, tol),
    `${nome}: calc=${calc} alvo=${alvo} desvio=${(desvio * 100).toFixed(3)}% (limite ${(tol * 100).toFixed(1)}%)`,
  ).toBe(true)
}

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

describe('Golden 15.235 — componentes (≤0,5%)', () => {
  it('SUPORTE (papel)', () => esperaBate('suporte', r.papel.custo, alvo15235.componentes.suporte))

  it('MATRIZ IMPRESSÃO (176,00)', () =>
    esperaBate('matriz', matItem('Matriz'), alvo15235.componentes.matriz))

  it('MAT.ACABAMENTO — Cola / FACA / Verniz / Caixa', () => {
    esperaBate('cola', matItem('Cola Branca'), alvo15235.componentes.matAcab.cola)
    esperaBate('faca', matItem('FACA NOVA'), alvo15235.componentes.matAcab.faca)
    esperaBate('verniz', matItem('Verniz'), alvo15235.componentes.matAcab.verniz)
    esperaBate('caixa', matItem('Caixa'), alvo15235.componentes.matAcab.caixa)
  })

  it('IMPRESSÃO (1.600,00)', () =>
    esperaBate('impressao', r.maquinas.custoTotal, alvo15235.componentes.impressao))

  it('ACABAMENTO — cadeia de 5 centros', () => {
    esperaBate('cortadeira', centro('Cortadeira'), alvo15235.componentes.acab.cortadeira)
    esperaBate('guilhotina', centro('Guilhotina'), alvo15235.componentes.acab.guilhotina)
    esperaBate('bobst', centro('Bobst E'), alvo15235.componentes.acab.bobst)
    esperaBate('destacar', centro('Destacar'), alvo15235.componentes.acab.destacar)
    esperaBate('aft70', centro('AFT70'), alvo15235.componentes.acab.aft70)
  })

  it('TINTA (Escala + Metálica) incluída no MD', () => {
    // A tinta entra no MD via itens diretos; validamos a soma-alvo 440,65
    // conferindo que o MD contém suporte + matriz + matAcab + tinta.
    const tintaAlvo = alvo15235.componentes.tintaEscala + alvo15235.componentes.tintaMetalica
    const mdSemTinta =
      alvo15235.componentes.suporte +
      alvo15235.componentes.matriz +
      alvo15235.componentes.matAcab.cola +
      alvo15235.componentes.matAcab.faca +
      alvo15235.componentes.matAcab.verniz +
      alvo15235.componentes.matAcab.caixa
    esperaBate('tinta (via MD)', r.materialDireto - mdSemTinta, tintaAlvo, 0.01)
  })
})

describe('Golden 15.235 — agregados (≤0,5%)', () => {
  it('Material Direto 6.598,70', () => esperaBate('MD', r.materialDireto, alvo15235.agregados.materialDireto))
  it('Custo de Transformação 3.814,80', () =>
    esperaBate('CT', r.custoTransformacao, alvo15235.agregados.custoTransformacao))
  it('Custo de Produção 10.413,50', () =>
    esperaBate('C.Prod', r.custoProducao, alvo15235.agregados.custoProducao))
  it('Total 10.427,04', () => esperaBate('Total', r.custoTotal, alvo15235.agregados.total))
})

describe('Golden 15.235 — margens por tiragem (≤0,5%)', () => {
  // O gross-up usa o mesmo CEV (17,75%) do caso; variamos só o markup.
  const cevPerc = input15235.cev
    ? input15235.cev.icms + input15235.cev.juros + input15235.cev.pisCofins + input15235.cev.comissoes
    : 0
  for (const m of alvo15235.margens) {
    it(`markup ${m.markup}% → ${m.total}`, () => {
      const preco = formarPrecoVenda(r.custoTotal, {
        impostos: cevPerc,
        comissao: 0,
        despAdm: 0,
        markup: m.markup,
      })
      esperaBate(`margem ${m.markup}%`, preco, m.total)
    })
  }
})
