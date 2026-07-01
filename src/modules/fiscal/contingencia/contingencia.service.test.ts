import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CodigoErroFiscal, ErroFiscal } from '../erros'
import type { SefazClient, StatusServico } from '../emissor-dfe/sefaz/tipos'
import { ServicoSefaz, AmbienteSefaz } from '../emissor-dfe/sefaz/tipos'

// Mock do prisma
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    filaContingencia: {
      count: vi.fn(),
    },
    logContingencia: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}))

import { prisma } from '../../../lib/prisma'
import { ContingenciaService } from './contingencia.service'

// === Mocks ===

const mockFilaCount = prisma.filaContingencia.count as ReturnType<typeof vi.fn>
const mockLogCreate = prisma.logContingencia.create as ReturnType<typeof vi.fn>
const mockLogFindMany = prisma.logContingencia.findMany as ReturnType<typeof vi.fn>
const mockLogCount = prisma.logContingencia.count as ReturnType<typeof vi.fn>

function criarMockSefazClient(disponivel: boolean = true): SefazClient {
  return {
    transmitir: vi.fn(),
    consultarStatus: vi.fn().mockResolvedValue({
      disponivel,
      codigoStatus: disponivel ? 107 : 0,
      motivo: disponivel ? 'Serviço em Operação' : 'Serviço indisponível',
      tempoMedio: 500,
      dataHoraConsulta: new Date(),
    } satisfies StatusServico),
    consultarProtocolo: vi.fn(),
    distribuicaoDFe: vi.fn(),
  }
}

// === Testes ===

