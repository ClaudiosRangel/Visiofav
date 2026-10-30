// Property-based + exemplos da máquina de estados do Pedido/Proposta (RFQ).
// Spec comercial-pedido-proposta (Task 2.1). Rodar:
//   npx vitest run <arquivo> --reporter=dot

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  TRANSICOES,
  ESTADOS_VALIDOS,
  ESTADOS_COM_MOTIVO,
  validarTransicao,
  getTransicoesPermitidas,
  isTerminal,
  PedidoPropostaError,
  type EstadoProposta,
} from './pedido-proposta-estado.service'

const arbEstado = fc.constantFrom(...ESTADOS_VALIDOS)

describe('Máquina de estados do Pedido/Proposta', () => {
  // P1 — transição só é aceita se estiver no mapa
  it('P1: aceita ⟺ novo ∈ TRANSICOES[atual]', () => {
    fc.assert(
      fc.property(arbEstado, arbEstado, (atual, novo) => {
        const permitida = TRANSICOES[atual].includes(novo)
        if (permitida) {
          // destino PERDIDO/CANCELADO exige motivo — passamos um válido aqui
          const motivo = ESTADOS_COM_MOTIVO.includes(novo) ? 'motivo valido' : undefined
          expect(() => validarTransicao(atual, novo, motivo)).not.toThrow()
        } else {
          expect(() => validarTransicao(atual, novo, 'motivo valido')).toThrowError(PedidoPropostaError)
        }
      }),
    )
  })

  // P2 — estados terminais nunca transicionam
  it('P2: a partir de ACEITO/PERDIDO/CANCELADO toda transição é rejeitada', () => {
    const terminais: EstadoProposta[] = ['ACEITO', 'PERDIDO', 'CANCELADO']
    fc.assert(
      fc.property(fc.constantFrom(...terminais), arbEstado, (atual, novo) => {
        expect(() => validarTransicao(atual, novo, 'motivo valido')).toThrowError(PedidoPropostaError)
      }),
    )
  })

  // P3 — motivo obrigatório em PERDIDO/CANCELADO
  it('P3: transição válida p/ PERDIDO/CANCELADO exige motivo >= 5 chars', () => {
    // Pares válidos (atual, novo) cujo destino exige motivo
    const paresComMotivo: Array<[EstadoProposta, EstadoProposta]> = []
    for (const atual of ESTADOS_VALIDOS) {
      for (const novo of TRANSICOES[atual]) {
        if (ESTADOS_COM_MOTIVO.includes(novo)) paresComMotivo.push([atual, novo])
      }
    }
    expect(paresComMotivo.length).toBeGreaterThan(0)
    for (const [atual, novo] of paresComMotivo) {
      expect(() => validarTransicao(atual, novo, undefined)).toThrowError(/motivo/i)
      expect(() => validarTransicao(atual, novo, 'abc')).toThrowError(/motivo/i)
      expect(() => validarTransicao(atual, novo, 'motivo ok')).not.toThrow()
    }
  })

  // P3b — código correto nos erros
  it('P3b: códigos de erro ESTADO_TRANSICAO_INVALIDA e MOTIVO_OBRIGATORIO', () => {
    try {
      validarTransicao('ACEITO', 'NOVO')
    } catch (e) {
      expect((e as PedidoPropostaError).code).toBe('ESTADO_TRANSICAO_INVALIDA')
    }
    try {
      validarTransicao('NOVO', 'CANCELADO', '')
    } catch (e) {
      expect((e as PedidoPropostaError).code).toBe('MOTIVO_OBRIGATORIO')
    }
  })

  // P4 — pureza e isTerminal ⟺ lista vazia
  it('P4: getTransicoesPermitidas é pura e isTerminal ⟺ lista vazia', () => {
    fc.assert(
      fc.property(arbEstado, (e) => {
        const a = getTransicoesPermitidas(e)
        const b = getTransicoesPermitidas(e)
        expect(a).toEqual(b)
        expect(isTerminal(e)).toBe(a.length === 0)
      }),
    )
  })

  it('exemplos: fluxo feliz e terminais', () => {
    expect(getTransicoesPermitidas('NOVO')).toContain('EM_ANALISE')
    expect(getTransicoesPermitidas('EM_ANALISE')).toContain('ENVIADO_ORCAMENTO')
    expect(getTransicoesPermitidas('PROPOSTA_ENVIADA')).toContain('ACEITO')
    expect(isTerminal('ACEITO')).toBe(true)
    expect(isTerminal('PERDIDO')).toBe(true)
    expect(isTerminal('CANCELADO')).toBe(true)
    expect(isTerminal('NOVO')).toBe(false)
  })
})
