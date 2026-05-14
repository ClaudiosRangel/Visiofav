import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

// ===========================================================================
// Schemas
// ===========================================================================

const idParamsSchema = z.object({ id: z.string().uuid() })

const nfsDisponiveisQuerySchema = z.object({
  rotaId: z.string().uuid().optional(),
  clienteId: z.string().uuid().optional(),
  dataInicio: z.string().optional(),
  dataFim: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
})

const marcarNfsSchema = z.object({
  nfeIds: z.array(z.string().uuid()).min(1),
})

const marcarRotaSchema = z.object({
  rotaId: z.string().uuid(),
})

const gerarMapaSchema = z.object({
  veiculoPlaca: z.string().min(1).max(10),
  motorista: z.string().max(200).optional(),
  motoristaCpf: z.string().max(14).optional(),
  observacoes: z.string().optional(),
  rotaId: z.string().uuid().optional(),
})

const transicaoStatusSchema = z.object({
  status: z.string().min(1),
})

const cancelarMapaSchema = z.object({
  motivoCancelamento: z.string().min(1, 'Motivo de cancelamento é obrigatório'),
})

const transferirNfsSchema = z.object({
  sourceMapaId: z.string().uuid(),
  targetMapaId: z.string().uuid(),
  nfeIds: z.array(z.string().uuid()).min(1),
})

const fecharMapaSchema = z.object({
  nfs: z.array(z.object({
    nfeId: z.string().uuid(),
    statusEntrega: z.enum(['ENTREGUE', 'DEVOLVIDO']),
    motivoDevolucao: z.string().optional(),
  })).min(1),
})

const listarMapasQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  numero: z.coerce.number().int().optional(),
  status: z.string().optional(),
  dataInicio: z.string().optional(),
  dataFim: z.string().optional(),
  motorista: z.string().optional(),
  placa: z.string().optional(),
  rotaId: z.string().uuid().optional(),
})

// ===========================================================================
// Status Machine — Mapa de Carregamento
// ===========================================================================

const VALID_TRANSITIONS_MAPA: Record<string, string[]> = {
  AGUARDANDO_SEPARACAO: ['EM_CARREGAMENTO', 'CANCELADO'],
  EM_CARREGAMENTO: ['FINALIZADO', 'CANCELADO'],
  FINALIZADO: [],
  CANCELADO: [],
}

function validarTransicaoMapa(statusAtual: string, statusAlvo: string): { valido: boolean; mensagem?: string } {
  const permitidos = VALID_TRANSITIONS_MAPA[statusAtual] || []
  if (!permitidos.includes(statusAlvo)) {
    return { valido: false, mensagem: `Não é possível transicionar de '${statusAtual}' para '${statusAlvo}'` }
  }
  return { valido: true }
}

// ===========================================================================
// Routes
// ===========================================================================

