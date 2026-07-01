/**
 * Testes unitários para nfe-eventos.ts
 * Cancelamento, Carta de Correção e Inutilização de NF-e
 *
 * Validates: Requirements 1.5, 1.6, 1.7, 1.8
 */

import { describe, it, expect, vi } from 'vitest'

// Mock xml-signer to avoid dependency on xml-crypto/node-forge
vi.mock('../xml/xml-signer', () => ({
  assinarXML: vi.fn(() => ({
    xmlAssinado: '<xml-assinado/>',
    certificadoX509: 'cert-base64',
  })),
}))

import {
  validarJustificativa,
  validarTextoCorrecao,
  dentroDoLimiteCancelamento,
  validarFaixaInutilizacao,
  validarLimiteCCe,
  gerarXmlCancelamento,
  gerarXmlCartaCorrecao,
  gerarXmlInutilizacao,
  cancelar,
  cartaCorrecao,
  inutilizar,
  PRAZO_CANCELAMENTO_HORAS,
  MAX_CCE_POR_NFE,
  MAX_FAIXA_INUTILIZACAO,
} from './nfe-eventos'
import { CodigoErroFiscal, ErroFiscal } from '../../erros'
import type { SefazClient, RespostaSefaz } from '../sefaz/tipos'
import { ServicoSefaz } from '../sefaz/tipos'

// === Mocks ===

function criarSefazClientMock(resposta?: Partial<RespostaSefaz>): SefazClient {
  return {
    transmitir: vi.fn().mockResolvedValue({
      sucesso: true,
      protocolo: '135210000000001',
      dataRecebimento: '2024-01-15T10:00:00-03:00',
      codigoStatus: 135,
      motivoStatus: 'Evento registrado e vinculado a NF-e',
      xmlRetorno: '<retEvento/>',
      ...resposta,
    }),
    consultarStatus: vi.fn(),
    consultarProtocolo: vi.fn(),
    distribuicaoDFe: vi.fn(),
  }
}

function criarCertificadoMock() {
  return {
    pfxBuffer: Buffer.from('fake-pfx-data'),
    senha: 'teste123',
  }
}

// === Testes de Validação ===

describe('validarJustificativa', () => {
  it('deve aceitar justificativa com 15 caracteres', () => {
    expect(() => validarJustificativa('a'.repeat(15))).not.toThrow()
  })

  it('deve aceitar justificativa com 255 caracteres', () => {
    expect(() => validarJustificativa('a'.repeat(255))).not.toThrow()
  })

  it('deve rejeitar justificativa com menos de 15 caracteres', () => {
    expect(() => validarJustificativa('curto')).toThrow(ErroFiscal)
    try {
      validarJustificativa('curto')
    } catch (err) {
      expect((err as ErroFiscal).codigo).toBe(CodigoErroFiscal.JUSTIFICATIVA_INVALIDA)
    }
  })

  it('deve rejeitar justificativa com mais de 255 caracteres', () => {
    expect(() => validarJustificativa('a'.repeat(256))).toThrow(ErroFiscal)
  })

  it('deve considerar trim no comprimento', () => {
    // "   curto   " tem 5 chars after trim → rejeitado
    expect(() => validarJustificativa('   curto   ')).toThrow(ErroFiscal)
  })
})

describe('validarTextoCorrecao', () => {
  it('deve aceitar texto com 15 caracteres', () => {
    expect(() => validarTextoCorrecao('a'.repeat(15))).not.toThrow()
  })

  it('deve aceitar texto com 1000 caracteres', () => {
    expect(() => validarTextoCorrecao('a'.repeat(1000))).not.toThrow()
  })

  it('deve rejeitar texto com menos de 15 caracteres', () => {
    expect(() => validarTextoCorrecao('curto')).toThrow(ErroFiscal)
  })

  it('deve rejeitar texto com mais de 1000 caracteres', () => {
    expect(() => validarTextoCorrecao('a'.repeat(1001))).toThrow(ErroFiscal)
  })
})

describe('dentroDoLimiteCancelamento', () => {
  it('deve retornar true se está dentro de 24h', () => {
    const dataAutorizacao = new Date('2024-01-15T10:00:00Z')
    const agora = new Date('2024-01-15T20:00:00Z') // 10h depois
    expect(dentroDoLimiteCancelamento(dataAutorizacao, agora)).toBe(true)
  })

  it('deve retornar false se já passaram 24h', () => {
    const dataAutorizacao = new Date('2024-01-15T10:00:00Z')
    const agora = new Date('2024-01-16T10:00:01Z') // 24h + 1s depois
    expect(dentroDoLimiteCancelamento(dataAutorizacao, agora)).toBe(false)
  })

  it('deve retornar true se está exatamente antes de 24h', () => {
    const dataAutorizacao = new Date('2024-01-15T10:00:00Z')
    const agora = new Date('2024-01-16T09:59:59Z') // 23h59m59s depois
    expect(dentroDoLimiteCancelamento(dataAutorizacao, agora)).toBe(true)
  })

  it('deve retornar false se está exatamente em 24h', () => {
    const dataAutorizacao = new Date('2024-01-15T10:00:00Z')
    const agora = new Date('2024-01-16T10:00:00Z') // exatamente 24h
    expect(dentroDoLimiteCancelamento(dataAutorizacao, agora)).toBe(false)
  })
})

