import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  soDigitos,
  normalizarNome,
  emailValido,
  derivarCpfVendedor,
  temDocumentoValido,
  camposEnderecoVazios,
} from './calcgraf-dedup'

/**
 * PBT — Property 4 (idempotência) e Property 5 (não-sobrescrita) do importador
 * de vendedores (spec orcamento-grafico-finalizacao, task 5.3).
 *
 * A idempotência e a não-sobrescrita do importador dependem exclusivamente das
 * funções puras de de-para/normalização testadas aqui. Se a chave de de-para é
 * determinística por linha, a 2ª execução casa com o mesmo registro (não
 * duplica); se os "campos faltantes" nunca incluem um campo já preenchido, o
 * enriquecimento nunca sobrescreve.
 */

const CAMPOS_END = ['logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'cep'] as const

describe('PBT — de-para/idempotência do importador (Property 4)', () => {
  it('derivarCpfVendedor é determinística: mesmo (doc, codigo) → mesma chave', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string(), { nil: undefined }),
        fc.integer({ min: 1, max: 999999 }),
        (doc, codigo) => {
          const a = derivarCpfVendedor(doc, codigo)
          const b = derivarCpfVendedor(doc, codigo)
          expect(a).toBe(b)
          // Chave sempre cabe no limite da coluna (14 chars)
          expect(a.length).toBeLessThanOrEqual(14)
          expect(a.length).toBeGreaterThan(0)
        },
      ),
      { numRuns: 500 },
    )
  })

  it('sem documento válido → placeholder SEM-DOC-<codigo> (único por código)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999999 }), (codigo) => {
        // documento vazio/curto → não é válido
        const cpf = derivarCpfVendedor('', codigo)
        expect(cpf).toBe(`SEM-DOC-${codigo}`.slice(0, 14))
        // Dois códigos diferentes → placeholders diferentes (não colidem a unique)
        const outro = derivarCpfVendedor('', codigo + 1)
        // (podem coincidir só se o slice(14) truncar ambos no mesmo prefixo —
        //  SEM-DOC- tem 8 chars, sobram 6 para o número: até 999999 cabe)
        if (codigo < 100000 && codigo + 1 < 100000) expect(cpf).not.toBe(outro)
      }),
      { numRuns: 500 },
    )
  })

  it('documento válido (11/14 dígitos) → usa o próprio doc como chave', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.stringMatching(/^[0-9]{11}$/),
          fc.stringMatching(/^[0-9]{14}$/),
        ),
        fc.integer({ min: 1, max: 999999 }),
        (doc, codigo) => {
          expect(temDocumentoValido(doc)).toBe(true)
          const cpf = derivarCpfVendedor(doc, codigo)
          expect(cpf).toBe(doc.trim().slice(0, 14))
          expect(cpf).not.toContain('SEM-DOC')
        },
      ),
      { numRuns: 300 },
    )
  })

  it('normalizarNome é idempotente e estável (chave de de-para por nome)', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const a = normalizarNome(s)
        const b = normalizarNome(a) // normalizar o já-normalizado não muda
        expect(b).toBe(a)
        // sem acentos, maiúsculo, sem espaços duplicados nas pontas
        expect(a).toBe(a.toUpperCase())
        expect(a).not.toMatch(/\s{2,}/)
        expect(a).toBe(a.trim())
      }),
      { numRuns: 500 },
    )
  })

  it('soDigitos remove tudo que não é dígito (determinístico)', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const d = soDigitos(s)
        expect(d).toMatch(/^[0-9]*$/)
        expect(soDigitos(d)).toBe(d)
      }),
      { numRuns: 500 },
    )
  })

  it('emailValido só aceita formato de e-mail; idempotente', () => {
    fc.assert(
      fc.property(fc.emailAddress(), (e) => {
        const v = emailValido(e)
        expect(v).toBe(e.trim().toLowerCase())
      }),
      { numRuns: 300 },
    )
    // qualquer string sem "@...." não é válida
    fc.assert(
      fc.property(fc.string().filter((s) => !/@.+\./.test(s)), (s) => {
        expect(emailValido(s)).toBeNull()
      }),
      { numRuns: 300 },
    )
  })
})

describe('PBT — não-sobrescrita no enriquecimento (Property 5)', () => {
  // Gera um "existente" (registro no banco) e um "novo" (dado do Calcgraf).
  const arbCampo = fc.oneof(
    fc.constant<string | null | undefined>(null),
    fc.constant<string | null | undefined>(undefined),
    fc.constant<string | null | undefined>(''),
    fc.string({ minLength: 1, maxLength: 40 }),
  )
  const arbRegistro = fc.record(Object.fromEntries(CAMPOS_END.map((k) => [k, arbCampo])) as Record<string, typeof arbCampo>)
  const arbNovo = fc.record(Object.fromEntries(CAMPOS_END.map((k) => [k, arbCampo])) as Record<string, typeof arbCampo>)

  it('faltantes NUNCA inclui um campo já preenchido no existente', () => {
    fc.assert(
      fc.property(arbRegistro, arbNovo, (existente, novo) => {
        const faltantes = camposEnderecoVazios(existente as Record<string, unknown>, novo as Record<string, string | null | undefined>)
        for (const k of Object.keys(faltantes)) {
          const atual = (existente as Record<string, unknown>)[k]
          // só pode estar em faltantes se o existente estava vazio
          expect(atual === null || atual === undefined || atual === '').toBe(true)
          // e o valor gravado é o do novo (não inventa valor)
          expect(faltantes[k]).toBe((novo as Record<string, unknown>)[k])
        }
      }),
      { numRuns: 500 },
    )
  })

  it('idempotência: após enriquecer, uma 2ª passada não acha mais nada a gravar', () => {
    fc.assert(
      fc.property(arbRegistro, arbNovo, (existente, novo) => {
        const ex = { ...(existente as Record<string, unknown>) }
        const faltantes = camposEnderecoVazios(ex, novo as Record<string, string | null | undefined>)
        // simula a gravação: aplica os faltantes ao existente
        Object.assign(ex, faltantes)
        // 2ª passada com o MESMO novo → nada mais a gravar
        const faltantes2 = camposEnderecoVazios(ex, novo as Record<string, string | null | undefined>)
        expect(Object.keys(faltantes2).length).toBe(0)
      }),
      { numRuns: 500 },
    )
  })
})
