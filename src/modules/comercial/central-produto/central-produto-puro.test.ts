// Property-based tests das funções PURAS da Central de Consulta do Produto/Acabado.
// Rodar: npx vitest run <arquivo> --reporter=dot
// Cada Property é implementada por UM único teste de propriedade (≥100 iterações).

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

import { CentralProdutoError } from './central-produto.errors'
import {
  validarTermoBusca,
  validarEdicao,
  TERMO_MIN,
} from './central-produto-validacao'
import { extrairProdutoTag, casarOpPorTag, normalizarTexto } from './central-produto-tag'
import { resolverArte, temFichaTecnica } from './central-produto-arte-ficha'
import { permitirEdicao } from './central-produto-permissao'
import { consolidarResultados } from './central-produto-consolidacao.service'
import type {
  EntradasConsolidacao,
  DeParaAcabado,
  ProdutoResumo,
  CalculoResumo,
  OpTagResumo,
} from './central-produto.types'

const RUNS = { numRuns: 100 }

// ─────────────────────────────────────────────────────────────────────────────
// Property 1: Validação do termo de busca
// ─────────────────────────────────────────────────────────────────────────────
describe('Property 1 — validação do termo de busca', () => {
  // Feature: comercial-central-produto-acabado, Property 1: termo < 2 chars após trim é rejeitado sem busca; >= 2 prossegue.
  it('rejeita < 2 chars (após trim) e aceita >= 2', () => {
    fc.assert(
      fc.property(fc.string(), (bruto) => {
        const limpo = bruto.trim()
        if (limpo.length < TERMO_MIN) {
          expect(() => validarTermoBusca(bruto)).toThrow(CentralProdutoError)
        } else {
          const r = validarTermoBusca(bruto)
          expect(r).toBe(limpo.toLowerCase())
        }
      }),
      RUNS,
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Property 10: Validação dos campos de edição
// ─────────────────────────────────────────────────────────────────────────────
describe('Property 10 — validação dos campos de edição', () => {
  // Feature: comercial-central-produto-acabado, Property 10: rejeita descricao fora de 1..200, imagemUrl não-nula fora de 1..500, acabados duplicados; aceita o resto.
  it('aceita campos válidos e rejeita inválidos/duplicados', () => {
    fc.assert(
      fc.property(
        fc.record({
          descricao: fc.option(fc.string({ maxLength: 260 }), { nil: undefined }),
          imagemUrl: fc.option(fc.oneof(fc.string({ maxLength: 560 }), fc.constant(null)), {
            nil: undefined,
          }),
          adicionarAcabados: fc.option(
            fc.array(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 6 }),
            { nil: undefined },
          ),
          acabadosExistentes: fc.array(fc.string({ minLength: 1, maxLength: 8 }), {
            maxLength: 6,
          }),
        }),
        (p) => {
          const descOk =
            p.descricao === undefined ||
            (p.descricao.length >= 1 && p.descricao.length <= 200)
          const imgOk =
            p.imagemUrl === undefined ||
            p.imagemUrl === null ||
            (p.imagemUrl.length >= 1 && p.imagemUrl.length <= 500)

          const existentes = new Set((p.acabadosExistentes ?? []).map((c) => c.trim()))
          let dup = false
          const vistos = new Set<string>()
          for (const b of p.adicionarAcabados ?? []) {
            const c = b.trim()
            if (c.length === 0) {
              dup = true
              break
            }
            if (vistos.has(c) || existentes.has(c)) {
              dup = true
              break
            }
            vistos.add(c)
          }

          const deveValer = descOk && imgOk && !dup
          if (deveValer) {
            expect(() => validarEdicao(p)).not.toThrow()
          } else {
            expect(() => validarEdicao(p)).toThrow(CentralProdutoError)
          }
        },
      ),
      RUNS,
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Property 9: Extração e casamento pela tag [Produto]
// ─────────────────────────────────────────────────────────────────────────────
describe('Property 9 — extração e casamento da tag [Produto]', () => {
  // Feature: comercial-central-produto-acabado, Property 9: extrai [Produto] <valor> sem bordas; casa OP sse tag normalizada == descrição normalizada.
  it('extrai o valor e casa por igualdade normalizada', () => {
    fc.assert(
      fc.property(
        // valor sem quebra de linha e sem colchetes para não confundir a regex
        fc
          .string({ minLength: 1, maxLength: 30 })
          .filter((s) => !/[\n\[\]]/.test(s) && s.trim().length > 0),
        fc.array(fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !/\n/.test(s)), {
          maxLength: 6,
        }),
        (valor, outros) => {
          const obs = `[Cliente] Fulano\n[Produto] ${valor}\n[Cores] 4x0`
          expect(extrairProdutoTag(obs)).toBe(valor.trim())

          // sem tag → null
          expect(extrairProdutoTag('sem tag aqui')).toBeNull()
          expect(extrairProdutoTag(null)).toBeNull()

          // casamento: cria OPs com a tag = valor e outras com valores diferentes
          const ops: OpTagResumo[] = [
            { id: 'a', numero: 1, produtoTag: `  ${valor.toUpperCase()}  ` },
            ...outros.map((o, i) => ({ id: `o${i}`, numero: i + 2, produtoTag: o })),
          ]
          const casadas = casarOpPorTag(valor, ops)
          for (const op of casadas) {
            expect(normalizarTexto(op.produtoTag)).toBe(normalizarTexto(valor))
          }
          // a OP 'a' (mesma tag em case diferente) deve estar entre as casadas
          expect(casadas.some((op) => op.id === 'a')).toBe(true)
        },
      ),
      RUNS,
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Property 7: Prioridade da fonte de arte
// ─────────────────────────────────────────────────────────────────────────────
describe('Property 7 — prioridade da fonte de arte', () => {
  // Feature: comercial-central-produto-acabado, Property 7: PRODUTO se há img do produto; senão CALCULO se há img do cálculo; senão NENHUMA.
  it('prioriza produto, depois cálculo, senão nenhuma', () => {
    const img = fc.oneof(
      fc.constant(null),
      fc.constant(''),
      fc.constant('   '),
      fc.string({ minLength: 1, maxLength: 20 }).map((s) => `x${s}`), // garante não-vazio
    )
    fc.assert(
      fc.property(img, img, (pImg, cImg) => {
        const r = resolverArte(pImg, cImg)
        const pOk = typeof pImg === 'string' && pImg.trim().length > 0
        const cOk = typeof cImg === 'string' && cImg.trim().length > 0
        if (pOk) {
          expect(r).toEqual({ fonte: 'PRODUTO', imagemUrl: pImg })
        } else if (cOk) {
          expect(r).toEqual({ fonte: 'CALCULO', imagemUrl: cImg })
        } else {
          expect(r).toEqual({ fonte: 'NENHUMA', imagemUrl: null })
        }
      }),
      RUNS,
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Property 8: Indicador de ficha técnica
// ─────────────────────────────────────────────────────────────────────────────
describe('Property 8 — indicador de ficha técnica', () => {
  // Feature: comercial-central-produto-acabado, Property 8: temFicha sse há AtributoGrafico OU engenharia de cálculo.
  it('é verdadeiro sse ao menos uma fonte existe', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (a, b) => {
        expect(temFichaTecnica(a, b)).toBe(a || b)
      }),
      RUNS,
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Property 11: Decisão de permissão de edição
// ─────────────────────────────────────────────────────────────────────────────
describe('Property 11 — decisão de permissão de edição', () => {
  // Feature: comercial-central-produto-acabado, Property 11: ADMIN/SUPER_ADMIN sempre true; senão reflete flags (default true), basta uma negar.
  it('bypass admin; caso contrário conjunção das flags', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom('ADMIN', 'SUPER_ADMIN', 'OPERADOR', 'SUPERVISOR', 'VENDEDOR'),
          fc.string(),
        ),
        fc.option(fc.boolean(), { nil: undefined }),
        fc.option(fc.boolean(), { nil: undefined }),
        (perfil, flagComercial, flagPcp) => {
          const r = permitirEdicao({ perfil, flagComercial, flagPcp })
          if (perfil === 'ADMIN' || perfil === 'SUPER_ADMIN') {
            expect(r).toBe(true)
          } else {
            expect(r).toBe((flagComercial ?? true) && (flagPcp ?? true))
          }
        },
      ),
      RUNS,
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Geradores para a consolidação
// ─────────────────────────────────────────────────────────────────────────────
const arbProduto = (): fc.Arbitrary<ProdutoResumo> =>
  fc.record({
    id: fc.uuid(),
    codigo: fc.string({ minLength: 1, maxLength: 10 }),
    nome: fc.string({ minLength: 1, maxLength: 20 }),
    descricao: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
    imagemUrl: fc.option(fc.string({ maxLength: 10 }), { nil: null }),
    clienteId: fc.option(fc.uuid(), { nil: null }),
  })

const arbCalculo = (): fc.Arbitrary<CalculoResumo> =>
  fc.record({
    id: fc.uuid(),
    numero: fc.integer({ min: 1, max: 99999 }),
    numeroCalcgraf: fc.option(fc.integer({ min: 1, max: 99999 }), { nil: null }),
    siglaAcabado: fc.option(fc.string({ minLength: 1, maxLength: 8 }), { nil: null }),
    descricao: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
    produto: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
    clienteNome: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
  })

function arbEntradas(): fc.Arbitrary<EntradasConsolidacao> {
  return fc
    .record({
      produtos: fc.array(arbProduto(), { maxLength: 8 }),
      calculos: fc.array(arbCalculo(), { maxLength: 8 }),
      opsSemProduto: fc.array(
        fc.record({
          id: fc.uuid(),
          numero: fc.integer({ min: 1, max: 9999 }),
          produtoTag: fc.string({ maxLength: 20 }),
        }),
        { maxLength: 4 },
      ),
    })
    .chain((base) => {
      // de-paras referenciam produtos existentes (ou um produtoId aleatório)
      const idsProduto = base.produtos.map((p) => p.id)
      const arbDePara: fc.Arbitrary<DeParaAcabado> = fc.record({
        codigoExterno: fc.string({ minLength: 1, maxLength: 8 }),
        nomeExterno: fc.string({ maxLength: 20 }),
        produtoId:
          idsProduto.length > 0
            ? fc.oneof(fc.constantFrom(...idsProduto), fc.uuid())
            : fc.uuid(),
      })
      return fc.record({
        termoNormalizado: fc.constant('abc'),
        deParas: fc.array(arbDePara, { maxLength: 8 }),
        produtos: fc.constant(base.produtos),
        calculos: fc.constant(base.calculos),
        opsSemProduto: fc.constant(base.opsSemProduto),
      })
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Property 2: Agrupamento único por produto
// ─────────────────────────────────────────────────────────────────────────────
describe('Property 2 — agrupamento único por produto', () => {
  // Feature: comercial-central-produto-acabado, Property 2: cada produtoId em no máximo 1 grupo; codigosAcabado = conjunto ordenado sem duplicatas dos de-paras do produto.
  it('produto nunca em dois grupos; códigos consolidados ordenados/únicos', () => {
    fc.assert(
      fc.property(arbEntradas(), (e) => {
        const r = consolidarResultados(e, 1000)
        const produtoIds = r.resultados
          .filter((g) => g.tipo === 'PRODUTO')
          .map((g) => g.produtoId)
        // unicidade
        expect(new Set(produtoIds).size).toBe(produtoIds.length)

        // códigos consolidados por produto
        for (const g of r.resultados.filter((x) => x.tipo === 'PRODUTO')) {
          const esperados = [
            ...new Set(
              e.deParas
                .filter((dp) => dp.produtoId === g.produtoId)
                .map((dp) => dp.codigoExterno.trim()),
            ),
          ].sort((a, b) => a.localeCompare(b))
          expect(g.codigosAcabado).toEqual(esperados)
        }
      }),
      RUNS,
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Property 3: Fallback de acabado sem produto
// ─────────────────────────────────────────────────────────────────────────────
describe('Property 3 — fallback de acabado sem produto', () => {
  // Feature: comercial-central-produto-acabado, Property 3: cálculo cujo siglaAcabado não casa de-para e não resolve produto vira ACABADO_SEM_PRODUTO; grupos PRODUTO nunca têm semProdutoCadastrado true.
  it('cálculo não coberto vira grupo sem produto; produto nunca marca sem cadastro', () => {
    fc.assert(
      fc.property(arbEntradas(), (e) => {
        const r = consolidarResultados(e, 1000)
        for (const g of r.resultados) {
          if (g.tipo === 'PRODUTO') {
            expect(g.semProdutoCadastrado).toBe(false)
          } else {
            expect(g.semProdutoCadastrado).toBe(true)
            expect(g.produtoId).toBeNull()
            expect(g.calculoId).not.toBeNull()
          }
        }
        // todo cálculo cujo siglaAcabado NÃO está coberto por de-para deve ter grupo
        const cobertos = new Set(
          e.deParas.map((dp) => dp.codigoExterno.trim().toLowerCase()),
        )
        for (const c of e.calculos) {
          const sigla = (c.siglaAcabado ?? '').trim().toLowerCase()
          const coberto = sigla.length > 0 && cobertos.has(sigla)
          const temGrupo = r.resultados.some((g) => g.calculoId === c.id)
          if (!coberto) expect(temGrupo).toBe(true)
        }
      }),
      RUNS,
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Property 4: Ausência de resultados
// ─────────────────────────────────────────────────────────────────────────────
describe('Property 4 — ausência de resultados', () => {
  // Feature: comercial-central-produto-acabado, Property 4: semResultado <=> lista vazia.
  it('semResultado sse resultados vazio', () => {
    fc.assert(
      fc.property(arbEntradas(), (e) => {
        const r = consolidarResultados(e, 1000)
        expect(r.semResultado).toBe(r.resultados.length === 0)
      }),
      RUNS,
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Property 5: Ordenação determinística e limite
// ─────────────────────────────────────────────────────────────────────────────
describe('Property 5 — ordenação determinística e limite', () => {
  // Feature: comercial-central-produto-acabado, Property 5: permutação das entradas produz a mesma sequência de grupos; nº de grupos <= limite; limiteAplicado sse total > limite.
  it('determinístico sob permutação e respeita o limite', () => {
    fc.assert(
      fc.property(arbEntradas(), fc.integer({ min: 1, max: 20 }), (e, limite) => {
        const permutado: EntradasConsolidacao = {
          ...e,
          deParas: [...e.deParas].reverse(),
          produtos: [...e.produtos].reverse(),
          calculos: [...e.calculos].reverse(),
          opsSemProduto: [...e.opsSemProduto].reverse(),
        }
        const r1 = consolidarResultados(e, 1000)
        const r2 = consolidarResultados(permutado, 1000)
        expect(r2.resultados.map((g) => g.chave)).toEqual(
          r1.resultados.map((g) => g.chave),
        )

        const rl = consolidarResultados(e, limite)
        expect(rl.resultados.length).toBeLessThanOrEqual(limite)
        expect(rl.limiteAplicado).toBe(r1.resultados.length > limite)
      }),
      RUNS,
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Property 6: Detalhe direto com produto único
// ─────────────────────────────────────────────────────────────────────────────
describe('Property 6 — detalhe direto com produto único', () => {
  // Feature: comercial-central-produto-acabado, Property 6: detalheDireto sse exatamente 1 grupo e é PRODUTO.
  it('detalheDireto sse 1 grupo do tipo PRODUTO', () => {
    fc.assert(
      fc.property(arbEntradas(), (e) => {
        const r = consolidarResultados(e, 1000)
        const esperado =
          r.resultados.length === 1 && r.resultados[0].tipo === 'PRODUTO'
        expect(r.detalheDireto).toBe(esperado)
      }),
      RUNS,
    )
  })
})
