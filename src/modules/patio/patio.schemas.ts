import { z } from 'zod'

// ─── Regex para placas brasileiras ─────────────────────────────────────────────
const PLACA_ANTIGA_REGEX = /^[A-Z]{3}[0-9]{4}$/
const PLACA_MERCOSUL_REGEX = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/

// ─── Enums ─────────────────────────────────────────────────────────────────────
const tipoOperacaoEnum = z.enum(['CARGA', 'DESCARGA', 'DEVOLUCAO', 'TRANSFERENCIA'])
const statusVeiculoEnum = z.enum(['AGUARDANDO', 'NA_DOCA', 'LIBERADO'])
const tipoRelatorioEnum = z.enum(['PERMANENCIA', 'FILA', 'OCUPACAO'])

// ─── Paginação base ────────────────────────────────────────────────────────────
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

// ─── Veículos ──────────────────────────────────────────────────────────────────

// POST /api/patio/veiculos/entrada — Body
export const entradaVeiculoSchema = z.object({
  placa: z.string().refine(
    (val) => PLACA_ANTIGA_REGEX.test(val) || PLACA_MERCOSUL_REGEX.test(val),
    { message: 'Placa inválida. Use formato antigo (ABC1234) ou Mercosul (ABC1D23)' },
  ),
  motoristaNome: z.string().min(1).max(150),
  motoristaDocumento: z.string().min(1).max(20),
  transportadoraId: z.string().uuid().optional(),
  tipoOperacao: tipoOperacaoEnum,
  agendamentoId: z.string().uuid().optional(),
  cdId: z.string().uuid(),
})

// PUT /api/patio/veiculos/:id/saida — Params
export const saidaVeiculoSchema = z.object({
  id: z.string().uuid(),
})

// GET /api/patio/veiculos — Query
export const listVeiculosSchema = paginationSchema.extend({
  status: statusVeiculoEnum.optional(),
  cdId: z.string().uuid().optional(),
})

// ─── Fila ──────────────────────────────────────────────────────────────────────

// GET /api/patio/fila — Query
export const listFilaSchema = z.object({
  cdId: z.string().uuid(),
})

// PUT /api/patio/fila/:id/prioridade — Params + Body
export const alterarPrioridadeParamsSchema = z.object({
  id: z.string().uuid(),
})

export const alterarPrioridadeSchema = z.object({
  prioridade: z.number().int().min(0).max(100),
  justificativa: z.string().min(5),
})

// ─── Chamada ───────────────────────────────────────────────────────────────────

// POST /api/patio/chamadas — Body
export const emitirChamadaSchema = z.object({
  veiculoId: z.string().uuid(),
  docaId: z.string().uuid(),
})

// PUT /api/patio/chamadas/:id/atender — Params
export const atenderChamadaSchema = z.object({
  id: z.string().uuid(),
})

// PUT /api/patio/chamadas/:id/cancelar — Params + Body
export const cancelarChamadaParamsSchema = z.object({
  id: z.string().uuid(),
})

export const cancelarChamadaSchema = z.object({
  motivo: z.string().min(5),
})

// ─── Sugestão ──────────────────────────────────────────────────────────────────

// GET /api/patio/sugestao/:docaId — Params
export const sugestaoChamadaSchema = z.object({
  docaId: z.string().uuid(),
})

// ─── Configuração ──────────────────────────────────────────────────────────────

// GET /api/patio/config — Query
export const getConfigSchema = z.object({
  cdId: z.string().uuid(),
})

// PUT /api/patio/config — Body
export const updateConfigSchema = z.object({
  cdId: z.string().uuid(),
  limitePermMinutos: z.number().int().min(1),
  alertaPermAtivo: z.boolean(),
  prioridadeAgendado: z.number().int(),
  prioridadeDescarga: z.number().int(),
  prioridadeCarga: z.number().int(),
  prioridadePadrao: z.number().int(),
})

// ─── Relatórios ────────────────────────────────────────────────────────────────

const relatorioBaseSchema = z.object({
  cdId: z.string().uuid().optional(),
  dataInicio: z.string().min(1),
  dataFim: z.string().min(1),
})

// GET /api/patio/relatorios/permanencia — Query
export const relatorioPermanenciaSchema = relatorioBaseSchema

// GET /api/patio/relatorios/fila — Query
export const relatorioFilaSchema = relatorioBaseSchema

// GET /api/patio/relatorios/ocupacao — Query
export const relatorioOcupacaoSchema = relatorioBaseSchema

// ─── Exportar ──────────────────────────────────────────────────────────────────

// GET /api/patio/exportar — Query
export const exportarPatioSchema = z.object({
  tipo: tipoRelatorioEnum,
  cdId: z.string().uuid().optional(),
  dataInicio: z.string().min(1),
  dataFim: z.string().min(1),
})
