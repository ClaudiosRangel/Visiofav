import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock Prisma before importing the generator
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    empresa: {
      findUniqueOrThrow: vi.fn(),
    },
    documentoFiscal: {
      findMany: vi.fn(),
    },
  },
}))

import { prisma } from '../../../lib/prisma'
import {
  SpedReinfGenerator,
  TipoEventoReinf,
  StatusEventoReinf,
  buildXmlR1000,
  buildXmlR2010,
  buildXmlR2020,
  buildXmlR2099,
  ReinfTransmissorMock,
} from './sped-reinf.generator'
import type { PeriodoParams } from './tipos'
import type { DadosContribuinte, RetencaoServico } from './sped-reinf.generator'

const mockEmpresa = {
  id: 'empresa-1',
  razaoSocial: 'Empresa Teste LTDA',
  nomeFantasia: 'Teste',
  cnpj: '12345678000199',
  inscEstadual: '123456789',
  uf: 'SP',
  regimeTributario: 3,
}

const mockDocsTomados = [
  {
    id: 'doc-1',
    empresaId: 'empresa-1',
    tipo: 'NFSE',
    tipoOperacao: 0,
    status: 'AUTORIZADO',
    numero: 100,
    emitenteCnpj: '98765432000188',
    emitenteRazao: 'Prestador Servicos LTDA',
    destCpfCnpj: '12345678000199',
    destRazao: 'Empresa Teste LTDA',
    valorTotal: 10000,
    valorIss: 500,
    dataEmissao: new Date('2024-03-15'),
    itens: [],
  },
]

const mockDocsPrestados = [
  {
    id: 'doc-2',
    empresaId: 'empresa-1',
    tipo: 'NFSE',
    tipoOperacao: 1,
    status: 'AUTORIZADO',
    numero: 200,
    emitenteCnpj: '12345678000199',
    emitenteRazao: 'Empresa Teste LTDA',
    destCpfCnpj: '11223344000155',
    destRazao: 'Tomador Servico LTDA',
    valorTotal: 20000,
    valorIss: 1000,
    dataEmissao: new Date('2024-03-20'),
    itens: [],
  },
]

