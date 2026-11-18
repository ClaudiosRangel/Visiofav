import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { authenticate } from '../../../middleware/authenticate'
import { obterComissoes } from './comissoes.service'
import { obterDadosItem } from './dados-item.service'
import { obterFechamentoTotalizador } from './fechamento-totalizador.service'
import { HierarquiaError, paramsItemSchema, paramsOrcamentoSchema } from './hierarquia-common'
import { copiarItem, obterItemHidratado } from './item-copia.service'
import { listarItensResumo } from './item-resumo.service'

/**
 * Rotas da hierarquia Orçamento → Item → Plano (spec orcamento-grafico-hierarquia-item-plano).
 * Registradas em server.ts com o prefixo /api/orcamento-grafico.
 *
 * Regras:
 *  - `authenticate` + empresaId EXPLÍCITO em toda consulta (SUPER_ADMIN não isola);
 *  - 404 idêntico para inexistente e de outra empresa, sem eco de campos;
 *  - NENHUMA rota chama o motor (`calcularOrcamentoGrafico`) nem `ancorarCustoCalcgraf`.
 */

type UsuarioToken = { id: string; empresaId: string }

async function tratar<T>(reply: FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof HierarquiaError) return reply.status(err.statusCode).send({ message: err.message })
    throw err
  }
}

function empresaDe(request: FastifyRequest): string {
  return (request.user as UsuarioToken).empresaId
}

export async function hierarquiaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // Grid_Itens (leve, sem resultadoCalculo).
  app.get('/:id/itens-resumo', async (request, reply) => {
    const { id } = paramsOrcamentoSchema.parse(request.params)
    return tratar(reply, async () => ({ itens: await listarItensResumo(id, empresaDe(request)) }))
  })

  // Painel_Dados_Item (somente leitura).
  app.get('/:id/itens/:itemId/dados-item', async (request, reply) => {
    const { id, itemId } = paramsItemSchema.parse(request.params)
    return tratar(reply, () => obterDadosItem(id, itemId, empresaDe(request)))
  })

  // Aba Fechamento (totalizador; lê só o persistido).
  app.get('/:id/fechamento-totalizador', async (request, reply) => {
    const { id } = paramsOrcamentoSchema.parse(request.params)
    return tratar(reply, () => obterFechamentoTotalizador(id, empresaDe(request)))
  })

  // Aba Comissões.
  app.get('/:id/comissoes', async (request, reply) => {
    const { id } = paramsOrcamentoSchema.parse(request.params)
    return tratar(reply, () => obterComissoes(id, empresaDe(request)))
  })

  // Item hidratado (ITEM_SELECT_HIDRATACAO + aproveitamentoManual).
  app.get('/:id/itens/:itemId', async (request, reply) => {
    const { id, itemId } = paramsItemSchema.parse(request.params)
    return tratar(reply, () => obterItemHidratado(id, itemId, empresaDe(request)))
  })

  // Copiar item (sem recálculo).
  app.post('/:id/itens/:itemId/copiar', async (request, reply) => {
    const { id, itemId } = paramsItemSchema.parse(request.params)
    return tratar(reply, async () => {
      const copia = await copiarItem(id, itemId, empresaDe(request))
      return reply.status(201).send(copia)
    })
  })
}
