/**
 * Testes do núcleo puro do Financeiro Vizor (`financeiro-calculo.ts`).
 *
 * Combina:
 * - Property-based tests (fast-check) para as 11 propriedades universais do
 *   núcleo puro definidas na seção "Correctness Properties" do design
 *   (Properties 1..11 — as 12 e 13 são de I/O e ficam nos services).
 * - Testes unitários de exemplos e casos-limite (Tarefa 2.7).
 */

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  calcularTotalMensal,
  calcularDiasEmAtraso,
  calcularTotalVencidoEmAberto,
  determinarEstagio,
  calcularDatasVencimento,
  competenciaMesSeguinte,
  decidirBloqueio,
} from './financeiro-calculo'
import { DIAS_BLOQUEIO, MODULOS, type Modulo, type StatusFatura } from './financeiro.types'

// ===========================================================================
// Geradores (fast-check) — restringem ao espaço de entrada de forma inteligente
// ===========================================================================

/** Um preço monetário plausível (0..999.999.999,99, 2 casas). */
const arbPreco = fc
  .double({ min: 0, max: 999_999_999.99, noNaN: true, noDefaultInfinity: true })
  .map((v) => Math.round(v * 100) / 100)

/** Um item { modulo, preco } com módulo dentro do conjunto canônico. */
const arbPrecoModulo = fc.record({
  modulo: fc.constantFrom(...MODULOS) as fc.Arbitrary<Modulo>,
  preco: arbPreco,
})

/** Lista de preços por módulo (0..6 itens, sem exigir módulos distintos). */
const arbPrecos = fc.array(arbPrecoModulo, { maxLength: 6 })

/** Timestamps num intervalo razoável (2000-01-01 .. 2100-01-01) para datas. */
const MIN_TS = Date.UTC(2000, 0, 1)
const MAX_TS = Date.UTC(2100, 0, 1)
const arbData = fc.integer({ min: MIN_TS, max: MAX_TS }).map((ts) => new Date(ts))

const STATUS_FATURA: StatusFatura[] = ['PENDENTE', 'PAGA', 'VENCIDA', 'CANCELADA']

/** Uma fatura com status, vencimento e valor. */
const arbFatura = fc.record({
  status: fc.constantFrom(...STATUS_FATURA),
  dataVencimento: arbData,
  valor: arbPreco,
})

const arbFaturas = fc.array(arbFatura, { maxLength: 20 })

const arbMetodoHttp = fc.constantFrom(
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'get',
  'post',
  'options',
  'HEAD',
)

// ===========================================================================
// Property 1: Total mensal ≥ 0 e ignora zeros
// Validates: Requirements 3.3
// ===========================================================================
describe('calcularTotalMensal — Property 1: >= 0 e ignora zeros', () => {
  it('é igual à soma dos preços > 0 e resultado >= 0', () => {
    fc.assert(
      fc.property(arbPrecos, (precos) => {
        const total = calcularTotalMensal(precos)
        const somaPositivos = precos
          .filter((p) => p.preco > 0)
          .reduce((acc, p) => acc + p.preco, 0)
        expect(total).toBeGreaterThanOrEqual(0)
        expect(total).toBeCloseTo(somaPositivos, 6)
      }),
    )
  })

  it('remover módulos com preço 0 não altera o total', () => {
    fc.assert(
      fc.property(arbPrecos, (precos) => {
        const semZeros = precos.filter((p) => p.preco !== 0)
        expect(calcularTotalMensal(semZeros)).toBeCloseTo(calcularTotalMensal(precos), 6)
      }),
    )
  })
})

