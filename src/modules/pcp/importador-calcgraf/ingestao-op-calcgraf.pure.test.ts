import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  normalizarOpParaHash,
  calcularHashOp,
  classificarIngestao,
  type OpOrigemDTO,
  type ItemOpOrigemDTO,
  type EtapaOpOrigemDTO,
  type LoteOpOrigemDTO,
  type OpDestinoResumo,
  type ResultadoIngestao,
} from './ingestao-op-calcgraf.pure'

/**
 * Testes das funções puras de ingestão de OP do Calcgraf
 * (.kiro/specs/importador-op-calcgraf). Validam as Correctness Properties do
 * design (seção "Correctness Properties"):
 *  - Property 1 — Hash determinístico / ordem-insensível (Requirement 2.2)
 *  - Property 2 — Idempotência de ingestão via classificar (Requirement 8.1)
 *  - Property 3 — Identidade por número (Requirements 2.3, 4.1)
 *  - Property 4 — Não-regressão de produção (Requirement 5.2)
 *  - Property 7 — tabela-verdade determinística de classificarIngestao
 *
 * Vitest + fast-check, sem mocks (funções puras, sem Prisma/IO).
 */

// ---------------------------------------------------------------------------
// Geradores (fast-check)
// ---------------------------------------------------------------------------

/**
 * String "textual" que sobrevive à normalização (trim) sem virar null: garante
 * ao menos um caractere não-branco. Evita que o gerador produza "   " (que
 * normaliza para null) e crie falsos conteúdos distintos.
 */
const textoNaoVazio = fc
  .string({ minLength: 1, maxLength: 20 })
  .map((s) => `x${s}`) // prefixo garante conteúdo não-branco após trim

const numeroFinito = fc.double({
  min: -1_000_000,
  max: 10_000_000,
  noNaN: true,
  noDefaultInfinity: true,
})

const itemGen: fc.Arbitrary<ItemOpOrigemDTO> = fc.record(
  {
    item: fc.integer({ min: 1, max: 999 }),
    codItemEstoque: textoNaoVazio,
    descricao: textoNaoVazio,
    quantidade: numeroFinito,
    unidadeMedida: fc.constantFrom('UN', 'KG', 'FL', 'MI'),
    status: fc.constantFrom('ATIVO', 'PENDENTE', 'OK'),
  },
  { requiredKeys: [] },
)

const etapaGen: fc.Arbitrary<EtapaOpOrigemDTO> = fc.record(
  {
    sequencia: fc.integer({ min: 1, max: 99 }),
    centro: textoNaoVazio,
    descricao: textoNaoVazio,
    status: fc.constantFrom('PENDENTE', 'EM_ANDAMENTO', 'CONCLUIDA'),
  },
  { requiredKeys: [] },
)

const loteGen: fc.Arbitrary<LoteOpOrigemDTO> = fc.record(
  {
    tiragem: fc.integer({ min: 1, max: 5_000_000 }),
    dataPrometida: fc.constantFrom('2026-01-15', '2026-02-20', '2026-03-30'),
    ordemFila: fc.integer({ min: 1, max: 50 }),
    status: fc.constantFrom('PENDENTE', 'PRODUZIDO'),
  },
  { requiredKeys: [] },
)

const opGen: fc.Arbitrary<OpOrigemDTO> = fc.record(
  {
    numero: fc.integer({ min: 1, max: 999_999 }),
    descricao: textoNaoVazio,
    dataEmissao: fc.constantFrom('2026-01-01', '2026-05-10'),
    produtoNome: textoNaoVazio,
    produtoCodigo: textoNaoVazio,
    clienteNome: textoNaoVazio,
    quantidade: numeroFinito,
    dataEntrega: fc.constantFrom('2026-02-01', '2026-06-10'),
    tiragem: fc.integer({ min: 1, max: 5_000_000 }),
    itens: fc.array(itemGen, { maxLength: 6 }),
    etapas: fc.array(etapaGen, { maxLength: 6 }),
    lotes: fc.array(loteGen, { maxLength: 4 }),
  },
  { requiredKeys: ['numero', 'descricao'] },
)

/** Embaralha um array de forma determinística a partir de uma permutação. */
function embaralharCom<T>(arr: T[], seed: number): T[] {
  const copia = [...arr]
  // Fisher–Yates com PRNG simples (mulberry32) semeado pelo `seed`.
  let a = seed >>> 0
  const rnd = () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[copia[i], copia[j]] = [copia[j], copia[i]]
  }
  return copia
}

