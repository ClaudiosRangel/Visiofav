import { describe, expect, it } from 'vitest'
import { agregarFechamento, type ItemParaFechamento } from './fechamento-totalizador.service'

const item = (p: Partial<ItemParaFechamento> & { id: string; sequencia: number }): ItemParaFechamento => ({
  descricao: null,
  quantidade: 1000,
  custoProducao: 100,
  valorTotal: 200,
  margemSelecionada: 30,
  cmValor: 50,
  ...p,
})

describe('agregarFechamento', () => {
  it('1 item → 1 linha', () => {
    const r = agregarFechamento('o1', [item({ id: 'a', sequencia: 1 })])
    expect(r.linhas).toEqual([
      { tiragem: 1000, margemPerc: 30, contribuicaoMarginalPerc: 25, valorUnitario: 0.2, valorTotal: 200, custoProducao: 100, itens: 1 },
    ])
    expect(r.itensSemCalculo).toEqual([])
    expect(r.quantidadeSemCalculo).toBe(0)
  })

  it('2 itens com a mesma tiragem somam na mesma linha; margem ponderada pelo preço', () => {
    const r = agregarFechamento('o1', [
      item({ id: 'a', sequencia: 1, valorTotal: 100, custoProducao: 60, margemSelecionada: 20, cmValor: 10 }),
      item({ id: 'b', sequencia: 2, valorTotal: 300, custoProducao: 150, margemSelecionada: 40, cmValor: 90 }),
    ])
    expect(r.linhas).toHaveLength(1)
    const l = r.linhas[0]
    expect(l.valorTotal).toBe(400)
    expect(l.custoProducao).toBe(210)
    expect(l.itens).toBe(2)
    expect(l.margemPerc).toBe(35) // (100·20 + 300·40) / 400
    expect(l.contribuicaoMarginalPerc).toBe(25) // 100 / 400
    expect(l.valorUnitario).toBe(0.4)
  })

  it('tiragens diferentes → uma linha por tiragem, em ordem crescente', () => {
    const r = agregarFechamento('o1', [
      item({ id: 'a', sequencia: 1, quantidade: 5000 }),
      item({ id: 'b', sequencia: 2, quantidade: 1000 }),
      item({ id: 'c', sequencia: 3, quantidade: 3000 }),
    ])
    expect(r.linhas.map((l) => l.tiragem)).toEqual([1000, 3000, 5000])
  })

  it('item sem cálculo (custo ou valor nulo) fica fora de todas as linhas e é listado', () => {
    const r = agregarFechamento('o1', [
      item({ id: 'a', sequencia: 2, custoProducao: null }),
      item({ id: 'b', sequencia: 1, valorTotal: null, descricao: 'sem valor' }),
      item({ id: 'c', sequencia: 3 }),
    ])
    expect(r.linhas).toHaveLength(1)
    expect(r.linhas[0].itens).toBe(1)
    expect(r.linhas[0].valorTotal).toBe(200)
    expect(r.itensSemCalculo).toEqual([
      { id: 'b', sequencia: 1, descricao: 'sem valor' },
      { id: 'a', sequencia: 2, descricao: null },
    ])
    expect(r.quantidadeSemCalculo).toBe(2)
  })

  it('nenhum item com cálculo → sem linhas', () => {
    const r = agregarFechamento('o1', [item({ id: 'a', sequencia: 1, valorTotal: null, custoProducao: null })])
    expect(r.linhas).toEqual([])
    expect(r.quantidadeSemCalculo).toBe(1)
  })

  it('orçamento sem itens → vazio', () => {
    const r = agregarFechamento('o1', [])
    expect(r).toEqual({ orcamentoId: 'o1', linhas: [], itensSemCalculo: [], quantidadeSemCalculo: 0 })
  })

  it('CM ausente em algum item da linha → contribuicaoMarginalPerc null', () => {
    const r = agregarFechamento('o1', [
      item({ id: 'a', sequencia: 1, cmValor: 10 }),
      item({ id: 'b', sequencia: 2, cmValor: null }),
    ])
    expect(r.linhas[0].contribuicaoMarginalPerc).toBeNull()
  })

  it('margem ausente em algum item → margemPerc null', () => {
    const r = agregarFechamento('o1', [
      item({ id: 'a', sequencia: 1 }),
      item({ id: 'b', sequencia: 2, margemSelecionada: null }),
    ])
    expect(r.linhas[0].margemPerc).toBeNull()
  })

  it('valor zero com custo presente conta como calculado (null é que não conta)', () => {
    const r = agregarFechamento('o1', [item({ id: 'a', sequencia: 1, valorTotal: 0, custoProducao: 0 })])
    expect(r.linhas).toHaveLength(1)
    expect(r.linhas[0].margemPerc).toBeNull() // soma de valor 0 → sem ponderação
  })
})
