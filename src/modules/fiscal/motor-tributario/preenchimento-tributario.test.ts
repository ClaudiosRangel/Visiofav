import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RegimeTributario } from './tipos'
import { CodigoErroFiscal, ErroFiscal } from '../erros'
import type { DadosItemParaPreenchimento } from './preenchimento-tributario'

// Mock do motor-tributario service
vi.mock('./motor-tributario.service', () => ({
  motorTributarioService: {
    buscarRegraComFallback: vi.fn(),
  },
}))

import { motorTributarioService } from './motor-tributario.service'
import { preencherCamposTributarios } from './preenchimento-tributario'

const mockBuscarRegra = motorTributarioService.buscarRegraComFallback as ReturnType<typeof vi.fn>

// Fixture de dados de item para preenchimento
function criarDadosItem(overrides: Partial<DadosItemParaPreenchimento> = {}): DadosItemParaPreenchimento {
  return {
    ncm: '84713012',
    cfop: '6102',
    ufOrigem: 'SP',
    ufDestino: 'MG',
    regimeTributario: RegimeTributario.NORMAL,
    empresaId: 'empresa-001',
    valorProduto: 1000,
    valorFrete: 50,
    valorSeguro: 10,
    valorOutras: 5,
    valorDesconto: 15,
    quantidade: 2,
    ...overrides,
  }
}

// Fixture de resultado de busca de regra
function criarResultadoRegra(overrides: Partial<Record<string, any>> = {}) {
  return {
    regra: {
      id: 'regra-001',
      ncm: '84713012',
      cfop: '6102',
      ufOrigem: 'SP',
      ufDestino: 'MG',
      regimeTributario: RegimeTributario.NORMAL,
      icms: {
        aliquota: 12,
        cst: '00',
        baseCalculo: 100,
        reducao: 0,
      },
      pis: {
        aliquota: 1.65,
        cst: '01',
      },
      cofins: {
        aliquota: 7.6,
        cst: '01',
      },
      ipi: {
        aliquota: 5,
        cst: '50',
      },
      ...overrides,
    },
    nivelFallback: 'EXATO' as const,
  }
}

