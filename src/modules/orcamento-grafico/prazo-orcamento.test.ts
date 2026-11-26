import { describe, expect, it } from 'vitest'
import fc from 'fast-check'

import { aplicarJurosNaMargem, jurosPrazoPerc } from './juros-prazo'
import { custoDaTiragem, margemSobrePreco, situacaoMargem } from './margem-minima'
import {
  agruparHistoricoPrazos,
  aindaPrecisaRecalcular,
  orcamentoTemCalculo,
  validarParcelamento,
  valorTotalDoOrcamento,
} from './prazo-orcamento.service'
import { formarPrecoVenda } from './orcamento-grafico-calculo.service'
import { contextoDePrecoDeParams, formarLinhaTiragem } from './hierarquia/tiragens-item-puro'

describe('juros pelo prazo (igual ao sistema de referência)', () => {
  it('taxa ao mês × dias ÷ 30: 2% e 90 dias = 6%', () => {
    expect(jurosPrazoPerc(90, 2)).toBe(6)
    expect(jurosPrazoPerc(28, 2)).toBeCloseTo(1.8667, 4)
  })

  it('à vista, sem prazo ou taxa zero: sem juros', () => {
    expect(jurosPrazoPerc(0, 2)).toBe(0)
    expect(jurosPrazoPerc(null, 2)).toBe(0)
    expect(jurosPrazoPerc(30, 0)).toBe(0)
  })

  it('entra no CEV: impostos da margem, ou cev.juros quando o CEV vem detalhado', () => {
    const m = { impostos: 15, comissao: 5, despAdm: 5, markup: 30 }
    expect(aplicarJurosNaMargem(m, undefined, 6).margem.impostos).toBe(21)
    const cev = { icms: 3, juros: 0, pisCofins: 9.25, comissoes: 3 }
    const r = aplicarJurosNaMargem(m, cev, 6)
    expect(r.cev?.juros).toBe(6)
    expect(r.margem).toBe(m)
    expect(aplicarJurosNaMargem(m, undefined, 0).margem).toBe(m)
  })

  it('o preço cresce com o prazo e a margem de volta da tiragem continua igual ao markup', () => {
    fc.assert(
      fc.property(fc.integer({ min: 100, max: 100000 }), fc.integer({ min: 0, max: 120 }), (custo, dias) => {
        const base = { impostos: 15, comissao: 5, despAdm: 5, markup: 30 }
        const { margem } = aplicarJurosNaMargem(base, undefined, jurosPrazoPerc(dias, 2))
        const semJuros = formarPrecoVenda(custo, base)
        const comJuros = formarPrecoVenda(custo, margem)
        expect(comJuros).toBeGreaterThanOrEqual(semJuros)
        const ctx = contextoDePrecoDeParams({ margem, cev: undefined })
        const linha = formarLinhaTiragem(1000, { materialDireto: custo, custoTransformacao: 0, servicoExterno: 0 }, ctx)
        expect(linha.margemPerc).toBe(30)
        expect(linha.valorTotal).toBe(comJuros)
      }),
    )
  })
})

describe('parcelamento mínimo (regra b)', () => {
  it('1 parcela ou sem mínimo: sempre vale', () => {
    expect(validarParcelamento(100, 1, 5000)).toBeNull()
    expect(validarParcelamento(100, 3, 0)).toBeNull()
  })

  it('parcelado abaixo do mínimo: recusa com o mínimo e o valor atual', () => {
    const msg = validarParcelamento(1200, 3, 5000)
    expect(msg).toContain('5.000,00')
    expect(msg).toContain('1.200,00')
    expect(validarParcelamento(5000, 3, 5000)).toBeNull()
  })

  it('valor do orçamento: consolidado, senão cabeçalho', () => {
    expect(valorTotalDoOrcamento({ valorTotalConsolidado: 900, precoVenda: 100 })).toBe(900)
    expect(valorTotalDoOrcamento({ valorTotalConsolidado: 0, precoVenda: 100 })).toBe(100)
    expect(valorTotalDoOrcamento({})).toBe(0)
  })
})

describe('orçamento calculado e recálculo pendente', () => {
  it('tem cálculo pelo cabeçalho, consolidado ou algum item', () => {
    expect(orcamentoTemCalculo({}, [])).toBe(false)
    expect(orcamentoTemCalculo({ precoVenda: 10 })).toBe(true)
    expect(orcamentoTemCalculo({ valorTotalConsolidado: '10' })).toBe(true)
    expect(orcamentoTemCalculo({}, [{ valorTotal: null }, { valorTotal: 5 }])).toBe(true)
  })

  it('só deixa de precisar recalcular quando todos os itens foram gravados depois da troca', () => {
    const troca = new Date('2026-11-25T10:00:00Z')
    const antes = new Date('2026-11-25T09:00:00Z')
    const depois = new Date('2026-11-25T11:00:00Z')
    expect(aindaPrecisaRecalcular(troca, [{ atualizadoEm: depois }, { atualizadoEm: antes }])).toBe(true)
    expect(aindaPrecisaRecalcular(troca, [{ atualizadoEm: depois }])).toBe(false)
    expect(aindaPrecisaRecalcular(troca, [])).toBe(false)
    expect(aindaPrecisaRecalcular(null, [{ atualizadoEm: antes }])).toBe(false)
  })
})

describe('histórico de prazos do cliente', () => {
  const d = (s: string) => new Date(s)
  it('mais usado primeiro; empate pelo mais recente; texto sem id agrupa pela descrição', () => {
    const h = agruparHistoricoPrazos([
      { prazoId: 'p30', descricao: '30 dias', data: d('2026-01-01'), origem: 'ORCAMENTO' },
      { prazoId: 'p28', descricao: '28/35/42', data: d('2026-02-01'), origem: 'ORCAMENTO' },
      { prazoId: 'p28', descricao: '28/35/42', data: d('2026-03-01'), origem: 'PEDIDO_PROPOSTA' },
      { prazoId: 'p30', descricao: '30 dias', data: d('2026-04-01'), origem: 'ORCAMENTO' },
      { prazoId: null, descricao: 'À vista', data: d('2026-05-01'), origem: 'PORTAL' },
      { prazoId: null, descricao: 'à vista', data: d('2026-05-02'), origem: 'PORTAL' },
    ])
    expect(h.map((x) => [x.descricao, x.vezes])).toEqual([
      ['à vista', 2],
      ['30 dias', 2],
      ['28/35/42', 2],
    ])
    expect(h[2].origens).toEqual(['ORCAMENTO', 'PEDIDO_PROPOSTA'])
  })

  it('ignora usos vazios', () => {
    expect(agruparHistoricoPrazos([{ prazoId: null, descricao: '  ', data: new Date(), origem: 'PORTAL' }])).toEqual([])
  })
})

describe('margem entre custo e preço', () => {
  it('(preço − custo) ÷ preço e situação frente à mínima', () => {
    expect(margemSobrePreco(1000, 700)).toBe(30)
    expect(situacaoMargem(30, 30)).toBe('DENTRO')
    expect(situacaoMargem(29.99, 30)).toBe('ABAIXO')
    expect(situacaoMargem(margemSobrePreco(0, 10), 30)).toBe('SEM_REFERENCIA')
  })

  it('custo da tiragem tira créditos e soma encargo financeiro', () => {
    expect(custoDaTiragem(1000, { creditosFiscais: 50, encargoFinanceiroPerc: 1 })).toBe(960)
    expect(custoDaTiragem(1000, null)).toBe(1000)
  })
})
