// Testes das regras de anexo (mime/limite/tamanho) — spec comercial-pedido-proposta
// (Task 4.1). Mocка o prisma para isolar as regras puras do service.
// Rodar: npx vitest run <arquivo> --reporter=dot

import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

// Mock do prisma usado pelo service (vi.hoisted p/ a factory do vi.mock poder ler).
const prismaMock = vi.hoisted(() => ({
  pedidoProposta: { findFirst: vi.fn() },
  anexoPedidoProposta: { count: vi.fn(), create: vi.fn() },
}))
vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }))

import { adicionarAnexo, LIMITE_ANEXOS, TAMANHO_MAX } from './anexo-pedido-proposta.service'
import { PedidoPropostaError } from './pedido-proposta-estado.service'

const EMPRESA = 'emp-1'
const PEDIDO = 'ped-1'

beforeEach(() => {
  vi.clearAllMocks()
  // Pedido pai sempre existe/é da empresa.
  prismaMock.pedidoProposta.findFirst.mockResolvedValue({ id: PEDIDO })
  prismaMock.anexoPedidoProposta.create.mockResolvedValue({ id: 'anexo-novo' })
})

function arquivo(mime: string, bytes = 10): { nome: string; mime: string; buffer: Buffer } {
  return { nome: 'img', mime, buffer: Buffer.alloc(bytes) }
}

describe('adicionarAnexo — regras', () => {
  // P5 — mime
  it('P5: só aceita image/*; qualquer outro mime → MIME_INVALIDO', async () => {
    prismaMock.anexoPedidoProposta.count.mockResolvedValue(0)
    await expect(adicionarAnexo(EMPRESA, PEDIDO, arquivo('application/pdf'))).rejects.toMatchObject({ code: 'MIME_INVALIDO' })
    await expect(adicionarAnexo(EMPRESA, PEDIDO, arquivo('text/plain'))).rejects.toMatchObject({ code: 'MIME_INVALIDO' })
    await expect(adicionarAnexo(EMPRESA, PEDIDO, arquivo('image/png'))).resolves.toEqual({ id: 'anexo-novo' })
    await expect(adicionarAnexo(EMPRESA, PEDIDO, arquivo('image/jpeg'))).resolves.toEqual({ id: 'anexo-novo' })
  })

  // P6 — limite de 5
  it('P6: aceita ⟺ já existem < 5 anexos; >= 5 → LIMITE_ANEXOS', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 6 }), async (n) => {
        prismaMock.anexoPedidoProposta.count.mockResolvedValue(n)
        if (n < LIMITE_ANEXOS) {
          await expect(adicionarAnexo(EMPRESA, PEDIDO, arquivo('image/png'))).resolves.toEqual({ id: 'anexo-novo' })
        } else {
          await expect(adicionarAnexo(EMPRESA, PEDIDO, arquivo('image/png'))).rejects.toMatchObject({ code: 'LIMITE_ANEXOS' })
        }
      }),
    )
  })

  // P7 — tamanho
  it('P7: buffer > 10MB → ARQUIVO_GRANDE', async () => {
    prismaMock.anexoPedidoProposta.count.mockResolvedValue(0)
    await expect(adicionarAnexo(EMPRESA, PEDIDO, arquivo('image/png', TAMANHO_MAX + 1))).rejects.toMatchObject({ code: 'ARQUIVO_GRANDE' })
    await expect(adicionarAnexo(EMPRESA, PEDIDO, arquivo('image/png', TAMANHO_MAX))).resolves.toEqual({ id: 'anexo-novo' })
  })

  it('pedido de outra empresa → NAO_ENCONTRADO (404)', async () => {
    prismaMock.pedidoProposta.findFirst.mockResolvedValue(null)
    await expect(adicionarAnexo(EMPRESA, PEDIDO, arquivo('image/png'))).rejects.toMatchObject({ code: 'NAO_ENCONTRADO', statusCode: 404 })
  })

  it('erros são PedidoPropostaError', async () => {
    prismaMock.anexoPedidoProposta.count.mockResolvedValue(0)
    await adicionarAnexo(EMPRESA, PEDIDO, arquivo('application/zip')).catch((e) => {
      expect(e).toBeInstanceOf(PedidoPropostaError)
    })
  })
})
