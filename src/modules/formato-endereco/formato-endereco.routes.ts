import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { prisma } from '../../lib/prisma'
import * as service from './formato-endereco.service'
import { AddressCompositionService } from './address-composition.service'
import { AddressGenerationV2Service } from './address-generation-v2.service'
import { MapaAdaptadorService } from './mapa-adaptador.service'

const idParamsSchema = z.object({ id: z.string().uuid() })

const segmentoSchema = z.object({
  nome: z.string().min(1),
  campoFisico: z.enum([
    'codigoDeposito',
    'codigoZona',
    'codigoRua',
    'codigoPredio',
    'codigoNivel',
    'codigoApto',
  ]),
  ordem: z.number().int().positive(),
  numerico: z.boolean(),
  prefixo: z.string().optional(),
})

const criarFormatoSchema = z.object({
  nome: z.string().min(1),
  descricao: z.string().optional(),
  segmentos: z.array(segmentoSchema).min(1, 'Formato deve ter pelo menos um segmento'),
})

const atualizarFormatoSchema = z.object({
  nome: z.string().min(1).optional(),
  descricao: z.string().optional(),
  segmentos: z.array(segmentoSchema).min(1).optional(),
  status: z.boolean().optional(),
})

export async function formatoEnderecoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // POST / — criar formato de endereço
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = criarFormatoSchema.parse(request.body)

    try {
      const formato = await service.criar({
        nome: body.nome,
        descricao: body.descricao,
        segmentos: body.segmentos,
        empresaId: user.empresaId,
      })
      return reply.status(201).send(formato)
    } catch (err: any) {
      if (err.status === 400) {
        return reply.status(400).send({ message: err.message })
      }
      throw err
    }
  })

  // POST /gerar — gerar endereços com formato v2
  app.post('/gerar', async (request, reply) => {
    const gerarSchema = z.object({
      centroDistribuicaoId: z.string().uuid(),
      depositoId: z.string().uuid(),
      zonaId: z.string().uuid().optional(),
      formatoEnderecoId: z.string().uuid().optional(),
      faixas: z.array(z.object({
        campoFisico: z.string().min(1),
        inicio: z.number().int().positive(),
        fim: z.number().int().positive(),
      })).min(1, 'Deve informar pelo menos uma faixa'),
      estruturaId: z.string().uuid().optional(),
      classificacaoProdutoId: z.string().uuid().optional(),
      ambienteArmazenagemId: z.string().uuid().optional(),
      formaArmazenagemId: z.string().uuid().optional(),
      areaArmazenagem: z.enum(['PULMAO', 'PICKING']).optional(),
      tipo: z.string().optional(),
      lado: z.enum(['PAR', 'IMPAR', 'AMBOS']).optional(),
      nivelPicking: z.number().int().min(0).optional(),
    })

    const body = gerarSchema.parse(request.body)

    try {
      const generationService = new AddressGenerationV2Service()
      const result = await generationService.gerarEnderecos(body)
      return reply.status(201).send(result)
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

  // GET / — listar formatos da empresa
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const formatos = await service.listar(user.empresaId)
    return formatos
  })

  // GET /resolver — resolver formato aplicável (depositoId, zonaId?)
  app.get('/resolver', async (request, reply) => {
    const querySchema = z.object({
      depositoId: z.string().uuid(),
      zonaId: z.string().uuid().optional(),
    })
    const { depositoId, zonaId } = querySchema.parse(request.query)

    try {
      const formato = await service.resolverFormato(depositoId, zonaId)
      return formato
    } catch (err: any) {
      if (err.status === 404) {
        return reply.status(404).send({ message: err.message })
      }
      throw err
    }
  })

  // GET /mapa — configuração do mapa adaptado + endereços agrupados
  app.get('/mapa', async (request, reply) => {
    const mapaQuerySchema = z.object({
      depositoId: z.string().uuid(),
      zonaId: z.string().uuid().optional(),
    })
    const { depositoId, zonaId } = mapaQuerySchema.parse(request.query)

    try {
      const formato = await service.resolverFormato(depositoId, zonaId)

      const whereClause: any = { depositoId }
      if (zonaId) {
        whereClause.zonaId = zonaId
      }

      const enderecos = await prisma.endereco.findMany({
        where: whereClause,
      })

      const mapaService = new MapaAdaptadorService()
      const config = mapaService.getMapaConfig(formato)
      const agrupados = mapaService.agruparEnderecos(enderecos, config, formato)

      return { config, enderecos: agrupados, formato }
    } catch (err: any) {
      if (err.status === 404) {
        return reply.status(404).send({ message: err.message })
      }
      throw err
    }
  })

  // GET /barcode/:codigo — buscar endereço pelo código de barras
  app.get('/barcode/:codigo', async (request, reply) => {
    const { codigo } = z.object({ codigo: z.string().min(1) }).parse(request.params)

    const endereco = await prisma.endereco.findFirst({
      where: { codigoBarras: codigo },
      include: {
        deposito: { select: { id: true, descricao: true } },
        zona: { select: { id: true, descricao: true } },
        estrutura: { select: { descricao: true } },
      },
    })

    if (!endereco) {
      return reply.status(404).send({ message: 'Endereço não encontrado' })
    }

    // Resolve the format for this address
    const formato = await service.resolverFormato(
      endereco.depositoId!,
      endereco.zonaId ?? undefined,
    )

    // Decompose the enderecoCompleto into segments
    const compositionService = new AddressCompositionService()
    let segmentos: Record<string, string> = {}

    if (endereco.enderecoCompleto) {
      try {
        segmentos = compositionService.decompor(formato, endereco.enderecoCompleto)
      } catch {
        // If decomposition fails (format mismatch), return empty segments
        segmentos = {}
      }
    }

    return {
      ...endereco,
      formato,
      segmentos,
    }
  })

  // GET /:id — buscar formato por ID
  app.get('/:id', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)
    const formato = await service.buscarPorId(id)
    if (!formato) {
      return reply.status(404).send({ message: 'Formato de endereço não encontrado' })
    }
    return formato
  })

  // PUT /:id — atualizar formato
  app.put('/:id', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)
    const body = atualizarFormatoSchema.parse(request.body)

    try {
      const formato = await service.atualizar(id, body)
      return formato
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

  // DELETE /:id — excluir formato (retorna 409 se em uso)
  app.delete('/:id', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)

    try {
      await service.excluir(id)
      return reply.status(204).send()
    } catch (err: any) {
      if (err.status === 404) {
        return reply.status(404).send({ message: err.message })
      }
      if (err.status === 409) {
        return reply.status(409).send({ message: err.message })
      }
      throw err
    }
  })
}
