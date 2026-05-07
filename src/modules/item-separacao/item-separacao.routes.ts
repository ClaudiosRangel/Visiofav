import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { confirmarItem } from './item-separacao.service'
import { verificarConclusaoOrdem } from './ordem-separacao-completion.helper'
import { registrarAudit } from '../auditoria/auditoria.routes'

const idParamsSchema = z.object({ id: z.string().uuid() })

const confirmarSchema = z.object({
  quantidadeSeparada: z.number().positive('Quantidade deve ser maior que zero'),
  motivoDivergencia: z.enum(['PRODUTO_NAO_ENCONTRADO', 'QUANTIDADE_INSUFICIENTE', 'AVARIA']).optional(),
})

const confirmarScannerSchema = z.object({
  barcodeEscaneado: z.string().min(1),
  quantidadeSeparada: z.number().positive('Quantidade deve ser maior que zero'),
  motivoDivergencia: z
    .enum(['PRODUTO_NAO_ENCONTRADO', 'QUANTIDADE_INSUFICIENTE', 'AVARIA'])
    .optional(),
})

export async function itemSeparacaoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  app.patch('/:id/confirmar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = confirmarSchema.parse(request.body)

    try {
      const result = await confirmarItem(id, body.quantidadeSeparada, body.motivoDivergencia, user.id)
      return result
    } catch (err: any) {
      if (err.status) return reply.status(err.status).send({ message: err.message })
      throw err
    }
  })

  // ==========================================================================
  // POST /:id/confirmar-scanner — Confirma separação de item via scanner
  // ==========================================================================
  app.post('/:id/confirmar-scanner', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = confirmarScannerSchema.parse(request.body)

    // Fetch the ItemSeparacao with its order and onda
    const itemSeparacao = await prisma.itemSeparacao.findUnique({
      where: { id },
      include: {
        ordemSeparacao: {
          include: {
            ondaSeparacao: { select: { id: true, empresaId: true } },
          },
        },
      },
    })

    if (!itemSeparacao) {
      return reply.status(404).send({ message: 'Item de separação não encontrado' })
    }

    if (itemSeparacao.status !== 'PENDENTE') {
      return reply.status(422).send({ message: `Item já está com status ${itemSeparacao.status}` })
    }

    // Validate the scanned barcode matches the expected product
    // Search by EAN in Sku first, then by product code
    const sku = await prisma.sku.findFirst({
      where: { codigoBarra: body.barcodeEscaneado },
      select: { produtoId: true },
    })

    let produtoEscaneadoId: string | null = sku?.produtoId ?? null

    if (!produtoEscaneadoId) {
      const produto = await prisma.produto.findFirst({
        where: { codigo: body.barcodeEscaneado },
        select: { id: true },
      })
      produtoEscaneadoId = produto?.id ?? null
    }

    if (!produtoEscaneadoId || produtoEscaneadoId !== itemSeparacao.produtoId) {
      return reply.status(422).send({
        message: 'Barcode escaneado não corresponde ao produto esperado para este item',
      })
    }

    // Validate divergence reason when quantity < requested
    const quantidadeSolicitada = Number(itemSeparacao.quantidadeSolicitada)
    if (body.quantidadeSeparada < quantidadeSolicitada && !body.motivoDivergencia) {
      return reply.status(422).send({
        message:
          'Quantidade separada menor que a solicitada. Informe o motivo da divergência (PRODUTO_NAO_ENCONTRADO, QUANTIDADE_INSUFICIENTE ou AVARIA)',
      })
    }

    // Determine item status
    const isTotalSeparado = body.quantidadeSeparada >= quantidadeSolicitada
    const novoStatus = isTotalSeparado ? 'SEPARADO' : 'SEPARADO_PARCIAL'

    // Update the item
    const itemAtualizado = await prisma.itemSeparacao.update({
      where: { id },
      data: {
        quantidadeSeparada: body.quantidadeSeparada,
        separadoEm: new Date(),
        status: novoStatus,
        motivoDivergencia: isTotalSeparado ? null : (body.motivoDivergencia ?? null),
      },
    })

    // Register audit
    await registrarAudit(user.empresaId, user.id, {
      entidade: 'SEPARACAO',
      entidadeId: id,
      acao: 'ATUALIZAR',
      descricao: `Item separado via scanner: ${body.quantidadeSeparada}/${quantidadeSolicitada}${body.motivoDivergencia ? ` (${body.motivoDivergencia})` : ''}`,
      dados: {
        itemSeparacaoId: id,
        barcodeEscaneado: body.barcodeEscaneado,
        quantidadeSeparada: body.quantidadeSeparada,
        quantidadeSolicitada,
        status: novoStatus,
        motivoDivergencia: body.motivoDivergencia,
      },
    })

    // Check if the order is complete (task 8.5)
    const conclusao = await verificarConclusaoOrdem(
      itemSeparacao.ordemSeparacaoId,
      itemSeparacao.ordemSeparacao.ondaSeparacao.empresaId,
      user.id,
    )

    return {
      id: itemAtualizado.id,
      quantidadeSeparada: Number(itemAtualizado.quantidadeSeparada),
      status: itemAtualizado.status,
      motivoDivergencia: itemAtualizado.motivoDivergencia,
      ordemSeparacao: conclusao,
    }
  })

  // ==========================================================================
  // GET /:id/enderecos-alternativos — Sugere endereços alternativos com saldo
  // ==========================================================================
  app.get('/:id/enderecos-alternativos', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    // Fetch the ItemSeparacao to get the product and current source address
    const itemSeparacao = await prisma.itemSeparacao.findUnique({
      where: { id },
      select: {
        id: true,
        produtoId: true,
        enderecoOrigemId: true,
        quantidadeSolicitada: true,
      },
    })

    if (!itemSeparacao) {
      return reply.status(404).send({ message: 'Item de separação não encontrado' })
    }

    // Find alternative addresses with positive stock of the same product
    // Exclude the current source address
    const saldosAlternativos = await prisma.saldoEndereco.findMany({
      where: {
        produtoId: itemSeparacao.produtoId,
        enderecoId: { not: itemSeparacao.enderecoOrigemId },
        quantidade: { gt: 0 },
      },
      include: {
        endereco: {
          select: {
            id: true,
            enderecoCompleto: true,
            codigoRua: true,
            codigoPredio: true,
            codigoNivel: true,
            codigoApto: true,
            tipo: true,
          },
        },
      },
      orderBy: { quantidade: 'desc' },
    })

    // Also fetch the current address saldo for context
    const saldoAtual = await prisma.saldoEndereco.findFirst({
      where: {
        produtoId: itemSeparacao.produtoId,
        enderecoId: itemSeparacao.enderecoOrigemId,
      },
      select: { quantidade: true, validade: true, lote: true },
    })

    return {
      itemSeparacaoId: id,
      produtoId: itemSeparacao.produtoId,
      quantidadeSolicitada: itemSeparacao.quantidadeSolicitada,
      enderecoAtual: {
        enderecoId: itemSeparacao.enderecoOrigemId,
        saldoDisponivel: saldoAtual ? Number(saldoAtual.quantidade) : 0,
        validade: saldoAtual?.validade ?? null,
        lote: saldoAtual?.lote ?? null,
      },
      enderecosAlternativos: saldosAlternativos.map((s) => ({
        enderecoId: s.enderecoId,
        endereco: s.endereco,
        saldoDisponivel: Number(s.quantidade),
        validade: s.validade,
        lote: s.lote,
      })),
    }
  })
}
