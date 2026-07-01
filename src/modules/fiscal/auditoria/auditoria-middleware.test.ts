import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import { registrarAuditoriaFiscalHook } from './auditoria-middleware'

// Mock do serviço de auditoria
vi.mock('./auditoria-fiscal.service', () => ({
  auditoriaFiscalService: {
    registrar: vi.fn().mockResolvedValue({ id: 'mock-id' }),
  },
  OperacaoAuditoria: {
    EMISSAO: 'EMISSAO',
    CANCELAMENTO: 'CANCELAMENTO',
    INUTILIZACAO: 'INUTILIZACAO',
    ALTERACAO_REGRA: 'ALTERACAO_REGRA',
    IMPORTACAO_XML: 'IMPORTACAO_XML',
    CARTA_CORRECAO: 'CARTA_CORRECAO',
  },
  EntidadeAuditoria: {
    DOCUMENTO_FISCAL: 'DocumentoFiscal',
    REGRA_TRIBUTARIA: 'RegraTributaria',
    XML_IMPORTADO: 'XmlImportado',
    CERTIFICADO: 'Certificado',
  },
}))

import { auditoriaFiscalService } from './auditoria-fiscal.service'

describe('Auditoria Fiscal Middleware', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify()

    // Simular request.user
    app.decorateRequest('user', null)

    // Registrar o hook de auditoria
    registrarAuditoriaFiscalHook(app)

    // Rota de teste POST (emissão)
    app.post('/fiscal/nfe/emitir', async (request, reply) => {
      ;(request as any).user = { id: 'user-1', empresaId: 'empresa-1' }
      return { status: 'ok' }
    })

    // Rota de teste GET (não deve auditar)
    app.get('/fiscal/nfe', async (request, reply) => {
      ;(request as any).user = { id: 'user-1', empresaId: 'empresa-1' }
      return { status: 'ok' }
    })

    // Rota de teste PUT (alteração de regra)
    app.put('/fiscal/motor-tributario/regras/:id', async (request, reply) => {
      ;(request as any).user = { id: 'user-2', empresaId: 'empresa-1' }
      return { status: 'ok' }
    })

    // Rota de teste DELETE (cancelamento)
    app.delete('/fiscal/nfe/:id', async (request, reply) => {
      ;(request as any).user = { id: 'user-1', empresaId: 'empresa-1' }
      return { status: 'ok' }
    })

    // Rota que retorna erro 400 (não deve auditar)
    app.post('/fiscal/nfe/erro', async (request, reply) => {
      ;(request as any).user = { id: 'user-1', empresaId: 'empresa-1' }
      return reply.status(400).send({ error: 'bad request' })
    })

    // Rota sem user/empresa (não deve auditar)
    app.post('/fiscal/nfe/sem-empresa', async (request, reply) => {
      ;(request as any).user = { id: 'user-1' }
      return { status: 'ok' }
    })

    await app.ready()
  })

  it('deve registrar auditoria para POST (emissão)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/fiscal/nfe/emitir',
      payload: {},
    })

    expect(response.statusCode).toBe(200)

    // Aguardar o fire-and-forget resolver
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(auditoriaFiscalService.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        empresaId: 'empresa-1',
        usuarioId: 'user-1',
        operacao: 'EMISSAO',
        ip: expect.any(String),
      })
    )
  })

  it('NÃO deve registrar auditoria para GET (leitura)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/fiscal/nfe',
    })

    expect(response.statusCode).toBe(200)

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(auditoriaFiscalService.registrar).not.toHaveBeenCalled()
  })

  it('deve registrar ALTERACAO_REGRA para PUT em motor-tributario', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/fiscal/motor-tributario/regras/regra-123',
      payload: {},
    })

    expect(response.statusCode).toBe(200)

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(auditoriaFiscalService.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        empresaId: 'empresa-1',
        usuarioId: 'user-2',
        operacao: 'ALTERACAO_REGRA',
        entidade: 'RegraTributaria',
      })
    )
  })

  it('deve registrar CANCELAMENTO para DELETE', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/fiscal/nfe/doc-456',
    })

    expect(response.statusCode).toBe(200)

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(auditoriaFiscalService.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        operacao: 'CANCELAMENTO',
        entidade: 'DocumentoFiscal',
      })
    )
  })

  it('NÃO deve registrar auditoria para respostas de erro (4xx)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/fiscal/nfe/erro',
      payload: {},
    })

    expect(response.statusCode).toBe(400)

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(auditoriaFiscalService.registrar).not.toHaveBeenCalled()
  })

  it('NÃO deve registrar auditoria quando não há empresaId', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/fiscal/nfe/sem-empresa',
      payload: {},
    })

    expect(response.statusCode).toBe(200)

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(auditoriaFiscalService.registrar).not.toHaveBeenCalled()
  })

  it('deve extrair IP do header x-forwarded-for quando presente', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/fiscal/nfe/emitir',
      payload: {},
      headers: {
        'x-forwarded-for': '192.168.1.100, 10.0.0.1',
      },
    })

    expect(response.statusCode).toBe(200)

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(auditoriaFiscalService.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        ip: '192.168.1.100',
      })
    )
  })
})
