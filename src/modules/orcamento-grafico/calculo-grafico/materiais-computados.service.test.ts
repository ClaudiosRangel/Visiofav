import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  somarMateriaisComputados,
  aplicarMateriaisComputadosAoResultado,
  type MaterialAcabamentoVinculo,
} from './materiais-computados.service'

/**
 * Testes do motor puro de materiais de acabamento computados.
 * Spec orcamento-grafico-paridade-total-calcgraf (Req 6, Properties 1–5).
 */

// Gerador de um material com valores >= 0 (campos numéricos podem vir como
// number ou string, imitando o Json solto do item).
const materialNaoNegativoArb = fc.record({
  materialAcabamentoId: fc.option(fc.string(), { nil: undefined }),
  nome: fc.option(fc.string(), { nil: undefined }),
  computarCusto: fc.boolean(),
  valorUnitario: fc.oneof(
    fc.double({ min: 0, max: 1_000_000, noNaN: true }),
    fc.double({ min: 0, max: 1_000_000, noNaN: true }).map((n) => String(n)),
    fc.constant(null),
    fc.constant(undefined),
  ),
  quantidade: fc.oneof(
    fc.double({ min: 0, max: 1_000_000, noNaN: true }),
    fc.double({ min: 0, max: 1_000_000, noNaN: true }).map((n) => String(n)),
    fc.constant(null),
    fc.constant(undefined),
  ),
}) as fc.Arbitrary<MaterialAcabamentoVinculo>

const listaNaoNegativaArb = fc.array(materialNaoNegativoArb, { maxLength: 30 })

describe('somarMateriaisComputados — golden cases', () => {
  it('soma valorUnitario * quantidade de um item computado', () => {
    const total = somarMateriaisComputados([
      { computarCusto: true, valorUnitario: 0.55, quantidade: 1000 },
    ])
    expect(total).toBeCloseTo(550, 6)
  })

  it('soma vários computados e ignora os não-computados', () => {
    const total = somarMateriaisComputados([
      { computarCusto: true, valorUnitario: 0.55, quantidade: 1000 }, // 550
      { computarCusto: false, valorUnitario: 10, quantidade: 100 }, // ignorado
      { computarCusto: true, valorUnitario: 2, quantidade: 50 }, // 100
    ])
    expect(total).toBeCloseTo(650, 6)
  })

  it('aceita campos numéricos como string (Json solto)', () => {
    const total = somarMateriaisComputados([
      { computarCusto: true, valorUnitario: '1.5', quantidade: '200' },
    ])
    expect(total).toBeCloseTo(300, 6)
  })

  it('trata valores ausentes/negativos/NaN como 0', () => {
    expect(
      somarMateriaisComputados([
        { computarCusto: true, valorUnitario: -5, quantidade: 100 },
        { computarCusto: true, valorUnitario: 'abc', quantidade: 10 },
        { computarCusto: true, valorUnitario: null, quantidade: 10 },
        { computarCusto: true, quantidade: 10 },
      ]),
    ).toBe(0)
  })

  it('retorna 0 para null/undefined/vazio', () => {
    expect(somarMateriaisComputados(null)).toBe(0)
    expect(somarMateriaisComputados(undefined)).toBe(0)
    expect(somarMateriaisComputados([])).toBe(0)
  })
})

describe('somarMateriaisComputados — Correctness Properties', () => {
  // Property 1: não-negatividade.
  it('P1: total >= 0 para quaisquer valorUnitario/quantidade >= 0', () => {
    fc.assert(
      fc.property(listaNaoNegativaArb, (materiais) => {
        expect(somarMateriaisComputados(materiais)).toBeGreaterThanOrEqual(0)
      }),
    )
  })

  // Property 2: ignora não-computados.
  it('P2: itens com computarCusto !== true não contribuem', () => {
    fc.assert(
      fc.property(listaNaoNegativaArb, (materiais) => {
        const soComputados = materiais.filter((m) => m.computarCusto === true)
        expect(somarMateriaisComputados(materiais)).toBeCloseTo(
          somarMateriaisComputados(soComputados),
          6,
        )
      }),
    )
  })

  // Property 3: identidade/zero — nenhum computarCusto => total 0.
  it('P3: se nenhum item tem computarCusto, total === 0', () => {
    const naoComputadoArb = materialNaoNegativoArb.map((m) => ({
      ...m,
      computarCusto: false,
    }))
    fc.assert(
      fc.property(fc.array(naoComputadoArb, { maxLength: 30 }), (materiais) => {
        expect(somarMateriaisComputados(materiais)).toBe(0)
      }),
    )
  })

  // Property 4: aditividade — f(a.concat(b)) === f(a) + f(b).
  it('P4: aditividade com tolerância de ponto flutuante', () => {
    fc.assert(
      fc.property(listaNaoNegativaArb, listaNaoNegativaArb, (a, b) => {
        expect(somarMateriaisComputados(a.concat(b))).toBeCloseTo(
          somarMateriaisComputados(a) + somarMateriaisComputados(b),
          6,
        )
      }),
    )
  })

  // Property 5: determinismo — mesma entrada => mesmo total.
  it('P5: mesma entrada produz sempre o mesmo total', () => {
    fc.assert(
      fc.property(listaNaoNegativaArb, (materiais) => {
        expect(somarMateriaisComputados(materiais)).toBe(
          somarMateriaisComputados(materiais),
        )
      }),
    )
  })
})

