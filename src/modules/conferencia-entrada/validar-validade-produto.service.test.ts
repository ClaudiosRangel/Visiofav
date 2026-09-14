import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  validarValidadeProduto,
  type ValidacaoValidadeInput,
} from './validar-validade-produto.service'

/**
 * Testes property-based do helper puro `validarValidadeProduto`.
 *
 * Cobrem as propriedades de correção P1–P5 do design
 * (.kiro/specs/conferencia-validade-produto/design.md → "Correctness Properties").
 *
 * A lógica de "dias restantes" segue o mesmo cálculo de `shelf-life.service.ts`
 * (Math.floor da diferença de dias de calendário, ignorando hora) e a
 * normalização por dia de `validade.service.ts` (verificarProdutoVencido).
 *
 * Para controlar `diasRestantes` de forma determinística, a validade é sempre
 * construída como (parte de data de `dataAtual`) + N dias de calendário, de modo
 * que `diasRestantes === N` independentemente da componente de horário.
 */

// Soma N dias de calendário à parte de DATA de `base`, gerando um Date local
// (zera implicitamente o efeito da hora ao usar o construtor ano/mês/dia).
function adicionarDiasCalendario(base: Date, dias: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + dias)
}

// Gerador de datas "atuais" arbitrárias (com componente de horário variada),
// dentro de uma janela ampla mas segura para aritmética de datas.
const arbDataAtual = fc
  .date({ min: new Date(2000, 0, 1), max: new Date(2100, 11, 31) })
  .filter((d) => !Number.isNaN(d.getTime()))

// shelfLifeMinimo: null ou inteiro >= 0 (inclui valores grandes).
const arbShelfLife = fc.oneof(
  fc.constant<number | null>(null),
  fc.integer({ min: 0, max: 3650 }),
)

const arbProdutoNome = fc.string({ minLength: 0, maxLength: 40 })

