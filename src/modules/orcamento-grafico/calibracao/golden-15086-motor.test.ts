/**
 * Golden 15.086 — confronto REAL por componente contra o MOTOR PURO
 * (`calcularOrcamentoGrafico`), com os parâmetros do cálculo 15.086 montados
 * em memória (sem Prisma). Task 13 (Fase 4) da spec
 * `orcamento-grafico-calibracao-15086`.
 *
 * Diferente de `golden-15086.test.ts` (que confronta a coerência interna dos
 * alvos, pois o motor-por-item depende de banco), este teste alimenta o motor
 * puro com os MESMOS parâmetros calibrados que o seed golden-15086 injeta
 * (suporte/tinta/material/impressão/acabamento), e exige desvio ≤ 0,5% por
 * componente contra os alvos reais do pré-cálculo (fonte de verdade:
 * docs/calcgraf-golden-15086-parametros.md).
 *
 * BASE: o Calcgraf processa 5.160 folhas (ceil(100000/21)=4.762 + quebra/perda
 * de impressão). Perda calibrada: fixa 350 folhas + 0,939% → folhasBrutas 5.160.
 * TODOS os componentes de folha (papel/tinta/impressão/acabamento/verniz) usam
 * essa base; os fatores/densidade/gramaturas abaixo foram calibrados a ela.
 *
 * É a prova de que as calibrações das Fases 1-3 reproduzem o Calcgraf no motor.
 */

import { describe, it, expect } from 'vitest'
import {
  calcularOrcamentoGrafico,
  type ParamsOrcamento,
  type ItemAcabamentoRico,
} from '../orcamento-grafico-calculo.service'
import { GOLDEN_15086, type Alvo } from './golden-15086.fixture'
import { consumoVerniz, consumoCola, consumoCaixa } from '../consumo-material-acabamento'

function confrontar(calculado: number, alvo: Alvo, qual: string) {
  const desvio = alvo.valor === 0 ? Math.abs(calculado) : Math.abs(calculado - alvo.valor) / alvo.valor
  expect(
    desvio,
    `${qual}: calculado ${calculado.toFixed(2)} vs alvo ${alvo.valor} (desvio ${(desvio * 100).toFixed(3)}% > ${(alvo.tolerancia * 100).toFixed(3)}%)`,
  ).toBeLessThanOrEqual(alvo.tolerancia)
}

// ── Parâmetros calibrados do 15.086 (folhasBrutas = 5.160) ──────────────────
const FOLHAS_BRUTAS = 5160
const AREA_M2 = FOLHAS_BRUTAS * 0.72 * 1.0
// Perda que leva 4.762 (ceil(100000/21)) → 5.160 folhas brutas.
const PERDA_FIXA_FOLHAS = 350
const PERDA_PERCENT = (FOLHAS_BRUTAS / (4762 + PERDA_FIXA_FOLHAS) - 1) * 100 // ≈ 0,939%
const ESC_FOLHAS = 4762 / FOLHAS_BRUTAS // atividades medidas a 4.762 e que operam por folha
const DENSIDADE_TINTA = 0.8866714963705421
const FATOR_IMPRESSAO = 3.5298497201576846
const FATOR_CORTADEIRA = 0.9999172916345708
const FATOR_DAYUAN = 1.1627906976744187
const GRAM_UV = 0.0027686090347589054
const GRAM_PRIMER = 0.0029720440719416884
const FATOR_COLA = 3.0e-7

function acabamentosMaquina(): ItemAcabamentoRico[] {
  return [
    { naturezaCusto: 'HORA_MAQUINA', nome: 'Cortadeira (Grande)', custoHora: 113.21, producaoHora: 3000, unidadeBase: 'FOLHA', quantAcertos: 1, tempoPorAcertoMin: 0, tempoPrimeiroAcertoMin: 15, fatorOperacao: FATOR_CORTADEIRA },
    { naturezaCusto: 'HORA_MAQUINA', nome: 'Verniz UV Total', custoHora: 155.0, producaoHora: 5000, unidadeBase: 'FOLHA', quantAcertos: 1, tempoPorAcertoMin: 0, tempoPrimeiroAcertoMin: 0, fatorOperacao: ESC_FOLHAS },
    { naturezaCusto: 'HORA_MAQUINA', nome: 'Dayuan (Corte e Vinco)', custoHora: 300.0, producaoHora: 6000, unidadeBase: 'FOLHA', quantAcertos: 1, tempoPorAcertoMin: 0, tempoPrimeiroAcertoMin: 30, fatorOperacao: FATOR_DAYUAN },
    { naturezaCusto: 'HORA_MAQUINA', nome: 'Destacar', custoHora: 50.0, producaoHora: 10000, unidadeBase: 'FOLHA', quantAcertos: 1, tempoPorAcertoMin: 0, tempoPrimeiroAcertoMin: 0, fatorOperacao: ESC_FOLHAS },
    { naturezaCusto: 'HORA_MAQUINA', nome: 'AFT70 (Coladeira)', custoHora: 320.0, producaoHora: 28182, unidadeBase: 'PRODUTO', quantAcertos: 1, tempoPorAcertoMin: 0, tempoPrimeiroAcertoMin: 90 },
  ]
}