describe('preencherCamposTributarios', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('deve chamar buscarRegraComFallback com os parâmetros corretos', async () => {
    mockBuscarRegra.mockResolvedValueOnce(criarResultadoRegra())
    const dados = criarDadosItem()

    await preencherCamposTributarios(dados)

    expect(mockBuscarRegra).toHaveBeenCalledWith({
      ncm: '84713012',
      cfop: '6102',
      ufOrigem: 'SP',
      ufDestino: 'MG',
      regimeTributario: RegimeTributario.NORMAL,
      empresaId: 'empresa-001',
    })
  })

  it('deve calcular base ICMS como vProd + vFrete + vSeg + vOutras - vDesc', async () => {
    mockBuscarRegra.mockResolvedValueOnce(criarResultadoRegra())
    const dados = criarDadosItem()
    // Base = 1000 + 50 + 10 + 5 - 15 = 1050

    const resultado = await preencherCamposTributarios(dados)

    expect(resultado.icmsBase).toBe(1050)
  })

  it('deve calcular ICMS valor como base × alíquota / 100', async () => {
    mockBuscarRegra.mockResolvedValueOnce(criarResultadoRegra())
    const dados = criarDadosItem()
    // Base = 1050, Alíquota = 12% → Valor = 126.00

    const resultado = await preencherCamposTributarios(dados)

    expect(resultado.icmsAliquota).toBe(12)
    expect(resultado.icmsValor).toBe(126)
  })

  it('deve aplicar redução de base de ICMS quando configurada na regra', async () => {
    const resultadoComReducao = criarResultadoRegra()
    resultadoComReducao.regra.icms.reducao = 30 // 30% de redução
    mockBuscarRegra.mockResolvedValueOnce(resultadoComReducao)
    const dados = criarDadosItem()
    // Base bruta = 1050, com 30% de redução: 1050 * 1 * (1 - 0.30) = 735
    // ICMS = 735 * 12% = 88.20

    const resultado = await preencherCamposTributarios(dados)

    expect(resultado.icmsBase).toBe(735)
    expect(resultado.icmsValor).toBe(88.2)
    expect(resultado.icmsReducao).toBe(30)
  })

  it('deve calcular PIS sobre a base bruta (sem redução ICMS)', async () => {
    mockBuscarRegra.mockResolvedValueOnce(criarResultadoRegra())
    const dados = criarDadosItem()
    // Base PIS = 1050, Alíquota = 1.65% → Valor = 17.33 (arredondado)

    const resultado = await preencherCamposTributarios(dados)

    expect(resultado.pisBase).toBe(1050)
    expect(resultado.pisAliquota).toBe(1.65)
    expect(resultado.pisValor).toBe(17.33)
    expect(resultado.pisCst).toBe('01')
  })

  it('deve calcular COFINS sobre a base bruta', async () => {
    mockBuscarRegra.mockResolvedValueOnce(criarResultadoRegra())
    const dados = criarDadosItem()
    // Base COFINS = 1050, Alíquota = 7.6% → Valor = 79.80

    const resultado = await preencherCamposTributarios(dados)

    expect(resultado.cofinsBase).toBe(1050)
    expect(resultado.cofinsAliquota).toBe(7.6)
    expect(resultado.cofinsValor).toBe(79.8)
    expect(resultado.cofinsCst).toBe('01')
  })

  it('deve calcular IPI sobre base sem desconto (vProd + vFrete + vSeg + vOutras)', async () => {
    mockBuscarRegra.mockResolvedValueOnce(criarResultadoRegra())
    const dados = criarDadosItem()
    // Base IPI = 1000 + 50 + 10 + 5 = 1065, Alíquota = 5% → Valor = 53.25

    const resultado = await preencherCamposTributarios(dados)

    expect(resultado.ipiBase).toBe(1065)
    expect(resultado.ipiAliquota).toBe(5)
    expect(resultado.ipiValor).toBe(53.25)
    expect(resultado.ipiCst).toBe('50')
  })

  it('deve registrar regraTributariaId e nivelFallback no resultado', async () => {
    mockBuscarRegra.mockResolvedValueOnce(criarResultadoRegra())
    const dados = criarDadosItem()

    const resultado = await preencherCamposTributarios(dados)

    expect(resultado.regraTributariaId).toBe('regra-001')
    expect(resultado.nivelFallback).toBe('EXATO')
  })

  it('deve registrar nivelFallback correto quando fallback é NCM_PARCIAL', async () => {
    const resultadoFallback = criarResultadoRegra()
    resultadoFallback.nivelFallback = 'NCM_PARCIAL'
    mockBuscarRegra.mockResolvedValueOnce(resultadoFallback)
    const dados = criarDadosItem()

    const resultado = await preencherCamposTributarios(dados)

    expect(resultado.nivelFallback).toBe('NCM_PARCIAL')
  })

  it('deve preencher icmsCst para regime NORMAL', async () => {
    mockBuscarRegra.mockResolvedValueOnce(criarResultadoRegra())
    const dados = criarDadosItem({ regimeTributario: RegimeTributario.NORMAL })

    const resultado = await preencherCamposTributarios(dados)

    expect(resultado.icmsCst).toBe('00')
    expect(resultado.icmsCsosn).toBeUndefined()
  })

  it('deve preencher icmsCsosn para regime SIMPLES_NACIONAL', async () => {
    const resultadoSN = criarResultadoRegra()
    resultadoSN.regra.icms.cst = '102' // CSOSN típico para Simples Nacional
    mockBuscarRegra.mockResolvedValueOnce(resultadoSN)
    const dados = criarDadosItem({ regimeTributario: RegimeTributario.SIMPLES_NACIONAL })

    const resultado = await preencherCamposTributarios(dados)

    expect(resultado.icmsCsosn).toBe('102')
    expect(resultado.icmsCst).toBeUndefined()
  })

  it('deve propagar ErroFiscal quando nenhuma regra é encontrada', async () => {
    const erro = new ErroFiscal(
      CodigoErroFiscal.REGRA_NAO_ENCONTRADA,
      'Nenhuma regra tributária encontrada',
      { ncm: '99999999' },
    )
    mockBuscarRegra.mockRejectedValue(erro)
    const dados = criarDadosItem({ ncm: '99999999' })

    await expect(preencherCamposTributarios(dados)).rejects.toThrow(ErroFiscal)
    await expect(preencherCamposTributarios(dados)).rejects.toMatchObject({
      codigo: CodigoErroFiscal.REGRA_NAO_ENCONTRADA,
    })
  })

  it('deve arredondar valores para 2 casas decimais (ABNT NBR 5891)', async () => {
    const resultadoComAliquotaFracionada = criarResultadoRegra()
    resultadoComAliquotaFracionada.regra.pis.aliquota = 1.65
    mockBuscarRegra.mockResolvedValue(resultadoComAliquotaFracionada)
    // Base = 333.33 (valores que geram muitas casas decimais)
    const dados = criarDadosItem({
      valorProduto: 333.33,
      valorFrete: 0,
      valorSeguro: 0,
      valorOutras: 0,
      valorDesconto: 0,
    })
    // PIS = 333.33 × 1.65% = 5.499945 → arredonda para 5.50

    const resultado = await preencherCamposTributarios(dados)

    expect(resultado.pisValor).toBe(5.5)
  })

  it('deve retornar todos os valores zerados quando alíquotas da regra são zero', async () => {
    const resultadoZerado = criarResultadoRegra()
    resultadoZerado.regra.icms.aliquota = 0
    resultadoZerado.regra.pis.aliquota = 0
    resultadoZerado.regra.cofins.aliquota = 0
    resultadoZerado.regra.ipi.aliquota = 0
    mockBuscarRegra.mockResolvedValueOnce(resultadoZerado)
    const dados = criarDadosItem()

    const resultado = await preencherCamposTributarios(dados)

    expect(resultado.icmsValor).toBe(0)
    expect(resultado.pisValor).toBe(0)
    expect(resultado.cofinsValor).toBe(0)
    expect(resultado.ipiValor).toBe(0)
  })

  it('deve aplicar percentual de base de cálculo da regra', async () => {
    const resultadoBaseReduzida = criarResultadoRegra()
    resultadoBaseReduzida.regra.icms.baseCalculo = 50 // 50% de base
    resultadoBaseReduzida.regra.icms.reducao = 0
    mockBuscarRegra.mockResolvedValueOnce(resultadoBaseReduzida)
    const dados = criarDadosItem()
    // Base bruta = 1050, percentual base = 50% → Base ICMS = 525
    // ICMS = 525 * 12% = 63.00

    const resultado = await preencherCamposTributarios(dados)

    expect(resultado.icmsBase).toBe(525)
    expect(resultado.icmsValor).toBe(63)
  })
})
