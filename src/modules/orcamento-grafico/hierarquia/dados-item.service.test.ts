import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => {
  const model = () => Object.fromEntries(['findFirst', 'findMany'].map((m) => [m, vi.fn()]))
  return {
    prismaMock: {
      itemOrcamentoGrafico: model(),
      relacaoCadastroGrafico: model(),
      tipoPlanoGrafico: model(),
      suporteGrafico: model(),
      acabamentoGrafico: model(),
    } as Record<string, any>,
  }
})
vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }))

import { fmtNumero, obterDadosItem, resolverEstrutura } from './dados-item.service'

const vetores = JSON.parse(
  readFileSync(join(process.cwd(), 'src', 'modules', 'orcamento-grafico', 'hierarquia', 'vetores-layout.json'), 'utf8'),
).vetores as Array<{
  id: string
  entrada: { tiposPlano: Array<{ id: string; fixo: boolean }> }
  saidaEsperada: { estrutura: string; tipoPlanoFixoId: string | null }
}>

describe('resolverEstrutura × vetores-layout.json (mesma regra do front)', () => {
  it('há vetores carregados', () => {
    expect(vetores.length).toBeGreaterThan(0)
  })
  for (const v of vetores) {
    it(`vetor ${v.id}`, () => {
      const r = resolverEstrutura(v.entrada.tiposPlano)
      expect(r.estrutura).toBe(v.saidaEsperada.estrutura)
      expect(r.tipoPlanoFixoId).toBe(v.saidaEsperada.tipoPlanoFixoId)
    })
  }
})

describe('fmtNumero', () => {
  it('usa vírgula e no máximo 2 casas', () => {
    expect(fmtNumero(12)).toBe('12')
    expect(fmtNumero(12.5)).toBe('12,5')
    expect(fmtNumero(12.345)).toBe('12,35')
  })
})

const baseItem = {
  id: 'i1', produtoGraficoId: 'p1', papelId: null, papelDescricao: 'Stora Enzo Bobina 415', gramatura: '415', numCores: 3,
  cores: [{ nome: 'Pantone 01' }, { nome: 'Pantone 02' }], acabamentosRicos: [{ acabamentoId: 'a1' }, { nome: 'Cortadeira', restricaoNome: 'Lateral' }],
  itensDiversos: [{ descricao: 'Fita', quantidade: 2 }, { descricao: '  ' }], qtdModelos: 2, comprimentoMm: '190', larguraMm: '1200', alturaMm: null,
  formatoCorteLarguraMm: '650', formatoCorteAlturaMm: '1225', processoImpressao: null, fabricante: null, planos: [],
}

beforeEach(() => vi.resetAllMocks())

