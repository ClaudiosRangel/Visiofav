import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { registrarAudit } from '../auditoria/auditoria.routes'
import { FichaService } from '../ficha-operacional/ficha.service'
import { OsAutoCreateService } from '../ordem-servico-wms/os-auto-create.service'

const idParamsSchema = z.object({ id: z.string().uuid() })
const ondaIdParamsSchema = z.object({ ondaId: z.string().uuid() })

const criarVolumeSchema = z.object({
  ondaSeparacaoId: z.string().uuid(),
  pedidoVendaId: z.string().uuid(),
  tipo: z.enum(['CAIXA', 'PALETE', 'FARDO']),
  pesoKg: z.number().positive('Peso deve ser maior que zero'),
  comprimentoCm: z.number().positive('Comprimento deve ser maior que zero'),
  larguraCm: z.number().positive('Largura deve ser maior que zero'),
  alturaCm: z.number().positive('Altura deve ser maior que zero'),
})

const vincularItensSchema = z.object({
  itens: z.array(z.object({
    itemSeparacaoId: z.string().uuid(),
    quantidade: z.number().positive(),
  })).min(1),
})

export async function volumeRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // POST / — criar volume
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = criarVolumeSchema.parse(request.body)

    const onda = await prisma.ondaSeparacao.findUnique({ where: { id: body.ondaSeparacaoId } })
    if (!onda) return reply.status(404).send({ message: 'Onda não encontrada' })
    if (onda.status !== 'CONFERIDA' && onda.status !== 'EMBALADA') {
      return reply.status(422).send({ message: `Onda em status ${onda.status}. Esperado: CONFERIDA` })
    }

    // Código sequencial por onda
    const ultimo = await prisma.volume.findFirst({
      where: { ondaSeparacaoId: body.ondaSeparacaoId },
      orderBy: { codigo: 'desc' },
      select: { codigo: true },
    })

    const isFirstVolume = !ultimo

    const volume = await prisma.volume.create({
      data: {
        ondaSeparacaoId: body.ondaSeparacaoId,
        pedidoVendaId: body.pedidoVendaId,
        codigo: (ultimo?.codigo ?? 0) + 1,
        tipo: body.tipo,
        pesoKg: body.pesoKg,
        comprimentoCm: body.comprimentoCm,
        larguraCm: body.larguraCm,
        alturaCm: body.alturaCm,
      },
    })

    // Task 13.2: Auto-create OS type SAIDA operation EMBALAGEM on first volume
    let ordemServico = null
    if (isFirstVolume) {
      try {
        const osService = new OsAutoCreateService()
        ordemServico = await osService.criarOsEmbalagem(user.empresaId, body.ondaSeparacaoId)

        // OS Sync: Set OS to EXECUTANDO with horaInicio
        if (ordemServico) {
          await prisma.ordemServicoWms.update({
            where: { id: ordemServico.id },
            data: { status: 'EXECUTANDO', horaInicio: new Date() },
          })
        }
      } catch {
        // Silenciar erros de criação de OS para não bloquear a operação
      }
    }

    return reply.status(201).send({ ...volume, ordemServico })
  })

  // POST /:id/itens — vincular itens ao volume
  app.post('/:id/itens', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)
    const { itens } = vincularItensSchema.parse(request.body)

    const volume = await prisma.volume.findUnique({ where: { id } })
    if (!volume) return reply.status(404).send({ message: 'Volume não encontrado' })

    // Validar quantidades
    for (const item of itens) {
      const itemSep = await prisma.itemSeparacao.findUnique({ where: { id: item.itemSeparacaoId } })
      if (!itemSep) return reply.status(404).send({ message: `Item ${item.itemSeparacaoId} não encontrado` })

      const jaVinculado = await prisma.itemVolume.aggregate({
        where: { itemSeparacaoId: item.itemSeparacaoId },
        _sum: { quantidade: true },
      })

      const totalVinculado = Number(jaVinculado._sum.quantidade || 0) + item.quantidade
      if (totalVinculado > Number(itemSep.quantidadeSeparada)) {
        return reply.status(422).send({ message: `Quantidade excede o separado para item ${item.itemSeparacaoId}` })
      }
    }

    await prisma.itemVolume.createMany({
      data: itens.map((i) => ({ volumeId: id, itemSeparacaoId: i.itemSeparacaoId, quantidade: i.quantidade })),
    })

    // Verificar se todos itens da onda estão vinculados → EMBALADA
    const onda = await prisma.ondaSeparacao.findUnique({
      where: { id: volume.ondaSeparacaoId },
      include: { ordens: { include: { itens: { select: { id: true, quantidadeSeparada: true } } } } },
    })

    if (onda) {
      const todosItensIds = onda.ordens.flatMap((o) => o.itens.map((i) => i.id))
      let todosVinculados = true

      for (const itemId of todosItensIds) {
        const vinculado = await prisma.itemVolume.aggregate({
          where: { itemSeparacaoId: itemId },
          _sum: { quantidade: true },
        })
        const itemSep = onda.ordens.flatMap((o) => o.itens).find((i) => i.id === itemId)
        if (!itemSep || Number(vinculado._sum.quantidade || 0) < Number(itemSep.quantidadeSeparada)) {
          todosVinculados = false
          break
        }
      }

      if (todosVinculados) {
        await prisma.ondaSeparacao.update({ where: { id: onda.id }, data: { status: 'EMBALADA' } })

        // OS Sync: Concluir OS de EMBALAGEM
        try {
          const os = await prisma.ordemServicoWms.findFirst({
            where: {
              ondaSeparacaoId: onda.id,
              operacao: 'EMBALAGEM',
              status: 'EXECUTANDO',
            },
            orderBy: { criadoEm: 'desc' },
          })
          if (os) {
            const horaFim = new Date()
            await prisma.ordemServicoWms.update({
              where: { id: os.id },
              data: { status: 'CONCLUIDO', horaFim },
            })
          }
        } catch {
          // OS sync is non-blocking
        }
      }
    }

    return { message: 'Itens vinculados ao volume' }
  })

  // GET /:id/etiqueta — dados para etiqueta
  app.get('/:id/etiqueta', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)

    const volume = await prisma.volume.findUnique({
      where: { id },
      include: { itens: { include: { itemSeparacao: { include: { ordemSeparacao: true } } } } },
    })

    if (!volume) return reply.status(404).send({ message: 'Volume não encontrado' })

    // Buscar dados do pedido/cliente
    const pedido = await prisma.pedidoVenda.findUnique({
      where: { id: volume.pedidoVendaId },
      include: { cliente: { select: { razaoSocial: true, nomeFantasia: true } } },
    })

    return {
      codigoVolume: volume.codigo,
      tipo: volume.tipo,
      pesoKg: Number(volume.pesoKg),
      dimensoes: `${Number(volume.comprimentoCm)}x${Number(volume.larguraCm)}x${Number(volume.alturaCm)} cm`,
      quantidadeItens: volume.itens.length,
      pedidoNumero: pedido?.numero,
      cliente: pedido?.cliente?.nomeFantasia || pedido?.cliente?.razaoSocial || '',
    }
  })

  // ==========================================================================
  // POST /:id/embalar-scanner — Vincula item ao volume via scanner
  // Task 10.1: Scans Produto_Barcode, validates item belongs to same
  // OndaSeparacao, creates ItemVolume link.
  // ==========================================================================
  app.post('/:id/embalar-scanner', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = z.object({
      barcodeEscaneado: z.string().min(1),
      quantidade: z.number().positive('Quantidade deve ser maior que zero'),
    }).parse(request.body)

    // Fetch the volume
    const volume = await prisma.volume.findUnique({
      where: { id },
      select: { id: true, ondaSeparacaoId: true, codigo: true },
    })

    if (!volume) return reply.status(404).send({ message: 'Volume não encontrado' })

    // Find product by barcode (EAN via Sku or product code)
    const sku = await prisma.sku.findFirst({
      where: { codigoBarra: body.barcodeEscaneado },
      select: { produtoId: true },
    })

    let produtoEscaneadoId: string | null = sku?.produtoId ?? null

    if (!produtoEscaneadoId) {
      const produto = await prisma.produto.findFirst({
        where: { codigo: body.barcodeEscaneado },
        select: { id: true },
      })
      produtoEscaneadoId = produto?.id ?? null
    }

    if (!produtoEscaneadoId) {
      return reply.status(422).send({ message: 'Produto não encontrado para o barcode escaneado' })
    }

    // Validate that the product belongs to the same OndaSeparacao as the volume
    const itemSeparacao = await prisma.itemSeparacao.findFirst({
      where: {
        produtoId: produtoEscaneadoId,
        ordemSeparacao: { ondaSeparacaoId: volume.ondaSeparacaoId },
        status: { in: ['SEPARADO', 'SEPARADO_PARCIAL'] },
      },
      select: { id: true, produtoId: true, quantidadeSeparada: true },
    })

    if (!itemSeparacao) {
      return reply.status(422).send({
        message: 'Produto não pertence à mesma onda de separação do volume ou não foi separado',
      })
    }

    // Check if quantity exceeds what was separated
    const jaVinculado = await prisma.itemVolume.aggregate({
      where: { itemSeparacaoId: itemSeparacao.id },
      _sum: { quantidade: true },
    })

    const totalVinculado = Number(jaVinculado._sum.quantidade || 0) + body.quantidade
    if (totalVinculado > Number(itemSeparacao.quantidadeSeparada)) {
      return reply.status(422).send({
        message: `Quantidade excede o separado. Separado: ${Number(itemSeparacao.quantidadeSeparada)}, já embalado: ${Number(jaVinculado._sum.quantidade || 0)}, tentando embalar: ${body.quantidade}`,
      })
    }

    // Create ItemVolume
    const itemVolume = await prisma.itemVolume.create({
      data: {
        volumeId: id,
        itemSeparacaoId: itemSeparacao.id,
        quantidade: body.quantidade,
      },
    })

    // Register audit
    await registrarAudit(user.empresaId, user.id, {
      entidade: 'VOLUME',
      entidadeId: id,
      acao: 'ATUALIZAR',
      descricao: `Item embalado via scanner: barcode ${body.barcodeEscaneado}, quantidade ${body.quantidade}`,
      dados: {
        volumeId: id,
        itemSeparacaoId: itemSeparacao.id,
        barcodeEscaneado: body.barcodeEscaneado,
        quantidade: body.quantidade,
      },
    })

    // Task 10.4: Check if all items from the onda are packed → EMBALADA
    await verificarConclusaoEmbalagem(volume.ondaSeparacaoId)

    return itemVolume
  })

  // ==========================================================================
  // GET /pendentes-embalagem/:ondaId — Lists separated items pending packing
  // Task 10.2: Grouped by sales order.
  // ==========================================================================
  app.get('/pendentes-embalagem/:ondaId', async (request, reply) => {
    const { ondaId } = ondaIdParamsSchema.parse(request.params)

    // Fetch all separated items from the onda
    const itensSeparados = await prisma.itemSeparacao.findMany({
      where: {
        ordemSeparacao: { ondaSeparacaoId: ondaId },
        status: { in: ['SEPARADO', 'SEPARADO_PARCIAL'] },
      },
      select: {
        id: true,
        produtoId: true,
        pedidoVendaId: true,
        quantidadeSeparada: true,
        status: true,
      },
    })

    if (itensSeparados.length === 0) {
      return { ondaId, pedidos: [], totalPendentes: 0 }
    }

    // For each item, check how much has already been packed
    const pendentes: Array<{
      itemSeparacaoId: string
      produtoId: string
      pedidoVendaId: string
      quantidadeSeparada: number
      quantidadeEmbalada: number
      quantidadePendente: number
    }> = []

    for (const item of itensSeparados) {
      const jaEmbalado = await prisma.itemVolume.aggregate({
        where: { itemSeparacaoId: item.id },
        _sum: { quantidade: true },
      })

      const quantidadeSeparada = Number(item.quantidadeSeparada)
      const quantidadeEmbalada = Number(jaEmbalado._sum.quantidade || 0)
      const quantidadePendente = quantidadeSeparada - quantidadeEmbalada

      if (quantidadePendente > 0) {
        pendentes.push({
          itemSeparacaoId: item.id,
          produtoId: item.produtoId,
          pedidoVendaId: item.pedidoVendaId,
          quantidadeSeparada,
          quantidadeEmbalada,
          quantidadePendente,
        })
      }
    }

    // Enrich with product data
    const produtoIds = [...new Set(pendentes.map((p) => p.produtoId))]
    const produtos = await prisma.produto.findMany({
      where: { id: { in: produtoIds } },
      select: { id: true, codigo: true, nome: true, unidade: true },
    })
    const produtoMap = new Map(produtos.map((p) => [p.id, p]))

    // Enrich with pedido data
    const pedidoIds = [...new Set(pendentes.map((p) => p.pedidoVendaId))]
    const pedidos = await prisma.pedidoVenda.findMany({
      where: { id: { in: pedidoIds } },
      select: { id: true, numero: true },
    })
    const pedidoMap = new Map(pedidos.map((p) => [p.id, p]))

    // Group by pedido
    const porPedido = new Map<string, typeof pendentes>()
    for (const item of pendentes) {
      const key = item.pedidoVendaId
      if (!porPedido.has(key)) porPedido.set(key, [])
      porPedido.get(key)!.push(item)
    }

    const resultado = Array.from(porPedido.entries()).map(([pedidoVendaId, itens]) => ({
      pedidoVendaId,
      pedidoNumero: pedidoMap.get(pedidoVendaId)?.numero ?? null,
      itens: itens.map((item) => ({
        ...item,
        produto: produtoMap.get(item.produtoId) ?? null,
      })),
    }))

    return { ondaId, pedidos: resultado, totalPendentes: pendentes.length }
  })
}

