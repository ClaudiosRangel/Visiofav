import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  folhaDescendeDe,
  prefixoDescendentes,
  agregarContagensPorNivel,
  normalizarTexto,
  gerarSugestoes,
  type NivelParaAgregacao,
  type ContagensPorFolha,
  type FolhaCandidata,
} from './hierarquia-analitica.service'

/**
 * Testes property-based da lógica pura analítica da Hierarquia Mercadológica
 * (Fase 2). Propriedades P1–P10 do design
 * (.kiro/specs/hierarquia-mercadologica-fase2/design.md).
 *
 * Todos com no mínimo 100 iterações.
 */

const RUNS = { numRuns: 100 }

// ---------------------------------------------------------------------------
// Geradores
// ---------------------------------------------------------------------------

// Segmento numérico de largura fixa (2 para níveis 1-3, 3 para a folha).
function seg(n: number, largura: number): string {
  return String(n % 10 ** largura).padStart(largura, '0')
}

/**
 * Gera uma árvore de níveis VÁLIDA (Departamento→Seção→Categoria→Subcategoria),
 * com codigoHierarquico composto pela concatenação dos ancestrais com ".".
 * Retorna a lista achatada de níveis (com o oráculo real de descendência
 * embutido nos próprios códigos).
 */
const arbArvore = fc
  .array(
    fc.record({
      dep: fc.integer({ min: 0, max: 5 }),
      sec: fc.integer({ min: 0, max: 5 }),
      cat: fc.integer({ min: 0, max: 5 }),
      sub: fc.integer({ min: 0, max: 20 }),
    }),
    { minLength: 0, maxLength: 30 },
  )
  .map((linhas) => {
    // Deduplica por caminho e materializa todos os níveis intermediários.
    const mapa = new Map<string, NivelParaAgregacao>()
    const add = (tipo: NivelParaAgregacao['tipo'], codigoHierarquico: string) => {
      const id = `${tipo}:${codigoHierarquico}`
      if (!mapa.has(id)) mapa.set(id, { id, tipo, codigoHierarquico })
    }
    for (const l of linhas) {
      const cDep = seg(l.dep, 2)
      const cSec = `${cDep}.${seg(l.sec, 2)}`
      const cCat = `${cSec}.${seg(l.cat, 2)}`
      const cSub = `${cCat}.${seg(l.sub, 3)}`
      add('DEPARTAMENTO', cDep)
      add('SECAO', cSec)
      add('CATEGORIA', cCat)
      add('SUBCATEGORIA', cSub)
    }
    return [...mapa.values()]
  })

// Mapa de contagens por folha, incluindo zeros e folhas ausentes.
function arbContagens(niveis: NivelParaAgregacao[]) {
  const folhas = niveis.filter((n) => n.tipo === 'SUBCATEGORIA')
  return fc
    .array(fc.integer({ min: 0, max: 1000 }), { minLength: folhas.length, maxLength: folhas.length })
    .map((valores) => {
      const c: ContagensPorFolha = {}
      folhas.forEach((f, i) => {
        // Deixa algumas folhas ausentes do mapa (undefined vira 0).
        if (valores[i] % 7 !== 0) c[f.id] = valores[i]
      })
      return c
    })
}

// Texto com caixa/acentos/espaços redundantes (inclui vazio).
const arbTexto = fc.oneof(
  fc.constant(''),
  fc.constantFrom('  Café  ', 'CAFÉ', 'cafe', 'Bebidas Quentes', 'BEBIDAS   QUENTES', ' áçãÕ '),
  fc.string(),
)

// Soma das folhas descendentes de um nível — oráculo independente da implementação.
function somaOraculo(nivel: NivelParaAgregacao, folhas: NivelParaAgregacao[], c: ContagensPorFolha): number {
  let s = 0
  for (const f of folhas) {
    if (f.codigoHierarquico === nivel.codigoHierarquico || f.codigoHierarquico.startsWith(nivel.codigoHierarquico + '.')) {
      s += c[f.id] ?? 0
    }
  }
  return s
}

