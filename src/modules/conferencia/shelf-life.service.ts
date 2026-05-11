export interface ShelfLifeInput {
  shelfLifeMinimo: number | null
  dataValidade: Date | null
  dataAtual: Date
  produtoNome: string
}

export interface ShelfLifeResult {
  aprovado: boolean
  diasRestantes: number | null
  mensagem?: string
  dataMinima?: string
}

/**
 * Função pura que valida shelf life.
 * - Se shelfLifeMinimo é null → aprovado (sem validação)
 * - Se dataValidade é null → aprovado (sem validação)
 * - Se diasRestantes >= shelfLifeMinimo → aprovado
 * - Se diasRestantes < shelfLifeMinimo → rejeitado com mensagem
 */
export function validarShelfLife(input: ShelfLifeInput): ShelfLifeResult {
  const { shelfLifeMinimo, dataValidade, dataAtual, produtoNome } = input

  if (shelfLifeMinimo === null || shelfLifeMinimo === undefined) {
    return { aprovado: true, diasRestantes: null }
  }

  if (dataValidade === null || dataValidade === undefined) {
    return { aprovado: true, diasRestantes: null }
  }

  // Calculate days remaining (difference in calendar days)
  const msPerDay = 1000 * 60 * 60 * 24
  const validadeTime = new Date(dataValidade.getFullYear(), dataValidade.getMonth(), dataValidade.getDate()).getTime()
  const atualTime = new Date(dataAtual.getFullYear(), dataAtual.getMonth(), dataAtual.getDate()).getTime()
  const diasRestantes = Math.floor((validadeTime - atualTime) / msPerDay)

  if (diasRestantes >= shelfLifeMinimo) {
    return { aprovado: true, diasRestantes }
  }

  // Calculate minimum acceptable date
  const dataMinima = new Date(dataAtual)
  dataMinima.setDate(dataMinima.getDate() + shelfLifeMinimo)
  const dataMinimaStr = dataMinima.toISOString().split('T')[0]

  return {
    aprovado: false,
    diasRestantes,
    mensagem: `Produto "${produtoNome}" requer no mínimo ${shelfLifeMinimo} dias de validade. Dias restantes: ${diasRestantes}. Data mínima aceitável: ${dataMinimaStr}.`,
    dataMinima: dataMinimaStr,
  }
}
