// Feature: orcamento-grafico-multi-item-gcad, Property 9: Para toda máquina de impressão selecionada, o Custo de Transformação da impressão é calculado com o acerto-por-cor e o custo-hora da máquina selecionada; e para toda restrição de acabamento selecionada, o Custo de Transformação da atividade usa o tempo de acerto e o tempo de operação da restrição (sobrepondo os padrão da atividade).
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  calcularOrcamentoGrafico,
  type ParamsOrcamento,
  type ItemAcabamentoRico,
} from '../orcamento-grafico-calculo.service'

/**
 * PBT — Property 9 (spec orcamento-grafico-multi-item-gcad, task 25): CUSTO DE
 * TRANSFORMAÇÃO SENSÍVEL À MÁQUINA E À RESTRIÇÃO.
 *
 * NOTA DE DESIGN: no envelope real, o seletor de máquina popula
 * `maquinaImpressao.{custoHora, acertoPorCorMin}` e a restrição sobrepõe os
 * tempos do acabamento rico HORA_MAQUINA (design §4.2/§4.3). Como este é um teste
 * PURO (sem banco), exercitamos o MOTOR com os mesmos campos que o envelope
 * injeta.
 *
 * (a) MÁQUINA — o CT da impressão responde a `custoHora` e `acertoPorCorMin`:
 *     dobrar o `custoHora` (mantendo o resto) dobra o CT da impressão
 *     (`resultado.maquinas.custoTotal`); e aumentar o `acertoPorCorMin` aumenta
 *     estritamente o CT (mais tempo de acerto por cor).
 * (b) RESTRIÇÃO — para um acabamento rico HORA_MAQUINA no MODO DIRETO (tempos em
 *     horas), o custo do centro = (tempoFixoHoras + tempoVarHoras) × custoHora
 *     (fórmula de `custo-transformacao.ts`). A "restrição" fornece
 *     tempoAcerto/tempoOperacao (min); derivamos tempoFixoHoras = tempoAcerto/60
 *     e tempoVarHoras = tempoOperacao/60 — como o envelope faz — e provamos que o
 *     CT daquele acabamento = (tempoFixoHoras + tempoVarHoras) × custoHora.
 */

const tipoSimples: ParamsOrcamento['tipoEmbalagem'] = {
  formulaLargura: 'L',
  formulaAltura: 'A',
  abaColagemMm: 0,
  sangriaMm: 0,
  pincaMm: 0,
}

const arred2 = (x: number) => Math.round(x * 100) / 100

/** Base com impressão CALIBRADA (acerto por cor) — o CT da impressão usa a máquina. */
function baseImpressao(custoHora: number, acertoPorCorMin: number, numCores: number): ParamsOrcamento {
  const cores = Array.from({ length: numCores }, (_, i) => ({
    nome: `Cor ${i + 1}`,
    tipo: 'CMYK' as const,
    coberturaPercent: 50,
    precoKg: 50,
    rendimentoM2Kg: 10000,
  }))
  return {
    tipoEmbalagem: tipoSimples,
    medidas: { L: 100, A: 150 },
    papel: { gramatura: 250, precoKg: 8 },
    maquinaImpressao: {
      velocidade: 6000,
      custoHora,
      formatoLargura: 660,
      formatoAltura: 960,
      pinca: 10,
      setupMinutos: 0,
      acertoPorCorMin, // > 0 ativa o modelo CALIBRADO (CT por acerto-por-cor)
      numCoresImpressao: numCores,
    },
    cores,
    acabamentos: [],
    aproveitamentoManual: 4,
    quantidade: 10000,
    perdas: { impressaoPercent: 0, impressaoFixaFolhas: 0, corteVincoPercent: 0, colagemPercent: 0 },
    margem: { impostos: 15, comissao: 5, despAdm: 5, markup: 30 },
  }
}

describe('PBT — Property 9 (máquina): CT da impressão usa custoHora e acertoPorCorMin', () => {
  it('dobrar o custoHora da máquina dobra o CT da impressão', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 50, max: 1000 }), // custoHora
        fc.integer({ min: 1, max: 90 }), // acertoPorCorMin
        fc.integer({ min: 1, max: 6 }), // nº de cores
        (custoHora, acerto, numCores) => {
          const r1 = calcularOrcamentoGrafico(baseImpressao(custoHora, acerto, numCores))
          const r2 = calcularOrcamentoGrafico(baseImpressao(custoHora * 2, acerto, numCores))
          // CT da impressão é linear no custoHora → dobra (±0,02 de arredondamento).
          expect(Math.abs(r2.maquinas.custoTotal - 2 * r1.maquinas.custoTotal)).toBeLessThanOrEqual(0.02)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('aumentar o acertoPorCorMin aumenta estritamente o CT da impressão', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 50, max: 1000 }),
        fc.integer({ min: 1, max: 60 }), // acerto base
        fc.integer({ min: 1, max: 60 }), // incremento
        fc.integer({ min: 1, max: 6 }),
        (custoHora, acerto, delta, numCores) => {
          const rMenor = calcularOrcamentoGrafico(baseImpressao(custoHora, acerto, numCores))
          const rMaior = calcularOrcamentoGrafico(baseImpressao(custoHora, acerto + delta, numCores))
          // Mais tempo de acerto por cor → mais tempo fixo → CT maior.
          expect(rMaior.maquinas.custoTotal).toBeGreaterThan(rMenor.maquinas.custoTotal)
        },
      ),
      { numRuns: 300 },
    )
  })
})

