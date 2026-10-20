/**
 * CRUD de Exceções de Calendário por centro/data (spec pcp-excecoes-calendario-gantt).
 *
 * Uma exceção sobrepõe o turno-base do centro NAQUELA data (padrão "calendar
 * exception" de MS Project/DHTMLX/Bryntum):
 *  - HORA_EXTRA: estende o expediente de um dia (janela horaInicio-horaFim).
 *  - DIA_EXTRA: torna trabalhável um dia normalmente não-útil (ex.: sábado).
 *  - NAO_TRABALHO: torna NÃO trabalhável um dia normalmente útil (feriado/parada).
 *
 * Prefixo /api/pcp. Autenticação + isolamento multi-tenant por empresaId
 * explícito (o centro referenciado também é validado contra a empresa).
 */
import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

const excecaoSchema = z
  .object({
    centroProducaoId: z.string().uuid(),
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve ser YYYY-MM-DD'),
    tipo: z.enum(['HORA_EXTRA', 'DIA_EXTRA', 'NAO_TRABALHO']),
    horaInicio: z.string().regex(HHMM).optional().nullable(),
    horaFim: z.string().regex(HHMM).optional().nullable(),
    observacao: z.string().max(300).optional().nullable(),
  })
  .refine(
    (v) => v.tipo === 'NAO_TRABALHO' || (!!v.horaInicio && !!v.horaFim),
    { message: 'HORA_EXTRA e DIA_EXTRA exigem horaInicio e horaFim', path: ['horaInicio'] },
  )
  .refine(
    (v) => v.tipo === 'NAO_TRABALHO' || !v.horaInicio || !v.horaFim || v.horaFim > v.horaInicio,
    { message: 'horaFim deve ser maior que horaInicio', path: ['horaFim'] },
  )

/** Converte "YYYY-MM-DD" para um Date meia-noite UTC (coluna @db.Date). */
function dataUtc(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`)
}

export async function excecaoTurnoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  // Lista exceções da empresa (filtro opcional por centro).
  app.get('/excecoes-turno', async (request) => {
    const user = request.user as { empresaId: string }
    const { centroProducaoId } = z
      .object({ centroProducaoId: z.string().uuid().optional() })
      .parse(request.query)
    return prisma.excecaoTurno.findMany({
      where: {
        empresaId: user.empresaId,
        ...(centroProducaoId ? { centroProducaoId } : {}),
      },
      orderBy: { data: 'asc' },
    })
  })

  app.post('/excecoes-turno', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const body = excecaoSchema.parse(request.body)

    // Centro precisa pertencer à empresa (isolamento multi-tenant).
    const centro = await prisma.centroProducao.findFirst({
      where: { id: body.centroProducaoId, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!centro) return reply.status(404).send({ message: 'Centro de produção não encontrado' })

    // Uma exceção por centro+data.
    const dup = await prisma.excecaoTurno.findFirst({
      where: { centroProducaoId: body.centroProducaoId, data: dataUtc(body.data) },
      select: { id: true },
    })
    if (dup) return reply.status(409).send({ message: 'Já existe uma exceção para este centro nesta data' })

    const naoTrabalho = body.tipo === 'NAO_TRABALHO'
    const criada = await prisma.excecaoTurno.create({
      data: {
        empresaId: user.empresaId,
        centroProducaoId: body.centroProducaoId,
        data: dataUtc(body.data),
        tipo: body.tipo,
        horaInicio: naoTrabalho ? null : body.horaInicio ?? null,
        horaFim: naoTrabalho ? null : body.horaFim ?? null,
        observacao: body.observacao ?? null,
      },
    })
    return reply.status(201).send(criada)
  })

  app.put('/excecoes-turno/:id', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = excecaoSchema.partial().parse(request.body)

    const existe = await prisma.excecaoTurno.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true, tipo: true, centroProducaoId: true },
    })
    if (!existe) return reply.status(404).send({ message: 'Exceção não encontrada' })

    // Se mudar centro/data, revalidar centro da empresa e unicidade centro+data.
    if (body.centroProducaoId) {
      const centro = await prisma.centroProducao.findFirst({
        where: { id: body.centroProducaoId, empresaId: user.empresaId },
        select: { id: true },
      })
      if (!centro) return reply.status(404).send({ message: 'Centro de produção não encontrado' })
    }
    if (body.centroProducaoId || body.data) {
      const centroAlvo = body.centroProducaoId ?? existe.centroProducaoId
      const dataAlvo = body.data ? dataUtc(body.data) : undefined
      if (dataAlvo) {
        const dup = await prisma.excecaoTurno.findFirst({
          where: { centroProducaoId: centroAlvo, data: dataAlvo, id: { not: id } },
          select: { id: true },
        })
        if (dup) return reply.status(409).send({ message: 'Já existe uma exceção para este centro nesta data' })
      }
    }

    const tipoFinal = body.tipo ?? existe.tipo
    const naoTrabalho = tipoFinal === 'NAO_TRABALHO'
    return prisma.excecaoTurno.update({
      where: { id },
      data: {
        ...(body.centroProducaoId ? { centroProducaoId: body.centroProducaoId } : {}),
        ...(body.data ? { data: dataUtc(body.data) } : {}),
        ...(body.tipo ? { tipo: body.tipo } : {}),
        ...(naoTrabalho
          ? { horaInicio: null, horaFim: null }
          : {
              ...(body.horaInicio !== undefined ? { horaInicio: body.horaInicio } : {}),
              ...(body.horaFim !== undefined ? { horaFim: body.horaFim } : {}),
            }),
        ...(body.observacao !== undefined ? { observacao: body.observacao } : {}),
      },
    })
  })

  app.delete('/excecoes-turno/:id', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const existe = await prisma.excecaoTurno.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!existe) return reply.status(404).send({ message: 'Exceção não encontrada' })
    await prisma.excecaoTurno.delete({ where: { id } })
    return { message: 'Exceção removida' }
  })
}
