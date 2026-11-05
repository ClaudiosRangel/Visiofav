// Testes de I/O da Central do Produto v2 (prisma MOCKADO).
// Cobre: isolamento empresaId, upsert ficha, transição de arte + OBSOLETA,
// exclusão bloqueada por movimentação, totalizadores sem notas ⇒ zeros.
// Rodar: npx vitest run <arquivo> --reporter=dot

import { describe, it, expect, vi, beforeEach } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  produto: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn(), delete: vi.fn() },
  cliente: { findFirst: vi.fn() },
  modeloFaca: { findFirst: vi.fn() },
  fichaGraficaProduto: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  arteRevisaoProduto: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  dimensaoProduto: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
  estruturaProduto: { findFirst: vi.fn() },
  ordemProducao: { findMany: vi.fn(), count: vi.fn() },
  itemPedidoVenda: { count: vi.fn() },
  itemPedidoCompra: { count: vi.fn() },
  itemOrcamento: { count: vi.fn() },
  saldoEndereco: { count: vi.fn() },
  estoque: { count: vi.fn() },
  itemDocumentoFiscal: { count: vi.fn(), findMany: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@prisma/client', () => ({ Prisma: {} }))

import {
  obterFichaMaster,
  salvarFicha,
  transicionarRevisao,
  excluirProduto,
  totalizadoresVenda,
} from './central-produto-v2.service'
import { CentralProdutoError } from './central-produto.errors'

const EMPRESA_A = 'empresa-A'

function zerarContadores() {
  prismaMock.itemPedidoVenda.count.mockResolvedValue(0)
  prismaMock.itemPedidoCompra.count.mockResolvedValue(0)
  prismaMock.ordemProducao.count.mockResolvedValue(0)
  prismaMock.itemOrcamento.count.mockResolvedValue(0)
  prismaMock.saldoEndereco.count.mockResolvedValue(0)
  prismaMock.estoque.count.mockResolvedValue(0)
  prismaMock.itemDocumentoFiscal.count.mockResolvedValue(0)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('obterFichaMaster — isolamento e consolidação', () => {
  it('produto de outra empresa ⇒ 404', async () => {
    prismaMock.produto.findFirst.mockResolvedValue(null)
    await expect(obterFichaMaster(EMPRESA_A, 'p1')).rejects.toMatchObject({ statusCode: 404 })
    expect(prismaMock.produto.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'p1', empresaId: EMPRESA_A }) }),
    )
  })

  it('consolida matriz derivada das OPs (tag [Matriz]) e marca podeExcluir', async () => {
    prismaMock.produto.findFirst.mockResolvedValue({
      id: 'p1', codigo: 'C1', nome: 'N', descricao: 'd', status: true, clienteId: null,
    })
    prismaMock.fichaGraficaProduto.findFirst.mockResolvedValue(null)
    prismaMock.ordemProducao.findMany.mockResolvedValue([
      { observacoes: 'xx\n[Matriz] 2529B - COM BRAILLE\n[Cores] 5x0' },
    ])
    prismaMock.arteRevisaoProduto.findMany.mockResolvedValue([])
    prismaMock.dimensaoProduto.findMany.mockResolvedValue([])
    prismaMock.estruturaProduto.findFirst.mockResolvedValue(null)
    zerarContadores()

    const r = await obterFichaMaster(EMPRESA_A, 'p1')
    expect(r.matrizDerivada).toBe('2529B - COM BRAILLE')
    expect(r.matrizExibida).toBe('2529B - COM BRAILLE')
    expect(r.podeExcluir).toBe(true)
    // a query de OP não traz pdfData
    const argOp = prismaMock.ordemProducao.findMany.mock.calls[0][0]
    expect('pdfData' in argOp.select).toBe(false)
    expect(argOp.where.empresaId).toBe(EMPRESA_A)
  })
})

