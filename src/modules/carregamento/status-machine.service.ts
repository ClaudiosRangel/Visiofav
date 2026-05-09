const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDENTE: ['EM_CARREGAMENTO', 'CANCELADO'],
  EM_CARREGAMENTO: ['CONCLUIDO', 'CANCELADO'],
  CONCLUIDO: [],
  CANCELADO: [],
}

export function validarTransicaoCarregamento(statusAtual: string, statusAlvo: string): { valido: boolean; mensagem?: string } {
  const permitidos = VALID_TRANSITIONS[statusAtual] || []
  if (!permitidos.includes(statusAlvo)) {
    return { valido: false, mensagem: `Não é possível transicionar de '${statusAtual}' para '${statusAlvo}'` }
  }
  return { valido: true }
}
