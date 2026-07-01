/**
 * Testes unitários para consulta de status SEFAZ (sefaz-status.ts)
 * Valida: probe de contingência, detecção de disponibilidade, tratamento de erros
 */

import { describe, it, expect, vi } from 'vitest'
import {
  consultarStatusSefaz,
  sefazEstaDisponivel,
  executarProbeContingencia,
  podeRetornarAoNormal,
  type ResultadoProbeStatus,
} from './sefaz-status'
import type { SefazClient, StatusServico } from './tipos'

// === Helpers de teste ===

function criarClientMock(statusOverrides?: Partial<StatusServico>): SefazClient {
  const statusPadrao: StatusServico = {
    disponivel: true,
    codigoStatus: 107,
    motivo: 'Serviço em Operação',
    tempoMedio: 1,
    dataHoraConsulta: new Date('2024-01-15T10:00:00Z'),
    ...statusOverrides,
  }

  return {
    transmitir: vi.fn(),
    consultarStatus: vi.fn().mockResolvedValue(statusPadrao),
    consultarProtocolo: vi.fn(),
    distribuicaoDFe: vi.fn(),
  }
}

function criarClientMockComErro(erro: Error): SefazClient {
  return {
    transmitir: vi.fn(),
    consultarStatus: vi.fn().mockRejectedValue(erro),
    consultarProtocolo: vi.fn(),
    distribuicaoDFe: vi.fn(),
  }
}

// === Testes ===

