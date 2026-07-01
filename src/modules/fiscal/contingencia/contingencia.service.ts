/**
 * Serviço de Contingência Fiscal
 *
 * Gerencia a máquina de estados de contingência por empresa:
 * Normal → Contingência → Probing → Normal
 *
 * - Ativação automática após 3 falhas consecutivas de comunicação com SEFAZ
 * - Probe periódico a cada 60s usando NfeStatusServico para detectar retorno
 * - Registro de log de entrada/saída com timestamp, motivo, modalidade e docs pendentes
 *
 * Requirements: 30.1, 30.4, 30.5
 */

import { prisma } from '../../../lib/prisma'
import { CodigoErroFiscal, ErroFiscal } from '../erros'
import {
  executarProbeContingencia,
  podeRetornarAoNormal,
  type ResultadoProbeStatus,
} from '../emissor-dfe/sefaz/sefaz-status'
import type { SefazClient, ModalidadeContingencia } from '../emissor-dfe/sefaz/tipos'

// === Tipos ===

/** Estados possíveis da máquina de estados de contingência */
export type EstadoContingencia = 'NORMAL' | 'CONTINGENCIA' | 'PROBING'

/** Estado interno de contingência por empresa */
export interface EstadoEmpresa {
  estado: EstadoContingencia
  modalidade: ModalidadeContingencia | null
  falhasConsecutivas: number
  entradaContingenciaEm: Date | null
  ultimoProbeEm: Date | null
  motivo: string | null
}

/** Resultado da tentativa de registrar falha */
export interface ResultadoRegistroFalha {
  contingenciaAtivada: boolean
  falhasConsecutivas: number
  estado: EstadoContingencia
}

/** Resultado do probe de contingência */
export interface ResultadoProbe {
  retornouAoNormal: boolean
  estado: EstadoContingencia
  probeResult: ResultadoProbeStatus
}

/** Status público da contingência para uma empresa */
export interface StatusContingencia {
  estado: EstadoContingencia
  modalidade: ModalidadeContingencia | null
  falhasConsecutivas: number
  entradaContingenciaEm: Date | null
  ultimoProbeEm: Date | null
  motivo: string | null
  documentosPendentes: number
}

// === Constantes ===

/** Número de falhas consecutivas para ativar contingência (Req 30.1) */
const MAX_FALHAS_CONSECUTIVAS = 3

/** Intervalo mínimo entre probes em milissegundos (60s - Req 30.4) */
const INTERVALO_PROBE_MS = 60_000

// === Serviço ===

export class ContingenciaService {
  /**
   * Estado em memória por empresa.
   * Chave: empresaId, Valor: estado da máquina de estados.
   */
  private estados: Map<string, EstadoEmpresa> = new Map()

  /**
   * Timers de probe por empresa (para limpeza em shutdown).
   */
  private probeTimers: Map<string, NodeJS.Timeout> = new Map()

  // === Consulta de estado ===

  /**
   * Retorna o estado atual da contingência para uma empresa.
   * Inclui contagem de documentos pendentes na fila.
   *
   * Requirements: 30.1, 30.5
   */
  async obterStatus(empresaId: string): Promise<StatusContingencia> {
    const estado = this.obterEstadoEmpresa(empresaId)

    const documentosPendentes = await prisma.filaContingencia.count({
      where: { empresaId, status: 'PENDENTE' },
    })

    return {
      estado: estado.estado,
      modalidade: estado.modalidade,
      falhasConsecutivas: estado.falhasConsecutivas,
      entradaContingenciaEm: estado.entradaContingenciaEm,
      ultimoProbeEm: estado.ultimoProbeEm,
      motivo: estado.motivo,
      documentosPendentes,
    }
  }

  /**
   * Verifica se a empresa está em modo de contingência.
   */
  estaEmContingencia(empresaId: string): boolean {
    const estado = this.obterEstadoEmpresa(empresaId)
    return estado.estado === 'CONTINGENCIA' || estado.estado === 'PROBING'
  }

  /**
   * Retorna a modalidade de contingência ativa para a empresa, ou null se em modo normal.
   */
  obterModalidade(empresaId: string): ModalidadeContingencia | null {
    const estado = this.obterEstadoEmpresa(empresaId)
    return estado.modalidade
  }

  // === Registro de falhas ===

