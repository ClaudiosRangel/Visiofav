import { prisma } from '../../lib/prisma'
import type { PrismaClient, ChamadaDoca } from '@prisma/client'
import { filaService } from './fila.service'
import { portariaService } from '../portaria/portaria.service'
import { sseService } from './sse.service'

type PrismaTransaction = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

export interface SugestaoResult {
  filaId: string
  veiculoId: string
  placa: string
  motoristaNome: string
  tipoOperacao: string
  entradaEm: Date
  prioridade: number
  posicao: number
  docaId: string
  docaDescricao: string
}

export interface EmitirChamadaInput {
  veiculoId: string
  docaId: string
}

export interface EmitirChamadaResult {
  chamada: ChamadaDoca
  veiculoPlaca: string
  docaDescricao: string
}

export class ChamadaDocaService {
  /**
   * Sugere o próximo veículo da fila de espera para uma doca específica.
   * Busca o CD da doca e retorna o primeiro veículo ordenado por prioridade DESC, posicao ASC.
   * Retorna null se a fila estiver vazia.
   */
  async sugerirProximo(empresaId: string, docaId: string): Promise<SugestaoResult | null> {
    // 1. Buscar a doca para obter seu centroDistribuicaoId
    const doca = await prisma.doca.findFirst({
      where: { id: docaId, empresaId },
    })

    if (!doca) {
      const error: any = new Error('Doca não encontrada')
      error.statusCode = 404
      throw error
    }

    if (!doca.centroDistribuicaoId) {
      const error: any = new Error('Doca não possui Centro de Distribuição vinculado')
      error.statusCode = 422
      throw error
    }

    const cdId = doca.centroDistribuicaoId

    // 2. Buscar próximo veículo da FilaEsperaPatio para o CD da doca
    //    Ordenação: prioridade DESC (maior primeiro), posicao ASC (FIFO para mesma prioridade)
    const proximo = await prisma.filaEsperaPatio.findFirst({
      where: {
        empresaId,
        cdId,
      },
      orderBy: [
        { prioridade: 'desc' },
        { posicao: 'asc' },
      ],
      include: {
        veiculo: {
          select: {
            placa: true,
            motoristaNome: true,
            tipoOperacao: true,
            entradaEm: true,
          },
        },
      },
    })

    // 3. Retornar null se fila vazia
    if (!proximo) {
      return null
    }

    // 4. Retornar sugestão com detalhes do veículo e da doca
    return {
      filaId: proximo.id,
      veiculoId: proximo.veiculoId,
      placa: proximo.veiculo.placa,
      motoristaNome: proximo.veiculo.motoristaNome,
      tipoOperacao: proximo.veiculo.tipoOperacao,
      entradaEm: proximo.veiculo.entradaEm,
      prioridade: proximo.prioridade,
      posicao: proximo.posicao,
      docaId: doca.id,
      docaDescricao: doca.descricao,
    }
  }

  /**
   * Emite uma chamada à doca para um veículo da fila de espera.
   * Valida que o veículo está AGUARDANDO (senão HTTP 422).
   * Em transação: cria ChamadaDoca com status CHAMADO, atualiza VeiculoPatio.status → CHAMADO + chamadaDocaEm.
   * Após commit, emite SSE "chamada-doca" com veiculoId, placa, docaId, docaDescricao.
   */
  async emitirChamada(
    empresaId: string,
    data: EmitirChamadaInput,
    usuarioId: string,
  ): Promise<EmitirChamadaResult> {
    // 1. Buscar o veículo no pátio e validar status AGUARDANDO
    const veiculo = await prisma.veiculoPatio.findFirst({
      where: { id: data.veiculoId, empresaId },
    })

    if (!veiculo) {
      const error: any = new Error('Veículo não encontrado no pátio')
      error.statusCode = 404
      throw error
    }

    if (veiculo.status !== 'AGUARDANDO') {
      const error: any = new Error(`Veículo não está aguardando. Status atual: ${veiculo.status}`)
      error.statusCode = 422
      throw error
    }

    // 2. Validar que a doca existe e pertence à empresa
    const doca = await prisma.doca.findFirst({
      where: { id: data.docaId, empresaId },
    })

    if (!doca) {
      const error: any = new Error('Doca não encontrada')
      error.statusCode = 404
      throw error
    }

    const agora = new Date()

    // 3. Transação: criar ChamadaDoca + atualizar VeiculoPatio
    const chamada = await prisma.$transaction(async (tx) => {
      // 3.1 Criar ChamadaDoca com status CHAMADO
      const novaChamada = await tx.chamadaDoca.create({
        data: {
          empresaId,
          veiculoId: data.veiculoId,
          docaId: data.docaId,
          status: 'CHAMADO',
          chamadoEm: agora,
          chamadoPorId: usuarioId,
        },
      })

      // 3.2 Atualizar VeiculoPatio: status → CHAMADO, chamadaDocaEm → agora
      await tx.veiculoPatio.update({
        where: { id: data.veiculoId },
        data: {
          status: 'CHAMADO',
          chamadaDocaEm: agora,
        },
      })

      return novaChamada
    })

    // 4. Emitir SSE "chamada-doca" após commit bem-sucedido
    sseService.broadcast(empresaId, {
      type: 'chamada-doca',
      data: {
        veiculoId: veiculo.id,
        placa: veiculo.placa,
        docaId: doca.id,
        docaDescricao: doca.descricao,
      },
    })

    return {
      chamada,
      veiculoPlaca: veiculo.placa,
      docaDescricao: doca.descricao,
    }
  }

