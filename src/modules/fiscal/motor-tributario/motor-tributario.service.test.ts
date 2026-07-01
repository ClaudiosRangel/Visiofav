import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CodigoErroFiscal, ErroFiscal } from '../erros'
import { BuscaRegraParams, RegimeTributario } from './tipos'

// Mock do prisma
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    regraTributaria: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}))

import { prisma } from '../../../lib/prisma'
import { MotorTributarioService } from './motor-tributario.service'

const mockFindFirst = prisma.regraTributaria.findFirst as ReturnType<typeof vi.fn>

// Fixture de regra no formato Prisma (como retorna do banco)
function criarRegraPrisma(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'regra-001',
    empresaId: 'empresa-001',
    ncm: '84713012',
    cfop: '6102',
    ufOrigem: 'SP',
    ufDestino: 'MG',
    regimeTributario: 3,
    icmsAliquota: 12,
    icmsCst: '00',
    icmsCsosn: null,
    icmsBaseCalculo: 100,
    icmsReducao: 0,
    icmsStMva: null,
    icmsStMvaAjust: null,
    icmsStAliqInterna: null,
    fcpAliquota: null,
    pisAliquota: 1.65,
    pisCst: '01',
    cofinsAliquota: 7.6,
    cofinsCst: '01',
    ipiAliquota: 5,
    ipiCst: '50',
    issAliquota: null,
    ativo: true,
    criadoEm: new Date(),
    atualizadoEm: new Date(),
    ...overrides,
  }
}

