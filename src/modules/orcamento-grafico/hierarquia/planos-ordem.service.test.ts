import { describe, expect, it } from 'vitest'
import { HierarquiaError } from './hierarquia-common'
import {
  LIMITE_PLANOS_POR_ITEM,
  MSG_LIMITE_PLANOS,
  aplicarDuasFases,
  inserirPlanoComPosicao,
  planejarInsercao,
  planejarReordenacao,
  reordenarPlanos,
  validarPermutacao,
  type PlanoOrdem,
} from './planos-ordem.service'

/**
 * planos-ordem.service (tarefa 7.6). Banco simulado em memória que IMPÕE a restrição
 * única [itemId, sequencia] a cada update/create, para provar que as duas fases
 * nunca a violam. Transação simulada: em erro, o estado volta ao de antes.
 */

type Linha = { id: string; itemId: string; empresaId: string; sequencia: number }

function bancoEmMemoria(inicial: Linha[], itemValido = { id: 'item-1', orcamentoId: 'orc-1', empresaId: 'emp-A' }) {
  let linhas = inicial.map((l) => ({ ...l }))
  const escritas: string[] = []

  const casa = (l: Linha, where: any) =>
    (where.id === undefined || l.id === where.id) &&
    (where.itemId === undefined || l.itemId === where.itemId) &&
    (where.empresaId === undefined || l.empresaId === where.empresaId)

  function exigirUnico() {
    const chaves = new Set<string>()
    for (const l of linhas) {
      const k = `${l.itemId}#${l.sequencia}`
      if (chaves.has(k)) throw new Error(`Unique constraint failed: [itemId, sequencia] = ${k}`)
      chaves.add(k)
    }
  }

  const tx: any = {
    itemOrcamentoGrafico: {
      findFirst: async ({ where }: any) =>
        where.id === itemValido.id &&
        where.orcamentoId === itemValido.orcamentoId &&
        where.empresaId === itemValido.empresaId &&
        where.orcamento?.empresaId === itemValido.empresaId
          ? { id: itemValido.id, empresaId: itemValido.empresaId }
          : null,
    },
    planoCalculoGrafico: {
      findMany: async ({ where }: any) =>
        linhas
          .filter((l) => casa(l, where))
          .sort((a, b) => a.sequencia - b.sequencia)
          .map((l) => ({ id: l.id, sequencia: l.sequencia })),
      count: async ({ where }: any) => linhas.filter((l) => casa(l, where)).length,
      updateMany: async ({ where, data }: any) => {
        let n = 0
        for (const l of linhas) if (casa(l, where)) { l.sequencia = data.sequencia; n++ }
        exigirUnico()
        escritas.push(`update ${where.id}=${data.sequencia}`)
        return { count: n }
      },
      create: async ({ data }: any) => {
        linhas.push({ id: data.id, itemId: data.itemId, empresaId: data.empresaId, sequencia: data.sequencia })
        exigirUnico()
        escritas.push(`create ${data.id}=${data.sequencia}`)
        return data
      },
    },
  }
  tx.$transaction = async (fn: any) => {
    const copia = linhas.map((l) => ({ ...l }))
    try {
      return await fn(tx)
    } catch (e) {
      linhas = copia
      throw e
    }
  }
  return { tx, linhas: () => linhas, escritas }
}

const plano = (id: string, sequencia: number, itemId = 'item-1', empresaId = 'emp-A'): Linha => ({ id, itemId, empresaId, sequencia })

