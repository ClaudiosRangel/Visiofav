/**
 * Integração REAL (Postgres local + motor + rotas) das várias tiragens por item.
 * Spec orcamento-grafico-tiragens-por-item, tarefa 3.
 *
 * Só roda com `INTEGRACAO_LOCAL=1` e um banco local com a empresa Carton Wega importada. Cria um
 * orçamento temporário e apaga tudo no fim. Nunca aponte DATABASE_URL para produção.
 *
 *   $env:INTEGRACAO_LOCAL='1'; npx vitest run src/modules/orcamento-grafico/hierarquia/tiragens-item.integracao-local.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const ctx = vi.hoisted(() => ({ empresaId: '' }))
vi.mock('../../../middleware/authenticate', () => ({
  authenticate: async (request: any) => {
    request.user = { id: 'user-integracao', empresaId: request.headers['x-empresa'] ?? ctx.empresaId }
  },
}))

import Fastify from 'fastify'
import { prisma } from '../../../lib/prisma'
import { orcamentoGraficoRoutes } from '../orcamento-grafico.routes'
import { hierarquiaRoutes } from './hierarquia.routes'
import { aplicarTiragemEscolhida } from './aprovacao-tiragem'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })
const rodar = process.env.INTEGRACAO_LOCAL === '1'
const P = '/api/orcamento-grafico'

describe.skipIf(!rodar)('tiragens por item — integração real (banco local)', () => {
  const app = Fastify()
  let empresaId = ''
  let orcamentoId = ''
  let itemId = ''
  let corpoItem: Record<string, unknown> = {}
  let perdaCriadaId = ''
  const outraEmpresa = '00000000-0000-4000-8000-000000000000'

  const chamar = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, empresa?: string) =>
    app.inject({ method, url, payload: payload as any, headers: empresa ? { 'x-empresa': empresa } : {} })

  beforeAll(async () => {
    // O server.ts converte erro de validação Zod em 400; o Fastify isolado do teste precisa do mesmo.
    app.setErrorHandler((error: any, _request, reply) => {
      if (error?.name === 'ZodError' || Array.isArray(error?.issues)) {
        return reply.status(400).send({ message: 'Dados inválidos', issues: error.issues })
      }
      return reply.status(error?.statusCode ?? 500).send({ message: error?.message ?? 'erro' })
    })
    app.register(orcamentoGraficoRoutes, { prefix: P })
    app.register(hierarquiaRoutes, { prefix: P }) // totalizador do Fechamento, como no server.ts
    await app.ready()

    const wega = await prisma.empresa.findFirst({ where: { razaoSocial: { contains: 'CARTON WEGA' } }, select: { id: true } })
    if (!wega) throw new Error('Empresa Carton Wega não encontrada no banco local')
    empresaId = wega.id
    ctx.empresaId = empresaId

    // Tipo 2D: as fórmulas usam só L, A, SANGRIA, ABA e PINCA (sem P).
    const tipos = await prisma.tipoEmbalagem.findMany({
      where: { empresaId },
      select: { id: true, formulaLargura: true, formulaAltura: true },
    })
    const tipo = tipos.find((t) => !/\bP\b/.test(`${t.formulaLargura} ${t.formulaAltura}`) && /\bL\b/.test(t.formulaLargura))
    const papel = await prisma.precoMateriaPrima.findFirst({ where: { empresaId, precoUnitario: { gt: 0 } }, select: { id: true, precoUnitario: true } })
    const maquina = await prisma.centroProducao.findFirst({
      where: { empresaId, status: true, formatoFolhaLargura: { gt: 0 }, velocidade: { gt: 0 }, custoHora: { gt: 0 } },
      select: { id: true },
    })
    if (!tipo || !papel || !maquina) throw new Error('Faltam tipo de embalagem, papel ou máquina no banco local')

    // A rota exige ao menos um Parâmetro de Perda da empresa; cria um temporário se faltar.
    if ((await prisma.parametroPerda.count({ where: { empresaId } })) === 0) {
      const perda = await prisma.parametroPerda.create({ data: { empresaId, perdaFixaFolhas: 100, perdaVariavel: 3 }, select: { id: true } })
      perdaCriadaId = perda.id
    }

    const ultimo = await prisma.orcamentoGrafico.findFirst({ where: { empresaId }, orderBy: { numero: 'desc' }, select: { numero: true } })
    const orc = await prisma.orcamentoGrafico.create({
      data: {
        empresaId,
        numero: (ultimo?.numero ?? 0) + 90000,
        tipoEmbalagemId: tipo.id,
        medidas: { L: 190, A: 1200 },
        quantidade: 2000,
        criadoPorId: 'user-integracao',
      },
      select: { id: true },
    })
    orcamentoId = orc.id

    corpoItem = {
      tipoEmbalagemId: tipo.id,
      medidas: { L: 190, A: 1200 },
      papelId: papel.id,
      precoKg: Number(papel.precoUnitario),
      gramatura: 415,
      maquinaId: maquina.id,
      cores: [{ nome: 'Pantone 01', tipo: 'PANTONE', coberturaPercent: 50, precoKg: 65, rendimentoM2Kg: 25 }],
      aproveitamentoManual: 3,
      quantidade: 2000,
    }
  })

  afterAll(async () => {
    if (orcamentoId) {
      await prisma.itemTiragemOrcamentoGrafico.deleteMany({ where: { empresaId, item: { orcamentoId } } })
      await prisma.planoCalculoGrafico.deleteMany({ where: { empresaId, item: { orcamentoId } } })
      await prisma.itemOrcamentoGrafico.deleteMany({ where: { empresaId, orcamentoId } })
      await prisma.orcamentoGrafico.deleteMany({ where: { id: orcamentoId, empresaId } })
    }
    if (perdaCriadaId) await prisma.parametroPerda.deleteMany({ where: { id: perdaCriadaId, empresaId } })
    await app.close()
    await prisma.$disconnect()
  })

  it('1. cria o item com 3 tiragens e grava uma linha por tiragem (referência = quantidade do item)', async () => {
    const res = await chamar('POST', `${P}/${orcamentoId}/itens`, { ...corpoItem, tiragens: [1000, 2000, 5000] })
    expect(res.statusCode, res.body).toBe(201)
    itemId = res.json().id

    const lin = await chamar('GET', `${P}/${orcamentoId}/itens/${itemId}/tiragens`)
    expect(lin.statusCode, lin.body).toBe(200)
    const linhas = lin.json() as Array<any>
    expect(linhas.map((l) => l.quantidade).sort((a, b) => a - b)).toEqual([1000, 2000, 5000])
    expect(linhas[0].quantidade).toBe(2000)
    expect(linhas[0].ordem).toBe(0)
    expect(linhas.every((l) => 'contexto' in l)).toBe(false)
    const porQtd = new Map(linhas.map((l) => [l.quantidade, l]))
    expect(Number(porQtd.get(5000).custoProducao)).toBeGreaterThan(Number(porQtd.get(1000).custoProducao))
    expect(Number(porQtd.get(5000).valorTotal)).toBeGreaterThan(Number(porQtd.get(1000).valorTotal))

    const item = await prisma.itemOrcamentoGrafico.findFirst({ where: { id: itemId, empresaId } })
    expect(item?.quantidade).toBe(2000)
    expect(Number(item?.valorTotal)).toBe(Number(porQtd.get(2000).valorTotal))
  })

  it('2. o GET do orçamento devolve as tiragens de cada item', async () => {
    const res = await chamar('GET', `${P}/${orcamentoId}`)
    expect(res.statusCode, res.body).toBe(200)
    const item = (res.json().itens as Array<any>).find((i) => i.id === itemId)
    expect(item.tiragens).toHaveLength(3)
    expect(item.tiragens[0].quantidade).toBe(2000)
    expect('contexto' in item.tiragens[0]).toBe(false)
  })

  it('3. valor digitado numa tiragem: grava o valor, calcula a margem de volta e espelha na referência', async () => {
    const res = await chamar('PUT', `${P}/${orcamentoId}/itens/${itemId}/tiragens/5000`, { valorTotal: 99999.5 })
    expect(res.statusCode, res.body).toBe(200)
    const l = res.json()
    expect(Number(l.valorTotal)).toBe(99999.5)
    expect(l.valorInformado).toBe(true)
    expect(Number.isFinite(Number(l.margemPerc))).toBe(true)

    // Tiragem de referência (2000): editar o valor espelha no item.
    const ref = await chamar('PUT', `${P}/${orcamentoId}/itens/${itemId}/tiragens/2000`, { valorTotal: 12345.67 })
    expect(ref.statusCode, ref.body).toBe(200)
    const item = await prisma.itemOrcamentoGrafico.findFirst({ where: { id: itemId, empresaId } })
    expect(Number(item?.valorTotal)).toBe(12345.67)
  })

  it('3b. o Fechamento do orçamento tem uma linha por tiragem e reflete o valor digitado', async () => {
    const res = await chamar('GET', `${P}/${orcamentoId}/fechamento-totalizador`)
    expect(res.statusCode, res.body).toBe(200)
    const f = res.json() as { linhas: Array<any>; itensSemCalculo: unknown[] }
    expect(f.linhas.map((l) => l.tiragem)).toEqual([1000, 2000, 5000])
    expect(f.itensSemCalculo).toEqual([])
    expect(f.linhas.every((l) => l.itens === 1 && l.itensSemEstaTiragem === 0)).toBe(true)
    // Valores digitados no passo anterior: 12.345,67 (2.000) e 99.999,50 (5.000).
    expect(f.linhas.find((l) => l.tiragem === 2000).valorTotal).toBe(12345.67)
    expect(f.linhas.find((l) => l.tiragem === 5000).valorTotal).toBe(99999.5)
    expect(f.linhas.find((l) => l.tiragem === 5000).valorUnitario).toBeCloseTo(99999.5 / 5000, 4)
  })

  it('4. salvar o item de novo sem a lista mantém as linhas e o valor digitado', async () => {
    const res = await chamar('PUT', `${P}/${orcamentoId}/itens/${itemId}`, { ...corpoItem })
    expect(res.statusCode, res.body).toBe(200)
    const linhas = (await chamar('GET', `${P}/${orcamentoId}/itens/${itemId}/tiragens`)).json() as Array<any>
    expect(linhas).toHaveLength(3)
    const l5000 = linhas.find((l) => l.quantidade === 5000)
    expect(l5000.valorInformado).toBe(true)
    expect(Number(l5000.valorTotal)).toBe(99999.5)
  })

  it('4b. voltar ao cálculo: limpar descarta o valor digitado e refaz pela margem do item', async () => {
    const res = await chamar('PUT', `${P}/${orcamentoId}/itens/${itemId}/tiragens/5000`, { limpar: true })
    expect(res.statusCode, res.body).toBe(200)
    const l = res.json()
    expect(l.valorInformado).toBe(false)
    expect(Number(l.valorTotal)).not.toBe(99999.5)
    expect(Number(l.valorTotal)).toBeGreaterThan(0)
  })

  it('4c. aprovar exige a tiragem escolhida e torna a escolhida a referência do item', async () => {
    await prisma.orcamentoGrafico.updateMany({ where: { id: orcamentoId, empresaId }, data: { status: 'ENVIADO' } })
    try {
      const sem = await chamar('POST', `${P}/${orcamentoId}/aprovar`, {})
      expect(sem.statusCode, sem.body).toBe(400)
      expect(sem.json().code).toBe('TIRAGEM_OBRIGATORIA')
      expect([...sem.json().itens[0].tiragens].sort((a: number, b: number) => a - b)).toEqual([1000, 2000, 5000])
      const errada = await chamar('POST', `${P}/${orcamentoId}/aprovar`, { tiragens: { [itemId]: 3333 } })
      expect(errada.statusCode).toBe(400)
      const ok = await chamar('POST', `${P}/${orcamentoId}/aprovar`, { tiragens: { [itemId]: 5000 } })
      expect(ok.statusCode, ok.body).toBe(200)
      const item = await prisma.itemOrcamentoGrafico.findFirst({ where: { id: itemId, empresaId } })
      expect(item?.quantidade).toBe(5000)
      const ref = await prisma.itemTiragemOrcamentoGrafico.findFirst({ where: { itemId, empresaId, ordem: 0 } })
      expect(ref?.quantidade).toBe(5000)
      expect(Number(item?.valorTotal)).toBe(Number(ref?.valorTotal))
    } finally {
      // Volta ao estado anterior para os próximos casos (referência 2000, orçamento em rascunho).
      await aplicarTiragemEscolhida(empresaId, itemId, 2000)
      await prisma.orcamentoGrafico.updateMany({ where: { id: orcamentoId, empresaId }, data: { status: 'RASCUNHO', aprovadoEm: null } })
    }
  })
  it('5. tiragens inválidas: 400 e nada muda', async () => {
    for (const ruim of [[1000, 1000], [0], [-5], [10.5], Array.from({ length: 21 }, (_, i) => (i + 1) * 100)]) {
      const res = await chamar('PUT', `${P}/${orcamentoId}/itens/${itemId}`, { ...corpoItem, tiragens: ruim })
      expect(res.statusCode, JSON.stringify(ruim)).toBe(400)
    }
    const linhas = (await chamar('GET', `${P}/${orcamentoId}/itens/${itemId}/tiragens`)).json() as Array<any>
    expect(linhas).toHaveLength(3)
  })

  it('6. isolamento: outra empresa recebe 404 nas duas rotas novas', async () => {
    const a = await chamar('GET', `${P}/${orcamentoId}/itens/${itemId}/tiragens`, undefined, outraEmpresa)
    expect(a.statusCode).toBe(404)
    const b = await chamar('PUT', `${P}/${orcamentoId}/itens/${itemId}/tiragens/2000`, { valorTotal: 1 }, outraEmpresa)
    expect(b.statusCode).toBe(404)
  })

  it('7. tiragem inexistente: 404; sem valor nem margem: 400', async () => {
    const a = await chamar('PUT', `${P}/${orcamentoId}/itens/${itemId}/tiragens/777`, { valorTotal: 10 })
    expect(a.statusCode, a.body).toBe(404)
    const b = await chamar('PUT', `${P}/${orcamentoId}/itens/${itemId}/tiragens/2000`, {})
    expect(b.statusCode, b.body).toBe(400)
  })

  it('8. com planos, cada tiragem soma os planos: o custo cresce com a tiragem e a lista é mantida', async () => {
    const plano = {
      nome: 'Tampa',
      suporteId: (corpoItem as any).papelId,
      gramatura: 415,
      formatoLarguraMm: 650,
      formatoAlturaMm: 1225,
      numCores: 1,
      cores: (corpoItem as any).cores,
      maquinaId: (corpoItem as any).maquinaId,
    }
    const p1 = await chamar('POST', `${P}/${orcamentoId}/itens/${itemId}/planos`, plano)
    expect(p1.statusCode, p1.body).toBe(201)
    const p2 = await chamar('POST', `${P}/${orcamentoId}/itens/${itemId}/planos`, { ...plano, nome: 'Caixa' })
    expect(p2.statusCode, p2.body).toBe(201)

    const linhas = (await chamar('GET', `${P}/${orcamentoId}/itens/${itemId}/tiragens`)).json() as Array<any>
    expect(linhas.map((l) => l.quantidade).sort((a, b) => a - b)).toEqual([1000, 2000, 5000])
    const c = (q: number) => Number(linhas.find((l) => l.quantidade === q).custoProducao)
    expect(c(5000)).toBeGreaterThan(c(1000))
    // Dois planos iguais custam mais que um (a soma entra de fato).
    expect(c(2000)).toBeGreaterThan(0)
  })

  it('9. lista vazia remove as linhas; o item volta a uma tiragem só', async () => {
    const res = await chamar('PUT', `${P}/${orcamentoId}/itens/${itemId}`, { ...corpoItem, tiragens: [] })
    expect(res.statusCode, res.body).toBe(200)
    const linhas = (await chamar('GET', `${P}/${orcamentoId}/itens/${itemId}/tiragens`)).json() as Array<any>
    expect(linhas).toEqual([])
  })

  it('10. vários planos: item sem papel salva sem cálculo e ganha custo e preço ao incluir o plano', async () => {
    // Produto de vários planos do cadastro (nenhum tipo de plano fixo).
    const produtos = await prisma.produtoGrafico.findMany({ where: { empresaId }, select: { id: true } })
    let produtoMulti: string | null = null
    for (const p of produtos) {
      const rels = await prisma.relacaoCadastroGrafico.findMany({
        where: { empresaId, tipoOrigem: 'PRODUTO', idOrigem: p.id, tipoDestino: 'PLANO' },
        select: { idDestino: true },
      })
      if (rels.length === 0) continue
      const tipos = await prisma.tipoPlanoGrafico.findMany({
        where: { empresaId, status: true, id: { in: rels.map((r) => r.idDestino) } },
        select: { fixo: true },
      })
      if (tipos.length > 0 && tipos.every((t) => !t.fixo)) { produtoMulti = p.id; break }
    }
    // Banco local sem o catálogo: cria produto + tipo de plano não fixo temporários.
    const temporarios: { produto?: string; tipo?: string } = {}
    if (!produtoMulti) {
      const sufixo = Date.now().toString(36)
      const prod = await prisma.produtoGrafico.create({ data: { empresaId, codigo: `QA-MULTI-${sufixo}`, nome: 'QA vários planos' } })
      const tipo = await prisma.tipoPlanoGrafico.create({ data: { empresaId, codigo: `QA-TP-${sufixo}`, nome: 'QA Cartão', fixo: false } })
      await prisma.relacaoCadastroGrafico.create({
        data: { empresaId, tipoOrigem: 'PRODUTO', idOrigem: prod.id, tipoDestino: 'PLANO', idDestino: tipo.id },
      })
      temporarios.produto = prod.id
      temporarios.tipo = tipo.id
      produtoMulti = prod.id
    }
    try {
    const suporte = await prisma.precoMateriaPrima.findFirst({
      where: { empresaId, precoUnitario: { gt: 0 } },
      select: { id: true },
    })
    if (!suporte) throw new Error('Sem papel com gramatura no banco local')

    const { papelId: _p, precoKg: _k, ...semPapel } = corpoItem as Record<string, unknown>
    const criar = await chamar('POST', `${P}/${orcamentoId}/itens`, {
      ...semPapel, gramatura: 0, produtoGraficoId: produtoMulti, tiragens: [1000, 3000],
    })
    expect(criar.statusCode, criar.body).toBe(201)
    const novoId = criar.json().id as string
    expect(criar.json().valorTotal).toBeNull()
    const linhas0 = (await chamar('GET', `${P}/${orcamentoId}/itens/${novoId}/tiragens`)).json() as Array<any>
    expect(linhas0.map((l) => l.quantidade).sort((a: number, b: number) => a - b)).toEqual([1000, 3000])

    // Salvar de novo sem plano também funciona.
    const salvar = await chamar('PUT', `${P}/${orcamentoId}/itens/${novoId}`, {
      ...semPapel, gramatura: 0, produtoGraficoId: produtoMulti, tiragens: [1000, 3000],
    })
    expect(salvar.statusCode, salvar.body).toBe(200)

    const plano = await chamar('POST', `${P}/${orcamentoId}/itens/${novoId}/planos`, {
      nome: 'Caixa', suporteId: suporte.id, gramatura: 300, formatoLarguraMm: 650, formatoAlturaMm: 900, numCores: 4,
    })
    expect(plano.statusCode, plano.body).toBe(201)
    const item = await prisma.itemOrcamentoGrafico.findFirst({ where: { id: novoId, empresaId } })
    expect(Number(item?.custoProducao)).toBeGreaterThan(0)
    expect(Number(item?.valorTotal)).toBeGreaterThan(Number(item?.custoProducao))
    const linhas1 = (await chamar('GET', `${P}/${orcamentoId}/itens/${novoId}/tiragens`)).json() as Array<any>
    expect(linhas1.every((l) => Number(l.valorTotal) > 0)).toBe(true)

    // Salvar o item depois do plano mantém o custo dos planos.
    const salvar2 = await chamar('PUT', `${P}/${orcamentoId}/itens/${novoId}`, {
      ...semPapel, gramatura: 0, produtoGraficoId: produtoMulti,
    })
    expect(salvar2.statusCode, salvar2.body).toBe(200)
    expect(Number(salvar2.json().custoProducao)).toBeGreaterThan(0)
    } finally {
      // Itens do orçamento são apagados no afterAll; aqui só o catálogo temporário.
      if (temporarios.produto) {
        await prisma.itemTiragemOrcamentoGrafico.deleteMany({ where: { empresaId, item: { orcamentoId } } })
        await prisma.planoCalculoGrafico.deleteMany({ where: { empresaId, item: { orcamentoId } } })
        await prisma.itemOrcamentoGrafico.deleteMany({ where: { empresaId, orcamentoId, produtoGraficoId: temporarios.produto } })
        await prisma.relacaoCadastroGrafico.deleteMany({ where: { empresaId, idOrigem: temporarios.produto } })
        await prisma.produtoGrafico.deleteMany({ where: { id: temporarios.produto, empresaId } })
      }
      if (temporarios.tipo) await prisma.tipoPlanoGrafico.deleteMany({ where: { id: temporarios.tipo, empresaId } })
    }
  })
})
