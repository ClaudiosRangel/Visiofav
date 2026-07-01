/**
 * Fila de Contingência Fiscal
 *
 * Gerencia a fila de documentos fiscais pendentes de retransmissão.
 * - Limite de 500 documentos por empresa
 * - Retransmissão em ordem FIFO (criadoEm ASC)
 * - Marca falha individual após 3 tentativas sem afetar os demais
 * - Notifica operador sobre falhas de retransmissão
 *
 * Requirements: 30.3, 30.6
 */

import { prisma } from '../../../lib/prisma'
import { CodigoErroFiscal, ErroFiscal } from '../erros'

// === Constantes ===

const LIMITE_FILA_POR_EMPRESA = 500
const MAX_TENTATIVAS_RETRANSMISSAO = 3

// === Tipos ===

export interface EnfileirarParams {
  empresaId: string
  documentoFiscalId: string
  xmlAssinado: string
  tipoContingencia: string
}

export interface ItemFila {
  id: string
  empresaId: string
  documentoFiscalId: string
  xmlAssinado: string
  tipoContingencia: string
  tentativas: number
  status: string
  erro: string | null
  criadoEm: Date
  transmitidoEm: Date | null
}

export interface ResultadoRetransmissao {
  id: string
  documentoFiscalId: string
  sucesso: boolean
  protocolo?: string
  erro?: string
}

export interface NotificacaoFalha {
  empresaId: string
  documentoFiscalId: string
  tentativas: number
  ultimoErro: string
  timestamp: Date
}

/**
 * Função de transmissão injetável para desacoplamento.
 * Recebe o XML assinado e retorna protocolo em caso de sucesso ou lança erro.
 */
export type TransmitirFn = (xmlAssinado: string) => Promise<{ protocolo: string }>

/**
 * Callback de notificação ao operador sobre falhas de retransmissão.
 */
export type NotificarOperadorFn = (notificacao: NotificacaoFalha) => Promise<void>

// === Classe Principal ===

export class FilaContingenciaService {
  private notificarOperador: NotificarOperadorFn

  constructor(notificarOperador?: NotificarOperadorFn) {
    this.notificarOperador = notificarOperador ?? defaultNotificarOperador
  }

  /**
   * Enfileira um documento para retransmissão posterior.
   * Respeita o limite de 500 documentos pendentes por empresa.
   *
   * @throws ErroFiscal(FILA_CONTINGENCIA_CHEIA) se o limite for atingido
   */
  async enfileirar(params: EnfileirarParams): Promise<ItemFila> {
    const { empresaId, documentoFiscalId, xmlAssinado, tipoContingencia } = params

    // Verificar limite de 500 documentos pendentes por empresa
    const countPendentes = await prisma.filaContingencia.count({
      where: {
        empresaId,
        status: 'PENDENTE',
      },
    })

    if (countPendentes >= LIMITE_FILA_POR_EMPRESA) {
      throw new ErroFiscal(
        CodigoErroFiscal.FILA_CONTINGENCIA_CHEIA,
        `Fila de contingência atingiu o limite de ${LIMITE_FILA_POR_EMPRESA} documentos pendentes para esta empresa`,
        { empresaId, limiteAtual: countPendentes },
      )
    }

    const item = await prisma.filaContingencia.create({
      data: {
        empresaId,
        documentoFiscalId,
        xmlAssinado,
        tipoContingencia,
        tentativas: 0,
        status: 'PENDENTE',
      },
    })

    return this.mapToItemFila(item)
  }

  /**
   * Retransmite documentos pendentes em ordem FIFO.
   * Cada documento é processado individualmente — falha de um não afeta os demais.
   * Marca como FALHA após 3 tentativas e notifica o operador.
   */
  async retransmitir(
    empresaId: string,
    transmitirFn: TransmitirFn,
  ): Promise<ResultadoRetransmissao[]> {
    // Buscar documentos pendentes em ordem FIFO (criadoEm ASC)
    const pendentes = await prisma.filaContingencia.findMany({
      where: {
        empresaId,
        status: 'PENDENTE',
      },
      orderBy: {
        criadoEm: 'asc',
      },
    })

    const resultados: ResultadoRetransmissao[] = []

    for (const item of pendentes) {
      const resultado = await this.tentarRetransmitirItem(item, transmitirFn)
      resultados.push(resultado)
    }

    return resultados
  }

