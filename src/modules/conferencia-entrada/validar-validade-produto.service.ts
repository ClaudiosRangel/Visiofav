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
import {
  calcularVencimentoPorFabricacao,
  percentualVidaUtilRestante,
  recusaPorPercentualRecebimento,
} from './shelf-life-avancado.service'

export interface ValidacaoValidadeInput {
  validadeDigitada: Date | null
  shelfLifeMinimo: number | null
  dataAtual: Date
  produtoNome: string
  // Atributos Logísticos e Shelf Life (opcionais — spec atributos-logisticos-shelf-life).
  // Data de fabricação digitada na doca (base para calcular vencimento).
  dataFabricacao?: Date | null
  // Prazo total do fabricante em dias (para o cálculo por fabricação e o RLM %).
  shelfLifeTotalDias?: number | null
  // RLM percentual: % mínimo de vida útil restante exigido no recebimento (0-100).
  percentualVidaUtilMinimo?: number | null
}

export type ValidacaoValidadeResult =
  | { aprovado: true; avisos?: string[] }
  | { aprovado: false; bloqueio: 'PRODUTO_VENCIDO'; mensagem: string }
  | {
      aprovado: false
      bloqueio: 'SHELF_LIFE'
      mensagem: string
      diasRestantes: number
      dataMinima: string
    }
  | {
      aprovado: false
      bloqueio: 'RLM_PERCENTUAL'
      mensagem: string
      percentualEncontrado: number
      percentualMinimo: number
    }
  | { aprovado: false; bloqueio: 'DATA_FABRICACAO_FUTURA'; mensagem: string }

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
  const avisos: string[] = []

  // 0. Data de fabricação futura → rejeita (Req 2.5).
  if (input.dataFabricacao && input.dataFabricacao.getTime() > input.dataAtual.getTime()) {
    return {
      aprovado: false,
      bloqueio: 'DATA_FABRICACAO_FUTURA',
      mensagem: `Data de fabricação (${formatarDataBR(input.dataFabricacao)}) é posterior à data atual.`,
    }
  }

  // 1. Determina a validade efetiva. Se não veio digitada mas há fabricação +
  //    shelf life total, calcula o vencimento (Req 2.2). Se veio digitada E há
  //    vencimento calculado divergente, apenas sinaliza (Req 2.3).
  const vencimentoCalculado = calcularVencimentoPorFabricacao(
    input.dataFabricacao ?? null,
    input.shelfLifeTotalDias ?? null,
  )
  let validadeEfetiva = input.validadeDigitada
  if (!validadeEfetiva && vencimentoCalculado) {
    validadeEfetiva = vencimentoCalculado
  } else if (validadeEfetiva && vencimentoCalculado) {
    const mesmaData =
      formatarDataBR(validadeEfetiva) === formatarDataBR(vencimentoCalculado)
    if (!mesmaData) {
      avisos.push(
        `Validade informada (${formatarDataBR(validadeEfetiva)}) diverge do vencimento calculado por fabricação (${formatarDataBR(vencimentoCalculado)}).`,
      )
    }
  }

  // Validade ausente (e sem cálculo possível) → nada a validar.
  if (!validadeEfetiva) {
    return { aprovado: true, avisos: avisos.length ? avisos : undefined }
  }

  // 2. Produto vencido (<= hoje) tem prioridade — mensagem mais clara.
  const vencido = verificarProdutoVencido(validadeEfetiva, input.dataAtual)
  if (vencido) {
    return {
      aprovado: false,
      bloqueio: 'PRODUTO_VENCIDO',
      mensagem: `Produto "${input.produtoNome}" está vencido (validade ${formatarDataBR(validadeEfetiva)}).`,
    }
  }

  // 3. Shelf life mínimo em dias (reusa a função existente).
  const resultado = validarShelfLife({
    shelfLifeMinimo: input.shelfLifeMinimo,
    dataValidade: validadeEfetiva,
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

  // 4. RLM percentual (Req 3): recusa se a % de vida útil restante < mínimo.
  const percentual = percentualVidaUtilRestante(
    validadeEfetiva,
    input.shelfLifeTotalDias ?? null,
    input.dataAtual,
  )
  if (recusaPorPercentualRecebimento(percentual, input.percentualVidaUtilMinimo ?? null)) {
    const p = Math.round((percentual as number) * 10) / 10
    return {
      aprovado: false,
      bloqueio: 'RLM_PERCENTUAL',
      mensagem: `Produto "${input.produtoNome}" chegou com ${p}% de vida útil restante, abaixo do mínimo de ${input.percentualVidaUtilMinimo}% exigido no recebimento.`,
      percentualEncontrado: p,
      percentualMinimo: input.percentualVidaUtilMinimo as number,
    }
  }

  // 5. Aprovado.
  return { aprovado: true, avisos: avisos.length ? avisos : undefined }
}
