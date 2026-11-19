import { describe, it, expect, vi, beforeAll } from 'vitest'
import fc from 'fast-check'

/**
 * Fase 3 (Tarefa 4.4) — `POST /:id/reaproveitar` e `POST /de-calculo` com Prisma mockado.
 *
 * A transação é simulada por um diário: as gravações feitas no `tx` ficam num buffer
 * que só é "confirmado" se a função da transação terminar sem erro. Falha injetada
 * em qualquer etapa → buffer descartado (nada persiste) e o status atual é mantido.
 * O motor de cálculo é substituído por stubs.
 */

const { prismaMock, calcularItemMock, montarParamsDoPlanoMock, calcularOrcamentoMock, garantirMock } = vi.hoisted(
  () => {
    const model = (...extra: string[]) =>
      Object.fromEntries(
        ['findFirst', 'findUnique', 'findMany', 'create', 'update', 'updateMany', 'delete', ...extra].map((m) => [
          m,
          vi.fn(),
        ]),
      )
    const prismaMock: Record<string, any> = {
      orcamentoGrafico: model(),
      itemOrcamentoGrafico: model(),
      planoCalculoGrafico: model(),
      produtoGrafico: model(),
      tipoPlanoGrafico: model(),
      calculoGrafico: model(),
      $queryRawUnsafe: vi.fn(),
      $executeRawUnsafe: vi.fn(),
      $transaction: vi.fn(),
    }
    return {
      prismaMock,
      calcularItemMock: vi.fn(),
      montarParamsDoPlanoMock: vi.fn(),
      calcularOrcamentoMock: vi.fn(),
      garantirMock: vi.fn(),
    }
  },
)

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../middleware/authenticate', () => ({
  authenticate: async (request: any) => {
    request.user = { id: 'user-1', empresaId: request.headers['x-empresa'] ?? 'emp-A' }
  },
}))
vi.mock('./orcamento-grafico-item.service', async (importOriginal) => {
  const real = await importOriginal<typeof import('./orcamento-grafico-item.service')>()
  return { ...real, calcularItem: calcularItemMock, montarParamsDoPlano: montarParamsDoPlanoMock }
})
vi.mock('./orcamento-grafico-calculo.service', async (importOriginal) => {
  const real = await importOriginal<typeof import('./orcamento-grafico-calculo.service')>()
  return { ...real, calcularOrcamentoGrafico: calcularOrcamentoMock }
})
vi.mock('./calculo-grafico/calculo-grafico.service', async (importOriginal) => {
  const real = await importOriginal<typeof import('./calculo-grafico/calculo-grafico.service')>()
  return { ...real, garantirEngenhariaCompleta: garantirMock }
})

import Fastify from 'fastify'
import { orcamentoGraficoRoutes } from './orcamento-grafico.routes'

vi.setConfig({ testTimeout: 120000, hookTimeout: 60000 })

const P = '/api/orcamento-grafico'
const hA = { 'x-empresa': 'emp-A' }
const hB = { 'x-empresa': 'emp-B' }

const ORC_ORIG = '11111111-1111-4111-8111-111111111111'
const ORC_NOVO = '12121212-1212-4212-8212-121212121212'
const ITEM_NOVO = '22222222-2222-4222-8222-222222222222'
const PLANO_NOVO = '33333333-3333-4333-8333-333333333333'
const PROD = '44444444-4444-4444-8444-444444444444'
const TIPO_PLANO = '55555555-5555-4555-8555-555555555555'
const TIPO_EMB = '66666666-6666-4666-8666-666666666666'
const CALC = '77777777-7777-4777-8777-777777777777'

function RESULTADO() {
  return {
    materialDireto: 60,
    custoTransformacao: 40,
    servicoExterno: 0,
    custoProducao: 100,
    custoTotal: 100,
    precoVenda: 150,
  }
}

// ── Transação simulada ──────────────────────────────────────────────────────

type Registro = { op: string; args: any }
const diario = {
  confirmado: [] as Registro[],
  todas: [] as Registro[], // leituras + gravações do tx (para checar empresaId explícito)
  opcoes: [] as any[],
}
const cenario = {
  falhaEm: null as string | null,
  erro: null as any,
  catalogo: new Set<string>(), // `${empresaId}:${tipo}:${id}`
}

