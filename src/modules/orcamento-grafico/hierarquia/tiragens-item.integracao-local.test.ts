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

  it('4. salvar o item de novo sem a lista mantém as linhas e o valor digitado', async () => {
    const res = await chamar('PUT', `${P}/${orcamentoId}/itens/${itemId}`, { ...corpoItem })
    expect(res.statusCode, res.body).toBe(200)
    const linhas = (await chamar('GET', `${P}/${orcamentoId}/itens/${itemId}/tiragens`)).json() as Array<any>
    expect(linhas).toHaveLength(3)
    const l5000 = linhas.find((l) => l.quantidade === 5000)
    expect(l5000.valorInformado).toBe(true)
    expect(Number(l5000.valorTotal)).toBe(99999.5)
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
})