// ---------------------------------------------------------------------------
// Property 1 — Hash determinístico / ordem-insensível
// ---------------------------------------------------------------------------

describe('calcularHashOp — Property 1 (determinístico / ordem-insensível)', () => {
  // Feature: importador-op-calcgraf, Property 1: Hash determinístico
  // Validates: Requirements 2.2
  it('mesma entrada chamada duas vezes produz o mesmo hash', () => {
    fc.assert(
      fc.property(opGen, (op) => {
        expect(calcularHashOp(op)).toBe(calcularHashOp(op))
      }),
      { numRuns: 200 },
    )
  })

  // Feature: importador-op-calcgraf, Property 1: Hash determinístico
  // Validates: Requirements 2.2
  it('embaralhar a ordem dos arrays filhos (itens/etapas/lotes) NÃO muda o hash', () => {
    fc.assert(
      fc.property(opGen, fc.integer({ min: 1, max: 1_000_000 }), (op, seed) => {
        const embaralhada: OpOrigemDTO = {
          ...op,
          itens: embaralharCom(op.itens ?? [], seed),
          etapas: embaralharCom(op.etapas ?? [], seed * 7 + 1),
          lotes: embaralharCom(op.lotes ?? [], seed * 13 + 3),
        }
        expect(calcularHashOp(embaralhada)).toBe(calcularHashOp(op))
      }),
      { numRuns: 300 },
    )
  })

  // Feature: importador-op-calcgraf, Property 1: Hash determinístico
  // Validates: Requirements 2.2
  it('normalizarOpParaHash é estável sob reordenação dos filhos', () => {
    fc.assert(
      fc.property(opGen, (op) => {
        const invertida: OpOrigemDTO = {
          ...op,
          itens: [...(op.itens ?? [])].reverse(),
          etapas: [...(op.etapas ?? [])].reverse(),
          lotes: [...(op.lotes ?? [])].reverse(),
        }
        expect(normalizarOpParaHash(invertida)).toBe(normalizarOpParaHash(op))
      }),
      { numRuns: 200 },
    )
  })
})

// ---------------------------------------------------------------------------
// Hash sensível a conteúdo (mudar campo relevante muda o hash)
// ---------------------------------------------------------------------------

describe('calcularHashOp — sensível a conteúdo', () => {
  // Validates: Requirements 2.2
  it('alterar a descrição (valor realmente diferente) muda o hash', () => {
    fc.assert(
      fc.property(opGen, textoNaoVazio, (op, novaDescricao) => {
        fc.pre(novaDescricao.trim() !== op.descricao.trim())
        const alterada: OpOrigemDTO = { ...op, descricao: novaDescricao }
        expect(calcularHashOp(alterada)).not.toBe(calcularHashOp(op))
      }),
      { numRuns: 200 },
    )
  })

  // Validates: Requirements 2.2
  it('alterar a quantidade (valor realmente diferente após normalização) muda o hash', () => {
    fc.assert(
      fc.property(opGen, (op) => {
        const base = op.quantidade ?? 0
        // Delta >= 0.01 garante diferença após a precisão fixa (4 casas).
        const alterada: OpOrigemDTO = { ...op, quantidade: base + 12345.6789 }
        expect(calcularHashOp(alterada)).not.toBe(calcularHashOp(op))
      }),
      { numRuns: 200 },
    )
  })

  // Validates: Requirements 2.2
  it('acrescentar um item muda o hash', () => {
    fc.assert(
      fc.property(opGen, (op) => {
        const novoItem: ItemOpOrigemDTO = {
          item: 1000,
          codItemEstoque: 'NOVO-COMPONENTE-UNICO',
          descricao: 'componente adicional unico',
          quantidade: 42,
          unidadeMedida: 'KG',
          status: 'ATIVO',
        }
        const alterada: OpOrigemDTO = { ...op, itens: [...(op.itens ?? []), novoItem] }
        expect(calcularHashOp(alterada)).not.toBe(calcularHashOp(op))
      }),
      { numRuns: 200 },
    )
  })

  it('exemplo concreto: numero diferente → hash diferente', () => {
    const a: OpOrigemDTO = { numero: 3138, descricao: 'Caixa X' }
    const b: OpOrigemDTO = { numero: 3137, descricao: 'Caixa X' }
    expect(calcularHashOp(a)).not.toBe(calcularHashOp(b))
  })

  it('exemplo concreto: trim e precisão não geram falsa diferença', () => {
    const a: OpOrigemDTO = { numero: 10, descricao: '  Caixa  ', quantidade: 1 }
    const b: OpOrigemDTO = { numero: 10, descricao: 'Caixa', quantidade: 1.0 }
    expect(calcularHashOp(a)).toBe(calcularHashOp(b))
  })
})