describe('SpedReinfGenerator', () => {
  let generator: SpedReinfGenerator
  const defaultParams: PeriodoParams = {
    empresaId: 'empresa-1',
    mes: 3,
    ano: 2024,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    generator = new SpedReinfGenerator()
    ;(prisma.empresa.findUniqueOrThrow as any).mockResolvedValue(mockEmpresa)
    ;(prisma.documentoFiscal.findMany as any).mockImplementation((args: any) => {
      if (args.where.tipoOperacao === 0) return Promise.resolve(mockDocsTomados)
      if (args.where.tipoOperacao === 1) return Promise.resolve(mockDocsPrestados)
      return Promise.resolve([])
    })
  })

  describe('gerar()', () => {
    it('should generate R-1000 event as first event', async () => {
      const result = await generator.gerar(defaultParams)

      expect(result.eventos[0].tipo).toBe(TipoEventoReinf.R1000)
    })

    it('should generate R-2010 when there are tomados retentions', async () => {
      const result = await generator.gerar(defaultParams)

      const r2010 = result.eventos.find(e => e.tipo === TipoEventoReinf.R2010)
      expect(r2010).toBeDefined()
      expect(r2010!.xml).toContain('evtServTom')
    })

    it('should generate R-2020 when there are prestados retentions', async () => {
      const result = await generator.gerar(defaultParams)

      const r2020 = result.eventos.find(e => e.tipo === TipoEventoReinf.R2020)
      expect(r2020).toBeDefined()
      expect(r2020!.xml).toContain('evtServPrest')
    })

    it('should generate R-2099 as last event', async () => {
      const result = await generator.gerar(defaultParams)

      const lastEvento = result.eventos[result.eventos.length - 1]
      expect(lastEvento.tipo).toBe(TipoEventoReinf.R2099)
    })

    it('should skip R-2010 when no tomados retentions exist', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockImplementation((args: any) => {
        if (args.where.tipoOperacao === 0) return Promise.resolve([])
        if (args.where.tipoOperacao === 1) return Promise.resolve(mockDocsPrestados)
        return Promise.resolve([])
      })

      const result = await generator.gerar(defaultParams)

      const r2010 = result.eventos.find(e => e.tipo === TipoEventoReinf.R2010)
      expect(r2010).toBeUndefined()
    })

    it('should skip R-2020 when no prestados retentions exist', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockImplementation((args: any) => {
        if (args.where.tipoOperacao === 0) return Promise.resolve(mockDocsTomados)
        if (args.where.tipoOperacao === 1) return Promise.resolve([])
        return Promise.resolve([])
      })

      const result = await generator.gerar(defaultParams)

      const r2020 = result.eventos.find(e => e.tipo === TipoEventoReinf.R2020)
      expect(r2020).toBeUndefined()
    })

    it('should generate only R-1000 and R-2099 when no retentions', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([])

      const result = await generator.gerar(defaultParams)

      expect(result.eventos).toHaveLength(2)
      expect(result.eventos[0].tipo).toBe(TipoEventoReinf.R1000)
      expect(result.eventos[1].tipo).toBe(TipoEventoReinf.R2099)
    })

    it('should set periodoApuracao in YYYY-MM format', async () => {
      const result = await generator.gerar(defaultParams)

      expect(result.periodoApuracao).toBe('2024-03')
    })

    it('should set totalEventos correctly', async () => {
      const result = await generator.gerar(defaultParams)

      expect(result.totalEventos).toBe(result.eventos.length)
    })

    it('should set all events status to PENDENTE', async () => {
      const result = await generator.gerar(defaultParams)

      for (const evento of result.eventos) {
        expect(evento.status).toBe(StatusEventoReinf.PENDENTE)
      }
    })

    it('should set cnpjDeclarante on all events', async () => {
      const result = await generator.gerar(defaultParams)

      for (const evento of result.eventos) {
        expect(evento.cnpjDeclarante).toBe('12345678000199')
      }
    })
  })

  describe('transmitir()', () => {
    it('should transmit all events and return ACEITO status', async () => {
      const result = await generator.gerar(defaultParams)
      const certificado = { pfx: Buffer.from('mock-pfx'), senha: 'senha' }

      const transmitidos = await generator.transmitir(result.eventos, certificado)

      for (const evento of transmitidos) {
        expect(evento.status).toBe(StatusEventoReinf.ACEITO)
        expect(evento.protocolo).toBeDefined()
      }
    })

    it('should return REJEITADO when XML is empty', async () => {
      const eventosVazios = [{
        tipo: TipoEventoReinf.R1000,
        id: 'test-id',
        xml: '',
        periodoApuracao: '2024-03',
        cnpjDeclarante: '12345678000199',
        status: StatusEventoReinf.PENDENTE,
      }]
      const certificado = { pfx: Buffer.from('mock-pfx'), senha: 'senha' }

      const transmitidos = await generator.transmitir(eventosVazios, certificado)

      expect(transmitidos[0].status).toBe(StatusEventoReinf.REJEITADO)
      expect(transmitidos[0].erros).toBeDefined()
      expect(transmitidos[0].erros![0].codigo).toBe('MS0001')
    })

    it('should use custom transmissor when provided', async () => {
      const mockTransmissor = {
        transmitir: vi.fn().mockResolvedValue({
          sucesso: true,
          protocolo: 'CUSTOM-PROTO-001',
          dataRecebimento: '2024-03-15T10:00:00Z',
        }),
      }
      const customGenerator = new SpedReinfGenerator(mockTransmissor)
      ;(prisma.empresa.findUniqueOrThrow as any).mockResolvedValue(mockEmpresa)
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([])

      const result = await customGenerator.gerar(defaultParams)
      const certificado = { pfx: Buffer.from('pfx'), senha: 'pass' }
      const transmitidos = await customGenerator.transmitir(result.eventos, certificado)

      expect(mockTransmissor.transmitir).toHaveBeenCalled()
      expect(transmitidos[0].protocolo).toBe('CUSTOM-PROTO-001')
    })
  })

  describe('buildXmlR1000()', () => {
    const contribuinte: DadosContribuinte = {
      cnpj: '12345678000199',
      razaoSocial: 'Empresa Teste LTDA',
      naturezaJuridica: '2062',
      classTributaria: '99',
      uf: 'SP',
    }

    it('should generate valid XML with Reinf namespace', () => {
      const xml = buildXmlR1000(contribuinte, '2024-03')

      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
      expect(xml).toContain('xmlns="http://www.reinf.esocial.gov.br/schemas/evtInfoContribuinte')
    })

    it('should include evtInfoContri element', () => {
      const xml = buildXmlR1000(contribuinte, '2024-03')

      expect(xml).toContain('<evtInfoContri>')
      expect(xml).toContain('</evtInfoContri>')
    })

    it('should include CNPJ raiz (8 digits)', () => {
      const xml = buildXmlR1000(contribuinte, '2024-03')

      expect(xml).toContain('<nrInsc>12345678</nrInsc>')
    })

    it('should include periodo de validade', () => {
      const xml = buildXmlR1000(contribuinte, '2024-03')

      expect(xml).toContain('<iniValid>2024-03</iniValid>')
    })

    it('should include classTributaria', () => {
      const xml = buildXmlR1000(contribuinte, '2024-03')

      expect(xml).toContain('<classTrib>99</classTrib>')
    })
  })

  describe('buildXmlR2010()', () => {
    const retencoes: RetencaoServico[] = [
      {
        cnpjPrestador: '98765432000188',
        razaoPrestador: 'Prestador LTDA',
        valorServico: 10000,
        valorRetencao: 1100,
        valorBaseRetencao: 10000,
        tipoServico: '100000001',
        numNF: '100',
        dataEmissao: new Date('2024-03-15'),
      },
    ]

    it('should generate XML with evtServTom schema', () => {
      const xml = buildXmlR2010('12345678000199', '2024-03', retencoes)

      expect(xml).toContain('xmlns="http://www.reinf.esocial.gov.br/schemas/evtServTom')
      expect(xml).toContain('<evtServTom>')
    })

    it('should include periodo de apuracao', () => {
      const xml = buildXmlR2010('12345678000199', '2024-03', retencoes)

      expect(xml).toContain('<perApur>2024-03</perApur>')
    })

    it('should include prestador CNPJ', () => {
      const xml = buildXmlR2010('12345678000199', '2024-03', retencoes)

      expect(xml).toContain('<cnpjPrestador>98765432000188</cnpjPrestador>')
    })

    it('should include retention values', () => {
      const xml = buildXmlR2010('12345678000199', '2024-03', retencoes)

      expect(xml).toContain('<vlrTotalBruto>10000.00</vlrTotalBruto>')
      expect(xml).toContain('<vlrTotalRetPrinc>1100.00</vlrTotalRetPrinc>')
    })

    it('should include NF data', () => {
      const xml = buildXmlR2010('12345678000199', '2024-03', retencoes)

      expect(xml).toContain('<numDocto>100</numDocto>')
      expect(xml).toContain('<dtEmissaoNF>2024-03-15</dtEmissaoNF>')
    })
  })

  describe('buildXmlR2020()', () => {
    const retencoes: RetencaoServico[] = [
      {
        cnpjPrestador: '11223344000155',
        razaoPrestador: 'Tomador LTDA',
        valorServico: 20000,
        valorRetencao: 2200,
        valorBaseRetencao: 20000,
        tipoServico: '100000001',
        numNF: '200',
        dataEmissao: new Date('2024-03-20'),
      },
    ]

    it('should generate XML with evtServPrest schema', () => {
      const xml = buildXmlR2020('12345678000199', '2024-03', retencoes)

      expect(xml).toContain('xmlns="http://www.reinf.esocial.gov.br/schemas/evtServPrest')
      expect(xml).toContain('<evtServPrest>')
    })

    it('should include tomador CNPJ', () => {
      const xml = buildXmlR2020('12345678000199', '2024-03', retencoes)

      expect(xml).toContain('<cnpjTomador>11223344000155</cnpjTomador>')
    })

    it('should include retention values', () => {
      const xml = buildXmlR2020('12345678000199', '2024-03', retencoes)

      expect(xml).toContain('<vlrTotalBruto>20000.00</vlrTotalBruto>')
      expect(xml).toContain('<vlrTotalRetPrinc>2200.00</vlrTotalRetPrinc>')
    })
  })

  describe('buildXmlR2099()', () => {
    it('should generate XML with evtFechaEvPer schema', () => {
      const xml = buildXmlR2099('12345678000199', '2024-03', true)

      expect(xml).toContain('xmlns="http://www.reinf.esocial.gov.br/schemas/evtFechamento')
      expect(xml).toContain('<evtFechaEvPer>')
    })

    it('should indicate movement when has retentions', () => {
      const xml = buildXmlR2099('12345678000199', '2024-03', true)

      expect(xml).toContain('<evtServTm>S</evtServTm>')
      expect(xml).toContain('<evtServPr>S</evtServPr>')
    })

    it('should indicate no movement when no retentions', () => {
      const xml = buildXmlR2099('12345678000199', '2024-03', false)

      expect(xml).toContain('<evtServTm>N</evtServTm>')
      expect(xml).toContain('<evtServPr>N</evtServPr>')
    })

    it('should include periodo de apuracao', () => {
      const xml = buildXmlR2099('12345678000199', '2024-03', true)

      expect(xml).toContain('<perApur>2024-03</perApur>')
    })
  })

  describe('ReinfTransmissorMock', () => {
    it('should return sucesso for valid XML', async () => {
      const transmissor = new ReinfTransmissorMock()
      const result = await transmissor.transmitir(
        '<xml>valid</xml>',
        { pfx: Buffer.from('pfx'), senha: 'pass' },
      )

      expect(result.sucesso).toBe(true)
      expect(result.protocolo).toBeDefined()
      expect(result.dataRecebimento).toBeDefined()
    })

    it('should return erro for empty XML', async () => {
      const transmissor = new ReinfTransmissorMock()
      const result = await transmissor.transmitir(
        '',
        { pfx: Buffer.from('pfx'), senha: 'pass' },
      )

      expect(result.sucesso).toBe(false)
      expect(result.erros).toBeDefined()
      expect(result.erros!.length).toBeGreaterThan(0)
    })
  })
})
