import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regressão do cálculo 12992 (Gerdau, rótulo, tiragem 4.000) — spec
 * orcamento-grafico-paridade-fluxo-legado, tarefa 3.13 (Req. 7.5, 9.1, 9.2, 9.3, 20.4, 20.7).
 *
 * Valores esperados, SEM tolerância (toBe / igualdade exata):
 *   custo R$ 5.192,05 · valor R$ 15.084,04 · Margem 47,62% · C.Marg. 55,01% · Valor Unitário 3,77101.
 *
 * Os três momentos são exercidos com o código REAL e Prisma mockado (padrão dos testes vizinhos):
 *   1. PUXAR  → `copiarCalculo(modo 'ITEM')` com `copiarCalculoParaItem` real (rotas) injetado em `CopiaDeps`;
 *   2. EDITAR → `POST /:id/itens/:itemId/calcular` (usa o `ancorarCustoCalcgraf` real);
 *   3. SALVAR → `PUT /:id/itens/:itemId` (usa o `ancorarCustoCalcgraf` real).
 * O motor (`calcularItem`) é substituído por um stub que devolve um valor DIVERGENTE (como o motor
 * real, ~5% abaixo): se a âncora falhar, os testes de editar/salvar quebram.
 *
 * SEM COBERTURA (depende de banco real / dado de produção):
 *   - A Foto real do 12992 (o banco de produção não existe localmente). A Foto aqui é SINTÉTICA, montada
 *     só com os campos que a cópia lê: custos.custoProducao, margens[selecionada], cev e custosCalcgraf
 *     (decomposição STC real, a mesma de decomposicao-stc.service.test.ts).
 *   - `calcularOrcamentoGrafico` real (o motor roda como stub; a regra "não chamar o motor" é do
 *     motor-guard e de custo-igualdade.test.ts).
 *   - Margem/C.Marg. em EDITAR e SALVAR: a âncora (`ancorarCustoCalcgraf`) projeta só custo/valor/STC.
 *     Nesses dois momentos a Margem vem do que o cliente envia em `margemSelecionada`, e a C.Marg. vem do
 *     resultado do motor (não ancorada). Ver "LACUNAS" no fim do arquivo.
 */

const { prismaMock, calcularItemMock } = vi.hoisted(() => {
  const model = () =>
    Object.fromEntries(
      ['findFirst', 'findUnique', 'findMany', 'create', 'update', 'updateMany', 'delete', 'count'].map((m) => [m, vi.fn()]),
    )
  const prismaMock: Record<string, any> = {
    orcamentoGrafico: model(),
    itemOrcamentoGrafico: model(),
    planoCalculoGrafico: model(),
    produtoGrafico: model(),
    defaultProdutoPlano: model(),
    tipoPlanoGrafico: model(),
    precoMateriaPrima: model(),
    calculoGrafico: model(),
    $queryRawUnsafe: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  }
  return { prismaMock, calcularItemMock: vi.fn() }
})

vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../../middleware/authenticate', () => ({
  authenticate: async (request: any) => {
    request.user = { id: 'user-1', empresaId: 'emp-A' }
  },
}))
vi.mock('../orcamento-grafico-item.service', async (importOriginal) => {
  const real = await importOriginal<typeof import('../orcamento-grafico-item.service')>()
  return { ...real, calcularItem: calcularItemMock }
})

import Fastify from 'fastify'
import { orcamentoGraficoRoutes, copiarCalculoParaItem } from '../orcamento-grafico.routes'
import { copiarCalculo, type CopiaDeps } from './calculo-copia.service'
import { agregarFechamento } from '../hierarquia/fechamento-totalizador.service'

vi.setConfig({ testTimeout: 120000, hookTimeout: 60000 })

// ── Valores de referência (sem tolerância) ───────────────────────────────────────────────
const CUSTO = 5192.05
const VALOR = 15084.04
const MARGEM = 47.62
const CM = 55.01
const TIRAGEM = 4000
const VALOR_UNITARIO = '3.77101'

const EMP = 'emp-A'
const ORC = '11111111-1111-4111-8111-111111111111'
const ITEM = '22222222-2222-4222-8222-222222222222'
const CALC = '33333333-3333-4333-8333-333333333333'
const TIPO_EMB = '66666666-6666-4666-8666-666666666666'

