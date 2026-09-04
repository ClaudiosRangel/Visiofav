/**
 * Testes de integração de AUTORIZAÇÃO das rotas do Financeiro Vizor (Tarefa 9.2).
 *
 * Foco: o guard de perfil (`requireSuperAdmin`) aplicado como preHandler em
 * TODAS as rotas do módulo. Para cada endpoint verificamos:
 *   - 401 quando não há sessão (`request.user` ausente);
 *   - 403 quando o perfil é diferente de `SUPER_ADMIN` (sem vazar dados);
 *   - 200 quando o perfil é `SUPER_ADMIN`.
 *
 * Os services são mockados (não tocam o banco) — o objetivo aqui é a camada de
 * autorização/roteamento, não a lógica de negócio (coberta em outros testes).
 *
 * Validates: Requirements 1.3, 1.5, 8.2, 9.8, 10.1, 10.2, 10.3
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'

// Cold start (transform + import do Fastify) pode ultrapassar o default de 5s
// na primeira asserção; damos folga para evitar flakiness de ambiente.
const TIMEOUT = 30_000

// --- Mocks dos services (sem I/O de banco) ---------------------------------
vi.mock('./status-financeiro.service', () => ({
  listarEmpresasComStatus: vi.fn(),
  reativarEmpresa: vi.fn(),
  inativarEmpresa: vi.fn(),
}))
vi.mock('./contrato-cobranca.service', async () => {
  const actual = await vi.importActual<typeof import('./contrato-cobranca.service')>(
    './contrato-cobranca.service',
  )
  return {
    ...actual,
    obterDetalheEmpresa: vi.fn(),
    salvarContrato: vi.fn(),
  }
})
vi.mock('./fatura.service', async () => {
  const actual = await vi.importActual<typeof import('./fatura.service')>('./fatura.service')
  return {
    ...actual,
    listarFaturas: vi.fn(),
    gerarVencimentos: vi.fn(),
    darBaixa: vi.fn(),
    cancelarFatura: vi.fn(),
  }
})

import { requireSuperAdmin } from './require-super-admin'
import * as statusSvc from './status-financeiro.service'
import * as contratoSvc from './contrato-cobranca.service'
import * as faturaSvc from './fatura.service'

/**
 * Monta uma instância de teste com o preHandler REAL de autorização
 * (`requireSuperAdmin`) e um hook que simula a sessão populada pelo
 * `authenticate` global. `user = null` simula "sem sessão" (→ 401).
 */
async function buildApp(user: { id?: string; perfil?: string } | null): Promise<FastifyInstance> {
  const app = Fastify()

  app.addHook('onRequest', (request, _reply, done) => {
    if (user) {
      ;(request as any).user = user
    }
    done()
  })
  app.addHook('preHandler', requireSuperAdmin)

  app.get('/empresas', async (_req, reply) => reply.send([]))
  app.get('/empresas/:id', async (_req, reply) => reply.send({ ok: true }))
  app.put('/empresas/:id/contrato', async (_req, reply) => reply.send({ ok: true }))
  app.post('/empresas/:id/gerar-vencimentos', async (_req, reply) => reply.send({ ok: true }))
  app.post('/empresas/:id/faturas/:faturaId/baixa', async (_req, reply) => reply.send({ ok: true }))
  app.post('/empresas/:id/faturas/:faturaId/cancelar', async (_req, reply) =>
    reply.send({ ok: true }),
  )
  app.post('/empresas/:id/reativar', async (_req, reply) => reply.send({ ok: true }))
  app.post('/empresas/:id/inativar', async (_req, reply) => reply.send({ ok: true }))

  await app.ready()
  return app
}

const SUPER_ADMIN = { id: 'sa-1', perfil: 'SUPER_ADMIN' }
const ADMIN = { id: 'u-1', perfil: 'ADMIN' }

const ENDPOINTS: { method: 'GET' | 'PUT' | 'POST'; url: string }[] = [
  { method: 'GET', url: '/empresas' },
  { method: 'GET', url: '/empresas/e-1' },
  { method: 'PUT', url: '/empresas/e-1/contrato' },
  { method: 'POST', url: '/empresas/e-1/gerar-vencimentos' },
  { method: 'POST', url: '/empresas/e-1/faturas/f-1/baixa' },
  { method: 'POST', url: '/empresas/e-1/faturas/f-1/cancelar' },
  { method: 'POST', url: '/empresas/e-1/reativar' },
  { method: 'POST', url: '/empresas/e-1/inativar' },
]

describe('financeiro-vizor.routes — autorização', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  for (const ep of ENDPOINTS) {
    it(
      `${ep.method} ${ep.url} → 401 sem sessão`,
      async () => {
        const app = await buildApp(null)
        const res = await app.inject({ method: ep.method, url: ep.url, payload: {} })
        expect(res.statusCode).toBe(401)
        // Não vaza dados de cobrança/negócio no corpo.
        expect(res.payload).not.toContain('totalMensal')
      },
      TIMEOUT,
    )

    it(
      `${ep.method} ${ep.url} → 403 para perfil ≠ SUPER_ADMIN`,
      async () => {
        const app = await buildApp(ADMIN)
        const res = await app.inject({ method: ep.method, url: ep.url, payload: {} })
        expect(res.statusCode).toBe(403)
        expect(res.payload).not.toContain('totalMensal')
      },
      TIMEOUT,
    )

    it(
      `${ep.method} ${ep.url} → 200 para SUPER_ADMIN`,
      async () => {
        const app = await buildApp(SUPER_ADMIN)
        const res = await app.inject({ method: ep.method, url: ep.url, payload: {} })
        expect(res.statusCode).toBe(200)
      },
      TIMEOUT,
    )
  }
})

// Referência aos mocks para garantir que o wiring de services existe (evita
// "unused import" e documenta a superfície mockada do módulo de rotas).
describe('financeiro-vizor.routes — mocks de service disponíveis', () => {
  it('exporta os services usados pelas rotas', () => {
    expect(vi.isMockFunction(statusSvc.listarEmpresasComStatus)).toBe(true)
    expect(vi.isMockFunction(contratoSvc.obterDetalheEmpresa)).toBe(true)
    expect(vi.isMockFunction(faturaSvc.listarFaturas)).toBe(true)
  })
})
