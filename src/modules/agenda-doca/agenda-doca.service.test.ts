import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgendaDocaService } from './agenda-doca.service'

vi.mock('../../lib/prisma', () => ({
  prisma: {
    configDoca: {
      findFirst: vi.fn(),
    },
    agendaWms: {
      findMany: vi.fn(),
    },
    bloqueioSlotDoca: {
      findFirst: vi.fn(),
    },
  },
}))

import { prisma } from '../../lib/prisma'

const mockedPrisma = vi.mocked(prisma, true)

describe('AgendaDocaService - validarConflito', () => {
  let service: AgendaDocaService
  const empresaId = 'empresa-1'

  beforeEach(() => {
    service = new AgendaDocaService()
    vi.clearAllMocks()
  })

  it('deve retornar conflito=false quando slot está livre', async () => {
    mockedPrisma.configDoca.findFirst.mockResolvedValue({
      id: 'cfg-1',
      empresaId,
      horaAberturaOp: '06:00',
      horaFechamentoOp: '22:00',
      bufferMinutos: 15,
      toleranciaAtraso: 30,
    } as any)
    mockedPrisma.agendaWms.findMany.mockResolvedValue([])
    mockedPrisma.bloqueioSlotDoca.findFirst.mockResolvedValue(null)

    const resultado = await service.validarConflito(
      { docaId: 'doca-1', dataPrevista: '2025-03-15', horaInicio: '08:00', horaFim: '09:00' },
      empresaId,
    )

    expect(resultado.conflito).toBe(false)
  })

  it('deve retornar conflito=true quando há agendamento sobreposto', async () => {
    mockedPrisma.configDoca.findFirst.mockResolvedValue({
      id: 'cfg-1',
      empresaId,
      horaAberturaOp: '06:00',
      horaFechamentoOp: '22:00',
      bufferMinutos: 15,
      toleranciaAtraso: 30,
    } as any)
    mockedPrisma.agendaWms.findMany.mockResolvedValue([
      { id: 'ag-1', horaInicio: '08:30', horaFim: '09:30', motorista: 'João' },
    ] as any)
    mockedPrisma.bloqueioSlotDoca.findFirst.mockResolvedValue(null)

    const resultado = await service.validarConflito(
      { docaId: 'doca-1', dataPrevista: '2025-03-15', horaInicio: '08:00', horaFim: '09:00' },
      empresaId,
    )

    expect(resultado.conflito).toBe(true)
    expect(resultado.agendamentoConflitante).toBeDefined()
    expect(resultado.motivo).toContain('Conflito com agendamento existente')
  })

  it('deve retornar conflito=true quando período está em bloqueio', async () => {
    mockedPrisma.configDoca.findFirst.mockResolvedValue({
      id: 'cfg-1',
      empresaId,
      horaAberturaOp: '06:00',
      horaFechamentoOp: '22:00',
      bufferMinutos: 15,
      toleranciaAtraso: 30,
    } as any)
    mockedPrisma.agendaWms.findMany.mockResolvedValue([])
    mockedPrisma.bloqueioSlotDoca.findFirst.mockResolvedValue({
      id: 'bloq-1',
      motivo: 'Manutenção preventiva',
      dataInicio: new Date('2025-03-15T07:00:00'),
      dataFim: new Date('2025-03-15T10:00:00'),
    } as any)

    const resultado = await service.validarConflito(
      { docaId: 'doca-1', dataPrevista: '2025-03-15', horaInicio: '08:00', horaFim: '09:00' },
      empresaId,
    )

    expect(resultado.conflito).toBe(true)
    expect(resultado.motivo).toContain('Doca bloqueada')
    expect(resultado.motivo).toContain('Manutenção preventiva')
  })

  it('deve retornar conflito=true quando horário está fora do período operacional', async () => {
    mockedPrisma.configDoca.findFirst.mockResolvedValue({
      id: 'cfg-1',
      empresaId,
      horaAberturaOp: '06:00',
      horaFechamentoOp: '22:00',
      bufferMinutos: 15,
      toleranciaAtraso: 30,
    } as any)

    const resultado = await service.validarConflito(
      { docaId: 'doca-1', dataPrevista: '2025-03-15', horaInicio: '05:00', horaFim: '06:30' },
      empresaId,
    )

    expect(resultado.conflito).toBe(true)
    expect(resultado.motivo).toContain('fora do período operacional')
  })
})
