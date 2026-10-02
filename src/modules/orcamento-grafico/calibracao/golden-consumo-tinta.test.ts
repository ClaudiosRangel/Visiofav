import { describe, it, expect } from 'vitest'
import {
  calcularConsumoTinta,
  consumoFixoTinta,
  CONST_SPANKS,
  PARTIDA_CONSUMO_KG_PADRAO,
} from '../consumo-tinta'
import { GOLDEN_TINTA } from './golden-consumo-tinta.fixture'

/**
 * CALIBRAÇÃO NÍVEL B — passo 1 (TINTA) vs Calcgraf.
 *
 * Valida o modelo decifrado (SPANKS para o variável + partida×cores×partes para
 * o fixo) contra o consumo/custo real da memória de cálculo.
 */

describe('Calibração — Consumo de tinta (SPANKS) vs Calcgraf', () => {
  for (const g of GOLDEN_TINTA) {
    describe(`${g.numero} — ${g.descricao}`, () => {
      const r = calcularConsumoTinta(g.params)

      it(`consumo FIXO ${g.consumoFixoReal} kg (exato)`, () => {
        // Fixo = partida × cores × ocorrências → 0,2 × 4 × 2 = 1,6 (exato)
        expect(r.consumoFixoKg).toBeCloseTo(g.consumoFixoReal, 2)
      })

      it(`consumo VARIÁVEL ${g.consumoVarReal} kg (±${g.tolerancia * 100}%)`, () => {
        const desvio = Math.abs(r.consumoVarKg - g.consumoVarReal) / g.consumoVarReal
        expect(
          desvio,
          `var calc ${r.consumoVarKg} vs real ${g.consumoVarReal}`,
        ).toBeLessThanOrEqual(g.tolerancia)
      })

      it(`custo R$ ${g.custoReal} (±${g.tolerancia * 100}%)`, () => {
        const desvio = Math.abs(r.custo - g.custoReal) / g.custoReal
        expect(r.custo, `custo calc ${r.custo} vs real ${g.custoReal}`)
        expect(desvio).toBeLessThanOrEqual(g.tolerancia)
      })
    })
  }
})

describe('consumo fixo de tinta — partida × cores × ocorrências', () => {
  it('usa a partida padrão de 0,2 kg (200 g)', () => {
    expect(PARTIDA_CONSUMO_KG_PADRAO).toBe(0.2)
  })
  it('0,2 × 4 cores × 2 partes = 1,6 kg', () => {
    const kg = consumoFixoTinta({
      coefSuporte: 1.5,
      areaM2: 0,
      lados: 1,
      cobertura: 0,
      cores: 4,
      ocorrencias: 2,
      precoKg: 44,
    })
    expect(kg).toBeCloseTo(1.6, 5)
  })
})

describe('constante SPANKS', () => {
  it('é 353 (constante clássica da indústria)', () => {
    expect(CONST_SPANKS).toBe(353)
  })
})
