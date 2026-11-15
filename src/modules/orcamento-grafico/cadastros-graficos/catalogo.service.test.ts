import { describe, it, expect } from 'vitest'
import {
  CatalogoError,
  obterCatalogoPlano,
  obterCatalogoProduto,
  ordenarPorRelacao,
  separarAcondicionamento,
} from './catalogo.service'

describe('ordenarPorRelacao', () => {
  const nome = (e: { nome: string }) => e.nome

  it('ordena pela ordem da relação e deixa sem ordem por último, em ordem alfabética', () => {
    const r = ordenarPorRelacao(
      [
        { id: 'a', nome: 'Zebra' },
        { id: 'b', nome: 'Beta' },
        { id: 'c', nome: 'Alfa' },
        { id: 'd', nome: 'Delta' },
      ],
      [
        { idDestino: 'a', ordem: 1 },
        { idDestino: 'b', ordem: null },
        { idDestino: 'c', ordem: null },
        { idDestino: 'd', ordem: 3 },
      ],
      nome,
    )
    expect(r.map((x) => x.id)).toEqual(['a', 'd', 'c', 'b'])
  })

  it('descarta entidades sem relação', () => {
    const r = ordenarPorRelacao(
      [
        { id: 'a', nome: 'A' },
        { id: 'x', nome: 'X' },
      ],
      [{ idDestino: 'a', ordem: 1 }],
      nome,
    )
    expect(r.map((x) => x.id)).toEqual(['a'])
  })
})

describe('separarAcondicionamento', () => {
  it('separa pela marca e pelo conjunto de relação, sem repetir', () => {
    const r = separarAcondicionamento(
      [
        { id: '1', acondicionamento: false },
        { id: '2', acondicionamento: true },
        { id: '3', acondicionamento: false },
        { id: '3', acondicionamento: false },
      ],
      new Set(['3']),
    )
    expect(r.atividades.map((a) => a.id)).toEqual(['1'])
    expect(r.acondicionamento.map((a) => a.id)).toEqual(['2', '3'])
  })
})

// ─── Prisma em memória (filtra empresaId, ativo e id in) ────────────────────

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
const E2 = 'empresa-2'