export async function mapaCarregamentoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // ==========================================================================
  // GET /nfs-disponiveis — List NFs available for load assembly (Task 7.1)
  // ==========================================================================
  app.get('/nfs-disponiveis', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { rotaId, clienteId, dataInicio, dataFim, page, limit } = nfsDisponiveisQuerySchema.parse(request.query)

    // Get NF IDs already in an active MapaCarregamento (non-CANCELADO)
    const nfsEmMapaAtivo = await prisma.mapaCarregamentoNf.findMany({
      where: {
        mapaCarregamento: {
          empresaId: user.empresaId,
          status: { not: 'CANCELADO' },
        },
      },
      select: { nfeId: true },
    })
    const nfeIdsEmMapa = nfsEmMapaAtivo.map((n) => n.nfeId)

    // Build where clause for PedidoVenda → VendaEfetivada → Nfe chain
    const pedidoWhere: any = { empresaId: user.empresaId }
    if (rotaId) pedidoWhere.rotaId = rotaId
    if (clienteId) pedidoWhere.clienteId = clienteId

    const nfeWhere: any = {
      empresaId: user.empresaId,
      id: { notIn: nfeIdsEmMapa },
      vendaEfetivada: {
        pedidoVenda: pedidoWhere,
      },
    }

    if (dataInicio || dataFim) {
      nfeWhere.criadoEm = {}
      if (dataInicio) nfeWhere.criadoEm.gte = new Date(dataInicio)
      if (dataFim) nfeWhere.criadoEm.lte = new Date(dataFim + 'T23:59:59.999Z')
    }

    const [nfs, total] = await Promise.all([
      prisma.nfe.findMany({
        where: nfeWhere,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { numero: 'asc' },
        include: {
          itens: { select: { qCom: true, vProd: true } },
          vendaEfetivada: {
            include: {
              pedidoVenda: {
                include: {
                  cliente: { select: { razaoSocial: true } },
                },
              },
            },
          },
        },
      }),
      prisma.nfe.count({ where: nfeWhere }),
    ])

    // Buscar rotas para os pedidos que têm rotaId
    const rotaIds = Array.from(new Set(
      nfs.map((nf) => nf.vendaEfetivada?.pedidoVenda?.rotaId).filter((id): id is string => !!id)
    ))
    const rotas = rotaIds.length > 0
      ? await prisma.rota.findMany({ where: { id: { in: rotaIds } }, select: { id: true, codigo: true, descricao: true } })
      : []
    const rotaLookup = new Map(rotas.map((r) => [r.id, r]))

    // Fallback: buscar clientes diretamente se o include não trouxe
    const clienteIds = Array.from(new Set(
      nfs.map((nf) => nf.vendaEfetivada?.pedidoVenda?.clienteId).filter((id): id is string => !!id)
    ))
    const clientes = clienteIds.length > 0
      ? await prisma.cliente.findMany({ where: { id: { in: clienteIds } }, select: { id: true, razaoSocial: true, nomeFantasia: true } })
      : []
    const clienteLookup = new Map(clientes.map((c) => [c.id, c]))

    const data = nfs.map((nf) => {
      const pedido = nf.vendaEfetivada?.pedidoVenda
      const rota = pedido?.rotaId ? rotaLookup.get(pedido.rotaId) : null
      const clienteFromInclude = pedido?.cliente?.razaoSocial || (pedido as any)?.cliente?.nomeFantasia
      const clienteFromLookup = pedido?.clienteId ? clienteLookup.get(pedido.clienteId) : null
      return {
        nfeId: nf.id,
        numero: nf.numero,
        serie: nf.serie,
        cliente: clienteFromInclude || clienteFromLookup?.razaoSocial || clienteFromLookup?.nomeFantasia || null,
        clienteId: pedido?.clienteId || null,
        rotaId: pedido?.rotaId || null,
        rotaCodigo: rota?.codigo || null,
        rotaDescricao: rota?.descricao || null,
        valorTotal: nf.itens.reduce((sum, item) => sum + Number(item.vProd), 0),
        pesoTotal: nf.itens.reduce((sum, item) => sum + Number(item.qCom), 0),
        mapaOk: nf.mapaOk,
      }
    })

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) }
  })

  // ==========================================================================
  // POST /nfs/marcar — Mark NFs (set mapaOk=true) (Task 7.4)
  // ==========================================================================
  app.post('/nfs/marcar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { nfeIds } = marcarNfsSchema.parse(request.body)

    await prisma.nfe.updateMany({
      where: {
        id: { in: nfeIds },
        empresaId: user.empresaId,
      },
      data: { mapaOk: true },
    })

    return { message: 'NFs marcadas com sucesso' }
  })

  // ==========================================================================
  // POST /nfs/desmarcar — Unmark NFs (set mapaOk=false) (Task 7.4)
  // ==========================================================================
  app.post('/nfs/desmarcar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { nfeIds } = marcarNfsSchema.parse(request.body)

    await prisma.nfe.updateMany({
      where: {
        id: { in: nfeIds },
        empresaId: user.empresaId,
      },
      data: { mapaOk: false },
    })

    return { message: 'NFs desmarcadas com sucesso' }
  })

  // ==========================================================================
  // POST /nfs/marcar-rota — Mark all NFs of a route (Task 7.4)
  // ==========================================================================
  app.post('/nfs/marcar-rota', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { rotaId } = marcarRotaSchema.parse(request.body)

    // Get NF IDs already in an active MapaCarregamento
    const nfsEmMapaAtivo = await prisma.mapaCarregamentoNf.findMany({
      where: {
        mapaCarregamento: {
          empresaId: user.empresaId,
          status: { not: 'CANCELADO' },
        },
      },
      select: { nfeId: true },
    })
    const nfeIdsEmMapa = nfsEmMapaAtivo.map((n) => n.nfeId)

    // Find all NFs linked to PedidoVenda with this rotaId
    const nfs = await prisma.nfe.findMany({
      where: {
        empresaId: user.empresaId,
        id: { notIn: nfeIdsEmMapa },
        vendaEfetivada: {
          pedidoVenda: {
            rotaId,
            empresaId: user.empresaId,
          },
        },
      },
      select: { id: true },
    })

    if (nfs.length > 0) {
      await prisma.nfe.updateMany({
        where: { id: { in: nfs.map((n) => n.id) } },
        data: { mapaOk: true },
      })
    }

    return { message: `${nfs.length} NFs marcadas para a rota` }
  })

  // ==========================================================================
  // POST /nfs/desmarcar-rota — Unmark all NFs of a route (Task 7.4)
  // ==========================================================================
  app.post('/nfs/desmarcar-rota', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { rotaId } = marcarRotaSchema.parse(request.body)

    // Find all NFs linked to PedidoVenda with this rotaId that are marked
    const nfs = await prisma.nfe.findMany({
      where: {
        empresaId: user.empresaId,
        mapaOk: true,
        vendaEfetivada: {
          pedidoVenda: {
            rotaId,
            empresaId: user.empresaId,
          },
        },
      },
      select: { id: true },
    })

    if (nfs.length > 0) {
      await prisma.nfe.updateMany({
        where: { id: { in: nfs.map((n) => n.id) } },
        data: { mapaOk: false },
      })
    }

    return { message: `${nfs.length} NFs desmarcadas para a rota` }
  })

  // ==========================================================================
  // GET /totalizacao — Totals grouped by route for marked NFs (Task 7.5)
  // ==========================================================================
  app.get('/totalizacao', async (request) => {
    const user = request.user as { id: string; empresaId: string }

    // Get all marked NFs with their route info and items
    const nfsMarcadas = await prisma.nfe.findMany({
      where: {
        empresaId: user.empresaId,
        mapaOk: true,
      },
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

    for (const nf of nfsMarcadas) {
      const rotaId = nf.vendaEfetivada?.pedidoVenda?.rotaId || null
      const key = rotaId

      if (!porRotaMap.has(key)) {
        porRotaMap.set(key, { quantidadeNfs: 0, valorTotal: 0, pesoTotalKg: 0, totalVolumes: 0 })
      }

      const grupo = porRotaMap.get(key)!
      grupo.quantidadeNfs += 1
      grupo.valorTotal += nf.itens.reduce((sum, item) => sum + Number(item.vProd), 0)
      grupo.pesoTotalKg += nf.itens.reduce((sum, item) => sum + Number(item.qCom), 0)
      grupo.totalVolumes += nf.itens.length
    }

    // Build response with rota details
    const rotaIds = Array.from(porRotaMap.keys()).filter((id): id is string => id !== null)
    const rotas = rotaIds.length > 0
      ? await prisma.rota.findMany({
          where: { id: { in: rotaIds } },
          select: { id: true, codigo: true, descricao: true },
        })
      : []

    const rotaLookup = new Map(rotas.map((r) => [r.id, r]))

    const porRota = Array.from(porRotaMap.entries()).map(([rotaId, totais]) => {
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
      quantidadeNfs: porRota.reduce((s, r) => s + r.quantidadeNfs, 0),
      valorTotal: Math.round(porRota.reduce((s, r) => s + r.valorTotal, 0) * 100) / 100,
      pesoTotalKg: Math.round(porRota.reduce((s, r) => s + r.pesoTotalKg, 0) * 1000) / 1000,
      totalVolumes: porRota.reduce((s, r) => s + r.totalVolumes, 0),
    }

    return { porRota, geral }
  })

  // ==========================================================================
  // POST / — Generate loading map from marked NFs (Task 8.1)
  // ==========================================================================
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = gerarMapaSchema.parse(request.body)

    // Find all marked NFs for this empresa
    const nfsMarcadas = await prisma.nfe.findMany({
      where: {
        empresaId: user.empresaId,
        mapaOk: true,
      },
      select: { id: true },
    })

    if (nfsMarcadas.length === 0) {
      return reply.status(422).send({ message: 'Nenhuma NF marcada para geração do mapa' })
    }

    const mapa = await prisma.$transaction(async (tx) => {
      // Sequential number: max(numero for empresa) + 1
      const maxResult = await tx.mapaCarregamento.findFirst({
        where: { empresaId: user.empresaId },
        orderBy: { numero: 'desc' },
        select: { numero: true },
      })
      const proximoNumero = (maxResult?.numero || 0) + 1

      // Create the map
      const novoMapa = await tx.mapaCarregamento.create({
        data: {
          empresaId: user.empresaId,
          numero: proximoNumero,
          rotaId: body.rotaId,
          veiculoPlaca: body.veiculoPlaca,
          motorista: body.motorista,
          motoristaCpf: body.motoristaCpf,
          observacoes: body.observacoes,
          criadoPorId: user.id,
          status: 'AGUARDANDO_SEPARACAO',
        },
      })

      // Associate all marked NFs
      await tx.mapaCarregamentoNf.createMany({
        data: nfsMarcadas.map((nf) => ({
          mapaCarregamentoId: novoMapa.id,
          nfeId: nf.id,
        })),
      })

      // Clear mapaOk flag
      await tx.nfe.updateMany({
        where: { id: { in: nfsMarcadas.map((n) => n.id) } },
        data: { mapaOk: false },
      })

      return novoMapa
    })

    return reply.status(201).send(mapa)
  })

  // ==========================================================================
  // GET / — List maps with pagination and filters (Task 8.15)
  // ==========================================================================
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { page, limit, numero, status, dataInicio, dataFim, motorista, placa, rotaId } =
      listarMapasQuerySchema.parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (numero) where.numero = numero
    if (status) where.status = status
    if (rotaId) where.rotaId = rotaId
    if (motorista) where.motorista = { contains: motorista, mode: 'insensitive' }
    if (placa) where.veiculoPlaca = { contains: placa, mode: 'insensitive' }
    if (dataInicio || dataFim) {
      where.criadoEm = {}
      if (dataInicio) where.criadoEm.gte = new Date(dataInicio)
      if (dataFim) where.criadoEm.lte = new Date(dataFim + 'T23:59:59.999Z')
    }

    const [data, total] = await Promise.all([
      prisma.mapaCarregamento.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { criadoEm: 'desc' },
        include: {
          nfs: { select: { id: true, nfeId: true, statusEntrega: true } },
        },
      }),
      prisma.mapaCarregamento.count({ where }),
    ])

    const dataComTotais = data.map((m) => ({
      ...m,
      totalNfs: m.nfs.length,
    }))

    return { data: dataComTotais, total, page, limit, totalPages: Math.ceil(total / limit) }
  })

  // ==========================================================================
  // GET /:id — Get map detail with all associated NFs (Task 8.10)
  // ==========================================================================
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const mapa = await prisma.mapaCarregamento.findFirst({
      where: { id, empresaId: user.empresaId },
      include: {
        nfs: true,
      },
    })

    if (!mapa) {
      return reply.status(404).send({ message: 'Mapa de carregamento não encontrado' })
    }

    // Fetch NF details for all associated NFs
    const nfeIds = mapa.nfs.map((n) => n.nfeId)
    const nfes = nfeIds.length > 0
      ? await prisma.nfe.findMany({
          where: { id: { in: nfeIds } },
          include: {
            itens: { select: { qCom: true, vProd: true, xProd: true } },
            vendaEfetivada: {
              include: {
                pedidoVenda: {
                  include: {
                    cliente: { select: { razaoSocial: true, cidade: true, bairro: true } },
                  },
                },
              },
            },
          },
        })
      : []

    const nfeLookup = new Map(nfes.map((nfe) => [nfe.id, nfe]))

    const nfsComDetalhes = mapa.nfs.map((mapaNf) => ({
      ...mapaNf,
      nfe: nfeLookup.get(mapaNf.nfeId) || null,
    }))

    return { ...mapa, nfs: nfsComDetalhes }
  })

  // ==========================================================================
  // PATCH /:id/status — Transition status (Task 8.4)
  // ==========================================================================
  app.patch('/:id/status', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const { status } = transicaoStatusSchema.parse(request.body)

    const mapa = await prisma.mapaCarregamento.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!mapa) {
      return reply.status(404).send({ message: 'Mapa de carregamento não encontrado' })
    }

    const resultado = validarTransicaoMapa(mapa.status, status)
    if (!resultado.valido) {
      return reply.status(422).send({
        message: resultado.mensagem,
        statusAtual: mapa.status,
        statusSolicitado: status,
      })
    }

    const updateData: any = { status }
    if (status === 'FINALIZADO') {
      updateData.finalizadoEm = new Date()
      updateData.fechadoPorId = user.id
    }

    const atualizado = await prisma.mapaCarregamento.update({
      where: { id },
      data: updateData,
    })

    return atualizado
  })

  // ==========================================================================
  // POST /:id/cancelar — Cancel map (Task 8.6)
  // ==========================================================================
  app.post('/:id/cancelar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const { motivoCancelamento } = cancelarMapaSchema.parse(request.body)

    const mapa = await prisma.mapaCarregamento.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!mapa) {
      return reply.status(404).send({ message: 'Mapa de carregamento não encontrado' })
    }

    if (mapa.status === 'FINALIZADO') {
      return reply.status(422).send({ message: 'Mapa finalizado não pode ser cancelado' })
    }

    if (mapa.status === 'CANCELADO') {
      return reply.status(422).send({ message: 'Mapa já está cancelado' })
    }

    await prisma.$transaction(async (tx) => {
      // Dissociate all NFs (delete MapaCarregamentoNf records)
      await tx.mapaCarregamentoNf.deleteMany({
        where: { mapaCarregamentoId: id },
      })

      // Set status CANCELADO
      await tx.mapaCarregamento.update({
        where: { id },
        data: {
          status: 'CANCELADO',
          motivoCancelamento,
          canceladoPorId: user.id,
          canceladoEm: new Date(),
        },
      })
    })

    return { message: 'Mapa de carregamento cancelado com sucesso' }
  })

  // ==========================================================================
  // POST /transferir-nfs — Transfer NFs between maps (Task 8.8)
  // ==========================================================================
  app.post('/transferir-nfs', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { sourceMapaId, targetMapaId, nfeIds } = transferirNfsSchema.parse(request.body)

    // Validate source map
    const sourceMapa = await prisma.mapaCarregamento.findFirst({
      where: { id: sourceMapaId, empresaId: user.empresaId },
    })
    if (!sourceMapa) {
      return reply.status(404).send({ message: 'Mapa de origem não encontrado' })
    }
    if (sourceMapa.status === 'FINALIZADO') {
      return reply.status(422).send({ message: 'Não é possível transferir NFs de um mapa finalizado' })
    }

    // Validate target map
    const targetMapa = await prisma.mapaCarregamento.findFirst({
      where: { id: targetMapaId, empresaId: user.empresaId },
    })
    if (!targetMapa) {
      return reply.status(404).send({ message: 'Mapa de destino não encontrado' })
    }
    if (targetMapa.status === 'FINALIZADO' || targetMapa.status === 'CANCELADO') {
      return reply.status(422).send({ message: 'Mapa de destino não aceita transferências (finalizado ou cancelado)' })
    }

    await prisma.$transaction(async (tx) => {
      // Move MapaCarregamentoNf records from source to target
      await tx.mapaCarregamentoNf.updateMany({
        where: {
          mapaCarregamentoId: sourceMapaId,
          nfeId: { in: nfeIds },
        },
        data: { mapaCarregamentoId: targetMapaId },
      })
    })

    return { message: 'NFs transferidas com sucesso' }
  })

  // ==========================================================================
  // POST /:id/fechar — Close map (confirm deliveries) (Task 8.12)
  // ==========================================================================
  app.post('/:id/fechar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const { nfs } = fecharMapaSchema.parse(request.body)

    const mapa = await prisma.mapaCarregamento.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!mapa) {
      return reply.status(404).send({ message: 'Mapa de carregamento não encontrado' })
    }

    if (mapa.status !== 'EM_CARREGAMENTO') {
      return reply.status(422).send({ message: 'Mapa deve estar em status EM_CARREGAMENTO para ser fechado' })
    }

    // Validate motivoDevolucao for DEVOLVIDO
    for (const nf of nfs) {
      if (nf.statusEntrega === 'DEVOLVIDO' && (!nf.motivoDevolucao || nf.motivoDevolucao.trim() === '')) {
        return reply.status(422).send({ message: 'Motivo de devolução é obrigatório para NFs devolvidas' })
      }
    }

    await prisma.$transaction(async (tx) => {
      // Update each NF delivery status
      for (const nf of nfs) {
        await tx.mapaCarregamentoNf.updateMany({
          where: {
            mapaCarregamentoId: id,
            nfeId: nf.nfeId,
          },
          data: {
            statusEntrega: nf.statusEntrega,
            motivoDevolucao: nf.statusEntrega === 'DEVOLVIDO' ? nf.motivoDevolucao : null,
          },
        })
      }

      // Transition to FINALIZADO
      await tx.mapaCarregamento.update({
        where: { id },
        data: {
          status: 'FINALIZADO',
          fechadoPorId: user.id,
          finalizadoEm: new Date(),
        },
      })
    })

    return { message: 'Mapa de carregamento fechado com sucesso' }
  })
}
