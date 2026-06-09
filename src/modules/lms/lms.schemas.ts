import { z } from 'zod'

// === METAS CRUD ===

// POST /api/lms/metas — Criar meta de operação
export const createMetaSchema = z.object({
  tipoOperacao: z.enum(['CONFERENCIA', 'ENDERECAMENTO', 'SEPARACAO', 'CARREGAMENTO', 'INVENTARIO']),
  tempoMetaMinutos: z.number().positive(),
  unidadeMedida: z.enum(['POR_ITEM', 'POR_PALLET', 'POR_LINHA', 'POR_VOLUME']),
  toleranciaPercentual: z.number().min(0).max(100),
  categoriaProduto: z.enum(['PESADO', 'FRAGIL', 'NORMAL', 'REFRIGERADO']).optional(),
})

// PUT /api/lms/metas/:id — Atualizar meta
export const updateMetaSchema = createMetaSchema.partial()

// Params para metas
export const metaParamsSchema = z.object({
  id: z.string().uuid(),
})

// === PRODUTIVIDADE ===

// GET /api/lms/produtividade — Listar produtividade
export const listProdutividadeSchema = z.object({
  operadorId: z.string().uuid().optional(),
  tipoOperacao: z.enum(['CONFERENCIA', 'ENDERECAMENTO', 'SEPARACAO', 'CARREGAMENTO', 'INVENTARIO']).optional(),
  dataInicio: z.string().min(1),
  dataFim: z.string().min(1),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
})

// === RANKING ===

// GET /api/lms/ranking — Ranking de funcionários
export const rankingSchema = z.object({
  periodo: z.enum(['DIA', 'SEMANA', 'MES']),
  tipoOperacao: z.enum(['CONFERENCIA', 'ENDERECAMENTO', 'SEPARACAO', 'CARREGAMENTO', 'INVENTARIO']).optional(),
  dataReferencia: z.string().optional(),
})

// === RELATÓRIOS ===

// GET /api/lms/relatorios/funcionario/:funcionarioId — Relatório individual
export const relatorioFuncionarioParamsSchema = z.object({
  funcionarioId: z.string().uuid(),
})

export const relatorioFuncionarioQuerySchema = z.object({
  dataInicio: z.string().min(1),
  dataFim: z.string().min(1),
})

// GET /api/lms/relatorios/operacao/:tipo — Relatório por operação
export const relatorioOperacaoParamsSchema = z.object({
  tipo: z.enum(['CONFERENCIA', 'ENDERECAMENTO', 'SEPARACAO', 'CARREGAMENTO', 'INVENTARIO']),
})

export const relatorioOperacaoQuerySchema = z.object({
  dataInicio: z.string().min(1),
  dataFim: z.string().min(1),
})

// === EXPORTAR ===

// GET /api/lms/exportar — Exportar relatórios CSV
export const exportarSchema = z.object({
  tipo: z.enum(['RANKING', 'FUNCIONARIO', 'OPERACAO']),
  dataInicio: z.string().min(1),
  dataFim: z.string().min(1),
  operadorId: z.string().uuid().optional(),
})

// === INCENTIVOS ===

// POST /api/lms/incentivos — Criar incentivo
export const createIncentivoSchema = z.object({
  faixa: z.enum(['ACIMA_META', 'NA_META', 'ABAIXO_META']),
  pontosIncentivo: z.number().int(),
  descricao: z.string().optional(),
})

// PUT /api/lms/incentivos/:id — Atualizar incentivo
export const updateIncentivoSchema = createIncentivoSchema.partial()

// Params para incentivos
export const incentivoParamsSchema = z.object({
  id: z.string().uuid(),
})

// === PAUSAS ===

// POST /api/lms/pausas — Iniciar pausa
export const iniciarPausaSchema = z.object({
  ordemServicoId: z.string().uuid().optional(),
  tipo: z.enum(['INTERVALO', 'ALMOCO', 'BANHEIRO', 'OUTROS']),
})

// PUT /api/lms/pausas/:id/encerrar — Encerrar pausa
export const encerrarPausaParamsSchema = z.object({
  id: z.string().uuid(),
})