describe('validarFaixaInutilizacao', () => {
  it('deve aceitar faixa de 1 número', () => {
    expect(() => validarFaixaInutilizacao(100, 100)).not.toThrow()
  })

  it('deve aceitar faixa de 1000 números', () => {
    expect(() => validarFaixaInutilizacao(1, 1000)).not.toThrow()
  })

  it('deve rejeitar faixa superior a 1000 números', () => {
    expect(() => validarFaixaInutilizacao(1, 1001)).toThrow(ErroFiscal)
    try {
      validarFaixaInutilizacao(1, 1001)
    } catch (err) {
      expect((err as ErroFiscal).codigo).toBe(CodigoErroFiscal.FAIXA_INUTILIZACAO_EXCEDIDA)
    }
  })

  it('deve rejeitar número inicial menor que 1', () => {
    expect(() => validarFaixaInutilizacao(0, 10)).toThrow(ErroFiscal)
  })

  it('deve rejeitar número final menor que número inicial', () => {
    expect(() => validarFaixaInutilizacao(100, 50)).toThrow(ErroFiscal)
  })
})

describe('validarLimiteCCe', () => {
  it('deve aceitar sequência 1', () => {
    expect(() => validarLimiteCCe(1)).not.toThrow()
  })

  it('deve aceitar sequência 20 (último permitido)', () => {
    expect(() => validarLimiteCCe(20)).not.toThrow()
  })

  it('deve rejeitar sequência 21', () => {
    expect(() => validarLimiteCCe(21)).toThrow(ErroFiscal)
    try {
      validarLimiteCCe(21)
    } catch (err) {
      expect((err as ErroFiscal).codigo).toBe(CodigoErroFiscal.LIMITE_CCE_EXCEDIDO)
    }
  })
})

// === Testes de geração de XML ===

describe('gerarXmlCancelamento', () => {
  it('deve gerar XML com tpEvento 110111', () => {
    const xml = gerarXmlCancelamento({
      chaveAcesso: '35240112345678000199550010000001001000000001',
      cnpjEmitente: '12345678000199',
      ambiente: 2,
      sequencia: 1,
      justificativa: 'Cancelamento por erro no preenchimento da NF-e',
      protocolo: '135210000000001',
    })

    expect(xml).toContain('<tpEvento>110111</tpEvento>')
    expect(xml).toContain('<descEvento>Cancelamento</descEvento>')
    expect(xml).toContain('<nProt>135210000000001</nProt>')
    expect(xml).toContain('<xJust>Cancelamento por erro no preenchimento da NF-e</xJust>')
    expect(xml).toContain('<tpAmb>2</tpAmb>')
    expect(xml).toContain('Id="ID110111')
  })
})

describe('gerarXmlCartaCorrecao', () => {
  it('deve gerar XML com tpEvento 110110 e texto de condição de uso', () => {
    const xml = gerarXmlCartaCorrecao({
      chaveAcesso: '35240112345678000199550010000001001000000001',
      cnpjEmitente: '12345678000199',
      ambiente: 2,
      sequencia: 1,
      textoCorrecao: 'Correcao do endereco do destinatario',
    })

    expect(xml).toContain('<tpEvento>110110</tpEvento>')
    expect(xml).toContain('<descEvento>Carta de Correcao</descEvento>')
    expect(xml).toContain('<xCorrecao>Correcao do endereco do destinatario</xCorrecao>')
    expect(xml).toContain('<xCondUso>')
    expect(xml).toContain('Id="ID110110')
  })
})

describe('gerarXmlInutilizacao', () => {
  it('deve gerar XML de inutilização com faixa de números', () => {
    const xml = gerarXmlInutilizacao({
      cnpjEmitente: '12345678000199',
      ambiente: 2,
      uf: 'SP',
      modelo: 55,
      serie: 1,
      numeroInicial: 100,
      numeroFinal: 110,
      justificativa: 'Numeracao inutilizada por falha no sistema',
      ano: 24,
    })

    expect(xml).toContain('<xServ>INUTILIZAR</xServ>')
    expect(xml).toContain('<cUF>35</cUF>')
    expect(xml).toContain('<CNPJ>12345678000199</CNPJ>')
    expect(xml).toContain('<nNFIni>100</nNFIni>')
    expect(xml).toContain('<nNFFin>110</nNFFin>')
    expect(xml).toContain('<mod>55</mod>')
    expect(xml).toContain('versao="4.00"')
  })
})

// === Testes de integração (com mock SEFAZ) ===

