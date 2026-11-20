import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { HierarquiaError, MSG_NAO_ENCONTRADO, paramsItemSchema } from './hierarquia-common'
import { definirEntradaTiragem } from './tiragens-item.service'

/**
 * Rotas das tiragens do item (spec orcamento-grafico-tiragens-por-item, tarefa 3).
 *
 *  - GET `/:id/itens/:itemId/tiragens`: linhas de tiragem do item (ordem 0 = referência), sem o
 *    contexto interno de preço. Item sem linhas devolve `[]`.
 *  - PUT `/:id/itens/:itemId/tiragens/:quantidade`: o usuário define o VALOR TOTAL da tiragem (a margem é
 *    calculada de volta) ou a MARGEM (valor refeito). Não recalcula custo: usa os custos e o contexto
 *    gravados na linha. Atualiza o consolidado do orçamento.
 *
 * A lista de tiragens e o recálculo de custo ficam em PUT/POST do item (`tiragens` no corpo) e nas rotas
 * de plano. `empresaId` explícito em toda consulta; item de outra empresa responde 404.
 */
export interface DepsRotasTiragens {
  /** Reconsolida o cabeçalho do orçamento (função do arquivo de rotas principal). */
  reconsolidarOrcamento: (orcamentoId: string, empresaId: string) => Promise<void>
}

const paramsTiragemSchema = paramsItemSchema.extend({
  quantidade: z.coerce.number().int().positive(),
})

const corpoTiragemSchema = z
  .object({
    valorTotal: z.number().positive().optional(),
    margemPerc: z.number().min(-1000).max(1000).optional(),
    faixaMargem: z.number().int().min(0).max(2).optional(),
  })
  .refine((c) => c.valorTotal !== undefined || c.margemPerc !== undefined, {
    message: 'Informe o valor total ou a margem da tiragem.',
  })

/** Linha sem o contexto interno de preço (não é dado de tela). */
function paraResposta<T extends { contexto?: unknown }>(linha: T): Omit<T, 'contexto'> {
  const { contexto: _contexto, ...resto } = linha
  return resto
}

export function registrarRotasTiragens(app: FastifyInstance, deps: DepsRotasTiragens): void {
  app.get('/:id/itens/:itemId/tiragens', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id, itemId } = paramsItemSchema.parse(request.params)
    const item = await prisma.itemOrcamentoGrafico.findFirst({
      where: { id: itemId, orcamentoId: id, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!item) return reply.status(404).send({ message: MSG_NAO_ENCONTRADO })
    const linhas = await prisma.itemTiragemOrcamentoGrafico.findMany({
      where: { itemId, empresaId: user.empresaId },
      orderBy: { ordem: 'asc' },
    })
    return linhas.map(paraResposta)
  })

  app.put('/:id/itens/:itemId/tiragens/:quantidade', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id, itemId, quantidade } = paramsTiragemSchema.parse(request.params)
    const corpo = corpoTiragemSchema.parse(request.body)
    const item = await prisma.itemOrcamentoGrafico.findFirst({
      where: { id: itemId, orcamentoId: id, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!item) return reply.status(404).send({ message: MSG_NAO_ENCONTRADO })
    try {
      const linha = await definirEntradaTiragem(user.empresaId, itemId, quantidade, {
        valorTotal: corpo.valorTotal ?? null,
        margemPerc: corpo.margemPerc ?? null,
        faixaMargem: corpo.faixaMargem ?? null,
      })
      await deps.reconsolidarOrcamento(id, user.empresaId)
      return paraResposta(linha)
    } catch (err) {
      if (err instanceof HierarquiaError) return reply.status(err.statusCode).send({ message: err.message })
      throw err
    }
  })
}
