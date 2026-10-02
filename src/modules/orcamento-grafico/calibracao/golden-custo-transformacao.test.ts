import { describe, it, expect } from 'vitest'
import {
  calcularCustoTransformacao,
  tempoAcertoMinutos,
  type AtividadeCT,
} from '../custo-transformacao'
import { GOLDEN_CT } from './golden-custo-transformacao.fixture'

/**
 * CALIBRAÇÃO NÍVEL B — passo 2: CUSTO DE TRANSFORMAÇÃO (máquina) vs Calcgraf.
 *
 * Valida que o modelo decifrado reproduz o CustoFixo/CustoUnitário que o
 * Calcgraf grava em CalculoResAgrupamento (agrupamento 1), a partir dos tempos
 * reais (acerto + produção) e do custo-hora da Tabela de Custos vigente.
 */

describe('Calibração Nível B — Custo de Transformação vs Calcgraf', () => {
  for (const g of GOLDEN_CT) {
    describe(`${g.numero} — ${g.descricao}`, () => {
      const r = calcularCustoTransformacao(g.atividades, g.tiragem)

      it(`CustoFixo R$ ${g.custoFixoReal} (±${g.tolerancia * 100}%)`, () => {
        const desvio = Math.abs(r.custoFixo - g.custoFixoReal) / g.custoFixoReal
        expect(
          desvio,
          `CustoFixo calc ${r.custoFixo} vs real ${g.custoFixoReal}`,
        ).toBeLessThanOrEqual(g.tolerancia)
      })

      it(`CustoUnitário R$ ${g.custoUnitarioReal} (±${g.tolerancia * 100}%)`, () => {
        const desvio =
          Math.abs(r.custoUnitario - g.custoUnitarioReal) / g.custoUnitarioReal
        expect(
          desvio,
          `CustoUnit calc ${r.custoUnitario} vs real ${g.custoUnitarioReal}`,
        ).toBeLessThanOrEqual(g.tolerancia)
      })

      it('CT total = CustoFixo + CustoUnit × tiragem (coerência)', () => {
        const esperado = r.custoFixo + r.custoUnitario * g.tiragem
        expect(Math.abs(r.custoTotal - esperado)).toBeLessThanOrEqual(0.01)
      })
    })
  }
})

describe('tempoAcertoMinutos — regra de setup (impressão vs acabamento)', () => {
  it('impressão: cores × acertoPorCor + 1º acerto', () => {
    const a: AtividadeCT = {
      nome: 'impr',
      impressao: true,
      custoHora: 440,
      producaoHora: 5500,
      unidadesProcessadas: 0,
      cores: 4,
      acertoPorCorMin: 25,
      tempoPrimeiroAcertoMin: 0,
    }
    expect(tempoAcertoMinutos(a)).toBe(100) // 4×25
  })

  it('impressão com 1º acerto: cores × acertoPorCor + t1', () => {
    const a: AtividadeCT = {
      nome: 'impr',
      impressao: true,
      custoHora: 440,
      producaoHora: 5500,
      unidadesProcessadas: 0,
      cores: 5,
      acertoPorCorMin: 10,
      tempoPrimeiroAcertoMin: 35,
    }
    expect(tempoAcertoMinutos(a)).toBe(85) // 5×10 + 35
  })

  it('acabamento: quantAcertos × tempoPorAcerto + 1º acerto', () => {
    const a: AtividadeCT = {
      nome: 'cort',
      impressao: false,
      custoHora: 113.21,
      producaoHora: 3000,
      unidadesProcessadas: 0,
      quantAcertos: 1,
      tempoPorAcertoMin: 0,
      tempoPrimeiroAcertoMin: 15,
    }
    expect(tempoAcertoMinutos(a)).toBe(15)
  })
})
