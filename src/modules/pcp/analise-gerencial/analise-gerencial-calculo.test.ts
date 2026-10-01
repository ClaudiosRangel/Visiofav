import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { Decimal } from '@prisma/client/runtime/library'
import {
  consolidarCM,
  pontoEquilibrio,
  cobertura,
  calcularIndicadores,
  simular,
  cmDoOrcamento,
  calcularPosCalculo,
  confrontarDRE,
  type OrcamentoResumo,
} from './analise-gerencial-calculo.service'

const near = (a: Decimal, b: number, tol = 0.01) => Math.abs(a.toNumber() - b) <= tol

describe('cmDoOrcamento', () => {
  it('usa CM do resultadoCalculo quando presente', () => {
    const r = cmDoOrcamento({ id: '1', status: 'APROVADO', precoVenda: 1000, custoTotal: 700, cmValor: 350 })
    expect(near(r.valor, 350)).toBe(true)
    expect(r.fallback).toBe(false)
  })
  it('fallback preço − custo quando CM ausente', () => {
    const r = cmDoOrcamento({ id: '1', status: 'APROVADO', precoVenda: 1000, custoTotal: 700 })
    expect(near(r.valor, 300)).toBe(true)
    expect(r.fallback).toBe(true)
  })
})

describe('consolidarCM (golden)', () => {
  // 3 orçamentos APROVADOS + 1 RECUSADO. CM% média é PONDERADA pelo preço.
  const orcamentos: OrcamentoResumo[] = [
    { id: 'a', status: 'APROVADO', precoVenda: 10000, custoTotal: 6000, cmValor: 4000, cmPerc: 40 },
    { id: 'b', status: 'APROVADO', precoVenda: 20000, custoTotal: 14000, cmValor: 6000, cmPerc: 30 },
    { id: 'c', status: 'APROVADO', precoVenda: 5000, custoTotal: 2500, cmValor: 2500, cmPerc: 50 },
    { id: 'd', status: 'RECUSADO', precoVenda: 9000, custoTotal: 5000, cmValor: 4000, cmPerc: 44 },
  ]
  const c = consolidarCM(orcamentos)

  it('conta fechados (só APROVADO) e total', () => {
    expect(c.fechados).toBe(3)
    expect(c.totalOrcamentos).toBe(4)
  })
  it('taxa de conversão = 3/4 = 0,75', () => {
    expect(near(c.taxaConversao, 0.75, 0.0001)).toBe(true)
  })
  it('soma preço fechados = 35.000 e soma CM = 12.500', () => {
    expect(near(c.somaPrecoVendaFechados, 35000)).toBe(true)
    expect(near(c.somaCMFechados, 12500)).toBe(true)
  })
  it('CM% média PONDERADA = 12.500 / 35.000 = 35,71% (não a média aritmética 40%)', () => {
    expect(near(c.cmMediaPerc, 35.714, 0.01)).toBe(true)
  })
  it('sem fallback quando todos têm CM', () => {
    expect(c.algumFallback).toBe(false)
  })
  it('marca fallback quando algum ganho não tem CM', () => {
    const c2 = consolidarCM([{ id: 'x', status: 'APROVADO', precoVenda: 1000, custoTotal: 600 }])
    expect(c2.algumFallback).toBe(true)
    expect(near(c2.somaCMFechados, 400)).toBe(true)
  })
  it('temPedido conta como ganho mesmo sem status APROVADO', () => {
    const c3 = consolidarCM([{ id: 'y', status: 'ENVIADO', precoVenda: 1000, custoTotal: 600, cmValor: 400, temPedido: true }])
    expect(c3.fechados).toBe(1)
  })
})

describe('pontoEquilibrio', () => {
  it('CF 350.000 e CM% 35 → 1.000.000', () => {
    const pe = pontoEquilibrio(350000, 35)
    expect(pe).not.toBeNull()
    expect(near(pe!, 1000000, 1)).toBe(true)
  })
  it('CM% ≤ 0 → indefinido (null, sem divisão por zero)', () => {
    expect(pontoEquilibrio(350000, 0)).toBeNull()
    expect(pontoEquilibrio(350000, -5)).toBeNull()
  })
})