// Decomposição STC REAL do 12992 (soma = 5.192,05).
const CUSTOS_STC = {
  materialDireto: 4113.94,
  custoTransformacao: 1078.11,
  custoProducao: 5192.05,
  componentes: [
    { origem: 'SUPORTE', grupo: 'MD', descricao: '0001Stora Enzo Bobina  415', valorTotal: 3010.745703875, quantFixa: 0, quantVariavel: 440.8119625, valorCm: 0 },
    { origem: 'CENTRO DE CUSTO', grupo: 'CT', descricao: '0001Offset Plana Roland RVU 4 cores', valorTotal: 732.790014684288, quantFixa: 4.5, quantVariavel: 0.734214390602056, valorCm: 732.79 },
    { origem: 'MAT.ACABAMENTO', grupo: 'MD', descricao: '0001BOPP Brilho (F100)', valorTotal: 581.8241, quantFixa: 0, quantVariavel: 1057.862, valorCm: 0 },
    { origem: 'MATRIZ IMPRESSÃO', grupo: 'MD', descricao: '0001RVU', valorTotal: 300, quantFixa: 3, quantVariavel: 0, valorCm: 0 },
    { origem: 'CENTRO DE CUSTO', grupo: 'CT', descricao: '0001Guilhotina de envol', valorTotal: 155.38, quantFixa: 0, quantVariavel: 2, valorCm: 155.38 },
    { origem: 'TINTA', grupo: 'MD', descricao: '0001Pantone 01 (424C - CINZA)', valorTotal: 101.164305949008, quantFixa: 0.2, quantVariavel: 1.35637393767705, valorCm: 0 },
    { origem: 'CENTRO DE CUSTO', grupo: 'CT', descricao: '0001Laminação maior / Plastificadora mai', valorTotal: 100, quantFixa: 0, quantVariavel: 1.66666666666667, valorCm: 100 },
    { origem: 'CENTRO DE CUSTO', grupo: 'CT', descricao: '0001Cortadeira (Grande)', valorTotal: 89.9390555555555, quantFixa: 0.25, quantVariavel: 0.544444444444444, valorCm: 89.94 },
    { origem: 'TINTA', grupo: 'MD', descricao: '0001Pantone 03 (123C - AMARELO)', valorTotal: 76.0509915014164, quantFixa: 0.2, quantVariavel: 0.290651558073654, valorCm: 0 },
    { origem: 'TINTA', grupo: 'MD', descricao: '0001Pantone 02 (295C - AZUL)', valorTotal: 44.1586402266289, quantFixa: 0.2, quantVariavel: 0.290651558073654, valorCm: 0 },
  ],
}