describe('MotorTributarioService - buscarRegraComFallback', () => {
  let service: MotorTributarioService

  const paramsPadrao: BuscaRegraParams = {
    ncm: '84713012',
    cfop: '6102',
    ufOrigem: 'SP',
    ufDestino: 'MG',
    regimeTributario: RegimeTributario.NORMAL,
    empresaId: 'empresa-001',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    service = new MotorTributarioService()
  })

  it('deve retornar regra exata quando encontrada (nível EXATO)', async () => {
    const regraDb = criarRegraPrisma()
    mockFindFirst.mockResolvedValueOnce(regraDb)

    const resultado = await service.buscarRegraComFallback(paramsPadrao)

    expect(resultado.nivelFallback).toBe('EXATO')
    expect(resultado.regra).not.toBeNull()
    expect(resultado.regra!.id).toBe('regra-001')
    expect(resultado.regra!.ncm).toBe('84713012')
    expect(resultado.regra!.cfop).toBe('6102')
    expect(resultado.regra!.icms.aliquota).toBe(12)
    expect(resultado.regra!.pis.aliquota).toBe(1.65)
    expect(resultado.regra!.cofins.aliquota).toBe(7.6)

    // Verificar que o primeiro findFirst foi chamado com busca exata
    expect(mockFindFirst).toHaveBeenCalledTimes(1)
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: {
        empresaId: 'empresa-001',
        ncm: '84713012',
        cfop: '6102',
        ufOrigem: 'SP',
        ufDestino: 'MG',
        regimeTributario: 3,
        ativo: true,
      },
    })
  })

  it('deve retornar regra por NCM parcial quando exata não encontrada (nível NCM_PARCIAL)', async () => {
    const regraNcmParcial = criarRegraPrisma({ id: 'regra-ncm-parcial', ncm: '84710000' })

    // 1ª chamada (exata) → null
    mockFindFirst.mockResolvedValueOnce(null)
    // 2ª chamada (NCM parcial) → encontrada
    mockFindFirst.mockResolvedValueOnce(regraNcmParcial)

    const resultado = await service.buscarRegraComFallback(paramsPadrao)

    expect(resultado.nivelFallback).toBe('NCM_PARCIAL')
    expect(resultado.regra!.id).toBe('regra-ncm-parcial')
    expect(mockFindFirst).toHaveBeenCalledTimes(2)

    // Verificar que o 2º findFirst usou startsWith com primeiros 4 dígitos
    expect(mockFindFirst).toHaveBeenNthCalledWith(2, {
      where: {
        empresaId: 'empresa-001',
        ncm: { startsWith: '8471' },
        cfop: '6102',
        ufOrigem: 'SP',
        ufDestino: 'MG',
        regimeTributario: 3,
        ativo: true,
      },
      orderBy: { ncm: 'asc' },
    })
  })

  it('deve retornar regra por CFOP genérico quando NCM parcial não encontrada (nível CFOP_GENERICO)', async () => {
    const regraCfopGenerico = criarRegraPrisma({ id: 'regra-cfop-gen', cfop: '6100' })

    // 1ª (exata) → null, 2ª (NCM parcial) → null, 3ª (CFOP genérico) → encontrada
    mockFindFirst.mockResolvedValueOnce(null)
    mockFindFirst.mockResolvedValueOnce(null)
    mockFindFirst.mockResolvedValueOnce(regraCfopGenerico)

    const resultado = await service.buscarRegraComFallback(paramsPadrao)

    expect(resultado.nivelFallback).toBe('CFOP_GENERICO')
    expect(resultado.regra!.id).toBe('regra-cfop-gen')
    expect(mockFindFirst).toHaveBeenCalledTimes(3)

    // Verificar que o 3º findFirst usou CFOP com último dígito zero
    expect(mockFindFirst).toHaveBeenNthCalledWith(3, {
      where: {
        empresaId: 'empresa-001',
        ncm: '84713012',
        cfop: '6100',
        ufOrigem: 'SP',
        ufDestino: 'MG',
        regimeTributario: 3,
        ativo: true,
      },
    })
  })

  it('deve retornar regra padrão do regime quando CFOP genérico não encontrada (nível PADRAO_REGIME)', async () => {
    const regraPadrao = criarRegraPrisma({ id: 'regra-padrao', ncm: '00000000', cfop: '0000' })

    // 1ª (exata) → null, 2ª (NCM parcial) → null, 3ª (CFOP genérico) → null, 4ª (padrão regime) → encontrada
    mockFindFirst.mockResolvedValueOnce(null)
    mockFindFirst.mockResolvedValueOnce(null)
    mockFindFirst.mockResolvedValueOnce(null)
    mockFindFirst.mockResolvedValueOnce(regraPadrao)

    const resultado = await service.buscarRegraComFallback(paramsPadrao)

    expect(resultado.nivelFallback).toBe('PADRAO_REGIME')
    expect(resultado.regra!.id).toBe('regra-padrao')
    expect(mockFindFirst).toHaveBeenCalledTimes(4)

    // Verificar que o 4º findFirst buscou só por regime e empresa
    expect(mockFindFirst).toHaveBeenNthCalledWith(4, {
      where: {
        empresaId: 'empresa-001',
        regimeTributario: 3,
        ativo: true,
      },
      orderBy: { criadoEm: 'asc' },
    })
  })

  it('deve lançar ErroFiscal(REGRA_NAO_ENCONTRADA) quando nenhuma regra encontrada em nenhum nível', async () => {
    mockFindFirst.mockResolvedValue(null)

    await expect(service.buscarRegraComFallback(paramsPadrao)).rejects.toThrow(ErroFiscal)

    try {
      await service.buscarRegraComFallback(paramsPadrao)
    } catch (err) {
      const erro = err as ErroFiscal
      expect(erro.codigo).toBe(CodigoErroFiscal.REGRA_NAO_ENCONTRADA)
      expect(erro.detalhes).toMatchObject({
        ncm: '84713012',
        cfop: '6102',
        ufOrigem: 'SP',
        ufDestino: 'MG',
        regimeTributario: 3,
        empresaId: 'empresa-001',
      })
    }
  })

  it('deve usar cache na segunda chamada com mesmos parâmetros', async () => {
    const regraDb = criarRegraPrisma()
    mockFindFirst.mockResolvedValueOnce(regraDb)

    // Primeira chamada — vai ao banco
    const resultado1 = await service.buscarRegraComFallback(paramsPadrao)
    expect(resultado1.nivelFallback).toBe('EXATO')
    expect(mockFindFirst).toHaveBeenCalledTimes(1)

    // Segunda chamada — deve vir do cache
    const resultado2 = await service.buscarRegraComFallback(paramsPadrao)
    expect(resultado2.nivelFallback).toBe('EXATO')
    expect(resultado2.regra!.id).toBe('regra-001')
    // Não deve ter feito novas chamadas ao banco
    expect(mockFindFirst).toHaveBeenCalledTimes(1)
  })

  it('deve invalidar cache após limparCache()', async () => {
    const regraDb = criarRegraPrisma()
    mockFindFirst.mockResolvedValue(regraDb)

    await service.buscarRegraComFallback(paramsPadrao)
    expect(mockFindFirst).toHaveBeenCalledTimes(1)

    // Limpar cache
    service.limparCache()

    // Nova chamada deve ir ao banco novamente
    await service.buscarRegraComFallback(paramsPadrao)
    expect(mockFindFirst).toHaveBeenCalledTimes(2)
  })

  it('deve mapear campos opcionais (ISS, FCP, ICMS-ST) corretamente', async () => {
    const regraComOpcional = criarRegraPrisma({
      issAliquota: 3.5,
      fcpAliquota: 2.0,
      icmsStMva: 40,
      icmsStMvaAjust: 52.48,
      icmsStAliqInterna: 18,
    })
    mockFindFirst.mockResolvedValueOnce(regraComOpcional)

    const resultado = await service.buscarRegraComFallback(paramsPadrao)

    expect(resultado.regra!.iss).toEqual({ aliquota: 3.5 })
    expect(resultado.regra!.fcp).toEqual({ aliquota: 2.0 })
    expect(resultado.regra!.icmsSt).toEqual({
      mva: 40,
      mvaAjustado: 52.48,
      aliquotaInterna: 18,
    })
  })

  it('deve gerar CFOP genérico corretamente (último dígito vira 0)', async () => {
    // CFOP 5405 → genérico = 5400
    const params: BuscaRegraParams = {
      ...paramsPadrao,
      cfop: '5405',
    }

    const regraCfopGen = criarRegraPrisma({ id: 'regra-cfop-5400', cfop: '5400' })
    mockFindFirst.mockResolvedValueOnce(null) // exata
    mockFindFirst.mockResolvedValueOnce(null) // NCM parcial
    mockFindFirst.mockResolvedValueOnce(regraCfopGen) // CFOP genérico

    const resultado = await service.buscarRegraComFallback(params)

    expect(resultado.nivelFallback).toBe('CFOP_GENERICO')
    expect(mockFindFirst).toHaveBeenNthCalledWith(3, expect.objectContaining({
      where: expect.objectContaining({ cfop: '5400' }),
    }))
  })
})