describe('cobertura', () => {
  it('Σ CM 200.000 vs CF 350.000 → 57,14% coberto, faltante 150.000, resultado −150.000', () => {
    const r = cobertura(200000, 350000)
    expect(near(r.coberturaPerc, 57.14, 0.01)).toBe(true)
    expect(near(r.faltante, 150000)).toBe(true)
    expect(near(r.resultado, -150000)).toBe(true)
  })
  it('Σ CM > CF → faltante 0 e resultado positivo', () => {
    const r = cobertura(400000, 350000)
    expect(r.faltante.isZero()).toBe(true)
    expect(near(r.resultado, 50000)).toBe(true)
  })
  it('CF = 0 → cobertura 0 (sem divisão por zero)', () => {
    const r = cobertura(100, 0)
    expect(r.coberturaPerc.isZero()).toBe(true)
  })
})

describe('calcularIndicadores (ponta a ponta)', () => {
  const orcamentos: OrcamentoResumo[] = [
    { id: 'a', status: 'APROVADO', precoVenda: 100000, custoTotal: 60000, cmValor: 40000, cmPerc: 40 },
    { id: 'b', status: 'APROVADO', precoVenda: 100000, custoTotal: 70000, cmValor: 30000, cmPerc: 30 },
  ]
  const ind = calcularIndicadores(orcamentos, 50000)
  it('CM% média ponderada = 70.000/200.000 = 35%', () => {
    expect(near(ind.consolidado.cmMediaPerc, 35)).toBe(true)
  })
  it('resultado = ΣCM − CF = 70.000 − 50.000 = 20.000', () => {
    expect(near(ind.resultadoPeriodo, 20000)).toBe(true)
  })
  it('ponto de equilíbrio = 50.000 / 0,35 ≈ 142.857', () => {
    expect(near(ind.pontoEquilibrio!, 142857.14, 0.5)).toBe(true)
  })
})

describe('simular', () => {
  it('cenários 80/100/120% com CM% padrão', () => {
    const res = simular(50000, [
      { faturamento: 80000 },
      { faturamento: 100000 },
      { faturamento: 120000 },
    ], 35)
    expect(near(res[0].cmProjetada, 28000)).toBe(true) // 80.000 × 35%
    expect(near(res[0].resultado, -22000)).toBe(true)
    expect(near(res[1].cmProjetada, 35000)).toBe(true)
    expect(near(res[2].cmProjetada, 42000)).toBe(true)
    expect(near(res[2].resultado, -8000)).toBe(true)
  })
  it('cenário com cmPerc próprio sobrepõe o padrão', () => {
    const res = simular(50000, [{ faturamento: 100000, cmPerc: 50 }], 35)
    expect(near(res[0].cmProjetada, 50000)).toBe(true)
    expect(res[0].resultado.isZero()).toBe(true)
  })
})