function makeTx(buf: Registro[]) {
  const itensCriados: any[] = []
  const planosCriados: any[] = []
  const registrar = (op: string, args: any) => {
    diario.todas.push({ op, args })
  }
  const escrita = (op: string, impl: (args: any) => any) =>
    vi.fn(async (args: any) => {
      registrar(op, args)
      buf.push({ op, args })
      if (cenario.falhaEm === op) throw cenario.erro
      return impl(args)
    })
  const leitura = (op: string, impl: (args: any) => any) =>
    vi.fn(async (args: any) => {
      registrar(op, args)
      return impl(args)
    })
  const busca = (tipo: string) =>
    leitura(`${tipo}.findFirst`, ({ where }: any) =>
      cenario.catalogo.has(`${where.empresaId}:${tipo}:${where.id}`) ? { id: where.id } : null,
    )

  return {
    orcamentoGrafico: {
      findFirst: leitura('orcamentoGrafico.findFirst', () => ({ numero: 7 })),
      create: escrita('orcamentoGrafico.create', ({ data }) => ({
        id: ORC_NOVO,
        numero: data.numero,
        versao: 1,
        ...data,
      })),
      update: escrita('orcamentoGrafico.update', () => ({})),
    },
    itemOrcamentoGrafico: {
      create: escrita('itemOrcamentoGrafico.create', ({ data }) => {
        const criado = { id: ITEM_NOVO, ...data }
        itensCriados.push(criado)
        return criado
      }),
      update: escrita('itemOrcamentoGrafico.update', ({ data }) => {
        Object.assign(itensCriados[0] ?? {}, data)
        return {}
      }),
      findMany: leitura('itemOrcamentoGrafico.findMany', () => itensCriados),
      findFirst: leitura('itemOrcamentoGrafico.findFirst', () => itensCriados[0] ?? null),
    },
    planoCalculoGrafico: {
      create: escrita('planoCalculoGrafico.create', ({ data }) => {
        const criado = { id: PLANO_NOVO, ...data }
        planosCriados.push(criado)
        return criado
      }),
      findMany: leitura('planoCalculoGrafico.findMany', () => planosCriados),
    },
    produtoGrafico: { findFirst: busca('produtoGrafico') },
    tipoPlanoGrafico: { findFirst: busca('tipoPlanoGrafico') },
    // Série padrão ativa da empresa + reserva atômica do Nº (proximo_numero 8).
    serieDocumento: {
      findFirst: leitura('serieDocumento.findFirst', ({ where }: any) => ({ id: `serie-${where.empresaId}`, nome: '' })),
    },
    $queryRaw: vi.fn(async () => {
      diario.todas.push({ op: 'raw', args: null })
      return [{ numero: 8 }]
    }),
    $executeRawUnsafe: escrita('raw', () => 1),
  }
}

function reiniciarCenario() {
  diario.confirmado = []
  diario.todas = []
  diario.opcoes = []
  cenario.falhaEm = null
  cenario.erro = null
  cenario.catalogo = new Set()
  for (const m of Object.values(prismaMock)) {
    if (typeof m === 'function') m.mockReset()
    else for (const f of Object.values(m as Record<string, any>)) f.mockReset()
  }
  calcularItemMock.mockReset().mockImplementation(async () => RESULTADO())
  montarParamsDoPlanoMock.mockReset().mockResolvedValue({})
  calcularOrcamentoMock.mockReset().mockImplementation(() => RESULTADO())
  garantirMock.mockReset()
  prismaMock.$transaction.mockImplementation(async (fn: any, opcoes?: any) => {
    diario.opcoes.push(opcoes)
    const buf: Registro[] = []
    const resultado = await fn(makeTx(buf))
    diario.confirmado.push(...buf)
    return resultado
  })
  prismaMock.$queryRawUnsafe.mockResolvedValue([])
  prismaMock.$executeRawUnsafe.mockResolvedValue(1)
}

async function buildApp() {
  const app = Fastify()
  app.setErrorHandler((err: any, _req, reply) => {
    reply.status(err?.name === 'ZodError' ? 400 : 500).send({ message: err?.message })
  })
  app.register(orcamentoGraficoRoutes, { prefix: P })
  await app.ready()
  return app
}

let app: Awaited<ReturnType<typeof buildApp>>
beforeAll(async () => {
  app = await buildApp()
})

