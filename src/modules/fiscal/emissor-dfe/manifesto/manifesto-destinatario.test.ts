/**
 * Testes unitários para manifesto-destinatario.ts
 * Manifesto do Destinatário Eletrônico (MDe)
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock xml-signer
vi.mock('../xml/xml-signer', () => ({
  assinarXML: vi.fn(() => ({
    xmlAssinado: '<xml-assinado/>',
    certificadoX509: 'cert-base64',
  })),
}))

// Mock prisma
vi.mock('../../../../lib/prisma', () => ({
  prisma: {
    eventoDocumentoFiscal: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    documentoFiscal: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'doc-001',
        chaveAcesso: '35240112345678000199550010000001001000000001',
        empresaId: 'empresa-001',
      }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}))

import {
  gerarXmlManifestacao,
  registrarCiencia,
  confirmarOperacao,
  registrarDesconhecimento,
  registrarOperacaoNaoRealizada,
  listarPendentes,
  validarChaveAcesso,
  validarJustificativaNaoRealizada,
  TP_EVENTO_CIENCIA,
  TP_EVENTO_CONFIRMACAO,
  TP_EVENTO_DESCONHECIMENTO,
  TP_EVENTO_NAO_REALIZADA,
  PRAZO_MANIFESTACAO_DIAS,
  MIN_JUSTIFICATIVA_NAO_REALIZADA,
  MAX_JUSTIFICATIVA_NAO_REALIZADA,
  DESCRICAO_EVENTO,
} from './manifesto-destinatario'
import { CodigoErroFiscal, ErroFiscal } from '../../erros'
import type { SefazClient, RespostaSefaz } from '../sefaz/tipos'
import { ServicoSefaz } from '../sefaz/tipos'
import { prisma } from '../../../../lib/prisma'

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

const CHAVE_VALIDA = '35240112345678000199550010000001001000000001'

// === Testes de Constantes ===

describe('Constantes de evento MDe', () => {
  it('deve ter código correto para Ciência da Operação', () => {
    expect(TP_EVENTO_CIENCIA).toBe('210210')
  })

  it('deve ter código correto para Confirmação da Operação', () => {
    expect(TP_EVENTO_CONFIRMACAO).toBe('210200')
  })

  it('deve ter código correto para Desconhecimento da Operação', () => {
    expect(TP_EVENTO_DESCONHECIMENTO).toBe('210220')
  })

  it('deve ter código correto para Operação Não Realizada', () => {
    expect(TP_EVENTO_NAO_REALIZADA).toBe('210240')
  })

  it('deve ter prazo de manifestação de 180 dias', () => {
    expect(PRAZO_MANIFESTACAO_DIAS).toBe(180)
  })

  it('deve ter descrições para todos os tipos de evento', () => {
    expect(DESCRICAO_EVENTO[TP_EVENTO_CIENCIA]).toBe('Ciencia da Operacao')
    expect(DESCRICAO_EVENTO[TP_EVENTO_CONFIRMACAO]).toBe('Confirmacao da Operacao')
    expect(DESCRICAO_EVENTO[TP_EVENTO_DESCONHECIMENTO]).toBe('Desconhecimento da Operacao')
    expect(DESCRICAO_EVENTO[TP_EVENTO_NAO_REALIZADA]).toBe('Operacao nao Realizada')
  })
})

// === Testes de Validação ===

describe('validarChaveAcesso', () => {
  it('deve aceitar chave de acesso com 44 dígitos numéricos', () => {
    expect(() => validarChaveAcesso(CHAVE_VALIDA)).not.toThrow()
  })

  it('deve rejeitar chave vazia', () => {
    expect(() => validarChaveAcesso('')).toThrow(ErroFiscal)
    try {
      validarChaveAcesso('')
    } catch (err) {
      expect((err as ErroFiscal).codigo).toBe(CodigoErroFiscal.CHAVE_ACESSO_INVALIDA)
    }
  })

  it('deve rejeitar chave com menos de 44 dígitos', () => {
    expect(() => validarChaveAcesso('123456789012345678901234567890123456789012')).toThrow(ErroFiscal)
  })

  it('deve rejeitar chave com mais de 44 dígitos', () => {
    expect(() => validarChaveAcesso('1234567890123456789012345678901234567890123456')).toThrow(ErroFiscal)
  })

  it('deve rejeitar chave com caracteres não numéricos', () => {
    expect(() => validarChaveAcesso('3524011234567800019955001000000100100000000A')).toThrow(ErroFiscal)
  })
})

describe('validarJustificativaNaoRealizada', () => {
  it('deve aceitar justificativa com 15 caracteres', () => {
    expect(() => validarJustificativaNaoRealizada('a'.repeat(15))).not.toThrow()
  })

  it('deve aceitar justificativa com 255 caracteres', () => {
    expect(() => validarJustificativaNaoRealizada('a'.repeat(255))).not.toThrow()
  })

  it('deve rejeitar justificativa com menos de 15 caracteres', () => {
    expect(() => validarJustificativaNaoRealizada('curto')).toThrow(ErroFiscal)
    try {
      validarJustificativaNaoRealizada('curto')
    } catch (err) {
      expect((err as ErroFiscal).codigo).toBe(CodigoErroFiscal.JUSTIFICATIVA_INVALIDA)
    }
  })

  it('deve rejeitar justificativa com mais de 255 caracteres', () => {
    expect(() => validarJustificativaNaoRealizada('a'.repeat(256))).toThrow(ErroFiscal)
  })

  it('deve considerar trim no comprimento', () => {
    expect(() => validarJustificativaNaoRealizada('   curto   ')).toThrow(ErroFiscal)
  })
})

// === Testes de Geração de XML ===

describe('gerarXmlManifestacao', () => {
  it('deve gerar XML de Ciência da Operação com cOrgao=91 (AN)', () => {
    const xml = gerarXmlManifestacao({
      chaveAcesso: CHAVE_VALIDA,
      cnpjDestinatario: '98765432000188',
      ambiente: 2,
      tpEvento: TP_EVENTO_CIENCIA,
      sequencia: 1,
    })

    expect(xml).toContain('<cOrgao>91</cOrgao>')
    expect(xml).toContain('<tpEvento>210210</tpEvento>')
    expect(xml).toContain('<descEvento>Ciencia da Operacao</descEvento>')
    expect(xml).toContain(`<chNFe>${CHAVE_VALIDA}</chNFe>`)
    expect(xml).toContain('<CNPJ>98765432000188</CNPJ>')
    expect(xml).toContain('<tpAmb>2</tpAmb>')
    expect(xml).toContain(`Id="ID210210${CHAVE_VALIDA}01"`)
    expect(xml).not.toContain('<xJust>')
  })

  it('deve gerar XML de Confirmação da Operação', () => {
    const xml = gerarXmlManifestacao({
      chaveAcesso: CHAVE_VALIDA,
      cnpjDestinatario: '98765432000188',
      ambiente: 1,
      tpEvento: TP_EVENTO_CONFIRMACAO,
      sequencia: 1,
    })

    expect(xml).toContain('<tpEvento>210200</tpEvento>')
    expect(xml).toContain('<descEvento>Confirmacao da Operacao</descEvento>')
    expect(xml).toContain('<tpAmb>1</tpAmb>')
  })

  it('deve gerar XML de Desconhecimento da Operação', () => {
    const xml = gerarXmlManifestacao({
      chaveAcesso: CHAVE_VALIDA,
      cnpjDestinatario: '98765432000188',
      ambiente: 2,
      tpEvento: TP_EVENTO_DESCONHECIMENTO,
      sequencia: 1,
    })

    expect(xml).toContain('<tpEvento>210220</tpEvento>')
    expect(xml).toContain('<descEvento>Desconhecimento da Operacao</descEvento>')
  })

  it('deve gerar XML de Operação Não Realizada com justificativa', () => {
    const justificativa = 'Mercadoria devolvida ao remetente por avaria'
    const xml = gerarXmlManifestacao({
      chaveAcesso: CHAVE_VALIDA,
      cnpjDestinatario: '98765432000188',
      ambiente: 2,
      tpEvento: TP_EVENTO_NAO_REALIZADA,
      sequencia: 1,
      justificativa,
    })

    expect(xml).toContain('<tpEvento>210240</tpEvento>')
    expect(xml).toContain('<descEvento>Operacao nao Realizada</descEvento>')
    expect(xml).toContain(`<xJust>${justificativa}</xJust>`)
  })

  it('não deve incluir justificativa para eventos que não a exigem', () => {
    const xml = gerarXmlManifestacao({
      chaveAcesso: CHAVE_VALIDA,
      cnpjDestinatario: '98765432000188',
      ambiente: 2,
      tpEvento: TP_EVENTO_CIENCIA,
      sequencia: 1,
      justificativa: 'texto ignorado',
    })

    expect(xml).not.toContain('<xJust>')
  })

  it('deve formatar sequência com 2 dígitos no ID', () => {
    const xml = gerarXmlManifestacao({
      chaveAcesso: CHAVE_VALIDA,
      cnpjDestinatario: '98765432000188',
      ambiente: 2,
      tpEvento: TP_EVENTO_CIENCIA,
      sequencia: 3,
    })

    expect(xml).toContain(`Id="ID210210${CHAVE_VALIDA}03"`)
  })
})

// === Testes de Integração (com mock SEFAZ) ===

describe('registrarCiencia', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deve transmitir evento de ciência à SEFAZ e retornar sucesso', async () => {
    const sefazClient = criarSefazClientMock()
    const certificado = criarCertificadoMock()

    const resultado = await registrarCiencia(
      {
        chaveAcesso: CHAVE_VALIDA,
        empresaId: 'empresa-001',
        cnpjDestinatario: '98765432000188',
        ambiente: 2,
      },
      { sefazClient, certificado }
    )

    expect(resultado.sucesso).toBe(true)
    expect(resultado.protocolo).toBe('135210000000001')
    expect(sefazClient.transmitir).toHaveBeenCalledWith(
      '<xml-assinado/>',
      ServicoSefaz.RECEPCAO_EVENTO
    )
  })

  it('deve rejeitar chave de acesso inválida', async () => {
    const sefazClient = criarSefazClientMock()
    const certificado = criarCertificadoMock()

    await expect(
      registrarCiencia(
        {
          chaveAcesso: 'invalida',
          empresaId: 'empresa-001',
          cnpjDestinatario: '98765432000188',
          ambiente: 2,
        },
        { sefazClient, certificado }
      )
    ).rejects.toThrow(ErroFiscal)

    expect(sefazClient.transmitir).not.toHaveBeenCalled()
  })
})

describe('confirmarOperacao', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deve transmitir evento de confirmação à SEFAZ e retornar sucesso', async () => {
    const sefazClient = criarSefazClientMock()
    const certificado = criarCertificadoMock()

    const resultado = await confirmarOperacao(
      {
        chaveAcesso: CHAVE_VALIDA,
        empresaId: 'empresa-001',
        cnpjDestinatario: '98765432000188',
        ambiente: 2,
      },
      { sefazClient, certificado }
    )

    expect(resultado.sucesso).toBe(true)
    expect(resultado.protocolo).toBe('135210000000001')
    expect(sefazClient.transmitir).toHaveBeenCalledWith(
      '<xml-assinado/>',
      ServicoSefaz.RECEPCAO_EVENTO
    )
  })
})

describe('registrarDesconhecimento', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deve transmitir evento de desconhecimento à SEFAZ e retornar sucesso', async () => {
    const sefazClient = criarSefazClientMock()
    const certificado = criarCertificadoMock()

    const resultado = await registrarDesconhecimento(
      {
        chaveAcesso: CHAVE_VALIDA,
        empresaId: 'empresa-001',
        cnpjDestinatario: '98765432000188',
        ambiente: 2,
      },
      { sefazClient, certificado }
    )

    expect(resultado.sucesso).toBe(true)
    expect(resultado.protocolo).toBe('135210000000001')
    expect(sefazClient.transmitir).toHaveBeenCalledWith(
      '<xml-assinado/>',
      ServicoSefaz.RECEPCAO_EVENTO
    )
  })
})

describe('registrarOperacaoNaoRealizada', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deve transmitir evento com justificativa à SEFAZ e retornar sucesso', async () => {
    const sefazClient = criarSefazClientMock()
    const certificado = criarCertificadoMock()

    const resultado = await registrarOperacaoNaoRealizada(
      {
        chaveAcesso: CHAVE_VALIDA,
        empresaId: 'empresa-001',
        cnpjDestinatario: '98765432000188',
        ambiente: 2,
        justificativa: 'Mercadoria devolvida ao remetente por avaria na entrega',
      },
      { sefazClient, certificado }
    )

    expect(resultado.sucesso).toBe(true)
    expect(resultado.protocolo).toBe('135210000000001')
  })

  it('deve rejeitar justificativa muito curta', async () => {
    const sefazClient = criarSefazClientMock()
    const certificado = criarCertificadoMock()

    await expect(
      registrarOperacaoNaoRealizada(
        {
          chaveAcesso: CHAVE_VALIDA,
          empresaId: 'empresa-001',
          cnpjDestinatario: '98765432000188',
          ambiente: 2,
          justificativa: 'curto',
        },
        { sefazClient, certificado }
      )
    ).rejects.toThrow(ErroFiscal)

    expect(sefazClient.transmitir).not.toHaveBeenCalled()
  })

  it('deve rejeitar justificativa muito longa', async () => {
    const sefazClient = criarSefazClientMock()
    const certificado = criarCertificadoMock()

    await expect(
      registrarOperacaoNaoRealizada(
        {
          chaveAcesso: CHAVE_VALIDA,
          empresaId: 'empresa-001',
          cnpjDestinatario: '98765432000188',
          ambiente: 2,
          justificativa: 'a'.repeat(256),
        },
        { sefazClient, certificado }
      )
    ).rejects.toThrow(ErroFiscal)

    expect(sefazClient.transmitir).not.toHaveBeenCalled()
  })
})

describe('listarPendentes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deve retornar lista vazia quando não há NF-e pendentes', async () => {
    vi.mocked(prisma.documentoFiscal.findMany).mockResolvedValue([])

    const resultado = await listarPendentes('empresa-001')

    expect(resultado).toEqual([])
  })

  it('deve calcular dias restantes corretamente', async () => {
    const dataEmissao = new Date()
    dataEmissao.setDate(dataEmissao.getDate() - 10) // 10 dias atrás

    vi.mocked(prisma.documentoFiscal.findMany).mockResolvedValue([
      {
        id: 'doc-001',
        chaveAcesso: CHAVE_VALIDA,
        emitenteCnpj: '12345678000199',
        emitenteRazao: 'Fornecedor ABC Ltda',
        valorTotal: { toNumber: () => 1500.0 } as any,
        dataEmissao,
        eventos: [],
      } as any,
    ])

    const resultado = await listarPendentes('empresa-001')

    expect(resultado).toHaveLength(1)
    expect(resultado[0].diasRestantes).toBe(170) // 180 - 10
    expect(resultado[0].chaveAcesso).toBe(CHAVE_VALIDA)
    expect(resultado[0].emitenteCnpj).toBe('12345678000199')
    expect(resultado[0].statusManifestacao).toBeNull()
  })

  it('deve retornar 0 dias restantes quando prazo já venceu', async () => {
    const dataEmissao = new Date()
    dataEmissao.setDate(dataEmissao.getDate() - 200) // 200 dias atrás (vencido)

    vi.mocked(prisma.documentoFiscal.findMany).mockResolvedValue([
      {
        id: 'doc-002',
        chaveAcesso: CHAVE_VALIDA,
        emitenteCnpj: '12345678000199',
        emitenteRazao: 'Fornecedor XYZ Ltda',
        valorTotal: { toNumber: () => 3200.0 } as any,
        dataEmissao,
        eventos: [],
      } as any,
    ])

    const resultado = await listarPendentes('empresa-001')

    expect(resultado).toHaveLength(1)
    expect(resultado[0].diasRestantes).toBe(0)
  })

  it('deve mostrar status de ciência quando já registrada', async () => {
    const dataEmissao = new Date()
    dataEmissao.setDate(dataEmissao.getDate() - 5)

    vi.mocked(prisma.documentoFiscal.findMany).mockResolvedValue([
      {
        id: 'doc-003',
        chaveAcesso: CHAVE_VALIDA,
        emitenteCnpj: '12345678000199',
        emitenteRazao: 'Fornecedor QWE Ltda',
        valorTotal: { toNumber: () => 800.0 } as any,
        dataEmissao,
        eventos: [
          { tipoEvento: TP_EVENTO_CIENCIA, dataEvento: new Date(), status: 'REGISTRADO' },
        ],
      } as any,
    ])

    const resultado = await listarPendentes('empresa-001')

    expect(resultado).toHaveLength(1)
    expect(resultado[0].statusManifestacao).toBe('Ciencia da Operacao')
  })
})

// === Testes de tratamento de resposta SEFAZ ===

describe('Tratamento de rejeição SEFAZ', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deve retornar falha quando SEFAZ rejeita o evento', async () => {
    const sefazClient = criarSefazClientMock({
      sucesso: false,
      protocolo: undefined,
      codigoStatus: 594,
      motivoStatus: 'Rejeicao: NF-e nao pertence ao CNPJ informado',
    })
    const certificado = criarCertificadoMock()

    const resultado = await registrarCiencia(
      {
        chaveAcesso: CHAVE_VALIDA,
        empresaId: 'empresa-001',
        cnpjDestinatario: '98765432000188',
        ambiente: 2,
      },
      { sefazClient, certificado }
    )

    expect(resultado.sucesso).toBe(false)
    expect(resultado.erros).toHaveLength(1)
    expect(resultado.erros![0].codigo).toBe(594)
    expect(resultado.erros![0].descricao).toContain('Rejeicao')
  })

  it('deve considerar cStat 573 (duplicidade) como sucesso', async () => {
    const sefazClient = criarSefazClientMock({
      sucesso: false,
      codigoStatus: 573,
      motivoStatus: 'Duplicidade de evento',
      protocolo: '135210000000002',
    })
    const certificado = criarCertificadoMock()

    const resultado = await confirmarOperacao(
      {
        chaveAcesso: CHAVE_VALIDA,
        empresaId: 'empresa-001',
        cnpjDestinatario: '98765432000188',
        ambiente: 2,
      },
      { sefazClient, certificado }
    )

    expect(resultado.sucesso).toBe(true)
  })
})
