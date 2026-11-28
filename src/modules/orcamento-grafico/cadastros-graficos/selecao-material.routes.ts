import { FastifyInstance, FastifyReply } from 'fastify'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { authenticate } from '../../../middleware/authenticate'
import {
  calcularSelecaoMaterial,
  type NaturezaSelecaoMaterial,
  type UnidadeCustoMaterial,
} from './material-selecao.service'
import { somarCustoPlanos } from './custo-plano.service'
import { refletirSelecoesNoJson } from './selecao-material-json'

/**
 * Seleção de material por atividade (spec orcamento-grafico-cadastros-relacoes,
 * tarefas 5.1–5.3). empresaId EXPLÍCITO em toda query (não depende do prismaScoped).
 *
 * - PUT /selecao-material: grava/atualiza a seleção de (item, plano, atividade),
 *   valida a relação ATIVIDADE→MATERIAL (422 com a lista permitida), calcula pelo
 *   módulo puro, reflete no Json `materiaisAcabamento` do item e devolve o resumo
 *   de custo por plano (somarCustoPlanos).
 * - Item puxado (calculoGraficoOrigemId) grava aplicaNoPreco=false: a âncora do
 *   custo não é tocada (a soma existente só considera linhas com computarCusto=true).
 * - GET /selecao-material?itemId=: lista as seleções do item.
 */

type UserToken = { id: string; empresaId: string }

const ID = z.string().uuid('Identificador inválido')
const numOpc = z.number().finite().nullable().optional()

const putSchema = z.object({
  itemId: ID,
  planoId: ID.nullable().optional(),
  acabamentoId: ID,
  materialId: ID,
  restricaoId: ID.nullable().optional(),
  tipoParam: z.number().int().min(0).max(4).optional().default(0),
  param1: numOpc,
  param2: numOpc,
  /** Parâmetros opcionais do cálculo (sem cadastro próprio na fase 1). */
  gramaturaKgM2: z.number().finite().min(0).nullable().optional(),
  pecasPorCaixa: z.number().finite().min(0).nullable().optional(),
  /**
   * true = a atividade aceita VÁRIOS materiais ao mesmo tempo (ex.: Cola Branca e Cola Quente): grava/atualiza
   * a seleção deste material sem trocar as demais. Ausente = troca o material da atividade (comportamento antigo).
   */
  adicionar: z.boolean().optional(),
})

const getSchema = z.object({ itemId: ID })

const deleteSchema = z.object({
  itemId: ID,
  acabamentoId: ID,
  planoId: ID.nullable().optional(),
  /** Remove sÃ³ este material da atividade (vÃ¡rios materiais). Ausente = remove todos da atividade. */
  materialId: ID.optional(),
})

function erroZod(reply: FastifyReply, error: z.ZodError) {
  const msg = error.errors
    .map((e) => (e.path.length ? `${e.path.join('.')}: ${e.message}` : e.message))
    .join('; ')
  return reply.status(400).send({ message: `Dados inválidos — ${msg}` })
}

