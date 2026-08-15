/**
 * Serviço de Picking Dinâmico — RF009
 *
 * Implementa a liberação automática de endereços de picking dinâmico
 * quando o saldo zera tanto no picking quanto no pulmão (PK + PL = 0).
 *
 * Também implementa a mudança de picking (DE/PARA) com bloqueio temporário.
 */

import { prisma } from '../../lib/prisma'

// ── Picking Dinâmico: Liberação Automática ────────────────────────────────

export interface ResultadoLiberacao {
  liberados: number
  enderecos: Array<{ id: string; enderecoCompleto: string; produtoId: string }>
}

/**
 * Verifica todos os endereços de picking dinâmico (fixo=false) de uma empresa
 * e libera aqueles cujo produto tem saldo ZERO em todos os endereços
 * (picking + pulmão). "Liberar" = desvincular o enderecoPickingId no
 * DadosLogisticosPicking e mudar o tipo do endereço para LIVRE.
 *
 * Chamada: pode ser disparada como job periódico ou após cada expedição.
 */
export async function liberarPickingsDinamicosZerados(empresaId: string): Promise<ResultadoLiberacao> {
  const liberados: ResultadoLiberacao['enderecos'] = []

  // Buscar todos os DadosLogisticosArmazenagem com fixo=false que têm endereço de picking vinculado
  const dadosPicking = await prisma.dadosLogisticosPicking.findMany({
    where: {
      enderecoPickingId: { not: null },
    },
  })

  // Para cada picking configurado, verificar se é dinâmico (não fixo)
  for (const dp of dadosPicking) {
    if (!dp.enderecoPickingId) continue

    // Verificar se o produto pertence à empresa
    const dadosArmazenagem = await prisma.dadosLogisticosArmazenagem.findFirst({
      where: { produtoId: dp.produtoId },
    })

    // Se fixo=true, pular (picking fixo não é liberado)
    if (dadosArmazenagem?.fixo) continue

    // Verificar se o endereço pertence à empresa
    const endereco = await prisma.endereco.findFirst({
      where: { id: dp.enderecoPickingId, empresaId },
    })
    if (!endereco) continue

    // Verificar saldo total do produto na empresa (PK + PL)
    const saldoTotal = await prisma.saldoEndereco.aggregate({
      where: { produtoId: dp.produtoId, empresaId, quantidade: { gt: 0 } },
      _sum: { quantidade: true },
    })

    const total = Number(saldoTotal._sum.quantidade ?? 0)

    // Se saldo total é zero → liberar
    if (total === 0) {
      // Desvincular o endereço do produto
      await prisma.dadosLogisticosPicking.update({
        where: { id: dp.id },
        data: { enderecoPickingId: null },
      })

      // Mudar tipo do endereço para LIVRE (se estava como PICKING)
      if (endereco.tipo === 'PICKING' || endereco.areaArmazenagem === 'PICKING') {
        await prisma.endereco.update({
          where: { id: endereco.id },
          data: { tipo: 'LIVRE', areaArmazenagem: null },
        })
      }

      liberados.push({
        id: endereco.id,
        enderecoCompleto: endereco.enderecoCompleto ?? '',
        produtoId: dp.produtoId,
      })
    }
  }

  return { liberados: liberados.length, enderecos: liberados }
}

// ── Mudança de Picking (DE/PARA) ──────────────────────────────────────────

export interface CriarMudancaPickingInput {
  empresaId: string
  produtoId: string
  enderecoOrigemId: string
  enderecoDestinoId: string
  solicitadoPorId: string
  observacao?: string
}

/**
 * Cria uma solicitação de mudança de picking (DE/PARA).
 * Bloqueia o endereço de origem para movimentação durante a mudança.
 */
export async function criarMudancaPicking(input: CriarMudancaPickingInput) {
  const { empresaId, produtoId, enderecoOrigemId, enderecoDestinoId, solicitadoPorId, observacao } = input

  // Validar que o endereço de origem existe e tem saldo do produto
  const saldoOrigem = await prisma.saldoEndereco.findFirst({
    where: { enderecoId: enderecoOrigemId, produtoId, quantidade: { gt: 0 } },
  })

  if (!saldoOrigem) {
    throw { statusCode: 422, message: 'Endereço de origem não tem saldo do produto informado' }
  }

  // Validar que o endereço de destino existe e está disponível
  const enderecoDestino = await prisma.endereco.findFirst({
    where: { id: enderecoDestinoId, status: true, bloqueado: false },
  })

  if (!enderecoDestino) {
    throw { statusCode: 422, message: 'Endereço de destino não encontrado ou está bloqueado' }
  }

  // Criar a solicitação e bloquear o endereço de origem
  const [mudanca] = await prisma.$transaction([
    prisma.mudancaPicking.create({
      data: {
        empresaId,
        produtoId,
        enderecoOrigemId,
        enderecoDestinoId,
        solicitadoPorId,
        observacao,
        status: 'PENDENTE',
      },
    }),
    // Bloquear endereço de origem
    prisma.endereco.update({
      where: { id: enderecoOrigemId },
      data: { bloqueado: true, motivoBloqueio: 'Mudança de picking em andamento' },
    }),
  ])

  return mudanca
}

