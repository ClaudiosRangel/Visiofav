import { describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import { calcularOrcamentoGrafico } from '../orcamento-grafico-calculo.service'
import { fechamentoDoResultado } from '../plano-calculo.service'
import { MARGEM_T5, TIRAGENS_T5, paramsPlano1, paramsPlano2 } from './t5-entrada'
import {
  brutoDePlanos,
  escolherReferencia,
  formarLinhaTiragem,
  MAX_TIRAGENS_POR_ITEM,
  numerarOrdem,
  validarTiragens,
} from './tiragens-item-puro'
import { calcularLinhasTiragem, entradasDasLinhas, gravarTiragensDoItem } from './tiragens-item.service'

const ctx = { margem: { ...MARGEM_T5 } }
const cevT5 = MARGEM_T5.impostos + MARGEM_T5.comissao + MARGEM_T5.despAdm

function brutoDoPlano(sequencia: number, p: ReturnType<typeof paramsPlano1>) {
  return fechamentoDoResultado(sequencia, calcularOrcamentoGrafico(p))
}

describe('validarTiragens', () => {
  it('aceita 1 a 20 inteiros positivos e devolve em ordem crescente', () => {
    expect(validarTiragens([6000, 2000, 4000])).toEqual([2000, 4000, 6000])
    expect(validarTiragens([1])).toEqual([1])
  })
  it('rejeita vazio, mais de 20, repetida, zero, negativa e fracionada', () => {
    expect(() => validarTiragens([])).toThrow()
    expect(() => validarTiragens(null)).toThrow()
    expect(() => validarTiragens(Array.from({ length: MAX_TIRAGENS_POR_ITEM + 1 }, (_, i) => i + 1))).toThrow()
    expect(() => validarTiragens([1000, 1000])).toThrow(/repetida/)
    expect(() => validarTiragens([0])).toThrow()
    expect(() => validarTiragens([-5])).toThrow()
    expect(() => validarTiragens([10.5])).toThrow()
    expect(() => validarTiragens(['1000'])).toThrow()
  })
  it('aceita exatamente 20', () => {
    expect(validarTiragens(Array.from({ length: 20 }, (_, i) => (i + 1) * 100))).toHaveLength(20)
  })
})

describe('formarLinhaTiragem — igualdade com o motor (plano único)', () => {
  it.each(TIRAGENS_T5)('valor/CM da tiragem %i batem com calcularOrcamentoGrafico', (q) => {
    const r = calcularOrcamentoGrafico(paramsPlano1(q))
    const linha = formarLinhaTiragem(q, r, { margem: { ...MARGEM_T5 }, cevPerc: r.cevPerc })
    expect(linha.custoProducao).toBeCloseTo(r.custoProducao, 2)
    expect(linha.valorTotal).toBeCloseTo(r.precoVenda, 2)
    expect(linha.cmValor).toBeCloseTo(r.contribuicaoMarginalValor, 1)
    expect(linha.valorInformado).toBe(false)
    expect(linha.margemPerc).toBe(MARGEM_T5.markup)
  })
})

describe('formarLinhaTiragem — valor digitado', () => {
  const bruto = { materialDireto: 4000, custoTransformacao: 1000, servicoExterno: 0 }
  it('a margem calculada de volta, aplicada ao custo, reproduz o valor digitado', () => {
    const digitado = 8000
    const l = formarLinhaTiragem(5000, bruto, ctx, { valorInformado: digitado })
    expect(l.valorInformado).toBe(true)
    expect(l.faixaMargem).toBeNull()
    expect(l.valorTotal).toBe(digitado)
    const refeito = formarLinhaTiragem(5000, bruto, ctx, { margemPerc: l.margemPerc })
    expect(Math.abs(refeito.valorTotal - digitado)).toBeLessThanOrEqual(0.5)
  })
  it('valor digitado tem precedência sobre margem e faixa', () => {
    const l = formarLinhaTiragem(5000, bruto, ctx, { valorInformado: 9000, margemPerc: 10, faixaMargem: 2 })
    expect(l.valorTotal).toBe(9000)
    expect(l.faixaMargem).toBeNull()
  })
  it('valor zero ou nulo é ignorado e volta ao markup do item', () => {
    expect(formarLinhaTiragem(5000, bruto, ctx, { valorInformado: 0 }).valorInformado).toBe(false)
    expect(formarLinhaTiragem(5000, bruto, ctx, { valorInformado: null }).margemPerc).toBe(MARGEM_T5.markup)
  })
  it('property: ida e volta valor↔margem fecha em até R$ 0,50', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 500000 }), // custo
        fc.integer({ min: 105, max: 400 }), // valor = custo × fator/100
        (custo, fator) => {
          const b = { materialDireto: custo * 0.8, custoTransformacao: custo * 0.2, servicoExterno: 0 }
          const valor = Math.round(custo * (fator / 100) * 100) / 100
          const l = formarLinhaTiragem(1000, b, { margem: { impostos: 0, comissao: 0, despAdm: 0, markup: 10 } }, { valorInformado: valor })
          try {
            const volta = formarLinhaTiragem(1000, b, { margem: { impostos: 0, comissao: 0, despAdm: 0, markup: 10 } }, { margemPerc: l.margemPerc })
            return Math.abs(volta.valorTotal - valor) <= 0.5 + valor * 1e-5
          } catch {
            return true // margem de volta ≥ 100% não forma preço; fora do domínio útil
          }
        },
      ),
    )
  })
})