const n = (v: unknown): number | null => {
  if (v === null || v === undefined) return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

function naturezaDoMaterial(tipoMaterial: string | null): NaturezaSelecaoMaterial {
  if (tipoMaterial === 'COLA') return 'COLA'
  if (tipoMaterial === 'ACONDICIONAMENTO') return 'CAIXA'
  if (tipoMaterial === 'REVESTIMENTO_KG') return 'VERNIZ'
  return 'OUTRO'
}

function unidadeDoMaterial(u: string | null): UnidadeCustoMaterial {
  return u === 'KG' || u === 'M2' || u === 'UN' || u === 'M' ? u : 'UN'
}

/** Área impressa (m²) = peso do papel ÷ gramatura (= folhas × formato). 0 quando indisponível. */
function areaImpressaDoItem(resultado: unknown, gramatura: unknown): number {
  const r = resultado as { papel?: { pesoKg?: unknown } } | null
  const peso = Number(r?.papel?.pesoKg)
  const gram = Number(gramatura)
  return Number.isFinite(peso) && peso > 0 && Number.isFinite(gram) && gram > 0 ? (peso * 1000) / gram : 0
}

function paraResposta(s: {
  id: string
  itemId: string
  planoId: string | null
  acabamentoId: string
  materialId: string
  restricaoId: string | null
  tipoParam: number
  param1: Prisma.Decimal | null
  param2: Prisma.Decimal | null
  consumo: Prisma.Decimal | null
  unidadeConsumo: string | null
  valorUnitario: Prisma.Decimal | null
  custo: Prisma.Decimal | null
  aplicaNoPreco: boolean
  situacaoParametro: string
}) {
  return {
    id: s.id,
    itemId: s.itemId,
    planoId: s.planoId,
    acabamentoId: s.acabamentoId,
    materialId: s.materialId,
    restricaoId: s.restricaoId,
    tipoParam: s.tipoParam,
    param1: n(s.param1),
    param2: n(s.param2),
    consumo: n(s.consumo),
    unidadeConsumo: s.unidadeConsumo,
    valorUnitario: n(s.valorUnitario),
    custo: n(s.custo) ?? 0,
    aplicaNoPreco: s.aplicaNoPreco,
    situacaoParametro: s.situacaoParametro,
  }
}

export async function selecaoMaterialRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  app.put('/selecao-material', async (request, reply) => {
    const user = request.user as UserToken
    const parsed = putSchema.safeParse(request.body)
    if (!parsed.success) return erroZod(reply, parsed.error)
    const b = parsed.data
    const empresaId = user.empresaId
    const planoId = b.planoId ?? null
    const restricaoId = b.restricaoId ?? null

    const item = await prisma.itemOrcamentoGrafico.findFirst({
      where: { id: b.itemId, empresaId },
      select: {
        id: true,
        quantidade: true,
        gramatura: true,
        resultadoCalculo: true,
        materiaisAcabamento: true,
        custoProducao: true,
        calculoGraficoOrigemId: true,
      },
    })
    if (!item) return reply.status(404).send({ message: 'Item do orçamento não encontrado' })

    const atividade = await prisma.acabamentoGrafico.findFirst({
      where: { id: b.acabamentoId, empresaId },
      select: { id: true },
    })
    if (!atividade) return reply.status(404).send({ message: 'Atividade não encontrada' })

    const material = await prisma.materialAcabamento.findFirst({
      where: { id: b.materialId, empresaId, ativo: true },
    })
    if (!material) return reply.status(404).send({ message: 'Material não encontrado' })

    if (planoId) {
      const plano = await prisma.planoCalculoGrafico.findFirst({
        where: { id: planoId, itemId: item.id, empresaId },
        select: { id: true },
      })
      if (!plano) return reply.status(404).send({ message: 'Plano não encontrado neste item' })
    }

    if (restricaoId) {
      const restricao = await prisma.restricaoAcabamento.findFirst({
        where: { id: restricaoId, acabamentoGraficoId: b.acabamentoId, empresaId },
        select: { id: true },
      })
      if (!restricao) return reply.status(404).send({ message: 'Restrição não encontrada nesta atividade' })
    }

    // Relação ATIVIDADE → MATERIAL (Req 7.2): 422 com a lista de materiais permitidos.
    const relacao = await prisma.relacaoCadastroGrafico.findFirst({
      where: {
        empresaId,
        tipoOrigem: 'ATIVIDADE',
        idOrigem: b.acabamentoId,
        tipoDestino: 'MATERIAL',
        idDestino: b.materialId,
      },
      select: { id: true },
    })
    if (!relacao) {
      const rels = await prisma.relacaoCadastroGrafico.findMany({
        where: { empresaId, tipoOrigem: 'ATIVIDADE', idOrigem: b.acabamentoId, tipoDestino: 'MATERIAL' },
        select: { idDestino: true },
      })
      const permitidos = rels.length
        ? await prisma.materialAcabamento.findMany({
            where: { empresaId, id: { in: rels.map((r) => r.idDestino) }, ativo: true },
            select: { id: true, codigo: true, nome: true },
            orderBy: { nome: 'asc' },
          })
        : []
      return reply.status(422).send({
        message: 'Este material não é permitido para a atividade selecionada.',
        permitidos,
      })
    }

    const itemPuxado = !!item.calculoGraficoOrigemId
    const area = areaImpressaDoItem(item.resultadoCalculo, item.gramatura)
    const saida = calcularSelecaoMaterial({
      tipoParam: b.tipoParam,
      param1: b.param1 ?? null,
      param2: b.param2 ?? null,
      tiragem: item.quantidade,
      areaImpressaM2: area,
      precoUnitario: n(material.valorReferencia),
      unidadeCusto: unidadeDoMaterial(material.unidadeCusto),
      natureza: naturezaDoMaterial(material.tipoMaterial),
      gramaturaKgM2: b.gramaturaKgM2 ?? null,
      pecasPorCaixa: b.pecasPorCaixa ?? null,
      itemPuxado,
    })
    // Sem área do item o TipoParam 1 não é confiável: sinaliza sem erro.
    if (b.tipoParam === 1 && area <= 0) {
      saida.situacaoParametro = 'A_VERIFICAR'
      saida.aplicaNoPreco = false
      saida.custo = 0
    }

    const dados = {
      restricaoId,
      tipoParam: b.tipoParam,
      param1: b.param1 ?? null,
      param2: b.param2 ?? null,
      consumo: saida.consumo,
      unidadeConsumo: saida.unidadeConsumo,
      valorUnitario: saida.valorUnitario, // preço congelado no momento da seleção (Req 7.10)
      custo: saida.custo,
      aplicaNoPreco: saida.aplicaNoPreco,
      situacaoParametro: saida.situacaoParametro,
      materialId: b.materialId,
    }

    const { selecao, todas } = await prisma.$transaction(async (tx) => {
      const existente = await tx.selecaoMaterialAcabamento.findFirst({
        where: {
          empresaId,
          itemId: item.id,
          planoId,
          acabamentoId: b.acabamentoId,
          ...(b.adicionar ? { materialId: b.materialId } : {}),
        },
        select: { id: true },
      })
      const gravada = existente
        ? await tx.selecaoMaterialAcabamento.update({ where: { id: existente.id }, data: dados })
        : await tx.selecaoMaterialAcabamento.create({
            data: { empresaId, itemId: item.id, planoId, acabamentoId: b.acabamentoId, ...dados },
          })

      const lista = await tx.selecaoMaterialAcabamento.findMany({
        where: { empresaId, itemId: item.id },
        orderBy: { criadoEm: 'asc' },
      })
      const materiais = await tx.materialAcabamento.findMany({
        where: { empresaId, id: { in: [...new Set(lista.map((s) => s.materialId))] } },
        select: { id: true, nome: true },
      })
      const nomes = new Map(materiais.map((m) => [m.id, m.nome]))

      const json = refletirSelecoesNoJson(
        item.materiaisAcabamento,
        lista.map((s) => ({
          selecaoId: s.id,
          materialId: s.materialId,
          nome: nomes.get(s.materialId) ?? '',
          valorUnitario: n(s.valorUnitario),
          consumo: n(s.consumo),
          aplicaNoPreco: s.aplicaNoPreco,
        })),
      )
      await tx.itemOrcamentoGrafico.updateMany({
        where: { id: item.id, empresaId },
        data: { materiaisAcabamento: json as Prisma.InputJsonValue },
      })
      return { selecao: gravada, todas: lista }
    })

    // Custo por plano (itens novos); item puxado devolve zeros e o custo ancorado.
    const porPlano = new Map<string, number[]>()
    for (const s of todas) {
      const chave = s.planoId ?? 'ITEM'
      const arr = porPlano.get(chave) ?? []
      if (s.aplicaNoPreco) arr.push(n(s.custo) ?? 0)
      porPlano.set(chave, arr)
    }
    const resumoCustos = somarCustoPlanos({
      itemPuxado,
      custoAncoradoItem: n(item.custoProducao) ?? 0,
      planos: [...porPlano.entries()].map(([id, custosMateriais]) => ({
        planoId: id,
        custosAtividades: [],
        custosMateriais,
      })),
    })

    return reply.send({
      selecao: paraResposta(selecao),
      motivo: saida.motivo ?? null,
      resumoCustos,
    })
  })

  // DELETE /selecao-material: remove a seleção de (item, plano, atividade). Idempotente
  // (removidas=0 se não existir). Reflete as restantes no Json; não recalcula resultadoCalculo.
  app.delete('/selecao-material', async (request, reply) => {
    const user = request.user as UserToken
    const entrada = {
      ...((request.query as Record<string, unknown> | null) ?? {}),
      ...((request.body as Record<string, unknown> | null) ?? {}),
    }
    const parsed = deleteSchema.safeParse(entrada)
    if (!parsed.success) return erroZod(reply, parsed.error)
    const b = parsed.data
    const empresaId = user.empresaId
    const planoId = b.planoId ?? null

    const item = await prisma.itemOrcamentoGrafico.findFirst({
      where: { id: b.itemId, empresaId },
      select: {
        id: true,
        materiaisAcabamento: true,
        custoProducao: true,
        calculoGraficoOrigemId: true,
      },
    })
    if (!item) return reply.status(404).send({ message: 'Item do orçamento não encontrado' })

    const { removidas, todas } = await prisma.$transaction(async (tx) => {
      const apagadas = await tx.selecaoMaterialAcabamento.deleteMany({
        where: {
          empresaId,
          itemId: item.id,
          planoId,
          acabamentoId: b.acabamentoId,
          ...(b.materialId ? { materialId: b.materialId } : {}),
        },
      })
      const lista = await tx.selecaoMaterialAcabamento.findMany({
        where: { empresaId, itemId: item.id },
        orderBy: { criadoEm: 'asc' },
      })
      const materiais = await tx.materialAcabamento.findMany({
        where: { empresaId, id: { in: [...new Set(lista.map((s) => s.materialId))] } },
        select: { id: true, nome: true },
      })
      const nomes = new Map(materiais.map((m) => [m.id, m.nome]))
      const json = refletirSelecoesNoJson(
        item.materiaisAcabamento,
        lista.map((s) => ({
          selecaoId: s.id,
          materialId: s.materialId,
          nome: nomes.get(s.materialId) ?? '',
          valorUnitario: n(s.valorUnitario),
          consumo: n(s.consumo),
          aplicaNoPreco: s.aplicaNoPreco,
        })),
      )
      await tx.itemOrcamentoGrafico.updateMany({
        where: { id: item.id, empresaId },
        data: { materiaisAcabamento: json as Prisma.InputJsonValue },
      })
      return { removidas: apagadas.count, todas: lista }
    })

    const itemPuxado = !!item.calculoGraficoOrigemId
    const porPlano = new Map<string, number[]>()
    for (const s of todas) {
      const chave = s.planoId ?? 'ITEM'
      const arr = porPlano.get(chave) ?? []
      if (s.aplicaNoPreco) arr.push(n(s.custo) ?? 0)
      porPlano.set(chave, arr)
    }
    const resumoCustos = somarCustoPlanos({
      itemPuxado,
      custoAncoradoItem: n(item.custoProducao) ?? 0,
      planos: [...porPlano.entries()].map(([id, custosMateriais]) => ({
        planoId: id,
        custosAtividades: [],
        custosMateriais,
      })),
    })

    return reply.send({ removidas, resumoCustos })
  })

  app.get('/selecao-material', async (request, reply) => {
    const user = request.user as UserToken
    const parsed = getSchema.safeParse(request.query)
    if (!parsed.success) return erroZod(reply, parsed.error)

    const item = await prisma.itemOrcamentoGrafico.findFirst({
      where: { id: parsed.data.itemId, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!item) return reply.status(404).send({ message: 'Item do orçamento não encontrado' })

    const lista = await prisma.selecaoMaterialAcabamento.findMany({
      where: { empresaId: user.empresaId, itemId: item.id },
      orderBy: { criadoEm: 'asc' },
    })
    return reply.send({ dados: lista.map(paraResposta) })
  })
}
