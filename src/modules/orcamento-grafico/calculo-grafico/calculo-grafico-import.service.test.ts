import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  mapearLinhaParaCalculo,
  mapeamentoEhErro,
  type LinhaAcervoCalcgraf,
} from './calculo-grafico-import.service'

/**
 * Property tests do submódulo Biblioteca de Cálculos Gráficos — IMPORTAÇÃO PURA.
 *
 * `importarAcervo` toca o Prisma (idempotência/gravação), então aqui testamos a
 * LÓGICA PURA que o sustenta: `mapearLinhaParaCalculo` (resiliente, não lança) e
 * `mapeamentoEhErro`, mais os invariantes de numeração em massa que o importador
 * usa. Padrão do projeto: vitest + fast-check, 100 iterações por property.
 *
 * Mapeia as Correctness Properties do design
 * (`.kiro/specs/biblioteca-calculos-graficos/design.md`): P12 (resiliência +
 * conservação), P5 (numeração própria única), P2/P3 (ramo de importação).
 */

// ============================================================================
// DE-PARA simulado (codProduto Calcgraf → tipoEmbalagemId Vizor)
// ============================================================================

const UUIDS = ['uuid-1', 'uuid-2', 'uuid-3', 'uuid-4', 'uuid-5']
const DE_PARA = new Map<number, string>(UUIDS.map((u, i) => [i + 1, u]))
const UUID_SET = new Set<string>(UUIDS)

// ============================================================================
// ARBITRÁRIOS DE LINHA DO ACERVO (mistura de válidas e corrompidas)
// ============================================================================

/** Linha VÁLIDA: numCalculo, tipoEmbalagem resolvível e tiragem > 0. */
const arbLinhaValida: fc.Arbitrary<LinhaAcervoCalcgraf> = fc.record({
  numCalculo: fc.integer({ min: 1, max: 999_999 }),
  // Resolve a embalagem por codProduto (de-para) OU por tipoEmbalagemId direto.
  tipoVia: fc.constantFrom('codProduto' as const, 'direto' as const),
  codProduto: fc.integer({ min: 1, max: 5 }),
  tiragem: fc.integer({ min: 1, max: 5_000_000 }),
  cliente: fc.option(fc.string({ maxLength: 30 }), { nil: null }),
  linhaProduto: fc.option(fc.string({ maxLength: 30 }), { nil: null }),
  produto: fc.option(fc.string({ maxLength: 30 }), { nil: null }),
  descricao: fc.option(fc.string({ maxLength: 30 }), { nil: null }),
  siglaAcabado: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
  numCores: fc.option(fc.integer({ min: 0, max: 8 }), { nil: null }),
}).map((r) => {
  const base: LinhaAcervoCalcgraf = {
    numCalculo: r.numCalculo,
    tiragem: r.tiragem,
    cliente: r.cliente,
    linhaProduto: r.linhaProduto,
    produto: r.produto,
    descricao: r.descricao,
    siglaAcabado: r.siglaAcabado,
    numCores: r.numCores,
  }
  if (r.tipoVia === 'direto') {
    base.tipoEmbalagemId = UUIDS[r.codProduto - 1]
  } else {
    base.codProduto = r.codProduto
  }
  return base
})

/** Linha CORROMPIDA: falta pelo menos um campo essencial. */
const arbLinhaCorrompida: fc.Arbitrary<LinhaAcervoCalcgraf> = fc.oneof(
  // sem numCalculo
  fc.record({
    numCalculo: fc.constant(null),
    codProduto: fc.integer({ min: 1, max: 5 }),
    tiragem: fc.integer({ min: 1, max: 1000 }),
  }),
  // sem tipoEmbalagem resolvível (codProduto fora do de-para e sem id direto)
  fc.record({
    numCalculo: fc.integer({ min: 1, max: 999_999 }),
    codProduto: fc.option(fc.integer({ min: 6, max: 50 }), { nil: null }),
    tiragem: fc.integer({ min: 1, max: 1000 }),
  }),
  // sem tiragem > 0 (null ou não-positiva), mas com embalagem resolvível
  fc.record({
    numCalculo: fc.integer({ min: 1, max: 999_999 }),
    codProduto: fc.integer({ min: 1, max: 5 }),
    tiragem: fc.constantFrom(null, 0, -1, -1000),
  }),
) as fc.Arbitrary<LinhaAcervoCalcgraf>