describe('validarPermutacao', () => {
  it('permutação válida', () => {
    expect(validarPermutacao(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual({ valido: true, faltando: [], sobrando: [], repetidos: [] })
  })
  it('id faltando', () => {
    expect(validarPermutacao(['a', 'b', 'c'], ['a', 'b'])).toMatchObject({ valido: false, faltando: ['c'] })
  })
  it('id repetido', () => {
    expect(validarPermutacao(['a', 'b'], ['a', 'a'])).toMatchObject({ valido: false, faltando: ['b'], repetidos: ['a'] })
  })
  it('id de outro item', () => {
    expect(validarPermutacao(['a', 'b'], ['a', 'b', 'x'])).toMatchObject({ valido: false, sobrando: ['x'] })
    expect(validarPermutacao(['a', 'b'], ['a', 'x'])).toMatchObject({ valido: false, faltando: ['b'], sobrando: ['x'] })
  })
})

describe('planejarReordenacao / planejarInsercao (puras)', () => {
  it('reordenar: sequências finais 1..N e temporárias negativas distintas', () => {
    const p = planejarReordenacao(['c', 'a', 'b'])
    expect(p.map((x) => x.final)).toEqual([1, 2, 3])
    expect(new Set(p.map((x) => x.temporaria)).size).toBe(3)
    expect(p.every((x) => x.temporaria < 0)).toBe(true)
  })
  it('sem posicaoApos → final (max+1), nada desloca', () => {
    expect(planejarInsercao([{ id: 'a', sequencia: 1 }, { id: 'b', sequencia: 4 }])).toEqual({ sequenciaNova: 5, deslocar: [] })
    expect(planejarInsercao([])).toEqual({ sequenciaNova: 1, deslocar: [] })
  })
  it('com posicaoApos → logo abaixo e os de baixo descem 1', () => {
    const planos: PlanoOrdem[] = [{ id: 'a', sequencia: 1 }, { id: 'b', sequencia: 2 }, { id: 'c', sequencia: 3 }]
    const r = planejarInsercao(planos, 'a')
    expect(r.sequenciaNova).toBe(2)
    expect(r.deslocar.map((d) => [d.id, d.final])).toEqual([['b', 3], ['c', 4]])
  })
  it('posicaoApos que não é do item → 400', () => {
    expect(() => planejarInsercao([{ id: 'a', sequencia: 1 }], 'x')).toThrow(HierarquiaError)
    try { planejarInsercao([{ id: 'a', sequencia: 1 }], 'x') } catch (e) { expect((e as HierarquiaError).statusCode).toBe(400) }
  })
})

describe('reordenarPlanos (duas fases, transação)', () => {
  it('permutação válida grava 1..N na nova ordem sem violar a unicidade', async () => {
    const db = bancoEmMemoria([plano('a', 1), plano('b', 2), plano('c', 3), plano('z', 1, 'item-2')])
    const r = await reordenarPlanos('orc-1', 'item-1', 'emp-A', ['c', 'a', 'b'], db.tx)
    expect(r).toEqual({ planos: [{ id: 'c', sequencia: 1 }, { id: 'a', sequencia: 2 }, { id: 'b', sequencia: 3 }] })
    const doItem = db.linhas().filter((l) => l.itemId === 'item-1').sort((x, y) => x.sequencia - y.sequencia)
    expect(doItem.map((l) => l.id)).toEqual(['c', 'a', 'b'])
    // Plano de outro item intacto.
    expect(db.linhas().find((l) => l.id === 'z')!.sequencia).toBe(1)
  })

  it.each([
    ['faltando', ['a', 'b']],
    ['repetido', ['a', 'a', 'b']],
    ['de outro item', ['a', 'b', 'z']],
  ])('ordem com id %s → 400 e nada gravado', async (_nome, ordem) => {
    const db = bancoEmMemoria([plano('a', 1), plano('b', 2), plano('c', 3), plano('z', 1, 'item-2')])
    const antes = JSON.stringify(db.linhas())
    await expect(reordenarPlanos('orc-1', 'item-1', 'emp-A', ordem, db.tx)).rejects.toMatchObject({ statusCode: 400 })
    expect(db.escritas).toEqual([])
    expect(JSON.stringify(db.linhas())).toBe(antes)
  })

  it('item de outra empresa → 404 e nada gravado', async () => {
    const db = bancoEmMemoria([plano('a', 1)])
    await expect(reordenarPlanos('orc-1', 'item-1', 'emp-B', ['a'], db.tx)).rejects.toMatchObject({ statusCode: 404 })
    expect(db.escritas).toEqual([])
  })

  it('sem duas fases a troca direta violaria a unicidade (prova do banco simulado)', async () => {
    const db = bancoEmMemoria([plano('a', 1), plano('b', 2)])
    await expect(
      db.tx.planoCalculoGrafico.updateMany({ where: { id: 'a', itemId: 'item-1', empresaId: 'emp-A' }, data: { sequencia: 2 } }),
    ).rejects.toThrow(/Unique/)
  })
})

describe('inserirPlanoComPosicao (posicaoApos + limite)', () => {
  const criarCom = (tx: any, id: string) => (sequencia: number) =>
    tx.planoCalculoGrafico.create({ data: { id, itemId: 'item-1', empresaId: 'emp-A', sequencia } })

  it('posicaoApos desloca em duas fases sem violar [itemId, sequencia]', async () => {
    const db = bancoEmMemoria([plano('a', 1), plano('b', 2), plano('c', 3)])
    await db.tx.$transaction((tx: any) => inserirPlanoComPosicao(tx, 'item-1', 'emp-A', 'a', criarCom(tx, 'novo')))
    const ordem = db.linhas().sort((x, y) => x.sequencia - y.sequencia).map((l) => `${l.id}:${l.sequencia}`)
    expect(ordem).toEqual(['a:1', 'novo:2', 'b:3', 'c:4'])
  })

  it('posicaoApos no último plano → vai para o final sem deslocar', async () => {
    const db = bancoEmMemoria([plano('a', 1), plano('b', 2)])
    await db.tx.$transaction((tx: any) => inserirPlanoComPosicao(tx, 'item-1', 'emp-A', 'b', criarCom(tx, 'novo')))
    expect(db.escritas).toEqual(['create novo=3'])
  })

  it('com lacunas de sequência também não viola a unicidade', async () => {
    const db = bancoEmMemoria([plano('a', 1), plano('b', 2), plano('c', 5)])
    await db.tx.$transaction((tx: any) => inserirPlanoComPosicao(tx, 'item-1', 'emp-A', 'a', criarCom(tx, 'novo')))
    const ordem = db.linhas().sort((x, y) => x.sequencia - y.sequencia).map((l) => l.id)
    expect(ordem).toEqual(['a', 'novo', 'b', 'c'])
  })

  it(`limite de ${LIMITE_PLANOS_POR_ITEM} planos → 409 e nada gravado`, async () => {
    const cheios = Array.from({ length: LIMITE_PLANOS_POR_ITEM }, (_, i) => plano(`p${i}`, i + 1))
    const db = bancoEmMemoria(cheios)
    await expect(
      db.tx.$transaction((tx: any) => inserirPlanoComPosicao(tx, 'item-1', 'emp-A', null, criarCom(tx, 'novo'))),
    ).rejects.toMatchObject({ statusCode: 409, message: MSG_LIMITE_PLANOS })
    expect(db.escritas).toEqual([])
  })

  it('falha na criação reverte o deslocamento (transação)', async () => {
    const db = bancoEmMemoria([plano('a', 1), plano('b', 2)])
    const antes = JSON.stringify(db.linhas())
    await expect(
      db.tx.$transaction((tx: any) =>
        inserirPlanoComPosicao(tx, 'item-1', 'emp-A', 'a', async () => { throw new Error('falha') }),
      ),
    ).rejects.toThrow('falha')
    expect(JSON.stringify(db.linhas())).toBe(antes)
  })

  it('aplicarDuasFases só toca planos do item e empresa informados', async () => {
    const db = bancoEmMemoria([plano('a', 1), plano('a', 7, 'item-2', 'emp-B')])
    await aplicarDuasFases(db.tx, 'item-1', 'emp-A', [{ id: 'a', temporaria: -1, final: 3 }])
    expect(db.linhas().map((l) => `${l.itemId}:${l.sequencia}`)).toEqual(['item-1:3', 'item-2:7'])
  })
})