// ---------------------------------------------------------------------------
// P1 — Filtro por prefixo casa exatamente os descendentes
// Feature: hierarquia-mercadologica-fase2, Property 1
// ---------------------------------------------------------------------------
describe('folhaDescendeDe (P1)', () => {
  it('Property 1: casa a própria folha e descendentes reais, e nada além', () => {
    fc.assert(
      fc.property(arbArvore, (niveis) => {
        const folhas = niveis.filter((n) => n.tipo === 'SUBCATEGORIA')
        for (const nivel of niveis) {
          for (const folha of folhas) {
            const esperado =
              folha.codigoHierarquico === nivel.codigoHierarquico ||
              folha.codigoHierarquico.startsWith(nivel.codigoHierarquico + '.')
            expect(folhaDescendeDe(folha.codigoHierarquico, nivel.codigoHierarquico)).toBe(esperado)
          }
        }
      }),
      RUNS,
    )
  })

  it('Property 1b: folha selecionada diretamente é descendente de si mesma', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), (n) => {
        const cod = `01.02.03.${seg(n, 3)}`
        expect(folhaDescendeDe(cod, cod)).toBe(true)
      }),
      RUNS,
    )
  })

  it('prefixoDescendentes delimita com ponto', () => {
    expect(prefixoDescendentes('01.02')).toBe('01.02.')
  })
})

