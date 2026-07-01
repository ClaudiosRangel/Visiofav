import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import forge from 'node-forge'

/**
 * Unit tests for CertificadoService.
 * Tests validation logic using a self-signed test certificate generated with node-forge.
 */

// Mock prisma before importing the service
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    certificadoDigital: {
      count: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

vi.mock('./certificado-crypto', () => ({
  encryptPfx: vi.fn((buf: Buffer) => buf.toString('base64')),
  decryptPfx: vi.fn((str: string) => Buffer.from(str, 'base64')),
  encryptSenha: vi.fn((s: string) => Buffer.from(s).toString('base64')),
  decryptSenha: vi.fn((s: string) => Buffer.from(s, 'base64').toString('utf-8')),
}))

import { CertificadoService } from './certificado.service'
import { prisma } from '../../../lib/prisma'
import { CodigoErroFiscal, ErroFiscal } from '../erros'

// === Helpers para gerar certificados de teste ===

function gerarCertificadoTeste(options: {
  cnpj?: string
  validoDe?: Date
  validoAte?: Date
  incluirICPBrasil?: boolean
  senha?: string
}): { pfxBuffer: Buffer; senha: string } {
  const {
    cnpj = '12345678000195',
    validoDe = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    validoAte = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    incluirICPBrasil = true,
    senha = 'teste123',
  } = options

  // Gerar par de chaves
  const keys = forge.pki.rsa.generateKeyPair(2048)

  // Criar certificado
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = validoDe
  cert.validity.notAfter = validoAte

  const attrs = [
    { shortName: 'CN', value: `EMPRESA TESTE:${cnpj}` },
    { shortName: 'O', value: 'Empresa Teste LTDA' },
    { shortName: 'OU', value: `CNPJ:${cnpj}` },
    { shortName: 'C', value: 'BR' },
  ]
  cert.setSubject(attrs)

  // Definir issuer com referência ICP-Brasil
  if (incluirICPBrasil) {
    cert.setIssuer([
      { shortName: 'CN', value: 'AC Certificadora ICP-Brasil' },
      { shortName: 'O', value: 'ICP-Brasil' },
      { shortName: 'C', value: 'BR' },
    ])
  } else {
    cert.setIssuer([
      { shortName: 'CN', value: 'Unknown CA' },
      { shortName: 'O', value: 'Foreign Corp' },
      { shortName: 'C', value: 'US' },
    ])
  }

  // Auto-assinar
  cert.sign(keys.privateKey, forge.md.sha256.create())

  // Converter para PFX
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], senha)
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes()
  const pfxBuffer = Buffer.from(p12Der, 'binary')

  return { pfxBuffer, senha }
}

