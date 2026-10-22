// Property-based + example tests para o de-para do enriquecimento de engenharia.
// Spec: orcamento-repeticao-engenharia-completa (Task 9).
//
// As funções testadas aqui são PURAS (não tocam Prisma): são o núcleo do
// de-para por nome normalizado e por documento (CNPJ/CPF). As propriedades
// garantem as REGRAS DE OURO da feature:
//   - NUNCA inventa (match ambíguo ou ausente → undefined).
//   - De-para do cliente por CNPJ só dígitos (tolerante a máscara).
//   - Normalização estável (idempotente) e case/acento-insensível.
//
// Rodar: npx vitest run <arquivo> --reporter=dot  (reporter "basic" foi removido)

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  normalizarNome,
  normalizarDoc,
  matchUnicoPorNome,
  matchClientePorDoc,
} from './enriquecimento-engenharia.service'

describe('normalizarNome (puro)', () => {
  it('idempotente: normalizar(normalizar(x)) === normalizar(x)', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const uma = normalizarNome(s)
        expect(normalizarNome(uma)).toBe(uma)
      }),
    )
  })

  it('nunca contém acento, é maiúsculo e sem espaços duplicados/bordas', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const n = normalizarNome(s)
        expect(n).toBe(n.toUpperCase())
        expect(/[\u0300-\u036f]/.test(n)).toBe(false) // sem marcas de acento
        expect(/\s{2,}/.test(n)).toBe(false) // sem espaço duplo
        expect(n).toBe(n.trim()) // sem espaço nas bordas
      }),
    )
  })

  it('exemplos: case/acento/espaço colapsam para a mesma chave', () => {
    expect(normalizarNome('  Stora   Enzo ')).toBe('STORA ENZO')
    expect(normalizarNome('cartão  Triplex')).toBe('CARTAO TRIPLEX')
    expect(normalizarNome('KRÁFT')).toBe('KRAFT')
    expect(normalizarNome(null)).toBe('')
    expect(normalizarNome(undefined)).toBe('')
  })
})

describe('normalizarDoc (puro)', () => {
  it('resulta só em dígitos', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(/^\d*$/.test(normalizarDoc(s))).toBe(true)
      }),
    )
  })

  it('máscara não altera os dígitos (invariância a formatação)', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 14 }), (digs) => {
        const puro = digs.join('')
        // injeta separadores comuns de CNPJ/CPF em posições arbitrárias
        const mascarado = puro.replace(/(\d{2})(\d{3})?/, '$1.$2').replace(/(\d{3})(\d)/, '$1/$2')
        expect(normalizarDoc(mascarado)).toBe(normalizarDoc(puro))
      }),
    )
  })

  it('exemplos', () => {
    expect(normalizarDoc('23.787.041/0001-75')).toBe('23787041000175')
    expect(normalizarDoc(null)).toBe('')
  })
})

// Property 2 — NUNCA INVENTA
describe('matchUnicoPorNome — nunca inventa (Property 2)', () => {
  it('só resolve quando há EXATAMENTE um candidato com nome normalizado igual', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.array(fc.record({ id: fc.uuid(), nome: fc.string() }), { maxLength: 20 }),
        (alvo, candidatos) => {
          const r = matchUnicoPorNome(alvo, candidatos)
          const alvoNorm = normalizarNome(alvo)
          const casados = candidatos.filter((c) => normalizarNome(c.nome) === alvoNorm)
          if (casados.length === 1) {
            expect(r).toBeDefined()
            expect(r!.id).toBe(casados[0].id)
          } else {
            // 0 ou 2+ → undefined (vira pendência; jamais chuta)
            expect(r).toBeUndefined()
          }
        },
      ),
    )
  })

  it('alvo vazio/nulo nunca resolve, mesmo com candidatos', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ id: fc.uuid(), nome: fc.string() })), (candidatos) => {
        expect(matchUnicoPorNome('', candidatos)).toBeUndefined()
        expect(matchUnicoPorNome('   ', candidatos)).toBeUndefined()
        expect(matchUnicoPorNome(null, candidatos)).toBeUndefined()
      }),
    )
  })

  it('duplicata (2 candidatos iguais) → ambíguo → undefined', () => {
    const cands = [
      { id: 'a', nome: 'Stora Enzo' },
      { id: 'b', nome: 'STORA  ENZO' }, // normaliza igual
    ]
    expect(matchUnicoPorNome('stora enzo', cands)).toBeUndefined()
  })

  it('match único case/acento/espaço-insensível resolve', () => {
    const cands = [
      { id: 'x', nome: 'Cartão Triplex' },
      { id: 'y', nome: 'Kraft Senges' },
    ]
    const r = matchUnicoPorNome('  CARTAO   TRIPLEX ', cands)
    expect(r?.id).toBe('x')
  })
})

// Property 4 — CLIENTE POR CNPJ NORMALIZADO
describe('matchClientePorDoc — cliente por CNPJ normalizado (Property 4)', () => {
  it('casa pelo documento só-dígitos independente de máscara', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 14 }),
        (digs) => {
          const puro = digs.join('')
          const clientes = [
            { id: 'outro', cpfCnpj: '00000000000000' },
            { id: 'alvo', cpfCnpj: `${puro.slice(0, 2)}.${puro.slice(2)}` },
          ]
          // se o "outro" por acaso colidir com o alvo, ignora o caso
          if (normalizarDoc(clientes[0].cpfCnpj) === normalizarDoc(puro)) return
          const r = matchClientePorDoc(puro, clientes)
          expect(r?.id).toBe('alvo')
        },
      ),
    )
  })

  it('doc vazio/nulo nunca casa', () => {
    const clientes = [{ id: 'a', cpfCnpj: '23787041000175' }]
    expect(matchClientePorDoc('', clientes)).toBeUndefined()
    expect(matchClientePorDoc(null, clientes)).toBeUndefined()
  })

  it('sem casamento → undefined', () => {
    const clientes = [{ id: 'a', cpfCnpj: '11111111111111' }]
    expect(matchClientePorDoc('23.787.041/0001-75', clientes)).toBeUndefined()
  })

  it('exemplo real (Carton Wega)', () => {
    const clientes = [
      { id: 'wega', cpfCnpj: '23.787.041/0001-75' },
      { id: 'ruido', cpfCnpj: null },
    ]
    expect(matchClientePorDoc('23787041000175', clientes)?.id).toBe('wega')
  })
})
