/**
 * Serviço de Auditoria Fiscal
 *
 * Registra log imutável (append-only) de todas as operações fiscais:
 * - Emissão de documentos fiscais
 * - Cancelamento de documentos
 * - Inutilização de numeração
 * - Alteração de regras tributárias
 * - Importação de XML
 * - Carta de Correção
 *
 * Armazena: usuário, timestamp, operação, dados antes/depois, IP.
 * Impede exclusão de registros (sem delete/update).
 * Vincula regra tributária utilizada em cada item para rastreabilidade.
 *
 * Requirements: 37.1, 37.2, 37.3, 37.4
 */

import { prisma } from '../../../lib/prisma'

// === Tipos ===

/** Operações fiscais auditáveis (Req 37.1) */
export enum OperacaoAuditoria {
  EMISSAO = 'EMISSAO',
  CANCELAMENTO = 'CANCELAMENTO',
  INUTILIZACAO = 'INUTILIZACAO',
  ALTERACAO_REGRA = 'ALTERACAO_REGRA',
  IMPORTACAO_XML = 'IMPORTACAO_XML',
  CARTA_CORRECAO = 'CARTA_CORRECAO',
}

/** Entidades rastreáveis no módulo fiscal */
export enum EntidadeAuditoria {
  DOCUMENTO_FISCAL = 'DocumentoFiscal',
  REGRA_TRIBUTARIA = 'RegraTributaria',
  XML_IMPORTADO = 'XmlImportado',
  CERTIFICADO = 'Certificado',
}

/** Parâmetros para registrar uma entrada de auditoria */
export interface RegistrarAuditoriaParams {
  empresaId: string
  usuarioId: string
  operacao: OperacaoAuditoria
  entidade: EntidadeAuditoria | string
  entidadeId: string
  dadosAntes?: Record<string, unknown> | null
  dadosDepois?: Record<string, unknown> | null
  ip?: string | null
}

/** Parâmetros para vincular regra tributária a um item (rastreabilidade) */
export interface RastreabilidadeRegraParams {
  empresaId: string
  usuarioId: string
  documentoId: string
  itemId: string
  regraId: string
  valoresCalculados: Record<string, unknown>
  ip?: string | null
}

/** Filtros para consulta de registros de auditoria */
export interface FiltrosAuditoria {
  empresaId: string
  entidade?: string
  entidadeId?: string
  operacao?: OperacaoAuditoria
  usuarioId?: string
  dataInicio?: Date
  dataFim?: Date
  page?: number
  limit?: number
}

/** Registro de auditoria retornado nas consultas */
export interface RegistroAuditoria {
  id: string
  empresaId: string
  usuarioId: string
  operacao: string
  entidade: string
  entidadeId: string
  dadosAntes: Record<string, unknown> | null
  dadosDepois: Record<string, unknown> | null
  ip: string | null
  timestamp: Date
}

/** Resultado paginado de consulta */
export interface ResultadoPaginado<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

// === Serviço ===

export class AuditoriaFiscalService {
  /**
   * Registra uma operação fiscal no log de auditoria.
   * Este é o método principal — todas as operações fiscais devem chamar este método.
   *
   * O registro é append-only: uma vez criado, não pode ser alterado ou excluído (Req 37.4).
   *
   * @param params - Dados da operação a registrar
   * @returns O registro de auditoria criado
   *
   * Requirements: 37.1, 37.2
   */
  async registrar(params: RegistrarAuditoriaParams): Promise<RegistroAuditoria> {
    const {
      empresaId,
      usuarioId,
      operacao,
      entidade,
      entidadeId,
      dadosAntes,
      dadosDepois,
      ip,
    } = params

    const registro = await prisma.auditoriaFiscal.create({
      data: {
        empresaId,
        usuarioId,
        operacao,
        entidade,
        entidadeId,
        dadosAntes: dadosAntes ? JSON.stringify(dadosAntes) : null,
        dadosDepois: dadosDepois ? JSON.stringify(dadosDepois) : null,
        ip: ip || null,
      },
    })

    return this.mapearRegistro(registro)
  }

  /**
   * Registra a emissão de um documento fiscal.
   *
   * Requirements: 37.1
   */
  async registrarEmissao(params: {
    empresaId: string
    usuarioId: string
    documentoId: string
    dadosDocumento: Record<string, unknown>
    ip?: string | null
  }): Promise<RegistroAuditoria> {
    return this.registrar({
      empresaId: params.empresaId,
      usuarioId: params.usuarioId,
      operacao: OperacaoAuditoria.EMISSAO,
      entidade: EntidadeAuditoria.DOCUMENTO_FISCAL,
      entidadeId: params.documentoId,
      dadosAntes: null,
      dadosDepois: params.dadosDocumento,
      ip: params.ip,
    })
  }

