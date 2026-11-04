// Decisão PURA de permissão de edição. Property 11.
// A resolução das flags (I/O no Parametro) fica na rota; aqui só a decisão,
// para ser testável sem banco. Espelha o padrão do Comercial/PCP: ADMIN e
// SUPER_ADMIN sempre podem; caso contrário, reflete podeEditarCadastros.

export interface EntradaPermissao {
  perfil: string
  /** Flag podeEditarCadastros do Comercial (default true quando ausente). */
  flagComercial?: boolean
  /** Flag equivalente do PCP, se existir (default true quando ausente). */
  flagPcp?: boolean
}

/**
 * Decide se o usuário pode EDITAR os cadastros na Central (Req 9.6, 10.1–10.4).
 * - ADMIN / SUPER_ADMIN: sempre true (independe das flags).
 * - Demais: true sse ambas as flags conhecidas permitirem (default true quando
 *   a flag está ausente — não-regressão). Basta UMA flag negar para bloquear.
 * A LEITURA é sempre liberada (esta função só decide a escrita).
 */
export function permitirEdicao(e: EntradaPermissao): boolean {
  if (e.perfil === 'ADMIN' || e.perfil === 'SUPER_ADMIN') return true
  const comercial = e.flagComercial ?? true
  const pcp = e.flagPcp ?? true
  return comercial && pcp
}
