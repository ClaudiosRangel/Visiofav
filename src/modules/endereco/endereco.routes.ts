import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { AddressGenerationService } from './address-generation.service'
import { ValidadorCapacidade } from './validador-capacidade.service'
import { resolverFormato } from '../formato-endereco/formato-endereco.service'
import { AddressCompositionService } from '../formato-endereco/address-composition.service'
import { AddressGenerationV2Service } from '../formato-endereco/address-generation-v2.service'
import { validarEndereco } from '../formato-endereco/address-validation.service'

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
      codigoDeposito: z.string().optional().default(''), codigoZona: z.string().optional().default(''),
      codigoRua: z.string().optional().default(''), codigoPredio: z.string().optional().default(''),
      codigoNivel: z.string().optional().default(''), codigoApto: z.string().optional().default(''),
      tipo: z.string().default('ARMAZENAGEM'),
      centroDistribuicaoId: z.string().uuid(), depositoId: z.string().uuid(),
      zonaId: z.string().uuid().optional(), estruturaId: z.string().uuid().optional(),
      formaArmazenagemId: z.string().uuid().optional(), ambienteArmazenagemId: z.string().uuid().optional(),
      classificacaoProdutoId: z.string().uuid().optional(),
    }).parse(request.body)

    // Resolver formato de endereço aplicável (Zona > Depósito > Padrão)
    const formato = await resolverFormato(data.depositoId, data.zonaId)

    // Validar endereço conforme formato configurado
    const validacao = validarEndereco(formato, {
      codigoDeposito: data.codigoDeposito || null,
      codigoZona: data.codigoZona || null,
      codigoRua: data.codigoRua || null,
      codigoPredio: data.codigoPredio || null,
      codigoNivel: data.codigoNivel || null,
      codigoApto: data.codigoApto || null,
    })

    if (!validacao.valido) {
      return reply.status(400).send({
        message: 'Validação de endereço falhou conforme formato configurado',
        erros: validacao.erros,
      })
    }

    // Compor enderecoCompleto via formato configurado (garante consistência com o formato)
    const compositionService = new AddressCompositionService()
    const valores: Record<string, string> = {
      codigoDeposito: data.codigoDeposito,
      codigoZona: data.codigoZona,
      codigoRua: data.codigoRua,
      codigoPredio: data.codigoPredio,
      codigoNivel: data.codigoNivel,
      codigoApto: data.codigoApto,
    }
    const enderecoCompleto = compositionService.compor(formato, valores)

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
      nivelPicking: z.number().int().min(0).optional(),
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
      // Resolver formato aplicável (Zona > Depósito > Padrão)
      const formato = await resolverFormato(body.depositoId, body.zonaId)

      // Se formato resolvido ≠ padrão, delegar para AddressGenerationService v2
      if (formato.id !== 'padrao') {
        const v2Service = new AddressGenerationV2Service()
        const result = await v2Service.gerarEnderecos({
          centroDistribuicaoId: body.centroDistribuicaoId,
          depositoId: body.depositoId,
          zonaId: body.zonaId,
          formatoEnderecoId: formato.id,
          faixas: [
            { campoFisico: 'codigoRua', inicio: body.ruaInicio, fim: body.ruaFim },
            { campoFisico: 'codigoPredio', inicio: body.predioInicio, fim: body.predioFim },
            { campoFisico: 'codigoNivel', inicio: body.nivelInicio, fim: body.nivelFim },
            { campoFisico: 'codigoApto', inicio: body.aptoInicio, fim: body.aptoFim },
          ].filter(f => {
            // Incluir apenas faixas cujos campos são segmentos ativos do formato
            return formato.segmentos.some(s => s.campoFisico === f.campoFisico)
          }),
          estruturaId: body.estruturaId,
          classificacaoProdutoId: body.classificacaoProdutoId,
          ambienteArmazenagemId: body.ambienteArmazenagemId,
          formaArmazenagemId: body.formaArmazenagemId,
          areaArmazenagem: body.areaArmazenagem,
          tipo: body.tipo,
          lado: body.lado,
          nivelPicking: body.nivelPicking,
        })
        return reply.status(201).send({
          criados: result.criados,
          ignorados: result.ignorados,
          total: result.total,
        })
      }

      // Formato = padrão → manter comportamento legado (compatibilidade)
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

  app.put('/:id', async (request, reply) => {
    const db = getDb(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const data = z.object({
      tipo: z.string().optional(), estado: z.string().optional(), status: z.boolean().optional(),
      codigoDeposito: z.string().optional(), codigoZona: z.string().optional(),
      codigoRua: z.string().optional(), codigoPredio: z.string().optional(),
      codigoNivel: z.string().optional(), codigoApto: z.string().optional(),
    }).parse(request.body)

    // Check if any segment field is being updated
    const segmentFields = ['codigoDeposito', 'codigoZona', 'codigoRua', 'codigoPredio', 'codigoNivel', 'codigoApto'] as const
    const hasSegmentUpdate = segmentFields.some(f => data[f] !== undefined)

    if (hasSegmentUpdate) {
      // Fetch existing address to merge segment values
      const existing = await db.endereco.findUnique({ where: { id } })
      if (!existing) {
        return reply.status(404).send({ message: 'Endereço não encontrado' })
      }

      // Merge existing values with updated ones
      const mergedValues: Record<string, string> = {
        codigoDeposito: data.codigoDeposito ?? existing.codigoDeposito ?? '',
        codigoZona: data.codigoZona ?? existing.codigoZona ?? '',
        codigoRua: data.codigoRua ?? existing.codigoRua ?? '',
        codigoPredio: data.codigoPredio ?? existing.codigoPredio ?? '',
        codigoNivel: data.codigoNivel ?? existing.codigoNivel ?? '',
        codigoApto: data.codigoApto ?? existing.codigoApto ?? '',
      }

      // Resolve format and recompose enderecoCompleto
      const formato = await resolverFormato(existing.depositoId, existing.zonaId ?? undefined)
      const compositionService = new AddressCompositionService()
      const enderecoCompleto = compositionService.compor(formato, mergedValues)

      return db.endereco.update({ where: { id }, data: { ...data, enderecoCompleto } })
    }

    return db.endereco.update({ where: { id }, data })
  })

  app.delete('/:id', async (request, reply) => {
    const db = getDb(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    await db.endereco.delete({ where: { id } })
    return reply.status(204).send()
  })
}