/** Cálculo Padrão 12992 (registro do Prisma, sintético). Coluna `custoProducao` < foto (sem crédito IPI), como em produção. */
function calculo12992() {
  return {
    id: CALC,
    empresaId: EMP,
    numero: 900,
    numeroCalcgraf: 12992,
    origem: 'MIGRADO_CALCGRAF',
    status: 'ATIVO',
    cancelado: false,
    origemCopiaId: null,
    clienteId: null,
    clienteNome: 'Gerdau',
    clienteDoc: null,
    clienteCodigo: null,
    linhaProduto: 'LÂMINAS',
    produto: 'Impressos',
    descricao: 'Rótulo p/ farpado GIR 500M',
    siglaAcabado: null,
    engenhariaCompleta: true,
    engenhariaPendentes: null,
    tipoEmbalagemId: TIPO_EMB,
    medidas: { L: 190, A: 1200, largura: 190, altura: 1200 },
    papelId: null,
    papelDescricao: 'Stora Enzo Bobina 415',
    suporteId: null,
    gramatura: 415,
    numCores: 3,
    cores: [
      { nome: 'Pantone 01', cobertura: 30, precoKg: 71.5, rendimentoM2Kg: 25, tipo: 'PANTONE' },
      { nome: 'Pantone 02', cobertura: 30, precoKg: 99, rendimentoM2Kg: 25, tipo: 'PANTONE' },
      { nome: 'Pantone 03', cobertura: 30, precoKg: 170.5, rendimentoM2Kg: 25, tipo: 'PANTONE' },
    ],
    maquinaId: 'maq-1',
    matrizQuantidade: 3,
    matrizPrecoUnitario: 100,
    tintaModo: null,
    tintaConsumoKg: null,
    acabamentosRicos: null,
    modeloFacaId: null,
    aproveitamentoManual: 3,
    montagemLinhas: null,
    montagemColunas: null,
    formatoCorteLarguraMm: 650,
    formatoCorteAlturaMm: 1225,
    itensDiversos: null,
    itensFornecidos: null,
    camposLivres: null,
    custosCalcgraf: CUSTOS_STC,
    quantidade: TIRAGEM,
    custoProducao: 5104.36,
    valorTotal: VALOR,
    margemSelecionada: null,
    resultadoCalculo: {
      versaoFoto: 2,
      cabecalho: { tributacao: 'ICMS + IPI', siglaAcabado: null },
      custos: { custoProducao: CUSTO },
      margens: [
        { selecionada: false, margemPercent: 30, cmPercent: 45, valorTotal: 12000 },
        { selecionada: true, margemPercent: MARGEM, cmPercent: CM, valorTotal: VALOR },
        { selecionada: false, margemPercent: 60, cmPercent: 65, valorTotal: 20000 },
      ],
      cev: { totalPercent: 21.25 },
    },
    custoProducaoColuna: undefined,
    fotosAnteriores: null,
    criadoPorId: null,
  }
}

/** Resultado "cru" do motor para o 12992: ~5% abaixo do Calcgraf (4.736,80) e preço divergente. */
function resultadoDoMotor() {
  return {
    materialDireto: 3870.22,
    custoTransformacao: 866.58,
    servicoExterno: 0,
    custoProducao: 4736.8,
    custoTotal: 4736.8,
    precoVenda: 14100,
    precoUnitario: 3.525,
    cevPerc: 0,
    cevValor: 0,
    contribuicaoMarginalValor: 0,
    contribuicaoMarginalPerc: 0,
    papel: { pesoKg: 480, custo: 3579.47 },
    tinta: { custoTotal: 0, detalhePorCor: [] },
    maquinas: { custoTotal: 0, detalhePorEtapa: [] },
    acabamentos: { custoTotal: 0, detalhePorAcabamento: [] },
  }
}

/** Valor Unitário com 5 casas = valorTotal / tiragem. */
const valorUnitario5 = (valorTotal: number, tiragem: number) => (valorTotal / tiragem).toFixed(5)

function prepararBancoCopia() {
  const calc = calculo12992()
  prismaMock.$transaction.mockImplementation(async (arg: any) =>
    typeof arg === 'function' ? arg(prismaMock) : Promise.all(arg),
  )
  prismaMock.$executeRaw.mockResolvedValue(1)
  prismaMock.calculoGrafico.findUnique.mockResolvedValue({ empresaId: EMP })
  prismaMock.calculoGrafico.findFirst.mockImplementation(async ({ where, orderBy }: any) => {
    if (orderBy?.numero === 'desc') return { numero: 900 }
    return where?.id === CALC && where?.empresaId === EMP ? calc : null
  })
  prismaMock.calculoGrafico.create.mockImplementation(async ({ data }: any) => ({ id: 'calc-novo', numero: data.numero }))
  prismaMock.orcamentoGrafico.findFirst.mockResolvedValue({ id: ORC, serie: '1', dataOrcamento: new Date('2026-11-01T12:00:00Z') })
  prismaMock.produtoGrafico.findMany.mockResolvedValue([])
  prismaMock.defaultProdutoPlano.findMany.mockResolvedValue([])
  prismaMock.tipoPlanoGrafico.findMany.mockResolvedValue([])
  prismaMock.itemOrcamentoGrafico.findFirst.mockResolvedValue({ sequencia: 0 })
  prismaMock.itemOrcamentoGrafico.create.mockImplementation(async ({ data }: any) => ({
    id: ITEM,
    custoProducao: data.custoProducao,
    _data: data,
  }))
  prismaMock.planoCalculoGrafico.create.mockResolvedValue({ id: 'plano-1' })
  prismaMock.$executeRawUnsafe.mockResolvedValue(1)
}

