// Rotas do Configurador Gráfico (paridade Calcgraf) — spec configurador-grafico-calcgraf.
//
// Expõe: itens de custo (visão unificada por Origem), crédito fiscal do papel,
// tabelas de custo por vigência (CRUD + bloqueio de sobreposição + versão
// vigente por data) e tributação por operação (CRUD). Prefixo aplicado no
// server.ts (`/api/configurador-grafico`).
//
// AUTENTICAÇÃO: `authenticate` no onRequest (padrão do módulo orçamento gráfico).
// MULTI-TENANT (steering ATENCAO §2.1): `empresaId` SEMPRE EXPLÍCITO em toda
// query — nunca confiar só no prismaScoped (bypass SUPER_ADMIN). Registro de
// outra empresa → 404 (sem revelar existência cross-tenant).

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { precoLiquidoCredito } from './credito-fiscal.service'
import { conflitoDeVigencia, versaoVigenteNaData, type Vigencia } from './vigencia-tabela.service'
import {
  montarItensCusto,
  origemValida,
  ORIGENS_VALIDAS,
  type ItemCustoFonte,
} from './itens-custo-view.service'

export async function configuradorGraficoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // ───────────────────────── Itens de Custo (visão unificada) ─────────────────────────
  // GET /itens-custo?origem=&busca= — deriva itens de custo dos cadastros
  // existentes (papel/tinta/máquina/acabamento) com Origem e grupo MD/CT/SE.
  app.get('/itens-custo', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const { origem, busca } = z
      .object({ origem: z.string().optional(), busca: z.string().optional() })
      .parse(request.query)

    if (origem && !origemValida(origem)) {
      return reply.status(400).send({
        message: `Origem inválida. Valores válidos: ${ORIGENS_VALIDAS.join(', ')}`,
      })
    }

    // Reúne os cadastros do Vizor (empresaId EXPLÍCITO em cada query).
    const [papeisTintas, centros, acabamentos] = await Promise.all([
      prisma.precoMateriaPrima.findMany({
        where: { empresaId: user.empresaId, status: true, tipo: { in: ['PAPEL', 'TINTA'] } },
        select: { id: true, descricao: true, tipo: true, precoUnitario: true },
      }),
      prisma.centroProducao.findMany({
        where: { empresaId: user.empresaId },
        select: { id: true, codigo: true, descricao: true, custoHora: true },
      }),
      prisma.acabamentoGrafico.findMany({
        where: { empresaId: user.empresaId },
        select: { id: true, nome: true, naturezaCusto: true, precoUnitario: true, custoHora: true },
      }),
    ])

    const fontes: ItemCustoFonte[] = [
      ...papeisTintas.map((p) => ({
        fonteTipo: (p.tipo === 'TINTA' ? 'TINTA' : 'PAPEL') as ItemCustoFonte['fonteTipo'],
        id: p.id,
        descricao: p.descricao,
        valor: p.precoUnitario != null ? Number(p.precoUnitario) : null,
      })),
      ...centros.map((c) => ({
        fonteTipo: 'CENTRO' as const,
        id: c.id,
        codigo: c.codigo,
        descricao: c.descricao,
        valor: c.custoHora != null ? Number(c.custoHora) : null,
      })),
      ...acabamentos.map((a) => ({
        fonteTipo: 'ACABAMENTO' as const,
        id: a.id,
        descricao: a.nome,
        natureza: a.naturezaCusto,
        valor: a.precoUnitario != null ? Number(a.precoUnitario) : (a.custoHora != null ? Number(a.custoHora) : null),
      })),
    ]

    let itens = montarItensCusto(fontes)
    if (origem) itens = itens.filter((i) => i.origem === origem.toUpperCase())
    if (busca) {
      const q = busca.toLowerCase()
      itens = itens.filter((i) => i.descricao.toLowerCase().includes(q) || (i.codigo ?? '').toLowerCase().includes(q))
    }
    return { itens }
  })

  // ───────────────────────── Crédito fiscal do papel ─────────────────────────
  // PUT /papel/:id/credito-fiscal — grava creditoPisCofinsPercent e retorna o
  // preço líquido calculado. Isolamento por empresa.
  app.put('/papel/:id/credito-fiscal', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const { creditoPisCofinsPercent } = z
      .object({ creditoPisCofinsPercent: z.coerce.number().min(0).max(100) })
      .parse(request.body)

    const papel = await prisma.precoMateriaPrima.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true, precoUnitario: true },
    })
    if (!papel) return reply.status(404).send({ message: 'Papel não encontrado' })

    await prisma.$executeRawUnsafe(
      `UPDATE preco_materia_prima SET credito_pis_cofins_percent = $1 WHERE id = $2 AND empresa_id = $3`,
      creditoPisCofinsPercent, id, user.empresaId,
    )
    const precoBruto = Number(papel.precoUnitario ?? 0)
    return {
      id,
      creditoPisCofinsPercent,
      precoBruto,
      precoLiquido: precoLiquidoCredito(precoBruto, creditoPisCofinsPercent),
    }
  })

  // ───────────────────────── Tabelas de Custo (vigência) ─────────────────────────
  const tabelaBodySchema = z.object({
    nome: z.string().min(1).max(100),
    vigenciaInicio: z.coerce.date(),
    vigenciaFim: z.coerce.date().nullable().optional(),
    ativo: z.boolean().optional(),
  })

  app.get('/tabelas-custo', async (request) => {
    const user = request.user as { empresaId: string }
    const tabelas = await prisma.tabelaCustoGrafico.findMany({
      where: { empresaId: user.empresaId },
      orderBy: { vigenciaInicio: 'desc' },
    })
    return { tabelas }
  })

  app.get('/tabelas-custo/vigente', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const { data } = z.object({ data: z.coerce.date() }).parse(request.query)
    const tabelas = await prisma.tabelaCustoGrafico.findMany({
      where: { empresaId: user.empresaId, ativo: true },
    })
    const vigente = versaoVigenteNaData(
      tabelas.map((t) => ({ ...t, inicio: t.vigenciaInicio, fim: t.vigenciaFim })),
      data,
    )
    if (!vigente) {
      return reply.status(404).send({ message: 'Nenhuma tabela de custo vigente para a data informada.' })
    }
    return vigente
  })

  app.post('/tabelas-custo', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const body = tabelaBodySchema.parse(request.body)
    const existentes = await prisma.tabelaCustoGrafico.findMany({
      where: { empresaId: user.empresaId },
      select: { id: true, vigenciaInicio: true, vigenciaFim: true, nome: true },
    })
    const candidata: Vigencia = { inicio: body.vigenciaInicio, fim: body.vigenciaFim ?? null }
    const conflito = conflitoDeVigencia(
      candidata,
      existentes.map((t) => ({ id: t.id, inicio: t.vigenciaInicio, fim: t.vigenciaFim, nome: t.nome })),
    )
    if (conflito) {
      return reply.status(409).send({
        message: `Vigência sobreposta à versão "${(conflito as { nome?: string }).nome}". Não é permitido coexistir versões cobrindo a mesma data.`,
      })
    }
    const tabela = await prisma.tabelaCustoGrafico.create({
      data: {
        empresaId: user.empresaId,
        nome: body.nome,
        vigenciaInicio: body.vigenciaInicio,
        vigenciaFim: body.vigenciaFim ?? null,
        ativo: body.ativo ?? true,
      },
    })
    return reply.status(201).send(tabela)
  })

  app.put('/tabelas-custo/:id', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = tabelaBodySchema.parse(request.body)
    const atual = await prisma.tabelaCustoGrafico.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!atual) return reply.status(404).send({ message: 'Tabela de custo não encontrada' })

    const existentes = await prisma.tabelaCustoGrafico.findMany({
      where: { empresaId: user.empresaId },
      select: { id: true, vigenciaInicio: true, vigenciaFim: true, nome: true },
    })
    const candidata: Vigencia = { inicio: body.vigenciaInicio, fim: body.vigenciaFim ?? null }
    const conflito = conflitoDeVigencia(
      candidata,
      existentes.map((t) => ({ id: t.id, inicio: t.vigenciaInicio, fim: t.vigenciaFim, nome: t.nome })),
      id, // ignora a própria versão
    )
    if (conflito) {
      return reply.status(409).send({
        message: `Vigência sobreposta à versão "${(conflito as { nome?: string }).nome}".`,
      })
    }
    const tabela = await prisma.tabelaCustoGrafico.update({
      where: { id },
      data: {
        nome: body.nome,
        vigenciaInicio: body.vigenciaInicio,
        vigenciaFim: body.vigenciaFim ?? null,
        ativo: body.ativo ?? atual.ativo,
      },
    })
    return tabela
  })

  // ───────────────────────── Tributação por operação ─────────────────────────
  const tribBodySchema = z.object({
    nome: z.string().min(1).max(60),
    ativo: z.boolean().optional(),
    aliquotaImposto: z.coerce.number().min(0).max(100).optional(),
    aliquotaIpi: z.coerce.number().min(0).max(100).optional(),
    pisCofinsPercent: z.coerce.number().min(0).max(100).optional(),
    comissaoPercent: z.coerce.number().min(0).max(100).optional(),
    flagCredIcms: z.boolean().optional(),
    flagCredIpi: z.boolean().optional(),
    flagCredPisCofins: z.boolean().optional(),
    flagPapelImune: z.boolean().optional(),
    prazoFinanciamento: z.coerce.number().int().min(0).optional(),
  })

  app.get('/tributacao', async (request) => {
    const user = request.user as { empresaId: string }
    const itens = await prisma.tributacaoGrafica.findMany({
      where: { empresaId: user.empresaId },
      orderBy: { nome: 'asc' },
    })
    return { itens }
  })

  app.post('/tributacao', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const body = tribBodySchema.parse(request.body)
    const criado = await prisma.tributacaoGrafica.create({
      data: { empresaId: user.empresaId, ...body },
    })
    return reply.status(201).send(criado)
  })

  app.put('/tributacao/:id', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = tribBodySchema.parse(request.body)
    const atual = await prisma.tributacaoGrafica.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!atual) return reply.status(404).send({ message: 'Tributação não encontrada' })
    const atualizado = await prisma.tributacaoGrafica.update({ where: { id }, data: body })
    return atualizado
  })
}
