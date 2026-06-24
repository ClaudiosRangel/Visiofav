import { prisma } from '../../lib/prisma'
import type { PrismaClient, FilaEsperaPatio } from '@prisma/client'

type PrismaTransaction = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

export class FilaService {
  /**
   * Calcula a prioridade de um veículo baseado na ConfigPatio do CD.
   * - Se agendado: prioridadeAgendado
   * - Se walk-in DESCARGA: prioridadeDescarga
   * - Se walk-in CARGA: prioridadeCarga
   * - Outros: prioridadePadrao
   */
  async calcularPrioridade(
    empresaId: string,
    cdId: string,
    tipoOperacao: string,
    isAgendado: boolean,
  ): Promise<number> {
    const config = await prisma.configPatio.findUnique({
      where: {
        empresaId_cdId: { empresaId, cdId },
      },
    })

    // Defaults caso ConfigPatio não exista para o CD
    const prioridadeAgendado = config?.prioridadeAgendado ?? 10
    const prioridadeDescarga = config?.prioridadeDescarga ?? 5
    const prioridadeCarga = config?.prioridadeCarga ?? 3
    const prioridadePadrao = config?.prioridadePadrao ?? 1

    if (isAgendado) {
      return prioridadeAgendado
    }

    switch (tipoOperacao) {
      case 'DESCARGA':
        return prioridadeDescarga
      case 'CARGA':
        return prioridadeCarga
      default:
        return prioridadePadrao
    }
  }

  /**
   * Insere um veículo na fila de espera na próxima posição disponível para o CD.
   * posicao = max(posicao para o CD) + 1
   */
  async inserirNaFila(
    tx: PrismaTransaction,
    empresaId: string,
    cdId: string,
    veiculoId: string,
    prioridade: number,
  ): Promise<FilaEsperaPatio> {
    const ultimaPosicao = await tx.filaEsperaPatio.aggregate({
      where: { empresaId, cdId },
      _max: { posicao: true },
    })
    const novaPosicao = (ultimaPosicao._max.posicao ?? 0) + 1

    const fila = await tx.filaEsperaPatio.create({
      data: {
        empresaId,
        cdId,
        veiculoId,
        posicao: novaPosicao,
        prioridade,
        entradaFilaEm: new Date(),
      },
    })

    return fila
  }

  /**
   * Remove um veículo da fila de espera.
   */
  async removerDaFila(
    tx: PrismaTransaction,
    empresaId: string,
    veiculoId: string,
  ): Promise<void> {
    await tx.filaEsperaPatio.deleteMany({
      where: { veiculoId, empresaId },
    })
  }

  /**
   * Re-insere um veículo na fila com prioridade elevada.
   * Usado após cancelamento de chamada de doca para reposicionar o veículo.
   */
  async reinserirComPrioridade(
    tx: PrismaTransaction,
    empresaId: string,
    cdId: string,
    veiculoId: string,
    prioridade: number,
  ): Promise<FilaEsperaPatio> {
    // Remove caso ainda exista (segurança)
    await this.removerDaFila(tx, empresaId, veiculoId)

    // Re-insere com a prioridade especificada na próxima posição
    return this.inserirNaFila(tx, empresaId, cdId, veiculoId, prioridade)
  }
}

export const filaService = new FilaService()
