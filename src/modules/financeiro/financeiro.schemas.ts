/**
 * Financeiro Operacional Completo (Bloco F1) — schemas Zod de entrada.
 *
 * Padrão de erro alinhado ao `formatarErroZod` de `cte.routes.ts`: mensagem
 * "campo: motivo", HTTP 422, nada persistido em caso de erro.
 */
import { z } from 'zod'
import {
  TIPOS_CONTA,
  TIPOS_CATEGORIA,
  TIPOS_LANCAMENTO,
  GRANULARIDADES,
  VALOR_MAX,
  COMPETENCIA_REGEX,
} from './financeiro.types'

const valorMonetario = z
  .number()
  .positive('deve ser maior que zero')
  .max(VALOR_MAX, 'excede o valor máximo permitido')

export const criarContaSchema = z.object({
  tipo: z.enum(TIPOS_CONTA),
  nome: z.string().min(1, 'obrigatório').max(120),
  banco: z.string().max(60).optional(),
  agencia: z.string().max(20).optional(),
  conta: z.string().max(30).optional(),
  saldoInicial: z.number().max(VALOR_MAX).optional().default(0),
})

export const transferenciaSchema = z.object({
  contaOrigemId: z.string().uuid(),
  contaDestinoId: z.string().uuid(),
  valor: valorMonetario,
  data: z.string().datetime({ offset: true }),
  descricao: z.string().max(300).optional(),
}).refine((d) => d.contaOrigemId !== d.contaDestinoId, {
  message: 'conta de origem e destino devem ser diferentes',
  path: ['contaDestinoId'],
})

export const criarCategoriaSchema = z.object({
  tipo: z.enum(TIPOS_CATEGORIA),
  codigo: z.string().min(1, 'obrigatório').max(20),
  nome: z.string().min(1, 'obrigatório').max(120),
  paiId: z.string().uuid().optional(),
})

export const criarCentroCustoSchema = z.object({
  codigo: z.string().min(1, 'obrigatório').max(20),
  nome: z.string().min(1, 'obrigatório').max(120),
})

const parteRateioSchema = z.object({
  centroCustoId: z.string().uuid(),
  valor: valorMonetario,
})

export const criarLancamentoSchema = z.object({
  contaFinanceiraId: z.string().uuid(),
  tipo: z.enum(TIPOS_LANCAMENTO),
  valor: valorMonetario,
  data: z.string().datetime({ offset: true }),
  dataCompetencia: z.string().datetime({ offset: true }).optional(),
  descricao: z.string().min(1, 'obrigatório').max(300),
  categoriaId: z.string().uuid().optional(),
  rateio: z.array(parteRateioSchema).optional(),
})

export const fluxoCaixaQuerySchema = z.object({
  de: z.string(),
  ate: z.string(),
  granularidade: z.enum(GRANULARIDADES).optional().default('MES'),
  contaFinanceiraId: z.string().uuid().optional(),
})

export const competenciaSchema = z.object({
  competencia: z.string().regex(COMPETENCIA_REGEX, 'formato esperado YYYY-MM'),
})

export const reabrirPeriodoSchema = z.object({
  competencia: z.string().regex(COMPETENCIA_REGEX, 'formato esperado YYYY-MM'),
  motivo: z.string().min(1, 'obrigatório').max(300),
})

/**
 * Formata ZodError em "campo: motivo" (HTTP 422). Réplica do padrão de
 * cte.routes.ts, sem os rótulos específicos de CT-e.
 */
export function formatarErroZod(err: any): { message: string; erros: any } {
  const issues = Array.isArray(err?.errors) ? err.errors : []
  const detalhes = issues.map((e: any) => {
    const pathArr = (e.path || []).filter((p: any) => typeof p !== 'number')
    const campo = pathArr.join('.') || 'campo'
    return `${campo}: ${e.message}`
  })
  const message = detalhes.length > 0 ? `Dados inválidos — ${detalhes.join('; ')}` : 'Dados inválidos'
  return { message, erros: err?.errors }
}
