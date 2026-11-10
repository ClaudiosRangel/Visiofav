/**
 * parada-centro.service.ts — Parada (downtime) de um Centro de Produção SEM
 * vínculo com OP/etapa (Checkout).
 *
 * Spec: checkout-parada-maquina-sem-op.
 *
 * O Checkout, até aqui, só registrava parada no contexto de uma
 * `EtapaOrdemProducao` (`ApontamentoEtapa` tipo PARADA, com
 * `etapaOrdemProducaoId` obrigatório). Quando a máquina para SEM nenhuma OP
 * rodando (ex.: manutenção), o operador era forçado a entrar numa OP. Este
 * módulo registra a parada no nível do CENTRO (máquina), como um evento de
 * downtime do recurso — padrão de mercado em MES.
 *
 * - `calcularDuracaoParada` é PURA (sem Prisma) e testável isoladamente.
 * - As funções de IO filtram SEMPRE `empresaId` + `centroProducaoId` da sessão
 *   do terminal (multi-tenant; prismaScoped não isola SUPER_ADMIN).
 * - NÃO cria/altera nenhuma OrdemProducao/EtapaOrdemProducao.
 */

import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { CheckoutError } from './checkout.service'

/** Identidade mínima do terminal (empresa + centro resolvidos na sessão). */
export interface CheckoutUserCentro {
  empresaId: string
  centroProducaoId: string
}

/** Motivos de parada — mesmo enum textual de ApontamentoEtapa.motivoParada. */
export const MOTIVOS_PARADA = [
  'MANUTENCAO',
  'FALTA_MATERIAL',
  'ACERTO_MAQUINA',
  'TROCA_TURNO',
  'OUTRO',
] as const

export const registrarParadaCentroSchema = z.object({
  motivoParada: z.enum(MOTIVOS_PARADA),
  codigoParadaId: z.string().uuid().optional(),
  observacao: z.string().optional(),
  funcionarioId: z.string().uuid().optional(),
})

export type RegistrarParadaCentroInput = z.infer<typeof registrarParadaCentroSchema>

/**
 * Duração de uma parada em MINUTOS inteiros, nunca negativa.
 * Função PURA (sem IO). `fim < inicio` ⇒ 0 (nunca negativo — Req 2.4).
 */
export function calcularDuracaoParada(inicio: Date, fim: Date): number {
  const ms = fim.getTime() - inicio.getTime()
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.round(ms / 60000)
}

/**
 * Retorna a parada ABERTA (fim = null) do centro do terminal, ou null.
 * Isolamento por empresaId + centroProducaoId explícitos.
 */
export async function paradaAbertaDoCentro(user: CheckoutUserCentro) {
  return prisma.paradaCentro.findFirst({
    where: {
      empresaId: user.empresaId,
      centroProducaoId: user.centroProducaoId,
      fim: null,
    },
    orderBy: { inicio: 'desc' },
  })
}

/**
 * Registra uma parada de máquina SEM OP (Req 1). Recusa se já houver uma
 * parada aberta para o mesmo centro (Req 1.3). NÃO toca OP/etapa.
 */
export async function registrarParadaCentro(
  user: CheckoutUserCentro,
  dadosRecebidos: RegistrarParadaCentroInput,
) {
  const parsed = registrarParadaCentroSchema.safeParse(dadosRecebidos)
  if (!parsed.success) {
    throw new CheckoutError(400, parsed.error.errors[0]?.message ?? 'Dados inválidos para a parada')
  }
  const dados = parsed.data

  const jaAberta = await paradaAbertaDoCentro(user)
  if (jaAberta) {
    throw new CheckoutError(
      400,
      'Já existe uma parada de máquina em aberto para este terminal. Encerre-a antes de registrar outra.',
    )
  }

  return prisma.paradaCentro.create({
    data: {
      empresaId: user.empresaId,
      centroProducaoId: user.centroProducaoId,
      motivoParada: dados.motivoParada,
      codigoParadaId: dados.codigoParadaId ?? null,
      observacao: dados.observacao ?? null,
      funcionarioId: dados.funcionarioId ?? null,
      inicio: new Date(),
      fim: null,
    },
  })
}

/**
 * Encerra a parada aberta do centro do terminal (Req 2). Grava `fim` e
 * `duracaoMinutos`. Sem parada aberta ⇒ 400.
 */
export async function encerrarParadaCentro(user: CheckoutUserCentro) {
  const aberta = await paradaAbertaDoCentro(user)
  if (!aberta) {
    throw new CheckoutError(400, 'Não há parada de máquina em aberto para encerrar.')
  }

  const fim = new Date()
  const duracaoMinutos = calcularDuracaoParada(aberta.inicio, fim)

  return prisma.paradaCentro.update({
    where: { id: aberta.id },
    data: { fim, duracaoMinutos },
  })
}
