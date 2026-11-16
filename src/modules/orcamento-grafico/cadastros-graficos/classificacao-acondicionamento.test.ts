import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  classificarGrupoAtividade,
  obterCatalogoPlano,
  obterCatalogoProduto,
} from './catalogo.service'

// ─── Prisma em memória (filtra por igualdade e `in`) ────────────────────────

type Linha = Record<string, any>

function tabela(rows: Linha[]) {
  const casa = (row: Linha, where: Linha = {}): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && 'in' in v) return (v.in as unknown[]).includes(row[k])
      return row[k] === v
    })
  return {
    findMany: async ({ where }: { where?: Linha } = {}) => rows.filter((r) => casa(r, where)),
    findFirst: async ({ where }: { where?: Linha } = {}) => rows.find((r) => casa(r, where)) ?? null,
  }
}

const E1 = 'empresa-1'

interface AtividadeFake {
  id: string
  flag: boolean
}
interface ProdutoFake {
  id: string
  /** ids de atividades ligadas ao produto (relação PRODUTO → ATIVIDADE). */
  atividades: string[]
  /** ids com a relação PRODUTO → ACONDICIONAMENTO. */
  acondicionamento: string[]
}

function montarDb(atividades: AtividadeFake[], produtos: ProdutoFake[]) {
  const relacoes: Linha[] = []
  for (const p of produtos) {
    for (const a of p.atividades) {
      relacoes.push({ empresaId: E1, tipoOrigem: 'PRODUTO', idOrigem: p.id, tipoDestino: 'ATIVIDADE', idDestino: a, ordem: null, padrao: false })
    }
    for (const a of p.acondicionamento) {
      relacoes.push({ empresaId: E1, tipoOrigem: 'PRODUTO', idOrigem: p.id, tipoDestino: 'ACONDICIONAMENTO', idDestino: a, ordem: null, padrao: false })
    }
  }
  // Todo plano 'pl' liga todas as atividades (para comparar as duas rotas).
  for (const a of atividades) {
    relacoes.push({ empresaId: E1, tipoOrigem: 'PLANO', idOrigem: 'pl', tipoDestino: 'ATIVIDADE', idDestino: a.id, ordem: null, padrao: false })
  }
  const dados: Record<string, Linha[]> = {
    produtoGrafico: produtos.map((p) => ({ id: p.id, empresaId: E1, status: true, nome: p.id })),
    tipoPlanoGrafico: [{ id: 'pl', empresaId: E1, status: true, nome: 'Plano' }],
    acabamentoGrafico: atividades.map((a) => ({
      id: a.id,
      empresaId: E1,
      status: true,
      nome: a.id,
      acondicionamento: a.flag,
    })),
    itemDiversoGrafico: [],
    defaultProdutoPlano: [],
    restricaoAcabamento: [],
    materialAcabamento: [],
    coberturaTinta: [],
    suporteGrafico: [],
    relacaoCadastroGrafico: relacoes,
  }
  const db: Record<string, unknown> = {}
  for (const [nome, rows] of Object.entries(dados)) db[nome] = tabela(rows)
  return db as any
}

describe('classificarGrupoAtividade', () => {
  it('entrada vazia (sem flag e sem relação) fica em ATIVIDADES', () => {
    expect(
      classificarGrupoAtividade({ flagAcondicionamento: false, temRelacaoAcondicionamento: false }),
    ).toBe('ATIVIDADES')
  })

  it('entrada preenchida: flag, relação ou ambas vão para ACONDICIONAMENTO', () => {
    expect(classificarGrupoAtividade({ flagAcondicionamento: true, temRelacaoAcondicionamento: false })).toBe(
      'ACONDICIONAMENTO',
    )
    expect(classificarGrupoAtividade({ flagAcondicionamento: false, temRelacaoAcondicionamento: true })).toBe(
      'ACONDICIONAMENTO',
    )
    expect(classificarGrupoAtividade({ flagAcondicionamento: true, temRelacaoAcondicionamento: true })).toBe(
      'ACONDICIONAMENTO',
    )
  })
})

describe('as duas rotas do catálogo agrupam a mesma atividade no mesmo grupo', () => {
  it('atividade só com flag fica em acondicionamento nas duas rotas', async () => {
    const db = montarDb(
      [
        { id: 'a-flag', flag: true },
        { id: 'a-normal', flag: false },
      ],
      [{ id: 'p', atividades: ['a-flag', 'a-normal'], acondicionamento: [] }],
    )
    const produto = await obterCatalogoProduto(E1, 'p', db)
    const plano = await obterCatalogoPlano(E1, 'pl', 'p', db)
    expect(produto.acondicionamento.map((a) => a.id)).toEqual(['a-flag'])
    expect(plano.acondicionamento.map((a) => a.id)).toEqual(['a-flag'])
    expect(plano.atividades.find((a) => a.id === 'a-normal')!.grupo).toBe('ATIVIDADES')
  })

  it('atividade só com relação do produto fica em acondicionamento nas duas rotas', async () => {
    const db = montarDb(
      [{ id: 'a-rel', flag: false }],
      [{ id: 'p', atividades: ['a-rel'], acondicionamento: ['a-rel'] }],
    )
    const produto = await obterCatalogoProduto(E1, 'p', db)
    const plano = await obterCatalogoPlano(E1, 'pl', 'p', db)
    expect(produto.acondicionamento.map((a) => a.id)).toEqual(['a-rel'])
    expect(plano.acondicionamento.map((a) => a.id)).toEqual(['a-rel'])
  })

  it('catálogo do plano sem produto usa só a flag do cadastro', async () => {
    const db = montarDb(
      [
        { id: 'a-flag', flag: true },
        { id: 'a-normal', flag: false },
      ],
      [{ id: 'p', atividades: [], acondicionamento: ['a-normal'] }],
    )
    const plano = await obterCatalogoPlano(E1, 'pl', undefined, db)
    expect(plano.acondicionamento.map((a) => a.id)).toEqual(['a-flag'])
  })
})

