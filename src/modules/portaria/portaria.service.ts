import { prisma } from '../../lib/prisma'
import type { PrismaClient } from '@prisma/client'
import { filaService } from '../patio/fila.service'

type PrismaTransaction = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

export interface CheckInInput {
  placa: string
  motorista: string
  motoristaDocumento?: string
  tipoOperacao?: string
  qtdCaixas?: number
  qtdPaletes?: number
  observacao?: string
  cdId?: string
}

export interface CheckInResult {
  agendamento: any
  veiculo: any
  filaPosicao: { posicao: number; prioridade: number }
  notaEntradaId: string | null
}

export class PortariaService {
  /**
   * conferirCheckin: Check-in integrado que valida AgendaWms AGENDADO,
   * rejeita duplicidade de placa no pátio (409), e em uma transação:
   * - Atualiza AgendaWms status → ESPERA + horaChegadaReal
   * - Cria VeiculoPatio com status AGUARDANDO
   * - Insere FilaEsperaPatio via FilaService
   */
  async conferirCheckin(
    empresaId: string,
    agendamentoId: string,
    data: CheckInInput,
    usuarioId: string,
  ): Promise<CheckInResult> {
    // 1. Buscar AgendaWms e validar status AGENDADO
    const ag = await prisma.agendaWms.findFirst({
      where: { id: agendamentoId, empresaId },
    })

    if (!ag) {
      const error: any = new Error('Agendamento não encontrado')
      error.statusCode = 404
      throw error
    }

    if (ag.status !== 'AGENDADO') {
      const error: any = new Error(`Agendamento não está AGENDADO. Status atual: ${ag.status}`)
      error.statusCode = 422
      throw error
    }

    const placaNormalizada = data.placa.toUpperCase()

    // 2. Validar duplicidade: veículo com mesma placa e status != LIBERADO
    const veiculoExistente = await prisma.veiculoPatio.findFirst({
      where: {
        empresaId,
        placa: placaNormalizada,
        status: { not: 'LIBERADO' },
      },
    })

    if (veiculoExistente) {
      const error: any = new Error(`Veículo com placa ${placaNormalizada} já está no pátio`)
      error.statusCode = 409
      throw error
    }

    // 3. Resolver cdId: do body, da doca do agendamento, ou primeiro CD da empresa
    let cdId = data.cdId
    if (!cdId && ag.docaId) {
      const doca = await prisma.doca.findUnique({
        where: { id: ag.docaId },
        select: { centroDistribuicaoId: true },
      })
      cdId = doca?.centroDistribuicaoId ?? undefined
    }
    if (!cdId) {
      const cd = await prisma.centroDistribuicao.findFirst({
        where: { empresaId, status: true },
        select: { id: true },
      })
      if (!cd) {
        const error: any = new Error('Nenhum Centro de Distribuição encontrado para a empresa')
        error.statusCode = 422
        throw error
      }
      cdId = cd.id
    }

    // 4. Calcular prioridade (isAgendado = true, pois vem de AgendaWms)
    const tipoOperacao = data.tipoOperacao || 'DESCARGA'
    const prioridade = await filaService.calcularPrioridade(
      empresaId,
      cdId,
      tipoOperacao,
      true, // isAgendado
    )

    // 5. Transação: atualizar AgendaWms + criar VeiculoPatio + inserir na fila
    const result = await prisma.$transaction(async (tx) => {
      // Atualizar AgendaWms: status → ESPERA, horaChegadaReal → now
      const atualizado = await tx.agendaWms.update({
        where: { id: agendamentoId },
        data: {
          placa: placaNormalizada,
          motorista: data.motorista,
          qtdCaixas: data.qtdCaixas,
          qtdPaletes: data.qtdPaletes,
          observacao: data.observacao || ag.observacao,
          status: 'ESPERA',
          horaChegadaReal: new Date(),
        },
      })

      // Criar VeiculoPatio com status AGUARDANDO
      const veiculo = await tx.veiculoPatio.create({
        data: {
          empresaId,
          cdId: cdId!,
          placa: placaNormalizada,
          motoristaNome: data.motorista,
          motoristaDocumento: data.motoristaDocumento || '',
          tipoOperacao,
          agendamentoId: ag.id,
          status: 'AGUARDANDO',
          entradaEm: new Date(),
          criadoPorId: usuarioId,
        },
      })

      // Inserir na FilaEsperaPatio via FilaService
      const fila = await filaService.inserirNaFila(
        tx,
        empresaId,
        cdId!,
        veiculo.id,
        prioridade,
      )

      return { atualizado, veiculo, fila }
    })

    return {
      agendamento: result.atualizado,
      veiculo: result.veiculo,
      filaPosicao: {
        posicao: result.fila.posicao,
        prioridade: result.fila.prioridade,
      },
      notaEntradaId: null,
    }
  }

  /**
   * Sincroniza o status do AgendaWms baseado na transição do VeiculoPatio.
   * Mapeamento: AGUARDANDO→ESPERA, NA_DOCA→NA_DOCA, CONFERINDO→CONFERINDO, CONFERIDO→CONFERIDO, LIBERADO→RECEBIDO
   * Pula se agendamentoId é null (walk-in).
   */
  async sincronizarAgendaStatus(
    tx: PrismaTransaction,
    veiculoId: string,
    novoStatus: string,
  ): Promise<void> {
    const veiculo = await tx.veiculoPatio.findUnique({
      where: { id: veiculoId },
      select: { agendamentoId: true, tempoPermMinutos: true },
    })

    if (!veiculo?.agendamentoId) return // Walk-in: sem sincronização

    const mapeamento: Record<string, string> = {
      AGUARDANDO: 'ESPERA',
      CHAMADO: 'ESPERA',
      NA_DOCA: 'NA_DOCA',
      CONFERINDO: 'CONFERINDO',
      CONFERIDO: 'CONFERIDO',
      LIBERADO: 'RECEBIDO',
    }

    const statusAgenda = mapeamento[novoStatus]
    if (!statusAgenda) return

    const updateData: any = { status: statusAgenda }

    // Setar tempoPermDocaMin quando liberado
    if (novoStatus === 'LIBERADO' && veiculo.tempoPermMinutos != null) {
      updateData.tempoPermDocaMin = veiculo.tempoPermMinutos
    }

    await tx.agendaWms.update({
      where: { id: veiculo.agendamentoId },
      data: updateData,
    })
  }
}

export const portariaService = new PortariaService()
