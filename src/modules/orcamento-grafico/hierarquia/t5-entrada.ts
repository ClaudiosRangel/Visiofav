/**
 * Entrada SINTÉTICA do item T5 (multi-plano) do baseline de custo da reforma
 * "hierarquia Orçamento → Item → Plano" (tarefa 1.1).
 *
 * Dois planos independentes (ex.: TAMPA e CAIXA), cada um calculado pelo motor
 * atual (`calcularPlano`) por tiragem; o item soma os planos com `somaPlanos`
 * e forma o preço com `formarPrecoVenda`. Nenhum arquivo de produção é tocado:
 * este módulo só monta entradas para o motor existente.
 */
import type { ParamsOrcamento } from '../orcamento-grafico-calculo.service'

export const TIRAGENS_T5 = [1000, 3000, 5000] as const

export const MARGEM_T5 = { impostos: 9.25, comissao: 3, despAdm: 2, markup: 30 } as const

const tipoNeutro = {
  formulaLargura: 'L',
  formulaAltura: 'A',
  abaColagemMm: 0,
  sangriaMm: 0,
  pincaMm: 0,
}

export function paramsPlano1(quantidade: number): ParamsOrcamento {
  return {
    tipoEmbalagem: tipoNeutro,
    medidas: { L: 200, A: 300 },
    papel: { gramatura: 300, precoKg: 7.45 },
    maquinaImpressao: {
      velocidade: 4000, custoHora: 440, formatoLargura: 700, formatoAltura: 1000,
      pinca: 10, setupMinutos: 30,
    },
    cores: [
      { nome: 'Cyan', tipo: 'CMYK', coberturaPercent: 40, precoKg: 71.5, rendimentoM2Kg: 25 },
      { nome: 'Magenta', tipo: 'CMYK', coberturaPercent: 40, precoKg: 71.5, rendimentoM2Kg: 25 },
      { nome: 'Yellow', tipo: 'CMYK', coberturaPercent: 40, precoKg: 71.5, rendimentoM2Kg: 25 },
      { nome: 'Black', tipo: 'CMYK', coberturaPercent: 40, precoKg: 71.5, rendimentoM2Kg: 25 },
    ],
    aproveitamentoManual: 6,
    acabamentos: [
      { naturezaCusto: 'HORA_MAQUINA', nome: 'Cortadeira (Grande)', custoHora: 113.21, tempoFixoHoras: 0.25, tempoVarHoras: 0.5 },
    ],
    quantidade,
    perdas: { impressaoPercent: 3, impressaoFixaFolhas: 100, corteVincoPercent: 2, colagemPercent: 1 },
    margem: { ...MARGEM_T5 },
  }
}

export function paramsPlano2(quantidade: number): ParamsOrcamento {
  return {
    tipoEmbalagem: tipoNeutro,
    medidas: { L: 120, A: 180 },
    papel: { gramatura: 250, precoKg: 6.83 },
    maquinaImpressao: {
      velocidade: 3000, custoHora: 140, formatoLargura: 650, formatoAltura: 900,
      pinca: 10, setupMinutos: 20,
    },
    cores: [
      { nome: 'Pantone 01', tipo: 'PANTONE', coberturaPercent: 60, precoKg: 170.5, rendimentoM2Kg: 25 },
    ],
    aproveitamentoManual: 12,
    acabamentos: [
      { naturezaCusto: 'HORA_MAQUINA', nome: 'Guilhotina', custoHora: 77.69, tempoFixoHoras: 0, tempoVarHoras: 0.4 },
      { naturezaCusto: 'MATERIAL_UN', nome: 'Material de apoio', variavelUn: 2, precoUn: 15 },
    ],
    quantidade,
    perdas: { impressaoPercent: 3, impressaoFixaFolhas: 50, corteVincoPercent: 2, colagemPercent: 1 },
    margem: { ...MARGEM_T5 },
  }
}
