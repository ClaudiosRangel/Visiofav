import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NotificacaoService } from './notificacao.service'

// Mock do sseService
vi.mock('../patio/sse.service', () => ({
  sseService: {
    broadcast: vi.fn(),
  },
}))

import { sseService } from '../patio/sse.service'

const mockBroadcast = sseService.broadcast as ReturnType<typeof vi.fn>

describe('NotificacaoService', () => {
  let service: NotificacaoService

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-15T10:00:00.000Z'))
    service = new NotificacaoService()
    mockBroadcast.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('notificarCriacao', () => {
    it('emite evento "agendamento-criado" com payload correto', () => {
      const agendamento = {
        id: 'ag-001',
        docaId: 'doca-001',
        dataPrevista: new Date('2025-01-15'),
        horaInicio: '08:00',
        horaFim: '09:00',
        status: 'AGENDADO',
        motorista: 'João Silva',
        placa: 'ABC-1234',
      }

      service.notificarCriacao(agendamento, 'empresa-001')

      expect(mockBroadcast).toHaveBeenCalledWith('empresa-001', {
        type: 'agendamento-criado',
        data: {
          id: 'ag-001',
          docaId: 'doca-001',
          dataPrevista: agendamento.dataPrevista,
          horaInicio: '08:00',
          horaFim: '09:00',
          status: 'AGENDADO',
          motorista: 'João Silva',
          placa: 'ABC-1234',
        },
      })
    })

    it('trata campos opcionais como null', () => {
      const agendamento = {
        id: 'ag-002',
        docaId: null,
        dataPrevista: '2025-01-15',
        horaInicio: null,
        horaFim: null,
        status: 'AGENDADO',
        motorista: null,
        placa: null,
      }

      service.notificarCriacao(agendamento, 'empresa-001')

      expect(mockBroadcast).toHaveBeenCalledWith('empresa-001', {
        type: 'agendamento-criado',
        data: {
          id: 'ag-002',
          docaId: null,
          dataPrevista: '2025-01-15',
          horaInicio: null,
          horaFim: null,
          status: 'AGENDADO',
          motorista: null,
          placa: null,
        },
      })
    })
  })

  describe('notificarStatusAlterado', () => {
    it('emite evento "status-alterado" com status anterior e novo', () => {
      const agendamento = {
        id: 'ag-001',
        docaId: 'doca-001',
        dataPrevista: new Date('2025-01-15'),
        horaInicio: '08:00',
        horaFim: '09:00',
        status: 'NA_DOCA',
        motorista: 'João',
        placa: 'XYZ-9876',
      }

      service.notificarStatusAlterado(agendamento, 'ESPERA', 'empresa-001')

      expect(mockBroadcast).toHaveBeenCalledWith('empresa-001', {
        type: 'status-alterado',
        data: {
          id: 'ag-001',
          statusAnterior: 'ESPERA',
          statusNovo: 'NA_DOCA',
          docaId: 'doca-001',
          horaInicio: '08:00',
          horaFim: '09:00',
        },
      })
    })
  })

  describe('notificarAtraso', () => {
    it('emite evento "atraso-detectado" com minutos de atraso', () => {
      const agendamento = {
        id: 'ag-001',
        docaId: 'doca-001',
        dataPrevista: new Date('2025-01-15'),
        horaInicio: '08:00',
        horaFim: '09:00',
        status: 'AGENDADO',
        motorista: 'Maria',
        placa: 'DEF-5678',
      }

      service.notificarAtraso(agendamento, 45, 'empresa-001')

      expect(mockBroadcast).toHaveBeenCalledWith('empresa-001', {
        type: 'atraso-detectado',
        data: {
          id: 'ag-001',
          minutosAtraso: 45,
          horaInicio: '08:00',
          docaId: 'doca-001',
          motorista: 'Maria',
          placa: 'DEF-5678',
        },
      })
    })
  })

  describe('throttle (agrupamento de notificações)', () => {
    it('bloqueia eventos duplicados do mesmo tipo/empresa dentro de 500ms', () => {
      const agendamento = {
        id: 'ag-001',
        docaId: 'doca-001',
        dataPrevista: '2025-01-15',
        horaInicio: '08:00',
        horaFim: '09:00',
        status: 'AGENDADO',
        motorista: 'João',
        placa: 'ABC-1234',
      }

      service.notificarCriacao(agendamento, 'empresa-001')
      service.notificarCriacao(agendamento, 'empresa-001')
      service.notificarCriacao(agendamento, 'empresa-001')

      expect(mockBroadcast).toHaveBeenCalledTimes(1)
    })

    it('permite emissão após 500ms', () => {
      const agendamento = {
        id: 'ag-001',
        docaId: 'doca-001',
        dataPrevista: '2025-01-15',
        horaInicio: '08:00',
        horaFim: '09:00',
        status: 'AGENDADO',
        motorista: 'João',
        placa: 'ABC-1234',
      }

      service.notificarCriacao(agendamento, 'empresa-001')
      vi.advanceTimersByTime(500)
      service.notificarCriacao(agendamento, 'empresa-001')

      expect(mockBroadcast).toHaveBeenCalledTimes(2)
    })

    it('não afeta eventos de tipos diferentes na mesma empresa', () => {
      const agendamento = {
        id: 'ag-001',
        docaId: 'doca-001',
        dataPrevista: '2025-01-15',
        horaInicio: '08:00',
        horaFim: '09:00',
        status: 'NA_DOCA',
        motorista: 'João',
        placa: 'ABC-1234',
      }

      service.notificarCriacao(agendamento, 'empresa-001')
      service.notificarStatusAlterado(agendamento, 'ESPERA', 'empresa-001')
      service.notificarAtraso(agendamento, 30, 'empresa-001')

      expect(mockBroadcast).toHaveBeenCalledTimes(3)
    })

    it('não afeta mesmo tipo de evento para empresas diferentes', () => {
      const agendamento = {
        id: 'ag-001',
        docaId: 'doca-001',
        dataPrevista: '2025-01-15',
        horaInicio: '08:00',
        horaFim: '09:00',
        status: 'AGENDADO',
        motorista: 'João',
        placa: 'ABC-1234',
      }

      service.notificarCriacao(agendamento, 'empresa-001')
      service.notificarCriacao(agendamento, 'empresa-002')
      service.notificarCriacao(agendamento, 'empresa-003')

      expect(mockBroadcast).toHaveBeenCalledTimes(3)
    })

    it('clearThrottle reseta o controle de throttle', () => {
      const agendamento = {
        id: 'ag-001',
        docaId: 'doca-001',
        dataPrevista: '2025-01-15',
        horaInicio: '08:00',
        horaFim: '09:00',
        status: 'AGENDADO',
        motorista: 'João',
        placa: 'ABC-1234',
      }

      service.notificarCriacao(agendamento, 'empresa-001')
      service.clearThrottle()
      service.notificarCriacao(agendamento, 'empresa-001')

      expect(mockBroadcast).toHaveBeenCalledTimes(2)
    })
  })
})