// ---------------------------------------------------------------------------
// classificarIngestao — tabela-verdade (determinística)
// ---------------------------------------------------------------------------

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

function destino(partial: Partial<OpDestinoResumo>): OpDestinoResumo {
  return {
    existe: partial.existe ?? true,
    hashSalvo: partial.hashSalvo ?? null,
    statusFinalizado: partial.statusFinalizado ?? false,
    temProducao: partial.temProducao ?? false,
  }
}

describe('classificarIngestao — tabela-verdade (it.each)', () => {
  const casos: Array<{
    nome: string
    destino: OpDestinoResumo
    hashRecebido: string
    esperado: ResultadoIngestao
  }> = [
    // Property 3 — Identidade por número: não existe ⇒ sempre criada.
    {
      nome: 'não existe ⇒ criada (hash qualquer)',
      destino: destino({ existe: false }),
      hashRecebido: HASH_A,
      esperado: 'criada',
    },
    {
      nome: 'não existe, com flags ruidosas ⇒ criada',
      destino: destino({ existe: false, statusFinalizado: true, temProducao: true, hashSalvo: HASH_A }),
      hashRecebido: HASH_A,
      esperado: 'criada',
    },
    // Proteção finalizada tem precedência sobre hash/produção.
    {
      nome: 'existe + finalizada + hash difere + produção ⇒ ignorada (proteção)',
      destino: destino({ existe: true, statusFinalizado: true, hashSalvo: HASH_A, temProducao: true }),
      hashRecebido: HASH_B,
      esperado: 'ignorada',
    },
    {
      nome: 'existe + finalizada + sem hash salvo ⇒ ignorada (proteção)',
      destino: destino({ existe: true, statusFinalizado: true, hashSalvo: null }),
      hashRecebido: HASH_B,
      esperado: 'ignorada',
    },
    // Property 2 — Idempotência: hash igual ⇒ ignorada.
    {
      nome: 'existe + hash igual ⇒ ignorada (idempotência)',
      destino: destino({ existe: true, hashSalvo: HASH_A, temProducao: false }),
      hashRecebido: HASH_A,
      esperado: 'ignorada',
    },
    {
      nome: 'existe + hash igual + com produção (não finalizada) ⇒ ignorada',
      destino: destino({ existe: true, hashSalvo: HASH_A, temProducao: true }),
      hashRecebido: HASH_A,
      esperado: 'ignorada',
    },
    // Atualizada: hash difere + sem produção + não finalizada.
    {
      nome: 'existe + hash difere + sem produção ⇒ atualizada',
      destino: destino({ existe: true, hashSalvo: HASH_A, temProducao: false }),
      hashRecebido: HASH_B,
      esperado: 'atualizada',
    },
    {
      nome: 'existe + sem hash salvo (null) + sem produção ⇒ atualizada',
      destino: destino({ existe: true, hashSalvo: null, temProducao: false }),
      hashRecebido: HASH_B,
      esperado: 'atualizada',
    },
    // Property 4 — Não-regressão: hash difere + com produção ⇒ pendente.
    {
      nome: 'existe + hash difere + com produção ⇒ pendente',
      destino: destino({ existe: true, hashSalvo: HASH_A, temProducao: true }),
      hashRecebido: HASH_B,
      esperado: 'pendente',
    },
    {
      nome: 'existe + sem hash salvo (null) + com produção ⇒ pendente',
      destino: destino({ existe: true, hashSalvo: null, temProducao: true }),
      hashRecebido: HASH_B,
      esperado: 'pendente',
    },
  ]

  it.each(casos)('$nome', ({ destino: d, hashRecebido, esperado }) => {
    expect(classificarIngestao(d, hashRecebido)).toBe(esperado)
  })
})

// ---------------------------------------------------------------------------
// Properties com fast-check gerando os booleans/hash
// ---------------------------------------------------------------------------