/** Gravações feitas diretamente no `prisma` global (devem ser zero nas rotas transacionais). */
function gravacoesGlobais() {
  return [
    prismaMock.orcamentoGrafico.create,
    prismaMock.orcamentoGrafico.update,
    prismaMock.itemOrcamentoGrafico.create,
    prismaMock.itemOrcamentoGrafico.update,
    prismaMock.planoCalculoGrafico.create,
  ].reduce((n, f) => n + f.mock.calls.length, 0)
}

// ── reaproveitar ────────────────────────────────────────────────────────────

type Estado = 'existe' | 'nulo' | 'outraEmpresa' | 'inexistente'

function origemPersistida(opts: { produtoId: string | null; tipoPlanoId: string | null; semPlano?: boolean }) {
  return {
    clienteId: null,
    clienteNome: 'Cliente X',
    vendedorId: null,
    serie: null,
    tipoEmbalagemId: TIPO_EMB,
    medidas: { L: 100, A: 200 },
    papelId: null,
    papelDescricao: null,
    gramatura: 250,
    numCores: 4,
    cores: [],
    acabamentos: null,
    quantidade: 1000,
    observacoes: null,
    produtoId: null,
    itens: [
      {
        id: '88888888-8888-4888-8888-888888888888',
        sequencia: 1,
        tipoEmbalagemId: TIPO_EMB,
        produtoGraficoId: opts.produtoId,
        descricao: null,
        medidas: { L: 100, A: 200 },
        papelId: null,
        gramatura: 250,
        numCores: 4,
        cores: [],
        maquinaId: null,
        acabamentosRicos: null,
        quantidade: 1000,
        matrizQuantidade: null,
        matrizPrecoUnitario: null,
        tintaModo: null,
        tintaConsumoKg: null,
        modeloFacaId: null,
        itensDiversos: null,
        itensFornecidos: null,
        montagemLinhas: null,
        montagemColunas: null,
        formatoCorteLarguraMm: null,
        formatoCorteAlturaMm: null,
        margemSelecionada: null,
        resultadoCalculo: RESULTADO(),
        custoProducao: 100,
        valorTotal: 150,
        planos: opts.semPlano
          ? []
          : [
              {
                id: '99999999-9999-4999-8999-999999999999',
                sequencia: 1,
                nome: 'Tampa',
                tipoPlanoId: opts.tipoPlanoId,
                suporteId: null,
                suporteProducaoId: null,
                gramatura: 250,
                formatoLarguraMm: 650,
                formatoAlturaMm: 1000,
                preImpressao: null,
                numCores: 4,
                cores: [],
                maquinaId: null,
                acabamentosRicos: null,
                montagemLinhas: null,
                montagemColunas: null,
                resultadoCalculo: RESULTADO(),
                custoSuporte: 10,
                custoImpressao: 20,
                custoAcabamento: 30,
              },
            ],
      },
    ],
  }
}

function idPorEstado(estado: Estado, id: string, aleatorio: string, tipo: string): string | null {
  switch (estado) {
    case 'nulo':
      return null
    case 'existe':
      cenario.catalogo.add(`emp-A:${tipo}:${id}`)
      return id
    case 'outraEmpresa':
      cenario.catalogo.add(`emp-B:${tipo}:${id}`) // existe, mas só na outra empresa
      return id
    case 'inexistente':
      return aleatorio
  }
}

function prepararReaproveitar(opts: {
  produto: Estado
  tipoPlano: Estado
  aleatorioProduto?: string
  aleatorioTipo?: string
  planoRecalcula?: boolean
  semPlano?: boolean
}) {
  reiniciarCenario()
  const produtoId = idPorEstado(opts.produto, PROD, opts.aleatorioProduto ?? PROD, 'produtoGrafico')
  const tipoPlanoId = idPorEstado(opts.tipoPlano, TIPO_PLANO, opts.aleatorioTipo ?? TIPO_PLANO, 'tipoPlanoGrafico')
  const origem = origemPersistida({ produtoId, tipoPlanoId, semPlano: opts.semPlano })
  prismaMock.orcamentoGrafico.findFirst.mockImplementation(async ({ where }: any) =>
    where.id === ORC_ORIG && where.empresaId === 'emp-A' ? origem : null,
  )
  if (opts.planoRecalcula === false) montarParamsDoPlanoMock.mockRejectedValue(new Error('sem preço'))
  return { origem, produtoId, tipoPlanoId }
}

const reaproveitar = (headers = hA, payload: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: `${P}/${ORC_ORIG}/reaproveitar`, headers, payload })

