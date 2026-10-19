/**
 * CRUDs gerenciais (spec pcp-relatorio-gerencial-producao, Task 4):
 *  - Metas de produção por TIPO DE PROCESSO (MetaProducaoProcesso)
 *  - Códigos de parada customizáveis (CodigoParada)
 * Prefixo /api/pcp. Autenticação + isolamento por empresaId explícito.
 */
import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { authenticate } from '../../../middleware/authenticate'

export async function gerencialCadastrosRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // ─── Metas por processo (Req 3) ───────────────────────────────────────────
  app.get('/gerencial/metas-processo', async (request) => {
    const user = request.user as { empresaId: string }
    return prisma.metaProducaoProcesso.findMany({
      where: { empresaId: user.empresaId },
      orderBy: { vigenciaInicio: 'desc' },
    })
  })

  const metaProcessoSchema = z.object({
    tipoProcessoId: z.string().uuid(),
    metaQuantidadeDia: z.number().positive(),
    metaValorDia: z.number().positive().optional().nullable(),
    vigenciaInicio: z.string(),
    vigenciaFim: z.string().optional().nullable(),
  })

  app.post('/gerencial/metas-processo', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const body = metaProcessoSchema.parse(request.body)
    const tp = await prisma.tipoProcesso.findFirst({
      where: { id: body.tipoProcessoId, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!tp) return reply.status(404).send({ message: 'Tipo de processo não encontrado' })
    const meta = await prisma.metaProducaoProcesso.create({
      data: {
        empresaId: user.empresaId,
        tipoProcessoId: body.tipoProcessoId,
        metaQuantidadeDia: body.metaQuantidadeDia,
        metaValorDia: body.metaValorDia ?? null,
        vigenciaInicio: new Date(body.vigenciaInicio),
        vigenciaFim: body.vigenciaFim ? new Date(body.vigenciaFim) : null,
      },
    })
    return reply.status(201).send(meta)
  })

  app.put('/gerencial/metas-processo/:id', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = metaProcessoSchema.partial().parse(request.body)
    const existe = await prisma.metaProducaoProcesso.findFirst({ where: { id, empresaId: user.empresaId }, select: { id: true } })
    if (!existe) return reply.status(404).send({ message: 'Meta não encontrada' })
    return prisma.metaProducaoProcesso.update({
      where: { id },
      data: {
        ...(body.tipoProcessoId ? { tipoProcessoId: body.tipoProcessoId } : {}),
        ...(body.metaQuantidadeDia != null ? { metaQuantidadeDia: body.metaQuantidadeDia } : {}),
        ...(body.metaValorDia !== undefined ? { metaValorDia: body.metaValorDia } : {}),
        ...(body.vigenciaInicio ? { vigenciaInicio: new Date(body.vigenciaInicio) } : {}),
        ...(body.vigenciaFim !== undefined ? { vigenciaFim: body.vigenciaFim ? new Date(body.vigenciaFim) : null } : {}),
      },
    })
  })

  app.delete('/gerencial/metas-processo/:id', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const existe = await prisma.metaProducaoProcesso.findFirst({ where: { id, empresaId: user.empresaId }, select: { id: true } })
    if (!existe) return reply.status(404).send({ message: 'Meta não encontrada' })
    await prisma.metaProducaoProcesso.delete({ where: { id } })
    return { message: 'Meta removida' }
  })

  // ─── Códigos de parada (Req 4) ─────────────────────────────────────────────
  app.get('/gerencial/codigos-parada', async (request) => {
    const user = request.user as { empresaId: string }
    return prisma.codigoParada.findMany({
      where: { empresaId: user.empresaId },
      orderBy: { codigo: 'asc' },
    })
  })

  const codigoParadaSchema = z.object({
    codigo: z.string().min(1).max(20),
    descricao: z.string().min(1).max(200),
    status: z.boolean().optional(),
  })

  app.post('/gerencial/codigos-parada', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const body = codigoParadaSchema.parse(request.body)
    const dup = await prisma.codigoParada.findFirst({ where: { empresaId: user.empresaId, codigo: body.codigo }, select: { id: true } })
    if (dup) return reply.status(409).send({ message: 'Já existe um código de parada com esse código' })
    const cp = await prisma.codigoParada.create({
      data: { empresaId: user.empresaId, codigo: body.codigo, descricao: body.descricao, status: body.status ?? true },
    })
    return reply.status(201).send(cp)
  })

  app.put('/gerencial/codigos-parada/:id', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = codigoParadaSchema.partial().parse(request.body)
    const existe = await prisma.codigoParada.findFirst({ where: { id, empresaId: user.empresaId }, select: { id: true } })
    if (!existe) return reply.status(404).send({ message: 'Código não encontrado' })
    return prisma.codigoParada.update({
      where: { id },
      data: {
        ...(body.codigo ? { codigo: body.codigo } : {}),
        ...(body.descricao ? { descricao: body.descricao } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      },
    })
  })

  app.delete('/gerencial/codigos-parada/:id', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const existe = await prisma.codigoParada.findFirst({ where: { id, empresaId: user.empresaId }, select: { id: true } })
    if (!existe) return reply.status(404).send({ message: 'Código não encontrado' })
    await prisma.codigoParada.delete({ where: { id } })
    return { message: 'Código removido' }
  })
}
