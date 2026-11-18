import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import type { Prisma } from '@prisma/client'

/**
 * Utilidades comuns das rotas da hierarquia Orçamento → Item → Plano.
 *
 * Regras (spec orcamento-grafico-hierarquia-item-plano, R16):
 *  - empresaId EXPLÍCITO em todo where (nunca só prismaScoped: SUPER_ADMIN não isola);
 *  - 404 com mensagem IDÊNTICA para registro inexistente e de outra empresa, sem eco de campos;
 *  - filhos filtrados pelo pai (`orcamentoId`).
 */

/** Mensagem única de 404 (inexistente e outra empresa são indistinguíveis). */
export const MSG_NAO_ENCONTRADO = 'Registro não encontrado.'

export type DbClient = typeof prisma | Prisma.TransactionClient

export class HierarquiaError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    /** Campos extras do corpo de erro (ex.: ids faltando/sobrando no 400 de reordenar). */
    public readonly detalhes?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'HierarquiaError'
  }
}

/** 404 padrão (sem eco de ids/campos). */
export function naoEncontrado(): HierarquiaError {
  return new HierarquiaError(404, MSG_NAO_ENCONTRADO)
}

export const paramsOrcamentoSchema = z.object({ id: z.string().uuid() })
export const paramsItemSchema = z.object({ id: z.string().uuid(), itemId: z.string().uuid() })
export const paramsPlanoSchema = paramsItemSchema.extend({ planoId: z.string().uuid() })

/** Número (Decimal do Prisma, string ou number) → number; null/undefined → null. */
export function paraNumero(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function arred2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100
}

/**
 * Garante que o orçamento existe NA empresa. Lança 404 padrão caso contrário
 * (inexistente e de outra empresa são tratados igual).
 */
export async function exigirOrcamentoDaEmpresa(db: DbClient, orcamentoId: string, empresaId: string) {
  const orc = await db.orcamentoGrafico.findFirst({
    where: { id: orcamentoId, empresaId },
    select: { id: true, vendedorId: true, valorTotalConsolidado: true },
  })
  if (!orc) throw naoEncontrado()
  return orc
}