const depsReais: CopiaDeps = {
  copiarCalculoParaItem: copiarCalculoParaItem as unknown as CopiaDeps['copiarCalculoParaItem'],
  resolverMaquinaDeOrigem: async () => null,
}

async function buildApp() {
  const app = Fastify()
  app.setErrorHandler((err: any, _req, reply) => {
    reply.status(err?.name === 'ZodError' ? 400 : 500).send({ message: err?.message })
  })
  app.register(orcamentoGraficoRoutes, { prefix: '/api/orcamento-grafico' })
  await app.ready()
  return app
}

const itemBody = () => ({
  tipoEmbalagemId: TIPO_EMB,
  medidas: { L: 190, A: 1200, largura: 190, altura: 1200 },
  gramatura: 415,
  quantidade: TIRAGEM,
  margemSelecionada: MARGEM,
})

/** Banco para EDITAR/SALVAR: item existente vinculado ao cálculo 12992 (origem). */
function prepararBancoItem(comOrigem: boolean) {
  const calc = calculo12992()
  prismaMock.$transaction.mockImplementation(async (arg: any) =>
    typeof arg === 'function' ? arg(prismaMock) : Promise.all(arg),
  )
  prismaMock.itemOrcamentoGrafico.findFirst.mockResolvedValue({ id: ITEM })
  prismaMock.itemOrcamentoGrafico.findMany.mockResolvedValue([])
  prismaMock.planoCalculoGrafico.findMany.mockResolvedValue([])
  prismaMock.orcamentoGrafico.update.mockResolvedValue({})
  prismaMock.itemOrcamentoGrafico.update.mockImplementation(async ({ data }: any) => ({ id: ITEM, ...data }))
  prismaMock.$executeRawUnsafe.mockResolvedValue(1)
  prismaMock.$queryRawUnsafe.mockImplementation(async (sql: string) =>
    String(sql).includes('calculo_grafico_origem_id')
      ? [{ calculo_grafico_origem_id: comOrigem ? CALC : null }]
      : [],
  )
  prismaMock.calculoGrafico.findFirst.mockImplementation(async ({ where }: any) =>
    where?.id === CALC && where?.empresaId === EMP ? calc : null,
  )
  prismaMock.precoMateriaPrima.findFirst.mockResolvedValue(null)
  calcularItemMock.mockImplementation(async () => resultadoDoMotor())
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('regressão 12992 — momento 1: PUXAR (copiarCalculo, modo ITEM)', () => {
  it('item nasce com custo 5.192,05, valor 15.084,04, margem 47,62%, C.Marg. 55,01% e VU 3,77101', async () => {
    prepararBancoCopia()
    const r = await copiarCalculo(
      { empresaId: EMP, usuarioId: 'user-1', origemId: CALC, modo: 'ITEM', orcamentoId: ORC },
      depsReais,
    )
    expect(r.itemId).toBe(ITEM)

    const data = prismaMock.itemOrcamentoGrafico.create.mock.calls[0][0].data
    expect(Number(data.custoProducao)).toBe(CUSTO)
    expect(Number(data.valorTotal)).toBe(VALOR)
    expect(Number(data.margemSelecionada)).toBe(MARGEM)
    expect(data.resultadoCalculo.contribuicaoMarginalPerc).toBe(CM)
    expect(data.quantidade).toBe(TIRAGEM)
    expect(valorUnitario5(Number(data.valorTotal), data.quantidade)).toBe(VALOR_UNITARIO)

    // vínculos de rastreio e empresa da origem
    expect(data.calculoGraficoOrigemId).toBe(CALC)
    expect(data.empresaId).toBe(EMP)
  })

  it('a decomposição STC fecha com o custo e não altera o custo do item (MD + CT = 5.192,05)', async () => {
    prepararBancoCopia()
    await copiarCalculo({ empresaId: EMP, usuarioId: 'user-1', origemId: CALC, modo: 'ITEM', orcamentoId: ORC }, depsReais)
    const res = prismaMock.itemOrcamentoGrafico.create.mock.calls[0][0].data.resultadoCalculo
    expect(res.custoProducao).toBe(CUSTO)
    expect(Math.round((res.materialDireto + res.custoTransformacao) * 100) / 100).toBe(CUSTO)
  })

  it('NÃO chama o motor ao puxar', async () => {
    prepararBancoCopia()
    await copiarCalculo({ empresaId: EMP, usuarioId: 'user-1', origemId: CALC, modo: 'ITEM', orcamentoId: ORC }, depsReais)
    expect(calcularItemMock).not.toHaveBeenCalled()
  })

  it('a origem não é alterada (nenhum update/delete em calculoGrafico)', async () => {
    prepararBancoCopia()
    await copiarCalculo({ empresaId: EMP, usuarioId: 'user-1', origemId: CALC, modo: 'ITEM', orcamentoId: ORC }, depsReais)
    expect(prismaMock.calculoGrafico.update).not.toHaveBeenCalled()
    expect(prismaMock.calculoGrafico.delete).not.toHaveBeenCalled()
  })

  it('Fechamento (parte pura) do item puxado: margem 47,62%, C.Marg. 55,01%, valor 15.084,04 na tiragem 4.000', async () => {
    prepararBancoCopia()
    await copiarCalculo({ empresaId: EMP, usuarioId: 'user-1', origemId: CALC, modo: 'ITEM', orcamentoId: ORC }, depsReais)
    const data = prismaMock.itemOrcamentoGrafico.create.mock.calls[0][0].data
    const valor = Number(data.valorTotal)
    // O totalizador lê CM em VALOR (R$): usa exatamente o que a cópia gravou, sem derivar no teste.
    const cmValor = data.resultadoCalculo.contribuicaoMarginalValor ?? null
    expect(cmValor).not.toBeNull()
    const f = agregarFechamento(ORC, [
      {
        id: ITEM,
        sequencia: 1,
        descricao: null,
        quantidade: data.quantidade,
        custoProducao: Number(data.custoProducao),
        valorTotal: valor,
        margemSelecionada: Number(data.margemSelecionada),
        cmValor,
      },
    ])
    expect(f.linhas).toHaveLength(1)
    expect(f.linhas[0].tiragem).toBe(TIRAGEM)
    expect(f.linhas[0].margemPerc).toBe(MARGEM)
    expect(f.linhas[0].contribuicaoMarginalPerc).toBe(CM)
    expect(f.linhas[0].valorTotal).toBe(VALOR)
    expect(f.linhas[0].custoProducao).toBe(CUSTO)
  })
})

describe('regressão 12992 — momento 2: EDITAR (POST /:id/itens/:itemId/calcular, âncora real)', () => {
  it('com origem: custo 5.192,05 e valor 15.084,04 mesmo com o motor devolvendo 4.736,80 / 14.100', async () => {
    prepararBancoItem(true)
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/orcamento-grafico/${ORC}/itens/${ITEM}/calcular`,
      headers: { 'x-empresa': EMP },
      payload: itemBody(),
    })
    expect(res.statusCode).toBe(200)
    const j = res.json()
    expect(j.fechamento.custoProducao).toBe(CUSTO)
    expect(j.fechamento.valorTotal).toBe(VALOR)
    expect(j.resultado.custoProducao).toBe(CUSTO)
    expect(j.resultado.precoVenda).toBe(VALOR)
    expect(valorUnitario5(j.fechamento.valorTotal, TIRAGEM)).toBe(VALOR_UNITARIO)

    const upd = prismaMock.itemOrcamentoGrafico.update.mock.calls[0][0].data
    expect(upd.custoProducao).toBe(CUSTO)
    expect(upd.valorTotal).toBe(VALOR)
    expect(upd.margemSelecionada).toBe(MARGEM)
  })

  it('sem origem (item novo do zero): NÃO ancora e usa o resultado do motor', async () => {
    prepararBancoItem(false)
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/orcamento-grafico/${ORC}/itens/${ITEM}/calcular`,
      headers: { 'x-empresa': EMP },
      payload: itemBody(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().fechamento.custoProducao).toBe(4736.8)
    expect(res.json().fechamento.valorTotal).toBe(14100)
  })
})

describe('regressão 12992 — momento 3: SALVAR (PUT /:id/itens/:itemId, âncora real)', () => {
  it('com origem: grava custo 5.192,05, valor 15.084,04, margem 47,62% e VU 3,77101', async () => {
    prepararBancoItem(true)
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT',
      url: `/api/orcamento-grafico/${ORC}/itens/${ITEM}`,
      headers: { 'x-empresa': EMP },
      payload: itemBody(),
    })
    expect(res.statusCode).toBe(200)
    const upd = prismaMock.itemOrcamentoGrafico.update.mock.calls[0][0].data
    expect(upd.custoProducao).toBe(CUSTO)
    expect(upd.valorTotal).toBe(VALOR)
    expect(upd.margemSelecionada).toBe(MARGEM)
    expect(upd.resultadoCalculo.custoProducao).toBe(CUSTO)
    expect(upd.resultadoCalculo.precoVenda).toBe(VALOR)
    expect(valorUnitario5(upd.valorTotal, upd.quantidade)).toBe(VALOR_UNITARIO)
    // a âncora consulta o cálculo de origem sempre filtrando por empresa
    expect(prismaMock.calculoGrafico.findFirst.mock.calls.some(([a]: any) => a?.where?.empresaId === EMP && a?.where?.id === CALC)).toBe(true)
  })

  it('sem origem: não ancora (grava o resultado do motor) e não falha', async () => {
    prepararBancoItem(false)
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT',
      url: `/api/orcamento-grafico/${ORC}/itens/${ITEM}`,
      headers: { 'x-empresa': EMP },
      payload: itemBody(),
    })
    expect(res.statusCode).toBe(200)
    const upd = prismaMock.itemOrcamentoGrafico.update.mock.calls[0][0].data
    expect(upd.custoProducao).toBe(4736.8)
    expect(upd.valorTotal).toBe(14100)
  })

  it('origem inexistente (cálculo sumiu): segue com o motor, sem erro', async () => {
    prepararBancoItem(true)
    prismaMock.calculoGrafico.findFirst.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT',
      url: `/api/orcamento-grafico/${ORC}/itens/${ITEM}`,
      headers: { 'x-empresa': EMP },
      payload: itemBody(),
    })
    expect(res.statusCode).toBe(200)
    expect(prismaMock.itemOrcamentoGrafico.update.mock.calls[0][0].data.custoProducao).toBe(4736.8)
  })
})

