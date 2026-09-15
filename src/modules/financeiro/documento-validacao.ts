/**
 * Financeiro D1 — validação de documento (CPF/CNPJ). Núcleo puro, sem I/O.
 * Detecção automática de PF (11 dígitos) / PJ (14 dígitos) + dígito verificador.
 */

export type TipoPessoa = 'FISICA' | 'JURIDICA'

/** Remove tudo que não é dígito. */
export function normalizarDoc(doc: string): string {
  return (doc ?? '').replace(/\D/g, '')
}

/** 11 → FISICA, 14 → JURIDICA, qualquer outro → null. */
export function detectarTipoPessoa(doc: string): TipoPessoa | null {
  const d = normalizarDoc(doc)
  if (d.length === 11) return 'FISICA'
  if (d.length === 14) return 'JURIDICA'
  return null
}

/** Valida CPF pelo dígito verificador. */
export function validarCpf(cpf: string): boolean {
  const d = normalizarDoc(cpf)
  if (d.length !== 11) return false
  if (/^(\d)\1{10}$/.test(d)) return false // todos iguais

  const calcDv = (base: string, pesoInicial: number): number => {
    let soma = 0
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i)
    const resto = (soma * 10) % 11
    return resto === 10 ? 0 : resto
  }
  const dv1 = calcDv(d.substring(0, 9), 10)
  const dv2 = calcDv(d.substring(0, 10), 11)
  return dv1 === Number(d[9]) && dv2 === Number(d[10])
}

/** Valida CNPJ pelo dígito verificador. */
export function validarCnpj(cnpj: string): boolean {
  const d = normalizarDoc(cnpj)
  if (d.length !== 14) return false
  if (/^(\d)\1{13}$/.test(d)) return false

  const calcDv = (base: string): number => {
    const pesos = base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    let soma = 0
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * pesos[i]
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }
  const dv1 = calcDv(d.substring(0, 12))
  const dv2 = calcDv(d.substring(0, 13))
  return dv1 === Number(d[12]) && dv2 === Number(d[13])
}

/**
 * Valida um documento (CPF ou CNPJ) detectando o tipo automaticamente.
 * Retorna `{ valido, tipoPessoa }`.
 */
export function validarDocumento(doc: string): { valido: boolean; tipoPessoa: TipoPessoa | null } {
  const tipoPessoa = detectarTipoPessoa(doc)
  if (tipoPessoa === 'FISICA') return { valido: validarCpf(doc), tipoPessoa }
  if (tipoPessoa === 'JURIDICA') return { valido: validarCnpj(doc), tipoPessoa }
  return { valido: false, tipoPessoa: null }
}