  /**
   * Consulta documentos na fila de uma empresa com paginação.
   */
  async consultarFila(
    empresaId: string,
    filtros?: { status?: string; page?: number; limit?: number },
  ) {
    const page = filtros?.page ?? 1
    const limit = filtros?.limit ?? 50
    const skip = (page - 1) * limit

    const where: Record<string, unknown> = { empresaId }
    if (filtros?.status) {
      where.status = filtros.status
    }

    const [data, total] = await Promise.all([
      prisma.filaContingencia.findMany({
        where,
        skip,
        take: limit,
        orderBy: { criadoEm: 'asc' },
      }),
      prisma.filaContingencia.count({ where }),
    ])

    return {
      data: data.map((item) => this.mapToItemFila(item)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }
  }

  /**
   * Retorna a quantidade de documentos pendentes na fila de uma empresa.
   */
  async contarPendentes(empresaId: string): Promise<number> {
    return prisma.filaContingencia.count({
      where: {
        empresaId,
        status: 'PENDENTE',
      },
    })
  }

  // === Métodos privados ===

  /**
   * Tenta retransmitir um único item da fila.
   * Se falhar, incrementa tentativas. Se atingir 3 tentativas, marca FALHA e notifica.
   * Falha de um documento NÃO afeta os demais (isolamento por try/catch individual).
   */
  private async tentarRetransmitirItem(
    item: Record<string, unknown>,
    transmitirFn: TransmitirFn,
  ): Promise<ResultadoRetransmissao> {
    const id = item.id as string
    const documentoFiscalId = item.documentoFiscalId as string
    const xmlAssinado = item.xmlAssinado as string
    const tentativasAtuais = (item.tentativas as number) + 1
    const empresaId = item.empresaId as string

    try {
      const { protocolo } = await transmitirFn(xmlAssinado)

      // Sucesso: marcar como transmitido
      await prisma.filaContingencia.update({
        where: { id },
        data: {
          status: 'TRANSMITIDO',
          tentativas: tentativasAtuais,
          transmitidoEm: new Date(),
          erro: null,
        },
      })

      // Atualizar status do documento fiscal
      await prisma.documentoFiscal.update({
        where: { id: documentoFiscalId },
        data: {
          status: 'AUTORIZADO',
          protocolo,
          dataAutorizacao: new Date(),
        },
      })

      return {
        id,
        documentoFiscalId,
        sucesso: true,
        protocolo,
      }
    } catch (err) {
      const mensagemErro = err instanceof Error ? err.message : 'Erro desconhecido'

      if (tentativasAtuais >= MAX_TENTATIVAS_RETRANSMISSAO) {
        // Atingiu limite de tentativas — marcar como FALHA
        await prisma.filaContingencia.update({
          where: { id },
          data: {
            status: 'FALHA',
            tentativas: tentativasAtuais,
            erro: mensagemErro,
          },
        })

        // Atualizar status do documento fiscal
        await prisma.documentoFiscal.update({
          where: { id: documentoFiscalId },
          data: {
            status: 'FALHA_RETRANSMISSAO',
          },
        })

        // Notificar operador sobre a falha
        await this.notificarOperador({
          empresaId,
          documentoFiscalId,
          tentativas: tentativasAtuais,
          ultimoErro: mensagemErro,
          timestamp: new Date(),
        })
      } else {
        // Ainda tem tentativas restantes — incrementar contador
        await prisma.filaContingencia.update({
          where: { id },
          data: {
            tentativas: tentativasAtuais,
            erro: mensagemErro,
          },
        })
      }

      return {
        id,
        documentoFiscalId,
        sucesso: false,
        erro: mensagemErro,
      }
    }
  }

  /**
   * Mapeia registro Prisma para tipo de domínio ItemFila.
   */
  private mapToItemFila(record: Record<string, unknown>): ItemFila {
    return {
      id: record.id as string,
      empresaId: record.empresaId as string,
      documentoFiscalId: record.documentoFiscalId as string,
      xmlAssinado: record.xmlAssinado as string,
      tipoContingencia: record.tipoContingencia as string,
      tentativas: record.tentativas as number,
      status: record.status as string,
      erro: (record.erro as string) ?? null,
      criadoEm: record.criadoEm as Date,
      transmitidoEm: (record.transmitidoEm as Date) ?? null,
    }
  }
}

// === Notificação padrão (log) ===

/**
 * Implementação padrão de notificação ao operador.
 * Em produção, pode ser substituída por email, websocket, push notification, etc.
 */
async function defaultNotificarOperador(notificacao: NotificacaoFalha): Promise<void> {
  console.warn(
    `[FISCAL-CONTINGENCIA] Falha de retransmissão - ` +
    `Empresa: ${notificacao.empresaId}, ` +
    `Documento: ${notificacao.documentoFiscalId}, ` +
    `Tentativas: ${notificacao.tentativas}, ` +
    `Erro: ${notificacao.ultimoErro}`,
  )
}

// === Instância singleton ===

export const filaContingenciaService = new FilaContingenciaService()
