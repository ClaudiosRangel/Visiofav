import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { registrarAudit } from '../auditoria/auditoria.routes'
import { FichaService } from '../ficha-operacional/ficha.service'
import crypto from 'node:crypto'

const idParamsSchema = z.object({ id: z.string().uuid() })
const itemParamsSchema = z.object({ id: z.string().uuid(), itemId: z.string().uuid() })

const conferirItemSchema = z.object({
  quantidadeConferida: z.number().min(0),
  tipoDivergencia: z.enum(['FALTA', 'EXCESSO', 'PRODUTO_ERRADO']).optional(),
  observacao: z.string().optional(),
})

const conferirScannerSchema = z.object({
  barcodeEscaneado: z.string().min(1),
  quantidadeConferida: z.number().min(0),
  observacao: z.string().optional(),
})

export async function conferenciaSaidaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // GET /:id — detalhe da conferência com itens
  app.get('/:id', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)

    // Tentar buscar por ID da conferência ou por ondaSeparacaoId
    let conferencia = await prisma.conferenciaSaida.findUnique({
      where: { id },
      include: {
        ondaSeparacao: {
          include: {
            ordens: {
              include: {
                itens: {
                  include: {
                    itensConferencia: { where: { conferenciaSaidaId: id } },
                  },
                },
              },
            },
          },
        },
      },
    })

    // Fallback: buscar pela ondaSeparacaoId (quando o app passa o ondaSeparacaoId)
    if (!conferencia) {
      conferencia = await prisma.conferenciaSaida.findFirst({
        where: { ondaSeparacaoId: id },
        include: {
          ondaSeparacao: {
            include: {
              ordens: {
                include: {
                  itens: {
                    include: {
                      itensConferencia: true,
                    },
                  },
                },
              },
            },
          },
        },
      })
    }

    if (!conferencia) return reply.status(404).send({ message: 'Conferência de saída não encontrada' })

    // Enriquecer itens com produto
    const todosItens = conferencia.ondaSeparacao.ordens.flatMap((o) => o.itens)
    const produtoIds = [...new Set(todosItens.map((i) => i.produtoId))]
    const produtos = await prisma.produto.findMany({
      where: { id: { in: produtoIds } },
      select: { id: true, codigo: true, nome: true, unidade: true },
    })
    const produtoMap = new Map(produtos.map((p) => [p.id, p]))

    const itens = todosItens.map((item) => {
      const produto = produtoMap.get(item.produtoId)
      const confItem = item.itensConferencia?.[0]
      return {
        id: item.id,
        produtoId: item.produtoId,
        produto: produto ? { codigo: produto.codigo, nome: produto.nome, unidade: produto.unidade } : null,
        quantidadeEsperada: Number(item.quantidadeSeparada),
        quantidadeConferida: confItem ? Number(confItem.quantidadeConferida) : 0,
        status: confItem ? (confItem.resultado === 'CONFORME' ? 'CONFORME' : 'DIVERGENTE') : 'PENDENTE',
      }
    })

    return {
      id: conferencia.id,
      status: conferencia.status,
      ondaSeparacaoId: conferencia.ondaSeparacaoId,
      itens,
    }
  })

  // POST /api/ondas-separacao/:id/conferencia — criar conferência

  // POST / — criar conferência para uma onda
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { ondaSeparacaoId, conferenteId } = z.object({
      ondaSeparacaoId: z.string().uuid(),
      conferenteId: z.string().uuid(),
    }).parse(request.body)

    const onda = await prisma.ondaSeparacao.findFirst({
      where: { id: ondaSeparacaoId, empresaId: user.empresaId },
    })

    if (!onda) return reply.status(404).send({ message: 'Onda não encontrada' })
    if (onda.status !== 'SEPARADA') return reply.status(422).send({ message: `Onda em status ${onda.status}. Esperado: SEPARADA` })

    const conferencia = await prisma.conferenciaSaida.create({
      data: { ondaSeparacaoId, conferenteId },
    })

    return reply.status(201).send(conferencia)
  })

  // PATCH /:id/itens/:itemId — conferir item
  app.patch('/:id/itens/:itemId', async (request, reply) => {
    const { id, itemId } = itemParamsSchema.parse(request.params)
    const body = conferirItemSchema.parse(request.body)

    const conferencia = await prisma.conferenciaSaida.findUnique({ where: { id } })
    if (!conferencia) return reply.status(404).send({ message: 'Conferência não encontrada' })
    if (conferencia.status !== 'EM_CONFERENCIA') return reply.status(422).send({ message: 'Conferência não está em andamento' })

    const itemSep = await prisma.itemSeparacao.findUnique({ where: { id: itemId } })
    if (!itemSep) return reply.status(404).send({ message: 'Item de separação não encontrado' })

    const resultado = body.quantidadeConferida === Number(itemSep.quantidadeSeparada) ? 'CONFORME' : 'DIVERGENTE'

    const itemConf = await prisma.itemConferenciaSaida.create({
      data: {
        conferenciaSaidaId: id,
        itemSeparacaoId: itemId,
        quantidadeConferida: body.quantidadeConferida,
        resultado,
        tipoDivergencia: resultado === 'DIVERGENTE' ? (body.tipoDivergencia || 'FALTA') : null,
        observacao: body.observacao,
      },
    })

    return itemConf
  })

  // PATCH /:id/aprovar — aprovar conferência
  app.patch('/:id/aprovar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const conferencia = await prisma.conferenciaSaida.findUnique({ where: { id } })
    if (!conferencia) return reply.status(404).send({ message: 'Conferência não encontrada' })
    if (conferencia.status !== 'EM_CONFERENCIA') return reply.status(422).send({ message: 'Conferência não está em andamento' })

    await prisma.$transaction(async (tx) => {
      await tx.conferenciaSaida.update({
        where: { id },
        data: { status: 'APROVADA', concluidaEm: new Date() },
      })
      await tx.ondaSeparacao.update({
        where: { id: conferencia.ondaSeparacaoId },
        data: { status: 'CONFERIDA' },
      })

      // Concluir OS de CONFERENCIA_SAIDA
      const osConf = await tx.ordemServicoWms.findFirst({
        where: { ondaSeparacaoId: conferencia.ondaSeparacaoId, operacao: 'CONFERENCIA_SAIDA', status: { notIn: ['CONCLUIDO', 'REJEITADO'] } },
      })
      if (osConf) {
        await tx.ordemServicoWms.update({
          where: { id: osConf.id },
          data: { status: 'CONCLUIDO', horaFim: new Date() },
        })
      }

      // Criar OS de EMBALAGEM automaticamente
      const ultimaOs = await tx.ordemServicoWms.findFirst({
        where: { empresaId: user.empresaId },
        orderBy: { numero: 'desc' },
        select: { numero: true },
      })
      await tx.ordemServicoWms.create({
        data: {
          empresaId: user.empresaId,
          numero: (ultimaOs?.numero ?? 0) + 1,
          tipo: 'SAIDA',
          operacao: 'EMBALAGEM',
          status: 'ABERTO',
          ondaSeparacaoId: conferencia.ondaSeparacaoId,
        },
      })
    })

    return { message: 'Conferência aprovada — OS de embalagem criada' }
  })

  // PATCH /:id/rejeitar — rejeitar conferência
  app.patch('/:id/rejeitar', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)

    const conferencia = await prisma.conferenciaSaida.findUnique({ where: { id } })
    if (!conferencia) return reply.status(404).send({ message: 'Conferência não encontrada' })
    if (conferencia.status !== 'EM_CONFERENCIA') return reply.status(422).send({ message: 'Conferência não está em andamento' })

    await prisma.$transaction(async (tx) => {
      await tx.conferenciaSaida.update({
        where: { id },
        data: { status: 'REJEITADA', concluidaEm: new Date() },
      })
      await tx.ondaSeparacao.update({
        where: { id: conferencia.ondaSeparacaoId },
        data: { status: 'EM_SEPARACAO' },
      })
    })

    return { message: 'Conferência rejeitada — onda retornou para separação' }
  })

  // ==========================================================================
  // POST /:id/conferir-scanner — Confere item via scanner no modo coletor
  // Task 9.1: Scans Produto_Barcode, registers checked quantity, compares
  // with separated quantity. When divergent, registers as DIVERGENTE.
  // ==========================================================================
  app.post('/:id/conferir-scanner', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = conferirScannerSchema.parse(request.body)

    // Fetch the conferência
    const conferencia = await prisma.conferenciaSaida.findUnique({
      where: { id },
      include: {
        ondaSeparacao: {
          include: {
            ordens: {
              include: {
                itens: { select: { id: true, produtoId: true, quantidadeSeparada: true, status: true } },
              },
            },
          },
        },
      },
    })

    if (!conferencia) return reply.status(404).send({ message: 'Conferência não encontrada' })
    if (conferencia.status !== 'EM_CONFERENCIA') {
      return reply.status(422).send({ message: 'Conferência não está em andamento' })
    }

    // Find the product by barcode (EAN via Sku or product code)
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

    if (!produtoEscaneadoId) {
      return reply.status(422).send({ message: 'Produto não encontrado para o barcode escaneado' })
    }

    // Find the matching ItemSeparacao in this onda
    const todosItens = conferencia.ondaSeparacao.ordens.flatMap((o) => o.itens)
    const itemSeparacao = todosItens.find((i) => i.produtoId === produtoEscaneadoId)

    if (!itemSeparacao) {
      // Product scanned doesn't belong to this onda — PRODUTO_ERRADO
      return reply.status(422).send({
        message: 'Produto escaneado não pertence a esta onda de separação',
        tipoDivergencia: 'PRODUTO_ERRADO',
      })
    }

    // Check if this item was already checked in this conferência
    const jaConferido = await prisma.itemConferenciaSaida.findFirst({
      where: { conferenciaSaidaId: id, itemSeparacaoId: itemSeparacao.id },
    })

    if (jaConferido) {
      return reply.status(422).send({ message: 'Este item já foi conferido nesta conferência' })
    }

    // Compare quantities
    const quantidadeSeparada = Number(itemSeparacao.quantidadeSeparada)
    const quantidadeConferida = body.quantidadeConferida

    let resultado: string
    let tipoDivergencia: string | null = null

    if (quantidadeConferida === quantidadeSeparada) {
      resultado = 'CONFORME'
    } else {
      resultado = 'DIVERGENTE'
      if (quantidadeConferida < quantidadeSeparada) {
        tipoDivergencia = 'FALTA'
      } else {
        tipoDivergencia = 'EXCESSO'
      }
    }

    // Create the ItemConferenciaSaida
    const itemConf = await prisma.itemConferenciaSaida.create({
      data: {
        conferenciaSaidaId: id,
        itemSeparacaoId: itemSeparacao.id,
        quantidadeConferida: body.quantidadeConferida,
        resultado,
        tipoDivergencia,
        observacao: body.observacao,
      },
    })

    // Register audit
    await registrarAudit(user.empresaId, user.id, {
      entidade: 'CONFERENCIA',
      entidadeId: id,
      acao: 'CONFERIR',
      descricao: `Item conferido via scanner: ${quantidadeConferida}/${quantidadeSeparada} — ${resultado}${tipoDivergencia ? ` (${tipoDivergencia})` : ''}`,
      dados: {
        conferenciaSaidaId: id,
        itemSeparacaoId: itemSeparacao.id,
        barcodeEscaneado: body.barcodeEscaneado,
        quantidadeConferida,
        quantidadeSeparada,
        resultado,
        tipoDivergencia,
      },
    })

    // Task 9.3: Check if all items have been checked — if so, auto-approve
    const totalItensOnda = todosItens.length
    const totalConferidos = await prisma.itemConferenciaSaida.count({
      where: { conferenciaSaidaId: id },
    })

    let conferenciaFinalizada = false
    if (totalConferidos >= totalItensOnda) {
      // Check if all items are CONFORME
      const itensConferidos = await prisma.itemConferenciaSaida.findMany({
        where: { conferenciaSaidaId: id },
        select: { resultado: true },
      })

      const todosConformes = itensConferidos.every((ic) => ic.resultado === 'CONFORME')

      if (todosConformes) {
        // All items checked and approved → update conferência and onda
        await prisma.$transaction(async (tx) => {
          await tx.conferenciaSaida.update({
            where: { id },
            data: { status: 'APROVADA', concluidaEm: new Date() },
          })
          await tx.ondaSeparacao.update({
            where: { id: conferencia.ondaSeparacaoId },
            data: { status: 'CONFERIDA' },
          })

          // Concluir OS de CONFERENCIA_SAIDA
          const osConf = await tx.ordemServicoWms.findFirst({
            where: { ondaSeparacaoId: conferencia.ondaSeparacaoId, operacao: 'CONFERENCIA_SAIDA', status: { notIn: ['CONCLUIDO', 'REJEITADO'] } },
          })
          if (osConf) {
            await tx.ordemServicoWms.update({
              where: { id: osConf.id },
              data: { status: 'CONCLUIDO', horaFim: new Date() },
            })
          }

          // Criar OS de EMBALAGEM automaticamente
          const ultimaOs = await tx.ordemServicoWms.findFirst({
            where: { empresaId: user.empresaId },
            orderBy: { numero: 'desc' },
            select: { numero: true },
          })
          await tx.ordemServicoWms.create({
            data: {
              empresaId: user.empresaId,
              numero: (ultimaOs?.numero ?? 0) + 1,
              tipo: 'SAIDA',
              operacao: 'EMBALAGEM',
              status: 'ABERTO',
              ondaSeparacaoId: conferencia.ondaSeparacaoId,
            },
          })
        })
        conferenciaFinalizada = true
      }
    }

    return {
      ...itemConf,
      resultado,
      tipoDivergencia,
      conferenciaFinalizada,
      progresso: { totalItens: totalItensOnda, conferidos: totalConferidos },
    }
  })

  // ==========================================================================
  // POST /:id/gerar-ficha — Gera FichaOperacional de conferência
  // Task 9.2: Generates FichaOperacional of type CONFERENCIA with items
  // and blank fields for checked quantity.
  // ==========================================================================
  app.post('/:id/gerar-ficha', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const conferencia = await prisma.conferenciaSaida.findUnique({
      where: { id },
      include: {
        itens: {
          include: {
            itemSeparacao: {
              include: {
                ordemSeparacao: true,
              },
            },
          },
        },
      },
    })

    if (!conferencia) return reply.status(404).send({ message: 'Conferência não encontrada' })

    // Enrich items with product data
    const itemSepIds = conferencia.itens.map((ic) => ic.itemSeparacaoId)

    // If conferência has no items yet, generate from onda's items
    let itensParaFicha = conferencia.itens

    if (itensParaFicha.length === 0) {
      // Fetch all items from the onda to create a blank ficha
      const ondaItens = await prisma.itemSeparacao.findMany({
        where: {
          ordemSeparacao: { ondaSeparacaoId: conferencia.ondaSeparacaoId },
          status: { in: ['SEPARADO', 'SEPARADO_PARCIAL'] },
        },
        select: { id: true, produtoId: true, quantidadeSeparada: true },
      })

      // Create placeholder items for the ficha (not persisted as ItemConferenciaSaida)
      itensParaFicha = ondaItens.map((item) => ({
        id: item.id,
        conferenciaSaidaId: id,
        itemSeparacaoId: item.id,
        quantidadeConferida: new (prisma as any).$extends ? 0 : 0 as any,
        resultado: 'PENDENTE',
        tipoDivergencia: null,
        observacao: null,
        itemSeparacao: null,
      })) as any
    }

    // Fetch product data for enrichment
    const allItemSepIds = itensParaFicha.map((ic: any) => ic.itemSeparacaoId)
    const itensSep = await prisma.itemSeparacao.findMany({
      where: { id: { in: allItemSepIds } },
      select: { id: true, produtoId: true, quantidadeSeparada: true },
    })

    const produtoIds = [...new Set(itensSep.map((i) => i.produtoId))]
    const produtos = await prisma.produto.findMany({
      where: { id: { in: produtoIds } },
      select: { id: true, codigo: true, nome: true, unidade: true },
    })
    const produtoMap = new Map(produtos.map((p) => [p.id, p]))
    const itemSepMap = new Map(itensSep.map((i) => [i.id, i]))

    // Build enriched conferencia for FichaService
    const conferenciaEnriquecida = {
      ...conferencia,
      itens: itensParaFicha.map((ic: any) => {
        const sep = itemSepMap.get(ic.itemSeparacaoId)
        const produto = sep ? produtoMap.get(sep.produtoId) : null
        return {
          ...ic,
          itemSeparacao: sep ? {
            ...sep,
            produto: produto ?? null,
          } : null,
        }
      }),
    }

    // Generate unique barcode
    const timestamp = Date.now().toString(36).toUpperCase()
    const random = crypto.randomBytes(3).toString('hex').toUpperCase()
    const codigoBarras = `CONF-${timestamp}-${random}`

    // Create FichaOperacional record
    const ficha = await prisma.fichaOperacional.create({
      data: {
        empresaId: user.empresaId,
        tipo: 'CONFERENCIA',
        referenciaId: id,
        codigoBarras,
        status: 'GERADA',
      },
    })

    // Generate HTML
    const fichaService = new FichaService()
    const html = fichaService.gerarHtmlConferencia(conferenciaEnriquecida as any)

    return reply.status(201).send({
      ficha,
      htmlDisponivel: !!html,
    })
  })
}
