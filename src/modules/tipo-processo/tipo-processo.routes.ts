import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { ordenarTipoProcessoBodySchema } from './tipo-processo.schemas'
import { calcularNovaPosicao, validarEmpresaCentros } from '../centro-producao/ordenacao.utils'

const idParamsSchema = z.object({ id: z.string().uuid() })

const tipoProcessoBodySchema = z.object({
  codigo: z.string().min(1, 'Código é obrigatório').max(20),
  descricao: z.string().min(1, 'Descrição é obrigatória').max(200),
})

const listQuerySchema = z.object({
  busca: z.string().optional(),
  status: z.enum(['true', 'false']).optional(),
})

/**
 * Cadastro de Tipo de Processo (Cortadeira, Impressão, Acabamento, etc.) —
 * substitui o antigo enum fixo `tipoMaquina` do CentroProducao. Cada Centro
 * de Produção agora referencia obrigatoriamente um Tipo de Processo. As
 * abas do painel de Programação são geradas dinamicamente a partir dos
 * tipos ATIVOS, ordenados por `posicao` (reordenável via drag-and-drop).
 */
export async function tipoProcessoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  /**
   * GET /api/tipos-processo
   * Lista os tipos de processo da empresa, ordenados por posição.
   */
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { busca, status } = listQuerySchema.parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (busca) {
      where.OR = [
        { codigo: { contains: busca, mode: 'insensitive' } },
        { descricao: { contains: busca, mode: 'insensitive' } },
      ]
    }
    if (status !== undefined) {
      where.status = status === 'true'
    }

    const data = await prisma.tipoProcesso.findMany({
      where,
      orderBy: [{ posicao: 'asc' }, { codigo: 'asc' }],
    })

    return { data, total: data.length }
  })

  /**
   * PATCH /api/tipos-processo/ordenar
   * Reordena os tipos de processo em lote (drag-and-drop na tela de cadastro
   * e, por consequência, ordem das abas no painel de Programação).
   */
  app.patch('/ordenar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { itens } = ordenarTipoProcessoBodySchema.parse(request.body)

    const tiposEmpresa = await prisma.tipoProcesso.findMany({
      where: { empresaId: user.empresaId },
      select: { id: true },
    })
    const idsEmpresa = tiposEmpresa.map((t) => t.id)
    const idsRequisicao = itens.map((item) => item.id)

    if (!validarEmpresaCentros(idsRequisicao, idsEmpresa)) {
      return reply.status(403).send({ message: 'Um ou mais tipos de processo não pertencem à sua empresa' })
    }

    await prisma.$transaction(
      itens.map((item) =>
        prisma.tipoProcesso.update({ where: { id: item.id }, data: { posicao: item.posicao } })
      )
    )

    return { message: 'Ordem atualizada com sucesso', count: itens.length }
  })

  /**
   * GET /api/tipos-processo/:id
   */
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const tipo = await prisma.tipoProcesso.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!tipo) return reply.status(404).send({ message: 'Tipo de processo não encontrado' })

    return tipo
  })

  /**
   * POST /api/tipos-processo
   */
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = tipoProcessoBodySchema.parse(request.body)

    const existente = await prisma.tipoProcesso.findUnique({
      where: { empresaId_codigo: { empresaId: user.empresaId, codigo: body.codigo } },
    })
    if (existente) {
      return reply.status(409).send({ message: `Código '${body.codigo}' já existe para esta empresa` })
    }

    const tiposEmpresa = await prisma.tipoProcesso.findMany({
      where: { empresaId: user.empresaId },
      select: { posicao: true },
    })
    const posicao = calcularNovaPosicao(tiposEmpresa.map((t) => t.posicao))

    const tipo = await prisma.tipoProcesso.create({
      data: { empresaId: user.empresaId, codigo: body.codigo, descricao: body.descricao, posicao },
    })

    return reply.status(201).send(tipo)
  })

  /**
   * PUT /api/tipos-processo/:id
   */
  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = tipoProcessoBodySchema.parse(request.body)

    const tipo = await prisma.tipoProcesso.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!tipo) return reply.status(404).send({ message: 'Tipo de processo não encontrado' })

    if (body.codigo !== tipo.codigo) {
      const existente = await prisma.tipoProcesso.findUnique({
        where: { empresaId_codigo: { empresaId: user.empresaId, codigo: body.codigo } },
      })
      if (existente && existente.id !== id) {
        return reply.status(409).send({ message: `Código '${body.codigo}' já existe para esta empresa` })
      }
    }

    const atualizado = await prisma.tipoProcesso.update({
      where: { id },
      data: { codigo: body.codigo, descricao: body.descricao },
    })

    return atualizado
  })

  /**
   * PATCH /api/tipos-processo/:id/inativar
   * Inativa o tipo — permanece disponível para centros já vinculados, mas
   * deixa de aparecer como opção para novos centros e some das abas do
   * painel de Programação (só tipos ATIVOS geram aba).
   */
  app.patch('/:id/inativar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const tipo = await prisma.tipoProcesso.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!tipo) return reply.status(404).send({ message: 'Tipo de processo não encontrado' })

    const inativado = await prisma.tipoProcesso.update({ where: { id }, data: { status: false } })
    return inativado
  })

  /**
   * PATCH /api/tipos-processo/:id/ativar
   */
  app.patch('/:id/ativar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const tipo = await prisma.tipoProcesso.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!tipo) return reply.status(404).send({ message: 'Tipo de processo não encontrado' })

    const ativado = await prisma.tipoProcesso.update({ where: { id }, data: { status: true } })
    return ativado
  })
}
