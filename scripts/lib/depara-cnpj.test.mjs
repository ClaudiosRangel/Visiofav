/**
 * Testes das funções puras de de-para por CNPJ (Properties 9 e 10 da spec
 * orcamento-grafico-paridade-total-calcgraf).
 *
 * Rodar: npx vitest run scripts/lib/depara-cnpj.test.mjs
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { normalizarCnpj, casarCliente } from './depara-cnpj.mjs'

describe('normalizarCnpj (Property 9 — normalização de CNPJ)', () => {
  it('mantém apenas os dígitos', () => {
    expect(normalizarCnpj('12.345.678/0001-90')).toBe('12345678000190')
    expect(normalizarCnpj('12345678000190')).toBe('12345678000190')
    expect(normalizarCnpj(' 12 345 678/0001-90 ')).toBe('12345678000190')
  })

  it('trata nulo/indefinido/vazio como string vazia', () => {
    expect(normalizarCnpj(null)).toBe('')
    expect(normalizarCnpj(undefined)).toBe('')
    expect(normalizarCnpj('')).toBe('')
    expect(normalizarCnpj('abc')).toBe('')
  })

  it('Property 9: formatações diferentes do MESMO documento casam', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[0-9]{14}$/),
        fc.array(fc.constantFrom('.', '/', '-', ' ')),
        (digitos, separadores) => {
          // Intercala separadores arbitrários entre os dígitos.
          let formatado = ''
          for (let i = 0; i < digitos.length; i++) {
            formatado += digitos[i]
            if (separadores[i % separadores.length]) formatado += separadores[i % separadores.length]
          }
          return normalizarCnpj(formatado) === digitos
        },
      ),
    )
  })

  it('Property 9: idempotência (normalizar o já normalizado não muda)', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const uma = normalizarCnpj(s)
        return normalizarCnpj(uma) === uma
      }),
    )
  })
})

describe('casarCliente (Property 10 — ambiguidade ⇒ vazio)', () => {
  it('retorna o id quando há EXATAMENTE 1 candidato', () => {
    expect(casarCliente('12345678000190', ['id-1'])).toBe('id-1')
    expect(
      casarCliente('12345678000190', [{ id: 'id-1', cpfCnpj: '12.345.678/0001-90' }]),
    ).toBe('id-1')
  })

  it('retorna null quando há 0 candidatos', () => {
    expect(casarCliente('12345678000190', [])).toBeNull()
    expect(casarCliente('12345678000190', null)).toBeNull()
  })

  it('retorna null quando há 2+ candidatos', () => {
    expect(casarCliente('12345678000190', ['id-1', 'id-2'])).toBeNull()
    expect(
      casarCliente('12345678000190', [
        { id: 'id-1', cpfCnpj: '12345678000190' },
        { id: 'id-2', cpfCnpj: '12345678000190' },
      ]),
    ).toBeNull()
  })

  it('filtra candidatos por CNPJ quando o objeto traz documento', () => {
    const candidatos = [
      { id: 'id-1', cpfCnpj: '12.345.678/0001-90' },
      { id: 'id-2', cpfCnpj: '99.999.999/9999-99' },
    ]
    // Só 1 casa com o alvo ⇒ retorna esse id.
    expect(casarCliente('12345678000190', candidatos)).toBe('id-1')
  })

  it('aceita o campo cpf_cnpj (snake_case) além de cpfCnpj', () => {
    expect(casarCliente('12345678000190', [{ id: 'id-1', cpf_cnpj: '12345678000190' }])).toBe(
      'id-1',
    )
  })

  it('Property 10: a cardinalidade dos elegíveis decide (1 ⇒ id, senão null)', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[0-9]{14}$/),
        fc.integer({ min: 0, max: 5 }),
        (cnpj, qtd) => {
          const candidatos = Array.from({ length: qtd }, (_, i) => ({ id: `id-${i}`, cpfCnpj: cnpj }))
          const r = casarCliente(cnpj, candidatos)
          return qtd === 1 ? r === 'id-0' : r === null
        },
      ),
    )
  })
})