describe('CertificadoService', () => {
  let service: CertificadoService
  const empresaId = 'empresa-test-id'
  const cnpjEmpresa = '12345678000195'

  beforeEach(() => {
    service = new CertificadoService()
    vi.clearAllMocks()
    ;(prisma.certificadoDigital.count as any).mockResolvedValue(0)
    ;(prisma.certificadoDigital.create as any).mockImplementation(async (args: any) => ({
      id: 'cert-id-1',
      ...args.data,
      criadoEm: new Date(),
      atualizadoEm: new Date(),
    }))
  })

  describe('upload', () => {
    it('aceita certificado válido com cadeia ICP-Brasil e CNPJ correto', async () => {
      const { pfxBuffer, senha } = gerarCertificadoTeste({
        cnpj: cnpjEmpresa,
        incluirICPBrasil: true,
      })

      const resultado = await service.upload(pfxBuffer, senha, empresaId, cnpjEmpresa)

      expect(resultado.cnpj).toBe(cnpjEmpresa)
      expect(resultado.tipo).toBe('A1')
      expect(resultado.ativo).toBe(true)
      expect(prisma.certificadoDigital.create).toHaveBeenCalledOnce()
    })

    it('rejeita certificado com cadeia não ICP-Brasil', async () => {
      const { pfxBuffer, senha } = gerarCertificadoTeste({
        cnpj: cnpjEmpresa,
        incluirICPBrasil: false,
      })

      await expect(
        service.upload(pfxBuffer, senha, empresaId, cnpjEmpresa)
      ).rejects.toThrow(ErroFiscal)

      try {
        await service.upload(pfxBuffer, senha, empresaId, cnpjEmpresa)
      } catch (err: any) {
        expect(err.codigo).toBe(CodigoErroFiscal.CERTIFICADO_CADEIA_INVALIDA)
      }
    })

    it('rejeita certificado com CNPJ divergente', async () => {
      const { pfxBuffer, senha } = gerarCertificadoTeste({
        cnpj: '99999999000199', // CNPJ diferente do esperado
        incluirICPBrasil: true,
      })

      await expect(
        service.upload(pfxBuffer, senha, empresaId, cnpjEmpresa)
      ).rejects.toThrow(ErroFiscal)

      try {
        await service.upload(pfxBuffer, senha, empresaId, cnpjEmpresa)
      } catch (err: any) {
        expect(err.codigo).toBe(CodigoErroFiscal.CERTIFICADO_CNPJ_DIVERGENTE)
      }
    })

    it('rejeita certificado expirado', async () => {
      const { pfxBuffer, senha } = gerarCertificadoTeste({
        cnpj: cnpjEmpresa,
        validoDe: new Date(2020, 0, 1),
        validoAte: new Date(2023, 0, 1), // Expirado
        incluirICPBrasil: true,
      })

      await expect(
        service.upload(pfxBuffer, senha, empresaId, cnpjEmpresa)
      ).rejects.toThrow(ErroFiscal)

      try {
        await service.upload(pfxBuffer, senha, empresaId, cnpjEmpresa)
      } catch (err: any) {
        expect(err.codigo).toBe(CodigoErroFiscal.CERTIFICADO_EXPIRADO)
      }
    })

    it('rejeita upload quando limite de 100 certificados ativos atingido', async () => {
      ;(prisma.certificadoDigital.count as any).mockResolvedValue(100)

      const { pfxBuffer, senha } = gerarCertificadoTeste({
        cnpj: cnpjEmpresa,
        incluirICPBrasil: true,
      })

      await expect(
        service.upload(pfxBuffer, senha, empresaId, cnpjEmpresa)
      ).rejects.toThrow(ErroFiscal)

      try {
        await service.upload(pfxBuffer, senha, empresaId, cnpjEmpresa)
      } catch (err: any) {
        expect(err.codigo).toBe(CodigoErroFiscal.CERTIFICADO_LIMITE_ATINGIDO)
      }
    })

    it('rejeita PFX com senha incorreta', async () => {
      const { pfxBuffer } = gerarCertificadoTeste({
        cnpj: cnpjEmpresa,
        incluirICPBrasil: true,
        senha: 'senha-correta',
      })

      await expect(
        service.upload(pfxBuffer, 'senha-errada', empresaId, cnpjEmpresa)
      ).rejects.toThrow(ErroFiscal)

      try {
        await service.upload(pfxBuffer, 'senha-errada', empresaId, cnpjEmpresa)
      } catch (err: any) {
        expect(err.codigo).toBe(CodigoErroFiscal.CERTIFICADO_SENHA_INCORRETA)
      }
    })
  })

  describe('obterParaAssinatura', () => {
    it('retorna certificado válido e ativo para o CNPJ', async () => {
      const pfxBase64 = Buffer.from('fake-pfx').toString('base64')
      const senhaBase64 = Buffer.from('senha123').toString('base64')

      ;(prisma.certificadoDigital.findFirst as any).mockResolvedValue({
        id: 'cert-1',
        cnpj: cnpjEmpresa,
        pfxEncrypted: pfxBase64,
        senhaEncrypted: senhaBase64,
        validoAte: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        ativo: true,
      })

      const resultado = await service.obterParaAssinatura(cnpjEmpresa, empresaId)

      expect(resultado.cnpj).toBe(cnpjEmpresa)
      expect(resultado.pfxBuffer).toBeInstanceOf(Buffer)
      expect(typeof resultado.senha).toBe('string')
    })

    it('lança erro quando nenhum certificado encontrado', async () => {
      ;(prisma.certificadoDigital.findFirst as any).mockResolvedValue(null)

      await expect(
        service.obterParaAssinatura(cnpjEmpresa, empresaId)
      ).rejects.toThrow(ErroFiscal)

      try {
        await service.obterParaAssinatura(cnpjEmpresa, empresaId)
      } catch (err: any) {
        expect(err.codigo).toBe(CodigoErroFiscal.CERTIFICADO_NAO_ENCONTRADO)
      }
    })

    it('lança erro quando certificado existe mas está expirado', async () => {
      // First call (busca ativo e não expirado) retorna null
      ;(prisma.certificadoDigital.findFirst as any)
        .mockResolvedValueOnce(null) // busca não expirado
        .mockResolvedValueOnce({ // busca expirado
          id: 'cert-expirado',
          cnpj: cnpjEmpresa,
          validoAte: new Date(2023, 0, 1),
          ativo: true,
        })

      await expect(
        service.obterParaAssinatura(cnpjEmpresa, empresaId)
      ).rejects.toThrow(ErroFiscal)

      try {
        ;(prisma.certificadoDigital.findFirst as any)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'cert-expirado',
            cnpj: cnpjEmpresa,
            validoAte: new Date(2023, 0, 1),
            ativo: true,
          })
        await service.obterParaAssinatura(cnpjEmpresa, empresaId)
      } catch (err: any) {
        expect(err.codigo).toBe(CodigoErroFiscal.CERTIFICADO_EXPIRADO)
      }
    })
  })

  describe('verificarVencimentos', () => {
    it('retorna certificados próximos do vencimento com dias restantes', async () => {
      const validoAte = new Date()
      validoAte.setDate(validoAte.getDate() + 15)

      ;(prisma.certificadoDigital.findMany as any).mockResolvedValue([
        {
          id: 'cert-1',
          cnpj: cnpjEmpresa,
          titular: 'Empresa Teste',
          validoAte,
        },
      ])

      const resultado = await service.verificarVencimentos(empresaId, 30)

      expect(resultado).toHaveLength(1)
      expect(resultado[0].cnpj).toBe(cnpjEmpresa)
      expect(resultado[0].diasRestantes).toBeGreaterThanOrEqual(14)
      expect(resultado[0].diasRestantes).toBeLessThanOrEqual(16)
    })

    it('retorna array vazio quando nenhum certificado próximo de vencer', async () => {
      ;(prisma.certificadoDigital.findMany as any).mockResolvedValue([])

      const resultado = await service.verificarVencimentos(empresaId, 30)

      expect(resultado).toEqual([])
    })

    it('usa padrão de 30 dias quando diasAntecedencia não informado', async () => {
      ;(prisma.certificadoDigital.findMany as any).mockResolvedValue([])

      await service.verificarVencimentos(empresaId)

      expect(prisma.certificadoDigital.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            empresaId,
            ativo: true,
          }),
        })
      )
    })
  })
})
