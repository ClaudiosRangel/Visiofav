import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  lerConfigBancoTeste,
  exigirEmpresaId,
  montarAmbienteFluxo,
  semearCenario,
  limparCenario,
  criarOrcamento,
  puxarCalculo,
  obterOrcamento,
  editarItem,
  calcular,
  salvarItem,
  enviar,
  aprovar,
  gerarPedidoVenda,
  primeiroItemId,
  PREFIXO_QA,
  type AmbienteFluxo,
  type CenarioFluxo,
  type Ctx,
} from './fluxo-existente.helpers'

/**
 * Tarefa 1.10 — fluxo existente do Orçamento Gráfico (Req 19.6 / 19.10).
 *
 * Integração REAL (rotas Fastify via `app.inject`, Prisma real, JWT real) contra
 * um banco LOCAL/descartável. Sem `FLUXO_TEST_DATABASE_URL` (ou com host que não
 * seja local) a suíte de integração fica SKIPPED com o motivo no título; os
 * testes de guarda abaixo rodam sempre, sem banco.
 *
 * Rodar de verdade (PowerShell):
 *   $env:FLUXO_TEST_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/visiofab_fluxo_test"
 *   npx vitest run src/modules/orcamento-grafico/hierarquia/fluxo-existente.test.ts
 * (o banco precisa estar migrado: `DATABASE_URL=<mesma url> npx prisma migrate deploy`
 * ou `npx tsx prisma/migrate-prod.ts`).
 */

const cfg = lerConfigBancoTeste()

describe('fluxo-existente — guarda de segurança (sem banco)', () => {
  it('sem FLUXO_TEST_DATABASE_URL não habilita', () => {
    const r = lerConfigBancoTeste({} as NodeJS.ProcessEnv)
    expect(r.habilitado).toBe(false)
  })

  it('recusa host remoto (ex.: Neon) e URL inválida', () => {
    const remoto = lerConfigBancoTeste({
      FLUXO_TEST_DATABASE_URL: 'postgresql://u:p@ep-x.sa-east-1.aws.neon.tech/db',
    } as unknown as NodeJS.ProcessEnv)
    expect(remoto.habilitado).toBe(false)
    expect(lerConfigBancoTeste({ FLUXO_TEST_DATABASE_URL: 'não é url' } as unknown as NodeJS.ProcessEnv).habilitado).toBe(false)
  })

  it('aceita somente localhost / 127.0.0.1 / ::1', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      const r = lerConfigBancoTeste({
        FLUXO_TEST_DATABASE_URL: `postgresql://u:p@${host}:5432/teste`,
      } as unknown as NodeJS.ProcessEnv)
      expect(r.habilitado).toBe(true)
    }
  })

  it('não usa DATABASE_URL como fallback', () => {
    const r = lerConfigBancoTeste({ DATABASE_URL: 'postgresql://u:p@localhost:5432/x' } as unknown as NodeJS.ProcessEnv)
    expect(r.habilitado).toBe(false)
  })

  it('empresaId explícito é obrigatório', () => {
    expect(() => exigirEmpresaId('')).toThrow()
    expect(() => exigirEmpresaId(undefined)).toThrow()
    expect(exigirEmpresaId('emp-1')).toBe('emp-1')
  })
})

const tituloIntegracao = cfg.habilitado
  ? 'fluxo-existente — integração (banco local de teste)'
  : `fluxo-existente — integração [SKIP: ${cfg.motivo}]`