describe('sefaz-status', () => {
  describe('consultarStatusSefaz', () => {
    it('retorna disponível quando cStat=107', async () => {
      const client = criarClientMock()
      const resultado = await consultarStatusSefaz(client, 'SP')

      expect(resultado.disponivel).toBe(true)
      expect(resultado.codigoStatus).toBe(107)
      expect(resultado.motivo).toBe('Serviço em Operação')
      expect(resultado.uf).toBe('SP')
      expect(resultado.erroConexao).toBe(false)
      expect(resultado.mensagemErro).toBeUndefined()
    })

    it('retorna indisponível quando cStat != 107', async () => {
      const client = criarClientMock({
        disponivel: false,
        codigoStatus: 109,
        motivo: 'Serviço paralisado momentaneamente',
      })

      const resultado = await consultarStatusSefaz(client, 'MG')

      expect(resultado.disponivel).toBe(false)
      expect(resultado.codigoStatus).toBe(109)
      expect(resultado.motivo).toBe('Serviço paralisado momentaneamente')
      expect(resultado.uf).toBe('MG')
      expect(resultado.erroConexao).toBe(false)
    })

    it('normaliza UF para uppercase', async () => {
      const client = criarClientMock()
      await consultarStatusSefaz(client, '  sp  ')

      expect(client.consultarStatus).toHaveBeenCalledWith('SP')
    })

    it('retorna tempoMedioResposta quando informado pela SEFAZ', async () => {
      const client = criarClientMock({ tempoMedio: 3 })
      const resultado = await consultarStatusSefaz(client, 'SP')

      expect(resultado.tempoMedioResposta).toBe(3)
    })

    it('trata erro de conexão retornando indisponível', async () => {
      const client = criarClientMockComErro(new Error('SEFAZ indisponível após 3 tentativas'))
      const resultado = await consultarStatusSefaz(client, 'SP')

      expect(resultado.disponivel).toBe(false)
      expect(resultado.codigoStatus).toBe(0)
      expect(resultado.erroConexao).toBe(true)
      expect(resultado.mensagemErro).toBe('SEFAZ indisponível após 3 tentativas')
      expect(resultado.uf).toBe('SP')
    })

    it('trata erro não-Error retornando mensagem como string', async () => {
      const client: SefazClient = {
        transmitir: vi.fn(),
        consultarStatus: vi.fn().mockRejectedValue('timeout'),
        consultarProtocolo: vi.fn(),
        distribuicaoDFe: vi.fn(),
      }

      const resultado = await consultarStatusSefaz(client, 'BA')

      expect(resultado.disponivel).toBe(false)
      expect(resultado.erroConexao).toBe(true)
      expect(resultado.mensagemErro).toBe('timeout')
    })

    it('preserva dataHoraConsulta do client quando sucesso', async () => {
      const dataEsperada = new Date('2024-06-01T14:30:00Z')
      const client = criarClientMock({ dataHoraConsulta: dataEsperada })

      const resultado = await consultarStatusSefaz(client, 'PR')

      expect(resultado.dataHoraConsulta).toEqual(dataEsperada)
    })

    it('gera dataHoraConsulta própria quando erro de conexão', async () => {
      const antes = new Date()
      const client = criarClientMockComErro(new Error('timeout'))
      const resultado = await consultarStatusSefaz(client, 'RS')
      const depois = new Date()

      expect(resultado.dataHoraConsulta.getTime()).toBeGreaterThanOrEqual(antes.getTime())
      expect(resultado.dataHoraConsulta.getTime()).toBeLessThanOrEqual(depois.getTime())
    })
  })

  describe('sefazEstaDisponivel', () => {
    it('retorna true quando serviço está em operação', async () => {
      const client = criarClientMock()
      const disponivel = await sefazEstaDisponivel(client, 'SP')

      expect(disponivel).toBe(true)
    })

    it('retorna false quando serviço está indisponível', async () => {
      const client = criarClientMock({ disponivel: false, codigoStatus: 109 })
      const disponivel = await sefazEstaDisponivel(client, 'SP')

      expect(disponivel).toBe(false)
    })

    it('retorna false quando há erro de conexão', async () => {
      const client = criarClientMockComErro(new Error('network error'))
      const disponivel = await sefazEstaDisponivel(client, 'SP')

      expect(disponivel).toBe(false)
    })
  })

  describe('executarProbeContingencia', () => {
    it('executa consulta e retorna resultado completo', async () => {
      const client = criarClientMock()
      const resultado = await executarProbeContingencia(client, 'GO')

      expect(resultado.disponivel).toBe(true)
      expect(resultado.uf).toBe('GO')
      expect(resultado.codigoStatus).toBe(107)
    })

    it('retorna indisponível quando probe falha', async () => {
      const client = criarClientMockComErro(new Error('Connection refused'))
      const resultado = await executarProbeContingencia(client, 'MT')

      expect(resultado.disponivel).toBe(false)
      expect(resultado.erroConexao).toBe(true)
      expect(resultado.uf).toBe('MT')
    })
  })

  describe('podeRetornarAoNormal', () => {
    it('retorna true quando disponível, sem erro e cStat=107', () => {
      const resultado: ResultadoProbeStatus = {
        disponivel: true,
        codigoStatus: 107,
        motivo: 'Serviço em Operação',
        dataHoraConsulta: new Date(),
        uf: 'SP',
        erroConexao: false,
      }

      expect(podeRetornarAoNormal(resultado)).toBe(true)
    })

    it('retorna false quando indisponível', () => {
      const resultado: ResultadoProbeStatus = {
        disponivel: false,
        codigoStatus: 109,
        motivo: 'Serviço paralisado',
        dataHoraConsulta: new Date(),
        uf: 'SP',
        erroConexao: false,
      }

      expect(podeRetornarAoNormal(resultado)).toBe(false)
    })

    it('retorna false quando há erro de conexão', () => {
      const resultado: ResultadoProbeStatus = {
        disponivel: false,
        codigoStatus: 0,
        motivo: 'Falha na comunicação',
        dataHoraConsulta: new Date(),
        uf: 'SP',
        erroConexao: true,
        mensagemErro: 'timeout',
      }

      expect(podeRetornarAoNormal(resultado)).toBe(false)
    })

    it('retorna false quando disponível=true mas cStat != 107', () => {
      // Edge case: disponível pode ser true para outros códigos na interface,
      // mas podeRetornarAoNormal é mais estrito
      const resultado: ResultadoProbeStatus = {
        disponivel: true,
        codigoStatus: 108, // hipotético código diferente
        motivo: 'Serviço parcial',
        dataHoraConsulta: new Date(),
        uf: 'SP',
        erroConexao: false,
      }

      expect(podeRetornarAoNormal(resultado)).toBe(false)
    })

    it('retorna false quando erroConexao=true mesmo com disponivel=true', () => {
      const resultado: ResultadoProbeStatus = {
        disponivel: true,
        codigoStatus: 107,
        motivo: 'Serviço em Operação',
        dataHoraConsulta: new Date(),
        uf: 'SP',
        erroConexao: true, // inconsistente, mas a função deve ser defensiva
      }

      expect(podeRetornarAoNormal(resultado)).toBe(false)
    })
  })
})
