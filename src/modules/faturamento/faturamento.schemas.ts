import { z } from 'zod'

// === Enums ===

export const tipoTarifaEnum = z.enum([
  'PALLET_DIA',
  'METRO_CUBICO',
  'MOVIMENTACAO_ENTRADA',
  'MOVIMENTACAO_SAIDA',
  'PERMANENCIA',
  'PICKING_UNITARIO',
])

export const statusContratoEnum = z.enum(['ATIVO', 'SUSPENSO', 'ENCERRADO'])

export const periodicidadeEnum = z.enum(['SEMANAL', 'QUINZENAL', 'MENSAL'])

export const statusFaturaEnum = z.enum(['GERADA', 'ENVIADA', 'PAGA', 'CANCELADA'])

// === Contratos ===

// POST /api/faturamento/contratos — Body
export const createContratoSchema = z.object({
  clienteId: z.string().uuid(),
  dataInicio: z.string().datetime(),
  dataFim: z.string().datetime(),
  periodicidade: periodicidadeEnum.default('MENSAL'),
  moeda: z.string().length(3).default('BRL'),
  observacao: z.string().optional(),
  tarifas: z.array(z.object({
    tipo: tipoTarifaEnum,
    valorUnitario: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Deve ser um decimal positivo com até 4 casas'),
    carenciaDias: z.number().int().min(0).optional(),
    descricao: z.string().max(200).optional(),
  })).min(1),
})

// PUT /api/faturamento/contratos/:id — Body
export const updateContratoSchema = z.object({
  dataFim: z.string().datetime().optional(),
  periodicidade: periodicidadeEnum.optional(),
  moeda: z.string().length(3).optional(),
  status: statusContratoEnum.optional(),
  observacao: z.string().optional(),
})

// GET /api/faturamento/contratos — Query
export const listContratosSchema = z.object({
  status: statusContratoEnum.optional(),
  clienteId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

// PUT /api/faturamento/contratos/:id/encerrar — Params
export const encerrarContratoParamsSchema = z.object({
  id: z.string().uuid(),
})

// === Tarifas ===

// POST /api/faturamento/contratos/:id/tarifas — Body (adicionar tarifa avulsa)
export const createTarifaSchema = z.object({
  tipo: tipoTarifaEnum,
  valorUnitario: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Deve ser um decimal positivo com até 4 casas'),
  carenciaDias: z.number().int().min(0).optional(),
  descricao: z.string().max(200).optional(),
})

// === Medições ===

// GET /api/faturamento/medicoes — Query
export const listMedicoesSchema = z.object({
  contratoId: z.string().uuid(),
  dataInicio: z.string().min(1), // YYYY-MM-DD
  dataFim: z.string().min(1), // YYYY-MM-DD
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

// POST /api/faturamento/medicoes/reprocessar — Body
export const reprocessarMedicaoSchema = z.object({
  contratoId: z.string().uuid(),
  data: z.string().min(1), // YYYY-MM-DD
})

// === Faturas ===

// POST /api/faturamento/faturas/gerar — Body
export const gerarFaturaSchema = z.object({
  contratoId: z.string().uuid(),
  periodoInicio: z.string().datetime(),
  periodoFim: z.string().datetime(),
})

// GET /api/faturamento/faturas — Query
export const listFaturasSchema = z.object({
  status: statusFaturaEnum.optional(),
  clienteId: z.string().uuid().optional(),
  contratoId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

// PUT /api/faturamento/faturas/:id — Body (ajustes manuais)
export const updateFaturaSchema = z.object({
  observacao: z.string().optional(),
  dataVencimento: z.string().datetime().optional(),
  itensAjuste: z.array(z.object({
    tipoTarifa: tipoTarifaEnum,
    descricao: z.string().max(200),
    quantidade: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Deve ser um decimal com até 4 casas'),
    valorUnitario: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Deve ser um decimal com até 4 casas'),
  })).optional(),
})

// PUT /api/faturamento/faturas/:id/cancelar — Body
export const cancelarFaturaSchema = z.object({
  motivo: z.string().min(1).max(500),
})

// === Relatório ===

// GET /api/faturamento/relatorio — Query
export const relatorioFaturamentoSchema = z.object({
  dataInicio: z.string().min(1), // YYYY-MM-DD
  dataFim: z.string().min(1), // YYYY-MM-DD
  clienteId: z.string().uuid().optional(),
  status: statusFaturaEnum.optional(),
})

// GET /api/faturamento/relatorio/exportar — Query (mesmos filtros)
export const exportarRelatorioSchema = relatorioFaturamentoSchema

// === Params reutilizáveis ===

// :id params (contratos, faturas)
export const faturamentoParamsSchema = z.object({
  id: z.string().uuid(),
})

// :id para faturas (enviar, pagar, cancelar)
export const faturaParamsSchema = z.object({
  id: z.string().uuid(),
})
