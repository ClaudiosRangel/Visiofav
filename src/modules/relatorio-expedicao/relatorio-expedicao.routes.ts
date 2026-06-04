import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

// ===========================================================================
// Schemas
// ===========================================================================

const periodoQuerySchema = z.object({
  dataInicio: z.string().min(1, 'dataInicio é obrigatório'),
  dataFim: z.string().min(1, 'dataFim é obrigatório'),
})

const consultaMapasQuerySchema = z.object({
  numero: z.coerce.number().int().optional(),
  dataInicio: z.string().optional(),
  dataFim: z.string().optional(),
  status: z.string().optional(),
  motorista: z.string().optional(),
  placa: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

const romaneioParamsSchema = z.object({
  mapaId: z.string().uuid(),
})

// ===========================================================================
// Routes
// ===========================================================================

export async function relatorioExpedicaoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // ==========================================================================
  // GET /total-roteiro — Totals grouped by Rota for a date range
  // ==========================================================================
  app.get('/total-roteiro', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { dataInicio, dataFim } = periodoQuerySchema.parse(request.query)

    const dtInicio = new Date(dataInicio)
    const dtFim = new Date(dataFim + 'T23:59:59.999Z')

    // Get all MapaCarregamento in the period with their NFs
    const mapas = await prisma.mapaCarregamento.findMany({
      where: {
        empresaId: user.empresaId,
        emissaoEm: { gte: dtInicio, lte: dtFim },
        status: { not: 'CANCELADO' },
      },
      include: {
        nfs: {
          select: { nfeId: true },
        },
      },
    })

    // Collect all NF IDs
    const nfeIds = mapas.flatMap((m) => m.nfs.map((n) => n.nfeId))

    if (nfeIds.length === 0) {
      return { data: [], geral: { quantidadeNfs: 0, valorTotal: 0, pesoTotalKg: 0, totalVolumes: 0 } }
    }

    // Fetch NFs with items and route info
    const nfes = await prisma.nfe.findMany({
      where: { id: { in: nfeIds } },
      include: {
        itens: { select: { qCom: true, vProd: true } },
        vendaEfetivada: {
          include: {
            pedidoVenda: {
              select: { rotaId: true },
            },
          },
        },
      },
    })

    // Group by rotaId
    const porRotaMap = new Map<string | null, {
      quantidadeNfs: number
      valorTotal: number
      pesoTotalKg: number
      totalVolumes: number
    }>()

    for (const nf of nfes) {
      const rotaId = nf.vendaEfetivada?.pedidoVenda?.rotaId || null

      if (!porRotaMap.has(rotaId)) {
        porRotaMap.set(rotaId, { quantidadeNfs: 0, valorTotal: 0, pesoTotalKg: 0, totalVolumes: 0 })
      }

      const grupo = porRotaMap.get(rotaId)!
      grupo.quantidadeNfs += 1
      grupo.valorTotal += nf.itens.reduce((sum, item) => sum + Number(item.vProd), 0)
      grupo.pesoTotalKg += nf.itens.reduce((sum, item) => sum + Number(item.qCom), 0)
      grupo.totalVolumes += nf.itens.length
    }

    // Fetch rota details
    const rotaIds = Array.from(porRotaMap.keys()).filter((id): id is string => id !== null)
    const rotas = rotaIds.length > 0
      ? await prisma.rota.findMany({
          where: { id: { in: rotaIds } },
          select: { id: true, codigo: true, descricao: true },
        })
      : []

    const rotaLookup = new Map(rotas.map((r) => [r.id, r]))

    const data = Array.from(porRotaMap.entries()).map(([rotaId, totais]) => {
      const rota = rotaId ? rotaLookup.get(rotaId) : null
      return {
        rotaId,
        rotaCodigo: rota?.codigo || null,
        rotaDescricao: rota?.descricao || null,
        quantidadeNfs: totais.quantidadeNfs,
        valorTotal: Math.round(totais.valorTotal * 100) / 100,
        pesoTotalKg: Math.round(totais.pesoTotalKg * 1000) / 1000,
        totalVolumes: totais.totalVolumes,
      }
    })

    const geral = {
      quantidadeNfs: data.reduce((s, r) => s + r.quantidadeNfs, 0),
      valorTotal: Math.round(data.reduce((s, r) => s + r.valorTotal, 0) * 100) / 100,
      pesoTotalKg: Math.round(data.reduce((s, r) => s + r.pesoTotalKg, 0) * 1000) / 1000,
      totalVolumes: data.reduce((s, r) => s + r.totalVolumes, 0),
    }

    return { data, geral }
  })

  // ==========================================================================
  // GET /total-expedicao — Overall expedition totals for a date range
  // ==========================================================================
  app.get('/total-expedicao', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { dataInicio, dataFim } = periodoQuerySchema.parse(request.query)

    const dtInicio = new Date(dataInicio)
    const dtFim = new Date(dataFim + 'T23:59:59.999Z')

    // Count mapas generated in the period
    const mapasGerados = await prisma.mapaCarregamento.count({
      where: {
        empresaId: user.empresaId,
        emissaoEm: { gte: dtInicio, lte: dtFim },
      },
    })

    // Get all non-cancelled mapas in the period with their NFs
    const mapas = await prisma.mapaCarregamento.findMany({
      where: {
        empresaId: user.empresaId,
        emissaoEm: { gte: dtInicio, lte: dtFim },
        status: { not: 'CANCELADO' },
      },
      include: {
        nfs: { select: { nfeId: true } },
      },
    })

    const nfeIds = mapas.flatMap((m) => m.nfs.map((n) => n.nfeId))

    let nfsExpedidas = 0
    let valorTotal = 0
    let pesoTotal = 0

    if (nfeIds.length > 0) {
      const nfes = await prisma.nfe.findMany({
        where: { id: { in: nfeIds } },
        include: {
          itens: { select: { qCom: true, vProd: true } },
        },
      })

      nfsExpedidas = nfes.length
      for (const nf of nfes) {
        valorTotal += nf.itens.reduce((sum, item) => sum + Number(item.vProd), 0)
        pesoTotal += nf.itens.reduce((sum, item) => sum + Number(item.qCom), 0)
      }
    }

    return {
      mapasGerados,
      nfsExpedidas,
      valorTotal: Math.round(valorTotal * 100) / 100,
      pesoTotal: Math.round(pesoTotal * 1000) / 1000,
    }
  })

  // ==========================================================================
  // GET /consulta-mapas — List maps with filters for reporting
  // ==========================================================================
  app.get('/consulta-mapas', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { numero, dataInicio, dataFim, status, motorista, placa, page, limit } =
      consultaMapasQuerySchema.parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (numero) where.numero = numero
    if (status) where.status = status
    if (motorista) where.motorista = { contains: motorista, mode: 'insensitive' }
    if (placa) where.veiculoPlaca = { contains: placa, mode: 'insensitive' }
    if (dataInicio || dataFim) {
      where.emissaoEm = {}
      if (dataInicio) where.emissaoEm.gte = new Date(dataInicio)
      if (dataFim) where.emissaoEm.lte = new Date(dataFim + 'T23:59:59.999Z')
    }

    const [mapas, total] = await Promise.all([
      prisma.mapaCarregamento.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { emissaoEm: 'desc' },
        include: {
          nfs: {
            select: { nfeId: true },
          },
        },
      }),
      prisma.mapaCarregamento.count({ where }),
    ])

    // Fetch NF values for each map
    const allNfeIds = mapas.flatMap((m) => m.nfs.map((n) => n.nfeId))
    const nfes = allNfeIds.length > 0
      ? await prisma.nfe.findMany({
          where: { id: { in: allNfeIds } },
          include: { itens: { select: { vProd: true } } },
        })
      : []

    const nfeLookup = new Map(nfes.map((nf) => [nf.id, nf]))

    const data = mapas.map((mapa) => {
      const nfeIdsDoMapa = mapa.nfs.map((n) => n.nfeId)
      let valorTotal = 0
      for (const nfeId of nfeIdsDoMapa) {
        const nfe = nfeLookup.get(nfeId)
        if (nfe) {
          valorTotal += nfe.itens.reduce((sum, item) => sum + Number(item.vProd), 0)
        }
      }

      return {
        id: mapa.id,
        numero: mapa.numero,
        emissao: mapa.emissaoEm,
        placa: mapa.veiculoPlaca,
        motorista: mapa.motorista,
        status: mapa.status,
        totalNfs: mapa.nfs.length,
        valorTotal: Math.round(valorTotal * 100) / 100,
      }
    })

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) }
  })

  // ==========================================================================
  // GET /romaneio/:mapaId — Complete romaneio (packing list) for a map
  // ==========================================================================
  app.get('/romaneio/:mapaId', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { mapaId } = romaneioParamsSchema.parse(request.params)

    const mapa = await prisma.mapaCarregamento.findFirst({
      where: { id: mapaId, empresaId: user.empresaId },
      include: {
        nfs: true,
      },
    })

    if (!mapa) {
      return reply.status(404).send({ message: 'Mapa de carregamento não encontrado' })
    }

    // Fetch NF details with client and route info
    const nfeIds = mapa.nfs.map((n) => n.nfeId)
    const nfes = nfeIds.length > 0
      ? await prisma.nfe.findMany({
          where: { id: { in: nfeIds } },
          include: {
            itens: { select: { qCom: true, vProd: true, xProd: true, nItem: true } },
            vendaEfetivada: {
              include: {
                pedidoVenda: {
                  include: {
                    cliente: {
                      select: {
                        id: true,
                        razaoSocial: true,
                        cpfCnpj: true,
                        cidade: true,
                        bairro: true,
                        logradouro: true,
                      },
                    },
                  },
                },
              },
            },
          },
        })
      : []

    const nfeLookup = new Map(nfes.map((nfe) => [nfe.id, nfe]))

    // Fetch rota info if available
    let rotaInfo = null
    if (mapa.rotaId) {
      rotaInfo = await prisma.rota.findUnique({
        where: { id: mapa.rotaId },
        select: { id: true, codigo: true, descricao: true },
      })
    }

    // Sort NFs: if sequenciaValida, sort by ordemEntrega ascending; otherwise keep insertion order
    const nfsOrdenadas = mapa.sequenciaValida
      ? [...mapa.nfs].sort((a, b) => (a.ordemEntrega ?? Infinity) - (b.ordemEntrega ?? Infinity))
      : mapa.nfs

    const nfsDetalhadas = nfsOrdenadas.map((mapaNf) => {
      const nfe = nfeLookup.get(mapaNf.nfeId)
      const valorTotal = nfe?.itens.reduce((sum, item) => sum + Number(item.vProd), 0) || 0
      const pesoTotal = nfe?.itens.reduce((sum, item) => sum + Number(item.qCom), 0) || 0

      const nfItem: any = {
        nfeId: mapaNf.nfeId,
        statusEntrega: mapaNf.statusEntrega,
        motivoDevolucao: mapaNf.motivoDevolucao,
        numero: nfe?.numero || null,
        serie: nfe?.serie || null,
        cliente: nfe?.vendaEfetivada?.pedidoVenda?.cliente || null,
        rotaId: nfe?.vendaEfetivada?.pedidoVenda?.rotaId || null,
        valorTotal: Math.round(valorTotal * 100) / 100,
        pesoTotalKg: Math.round(pesoTotal * 1000) / 1000,
        totalItens: nfe?.itens.length || 0,
      }

      // Include delivery sequence fields when sequence is saved
      if (mapa.sequenciaValida) {
        nfItem.ordemEntrega = mapaNf.ordemEntrega
        nfItem.distanciaParcialKm = mapaNf.distanciaParcialKm != null
          ? Number(mapaNf.distanciaParcialKm)
          : null
      }

      return nfItem
    })

    const response: any = {
      id: mapa.id,
      numero: mapa.numero,
      emissao: mapa.emissaoEm,
      placa: mapa.veiculoPlaca,
      motorista: mapa.motorista,
      motoristaCpf: mapa.motoristaCpf,
      observacoes: mapa.observacoes,
      status: mapa.status,
      rota: rotaInfo,
      criadoEm: mapa.criadoEm,
      finalizadoEm: mapa.finalizadoEm,
      nfs: nfsDetalhadas,
    }

    // Include total distance when sequence is saved
    if (mapa.sequenciaValida) {
      response.distanciaTotalKm = mapa.distanciaTotalKm != null
        ? Number(mapa.distanciaTotalKm)
        : null
    }

    return response
  })
}
