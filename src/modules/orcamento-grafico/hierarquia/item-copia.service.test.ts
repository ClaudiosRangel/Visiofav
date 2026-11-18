import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, motorMock } = vi.hoisted(() => {
  const model = () =>
    Object.fromEntries(['findFirst', 'findMany', 'create', 'update'].map((m) => [m, vi.fn()]))
  const prismaMock: Record<string, any> = {
    orcamentoGrafico: model(),
    itemOrcamentoGrafico: model(),
    planoCalculoGrafico: model(),
    selecaoMaterialAcabamento: model(),
    $queryRawUnsafe: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    $transaction: vi.fn(),
  }
  return { prismaMock, motorMock: { calcularOrcamentoGrafico: vi.fn(), calcularItem: vi.fn() } }
})
vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../orcamento-grafico-calculo.service', () => ({ calcularOrcamentoGrafico: motorMock.calcularOrcamentoGrafico }))
vi.mock('../orcamento-grafico-item.service', () => ({ calcularItem: motorMock.calcularItem }))

import { copiarItem, remapearSelecaoIds } from './item-copia.service'

const original = {
  id: 'item-1', orcamentoId: 'orc-1', empresaId: 'emp-A', sequencia: 1,
  tipoEmbalagemId: 'te', descricao: 'Original', medidas: { L: 1, A: 2, largura: 1, altura: 2 },
  papelId: 'pp', papelDescricao: 'Papel', suporteId: 'su', gramatura: '415', numCores: 3,
  cores: [{ nome: 'P1' }], maquinaId: 'mq', matrizQuantidade: '3', matrizPrecoUnitario: '100',
  tintaModo: null, tintaConsumoKg: null, acabamentosRicos: [{ nome: 'x' }],
  materiaisAcabamento: [{ origem: 'SELECAO', selecaoId: 'sel-old', nome: 'Mat' }, { origem: 'MANUAL', selecaoId: 'sel-old' }],
  materialMicroonduladoId: null, modeloFacaId: null, itensDiversos: null, itensFornecidos: null, camposLivres: null,
  quantidade: 4000, resultadoCalculo: { custoProducao: 5192.05 }, margemSelecionada: '30', custoProducao: '5192.05',
  valorTotal: '7000.00', pendente: false, criadoEm: new Date(), atualizadoEm: new Date(),
  siglaAcabado: null, tributacao: null, processoImpressao: null, coberturaTintaTexto: null, fabricante: null,
  microondulado: false, fornecido: false, qtdModelos: 1, arte: null, observacao: null, observacaoAreasOp: null,
  conteudoVolume: null, acondicionamento: null, comprimentoMm: '190', larguraMm: '1200', alturaMm: null, abaColaMm: null,
  abaFechamentoMm: null, fibra: false, montagemLinhas: 2, montagemColunas: 2, formatoSupLarguraMm: null,
  formatoSupAlturaMm: null, formatoCorteLarguraMm: '650', formatoCorteAlturaMm: '1225', ajusteCorteMicroMm: '0',
  suporteProducaoId: null, calculoGraficoOrigemId: 'calc-1', produtoGraficoId: 'prod-1', planos: [],
}

