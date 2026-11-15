import { describe, expect, it } from 'vitest'
import { aplicarRoteiro, planejarOrdens, type LinhaRoteiro, type RelacaoParaOrdem } from './roteiro'
import type { RelacaoTraduzida } from './tabelas-relacao'

const rot = (linha: number, plano: number, ordem: number, atividade: number): LinhaRoteiro => ({
  CodLinhaProduto: linha,
  CodPlanoCad: plano,
  Ordem: ordem,
  CodAtividade: atividade,
  FlagCheck: -1,
})
const planoAtv = (plano: number, atv: number): RelacaoTraduzida => ({ origem: { tipo: 'PLANO', codigo: plano }, destino: { tipo: 'ATIVIDADE', codigo: atv } })
const prodAtv = (prod: number, atv: number): RelacaoTraduzida => ({ origem: { tipo: 'PRODUTO', codigo: prod }, destino: { tipo: 'ATIVIDADE', codigo: atv } })

const base = {
  linhaDoPlano: new Map([[12, 1]]),
  linhaDoProduto: new Map([[7, 3]]),
}

describe('aplicarRoteiro (7.5)', () => {
  it('usa a ordem da linha do próprio plano e ignora 999 (sem ordem)', () => {
    const r = aplicarRoteiro({
      ...base,
      roteiros: [rot(1, 12, 5, 2), rot(15, 12, 9, 2), rot(1, 12, 999, 3)],
      relacoes: [planoAtv(12, 2), planoAtv(12, 3)],
    })
    expect(r.ordens).toEqual([{ tipoOrigem: 'PLANO', codigoOrigem: 12, codigoAtividade: 2, ordem: 5 }])
    expect(r.semOrdem).toBe(1)
    expect(r.divergencias).toEqual([])
  })

  it('PRODUTO→ATIVIDADE usa o roteiro de plano 0 da linha do produto', () => {
    const r = aplicarRoteiro({ ...base, roteiros: [rot(3, 0, 2, 39), rot(1, 0, 7, 39)], relacoes: [prodAtv(7, 39)] })
    expect(r.ordens).toEqual([{ tipoOrigem: 'PRODUTO', codigoOrigem: 7, codigoAtividade: 39, ordem: 2 }])
  })

  it('lista relação sem roteiro e roteiro sem relação', () => {
    const r = aplicarRoteiro({
      ...base,
      roteiros: [rot(1, 12, 1, 2), rot(1, 12, 4, 8), rot(3, 0, 1, 53)],
      relacoes: [planoAtv(12, 2), planoAtv(12, 99)],
    })
    const tipos = r.divergencias.map((d) => d.tipo).sort()
    expect(tipos).toEqual(['RELACAO_SEM_ROTEIRO', 'ROTEIRO_SEM_RELACAO', 'ROTEIRO_SEM_RELACAO'])
    expect(r.divergencias.find((d) => d.tipo === 'RELACAO_SEM_ROTEIRO')?.descricao).toContain('atividade 99')
    expect(r.divergencias.filter((d) => d.tipo === 'ROTEIRO_SEM_RELACAO').map((d) => d.descricao).join('|')).toMatch(/plano 12 → atividade 8.*atividade de produto 53 na linha 3/)
  })

  it('ordens diferentes na mesma linha do plano: usa a menor e avisa o conflito', () => {
    const r = aplicarRoteiro({ ...base, roteiros: [rot(1, 12, 6, 2), rot(1, 12, 4, 2)], relacoes: [planoAtv(12, 2)] })
    expect(r.ordens[0].ordem).toBe(4)
    expect(r.divergencias).toHaveLength(1)
    expect(r.divergencias[0]).toMatchObject({ tipo: 'ORDEM_CONFLITANTE' })
  })

  it('sem a linha do plano no roteiro, usa o conjunto das linhas', () => {
    const r = aplicarRoteiro({ ...base, roteiros: [rot(15, 12, 8, 2)], relacoes: [planoAtv(12, 2)] })
    expect(r.ordens[0].ordem).toBe(8)
  })

  it('ordem 0 é uma ordem válida', () => {
    const r = aplicarRoteiro({ ...base, roteiros: [rot(1, 12, 0, 2)], relacoes: [planoAtv(12, 2)] })
    expect(r.ordens[0].ordem).toBe(0)
  })
})

describe('planejarOrdens — só preenche ordem vazia', () => {
  const aplicada = { tipoOrigem: 'PLANO' as const, codigoOrigem: 12, codigoAtividade: 2, ordem: 5 }
  const ids = {
    plano: new Map([[12, 'p12']]),
    produto: new Map<number, string>(),
    atividade: new Map([[2, 'a2']]),
  }
  const rel = (ordem: number | null, id: string | null = 'r1'): RelacaoParaOrdem => ({ id, tipoOrigem: 'PLANO', idOrigem: 'p12', tipoDestino: 'ATIVIDADE', idDestino: 'a2', ordem })

  it('define a ordem quando está vazia', () => {
    const ops = planejarOrdens([aplicada], ids.plano, ids.produto, ids.atividade, [rel(null)])
    expect(ops[0]).toMatchObject({ tipo: 'DEFINIR', id: 'r1', ordem: 5 })
  })

  it('nunca sobrescreve ordem já preenchida (segunda execução não define nada)', () => {
    const ops = planejarOrdens([aplicada], ids.plano, ids.produto, ids.atividade, [rel(5)])
    expect(ops[0]).toMatchObject({ tipo: 'IGNORAR', motivo: 'JA_TEM_ORDEM' })
  })

  it('relação ainda não importada fica de fora', () => {
    const ops = planejarOrdens([aplicada], ids.plano, ids.produto, ids.atividade, [])
    expect(ops[0]).toMatchObject({ tipo: 'IGNORAR', motivo: 'SEM_RELACAO_NO_VIZOR' })
  })
})