  /**
   * Registra o cancelamento de um documento fiscal.
   *
   * Requirements: 37.1
   */
  async registrarCancelamento(params: {
    empresaId: string
    usuarioId: string
    documentoId: string
    dadosAntes: Record<string, unknown>
    dadosDepois: Record<string, unknown>
    ip?: string | null
  }): Promise<RegistroAuditoria> {
    return this.registrar({
      empresaId: params.empresaId,
      usuarioId: params.usuarioId,
      operacao: OperacaoAuditoria.CANCELAMENTO,
      entidade: EntidadeAuditoria.DOCUMENTO_FISCAL,
      entidadeId: params.documentoId,
      dadosAntes: params.dadosAntes,
      dadosDepois: params.dadosDepois,
      ip: params.ip,
    })
  }

  /**
   * Registra a inutilização de faixa de numeração.
   *
   * Requirements: 37.1
   */
  async registrarInutilizacao(params: {
    empresaId: string
    usuarioId: string
    entidadeId: string
    dadosInutilizacao: Record<string, unknown>
    ip?: string | null
  }): Promise<RegistroAuditoria> {
    return this.registrar({
      empresaId: params.empresaId,
      usuarioId: params.usuarioId,
      operacao: OperacaoAuditoria.INUTILIZACAO,
      entidade: EntidadeAuditoria.DOCUMENTO_FISCAL,
      entidadeId: params.entidadeId,
      dadosAntes: null,
      dadosDepois: params.dadosInutilizacao,
      ip: params.ip,
    })
  }

  /**
   * Registra a alteração de uma regra tributária.
   * Armazena dados antes e depois para comparação (Req 37.2).
   *
   * Requirements: 37.1, 37.2
   */
  async registrarAlteracaoRegra(params: {
    empresaId: string
    usuarioId: string
    regraId: string
    dadosAntes: Record<string, unknown>
    dadosDepois: Record<string, unknown>
    ip?: string | null
  }): Promise<RegistroAuditoria> {
    return this.registrar({
      empresaId: params.empresaId,
      usuarioId: params.usuarioId,
      operacao: OperacaoAuditoria.ALTERACAO_REGRA,
      entidade: EntidadeAuditoria.REGRA_TRIBUTARIA,
      entidadeId: params.regraId,
      dadosAntes: params.dadosAntes,
      dadosDepois: params.dadosDepois,
      ip: params.ip,
    })
  }

  /**
   * Registra a importação de XML de entrada.
   *
   * Requirements: 37.1
   */
  async registrarImportacaoXml(params: {
    empresaId: string
    usuarioId: string
    xmlId: string
    dadosXml: Record<string, unknown>
    ip?: string | null
  }): Promise<RegistroAuditoria> {
    return this.registrar({
      empresaId: params.empresaId,
      usuarioId: params.usuarioId,
      operacao: OperacaoAuditoria.IMPORTACAO_XML,
      entidade: EntidadeAuditoria.XML_IMPORTADO,
      entidadeId: params.xmlId,
      dadosAntes: null,
      dadosDepois: params.dadosXml,
      ip: params.ip,
    })
  }

  /**
   * Registra uma Carta de Correção.
   *
   * Requirements: 37.1
   */
  async registrarCartaCorrecao(params: {
    empresaId: string
    usuarioId: string
    documentoId: string
    dadosCartaCorrecao: Record<string, unknown>
    ip?: string | null
  }): Promise<RegistroAuditoria> {
    return this.registrar({
      empresaId: params.empresaId,
      usuarioId: params.usuarioId,
      operacao: OperacaoAuditoria.CARTA_CORRECAO,
      entidade: EntidadeAuditoria.DOCUMENTO_FISCAL,
      entidadeId: params.documentoId,
      dadosAntes: null,
      dadosDepois: params.dadosCartaCorrecao,
      ip: params.ip,
    })
  }

  /**
   * Registra rastreabilidade: vincula a regra tributária utilizada em cada item
   * de um documento fiscal, registrando quais valores foram calculados.
   *
   * Permite rastrear a origem de cada cálculo tributário (Req 37.3).
   *
   * @param params - Dados de rastreabilidade do item
   * @returns O registro de auditoria criado
   *
   * Requirements: 37.3
   */
  async registrarRastreabilidadeRegra(
    params: RastreabilidadeRegraParams
  ): Promise<RegistroAuditoria> {
    return this.registrar({
      empresaId: params.empresaId,
      usuarioId: params.usuarioId,
      operacao: OperacaoAuditoria.EMISSAO,
      entidade: EntidadeAuditoria.REGRA_TRIBUTARIA,
      entidadeId: params.regraId,
      dadosAntes: null,
      dadosDepois: {
        documentoId: params.documentoId,
        itemId: params.itemId,
        regraId: params.regraId,
        valoresCalculados: params.valoresCalculados,
      },
      ip: params.ip,
    })
  }

