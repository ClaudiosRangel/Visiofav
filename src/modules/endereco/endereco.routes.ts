import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'

export async function enderecoRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const q = z.object({
      page: z.coerce.number().default(1), limit: z.coerce.number().default(50),
      search: z.string().optional(), centroDistribuicaoId: z.string().uuid().optional(),
      depositoId: z.string().uuid().optional(), estado: z.string().optional(),
    }).parse(request.query)

    const where = {
      ...(q.search ? { enderecoCompleto: { contains: q.search } } : {}),
      ...(q.centroDistribuicaoId ? { centroDistribuicaoId: q.centroDistribuicaoId } : {}),
      ...(q.depositoId ? { depositoId: q.depositoId } : {}),
      ...(q.estado ? { estado: q.estado } : {}),
    }

    const [data, total] = await Promise.all([
      prisma.endereco.findMany({
        where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { enderecoCompleto: 'asc' },
        include: {
          deposito: { select: { descricao: true } },
          zona: { select: { descricao: true } },
          estrutura: { select: { descricao: true } },
        },
      }),
      prisma.endereco.count({ where }),
    ])
    return { data, total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) }
  })

  app.post('/', async (request, reply) => {
    const data = z.object({
      codigoDeposito: z.string(), codigoZona: z.string(), codigoRua: z.string(),
      codigoPredio: z.string(), codigoNivel: z.string(), codigoApto: z.string(),
      tipo: z.string().default('ARMAZENAGEM'),
      centroDistribuicaoId: z.string().uuid(), depositoId: z.string().uuid(),
      zonaId: z.string().uuid().optional(), estruturaId: z.string().uuid().optional(),
      formaArmazenagemId: z.string().uuid().optional(), ambienteArmazenagemId: z.string().uuid().optional(),
      classificacaoProdutoId: z.string().uuid().optional(),
    }).parse(request.body)

    const enderecoCompleto = `${data.codigoDeposito}-${data.codigoZona}-${data.codigoRua}-${data.codigoPredio}-${data.codigoNivel}-${data.codigoApto}`
    return reply.status(201).send(await prisma.endereco.create({ data: { ...data, enderecoCompleto } }))
  })

  // Geração automática de endereços
  app.post('/gerar', async (request, reply) => {
    const body = z.object({
      centroDistribuicaoId: z.string().uuid(), depositoId: z.string().uuid(),
      codigoDeposito: z.string(), codigoZona: z.string(),
      zonaId: z.string().uuid().optional(), estruturaId: z.string().uuid().optional(),
      tipo: z.string().default('ARMAZENAGEM'),
      ruaInicio: z.number(), ruaFim: z.number(),
      predioInicio: z.number(), predioFim: z.number(),
      nivelInicio: z.number(), nivelFim: z.number(),
      aptoInicio: z.number(), aptoFim: z.number(),
    }).parse(request.body)

    const enderecos: Array<Record<string, unknown>> = []
    const pad = (n: number) => String(n).padStart(3, '0')

    for (let rua = body.ruaInicio; rua <= body.ruaFim; rua++) {
      for (let predio = body.predioInicio; predio <= body.predioFim; predio++) {
        for (let nivel = body.nivelInicio; nivel <= body.nivelFim; nivel++) {
          for (let apto = body.aptoInicio; apto <= body.aptoFim; apto++) {
            const codigoRua = pad(rua), codigoPredio = pad(predio), codigoNivel = pad(nivel), codigoApto = pad(apto)
            const enderecoCompleto = `${body.codigoDeposito}-${body.codigoZona}-${codigoRua}-${codigoPredio}-${codigoNivel}-${codigoApto}`
            enderecos.push({
              codigoDeposito: body.codigoDeposito, codigoZona: body.codigoZona,
              codigoRua, codigoPredio, codigoNivel, codigoApto, enderecoCompleto,
              tipo: body.tipo, centroDistribuicaoId: body.centroDistribuicaoId,
              depositoId: body.depositoId, zonaId: body.zonaId, estruturaId: body.estruturaId,
            })
          }
        }
      }
    }

    const result = await prisma.endereco.createMany({ data: enderecos as any, skipDuplicates: true })
    return reply.status(201).send({ criados: result.count, total: enderecos.length })
  })

  app.put('/:id', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const data = z.object({ tipo: z.string().optional(), estado: z.string().optional(), status: z.boolean().optional() }).parse(request.body)
    return prisma.endereco.update({ where: { id }, data })
  })

  app.delete('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    await prisma.endereco.delete({ where: { id } })
    return reply.status(204).send()
  })
}