function porOp(op: string) {
  return diario.confirmado.filter((r) => r.op === op)
}

describe('POST /:id/reaproveitar (Prisma mockado)', () => {
  it('copia produtoGraficoId e tipoPlanoId existentes na empresa, em transação com timeout elevado', async () => {
    prepararReaproveitar({ produto: 'existe', tipoPlano: 'existe', planoRecalcula: true })
    const res = await reaproveitar()
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ id: ORC_NOVO, numero: 8, versao: 1 })
    expect(porOp('itemOrcamentoGrafico.create')[0].args.data.produtoGraficoId).toBe(PROD)
    expect(porOp('planoCalculoGrafico.create')[0].args.data.tipoPlanoId).toBe(TIPO_PLANO)
    expect(diario.opcoes[0].timeout).toBeGreaterThanOrEqual(20000)
    expect(gravacoesGlobais()).toBe(0)
  })

  it('copia o tipoPlanoId também na cópia-espelho (recálculo do plano indisponível)', async () => {
    prepararReaproveitar({ produto: 'existe', tipoPlano: 'existe', planoRecalcula: false })
    const res = await reaproveitar()
    expect(res.statusCode).toBe(201)
    expect(porOp('planoCalculoGrafico.create')[0].args.data.tipoPlanoId).toBe(TIPO_PLANO)
  })

  it.each([['outraEmpresa'], ['inexistente']] as [Estado][])(
    'id %s vira null no item e no plano, sem falha e sem aviso',
    async (estado) => {
      prepararReaproveitar({ produto: estado, tipoPlano: estado, aleatorioProduto: PROD, aleatorioTipo: TIPO_PLANO })
      const res = await reaproveitar()
      expect(res.statusCode).toBe(201)
      expect(res.json().avisos).toEqual([])
      expect(porOp('itemOrcamentoGrafico.create')[0].args.data.produtoGraficoId).toBeNull()
      expect(porOp('planoCalculoGrafico.create')[0].args.data.tipoPlanoId).toBeNull()
    },
  )

  it('não cria SelecaoMaterialAcabamento nem aplica defaults do produto', async () => {
    prepararReaproveitar({ produto: 'existe', tipoPlano: 'existe' })
    await reaproveitar()
    const ops = diario.todas.map((r) => r.op)
    expect(ops.some((o) => /selecao/i.test(o))).toBe(false)
    // o item copia os valores do item de origem, não valores vindos do produto
    const data = porOp('itemOrcamentoGrafico.create')[0].args.data
    expect(data.gramatura).toBe(250)
    expect(data.numCores).toBe(4)
  })

  it('mantém 404 para origem inexistente ou de outra empresa, sem gravar nada', async () => {
    prepararReaproveitar({ produto: 'nulo', tipoPlano: 'nulo' })
    const res = await reaproveitar(hB)
    expect(res.statusCode).toBe(404)
    expect(diario.todas.length).toBe(0)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('todo where e data do tx carregam empresaId explícito (empresa da sessão)', async () => {
    prepararReaproveitar({ produto: 'existe', tipoPlano: 'existe' })
    const res = await reaproveitar(hA, { quantidade: 500 })
    expect(res.statusCode).toBe(201)
    for (const { op, args } of diario.todas) {
      if (op === 'raw') continue
      if (op.endsWith('.create')) expect(args.data.empresaId, op).toBe('emp-A')
      else expect(args.where.empresaId, op).toBe('emp-A')
    }
    expect(prismaMock.calculoGrafico.findFirst).not.toHaveBeenCalled()
  })

  it('sem planos, reaproveita só o item e consolida o orçamento', async () => {
    prepararReaproveitar({ produto: 'existe', tipoPlano: 'nulo', semPlano: true })
    const res = await reaproveitar()
    expect(res.statusCode).toBe(201)
    expect(porOp('planoCalculoGrafico.create')).toHaveLength(0)
    expect(porOp('orcamentoGrafico.update')).toHaveLength(1)
  })
})

// ── de-calculo ──────────────────────────────────────────────────────────────

