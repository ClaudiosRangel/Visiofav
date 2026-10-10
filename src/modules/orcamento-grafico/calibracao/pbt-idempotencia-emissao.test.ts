// Feature: orcamento-grafico-op-relatorio-paridade, Property 10: idempotência da emissão de OP — decidirEmissao retorna 'idempotente' quando já existe OP, a reserva atual == a desejada e não há forçar reemissão; a 2ª aplicação sem mudança nunca duplica nem altera a OP.
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * PBT — Property 10 (Valida Req 16.6): IDEMPOTÊNCIA DA EMISSÃO DE OP.
 *
 * `emitirOpDoCalculo` não é pura (toca Prisma/transação). Conforme a task 33,
 * modelamos aqui a REGRA de decisão pura espelhando exatamente a lógica real de
 * `orcamento-grafico-op.service.ts`:
 *
 *   // 2a. IDEMPOTÊNCIA (Req 16.6)
 *   if (opExistente && !opcoes.forcarReemissao && opExistente.opReserva === opReservaDesejada)
 *       → retorna sem alterar (idempotente)
 *   else if (!opExistente) → cria (1ª emissão)
 *   else → reemite (incrementa revisão)
 *
 * Provamos:
 *   (a) decidirEmissao reproduz essa tabela de decisão para qualquer estado;
 *   (b) a 2ª aplicação SEM mudança (mesmo estado, mesmas opções) é sempre
 *       'idempotente' quando já há OP.
 */

interface EstadoEmissao {
  temOp: boolean
  opReservaAtual: boolean
}
interface OpcoesEmissao {
  opReserva: boolean
  forcarReemissao?: boolean
}

type Decisao = 'criar' | 'reemitir' | 'idempotente'

/** Regra pura espelhando a decisão de `emitirOpDoCalculo`. */
function decidirEmissao(estado: EstadoEmissao, opcoes: OpcoesEmissao): Decisao {
  if (!estado.temOp) return 'criar'
  const idempotente =
    !opcoes.forcarReemissao && estado.opReservaAtual === opcoes.opReserva
  return idempotente ? 'idempotente' : 'reemitir'
}

const arbEstado = fc.record({
  temOp: fc.boolean(),
  opReservaAtual: fc.boolean(),
}) satisfies fc.Arbitrary<EstadoEmissao>

const arbOpcoes = fc.record({
  opReserva: fc.boolean(),
  forcarReemissao: fc.option(fc.boolean(), { nil: undefined }),
}) satisfies fc.Arbitrary<OpcoesEmissao>

describe('PBT — Property 10: idempotência da emissão de OP', () => {
  it('decidirEmissao reproduz a tabela de decisão real', () => {
    fc.assert(
      fc.property(arbEstado, arbOpcoes, (estado, opcoes) => {
        const d = decidirEmissao(estado, opcoes)
        if (!estado.temOp) {
          expect(d).toBe('criar')
        } else if (!opcoes.forcarReemissao && estado.opReservaAtual === opcoes.opReserva) {
          expect(d).toBe('idempotente')
        } else {
          expect(d).toBe('reemitir')
        }
      }),
      { numRuns: 200 },
    )
  })

  it('2ª aplicação sem mudança → idempotente (OP já existe, mesma reserva, sem forçar)', () => {
    fc.assert(
      fc.property(fc.boolean(), (reserva) => {
        // 1ª emissão: não existe OP ainda → cria.
        const estado0: EstadoEmissao = { temOp: false, opReservaAtual: reserva }
        const opcoes: OpcoesEmissao = { opReserva: reserva, forcarReemissao: false }
        expect(decidirEmissao(estado0, opcoes)).toBe('criar')

        // Após criar, o estado reflete a OP com a reserva desejada.
        const estado1: EstadoEmissao = { temOp: true, opReservaAtual: reserva }
        // 2ª aplicação idêntica → idempotente (nada duplica/altera).
        expect(decidirEmissao(estado1, opcoes)).toBe('idempotente')
        // E permanece idempotente em qualquer reaplicação subsequente.
        expect(decidirEmissao(estado1, opcoes)).toBe('idempotente')
      }),
      { numRuns: 100 },
    )
  })

  it('forçar reemissão OU reserva divergente → reemitir (não idempotente)', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (reservaAtual, reservaDesejada) => {
        const estado: EstadoEmissao = { temOp: true, opReservaAtual: reservaAtual }
        // Forçar sempre reemite.
        expect(decidirEmissao(estado, { opReserva: reservaAtual, forcarReemissao: true })).toBe(
          'reemitir',
        )
        // Reserva divergente sem forçar → reemite.
        if (reservaAtual !== reservaDesejada) {
          expect(decidirEmissao(estado, { opReserva: reservaDesejada })).toBe('reemitir')
        }
      }),
      { numRuns: 100 },
    )
  })
})
