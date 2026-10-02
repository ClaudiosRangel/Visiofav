import { describe, it, expect } from 'vitest'
import { formarPrecoVenda } from '../orcamento-grafico-calculo.service'
import { GOLDEN_PRECOS } from './golden-precos.fixture'

/**
 * CALIBRAÇÃO NÍVEL A — valida que a FÓRMULA DE PREÇO do Vizor
 * (`formarPrecoVenda`, gross-up por divisor único) reproduz o preço REAL do
 * Calcgraf (ValorTotalVenda), dado o custo-base real + margem + CEV.
 *
 * custoBase(tiragem) = somaCustoFixo + somaCustoUnitario × tiragem
 * preço = custoBase / (1 − margem%/100 − cev%/100)
 *
 * Tolerância: ≤ 0,5% no valor total (meta do Bloco 2). Fonte dos números:
 * docs/calcgraf-calibracao-harness.md + golden-precos.fixture.ts (dados reais).
 */

const TOL = 0.005 // 0,5%

describe('Calibração Nível A — fórmula de preço vs Calcgraf (dados reais)', () => {
  for (const caso of GOLDEN_PRECOS) {
    describe(`Cálculo ${caso.num} — ${caso.descricao}`, () => {
      for (const t of caso.tiragens) {
        it(`tiragem ${t.tiragem.toLocaleString('pt-BR')} → VT ${t.valorTotalVenda.toLocaleString('pt-BR')} (±0,5%)`, () => {
          const custoBase = caso.somaCustoFixo + caso.somaCustoUnitario * t.tiragem
          // formarPrecoVenda(custo, {impostos, comissao, despAdm, markup}) usa
          // divisor (1 − (impostos+comissao+despAdm+markup)/100). Mapeamos o CEV
          // efetivo em `impostos` e a margem em `markup`.
          const preco = formarPrecoVenda(custoBase, {
            impostos: caso.cevPerc,
            comissao: 0,
            despAdm: 0,
            markup: t.margemPerc,
          })
          const desvio = Math.abs(preco - t.valorTotalVenda) / t.valorTotalVenda
          expect(desvio, `preço calc ${preco.toFixed(2)} vs real ${t.valorTotalVenda} (desvio ${(desvio * 100).toFixed(3)}%)`).toBeLessThanOrEqual(TOL)
        })
      }

      it('CEV é constante entre as tiragens (sanidade da fórmula)', () => {
        // Resolve o CEV implícito de cada tiragem; devem ser quase iguais.
        const cevs = caso.tiragens.map((t) => {
          const base = caso.somaCustoFixo + caso.somaCustoUnitario * t.tiragem
          return (1 - t.margemPerc / 100) - base / t.valorTotalVenda
        })
        const min = Math.min(...cevs)
        const max = Math.max(...cevs)
        expect(max - min).toBeLessThanOrEqual(0.01) // ≤ 1 ponto percentual de variação
      })

      // Nível B — a decomposição (CT + MD + SE) deve reconstituir o custo-base.
      if (caso.componentes) {
        const c = caso.componentes
        it('decomposição CT+MD+SE = custo-base agregado', () => {
          const fixo = c.custoTransformacao.fixo + c.materiaisDiretos.fixo + c.servicosExternos.fixo
          const unit = c.custoTransformacao.unitario + c.materiaisDiretos.unitario + c.servicosExternos.unitario
          expect(Math.abs(fixo - caso.somaCustoFixo)).toBeLessThanOrEqual(0.5)
          expect(Math.abs(unit - caso.somaCustoUnitario)).toBeLessThanOrEqual(0.0001)
        })
      }
    })
  }
})