// ===========================================================================
// Property 2: Total mensal monotônico
// Validates: Requirements 3.3
// ===========================================================================
describe('calcularTotalMensal — Property 2: monotônico', () => {
  it('aumentar o preço de um módulo nunca diminui o total', () => {
    fc.assert(
      fc.property(
        fc.array(arbPrecoModulo, { minLength: 1, maxLength: 6 }),
        fc.nat({ max: 5 }),
        fc.double({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
        (precos, idxRaw, incremento) => {
          const idx = idxRaw % precos.length
          const antes = calcularTotalMensal(precos)
          const depois = precos.map((p, i) =>
            i === idx ? { ...p, preco: p.preco + incremento } : p,
          )
          expect(calcularTotalMensal(depois)).toBeGreaterThanOrEqual(antes - 1e-6)
        },
      ),
    )
  })
})

// ===========================================================================
// Property 3: Dias em atraso ≥ 0 e usa a fatura mais antiga
// Validates: Requirements 6.3, 4.4, 2.5
// ===========================================================================
describe('calcularDiasEmAtraso — Property 3: >= 0 e fatura mais antiga', () => {
  it('sempre >= 0; corresponde ao vencimento mais antigo em aberto, senão 0', () => {
    fc.assert(
      fc.property(arbFaturas, arbData, (faturas, agora) => {
        const dias = calcularDiasEmAtraso(faturas, agora)
        expect(dias).toBeGreaterThanOrEqual(0)
        expect(Number.isInteger(dias)).toBe(true)

        const vencidasEmAberto = faturas.filter(
          (f) =>
            (f.status === 'PENDENTE' || f.status === 'VENCIDA') &&
            f.dataVencimento.getTime() < agora.getTime(),
        )
        if (vencidasEmAberto.length === 0) {
          expect(dias).toBe(0)
        } else {
          const maisAntiga = Math.min(...vencidasEmAberto.map((f) => f.dataVencimento.getTime()))
          const esperado = Math.floor((agora.getTime() - maisAntiga) / (24 * 60 * 60 * 1000))
          expect(dias).toBe(Math.max(0, esperado))
        }
      }),
    )
  })
})

// ===========================================================================
// Property 4: Total vencido não negativo e só conta vencidas em aberto
// Validates: Requirements 2.5, 4.4
// ===========================================================================
describe('calcularTotalVencidoEmAberto — Property 4: >= 0 e só vencidas em aberto', () => {
  it('soma apenas PENDENTE/VENCIDA com vencimento < agora; ignora PAGA/CANCELADA/futuras', () => {
    fc.assert(
      fc.property(arbFaturas, arbData, (faturas, agora) => {
        const total = calcularTotalVencidoEmAberto(faturas, agora)
        expect(total).toBeGreaterThanOrEqual(0)

        const esperado = faturas
          .filter(
            (f) =>
              (f.status === 'PENDENTE' || f.status === 'VENCIDA') &&
              f.dataVencimento.getTime() < agora.getTime(),
          )
          .reduce((acc, f) => acc + f.valor, 0)
        expect(total).toBeCloseTo(esperado, 4)
      }),
    )
  })

  it('faturas PAGA/CANCELADA ou futuras nunca entram no total', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            status: fc.constantFrom<StatusFatura>('PAGA', 'CANCELADA'),
            dataVencimento: arbData,
            valor: arbPreco,
          }),
          { maxLength: 10 },
        ),
        arbData,
        (faturasFechadas, agora) => {
          expect(calcularTotalVencidoEmAberto(faturasFechadas, agora)).toBe(0)
        },
      ),
    )
  })
})

// ===========================================================================
// Property 5: Estágio — INATIVADO é absorvente sob o job
// Validates: Requirements 6.12
// ===========================================================================
describe('determinarEstagio — Property 5: INATIVADO absorvente', () => {
  it('INATIVADO permanece INATIVADO para qualquer dias', () => {
    fc.assert(
      fc.property(fc.integer({ min: -5, max: 5000 }), (dias) => {
        expect(determinarEstagio('INATIVADO', dias)).toBe('INATIVADO')
      }),
    )
  })
})

// ===========================================================================
// Property 6: Estágio — job nunca reativa
// Validates: Requirements 8.6
// ===========================================================================
describe('determinarEstagio — Property 6: job nunca reativa', () => {
  it('SOMENTE_LEITURA permanece SOMENTE_LEITURA para qualquer dias', () => {
    fc.assert(
      fc.property(fc.integer({ min: -5, max: 5000 }), (dias) => {
        expect(determinarEstagio('SOMENTE_LEITURA', dias)).toBe('SOMENTE_LEITURA')
      }),
    )
  })
})

// ===========================================================================
// Property 7: Estágio — limiar de bloqueio (dias >= 30 sse SOMENTE_LEITURA)
// Validates: Requirements 6.5, 6.7, 6.11
// ===========================================================================
describe('determinarEstagio — Property 7: limiar de bloqueio a partir de ATIVO', () => {
  it('ATIVO -> SOMENTE_LEITURA se e somente se dias >= 30', () => {
    fc.assert(
      fc.property(fc.integer({ min: -5, max: 5000 }), (dias) => {
        const resultado = determinarEstagio('ATIVO', dias)
        if (dias >= DIAS_BLOQUEIO) {
          expect(resultado).toBe('SOMENTE_LEITURA')
        } else {
          expect(resultado).toBe('ATIVO')
        }
      }),
    )
  })
})

