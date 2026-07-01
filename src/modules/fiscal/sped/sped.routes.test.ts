/**
 * Tests for SPED routes
 * Validates: Requirements 14.1, 15.1, 16.1, 17.1, 18.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { spedRoutes } from './sped.routes'

const EMPRESA_ID = '00000000-0000-4000-a000-000000000001'

// Mock Prisma
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    empresa: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: '00000000-0000-4000-a000-000000000001',
        razaoSocial: 'Empresa Teste LTDA',
        nomeFantasia: 'Empresa Teste',
        cnpj: '12345678000190',
        uf: 'SP',
        inscEstadual: '123456789',
        regimeTributario: 3,
        cep: '01001000',
        logradouro: 'Rua Teste',
        numero: '100',
        complemento: '',
        bairro: 'Centro',
        telefone: '11999999999',
        email: 'teste@empresa.com',
      }),
    },
    documentoFiscal: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
    apuracaoFiscal: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}))

// Helper to build a Fastify app with SPED routes + mock auth
async function buildApp() {
  const app = Fastify()

  // Mock authenticate decorator
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (request) => {
    ;(request as any).user = { id: 'user-1', empresaId: EMPRESA_ID }
  })

  app.register(spedRoutes, { prefix: '/fiscal/sped' })
  await app.ready()
  return app
}

describe('SPED Routes', () => {
  let app: ReturnType<typeof Fastify>

  beforeEach(async () => {
    app = await buildApp()
  })

  describe('POST /fiscal/sped/fiscal', () => {
    it('deve gerar EFD ICMS/IPI com sucesso e retornar metadados', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/fiscal/sped/fiscal',
        payload: {
          empresaId: EMPRESA_ID,
          mes: 3,
          ano: 2024,
        },
      })

      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.id).toBeDefined()
      expect(body.tipo).toBe('EFD_ICMS_IPI')
      expect(body.nomeArquivo).toBe('EFD_ICMS_IPI_202403.txt')
      expect(body.totalRegistros).toBeGreaterThan(0)
      expect(body.blocos).toBeDefined()
      expect(body.valido).toBe(true)
      expect(body.geradoEm).toBeDefined()
    })

    it('deve rejeitar body sem empresaId', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/fiscal/sped/fiscal',
        payload: {
          mes: 3,
          ano: 2024,
        },
      })

      expect(response.statusCode).toBe(400)
      const body = JSON.parse(response.body)
      expect(body.message).toBe('Dados inválidos')
    })

    it('deve rejeitar mês fora do intervalo', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/fiscal/sped/fiscal',
        payload: {
          empresaId: EMPRESA_ID,
          mes: 13,
          ano: 2024,
        },
      })

      expect(response.statusCode).toBe(400)
    })

    it('deve rejeitar ano fora do intervalo', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/fiscal/sped/fiscal',
        payload: {
          empresaId: EMPRESA_ID,
          mes: 6,
          ano: 1999,
        },
      })

      expect(response.statusCode).toBe(400)
    })

    it('deve aceitar versaoLayout e finalidade opcionais', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/fiscal/sped/fiscal',
        payload: {
          empresaId: EMPRESA_ID,
          mes: 6,
          ano: 2024,
          versaoLayout: '018',
          finalidade: 'RETIFICADORA',
        },
      })

      expect(response.statusCode).toBe(201)
    })
  })

  describe('POST /fiscal/sped/contribuicoes', () => {
    it('deve gerar EFD Contribuições com sucesso', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/fiscal/sped/contribuicoes',
        payload: {
          empresaId: EMPRESA_ID,
          mes: 5,
          ano: 2024,
        },
      })

      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.tipo).toBe('EFD_CONTRIBUICOES')
      expect(body.nomeArquivo).toBe('EFD_CONTRIBUICOES_202405.txt')
      expect(body.totalRegistros).toBeGreaterThan(0)
      expect(body.valido).toBe(true)
    })

    it('deve rejeitar empresaId inválido (não UUID)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/fiscal/sped/contribuicoes',
        payload: {
          empresaId: 'nao-uuid',
          mes: 5,
          ano: 2024,
        },
      })

      expect(response.statusCode).toBe(400)
    })
  })

  describe('POST /fiscal/sped/ecd', () => {
    it('deve gerar ECD com sucesso', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/fiscal/sped/ecd',
        payload: {
          empresaId: EMPRESA_ID,
          mes: 12,
          ano: 2024,
        },
      })

      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.tipo).toBe('ECD')
      expect(body.nomeArquivo).toBe('ECD_202412.txt')
      expect(body.valido).toBe(true)
    })
  })

  describe('POST /fiscal/sped/ecf', () => {
    it('deve gerar ECF com sucesso', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/fiscal/sped/ecf',
        payload: {
          empresaId: EMPRESA_ID,
          mes: 1,
          ano: 2024,
        },
      })

      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.tipo).toBe('ECF')
      expect(body.nomeArquivo).toBe('ECF_2024.txt')
      expect(body.valido).toBe(true)
    })
  })

  describe('POST /fiscal/sped/reinf/transmitir', () => {
    it('deve gerar EFD-Reinf com sucesso quando módulo está implementado', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/fiscal/sped/reinf/transmitir',
        payload: {
          empresaId: EMPRESA_ID,
          mes: 3,
          ano: 2024,
        },
      })

      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.id).toBeDefined()
      expect(body.tipo).toBe('REINF')
      expect(body.valido).toBe(true)
      expect(body.geradoEm).toBeDefined()
    })

    it('deve rejeitar body inválido', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/fiscal/sped/reinf/transmitir',
        payload: {
          mes: 3,
          // missing empresaId and ano
        },
      })

      expect(response.statusCode).toBe(400)
    })
  })

  describe('GET /fiscal/sped/:id/download', () => {
    it('deve retornar 404 para arquivo inexistente', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/fiscal/sped/id-inexistente/download',
      })

      expect(response.statusCode).toBe(404)
      const body = JSON.parse(response.body)
      expect(body.message).toBe('Arquivo SPED não encontrado')
    })

    it('deve fazer download de arquivo gerado previamente', async () => {
      // First, generate a file
      const genResponse = await app.inject({
        method: 'POST',
        url: '/fiscal/sped/fiscal',
        payload: {
          empresaId: EMPRESA_ID,
          mes: 7,
          ano: 2024,
        },
      })

      expect(genResponse.statusCode).toBe(201)
      const { id } = JSON.parse(genResponse.body)

      // Then download it
      const dlResponse = await app.inject({
        method: 'GET',
        url: `/fiscal/sped/${id}/download`,
      })

      expect(dlResponse.statusCode).toBe(200)
      expect(dlResponse.headers['content-type']).toBe('application/octet-stream')
      expect(dlResponse.headers['content-disposition']).toContain('EFD_ICMS_IPI_202407.txt')
      expect(dlResponse.body.length).toBeGreaterThan(0)
    })
  })

  describe('Validação de schema compartilhada', () => {
    it('deve rejeitar finalidade inválida', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/fiscal/sped/fiscal',
        payload: {
          empresaId: EMPRESA_ID,
          mes: 3,
          ano: 2024,
          finalidade: 'INVALIDA',
        },
      })

      expect(response.statusCode).toBe(400)
    })

    it('deve rejeitar mês 0', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/fiscal/sped/fiscal',
        payload: {
          empresaId: EMPRESA_ID,
          mes: 0,
          ano: 2024,
        },
      })

      expect(response.statusCode).toBe(400)
    })
  })
})