function montarDb(extra: Partial<Record<string, Linha[]>> = {}) {
  const dados: Record<string, Linha[]> = {
    produtoGrafico: [
      { id: 'prod', empresaId: E1, status: true, nome: 'Cartucho' },
      { id: 'prodInativo', empresaId: E1, status: false, nome: 'Velho' },
      { id: 'prodE2', empresaId: E2, status: true, nome: 'Outro' },
    ],
    tipoPlanoGrafico: [
      { id: 'pl1', empresaId: E1, status: true, nome: 'Cartão' },
      { id: 'pl2', empresaId: E1, status: false, nome: 'Inativo' },
      { id: 'plE2', empresaId: E2, status: true, nome: 'Alheio' },
    ],
    acabamentoGrafico: [
      { id: 'at1', empresaId: E1, status: true, nome: 'Verniz', acondicionamento: false },
      { id: 'at2', empresaId: E1, status: true, nome: 'Corte', acondicionamento: false },
      { id: 'at3', empresaId: E1, status: true, nome: 'Embalar', acondicionamento: true },
      { id: 'at4', empresaId: E1, status: false, nome: 'Inativa', acondicionamento: false },
      { id: 'atE2', empresaId: E2, status: true, nome: 'Alheia', acondicionamento: false },
    ],
    itemDiversoGrafico: [
      { id: 'it1', empresaId: E1, status: true, automatico: true, nome: 'Faca' },
      { id: 'it2', empresaId: E1, status: true, automatico: false, nome: 'Manual' },
    ],
    defaultProdutoPlano: [
      { id: 'd1', empresaId: E1, produtoId: 'prod', tipoPlanoId: 'pl1', atividadesPreMarcadas: ['at2'] },
    ],
    restricaoAcabamento: [
      { id: 'r1', empresaId: E1, acabamentoGraficoId: 'at1', nome: 'Brilho' },
      { id: 'rE2', empresaId: E2, acabamentoGraficoId: 'at1', nome: 'Alheia' },
    ],
    materialAcabamento: [
      { id: 'm1', empresaId: E1, ativo: true, nome: 'Cola Quente' },
      { id: 'm2', empresaId: E1, ativo: false, nome: 'Cola Inativa' },
    ],
    coberturaTinta: [
      { id: 'c1', empresaId: E1, ativo: true, nome: 'Escala' },
      { id: 'c2', empresaId: E1, ativo: false, nome: 'Velha' },
    ],
    suporteGrafico: [{ id: 's1', empresaId: E1, status: true, descricao: 'Cartão 250' }],
    relacaoCadastroGrafico: [
      // produto
      { empresaId: E1, tipoOrigem: 'PRODUTO', idOrigem: 'prod', tipoDestino: 'PLANO', idDestino: 'pl1', ordem: null, padrao: false },
      { empresaId: E1, tipoOrigem: 'PRODUTO', idOrigem: 'prod', tipoDestino: 'PLANO', idDestino: 'pl2', ordem: null, padrao: false },
      { empresaId: E1, tipoOrigem: 'PRODUTO', idOrigem: 'prod', tipoDestino: 'PLANO', idDestino: 'plE2', ordem: null, padrao: false },
      { empresaId: E1, tipoOrigem: 'PRODUTO', idOrigem: 'prod', tipoDestino: 'ATIVIDADE', idDestino: 'at1', ordem: 2, padrao: false },
      { empresaId: E1, tipoOrigem: 'PRODUTO', idOrigem: 'prod', tipoDestino: 'ATIVIDADE', idDestino: 'at2', ordem: 1, padrao: false },
      { empresaId: E1, tipoOrigem: 'PRODUTO', idOrigem: 'prod', tipoDestino: 'ATIVIDADE', idDestino: 'at3', ordem: 3, padrao: false },
      { empresaId: E1, tipoOrigem: 'PRODUTO', idOrigem: 'prod', tipoDestino: 'ATIVIDADE', idDestino: 'at4', ordem: 4, padrao: false },
      { empresaId: E1, tipoOrigem: 'PRODUTO', idOrigem: 'prod', tipoDestino: 'ATIVIDADE', idDestino: 'atE2', ordem: 5, padrao: false },
      { empresaId: E1, tipoOrigem: 'PRODUTO', idOrigem: 'prod', tipoDestino: 'ITEM_DIVERSO', idDestino: 'it1', ordem: null, padrao: false },
      // relação de OUTRA empresa para o mesmo produto: não pode aparecer
      { empresaId: E2, tipoOrigem: 'PRODUTO', idOrigem: 'prod', tipoDestino: 'ATIVIDADE', idDestino: 'at1', ordem: 0, padrao: false },
      // plano
      { empresaId: E1, tipoOrigem: 'PLANO', idOrigem: 'pl1', tipoDestino: 'ATIVIDADE', idDestino: 'at1', ordem: 2, padrao: false },
      { empresaId: E1, tipoOrigem: 'PLANO', idOrigem: 'pl1', tipoDestino: 'ATIVIDADE', idDestino: 'at2', ordem: 1, padrao: false },
      { empresaId: E1, tipoOrigem: 'PLANO', idOrigem: 'pl1', tipoDestino: 'ATIVIDADE', idDestino: 'at4', ordem: 3, padrao: false },
      { empresaId: E1, tipoOrigem: 'PLANO', idOrigem: 'pl1', tipoDestino: 'COBERTURA_TINTA', idDestino: 'c1', ordem: null, padrao: false },
      { empresaId: E1, tipoOrigem: 'PLANO', idOrigem: 'pl1', tipoDestino: 'COBERTURA_TINTA', idDestino: 'c2', ordem: null, padrao: false },
      { empresaId: E1, tipoOrigem: 'PLANO', idOrigem: 'pl1', tipoDestino: 'SUPORTE', idDestino: 's1', ordem: null, padrao: false },
      { empresaId: E1, tipoOrigem: 'PLANO', idOrigem: 'pl1', tipoDestino: 'ITEM_DIVERSO', idDestino: 'it1', ordem: null, padrao: false },
      { empresaId: E1, tipoOrigem: 'PLANO', idOrigem: 'pl1', tipoDestino: 'ITEM_DIVERSO', idDestino: 'it2', ordem: null, padrao: false },
      { empresaId: E1, tipoOrigem: 'ATIVIDADE', idOrigem: 'at1', tipoDestino: 'MATERIAL', idDestino: 'm1', ordem: null, padrao: false },
      { empresaId: E1, tipoOrigem: 'ATIVIDADE', idOrigem: 'at1', tipoDestino: 'MATERIAL', idDestino: 'm2', ordem: null, padrao: false },
    ],
    ...extra,
  }
  const db: Record<string, unknown> = {}
  for (const [nome, rows] of Object.entries(dados)) db[nome] = tabela(rows)
  return db as any
}

