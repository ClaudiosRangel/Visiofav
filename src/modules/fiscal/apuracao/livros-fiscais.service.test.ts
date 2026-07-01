import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock Prisma before importing the service
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    documentoFiscal: {
      findMany: vi.fn(),
    },
    apuracaoFiscal: {
      findUnique: vi.fn(),
    },
  },
}))

import { prisma } from '../../../lib/prisma'
import { LivrosFiscaisService } from './livros-fiscais.service'
import { CodigoErroFiscal } from '../erros'

describe('LivrosFiscaisService', () => {
  let service: LivrosFiscaisService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new LivrosFiscaisService()

    // Default mocks
    ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([])
    ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue(null)
  })

  describe('gerarLivroEntradas', () => {
    it('should return empty book when no entry documents exist', async () => {
      const result = await service.gerarLivroEntradas({
        empresaId: 'empresa-1',
        periodo: '2024-01',
      })

      expect(result.empresaId).toBe('empresa-1')
      expect(result.periodo).toBe('2024-01')
      expect(result.totalGeral).toBe(0)
      expect(result.totalIcms).toBe(0)
      expect(result.totalIpi).toBe(0)
      expect(result.gruposCfop).toHaveLength(0)
    })

    it('should classify entries by CFOP', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([
        {
          id: 'doc-1',
          dataEmissao: new Date('2024-01-10'),
          numero: 100,
          serie: 1,
          emitenteCnpj: '12345678000100',
          emitenteRazao: 'Fornecedor A',
          emitenteUf: 'SP',
          chaveAcesso: '35240112345678000100550010000001001000000001',
          itens: [
            {
              cfop: '1102',
              valorTotal: 1000,
              icmsValor: 180,
              ipiValor: 50,
              pisValor: 16.5,
              cofinsValor: 76,
              icmsBase: 1000,
              icmsAliquota: 18,
            },
            {
              cfop: '1403',
              valorTotal: 500,
              icmsValor: 90,
              ipiValor: 25,
              pisValor: 8.25,
              cofinsValor: 38,
              icmsBase: 500,
              icmsAliquota: 18,
            },
          ],
        },
        {
          id: 'doc-2',
          dataEmissao: new Date('2024-01-15'),
          numero: 200,
          serie: 1,
          emitenteCnpj: '98765432000100',
          emitenteRazao: 'Fornecedor B',
          emitenteUf: 'MG',
          chaveAcesso: '35240198765432000100550010000002001000000002',
          itens: [
            {
              cfop: '1102',
              valorTotal: 2000,
              icmsValor: 360,
              ipiValor: 100,
              pisValor: 33,
              cofinsValor: 152,
              icmsBase: 2000,
              icmsAliquota: 18,
            },
          ],
        },
      ])

      const result = await service.gerarLivroEntradas({
        empresaId: 'empresa-1',
        periodo: '2024-01',
      })

      expect(result.gruposCfop).toHaveLength(2)

      // CFOP 1102 — 2 itens
      const grupo1102 = result.gruposCfop.find((g) => g.cfop === '1102')
      expect(grupo1102).toBeDefined()
      expect(grupo1102!.itens).toHaveLength(2)
      expect(grupo1102!.totalValor).toBe(3000)
      expect(grupo1102!.totalIcms).toBe(540)

      // CFOP 1403 — 1 item
      const grupo1403 = result.gruposCfop.find((g) => g.cfop === '1403')
      expect(grupo1403).toBeDefined()
      expect(grupo1403!.itens).toHaveLength(1)
      expect(grupo1403!.totalValor).toBe(500)

      // Totais gerais
      expect(result.totalGeral).toBe(3500)
      expect(result.totalIcms).toBe(630)
      expect(result.totalIpi).toBe(175)
    })

    it('should sort groups by CFOP code', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([
        {
          id: 'doc-1',
          dataEmissao: new Date('2024-01-05'),
          numero: 50,
          serie: 1,
          emitenteCnpj: '11111111000100',
          emitenteRazao: 'F1',
          emitenteUf: 'RJ',
          chaveAcesso: null,
          itens: [
            { cfop: '2102', valorTotal: 100, icmsValor: 12, ipiValor: 0, pisValor: 0, cofinsValor: 0, icmsBase: 100, icmsAliquota: 12 },
            { cfop: '1102', valorTotal: 200, icmsValor: 36, ipiValor: 0, pisValor: 0, cofinsValor: 0, icmsBase: 200, icmsAliquota: 18 },
            { cfop: '1556', valorTotal: 300, icmsValor: 54, ipiValor: 0, pisValor: 0, cofinsValor: 0, icmsBase: 300, icmsAliquota: 18 },
          ],
        },
      ])

      const result = await service.gerarLivroEntradas({
        empresaId: 'empresa-1',
        periodo: '2024-01',
      })

      expect(result.gruposCfop[0].cfop).toBe('1102')
      expect(result.gruposCfop[1].cfop).toBe('1556')
      expect(result.gruposCfop[2].cfop).toBe('2102')
    })

    it('should query documents filtered by empresaId, period and type', async () => {
      await service.gerarLivroEntradas({ empresaId: 'empresa-1', periodo: '2024-03' })

      expect(prisma.documentoFiscal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            empresaId: 'empresa-1',
            tipoOperacao: 0,
            status: 'AUTORIZADO',
            dataEmissao: {
              gte: new Date(2024, 2, 1),
              lte: new Date(2024, 2, 31, 23, 59, 59, 999),
            },
          }),
        }),
      )
    })
  })

  describe('gerarLivroSaidas', () => {
    it('should return empty book when no exit documents exist', async () => {
      const result = await service.gerarLivroSaidas({
        empresaId: 'empresa-1',
        periodo: '2024-01',
      })

      expect(result.empresaId).toBe('empresa-1')
      expect(result.periodo).toBe('2024-01')
      expect(result.totalGeral).toBe(0)
      expect(result.gruposCfop).toHaveLength(0)
    })

    it('should classify exits by CFOP', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([
        {
          id: 'doc-1',
          dataEmissao: new Date('2024-01-20'),
          numero: 300,
          serie: 1,
          destCpfCnpj: '99999999000100',
          destRazao: 'Cliente X',
          destUf: 'RJ',
          chaveAcesso: '35240112345678000100550010000003001000000003',
          itens: [
            {
              cfop: '5102',
              valorTotal: 5000,
              icmsValor: 900,
              ipiValor: 250,
              pisValor: 82.5,
              cofinsValor: 380,
              icmsBase: 5000,
              icmsAliquota: 18,
            },
            {
              cfop: '6102',
              valorTotal: 3000,
              icmsValor: 360,
              ipiValor: 150,
              pisValor: 49.5,
              cofinsValor: 228,
              icmsBase: 3000,
              icmsAliquota: 12,
            },
          ],
        },
      ])

      const result = await service.gerarLivroSaidas({
        empresaId: 'empresa-1',
        periodo: '2024-01',
      })

      expect(result.gruposCfop).toHaveLength(2)

      const grupo5102 = result.gruposCfop.find((g) => g.cfop === '5102')
      expect(grupo5102).toBeDefined()
      expect(grupo5102!.totalValor).toBe(5000)
      expect(grupo5102!.totalIcms).toBe(900)

      const grupo6102 = result.gruposCfop.find((g) => g.cfop === '6102')
      expect(grupo6102).toBeDefined()
      expect(grupo6102!.totalValor).toBe(3000)

      expect(result.totalGeral).toBe(8000)
      expect(result.totalIcms).toBe(1260)
      expect(result.totalIpi).toBe(400)
    })

    it('should query documents with tipoOperacao=1 (saída)', async () => {
      await service.gerarLivroSaidas({ empresaId: 'empresa-1', periodo: '2024-06' })

      expect(prisma.documentoFiscal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tipoOperacao: 1,
            status: 'AUTORIZADO',
          }),
        }),
      )
    })
  })

  describe('gerarLivroApuracaoICMS', () => {
    it('should return apuração data from persisted record', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue({
        id: 'ap-icms-1',
        empresaId: 'empresa-1',
        tipo: 'ICMS',
        periodo: '2024-01',
        totalDebitos: 10000,
        totalCreditos: 6000,
        estornoDebitos: 200,
        estornoCreditos: 100,
        ajustes: 50,
        saldoAnterior: 500,
        saldoFinal: 3450,
        valorRecolher: 3450,
        fechado: true,
      })

      const result = await service.gerarLivroApuracaoICMS({
        empresaId: 'empresa-1',
        periodo: '2024-01',
      })

      expect(result.totalDebitos).toBe(10000)
      expect(result.totalCreditos).toBe(6000)
      expect(result.estornoDebitos).toBe(200)
      expect(result.estornoCreditos).toBe(100)
      expect(result.ajustes).toBe(50)
      expect(result.saldoAnterior).toBe(500)
      expect(result.saldoFinal).toBe(3450)
      expect(result.valorRecolher).toBe(3450)
    })

    it('should throw when no ICMS apuração exists for the period', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue(null)

      await expect(
        service.gerarLivroApuracaoICMS({ empresaId: 'empresa-1', periodo: '2024-01' }),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.APURACAO_SALDO_INCONSISTENTE,
      })
    })

    it('should query with tipo=ICMS', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue({
        totalDebitos: 0, totalCreditos: 0, estornoDebitos: 0,
        estornoCreditos: 0, ajustes: 0, saldoAnterior: 0,
        saldoFinal: 0, valorRecolher: 0,
      })

      await service.gerarLivroApuracaoICMS({ empresaId: 'empresa-1', periodo: '2024-02' })

      expect(prisma.apuracaoFiscal.findUnique).toHaveBeenCalledWith({
        where: {
          empresaId_tipo_periodo: {
            empresaId: 'empresa-1',
            tipo: 'ICMS',
            periodo: '2024-02',
          },
        },
      })
    })
  })

  describe('gerarLivroApuracaoIPI', () => {
    it('should return apuração data from persisted IPI record', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue({
        id: 'ap-ipi-1',
        empresaId: 'empresa-1',
        tipo: 'IPI',
        periodo: '2024-01',
        totalDebitos: 3000,
        totalCreditos: 1200,
        estornoDebitos: 0,
        estornoCreditos: 0,
        ajustes: 0,
        saldoAnterior: 200,
        saldoFinal: 1600,
        valorRecolher: 1600,
        fechado: false,
      })

      const result = await service.gerarLivroApuracaoIPI({
        empresaId: 'empresa-1',
        periodo: '2024-01',
      })

      expect(result.totalDebitos).toBe(3000)
      expect(result.totalCreditos).toBe(1200)
      expect(result.saldoAnterior).toBe(200)
      expect(result.saldoFinal).toBe(1600)
      expect(result.valorRecolher).toBe(1600)
    })

    it('should throw when no IPI apuração exists for the period', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue(null)

      await expect(
        service.gerarLivroApuracaoIPI({ empresaId: 'empresa-1', periodo: '2024-01' }),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.APURACAO_SALDO_INCONSISTENTE,
      })
    })

    it('should query with tipo=IPI', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue({
        totalDebitos: 0, totalCreditos: 0, estornoDebitos: 0,
        estornoCreditos: 0, ajustes: 0, saldoAnterior: 0,
        saldoFinal: 0, valorRecolher: 0,
      })

      await service.gerarLivroApuracaoIPI({ empresaId: 'empresa-1', periodo: '2024-05' })

      expect(prisma.apuracaoFiscal.findUnique).toHaveBeenCalledWith({
        where: {
          empresaId_tipo_periodo: {
            empresaId: 'empresa-1',
            tipo: 'IPI',
            periodo: '2024-05',
          },
        },
      })
    })
  })

  describe('gerarDadosPdfEntradas', () => {
    it('should wrap livro entradas data with PDF metadata', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([])

      const result = await service.gerarDadosPdfEntradas({
        empresaId: 'empresa-1',
        periodo: '2024-01',
      })

      expect(result.tipo).toBe('LIVRO_ENTRADAS')
      expect(result.cabecalho.empresaId).toBe('empresa-1')
      expect(result.cabecalho.periodo).toBe('2024-01')
      expect(result.cabecalho.geradoEm).toBeDefined()
      expect(result.dados.gruposCfop).toHaveLength(0)
    })
  })

  describe('gerarDadosPdfSaidas', () => {
    it('should wrap livro saidas data with PDF metadata', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([])

      const result = await service.gerarDadosPdfSaidas({
        empresaId: 'empresa-1',
        periodo: '2024-01',
      })

      expect(result.tipo).toBe('LIVRO_SAIDAS')
      expect(result.cabecalho.empresaId).toBe('empresa-1')
      expect(result.cabecalho.periodo).toBe('2024-01')
      expect(result.cabecalho.geradoEm).toBeDefined()
    })
  })

  describe('gerarDadosPdfApuracaoICMS', () => {
    it('should wrap livro apuração ICMS data with PDF metadata', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue({
        totalDebitos: 5000, totalCreditos: 3000, estornoDebitos: 0,
        estornoCreditos: 0, ajustes: 0, saldoAnterior: 0,
        saldoFinal: 2000, valorRecolher: 2000,
      })

      const result = await service.gerarDadosPdfApuracaoICMS({
        empresaId: 'empresa-1',
        periodo: '2024-01',
      })

      expect(result.tipo).toBe('LIVRO_APURACAO_ICMS')
      expect(result.dados.valorRecolher).toBe(2000)
    })
  })

  describe('gerarDadosPdfApuracaoIPI', () => {
    it('should wrap livro apuração IPI data with PDF metadata', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue({
        totalDebitos: 2000, totalCreditos: 800, estornoDebitos: 0,
        estornoCreditos: 0, ajustes: 0, saldoAnterior: 0,
        saldoFinal: 1200, valorRecolher: 1200,
      })

      const result = await service.gerarDadosPdfApuracaoIPI({
        empresaId: 'empresa-1',
        periodo: '2024-01',
      })

      expect(result.tipo).toBe('LIVRO_APURACAO_IPI')
      expect(result.dados.valorRecolher).toBe(1200)
    })
  })
})
