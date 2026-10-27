/**
 * Aprovação de Amostra/Modelo (R5 — spec orcamento-grafico-handoff-comercial).
 * Rodadas (reprovar abre nova rodada preservando histórico), tipos DIGITAL/
 * FISICA/FACA, aprovação pelo cliente (via portal) ou internamente. Bloqueia a
 * liberação do pedido p/ PCP quando exigida e sem amostra APROVADA.
 *
 * Isolamento multi-tenant: `empresaId` explícito. A regra de EXIGÊNCIA é pura
 * (`amostra.puro.ts`); aqui fica a persistência.
 */
import { prisma } from '../../../lib/prisma'
import { amostraExigida, proximaRodada, type ConfigAmostra } from './amostra.puro'
import { configAmostraDaEmpresa } from './converter-orcamento.service'

export class AmostraError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) {
    super(message)
    this.name = 'AmostraError'
  }
}

const STATUS_VALIDOS = ['SOLICITADA', 'EM_PRODUCAO_AMOSTRA', 'ENVIADA_CLIENTE', 'APROVADA', 'REPROVADA'] as const
const TIPOS_VALIDOS = ['DIGITAL', 'FISICA', 'FACA'] as const

/** Garante que o vínculo (orçamento ou pedido) pertence à empresa. */
async function validarVinculo(empresaId: string, orcamentoId?: string | null, pedidoVendaId?: string | null) {
  if (!orcamentoId && !pedidoVendaId) {
    throw new AmostraError(400, 'Informe orcamentoId ou pedidoVendaId')
  }
  if (orcamentoId) {
    const o = await prisma.orcamentoGrafico.findFirst({ where: { id: orcamentoId, empresaId }, select: { id: true } })
    if (!o) throw new AmostraError(404, 'Orçamento não encontrado')
  }
  if (pedidoVendaId) {
    const p = await prisma.pedidoVenda.findFirst({ where: { id: pedidoVendaId, empresaId }, select: { id: true } })
    if (!p) throw new AmostraError(404, 'Pedido não encontrado')
  }
}

/** Cria uma solicitação de amostra (rodada 1, ou próxima rodada se já houver). */
export async function solicitarAmostra(
  empresaId: string,
  dados: { orcamentoId?: string | null; pedidoVendaId?: string | null; tipo: string },
) {
  if (!TIPOS_VALIDOS.includes(dados.tipo as never)) {
    throw new AmostraError(400, `Tipo inválido. Use ${TIPOS_VALIDOS.join(' | ')}`)
  }
  await validarVinculo(empresaId, dados.orcamentoId, dados.pedidoVendaId)

  // Próxima rodada = maior rodada existente + 1 (para o mesmo vínculo).
  const where = {
    empresaId,
    ...(dados.orcamentoId ? { orcamentoId: dados.orcamentoId } : {}),
    ...(dados.pedidoVendaId ? { pedidoVendaId: dados.pedidoVendaId } : {}),
  }
  const ultima = await prisma.aprovacaoAmostra.findFirst({
    where, orderBy: { rodada: 'desc' }, select: { rodada: true },
  })
  const rodada = proximaRodada(ultima?.rodada)

  return prisma.aprovacaoAmostra.create({
    data: {
      empresaId,
      orcamentoId: dados.orcamentoId ?? null,
      pedidoVendaId: dados.pedidoVendaId ?? null,
      tipo: dados.tipo,
      status: 'SOLICITADA',
      rodada,
    },
  })
}

/** Avança o status da amostra (produção → enviada). Anexo opcional. */
export async function avancarStatusAmostra(
  empresaId: string,
  id: string,
  novoStatus: string,
  anexoUrl?: string | null,
) {
  if (!STATUS_VALIDOS.includes(novoStatus as never)) {
    throw new AmostraError(400, 'Status inválido')
  }
  const a = await prisma.aprovacaoAmostra.findFirst({ where: { id, empresaId }, select: { id: true, status: true } })
  if (!a) throw new AmostraError(404, 'Amostra não encontrada')
  if (a.status === 'APROVADA' || a.status === 'REPROVADA') {
    throw new AmostraError(409, 'Amostra já finalizada (aprovada/reprovada)')
  }
  return prisma.aprovacaoAmostra.update({
    where: { id },
    data: { status: novoStatus, ...(anexoUrl !== undefined ? { anexoUrl } : {}) },
  })
}

/** Aprova a amostra (pelo cliente/rep ou internamente). */
export async function aprovarAmostra(empresaId: string, id: string, aprovadoPor: string) {
  const a = await prisma.aprovacaoAmostra.findFirst({ where: { id, empresaId }, select: { id: true, status: true } })
  if (!a) throw new AmostraError(404, 'Amostra não encontrada')
  if (a.status === 'APROVADA') return prisma.aprovacaoAmostra.findUnique({ where: { id } })
  if (a.status === 'REPROVADA') throw new AmostraError(409, 'Amostra já reprovada; abra nova rodada')
  return prisma.aprovacaoAmostra.update({
    where: { id },
    data: { status: 'APROVADA', aprovadoPor, aprovadoEm: new Date() },
  })
}