  // === Consultas ===

  /**
   * Lista registros de auditoria com filtros.
   * Permite filtrar por entidade, operação, usuário e período.
   *
   * @param filtros - Filtros de consulta
   * @returns Resultado paginado com registros de auditoria
   */
  async listar(filtros: FiltrosAuditoria): Promise<ResultadoPaginado<RegistroAuditoria>> {
    const page = filtros.page || 1
    const limit = filtros.limit || 50

    const where = this.construirWhere(filtros)

    const [registros, total] = await Promise.all([
      prisma.auditoriaFiscal.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditoriaFiscal.count({ where }),
    ])

    return {
      data: registros.map((r) => this.mapearRegistro(r)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }
  }

  /**
   * Obtém a trilha de auditoria completa de um documento fiscal específico.
   * Retorna todas as operações realizadas sobre o documento, em ordem cronológica.
   *
   * @param empresaId - ID da empresa
   * @param documentoId - ID do documento fiscal
   * @returns Lista ordenada de registros de auditoria do documento
   */
  async obterTrilhaDocumento(
    empresaId: string,
    documentoId: string
  ): Promise<RegistroAuditoria[]> {
    const registros = await prisma.auditoriaFiscal.findMany({
      where: {
        empresaId,
        entidadeId: documentoId,
      },
      orderBy: { timestamp: 'asc' },
    })

    return registros.map((r) => this.mapearRegistro(r))
  }

  /**
   * Obtém um registro de auditoria específico pelo ID.
   *
   * @param id - ID do registro de auditoria
   * @returns O registro encontrado ou null
   */
  async obterPorId(id: string): Promise<RegistroAuditoria | null> {
    const registro = await prisma.auditoriaFiscal.findUnique({
      where: { id },
    })

    if (!registro) return null

    return this.mapearRegistro(registro)
  }

  // === Métodos bloqueados (Req 37.4) ===

  /**
   * Exclusão de registros de auditoria é PROIBIDA.
   * Este método existe para documentar a restrição e lançar erro caso chamado.
   *
   * Requirements: 37.4
   */
  async excluir(_id: string): Promise<never> {
    throw new Error(
      'Operação proibida: registros de auditoria fiscal não podem ser excluídos (Req 37.4)'
    )
  }

  /**
   * Atualização de registros de auditoria é PROIBIDA.
   * Este método existe para documentar a restrição e lançar erro caso chamado.
   *
   * Requirements: 37.4
   */
  async atualizar(_id: string, _dados: unknown): Promise<never> {
    throw new Error(
      'Operação proibida: registros de auditoria fiscal não podem ser alterados (Req 37.4)'
    )
  }

  // === Métodos internos ===

  /**
   * Constrói o objeto where do Prisma a partir dos filtros.
   */
  private construirWhere(filtros: FiltrosAuditoria) {
    const where: Record<string, unknown> = {
      empresaId: filtros.empresaId,
    }

    if (filtros.entidade) {
      where.entidade = filtros.entidade
    }

    if (filtros.entidadeId) {
      where.entidadeId = filtros.entidadeId
    }

    if (filtros.operacao) {
      where.operacao = filtros.operacao
    }

    if (filtros.usuarioId) {
      where.usuarioId = filtros.usuarioId
    }

    if (filtros.dataInicio || filtros.dataFim) {
      const timestamp: Record<string, Date> = {}
      if (filtros.dataInicio) {
        timestamp.gte = filtros.dataInicio
      }
      if (filtros.dataFim) {
        timestamp.lte = filtros.dataFim
      }
      where.timestamp = timestamp
    }

    return where
  }

  /**
   * Mapeia um registro do Prisma para o formato de retorno,
   * parseando os campos JSON.
   */
  private mapearRegistro(registro: {
    id: string
    empresaId: string
    usuarioId: string
    operacao: string
    entidade: string
    entidadeId: string
    dadosAntes: string | null
    dadosDepois: string | null
    ip: string | null
    timestamp: Date
  }): RegistroAuditoria {
    return {
      id: registro.id,
      empresaId: registro.empresaId,
      usuarioId: registro.usuarioId,
      operacao: registro.operacao,
      entidade: registro.entidade,
      entidadeId: registro.entidadeId,
      dadosAntes: registro.dadosAntes
        ? (JSON.parse(registro.dadosAntes) as Record<string, unknown>)
        : null,
      dadosDepois: registro.dadosDepois
        ? (JSON.parse(registro.dadosDepois) as Record<string, unknown>)
        : null,
      ip: registro.ip,
      timestamp: registro.timestamp,
    }
  }
}

/** Instância singleton do serviço de auditoria fiscal */
export const auditoriaFiscalService = new AuditoriaFiscalService()