function prepararDeCalculo(opts: { produto: Estado; tipoPlano: Estado; aleatorioProduto?: string; aleatorioTipo?: string; comCampos?: boolean }) {
  reiniciarCenario()
  const produtoGraficoId = idPorEstado(opts.produto, PROD, opts.aleatorioProduto ?? PROD, 'produtoGrafico')
  const tipoPlanoId = idPorEstado(opts.tipoPlano, TIPO_PLANO, opts.aleatorioTipo ?? TIPO_PLANO, 'tipoPlanoGrafico')
  const calc: Record<string, unknown> = {
    id: CALC,
    empresaId: 'emp-A',
    numero: 1,
    origem: 'VIZOR',
    tipoEmbalagemId: TIPO_EMB,
    descricao: 'Caixa',
    medidas: { L: 100, A: 200 },
    gramatura: 250,
    numCores: 4,
    cores: [],
    quantidade: 1000,
    aproveitamentoManual: 3,
    resultadoCalculo: {},
    custoProducao: null,
    valorTotal: null,
    clienteId: null,
    clienteNome: 'Cliente X',
    custosCalcgraf: null,
    ...(opts.comCampos === false ? {} : { produtoGraficoId, tipoPlanoId }),
  }
  prismaMock.calculoGrafico.findUnique.mockResolvedValue({ id: CALC, empresaId: 'emp-A' })
  garantirMock.mockResolvedValue({ calculo: calc, clienteId: null, pendentes: [] })
  return calc
}

const deCalculo = (headers = hA) =>
  app.inject({ method: 'POST', url: `${P}/de-calculo`, headers, payload: { calculoId: CALC } })

describe('POST /de-calculo (Prisma mockado)', () => {
  it('copia produtoGraficoId (item) e tipoPlanoId (1º plano) quando o cálculo os possui', async () => {
    prepararDeCalculo({ produto: 'existe', tipoPlano: 'existe' })
    const res = await deCalculo()
    expect(res.statusCode).toBe(201)
    expect(porOp('itemOrcamentoGrafico.create')[0].args.data.produtoGraficoId).toBe(PROD)
    expect(porOp('planoCalculoGrafico.create')[0].args.data.tipoPlanoId).toBe(TIPO_PLANO)
    expect(gravacoesGlobais()).toBe(0)
  })

  it('cálculo sem os campos (caso atual): item e plano nascem sem produto e sem tipo, sem consultar o catálogo', async () => {
    prepararDeCalculo({ produto: 'nulo', tipoPlano: 'nulo', comCampos: false })
    const res = await deCalculo()
    expect(res.statusCode).toBe(201)
    expect(porOp('itemOrcamentoGrafico.create')[0].args.data.produtoGraficoId ?? null).toBeNull()
    expect(porOp('planoCalculoGrafico.create')[0].args.data.tipoPlanoId ?? null).toBeNull()
    expect(diario.todas.some((r) => r.op === 'produtoGrafico.findFirst')).toBe(false)
  })

  it.each([['outraEmpresa'], ['inexistente']] as [Estado][])('id %s vira ausente, sem falha', async (estado) => {
    prepararDeCalculo({ produto: estado, tipoPlano: estado })
    const res = await deCalculo()
    expect(res.statusCode).toBe(201)
    expect(porOp('itemOrcamentoGrafico.create')[0].args.data.produtoGraficoId ?? null).toBeNull()
    expect(porOp('planoCalculoGrafico.create')[0].args.data.tipoPlanoId ?? null).toBeNull()
  })

  it('mantém 404 (cálculo inexistente) e 403 (outra empresa) sem gravar', async () => {
    prepararDeCalculo({ produto: 'nulo', tipoPlano: 'nulo' })
    prismaMock.calculoGrafico.findUnique.mockResolvedValueOnce(null)
    expect((await deCalculo()).statusCode).toBe(404)
    prismaMock.calculoGrafico.findUnique.mockResolvedValueOnce({ id: CALC, empresaId: 'emp-X' })
    expect((await deCalculo()).statusCode).toBe(403)
    expect(diario.todas.length).toBe(0)
  })

  it('todo where e data do tx carregam empresaId explícito', async () => {
    prepararDeCalculo({ produto: 'existe', tipoPlano: 'existe' })
    expect((await deCalculo()).statusCode).toBe(201)
    for (const { op, args } of diario.todas) {
      if (op === 'raw') continue
      if (op.endsWith('.create')) expect(args.data.empresaId, op).toBe('emp-A')
      else expect(args.where.empresaId, op).toBe('emp-A')
    }
  })
})

// ── Propriedades ────────────────────────────────────────────────────────────

const estadoArb = fc.constantFrom<Estado>('existe', 'nulo', 'outraEmpresa', 'inexistente')

