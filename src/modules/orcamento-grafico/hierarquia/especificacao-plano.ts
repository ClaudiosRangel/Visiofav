import { z } from 'zod'

/**
 * Especificação do plano (decisão D1 da spec orcamento-grafico-hierarquia-item-plano).
 *
 * Json versionado gravado em `plano_calculo_grafico.especificacao`. Guarda os campos do
 * plano que não têm coluna (ocorrências, montagem, formatos, processo, capas, micro...).
 * Fica FORA do cálculo: o motor não lê esta coluna.
 *
 * Validação permissiva: exige só `versao: 1` e limita o tamanho serializado. Os campos
 * internos são validados pela tela (e podem ser apertados aqui quando o formato fechar).
 */

/** Tamanho máximo do Json serializado (caracteres). */
export const ESPECIFICACAO_TAMANHO_MAX = 16_000

export const especificacaoPlanoSchema = z
  .object({ versao: z.literal(1) })
  .passthrough()
  .refine((v) => JSON.stringify(v).length <= ESPECIFICACAO_TAMANHO_MAX, {
    message: `especificacao excede ${ESPECIFICACAO_TAMANHO_MAX} caracteres`,
  })

export type EspecificacaoPlano = z.infer<typeof especificacaoPlanoSchema>
