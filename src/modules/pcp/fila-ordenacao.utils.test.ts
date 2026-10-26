import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { reordenarComIniciadaNoTopo, type EtapaParaOrdenar } from './fila-ordenacao.utils'

function etapa(id: string, opNumero: number, ordemManual = false, posicaoFila: number | null = null): EtapaParaOrdenar {
  return { id, opNumero, ordemManual, posicaoFila, dataEntregaPrevista: null }
}

describe('reordenarComIniciadaNoTopo (R1 — Property 3)', () => {
  it('P3a: a etapa iniciada vem antes das pendentes não-manuais', () => {
    const etapas = [etapa('a', 10), etapa('b', 5), etapa('c', 20)]
    const pos = reordenarComIniciadaNoTopo(etapas, 'c')
    // 'c' deve ter a menor posição entre as automáticas.
    expect(pos.get('c')).toBeLessThan(pos.get('a')!)
    expect(pos.get('c')).toBeLessThan(pos.get('b')!)
    expect(pos.get('c')).toBe(1)
  })

  it('P3b: etapas manuais preservam seu slot', () => {
    const etapas = [
      etapa('manual', 1, true, 1),
      etapa('a', 10),
      etapa('iniciada', 20),
    ]
    const pos = reordenarComIniciadaNoTopo(etapas, 'iniciada')
    expect(pos.get('manual')).toBe(1) // slot manual preservado
    expect(pos.get('iniciada')).toBe(2) // iniciada no 1º slot automático livre
    expect(pos.get('a')).toBe(3)
  })

  it('P3c: posições são permutação de 1..N (sem buracos nem duplicatas)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 999 }), { minLength: 1, maxLength: 12 }),
        fc.nat(),
        (opNumeros, idxIniciada) => {
          const etapas = opNumeros.map((n, i) => etapa(`e${i}`, n))
          const alvo = `e${idxIniciada % etapas.length}`
          const pos = reordenarComIniciadaNoTopo(etapas, alvo)
          const valores = [...pos.values()].sort((a, b) => a - b)
          expect(valores).toEqual(Array.from({ length: etapas.length }, (_, i) => i + 1))
          // a iniciada é sempre a posição 1 (não há manuais neste cenário)
          expect(pos.get(alvo)).toBe(1)
        },
      ),
    )
  })

  it('P3d: etapa inexistente cai no recálculo padrão (sem erro)', () => {
    const etapas = [etapa('a', 10), etapa('b', 5)]
    const pos = reordenarComIniciadaNoTopo(etapas, 'nao-existe')
    // ordena por opNumero: b(5) antes de a(10)
    expect(pos.get('b')).toBe(1)
    expect(pos.get('a')).toBe(2)
  })
})
