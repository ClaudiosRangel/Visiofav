import { describe, it, expect } from 'vitest'
import { calcularOrcamentoGrafico, type ParamsOrcamento } from './orcamento-grafico-calculo.service'

// TASK 1.2 — bloco MAT.ACABAMENTO (materiais de acabamento ricos no MD).
// Valores de referência: golden 15.235 (docs/calcgraf-golden-15235-acabamentos.md).

const baseParams: ParamsOrcamento = {
  tipoEmbalagem: {
    formulaLargura: 'L + ABA + SANGRIA * 2',
    formulaAltura: 'A + SANGRIA * 2',
    abaColagemMm: 20,
    sangriaMm: 3,
    pincaMm: 10,
  },
  medidas: { L: 80, A: 150 },
  papel: { gramatura: 300, precoKg: 8 },
  maquinaImpressao: {
    velocidade: 6000,
    custoHora: 250,
    formatoLargura: 660,
    formatoAltura: 960,
    pinca: 10,
    setupMinutos: 30,
  },
  cores: [{ nome: 'CMYK', tipo: 'CMYK', coberturaPercent: 50, precoKg: 40, rendimentoM2Kg: 25 }],
  acabamentos: [],
  quantidade: 20000,
  perdas: { impressaoPercent: 5, impressaoFixaFolhas: 50, corteVincoPercent: 3, colagemPercent: 2 },
  margem: { impostos: 15, comissao: 5, despAdm: 5, markup: 30 },
}

describe('MAT.ACABAMENTO — materiais de acabamento ricos (golden 15.235)', () => {
  it('calcula os 3 subtotais (KG, FIXO, UN) com as regras do golden e soma ao MD', () => {
    const r = calcularOrcamentoGrafico({
      ...baseParams,
      acabamentos: [
        { naturezaCusto: 'MATERIAL_KG', nome: 'Cola Branca (190 mm)', variavelKg: 1.14, precoKg: 29.15 },
        { naturezaCusto: 'CUSTO_FIXO', nome: 'FACA NOVA', valorFixo: 1300 },
        { naturezaCusto: 'MATERIAL_KG', nome: "Verniz Base D'Água Fosco (F100)", variavelKg: 5.63, precoKg: 24.2 },
        { naturezaCusto: 'MATERIAL_UN', nome: 'Caixa Padrão', variavelUn: 20, precoUn: 7.7 },
      ],
    })

    expect(r.matAcabamento).toBeDefined()
    const itens = r.matAcabamento!.itens

    // Cola: 1,14 × 29,15 = 33,231 → 33,23
    expect(itens[0]).toMatchObject({ natureza: 'MATERIAL_KG', variavel: 1.14, unitario: 29.15, subtotal: 33.23 })
    // FACA NOVA: custo fixo 1.300,00 (fixo preenchido, não escala)
    expect(itens[1]).toMatchObject({ natureza: 'CUSTO_FIXO', fixo: 1300, variavel: 0, unitario: 0, subtotal: 1300 })
    // Verniz: 5,63 × 24,2 = 136,246 → 136,25 (regra var×preço arredondada a 2 casas)
    expect(itens[2]).toMatchObject({ natureza: 'MATERIAL_KG', variavel: 5.63, unitario: 24.2, subtotal: 136.25 })
    // Caixa: 20 × 7,7 = 154,00
    expect(itens[3]).toMatchObject({ natureza: 'MATERIAL_UN', variavel: 20, unitario: 7.7, subtotal: 154 })

    const somaEsperada = Math.round((33.23 + 1300 + 136.25 + 154) * 100) / 100
    expect(r.matAcabamento!.custoTotal).toBeCloseTo(somaEsperada, 2)
  })

  it('soma matAcabamento.custoTotal ao Material Direto', () => {
    const semAcab = calcularOrcamentoGrafico(baseParams)
    const comAcab = calcularOrcamentoGrafico({
      ...baseParams,
      acabamentos: [{ naturezaCusto: 'CUSTO_FIXO', nome: 'FACA NOVA', valorFixo: 1300 }],
    })

    expect(comAcab.matAcabamento!.custoTotal).toBe(1300)
    expect(comAcab.materialDireto).toBeCloseTo(Math.round((semAcab.materialDireto + 1300) * 100) / 100, 2)
  })

  it('não altera o MD quando não há acabamentos ricos de material (não-regressão)', () => {
    const semAcab = calcularOrcamentoGrafico(baseParams)
    expect(semAcab.matAcabamento).toBeUndefined()

    // Com apenas HORA_MAQUINA (que NÃO entra no MAT.ACABAMENTO nesta task),
    // o MD permanece idêntico ao do orçamento sem acabamentos.
    const comHoraMaquina = calcularOrcamentoGrafico({
      ...baseParams,
      acabamentos: [
        {
          naturezaCusto: 'HORA_MAQUINA',
          nome: 'Cortadeira',
          custoHora: 113.21,
          producaoHora: 9000,
          unidadeBase: 'FOLHA',
        },
      ],
    })
    expect(comHoraMaquina.matAcabamento).toBeUndefined()
    expect(comHoraMaquina.materialDireto).toBe(semAcab.materialDireto)
  })
})