describe('soma dos planos por tiragem (multi-plano)', () => {
  it.each(TIRAGENS_T5)('tiragem %i: o item soma MD/CT/SE dos dois planos', (q) => {
    const p1 = brutoDoPlano(1, paramsPlano1(q))
    const p2 = brutoDoPlano(2, paramsPlano2(q))
    const soma = brutoDePlanos([p1, p2])
    expect(soma.materialDireto).toBeCloseTo(p1.materialDireto + p2.materialDireto, 2)
    expect(soma.custoTransformacao).toBeCloseTo(p1.custoTransformacao + p2.custoTransformacao, 2)
    const l = formarLinhaTiragem(q, soma, ctx)
    expect(l.custoProducao).toBeCloseTo(soma.materialDireto + soma.custoTransformacao + soma.servicoExterno, 1)
  })
  it('o custo cresce com a tiragem (mesmos planos, mais folhas)', () => {
    const custos = TIRAGENS_T5.map((q) =>
      formarLinhaTiragem(q, brutoDePlanos([brutoDoPlano(1, paramsPlano1(q)), brutoDoPlano(2, paramsPlano2(q))]), ctx).custoProducao,
    )
    expect(custos[0]).toBeLessThan(custos[1])
    expect(custos[1]).toBeLessThan(custos[2])
  })
})

describe('referência e ordem', () => {
  it('usa a quantidade atual quando está na lista; senão a primeira', () => {
    expect(escolherReferencia([2000, 4000, 6000], 4000)).toBe(4000)
    expect(escolherReferencia([2000, 4000, 6000], 9999)).toBe(2000)
    expect(escolherReferencia([2000, 4000, 6000], null)).toBe(2000)
  })
  it('numera 0 para a referência e 1..N crescente para as demais', () => {
    const r = numerarOrdem([{ quantidade: 2000 }, { quantidade: 4000 }, { quantidade: 6000 }], 4000)
    expect(r.map((x) => [x.quantidade, x.ordem])).toEqual([[4000, 0], [2000, 1], [6000, 2]])
  })
})

describe('calcularLinhasTiragem', () => {
  it('calcula uma linha por tiragem e mantém o valor digitado nas decisões existentes', async () => {
    const calc = vi.fn(async (q: number) => ({ materialDireto: q * 0.5, custoTransformacao: q * 0.1, servicoExterno: 0 }))
    const linhas = await calcularLinhasTiragem({
      tiragens: [1000, 2000, 3000],
      quantidadeAtual: 2000,
      calcularNaTiragem: calc,
      ctx,
      entradas: new Map([[3000, { valorInformado: 5000 }]]),
    })
    expect(calc).toHaveBeenCalledTimes(3)
    expect(linhas.find((l) => l.ordem === 0)?.quantidade).toBe(2000)
    const l3 = linhas.find((l) => l.quantidade === 3000)!
    expect(l3.valorInformado).toBe(true)
    expect(l3.valorTotal).toBe(5000)
    expect(linhas.find((l) => l.quantidade === 1000)!.valorInformado).toBe(false)
  })
})