// ── Property-based ────────────────────────────────────────────────────────────
describe('propriedades', () => {
  const arbOrc = fc.record({
    preco: fc.integer({ min: 1, max: 1_000_000 }),
    cmPercBruta: fc.integer({ min: 1, max: 99 }),
  })

  it('P1: CM% média ponderada fica entre a menor e a maior CM% dos itens', () => {
    fc.assert(
      fc.property(fc.array(arbOrc, { minLength: 1, maxLength: 30 }), (items) => {
        const orcs: OrcamentoResumo[] = items.map((x, i) => ({
          id: String(i), status: 'APROVADO', precoVenda: x.preco, custoTotal: 0,
          cmValor: (x.preco * x.cmPercBruta) / 100, cmPerc: x.cmPercBruta,
        }))
        const c = consolidarCM(orcs)
        const min = Math.min(...items.map((x) => x.cmPercBruta))
        const max = Math.max(...items.map((x) => x.cmPercBruta))
        const media = c.cmMediaPerc.toNumber()
        return media >= min - 0.01 && media <= max + 0.01
      }),
    )
  })

  it('P2: PE × (CM%/100) ≈ CF quando CM% > 0 (inverso)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5_000_000 }),
        fc.integer({ min: 1, max: 99 }),
        (cf, cmPerc) => {
          const pe = pontoEquilibrio(cf, cmPerc)
          if (!pe) return false
          const back = pe.times(cmPerc).dividedBy(100)
          return Math.abs(back.toNumber() - cf) <= 1
        },
      ),
    )
  })

  it('P3: cobertura ≥ 0 e resultado = ΣCM − CF (identidade)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.integer({ min: 0, max: 5_000_000 }),
        (cm, cf) => {
          const r = cobertura(cm, cf)
          const idOk = Math.abs(r.resultado.toNumber() - (cm - cf)) <= 0.01
          return r.coberturaPerc.greaterThanOrEqualTo(0) && idOk
        },
      ),
    )
  })

  it('P4: CM% ≤ 0 sempre dá PE indefinido (nunca divide por zero)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5_000_000 }), fc.integer({ min: -50, max: 0 }), (cf, cm) => {
        return pontoEquilibrio(cf, cm) === null
      }),
    )
  })
})

describe('calcularPosCalculo', () => {
  it('desvio de quantidade e valor proporcional', () => {
    const r = calcularPosCalculo([
      { referencia: 'OP-1', quantidadePrevista: 1000, quantidadeProduzida: 950, quantidadeRejeitada: 20, valorPrevisto: 10000, semRealizado: false },
    ])
    expect(near(r[0].desvioQuantidade, -50)).toBe(true)
    expect(near(r[0].desvioQuantidadePerc, -5)).toBe(true)
    // valor proporcional = 10.000 × 950/1000 = 9.500
    expect(near(r[0].valorProporcionalRealizado, 9500)).toBe(true)
  })
  it('produção acima do previsto → desvio positivo', () => {
    const r = calcularPosCalculo([
      { referencia: 'OP-2', quantidadePrevista: 1000, quantidadeProduzida: 1080, valorPrevisto: 5000, semRealizado: false },
    ])
    expect(near(r[0].desvioQuantidade, 80)).toBe(true)
    expect(near(r[0].desvioQuantidadePerc, 8)).toBe(true)
  })
  it('item sem realizado não quebra (proporcional 0, flag preservada)', () => {
    const r = calcularPosCalculo([
      { referencia: 'OP-3', quantidadePrevista: 1000, quantidadeProduzida: 0, valorPrevisto: 5000, semRealizado: true },
    ])
    expect(r[0].semRealizado).toBe(true)
    expect(r[0].valorProporcionalRealizado.isZero()).toBe(true)
    expect(near(r[0].desvioQuantidade, -1000)).toBe(true)
  })
  it('quantidade prevista 0 → desvio% 0 (sem divisão por zero)', () => {
    const r = calcularPosCalculo([
      { referencia: 'OP-4', quantidadePrevista: 0, quantidadeProduzida: 100, valorPrevisto: 0, semRealizado: false },
    ])
    expect(r[0].desvioQuantidadePerc.isZero()).toBe(true)
    expect(r[0].valorProporcionalRealizado.isZero()).toBe(true)
  })
})

describe('confrontarDRE', () => {
  it('com contábil disponível → diferença = gerencial − contábil', () => {
    const c = confrontarDRE(20000, 15000)
    expect(c.contabilDisponivel).toBe(true)
    expect(near(c.resultadoContabil!, 15000)).toBe(true)
    expect(near(c.diferenca!, 5000)).toBe(true)
  })
  it('sem contábil → só gerencial, sem quebrar', () => {
    const c = confrontarDRE(20000, null)
    expect(c.contabilDisponivel).toBe(false)
    expect(c.resultadoContabil).toBeNull()
    expect(c.diferenca).toBeNull()
    expect(near(c.resultadoGerencial, 20000)).toBe(true)
  })
})
