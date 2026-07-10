import type { AgendaWms, PrismaClient } from '@prisma/client'
import { z } from 'zod'
import {
  validarCredenciaisSupervisor,
  type ValidacaoSupervisorResult,
} from '../conferencia-entrada/validar-supervisor.service'

type PrismaTransaction = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

// ─── Schema ────────────────────────────────────────────────────────────────────

/**
 * Body de `POST /autorizar-entrada/:id`. `usuario`/`senha` são opcionais pois só
 * são exigidos quando o AgendaWms está na condição "agendado sem nota fiscal"
 * (Requirement 5.1/5.2) — a exigência é decidida em tempo de execução, não pelo schema.
 */
export const autorizarEntradaBodySchema = z.object({
  usuario: z.string().min(1).optional(),
  senha: z.string().min(1).optional(),
})

export type AutorizarEntradaBody = z.infer<typeof autorizarEntradaBodySchema>

// ─── Tipos de decisão ──────────────────────────────────────────────────────────

export interface DecisaoLiberacaoConferencia {
  efetivar: boolean
  supervisorLiberacaoId: string | null
  erro?: { statusCode: 401 | 422; message: string }
}

function getHojeRange() {
  const hojeStr = new Date().toISOString().split('T')[0]
  const hojeUtc = new Date(hojeStr + 'T00:00:00.000Z')
  const amanhaUtc = new Date(hojeStr + 'T00:00:00.000Z')
  amanhaUtc.setUTCDate(amanhaUtc.getUTCDate() + 1)
  return { hojeUtc, amanhaUtc }
}

/**
 * Verifica a condição "agendado sem nota fiscal" (Requirement 5.1):
 * (a) AgendaWms tem pedidoCompraId ou fornecedorId
 * (b) NÃO existe NotaEntrada PENDENTE/EM_CONFERENCIA do fornecedor no dia
 * (c) NÃO existe CompraEfetivada com xmlNfe preenchido vinculada ao pedido ou ao fornecedor
 *
 * Retorna `true` quando as três condições se confirmam, ou seja, quando o Sistema
 * não conseguiria localizar/criar automaticamente uma Nota_Entrada para o agendamento.
 */
export async function agendaSemNotaFiscal(
  tx: PrismaTransaction,
  ag: AgendaWms,
  empresaId: string,
): Promise<boolean> {
  // (a) precisa ter pedido ou fornecedor vinculado
  if (!ag.pedidoCompraId && !ag.fornecedorId) return false

  const { hojeUtc, amanhaUtc } = getHojeRange()

  // (b) buscar documento do fornecedor (escopado à empresa do agendamento)
  let fornecedorDoc: string | null = null
  if (ag.fornecedorId) {
    const forn = await tx.fornecedor.findFirst({
      where: { id: ag.fornecedorId, empresaId },
      select: { cnpj: true },
    })
    fornecedorDoc = forn?.cnpj ?? null
  }

  const notaLocalizavel = fornecedorDoc
    ? await tx.notaEntrada.findFirst({
        where: {
          fornecedorDoc,
          empresaId,
          status: { in: ['PENDENTE', 'EM_CONFERENCIA'] },
          dataEntrada: { gte: hojeUtc, lt: amanhaUtc },
        },
      })
    : null
  if (notaLocalizavel) return false

  // (c) buscar CompraEfetivada com xmlNfe vinculável ao pedido ou ao fornecedor
  const compraComXml = await tx.compraEfetivada.findFirst({
    where: {
      empresaId,
      xmlNfe: { not: null },
      OR: [
        ...(ag.pedidoCompraId ? [{ pedidoCompraId: ag.pedidoCompraId }] : []),
        ...(ag.fornecedorId ? [{ pedidoCompra: { fornecedorId: ag.fornecedorId } }] : []),
      ],
    },
  })
  if (compraComXml) return false

  return true
}

// ─── Decisão de liberação ──────────────────────────────────────────────────────

const ERRO_CREDENCIAIS_OBRIGATORIAS =
  'Login e senha de Supervisor são obrigatórios para liberar este agendamento sem nota fiscal vinculada'

/**
 * Decide se a Liberação_de_Conferência pode ser efetivada, combinando o resultado
 * de `agendaSemNotaFiscal` (Requirement 5.1) com a validação de credenciais de
 * Supervisor (`validarCredenciaisSupervisor`, Requirement 5.7).
 *
 * - Condição falsa: efetiva sem exigir credenciais, `supervisorLiberacaoId = null`
 *   (Requirement 5.5).
 * - Condição verdadeira:
 *   - credenciais ausentes → rejeita com 422, sem alterar status/OS/supervisorLiberacaoId
 *     (Requirement 5.2).
 *   - credenciais inválidas → rejeita com 401 (mensagem genérica), sem alterar
 *     status/OS/supervisorLiberacaoId (Requirement 5.4).
 *   - credenciais válidas → efetiva com `supervisorLiberacaoId = supervisorId`
 *     retornado pelo Serviço_Validação_Supervisor (Requirement 5.3).
 *
 * Requirements: 5.2, 5.3, 5.4, 5.5, 5.7
 */
export async function decidirLiberacaoConferencia(
  tx: PrismaTransaction,
  ag: AgendaWms,
  empresaId: string,
  credenciais: AutorizarEntradaBody,
): Promise<DecisaoLiberacaoConferencia> {
  const precisaSenhaSupervisor = await agendaSemNotaFiscal(tx, ag, empresaId)

  if (!precisaSenhaSupervisor) {
    return { efetivar: true, supervisorLiberacaoId: null }
  }

  if (!credenciais.usuario || !credenciais.senha) {
    return {
      efetivar: false,
      supervisorLiberacaoId: null,
      erro: { statusCode: 422, message: ERRO_CREDENCIAIS_OBRIGATORIAS },
    }
  }

  const validacao: ValidacaoSupervisorResult = await validarCredenciaisSupervisor({
    usuario: credenciais.usuario,
    senha: credenciais.senha,
    empresaId,
  })

  if (!validacao.valido || !validacao.supervisorId) {
    return {
      efetivar: false,
      supervisorLiberacaoId: null,
      erro: { statusCode: 401, message: validacao.erro ?? 'Credenciais inválidas' },
    }
  }

  return { efetivar: true, supervisorLiberacaoId: validacao.supervisorId }
}
