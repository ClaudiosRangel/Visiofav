/**
 * Testes de integração do service de aprovação de arte (mock de Prisma).
 * Rodar: npx vitest run src/modules/orcamento-grafico/pedido-proposta/aprovacao-arte.service.test.ts --reporter=dot
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  pedidoProposta: { findFirst: vi.fn(), update: vi.fn() },
  linkAprovacaoArte: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  anexoPedidoProposta: { findFirst: vi.fn() },
}))
vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }))

// Servico_Eventos mockado (best-effort — não deve quebrar os testes).
const eventosMock = vi.hoisted(() => ({ registrarEvento: vi.fn(), solicitarTransicao: vi.fn() }))
vi.mock('./servico-eventos.service', () => eventosMock)

import { gerarLink, decidir } from './aprovacao-arte.service'
import { AprovacaoArteError } from './aprovacao-arte.motor'

const EMPRESA = 'emp-1'
const PEDIDO = 'ped-1'

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.pedidoProposta.findFirst.mockResolvedValue({ id: PEDIDO, situacaoInterna: 'APROVACAO_ARTE_PENDENTE' })
  prismaMock.pedidoProposta.update.mockResolvedValue({})
  prismaMock.linkAprovacaoArte.findFirst.mockResolvedValue(null)
  prismaMock.linkAprovacaoArte.create.mockResolvedValue({})
  prismaMock.linkAprovacaoArte.update.mockResolvedValue({})
  prismaMock.linkAprovacaoArte.updateMany.mockResolvedValue({ count: 0 })
  eventosMock.registrarEvento.mockResolvedValue({ eventoId: 'ev', reaproveitado: false })
  eventosMock.solicitarTransicao.mockResolvedValue({ situacao: 'PRE_IMPRESSAO_EM_ANDAMENTO', rodada: 2, eventoId: 'ev', reaproveitado: false })
})

describe('gerarLink', () => {
  it('pedido de outra empresa → 404', async () => {
    prismaMock.pedidoProposta.findFirst.mockResolvedValue(null)
    await expect(gerarLink(EMPRESA, PEDIDO, 'u1')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('cria link novo com token e url', async () => {
    const r = await gerarLink(EMPRESA, PEDIDO, 'u1')
    expect(r.token).toBeTruthy()
    expect(r.url).toContain('/aprovar-arte/')
    expect(r.reaproveitado).toBe(false)
    expect(prismaMock.linkAprovacaoArte.create).toHaveBeenCalledOnce()
  })

  it('reusa PENDENTE não expirado', async () => {
    const futuro = new Date(Date.now() + 86400000)
    prismaMock.linkAprovacaoArte.findFirst.mockResolvedValue({ token: 'tok-existente', expiraEm: futuro })
    const r = await gerarLink(EMPRESA, PEDIDO, 'u1')
    expect(r.reaproveitado).toBe(true)
    expect(r.token).toBe('tok-existente')
    expect(prismaMock.linkAprovacaoArte.create).not.toHaveBeenCalled()
  })

  it('novo=true cancela pendentes e cria novo', async () => {
    const r = await gerarLink(EMPRESA, PEDIDO, 'u1', true)
    expect(prismaMock.linkAprovacaoArte.updateMany).toHaveBeenCalledOnce()
    expect(prismaMock.linkAprovacaoArte.create).toHaveBeenCalledOnce()
    expect(r.reaproveitado).toBe(false)
  })
})

describe('decidir', () => {
  const futuro = new Date(Date.now() + 86400000)

  it('aprovar grava decisão e registra evento de aprovação', async () => {
    prismaMock.linkAprovacaoArte.findUnique.mockResolvedValue({
      id: 'l1', empresaId: EMPRESA, pedidoPropostaId: PEDIDO, status: 'PENDENTE', expiraEm: futuro, decididoEm: null, motivoAjuste: null,
    })
    const r = await decidir('tok', 'APROVADA', 'Fulano', undefined, '1.2.3.4')
    expect(r.estado).toBe('APROVADA')
    expect(prismaMock.linkAprovacaoArte.update).toHaveBeenCalledOnce()
    expect(eventosMock.registrarEvento).toHaveBeenCalled()
  })

  it('pedir ajuste sem motivo → 400', async () => {
    prismaMock.linkAprovacaoArte.findUnique.mockResolvedValue({
      id: 'l1', empresaId: EMPRESA, pedidoPropostaId: PEDIDO, status: 'PENDENTE', expiraEm: futuro, decididoEm: null, motivoAjuste: null,
    })
    await expect(decidir('tok', 'AJUSTE_SOLICITADO', 'Fulano')).rejects.toMatchObject({ code: 'MOTIVO_OBRIGATORIO' })
    expect(prismaMock.linkAprovacaoArte.update).not.toHaveBeenCalled()
  })

  it('pedir ajuste com motivo devolve para pré-impressão', async () => {
    prismaMock.linkAprovacaoArte.findUnique.mockResolvedValue({
      id: 'l1', empresaId: EMPRESA, pedidoPropostaId: PEDIDO, status: 'PENDENTE', expiraEm: futuro, decididoEm: null, motivoAjuste: null,
    })
    const r = await decidir('tok', 'AJUSTE_SOLICITADO', 'Fulano', 'trocar a cor')
    expect(r.estado).toBe('AJUSTE_SOLICITADO')
    expect(eventosMock.solicitarTransicao).toHaveBeenCalled()
  })

  it('idempotência: link já APROVADA + reenvio APROVADA → estado atual, sem novo update', async () => {
    prismaMock.linkAprovacaoArte.findUnique.mockResolvedValue({
      id: 'l1', empresaId: EMPRESA, pedidoPropostaId: PEDIDO, status: 'APROVADA', expiraEm: futuro, decididoEm: new Date(), motivoAjuste: null,
    })
    const r = await decidir('tok', 'APROVADA', 'Fulano')
    expect(r.estado).toBe('APROVADA')
    expect(r.pedidoAtualizado).toBe(false)
    expect(prismaMock.linkAprovacaoArte.update).not.toHaveBeenCalled()
  })

  it('link expirado → 410', async () => {
    const passado = new Date(Date.now() - 86400000)
    prismaMock.linkAprovacaoArte.findUnique.mockResolvedValue({
      id: 'l1', empresaId: EMPRESA, pedidoPropostaId: PEDIDO, status: 'PENDENTE', expiraEm: passado, decididoEm: null, motivoAjuste: null,
    })
    await expect(decidir('tok', 'APROVADA', 'Fulano')).rejects.toMatchObject({ code: 'LINK_EXPIRADO', statusCode: 410 })
  })

  it('token inexistente → 404', async () => {
    prismaMock.linkAprovacaoArte.findUnique.mockResolvedValue(null)
    await expect(decidir('tok', 'APROVADA', 'Fulano')).rejects.toMatchObject({ statusCode: 404 })
  })
})