describe('cancelar', () => {
  it('deve bloquear cancelamento após 24 horas', async () => {
    const sefazClient = criarSefazClientMock()
    const certificado = criarCertificadoMock()

    const documento = {
      id: 'doc-001',
      chaveAcesso: '35240112345678000199550010000001001000000001',
      cnpjEmitente: '12345678000199',
      ambiente: 2,
      dataAutorizacao: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25h atrás
      proximoSeqEvento: 1,
      protocolo: '135210000000001',
    }

    await expect(
      cancelar(
        { documentoId: 'doc-001', justificativa: 'Cancelamento por erro' },
        documento,
        { sefazClient, certificado }
      )
    ).rejects.toThrow(ErroFiscal)

    try {
      await cancelar(
        { documentoId: 'doc-001', justificativa: 'Cancelamento por erro' },
        documento,
        { sefazClient, certificado }
      )
    } catch (err) {
      expect((err as ErroFiscal).codigo).toBe(CodigoErroFiscal.PRAZO_CANCELAMENTO_EXCEDIDO)
    }

    // Não deve ter chamado a SEFAZ
    expect(sefazClient.transmitir).not.toHaveBeenCalled()
  })

  it('deve rejeitar justificativa muito curta', async () => {
    const sefazClient = criarSefazClientMock()
    const certificado = criarCertificadoMock()

    const documento = {
      id: 'doc-001',
      chaveAcesso: '35240112345678000199550010000001001000000001',
      cnpjEmitente: '12345678000199',
      ambiente: 2,
      dataAutorizacao: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1h atrás
      proximoSeqEvento: 1,
      protocolo: '135210000000001',
    }

    await expect(
      cancelar(
        { documentoId: 'doc-001', justificativa: 'curto' },
        documento,
        { sefazClient, certificado }
      )
    ).rejects.toThrow(ErroFiscal)
  })
})

describe('cartaCorrecao', () => {
  it('deve rejeitar quando limite de 20 CC-e for atingido', async () => {
    const sefazClient = criarSefazClientMock()
    const certificado = criarCertificadoMock()

    const documento = {
      id: 'doc-001',
      chaveAcesso: '35240112345678000199550010000001001000000001',
      cnpjEmitente: '12345678000199',
      ambiente: 2,
      dataAutorizacao: new Date(),
      proximoSeqEvento: 21, // já tem 20 CC-e
    }

    await expect(
      cartaCorrecao(
        { documentoId: 'doc-001', textoCorrecao: 'Correcao do endereco completo do destinatario' },
        documento,
        { sefazClient, certificado }
      )
    ).rejects.toThrow(ErroFiscal)

    try {
      await cartaCorrecao(
        { documentoId: 'doc-001', textoCorrecao: 'Correcao do endereco completo do destinatario' },
        documento,
        { sefazClient, certificado }
      )
    } catch (err) {
      expect((err as ErroFiscal).codigo).toBe(CodigoErroFiscal.LIMITE_CCE_EXCEDIDO)
    }
  })

  it('deve rejeitar texto de correção muito curto', async () => {
    const sefazClient = criarSefazClientMock()
    const certificado = criarCertificadoMock()

    const documento = {
      id: 'doc-001',
      chaveAcesso: '35240112345678000199550010000001001000000001',
      cnpjEmitente: '12345678000199',
      ambiente: 2,
      dataAutorizacao: new Date(),
      proximoSeqEvento: 1,
    }

    await expect(
      cartaCorrecao(
        { documentoId: 'doc-001', textoCorrecao: 'curto' },
        documento,
        { sefazClient, certificado }
      )
    ).rejects.toThrow(ErroFiscal)
  })
})

describe('inutilizar', () => {
  it('deve rejeitar faixa maior que 1000 números', async () => {
    const sefazClient = criarSefazClientMock()
    const certificado = criarCertificadoMock()

    const documento = {
      cnpjEmitente: '12345678000199',
      ambiente: 2,
      uf: 'SP',
    }

    await expect(
      inutilizar(
        {
          serie: 1,
          numeroInicial: 1,
          numeroFinal: 1001,
          justificativa: 'Numeracao inutilizada por falha no sistema',
          modelo: 55,
        },
        documento,
        { sefazClient, certificado }
      )
    ).rejects.toThrow(ErroFiscal)

    try {
      await inutilizar(
        {
          serie: 1,
          numeroInicial: 1,
          numeroFinal: 1001,
          justificativa: 'Numeracao inutilizada por falha no sistema',
          modelo: 55,
        },
        documento,
        { sefazClient, certificado }
      )
    } catch (err) {
      expect((err as ErroFiscal).codigo).toBe(CodigoErroFiscal.FAIXA_INUTILIZACAO_EXCEDIDA)
    }
  })

  it('deve rejeitar justificativa muito curta', async () => {
    const sefazClient = criarSefazClientMock()
    const certificado = criarCertificadoMock()

    const documento = {
      cnpjEmitente: '12345678000199',
      ambiente: 2,
      uf: 'SP',
    }

    await expect(
      inutilizar(
        {
          serie: 1,
          numeroInicial: 1,
          numeroFinal: 10,
          justificativa: 'curto',
          modelo: 55,
        },
        documento,
        { sefazClient, certificado }
      )
    ).rejects.toThrow(ErroFiscal)
  })
})
