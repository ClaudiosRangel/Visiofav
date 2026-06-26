import { prisma } from '../../lib/prisma'

// Tipos válidos de pendência
export type TipoPendencia = 'LOTE' | 'VALIDADE'

// Status válidos de pendência
export type StatusPendencia = 'AGUARDANDO_CCE' | 'RESOLVIDA' | 'CANCELADA'

// Motivos mapeados por tipo
const MOTIVO_POR_TIPO: Record<TipoPendencia, string> = {
  LOTE: 'Aguardando CCE de lote',
  VALIDADE: 'Aguardando CCE de validade',
}

// Interface para criação de pendência
export interface CriarPendenciaInput {
  empresaId: string
  notaEntradaId: string
  codigoProduto: string
  descricaoProduto: string
  fornecedor: string
  tipo: TipoPendencia
}

// Interface para filtros de listagem
export interface FiltrosPendencia {
  fornecedor?: string
  dataInicio?: Date
  dataFim?: Date
  status?: string
}

/**
 * Cria uma pendência CC-e com status AGUARDANDO_CCE.
 * O motivo é definido automaticamente com base no tipo (LOTE ou VALIDADE).
 */
export async function criarPendencia(dados: CriarPendenciaInput) {
  const motivo = MOTIVO_POR_TIPO[dados.tipo]

  const pendencia = await prisma.pendenciaCce.create({
    data: {
      empresaId: dados.empresaId,
      notaEntradaId: dados.notaEntradaId,
      codigoProduto: dados.codigoProduto,
      descricaoProduto: dados.descricaoProduto,
      fornecedor: dados.fornecedor,
      tipo: dados.tipo,
      motivo,
      status: 'AGUARDANDO_CCE',
    },
  })

  return pendencia
}

/**
 * Lista pendências de uma empresa com filtros opcionais.
 * - fornecedor: busca parcial case-insensitive (contains + mode insensitive)
 * - dataInicio/dataFim: filtro por intervalo em criadoEm
 * - status: match exato
 * Ordenação por criadoEm desc (mais recentes primeiro).
 */
export async function listarPendencias(empresaId: string, filtros: FiltrosPendencia = {}) {
  const where: any = { empresaId }

  if (filtros.fornecedor) {
    where.fornecedor = {
      contains: filtros.fornecedor,
      mode: 'insensitive',
    }
  }

  if (filtros.dataInicio || filtros.dataFim) {
    where.criadoEm = {}
    if (filtros.dataInicio) {
      where.criadoEm.gte = filtros.dataInicio
    }
    if (filtros.dataFim) {
      where.criadoEm.lte = filtros.dataFim
    }
  }

  if (filtros.status) {
    where.status = filtros.status
  }

  const pendencias = await prisma.pendenciaCce.findMany({
    where,
    orderBy: { criadoEm: 'desc' },
  })

  return pendencias
}

/**
 * Resolve uma pendência (status → RESOLVIDA ou CANCELADA).
 * Valida:
 * - Pendência existe (404 se não encontrada)
 * - Pendência está em AGUARDANDO_CCE (409 se já processada)
 * Registra resolvidoEm e resolvidoPorId.
 */
export async function resolverPendencia(
  id: string,
  novoStatus: 'RESOLVIDA' | 'CANCELADA',
  resolvidoPorId: string,
) {
  const pendencia = await prisma.pendenciaCce.findUnique({
    where: { id },
  })

  if (!pendencia) {
    return {
      erro: {
        status: 404,
        code: 'PENDENCIA_NAO_ENCONTRADA',
        message: 'Pendência não encontrada',
      },
    }
  }

  if (pendencia.status !== 'AGUARDANDO_CCE') {
    return {
      erro: {
        status: 409,
        code: 'PENDENCIA_JA_PROCESSADA',
        message: 'Esta pendência já foi processada',
      },
    }
  }

  const atualizada = await prisma.pendenciaCce.update({
    where: { id },
    data: {
      status: novoStatus,
      resolvidoEm: new Date(),
      resolvidoPorId,
    },
  })

  return { data: atualizada }
}

/**
 * Verifica se existem pendências AGUARDANDO_CCE para uma nota de entrada.
 * Retorna true se há pelo menos uma pendência aberta.
 */
export async function verificarPendenciasAbertas(notaEntradaId: string): Promise<boolean> {
  const count = await prisma.pendenciaCce.count({
    where: {
      notaEntradaId,
      status: 'AGUARDANDO_CCE',
    },
  })

  return count > 0
}