/** Qualquer linha (válida ou corrompida) em proporções variadas. */
const arbLinha = fc.oneof(
  { weight: 3, arbitrary: arbLinhaValida },
  { weight: 2, arbitrary: arbLinhaCorrompida },
)

const arbAcervo = fc.array(arbLinha, { maxLength: 40 })

// ============================================================================
// PROPERTY 12 — Importação resiliente + conservação (nível do mapeamento puro)
// ============================================================================

describe('calculo-grafico-import — Property 12 (resiliência + conservação)', () => {
  // Feature: biblioteca-calculos-graficos, Property 12: Importação resiliente com relatório e contagens conservadas — nenhuma linha faz o mapeamento lançar; cada uma resulta em OK ou Erro, nunca exceção.
  it('toda linha retorna OK ou Erro, nunca lança (resiliência)', () => {
    fc.assert(
      fc.property(arbAcervo, (linhas) => {
        for (const linha of linhas) {
          // Não deve lançar para nenhuma entrada, por mais corrompida que seja.
          expect(() => mapearLinhaParaCalculo(linha, DE_PARA)).not.toThrow()
          const r = mapearLinhaParaCalculo(linha, DE_PARA)
          // É exatamente um dos dois baldes (OK XOR Erro).
          if (mapeamentoEhErro(r)) {
            // LinhaMapeadaErro: tem o campo `erro` (string).
            expect(typeof r.erro).toBe('string')
          } else {
            // LinhaMapeadaOk: tem o campo `engenharia`.
            expect('engenharia' in r).toBe(true)
          }
        }
      }),
    )
  })

  // Feature: biblioteca-calculos-graficos, Property 12: Importação resiliente com relatório e contagens conservadas — para linhas OK, a embalagem está no de-para (ou veio direto), quantidade > 0 e numeroCalcgraf é number.
  it('linhas OK têm embalagem resolvida, quantidade > 0 e numeroCalcgraf numérico', () => {
    fc.assert(
      fc.property(arbAcervo, (linhas) => {
        for (const linha of linhas) {
          const r = mapearLinhaParaCalculo(linha, DE_PARA)
          if (mapeamentoEhErro(r)) continue
          // tipoEmbalagemId está no conjunto de uuids do de-para OU veio direto.
          expect(UUID_SET.has(r.engenharia.tipoEmbalagemId)).toBe(true)
          expect(r.engenharia.quantidade).toBeGreaterThan(0)
          expect(typeof r.numeroCalcgraf).toBe('number')
        }
      }),
    )
  })

  // Feature: biblioteca-calculos-graficos, Property 12: Importação resiliente com relatório e contagens conservadas — para linhas corrompidas, mapeamentoEhErro é true e há motivo (string).
  it('linhas corrompidas resultam em erro com motivo (string)', () => {
    fc.assert(
      fc.property(fc.array(arbLinhaCorrompida, { maxLength: 30 }), (linhas) => {
        for (const linha of linhas) {
          const r = mapearLinhaParaCalculo(linha, DE_PARA)
          expect(mapeamentoEhErro(r)).toBe(true)
          if (mapeamentoEhErro(r)) {
            expect(typeof r.erro).toBe('string')
            expect(r.erro.length).toBeGreaterThan(0)
          }
        }
      }),
    )
  })

  // Feature: biblioteca-calculos-graficos, Property 12: Importação resiliente com relatório e contagens conservadas — conservação: #OK + #erro === total de linhas (cada linha cai em exatamente um balde).
  it('conservação: #OK + #erro === total de linhas', () => {
    fc.assert(
      fc.property(arbAcervo, (linhas) => {
        let ok = 0
        let erro = 0
        for (const linha of linhas) {
          const r = mapearLinhaParaCalculo(linha, DE_PARA)
          if (mapeamentoEhErro(r)) erro += 1
          else ok += 1
        }
        expect(ok + erro).toBe(linhas.length)
      }),
    )
  })
})

// ============================================================================
// PROPERTY 5 — Numeração própria única (lógica pura do importador)
// ============================================================================

/**
 * O importador atribui numeração em massa sequencial: `let prox = max+1;` e a
 * cada inserção `push(prox++)`. Aqui testamos o INVARIANTE puro dessa regra —
 * a sequência [max+1 .. max+n] tem n elementos DISTINTOS e todos > max (sem
 * colisão). Implementado inline (é exatamente a regra do importarAcervo).
 */
