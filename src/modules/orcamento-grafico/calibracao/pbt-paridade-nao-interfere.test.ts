// Feature: orcamento-grafico-op-relatorio-paridade, Property 1: campos de paridade não interferem no custo — a soma de planos e a derivação de custos de fechamento dependem SOMENTE dos valores de custo, nunca de campos textuais/descritivos (nome, suporte, troca, descritivo).
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { somaPlanos, type FechamentoPlano } from '../plano-calculo.service'
import {
  derivarCustosPlano,
} from '../orcamento-grafico-relatorio.service'
import type { ResultadoOrcamento } from '../orcamento-grafico-calculo.service'

/**
 * PBT — Property 1 (Valida Req 1.5, 3.5, 16.5): CAMPOS DE PARIDADE NÃO
 * INTERFEREM NO CUSTO.
 *
 * As funções puras de fechamento (`somaPlanos`) e de derivação de custos
 * (`derivarCustosPlano`) dependem EXCLUSIVAMENTE dos campos numéricos de custo.
 * Nenhum campo textual/descritivo (nomes de suporte, rótulos de troca, descrição
 * de plano, ocorrências, etc.) deve alterar o resultado. Provamos isso gerando
 * dois conjuntos de planos IDÊNTICOS nos custos e exigindo soma igual, qualquer
 * que seja o restante dos campos.
 */

// Gerador de valores de custo não-negativos com 2 casas (domínio real).
const arbCusto = fc
  .integer({ min: 0, max: 10_000_00 })
  .map((cents) => cents / 100)

// Gerador de um FechamentoPlano cujos custos são determinados; os campos de
// granularidade fina (suporte/impressão/acabamento) variam livremente para
// provar que NÃO afetam a soma de MD/CT/SE.
const arbPlano = fc.record({
  sequencia: fc.integer({ min: 1, max: 1000 }),
  custoSuporte: arbCusto,
  custoImpressao: arbCusto,
  custoAcabamento: arbCusto,
  materialDireto: arbCusto,
  custoTransformacao: arbCusto,
  servicoExterno: arbCusto,
}) satisfies fc.Arbitrary<FechamentoPlano>

describe('PBT — Property 1: campos de paridade não interferem no custo', () => {
  it('somaPlanos depende só de MD/CT/SE — planos idênticos nos custos somam igual', () => {
    fc.assert(
      fc.property(fc.array(arbPlano, { minLength: 0, maxLength: 30 }), (planos) => {
        // Clona os planos preservando os custos, mas reescrevendo os campos
        // "textuais"/de granularidade (aqui numéricos, mas IGNORADOS pela soma).
        const clones: FechamentoPlano[] = planos.map((p, i) => ({
          ...p,
          sequencia: p.sequencia + 10_000 + i, // sequência diferente
          custoSuporte: p.custoSuporte + 123, // ignorado por somaPlanos
          custoImpressao: p.custoImpressao + 456, // ignorado por somaPlanos
          custoAcabamento: p.custoAcabamento + 789, // ignorado por somaPlanos
        }))
        const a = somaPlanos(planos)
        const b = somaPlanos(clones)
        expect(b.materialDireto).toBe(a.materialDireto)
        expect(b.custoTransformacao).toBe(a.custoTransformacao)
        expect(b.servicoExterno).toBe(a.servicoExterno)
      }),
      { numRuns: 200 },
    )
  })

  it('derivarCustosPlano depende só dos blocos de custo do ResultadoOrcamento', () => {
    fc.assert(
      fc.property(
        arbCusto, // papel.custo
        arbCusto, // maquinas.custoTotal
        arbCusto, // tinta.custoTotal
        arbCusto, // acabamentos.custoTotal
        arbCusto, // acabamentosCentros.custoTotal
        fc.string(), // campo textual arbitrário (não deve influir)
        (papel, maquinas, tinta, acab, acabCentros, textoQualquer) => {
          const base = {
            papel: { custo: papel },
            maquinas: { custoTotal: maquinas },
            tinta: { custoTotal: tinta },
            acabamentos: { custoTotal: acab },
            acabamentosCentros: { custoTotal: acabCentros },
          } as unknown as ResultadoOrcamento

          // Mesmo resultado com campos textuais extras injetados.
          const comTexto = {
            ...base,
            // @ts-expect-error — campo arbitrário irrelevante para a derivação
            nomeProdutoLivre: textoQualquer,
            // @ts-expect-error — idem
            descricao: textoQualquer,
          } as unknown as ResultadoOrcamento

          const r1 = derivarCustosPlano(base)
          const r2 = derivarCustosPlano(comTexto)
          expect(r2).toEqual(r1)

          // E os custos derivados batem com a regra documentada.
          const r2casas = (x: number) => Math.round(x * 100) / 100
          expect(r1.custoSuporte).toBe(r2casas(papel))
          expect(r1.custoImpressao).toBe(r2casas(maquinas + tinta))
          expect(r1.custoAcabamento).toBe(r2casas(acab + acabCentros))
        },
      ),
      { numRuns: 200 },
    )
  })
})