// ===========================================================================
// Property 8: Guard — INATIVADO bloqueia todo método
// Validates: Requirements 9.2
// ===========================================================================
describe('decidirBloqueio — Property 8: INATIVADO bloqueia tudo', () => {
  it('qualquer método => BLOQUEAR_INATIVADO', () => {
    fc.assert(
      fc.property(arbMetodoHttp, (metodo) => {
        expect(decidirBloqueio('INATIVADO', metodo)).toBe('BLOQUEAR_INATIVADO')
      }),
    )
  })
})

// ===========================================================================
// Property 9: Guard — SOMENTE_LEITURA libera exatamente os GET
// Validates: Requirements 7.1, 7.2
// ===========================================================================
describe('decidirBloqueio — Property 9: SOMENTE_LEITURA libera só GET', () => {
  it('PERMITIR se e somente se método é GET (case-insensitive)', () => {
    fc.assert(
      fc.property(arbMetodoHttp, (metodo) => {
        const resultado = decidirBloqueio('SOMENTE_LEITURA', metodo)
        const ehEscrita = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(metodo.toUpperCase())
        if (ehEscrita) {
          expect(resultado).toBe('BLOQUEAR_SOMENTE_LEITURA')
        } else {
          expect(resultado).toBe('PERMITIR')
        }
      }),
    )
  })
})

// ===========================================================================
// Property 10: Guard — ATIVO nunca bloqueia
// Validates: Requirements 7.4
// ===========================================================================
describe('decidirBloqueio — Property 10: ATIVO nunca bloqueia', () => {
  it('qualquer método => PERMITIR', () => {
    fc.assert(
      fc.property(arbMetodoHttp, (metodo) => {
        expect(decidirBloqueio('ATIVO', metodo)).toBe('PERMITIR')
      }),
    )
  })
})

// ===========================================================================
// Property 11: Vencimentos — quantidade e dia corretos
// Validates: Requirements 5.1, 5.2, 5.3
// ===========================================================================
describe('calcularDatasVencimento — Property 11: quantidade e dia corretos', () => {
  const arbCompetencia = fc
    .record({
      ano: fc.integer({ min: 2000, max: 2099 }),
      mes: fc.integer({ min: 1, max: 12 }),
    })
    .map(({ ano, mes }) => `${ano}-${mes.toString().padStart(2, '0')}`)

  it('retorna exatamente `meses` competências consecutivas com dia = min(dia, últimoDiaDoMês)', () => {
    fc.assert(
      fc.property(
        arbCompetencia,
        fc.integer({ min: 1, max: 60 }),
        fc.integer({ min: 1, max: 31 }),
        (competenciaInicial, meses, diaVencimento) => {
          const datas = calcularDatasVencimento(competenciaInicial, meses, diaVencimento)
          expect(datas).toHaveLength(meses)

          const [anoIni, mesIni] = competenciaInicial.split('-').map(Number)
          for (let i = 0; i < datas.length; i++) {
            const totalMeses = mesIni - 1 + i
            const anoEsp = anoIni + Math.floor(totalMeses / 12)
            const mesEsp = (totalMeses % 12) + 1
            const compEsp = `${anoEsp}-${mesEsp.toString().padStart(2, '0')}`
            expect(datas[i].competencia).toBe(compEsp)

            const ultimoDia = new Date(anoEsp, mesEsp, 0).getDate()
            const diaEsp = Math.min(diaVencimento, ultimoDia)
            expect(datas[i].dataVencimento.getFullYear()).toBe(anoEsp)
            expect(datas[i].dataVencimento.getMonth()).toBe(mesEsp - 1)
            expect(datas[i].dataVencimento.getDate()).toBe(diaEsp)
          }
        },
      ),
    )
  })

  it('as competências são estritamente crescentes e sem lacunas', () => {
    fc.assert(
      fc.property(arbCompetencia, fc.integer({ min: 2, max: 24 }), (comp, meses) => {
        const datas = calcularDatasVencimento(comp, meses, 15)
        for (let i = 1; i < datas.length; i++) {
          expect(datas[i].dataVencimento.getTime()).toBeGreaterThan(
            datas[i - 1].dataVencimento.getTime(),
          )
        }
      }),
    )
  })
})