describe('validarValidadeProduto (property-based)', () => {
  // P1 — Vencido nunca aprova
  // Para qualquer validade <= dataAtual (comparando por dia), o resultado é
  // aprovado: false com bloqueio 'PRODUTO_VENCIDO', para qualquer shelfLifeMinimo
  // (inclusive null e valores grandes).
  // **Validates: Requirements 1.1**
  it('P1 — validade vencida (<= hoje) nunca aprova, bloqueia PRODUTO_VENCIDO', () => {
    fc.assert(
      fc.property(
        arbDataAtual,
        // N <= 0 → validade no passado ou hoje (vencido, pois a regra é <=)
        fc.integer({ min: -3650, max: 0 }),
        arbShelfLife,
        arbProdutoNome,
        (dataAtual, diasOffset, shelfLifeMinimo, produtoNome) => {
          const input: ValidacaoValidadeInput = {
            validadeDigitada: adicionarDiasCalendario(dataAtual, diasOffset),
            shelfLifeMinimo,
            dataAtual,
            produtoNome,
          }
          const r = validarValidadeProduto(input)
          expect(r.aprovado).toBe(false)
          if (r.aprovado === false) {
            expect(r.bloqueio).toBe('PRODUTO_VENCIDO')
          }
        },
      ),
    )
  })

  // P2 — Shelf life curto nunca aprova (se não vencido)
  // Para validade > dataAtual mas diasRestantes < shelfLifeMinimo, o resultado é
  // aprovado: false com bloqueio 'SHELF_LIFE'.
  // **Validates: Requirements 1.2**
  it('P2 — validade não vencida porém com dias restantes < shelfLifeMinimo bloqueia SHELF_LIFE', () => {
    fc.assert(
      fc.property(
        arbDataAtual,
        arbProdutoNome,
        // shelfLifeMinimo >= 2 para existir ao menos um N em [1, shelfLifeMinimo - 1]
        fc.integer({ min: 2, max: 3650 }),
        fc.integer({ min: 0, max: 3649 }),
        (dataAtual, produtoNome, shelfLifeMinimo, seed) => {
          // N em [1, shelfLifeMinimo - 1] → não vencido, mas abaixo do mínimo
          const n = 1 + (seed % (shelfLifeMinimo - 1))
          const input: ValidacaoValidadeInput = {
            validadeDigitada: adicionarDiasCalendario(dataAtual, n),
            shelfLifeMinimo,
            dataAtual,
            produtoNome,
          }
          const r = validarValidadeProduto(input)
          expect(r.aprovado).toBe(false)
          if (r.aprovado === false) {
            expect(r.bloqueio).toBe('SHELF_LIFE')
          }
        },
      ),
    )
  })

  // P3 — Validade adequada sempre aprova
  // Para validade > dataAtual com diasRestantes >= shelfLifeMinimo (ou shelfLifeMinimo
  // nulo), o resultado é aprovado: true.
  // **Validates: Requirements 1.3**
  it('P3 — validade não vencida com dias restantes >= shelfLifeMinimo (ou nulo) aprova', () => {
    fc.assert(
      fc.property(
        arbDataAtual,
        arbProdutoNome,
        arbShelfLife,
        // diasExtra >= 0: N = max(shelfLifeMinimo, 1) + diasExtra garante N >= 1 e N >= shelfLifeMinimo
        fc.integer({ min: 0, max: 3650 }),
        (dataAtual, produtoNome, shelfLifeMinimo, diasExtra) => {
          const base = shelfLifeMinimo === null ? 1 : Math.max(shelfLifeMinimo, 1)
          const n = base + diasExtra
          const input: ValidacaoValidadeInput = {
            validadeDigitada: adicionarDiasCalendario(dataAtual, n),
            shelfLifeMinimo,
            dataAtual,
            produtoNome,
          }
          const r = validarValidadeProduto(input)
          expect(r.aprovado).toBe(true)
        },
      ),
    )
  })

  // P4 — Independência da NF-e
  // O resultado nunca depende da validade da NF-e: o input não possui campo de
  // validade da NF-e (garantido estruturalmente pelo tipo). Teste documental:
  // o mesmo input produz o mesmo resultado de forma determinística, e não há
  // qualquer canal para injetar a validade da NF-e.
  // **Validates: Requirements 2.1**
  it('P4 — resultado independe da NF-e (tipo de entrada não a inclui) e é determinístico', () => {
    fc.assert(
      fc.property(
        arbDataAtual,
        fc.integer({ min: -3650, max: 3650 }),
        arbShelfLife,
        arbProdutoNome,
        (dataAtual, diasOffset, shelfLifeMinimo, produtoNome) => {
          const input: ValidacaoValidadeInput = {
            validadeDigitada: adicionarDiasCalendario(dataAtual, diasOffset),
            shelfLifeMinimo,
            dataAtual,
            produtoNome,
          }
          const r1 = validarValidadeProduto({ ...input })
          const r2 = validarValidadeProduto({ ...input })
          expect(r2).toEqual(r1)
          // Garantia estrutural: as chaves do input são exatamente estas — não há
          // campo de validade da NF-e a considerar.
          expect(Object.keys(input).sort()).toEqual(
            ['dataAtual', 'produtoNome', 'shelfLifeMinimo', 'validadeDigitada'].sort(),
          )
        },
      ),
    )
  })

  // P5 — Validade nula aprova
  // validadeDigitada == null → aprovado: true, para qualquer shelfLifeMinimo.
  // **Validates: Requirements 3.1**
  it('P5 — validade nula sempre aprova, para qualquer shelfLifeMinimo', () => {
    fc.assert(
      fc.property(arbShelfLife, arbDataAtual, arbProdutoNome, (shelfLifeMinimo, dataAtual, produtoNome) => {
        const input: ValidacaoValidadeInput = {
          validadeDigitada: null,
          shelfLifeMinimo,
          dataAtual,
          produtoNome,
        }
        const r = validarValidadeProduto(input)
        expect(r.aprovado).toBe(true)
      }),
    )
  })
})