  /**
   * Confirma a chegada do veículo à doca.
   * Atualiza ChamadaDoca status → ATENDIDO, VeiculoPatio status → NA_DOCA,
   * remove da FilaEsperaPatio e sincroniza AgendaWms.
   */
  async confirmarChegada(empresaId: string, chamadaId: string) {
    // 1. Buscar ChamadaDoca com veículo vinculado, validando empresaId
    const chamada = await prisma.chamadaDoca.findFirst({
      where: {
        id: chamadaId,
        empresaId,
      },
      include: {
        veiculo: { select: { id: true, empresaId: true, status: true } },
      },
    })

    if (!chamada) {
      const error: any = new Error('Chamada de doca não encontrada')
      error.statusCode = 404
      throw error
    }

    // 2. Validar que a chamada está com status CHAMADO
    if (chamada.status !== 'CHAMADO') {
      const error: any = new Error(
        `Chamada não pode ser confirmada. Status atual: ${chamada.status}`,
      )
      error.statusCode = 422
      throw error
    }

    const agora = new Date()

    // 3. Transação: atualizar ChamadaDoca, VeiculoPatio, remover da fila, sincronizar AgendaWms
    const resultado = await prisma.$transaction(async (tx) => {
      // 3.1 Atualizar ChamadaDoca: status → ATENDIDO, atendidoEm → agora
      const chamadaAtualizada = await tx.chamadaDoca.update({
        where: { id: chamadaId },
        data: {
          status: 'ATENDIDO',
          atendidoEm: agora,
          tempoRespostaMin: Math.floor(
            (agora.getTime() - chamada.chamadoEm.getTime()) / 60000,
          ),
        },
      })

      // 3.2 Atualizar VeiculoPatio: status → NA_DOCA, chegadaDocaEm, docaId
      await tx.veiculoPatio.update({
        where: { id: chamada.veiculoId },
        data: {
          status: 'NA_DOCA',
          chegadaDocaEm: agora,
          docaId: chamada.docaId,
        },
      })

      // 3.3 Remover da FilaEsperaPatio
      await filaService.removerDaFila(tx, empresaId, chamada.veiculoId)

      // 3.4 Sincronizar AgendaWms.status → NA_DOCA
      await portariaService.sincronizarAgendaStatus(tx, chamada.veiculoId, 'NA_DOCA')

      return chamadaAtualizada
    })

    return resultado
  }

  /**
   * Cancela uma chamada de doca e re-insere o veículo na fila de espera.
   * Valida que a ChamadaDoca está com status CHAMADO (senão HTTP 422).
   * Em transação:
   *  - Atualiza ChamadaDoca.status → CANCELADO + motivoCancelamento + canceladoEm
   *  - Reseta VeiculoPatio.status → AGUARDANDO + limpa chamadaDocaEm
   *  - Re-insere na FilaEsperaPatio com prioridade original (ou elevada)
   */
  async cancelarChamada(
    empresaId: string,
    chamadaId: string,
    motivo: string,
  ): Promise<ChamadaDoca> {
    // 1. Buscar ChamadaDoca e validar status
    const chamada = await prisma.chamadaDoca.findFirst({
      where: { id: chamadaId, empresaId },
      include: {
        veiculo: {
          select: {
            id: true,
            cdId: true,
            tipoOperacao: true,
            agendamentoId: true,
          },
        },
      },
    })

    if (!chamada) {
      const error: any = new Error('Chamada de doca não encontrada')
      error.statusCode = 404
      throw error
    }

    if (chamada.status !== 'CHAMADO') {
      const error: any = new Error(
        `Chamada não pode ser cancelada. Status atual: ${chamada.status}`,
      )
      error.statusCode = 422
      throw error
    }

    // 2. Calcular prioridade para re-inserção (mantém original ou eleva em +1)
    const prioridade = await filaService.calcularPrioridade(
      empresaId,
      chamada.veiculo.cdId,
      chamada.veiculo.tipoOperacao,
      chamada.veiculo.agendamentoId != null,
    )
    // Eleva a prioridade em +1 para dar leve preferência ao veículo que já foi chamado
    const prioridadeElevada = prioridade + 1

    // 3. Executar transação
    const resultado = await prisma.$transaction(async (tx) => {
      // 3a. Atualizar ChamadaDoca: status → CANCELADO
      const chamadaAtualizada = await tx.chamadaDoca.update({
        where: { id: chamadaId },
        data: {
          status: 'CANCELADO',
          motivoCancelamento: motivo,
          canceladoEm: new Date(),
        },
      })

      // 3b. Resetar VeiculoPatio: status → AGUARDANDO, limpar chamadaDocaEm
      await tx.veiculoPatio.update({
        where: { id: chamada.veiculoId },
        data: {
          status: 'AGUARDANDO',
          chamadaDocaEm: null,
        },
      })

      // 3c. Re-inserir na FilaEsperaPatio com prioridade elevada
      await filaService.reinserirComPrioridade(
        tx,
        empresaId,
        chamada.veiculo.cdId,
        chamada.veiculoId,
        prioridadeElevada,
      )

      return chamadaAtualizada
    })

    return resultado
  }
}

export const chamadaDocaService = new ChamadaDocaService()
