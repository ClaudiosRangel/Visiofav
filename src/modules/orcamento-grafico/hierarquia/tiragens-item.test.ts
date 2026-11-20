import { describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import { calcularOrcamentoGrafico } from '../orcamento-grafico-calculo.service'
import { fechamentoDoResultado } from '../plano-calculo.service'
import { MARGEM_T5, TIRAGENS_T5, paramsPlano1, paramsPlano2 } from './t5-entrada'
import {
  brutoDePlanos,
  contextoDePrecoDeParams,
  escolherReferencia,
  formarLinhaTiragem,
  MAX_TIRAGENS_POR_ITEM,
  numerarOrdem,
  validarTiragens,
} from './tiragens-item-puro'
import {
  calcularLinhasTiragem,
  definirEntradaTiragem,
  entradasDasLinhas,
  gravarTiragensDoItem,
  recalcularTiragensDoItem,
} from './tiragens-item.service'

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
  it('a linha guarda o contexto de preço usado', () => {
    const l = formarLinhaTiragem(1000, { materialDireto: 1, custoTransformacao: 1, servicoExterno: 0 }, ctx)
    expect(l.contexto).toEqual(ctx)
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
        fc.integer({ min: 100, max: 500000 }),
        fc.integer({ min: 105, max: 400 }),
        (custo, fator) => {
          const b = { materialDireto: custo * 0.8, custoTransformacao: custo * 0.2, servicoExterno: 0 }
          const valor = Math.round(custo * (fator / 100) * 100) / 100
          const c = { margem: { impostos: 0, comissao: 0, despAdm: 0, markup: 10 } }
          const l = formarLinhaTiragem(1000, b, c, { valorInformado: valor })
          try {
            const volta = formarLinhaTiragem(1000, b, c, { margemPerc: l.margemPerc })
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
  const calcBase = (q: number) => ({ bruto: { materialDireto: q * 0.5, custoTransformacao: q * 0.1, servicoExterno: 0 }, ctx })
  it('calcula uma linha por tiragem e mantém o valor digitado nas decisões existentes', async () => {
    const calc = vi.fn(async (q: number) => calcBase(q))
    const linhas = await calcularLinhasTiragem({
      tiragens: [1000, 2000, 3000],
      quantidadeAtual: 2000,
      calcularNaTiragem: calc,
      entradas: new Map([[3000, { valorInformado: 5000 }]]),
    })
    expect(calc).toHaveBeenCalledTimes(3)
    expect(linhas.find((l) => l.ordem === 0)?.quantidade).toBe(2000)
    const l3 = linhas.find((l) => l.quantidade === 3000)!
    expect(l3.valorInformado).toBe(true)
    expect(l3.valorTotal).toBe(5000)
    expect(linhas.find((l) => l.quantidade === 1000)!.valorInformado).toBe(false)
  })
  it('valor ancorado (cálculo de origem) vale na tiragem de origem e não nas outras', async () => {
    const linhas = await calcularLinhasTiragem({
      tiragens: [1000, 2000],
      quantidadeAtual: 1000,
      calcularNaTiragem: async (q) => ({ ...calcBase(q), valorAncorado: q === 1000 ? 15084.04 : null }),
    })
    expect(linhas.find((l) => l.quantidade === 1000)!.valorTotal).toBe(15084.04)
    const outra = linhas.find((l) => l.quantidade === 2000)!
    expect(outra.valorInformado).toBe(false)
    expect(outra.valorTotal).not.toBe(15084.04)
  })
  it('decisão do usuário vence a âncora', async () => {
    const linhas = await calcularLinhasTiragem({
      tiragens: [1000],
      calcularNaTiragem: async (q) => ({ ...calcBase(q), valorAncorado: 15084.04 }),
      entradas: new Map([[1000, { valorInformado: 9999 }]]),
    })
    expect(linhas[0].valorTotal).toBe(9999)
  })
})

describe('contextoDePrecoDeParams', () => {
  it('sem cev detalhado usa a margem como está', () => {
    const c = contextoDePrecoDeParams({ margem: { impostos: 15, comissao: 5, despAdm: 5, markup: 30 } })
    expect(c.cevPerc).toBe(25)
    expect(c.margem.markup).toBe(30)
  })
  it('com cev detalhado: impostos = icms+juros+pisCofins, comissão = comissões, despAdm = 0', () => {
    const c = contextoDePrecoDeParams({
      margem: { impostos: 1, comissao: 1, despAdm: 1, markup: 15.9283909276128 },
      cev: { icms: 3, juros: 6, pisCofins: 9.25, comissoes: 3 },
      creditosFiscais: 10,
      encargoFinanceiroPerc: 0.13,
    })
    expect(c.margem).toEqual({ impostos: 18.25, comissao: 3, despAdm: 0, markup: 15.9283909276128 })
    expect(c.cevPerc).toBe(21.25)
    expect(c.creditosFiscais).toBe(10)
    expect(c.encargoFinanceiroPerc).toBe(0.13)
  })
  it('o preço pelo contexto derivado bate com o motor quando há CEV detalhado', () => {
    const base = paramsPlano1(1000)
    const params = { ...base, cev: { icms: 3, juros: 2, pisCofins: 9.25, comissoes: 3 } }
    const r = calcularOrcamentoGrafico(params)
    const l = formarLinhaTiragem(1000, r, contextoDePrecoDeParams(params))
    expect(l.valorTotal).toBeCloseTo(r.precoVenda, 2)
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
    const tx = {
      itemTiragemOrcamentoGrafico: {
        deleteMany: vi.fn(async (_a?: any) => {}),
        upsert: vi.fn(async (_a?: any) => {}),
      },
      itemOrcamentoGrafico: { updateMany: vi.fn(async (_a?: any) => {}) },
    }
    const db: any = {
      itemOrcamentoGrafico: { findFirst: vi.fn(async () => (itemExiste ? { id: 'i1' } : null)) },
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    }
    return { db, tx }
  }
  const linhas = numerarOrdem(
    [2000, 4000].map((q) => formarLinhaTiragem(q, { materialDireto: q, custoTransformacao: 100, servicoExterno: 0 }, ctx)),
    4000,
  )

  it('grava as linhas (com o contexto) e espelha a referência no item, sempre com empresaId', async () => {
    const { db, tx } = dbFake()
    await gravarTiragensDoItem('emp1', 'i1', linhas, db)
    expect(db.itemOrcamentoGrafico.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'i1', empresaId: 'emp1' } }))
    expect(tx.itemTiragemOrcamentoGrafico.upsert).toHaveBeenCalledTimes(2)
    expect(tx.itemTiragemOrcamentoGrafico.upsert.mock.calls[0][0].create.contexto).toEqual(ctx)
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

describe('recalcularTiragensDoItem', () => {
  function dbComLinhas(linhasExistentes: any[]) {
    const tx = {
      itemTiragemOrcamentoGrafico: { deleteMany: vi.fn(async (_a?: any) => {}), upsert: vi.fn(async (_a?: any) => {}) },
      itemOrcamentoGrafico: { updateMany: vi.fn(async (_a?: any) => {}) },
    }
    const db: any = {
      itemTiragemOrcamentoGrafico: { findMany: vi.fn(async () => linhasExistentes) },
      itemOrcamentoGrafico: { findFirst: vi.fn(async () => ({ id: 'i1' })) },
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    }
    return { db, tx }
  }
  const calc = async (q: number) => ({ bruto: { materialDireto: q, custoTransformacao: 50, servicoExterno: 0 }, ctx })

  it('item sem linhas e sem lista nova: devolve null e não grava (comportamento de uma tiragem)', async () => {
    const { db } = dbComLinhas([])
    const r = await recalcularTiragensDoItem({ empresaId: 'e1', itemId: 'i1', calcularNaTiragem: calc, db })
    expect(r).toBeNull()
    expect(db.$transaction).not.toHaveBeenCalled()
  })
  it('lista nova cria as linhas', async () => {
    const { db, tx } = dbComLinhas([])
    const r = await recalcularTiragensDoItem({ empresaId: 'e1', itemId: 'i1', tiragens: [1000, 2000, 3000], calcularNaTiragem: calc, db })
    expect(r).toHaveLength(3)
    expect(tx.itemTiragemOrcamentoGrafico.upsert).toHaveBeenCalledTimes(3)
  })
  it('sem lista nova, recalcula as quantidades existentes e mantém o valor digitado', async () => {
    const { db, tx } = dbComLinhas([
      { quantidade: 2000, ordem: 0, valorTotal: '8000', margemPerc: '20', faixaMargem: null, valorInformado: true },
      { quantidade: 1000, ordem: 1, valorTotal: '4000', margemPerc: '30', faixaMargem: null, valorInformado: false },
    ])
    const r = await recalcularTiragensDoItem({ empresaId: 'e1', itemId: 'i1', calcularNaTiragem: calc, db })
    expect(r!.map((l) => l.quantidade).sort()).toEqual([1000, 2000])
    expect(r!.find((l) => l.quantidade === 2000)!.valorTotal).toBe(8000)
    expect(r!.find((l) => l.ordem === 0)!.quantidade).toBe(2000)
    expect(tx.itemOrcamentoGrafico.updateMany).toHaveBeenCalledTimes(1)
  })
  it('lista vazia explícita remove as linhas e devolve []', async () => {
    const { db, tx } = dbComLinhas([{ quantidade: 1000, ordem: 0, valorTotal: '1', margemPerc: '1', faixaMargem: null, valorInformado: false }])
    const r = await recalcularTiragensDoItem({ empresaId: 'e1', itemId: 'i1', tiragens: [], calcularNaTiragem: calc, db })
    expect(r).toEqual([])
    expect(tx.itemOrcamentoGrafico.updateMany).not.toHaveBeenCalled()
  })
  it('tiragem removida da lista é apagada', async () => {
    const { db, tx } = dbComLinhas([{ quantidade: 5000, ordem: 0, valorTotal: '1', margemPerc: '1', faixaMargem: null, valorInformado: false }])
    await recalcularTiragensDoItem({ empresaId: 'e1', itemId: 'i1', tiragens: [1000, 2000], calcularNaTiragem: calc, db })
    expect(tx.itemTiragemOrcamentoGrafico.deleteMany).toHaveBeenCalledWith({
      where: { itemId: 'i1', empresaId: 'e1', quantidade: { notIn: expect.arrayContaining([1000, 2000]) } },
    })
  })
})

describe('definirEntradaTiragem', () => {
  const ctxGravado = { margem: { ...MARGEM_T5 }, cevPerc: cevT5 }
  function db(opts: { achou?: boolean; ordem?: number; contexto?: unknown } = {}) {
    const { achou = true, ordem = 0, contexto = ctxGravado } = opts
    const tx = {
      itemTiragemOrcamentoGrafico: { updateMany: vi.fn(async (_a?: any) => {}) },
      itemOrcamentoGrafico: { updateMany: vi.fn(async (_a?: any) => {}) },
    }
    const d: any = {
      itemTiragemOrcamentoGrafico: {
        findFirst: vi.fn(async () =>
          achou ? { id: 'l1', ordem, materialDireto: '4000', custoTransformacao: '1000', servicoExterno: '0', contexto } : null,
        ),
      },
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    }
    return { d, tx }
  }
  it('valor digitado: grava o valor, calcula a margem de volta e marca valorInformado', async () => {
    const { d, tx } = db()
    const l = await definirEntradaTiragem('e1', 'i1', 2000, { valorTotal: 8000 }, d)
    expect(l.valorTotal).toBe(8000)
    expect(l.valorInformado).toBe(true)
    expect(l.faixaMargem).toBeNull()
    const chamada = tx.itemTiragemOrcamentoGrafico.updateMany.mock.calls[0][0]
    expect(chamada.where).toEqual({ id: 'l1', empresaId: 'e1' })
    expect(chamada.data.valorTotal).toBe(8000)
  })
  it('margem escolhida: refaz o valor com o contexto guardado, vira faixa 1 e desmarca valorInformado', async () => {
    const { d } = db()
    const l = await definirEntradaTiragem('e1', 'i1', 2000, { margemPerc: 20 }, d)
    const esperado = formarLinhaTiragem(2000, { materialDireto: 4000, custoTransformacao: 1000, servicoExterno: 0 }, ctxGravado, { margemPerc: 20 })
    expect(l.valorTotal).toBe(esperado.valorTotal)
    expect(l.valorInformado).toBe(false)
    expect(l.faixaMargem).toBe(1)
  })
  it('tiragem de referência (ordem 0) é espelhada no item; as demais não', async () => {
    const ref = db({ ordem: 0 })
    await definirEntradaTiragem('e1', 'i1', 2000, { valorTotal: 8000 }, ref.d)
    expect(ref.tx.itemOrcamentoGrafico.updateMany).toHaveBeenCalledTimes(1)
    expect(ref.tx.itemOrcamentoGrafico.updateMany.mock.calls[0][0].where).toEqual({ id: 'i1', empresaId: 'e1' })
    const outra = db({ ordem: 2 })
    await definirEntradaTiragem('e1', 'i1', 2000, { valorTotal: 8000 }, outra.d)
    expect(outra.tx.itemOrcamentoGrafico.updateMany).not.toHaveBeenCalled()
  })
  it('sem valor nem margem: 400; inexistente ou de outra empresa: 404; sem contexto gravado: 409', async () => {
    await expect(definirEntradaTiragem('e1', 'i1', 2000, {}, db().d)).rejects.toMatchObject({ statusCode: 400 })
    await expect(definirEntradaTiragem('e1', 'i1', 2000, { valorTotal: 1 }, db({ achou: false }).d)).rejects.toMatchObject({ statusCode: 404 })
    await expect(definirEntradaTiragem('e1', 'i1', 2000, { valorTotal: 1 }, db({ contexto: null }).d)).rejects.toMatchObject({ statusCode: 409 })
  })
  it('margem + CEV >= 100% vira 400 legível e não grava', async () => {
    const { d, tx } = db()
    await expect(definirEntradaTiragem('e1', 'i1', 2000, { margemPerc: 95 }, d)).rejects.toMatchObject({ statusCode: 400 })
    expect(tx.itemTiragemOrcamentoGrafico.updateMany).not.toHaveBeenCalled()
  })
})