function prepararBanco() {
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
  prismaMock.orcamentoGrafico.findFirst.mockResolvedValue({ id: 'orc-1' })
  prismaMock.itemOrcamentoGrafico.findFirst.mockImplementation(async ({ where, orderBy }: any) => {
    if (orderBy?.sequencia === 'desc') return { sequencia: 3 }
    return where.id === 'item-1' && where.orcamentoId === 'orc-1' && where.empresaId === 'emp-A' ? original : null
  })
  prismaMock.itemOrcamentoGrafico.findMany.mockResolvedValue([
    { custoProducao: '5192.05', valorTotal: '7000.00', margemSelecionada: '30' },
    { custoProducao: '5192.05', valorTotal: '7000.00', margemSelecionada: '30' },
  ])
  prismaMock.planoCalculoGrafico.findMany.mockResolvedValue([
    {
      id: 'pl-old', itemId: 'item-1', empresaId: 'emp-A', sequencia: 1, nome: 'Plano 1', suporteId: null, suporteProducaoId: null,
      gramatura: '415', formatoLarguraMm: '650', formatoAlturaMm: '1225', preImpressao: null, numCores: 3, cores: null,
      maquinaId: null, acabamentosRicos: null, resultadoCalculo: null, custoSuporte: '0', custoImpressao: '0',
      custoAcabamento: '0', tipoPlanoId: 'tp',
    },
  ])
  prismaMock.planoCalculoGrafico.create.mockResolvedValue({ id: 'pl-new' })
  prismaMock.selecaoMaterialAcabamento.findMany.mockResolvedValue([
    { id: 'sel-old', empresaId: 'emp-A', itemId: 'item-1', planoId: 'pl-old', acabamentoId: 'ac', materialId: 'm', restricaoId: null,
      tipoParam: 0, param1: null, param2: null, consumo: '2', unidadeConsumo: 'kg', valorUnitario: '5', custo: '10',
      aplicaNoPreco: true, situacaoParametro: 'VALIDADO' },
  ])
  prismaMock.selecaoMaterialAcabamento.create.mockResolvedValue({ id: 'sel-new' })
  prismaMock.itemOrcamentoGrafico.create.mockResolvedValue({ id: 'item-new' })
  prismaMock.$queryRawUnsafe.mockResolvedValue([{ aproveitamento_manual: '3' }])
  prismaMock.$executeRawUnsafe.mockResolvedValue(1)
  prismaMock.itemOrcamentoGrafico.update.mockResolvedValue({})
  prismaMock.orcamentoGrafico.update.mockResolvedValue({})
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('copiarItem', () => {
  it('copia valores persistidos sem chamar o motor, com sequencia = max+1 e empresaId explícito', async () => {
    prepararBanco()
    const r = await copiarItem('orc-1', 'item-1', 'emp-A', prismaMock as any)
    expect(r).toEqual({ itemId: 'item-new', sequencia: 4, planosCopiados: 1 })

    const data = prismaMock.itemOrcamentoGrafico.create.mock.calls[0][0].data
    expect(data.orcamentoId).toBe('orc-1')
    expect(data.empresaId).toBe('emp-A')
    expect(data.sequencia).toBe(4)
    // Custo e âncora acompanham a cópia (idêntico ao original).
    expect(data.custoProducao).toBe(original.custoProducao)
    expect(data.valorTotal).toBe(original.valorTotal)
    expect(data.margemSelecionada).toBe(original.margemSelecionada)
    expect(data.resultadoCalculo).toEqual(original.resultadoCalculo)
    expect(data.calculoGraficoOrigemId).toBe('calc-1')
    expect(data).not.toHaveProperty('id')

    expect(motorMock.calcularOrcamentoGrafico).not.toHaveBeenCalled()
    expect(motorMock.calcularItem).not.toHaveBeenCalled()
  })

  it('copia aproveitamento_manual por SQL raw parametrizado', async () => {
    prepararBanco()
    await copiarItem('orc-1', 'item-1', 'emp-A', prismaMock as any)
    const [sqlLeitura, ...paramsLeitura] = prismaMock.$queryRawUnsafe.mock.calls[0]
    expect(sqlLeitura).toContain('aproveitamento_manual')
    expect(paramsLeitura).toEqual(['item-1', 'emp-A'])
    const [sqlEscrita, ...paramsEscrita] = prismaMock.$executeRawUnsafe.mock.calls[0]
    expect(sqlEscrita).toContain('UPDATE item_orcamento_grafico')
    expect(paramsEscrita).toEqual([3, 'item-new', 'emp-A'])
  })

  it('cria planos com ids novos, seleções ligadas ao plano novo e reescreve selecaoId no JSON do item', async () => {
    prepararBanco()
    await copiarItem('orc-1', 'item-1', 'emp-A', prismaMock as any)
    const plano = prismaMock.planoCalculoGrafico.create.mock.calls[0][0].data
    expect(plano.itemId).toBe('item-new')
    expect(plano.empresaId).toBe('emp-A')
    expect(plano).not.toHaveProperty('id')

    const sel = prismaMock.selecaoMaterialAcabamento.create.mock.calls[0][0].data
    expect(sel.itemId).toBe('item-new')
    expect(sel.planoId).toBe('pl-new')
    expect(sel.empresaId).toBe('emp-A')

    const upd = prismaMock.itemOrcamentoGrafico.update.mock.calls[0][0]
    expect(upd.where).toEqual({ id: 'item-new', empresaId: 'emp-A' })
    expect(upd.data.materiaisAcabamento).toEqual([
      { origem: 'SELECAO', selecaoId: 'sel-new', nome: 'Mat' },
      { origem: 'MANUAL', selecaoId: 'sel-old' }, // linha manual nunca é alterada
    ])
  })

  it('reconsolida o cabeçalho pela função pura consolidarOrcamento', async () => {
    prepararBanco()
    await copiarItem('orc-1', 'item-1', 'emp-A', prismaMock as any)
    const upd = prismaMock.orcamentoGrafico.update.mock.calls[0][0]
    expect(upd.where).toEqual({ id: 'orc-1', empresaId: 'emp-A' })
    expect(upd.data).toEqual({ custoProducaoConsolidado: 10384.1, valorTotalConsolidado: 14000 })
  })

  it('item de outra empresa/orçamento → 404 e nada é criado', async () => {
    prepararBanco()
    await expect(copiarItem('orc-1', 'item-1', 'emp-B', prismaMock as any)).rejects.toMatchObject({ statusCode: 404 })
    expect(prismaMock.itemOrcamentoGrafico.create).not.toHaveBeenCalled()
    expect(prismaMock.planoCalculoGrafico.create).not.toHaveBeenCalled()
  })

  it('colisão P2002 repete uma única vez', async () => {
    prepararBanco()
    prismaMock.itemOrcamentoGrafico.create
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }))
      .mockResolvedValueOnce({ id: 'item-new' })
    const r = await copiarItem('orc-1', 'item-1', 'emp-A', prismaMock as any)
    expect(r.itemId).toBe('item-new')
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2)
  })

  it('falha geral propaga (a transação reverte tudo)', async () => {
    prepararBanco()
    prismaMock.itemOrcamentoGrafico.create.mockRejectedValue(new Error('boom'))
    await expect(copiarItem('orc-1', 'item-1', 'emp-A', prismaMock as any)).rejects.toThrow('boom')
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
  })
})

describe('remapearSelecaoIds', () => {
  it('só altera linhas de origem SELECAO que constam do mapa', () => {
    const r = remapearSelecaoIds(
      [{ origem: 'SELECAO', selecaoId: 'a' }, { origem: 'SELECAO', selecaoId: 'z' }, { origem: 'MANUAL', selecaoId: 'a' }, 'lixo'],
      new Map([['a', 'b']]),
    )
    expect(r).toEqual([{ origem: 'SELECAO', selecaoId: 'b' }, { origem: 'SELECAO', selecaoId: 'z' }, { origem: 'MANUAL', selecaoId: 'a' }, 'lixo'])
  })
  it('valor que não é lista volta igual', () => {
    expect(remapearSelecaoIds(null, new Map())).toBeNull()
  })
})
