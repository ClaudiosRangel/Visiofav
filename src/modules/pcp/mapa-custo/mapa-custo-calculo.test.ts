import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { Decimal } from '@prisma/client/runtime/library'
import {
  calcularMapa,
  depreciacaoBem,
  custoFuncionario,
  resolverChave,
  NATUREZA,
  TIPO_CHAVE,
  type CalcularMapaInput,
} from './mapa-custo-calculo.service'

const D = (v: number | string) => new Decimal(v)
const near = (a: Decimal, b: number, tol = 0.01) => Math.abs(a.toNumber() - b) <= tol

describe('depreciacaoBem', () => {
  it('depreciação linear com residual (RI-1: Roland Ultra 50.000, 10 anos, 35%)', () => {
    // base = 50000 − 50000×35% = 32500 ; ÷ (10×12=120) = 270,833...
    const dep = depreciacaoBem({ id: 'b', centroCustoId: 'c', valor: 50000, estado: 'REGULAR', anosVidaUtil: 10, residualPerc: 35 })
    expect(near(dep, 270.83)).toBe(true)
  })
  it('informática sem residual (3 anos, 10.000)', () => {
    // 10000 / (3×12=36) = 277,77...
    const dep = depreciacaoBem({ id: 'b', centroCustoId: 'c', valor: 10000, estado: 'BOM', anosVidaUtil: 3, residualPerc: 0 })
    expect(near(dep, 277.78)).toBe(true)
  })
  it('anos = 0 → depreciação zero (sem divisão por zero)', () => {
    const dep = depreciacaoBem({ id: 'b', centroCustoId: 'c', valor: 1000, estado: 'BOM', anosVidaUtil: 0, residualPerc: 0 })
    expect(dep.isZero()).toBe(true)
  })
})

describe('custoFuncionario', () => {
  it('salário × (1 + 60%) + ajuda de custo', () => {
    // 2000 × 1,60 + 218 = 3418
    const c = custoFuncionario({ id: 'f', salario: 2000, ajudaCusto: 218, rateado: false }, D(60))
    expect(near(c, 3418)).toBe(true)
  })
  it('ajuda de custo NÃO sofre encargos', () => {
    const semAjuda = custoFuncionario({ id: 'f', salario: 1000, ajudaCusto: 0, rateado: false }, D(60))
    const comAjuda = custoFuncionario({ id: 'f', salario: 1000, ajudaCusto: 500, rateado: false }, D(60))
    expect(near(comAjuda.minus(semAjuda), 500)).toBe(true) // diferença = exatamente a ajuda
  })
})

describe('resolverChave', () => {
  const ctx = { headcountPorCentro: new Map<string, number>(), ativoPorCentro: new Map<string, Decimal>() }

  it('MANUAL 1+1 → 50%/50% (RI-6: impressores Roland/Heidelberg SM)', () => {
    const fr = resolverChave({ id: 'k', tipo: TIPO_CHAVE.MANUAL, destinos: [{ centroCustoId: 'r', peso: 50 }, { centroCustoId: 's', peso: 50 }] }, ctx)
    expect(near(fr.get('r')!, 0.5)).toBe(true)
    expect(near(fr.get('s')!, 0.5)).toBe(true)
  })
  it('MANUAL peso 1 em 11 centros → 9,09% cada (RI-6: Fábrica geral)', () => {
    const destinos = Array.from({ length: 11 }, (_, i) => ({ centroCustoId: `c${i}`, peso: 1 }))
    const fr = resolverChave({ id: 'k', tipo: TIPO_CHAVE.MANUAL, destinos }, ctx)
    expect(near(fr.get('c0')!, 1 / 11)).toBe(true)
    const soma = [...fr.values()].reduce((a, b) => a.plus(b), D(0))
    expect(near(soma, 1)).toBe(true)
  })
  it('HEADCOUNT usa nº de funcionários do centro', () => {
    const ctxH = { headcountPorCentro: new Map([['a', 24], ['b', 3]]), ativoPorCentro: new Map<string, Decimal>() }
    const fr = resolverChave({ id: 'k', tipo: TIPO_CHAVE.HEADCOUNT, destinos: [{ centroCustoId: 'a', peso: 0 }, { centroCustoId: 'b', peso: 0 }] }, ctxH)
    expect(near(fr.get('a')!, 24 / 27)).toBe(true)
    expect(near(fr.get('b')!, 3 / 27)).toBe(true)
  })
  it('soma de pesos zero → erro (Req 6.3)', () => {
    expect(() => resolverChave({ id: 'kx', tipo: TIPO_CHAVE.MANUAL, destinos: [{ centroCustoId: 'a', peso: 0 }] }, ctx)).toThrow(/soma de pesos/)
  })
})

