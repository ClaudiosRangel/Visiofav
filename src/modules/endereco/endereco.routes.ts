import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { AddressGenerationService } from './address-generation.service'
import { ValidadorCapacidade } from './validador-capacidade.service'

function getDb(request: any) { return request.prismaScoped || prisma }

export async function enderecoRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const db = getDb(request)
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
      db.endereco.findMany({
        where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { enderecoCompleto: 'asc' },
        include: {
          deposito: { select: { descricao: true } },
          zona: { select: { descricao: true } },
          estrutura: { select: { descricao: true } },
          saldos: { where: { quantidade: { gt: 0 } }, select: { quantidade: true } },
        },
      }),
      db.endereco.count({ where }),
    ])

    // Calcular campo 'estado' baseado nos saldos
    const dataComEstado = data.map((e: any) => {
      const saldoTotal = e.saldos?.reduce((acc: number, s: any) => acc + Number(s.quantidade), 0) ?? 0
      let estado: string
      if (!e.status) {
        estado = 'BLOQUEADO'
      } else if (saldoTotal > 0) {
        estado = 'OCUPADO'
      } else {
        estado = 'LIVRE'
      }
      const { saldos, ...rest } = e
      return { ...rest, estado }
    })

    return { data: dataComEstado, total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) }
  })

  app.post('/', async (request, reply) => {
    const db = getDb(request)
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
    return reply.status(201).send(await db.endereco.create({ data: { ...data, enderecoCompleto } }))
  })

  // Geração automática de endereços
  app.post('/gerar', async (request, reply) => {
    const body = z.object({
      centroDistribuicaoId: z.string().uuid(),
      depositoId: z.string().uuid(),
      codigoDeposito: z.string(),
      codigoZona: z.string(),
      zonaId: z.string().uuid().optional(),
      estruturaId: z.string().uuid().optional(),
      classificacaoProdutoId: z.string().uuid().optional(),
      ambienteArmazenagemId: z.string().uuid().optional(),
      formaArmazenagemId: z.string().uuid().optional(),
      areaArmazenagem: z.enum(['PULMAO', 'PICKING']).optional().default('PULMAO'),
      situacao: z.string().optional().default('ARMAZENAGEM'),
      lado: z.enum(['PAR', 'IMPAR', 'AMBOS']).optional().default('AMBOS'),
      tipo: z.string().optional().default('ARMAZENAGEM'),
      ruaInicio: z.number().int().positive(),
      ruaFim: z.number().int().positive(),
      predioInicio: z.number().int().positive(),
      predioFim: z.number().int().positive(),
      nivelInicio: z.number().int().positive(),
      nivelFim: z.number().int().positive(),
      aptoInicio: z.number().int().positive(),
      aptoFim: z.number().int().positive(),
    }).parse(request.body)

    try {
      const service = new AddressGenerationService()
      const result = await service.generate(body)
      return reply.status(201).send({
        criados: result.criados,
        ignorados: result.ignorados,
        total: result.total,
      })
    } catch (err: any) {
      if (err.status === 400) {
        return reply.status(400).send({ message: err.message })
      }
      if (err.status === 404) {
        return reply.status(404).send({ message: err.message })
      }
      throw err
    }
  })

  // Capacity utilization for an address
  app.get('/:id/capacidade', async (request, reply) => {
    const db = getDb(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const endereco = await db.endereco.findUnique({ where: { id } })
    if (!endereco) {
      return reply.status(404).send({ message: 'Endereço não encontrado' })
    }

    const validador = new ValidadorCapacidade()
    const utilization = await validador.getUtilization(id)
    return utilization
  })

  // Validate capacity before storing a product
  app.post('/validar-capacidade', async (request, reply) => {
    const body = z.object({
      enderecoId: z.string().uuid(),
      produtoId: z.string().uuid(),
      quantidade: z.number().positive(),
    }).parse(request.body)

    const validador = new ValidadorCapacidade()
    try {
      const result = await validador.validar(body)
      if (!result.permitido) {
        return reply.status(422).send(result)
      }
      return result
    } catch (err: any) {
      if (err.status === 404) {
        return reply.status(404).send({ message: err.message })
      }
      throw err
    }
  })

  app.put('/:id', async (request) => {
    const db = getDb(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const data = z.object({ tipo: z.string().optional(), estado: z.string().optional(), status: z.boolean().optional() }).parse(request.body)
    return db.endereco.update({ where: { id }, data })
  })

  app.delete('/:id', async (request, reply) => {
    const db = getDb(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    await db.endereco.delete({ where: { id } })
    return reply.status(204).send()
  })
}
