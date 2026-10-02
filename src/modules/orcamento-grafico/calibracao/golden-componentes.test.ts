import { describe, it, expect } from 'vitest'
import { calcularPapel } from '../orcamento-grafico-calculo.service'
import { GOLDEN_PAPEL } from './golden-componentes.fixture'

/**
 * CALIBRAÇÃO NÍVEL B — valida que o motor do Vizor reproduz o CUSTO por
 * COMPONENTE do Calcgraf. Começa pelo PAPEL (≈70% do Material Direto).
 *
 * `calcularPapel` do Vizor: peso = folhas × larg_m × alt_m × gramatura / 1000;
 * custo = peso × precoKg. Comparado com peso/subtotal REAIS do pré-cálculo.
 * Tolerância ≤ 0,5% (meta do Bloco 2); na prática bate exato.
 */

const TOL = 0.005

describe('Calibração Nível B — PAPEL (Material Direto) vs Calcgraf', () => {
  for (const p of GOLDEN_PAPEL) {
    describe(p.descricao, () => {
      // Reproduz exatamente o insumo do Calcgraf: nº de folhas já dado,
      // sem perda adicional (a perda/aparas já está embutida nas folhas reais).
      const r = calcularPapel({
        folhasNecessarias: p.folhas,
        larguraMm: p.formatoLarguraMm,
        alturaMm: p.formatoAlturaMm,
        gramaturaGm2: p.gramatura,
        precoKg: p.precoKg,
        perdaPercent: 0,
        perdaFixaFolhas: 0,
      })

      it(`peso ${p.pesoKgReal} kg (±0,5%)`, () => {
        const desvio = Math.abs(r.pesoKg - p.pesoKgReal) / p.pesoKgReal
        expect(desvio, `peso calc ${r.pesoKg} vs real ${p.pesoKgReal}`).toBeLessThanOrEqual(TOL)
      })

      it(`subtotal R$ ${p.subtotalReal} (±0,5%)`, () => {
        const desvio = Math.abs(r.custo - p.subtotalReal) / p.subtotalReal
        expect(desvio, `custo calc ${r.custo} vs real ${p.subtotalReal}`).toBeLessThanOrEqual(TOL)
      })
    })
  }
})
