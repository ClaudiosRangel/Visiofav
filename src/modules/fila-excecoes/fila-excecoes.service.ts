/**
 * Fila de Exceções — agrega, para resolução assíncrona por um Supervisor,
 * três origens de exceção de conferência de entrada que hoje ficam dispersas:
 *   - Itens ItemNotaEntrada com statusConferencia = HOLD
 *   - PendenciaCce com status = AGUARDANDO_CCE
 *   - Itens PENDENTE_SEGUNDA_CONFERENCIA cujo produto tem aceitarSenha=true
 *     (aguardando autorização de supervisor, ainda não solicitada)
 *
 * Não é uma tabela própria — é uma visão composta sobre dados já existentes.
 */

import { prisma } from '../../lib/prisma'

export type TipoExcecao = 'HOLD' | 'CCE' | 'SENHA'

export interface ItemFilaExcecoes {
  id: string
  /** Identificador real da origem (itemNotaEntradaId para HOLD/SENHA, pendenciaId para CCE) — usado nas ações de resolução */
  origemId: string
  tipo: TipoExcecao
  notaEntradaId: string
  notaNumero: number
  fornecedor: string | null
  itemNotaEntradaId: string | null
  descricaoProduto: string
  motivo: string
  motivoDetalhe: string | null
  criadoEm: Date
}

export interface FiltrosFilaExcecoes {
  fornecedor?: string
  notaId?: string
  tipo?: TipoExcecao
  dataInicio?: Date
  dataFim?: Date
}

function dentroDoIntervalo(data: Date, dataInicio?: Date, dataFim?: Date): boolean {
  if (dataInicio && data < dataInicio) return false
  if (dataFim && data > dataFim) return false
  return true
}

function combinaFornecedor(fornecedor: string | null, filtro?: string): boolean {
  if (!filtro) return true
  if (!fornecedor) return false
  return fornecedor.toLowerCase().includes(filtro.toLowerCase())
}

const MOTIVO_LABEL: Record<string, string> = {
  ERRO_CONTAGEM_FORNECEDOR: 'Erro de contagem do fornecedor',
  AVARIA_TRANSPORTE: 'Avaria no transporte',
  ERRO_ETIQUETAGEM: 'Erro de etiquetagem',
  AGUARDANDO_CCE_FORNECEDOR: 'Aguardando CC-e do fornecedor',
  DIVERGENCIA_LOTE_FORNECEDOR: 'Divergência de lote do fornecedor',
  OUTRO: 'Outro',
}

export async function listarFilaExcecoes(
  empresaId: string,
  filtros: FiltrosFilaExcecoes = {},
): Promise<ItemFilaExcecoes[]> {
  const resultado: ItemFilaExcecoes[] = []

  // ─── 1. Itens em HOLD ──────────────────────────────────────────────────
  if (!filtros.tipo || filtros.tipo === 'HOLD') {
    const itensHold = await prisma.itemNotaEntrada.findMany({
      where: {
        statusConferencia: 'HOLD',
        notaEntrada: { empresaId, ...(filtros.notaId ? { id: filtros.notaId } : {}) },
      },
      include: { notaEntrada: { select: { id: true, numero: true, fornecedor: true } } },
    })
    for (const item of itensHold) {
      if (!item.holdCriadoEm) continue
      if (!dentroDoIntervalo(item.holdCriadoEm, filtros.dataInicio, filtros.dataFim)) continue
      if (!combinaFornecedor(item.notaEntrada.fornecedor, filtros.fornecedor)) continue
      resultado.push({
        id: `hold-${item.id}`,
        origemId: item.id,
        tipo: 'HOLD',
        notaEntradaId: item.notaEntrada.id,
        notaNumero: item.notaEntrada.numero,
        fornecedor: item.notaEntrada.fornecedor,
        itemNotaEntradaId: item.id,
        descricaoProduto: item.descricao,
        motivo: item.holdMotivo ? (MOTIVO_LABEL[item.holdMotivo] ?? item.holdMotivo) : 'Sem motivo',
        motivoDetalhe: item.holdMotivoDetalhe,
        criadoEm: item.holdCriadoEm,
      })
    }
  }

  // ─── 2. Pendências CC-e abertas ────────────────────────────────────────
  if (!filtros.tipo || filtros.tipo === 'CCE') {
    const pendencias = await prisma.pendenciaCce.findMany({
      where: {
        empresaId,
        status: 'AGUARDANDO_CCE',
        ...(filtros.notaId ? { notaEntradaId: filtros.notaId } : {}),
        ...(filtros.fornecedor ? { fornecedor: { contains: filtros.fornecedor, mode: 'insensitive' } } : {}),
        ...(filtros.dataInicio || filtros.dataFim
          ? { criadoEm: { ...(filtros.dataInicio ? { gte: filtros.dataInicio } : {}), ...(filtros.dataFim ? { lte: filtros.dataFim } : {}) } }
          : {}),
      },
      include: { notaEntrada: { select: { numero: true } } },
    })
    for (const p of pendencias) {
      resultado.push({
        id: `cce-${p.id}`,
        origemId: p.id,
        tipo: 'CCE',
        notaEntradaId: p.notaEntradaId,
        notaNumero: p.notaEntrada.numero,
        fornecedor: p.fornecedor,
        itemNotaEntradaId: null,
        descricaoProduto: p.descricaoProduto,
        motivo: p.motivo,
        motivoDetalhe: null,
        criadoEm: p.criadoEm,
      })
    }
  }

  // ─── 3. Itens PENDENTE_SEGUNDA_CONFERENCIA aguardando senha ────────────
  if (!filtros.tipo || filtros.tipo === 'SENHA') {
    const itensPendentes = await prisma.itemNotaEntrada.findMany({
      where: {
        statusConferencia: 'PENDENTE_SEGUNDA_CONFERENCIA',
        notaEntrada: { empresaId, ...(filtros.notaId ? { id: filtros.notaId } : {}) },
      },
      include: { notaEntrada: { select: { id: true, numero: true, fornecedor: true, criadoEm: true } } },
    })
    for (const item of itensPendentes) {
      if (!item.codigoProduto) continue
      const produto = await prisma.produto.findFirst({
        where: { empresaId, codigo: item.codigoProduto },
        select: { id: true },
      })
      if (!produto) continue
      const config = await prisma.configConferenciaProduto.findUnique({
        where: { empresaId_produtoId: { empresaId, produtoId: produto.id } },
      })
      if (!config?.aceitarSenha) continue

      const criadoEm = item.notaEntrada.criadoEm
      if (!dentroDoIntervalo(criadoEm, filtros.dataInicio, filtros.dataFim)) continue
      if (!combinaFornecedor(item.notaEntrada.fornecedor, filtros.fornecedor)) continue

      resultado.push({
        id: `senha-${item.id}`,
        origemId: item.id,
        tipo: 'SENHA',
        notaEntradaId: item.notaEntrada.id,
        notaNumero: item.notaEntrada.numero,
        fornecedor: item.notaEntrada.fornecedor,
        itemNotaEntradaId: item.id,
        descricaoProduto: item.descricao,
        motivo: 'Aguardando autorização de supervisor',
        motivoDetalhe: null,
        criadoEm,
      })
    }
  }

  resultado.sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime())
  return resultado
}