describe('regressão 12992 — parte pura: Valor Unitário com 5 casas', () => {
  it('15.084,04 / 4.000 = 3,77101', () => {
    expect(valorUnitario5(VALOR, TIRAGEM)).toBe(VALOR_UNITARIO)
  })
})

/**
 * LACUNAS encontradas (não corrigidas aqui: fora do escopo da 3.13 e proibidas de mexer em motor/âncora):
 *  1. `agregarFechamento` arredonda o Valor Unitário a 4 casas (`arred4`): 15.084,04 / 4.000 vira 3,7710,
 *     não 3,77101. Se o Fechamento mostrar `valorUnitario` do DTO, o valor exibido diverge do requisito
 *     (5 casas). A formatação do front não recalcula.
 *  2. A cópia projeta só `contribuicaoMarginalPerc` (55,01) no resultado do item; o totalizador lê
 *     `contribuicaoMarginalValor` (R$) do JSON. Para um item recém-puxado a C.Marg. do Fechamento sai
 *     `null` até que algo grave o valor em R$.
 *  3. Em EDITAR/SALVAR a âncora não projeta Margem nem C.Marg.: a Margem depende de `margemSelecionada`
 *     enviado pelo cliente e a C.Marg. vem do motor.
 */
describe('regressão 12992 — lacunas documentadas (comportamento atual)', () => {
  it('(1) o DTO do Fechamento arredonda o Valor Unitário a 4 casas', () => {
    const f = agregarFechamento(ORC, [
      { id: ITEM, sequencia: 1, descricao: null, quantidade: TIRAGEM, custoProducao: CUSTO, valorTotal: VALOR, margemSelecionada: MARGEM, cmValor: 8297.77 },
    ])
    expect(f.linhas[0].valorUnitario).toBe(3.771)
  })
})
