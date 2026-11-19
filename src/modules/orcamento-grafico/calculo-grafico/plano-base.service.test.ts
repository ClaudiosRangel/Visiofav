import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  montarPlanoBase,
  planoBaseParaGravar,
  resolverSigla,
  NOME_PLANO_BASE,
  SIGLA_VARIOS,
} from './plano-base.service'

const NUM_RUNS = 100
const sigla = fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0)

// Feature: orcamento-grafico-paridade-fluxo-legado, Property 9: regra da sigla
// **Validates: Requirements 4.9, 6.9, 6.10**
describe('resolverSigla — Property 9', () => {
  it('"(vários)" com mais de uma sigla distinta; a própria sigla com exatamente uma; null sem siglas', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(sigla, fc.constant(null), fc.constant('   ')), { maxLength: 10 }),
        (lista) => {
          const distintas = new Set(
            lista.filter((s): s is string => !!s && s.trim().length > 0).map((s) => s.trim()),
          )
          const r = resolverSigla(lista)
          if (distintas.size === 0) expect(r).toBeNull()
          else if (distintas.size === 1) expect(r).toBe([...distintas][0])
          else expect(r).toBe(SIGLA_VARIOS)
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })

  it('repetir a mesma sigla não vira "(vários)"', () => {
    expect(resolverSigla(['AB', 'AB', ' AB '])).toBe('AB')
    expect(resolverSigla(['AB', 'CD'])).toBe('(vários)')
  })
})

// Feature: orcamento-grafico-paridade-fluxo-legado, Property 12 (parte pura): Plano_Base fiel, vazio onde falta
// **Validates: Requirements 8.1, 8.2, 8.5**
describe('montarPlanoBase — Property 12 (parte pura)', () => {
  it('cálculo e Foto vazios → tudo null/vazio, sem default nem zero', () => {
    for (const foto of [null, undefined, {}]) {
      const p = montarPlanoBase({}, foto as never)
      expect(p).toEqual({
        nome: NOME_PLANO_BASE,
        suporte: null,
        formatoCorte: null,
        cores: [],
        coberturaTinta: null,
        atividades: [],
        custoPlano: null,
      })
    }
  })

  it('campos presentes são copiados e ausentes ficam null/vazios (cada campo independente)', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string({ minLength: 1, maxLength: 15 }).filter((s) => s.trim() === s && s.length > 0), { nil: undefined }),
        fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
        fc.option(fc.tuple(fc.integer({ min: 1, max: 2000 }), fc.integer({ min: 1, max: 2000 })), { nil: undefined }),
        fc.array(fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim() === s && s.length > 0), { maxLength: 4 }),
        fc.array(fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim() === s && s.length > 0), { maxLength: 4 }),
        (papel, gram, fmt, nomesCores, nomesAtiv) => {
          const p = montarPlanoBase(
            {
              papelDescricao: papel,
              gramatura: gram,
              formatoCorteLarguraMm: fmt?.[0],
              formatoCorteAlturaMm: fmt?.[1],
              cores: nomesCores.map((nome) => ({ nome, coberturaPercent: 50 })),
              acabamentosRicos: nomesAtiv.map((nome) => ({ nome })),
            },
            null,
          )
          if (papel === undefined && gram === undefined) expect(p.suporte).toBeNull()
          else expect(p.suporte).toEqual({ nome: papel ?? null, gramatura: gram ?? null })

          if (fmt === undefined) expect(p.formatoCorte).toBeNull()
          else expect(p.formatoCorte).toEqual({ larguraMm: fmt[0], alturaMm: fmt[1] })

          expect(p.cores.map((c) => c.nome)).toEqual(nomesCores)
          expect(p.coberturaTinta).toBe(nomesCores.length > 0 ? 50 : null)
          expect(p.atividades).toEqual(nomesAtiv)
          expect(p.custoPlano).toBeNull()
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })

  it('custoPlano vem da Foto com 2 casas; cobertura divergente entre cores fica null', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1e7, noNaN: true }), (custo) => {
        const p = montarPlanoBase({}, { custos: { custoProducao: custo } } as never)
        expect(p.custoPlano).toBe(Math.round((custo + Number.EPSILON) * 100) / 100)
      }),
      { numRuns: NUM_RUNS },
    )
    const p = montarPlanoBase(
      { cores: [{ nome: 'A', coberturaPercent: 10 }, { nome: 'B', coberturaPercent: 20 }] },
      null,
    )
    expect(p.coberturaTinta).toBeNull()
  })

  it('planoBaseParaGravar marca somenteExibicao e deixa resultado/custos nulos', () => {
    const g = planoBaseParaGravar(montarPlanoBase({ papelDescricao: 'X' }, null))
    expect(g.especificacao.somenteExibicao).toBe(true)
    expect(g.especificacao.base).toBe(true)
    expect(g.resultadoCalculo).toBeNull()
    expect(g.custoSuporte).toBeNull()
    expect(g.custoImpressao).toBeNull()
    expect(g.custoAcabamento).toBeNull()
  })
})
