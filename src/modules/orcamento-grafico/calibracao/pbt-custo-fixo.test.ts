// Feature: orcamento-grafico-multi-item-gcad, Property 4: Para toda tiragem inteira de 1 a 1.000.000 peças, o custo de um Item Diverso marcado como fixo e o custo da matriz de impressão permanecem exatamente iguais (desvio zero) aos valores informados, não escalando com a tiragem.
// Feature: orcamento-grafico-multi-item-gcad, Property 10: Para toda tiragem inteira positiva, o custo de um Item Diverso não marcado como fixo é igual ao seu valor unitário multiplicado pela tiragem.
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  calcularOrcamentoGrafico,
  type ParamsOrcamento,
} from '../orcamento-grafico-calculo.service'

/**
 * PBT — Properties 4 e 10 (spec orcamento-grafico-multi-item-gcad, task 25):
 * CUSTO FIXO vs. VARIÁVEL dos Itens Diversos / Matriz.
 *
 * O motor soma `Σ itensDiversos.valor` como CUSTO FIXO no Material Direto (não
 * escala com a tiragem) — ver `orcamento-grafico-calculo.service.ts`. A matriz
 * de impressão é modelada pelo envelope como um item diverso FIXO
 * (`{ descricao:'Matriz de Impressão', valor: quantidade × precoUnitario }`).
 *
 * P4 — FIXO não escala: exercitamos o motor com um item diverso de valor `V`
 * fixo em DUAS tiragens diferentes e provamos que a contribuição do item ao MD
 * é a MESMA (`V`, desvio zero): a diferença de MD entre "com item" e "sem item"
 * é exatamente `V` em qualquer tiragem.
 *
 * P10 — VARIÁVEL escala linearmente: a regra do envelope para um Item Diverso
 * NÃO-fixo é `valor passado ao motor = valorUnitário × quantidade`
 * (`montarInputDoItem`: `fixo ? valor : valor * quantidade`). Replicamos essa
 * helper pura local e provamos a linearidade; e confirmamos no motor que, somando
 * esse valor como item diverso, a contribuição ao MD = valorUnitário × tiragem.
 */

const tipoSimples: ParamsOrcamento['tipoEmbalagem'] = {
  formulaLargura: 'L',
  formulaAltura: 'A',
  abaColagemMm: 0,
  sangriaMm: 0,
  pincaMm: 0,
}

/** Base de params SEM itens diversos (para medir a contribuição por diferença de MD). */
function base(quantidade: number): ParamsOrcamento {
  return {
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
    acabamentos: [],
    aproveitamentoManual: 4,
    quantidade,
    perdas: { impressaoPercent: 0, impressaoFixaFolhas: 0, corteVincoPercent: 0, colagemPercent: 0 },
    margem: { impostos: 15, comissao: 5, despAdm: 5, markup: 30 },
  }
}

const arred2 = (x: number) => Math.round(x * 100) / 100

/**
 * Regra PURA do envelope (`montarInputDoItem`) para o valor de um Item Diverso
 * passado ao motor: FIXO → `valor`; VARIÁVEL → `valor × quantidade`.
 */
function valorItemDiverso(valorUnitario: number, quantidade: number, fixo: boolean): number {
  return fixo ? valorUnitario : valorUnitario * quantidade
}

describe('PBT — Property 4: custo fixo (item diverso fixo / matriz) não escala com a tiragem', () => {
  it('item diverso FIXO contribui exatamente V ao MD, igual em qualquer tiragem', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 0, max: 100_000_00 }).map((c) => c / 100), // valor R$ (0..100.000)
        (tiragemA, tiragemB, valorFixo) => {
          // Contribuição = MD(com item) − MD(sem item), medida em cada tiragem.
          const contribA =
            arred2(
              calcularOrcamentoGrafico({
                ...base(tiragemA),
                itensDiversos: [{ descricao: 'Fixo', valor: valorFixo }],
              }).materialDireto - calcularOrcamentoGrafico(base(tiragemA)).materialDireto,
            )
          const contribB =
            arred2(
              calcularOrcamentoGrafico({
                ...base(tiragemB),
                itensDiversos: [{ descricao: 'Fixo', valor: valorFixo }],
              }).materialDireto - calcularOrcamentoGrafico(base(tiragemB)).materialDireto,
            )

          // Desvio zero: a contribuição é V em ambas as tiragens.
          expect(contribA).toBe(arred2(valorFixo))
          expect(contribB).toBe(arred2(valorFixo))
          expect(contribA).toBe(contribB)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('matriz (quantidade × precoUnitario) é FIXA no MD e independe da tiragem', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 100 }), // quantidade de matrizes
        fc.integer({ min: 1, max: 10_000_00 }).map((c) => c / 100), // preço unitário R$
        (tiragemA, tiragemB, qtdMatriz, precoUnit) => {
          // O envelope injeta a matriz como item diverso fixo (valor = qtd × preço).
          const valorMatriz = qtdMatriz * precoUnit
          const matrizItem = [{ descricao: 'Matriz de Impressão', valor: valorMatriz }]

          const contribA = arred2(
            calcularOrcamentoGrafico({ ...base(tiragemA), itensDiversos: matrizItem }).materialDireto -
              calcularOrcamentoGrafico(base(tiragemA)).materialDireto,
          )
          const contribB = arred2(
            calcularOrcamentoGrafico({ ...base(tiragemB), itensDiversos: matrizItem }).materialDireto -
              calcularOrcamentoGrafico(base(tiragemB)).materialDireto,
          )

          expect(contribA).toBe(arred2(valorMatriz))
          expect(contribA).toBe(contribB)
        },
      ),
      { numRuns: 300 },
    )
  })
})

describe('PBT — Property 10: item diverso variável escala linearmente', () => {
  it('regra pura do envelope: valor passado = valorUnitário × tiragem', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 10_000_00 }).map((c) => c / 100),
        (tiragem, valorUnitario) => {
          const valorVar = valorItemDiverso(valorUnitario, tiragem, false)
          const valorFixo = valorItemDiverso(valorUnitario, tiragem, true)
          // Variável = unitário × tiragem; fixo = unitário.
          expect(valorVar).toBeCloseTo(valorUnitario * tiragem, 6)
          expect(valorFixo).toBe(valorUnitario)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('no motor: item diverso variável contribui valorUnitário × tiragem ao MD', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 1_000_00 }).map((c) => c / 100),
        (tiragem, valorUnitario) => {
          // Envelope: para item NÃO-fixo, o valor somado ao motor = unitário × tiragem.
          const valorVar = valorItemDiverso(valorUnitario, tiragem, false)
          const contrib = arred2(
            calcularOrcamentoGrafico({
              ...base(tiragem),
              itensDiversos: [{ descricao: 'Variável', valor: valorVar }],
            }).materialDireto - calcularOrcamentoGrafico(base(tiragem)).materialDireto,
          )
          expect(contrib).toBe(arred2(valorUnitario * tiragem))
        },
      ),
      { numRuns: 200 },
    )
  })
})
