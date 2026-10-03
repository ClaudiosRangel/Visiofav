/**
 * Funções PURAS de de-para/normalização usadas pelo importador do Calcgraf
 * (`importar-calcgraf.ts`). Extraídas para um módulo próprio para poderem ser
 * testadas (property-based) SEM importar o script, que puxa o Prisma Client e
 * efeitos colaterais de conexão (steering: teste de lib pura não importa o
 * módulo pesado).
 *
 * As propriedades que sustentam a IDEMPOTÊNCIA e a NÃO-SOBRESCRITA do
 * importador dependem exclusivamente destas funções:
 *  - a chave de de-para (cpf/placeholder/nome) é determinística por linha;
 *  - o conjunto de "campos faltantes" nunca inclui um campo já preenchido.
 */

export function soDigitos(v: string | null | undefined): string {
  return (v || '').replace(/\D/g, '')
}

export function normalizarNome(v: string | null | undefined): string {
  return (v || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // tira acentos
    .toUpperCase().trim().replace(/\s+/g, ' ')
}

export function emailValido(v: string | null | undefined): string | null {
  const e = (v || '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null
}

/**
 * Deriva o `cpf` usado como chave única `[empresaId, cpf]` do Vendedor.
 * - Documento válido (11/14 dígitos) → o próprio CNPJ/CPF (trim, ≤14 chars).
 * - Sem documento → placeholder determinístico `SEM-DOC-<Codigo>` (≤14 chars).
 * Determinístico por linha: idempotência da 2ª execução depende disto.
 */
export function derivarCpfVendedor(cnpjCpf: string | null | undefined, codigo: number): string {
  const docDigitos = soDigitos(cnpjCpf)
  const temDoc = docDigitos.length === 11 || docDigitos.length === 14
  return temDoc ? (cnpjCpf as string).trim().slice(0, 14) : `SEM-DOC-${codigo}`.slice(0, 14)
}

/** True quando o documento é um CPF/CNPJ válido em comprimento (11 ou 14 dígitos). */
export function temDocumentoValido(cnpjCpf: string | null | undefined): boolean {
  const d = soDigitos(cnpjCpf).length
  return d === 11 || d === 14
}

/**
 * Campos de endereço do `novo` que devem ser gravados: SOMENTE os que estão
 * vazios no `existente`. Nunca inclui um campo já preenchido (não-sobrescrita).
 */
export function camposEnderecoVazios(
  existente: Record<string, unknown>,
  novo: Record<string, string | null | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of ['logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'cep'] as const) {
    const atual = existente[k]
    const nv = novo[k]
    if ((atual === null || atual === undefined || atual === '') && nv) out[k] = nv
  }
  return out
}
