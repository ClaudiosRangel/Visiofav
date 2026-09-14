/**
 * Helper puro de validação de validade do produto na conferência de entrada.
 *
 * Encapsula a ordem "produto vencido primeiro, depois shelf life mínimo",
 * de forma idêntica nos três canais de conferência (individual, em lote e
 * por código de barras).
 *
 * NÃO depende da validade da NF-e — o tipo de entrada não inclui esse valor.
 *
 * Reutiliza `verificarProdutoVencido` (validade.service) e `validarShelfLife`
 * (shelf-life.service); não duplica lógica de datas.
 */

import { verificarProdutoVencido } from './validade.service'
import { validarShelfLife } from '../conferencia/shelf-life.service'

export interface ValidacaoValidadeInput {
  validadeDigitada: Date | null
  shelfLifeMinimo: number | null
  dataAtual: Date
  produtoNome: string
}

export type ValidacaoValidadeResult =
  | { aprovado: true }
  | { aprovado: false; bloqueio: 'PRODUTO_VENCIDO'; mensagem: string }
  | {
      aprovado: false
      bloqueio: 'SHELF_LIFE'
      mensagem: string
      diasRestantes: number
      dataMinima: string
    }

/**
 * Formata uma data no padrão DD/MM/AAAA (local, sem dependência externa).
 */
function formatarDataBR(date: Date): string {
  const dia = String(date.getDate()).padStart(2, '0')
  const mes = String(date.getMonth() + 1).padStart(2, '0')
  const ano = date.getFullYear()
  return `${dia}/${mes}/${ano}`
}

/**
 * Valida a validade digitada de um produto contra duas referências objetivas:
 *
 * 1. Validade ausente (null) → aprovado (a obrigatoriedade é responsabilidade
 *    da regra de `exigeLote`, fora deste helper).
 * 2. Produto vencido (validade <= data atual) → bloqueio `PRODUTO_VENCIDO`.
 * 3. Shelf life mínimo (dias restantes < `shelfLifeMinimo`) → bloqueio `SHELF_LIFE`.
 * 4. Caso contrário → aprovado.
 *
 * Função pura, sem acesso a banco.
 */
export function validarValidadeProduto(
  input: ValidacaoValidadeInput,
): ValidacaoValidadeResult {
  // 1. Validade ausente → nada a validar.
  if (!input.validadeDigitada) {
    return { aprovado: true }
  }

  // 2. Produto vencido (<= hoje) tem prioridade — mensagem mais clara.
  const vencido = verificarProdutoVencido(input.validadeDigitada, input.dataAtual)
  if (vencido) {
    return {
      aprovado: false,
      bloqueio: 'PRODUTO_VENCIDO',
      mensagem: `Produto "${input.produtoNome}" está vencido (validade ${formatarDataBR(input.validadeDigitada)}).`,
    }
  }

  // 3. Shelf life mínimo (reusa a função existente).
  const resultado = validarShelfLife({
    shelfLifeMinimo: input.shelfLifeMinimo,
    dataValidade: input.validadeDigitada,
    dataAtual: input.dataAtual,
    produtoNome: input.produtoNome,
  })
  if (!resultado.aprovado) {
    return {
      aprovado: false,
      bloqueio: 'SHELF_LIFE',
      mensagem: resultado.mensagem!,
      diasRestantes: resultado.diasRestantes!,
      dataMinima: resultado.dataMinima!,
    }
  }

  // 4. Aprovado.
  return { aprovado: true }
}