describe('aplicarMateriaisComputadosAoResultado — soma aditiva por cima', () => {
  it('soma o delta a MD/custoProducao/custoTotal', () => {
    const r = aplicarMateriaisComputadosAoResultado(
      { materialDireto: 100, custoProducao: 180, custoTotal: 180, precoVenda: 300 },
      50,
    )
    expect(r.materialDireto).toBeCloseTo(150, 6)
    expect(r.custoProducao).toBeCloseTo(230, 6)
    expect(r.custoTotal).toBeCloseTo(230, 6)
  })

  it('propaga ao preço via gross-up proporcional ao custo', () => {
    // preço = custoTotal/(1-fator). fator aqui implícito: 300 = 180/(1-0,4).
    // Novo custoTotal 230 → preço 230/0,6 = 383,33 = 300 * (230/180).
    const r = aplicarMateriaisComputadosAoResultado(
      { materialDireto: 100, custoProducao: 180, custoTotal: 180, precoVenda: 300 },
      50,
    )
    expect(r.precoVenda).toBeCloseTo(383.33, 2)
  })

  it('delta 0 (ou negativo) não altera o resultado — não-regressão (R6.7)', () => {
    const base = { materialDireto: 100, custoProducao: 180, custoTotal: 180, precoVenda: 300 }
    const zerado = aplicarMateriaisComputadosAoResultado({ ...base }, 0)
    expect(zerado).toEqual(base)
    const negativo = aplicarMateriaisComputadosAoResultado({ ...base }, -10)
    expect(negativo).toEqual(base)
  })

  it('preserva a âncora de repetição: soma o delta POR CIMA do valor ancorado', () => {
    // Resultado já ANCORADO no Calcgraf (ex.: 5.192,05). O delta só ACRESCE.
    const ancorado = { materialDireto: 4113.94, custoProducao: 5192.05, custoTotal: 5192.05, precoVenda: 7000 }
    const delta = somarMateriaisComputados([{ computarCusto: true, valorUnitario: 0.55, quantidade: 1000 }]) // 550
    const r = aplicarMateriaisComputadosAoResultado({ ...ancorado }, delta)
    expect(r.custoProducao).toBeCloseTo(5742.05, 2) // 5192,05 + 550, âncora preservada + delta
    expect(r.materialDireto).toBeCloseTo(4663.94, 2)
    expect(r.custoTotal).toBeCloseTo(5742.05, 2)
    expect(r.precoVenda).toBeGreaterThan(7000) // preço acompanha o acréscimo
  })

  it('não propaga preço quando não há base de custo > 0 (evita divisão por zero)', () => {
    const r = aplicarMateriaisComputadosAoResultado(
      { materialDireto: 0, custoProducao: 0, custoTotal: 0, precoVenda: 0 },
      50,
    )
    expect(r.materialDireto).toBeCloseTo(50, 6)
    expect(r.custoProducao).toBeCloseTo(50, 6)
    expect(r.precoVenda).toBe(0)
  })

  // Property: custo de produção final = custo original + delta (aditividade).
  it('P6: custoProducao_final === custoProducao_inicial + delta (delta >= 0)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1_000_000, noNaN: true }),
        fc.double({ min: 0, max: 1_000_000, noNaN: true }),
        (custoInicial, delta) => {
          const r = aplicarMateriaisComputadosAoResultado(
            { materialDireto: custoInicial, custoProducao: custoInicial, custoTotal: custoInicial, precoVenda: custoInicial * 2 },
            delta,
          )
          const esperado = Math.round((custoInicial + delta) * 100) / 100
          expect(r.custoProducao).toBeCloseTo(esperado, 2)
        },
      ),
    )
  })
})
