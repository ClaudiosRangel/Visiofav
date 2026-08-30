import { describe, it, expect } from 'vitest'
import { calcularPutaway, type CandidatoPutaway, type PutawayInput } from './putaway-motor.service'

function c(id: string, rua: string, predio: number, disponivel: number, curvaAbc?: string): CandidatoPutaway {
  return {
    id, enderecoCompleto: `${rua}-${predio}`, rua, predio, nivel: 1, apartamento: 1,
    capacidadePalete: disponivel, saldoAtual: 0, disponivel, curvaAbc,
  }
}

function baseInput(over: Partial<PutawayInput>): PutawayInput {
  return {
    quantidade: 100,
    ruaOrigem: 'A',
    predioOrigem: 5,
    nivelMin: 1,
    nivelMax: 99,
    prediosVarreduraPorLado: 3,
    usarClasseAbc: false,
    candidatosFixo: [],
    candidatosConsolidacao: [],
    candidatosLivre: [],
    candidatosOverflow: [],
    ...over,
  }
}

describe('putaway-motor.service (RF008)', () => {
  it('conservação: quantidadeAlocada + quantidadeRestante == quantidade', () => {
    const r = calcularPutaway(baseInput({ quantidade: 100, candidatosLivre: [c('l1', 'A', 6, 40)] }))
    expect(r.quantidadeAlocada + r.quantidadeRestante).toBe(100)
    expect(r.quantidadeAlocada).toBe(40)
    expect(r.quantidadeRestante).toBe(60)
    expect(r.incompleto).toBe(true)
  })

  it('completa quando a capacidade cobre a quantidade', () => {
    const r = calcularPutaway(baseInput({ quantidade: 30, candidatosLivre: [c('l1', 'A', 6, 40)] }))
    expect(r.quantidadeRestante).toBe(0)
    expect(r.incompleto).toBe(false)
  })

  it('prioridade da cadeia: fixo antes de consolidação antes de livre', () => {
    const r = calcularPutaway(baseInput({
      quantidade: 3,
      candidatosFixo: [c('fixo', 'A', 5, 1)],
      candidatosConsolidacao: [c('consol', 'A', 5, 1)],
      candidatosLivre: [c('livre', 'A', 6, 10)],
    }))
    expect(r.alocacoes.map((a) => a.enderecoId)).toEqual(['fixo', 'consol', 'livre'])
  })

  it('overflow só é usado quando fixo/consolidação/livre não cobrem', () => {
    const r = calcularPutaway(baseInput({
      quantidade: 50,
      candidatosLivre: [c('livre', 'A', 6, 30)],
      candidatosOverflow: [c('over', 'A', 7, 100)],
    }))
    // Livre primeiro (30), depois overflow (20).
    expect(r.alocacoes.map((a) => a.enderecoId)).toEqual(['livre', 'over'])
    expect(r.alocacoes.find((a) => a.enderecoId === 'livre')!.quantidadeAlocada).toBe(30)
    expect(r.alocacoes.find((a) => a.enderecoId === 'over')!.quantidadeAlocada).toBe(20)
    expect(r.incompleto).toBe(false)
  })

  it('camada livre é ordenada por proximidade RF008 (direita antes de esquerda)', () => {
    const r = calcularPutaway(baseInput({
      quantidade: 20,
      candidatosLivre: [c('esq', 'A', 4, 10), c('dir', 'A', 6, 10)],
    }))
    expect(r.alocacoes.map((a) => a.enderecoId)).toEqual(['dir', 'esq'])
  })

  it('não aloca em endereço sem disponibilidade', () => {
    const r = calcularPutaway(baseInput({
      quantidade: 10,
      candidatosLivre: [c('cheio', 'A', 6, 0), c('vazio', 'A', 7, 10)],
    }))
    expect(r.alocacoes.map((a) => a.enderecoId)).toEqual(['vazio'])
  })

  it('remove endereços duplicados preservando a camada de maior prioridade', () => {
    // Mesmo id em fixo e livre: deve entrar só uma vez, como fixo.
    const r = calcularPutaway(baseInput({
      quantidade: 5,
      candidatosFixo: [c('dup', 'A', 5, 10)],
      candidatosLivre: [c('dup', 'A', 5, 10)],
    }))
    expect(r.alocacoes.filter((a) => a.enderecoId === 'dup').length).toBe(1)
  })

  it('com ABC habilitado, classe A vem antes de C mantendo proximidade como desempate', () => {
    const r = calcularPutaway(baseInput({
      quantidade: 30,
      usarClasseAbc: true,
      candidatosLivre: [c('c', 'A', 6, 10, 'C'), c('a', 'A', 8, 10, 'A'), c('b', 'A', 7, 10, 'B')],
    }))
    // Ordena por classe (A,B,C) — mesmo que a proximidade colocasse 6 antes de 8.
    expect(r.alocacoes.map((a) => a.enderecoId)).toEqual(['a', 'b', 'c'])
  })
})
