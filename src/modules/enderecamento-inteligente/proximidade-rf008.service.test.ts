import { describe, it, expect } from 'vitest'
import { ordenarRF008, type EnderecoCandidatoRF008 } from './proximidade-rf008.service'

function cand(id: string, rua: string, predio: number, nivel = 1, apto = 1): EnderecoCandidatoRF008 {
  return { id, rua, predio, nivel, apartamento: apto, enderecoCompleto: `${rua}-${predio}-${nivel}-${apto}` }
}

describe('proximidade-rf008.service (RF008.7)', () => {
  it('prioriza N prédios à direita, depois N à esquerda, a partir do prédio de origem', () => {
    // Origem: rua A, prédio 5, N=3. Direita: 6,7,8 ; Esquerda: 4,3,2.
    const candidatos = [
      cand('p2', 'A', 2),
      cand('p8', 'A', 8),
      cand('p4', 'A', 4),
      cand('p6', 'A', 6),
      cand('p7', 'A', 7),
      cand('p3', 'A', 3),
    ]
    const ord = ordenarRF008({
      candidatos, ruaOrigem: 'A', predioOrigem: 5, prediosVarreduraPorLado: 3, nivelMin: 1, nivelMax: 99,
    })
    // Direita dentro da janela (6,7,8), depois esquerda dentro da janela (4,3,2).
    expect(ord.map((c) => c.id)).toEqual(['p6', 'p7', 'p8', 'p4', 'p3', 'p2'])
  })

  it('o próprio prédio de origem vem após a janela direita/esquerda', () => {
    const candidatos = [cand('mesmo', 'A', 5), cand('dir', 'A', 6), cand('esq', 'A', 4)]
    const ord = ordenarRF008({
      candidatos, ruaOrigem: 'A', predioOrigem: 5, prediosVarreduraPorLado: 3, nivelMin: 1, nivelMax: 99,
    })
    expect(ord.map((c) => c.id)).toEqual(['dir', 'esq', 'mesmo'])
  })

  it('prédios fora da janela ±N vêm depois, por distância crescente', () => {
    // N=1 → janela é só 6 (dir) e 4 (esq). 8 e 2 ficam fora, por distância.
    const candidatos = [cand('p8', 'A', 8), cand('p2', 'A', 2), cand('p6', 'A', 6), cand('p4', 'A', 4)]
    const ord = ordenarRF008({
      candidatos, ruaOrigem: 'A', predioOrigem: 5, prediosVarreduraPorLado: 1, nivelMin: 1, nivelMax: 99,
    })
    // Janela: 6, 4. Fora: distância 3 → p8(+3) antes de p2(-3) (direita antes).
    expect(ord.map((c) => c.id)).toEqual(['p6', 'p4', 'p8', 'p2'])
  })

  it('esgota a rua de origem antes de considerar outras ruas', () => {
    const candidatos = [cand('bDir', 'B', 6), cand('aEsq', 'A', 4), cand('aDir', 'A', 6)]
    const ord = ordenarRF008({
      candidatos, ruaOrigem: 'A', predioOrigem: 5, prediosVarreduraPorLado: 3, nivelMin: 1, nivelMax: 99,
    })
    // Toda a rua A antes de qualquer endereço da rua B.
    expect(ord.map((c) => c.id)).toEqual(['aDir', 'aEsq', 'bDir'])
  })

  it('outras ruas são consideradas em ordem alfabética', () => {
    const candidatos = [cand('c', 'C', 5), cand('b', 'B', 5)]
    const ord = ordenarRF008({
      candidatos, ruaOrigem: 'A', predioOrigem: 5, prediosVarreduraPorLado: 3, nivelMin: 1, nivelMax: 99,
    })
    expect(ord.map((c) => c.id)).toEqual(['b', 'c'])
  })

  it('filtra candidatos fora da faixa de nível', () => {
    const candidatos = [cand('n1', 'A', 6, 1), cand('n5', 'A', 6, 5)]
    const ord = ordenarRF008({
      candidatos, ruaOrigem: 'A', predioOrigem: 5, prediosVarreduraPorLado: 3, nivelMin: 1, nivelMax: 3,
    })
    expect(ord.map((c) => c.id)).toEqual(['n1'])
  })

  it('dentro do mesmo prédio, ordena por nível e depois apartamento', () => {
    const candidatos = [
      cand('a', 'A', 6, 2, 1),
      cand('b', 'A', 6, 1, 2),
      cand('c', 'A', 6, 1, 1),
    ]
    const ord = ordenarRF008({
      candidatos, ruaOrigem: 'A', predioOrigem: 5, prediosVarreduraPorLado: 3, nivelMin: 1, nivelMax: 99,
    })
    expect(ord.map((c) => c.id)).toEqual(['c', 'b', 'a'])
  })
})
