import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import type { ItemOrcamentoInput } from '../orcamento-grafico-item.service'
import { ItemOrcamentoError } from '../orcamento-grafico-item.service'
import { sincronizarCalculoProprio } from '../calculo-grafico/calculo-proprio.service'
import {
  EditorCalculoError,
  atualizarAtividade,
  atualizarFolha,
  calcularFolhas,
  copiarFolha,
  definirAtividades,
  excluirFolha,
  gerarFolhasDoItem,
  incluirFolha,
  limparCampoManual,
  montarVisaoEditor,
  reordenarFolhas,
} from './editor-calculo.service'

/**
 * Rotas do Editor do Cálculo (spec orcamento-editor-calculo, design §5). Registradas dentro do plugin
 * do orçamento (prefixo /api/orcamento-grafico), logo passam pela autenticação e pela guarda do fluxo
 * (setor ORÇAMENTO). Escrita só em orçamento RASCUNHO. `empresaId` explícito em toda consulta.
 */
export interface DepsRotasEditor {
  /** Input do item montado como no cálculo dos planos (`reconstruirInputBaseDoItem`). */
  inputBaseDoItem: (orcamentoId: string, itemId: string, empresaId: string) => Promise<ItemOrcamentoInput | null>
  /** Recalcula as folhas, reconsolida o item/orçamento e as tiragens. */
  depoisDeAlterar: (orcamentoId: string, itemId: string, empresaId: string) => Promise<void>
}

const paramsItem = z.object({ id: z.string().uuid(), itemId: z.string().uuid() })
const paramsFolha = paramsItem.extend({ folhaId: z.string().uuid() })
const paramsAtividade = paramsItem.extend({ atividadeId: z.string().uuid() })

const numOuNull = z.number().finite().nullable().optional()
const impressaoSchema = z.object({
  cores: z.string().max(20).nullable().optional(),
  processoImpressao: z.string().max(120).nullable().optional(),
  coberturaTinta: z.union([z.number(), z.string().max(60)]).nullable().optional(),
  maquinaId: z.string().uuid().nullable().optional(),
  numCores: z.number().int().min(0).max(24).optional(),
  tintas: z.array(z.record(z.unknown())).max(24).optional(),
  preImpressao: z.record(z.unknown()).nullable().optional(),
})
const folhaSchema = z
  .object({
    nome: z.string().trim().min(1).max(60),
    tiragem: z.number().int().positive().nullable(),
    ocorrencias: z.number().int().min(1).max(999),
    formatoLarguraMm: numOuNull,
    formatoAlturaMm: numOuNull,
    formatoFolhaLarguraMm: numOuNull,
    formatoFolhaAlturaMm: numOuNull,
    suporteId: z.string().uuid().nullable(),
    gramatura: numOuNull,
    impressao: z.array(impressaoSchema).max(3).nullable(),
    fibra: z.string().max(20).nullable(),
    suporteNc: z
      .object({
        nome: z.string().max(120).optional(),
        gramatura: numOuNull,
        espessura: numOuNull,
        formato: z.string().max(40).nullable().optional(),
        custoKg: numOuNull,
        freteKg: numOuNull,
        creditoIcms: numOuNull,
        creditoIpi: numOuNull,
      })
      .nullable(),
    aproveitamento: z.number().int().min(0).max(9999).nullable(),
    quebraFixa: numOuNull,
    quebraVariavel: numOuNull,
    apara: numOuNull,
    opcoes: z
      .object({
        naoCalcular: z.boolean().optional(),
        naoCobrarImpressao: z.boolean().optional(),
        naoExibirProposta: z.boolean().optional(),
        tiraRetira: z.boolean().optional(),
        pinca: z.boolean().optional(),
        refileFolha: numOuNull,
        refileFinal: numOuNull,
        contraPinca: numOuNull,
        corteDuplo: numOuNull,
      })
      .nullable(),
  })
  .partial()

const atividadesSchema = z.object({
  atividades: z
    .array(z.object({ acabamentoId: z.string().uuid(), folhaIds: z.array(z.string().uuid()).max(50) }))
    .max(200),
})

