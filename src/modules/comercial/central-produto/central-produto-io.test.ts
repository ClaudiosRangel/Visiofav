// Testes dos services de I/O (busca, detalhe, edição) com prisma MOCKADO.
// Cobre Properties 12 e 13 (não-vazamento multi-tenant) e casos de integração
// (403 por permissão é testado na rota; aqui: edição transacional, 404
// cross-empresa, select de OP sem pdfData).
// Rodar: npx vitest run <arquivo> --reporter=dot

import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

// ── Mock do prisma ──
const prismaMock = vi.hoisted(() => ({
  deParaImportacao: { findMany: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
  produto: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  calculoGrafico: { findMany: vi.fn(), findFirst: vi.fn() },
  ordemProducao: { findMany: vi.fn() },
  cliente: { findFirst: vi.fn() },
  atributoGrafico: { findFirst: vi.fn(), upsert: vi.fn() },
  itemOrcamentoGrafico: { findMany: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }))

// Mock mínimo do Prisma namespace para a classe de erro P2002.
vi.mock('@prisma/client', () => ({
  Prisma: {
    PrismaClientKnownRequestError: class extends Error {
      code: string
      constructor(message: string, opts: { code: string }) {
        super(message)
        this.code = opts.code
      }
    },
  },
}))

import { buscarCentralProduto } from './central-produto-busca.service'
import { aplicarEdicao } from './central-produto-edicao.service'
import { CentralProdutoError } from './central-produto.errors'

beforeEach(() => {
  vi.clearAllMocks()
  // defaults vazios
  prismaMock.deParaImportacao.findMany.mockResolvedValue([])
  prismaMock.produto.findMany.mockResolvedValue([])
  prismaMock.calculoGrafico.findMany.mockResolvedValue([])
  prismaMock.ordemProducao.findMany.mockResolvedValue([])
})

const EMPRESA_A = 'empresa-A'

// ─────────────────────────────────────────────────────────────────────────────
// Property 12: Não-vazamento multi-tenant na leitura
// ─────────────────────────────────────────────────────────────────────────────
describe('Property 12 — não-vazamento multi-tenant na leitura', () => {
  // Feature: comercial-central-produto-acabado, Property 12: toda query da busca recebe o empresaId da sessão (A), mesmo com dados de B e termos iguais; resultado só de A.
  it('todas as 4 queries recebem empresaId da sessão (A)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // termo válido: >= 2 caracteres não-espaço após trim (Req 1.5)
        fc
          .string({ minLength: 2, maxLength: 10 })
          .filter((s) => s.trim().length >= 2),
        async (termo) => {
          vi.clearAllMocks()
          prismaMock.deParaImportacao.findMany.mockResolvedValue([])
          prismaMock.produto.findMany.mockResolvedValue([])
          prismaMock.calculoGrafico.findMany.mockResolvedValue([])
          prismaMock.ordemProducao.findMany.mockResolvedValue([])

          await buscarCentralProduto({ empresaId: EMPRESA_A, termo })

          // Cada query precisa ter sido chamada com where.empresaId === A.
          for (const fn of [
            prismaMock.deParaImportacao.findMany,
            prismaMock.produto.findMany,
            prismaMock.calculoGrafico.findMany,
            prismaMock.ordemProducao.findMany,
          ]) {
            expect(fn).toHaveBeenCalled()
            const arg = fn.mock.calls[0][0]
            expect(arg.where.empresaId).toBe(EMPRESA_A)
          }
        },
      ),
      { numRuns: 100 },
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Property 13: Não-vazamento multi-tenant na escrita
// ─────────────────────────────────────────────────────────────────────────────
describe('Property 13 — não-vazamento multi-tenant na escrita', () => {
  // Feature: comercial-central-produto-acabado, Property 13: editar produto de outra empresa é rejeitado (404) e nenhuma gravação ocorre.
  it('produto de outra empresa ⇒ 404 e nenhuma gravação', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (produtoId) => {
        vi.clearAllMocks()
        // findFirst por { id, empresa: A } não encontra → produto é de outra empresa
        prismaMock.produto.findFirst.mockResolvedValue(null)

        await expect(
          aplicarEdicao({ empresaId: EMPRESA_A, produtoId, descricao: 'x' }),
        ).rejects.toMatchObject({ statusCode: 404 })

        // a resolução usou o empresaId da sessão
        expect(prismaMock.produto.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ id: produtoId, empresaId: EMPRESA_A }),
          }),
        )
        // nenhuma transação de escrita foi iniciada
        expect(prismaMock.$transaction).not.toHaveBeenCalled()
        expect(prismaMock.produto.update).not.toHaveBeenCalled()
      }),
      { numRuns: 100 },
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Integração (exemplos) — edição transacional, select de OP sem pdfData
// ─────────────────────────────────────────────────────────────────────────────
describe('edição — transação e rollback', () => {
  it('aplica alterações numa única $transaction e recarrega o detalhe', async () => {
    prismaMock.produto.findFirst.mockResolvedValue({ id: 'p1' })
    prismaMock.deParaImportacao.findMany.mockResolvedValue([])
    // a transação executa o callback com um tx mockado
    const tx = {
      produto: { update: vi.fn().mockResolvedValue({}) },
      atributoGrafico: { upsert: vi.fn().mockResolvedValue({}) },
      deParaImportacao: { deleteMany: vi.fn(), create: vi.fn() },
    }
    prismaMock.$transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx))

    // obterDetalhe recarrega: produto encontrado + listas vazias
    prismaMock.produto.findFirst.mockResolvedValue({
      id: 'p1',
      codigo: 'C1',
      nome: 'Produto 1',
      descricao: 'Nova desc',
      imagemUrl: null,
      clienteId: null,
    })
    prismaMock.atributoGrafico.findFirst.mockResolvedValue(null)
    prismaMock.calculoGrafico.findMany.mockResolvedValue([])
    prismaMock.itemOrcamentoGrafico.findMany.mockResolvedValue([])
    prismaMock.ordemProducao.findMany.mockResolvedValue([])

    const r = await aplicarEdicao({
      empresaId: EMPRESA_A,
      produtoId: 'p1',
      descricao: 'Nova desc',
    })

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(tx.produto.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' }, data: { descricao: 'Nova desc' } }),
    )
    expect(r.identificacao.produtoId).toBe('p1')
  })

  it('rejeita descrição fora do limite ANTES de abrir transação', async () => {
    prismaMock.produto.findFirst.mockResolvedValue({ id: 'p1' })
    prismaMock.deParaImportacao.findMany.mockResolvedValue([])

    await expect(
      aplicarEdicao({ empresaId: EMPRESA_A, produtoId: 'p1', descricao: 'x'.repeat(201) }),
    ).rejects.toBeInstanceOf(CentralProdutoError)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
})

describe('busca — select de OrdemProducao sem pdfData', () => {
  it('a query de OP não seleciona pdfData', async () => {
    await buscarCentralProduto({ empresaId: EMPRESA_A, termo: 'abc' })
    const arg = prismaMock.ordemProducao.findMany.mock.calls[0][0]
    expect(arg.select).toBeDefined()
    expect('pdfData' in arg.select).toBe(false)
    // só os campos previstos
    expect(arg.select).toEqual({ id: true, numero: true, observacoes: true })
  })
})
