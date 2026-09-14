/**
 * Testes do núcleo puro do Financeiro Operacional F1 (`financeiro-calculo.ts`).
 * Property-based (fast-check) para as Correctness Properties do design +
 * casos-limite unitários.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  calcularSaldoConta,
  projetarFluxoCaixa,
  classificarAging,
  montarDreGerencial,
  validarRateio,
} from './financeiro-calculo'
import type { MovimentoConta, TituloFluxo, TituloAging } from './financeiro.types'

const valorArb = fc.integer({ min: 0, max: 1_000_000 }).map((n) => n / 100) // 2 casas

describe('calcularSaldoConta', () => {
  // Property 1: saldo == inicial + Σ entradas realizadas − Σ saídas realizadas
  it('Property 1: saldo reflete apenas movimentos realizados', () => {
    fc.assert(
      fc.property(
        valorArb,
        fc.array(
          fc.record({
            tipo: fc.constantFrom<'ENTRADA' | 'SAIDA'>('ENTRADA', 'SAIDA'),
            valor: valorArb,
            realizado: fc.boolean(),
          }),
        ),
        (inicial, movs: MovimentoConta[]) => {
          const esperado = movs
            .filter((m) => m.realizado)
            .reduce((acc, m) => acc + (m.tipo === 'ENTRADA' ? m.valor : -m.valor), inicial)
          const saldo = calcularSaldoConta(inicial, movs)
          expect(Math.abs(saldo - esperado)).toBeLessThanOrEqual(0.01)
        },
      ),
    )
  })

  it('movimentos previstos (não realizados) não afetam o saldo', () => {
    const movs: MovimentoConta[] = [
      { tipo: 'ENTRADA', valor: 100, realizado: false },
      { tipo: 'SAIDA', valor: 50, realizado: false },
    ]
    expect(calcularSaldoConta(200, movs)).toBe(200)
  })
})

describe('projetarFluxoCaixa', () => {
  // Property 3: por bucket, saldoFinal == saldoInicial + entradas − saídas
  it('Property 3: cada bucket é balanceado e encadeia o saldo', () => {
    fc.assert(
      fc.property(
        valorArb,
        fc.array(
          fc.record({
            origem: fc.constantFrom<'RECEBER' | 'PAGAR'>('RECEBER', 'PAGAR'),
            valor: valorArb,
            diaOffset: fc.integer({ min: 0, max: 60 }),
            realizado: fc.boolean(),
          }),
          { maxLength: 20 },
        ),
        (saldoInicial, raw) => {
          const base = new Date(Date.UTC(2026, 0, 1))
          const titulos: TituloFluxo[] = raw.map((r) => ({
            origem: r.origem,
            valor: r.valor,
            vencimento: new Date(base.getTime() + r.diaOffset * 86400000),
            realizado: r.realizado,
          }))
          const buckets = projetarFluxoCaixa({
            saldoInicial,
            titulos,
            lancamentos: [],
            de: base,
            ate: new Date(Date.UTC(2026, 2, 1)),
            granularidade: 'MES',
          })
          let anterior = saldoInicial
          for (const b of buckets) {
            expect(Math.abs(b.saldoInicial - anterior)).toBeLessThanOrEqual(0.01)
            const calc = b.saldoInicial + b.entradas - b.saidas
            expect(Math.abs(b.saldoFinal - calc)).toBeLessThanOrEqual(0.01)
            anterior = b.saldoFinal
          }
        },
      ),
    )
  })
})

describe('classificarAging', () => {
  // Property 2: faixas exaustivas e exclusivas (soma das faixas == soma dos títulos)
  it('Property 2: total distribuído == total dos títulos', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ valor: valorArb, diaOffset: fc.integer({ min: -120, max: 120 }) }),
          { maxLength: 30 },
        ),
        (raw) => {
          const agora = new Date(Date.UTC(2026, 5, 15))
          const titulos: TituloAging[] = raw.map((r) => ({
            valor: r.valor,
            vencimento: new Date(agora.getTime() + r.diaOffset * 86400000),
          }))
          const resumo = classificarAging(titulos, agora)
          const somaFaixas = Object.values(resumo).reduce((a, b) => a + b, 0)
          const somaTitulos = titulos.reduce((a, t) => a + t.valor, 0)
          expect(Math.abs(somaFaixas - somaTitulos)).toBeLessThanOrEqual(0.05)
        },
      ),
    )
  })

  it('faixas de fronteira: hoje = A_VENCER, 30 dias = D1_30, 31 = D31_60', () => {
    const agora = new Date(Date.UTC(2026, 5, 15))
    const dia = 86400000
    const r = classificarAging(
      [
        { valor: 10, vencimento: agora }, // 0 dias
        { valor: 20, vencimento: new Date(agora.getTime() - 30 * dia) }, // 30 dias
        { valor: 40, vencimento: new Date(agora.getTime() - 31 * dia) }, // 31 dias
      ],
      agora,
    )
    expect(r.A_VENCER).toBe(10)
    expect(r.D1_30).toBe(20)
    expect(r.D31_60).toBe(40)
  })
})

describe('montarDreGerencial', () => {
  it('soma por categoria dentro do período', () => {
    const jan = new Date(Date.UTC(2026, 0, 10))
    const fev = new Date(Date.UTC(2026, 1, 10))
    const linhas = montarDreGerencial(
      [
        { tipo: 'RECEITA', categoriaId: 'A', valor: 100, competencia: jan },
        { tipo: 'RECEITA', categoriaId: 'A', valor: 50, competencia: jan },
        { tipo: 'DESPESA', categoriaId: 'B', valor: 30, competencia: jan },
        { tipo: 'RECEITA', categoriaId: 'A', valor: 999, competencia: new Date(Date.UTC(2026, 5, 1)) }, // fora
      ],
      jan,
      fev,
    )
    const receitaA = linhas.find((l) => l.categoriaId === 'A' && l.tipo === 'RECEITA')
    const despesaB = linhas.find((l) => l.categoriaId === 'B' && l.tipo === 'DESPESA')
    expect(receitaA?.total).toBe(150)
    expect(despesaB?.total).toBe(30)
    expect(linhas).toHaveLength(2)
  })
})

describe('validarRateio', () => {
  // Property 4: rateio fecha quando Σ partes == total (tol. 0,01)
  it('Property 4: soma exata das partes é válida', () => {
    fc.assert(
      fc.property(fc.array(valorArb, { minLength: 1, maxLength: 8 }), (valores) => {
        const total = valores.reduce((a, b) => a + b, 0)
        const partes = valores.map((v, i) => ({ centroCustoId: `c${i}`, valor: v }))
        expect(validarRateio(total, partes)).toBe(true)
      }),
    )
  })

  it('rateio vazio é inválido; sobra de centavo além da tolerância é inválido', () => {
    expect(validarRateio(100, [])).toBe(false)
    expect(validarRateio(100, [{ centroCustoId: 'c1', valor: 99.5 }])).toBe(false)
    expect(validarRateio(100, [{ centroCustoId: 'c1', valor: 99.99 }])).toBe(true)
  })
})
