import { describe, it, expect } from 'vitest'
import { calcularOrcamentoGrafico } from '../orcamento-grafico-calculo.service'
import { input7343, alvo7343 } from './golden-7343.fixture'

/**
 * GOLDEN 7343 — "RÓTULO P/ARAME FARPADO ELEFANTE 250M" (cliente 368, 4.000 un).
 *
 * Congela a paridade do Vizor com a MEMÓRIA DE CÁLCULO (pré-cálculo) do
 * Calcgraf/G-Print enviada pelo usuário: reproduz cada componente (suporte,
 * matriz, 3 tintas, 2 materiais de acabamento, impressão e 4 acabamentos
 * hora-máquina) e os agregados MD/CT/C.PROD, com desvio ≤ tolerância.
 *
 * Caso de PLANO ÚNICO / impressão offset 3x0 — complementa os goldens de
 * cartucho (15.235) e os de calibração de componente (15185/15086). Prova que o
 * modelo de composição MD + CT → C.PROD do Vizor reproduz o C.PROD 5.411,87.
 */

const TOL = alvo7343.tolerancia

function esperaBate(nome: string, calc: number, alvo: number, tol = TOL) {
  const desvio = alvo === 0 ? (calc === 0 ? 0 : 1) : Math.abs(calc - alvo) / Math.abs(alvo)
  expect(
    desvio <= tol,
    `${nome}: calc=${calc.toFixed(2)} alvo=${alvo} desvio=${(desvio * 100).toFixed(3)}% (limite ${(tol * 100).toFixed(1)}%)`,
  ).toBe(true)
}

const r = calcularOrcamentoGrafico(input7343)

function centro(nome: string): number {
  const c = r.acabamentosCentros?.detalhePorEtapa.find((e) => e.etapa.startsWith(nome))
  return c ? c.custo : NaN
}
function matItem(nome: string): number {
  const i = r.matAcabamento?.itens.find((x) => x.nome.startsWith(nome))
  return i ? i.subtotal : NaN
}

describe('Golden 7343 — Material Direto (itens ≤0,8%)', () => {
  it('SUPORTE Nz Bobina 325 (2.682,92)', () => esperaBate('suporte', matItem('Suporte Nz Bobina'), alvo7343.componentes.suporte))
  it('MATRIZ RVU (300,00)', () => esperaBate('matriz', matItem('Matriz'), alvo7343.componentes.matriz))
  it('TINTAS Pantone 01/02/03', () => {
    esperaBate('pantone01', matItem('Tinta Pantone 01'), alvo7343.componentes.pantone01)
    esperaBate('pantone02', matItem('Tinta Pantone 02'), alvo7343.componentes.pantone02)
    esperaBate('pantone03', matItem('Tinta Pantone 03'), alvo7343.componentes.pantone03)
  })
  it('MAT.ACABAMENTO — BOPP + Fita', () => {
    esperaBate('bopp', matItem('BOPP Brilho'), alvo7343.componentes.boppBrilho)
    esperaBate('fita', matItem('Fita Dupla Face'), alvo7343.componentes.fitaMaterial)
  })
})

describe('Golden 7343 — Custo de Transformação (centros ≤0,8%)', () => {
  it('IMPRESSÃO Offset RVU 4c (770,00)', () => esperaBate('impressao', centro('Offset Plana Roland'), alvo7343.componentes.impressao))
  it('Guilhotina de envol (51,79)', () => esperaBate('guilhotina', centro('Guilhotina de envol'), alvo7343.componentes.guilhotina))
  it('Cortadeira (Grande) (89,18)', () => esperaBate('cortadeira', centro('Cortadeira'), alvo7343.componentes.cortadeira))
  it('Fita dupla face (160,00)', () => esperaBate('fitaHora', centro('Fita dupla face'), alvo7343.componentes.fitaHora))
  it('Laminação maior (100,00)', () => esperaBate('laminacao', centro('Laminação maior'), alvo7343.componentes.laminacao))
})

describe('Golden 7343 — agregados (≤0,5%)', () => {
  it('Material Direto 4.240,89', () => esperaBate('MD', r.materialDireto, alvo7343.agregados.materialDireto, 0.005))
  it('Custo de Transformação 1.170,98', () => esperaBate('CT', r.custoTransformacao, alvo7343.agregados.custoTransformacao, 0.005))
  it('Custo de Produção 5.411,87 (MD + CT + SE)', () => esperaBate('C.Prod', r.custoProducao, alvo7343.agregados.custoProducao, 0.005))
})