/** Gerador de hash hex de 64 chars (sha256) — fast-check v4 removeu hexaString. */
const hashGen: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...'0123456789abcdef'.split('')), { minLength: 64, maxLength: 64 })
  .map((chars) => chars.join(''))

describe('classificarIngestao — Property 3 (identidade por número / não existe ⇒ criada)', () => {
  // Feature: importador-op-calcgraf, Property 3: Identidade por número
  // Validates: Requirements 2.3, 4.1
  it('existe=false ⇒ sempre "criada", quaisquer flags/hash', () => {
    fc.assert(
      fc.property(hashGen, fc.boolean(), fc.boolean(), fc.option(hashGen, { nil: null }), (
        hashRecebido,
        statusFinalizado,
        temProducao,
        hashSalvo,
      ) => {
        const d = destino({ existe: false, statusFinalizado, temProducao, hashSalvo })
        expect(classificarIngestao(d, hashRecebido)).toBe('criada')
      }),
      { numRuns: 300 },
    )
  })
})

describe('classificarIngestao — Property 2 (idempotência)', () => {
  // Feature: importador-op-calcgraf, Property 2: Idempotência de ingestão
  // Validates: Requirements 8.1
  it('existe + não finalizada + hashSalvo === hashRecebido ⇒ "ignorada" (qualquer temProducao)', () => {
    fc.assert(
      fc.property(hashGen, fc.boolean(), (hash, temProducao) => {
        const d = destino({ existe: true, statusFinalizado: false, hashSalvo: hash, temProducao })
        expect(classificarIngestao(d, hash)).toBe('ignorada')
      }),
      { numRuns: 300 },
    )
  })
})

describe('classificarIngestao — Property 4 (não-regressão com produção)', () => {
  // Feature: importador-op-calcgraf, Property 4: Não-regressão de produção
  // Validates: Requirements 5.2
  it('existe + hash difere + com produção + não finalizada ⇒ "pendente"', () => {
    fc.assert(
      fc.property(hashGen, hashGen, (hashSalvo, hashRecebido) => {
        fc.pre(hashSalvo !== hashRecebido)
        const d = destino({
          existe: true,
          statusFinalizado: false,
          temProducao: true,
          hashSalvo,
        })
        expect(classificarIngestao(d, hashRecebido)).toBe('pendente')
      }),
      { numRuns: 300 },
    )
  })
})

describe('classificarIngestao — proteção finalizada', () => {
  // Validates: Requirements 5.2 (proteção), design "OP finalizada ⇒ ignorada"
  it('existe + finalizada ⇒ sempre "ignorada" (mesmo com hash diferente / produção)', () => {
    fc.assert(
      fc.property(hashGen, hashGen, fc.boolean(), fc.option(hashGen, { nil: null }), (
        hashRecebido,
        _h,
        temProducao,
        hashSalvo,
      ) => {
        const d = destino({ existe: true, statusFinalizado: true, temProducao, hashSalvo })
        expect(classificarIngestao(d, hashRecebido)).toBe('ignorada')
      }),
      { numRuns: 300 },
    )
  })
})

describe('classificarIngestao — atualizada', () => {
  // Validates: Requirements 5.1
  it('existe + hash difere + sem produção + não finalizada ⇒ "atualizada"', () => {
    fc.assert(
      fc.property(hashGen, hashGen, (hashSalvo, hashRecebido) => {
        fc.pre(hashSalvo !== hashRecebido)
        const d = destino({
          existe: true,
          statusFinalizado: false,
          temProducao: false,
          hashSalvo,
        })
        expect(classificarIngestao(d, hashRecebido)).toBe('atualizada')
      }),
      { numRuns: 300 },
    )
  })

  // Property 7 — determinismo: a mesma entrada sempre produz o mesmo resultado.
  // Validates: Requirements 8.4
  it('é determinística (mesma entrada ⇒ mesmo resultado) para qualquer combinação', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.option(hashGen, { nil: null }),
        fc.boolean(),
        fc.boolean(),
        hashGen,
        (existe, hashSalvo, statusFinalizado, temProducao, hashRecebido) => {
          const d = destino({ existe, hashSalvo, statusFinalizado, temProducao })
          const r1 = classificarIngestao(d, hashRecebido)
          const r2 = classificarIngestao(d, hashRecebido)
          expect(r1).toBe(r2)
          expect(['criada', 'atualizada', 'pendente', 'ignorada']).toContain(r1)
        },
      ),
      { numRuns: 300 },
    )
  })
})