const atividadeSchema = z.object({
  detalhes: z
    .object({
      tiragem: numOuNull,
      producaoHora: numOuNull,
      entradas: numOuNull,
      repeticoes: z.string().max(20).nullable().optional(),
      tempoPrimeiroAcertoMin: numOuNull,
      quantAcertos: numOuNull,
      tempoPorAcertoMin: numOuNull,
      quebraFixa: numOuNull,
      quebraVariavel: numOuNull,
      formatoCorte: z.string().max(40).nullable().optional(),
      centroProducaoId: z.string().uuid().nullable().optional(),
      restricaoIds: z.array(z.string().uuid()).max(20).optional(),
    })
    .optional(),
  materiais: z
    .array(
      z.object({
        materialAcabamentoId: z.string().uuid(),
        medida: z.string().max(40).nullable().optional(),
        coberturaFrente: numOuNull,
        coberturaVerso: numOuNull,
      }),
    )
    .max(30)
    .optional(),
  infoComplementar: z.string().max(2000).nullable().optional(),
})

function responder(reply: FastifyReply, err: unknown) {
  if (err instanceof EditorCalculoError || err instanceof ItemOrcamentoError) {
    return reply.status(err.statusCode).send({ message: err.message })
  }
  throw err
}

async function exigirItemEditavel(orcamentoId: string, itemId: string, empresaId: string, escrita: boolean) {
  const item = await prisma.itemOrcamentoGrafico.findFirst({
    where: { id: itemId, orcamentoId, empresaId },
    select: { id: true, orcamento: { select: { status: true } } },
  })
  if (!item) throw new EditorCalculoError(404, 'Item de orçamento não encontrado')
  if (escrita && item.orcamento?.status !== 'RASCUNHO') {
    throw new EditorCalculoError(409, 'O orçamento não está em rascunho: o Editor do cálculo é só leitura.')
  }
}