describe('agrupamento antes e depois da correção da flag', () => {
  // Atividades 39 (Caixa Padrão) e 53 (Embalar) começam com a flag false (hoje em produção, hipótese H1).
  const atividadesAntes: AtividadeFake[] = [
    { id: 'a39', flag: false },
    { id: 'a53', flag: false },
    { id: 'a10', flag: false },
  ]
  const atividadesDepois: AtividadeFake[] = atividadesAntes.map((a) =>
    a.id === 'a39' || a.id === 'a53' ? { ...a, flag: true } : a,
  )
  const produtos: ProdutoFake[] = [
    // produto 2: liga 39 e 53 só por ATIVIDADE → PRODUTO (sem relação de acondicionamento)
    { id: 'p2', atividades: ['a10', 'a39', 'a53'], acondicionamento: [] },
    // produtos 7/11/12: já têm a relação da tabela 6
    { id: 'p7', atividades: ['a10', 'a39', 'a53'], acondicionamento: ['a39', 'a53'] },
    { id: 'p12', atividades: ['a10', 'a53'], acondicionamento: ['a53'] },
    // produto sem nenhuma das duas atividades
    { id: 'p3', atividades: ['a10'], acondicionamento: [] },
  ]

  async function agrupamento(atividades: AtividadeFake[]) {
    const db = montarDb(atividades, produtos)
    const r: Record<string, { atividades: string[]; acondicionamento: string[] }> = {}
    for (const p of produtos) {
      const c = await obterCatalogoProduto(E1, p.id, db)
      r[p.id] = {
        atividades: c.atividades.map((a) => a.id).sort(),
        acondicionamento: c.acondicionamento.map((a) => a.id).sort(),
      }
    }
    return r
  }

  it('só muda o produto que dependia da flag; os demais ficam idênticos', async () => {
    const antes = await agrupamento(atividadesAntes)
    const depois = await agrupamento(atividadesDepois)

    const mudaram = produtos.map((p) => p.id).filter((id) => JSON.stringify(antes[id]) !== JSON.stringify(depois[id]))
    expect(mudaram).toEqual(['p2'])
    expect(antes.p2.acondicionamento).toEqual([])
    expect(depois.p2.acondicionamento).toEqual(['a39', 'a53'])
    expect(depois.p2.atividades).toEqual(['a10'])
  })

  it('a correção não altera nenhuma relação nem a lista total de atividades do produto', async () => {
    const antes = await agrupamento(atividadesAntes)
    const depois = await agrupamento(atividadesDepois)
    for (const p of produtos) {
      const todasAntes = [...antes[p.id].atividades, ...antes[p.id].acondicionamento].sort()
      const todasDepois = [...depois[p.id].atividades, ...depois[p.id].acondicionamento].sort()
      expect(todasDepois).toEqual(todasAntes)
    }
  })
})

describe('propriedades', () => {
  // Feature: orcamento-grafico-fase3-produto-embalagem, Property 12: Classificação de grupo é a mesma nas duas rotas do catálogo
  it('Property 12: a atividade cai no mesmo grupo nas duas rotas e segue a função única', async () => {
    const arbAtividade = fc.record({
      flag: fc.boolean(),
      noProduto: fc.boolean(),
      relacao: fc.boolean(),
    })
    await fc.assert(
      fc.asyncProperty(fc.array(arbAtividade, { minLength: 1, maxLength: 8 }), async (entradas) => {
        const atividades: AtividadeFake[] = entradas.map((e, i) => ({ id: `a${i}`, flag: e.flag }))
        // A relação de acondicionamento só vale se a atividade está ligada ao produto.
        const produto: ProdutoFake = {
          id: 'p',
          atividades: entradas.map((e, i) => (e.noProduto || e.relacao ? `a${i}` : null)).filter((x): x is string => !!x),
          acondicionamento: entradas.map((e, i) => (e.relacao ? `a${i}` : null)).filter((x): x is string => !!x),
        }
        const db = montarDb(atividades, [produto])
        const porProduto = await obterCatalogoProduto(E1, 'p', db)
        const porPlano = await obterCatalogoPlano(E1, 'pl', 'p', db)

        const idsAcondProduto = new Set(porProduto.acondicionamento.map((a) => a.id))
        for (const planoAtv of porPlano.atividades) {
          const i = Number(planoAtv.id.slice(1))
          const esperado = classificarGrupoAtividade({
            flagAcondicionamento: entradas[i].flag,
            temRelacaoAcondicionamento: entradas[i].relacao,
          })
          // Rota do plano: grupo segue a função única.
          expect(planoAtv.grupo).toBe(esperado)
          // Rota do produto: atividades do produto (ligadas) seguem a mesma decisão.
          if (produto.atividades.includes(planoAtv.id)) {
            expect(idsAcondProduto.has(planoAtv.id)).toBe(esperado === 'ACONDICIONAMENTO')
          }
        }
        // Nenhuma atividade aparece nos dois grupos do produto.
        const demais = new Set(porProduto.atividades.map((a) => a.id))
        for (const id of idsAcondProduto) expect(demais.has(id)).toBe(false)
      }),
      { numRuns: 100 },
    )
  })
})
