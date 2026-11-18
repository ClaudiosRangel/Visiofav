import { describe, it, expect } from 'vitest'
import { calcularPlano, fechamentoDoResultado, somaPlanos } from '../plano-calculo.service'
import { formarPrecoVenda } from '../orcamento-grafico-calculo.service'
import { TIRAGENS_T5, MARGEM_T5, paramsPlano1, paramsPlano2 } from './t5-entrada'
import {
  CUSTO_BASELINE,
  CUSTO_VALIDADO_LEGADO,
  T5_QUEBRA_POR_TIRAGEM,
  centavos,
} from './custo-baseline.fixture'

// Feature: orcamento-grafico-hierarquia-item-plano, baseline de custo (tarefa 1.1)
describe('custo-baseline.fixture — T1..T5', () => {
  it('T1..T4 batem com os valores já validados no legado (centavos)', () => {
    for (const id of ['T1', 'T2', 'T3', 'T4'] as const) {
      const item = CUSTO_BASELINE.find((i) => i.id === id)!
      expect(centavos(item.resultadoCustoProducao!)).toBe(centavos(CUSTO_VALIDADO_LEGADO[id]))
      expect(centavos(item.tiragens[0].custoProducao)).toBe(centavos(CUSTO_VALIDADO_LEGADO[id]))
    }
  })

  it('T5 multi-plano: o motor atual reproduz o baseline gravado (diferença 0,00)', () => {
    const t5 = CUSTO_BASELINE.find((i) => i.id === 'T5')!
    expect(t5.estrutura).toBe('MULTI_PLANO')
    expect(t5.tiragens.map((t) => t.tiragem)).toEqual([...TIRAGENS_T5])

    for (const t of t5.tiragens) {
      const r1 = calcularPlano(paramsPlano1(t.tiragem))
      const r2 = calcularPlano(paramsPlano2(t.tiragem))
      expect(r1.custoProducao).toBeGreaterThan(0)
      expect(r2.custoProducao).toBeGreaterThan(0)
      const s = somaPlanos([fechamentoDoResultado(1, r1), fechamentoDoResultado(2, r2)])
      const custo = Math.round((s.materialDireto + s.custoTransformacao + s.servicoExterno) * 100) / 100
      const preco = formarPrecoVenda(custo, MARGEM_T5)

      expect(centavos(custo)).toBe(centavos(t.custoProducao))
      expect(centavos(preco)).toBe(centavos(t.precoVenda!))
      expect(centavos(preco)).toBe(centavos(t.valorTotal!))

      const q = T5_QUEBRA_POR_TIRAGEM.find((x) => x.tiragem === t.tiragem)!
      expect(centavos(r1.custoProducao)).toBe(centavos(q.plano1))
      expect(centavos(r2.custoProducao)).toBe(centavos(q.plano2))
      expect(centavos(s.materialDireto)).toBe(centavos(q.md))
      expect(centavos(s.custoTransformacao)).toBe(centavos(q.ct))
    }
    expect(centavos(t5.resultadoCustoProducao!)).toBe(centavos(t5.tiragens[0].custoProducao))
  })

  it('T1..T4 têm tiragem real, valor total medido e nenhum item fica por classificar', () => {
    for (const id of ['T1', 'T2', 'T3', 'T4'] as const) {
      const item = CUSTO_BASELINE.find((i) => i.id === id)!
      expect(item.medido).toBe(true)
      expect(item.estrutura).not.toBe('A_CLASSIFICAR')
      expect(item.produtoCadastro).not.toBeNull()
      for (const t of item.tiragens) {
        expect(t.tiragem).toBeGreaterThan(0)
        expect(t.valorTotal).not.toBeNull()
        expect(t.precoVenda).not.toBeNull()
        // preço > custo: a margem do legado nunca é negativa nestes casos
        expect(centavos(t.valorTotal!)).toBeGreaterThan(centavos(t.custoProducao))
      }
    }
  })

  it('cobre ao menos 1 plano único (T2) e 1 multi-plano (T3, T4, T5)', () => {
    const porId = Object.fromEntries(CUSTO_BASELINE.map((i) => [i.id, i.estrutura]))
    expect(porId.T2).toBe('PLANO_UNICO')
    expect(porId.T3).toBe('MULTI_PLANO')
    expect(porId.T4).toBe('MULTI_PLANO')
    expect(porId.T5).toBe('MULTI_PLANO')
  })
})