/** Reprova a amostra (motivo obrigatório). Permite abrir nova rodada depois. */
export async function reprovarAmostra(empresaId: string, id: string, motivoReprova: string) {
  if (!motivoReprova || !motivoReprova.trim()) {
    throw new AmostraError(400, 'Motivo da reprovação é obrigatório')
  }
  const a = await prisma.aprovacaoAmostra.findFirst({ where: { id, empresaId }, select: { id: true, status: true } })
  if (!a) throw new AmostraError(404, 'Amostra não encontrada')
  if (a.status === 'APROVADA') throw new AmostraError(409, 'Amostra já aprovada')
  return prisma.aprovacaoAmostra.update({
    where: { id },
    data: { status: 'REPROVADA', motivoReprova: motivoReprova.trim() },
  })
}

/** Lista as rodadas de amostra de um vínculo (orçamento ou pedido). */
export async function listarAmostras(
  empresaId: string,
  filtro: { orcamentoId?: string; pedidoVendaId?: string },
) {
  return prisma.aprovacaoAmostra.findMany({
    where: {
      empresaId,
      ...(filtro.orcamentoId ? { orcamentoId: filtro.orcamentoId } : {}),
      ...(filtro.pedidoVendaId ? { pedidoVendaId: filtro.pedidoVendaId } : {}),
    },
    orderBy: [{ rodada: 'desc' }],
  })
}

/**
 * Lista TODAS as amostras da empresa para a tela "Amostras / Modelos" do
 * Comercial, trazendo contexto do orçamento (número/cliente). Filtro opcional
 * por status. Isolamento por `empresaId`. Só a rodada mais recente por
 * vínculo (orçamento) interessa para a fila — mas devolvemos todas e o front
 * agrupa; aqui ordenamos por mais recente.
 */
export async function listarAmostrasEmpresa(
  empresaId: string,
  filtro?: { status?: string; apenasPendentes?: boolean },
) {
  const statusPendentes = ['SOLICITADA', 'EM_PRODUCAO_AMOSTRA', 'ENVIADA_CLIENTE']
  const where: Record<string, unknown> = { empresaId }
  if (filtro?.status) where.status = filtro.status
  else if (filtro?.apenasPendentes) where.status = { in: statusPendentes }

  const amostras = await prisma.aprovacaoAmostra.findMany({
    where,
    orderBy: [{ criadoEm: 'desc' }],
    take: 300,
    select: {
      id: true, orcamentoId: true, pedidoVendaId: true, tipo: true,
      status: true, rodada: true, anexoUrl: true, aprovadoPor: true,
      aprovadoEm: true, motivoReprova: true, criadoEm: true,
    },
  })

  // Enriquecer com número/cliente do orçamento (sem N+1 pesado — 1 query).
  const orcIds = [...new Set(amostras.map((a) => a.orcamentoId).filter(Boolean) as string[])]
  const orcs = orcIds.length
    ? await prisma.orcamentoGrafico.findMany({
        where: { id: { in: orcIds }, empresaId },
        select: { id: true, numero: true, clienteNome: true },
      })
    : []
  const mapOrc = new Map(orcs.map((o) => [o.id, o]))

  return amostras.map((a) => ({
    ...a,
    orcamentoNumero: a.orcamentoId ? mapOrc.get(a.orcamentoId)?.numero ?? null : null,
    clienteNome: a.orcamentoId ? mapOrc.get(a.orcamentoId)?.clienteNome ?? null : null,
  }))
}

/**
 * Verifica se a liberação do pedido para o PCP está permitida quanto à amostra:
 * se o pedido exige amostra e não há `APROVADA`, retorna { permitido: false }.
 * Usada na liberação (Onda 4) e espelha a regra da conversão.
 */
export async function liberacaoPermitidaPorAmostra(
  empresaId: string,
  pedido: { id: string; exigeAmostra: boolean; orcamentoOrigemId?: string | null },
): Promise<{ permitido: boolean; motivo?: string }> {
  if (!pedido.exigeAmostra) return { permitido: true }
  // Procura amostra APROVADA ligada ao pedido OU ao orçamento de origem.
  const aprovada = await prisma.aprovacaoAmostra.count({
    where: {
      empresaId,
      status: 'APROVADA',
      OR: [
        { pedidoVendaId: pedido.id },
        ...(pedido.orcamentoOrigemId ? [{ orcamentoId: pedido.orcamentoOrigemId }] : []),
      ],
    },
  })
  return aprovada > 0
    ? { permitido: true }
    : { permitido: false, motivo: 'Amostra exigida e ainda não aprovada' }
}

/** Resolve a exigência efetiva de amostra para um orçamento (helper p/ front). */
export async function exigenciaAmostraDoOrcamento(
  empresaId: string,
  orcamento: { exigeAmostra: boolean | null; observacoes: string | null },
  configOverride?: ConfigAmostra,
): Promise<boolean> {
  const config = configOverride ?? (await configAmostraDaEmpresa(empresaId))
  const m = orcamento.observacoes?.match(/\[TipoOp\]\s*(.+?)(?:\n|$)/i)
  return amostraExigida(config, orcamento.exigeAmostra, m ? m[1].trim() : null)
}
