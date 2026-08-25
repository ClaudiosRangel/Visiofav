/**
 * Serviço de Reserva de Produção (Ponto 2 da Análise de Produção).
 *
 * Cria/cancela reservas (empenho) de material para uma OP. A reserva impede
 * que o mesmo saldo seja prometido a outra OP — o disponível de um material é
 * calculado como: estoque físico - Σ reservas ATIVAS de todas as OPs.
 *
 * Referência conceitual: docs/visao-analise-pedido-para-op.md (Ponto 2)
 */

import { prisma } from '../../../lib/prisma'

export interface ResultadoReserva {
  ordemProducaoId: string
  reservasCriadas: number
  reservasIgnoradas: number
  detalhes: Array<{
    produtoId: string | null
    descricao: string
    quantidade: number
    reservado: boolean
    motivo?: string
  }>
}

/**
 * Soma as reservas ATIVAS de um produto, opcionalmente excluindo uma OP
 * (útil ao recalcular disponível para a própria OP que está sendo analisada).
 */
export async function somarReservasAtivas(
  empresaId: string,
  produtoId: string,
  excluirOpId?: string,
): Promise<number> {
  const where: Record<string, unknown> = {
    empresaId,
    produtoId,
    status: 'ATIVA',
  }
  if (excluirOpId) {
    where.ordemProducaoId = { not: excluirOpId }
  }

  const agregado = await prisma.reservaProducao.aggregate({
    where,
    _sum: { quantidade: true },
  })

  return Number(agregado._sum.quantidade ?? 0)
}

/**
 * Cria reservas de material para uma OP a partir dos seus itens.
 *
 * Regras:
 * - Só cria reserva para itens com `produtoComponenteId` (material cadastrado)
 * - Idempotente: se a OP já tem reservas ATIVAS, não duplica (retorna ignoradas)
 * - A quantidade reservada é a necessidade líquida (quantidade - já liberada)
 *
 * @param opId ID da ordem de produção
 * @param empresaId empresa
 */
export async function criarReservasOp(
  opId: string,
  empresaId: string,
): Promise<ResultadoReserva> {
  const op = await prisma.ordemProducao.findFirst({
    where: { id: opId, empresaId },
    select: {
      id: true,
      itens: {
        select: {
          produtoComponenteId: true,
          descricaoProduto: true,
          quantidade: true,
          quantidadeLiberada: true,
          unidadeMedida: true,
        },
      },
    },
  })

  if (!op) {
    throw { statusCode: 404, message: 'Ordem de produção não encontrada' }
  }

  // Idempotência: verificar se já existem reservas ativas para esta OP
  const reservasExistentes = await prisma.reservaProducao.count({
    where: { ordemProducaoId: opId, status: 'ATIVA' },
  })

  const detalhes: ResultadoReserva['detalhes'] = []
  let criadas = 0
  let ignoradas = 0

  for (const item of op.itens) {
    const necessario = Number(item.quantidade) - Number(item.quantidadeLiberada)

    // Material sem cadastro — não pode reservar
    if (!item.produtoComponenteId) {
      ignoradas++
      detalhes.push({
        produtoId: null,
        descricao: item.descricaoProduto,
        quantidade: Math.max(0, necessario),
        reservado: false,
        motivo: 'Material sem cadastro (sem produtoComponenteId)',
      })
      continue
    }

    if (necessario <= 0) {
      ignoradas++
      detalhes.push({
        produtoId: item.produtoComponenteId,
        descricao: item.descricaoProduto,
        quantidade: 0,
        reservado: false,
        motivo: 'Necessidade líquida zero',
      })
      continue
    }

    // Se já tem reservas ativas, não duplica (idempotência)
    if (reservasExistentes > 0) {
      ignoradas++
      detalhes.push({
        produtoId: item.produtoComponenteId,
        descricao: item.descricaoProduto,
        quantidade: necessario,
        reservado: false,
        motivo: 'OP já possui reservas ativas',
      })
      continue
    }

    await prisma.reservaProducao.create({
      data: {
        empresaId,
        ordemProducaoId: opId,
        produtoId: item.produtoComponenteId,
        descricao: item.descricaoProduto,
        quantidade: necessario,
        unidadeMedida: item.unidadeMedida,
        status: 'ATIVA',
      },
    })
    criadas++
    detalhes.push({
      produtoId: item.produtoComponenteId,
      descricao: item.descricaoProduto,
      quantidade: necessario,
      reservado: true,
    })
  }

  return {
    ordemProducaoId: opId,
    reservasCriadas: criadas,
    reservasIgnoradas: ignoradas,
    detalhes,
  }
}

/**
 * Cancela todas as reservas ATIVAS de uma OP (ex: ao cancelar a OP).
 */
export async function cancelarReservasOp(
  opId: string,
  empresaId: string,
): Promise<{ canceladas: number }> {
  const result = await prisma.reservaProducao.updateMany({
    where: { ordemProducaoId: opId, empresaId, status: 'ATIVA' },
    data: { status: 'CANCELADA' },
  })
  return { canceladas: result.count }
}

/**
 * Marca as reservas de uma OP como CONSUMIDAS (ex: ao concluir a produção).
 */
export async function consumirReservasOp(
  opId: string,
  empresaId: string,
): Promise<{ consumidas: number }> {
  const result = await prisma.reservaProducao.updateMany({
    where: { ordemProducaoId: opId, empresaId, status: 'ATIVA' },
    data: { status: 'CONSUMIDA' },
  })
  return { consumidas: result.count }
}
