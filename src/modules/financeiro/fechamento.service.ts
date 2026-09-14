/**
 * Financeiro Operacional F1 — fechamento de período.
 *
 * Fecha uma competência ("YYYY-MM") travando escritas com data dentro dela.
 * `assertPeriodoAberto` é o guard consumido por lançamento/baixa/estorno.
 */
import type { PrismaClient } from '@prisma/client'
import { ErroFinanceiro } from './conta-financeira.service'
import { competenciaDe } from './financeiro-calculo'

export async function fecharPeriodo(prisma: PrismaClient, empresaId: string, competencia: string, usuarioId: string) {
  return prisma.fechamentoPeriodo.upsert({
    where: { empresaId_competencia: { empresaId, competencia } },
    create: { empresaId, competencia, fechadoPor: usuarioId, aberto: false },
    update: { aberto: false, fechadoPor: usuarioId, fechadoEm: new Date(), reabertoPor: null, reabertoEm: null, motivoReabertura: null },
  })
}

export async function reabrirPeriodo(prisma: PrismaClient, empresaId: string, competencia: string, usuarioId: string, motivo: string) {
  const fechamento = await prisma.fechamentoPeriodo.findFirst({ where: { empresaId, competencia } })
  if (!fechamento) throw new ErroFinanceiro(404, 'Período não encontrado')
  return prisma.fechamentoPeriodo.update({
    where: { empresaId_competencia: { empresaId, competencia } },
    data: { aberto: true, reabertoPor: usuarioId, reabertoEm: new Date(), motivoReabertura: motivo },
  })
}

export async function listarFechamentos(prisma: PrismaClient, empresaId: string) {
  return prisma.fechamentoPeriodo.findMany({ where: { empresaId }, orderBy: { competencia: 'desc' } })
}

/** Se a competência de `data` está fechada, lança 409. Usado por escritas. */
export async function assertPeriodoAberto(prisma: PrismaClient, empresaId: string, data: Date) {
  const competencia = competenciaDe(data)
  const fechamento = await prisma.fechamentoPeriodo.findFirst({ where: { empresaId, competencia } })
  if (fechamento && !fechamento.aberto) {
    throw new ErroFinanceiro(409, `Período ${competencia} está fechado`)
  }
}