  /**
   * Registra uma falha de comunicação com a SEFAZ.
   * Após 3 falhas consecutivas (Req 30.1), ativa contingência automaticamente.
   *
   * @param empresaId - ID da empresa
   * @param motivo - Descrição da falha (timeout, erro de conexão, etc.)
   * @param modalidade - Modalidade de contingência a usar se ativada
   * @returns Resultado indicando se a contingência foi ativada
   *
   * Requirements: 30.1
   */
  async registrarFalha(
    empresaId: string,
    motivo: string,
    modalidade: ModalidadeContingencia = 'SVC_AN'
  ): Promise<ResultadoRegistroFalha> {
    const estado = this.obterEstadoEmpresa(empresaId)

    // Se já está em contingência, apenas incrementa o contador
    if (estado.estado !== 'NORMAL') {
      estado.falhasConsecutivas++
      return {
        contingenciaAtivada: false,
        falhasConsecutivas: estado.falhasConsecutivas,
        estado: estado.estado,
      }
    }

    // Incrementar falhas consecutivas
    estado.falhasConsecutivas++

    // Verificar se atingiu o limite para ativar contingência
    if (estado.falhasConsecutivas >= MAX_FALHAS_CONSECUTIVAS) {
      await this.ativarContingencia(empresaId, motivo, modalidade)
      return {
        contingenciaAtivada: true,
        falhasConsecutivas: estado.falhasConsecutivas,
        estado: 'CONTINGENCIA',
      }
    }

    return {
      contingenciaAtivada: false,
      falhasConsecutivas: estado.falhasConsecutivas,
      estado: estado.estado,
    }
  }

  /**
   * Registra comunicação bem-sucedida com a SEFAZ.
   * Reseta o contador de falhas consecutivas.
   */
  registrarSucesso(empresaId: string): void {
    const estado = this.obterEstadoEmpresa(empresaId)
    estado.falhasConsecutivas = 0
  }

  // === Ativação / Desativação ===

  /**
   * Ativa o modo de contingência para uma empresa.
   * Registra log de entrada (Req 30.5) e inicia probe periódico.
   *
   * Requirements: 30.1, 30.5
   */
  async ativarContingencia(
    empresaId: string,
    motivo: string,
    modalidade: ModalidadeContingencia = 'SVC_AN'
  ): Promise<void> {
    const estado = this.obterEstadoEmpresa(empresaId)

    // Evitar dupla ativação
    if (estado.estado === 'CONTINGENCIA' || estado.estado === 'PROBING') {
      throw new ErroFiscal(
        CodigoErroFiscal.CONTINGENCIA_JA_ATIVA,
        'A empresa já está em modo de contingência',
        { empresaId, estadoAtual: estado.estado }
      )
    }

    const agora = new Date()

    // Atualizar estado em memória
    estado.estado = 'CONTINGENCIA'
    estado.modalidade = modalidade
    estado.entradaContingenciaEm = agora
    estado.motivo = motivo

    // Contar documentos pendentes para o log
    const documentosPendentes = await prisma.filaContingencia.count({
      where: { empresaId, status: 'PENDENTE' },
    })

    // Registrar log de ENTRADA na contingência (Req 30.5)
    await prisma.logContingencia.create({
      data: {
        empresaId,
        acao: 'ENTRADA',
        motivo,
        modalidade,
        documentosPendentes,
        timestamp: agora,
      },
    })
  }

  /**
   * Executa probe de contingência para verificar retorno da SEFAZ.
   * Se a SEFAZ responder com sucesso (cStat=107), transiciona para NORMAL.
   *
   * Deve ser chamado periodicamente (a cada 60s) enquanto em contingência.
   *
   * @param empresaId - ID da empresa
   * @param client - Cliente SEFAZ configurado
   * @param uf - UF do emitente para consulta
   * @returns Resultado do probe
   *
   * Requirements: 30.4
   */
  async executarProbe(
    empresaId: string,
    client: SefazClient,
    uf: string
  ): Promise<ResultadoProbe> {
    const estado = this.obterEstadoEmpresa(empresaId)

    // Só executa probe se estiver em contingência ou probing
    if (estado.estado === 'NORMAL') {
      return {
        retornouAoNormal: false,
        estado: 'NORMAL',
        probeResult: {
          disponivel: true,
          codigoStatus: 107,
          motivo: 'Sistema já está em modo normal',
          dataHoraConsulta: new Date(),
          uf,
          erroConexao: false,
        },
      }
    }

    // Verificar intervalo mínimo entre probes
    const agora = new Date()
    if (estado.ultimoProbeEm) {
      const elapsed = agora.getTime() - estado.ultimoProbeEm.getTime()
      if (elapsed < INTERVALO_PROBE_MS) {
        return {
          retornouAoNormal: false,
          estado: estado.estado,
          probeResult: {
            disponivel: false,
            codigoStatus: 0,
            motivo: 'Intervalo mínimo entre probes não atingido',
            dataHoraConsulta: agora,
            uf,
            erroConexao: false,
          },
        }
      }
    }

    // Transicionar para PROBING
    estado.estado = 'PROBING'
    estado.ultimoProbeEm = agora

    // Executar probe usando sefaz-status
    const probeResult = await executarProbeContingencia(client, uf)

    // Decidir se retorna ao normal
    if (podeRetornarAoNormal(probeResult)) {
      await this.desativarContingencia(empresaId)
      return {
        retornouAoNormal: true,
        estado: 'NORMAL',
        probeResult,
      }
    }

    // Permanece em contingência
    estado.estado = 'CONTINGENCIA'
    return {
      retornouAoNormal: false,
      estado: 'CONTINGENCIA',
      probeResult,
    }
  }