describe('obterDadosItem', () => {
  it('plano único (algum tipo permitido é fixo): 5 seções e planosPersistidos informado', async () => {
    prismaMock.itemOrcamentoGrafico.findFirst.mockResolvedValue({
      ...baseItem,
      planos: [{ id: 'pl1', nome: 'Plano 1', tipoPlanoId: null, suporteId: null, gramatura: null, formatoLarguraMm: '1', formatoAlturaMm: '1', numCores: 0, cores: null, acabamentosRicos: null }],
    })
    prismaMock.relacaoCadastroGrafico.findMany.mockResolvedValue([{ idDestino: 't1' }, { idDestino: 't2' }])
    prismaMock.tipoPlanoGrafico.findMany.mockResolvedValue([{ id: 't1', fixo: false }, { id: 't2', fixo: true }])
    prismaMock.acabamentoGrafico.findMany.mockResolvedValue([{ id: 'a1', nome: 'AFT70' }])
    prismaMock.suporteGrafico.findMany.mockResolvedValue([])

    const r = await obterDadosItem('o1', 'i1', 'emp-A')
    expect(r.estrutura).toBe('PLANO_UNICO')
    expect(r.planosPersistidos).toBe(1)
    expect(r.secoes.map((s) => s.chave)).toEqual(['formato', 'suporte', 'cores', 'acabamento', 'itens-diversos'])
    const porChave = Object.fromEntries(r.secoes.map((s) => [s.chave, s.linhas]))
    expect(porChave.formato).toEqual(['Formato: 190 x 1200 mm', 'Formato de corte: 650 x 1225 mm'])
    expect(porChave.suporte).toEqual(['Stora Enzo Bobina 415 — 415 g/m²'])
    expect(porChave.cores).toEqual(['3 cor(es): Pantone 01, Pantone 02'])
    expect(porChave.acabamento).toEqual(['AFT70', 'Cortadeira (Lateral)'])
    expect(porChave['itens-diversos']).toEqual(['Fita (2)'])
    // Tipos de plano lidos com empresaId explícito.
    expect(prismaMock.relacaoCadastroGrafico.findMany.mock.calls[0][0].where.empresaId).toBe('emp-A')
    expect(prismaMock.tipoPlanoGrafico.findMany.mock.calls[0][0].where.empresaId).toBe('emp-A')
  })

  it('multi-plano: 4 seções, uma linha por plano; seção sem dado volta com linhas []', async () => {
    prismaMock.itemOrcamentoGrafico.findFirst.mockResolvedValue({
      ...baseItem,
      acabamentosRicos: null,
      itensDiversos: null,
      planos: [
        { id: 'pl1', nome: 'Caixa', tipoPlanoId: 't1', suporteId: 's1', gramatura: '300', formatoLarguraMm: '650', formatoAlturaMm: '1225', numCores: 2, cores: null, acabamentosRicos: [{ nome: 'Verniz' }] },
        { id: 'pl2', nome: 'Tampa', tipoPlanoId: 't1', suporteId: null, gramatura: null, formatoLarguraMm: '0', formatoAlturaMm: '0', numCores: 0, cores: null, acabamentosRicos: null },
      ],
    })
    prismaMock.relacaoCadastroGrafico.findMany.mockResolvedValue([{ idDestino: 't1' }])
    prismaMock.tipoPlanoGrafico.findMany.mockResolvedValue([{ id: 't1', fixo: false }])
    prismaMock.suporteGrafico.findMany.mockResolvedValue([{ id: 's1', descricao: 'Cartão 300' }])
    prismaMock.acabamentoGrafico.findMany.mockResolvedValue([])

    const r = await obterDadosItem('o1', 'i1', 'emp-A')
    expect(r.estrutura).toBe('MULTI_PLANO')
    expect(r.secoes.map((s) => s.chave)).toEqual(['especificacoes-gerais', 'tipos-plano', 'acabamentos-produto', 'itens-diversos'])
    const porChave = Object.fromEntries(r.secoes.map((s) => [s.chave, s.linhas]))
    expect(porChave['tipos-plano']).toEqual([
      'Caixa — Suporte: Cartão 300 · Cores: 2 cor(es) · Formato: 650 x 1225 mm · Acabamentos: Verniz',
      'Tampa',
    ])
    expect(porChave['acabamentos-produto']).toEqual([])
    expect(porChave['itens-diversos']).toEqual([])
    expect(porChave['especificacoes-gerais']).toEqual(['Formato: 190 x 1200 mm', 'Modelos: 2'])
    expect(prismaMock.suporteGrafico.findMany.mock.calls[0][0].where.empresaId).toBe('emp-A')
  })

  it('item inexistente/de outra empresa → 404 padrão', async () => {
    prismaMock.itemOrcamentoGrafico.findFirst.mockResolvedValue(null)
    await expect(obterDadosItem('o1', 'i1', 'emp-A')).rejects.toMatchObject({ statusCode: 404, message: 'Registro não encontrado.' })
  })

  it('produto sem tipos de plano → multi-plano', async () => {
    prismaMock.itemOrcamentoGrafico.findFirst.mockResolvedValue({ ...baseItem, produtoGraficoId: null })
    prismaMock.suporteGrafico.findMany.mockResolvedValue([])
    prismaMock.acabamentoGrafico.findMany.mockResolvedValue([])
    const r = await obterDadosItem('o1', 'i1', 'emp-A')
    expect(r.estrutura).toBe('MULTI_PLANO')
    expect(prismaMock.relacaoCadastroGrafico.findMany).not.toHaveBeenCalled()
  })
})
