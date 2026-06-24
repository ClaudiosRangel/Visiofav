import { z } from 'zod'

// ─── Helpers ───────────────────────────────────────────────────────────────────

const horaRegex = /^\d{2}:\d{2}$/

// ─── Params ────────────────────────────────────────────────────────────────────

export const idParamsSchema = z.object({
  id: z.string().uuid(),
})

// ─── Criação de Agendamento ────────────────────────────────────────────────────

export const criarAgendamentoSchema = z
  .object({
    fornecedorId: z.string().uuid().optional(),
    fornecedorCnpj: z.string().optional(),
    pedidoCompraId: z.string().uuid().optional(),
    docaId: z.string().uuid(),
    dataPrevista: z.string().min(1), // YYYY-MM-DD
    horaInicio: z.string().regex(horaRegex, 'Formato HH:MM').optional(),
    horaFim: z.string().regex(horaRegex, 'Formato HH:MM').optional(),
    autoAgendar: z.boolean().optional(),
    duracaoMinutos: z.number().int().min(15).max(480).optional(),
    motorista: z.string().optional(),
    placa: z.string().optional(),
    tipoVeiculo: z.string().optional(),
    qtdCaixas: z.number().int().min(0).optional(),
    qtdPaletes: z.number().int().min(0).optional(),
    observacao: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.horaInicio && data.horaFim) {
        return data.horaFim > data.horaInicio
      }
      return true
    },
    { message: 'horaFim deve ser posterior a horaInicio', path: ['horaFim'] },
  )

// ─── Edição de Agendamento ─────────────────────────────────────────────────────

export const editarAgendamentoSchema = z
  .object({
    motorista: z.string().optional(),
    placa: z.string().optional(),
    tipoVeiculo: z.string().optional(),
    qtdCaixas: z.number().int().nullable().optional(),
    qtdPaletes: z.number().int().nullable().optional(),
    observacao: z.string().optional(),
    horaInicio: z.string().regex(horaRegex, 'Formato HH:MM').optional(),
    horaFim: z.string().regex(horaRegex, 'Formato HH:MM').optional(),
    docaId: z.string().uuid().optional(),
    fornecedorId: z.string().uuid().nullable().optional(),
  })
  .refine(
    (data) => {
      if (data.horaInicio && data.horaFim) {
        return data.horaFim > data.horaInicio
      }
      return true
    },
    { message: 'horaFim deve ser posterior a horaInicio', path: ['horaFim'] },
  )

// ─── Mover Agendamento (Drag-and-Drop) ────────────────────────────────────────

export const moverAgendamentoSchema = z
  .object({
    docaId: z.string().uuid().optional(),
    dataPrevista: z.string().optional(), // YYYY-MM-DD
    horaInicio: z.string().regex(horaRegex, 'Formato HH:MM').optional(),
    horaFim: z.string().regex(horaRegex, 'Formato HH:MM').optional(),
  })
  .refine(
    (data) => {
      if (data.horaInicio && data.horaFim) {
        return data.horaFim > data.horaInicio
      }
      return true
    },
    { message: 'horaFim deve ser posterior a horaInicio', path: ['horaFim'] },
  )

// ─── Alterar Status ────────────────────────────────────────────────────────────

export const alterarStatusSchema = z.object({
  status: z.enum([
    'AGENDADO',
    'CONFIRMADO',
    'ESPERA',
    'NA_DOCA',
    'CONFERINDO',
    'CONFERIDO',
    'RECEBIDO',
    'CANCELADO',
  ]),
})

// ─── Queries ───────────────────────────────────────────────────────────────────

export const listQuerySchema = z.object({
  status: z.string().optional(),
  data: z.string().optional(), // YYYY-MM-DD — filtra por dia específico
  dataInicio: z.string().optional(),
  dataFim: z.string().optional(),
  docaId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
})

export const timelineQuerySchema = z.object({
  data: z.string().min(1), // YYYY-MM-DD
  visualizacao: z.enum(['dia', 'semana', 'mes']).default('dia'),
})

export const gradeQuerySchema = z.object({
  data: z.string().min(1), // YYYY-MM-DD
  slotMinutos: z.coerce.number().int().min(10).max(120).optional().default(30),
})

export const estatisticasQuerySchema = z.object({
  dataInicio: z.string().min(1), // YYYY-MM-DD
  dataFim: z.string().min(1), // YYYY-MM-DD
})

// ─── Bloqueios ─────────────────────────────────────────────────────────────────

export const criarBloqueioSchema = z
  .object({
    docaId: z.string().uuid(),
    dataInicio: z.string().datetime(),
    dataFim: z.string().datetime(),
    motivo: z.string().min(1).max(200),
  })
  .refine((data) => data.dataFim > data.dataInicio, {
    message: 'dataFim deve ser posterior a dataInicio',
    path: ['dataFim'],
  })

// ─── Configuração de Doca ──────────────────────────────────────────────────────

export const configDocaSchema = z.object({
  horaAberturaOp: z.string().regex(horaRegex, 'Formato HH:MM').optional(),
  horaFechamentoOp: z.string().regex(horaRegex, 'Formato HH:MM').optional(),
  bufferMinutos: z.number().int().min(0).optional(),
  toleranciaAtraso: z.number().int().min(0).optional(),
})