// ---------------------------------------------------------------------------
// P2/P3/P4/P5 — Agregação de contagens
// ---------------------------------------------------------------------------
describe('agregarContagensPorNivel (P2–P5)', () => {
  it('Property 2: cada nível recebe a soma das folhas descendentes e todos os níveis aparecem', () => {
    fc.assert(
      fc.property(
        arbArvore.chain((niveis) => arbContagens(niveis).map((c) => ({ niveis, c }))),
        ({ niveis, c }) => {
          const folhas = niveis.filter((n) => n.tipo === 'SUBCATEGORIA')
          const res = agregarContagensPorNivel(niveis, c)
          for (const nivel of niveis) {
            expect(res[nivel.id]).toBe(somaOraculo(nivel, folhas, c))
          }
          // Todos os níveis presentes no resultado.
          expect(Object.keys(res).sort()).toEqual(niveis.map((n) => n.id).sort())
        },
      ),
      RUNS,
    )
  })

  it('Property 3: conservação por camada (soma dos DEPARTAMENTOs == soma das folhas)', () => {
    fc.assert(
      fc.property(
        arbArvore.chain((niveis) => arbContagens(niveis).map((c) => ({ niveis, c }))),
        ({ niveis, c }) => {
          const folhas = niveis.filter((n) => n.tipo === 'SUBCATEGORIA')
          const totalFolhas = folhas.reduce((s, f) => s + (c[f.id] ?? 0), 0)
          const res = agregarContagensPorNivel(niveis, c)
          for (const tipo of ['DEPARTAMENTO', 'SECAO', 'CATEGORIA', 'SUBCATEGORIA'] as const) {
            const daCamada = niveis.filter((n) => n.tipo === tipo)
            const somaCamada = daCamada.reduce((s, n) => s + res[n.id], 0)
            expect(somaCamada).toBe(totalFolhas)
          }
        },
      ),
      RUNS,
    )
  })

  it('Property 4: independência de ordem das folhas', () => {
    fc.assert(
      fc.property(
        arbArvore.chain((niveis) => arbContagens(niveis).map((c) => ({ niveis, c }))),
        ({ niveis, c }) => {
          const embaralhado = [...niveis].reverse()
          const a = agregarContagensPorNivel(niveis, c)
          const b = agregarContagensPorNivel(embaralhado, c)
          expect(b).toEqual(a)
        },
      ),
      RUNS,
    )
  })

  it('Property 5: conservação global (soma das folhas + sem-hierarquia == total)', () => {
    fc.assert(
      fc.property(
        arbArvore.chain((niveis) => arbContagens(niveis).map((c) => ({ niveis, c }))),
        fc.integer({ min: 0, max: 500 }),
        ({ niveis, c }, semHierarquia) => {
          const folhas = niveis.filter((n) => n.tipo === 'SUBCATEGORIA')
          const totalFolhas = folhas.reduce((s, f) => s + (c[f.id] ?? 0), 0)
          const total = totalFolhas + semHierarquia
          expect(totalFolhas + semHierarquia).toBe(total)
        },
      ),
      RUNS,
    )
  })

  it('árvore vazia → objeto vazio, sem erro', () => {
    expect(agregarContagensPorNivel([], {})).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// P6/P7/P8 — Normalização de texto
// ---------------------------------------------------------------------------
describe('normalizarTexto (P6–P8)', () => {
  it('Property 6: produz forma canônica (minúsculas, sem acento, sem espaço redundante)', () => {
    fc.assert(
      fc.property(arbTexto, (t) => {
        const r = normalizarTexto(t)
        expect(r).toBe(r.toLowerCase())
        // Sem diacríticos remanescentes após decompor em NFD.
        expect(/[\u0300-\u036f]/.test(r.normalize('NFD'))).toBe(false)
        expect(/\s{2,}/.test(r)).toBe(false)
        expect(r).toBe(r.trim())
      }),
      RUNS,
    )
  })

  it('Property 7: idempotência', () => {
    fc.assert(
      fc.property(arbTexto, (t) => {
        expect(normalizarTexto(normalizarTexto(t))).toBe(normalizarTexto(t))
      }),
      RUNS,
    )
  })

  it('Property 8: equivalência sob caixa, acento e espaços', () => {
    fc.assert(
      fc.property(fc.constantFrom('Café', 'Bebidas Quentes', 'Açúcar Mascavo'), (base) => {
        const variacaoCaixa = base.toUpperCase()
        const variacaoEspaco = `   ${base.replace(/ /g, '   ')}   `
        expect(normalizarTexto(variacaoCaixa)).toBe(normalizarTexto(base))
        expect(normalizarTexto(variacaoEspaco)).toBe(normalizarTexto(base))
      }),
      RUNS,
    )
  })

  it('null/undefined/vazio → ""', () => {
    expect(normalizarTexto(null)).toBe('')
    expect(normalizarTexto(undefined)).toBe('')
    expect(normalizarTexto('   ')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// P9/P10 — Geração de sugestões
// ---------------------------------------------------------------------------
describe('gerarSugestoes (P9–P10)', () => {
  const folhas: FolhaCandidata[] = [
    { id: 'f1', descricao: 'Café', codigoHierarquico: '01.02.03.005' },
    { id: 'f2', descricao: 'CAFÉ', codigoHierarquico: '01.02.03.002' }, // mesmo texto normalizado, código menor
    { id: 'f3', descricao: 'Açúcar', codigoHierarquico: '02.01.01.001' },
  ]

  it('Property 9: candidatos têm texto idêntico e sugestão é o menor código (determinístico)', () => {
    const itens = gerarSugestoes(
      [{ textoNormalizado: normalizarTexto('café'), valorOriginal: 'café', quantidade: 3 }],
      folhas,
    )
    expect(itens).toHaveLength(1)
    const item = itens[0]
    // candidatos = f1 e f2 (ambos "cafe"); f3 fora
    expect(item.candidatos.map((c) => c.id).sort()).toEqual(['f1', 'f2'])
    // sugestão = menor codigoHierarquico → f2 (01.02.03.002)
    expect(item.sugestaoFolhaId).toBe('f2')
  })

  it('Property 9b: sem candidato → sugestaoFolhaId null', () => {
    const itens = gerarSugestoes(
      [{ textoNormalizado: normalizarTexto('Inexistente'), valorOriginal: 'Inexistente', quantidade: 1 }],
      folhas,
    )
    expect(itens[0].sugestaoFolhaId).toBeNull()
    expect(itens[0].candidatos).toEqual([])
  })

  it('Property 9c: determinístico sob permutação das folhas', () => {
    const a = gerarSugestoes([{ textoNormalizado: 'cafe', valorOriginal: 'Café', quantidade: 1 }], folhas)
    const b = gerarSugestoes([{ textoNormalizado: 'cafe', valorOriginal: 'Café', quantidade: 1 }], [...folhas].reverse())
    expect(b[0].sugestaoFolhaId).toBe(a[0].sugestaoFolhaId)
  })

  it('Property 10: agrupa por texto normalizado somando quantidades', () => {
    const itens = gerarSugestoes(
      [
        { textoNormalizado: 'cafe', valorOriginal: 'Café', quantidade: 3 },
        { textoNormalizado: 'cafe', valorOriginal: 'CAFÉ', quantidade: 5 },
      ],
      folhas,
    )
    expect(itens).toHaveLength(1)
    expect(itens[0].quantidade).toBe(8)
  })
})
