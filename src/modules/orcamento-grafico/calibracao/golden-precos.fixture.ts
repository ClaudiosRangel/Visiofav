/**
 * Fixtures de calibração do preço do Orçamento Gráfico (Bloco 2).
 *
 * Casos REAIS do Calcgraf (backup Carton Wega), ANONIMIZADOS: mantêm só os
 * números necessários para validar a FÓRMULA DE PREÇO (custo-base, margem, CEV
 * → preço). Sem nome de cliente/produto. Fonte: cartoon/export/golden-orcamento.json
 * (ignorado pelo git); esta fixture é a versão versionável/segura.
 *
 * Relação confirmada (docs/calcgraf-calibracao-harness.md):
 *   custoBase(tiragem) = somaCustoFixo + somaCustoUnitario × tiragem
 *   preço = custoBase / (1 − margem%/100 − cev%/100)
 * O `cevPerc` aqui é o CEV efetivo por cálculo (resolvido dos dados reais), que
 * é constante entre as tiragens do mesmo cálculo.
 */

export interface GoldenTiragem {
  tiragem: number
  valorTotalVenda: number // ALVO (preço real do Calcgraf)
  margemPerc: number // AliqMargem aplicada
  contribMarginal: number // ValorContMarginal real
}

export interface GoldenCaso {
  num: number
  descricao: string
  somaCustoFixo: number // Σ CustoFixo dos agrupamentos positivos
  somaCustoUnitario: number // Σ CustoUnitario dos agrupamentos positivos
  cevPerc: number // CEV efetivo do cálculo (constante entre tiragens)
  tiragens: GoldenTiragem[]
  // Decomposição real (CalculoResAgrupamento, agrupamentos positivos):
  // 1=Custo de Transformação, 2=Materiais Diretos, 3=Serviços Externos.
  // custo(tiragem) = fixo + unitario × tiragem, por componente.
  componentes?: {
    custoTransformacao: { fixo: number; unitario: number } // agrup 1
    materiaisDiretos: { fixo: number; unitario: number } // agrup 2
    servicosExternos: { fixo: number; unitario: number } // agrup 3
  }
}

export const GOLDEN_PRECOS: GoldenCaso[] = [
  {
    num: 15168,
    descricao: 'Cartão, 3 tiragens',
    somaCustoFixo: 5199.72,
    somaCustoUnitario: 2.712713,
    cevPerc: 19.324,
    tiragens: [
      { tiragem: 10000, valorTotalVenda: 57000.0, margemPerc: 23.9625, contribMarginal: 19142.30 },
      { tiragem: 20000, valorTotalVenda: 104000.0, margemPerc: 23.5084, contribMarginal: 32709.46 },
      { tiragem: 40000, valorTotalVenda: 190000.0, margemPerc: 20.8258, contribMarginal: 53383.80 },
    ],
    componentes: {
      custoTransformacao: { fixo: 2706.61, unitario: 0.277707 },
      materiaisDiretos: { fixo: 2493.12, unitario: 2.435006 },
      servicosExternos: { fixo: 0, unitario: 0 },
    },
  },
  {
    num: 15182,
    descricao: 'Gerdau (golden do plano de ação), 1 tiragem',
    somaCustoFixo: 876.50,
    somaCustoUnitario: 1.414387,
    cevPerc: 18.300,
    tiragens: [
      { tiragem: 4000, valorTotalVenda: 17140.96, margemPerc: 43.581, contribMarginal: 8975.01 },
    ],
    componentes: {
      custoTransformacao: { fixo: 478.30, unitario: 0.256628 },
      materiaisDiretos: { fixo: 398.20, unitario: 1.157760 },
      servicosExternos: { fixo: 0, unitario: 0 },
    },
  },
  {
    num: 14879,
    descricao: 'Tiragens altas (575k/1,15M/2,3M)',
    somaCustoFixo: 5740.30,
    somaCustoUnitario: 0.168000,
    cevPerc: 16.65,
    tiragens: [
      { tiragem: 575000, valorTotalVenda: 161575.0, margemPerc: 20.0, contribMarginal: 47446.85 },
      { tiragem: 1150000, valorTotalVenda: 313950.0, margemPerc: 20.0, contribMarginal: 89705.40 },
      { tiragem: 2300000, valorTotalVenda: 618700.0, margemPerc: 20.0, contribMarginal: 174222.51 },
    ],
    componentes: {
      custoTransformacao: { fixo: 3348.30, unitario: 0.020493 },
      materiaisDiretos: { fixo: 2392.00, unitario: 0.147507 },
      servicosExternos: { fixo: 0, unitario: 0 },
    },
  },
  {
    num: 14878,
    descricao: 'Tiragens muito altas (1,8M/3,6M/7,25M)',
    somaCustoFixo: 35180.44,
    somaCustoUnitario: 0.294749,
    cevPerc: 16.75,
    tiragens: [
      { tiragem: 1800000, valorTotalVenda: 894600.0, margemPerc: 20.0, contribMarginal: 276334.77 },
      { tiragem: 3600000, valorTotalVenda: 1731600.0, margemPerc: 20.0, contribMarginal: 514536.23 },
      { tiragem: 7250000, valorTotalVenda: 3436500.0, margemPerc: 20.0, contribMarginal: 999085.87 },
    ],
    componentes: {
      custoTransformacao: { fixo: 26613.30, unitario: 0.039334 },
      materiaisDiretos: { fixo: 8567.14, unitario: 0.255415 },
      servicosExternos: { fixo: 0, unitario: 0 },
    },
  },
]
