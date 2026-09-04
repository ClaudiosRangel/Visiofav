/**
 * Schemas de validação de entrada (Zod) do módulo Financeiro Vizor.
 *
 * Concentra a validação dos payloads das rotas que fazem escrita:
 * - `salvarContratoSchema`: criação/atualização de contrato de cobrança
 *   (data do contrato não futura, dia de vencimento inteiro 1..31, preços por
 *   módulo dentro do intervalo permitido). (Req 3.5, 3.6, 3.8)
 * - `gerarVencimentosSchema`: geração de vencimentos em lote (meses inteiro
 *   1..60, competência inicial opcional no formato YYYY-MM). (Req 5.6, 5.7, 5.10)
 *
 * A validação acontece ANTES de qualquer escrita — em caso de erro, nada é
 * persistido e o estado anterior é preservado. O helper `formatarErroZod()`
 * transforma o `ZodError` numa mensagem legível "campo: motivo" (mesmo padrão
 * de `cte.routes.ts`) para a rota responder 422 com o campo que reprovou.
 *
 * Ver design em `.kiro/specs/financeiro-vizor/design.md`
 * (seção "Schemas Zod (validação de entrada)").
 */

import { z } from 'zod'

import {
  DIA_VENCIMENTO_MAX,
  DIA_VENCIMENTO_MIN,
  MESES_MAX,
  MESES_MIN,
  MODULOS,
  PRECO_MAX,
} from './financeiro.types'

// ---------------------------------------------------------------------------
// Schema: salvar contrato (Req 3.5, 3.6, 3.8)
// ---------------------------------------------------------------------------

/** Preço de um módulo específico (módulo do conjunto canônico, 0..PRECO_MAX). */
const precoModuloSchema = z.object({
  modulo: z.enum(MODULOS),
  preco: z
    .number({ invalid_type_error: 'O preço deve ser um valor numérico.' })
    .min(0, { message: 'O preço deve estar entre 0,00 e 999.999.999,99.' })
    .max(PRECO_MAX, { message: 'O preço deve estar entre 0,00 e 999.999.999,99.' }), // Req 3.6
})

/**
 * Payload de criação/atualização de contrato de cobrança.
 *
 * - `dataContrato`: data válida e não futura (Req 3.8). `z.coerce.date()`
 *   aceita string ISO / timestamp e converte para `Date`; datas inválidas
 *   reprovam automaticamente.
 * - `diaVencimento`: inteiro entre 1 e 31 (Req 3.5).
 * - `precos`: até seis entradas (uma por módulo), cada preço em 0..PRECO_MAX
 *   (Req 3.6). Módulos ausentes assumem preço 0 na camada de service.
 */
export const salvarContratoSchema = z.object({
  dataContrato: z.coerce
    .date({ invalid_type_error: 'A data do contrato deve ser uma data válida e não futura.' })
    .refine((d) => d <= new Date(), {
      message: 'A data do contrato deve ser uma data válida e não futura.', // Req 3.8
    }),
  diaVencimento: z
    .number({ invalid_type_error: 'O dia de vencimento deve ser um inteiro entre 1 e 31.' })
    .int({ message: 'O dia de vencimento deve ser um inteiro entre 1 e 31.' })
    .min(DIA_VENCIMENTO_MIN, { message: 'O dia de vencimento deve ser um inteiro entre 1 e 31.' })
    .max(DIA_VENCIMENTO_MAX, { message: 'O dia de vencimento deve ser um inteiro entre 1 e 31.' }), // Req 3.5
  precos: z.array(precoModuloSchema).max(6, {
    message: 'A lista de preços deve conter no máximo seis módulos.',
  }),
})

export type SalvarContratoBody = z.infer<typeof salvarContratoSchema>

// ---------------------------------------------------------------------------
// Schema: gerar vencimentos em lote (Req 5.6, 5.7, 5.10)
// ---------------------------------------------------------------------------

/**
 * Payload da geração de vencimentos em lote.
 *
 * - `meses`: inteiro entre 1 e 60 (Req 5.10).
 * - `competenciaInicial`: opcional, no formato "YYYY-MM" (mês 01..12). Quando
 *   ausente, a geração inicia no mês seguinte ao corrente (Req 5.6/5.7).
 */
export const gerarVencimentosSchema = z.object({
  meses: z
    .number({ invalid_type_error: 'O número de meses deve estar entre 1 e 60.' })
    .int({ message: 'O número de meses deve estar entre 1 e 60.' })
    .min(MESES_MIN, { message: 'O número de meses deve estar entre 1 e 60.' })
    .max(MESES_MAX, { message: 'O número de meses deve estar entre 1 e 60.' }), // Req 5.10
  competenciaInicial: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Competência deve estar no formato YYYY-MM.' })
    .optional(), // Req 5.6/5.7
})

export type GerarVencimentosBody = z.infer<typeof gerarVencimentosSchema>

// ---------------------------------------------------------------------------
// Helper de formatação de erro (mesmo padrão de cte.routes.ts)
// ---------------------------------------------------------------------------

/** Rótulos amigáveis por caminho técnico do payload, para a mensagem de erro. */
const ROTULOS: Record<string, string> = {
  dataContrato: 'Data do contrato',
  diaVencimento: 'Dia de vencimento',
  precos: 'Preços dos módulos',
  'precos.preco': 'Preço do módulo',
  'precos.modulo': 'Módulo',
  meses: 'Número de meses',
  competenciaInicial: 'Competência inicial',
}

/**
 * Formata um `ZodError` numa mensagem legível "campo: motivo", para que o
 * frontend consiga mostrar ao usuário exatamente qual campo reprovou em vez de
 * um genérico "Dados inválidos". Mesmo padrão de `cte.routes.ts`.
 *
 * As rotas do módulo usam este helper para responder HTTP 422 preservando o
 * estado anterior (nenhuma escrita antes da validação passar).
 */
export function formatarErroZod(err: unknown): { message: string; erros: unknown } {
  const anyErr = err as { errors?: unknown[] }
  const issues = Array.isArray(anyErr?.errors) ? anyErr.errors : []
  const detalhes = issues.map((e) => {
    const issue = e as { path?: unknown[]; message?: string }
    // Remove índices numéricos do caminho (ex.: precos.0.preco -> precos.preco).
    const pathArr = (issue.path || []).filter((p) => typeof p !== 'number') as string[]
    const pathKey = pathArr.join('.')
    const rotulo = ROTULOS[pathKey] || pathArr.join(' → ') || 'campo'
    return `${rotulo}: ${issue.message}`
  })
  const message =
    detalhes.length > 0 ? `Dados inválidos — ${detalhes.join('; ')}` : 'Dados inválidos'
  return { message, erros: anyErr?.errors ?? [] }
}
