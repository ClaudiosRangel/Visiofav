import { prisma } from '../../lib/prisma'

// ─── Tipos ─────────────────────────────────────────────────────────────────────

export type ModoResolucao = 'ACEITAR_CCE' | 'ACEITAR_SENHA' | 'ACEITAR_LIVRE' | 'BLOQUEAR'

export interface ConfigResolucao {
  modoResolucaoLote: ModoResolucao
  modoResolucaoValidade: ModoResolucao
}

// ─── Constantes ────────────────────────────────────────────────────────────────

export const CONFIG_PADRAO: ConfigResolucao = {
  modoResolucaoLote: 'BLOQUEAR',
  modoResolucaoValidade: 'BLOQUEAR',
}

// ─── Funções ───────────────────────────────────────────────────────────────────

/**
 * Obtém a configuração de resolução de divergência para um produto.
 * Retorna BLOQUEAR para ambos os modos caso não exista configuração cadastrada.
 *
 * Requirements: 1.3, 2.4
 */
export async function obterModoResolucao(
  empresaId: string,
  produtoId: string,
): Promise<ConfigResolucao> {
  const config = await prisma.configConferenciaProduto.findUnique({
    where: { empresaId_produtoId: { empresaId, produtoId } },
  })

  if (!config) {
    return CONFIG_PADRAO
  }

  return {
    modoResolucaoLote: config.modoResolucaoLote as ModoResolucao,
    modoResolucaoValidade: config.modoResolucaoValidade as ModoResolucao,
  }
}
