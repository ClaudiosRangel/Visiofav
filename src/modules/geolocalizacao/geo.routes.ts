import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { GeoService } from './geo.service'
import { calcularDistanciaHaversine } from './haversine'
import { latitudeSchema, longitudeSchema } from './coord-validation'
import { prisma } from '../../lib/prisma'
import { otimizarSequenciaNearestNeighbor, PontoEntrega } from './nearest-neighbor'

export async function geoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  const geoService = new GeoService()

  // POST /clientes/:id/geocodificar — Geocodificar endereço de um cliente
  app.post('/clientes/:id/geocodificar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    if (!user.empresaId) {
      return reply.status(400).send({ message: 'Empresa não selecionada' })
    }

    try {
      const result = await geoService.geocodificarCliente(id, user.empresaId)
      return result
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message })
    }
  })

  // POST /clientes/geocodificar-batch — Geocodificação em lote
  app.post('/clientes/geocodificar-batch', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }

    const schema = z.object({
      clienteIds: z.array(z.string().uuid()).min(1),
    })

    const { clienteIds } = schema.parse(request.body)

    if (!user.empresaId) {
      return reply.status(400).send({ message: 'Empresa não selecionada' })
    }

    try {
      const result = await geoService.geocodificarBatch(clienteIds, user.empresaId)
      return result
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message })
    }
  })

  // POST /empresa/geocodificar — Geocodificar endereço da empresa
  app.post('/empresa/geocodificar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }

    if (!user.empresaId) {
      return reply.status(400).send({ message: 'Empresa não selecionada' })
    }

    try {
      const result = await geoService.geocodificarEmpresa(user.empresaId)
      return result
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message })
    }
  })

  // POST /distancia — Calcular distância entre dois pontos
  app.post('/distancia', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }

    const coordenadaSchema = z.object({
      latitude: latitudeSchema,
      longitude: longitudeSchema,
    })

    const bodySchema = z.object({
      origem: coordenadaSchema.optional(),
      destino: coordenadaSchema,
    })

    const parseResult = bodySchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.status(422).send({ message: parseResult.error.errors[0].message })
    }

    const { origem, destino } = parseResult.data

    let origemCoord: { latitude: number; longitude: number }

    if (origem) {
      origemCoord = origem
    } else {
      // Usar coordenadas da Empresa autenticada
      if (!user.empresaId) {
        return reply.status(400).send({ message: 'Empresa não selecionada' })
      }

      const empresa = await prisma.empresa.findFirst({
        where: { id: user.empresaId },
        select: { latitude: true, longitude: true },
      })

      if (!empresa || empresa.latitude === null || empresa.longitude === null) {
        return reply.status(422).send({
          message: 'A empresa precisa ter geolocalização configurada para calcular distâncias',
        })
      }

      origemCoord = {
        latitude: Number(empresa.latitude),
        longitude: Number(empresa.longitude),
      }
    }

    const distanciaKm = calcularDistanciaHaversine(origemCoord, destino)

    return { distanciaKm }
  })

  // GET /distancia/cliente/:clienteId — Distância empresa→cliente
  app.get('/distancia/cliente/:clienteId', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }

    const paramsSchema = z.object({
      clienteId: z.string().uuid(),
    })

    const parseResult = paramsSchema.safeParse(request.params)
    if (!parseResult.success) {
      return reply.status(422).send({ message: parseResult.error.errors[0].message })
    }

    const { clienteId } = parseResult.data

    if (!user.empresaId) {
      return reply.status(400).send({ message: 'Empresa não selecionada' })
    }

    // Buscar coordenadas da Empresa
    const empresa = await prisma.empresa.findFirst({
      where: { id: user.empresaId },
      select: { latitude: true, longitude: true },
    })

    if (!empresa || empresa.latitude === null || empresa.longitude === null) {
      return reply.status(422).send({
        message: 'A empresa precisa ter geolocalização configurada para calcular distâncias',
      })
    }

    // Buscar coordenadas do Cliente
    const cliente = await prisma.cliente.findFirst({
      where: { id: clienteId, empresaId: user.empresaId },
      select: { latitude: true, longitude: true },
    })

    if (!cliente) {
      return reply.status(404).send({ message: 'Cliente não encontrado' })
    }

    if (cliente.latitude === null || cliente.longitude === null) {
      return reply.status(422).send({
        message: 'O cliente não possui geolocalização',
      })
    }

    const origemCoord = {
      latitude: Number(empresa.latitude),
      longitude: Number(empresa.longitude),
    }

    const destinoCoord = {
      latitude: Number(cliente.latitude),
      longitude: Number(cliente.longitude),
    }

    const distanciaKm = calcularDistanciaHaversine(origemCoord, destinoCoord)

    return { distanciaKm }
  })

  // POST /mapas/:id/otimizar — Calcular sequência otimizada de entrega
  app.post('/mapas/:id/otimizar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    if (!user.empresaId) {
      return reply.status(400).send({ message: 'Empresa não selecionada' })
    }

    // Buscar coordenadas da Empresa (origem)
    const empresa = await prisma.empresa.findFirst({
      where: { id: user.empresaId },
      select: { latitude: true, longitude: true },
    })

    if (!empresa || empresa.latitude === null || empresa.longitude === null) {
      return reply.status(422).send({
        message: 'A empresa precisa ter geolocalização configurada para otimizar rotas',
      })
    }

    // Buscar o Mapa de Carregamento
    const mapa = await prisma.mapaCarregamento.findFirst({
      where: { id, empresaId: user.empresaId },
      include: { nfs: true },
    })

    if (!mapa) {
      return reply.status(404).send({ message: 'Mapa de carregamento não encontrado' })
    }

    // Buscar NFs com dados do Cliente (via VendaEfetivada → PedidoVenda → Cliente)
    const nfeIds = mapa.nfs.map((n) => n.nfeId)
    const nfes = nfeIds.length > 0
      ? await prisma.documentoFiscal.findMany({
          where: { id: { in: nfeIds } },
          include: {
            vendaEfetivada: {
              include: {
                pedidoVenda: {
                  include: {
                    cliente: {
                      select: {
                        id: true,
                        razaoSocial: true,
                        logradouro: true,
                        numero: true,
                        bairro: true,
                        cidade: true,
                        uf: true,
                        latitude: true,
                        longitude: true,
                      },
                    },
                  },
                },
              },
            },
          },
        })
      : []

    // Extrair clientes únicos das NFs
    const clientesMap = new Map<string, {
      id: string
      razaoSocial: string
      logradouro: string | null
      numero: string | null
      bairro: string | null
      cidade: string | null
      uf: string | null
      latitude: number | null
      longitude: number | null
    }>()

    for (const nfe of nfes) {
      const cliente = nfe.vendaEfetivada?.pedidoVenda?.cliente
      if (cliente && !clientesMap.has(cliente.id)) {
        clientesMap.set(cliente.id, {
          id: cliente.id,
          razaoSocial: cliente.razaoSocial,
          logradouro: cliente.logradouro,
          numero: cliente.numero,
          bairro: cliente.bairro,
          cidade: cliente.cidade,
          uf: cliente.uf,
          latitude: cliente.latitude !== null ? Number(cliente.latitude) : null,
          longitude: cliente.longitude !== null ? Number(cliente.longitude) : null,
        })
      }
    }

    const clientes = Array.from(clientesMap.values())

    // Separar clientes geocodificados e sem geolocalização
    const geocodificados = clientes.filter(
      (c) => c.latitude !== null && c.longitude !== null
    )
    const semGeolocalizacao = clientes.filter(
      (c) => c.latitude === null || c.longitude === null
    )

    // Construir pontos de entrega para o algoritmo
    const pontos: PontoEntrega[] = geocodificados.map((c) => ({
      id: c.id,
      clienteId: c.id,
      coordenada: { latitude: c.latitude!, longitude: c.longitude! },
    }))

    // Executar otimização
    const origemCoord = {
      latitude: Number(empresa.latitude),
      longitude: Number(empresa.longitude),
    }
    const resultado = otimizarSequenciaNearestNeighbor(origemCoord, pontos)

    // Formatar endereço: "logradouro, numero - bairro - cidade/UF"
    const formatarEndereco = (c: { logradouro: string | null; numero: string | null; bairro: string | null; cidade: string | null; uf: string | null }) => {
      const parts: string[] = []
      if (c.logradouro) {
        parts.push(c.numero ? `${c.logradouro}, ${c.numero}` : c.logradouro)
      }
      if (c.bairro) parts.push(c.bairro)
      if (c.cidade && c.uf) {
        parts.push(`${c.cidade}/${c.uf}`)
      } else if (c.cidade) {
        parts.push(c.cidade)
      }
      return parts.join(' - ')
    }

    // Construir sequência de resposta
    const sequencia = resultado.sequencia.map((item) => {
      const cliente = clientesMap.get(item.clienteId)!
      return {
        ordem: item.ordem,
        clienteId: item.clienteId,
        razaoSocial: cliente.razaoSocial,
        endereco: formatarEndereco(cliente),
        latitude: item.coordenada.latitude,
        longitude: item.coordenada.longitude,
        distanciaParcialKm: item.distanciaParcialKm,
      }
    })

    // Clientes sem geolocalização ao final
    const clientesSemGeolocalizacao = semGeolocalizacao.map((c) => ({
      clienteId: c.id,
      razaoSocial: c.razaoSocial,
      endereco: formatarEndereco(c),
    }))

    return {
      sequencia,
      clientesSemGeolocalizacao,
      distanciaTotalKm: resultado.distanciaTotalKm,
    }
  })

  // GET /clientes/:id/sugestao-rota — Sugerir rotas por proximidade geográfica
  app.get('/clientes/:id/sugestao-rota', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    if (!user.empresaId) {
      return reply.status(400).send({ message: 'Empresa não selecionada' })
    }

    try {
      const result = await geoService.sugerirRotas(id, user.empresaId)
      return { sugestoes: result }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message })
    }
  })

  // GET /rotas/cobertura-consolidada — Cobertura consolidada de todas as rotas
  app.get('/rotas/cobertura-consolidada', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }

    if (!user.empresaId) {
      return reply.status(400).send({ message: 'Empresa não selecionada' })
    }

    try {
      const result = await geoService.areaCoberturaConsolidada(user.empresaId)
      return result
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message })
    }
  })

  // GET /rotas/:id/cobertura — Área de cobertura de uma rota
  app.get('/rotas/:id/cobertura', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    if (!user.empresaId) {
      return reply.status(400).send({ message: 'Empresa não selecionada' })
    }

    try {
      const result = await geoService.areaCoberturaRota(id, user.empresaId)
      return result
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message })
    }
  })

  // POST /mapas/:id/salvar-sequencia — Salvar sequência de entrega no mapa
  app.post('/mapas/:id/salvar-sequencia', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    if (!user.empresaId) {
      return reply.status(400).send({ message: 'Empresa não selecionada' })
    }

    const bodySchema = z.object({
      sequencia: z.array(
        z.object({
          nfeId: z.string().uuid(),
          ordemEntrega: z.number().int().min(1),
          distanciaParcialKm: z.number().min(0),
        })
      ),
    })

    const parseResult = bodySchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.status(422).send({ message: parseResult.error.errors[0].message })
    }

    const { sequencia } = parseResult.data

    // Verificar que o mapa existe e pertence à empresa do usuário
    const mapa = await prisma.mapaCarregamento.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!mapa) {
      return reply.status(404).send({ message: 'Mapa de carregamento não encontrado' })
    }

    // Calcular distância total como soma das distâncias parciais (arredondado para 2 decimais)
    const distanciaTotalKm = Math.round(
      sequencia.reduce((sum, item) => sum + item.distanciaParcialKm, 0) * 100
    ) / 100

    // Usar transação para atualizar tudo atomicamente
    await prisma.$transaction(async (tx) => {
      // Atualizar cada MapaCarregamentoNf com ordemEntrega e distanciaParcialKm
      for (const item of sequencia) {
        await tx.mapaCarregamentoNf.update({
          where: {
            mapaCarregamentoId_nfeId: {
              mapaCarregamentoId: id,
              nfeId: item.nfeId,
            },
          },
          data: {
            ordemEntrega: item.ordemEntrega,
            distanciaParcialKm: item.distanciaParcialKm,
          },
        })
      }

      // Atualizar MapaCarregamento com distanciaTotalKm e sequenciaValida = true
      await tx.mapaCarregamento.update({
        where: { id },
        data: {
          distanciaTotalKm,
          sequenciaValida: true,
        },
      })
    })

    return { success: true, distanciaTotalKm }
  })
}
