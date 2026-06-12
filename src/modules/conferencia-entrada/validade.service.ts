/**
 * Serviço de validação de validade para conferência de entrada.
 *
 * Responsável por:
 * - Comparar validade digitada com validade da NF (Req 3.2, 3.3)
 * - Verificar se produto está vencido (Req 3.4)
 */

export interface DivergenciaValidade {
  tipo: 'VALIDADE_DIVERGENTE'
  validadeDigitada: Date
  validadeNf: Date
}

export interface BloqueioVencimento {
  alerta: 'PRODUTO VENCIDO'
  validadeDigitada: Date
  dataAtual: Date
}

/**
 * Compara a validade digitada pelo conferente com a validade registrada na NF.
 *
 * - Se ambas ausentes (null/undefined): retorna null (sem divergência)
 * - Se iguais (mesmo dia): retorna null
 * - Se diferentes: retorna divergência com tipo "VALIDADE_DIVERGENTE"
 *
 * A comparação é feita apenas por data (ano, mês, dia), ignorando hora.
 *
 * @param validadeDigitada Data de validade informada pelo conferente
 * @param validadeNf Data de validade registrada na NF
 * @returns Divergência ou null se sem problemas
 *
 * Requirements: 3.2, 3.3
 */
export function compararValidade(
  validadeDigitada: Date | null | undefined,
  validadeNf: Date | null | undefined,
): DivergenciaValidade | null {
  // Ambas ausentes: sem divergência
  if (!validadeDigitada && !validadeNf) {
    return null
  }

  // Uma presente e outra ausente: divergência
  if (!validadeDigitada || !validadeNf) {
    return {
      tipo: 'VALIDADE_DIVERGENTE',
      validadeDigitada: validadeDigitada!,
      validadeNf: validadeNf!,
    }
  }

  // Comparar apenas a data (ignorar horário)
  const digitadaDate = normalizarData(validadeDigitada)
  const nfDate = normalizarData(validadeNf)

  if (digitadaDate.getTime() === nfDate.getTime()) {
    return null
  }

  return {
    tipo: 'VALIDADE_DIVERGENTE',
    validadeDigitada,
    validadeNf,
  }
}

/**
 * Verifica se o produto está vencido com base na validade digitada.
 *
 * - Se validadeDigitada for anterior à dataAtual: retorna bloqueio com alerta "PRODUTO VENCIDO"
 * - Caso contrário: retorna null (produto dentro da validade)
 *
 * A comparação é feita apenas por data (ano, mês, dia), ignorando hora.
 *
 * @param validadeDigitada Data de validade informada pelo conferente
 * @param dataAtual Data atual para comparação
 * @returns Bloqueio de vencimento ou null se produto dentro da validade
 *
 * Requirements: 3.4
 */
export function verificarProdutoVencido(
  validadeDigitada: Date | null | undefined,
  dataAtual: Date,
): BloqueioVencimento | null {
  if (!validadeDigitada) {
    return null
  }

  const validadeNorm = normalizarData(validadeDigitada)
  const atualNorm = normalizarData(dataAtual)

  if (validadeNorm.getTime() < atualNorm.getTime()) {
    return {
      alerta: 'PRODUTO VENCIDO',
      validadeDigitada,
      dataAtual,
    }
  }

  return null
}

/**
 * Normaliza uma data removendo a componente de horário (zera horas, minutos, segundos, ms).
 */
function normalizarData(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}
