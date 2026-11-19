import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  resolverProdutoGrafico,
  resolverTipoPlano,
  normalizarNome,
  type ProdutoGraficoResolucao,
  type DefaultProdutoPlanoResolucao,
  type TipoPlanoResolucao,
} from './resolucao-catalogo.service'

// Feature: orcamento-grafico-paridade-fluxo-legado, Property 6: resolução única de produto e tipo de plano
// **Validates: Requirements 6.1, 6.2, 6.3**

const NUM_RUNS = 100

const idArb = fc.uuid()
const nomeArb = fc.string({ minLength: 1, maxLength: 20 })

const produtoArb = (tipoEmbalagemId: fc.Arbitrary<string | null>) =>
  fc.record({
    id: idArb,
    nome: nomeArb,
    tipoEmbalagemId,
    status: fc.boolean(),
  })

describe('resolverProdutoGrafico — Property 6', () => {
  it('só resolve com exatamente 1 candidato ativo por tipoEmbalagem; 0 → ZERO; vários → MULTIPLOS', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.array(produtoArb(fc.oneof(fc.uuid(), fc.constant<string | null>(null))), { maxLength: 8 }),
        fc.array(produtoArb(fc.constant('ALVO')), { maxLength: 4 }),
        (tipoId, outros, alvos) => {
          const doTipo = alvos.map((p) => ({ ...p, tipoEmbalagemId: tipoId }))
          const lista: ProdutoGraficoResolucao[] = [
            ...outros.filter((p) => p.tipoEmbalagemId !== tipoId),
            ...doTipo,
          ]
          // sem nome no cálculo, o desempate por nome nunca ajuda
          const r = resolverProdutoGrafico({ tipoEmbalagemId: tipoId, produto: null }, lista)
          const candidatos = doTipo.filter((p) => p.status !== false)
          if (candidatos.length === 1) {
            expect(r.id).toBe(candidatos[0].id)
            expect(r.motivo).toBeUndefined()
          } else {
            expect(r.id).toBeNull()
            expect(r.motivo).toBe(candidatos.length === 0 ? 'ZERO' : 'MULTIPLOS')
          }
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })

  it('com vários candidatos, desempata por nome normalizado somente se sobrar exatamente 1; nunca depende de nome fixo', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.array(nomeArb, { minLength: 2, maxLength: 6 }),
        fc.nat(),
        (tipoId, nomes, idx) => {
          const lista: ProdutoGraficoResolucao[] = nomes.map((nome, i) => ({
            id: `p${i}`,
            nome,
            tipoEmbalagemId: tipoId,
          }))
          const alvo = lista[idx % lista.length]
          const r = resolverProdutoGrafico({ tipoEmbalagemId: tipoId, produto: alvo.nome.toUpperCase() }, lista)
          const iguais = lista.filter((p) => normalizarNome(p.nome) === normalizarNome(alvo.nome))
          if (iguais.length === 1) {
            expect(r.id).toBe(iguais[0].id)
          } else {
            expect(r.id).toBeNull()
            expect(r.motivo).toBe('MULTIPLOS')
          }
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })

  it('sem tipoEmbalagemId no cálculo → ZERO, e produtos inativos nunca são candidatos', () => {
    expect(resolverProdutoGrafico({ tipoEmbalagemId: null, produto: 'x' }, [])).toEqual({ id: null, motivo: 'ZERO' })
    const r = resolverProdutoGrafico(
      { tipoEmbalagemId: 't1' },
      [{ id: 'a', nome: 'A', tipoEmbalagemId: 't1', status: false }],
    )
    expect(r).toEqual({ id: null, motivo: 'ZERO' })
  })
})

describe('resolverTipoPlano — Property 6', () => {
  const tipoArb = fc.record({ id: idArb, fixo: fc.boolean() })

  it('só resolve com 1 candidato; com vários exige exatamente 1 fixo; 0 → ZERO', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(tipoArb, { selector: (t) => t.id, maxLength: 6 }),
        fc.uniqueArray(fc.nat({ max: 5 }), { maxLength: 6 }),
        (tipos, indices) => {
          const defaults: DefaultProdutoPlanoResolucao[] = tipos.length
            ? indices.map((i) => ({ produtoId: 'P', tipoPlanoId: tipos[i % tipos.length].id }))
            : []
          const tiposPlano: TipoPlanoResolucao[] = tipos
          const r = resolverTipoPlano({ id: 'P' }, defaults, tiposPlano)
          const ids = Array.from(new Set(defaults.map((d) => d.tipoPlanoId)))
          if (ids.length === 0) {
            expect(r).toEqual({ id: null, motivo: 'ZERO' })
          } else if (ids.length === 1) {
            expect(r.id).toBe(ids[0])
          } else {
            const fixos = tipos.filter((t) => t.fixo && ids.includes(t.id))
            if (fixos.length === 1) expect(r.id).toBe(fixos[0].id)
            else expect(r).toEqual({ id: null, motivo: 'MULTIPLOS' })
          }
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })

  it('ignora defaults de outros produtos e produto ausente → ZERO', () => {
    expect(resolverTipoPlano(null, [], [])).toEqual({ id: null, motivo: 'ZERO' })
    const r = resolverTipoPlano(
      { id: 'P' },
      [{ produtoId: 'OUTRO', tipoPlanoId: 'x' }],
      [{ id: 'x', fixo: true }],
    )
    expect(r).toEqual({ id: null, motivo: 'ZERO' })
  })
})
