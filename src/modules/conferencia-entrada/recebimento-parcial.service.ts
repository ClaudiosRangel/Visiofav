import { Decimal } from '@prisma/client/runtime/library'
import { prisma } from '../../lib/prisma'

// =========================================================================
// Recebimento Parcial — Serviço de lógica de negócio
// Requirements: 6.2, 6.3, 6.4, 6.5, 6.6
// =========================================================================

export interface AvaliacaoRecebimentoParcial {
  tipo: 'PARCIAL_ACEITO' | 'DIVERGENCIA_PADRAO'
  saldoPendente?: number
  quantidadeConferida: number
  quantidadeNf: number
}

export interface RegistrarSaldoParams {
  empresaId: string
  notaEntradaId: string
  itemNotaEntradaId: string
  quantidadeNf: number
  quantidadeRecebida: number
}

export interface ReceberSaldoResult {
  saldoAtualizado: number
  completou: boolean
}

/**
 * Avalia se um recebimento parcial deve ser aceito ou tratado como divergência.
 *
 * - Se config `permiteRecebimentoParcial` ativa e qtd conferida < qtd NF → aceitar parcial e calcular saldo
 * - Se config inativa e qtd conferida ≠ qtd NF → tratar como divergência padrão
 *
 * Validates: Requirements 6.2, 6.5
 */
export function avaliarRecebimentoParcial(
  quantidadeConferida: number,
  quantidadeNf: number,
  permiteRecebimentoParcial: boolean,
): AvaliacaoRecebimentoParcial {
  if (permiteRecebimentoParcial && quantidadeConferida < quantidadeNf) {
    const saldo = quantidadeNf - quantidadeConferida
    return {
      tipo: 'PARCIAL_ACEITO',
      saldoPendente: saldo,
      quantidadeConferida,
      quantidadeNf,
    }
  }

  if (!permiteRecebimentoParcial && quantidadeConferida !== quantidadeNf) {
    return {
      tipo: 'DIVERGENCIA_PADRAO',
      quantidadeConferida,
      quantidadeNf,
    }
  }

  // Quantidade igual → sem divergência (não é parcial, conferência conforme)
  return {
    tipo: 'PARCIAL_ACEITO',
    quantidadeConferida,
    quantidadeNf,
  }
}

/**
 * Registra um saldo pendente para recebimento futuro.
 * Cria um SaldoPendenteItem com saldo = quantidadeNf - quantidadeRecebida.
 * Atualiza o status da nota para "PARCIALMENTE_RECEBIDO".
 *
 * Validates: Requirements 6.3, 6.4
 */
export async function registrarSaldoPendente(params: RegistrarSaldoParams) {
  const { empresaId, notaEntradaId, itemNotaEntradaId, quantidadeNf, quantidadeRecebida } = params
  const saldo = quantidadeNf - quantidadeRecebida

  const saldoPendente = await prisma.saldoPendenteItem.create({
    data: {
      empresaId,
      notaEntradaId,
      itemNotaEntradaId,
      quantidadeNf: new Decimal(quantidadeNf),
      quantidadeRecebida: new Decimal(quantidadeRecebida),
      saldoPendente: new Decimal(saldo),
      status: 'PENDENTE',
    },
  })

  // Atualizar status da nota para PARCIALMENTE_RECEBIDO
  await prisma.notaEntrada.update({
    where: { id: notaEntradaId },
    data: { statusRecebimento: 'PARCIALMENTE_RECEBIDO' },
  })

  return saldoPendente
}

/**
 * Recebe saldo pendente de um item previamente recebido parcialmente.
 * Atualiza a quantidade recebida e recalcula o saldo.
 * Se saldo chegar a zero, marca como RECEBIDO.
 *
 * Validates: Requirements 6.5
 */
export async function receberSaldo(
  saldoPendenteId: string,
  quantidadeRecebida: number,
): Promise<ReceberSaldoResult> {
  const saldoItem = await prisma.saldoPendenteItem.findUniqueOrThrow({
    where: { id: saldoPendenteId },
  })

  const quantidadeRecebidaAtual = Number(saldoItem.quantidadeRecebida)
  const novaQuantidadeRecebida = quantidadeRecebidaAtual + quantidadeRecebida
  const novoSaldo = Number(saldoItem.quantidadeNf) - novaQuantidadeRecebida
  const completou = novoSaldo <= 0

  await prisma.saldoPendenteItem.update({
    where: { id: saldoPendenteId },
    data: {
      quantidadeRecebida: new Decimal(novaQuantidadeRecebida),
      saldoPendente: new Decimal(Math.max(novoSaldo, 0)),
      status: completou ? 'RECEBIDO' : 'PENDENTE',
    },
  })

  return {
    saldoAtualizado: Math.max(novoSaldo, 0),
    completou,
  }
}

/**
 * Verifica se todos os saldos pendentes de uma nota foram recebidos.
 * Se sim, atualiza o status da nota para "CONFERIDA".
 *
 * Validates: Requirements 6.6
 */
export async function verificarNotaCompleta(notaEntradaId: string): Promise<boolean> {
  const saldosPendentes = await prisma.saldoPendenteItem.findMany({
    where: { notaEntradaId },
  })

  // Se não há saldos pendentes, não há o que verificar
  if (saldosPendentes.length === 0) return false

  const todosRecebidos = saldosPendentes.every((s) => s.status === 'RECEBIDO')

  if (todosRecebidos) {
    await prisma.notaEntrada.update({
      where: { id: notaEntradaId },
      data: { statusRecebimento: 'CONFERIDA' },
    })
    return true
  }

  return false
}
