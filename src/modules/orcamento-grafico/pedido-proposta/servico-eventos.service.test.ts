/**
 * Testes de integração do Servico_Eventos (spec comercial-pedido-status-fiel).
 * Mocka o prisma para validar isolamento por empresaId, idempotência, update
 * otimista e transação. Req 16.5.
 *
 * Rodar: npx vitest run src/modules/orcamento-grafico/pedido-proposta/servico-eventos.service.test.ts --reporter=dot
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const prismaMock = vi.hoisted(() => {
  const pedidoProposta = { findFirst: vi.fn(), updateMany: vi.fn() }
  const logPedidoProposta = { findFirst: vi.fn(), create: vi.fn() }
  const client = {
    pedidoProposta,
    logPedidoProposta,
    // $transaction(fn) roda o callback com um "tx" = o próprio client
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(client)),
  }
  return client
})
vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }))

import { registrarEvento, solicitarTransicao } from './servico-eventos.service'
import { StatusFielError } from './status-fiel.motor'

const EMPRESA = 'emp-1'
const PEDIDO = 'ped-1'

function pedidoBase(over: Record<string, unknown> = {}) {
  return {
    id: PEDIDO,
    empresaId: EMPRESA,
    situacaoInterna: 'TRIAGEM',
    versao: 0,
    rodada: 1,
    tipoPedidoDerivado: 'PRODUTO_NOVO',
    tipoPedido: 'NOVO',
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.logPedidoProposta.findFirst.mockResolvedValue(null)
  prismaMock.logPedidoProposta.create.mockResolvedValue({ id: 'evt-novo' })
  prismaMock.pedidoProposta.updateMany.mockResolvedValue({ count: 1 })
})

describe('registrarEvento', () => {
  it('grava um evento sem mudar situação/rodada', async () => {
    prismaMock.pedidoProposta.findFirst.mockResolvedValue(pedidoBase())
    const r = await registrarEvento({
      empresaId: EMPRESA,
      pedidoId: PEDIDO,
      tipoEvento: 'VINCULO_OP',
      origem: 'modulo:pcp',
      idempotenciaChave: 'k1',
    })
    expect(r).toEqual({ eventoId: 'evt-novo', reaproveitado: false })
    expect(prismaMock.logPedidoProposta.create).toHaveBeenCalledOnce()
    expect(prismaMock.pedidoProposta.updateMany).not.toHaveBeenCalled()
  })

  it('tipoEvento fora do formato → EVENTO_INVALIDO', async () => {
    await expect(
      registrarEvento({ empresaId: EMPRESA, pedidoId: PEDIDO, tipoEvento: 'minusculo', origem: 'modulo:x', idempotenciaChave: 'k' }),
    ).rejects.toMatchObject({ code: 'EVENTO_INVALIDO' })
  })

  it('pedido de outra empresa → NAO_ENCONTRADO (404)', async () => {
    prismaMock.pedidoProposta.findFirst.mockResolvedValue(null)
    await expect(
      registrarEvento({ empresaId: EMPRESA, pedidoId: PEDIDO, tipoEvento: 'TESTE', origem: 'modulo:x', idempotenciaChave: 'k' }),
    ).rejects.toMatchObject({ code: 'NAO_ENCONTRADO', statusCode: 404 })
  })

  it('idempotência: mesma chave + mesmos params → reaproveita', async () => {
    const hashEsperado = (await import('node:crypto'))
      .createHash('sha256')
      .update(JSON.stringify({ op: 'REGISTRAR_EVENTO', pedidoId: PEDIDO, tipoEvento: 'VINCULO_OP' }))
      .digest('hex')
    prismaMock.logPedidoProposta.findFirst.mockResolvedValue({ id: 'evt-anterior', dados: { __hash: hashEsperado } })
    const r = await registrarEvento({
      empresaId: EMPRESA, pedidoId: PEDIDO, tipoEvento: 'VINCULO_OP', origem: 'modulo:pcp', idempotenciaChave: 'k1',
    })
    expect(r).toEqual({ eventoId: 'evt-anterior', reaproveitado: true })
    expect(prismaMock.logPedidoProposta.create).not.toHaveBeenCalled()
  })

  it('idempotência: mesma chave + params diferentes → IDEMPOTENCIA_CONFLITO', async () => {
    prismaMock.logPedidoProposta.findFirst.mockResolvedValue({ id: 'evt-anterior', dados: { __hash: 'outro' } })
    await expect(
      registrarEvento({ empresaId: EMPRESA, pedidoId: PEDIDO, tipoEvento: 'VINCULO_OP', origem: 'modulo:pcp', idempotenciaChave: 'k1' }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCIA_CONFLITO', statusCode: 409 })
  })
})

describe('solicitarTransicao', () => {
  it('avanço válido grava situação + evento na transação', async () => {
    prismaMock.pedidoProposta.findFirst.mockResolvedValue(pedidoBase({ situacaoInterna: 'TRIAGEM' }))
    const r = await solicitarTransicao({
      empresaId: EMPRESA,
      pedidoId: PEDIDO,
      destino: 'PRE_IMPRESSAO_EM_ANDAMENTO',
      origem: 'modulo:pre-impressao',
      idempotenciaChave: 't1',
    })
    expect(r.situacao).toBe('PRE_IMPRESSAO_EM_ANDAMENTO')
    expect(r.rodada).toBe(1)
    expect(prismaMock.$transaction).toHaveBeenCalledOnce()
    expect(prismaMock.pedidoProposta.updateMany).toHaveBeenCalledOnce()
    expect(prismaMock.logPedidoProposta.create).toHaveBeenCalledOnce()
  })

  it('transição inválida → ESTADO_TRANSICAO_INVALIDA sem gravar', async () => {
    prismaMock.pedidoProposta.findFirst.mockResolvedValue(pedidoBase({ situacaoInterna: 'TRIAGEM' }))
    await expect(
      solicitarTransicao({ empresaId: EMPRESA, pedidoId: PEDIDO, destino: 'APROVADO', origem: 'usuario:1', idempotenciaChave: 't2' }),
    ).rejects.toMatchObject({ code: 'ESTADO_TRANSICAO_INVALIDA' })
    expect(prismaMock.pedidoProposta.updateMany).not.toHaveBeenCalled()
  })

  it('pedido terminal → PEDIDO_TERMINAL', async () => {
    prismaMock.pedidoProposta.findFirst.mockResolvedValue(pedidoBase({ situacaoInterna: 'CANCELADO' }))
    await expect(
      solicitarTransicao({ empresaId: EMPRESA, pedidoId: PEDIDO, destino: 'TRIAGEM', origem: 'usuario:1', idempotenciaChave: 't3' }),
    ).rejects.toMatchObject({ code: 'PEDIDO_TERMINAL', statusCode: 409 })
  })

  it('devolução (RETORNO) incrementa a rodada', async () => {
    prismaMock.pedidoProposta.findFirst.mockResolvedValue(
      pedidoBase({ situacaoInterna: 'APROVACAO_ARTE_PENDENTE', rodada: 2 }),
    )
    const r = await solicitarTransicao({
      empresaId: EMPRESA,
      pedidoId: PEDIDO,
      destino: { setor: 'PRE_IMPRESSAO' },
      origem: 'usuario:9',
      motivo: 'ajustar a arte conforme cliente',
      idempotenciaChave: 't4',
      intencao: 'DEVOLVER',
    })
    expect(r.situacao).toBe('PRE_IMPRESSAO_EM_ANDAMENTO')
    expect(r.rodada).toBe(3)
  })

  it('colisão de versão (count=0) revalida e, persistindo, falha', async () => {
    prismaMock.pedidoProposta.findFirst.mockResolvedValue(pedidoBase({ situacaoInterna: 'TRIAGEM' }))
    prismaMock.pedidoProposta.updateMany.mockResolvedValue({ count: 0 })
    await expect(
      solicitarTransicao({ empresaId: EMPRESA, pedidoId: PEDIDO, destino: 'PRE_IMPRESSAO_EM_ANDAMENTO', origem: 'usuario:1', idempotenciaChave: 't5' }),
    ).rejects.toBeInstanceOf(StatusFielError)
  })

  it('pedido de outra empresa → NAO_ENCONTRADO', async () => {
    prismaMock.pedidoProposta.findFirst.mockResolvedValue(null)
    await expect(
      solicitarTransicao({ empresaId: EMPRESA, pedidoId: PEDIDO, destino: 'PRE_IMPRESSAO_EM_ANDAMENTO', origem: 'usuario:1', idempotenciaChave: 't6' }),
    ).rejects.toMatchObject({ code: 'NAO_ENCONTRADO', statusCode: 404 })
  })
})