describe('PBT — Property 9 (restrição): CT do acabamento usa tempos da restrição', () => {
  it('acabamento HORA_MAQUINA modo direto: CT = (tempoAcerto/60 + tempoOperacao/60) × custoHora', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999 }), // tempoAcertoMin da restrição
        fc.integer({ min: 0, max: 999 }), // tempoOperacaoMin da restrição
        fc.integer({ min: 50, max: 1000 }), // custoHora do centro
        (tempoAcertoMin, tempoOperacaoMin, custoHora) => {
          // Derivação do envelope: tempoFixoHoras = acerto/60; tempoVarHoras = operação/60.
          const tempoFixoHoras = tempoAcertoMin / 60
          const tempoVarHoras = tempoOperacaoMin / 60

          const acab: ItemAcabamentoRico[] = [
            {
              naturezaCusto: 'HORA_MAQUINA',
              nome: 'Coladeira (restrição)',
              custoHora,
              tempoFixoHoras,
              tempoVarHoras,
            },
          ]

          // Base sem impressão calibrada (modelo legado de impressão). Medimos a
          // contribuição do centro de acabamento por diferença no CT.
          const comAcab: ParamsOrcamento = {
            tipoEmbalagem: tipoSimples,
            medidas: { L: 100, A: 150 },
            papel: { gramatura: 250, precoKg: 8 },
            maquinaImpressao: {
              velocidade: 6000,
              custoHora: 250,
              formatoLargura: 660,
              formatoAltura: 960,
              pinca: 10,
              setupMinutos: 10,
            },
            cores: [
              { nome: 'Preto', tipo: 'CMYK', coberturaPercent: 50, precoKg: 50, rendimentoM2Kg: 10000 },
            ],
            acabamentos: acab,
            aproveitamentoManual: 4,
            quantidade: 10000,
            perdas: { impressaoPercent: 0, impressaoFixaFolhas: 0, corteVincoPercent: 0, colagemPercent: 0 },
            margem: { impostos: 15, comissao: 5, despAdm: 5, markup: 30 },
          }
          const semAcab: ParamsOrcamento = { ...comAcab, acabamentos: [] }

          const r = calcularOrcamentoGrafico(comAcab)
          const r0 = calcularOrcamentoGrafico(semAcab)

          const esperado = arred2((tempoFixoHoras + tempoVarHoras) * custoHora)
          // O centro de acabamento aparece em `acabamentosCentros.custoTotal` e
          // compõe o Custo de Transformação.
          expect(r.acabamentosCentros?.custoTotal ?? 0).toBeCloseTo(esperado, 2)
          // A diferença de CT entre com/sem o acabamento = o custo do centro.
          expect(Math.abs((r.custoTransformacao - r0.custoTransformacao) - esperado)).toBeLessThanOrEqual(0.02)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('restrição com maior tempo de operação → maior CT do acabamento (sobreposição responde)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500 }), // operação base (min)
        fc.integer({ min: 1, max: 499 }), // incremento
        fc.integer({ min: 0, max: 500 }), // acerto (min)
        fc.integer({ min: 50, max: 1000 }), // custoHora
        (operBase, delta, acertoMin, custoHora) => {
          const mk = (operMin: number): ItemAcabamentoRico[] => [
            {
              naturezaCusto: 'HORA_MAQUINA',
              nome: 'Coladeira',
              custoHora,
              tempoFixoHoras: acertoMin / 60,
              tempoVarHoras: operMin / 60,
            },
          ]
          const common: ParamsOrcamento = {
            tipoEmbalagem: tipoSimples,
            medidas: { L: 100, A: 150 },
            papel: { gramatura: 250, precoKg: 8 },
            maquinaImpressao: { velocidade: 6000, custoHora: 250, formatoLargura: 660, formatoAltura: 960, pinca: 10, setupMinutos: 10 },
            cores: [{ nome: 'Preto', tipo: 'CMYK', coberturaPercent: 50, precoKg: 50, rendimentoM2Kg: 10000 }],
            acabamentos: [],
            aproveitamentoManual: 4,
            quantidade: 10000,
            perdas: { impressaoPercent: 0, impressaoFixaFolhas: 0, corteVincoPercent: 0, colagemPercent: 0 },
            margem: { impostos: 15, comissao: 5, despAdm: 5, markup: 30 },
          }
          const rMenor = calcularOrcamentoGrafico({ ...common, acabamentos: mk(operBase) })
          const rMaior = calcularOrcamentoGrafico({ ...common, acabamentos: mk(operBase + delta) })
          expect(rMaior.acabamentosCentros!.custoTotal).toBeGreaterThan(rMenor.acabamentosCentros!.custoTotal)
        },
      ),
      { numRuns: 300 },
    )
  })
})