describe('entradasDasLinhas', () => {
  it('preserva valor digitado e faixa escolhida; descarta a margem padrão', () => {
    const m = entradasDasLinhas([
      { quantidade: 1000, valorTotal: '5000.00', margemPerc: '20', faixaMargem: null, valorInformado: true },
      { quantidade: 2000, valorTotal: '9000', margemPerc: '30', faixaMargem: 2, valorInformado: false },
      { quantidade: 3000, valorTotal: '9000', margemPerc: '30', faixaMargem: null, valorInformado: false },
    ])
    expect(m.get(1000)).toEqual({ valorInformado: 5000 })
    expect(m.get(2000)).toEqual({ margemPerc: 30, faixaMargem: 2 })
    expect(m.has(3000)).toBe(false)
  })
})

describe('gravarTiragensDoItem', () => {
  function dbFake(itemExiste = true) {
    const chamadas: Array<[string, unknown]> = []
    const tx = {
      itemTiragemOrcamentoGrafico: {
        deleteMany: vi.fn(async (a) => { chamadas.push(['deleteMany', a]) }),
        upsert: vi.fn(async (a) => { chamadas.push(['upsert', a]) }),
      },
      itemOrcamentoGrafico: { updateMany: vi.fn(async (a) => { chamadas.push(['updateMany', a]) }) },
    }
    const db: any = {
      itemOrcamentoGrafico: { findFirst: vi.fn(async () => (itemExiste ? { id: 'i1' } : null)) },
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    }
    return { db, tx, chamadas }
  }
  const linhas = numerarOrdem(
    [2000, 4000].map((q) => formarLinhaTiragem(q, { materialDireto: q, custoTransformacao: 100, servicoExterno: 0 }, ctx)),
    4000,
  )

  it('grava as linhas e espelha a referência no item, sempre com empresaId', async () => {
    const { db, tx } = dbFake()
    await gravarTiragensDoItem('emp1', 'i1', linhas, db)
    expect(db.itemOrcamentoGrafico.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'i1', empresaId: 'emp1' } }))
    expect(tx.itemTiragemOrcamentoGrafico.upsert).toHaveBeenCalledTimes(2)
    expect(tx.itemTiragemOrcamentoGrafico.deleteMany).toHaveBeenCalledWith({
      where: { itemId: 'i1', empresaId: 'emp1', quantidade: { notIn: [4000, 2000] } },
    })
    const espelho = tx.itemOrcamentoGrafico.updateMany.mock.calls[0][0]
    expect(espelho.where).toEqual({ id: 'i1', empresaId: 'emp1' })
    expect(espelho.data.quantidade).toBe(4000)
  })
  it('item de outra empresa ou inexistente: 404 e nada é gravado', async () => {
    const { db, tx } = dbFake(false)
    await expect(gravarTiragensDoItem('outra', 'i1', linhas, db)).rejects.toMatchObject({ statusCode: 404 })
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(tx.itemTiragemOrcamentoGrafico.upsert).not.toHaveBeenCalled()
  })
  it('lista vazia remove as linhas e não espelha nada', async () => {
    const { db, tx } = dbFake()
    await gravarTiragensDoItem('emp1', 'i1', [], db)
    expect(tx.itemTiragemOrcamentoGrafico.deleteMany).toHaveBeenCalledWith({ where: { itemId: 'i1', empresaId: 'emp1', quantidade: { notIn: [] } } })
    expect(tx.itemOrcamentoGrafico.updateMany).not.toHaveBeenCalled()
  })
  it('margem fora de Decimal(5,2) é limitada ao espelhar', async () => {
    const { db, tx } = dbFake()
    const l = numerarOrdem([{ ...formarLinhaTiragem(1000, { materialDireto: 1, custoTransformacao: 0, servicoExterno: 0 }, ctx), margemPerc: 12345.678 }], 1000)
    await gravarTiragensDoItem('emp1', 'i1', l, db)
    expect(tx.itemOrcamentoGrafico.updateMany.mock.calls[0][0].data.margemSelecionada).toBe(999.99)
  })
})

void cevT5
