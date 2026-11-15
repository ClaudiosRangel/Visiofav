import { describe, expect, it } from 'vitest'
import { calcularSelecaoMaterial } from './material-selecao.service'
import { refletirSelecoesNoJson, ORIGEM_SELECAO, type LinhaSelecaoParaJson } from './selecao-material-json'
import { somarCustoPlanos } from './custo-plano.service'
import {
  aplicarMateriaisComputadosAoResultado,
  somarMateriaisComputados,
  type MaterialAcabamentoVinculo,
} from '../calculo-grafico/materiais-computados.service'

function selecao(itemPuxado: boolean, id = 'sel-1'): LinhaSelecaoParaJson {
  const s = calcularSelecaoMaterial({
    tipoParam: 4,
    param1: 2,
    tiragem: 1000,
    areaImpressaM2: 0,
    precoUnitario: 0.5,
    unidadeCusto: 'UN',
    itemPuxado,
  })
  return {
    selecaoId: id,
    materialId: 'mat-1',
    nome: 'Cola Quente',
    valorUnitario: s.valorUnitario,
    consumo: s.consumo,
    aplicaNoPreco: s.aplicaNoPreco,
  }
}

const resultadoBase = () => ({ materialDireto: 4113.94, custoProducao: 5192.05, custoTotal: 5192.05, precoVenda: 7000 })

describe('refletirSelecoesNoJson', () => {
  it('preserva linhas manuais e marca as da seleção com origem SELECAO', () => {
    const manual = { materialAcabamentoId: 'm-x', nome: 'Manual', computarCusto: true, valorUnitario: 10, quantidade: 2 }
    const json = refletirSelecoesNoJson([manual], [selecao(false)])
    expect(json[0]).toEqual(manual)
    expect(json[1]).toMatchObject({ origem: ORIGEM_SELECAO, selecaoId: 'sel-1', valorUnitario: 0.5, quantidade: 2000, computarCusto: true })
  })

  it('é idempotente (gravar duas vezes dá o mesmo resultado)', () => {
    const manual = { nome: 'Manual', computarCusto: false }
    const um = refletirSelecoesNoJson([manual], [selecao(false)])
    const dois = refletirSelecoesNoJson(um, [selecao(false)])
    expect(dois).toEqual(um)
  })

  it('substitui apenas linhas de seleção antigas, nunca as manuais com o mesmo material', () => {
    const manual = { materialAcabamentoId: 'mat-1', nome: 'Manual', computarCusto: true, valorUnitario: 1, quantidade: 1 }
    const antiga = { origem: ORIGEM_SELECAO, selecaoId: 'velha', computarCusto: true, valorUnitario: 9, quantidade: 9 }
    const json = refletirSelecoesNoJson([manual, antiga], [selecao(false, 'nova')])
    expect(json).toHaveLength(2)
    expect(json[0]).toEqual(manual)
    expect((json[1] as { selecaoId: string }).selecaoId).toBe('nova')
  })

  it('aceita Json nulo ou inválido', () => {
    expect(refletirSelecoesNoJson(null, [])).toEqual([])
    expect(refletirSelecoesNoJson('x', [selecao(false)])).toHaveLength(1)
  })
})

describe('regressão: item puxado mantém o custo ancorado', () => {
  it('seleção em item puxado grava aplicaNoPreco=false e o total não muda', () => {
    const sel = selecao(true)
    expect(sel.aplicaNoPreco).toBe(false)
    const json = refletirSelecoesNoJson([], [sel]) as MaterialAcabamentoVinculo[]
    const delta = somarMateriaisComputados(json)
    expect(delta).toBe(0)
    const antes = resultadoBase()
    const depois = aplicarMateriaisComputadosAoResultado(resultadoBase(), delta)
    expect(depois).toEqual(antes)
  })

  it('item novo soma o custo da seleção ao Material Direto', () => {
    const sel = selecao(false)
    const json = refletirSelecoesNoJson([], [sel]) as MaterialAcabamentoVinculo[]
    const delta = somarMateriaisComputados(json)
    expect(delta).toBe(1000) // 2 × 1000 × 0,5
    const depois = aplicarMateriaisComputadosAoResultado(resultadoBase(), delta)
    expect(depois.materialDireto).toBe(5113.94)
    expect(depois.custoProducao).toBe(6192.05)
  })

  it('somarCustoPlanos: puxado devolve zeros por plano e o custo ancorado', () => {
    const r = somarCustoPlanos({
      itemPuxado: true,
      custoAncoradoItem: 5192.05,
      planos: [{ planoId: 'ITEM', custosAtividades: [], custosMateriais: [] }],
    })
    expect(r.totalPlanos).toBe(0)
    expect(r.totalItem).toBe(5192.05)
    expect(r.custoPorPlano[0].custoPlano).toBe(0)
  })

  it('somarCustoPlanos: item novo soma materiais por plano', () => {
    const r = somarCustoPlanos({
      itemPuxado: false,
      planos: [
        { planoId: 'a', custosAtividades: [], custosMateriais: [100, 50] },
        { planoId: 'b', custosAtividades: [], custosMateriais: [25] },
      ],
    })
    expect(r.totalItem).toBe(175)
  })
})