describe('ContingenciaService', () => {
  let service: ContingenciaService
  const empresaId = 'empresa-test-001'

  beforeEach(() => {
    vi.clearAllMocks()
    service = new ContingenciaService()
    mockFilaCount.mockResolvedValue(0)
    mockLogCreate.mockResolvedValue({ id: 'log-001' })
  })

  describe('obterStatus', () => {
    it('retorna estado NORMAL para empresa sem falhas', async () => {
      const status = await service.obterStatus(empresaId)

      expect(status.estado).toBe('NORMAL')
      expect(status.modalidade).toBeNull()
      expect(status.falhasConsecutivas).toBe(0)
      expect(status.entradaContingenciaEm).toBeNull()
      expect(status.documentosPendentes).toBe(0)
    })

    it('retorna contagem de documentos pendentes', async () => {
      mockFilaCount.mockResolvedValue(15)

      const status = await service.obterStatus(empresaId)

      expect(status.documentosPendentes).toBe(15)
      expect(mockFilaCount).toHaveBeenCalledWith({
        where: { empresaId, status: 'PENDENTE' },
      })
    })
  })

  describe('registrarFalha', () => {
    it('incrementa falhas consecutivas sem ativar contingência (1ª falha)', async () => {
      const resultado = await service.registrarFalha(empresaId, 'Timeout SEFAZ')

      expect(resultado.contingenciaAtivada).toBe(false)
      expect(resultado.falhasConsecutivas).toBe(1)
      expect(resultado.estado).toBe('NORMAL')
    })

    it('incrementa falhas consecutivas sem ativar contingência (2ª falha)', async () => {
      await service.registrarFalha(empresaId, 'Timeout SEFAZ')
      const resultado = await service.registrarFalha(empresaId, 'Timeout SEFAZ')

      expect(resultado.contingenciaAtivada).toBe(false)
      expect(resultado.falhasConsecutivas).toBe(2)
      expect(resultado.estado).toBe('NORMAL')
    })

    it('ativa contingência após 3 falhas consecutivas (Req 30.1)', async () => {
      await service.registrarFalha(empresaId, 'Timeout SEFAZ')
      await service.registrarFalha(empresaId, 'Timeout SEFAZ')
      const resultado = await service.registrarFalha(empresaId, 'SEFAZ indisponível', 'SVC_AN')

      expect(resultado.contingenciaAtivada).toBe(true)
      expect(resultado.falhasConsecutivas).toBe(3)
      expect(resultado.estado).toBe('CONTINGENCIA')
    })

    it('registra log de entrada na contingência (Req 30.5)', async () => {
      await service.registrarFalha(empresaId, 'Timeout')
      await service.registrarFalha(empresaId, 'Timeout')
      await service.registrarFalha(empresaId, 'SEFAZ indisponível', 'SVC_RS')

      expect(mockLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          empresaId,
          acao: 'ENTRADA',
          motivo: 'SEFAZ indisponível',
          modalidade: 'SVC_RS',
          documentosPendentes: 0,
        }),
      })
    })

    it('usa modalidade SVC_AN por padrão', async () => {
      await service.registrarFalha(empresaId, 'Timeout')
      await service.registrarFalha(empresaId, 'Timeout')
      await service.registrarFalha(empresaId, 'Timeout')

      expect(mockLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          modalidade: 'SVC_AN',
        }),
      })
    })

    it('incrementa falhas mas não reativa se já em contingência', async () => {
      // Ativar contingência
      await service.registrarFalha(empresaId, 'Timeout')
      await service.registrarFalha(empresaId, 'Timeout')
      await service.registrarFalha(empresaId, 'Timeout')

      // Registrar mais uma falha (já em contingência)
      const resultado = await service.registrarFalha(empresaId, 'Continua indisponível')

      expect(resultado.contingenciaAtivada).toBe(false)
      expect(resultado.falhasConsecutivas).toBe(4)
      expect(resultado.estado).toBe('CONTINGENCIA')
    })
  })

  describe('registrarSucesso', () => {
    it('reseta contador de falhas consecutivas', async () => {
      await service.registrarFalha(empresaId, 'Timeout')
      await service.registrarFalha(empresaId, 'Timeout')

      service.registrarSucesso(empresaId)

      const status = await service.obterStatus(empresaId)
      expect(status.falhasConsecutivas).toBe(0)
    })
  })

  describe('estaEmContingencia', () => {
    it('retorna false quando em modo normal', () => {
      expect(service.estaEmContingencia(empresaId)).toBe(false)
    })

    it('retorna true quando em contingência', async () => {
      await service.registrarFalha(empresaId, 'Timeout')
      await service.registrarFalha(empresaId, 'Timeout')
      await service.registrarFalha(empresaId, 'Timeout')

      expect(service.estaEmContingencia(empresaId)).toBe(true)
    })
  })

  describe('ativarContingencia', () => {
    it('lança erro se já estiver em contingência', async () => {
      // Ativa via falhas
      await service.registrarFalha(empresaId, 'Timeout')
      await service.registrarFalha(empresaId, 'Timeout')
      await service.registrarFalha(empresaId, 'Timeout')

      await expect(
        service.ativarContingencia(empresaId, 'Teste', 'SVC_AN')
      ).rejects.toThrow(ErroFiscal)
    })
  })

  describe('executarProbe', () => {
    it('retorna ao normal quando SEFAZ responde com sucesso (Req 30.4)', async () => {
      const client = criarMockSefazClient(true)

      // Ativar contingência primeiro
      await service.registrarFalha(empresaId, 'Timeout')
      await service.registrarFalha(empresaId, 'Timeout')
      await service.registrarFalha(empresaId, 'Timeout')

      const resultado = await service.executarProbe(empresaId, client, 'SP')

      expect(resultado.retornouAoNormal).toBe(true)
      expect(resultado.estado).toBe('NORMAL')
      expect(resultado.probeResult.disponivel).toBe(true)
    })

    it('permanece em contingência quando SEFAZ indisponível', async () => {
      const client = criarMockSefazClient(false)

      // Ativar contingência primeiro
      await service.registrarFalha(empresaId, 'Timeout')
      await service.registrarFalha(empresaId, 'Timeout')
      await service.registrarFalha(empresaId, 'Timeout')

      const resultado = await service.executarProbe(empresaId, client, 'SP')

      expect(resultado.retornouAoNormal).toBe(false)
      expect(resultado.estado).toBe('CONTINGENCIA')
    })

    it('registra log de saída ao retornar ao normal (Req 30.5)', async () => {
      const client = criarMockSefazClient(true)

      await service.registrarFalha(empresaId, 'Timeout')
      await service.registrarFalha(empresaId, 'Timeout')
      await service.registrarFalha(empresaId, 'Timeout')

      await service.executarProbe(empresaId, client, 'SP')

      // Deve ter registrado log de ENTRADA (na ativação) e SAIDA (no retorno)
      expect(mockLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          empresaId,
          acao: 'SAIDA',
          motivo: 'SEFAZ retornou ao estado operacional (cStat=107)',
        }),
      })
    })

    it('não executa probe se sistema já em modo normal', async () => {
      const client = criarMockSefazClient(true)

      const resultado = await service.executarProbe(empresaId, client, 'SP')

      expect(resultado.retornouAoNormal).toBe(false)
      expect(resultado.estado).toBe('NORMAL')
      expect(client.consultarStatus).not.toHaveBeenCalled()
    })

    it('respeita intervalo mínimo de 60s entre probes', async () => {
      const client = criarMockSefazClient(false)

      // Ativar contingência
      await service.registrarFalha(empresaId, 'Timeout')
      await service.registrarFalha(empresaId, 'Timeout')
      await service.registrarFalha(empresaId, 'Timeout')

      // Primeira probe
      await service.executarProbe(empresaId, client, 'SP')

      // Segunda probe imediata — deve ser ignorada
      const resultado = await service.executarProbe(empresaId, client, 'SP')

      expect(resultado.probeResult.motivo).toBe('Intervalo mínimo entre probes não atingido')
      // consultarStatus deve ter sido chamada apenas 1 vez
      expect(client.consultarStatus).toHaveBeenCalledTimes(1)
    })
  })

  describe('desativarContingencia', () => {
    it('reseta estado para normal e registra log de saída', async () => {
      // Ativar contingência
      await service.registrarFalha(empresaId, 'Timeout')
      await service.registrarFalha(empresaId, 'Timeout')
      await service.registrarFalha(empresaId, 'Timeout')

      mockLogCreate.mockClear()

      await service.desativarContingencia(empresaId)

      const status = await service.obterStatus(empresaId)
      expect(status.estado).toBe('NORMAL')
      expect(status.falhasConsecutivas).toBe(0)
      expect(status.modalidade).toBeNull()

      expect(mockLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          acao: 'SAIDA',
        }),
      })
    })
  })

  describe('listarLogs', () => {
    it('lista logs com paginação', async () => {
      const mockLogs = [
        { id: 'log-1', acao: 'ENTRADA', motivo: 'Timeout', modalidade: 'SVC_AN', documentosPendentes: 5, timestamp: new Date() },
      ]
      mockLogFindMany.mockResolvedValue(mockLogs)
      mockLogCount.mockResolvedValue(1)

      const resultado = await service.listarLogs(empresaId, { page: 1, limit: 10 })

      expect(resultado.data).toEqual(mockLogs)
      expect(resultado.total).toBe(1)
      expect(resultado.page).toBe(1)
    })

    it('filtra por ação (ENTRADA/SAIDA)', async () => {
      mockLogFindMany.mockResolvedValue([])
      mockLogCount.mockResolvedValue(0)

      await service.listarLogs(empresaId, { page: 1, limit: 10, acao: 'ENTRADA' })

      expect(mockLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { empresaId, acao: 'ENTRADA' },
        })
      )
    })
  })

  describe('obterModalidade', () => {
    it('retorna null quando em modo normal', () => {
      expect(service.obterModalidade(empresaId)).toBeNull()
    })

    it('retorna modalidade configurada quando em contingência', async () => {
      await service.registrarFalha(empresaId, 'Timeout')
      await service.registrarFalha(empresaId, 'Timeout')
      await service.registrarFalha(empresaId, 'Timeout', 'SVC_RS')

      // A modalidade é definida na 3ª falha (que ativa contingência)
      expect(service.obterModalidade(empresaId)).toBe('SVC_RS')
    })
  })
})