/**
 * Golden case sintético determinístico — valida a mecânica RKW ponta a ponta
 * (encargos, depreciação, rateio de despesa por headcount, rateio 2 níveis,
 * custo/hora). Números escolhidos para conferência manual fácil.
 *
 * Setup:
 *  - ADM (administração): 1 func salário 1000 → A=1600. Chave ADM→ 100% PROD1.
 *  - AUX (auxiliar): 1 func salário 1000 → A=1600. Chave AUX→ 100% PROD1.
 *  - PROD1 (produtivo): 1 func salário 1000 → A=1600; 1 bem 12000/10a/0% → B=100;
 *    despesa 1000 rateada por HEADCOUNT (só PROD1 tem peso). Horas=150×1+0=150.
 */
describe('calcularMapa (golden case sintético)', () => {
  const input: CalcularMapaInput = {
    parametros: { percEncargos: 60, horasProdutivasBase: 150, ajustePraticarPerc: 24 },
    centros: [
      { id: 'ADM', codigo: 'ADM', natureza: NATUREZA.ADMINISTRACAO, unidadesProdutivas: 0, horasExtras: 0, chaveRateioId: 'kAdm' },
      { id: 'AUX', codigo: 'AUX', natureza: NATUREZA.AUXILIAR, unidadesProdutivas: 0, horasExtras: 0, chaveRateioId: 'kAux' },
      { id: 'P1', codigo: 'P1', natureza: NATUREZA.PRODUTIVO, unidadesProdutivas: 1, horasExtras: 0, chaveRateioId: null },
    ],
    bens: [
      { id: 'bem1', centroCustoId: 'P1', valor: 12000, estado: 'BOM', anosVidaUtil: 10, residualPerc: 0 }, // 12000/120 = 100
    ],
    funcionarios: [
      { id: 'fAdm', centroCustoId: 'ADM', salario: 1000, ajudaCusto: 0, rateado: false },
      { id: 'fAux', centroCustoId: 'AUX', salario: 1000, ajudaCusto: 0, rateado: false },
      { id: 'fP1', centroCustoId: 'P1', salario: 1000, ajudaCusto: 0, rateado: false },
    ],
    despesas: [
      { id: 'd1', valor: 1000, chaveRateioId: 'kDesp' },
    ],
    chaves: [
      { id: 'kAdm', tipo: TIPO_CHAVE.CENTRO, destinos: [{ centroCustoId: 'P1', peso: 1 }] },
      { id: 'kAux', tipo: TIPO_CHAVE.CENTRO, destinos: [{ centroCustoId: 'P1', peso: 1 }] },
      { id: 'kDesp', tipo: TIPO_CHAVE.HEADCOUNT, destinos: [{ centroCustoId: 'P1', peso: 0 }] },
    ],
  }

  const { resultados, totais } = calcularMapa(input)
  const r = (id: string) => resultados.find((x) => x.centroCustoId === id)!

  it('A: mão de obra com 60% encargos (1000×1,6 = 1600 cada)', () => {
    expect(near(r('P1').salariosEncargos, 1600)).toBe(true)
    expect(near(r('ADM').salariosEncargos, 1600)).toBe(true)
    expect(near(r('AUX').salariosEncargos, 1600)).toBe(true)
  })
  it('B: depreciação do bem de P1 = 100', () => {
    expect(near(r('P1').depreciacoes, 100)).toBe(true)
  })
  it('C: despesa 1000 rateada 100% a P1 (único no headcount)', () => {
    expect(near(r('P1').despesas, 1000)).toBe(true)
  })
  it('D = A+B+C: P1 = 1600+100+1000 = 2700; ADM=1600; AUX=1600', () => {
    expect(near(r('P1').custoFixo, 2700)).toBe(true)
    expect(near(r('ADM').custoFixo, 1600)).toBe(true)
    expect(near(r('AUX').custoFixo, 1600)).toBe(true)
  })
  it('E (aux) e F (adm) de P1 recebem os 1600 de cada', () => {
    expect(near(r('P1').rateioAuxiliar, 1600)).toBe(true)
    expect(near(r('P1').rateioAdministracao, 1600)).toBe(true)
  })
  it('G = D+E+F de P1 = 2700+1600+1600 = 5900', () => {
    expect(near(r('P1').custoFixoFinal, 5900)).toBe(true)
  })
  it('Custo/Hora Apurado de P1 = 5900/150 = 39,333...', () => {
    expect(near(r('P1').custoHoraApurado, 39.3333, 0.001)).toBe(true)
  })
  it('Custo/Hora A Praticar = Apurado × 1,24', () => {
    expect(near(r('P1').custoHoraPraticar, 39.3333 * 1.24, 0.01)).toBe(true)
  })
  it('totais: custoFixoTotal = D(ADM)+D(AUX)+D(P1) = 1600+1600+2700 = 5900', () => {
    expect(near(totais.custoFixoTotal, 5900)).toBe(true)
  })
  it('taxaAdministrativa = 1600/5900 ≈ 27,12%', () => {
    expect(near(totais.taxaAdministrativa, (1600 / 5900) * 100, 0.1)).toBe(true)
  })
  it('totalFuncionarios = 3; ativoImobilizado = 12000; depreciacaoMensal = 100', () => {
    expect(totais.totalFuncionarios).toBe(3)
    expect(near(totais.ativoImobilizado, 12000)).toBe(true)
    expect(near(totais.depreciacaoMensal, 100)).toBe(true)
  })

  // Property 3 (neste setup): P1 (único produtivo) recebe TODO o custo fixo
  it('Property 3 — Σ custoFixoFinal dos PRODUTIVOS = custoFixoTotal', () => {
    expect(near(r('P1').custoFixoFinal, totais.custoFixoTotal.toNumber())).toBe(true)
  })

  // Property 6 — idempotência
  it('Property 6 — recalcular produz o mesmo resultado', () => {
    const segunda = calcularMapa(input)
    expect(segunda.totais.custoFixoTotal.toString()).toBe(totais.custoFixoTotal.toString())
    expect(near(segunda.resultados.find((x) => x.centroCustoId === 'P1')!.custoHoraApurado, r('P1').custoHoraApurado.toNumber())).toBe(true)
  })
})