describe('Propriedades de reaproveitar e de-calculo', () => {
  it('Property 14: Cópia de produto e tipo de plano', async () => {
    // Feature: orcamento-grafico-fase3-produto-embalagem, Property 14: Cópia de produto e tipo de plano
    const referencia = new Map<string, unknown>()
    await fc.assert(
      fc.asyncProperty(
        estadoArb,
        estadoArb,
        fc.uuid(),
        fc.uuid(),
        fc.boolean(),
        async (produto, tipoPlano, aleatorioProduto, aleatorioTipo, planoRecalcula) => {
          const { produtoId, tipoPlanoId } = prepararReaproveitar({
            produto,
            tipoPlano,
            aleatorioProduto,
            aleatorioTipo,
            planoRecalcula,
          })
          const res = await reaproveitar()

          // mesmo status de sucesso
          expect(res.statusCode).toBe(201)
          const item = porOp('itemOrcamentoGrafico.create')[0].args.data
          const plano = porOp('planoCalculoGrafico.create')[0].args.data

          // copia só quando o id existe na empresa do usuário; senão null
          expect(item.produtoGraficoId).toBe(produto === 'existe' ? produtoId : null)
          expect(plano.tipoPlanoId).toBe(tipoPlano === 'existe' ? tipoPlanoId : null)

          // valores iguais, independentes do catálogo
          const ultimoConsolidado = porOp('orcamentoGrafico.update').at(-1)!.args.data
          const observado = JSON.stringify({
            custoProducao: item.custoProducao,
            valorTotal: item.valorTotal,
            resultadoCalculo: item.resultadoCalculo,
            consolidado: [ultimoConsolidado.custoProducaoConsolidado, ultimoConsolidado.valorTotalConsolidado],
          })
          const chave = String(planoRecalcula)
          if (!referencia.has(chave)) referencia.set(chave, observado)
          expect(observado).toBe(referencia.get(chave))
          expect(gravacoesGlobais()).toBe(0)
        },
      ),
      { numRuns: 100 },
    )
  })

  const ETAPAS_REAPROVEITAR = [
    'orcamentoGrafico.create',
    'itemOrcamentoGrafico.create',
    'planoCalculoGrafico.create',
    'itemOrcamentoGrafico.update', // reconsolidação do item com planos
    'orcamentoGrafico.update', // reconsolidação do cabeçalho
  ]
  const ETAPAS_DE_CALCULO = [
    'orcamentoGrafico.create',
    'itemOrcamentoGrafico.create',
    'raw', // aproveitamento_manual
    'planoCalculoGrafico.create',
  ]

  it('Property 15: Reaproveitar é atômico', async () => {
    // Feature: orcamento-grafico-fase3-produto-embalagem, Property 15: Reaproveitar é atômico
    const pontoArb = fc.oneof(
      fc.record({
        rota: fc.constant('reaproveitar' as const),
        etapa: fc.constantFrom(...ETAPAS_REAPROVEITAR),
        colisao: fc.boolean(),
        planoRecalcula: fc.boolean(),
      }),
      fc.record({
        rota: fc.constant('de-calculo' as const),
        etapa: fc.constantFrom(...ETAPAS_DE_CALCULO),
        colisao: fc.boolean(),
        planoRecalcula: fc.boolean(),
      }),
    )
    await fc.assert(
      fc.asyncProperty(pontoArb, async ({ rota, etapa, colisao, planoRecalcula }) => {
        if (rota === 'reaproveitar') prepararReaproveitar({ produto: 'existe', tipoPlano: 'existe', planoRecalcula })
        else prepararDeCalculo({ produto: 'existe', tipoPlano: 'existe' })

        cenario.falhaEm = etapa
        cenario.erro = colisao
          ? Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
          : new Error('falha injetada')

        const res = rota === 'reaproveitar' ? await reaproveitar() : await deCalculo()

        // o status atual da rota é mantido: P2002 → 409, qualquer outro erro → 500
        expect(res.statusCode).toBe(colisao ? 409 : 500)
        // nada confirmado: nenhum orçamento, item ou plano persiste
        expect(diario.confirmado).toEqual([])
        expect(gravacoesGlobais()).toBe(0)
        // a falha foi de fato alcançada (a etapa injetada foi executada)
        expect(diario.todas.some((r) => r.op === etapa)).toBe(true)
      }),
      { numRuns: 100 },
    )
  })
})
