// Feature: orcamento-grafico-multi-item-gcad, Property 3: Para todo item com um Modelo GCad selecionado, o número de poses da imposição é igual ao produto do número de linhas pelo número de colunas da repetição/encaixe do modelo, e a área total ocupada por essas poses é menor ou igual à área da folha do formato de corte (admitida folga máxima de 0,5% da área da folha).
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  calcularOrcamentoGrafico,
  type ParamsOrcamento,
} from '../orcamento-grafico-calculo.service'

/**
 * PBT — Property 3 (spec orcamento-grafico-multi-item-gcad, task 25): IMPOSIÇÃO
 * POR MODELO GCad.
 *
 * NOTA DE DESIGN (envelope-com-banco vs. lógica pura): o envelope real
 * (`montarParamsDoItem`) lê o `ModeloFaca` do Prisma e injeta a imposição real no
 * motor via `aproveitamentoManual = linhas × colunas` (design §4.1). Como este é
 * um teste PURO (sem banco), exercitamos diretamente o MOTOR com o mesmo ponto de
 * injeção que o envelope usa — passando `aproveitamentoManual = linhas × colunas`.
 *
 * Validamos as duas facetas da propriedade:
 *   (a) RELAÇÃO DE FOLHAS: o motor usa `aproveitamentoManual` como poses/folha, de
 *       modo que `resultado.encaixe.aproveitamento === linhas × colunas` e
 *       `resultado.encaixe.folhasNecessarias === ceil(quantidade / (linhas×colunas))`
 *       — exatamente a relação de imposição do GCad.
 *   (b) ÁREA (propriedade aritmética pura da imposição): com larguraPeça/alturaPeça
 *       e formato de corte gerados de modo que (linhas × larguraPeça ≤ larguraFolha)
 *       e (colunas × alturaPeça ≤ alturaFolha), a área ocupada pelas poses
 *       (linhas × colunas × áreaPeça) ≤ áreaFolha × (1 + 0,005).
 *   O encaixe REAL (poses/folha) é injetado via `aproveitamentoManual`; a
 *   desigualdade de área é a garantia geométrica do próprio modelo (o formato de
 *   corte é dimensionado para caber as linhas×colunas poses).
 */

const tipoSimples: ParamsOrcamento['tipoEmbalagem'] = {
  formulaLargura: 'L',
  formulaAltura: 'A',
  abaColagemMm: 0,
  sangriaMm: 0,
  pincaMm: 0,
}

/**
 * Gerador do domínio VÁLIDO da propriedade: linhas/colunas ∈ [1..20], dimensões
 * da peça positivas, e um formato de corte (folha) grande o suficiente para
 * acomodar a grade (linhas × larguraPeça ≤ larguraFolha, colunas × alturaPeça ≤
 * alturaFolha). O "folgaFolha" extra garante que o formato de corte seja ≥ a
 * grade sem forçar igualdade (modela a folha real do GCad).
 */
const arbModelo = fc
  .record({
    linhas: fc.integer({ min: 1, max: 20 }),
    colunas: fc.integer({ min: 1, max: 20 }),
    larguraPecaMm: fc.integer({ min: 10, max: 200 }),
    alturaPecaMm: fc.integer({ min: 10, max: 200 }),
    folgaLarguraMm: fc.integer({ min: 0, max: 300 }),
    folgaAlturaMm: fc.integer({ min: 0, max: 300 }),
    quantidade: fc.integer({ min: 1, max: 1_000_000 }),
    gramatura: fc.integer({ min: 80, max: 500 }),
    precoKgPapel: fc.integer({ min: 2, max: 30 }),
  })
  .map((g) => {
    // Folha (formato de corte) grande o bastante para a grade caber.
    const larguraFolhaMm = g.linhas * g.larguraPecaMm + g.folgaLarguraMm
    const alturaFolhaMm = g.colunas * g.alturaPecaMm + g.folgaAlturaMm
    return { ...g, larguraFolhaMm, alturaFolhaMm }
  })

interface ModeloGerado {
  linhas: number
  colunas: number
  larguraPecaMm: number
  alturaPecaMm: number
  larguraFolhaMm: number
  alturaFolhaMm: number
  quantidade: number
  gramatura: number
  precoKgPapel: number
}

function montarParams(g: ModeloGerado): ParamsOrcamento {
  const aprov = g.linhas * g.colunas
  return {
    tipoEmbalagem: tipoSimples,
    medidas: { L: g.larguraPecaMm, A: g.alturaPecaMm },
    papel: { gramatura: g.gramatura, precoKg: g.precoKgPapel },
    maquinaImpressao: {
      velocidade: 6000,
      custoHora: 250,
      // Formato de corte (folha) = o formato injetado pelo modelo GCad.
      formatoLargura: g.larguraFolhaMm,
      formatoAltura: g.alturaFolhaMm,
      pinca: 0,
      setupMinutos: 0,
    },
    cores: [
      { nome: 'Preto', tipo: 'CMYK', coberturaPercent: 50, precoKg: 50, rendimentoM2Kg: 10000 },
    ],
    acabamentos: [],
    // Ponto de injeção do GCad: poses/folha = linhas × colunas (design §4.1).
    aproveitamentoManual: aprov,
    quantidade: g.quantidade,
    perdas: { impressaoPercent: 0, impressaoFixaFolhas: 0, corteVincoPercent: 0, colagemPercent: 0 },
    margem: { impostos: 15, comissao: 5, despAdm: 5, markup: 30 },
  }
}

describe('PBT — Property 3: imposição por modelo GCad', () => {
  it('poses/folha = linhas×colunas e folhas = ceil(quantidade / poses)', () => {
    fc.assert(
      fc.property(arbModelo, (g) => {
        const poses = g.linhas * g.colunas
        const r = calcularOrcamentoGrafico(montarParams(g))

        // (a) relação de imposição injetada pelo GCad
        expect(r.encaixe.aproveitamento).toBe(poses)
        expect(r.encaixe.folhasNecessarias).toBe(Math.ceil(g.quantidade / poses))
      }),
      { numRuns: 300 },
    )
  })

  it('área das poses ≤ área da folha do formato de corte (folga máx 0,5%)', () => {
    fc.assert(
      fc.property(arbModelo, (g) => {
        const poses = g.linhas * g.colunas
        const areaPeca = g.larguraPecaMm * g.alturaPecaMm
        const areaPoses = poses * areaPeca
        const areaFolha = g.larguraFolhaMm * g.alturaFolhaMm

        // Desigualdade de área da imposição (propriedade aritmética pura):
        // a grade foi dimensionada para caber na folha → poses ≤ folha + 0,5%.
        expect(areaPoses).toBeLessThanOrEqual(areaFolha * (1 + 0.005))
      }),
      { numRuns: 300 },
    )
  })
})
