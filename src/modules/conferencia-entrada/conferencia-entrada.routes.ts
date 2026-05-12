import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

/**
 * Parseia data no formato DD/MM/AAAA (brasileiro) ou ISO (AAAA-MM-DD).
 */
function parseDateBR(value: string | null | undefined): Date | null {
  if (!value) return null
  const brMatch = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (brMatch) {
    const [, dia, mes, ano] = brMatch
    return new Date(Number(ano), Number(mes) - 1, Number(dia))
  }
  const isoDate = new Date(value)
  if (!isNaN(isoDate.getTime())) return isoDate
  return null
}

const idParamsSchema = z.object({ id: z.string().uuid() })

const conferirItemSchema = z.object({
  itemNotaEntradaId: z.string().uuid(),
  quantidadeConferida: z.number().min(0),
  lote: z.string().optional(),
  validade: z.string().optional(),
  observacao: z.string().optional(),
})

export async function conferenciaEntradaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // GET /notas-pendentes — notas de entrada pendentes de conferência
  app.get('/notas-pendentes', async () => {
    const notas = await prisma.notaEntrada.findMany({
      where: { status: { in: ['PENDENTE', 'EM_CONFERENCIA'] } },
      orderBy: { criadoEm: 'desc' },
      include: { itens: true },
    })

    return notas.map((n) => {
      const totalItens = n.itens.length
      // Conferência cega: não mostra quantidades esperadas
      return {
        id: n.id,
        numero: n.numero,
        serie: n.serie,
        fornecedor: n.fornecedor,
        fornecedorDoc: n.fornecedorDoc,
        dataEntrada: n.dataEntrada,
        status: n.status,
        totalItens,
      }
    })
  })

  // GET /:id — detalhe da nota para conferência
  app.get('/:id', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)

    const nota = await prisma.notaEntrada.findUnique({
      where: { id },
      include: { itens: true },
    })

    if (!nota) return reply.status(404).send({ message: 'Nota não encontrada' })

    // Na conferência cega, retorna itens SEM a quantidade esperada
    const itensCegos = nota.itens.map((item) => ({
      id: item.id,
      item: item.item,
      descricao: item.descricao,
      codigoProduto: item.codigoProduto,
      unidade: item.unidade,
      // Quantidade esperada NÃO é enviada (conferência cega)
      quantidadeEsperada: nota.status === 'CONFERIDA' ? Number(item.quantidade) : undefined,
      lote: item.lote,
      validade: item.validade,
    }))

    return { ...nota, itens: itensCegos }
  })

  // POST /:id/iniciar — inicia conferência de uma nota
  app.post('/:id/iniciar', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)

    const nota = await prisma.notaEntrada.findUnique({ where: { id } })
    if (!nota) return reply.status(404).send({ message: 'Nota não encontrada' })
    if (nota.status !== 'PENDENTE') return reply.status(422).send({ message: `Nota em status ${nota.status}` })

    await prisma.notaEntrada.update({ where: { id }, data: { status: 'EM_CONFERENCIA' } })
    return { message: 'Conferência iniciada' }
  })

  // POST /:id/conferir-item — conferir um item (cega: operador digita quantidade sem ver a esperada)
  app.post('/:id/conferir-item', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)
    const body = conferirItemSchema.parse(request.body)

    const nota = await prisma.notaEntrada.findUnique({ where: { id } })
    if (!nota) return reply.status(404).send({ message: 'Nota não encontrada' })

    const item = await prisma.itemNotaEntrada.findUnique({ where: { id: body.itemNotaEntradaId } })
    if (!item) return reply.status(404).send({ message: 'Item não encontrado' })

    const quantidadeEsperada = Number(item.quantidade)
    const resultado = body.quantidadeConferida === quantidadeEsperada ? 'CONFORME' : 'DIVERGENTE'
    const tipoDivergencia = body.quantidadeConferida < quantidadeEsperada ? 'FALTA' : body.quantidadeConferida > quantidadeEsperada ? 'EXCESSO' : null

    // Atualizar item com lote/validade se informados
    if (body.lote || body.validade) {
      await prisma.itemNotaEntrada.update({
        where: { id: body.itemNotaEntradaId },
        data: {
          lote: body.lote || item.lote,
          validade: body.validade ? parseDateBR(body.validade) : item.validade,
        },
      })
    }

    return {
      itemId: item.id,
      descricao: item.descricao,
      quantidadeEsperada,
      quantidadeConferida: body.quantidadeConferida,
      resultado,
      tipoDivergencia,
    }
  })

  // POST /:id/concluir — conclui conferência
  app.post('/:id/concluir', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)

    const nota = await prisma.notaEntrada.findUnique({ where: { id }, include: { itens: true } })
    if (!nota) return reply.status(404).send({ message: 'Nota não encontrada' })

    await prisma.notaEntrada.update({ where: { id }, data: { status: 'CONFERIDA' } })
    return { message: 'Conferência concluída', totalItens: nota.itens.length }
  })
}