// ==========================================================================
// Helper: Verifica conclusão de embalagem (Task 10.4)
// When all separated items are packed, update OndaSeparacao to EMBALADA.
// ==========================================================================
async function verificarConclusaoEmbalagem(ondaSeparacaoId: string): Promise<boolean> {
  const onda = await prisma.ondaSeparacao.findUnique({
    where: { id: ondaSeparacaoId },
    include: {
      ordens: {
        include: {
          itens: { select: { id: true, quantidadeSeparada: true, status: true } },
        },
      },
    },
  })

  if (!onda) return false

  const todosItens = onda.ordens.flatMap((o) => o.itens)
  // Only consider items that were actually separated
  const itensSeparados = todosItens.filter((i) => ['SEPARADO', 'SEPARADO_PARCIAL'].includes(i.status))

  if (itensSeparados.length === 0) return false

  let todosEmbalados = true
  for (const item of itensSeparados) {
    const vinculado = await prisma.itemVolume.aggregate({
      where: { itemSeparacaoId: item.id },
      _sum: { quantidade: true },
    })
    if (Number(vinculado._sum.quantidade || 0) < Number(item.quantidadeSeparada)) {
      todosEmbalados = false
      break
    }
  }

  if (todosEmbalados) {
    await prisma.ondaSeparacao.update({
      where: { id: ondaSeparacaoId },
      data: { status: 'EMBALADA' },
    })

    // OS Sync: Concluir OS de EMBALAGEM
    try {
      const os = await prisma.ordemServicoWms.findFirst({
        where: {
          ondaSeparacaoId,
          operacao: 'EMBALAGEM',
          status: 'EXECUTANDO',
        },
        orderBy: { criadoEm: 'desc' },
      })
      if (os) {
        const horaFim = new Date()
        await prisma.ordemServicoWms.update({
          where: { id: os.id },
          data: { status: 'CONCLUIDO', horaFim },
        })
      }
    } catch {
      // OS sync is non-blocking
    }

    return true
  }

  return false
}
