import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  aplicarDecisaoVinculo,
  codigoEmbalagemDe,
  decidirVinculo,
  type TipoEmbalagemCandidato,
} from './vinculo-embalagem'

const NUM_RUNS = 100

const tipo = (id: string, n: number): TipoEmbalagemCandidato => ({ id, codigo: codigoEmbalagemDe(n) })

describe('decidirVinculo (exemplos)', () => {
  it('preenche vazio com exatamente 1 candidato por CG-EMB-<n>', () => {
    const d = decidirVinculo({ codigoOrigemProduto: 3, tipoEmbalagemIdAtual: null, tipos: [tipo('a', 3), tipo('b', 4)] })
    expect(d).toEqual({ acao: 'PREENCHER', tipoEmbalagemId: 'a' })
  })

  it('o mesmo tipo achado por codigoOrigem e por código conta uma vez', () => {
    const d = decidirVinculo({
      codigoOrigemProduto: 3,
      tipoEmbalagemIdAtual: '',
      tipos: [{ id: 'a', codigo: 'CG-EMB-3', codigoOrigem: 3 }],
    })
    expect(d).toEqual({ acao: 'PREENCHER', tipoEmbalagemId: 'a' })
  })

  it('vínculo preenchido nunca muda', () => {
    expect(decidirVinculo({ codigoOrigemProduto: 3, tipoEmbalagemIdAtual: 'x', tipos: [tipo('a', 3)] })).toEqual({ acao: 'MANTER' })
  })

  it('sem código de origem, sem candidato e mais de um viram não casados com motivo', () => {
    expect(decidirVinculo({ codigoOrigemProduto: null, tipoEmbalagemIdAtual: null, tipos: [tipo('a', 3)] })).toMatchObject({
      acao: 'NAO_CASADO',
      motivo: 'SEM_INFORMACAO',
    })
    expect(decidirVinculo({ codigoOrigemProduto: 9, tipoEmbalagemIdAtual: null, tipos: [tipo('a', 3)] })).toMatchObject({
      acao: 'NAO_CASADO',
      motivo: 'NENHUM_CANDIDATO',
    })
    expect(
      decidirVinculo({
        codigoOrigemProduto: 3,
        tipoEmbalagemIdAtual: null,
        tipos: [tipo('a', 3), { id: 'b', codigo: 'OUTRO', codigoOrigem: 3 }],
      }),
    ).toMatchObject({ acao: 'NAO_CASADO', motivo: 'MAIS_DE_UM' })
  })
})

describe('Property 3: importação do vínculo é idempotente e nunca sobrescreve', () => {
  // Feature: orcamento-grafico-fase3-produto-embalagem, Property 3: Importação do vínculo é idempotente e nunca sobrescreve
  const tiposArb = fc.uniqueArray(
    fc.record({
      id: fc.uuid(),
      n: fc.integer({ min: 1, max: 6 }),
      comOrigem: fc.boolean(),
      sufixo: fc.integer({ min: 0, max: 3 }),
    }),
    { selector: (t) => t.id, maxLength: 8 },
  ).map((lista) =>
    lista.map<TipoEmbalagemCandidato>((t, i) => ({
      id: t.id,
      // Só `sufixo === 0` segue a convenção CG-EMB-<n>; os demais têm código sem relação com o produto.
      codigo: t.sufixo === 0 ? codigoEmbalagemDe(t.n) : `TIPO-${i}`,
      codigoOrigem: t.comOrigem ? t.n : null,
    })),
  )
  const atualArb = fc.oneof(fc.constant(null), fc.constant(undefined), fc.constant(''), fc.uuid())
  const origemArb = fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 6 }))

  it('vínculo preenchido nunca muda', () => {
    fc.assert(
      fc.property(fc.uuid(), origemArb, tiposArb, (atual, origem, tipos) => {
        const d = decidirVinculo({ codigoOrigemProduto: origem, tipoEmbalagemIdAtual: atual, tipos })
        expect(d).toEqual({ acao: 'MANTER' })
        expect(aplicarDecisaoVinculo(atual, d)).toBe(atual)
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('vazio: preenche só com exatamente 1 candidato; 0 ou 2+ vão ao relatório com o motivo certo', () => {
    fc.assert(
      fc.property(atualArb.filter((a) => !a), origemArb, tiposArb, (atual, origem, tipos) => {
        const d = decidirVinculo({ codigoOrigemProduto: origem, tipoEmbalagemIdAtual: atual, tipos })
        if (origem === null) {
          expect(d).toMatchObject({ acao: 'NAO_CASADO', motivo: 'SEM_INFORMACAO' })
          return
        }
        const candidatos = tipos.filter((t) => t.codigoOrigem === origem || t.codigo === codigoEmbalagemDe(origem))
        if (candidatos.length === 1) expect(d).toEqual({ acao: 'PREENCHER', tipoEmbalagemId: candidatos[0].id })
        else if (candidatos.length === 0) expect(d).toMatchObject({ acao: 'NAO_CASADO', motivo: 'NENHUM_CANDIDATO' })
        else expect(d).toMatchObject({ acao: 'NAO_CASADO', motivo: 'MAIS_DE_UM' })
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('aplicar a decisão duas vezes equivale a aplicar uma', () => {
    fc.assert(
      fc.property(atualArb, origemArb, tiposArb, (atual, origem, tipos) => {
        const d1 = decidirVinculo({ codigoOrigemProduto: origem, tipoEmbalagemIdAtual: atual, tipos })
        const depoisDe1 = aplicarDecisaoVinculo(atual, d1)
        const d2 = decidirVinculo({ codigoOrigemProduto: origem, tipoEmbalagemIdAtual: depoisDe1, tipos })
        const depoisDe2 = aplicarDecisaoVinculo(depoisDe1, d2)
        expect(depoisDe2).toBe(depoisDe1)
        // Na segunda execução nada é preenchido.
        expect(d2.acao).not.toBe('PREENCHER')
      }),
      { numRuns: NUM_RUNS },
    )
  })
})