// ===========================================================================
// Tarefa 2.7 — Testes unitários de casos-limite do núcleo puro
// ===========================================================================
describe('Casos-limite (unitários)', () => {
  // ---- calcularDatasVencimento: dia 31 em fevereiro ----
  it('dia 31 em fevereiro de ano NÃO bissexto usa 28', () => {
    const [d] = calcularDatasVencimento('2026-02', 1, 31)
    expect(d.competencia).toBe('2026-02')
    expect(d.dataVencimento.getDate()).toBe(28)
  })

  it('dia 31 em fevereiro de ano bissexto usa 29', () => {
    const [d] = calcularDatasVencimento('2024-02', 1, 31)
    expect(d.competencia).toBe('2024-02')
    expect(d.dataVencimento.getDate()).toBe(29)
  })

  it('dia 31 em abril (30 dias) usa 30', () => {
    const [d] = calcularDatasVencimento('2026-04', 1, 31)
    expect(d.dataVencimento.getDate()).toBe(30)
  })

  it('dia 15 em mês com 31 dias mantém 15', () => {
    const [d] = calcularDatasVencimento('2026-01', 1, 15)
    expect(d.dataVencimento.getDate()).toBe(15)
  })

  // ---- calcularDatasVencimento: virada de ano dezembro -> janeiro ----
  it('gera dezembro -> janeiro do ano seguinte corretamente', () => {
    const datas = calcularDatasVencimento('2026-12', 3, 10)
    expect(datas.map((x) => x.competencia)).toEqual(['2026-12', '2027-01', '2027-02'])
    // fevereiro/2027 (não bissexto) com dia 10 permanece 10
    expect(datas[2].dataVencimento.getDate()).toBe(10)
  })

  // ---- competenciaMesSeguinte ----
  it('competenciaMesSeguinte de um mês comum retorna o mês seguinte', () => {
    expect(competenciaMesSeguinte(new Date(2026, 2, 15))).toBe('2026-04') // março -> abril
  })

  it('competenciaMesSeguinte em dezembro vira o ano', () => {
    expect(competenciaMesSeguinte(new Date(2026, 11, 31))).toBe('2027-01') // dez -> jan
  })

  // ---- calcularDiasEmAtraso: limiares 9/10/29/30 ----
  const diaMs = 24 * 60 * 60 * 1000
  function faturaVencidaHa(dias: number, agora: Date): { status: StatusFatura; dataVencimento: Date } {
    return { status: 'VENCIDA', dataVencimento: new Date(agora.getTime() - dias * diaMs) }
  }

  it('diasEmAtraso exatos: 9, 10, 29 e 30 dias', () => {
    const agora = new Date(2026, 5, 15, 12, 0, 0)
    expect(calcularDiasEmAtraso([faturaVencidaHa(9, agora)], agora)).toBe(9)
    expect(calcularDiasEmAtraso([faturaVencidaHa(10, agora)], agora)).toBe(10)
    expect(calcularDiasEmAtraso([faturaVencidaHa(29, agora)], agora)).toBe(29)
    expect(calcularDiasEmAtraso([faturaVencidaHa(30, agora)], agora)).toBe(30)
  })

  it('usa a fatura vencida mais antiga (maior atraso) entre várias', () => {
    const agora = new Date(2026, 5, 15, 12, 0, 0)
    const faturas = [faturaVencidaHa(5, agora), faturaVencidaHa(42, agora), faturaVencidaHa(20, agora)]
    expect(calcularDiasEmAtraso(faturas, agora)).toBe(42)
  })

  it('ignora PAGA/CANCELADA e futuras ao calcular o atraso', () => {
    const agora = new Date(2026, 5, 15, 12, 0, 0)
    const faturas = [
      { status: 'PAGA' as StatusFatura, dataVencimento: new Date(agora.getTime() - 100 * diaMs) },
      { status: 'CANCELADA' as StatusFatura, dataVencimento: new Date(agora.getTime() - 80 * diaMs) },
      { status: 'PENDENTE' as StatusFatura, dataVencimento: new Date(agora.getTime() + 5 * diaMs) },
    ]
    expect(calcularDiasEmAtraso(faturas, agora)).toBe(0)
  })

  // ---- faturas vazias ----
  it('lista de faturas vazia => diasEmAtraso 0 e totalVencido 0', () => {
    const agora = new Date(2026, 5, 15)
    expect(calcularDiasEmAtraso([], agora)).toBe(0)
    expect(calcularTotalVencidoEmAberto([], agora)).toBe(0)
  })

  // ---- todos os módulos com preço 0 ----
  it('todos os módulos com preço 0 => total mensal 0', () => {
    const precos = MODULOS.map((modulo) => ({ modulo, preco: 0 }))
    expect(calcularTotalMensal(precos)).toBe(0)
  })

  it('lista de preços vazia => total mensal 0', () => {
    expect(calcularTotalMensal([])).toBe(0)
  })

  it('soma apenas os módulos com preço > 0', () => {
    const precos = [
      { modulo: 'COMPRAS' as Modulo, preco: 100 },
      { modulo: 'VENDAS' as Modulo, preco: 0 },
      { modulo: 'WMS' as Modulo, preco: 250.5 },
    ]
    expect(calcularTotalMensal(precos)).toBeCloseTo(350.5, 4)
  })
})
