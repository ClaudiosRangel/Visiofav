import { prisma } from '../../lib/prisma'
import { z } from 'zod'

// ─── Tipos ─────────────────────────────────────────────────────────────────────

export interface ConfigBloqueioConferencia {
  aceitarSenha: boolean
  aceitarCcePendente: boolean
}

// ─── Constantes ────────────────────────────────────────────────────────────────

/**
 * Configuração padrão: ambos false → bloqueio total (reconferência obrigatória).
 * Requirements: 3.5
 */
export const CONFIG_PADRAO: ConfigBloqueioConferencia = {
  aceitarSenha: false,
  aceitarCcePendente: false,
}

// ─── Schemas Zod ───────────────────────────────────────────────────────────────

export const configConferenciaProdutoSchema = z.object({
  aceitarSenha: z.boolean().default(false),
  aceitarCcePendente: z.boolean().default(false),
})

// ─── Funções ───────────────────────────────────────────────────────────────────

/**
 * Obtém a configuração de bloqueio de conferência para um produto.
 * Retorna bloqueio total (ambos false) caso não exista configuração cadastrada.
 *
 * Requirements: 3.4, 3.5
 */
export async function obterConfigBloqueio(
  empresaId: string,
  produtoId: string,
): Promise<ConfigBloqueioConferencia> {
  const config = await prisma.configConferenciaProduto.findUnique({
    where: { empresaId_produtoId: { empresaId, produtoId } },
  })

  if (!config) {
    return CONFIG_PADRAO
  }

  return {
    aceitarSenha: config.aceitarSenha,
    aceitarCcePendente: config.aceitarCcePendente,
  }
}

/**
 * Determina a decisão de resolução com base na configuração booleana.
 *
 * - aceitarSenha=true → permite liberação com senha de supervisor
 * - aceitarCcePendente=true (e aceitarSenha=false) → prossegue para pendência/email
 * - ambos false → bloqueio total (reconferência obrigatória)
 *
 * Requirements: 3.5, 3.6
 */
export type DecisaoResolucao = 'ACEITAR_SENHA' | 'ACEITAR_CCE_PENDENTE' | 'BLOQUEAR'

export function determinarDecisaoResolucao(config: ConfigBloqueioConferencia): DecisaoResolucao {
  if (config.aceitarSenha) {
    return 'ACEITAR_SENHA'
  }
  if (config.aceitarCcePendente) {
    return 'ACEITAR_CCE_PENDENTE'
  }
  return 'BLOQUEAR'
}