function gerarSequenciaNumeracao(max: number, n: number): number[] {
  const out: number[] = []
  let prox = max + 1
  for (let i = 0; i < n; i++) out.push(prox++)
  return out
}

describe('calculo-grafico-import — Property 5 (numeração própria única)', () => {
  // Feature: biblioteca-calculos-graficos, Property 5: Numeração própria única e atômica por empresa — dada uma base max >= 0 e contagem n >= 0, a sequência [max+1 .. max+n] tem n elementos distintos e todos > max (sem colisão).
  it('sequência de numeração em massa é única e estritamente > max', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 2000 }),
        (max, n) => {
          const seq = gerarSequenciaNumeracao(max, n)
          // Tem exatamente n elementos.
          expect(seq.length).toBe(n)
          // Todos distintos (sem colisão).
          expect(new Set(seq).size).toBe(n)
          // Todos estritamente maiores que max.
          for (const num of seq) expect(num).toBeGreaterThan(max)
          // Contíguos e crescentes: o último é max + n (quando n > 0).
          if (n > 0) {
            expect(seq[0]).toBe(max + 1)
            expect(seq[seq.length - 1]).toBe(max + n)
          }
        },
      ),
    )
  })
})

// ============================================================================
// PROPERTY 3 (ramo importação) / P2 — número e truncamento de campos
// ============================================================================

describe('calculo-grafico-import — Property 3/P2 (número preservado + truncamento)', () => {
  // Feature: biblioteca-calculos-graficos, Property 3: Round-trip do mapeamento biblioteca ↔ item do orçamento — para uma linha válida, numeroCalcgraf é igual ao linha.numCalculo.
  it('numeroCalcgraf de uma linha válida é igual ao linha.numCalculo', () => {
    fc.assert(
      fc.property(arbLinhaValida, (linha) => {
        const r = mapearLinhaParaCalculo(linha, DE_PARA)
        expect(mapeamentoEhErro(r)).toBe(false)
        if (!mapeamentoEhErro(r)) {
          expect(r.numeroCalcgraf).toBe(linha.numCalculo)
        }
      }),
    )
  })

  // Feature: biblioteca-calculos-graficos, Property 2: Cálculo sempre carrega empresa e origem corretas (ramo importação) — campos de biblioteca são truncados aos limites do schema (clienteNome<=200, linhaProduto<=120, siglaAcabado<=60, descricao<=200).
  it('campos de biblioteca longos são truncados aos limites do schema', () => {
    // Conteúdo longo SEM espaços nas bordas: o mapeamento faz trim() antes de
    // truncar, então geramos caracteres não-brancos para que a truncagem seja
    // determinística (o resultado é exatamente os `max` primeiros caracteres).
    const arbStrLonga = (len: number) =>
      fc
        .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
          minLength: len,
          maxLength: len + 100,
        })
        .map((chars) => chars.join(''))
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999_999 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 1000 }),
        arbStrLonga(260), // cliente
        arbStrLonga(140), // linhaProduto
        arbStrLonga(260), // produto
        arbStrLonga(260), // descricao
        arbStrLonga(80), // siglaAcabado
        (num, cod, tir, cliente, linhaProduto, produto, descricao, siglaAcabado) => {
          const linha: LinhaAcervoCalcgraf = {
            numCalculo: num,
            codProduto: cod,
            tiragem: tir,
            cliente,
            linhaProduto,
            produto,
            descricao,
            siglaAcabado,
          }
          const r = mapearLinhaParaCalculo(linha, DE_PARA)
          expect(mapeamentoEhErro(r)).toBe(false)
          if (mapeamentoEhErro(r)) return
          // Limites do schema calculo_grafico (truncamento exato pelo prefixo).
          expect(r.biblioteca.clienteNome).toBe(cliente.slice(0, 200))
          expect(r.biblioteca.linhaProduto).toBe(linhaProduto.slice(0, 120))
          expect(r.biblioteca.produto).toBe(produto.slice(0, 200))
          expect(r.biblioteca.descricao).toBe(descricao.slice(0, 200))
          expect(r.biblioteca.siglaAcabado).toBe(siglaAcabado.slice(0, 60))
        },
      ),
    )
  })
})