  /**
   * Desativa o modo de contingência e retorna ao modo normal.
   * Registra log de saída (Req 30.5).
   *
   * Requirements: 30.5
   */
  async desativarContingencia(empresaId: string): Promise<void> {
    const estado = this.obterEstadoEmpresa(empresaId)

    const agora = new Date()

    // Contar documentos pendentes para o log
    const documentosPendentes = await prisma.filaContingencia.count({
      where: { empresaId, status: 'PENDENTE' },
    })

    // Registrar log de SAÍDA da contingência (Req 30.5)
    await prisma.logContingencia.create({
      data: {
        empresaId,
        acao: 'SAIDA',
        motivo: 'SEFAZ retornou ao estado operacional (cStat=107)',
        modalidade: estado.modalidade || 'SVC_AN',
        documentosPendentes,
        timestamp: agora,
      },
    })

    // Resetar estado para normal
    estado.estado = 'NORMAL'
    estado.modalidade = null
    estado.falhasConsecutivas = 0
    estado.entradaContingenciaEm = null
    estado.motivo = null

    // Parar timer de probe se existir
    this.pararProbe(empresaId)
  }

  // === Probe periódico ===

  /**
   * Inicia o probe periódico (a cada 60s) para uma empresa em contingência.
   * O probe é executado automaticamente enquanto a empresa estiver em contingência.
   *
   * @param empresaId - ID da empresa
   * @param client - Cliente SEFAZ configurado
   * @param uf - UF do emitente
   *
   * Requirements: 30.4
   */
  iniciarProbePerodico(
    empresaId: string,
    client: SefazClient,
    uf: string
  ): void {
    // Evitar múltiplos timers para a mesma empresa
    this.pararProbe(empresaId)

    const timer = setInterval(async () => {
      try {
        const resultado = await this.executarProbe(empresaId, client, uf)
        if (resultado.retornouAoNormal) {
          this.pararProbe(empresaId)
        }
      } catch {
        // Erro no probe não deve interromper o timer — SEFAZ ainda indisponível
      }
    }, INTERVALO_PROBE_MS)

    this.probeTimers.set(empresaId, timer)
  }

  /**
   * Para o probe periódico de uma empresa.
   */
  pararProbe(empresaId: string): void {
    const timer = this.probeTimers.get(empresaId)
    if (timer) {
      clearInterval(timer)
      this.probeTimers.delete(empresaId)
    }
  }

  /**
   * Para todos os probes periódicos (para shutdown graceful).
   */
  pararTodosProbes(): void {
    for (const [empresaId] of this.probeTimers) {
      this.pararProbe(empresaId)
    }
  }

  // === Consulta de logs ===

  /**
   * Lista os logs de contingência de uma empresa.
   * Útil para auditoria e diagnóstico.
   *
   * Requirements: 30.5
   */
  async listarLogs(
    empresaId: string,
    filtros: { page: number; limit: number; acao?: 'ENTRADA' | 'SAIDA' }
  ) {
    const where: any = { empresaId }

    if (filtros.acao) {
      where.acao = filtros.acao
    }

    const [logs, total] = await Promise.all([
      prisma.logContingencia.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip: (filtros.page - 1) * filtros.limit,
        take: filtros.limit,
      }),
      prisma.logContingencia.count({ where }),
    ])

    return {
      data: logs,
      total,
      page: filtros.page,
      limit: filtros.limit,
      totalPages: Math.ceil(total / filtros.limit),
    }
  }

  // === Métodos internos ===

  /**
   * Obtém ou inicializa o estado em memória para uma empresa.
   */
  private obterEstadoEmpresa(empresaId: string): EstadoEmpresa {
    let estado = this.estados.get(empresaId)

    if (!estado) {
      estado = {
        estado: 'NORMAL',
        modalidade: null,
        falhasConsecutivas: 0,
        entradaContingenciaEm: null,
        ultimoProbeEm: null,
        motivo: null,
      }
      this.estados.set(empresaId, estado)
    }

    return estado
  }
}

/** Instância singleton do serviço de contingência */
export const contingenciaService = new ContingenciaService()