function materiaisAcabamento(): ItemAcabamentoRico[] {
  const uv = consumoVerniz({ areaImpressaM2: AREA_M2, cobertura: 0.9, gramaturaKgM2: GRAM_UV })
  const primer = consumoVerniz({ areaImpressaM2: AREA_M2, cobertura: 1.0, gramaturaKgM2: GRAM_PRIMER })
  const cola = consumoCola({ tiragem: 100000, comprimentoColaMm: 177, fatorKgPorMmPeca: FATOR_COLA })
  const caixa = consumoCaixa({ tiragem: 100000, pecasPorCaixa: 893 })
  return [
    { naturezaCusto: 'MATERIAL_KG', nome: 'Cola Branca', variavelKg: cola, precoKg: 29.15 },
    { naturezaCusto: 'MATERIAL_KG', nome: 'Verniz Primer', variavelKg: primer, precoKg: 17.49 },
    { naturezaCusto: 'MATERIAL_KG', nome: 'Verniz UV (material)', variavelKg: uv, precoKg: 57.2 },
    { naturezaCusto: 'MATERIAL_UN', nome: 'Caixa Padrão', variavelUn: caixa, precoUn: 7.7 },
  ]
}

function params(): ParamsOrcamento {
  return {
    tipoEmbalagem: { formulaLargura: '(COMPRIMENTO + LARGURA) * 2 + ABA', formulaAltura: 'ALTURA + LARGURA + ABA', abaColagemMm: 15, sangriaMm: 3, pincaMm: 10, parametros: [] },
    medidas: { comprimento: 38, largura: 28, altura: 177, ABA: 15 },
    papel: { gramatura: 222, precoKg: 7.74 },
    maquinaImpressao: {
      velocidade: 4233, custoHora: 550, formatoLargura: 720, formatoAltura: 1000,
      pinca: 10, setupMinutos: 30, acertoPorCorMin: 18, numCoresImpressao: 5, fatorOperacao: FATOR_IMPRESSAO,
    },
    cores: [
      { nome: 'Ciano', tipo: 'CMYK', coberturaPercent: 80, precoKg: 44, rendimentoM2Kg: 25, densidade: DENSIDADE_TINTA },
      { nome: 'Magenta', tipo: 'CMYK', coberturaPercent: 30, precoKg: 44, rendimentoM2Kg: 25, densidade: DENSIDADE_TINTA },
      { nome: 'Amarelo', tipo: 'CMYK', coberturaPercent: 30, precoKg: 44, rendimentoM2Kg: 25, densidade: DENSIDADE_TINTA },
      { nome: 'Preto', tipo: 'CMYK', coberturaPercent: 40, precoKg: 44, rendimentoM2Kg: 25, densidade: DENSIDADE_TINTA },
      { nome: 'Pantone 01', tipo: 'PANTONE', coberturaPercent: 5, precoKg: 71.5, rendimentoM2Kg: 25, densidade: DENSIDADE_TINTA },
    ],
    aproveitamentoManual: 21,
    coefTintaSuporte: 1.5,
    partidaConsumoTintaKg: 0.2,
    coberturaCmykAgregadaPercent: 60,
    acabamentos: [...acabamentosMaquina(), ...materiaisAcabamento()],
    quantidade: 100000,
    perdas: { impressaoPercent: PERDA_PERCENT, impressaoFixaFolhas: PERDA_FIXA_FOLHAS, corteVincoPercent: 0, colagemPercent: 0 },
    margem: { impostos: 0, comissao: 0, despAdm: 0, markup: 0 },
    // Matriz de impressão (495,00) entra no MD como item diverso fixo.
    itensDiversos: [{ descricao: 'Matriz de Impressão', valor: 495.0 }],
  }
}

describe('Golden 15.086 — confronto REAL por componente (motor puro)', () => {
  const r = calcularOrcamentoGrafico(params())
  const c = GOLDEN_15086.componentes

  it('SUPORTE (papel) ≤ 0,5% (5.160 folhas, 222 g/m²)', () => {
    confrontar(r.papel.custo, c.suporte.alvo, 'SUPORTE')
  })

  it('TINTA ≤ 0,5% (Escala 60% agregada + Pantone 5%, densidade calibrada)', () => {
    confrontar(r.tinta.custoTotal, c.tinta.alvo, 'TINTA')
  })

  it('MAT.ACABAMENTO ≤ 0,5% (Cola + Primer + UV + Caixa)', () => {
    expect(r.matAcabamento, 'matAcabamento deve existir').toBeDefined()
    confrontar(r.matAcabamento!.custoTotal, c.matAcabamento.alvo, 'MAT.ACABAMENTO')
  })

  it('IMPRESSÃO ≤ 0,5% (acerto 120min + operação fatorOperacao)', () => {
    confrontar(r.maquinas.custoTotal, c.impressao.alvo, 'IMPRESSÃO')
  })

  it('ACABAMENTO (centros) ≤ 0,5% (base folhas/tiragem por atividade)', () => {
    expect(r.acabamentosCentros, 'acabamentosCentros deve existir').toBeDefined()
    confrontar(r.acabamentosCentros!.custoTotal, c.acabamento.alvo, 'ACABAMENTO')
  })

  it('Custo de Transformação total ≤ 0,5% (impressão + acabamento)', () => {
    confrontar(r.custoTransformacao, GOLDEN_15086.totais.custoTransformacao, 'CT')
  })

  it('Material Direto total ≤ 0,5% (papel+tinta+mat.acab+matriz)', () => {
    confrontar(r.materialDireto, GOLDEN_15086.totais.materialDireto, 'MD')
  })

  it('Custo de Produção total ≤ 0,5% (MD + CT + Serviço Externo)', () => {
    confrontar(r.custoProducao, GOLDEN_15086.totais.custoProducao, 'C.Prod')
  })
})
