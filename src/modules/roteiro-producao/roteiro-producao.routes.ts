import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

const roteiroBodySchema = z.object({
  produtoId: z.string().uuid(),
  versao: z.number().int().positive().optional().default(1),
  descricao: z.string().max(200).optional().nullable(),
  status: z.enum(['ATIVO', 'INATIVO', 'RASCUNHO']).optional().default('RASCUNHO'),
})

const etapaBodySchema = z.object({
  sequencia: z.number().int().positive(),
  descricao: z.string().min(1).max(200),
  centroProducaoId: z.string().uuid(),
  tempoSetupMinutos: z.number().min(0).optional().default(0),
  tempoOperacaoMinutos: z.number().min(0).optional().default(0),
  tempoEsperaMinutos: z.number().min(0).optional().default(0),
  recursoId: z.string().uuid().optional().nullable(),
  observacao: z.string().optional().nullable(),
})

const listQuerySchema = z.object({
  produtoId: z.string().uuid().optional(),
  status: z.enum(['ATIVO', 'INATIVO', 'RASCUNHO']).optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
})

export async function roteiroProducaoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  /**
   * GET /api/roteiros-producao
   */
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { produtoId, status, page, limit } = listQuerySchema.parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (produtoId) where.produtoId = produtoId
    if (status) where.status = status

    const [data, total] = await Promise.all([
      prisma.roteiroProducao.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ produtoId: 'asc' }, { versao: 'desc' }],
        include: {
          etapas: {
            orderBy: { sequencia: 'asc' },
            include: {
              centroProducao: { select: { id: true, codigo: true, descricao: true } },
              recurso: { select: { id: true, codigo: true, descricao: true } },
            },
          },
        },
      }),
      prisma.roteiroProducao.count({ where }),
    ])

    return { data, total, page, limit }
  })

  /**
   * GET /api/roteiros-producao/:id
   */
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const roteiro = await prisma.roteiroProducao.findFirst({
      where: { id, empresaId: user.empresaId },
      include: {
        etapas: {
          orderBy: { sequencia: 'asc' },
          include: {
            centroProducao: { select: { id: true, codigo: true, descricao: true, custoHora: true } },
            recurso: { select: { id: true, codigo: true, descricao: true, custoHora: true } },
          },
        },
      },
    })

    if (!roteiro) {
      return reply.status(404).send({ message: 'Roteiro não encontrado' })
    }

    return roteiro
  })

  /**
   * POST /api/roteiros-producao
   */
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = roteiroBodySchema.parse(request.body)

    // Valida produto
    const produto = await prisma.produto.findFirst({
      where: { id: body.produtoId, empresaId: user.empresaId },
    })

    if (!produto) {
      return reply.status(400).send({ message: 'Produto não encontrado nesta empresa' })
    }

    // Valida unicidade de ATIVO
    if (body.status === 'ATIVO') {
      const ativoExistente = await prisma.roteiroProducao.findFirst({
        where: { empresaId: user.empresaId, produtoId: body.produtoId, status: 'ATIVO' },
      })
      if (ativoExistente) {
        return reply.status(409).send({ message: 'Já existe um roteiro ATIVO para este produto' })
      }
    }

    // Verifica duplicidade de versão
    const versaoExistente = await prisma.roteiroProducao.findUnique({
      where: {
        empresaId_produtoId_versao: {
          empresaId: user.empresaId,
          produtoId: body.produtoId,
          versao: body.versao,
        },
      },
    })

    if (versaoExistente) {
      return reply.status(409).send({ message: `Versão ${body.versao} já existe para este produto` })
    }

    const roteiro = await prisma.roteiroProducao.create({
      data: {
        empresaId: user.empresaId,
        produtoId: body.produtoId,
        versao: body.versao,
        descricao: body.descricao ?? undefined,
        status: body.status,
      },
    })

    return reply.status(201).send(roteiro)
  })

  /**
   * PUT /api/roteiros-producao/:id
   */
  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = z.object({
      descricao: z.string().max(200).optional().nullable(),
      status: z.enum(['ATIVO', 'INATIVO', 'RASCUNHO']).optional(),
    }).parse(request.body)

    const roteiro = await prisma.roteiroProducao.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!roteiro) {
      return reply.status(404).send({ message: 'Roteiro não encontrado' })
    }

    if (body.status === 'ATIVO' && roteiro.status !== 'ATIVO') {
      const ativoExistente = await prisma.roteiroProducao.findFirst({
        where: { empresaId: user.empresaId, produtoId: roteiro.produtoId, status: 'ATIVO', id: { not: id } },
      })
      if (ativoExistente) {
        return reply.status(409).send({ message: 'Já existe um roteiro ATIVO para este produto' })
      }
    }

    const atualizado = await prisma.roteiroProducao.update({
      where: { id },
      data: {
        descricao: body.descricao !== undefined ? body.descricao : undefined,
        status: body.status,
      },
    })

    return atualizado
  })

  /**
   * POST /api/roteiros-producao/:id/etapas
   * Adiciona uma etapa ao roteiro.
   */
  app.post('/:id/etapas', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = etapaBodySchema.parse(request.body)

    const roteiro = await prisma.roteiroProducao.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!roteiro) {
      return reply.status(404).send({ message: 'Roteiro não encontrado' })
    }

    // Valida centro de produção
    const centro = await prisma.centroProducao.findFirst({
      where: { id: body.centroProducaoId, empresaId: user.empresaId },
    })

    if (!centro) {
      return reply.status(400).send({ message: 'Centro de produção não encontrado nesta empresa' })
    }

    // Valida recurso (se informado)
    if (body.recursoId) {
      const recurso = await prisma.recursoProducao.findFirst({
        where: { id: body.recursoId, empresaId: user.empresaId },
      })
      if (!recurso) {
        return reply.status(400).send({ message: 'Recurso não encontrado nesta empresa' })
      }
    }

    const tempoTotalMinutos = body.tempoSetupMinutos + body.tempoOperacaoMinutos + body.tempoEsperaMinutos

    const etapa = await prisma.etapaRoteiro.create({
      data: {
        roteiroProducaoId: id,
        sequencia: body.sequencia,
        descricao: body.descricao,
        centroProducaoId: body.centroProducaoId,
        tempoSetupMinutos: body.tempoSetupMinutos,
        tempoOperacaoMinutos: body.tempoOperacaoMinutos,
        tempoEsperaMinutos: body.tempoEsperaMinutos,
        tempoTotalMinutos,
        recursoId: body.recursoId ?? undefined,
        observacao: body.observacao ?? undefined,
      },
      include: {
        centroProducao: { select: { id: true, codigo: true, descricao: true } },
        recurso: { select: { id: true, codigo: true, descricao: true } },
      },
    })

    return reply.status(201).send(etapa)
  })

  /**
   * PUT /api/roteiros-producao/:id/etapas/:etapaId
   * Atualiza uma etapa do roteiro.
   */
  app.put('/:id/etapas/:etapaId', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const { etapaId } = z.object({ etapaId: z.string().uuid() }).parse(request.params)
    const body = etapaBodySchema.parse(request.body)

    const roteiro = await prisma.roteiroProducao.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!roteiro) {
      return reply.status(404).send({ message: 'Roteiro não encontrado' })
    }

    const etapaExistente = await prisma.etapaRoteiro.findFirst({
      where: { id: etapaId, roteiroProducaoId: id },
    })

    if (!etapaExistente) {
      return reply.status(404).send({ message: 'Etapa não encontrada neste roteiro' })
    }

    // Valida centro
    const centro = await prisma.centroProducao.findFirst({
      where: { id: body.centroProducaoId, empresaId: user.empresaId },
    })
    if (!centro) {
      return reply.status(400).send({ message: 'Centro de produção não encontrado nesta empresa' })
    }

    if (body.recursoId) {
      const recurso = await prisma.recursoProducao.findFirst({
        where: { id: body.recursoId, empresaId: user.empresaId },
      })
      if (!recurso) {
        return reply.status(400).send({ message: 'Recurso não encontrado nesta empresa' })
      }
    }

    const tempoTotalMinutos = body.tempoSetupMinutos + body.tempoOperacaoMinutos + body.tempoEsperaMinutos

    const atualizada = await prisma.etapaRoteiro.update({
      where: { id: etapaId },
      data: {
        sequencia: body.sequencia,
        descricao: body.descricao,
        centroProducaoId: body.centroProducaoId,
        tempoSetupMinutos: body.tempoSetupMinutos,
        tempoOperacaoMinutos: body.tempoOperacaoMinutos,
        tempoEsperaMinutos: body.tempoEsperaMinutos,
        tempoTotalMinutos,
        recursoId: body.recursoId ?? null,
        observacao: body.observacao ?? null,
      },
      include: {
        centroProducao: { select: { id: true, codigo: true, descricao: true } },
        recurso: { select: { id: true, codigo: true, descricao: true } },
      },
    })

    return atualizada
  })

  /**
   * DELETE /api/roteiros-producao/:id/etapas/:etapaId
   * Remove uma etapa do roteiro.
   */
  app.delete('/:id/etapas/:etapaId', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const { etapaId } = z.object({ etapaId: z.string().uuid() }).parse(request.params)

    const roteiro = await prisma.roteiroProducao.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!roteiro) {
      return reply.status(404).send({ message: 'Roteiro não encontrado' })
    }

    const etapa = await prisma.etapaRoteiro.findFirst({
      where: { id: etapaId, roteiroProducaoId: id },
    })

    if (!etapa) {
      return reply.status(404).send({ message: 'Etapa não encontrada neste roteiro' })
    }

    await prisma.etapaRoteiro.delete({ where: { id: etapaId } })

    return reply.status(204).send()
  })

  /**
   * GET /api/roteiros-producao/:id/calcular-tempo
   * Calcula o tempo total de produção para uma quantidade N.
   */
  app.get('/:id/calcular-tempo', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const { quantidade } = z.object({
      quantidade: z.coerce.number().positive(),
    }).parse(request.query)

    const roteiro = await prisma.roteiroProducao.findFirst({
      where: { id, empresaId: user.empresaId },
      include: { etapas: { orderBy: { sequencia: 'asc' } } },
    })

    if (!roteiro) {
      return reply.status(404).send({ message: 'Roteiro não encontrado' })
    }

    const etapasCalculadas = roteiro.etapas.map((etapa) => {
      const tempoTotal = Number(etapa.tempoSetupMinutos) +
        (Number(etapa.tempoOperacaoMinutos) * quantidade) +
        Number(etapa.tempoEsperaMinutos)

      return {
        sequencia: etapa.sequencia,
        descricao: etapa.descricao,
        tempoSetup: Number(etapa.tempoSetupMinutos),
        tempoOperacao: Number(etapa.tempoOperacaoMinutos) * quantidade,
        tempoEspera: Number(etapa.tempoEsperaMinutos),
        tempoTotalEtapa: Math.round(tempoTotal * 100) / 100,
      }
    })

    const tempoTotalMinutos = etapasCalculadas.reduce((acc, e) => acc + e.tempoTotalEtapa, 0)
    const tempoTotalHoras = Math.round((tempoTotalMinutos / 60) * 100) / 100

    return {
      roteiroId: id,
      quantidade,
      etapas: etapasCalculadas,
      tempoTotalMinutos: Math.round(tempoTotalMinutos * 100) / 100,
      tempoTotalHoras,
    }
  })

  /**
   * POST /api/roteiros-producao/:id/duplicar
   * Duplica um roteiro para criar nova versão.
   */
  app.post('/:id/duplicar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const roteiro = await prisma.roteiroProducao.findFirst({
      where: { id, empresaId: user.empresaId },
      include: { etapas: true },
    })

    if (!roteiro) {
      return reply.status(404).send({ message: 'Roteiro não encontrado' })
    }

    const ultimaVersao = await prisma.roteiroProducao.findFirst({
      where: { empresaId: user.empresaId, produtoId: roteiro.produtoId },
      orderBy: { versao: 'desc' },
      select: { versao: true },
    })

    const novaVersao = (ultimaVersao?.versao ?? 0) + 1

    const novoRoteiro = await prisma.roteiroProducao.create({
      data: {
        empresaId: user.empresaId,
        produtoId: roteiro.produtoId,
        versao: novaVersao,
        descricao: roteiro.descricao ? `${roteiro.descricao} (cópia)` : `Versão ${novaVersao}`,
        status: 'RASCUNHO',
        etapas: {
          create: roteiro.etapas.map((etapa) => ({
            sequencia: etapa.sequencia,
            descricao: etapa.descricao,
            centroProducaoId: etapa.centroProducaoId,
            tempoSetupMinutos: etapa.tempoSetupMinutos,
            tempoOperacaoMinutos: etapa.tempoOperacaoMinutos,
            tempoEsperaMinutos: etapa.tempoEsperaMinutos,
            tempoTotalMinutos: etapa.tempoTotalMinutos,
            recursoId: etapa.recursoId,
            observacao: etapa.observacao,
          })),
        },
      },
      include: { etapas: { orderBy: { sequencia: 'asc' } } },
    })

    return reply.status(201).send(novoRoteiro)
  })
}
