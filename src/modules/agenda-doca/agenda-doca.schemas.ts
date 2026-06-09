import { z } from 'zod'

// GET /api/agenda-doca/timeline — Query
export const timelineQuerySchema = z.object({
  data: z.string().min(1), // YYYY-MM-DD
  visualizacao: z.enum(['dia', 'semana', 'mes']).default('dia'),
})

// POST /api/agenda-doca/agendar — Body
export const agendarSchema = z.object({
  docaId: z.string().uuid(),
  fornecedorId: z.string().uuid().optional(),
  dataPrevista: z.string().min(1), // YYYY-MM-DD
  horaInicio: z.string().regex(/^\d{2}:\d{2}$/), // "08:00"
  horaFim: z.string().regex(/^\d{2}:\d{2}$/), // "10:00"
  motorista: z.string().optional(),
  placa: z.string().optional(),
  tipoVeiculo: z.string().optional(),
  qtdCaixas: z.number().int().min(0).optional(),
  qtdPaletes: z.number().int().min(0).optional(),
  observacao: z.string().optional(),
})

// PUT /api/agenda-doca/:id/mover — Body
export const moverAgendamentoSchema = z.object({
  docaId: z.string().uuid().optional(), // nova doca (se mudar)
  dataPrevista: z.string().optional(), // nova data
  horaInicio: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  horaFim: z.string().regex(/^\d{2}:\d{2}$/).optional(),
})

// PUT /api/agenda-doca/:id/chegada — Body
export const registrarChegadaSchema = z.object({
  horaChegadaReal: z.string().datetime().optional(), // se não informado, usa now()
})

// POST /api/agenda-doca/bloqueios — Body
export const criarBloqueioSchema = z.object({
  docaId: z.string().uuid(),
  dataInicio: z.string().datetime(),
  dataFim: z.string().datetime(),
  motivo: z.string().min(1).max(200),
})

// PUT /api/agenda-doca/config — Body
export const atualizarConfigDocaSchema = z.object({
  horaAberturaOp: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  horaFechamentoOp: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  bufferMinutos: z.number().int().min(0).optional(),
  toleranciaAtraso: z.number().int().min(0).optional(),
})

// Params
export const agendaDocaParamsSchema = z.object({
  id: z.string().uuid(),
})

// GET /api/agenda-doca/estatisticas — Query
export const estatisticasQuerySchema = z.object({
  dataInicio: z.string().min(1),
  dataFim: z.string().min(1),
})