describe.skipIf(!cfg.habilitado)(tituloIntegracao, () => {
  let amb: AmbienteFluxo
  let cenario: CenarioFluxo
  let ctx: Ctx

  // Estado compartilhado entre os passos (fluxo sequencial).
  let orcamentoBranco = ''
  let orcamentoRepeticao = ''
  let itemId = ''

  beforeAll(async () => {
    if (!cfg.habilitado) return
    amb = await montarAmbienteFluxo(cfg.url)
    cenario = await semearCenario(amb.prisma)
    ctx = { app: amb.app, empresaId: cenario.empresaId, token: amb.tokenPara(cenario.empresaId) }
  }, 120_000)

  afterAll(async () => {
    if (!amb) return
    try {
      if (cenario) await limparCenario(amb.prisma, cenario.empresaId)
    } finally {
      await amb.encerrar()
    }
  }, 120_000)

  it('dados de teste usam o prefixo QA-FLUXO e empresa própria', async () => {
    const empresa = await amb.prisma.empresa.findUnique({ where: { id: cenario.empresaId } })
    expect(empresa.razaoSocial.startsWith(PREFIXO_QA)).toBe(true)
  })

  it('1) criar orçamento em branco → 201, RASCUNHO, empresaId explícito', async () => {
    const r = await criarOrcamento(ctx, cenario)
    expect(r.status).toBe(201)
    expect(r.corpo.status).toBe('RASCUNHO')
    orcamentoBranco = r.corpo.id
    const orc = await amb.prisma.orcamentoGrafico.findFirst({ where: { id: orcamentoBranco, empresaId: cenario.empresaId } })
    expect(orc).not.toBeNull()
  })

  it('2) puxar cálculo (de-calculo) → 201, orçamento de repetição com 1 item e valor', async () => {
    const r = await puxarCalculo(ctx, cenario.calculoId)
    expect(r.status).toBe(201)
    orcamentoRepeticao = r.corpo.id
    const orc = await amb.prisma.orcamentoGrafico.findFirst({
      where: { id: orcamentoRepeticao, empresaId: cenario.empresaId },
      select: { tipo: true, status: true, valorTotalConsolidado: true },
    })
    expect(orc?.tipo).toBe('REPETICAO')
    expect(orc?.status).toBe('RASCUNHO')
    expect(Number(orc?.valorTotalConsolidado)).toBeGreaterThan(0)
    const id = await primeiroItemId(amb.prisma, cenario.empresaId, orcamentoRepeticao)
    expect(id).not.toBeNull()
    itemId = id as string
  })

  it('3) editar item + 4) calcular → 200 com resultado e fechamento', async () => {
    const corpo = editarItem(cenario, { quantidade: 1200 })
    const r = await calcular(ctx, orcamentoRepeticao, itemId, corpo)
    expect(r.status).toBe(200)
    expect(r.corpo.resultado).toBeTruthy()
    expect(r.corpo.fechamento).toBeTruthy()
  })

  it('5) salvar item → 200 e item persistido na empresa certa', async () => {
    const corpo = editarItem(cenario, { quantidade: 1200 })
    const r = await salvarItem(ctx, orcamentoRepeticao, itemId, corpo)
    expect(r.status).toBe(200)
    const item = await amb.prisma.itemOrcamentoGrafico.findFirst({
      where: { id: itemId, empresaId: cenario.empresaId },
      select: { quantidade: true },
    })
    expect(item?.quantidade).toBe(1200)
    const det = await obterOrcamento(ctx, orcamentoRepeticao)
    expect(det.status).toBe(200)
  })

  it('6) enviar proposta → ENVIADO', async () => {
    const r = await enviar(ctx, orcamentoRepeticao)
    expect(r.status).toBe(200)
    expect(r.corpo.status).toBe('ENVIADO')
  })

  it('7) aprovar → APROVADO e 8) Pedido de Venda gerado (origem ORCAMENTO_GRAFICO)', async () => {
    const r = await aprovar(ctx, orcamentoRepeticao)
    expect(r.status).toBe(200)
    expect(r.corpo.status).toBe('APROVADO')
    const pedido = await gerarPedidoVenda(amb.prisma, cenario.empresaId, orcamentoRepeticao)
    expect(pedido).not.toBeNull()
    expect(pedido?.empresaId).toBe(cenario.empresaId)
    expect(pedido?.origemPedido).toBe('ORCAMENTO_GRAFICO')
    expect(pedido?.clienteId).toBe(cenario.clienteId)
    expect(Number(pedido?.valorTotal)).toBeGreaterThan(0)
  })

  it('enviar orçamento em branco sem preço é recusado (400) — regra preservada', async () => {
    const r = await enviar(ctx, orcamentoBranco)
    expect(r.status).toBe(400)
  })

  it('isolamento: token de OUTRA empresa não enxerga o orçamento (404)', async () => {
    const outraEmpresa = '00000000-0000-4000-8000-00000000f1f1'
    const ctxOutra: Ctx = { app: amb.app, empresaId: outraEmpresa, token: amb.tokenPara(outraEmpresa) }
    const r = await enviar(ctxOutra, orcamentoBranco)
    expect(r.status).toBe(404)
    const r2 = await aprovar(ctxOutra, orcamentoRepeticao)
    expect(r2.status).toBe(404)
  })
})