describe('salvarFicha — upsert 1:1 e validação de modeloFaca', () => {
  it('cria quando não existe', async () => {
    prismaMock.produto.findFirst.mockResolvedValue({ id: 'p1', codigo: 'C', nome: 'N', descricao: null, status: true, clienteId: null })
    prismaMock.fichaGraficaProduto.findFirst.mockResolvedValue(null)
    prismaMock.fichaGraficaProduto.create.mockResolvedValue({})
    const r = await salvarFicha({ empresaId: EMPRESA_A, produtoId: 'p1', cartao: 'Duplex' })
    expect(prismaMock.fichaGraficaProduto.create).toHaveBeenCalled()
    expect(r.cartao).toBe('Duplex')
  })

  it('modeloFacaId de outra empresa ⇒ 400', async () => {
    prismaMock.produto.findFirst.mockResolvedValue({ id: 'p1', codigo: 'C', nome: 'N', descricao: null, status: true, clienteId: null })
    prismaMock.modeloFaca.findFirst.mockResolvedValue(null)
    await expect(
      salvarFicha({ empresaId: EMPRESA_A, produtoId: 'p1', modeloFacaId: '11111111-1111-1111-1111-111111111111' }),
    ).rejects.toBeInstanceOf(CentralProdutoError)
  })
})

describe('transicionarRevisao — aprovação marca anteriores OBSOLETA', () => {
  it('ao aprovar, obsoleta a aprovada anterior em transação', async () => {
    prismaMock.arteRevisaoProduto.findFirst.mockResolvedValue({ id: 'r2', produtoId: 'p1', estado: 'EM_APROVACAO' })
    const tx = {
      arteRevisaoProduto: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'r1', estado: 'APROVADA' },
          { id: 'r2', estado: 'EM_APROVACAO' },
        ]),
        updateMany: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
      },
    }
    prismaMock.$transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx))
    // releitura final
    prismaMock.arteRevisaoProduto.findFirst.mockResolvedValueOnce({ id: 'r2', produtoId: 'p1', estado: 'EM_APROVACAO' })
      .mockResolvedValueOnce({
        id: 'r2', numero: 2, estado: 'APROVADA', descricao: null, imagens: ['a'],
        aprovadaPorId: 'u1', aprovadaEm: new Date(), comentario: null, criadoEm: new Date(),
      })

    const r = await transicionarRevisao({
      empresaId: EMPRESA_A, revisaoId: 'r2', novoEstado: 'APROVADA', usuarioId: 'u1',
    })
    expect(tx.arteRevisaoProduto.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['r1'] } }, data: { estado: 'OBSOLETA' } }),
    )
    expect(r.estado).toBe('APROVADA')
  })

  it('transição inválida ⇒ 400', async () => {
    prismaMock.arteRevisaoProduto.findFirst.mockResolvedValue({ id: 'r1', produtoId: 'p1', estado: 'RASCUNHO' })
    await expect(
      transicionarRevisao({ empresaId: EMPRESA_A, revisaoId: 'r1', novoEstado: 'APROVADA', usuarioId: 'u1' }),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
})

describe('excluirProduto — bloqueio por movimentação', () => {
  it('com OP ⇒ 409 e NÃO deleta', async () => {
    prismaMock.produto.findFirst.mockResolvedValue({ id: 'p1', codigo: 'C', nome: 'N', descricao: null, status: true, clienteId: null })
    zerarContadores()
    prismaMock.ordemProducao.count.mockResolvedValue(3)
    await expect(excluirProduto(EMPRESA_A, 'p1')).rejects.toMatchObject({ statusCode: 409 })
    expect(prismaMock.produto.delete).not.toHaveBeenCalled()
  })

  it('sem movimentação ⇒ deleta', async () => {
    prismaMock.produto.findFirst.mockResolvedValue({ id: 'p1', codigo: 'C', nome: 'N', descricao: null, status: true, clienteId: null })
    zerarContadores()
    prismaMock.produto.delete.mockResolvedValue({})
    await excluirProduto(EMPRESA_A, 'p1')
    expect(prismaMock.produto.delete).toHaveBeenCalledWith({ where: { id: 'p1' } })
  })
})

describe('totalizadoresVenda — sem notas ⇒ zeros', () => {
  it('retorna temVendas=false quando não há itens', async () => {
    prismaMock.produto.findFirst.mockResolvedValue({ id: 'p1', codigo: 'C', nome: 'N', descricao: null, status: true, clienteId: null })
    prismaMock.itemDocumentoFiscal.findMany.mockResolvedValue([])
    const r = await totalizadoresVenda(EMPRESA_A, 'p1')
    expect(r.temVendas).toBe(false)
    expect(r.quantidadeTotal).toBe(0)
    expect(r.valorTotal).toBe(0)
    // filtro de empresa e saída aplicado via relação documento
    const arg = prismaMock.itemDocumentoFiscal.findMany.mock.calls[0][0]
    expect(arg.where.documento.empresaId).toBe(EMPRESA_A)
    expect(arg.where.documento.tipoOperacao).toBe(1)
  })
})