/**
 * Executa a mudança de picking: transfere todo o saldo do produto do
 * endereço de origem para o destino, atualiza DadosLogisticosPicking,
 * e desbloqueia o endereço de origem (liberando-o como LIVRE).
 */
export async function executarMudancaPicking(mudancaId: string, executadoPorId: string) {
  const mudanca = await prisma.mudancaPicking.findUnique({ where: { id: mudancaId } })

  if (!mudanca) throw { statusCode: 404, message: 'Mudança de picking não encontrada' }
  if (mudanca.status !== 'PENDENTE' && mudanca.status !== 'EM_ANDAMENTO') {
    throw { statusCode: 422, message: `Mudança já está com status ${mudanca.status}` }
  }

  await prisma.$transaction(async (tx) => {
    // Buscar saldos do produto no endereço de origem
    const saldos = await tx.saldoEndereco.findMany({
      where: { enderecoId: mudanca.enderecoOrigemId, produtoId: mudanca.produtoId, quantidade: { gt: 0 } },
    })

    let totalTransferido = 0

    for (const saldo of saldos) {
      const qtd = Number(saldo.quantidade)

      // Creditar no destino
      const saldoDestino = await tx.saldoEndereco.findFirst({
        where: { enderecoId: mudanca.enderecoDestinoId, produtoId: mudanca.produtoId, lote: saldo.lote },
      })

      if (saldoDestino) {
        await tx.saldoEndereco.update({
          where: { id: saldoDestino.id },
          data: { quantidade: { increment: qtd } },
        })
      } else {
        await tx.saldoEndereco.create({
          data: {
            enderecoId: mudanca.enderecoDestinoId,
            produtoId: mudanca.produtoId,
            quantidade: qtd,
            lote: saldo.lote,
            validade: saldo.validade,
            empresaId: mudanca.empresaId,
          },
        })
      }

      // Debitar da origem
      await tx.saldoEndereco.update({
        where: { id: saldo.id },
        data: { quantidade: 0 },
      })

      totalTransferido += qtd
    }

    // Atualizar DadosLogisticosPicking: trocar enderecoPickingId
    await tx.dadosLogisticosPicking.updateMany({
      where: { produtoId: mudanca.produtoId, enderecoPickingId: mudanca.enderecoOrigemId },
      data: { enderecoPickingId: mudanca.enderecoDestinoId },
    })

    // Atualizar tipos dos endereços
    await tx.endereco.update({
      where: { id: mudanca.enderecoOrigemId },
      data: { tipo: 'LIVRE', areaArmazenagem: null, bloqueado: false, motivoBloqueio: null },
    })
    await tx.endereco.update({
      where: { id: mudanca.enderecoDestinoId },
      data: { tipo: 'PICKING', areaArmazenagem: 'PICKING' },
    })

    // Concluir a mudança
    await tx.mudancaPicking.update({
      where: { id: mudancaId },
      data: { status: 'CONCLUIDA', quantidadeTransferida: totalTransferido, concluidoEm: new Date() },
    })

    // Log de movimentação
    await tx.logMovimentacao.create({
      data: {
        empresaId: mudanca.empresaId,
        produtoId: mudanca.produtoId,
        enderecoId: mudanca.enderecoDestinoId,
        tipo: 'TRANSFERENCIA',
        quantidade: totalTransferido,
        saldoAnterior: 0,
        saldoNovo: totalTransferido,
        motivo: `Mudança de picking DE/PARA concluída (mudança #${mudancaId.slice(0, 8)})`,
        usuarioId: executadoPorId,
      },
    })
  })

  return { message: 'Mudança de picking concluída' }
}

/**
 * Cancela uma mudança de picking e desbloqueia o endereço de origem.
 */
export async function cancelarMudancaPicking(mudancaId: string) {
  const mudanca = await prisma.mudancaPicking.findUnique({ where: { id: mudancaId } })
  if (!mudanca) throw { statusCode: 404, message: 'Mudança não encontrada' }
  if (mudanca.status === 'CONCLUIDA') throw { statusCode: 422, message: 'Mudança já concluída, não pode ser cancelada' }

  await prisma.$transaction([
    prisma.mudancaPicking.update({ where: { id: mudancaId }, data: { status: 'CANCELADA' } }),
    prisma.endereco.update({
      where: { id: mudanca.enderecoOrigemId },
      data: { bloqueado: false, motivoBloqueio: null },
    }),
  ])

  return { message: 'Mudança de picking cancelada' }
}
