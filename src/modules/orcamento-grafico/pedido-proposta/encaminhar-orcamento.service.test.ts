// Golden do encaminhamento RFQ → Orçamento — spec comercial-pedido-proposta
// (Task 5.1). Mocка o prisma. Rodar: npx vitest run <arquivo> --reporter=dot

import { describe, it, expect, vi, beforeEach } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  pedidoProposta: { findFirst: vi.fn() },
  orcamentoGrafico: { findFirst: vi.fn() },
  tipoEmbalagem: { findMany: vi.fn(), findFirst: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }))

import { criarOrcamentoDePedidoProposta } from './encaminhar-orcamento.service'

const EMPRESA = 'emp-1'
const PEDIDO = 'ped-1'

beforeEach(() => {
  vi.clearAllMocks()
})

function rfqBase(over: Record<string, unknown> = {}) {
  return {
    id: PEDIDO,
    estado: 'EM_ANALISE',
    orcamentoGraficoId: null,
    clienteId: 'cli-1',
    clienteNome: 'Cliente X',
    vendedorId: 'vend-1',
    tipoEmbalagem: 'Cartucho',
    medidasTexto: '190 x 100 x 40',
    quantidade: 5000,
    acabamentos: 'Verniz UV',
    observacoes: 'obs',
    exigeAmostra: false,
    numero: 7,
    ...over,
  }
}

describe('criarOrcamentoDePedidoProposta (golden)', () => {
  // G1 — caminho feliz
  it('G1: EM_ANALISE + tipo casa único → cria orçamento AGUARDANDO, vincula e transiciona', async () => {
    prismaMock.pedidoProposta.findFirst.mockResolvedValue(rfqBase())
    prismaMock.tipoEmbalagem.findMany.mockResolvedValue([{ id: 'tipo-1', codigo: 'CG-EMB-1', descricao: 'Cartucho' }])
    prismaMock.tipoEmbalagem.findFirst.mockResolvedValue({ id: 'tipo-1' })
    prismaMock.orcamentoGrafico.findFirst.mockResolvedValue({ numero: 40 }) // último número

    const tx = {
      orcamentoGrafico: { create: vi.fn().mockResolvedValue({ id: 'orc-novo', numero: 41 }) },
      pedidoProposta: { update: vi.fn().mockResolvedValue({}) },
      logPedidoProposta: { create: vi.fn().mockResolvedValue({}) },
    }
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx))

    const r = await criarOrcamentoDePedidoProposta(EMPRESA, PEDIDO, 'user-1')
    expect(r).toEqual({ orcamentoGraficoId: 'orc-novo', numero: 41 })

    // Orçamento criado RASCUNHO + AGUARDANDO + vínculo + medidas parseadas
    const dataOrc = tx.orcamentoGrafico.create.mock.calls[0][0].data
    expect(dataOrc.status).toBe('RASCUNHO')
    expect(dataOrc.etapaCalculo).toBe('AGUARDANDO')
    expect(dataOrc.pedidoPropostaId).toBe(PEDIDO)
    expect(dataOrc.tipoEmbalagemId).toBe('tipo-1')
    expect(dataOrc.numero).toBe(41)
    expect(dataOrc.medidas).toMatchObject({ P: 190, L: 100, A: 40 })

    // RFQ transicionado para ENVIADO_ORCAMENTO
    const dataUpd = tx.pedidoProposta.update.mock.calls[0][0].data
    expect(dataUpd.estado).toBe('ENVIADO_ORCAMENTO')
    expect(dataUpd.orcamentoGraficoId).toBe('orc-novo')
  })

  // G2 — estado inválido
  it('G2: estado ≠ EM_ANALISE → RFQ_NAO_APTO_ENCAMINHAR, nada criado', async () => {
    prismaMock.pedidoProposta.findFirst.mockResolvedValue(rfqBase({ estado: 'NOVO' }))
    await expect(criarOrcamentoDePedidoProposta(EMPRESA, PEDIDO, 'user-1')).rejects.toMatchObject({
      code: 'RFQ_NAO_APTO_ENCAMINHAR',
      statusCode: 409,
    })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  // G2b — tipo de embalagem não resolvido
  it('G2b: tipo de embalagem ambíguo/sem match → TIPO_EMBALAGEM_NAO_RESOLVIDO', async () => {
    prismaMock.pedidoProposta.findFirst.mockResolvedValue(rfqBase({ tipoEmbalagem: 'Coisa Inexistente' }))
    prismaMock.tipoEmbalagem.findMany.mockResolvedValue([{ id: 'tipo-1', codigo: 'CG-EMB-1', descricao: 'Cartucho' }])
    await expect(criarOrcamentoDePedidoProposta(EMPRESA, PEDIDO, 'user-1')).rejects.toMatchObject({
      code: 'TIPO_EMBALAGEM_NAO_RESOLVIDO',
    })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  // G3 — falha na transação não deixa estado alterado (propaga erro)
  it('G3: falha na criação do orçamento propaga erro (rollback — $transaction lança)', async () => {
    prismaMock.pedidoProposta.findFirst.mockResolvedValue(rfqBase())
    prismaMock.tipoEmbalagem.findMany.mockResolvedValue([{ id: 'tipo-1', codigo: 'CG-EMB-1', descricao: 'Cartucho' }])
    prismaMock.tipoEmbalagem.findFirst.mockResolvedValue({ id: 'tipo-1' })
    prismaMock.orcamentoGrafico.findFirst.mockResolvedValue({ numero: 40 })
    prismaMock.$transaction.mockRejectedValue(new Error('db down'))
    await expect(criarOrcamentoDePedidoProposta(EMPRESA, PEDIDO, 'user-1')).rejects.toThrow('db down')
  })

  // Idempotência — já encaminhado retorna o existente
  it('idempotente: já tem orcamentoGraficoId → retorna o existente sem recriar', async () => {
    prismaMock.pedidoProposta.findFirst.mockResolvedValue(rfqBase({ orcamentoGraficoId: 'orc-ja' }))
    prismaMock.orcamentoGrafico.findFirst.mockResolvedValue({ id: 'orc-ja', numero: 33 })
    const r = await criarOrcamentoDePedidoProposta(EMPRESA, PEDIDO, 'user-1')
    expect(r).toEqual({ orcamentoGraficoId: 'orc-ja', numero: 33 })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
})