/**
 * Property-based (fast-check): gera mapas aleatórios com N produtivos + 1 aux + 1 adm,
 * chaves CENTRO/HEADCOUNT que distribuem 100% nos produtivos, e valida as
 * Correctness Properties do design.
 */
describe('calcularMapa — propriedades (fast-check)', () => {
  const arbMapa = fc
    .record({
      nProd: fc.integer({ min: 1, max: 5 }),
      salarios: fc.array(fc.integer({ min: 1000, max: 8000 }), { minLength: 3, maxLength: 12 }),
      valoresBem: fc.array(fc.integer({ min: 1000, max: 500000 }), { minLength: 0, maxLength: 6 }),
      despesa: fc.integer({ min: 0, max: 100000 }),
      encargos: fc.integer({ min: 0, max: 80 }),
      ajuste: fc.integer({ min: 0, max: 50 }),
    })
    .map((s) => {
      const prodIds = Array.from({ length: s.nProd }, (_, i) => `P${i}`)
      const centros = [
        { id: 'ADM', codigo: 'ADM', natureza: NATUREZA.ADMINISTRACAO, unidadesProdutivas: 0, horasExtras: 0, chaveRateioId: 'kAdm' },
        { id: 'AUX', codigo: 'AUX', natureza: NATUREZA.AUXILIAR, unidadesProdutivas: 0, horasExtras: 0, chaveRateioId: 'kAux' },
        ...prodIds.map((id, i) => ({ id, codigo: id, natureza: NATUREZA.PRODUTIVO, unidadesProdutivas: 1 + (i % 3), horasExtras: 0, chaveRateioId: null })),
      ]
      const allIds = ['ADM', 'AUX', ...prodIds]
      const funcionarios = s.salarios.map((sal, i) => ({ id: `f${i}`, centroCustoId: allIds[i % allIds.length], salario: sal, ajudaCusto: 0, rateado: false }))
      const bens = s.valoresBem.map((v, i) => ({ id: `b${i}`, centroCustoId: prodIds[i % prodIds.length], valor: v, estado: 'BOM', anosVidaUtil: 10, residualPerc: 0 }))
      const destinosProd = prodIds.map((id) => ({ centroCustoId: id, peso: 1 }))
      const input: CalcularMapaInput = {
        parametros: { percEncargos: s.encargos, horasProdutivasBase: 150, ajustePraticarPerc: s.ajuste },
        centros,
        bens,
        funcionarios,
        despesas: s.despesa > 0 ? [{ id: 'd0', valor: s.despesa, chaveRateioId: 'kDesp' }] : [],
        // kDesp por HEADCOUNT nos produtivos; se todos tiverem 0 func, cai no fallback do teste (garantimos peso via MANUAL)
        chaves: [
          { id: 'kAdm', tipo: TIPO_CHAVE.MANUAL, destinos: destinosProd },
          { id: 'kAux', tipo: TIPO_CHAVE.MANUAL, destinos: destinosProd },
          { id: 'kDesp', tipo: TIPO_CHAVE.MANUAL, destinos: destinosProd },
        ],
      }
      return input
    })

  it('Property 1 — Σ custoFixo (nível 0) = custoFixoTotal', () => {
    fc.assert(
      fc.property(arbMapa, (input) => {
        const { resultados, totais } = calcularMapa(input)
        const somaD = resultados.reduce((a, r) => a.plus(r.custoFixo), new Decimal(0))
        return near(somaD.minus(totais.custoFixoTotal), 0, 0.05)
      }),
    )
  })

  it('Property 3 — Σ custoFixoFinal dos produtivos = custoFixoTotal (rateio conserva)', () => {
    fc.assert(
      fc.property(arbMapa, (input) => {
        const { resultados, totais } = calcularMapa(input)
        const prodIds = new Set(input.centros.filter((c) => c.natureza === NATUREZA.PRODUTIVO).map((c) => c.id))
        const somaG = resultados.filter((r) => prodIds.has(r.centroCustoId)).reduce((a, r) => a.plus(r.custoFixoFinal), new Decimal(0))
        return near(somaG.minus(totais.custoFixoTotal), 0, 0.5)
      }),
    )
  })

  it('Property 4 — custo/hora apurado ≥ 0 para todo produtivo', () => {
    fc.assert(
      fc.property(arbMapa, (input) => {
        const { resultados } = calcularMapa(input)
        return resultados.every((r) => r.custoHoraApurado.greaterThanOrEqualTo(0))
      }),
    )
  })

  it('Property 5 — A Praticar = Apurado × (1 + ajuste%)', () => {
    fc.assert(
      fc.property(arbMapa, (input) => {
        const { resultados } = calcularMapa(input)
        const ajuste = new Decimal(input.parametros.ajustePraticarPerc).dividedBy(100)
        return resultados.every((r) => {
          const esperado = r.custoHoraApurado.times(new Decimal(1).plus(ajuste))
          return near(esperado.minus(r.custoHoraPraticar), 0, 0.01)
        })
      }),
    )
  })

  it('Property 6 — idempotência (recalcular = mesmo resultado)', () => {
    fc.assert(
      fc.property(arbMapa, (input) => {
        const a = calcularMapa(input)
        const b = calcularMapa(input)
        return a.totais.custoFixoTotal.toString() === b.totais.custoFixoTotal.toString()
      }),
    )
  })
})