export function registrarRotasEditor(app: FastifyInstance, deps: DepsRotasEditor): void {
  const usuario = (request: { user: unknown }) => request.user as { id: string; empresaId: string }

  app.get('/:id/itens/:itemId/editor', async (request, reply) => {
    const { id, itemId } = paramsItem.parse(request.params)
    const { empresaId } = usuario(request)
    try {
      await exigirItemEditavel(id, itemId, empresaId, false)
      // Item criado antes da regra "todo item tem número de cálculo": ganha o número ao abrir o Editor.
      try {
        await sincronizarCalculoProprio({ empresaId, usuarioId: usuario(request).id, itemId })
      } catch (err) {
        request.log.warn({ err, itemId }, 'Editor: número de cálculo do item não sincronizado')
      }
      return await montarVisaoEditor(empresaId, id, itemId)
    } catch (err) {
      return responder(reply, err)
    }
  })

  /** Gera (ou regera) os Planos do Cálculo a partir dos Tipos de Plano e recalcula. */
  app.post('/:id/itens/:itemId/editor/gerar', async (request, reply) => {
    const { id, itemId } = paramsItem.parse(request.params)
    const { empresaId } = usuario(request)
    try {
      await exigirItemEditavel(id, itemId, empresaId, true)
      await gerarFolhasDoItem(empresaId, itemId)
      await deps.depoisDeAlterar(id, itemId, empresaId)
      return await montarVisaoEditor(empresaId, id, itemId)
    } catch (err) {
      return responder(reply, err)
    }
  })

  /** Prévia: custo de cada plano sem gravar. */
  app.post('/:id/itens/:itemId/editor/calcular', async (request, reply) => {
    const { id, itemId } = paramsItem.parse(request.params)
    const { empresaId } = usuario(request)
    try {
      await exigirItemEditavel(id, itemId, empresaId, false)
      const base = await deps.inputBaseDoItem(id, itemId, empresaId)
      if (!base) throw new EditorCalculoError(404, 'Item de orçamento não encontrado')
      const r = await calcularFolhas(empresaId, itemId, base)
      return r.map((c) => ({
        folhaId: c.folhaId,
        sequencia: c.sequencia,
        custoProducao: c.resultado?.custoProducao ?? 0,
        materialDireto: c.resultado?.materialDireto ?? 0,
        custoTransformacao: c.resultado?.custoTransformacao ?? 0,
        servicoExterno: c.resultado?.servicoExterno ?? 0,
        precoVenda: c.resultado?.precoVenda ?? 0,
        aproveitamento: c.resultado?.encaixe?.aproveitamento ?? null,
        folhas: c.resultado?.encaixe?.folhasNecessarias ?? null,
      }))
    } catch (err) {
      return responder(reply, err)
    }
  })

  app.post('/:id/itens/:itemId/folhas', async (request, reply) => {
    const { id, itemId } = paramsItem.parse(request.params)
    const { empresaId } = usuario(request)
    const body = z.object({ nome: z.string().trim().max(60).optional() }).parse(request.body ?? {})
    try {
      await exigirItemEditavel(id, itemId, empresaId, true)
      const f = await incluirFolha(empresaId, itemId, body.nome ?? 'Plano')
      await deps.depoisDeAlterar(id, itemId, empresaId)
      return reply.status(201).send(f)
    } catch (err) {
      return responder(reply, err)
    }
  })

  app.put('/:id/itens/:itemId/folhas/:folhaId', async (request, reply) => {
    const { id, itemId, folhaId } = paramsFolha.parse(request.params)
    const { empresaId } = usuario(request)
    const body = folhaSchema.parse(request.body)
    try {
      await exigirItemEditavel(id, itemId, empresaId, true)
      if (body.suporteId) {
        const ok = await prisma.precoMateriaPrima.findFirst({ where: { id: body.suporteId, empresaId }, select: { id: true } })
        if (!ok) throw new EditorCalculoError(422, 'Suporte não encontrado no cadastro.')
      }
      await atualizarFolha(empresaId, itemId, folhaId, body)
      await deps.depoisDeAlterar(id, itemId, empresaId)
      return await montarVisaoEditor(empresaId, id, itemId)
    } catch (err) {
      return responder(reply, err)
    }
  })

  /** "Voltar ao calculado" de um campo digitado à mão. */
  app.post('/:id/itens/:itemId/folhas/:folhaId/limpar-manual', async (request, reply) => {
    const { id, itemId, folhaId } = paramsFolha.parse(request.params)
    const { empresaId } = usuario(request)
    const { campo } = z.object({ campo: z.string().max(60) }).parse(request.body)
    try {
      await exigirItemEditavel(id, itemId, empresaId, true)
      await limparCampoManual(empresaId, itemId, folhaId, campo)
      await gerarFolhasDoItem(empresaId, itemId)
      await deps.depoisDeAlterar(id, itemId, empresaId)
      return await montarVisaoEditor(empresaId, id, itemId)
    } catch (err) {
      return responder(reply, err)
    }
  })

  app.post('/:id/itens/:itemId/folhas/:folhaId/copiar', async (request, reply) => {
    const { id, itemId, folhaId } = paramsFolha.parse(request.params)
    const { empresaId } = usuario(request)
    try {
      await exigirItemEditavel(id, itemId, empresaId, true)
      const f = await copiarFolha(empresaId, itemId, folhaId)
      await deps.depoisDeAlterar(id, itemId, empresaId)
      return reply.status(201).send(f)
    } catch (err) {
      return responder(reply, err)
    }
  })

  app.delete('/:id/itens/:itemId/folhas/:folhaId', async (request, reply) => {
    const { id, itemId, folhaId } = paramsFolha.parse(request.params)
    const { empresaId } = usuario(request)
    try {
      await exigirItemEditavel(id, itemId, empresaId, true)
      await excluirFolha(empresaId, itemId, folhaId)
      await deps.depoisDeAlterar(id, itemId, empresaId)
      return reply.status(204).send()
    } catch (err) {
      return responder(reply, err)
    }
  })

  app.patch('/:id/itens/:itemId/folhas/ordem', async (request, reply) => {
    const { id, itemId } = paramsItem.parse(request.params)
    const { empresaId } = usuario(request)
    const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }).parse(request.body)
    try {
      await exigirItemEditavel(id, itemId, empresaId, true)
      await reordenarFolhas(empresaId, itemId, ids)
      await deps.depoisDeAlterar(id, itemId, empresaId)
      return await montarVisaoEditor(empresaId, id, itemId)
    } catch (err) {
      return responder(reply, err)
    }
  })

  app.put('/:id/itens/:itemId/editor/atividades', async (request, reply) => {
    const { id, itemId } = paramsItem.parse(request.params)
    const { empresaId } = usuario(request)
    const body = atividadesSchema.parse(request.body)
    try {
      await exigirItemEditavel(id, itemId, empresaId, true)
      await definirAtividades(empresaId, itemId, body.atividades)
      await deps.depoisDeAlterar(id, itemId, empresaId)
      return await montarVisaoEditor(empresaId, id, itemId)
    } catch (err) {
      return responder(reply, err)
    }
  })

  app.put('/:id/itens/:itemId/editor/atividades/:atividadeId', async (request, reply) => {
    const { id, itemId, atividadeId } = paramsAtividade.parse(request.params)
    const { empresaId } = usuario(request)
    const body = atividadeSchema.parse(request.body)
    try {
      await exigirItemEditavel(id, itemId, empresaId, true)
      await atualizarAtividade(empresaId, itemId, atividadeId, body)
      await deps.depoisDeAlterar(id, itemId, empresaId)
      return await montarVisaoEditor(empresaId, id, itemId)
    } catch (err) {
      return responder(reply, err)
    }
  })
}
