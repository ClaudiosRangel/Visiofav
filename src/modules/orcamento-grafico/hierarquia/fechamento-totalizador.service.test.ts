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

const tir = (quantidade: number, valorTotal: number, custoProducao: number, margemPerc: number | null, cmValor: number | null) => ({
  quantidade,
  valorTotal,
  custoProducao,
  margemPerc,
  cmValor,
})

describe('agregarFechamento — várias tiragens por item', () => {
  it('item com 3 tiragens gera 3 linhas, uma por tiragem, em ordem crescente', () => {
    const r = agregarFechamento('o1', [
      item({ id: 'a', sequencia: 1, tiragens: [tir(4000, 400, 200, 20, 100), tir(2000, 250, 150, 20, 60), tir(6000, 500, 260, 20, 130)] }),
    ])
    expect(r.linhas.map((l) => l.tiragem)).toEqual([2000, 4000, 6000])
    expect(r.linhas[0]).toMatchObject({ valorTotal: 250, custoProducao: 150, itens: 1, itensSemEstaTiragem: 0, valorUnitario: 0.125 })
  })
  it('a lista de tiragens manda: a quantidade/valor do próprio item não entra como linha extra', () => {
    const r = agregarFechamento('o1', [
      item({ id: 'a', sequencia: 1, quantidade: 9999, valorTotal: 999, tiragens: [tir(1000, 100, 50, 20, 30)] }),
    ])
    expect(r.linhas.map((l) => l.tiragem)).toEqual([1000])
    expect(r.linhas[0].valorTotal).toBe(100)
  })
  it('dois itens com as mesmas tiragens somam por tiragem (o total do orçamento é a soma dos itens)', () => {
    const r = agregarFechamento('o1', [
      item({ id: 'a', sequencia: 1, tiragens: [tir(1000, 100, 60, 20, 10), tir(2000, 180, 100, 20, 20)] }),
      item({ id: 'b', sequencia: 2, tiragens: [tir(1000, 300, 150, 40, 90), tir(2000, 500, 260, 40, 150)] }),
    ])
    expect(r.linhas).toHaveLength(2)
    expect(r.linhas[0]).toMatchObject({ tiragem: 1000, valorTotal: 400, custoProducao: 210, itens: 2, margemPerc: 35 })
    expect(r.linhas[1]).toMatchObject({ tiragem: 2000, valorTotal: 680, custoProducao: 360, itens: 2 })
  })
  it('item com uma tiragem só e item com várias coexistem; a linha avisa quantos itens ficaram de fora', () => {
    const r = agregarFechamento('o1', [
      item({ id: 'a', sequencia: 1, quantidade: 1000 }),
      item({ id: 'b', sequencia: 2, tiragens: [tir(1000, 300, 150, 40, 90), tir(2000, 500, 260, 40, 150)] }),
    ])
    const l1000 = r.linhas.find((l) => l.tiragem === 1000)!
    const l2000 = r.linhas.find((l) => l.tiragem === 2000)!
    expect(l1000).toMatchObject({ itens: 2, itensSemEstaTiragem: 0, valorTotal: 500 })
    expect(l2000).toMatchObject({ itens: 1, itensSemEstaTiragem: 1, valorTotal: 500 })
  })
  it('item cujas linhas todas estão sem custo ou valor vai para "sem cálculo"', () => {
    const r = agregarFechamento('o1', [
      item({ id: 'a', sequencia: 1, tiragens: [{ quantidade: 1000, valorTotal: null, custoProducao: null, margemPerc: null, cmValor: null }] }),
    ])
    expect(r.linhas).toEqual([])
    expect(r.quantidadeSemCalculo).toBe(1)
  })
  it('margem ausente em uma linha da tiragem deixa margemPerc nulo só nessa tiragem', () => {
    const r = agregarFechamento('o1', [
      item({ id: 'a', sequencia: 1, tiragens: [tir(1000, 100, 50, null, 10), tir(2000, 200, 90, 25, 30)] }),
    ])
    expect(r.linhas.find((l) => l.tiragem === 1000)!.margemPerc).toBeNull()
    expect(r.linhas.find((l) => l.tiragem === 2000)!.margemPerc).toBe(25)
  })
  it('lista vazia de tiragens equivale a item de uma tiragem só', () => {
    const a = agregarFechamento('o1', [item({ id: 'a', sequencia: 1, tiragens: [] })])
    const b = agregarFechamento('o1', [item({ id: 'a', sequencia: 1 })])
    expect(a.linhas).toEqual(b.linhas)
  })
})

describe('agregarFechamento', () => {
  it('1 item → 1 linha', () => {
    const r = agregarFechamento('o1', [item({ id: 'a', sequencia: 1 })])
    expect(r.linhas).toEqual([
      { tiragem: 1000, margemPerc: 30, contribuicaoMarginalPerc: 25, valorUnitario: 0.2, valorTotal: 200, custoProducao: 100, itens: 1, itensSemEstaTiragem: 0 },
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
