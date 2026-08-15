import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

export async function ressuprimentoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // GET /pendentes — endereços de picking com saldo abaixo do mínimo
  app.get('/pendentes', async (request) => {
    const user = request.user as { id: string; empresaId: string }

    // Buscar endereços de picking
    const enderecosPicking = await prisma.endereco.findMany({
      where: { tipo: 'PICKING', status: true },
      include: {
        saldos: {
          where: { quantidade: { gt: 0 } },
          include: { produto: { select: { id: true, codigo: true, nome: true } } },
        },
      },
    })

    // Buscar parâmetro global de saldo mínimo (fallback)
    const paramMinimo = await prisma.parametro.findFirst({
      where: { empresaId: user.empresaId, chave: 'WMS_PICKING_SALDO_MINIMO' },
    })
    const saldoMinimoGlobal = paramMinimo ? Number(paramMinimo.valor) : 10

    // Buscar dados logísticos de picking por produto (ponto de reposição individual)
    let dadosPickingMap: Record<string, { pontoReposicao: number; capacidade: number; enderecoPickingId: string | null }> = {}
    try {
      const dadosPicking = await prisma.dadosLogisticosPicking.findMany()
      for (const dp of dadosPicking) {
        dadosPickingMap[dp.produtoId] = {
          pontoReposicao: Number(dp.pontoReposicao),
          capacidade: Number(dp.capacidade),
          enderecoPickingId: dp.enderecoPickingId,
        }
      }
    } catch {
      // Tabela pode não existir ainda
    }

    // Identificar endereços que precisam de reposição
    const pendentes: any[] = []

    for (const end of enderecosPicking) {
      for (const saldo of end.saldos) {
        const qtd = Number(saldo.quantidade)
        // Usar ponto de reposição do produto se configurado, senão usar global
        const dadosProd = dadosPickingMap[saldo.produtoId]
        const pontoRep = dadosProd?.pontoReposicao && dadosProd.pontoReposicao > 0
          ? dadosProd.pontoReposicao
          : saldoMinimoGlobal
        const capacidade = dadosProd?.capacidade && dadosProd.capacidade > 0
          ? dadosProd.capacidade
          : pontoRep * 2

        if (qtd < pontoRep) {
          // Buscar endereço de pulmão com saldo deste produto
          const pulmao = await prisma.saldoEndereco.findFirst({
            where: {
              produtoId: saldo.produtoId,
              quantidade: { gt: 0 },
              endereco: { tipo: 'ARMAZENAGEM' },
              enderecoId: { not: end.id },
            },
            include: { endereco: { select: { id: true, enderecoCompleto: true } } },
            orderBy: { quantidade: 'desc' },
          })

          const quantidadeRepor = Math.min(capacidade - qtd, pulmao ? Number(pulmao.quantidade) : 0)

          pendentes.push({
            enderecoPickingId: end.id,
            enderecoPickingCompleto: end.enderecoCompleto,
            produtoId: saldo.produtoId,
            produto: saldo.produto,
            saldoAtual: qtd,
            saldoMinimo: pontoRep,
            capacidade,
            quantidadeRepor: quantidadeRepor > 0 ? quantidadeRepor : pontoRep - qtd,
            pulmao: pulmao ? {
              enderecoId: pulmao.endereco.id,
              enderecoCompleto: pulmao.endereco.enderecoCompleto,
              saldoDisponivel: Number(pulmao.quantidade),
            } : null,
            fonteConfig: dadosProd?.pontoReposicao ? 'PRODUTO' : 'GLOBAL',
          })
        }
      }
    }

    // Endereços de picking vazios (sem saldo nenhum)
    const pickingVazios = enderecosPicking.filter((e) => e.saldos.length === 0)

    return {
      data: pendentes,
      total: pendentes.length,
      pickingVazios: pickingVazios.length,
      saldoMinimo: saldoMinimoGlobal,
    }
  })

  // POST /executar — executar reposição (transferir do pulmão para picking)
  app.post('/executar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = z.object({
      produtoId: z.string().uuid(),
      enderecoOrigemId: z.string().uuid(),
      enderecoDestinoId: z.string().uuid(),
      quantidade: z.number().positive(),
    }).parse(request.body)

    // Validar
    const saldoOrigem = await prisma.saldoEndereco.findFirst({
      where: { enderecoId: body.enderecoOrigemId, produtoId: body.produtoId },
    })

    if (!saldoOrigem || Number(saldoOrigem.quantidade) < body.quantidade) {
      return reply.status(422).send({ message: 'Saldo insuficiente no pulmão' })
    }

    const [endOrigem, endDestino] = await Promise.all([
      prisma.endereco.findUnique({ where: { id: body.enderecoOrigemId }, select: { enderecoCompleto: true } }),
      prisma.endereco.findUnique({ where: { id: body.enderecoDestinoId }, select: { enderecoCompleto: true } }),
    ])

    await prisma.$transaction(async (tx) => {
      const saldoAnteriorOrigem = Number(saldoOrigem.quantidade)

      // Debitar pulmão
      await tx.saldoEndereco.update({
        where: { id: saldoOrigem.id },
        data: { quantidade: { decrement: body.quantidade } },
      })

      // Creditar picking
      const saldoDestino = await tx.saldoEndereco.findFirst({
        where: { enderecoId: body.enderecoDestinoId, produtoId: body.produtoId },
      })

      const saldoAnteriorDestino = saldoDestino ? Number(saldoDestino.quantidade) : 0

      if (saldoDestino) {
        await tx.saldoEndereco.update({
          where: { id: saldoDestino.id },
          data: { quantidade: { increment: body.quantidade } },
        })
      } else {
        await tx.saldoEndereco.create({
          data: { enderecoId: body.enderecoDestinoId, produtoId: body.produtoId, quantidade: body.quantidade },
        })
      }

      // Logs
      const motivo = `Ressuprimento: ${endOrigem?.enderecoCompleto} → ${endDestino?.enderecoCompleto}`

      await tx.logMovimentacao.create({
        data: {
          empresaId: user.empresaId, produtoId: body.produtoId, enderecoId: body.enderecoOrigemId,
          tipo: 'TRANSFERENCIA', quantidade: -body.quantidade,
          saldoAnterior: saldoAnteriorOrigem, saldoNovo: saldoAnteriorOrigem - body.quantidade,
          motivo, usuarioId: user.id,
        },
      })

      await tx.logMovimentacao.create({
        data: {
          empresaId: user.empresaId, produtoId: body.produtoId, enderecoId: body.enderecoDestinoId,
          tipo: 'TRANSFERENCIA', quantidade: body.quantidade,
          saldoAnterior: saldoAnteriorDestino, saldoNovo: saldoAnteriorDestino + body.quantidade,
          motivo, usuarioId: user.id,
        },
      })

      // Criar OS de reposição
      const ultimaOs = await tx.ordemServicoWms.findFirst({
        where: { empresaId: user.empresaId },
        orderBy: { numero: 'desc' },
        select: { numero: true },
      })

      await tx.ordemServicoWms.create({
        data: {
          empresaId: user.empresaId,
          numero: (ultimaOs?.numero ?? 0) + 1,
          tipo: 'TRANSFERENCIA',
          operacao: 'REPOSICAO',
          status: 'CONCLUIDO',
          horaInicio: new Date(),
          horaFim: new Date(),
        },
      })
    })

    return { message: 'Ressuprimento executado', quantidade: body.quantidade }
  })

  // GET /pendentes-demanda — MODO 2: calcula reposição apenas para atender pedidos pendentes
  // (não completa o picking — só comanda o necessário para a separação imediata)
  app.get('/pendentes-demanda', async (request) => {
    const user = request.user as { id: string; empresaId: string }

    // Buscar ondas de separação ativas (AGUARDANDO_SEPARACAO ou EM_SEPARACAO)
    const ondasAtivas = await prisma.ondaSeparacao.findMany({
      where: { empresaId: user.empresaId, status: { in: ['AGUARDANDO_SEPARACAO', 'EM_SEPARACAO'] } },
      include: {
        ordens: { include: { itens: { select: { produtoId: true, quantidadeSolicitada: true, enderecoOrigemId: true } } } },
      },
    })

    // Agregar demanda por produto em endereços de picking
    const demandaPorProdutoPicking = new Map<string, { produtoId: string; enderecoPickingId: string; quantidadeNecessaria: number }>()

    for (const onda of ondasAtivas) {
      for (const ordem of onda.ordens) {
        for (const item of ordem.itens) {
          // Verificar se o endereço de origem é picking
          const endereco = await prisma.endereco.findFirst({
            where: { id: item.enderecoOrigemId, tipo: 'PICKING' },
            select: { id: true },
          })
          if (!endereco) continue

          const chave = `${item.produtoId}_${item.enderecoOrigemId}`
          const existente = demandaPorProdutoPicking.get(chave)
          if (existente) {
            existente.quantidadeNecessaria += Number(item.quantidadeSolicitada)
          } else {
            demandaPorProdutoPicking.set(chave, {
              produtoId: item.produtoId,
              enderecoPickingId: item.enderecoOrigemId,
              quantidadeNecessaria: Number(item.quantidadeSolicitada),
            })
          }
        }
      }
    }

    // Para cada demanda, verificar se o saldo no picking é suficiente
    const pendentes: Array<{
      produtoId: string
      enderecoPickingId: string
      enderecoPickingCompleto: string
      saldoAtual: number
      demandaPedidos: number
      deficit: number
      pulmao: { enderecoId: string; enderecoCompleto: string; saldoDisponivel: number } | null
    }> = []

    for (const [, demanda] of demandaPorProdutoPicking) {
      const saldo = await prisma.saldoEndereco.aggregate({
        where: { enderecoId: demanda.enderecoPickingId, produtoId: demanda.produtoId, quantidade: { gt: 0 } },
        _sum: { quantidade: true },
      })
      const saldoAtual = Number(saldo._sum.quantidade ?? 0)
      const deficit = demanda.quantidadeNecessaria - saldoAtual

      if (deficit > 0) {
        const enderecoPicking = await prisma.endereco.findUnique({
          where: { id: demanda.enderecoPickingId },
          select: { enderecoCompleto: true },
        })

        // Buscar pulmão com saldo
        const pulmao = await prisma.saldoEndereco.findFirst({
          where: {
            produtoId: demanda.produtoId,
            quantidade: { gt: 0 },
            endereco: { tipo: 'ARMAZENAGEM' },
            enderecoId: { not: demanda.enderecoPickingId },
          },
          include: { endereco: { select: { id: true, enderecoCompleto: true } } },
          orderBy: { quantidade: 'desc' },
        })

        pendentes.push({
          produtoId: demanda.produtoId,
          enderecoPickingId: demanda.enderecoPickingId,
          enderecoPickingCompleto: enderecoPicking?.enderecoCompleto ?? '',
          saldoAtual,
          demandaPedidos: demanda.quantidadeNecessaria,
          deficit,
          pulmao: pulmao ? {
            enderecoId: pulmao.endereco.id,
            enderecoCompleto: pulmao.endereco.enderecoCompleto ?? '',
            saldoDisponivel: Number(pulmao.quantidade),
          } : null,
        })
      }
    }

    return {
      modo: 'DEMANDA_IMEDIATA',
      data: pendentes,
      total: pendentes.length,
      descricao: 'Reposição calculada apenas para atender pedidos de separação pendentes (não completa o picking)',
    }
  })
}