describe('obterCatalogoProduto', () => {
  it('ordena atividades pelo roteiro e separa acondicionamento', async () => {
    const r = await obterCatalogoProduto(E1, 'prod', montarDb())
    expect(r.atividades.map((a) => a.id)).toEqual(['at2', 'at1'])
    expect(r.acondicionamento.map((a) => a.id)).toEqual(['at3'])
  })

  it('filtra por status e por empresa (planos, atividades, itens)', async () => {
    const r = await obterCatalogoProduto(E1, 'prod', montarDb())
    expect(r.planos.map((p) => p.id)).toEqual(['pl1'])
    const todas = [...r.atividades, ...r.acondicionamento].map((a) => a.id)
    expect(todas).not.toContain('at4')
    expect(todas).not.toContain('atE2')
    expect(r.itensDiversos.map((i) => i.id)).toEqual(['it1'])
    expect(r.defaults).toHaveLength(1)
  })

  it('não vê relações nem produto de outra empresa', async () => {
    await expect(obterCatalogoProduto(E2, 'prod', montarDb())).rejects.toBeInstanceOf(CatalogoError)
    await expect(obterCatalogoProduto(E1, 'prodE2', montarDb())).rejects.toMatchObject({ statusCode: 404 })
  })

  it('produto inativo retorna 404', async () => {
    await expect(obterCatalogoProduto(E1, 'prodInativo', montarDb())).rejects.toMatchObject({
      statusCode: 404,
    })
  })
})

describe('obterCatalogoPlano', () => {
  it('atividades em ordem do roteiro, só ativas, com restrições e materiais da empresa', async () => {
    const r = await obterCatalogoPlano(E1, 'pl1', undefined, montarDb())
    expect(r.atividades.map((a) => a.id)).toEqual(['at2', 'at1'])
    const verniz = r.atividades.find((a) => a.id === 'at1')!
    expect(verniz.restricoes.map((x) => x.id)).toEqual(['r1'])
    expect(verniz.materiais.map((m) => m.id)).toEqual(['m1'])
  })

  it('filtra coberturas inativas e itens diversos não automáticos', async () => {
    const r = await obterCatalogoPlano(E1, 'pl1', undefined, montarDb())
    expect(r.coberturas.map((c) => c.id)).toEqual(['c1'])
    expect(r.suportes.map((s) => s.id)).toEqual(['s1'])
    expect(r.itensDiversosAutomaticos.map((i) => i.id)).toEqual(['it1'])
  })

  it('com produtoId marca as atividades pré-marcadas do default', async () => {
    const r = await obterCatalogoPlano(E1, 'pl1', 'prod', montarDb())
    expect(r.atividades.find((a) => a.id === 'at2')!.preMarcada).toBe(true)
    expect(r.atividades.find((a) => a.id === 'at1')!.preMarcada).toBe(false)
  })

  it('plano ou produto de outra empresa/inativo retorna 404', async () => {
    await expect(obterCatalogoPlano(E1, 'plE2', undefined, montarDb())).rejects.toMatchObject({
      statusCode: 404,
    })
    await expect(obterCatalogoPlano(E1, 'pl2', undefined, montarDb())).rejects.toMatchObject({
      statusCode: 404,
    })
    await expect(obterCatalogoPlano(E1, 'pl1', 'prodE2', montarDb())).rejects.toMatchObject({
      statusCode: 404,
    })
    await expect(obterCatalogoPlano(E2, 'pl1', undefined, montarDb())).rejects.toMatchObject({
      statusCode: 404,
    })
  })
})
