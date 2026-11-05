/**
 * Testes de integração do Board da Pré-Impressão (mock de Prisma).
 * Rodar: npx vitest run src/modules/orcamento-grafico/pedido-proposta/pre-impressao.service.test.ts --reporter=dot
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  pedidoProposta: { findFirst: vi.fn() },
  etapaPreImpressao: {
    findMany: vi.fn(), findFirst: vi.fn(), findFirstOrThrow: vi.fn(),
    createMany: vi.fn(), update: vi.fn(),
  },
}))
vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }))
const eventosMock = vi.hoisted(() => ({ registrarEvento: vi.fn(), solicitarTransicao: vi.fn() }))
vi.mock('./servico-eventos.service', () => eventosMock)

import { garantirBoard, mudarStatusEtapa } from './pre-impressao.service'

const EMPRESA = 'emp-1'
const PEDIDO = 'ped-1'

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.pedidoProposta.findFirst.mockResolvedValue({ id: PEDIDO, tipoPedidoDerivado: 'PRODUTO_NOVO', tipoPedido: 'NOVO' })
  prismaMock.etapaPreImpressao.findMany.mockResolvedValue([])
  prismaMock.etapaPreImpressao.createMany.mockResolvedValue({ count: 4 })
  prismaMock.etapaPreImpressao.update.mockResolvedValue({})
  eventosMock.registrarEvento.mockResolvedValue({ eventoId: 'ev', reaproveitado: false })
})

describe('garantirBoard', () => {
  it('cria as 4 etapas quando não existem (idempotente)', async () => {
    const r = await garantirBoard(EMPRESA, PEDIDO)
    expect(r.criadas).toBe(4)
    expect(prismaMock.etapaPreImpressao.createMany).toHaveBeenCalledOnce()
    const arg = prismaMock.etapaPreImpressao.createMany.mock.calls[0][0]
    expect(arg.data).toHaveLength(4)
    expect(arg.data.every((d) => d.empresaId === EMPRESA)).toBe(true)
  })

  it('não cria nada quando já existem as 4 etapas', async () => {
    prismaMock.etapaPreImpressao.findMany.mockResolvedValue([
      { etapa: 'MOCKUP' }, { etapa: 'ARTE' }, { etapa: 'PADRAO' }, { etapa: 'FICHA_TECNICA' },
    ])
    const r = await garantirBoard(EMPRESA, PEDIDO)
    expect(r.criadas).toBe(0)
    expect(prismaMock.etapaPreImpressao.createMany).not.toHaveBeenCalled()
  })

  it('pedido de outra empresa → 404', async () => {
    prismaMock.pedidoProposta.findFirst.mockResolvedValue(null)
    await expect(garantirBoard(EMPRESA, PEDIDO)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('mudarStatusEtapa', () => {
  it('conclui ARTE (PRODUTO_NOVO ⇒ caminho COMPLETA, board não concluído ainda)', async () => {
    prismaMock.etapaPreImpressao.findFirst.mockResolvedValue({ id: 'e-arte', status: 'EM_ANDAMENTO', dataInicio: new Date() })
    // obterBoard (chamado ao final): garante board (findMany p/ garantir) + findMany das etapas
    prismaMock.etapaPreImpressao.findMany
      .mockResolvedValueOnce([{ etapa: 'MOCKUP' }, { etapa: 'ARTE' }, { etapa: 'PADRAO' }, { etapa: 'FICHA_TECNICA' }]) // garantir dentro de obterBoard
      .mockResolvedValueOnce([
        { etapa: 'MOCKUP', status: 'PENDENTE', ordem: 0, observacao: null, dataInicio: null, dataConclusao: null },
        { etapa: 'ARTE', status: 'CONCLUIDA', ordem: 1, observacao: null, dataInicio: null, dataConclusao: null },
        { etapa: 'PADRAO', status: 'PENDENTE', ordem: 2, observacao: null, dataInicio: null, dataConclusao: null },
        { etapa: 'FICHA_TECNICA', status: 'PENDENTE', ordem: 3, observacao: null, dataInicio: null, dataConclusao: null },
      ])
    const r = await mudarStatusEtapa(EMPRESA, PEDIDO, 'ARTE', 'CONCLUIDA', 'u1', 'ok')
    expect(r.etapa).toBe('ARTE')
    expect(r.status).toBe('CONCLUIDA')
    expect(r.boardConcluido).toBe(false)
    expect(prismaMock.etapaPreImpressao.update).toHaveBeenCalledOnce()
    expect(eventosMock.registrarEvento).toHaveBeenCalled()
  })

  it('status inválido → 400', async () => {
    await expect(mudarStatusEtapa(EMPRESA, PEDIDO, 'ARTE', 'FOO', 'u1')).rejects.toMatchObject({ code: 'STATUS_ETAPA_INVALIDO' })
  })

  it('etapa inválida → 400', async () => {
    await expect(mudarStatusEtapa(EMPRESA, PEDIDO, 'XPTO', 'CONCLUIDA', 'u1')).rejects.toMatchObject({ code: 'ETAPA_INVALIDA' })
  })
})
