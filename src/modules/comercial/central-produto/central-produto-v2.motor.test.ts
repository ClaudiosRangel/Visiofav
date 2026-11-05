import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  proximaRevisao,
  validarImagensRevisao,
  transicaoArte,
  aplicarAprovacao,
  derivarMatriz,
  resolverMatrizExibida,
  podeExcluir,
  CentralProdutoV2Error,
  type EstadoArte,
} from './central-produto-v2.motor'

describe('central-produto-v2.motor — proximaRevisao', () => {
  it('começa em 1 quando vazio', () => {
    expect(proximaRevisao([])).toBe(1)
  })
  it('golden: max+1', () => {
    expect(proximaRevisao([{ numero: 1 }, { numero: 3 }, { numero: 2 }])).toBe(4)
  })
  // P1: sempre maior que todos os existentes
  it('P1 — sempre > todos os números existentes', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 9999 })), (nums) => {
        const existentes = nums.map((n) => ({ numero: n }))
        const prox = proximaRevisao(existentes)
        return nums.every((n) => prox > n) && prox >= 1
      }),
    )
  })
})

describe('central-produto-v2.motor — validarImagensRevisao', () => {
  it('aceita 1..4', () => {
    expect(() => validarImagensRevisao(['a'])).not.toThrow()
    expect(() => validarImagensRevisao(['a', 'b', 'c', 'd'])).not.toThrow()
  })
  it('rejeita 0 e >4', () => {
    expect(() => validarImagensRevisao([])).toThrow(CentralProdutoV2Error)
    expect(() => validarImagensRevisao(['a', 'b', 'c', 'd', 'e'])).toThrow(
      CentralProdutoV2Error,
    )
  })
  // P2: aceita exatamente 1..4
  it('P2 — aceita sse 1..4', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10 }), (n) => {
        const imgs = Array.from({ length: n }, (_, i) => `img${i}`)
        let ok = true
        try {
          validarImagensRevisao(imgs)
        } catch {
          ok = false
        }
        return ok === (n >= 1 && n <= 4)
      }),
    )
  })
})

describe('central-produto-v2.motor — transicaoArte', () => {
  it('permite o fluxo feliz', () => {
    expect(() => transicaoArte('RASCUNHO', 'EM_APROVACAO')).not.toThrow()
    expect(() => transicaoArte('EM_APROVACAO', 'APROVADA')).not.toThrow()
    expect(() => transicaoArte('APROVADA', 'OBSOLETA')).not.toThrow()
    expect(() => transicaoArte('REPROVADA', 'RASCUNHO')).not.toThrow()
  })
  it('bloqueia pular estado (RASCUNHO → APROVADA)', () => {
    expect(() => transicaoArte('RASCUNHO', 'APROVADA')).toThrow(CentralProdutoV2Error)
  })
  // P5: nunca permite pular do RASCUNHO direto para APROVADA/OBSOLETA
  it('P5 — RASCUNHO nunca vai direto a APROVADA/OBSOLETA', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<EstadoArte>('APROVADA', 'OBSOLETA'),
        (destino) => {
          try {
            transicaoArte('RASCUNHO', destino)
            return false
          } catch {
            return true
          }
        },
      ),
    )
  })
})

describe('central-produto-v2.motor — aplicarAprovacao', () => {
  it('golden: marca aprovadas anteriores como obsoletas', () => {
    const revisoes = [
      { id: 'a', estado: 'APROVADA' as EstadoArte },
      { id: 'b', estado: 'OBSOLETA' as EstadoArte },
      { id: 'c', estado: 'APROVADA' as EstadoArte }, // recém-aprovada
    ]
    expect(aplicarAprovacao(revisoes, 'c')).toEqual(['a'])
  })
  // P3: no máximo 1 APROVADA após aplicar (as retornadas viram obsoletas)
  it('P3 — resulta em no máximo 1 vigente', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<EstadoArte>('APROVADA', 'OBSOLETA', 'RASCUNHO'), {
          minLength: 1,
          maxLength: 8,
        }),
        (estados) => {
          const revisoes = estados.map((e, i) => ({ id: `r${i}`, estado: e }))
          const idAprovada = 'r0'
          revisoes[0].estado = 'APROVADA'
          const obsoletar = new Set(aplicarAprovacao(revisoes, idAprovada))
          const vigentes = revisoes.filter(
            (r) => r.estado === 'APROVADA' && !obsoletar.has(r.id),
          )
          return vigentes.length <= 1 && vigentes.every((v) => v.id === idAprovada)
        },
      ),
    )
  })
})

describe('central-produto-v2.motor — derivarMatriz / resolverMatrizExibida', () => {
  it('extrai a tag [Matriz] da 1ª obs não-vazia', () => {
    const obs = [
      'linha\n[Cliente] X\n[Matriz] 2529B - COM BRAILLE\n[Formato] 600 x 910',
    ]
    expect(derivarMatriz(obs)).toBe('2529B - COM BRAILLE')
  })
  it('null quando nenhuma obs tem a tag', () => {
    expect(derivarMatriz([null, 'sem tag', '[Cliente] Y'])).toBeNull()
  })
  it('respeita a ordem (1ª não-vazia vence)', () => {
    const obs = ['[Matriz] 2186B', '[Matriz] 1241B']
    expect(derivarMatriz(obs)).toBe('2186B')
  })
  it('matriz manual tem precedência', () => {
    expect(resolverMatrizExibida('MANUAL-1', '2529B')).toBe('MANUAL-1')
    expect(resolverMatrizExibida('  ', '2529B')).toBe('2529B')
    expect(resolverMatrizExibida(null, '2529B')).toBe('2529B')
    expect(resolverMatrizExibida(null, null)).toBeNull()
  })
})

describe('central-produto-v2.motor — podeExcluir', () => {
  it('ok quando tudo zero', () => {
    expect(
      podeExcluir({ pedidos: 0, ops: 0, notas: 0, itensOrcamento: 0, saldos: 0 }).ok,
    ).toBe(true)
  })
  it('bloqueia com motivo quando há movimentação', () => {
    const r = podeExcluir({ pedidos: 0, ops: 2, notas: 0, itensOrcamento: 0, saldos: 1 })
    expect(r.ok).toBe(false)
    expect(r.motivo).toContain('2 OP')
    expect(r.motivo).toContain('1 saldo')
  })
  // P4: ok ⟺ soma = 0
  it('P4 — ok sse soma dos contadores é zero', () => {
    fc.assert(
      fc.property(
        fc.record({
          pedidos: fc.nat({ max: 5 }),
          ops: fc.nat({ max: 5 }),
          notas: fc.nat({ max: 5 }),
          itensOrcamento: fc.nat({ max: 5 }),
          saldos: fc.nat({ max: 5 }),
        }),
        (mov) => {
          const soma =
            mov.pedidos + mov.ops + mov.notas + mov.itensOrcamento + mov.saldos
          return podeExcluir(mov).ok === (soma === 0)
        },
      ),
    )
  })
})
