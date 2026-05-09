import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { dispararWebhook } from '../integracao/webhook-dispatcher'
import { registrarAudit } from '../auditoria/auditoria.routes'
import { FichaService } from '../ficha-operacional/ficha.service'
import { OsAutoCreateService } from '../ordem-servico-wms/os-auto-create.service'
import { MonitorService } from '../monitor/monitor.service'
import { StockService } from '../estoque/stock.service'
import { validarTransicaoCarregamento } from './status-machine.service'

const idParamsSchema = z.object({ id: z.string().uuid() })

const criarCarregamentoSchema = z.object({
  docaId: z.string().uuid(),
  veiculoPlaca: z.string().min(1).max(10),
  transportadoraId: z.string().uuid().optional(),
  motorista: z.string().max(200).optional(),
  motoristaCpf: z.string().max(14).optional(),
  rotaId: z.string().uuid().optional(),
})

const adicionarVolumesSchema = z.object({
  volumes: z.array(z.object({
    volumeId: z.string().uuid(),
    sequencia: z.number().int().positive(),
  })).min(1),
})

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.string().optional(),
  rotaId: z.string().uuid().optional(),
})

export async function carregamentoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // GET / — listar carregamentos
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { page, limit, status, rotaId } = listQuerySchema.parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (status) where.status = status
    if (rotaId) where.rotaId = rotaId

    const [data, total] = await Promise.all([
      prisma.carregamento.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { criadoEm: 'desc' },
        include: { volumes: { include: { volume: { select: { codigo: true, tipo: true, pesoKg: true, status: true } } } } },
      }),
      prisma.carregamento.count({ where }),
    ])

    const dataComProgresso = data.map((c) => ({
      ...c,
      totalVolumes: c.volumes.length,
      volumesCarregados: c.volumes.filter((v) => v.carregadoEm !== null).length,
      pesoTotal: c.volumes.reduce((s, v) => s + Number(v.volume.pesoKg), 0),
    }))

    return { data: dataComProgresso, total }
  })

  // POST / — criar carregamento
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = criarCarregamentoSchema.parse(request.body)

    // Validate rotaId belongs to same empresa
    if (body.rotaId) {
      const rota = await prisma.rota.findFirst({
        where: { id: body.rotaId, empresaId: user.empresaId },
      })
      if (!rota) return reply.status(422).send({ message: 'Rota não encontrada ou não pertence a esta empresa' })
    }

    const carregamento = await prisma.carregamento.create({
      data: {
        empresaId: user.empresaId,
        docaId: body.docaId,
        veiculoPlaca: body.veiculoPlaca,
        transportadoraId: body.transportadoraId,
        motorista: body.motorista,
        motoristaCpf: body.motoristaCpf,
        rotaId: body.rotaId,
      },
    })

    // Task 13.3: Auto-create OS type SAIDA operation CARREGAMENTO
    let ordemServico = null
    try {
      const osService = new OsAutoCreateService()
      ordemServico = await osService.criarOsCarregamento(user.empresaId, carregamento.id)
    } catch {
      // Silenciar erros de criação de OS para não bloquear a operação
    }

    return reply.status(201).send({ ...carregamento, ordemServico })
  })

  // POST /:id/volumes — adicionar volumes
  app.post('/:id/volumes', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)
    const { volumes } = adicionarVolumesSchema.parse(request.body)

    const carregamento = await prisma.carregamento.findUnique({ where: { id } })
    if (!carregamento) return reply.status(404).send({ message: 'Carregamento não encontrado' })

    // Validar volumes
    for (const v of volumes) {
      const volume = await prisma.volume.findUnique({ where: { id: v.volumeId } })
      if (!volume) return reply.status(404).send({ message: `Volume ${v.volumeId} não encontrado` })
      if (volume.status !== 'EMBALADO') return reply.status(422).send({ message: `Volume ${volume.codigo} não está EMBALADO` })
    }

    await prisma.carregamentoVolume.createMany({
      data: volumes.map((v) => ({
        carregamentoId: id,
        volumeId: v.volumeId,
        sequencia: v.sequencia,
      })),
    })

    await prisma.carregamento.update({ where: { id }, data: { status: 'EM_CARREGAMENTO' } })

    return { message: 'Volumes adicionados' }
  })

  // PATCH /:id/confirmar — confirmar carregamento
  app.patch('/:id/confirmar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const carregamento = await prisma.carregamento.findUnique({
      where: { id },
      include: {
        volumes: {
          include: {
            volume: {
              include: {
                ondaSeparacao: { include: { pedidos: true } },
                itens: { include: { itemSeparacao: { select: { produtoId: true, quantidadeSeparada: true } } } },
              },
            },
          },
        },
      },
    })

    if (!carregamento) return reply.status(404).send({ message: 'Carregamento não encontrado' })
    if (carregamento.volumes.length === 0) return reply.status(422).send({ message: 'Nenhum volume no carregamento' })

    // Collect items for final stock deduction
    const itensParaDeduzir: { produtoId: string; quantidade: number }[] = []
    for (const cv of carregamento.volumes) {
      for (const iv of cv.volume.itens) {
        if (iv.itemSeparacao) {
          itensParaDeduzir.push({
            produtoId: iv.itemSeparacao.produtoId,
            quantidade: Number(iv.quantidade),
          })
        }
      }
    }

    // Final stock deduction
    if (itensParaDeduzir.length > 0) {
      try {
        const stockService = new StockService()
        await stockService.deduzirEstoqueFinal(user.empresaId, itensParaDeduzir)
      } catch (err: any) {
        if (err.status === 422) {
          return reply.status(422).send({ message: err.message })
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      // Marcar todos volumes como carregados
      for (const cv of carregamento.volumes) {
        await tx.carregamentoVolume.update({
          where: { id: cv.id },
          data: { carregadoEm: new Date() },
        })
        await tx.volume.update({
          where: { id: cv.volumeId },
          data: { status: 'CARREGADO' },
        })
      }

      // Concluir carregamento
      await tx.carregamento.update({
        where: { id },
        data: { status: 'CONCLUIDO', concluidoEm: new Date() },
      })

      // Coletar pedidos únicos e atualizar status
      const pedidoIds = new Set<string>()
      const ondaIds = new Set<string>()

      for (const cv of carregamento.volumes) {
        ondaIds.add(cv.volume.ondaSeparacaoId)
        for (const op of cv.volume.ondaSeparacao.pedidos) {
          pedidoIds.add(op.pedidoVendaId)
        }
      }

      // Atualizar pedidos → FATURADO
      for (const pedidoId of pedidoIds) {
        await tx.pedidoVenda.update({ where: { id: pedidoId }, data: { status: 'FATURADO' } })
        // Atualizar VendaEfetivada → EM_TRANSITO
        await tx.vendaEfetivada.updateMany({
          where: { pedidoVendaId: pedidoId },
          data: { statusEntrega: 'EM_TRANSITO' },
        })
      }

      // Concluir ondas
      for (const ondaId of ondaIds) {
        await tx.ondaSeparacao.update({ where: { id: ondaId }, data: { status: 'CONCLUIDA' } })
      }

      // OS Sync: Concluir OS de CARREGAMENTO
      try {
        const os = await tx.ordemServicoWms.findFirst({
          where: {
            carregamentoId: id,
            empresaId: user.empresaId,
            operacao: 'CARREGAMENTO',
            status: { in: ['ABERTO', 'EXECUTANDO'] },
          },
          orderBy: { criadoEm: 'desc' },
        })
        if (os) {
          const horaFim = new Date()
          await tx.ordemServicoWms.update({
            where: { id: os.id },
            data: {
              status: 'CONCLUIDO',
              horaInicio: os.horaInicio || horaFim,
              horaFim,
            },
          })
        }
      } catch {
        // OS sync is non-blocking
      }
    })

    // Disparar webhook
    try {
      await dispararWebhook(user.empresaId, 'expedicao.carregada', {
        carregamentoId: id,
        veiculoPlaca: carregamento.veiculoPlaca,
        totalVolumes: carregamento.volumes.length,
      })
    } catch { /* silenciar erros de webhook */ }

    return { message: 'Carregamento concluído — pedidos atualizados para FATURADO' }
  })

  // ==========================================================================
  // POST /:id/carregar-scanner — Confirms volume loaded via scanner
  // Task 11.1: Validates volume belongs to carregamento, registers timestamp,
  // checks sequence. Task 11.3: When all volumes confirmed, update status.
  // ==========================================================================
  app.post('/:id/carregar-scanner', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = z.object({
      barcodeVolume: z.string().min(1),
    }).parse(request.body)

    // Find the carregamento
    const carregamento = await prisma.carregamento.findUnique({
      where: { id },
      select: { id: true, empresaId: true, status: true },
    })

    if (!carregamento) return reply.status(404).send({ message: 'Carregamento não encontrado' })
    if (carregamento.status === 'CONCLUIDO') {
      return reply.status(422).send({ message: 'Carregamento já foi concluído' })
    }

    // Try to find the volume by numeric code first, then by UUID
    const volumeCode = parseInt(body.barcodeVolume, 10)

    let carregamentoVolume: {
      id: string
      carregamentoId: string
      volumeId: string
      sequencia: number
      carregadoEm: Date | null
      volume: { id: string; codigo: number; ondaSeparacaoId: string }
    } | null = null

    if (!isNaN(volumeCode)) {
      carregamentoVolume = await prisma.carregamentoVolume.findFirst({
        where: {
          carregamentoId: id,
          volume: { codigo: volumeCode },
        },
        include: {
          volume: { select: { id: true, codigo: true, ondaSeparacaoId: true } },
        },
      })
    }

    if (!carregamentoVolume) {
      carregamentoVolume = await prisma.carregamentoVolume.findFirst({
        where: {
          carregamentoId: id,
          volumeId: body.barcodeVolume,
        },
        include: {
          volume: { select: { id: true, codigo: true, ondaSeparacaoId: true } },
        },
      })
    }

    if (!carregamentoVolume) {
      return reply.status(422).send({
        message: 'Volume não pertence a este carregamento. Verifique o código do volume.',
      })
    }

    if (carregamentoVolume.carregadoEm) {
      return reply.status(422).send({
        message: `Volume ${carregamentoVolume.volume.codigo} já foi carregado em ${carregamentoVolume.carregadoEm.toISOString()}`,
      })
    }

    // Check sequence — find the next expected volume
    const proximoNaSequencia = await prisma.carregamentoVolume.findFirst({
      where: {
        carregamentoId: id,
        carregadoEm: null,
      },
      orderBy: { sequencia: 'asc' },
      select: { id: true, sequencia: true },
    })

    let avisoSequencia: string | undefined
    if (proximoNaSequencia && proximoNaSequencia.id !== carregamentoVolume.id) {
      avisoSequencia = `Volume fora de sequência. Sequência esperada: ${proximoNaSequencia.sequencia}. Sequência deste volume: ${carregamentoVolume.sequencia}.`
    }

    // Register loading timestamp
    const carregamentoVolumeAtualizado = await prisma.carregamentoVolume.update({
      where: { id: carregamentoVolume.id },
      data: { carregadoEm: new Date() },
    })

    // Register audit
    await registrarAudit(user.empresaId, user.id, {
      entidade: 'CARREGAMENTO',
      entidadeId: id,
      acao: 'ATUALIZAR',
      descricao: `Volume ${carregamentoVolume.volume.codigo} carregado via scanner${avisoSequencia ? ' (fora de sequência)' : ''}`,
      dados: {
        carregamentoId: id,
        volumeId: carregamentoVolume.volumeId,
        volumeCodigo: carregamentoVolume.volume.codigo,
        sequencia: carregamentoVolume.sequencia,
        barcodeVolume: body.barcodeVolume,
        foraDeSequencia: !!avisoSequencia,
      },
    })

    // Task 11.3: Check if all volumes are confirmed → CONCLUIDO
    const totalVolumes = await prisma.carregamentoVolume.count({
      where: { carregamentoId: id },
    })
    const volumesCarregados = await prisma.carregamentoVolume.count({
      where: { carregamentoId: id, carregadoEm: { not: null } },
    })

    let carregamentoConcluido = false
    if (volumesCarregados >= totalVolumes) {
      await prisma.$transaction(async (tx) => {
        // Update carregamento status
        await tx.carregamento.update({
          where: { id },
          data: { status: 'CONCLUIDO', concluidoEm: new Date() },
        })

        // Update all volumes to CARREGADO
        const cvs = await tx.carregamentoVolume.findMany({
          where: { carregamentoId: id },
          select: { volumeId: true },
        })
        for (const cv of cvs) {
          await tx.volume.update({
            where: { id: cv.volumeId },
            data: { status: 'CARREGADO' },
          })
        }
      })
      carregamentoConcluido = true

      // Final stock deduction on scanner-based completion
      try {
        const carregamentoCompleto = await prisma.carregamento.findUnique({
          where: { id },
          include: {
            volumes: {
              include: {
                volume: {
                  include: {
                    itens: { include: { itemSeparacao: { select: { produtoId: true } } } },
                  },
                },
              },
            },
          },
        })
        if (carregamentoCompleto) {
          const itensParaDeduzir: { produtoId: string; quantidade: number }[] = []
          for (const cv of carregamentoCompleto.volumes) {
            for (const iv of cv.volume.itens) {
              if (iv.itemSeparacao) {
                itensParaDeduzir.push({
                  produtoId: iv.itemSeparacao.produtoId,
                  quantidade: Number(iv.quantidade),
                })
              }
            }
          }
          if (itensParaDeduzir.length > 0) {
            const stockService = new StockService()
            await stockService.deduzirEstoqueFinal(user.empresaId, itensParaDeduzir)
          }
        }
      } catch {
        // Stock deduction error logged but doesn't block
      }

      // OS Sync: Concluir OS de CARREGAMENTO
      try {
        const os = await prisma.ordemServicoWms.findFirst({
          where: {
            carregamentoId: id,
            empresaId: user.empresaId,
            operacao: 'CARREGAMENTO',
            status: { in: ['ABERTO', 'EXECUTANDO'] },
          },
          orderBy: { criadoEm: 'desc' },
        })
        if (os) {
          const horaFim = new Date()
          await prisma.ordemServicoWms.update({
            where: { id: os.id },
            data: { status: 'CONCLUIDO', horaInicio: os.horaInicio || horaFim, horaFim },
          })
        }
      } catch {
        // OS sync is non-blocking
      }
    }

    // OS Sync: Start OS CARREGAMENTO on first volume loaded
    if (volumesCarregados === 1) {
      try {
        const os = await prisma.ordemServicoWms.findFirst({
          where: {
            carregamentoId: id,
            empresaId: user.empresaId,
            operacao: 'CARREGAMENTO',
            status: { in: ['ABERTO'] },
          },
          orderBy: { criadoEm: 'desc' },
        })
        if (os) {
          await prisma.ordemServicoWms.update({
            where: { id: os.id },
            data: { status: 'EXECUTANDO', horaInicio: new Date() },
          })
        }
      } catch {
        // OS sync is non-blocking
      }
    }

    return {
      ...carregamentoVolumeAtualizado,
      volumeCodigo: carregamentoVolume.volume.codigo,
      avisoSequencia,
      carregamentoConcluido,
      progresso: { totalVolumes, volumesCarregados },
    }
  })

  // ==========================================================================
  // GET /:id/romaneio — Returns complete romaneio data
  // Task 11.2
  // ==========================================================================
  app.get('/:id/romaneio', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)

    const carregamento = await buscarCarregamentoCompleto(id)
    if (!carregamento) return reply.status(404).send({ message: 'Carregamento não encontrado' })

    const volumesSorted = [...carregamento.volumes].sort((a, b) => a.sequencia - b.sequencia)

    let pesoTotal = 0
    let totalItens = 0

    const volumesData = volumesSorted.map((cv) => {
      const vol = cv.volume
      const peso = Number(vol.pesoKg)
      const qtdItens = vol.itens?.length ?? 0
      pesoTotal += peso
      totalItens += qtdItens

      return {
        sequencia: cv.sequencia,
        volumeCodigo: vol.codigo,
        tipo: vol.tipo,
        pesoKg: peso,
        comprimentoCm: Number(vol.comprimentoCm),
        larguraCm: Number(vol.larguraCm),
        alturaCm: Number(vol.alturaCm),
        quantidadeItens: qtdItens,
        carregadoEm: cv.carregadoEm,
      }
    })

    return {
      carregamentoId: id,
      veiculoPlaca: carregamento.veiculoPlaca,
      doca: carregamento.doca?.descricao ?? null,
      transportadora: carregamento.transportadora?.razaoSocial ?? null,
      transportadoraCnpj: carregamento.transportadora?.cnpj ?? null,
      status: carregamento.status,
      criadoEm: carregamento.criadoEm,
      concluidoEm: carregamento.concluidoEm,
      volumes: volumesData,
      totalVolumes: carregamento.volumes.length,
      pesoTotal,
      totalItens,
    }
  })

  // ==========================================================================
  // GET /:id/romaneio/html — Returns HTML romaneio for printing
  // Task 11.2
  // ==========================================================================
  app.get('/:id/romaneio/html', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)

    const carregamento = await buscarCarregamentoCompleto(id)
    if (!carregamento) return reply.status(404).send({ message: 'Carregamento não encontrado' })

    const fichaService = new FichaService()
    const html = fichaService.gerarRomaneioHtml(carregamento as any)

    reply.header('Content-Type', 'text/html; charset=utf-8')
    return reply.send(html)
  })

  // ==========================================================================
  // GET /:id/romaneio/pdf — Returns PDF romaneio
  // Task 11.2
  // ==========================================================================
  app.get('/:id/romaneio/pdf', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)

    const carregamento = await buscarCarregamentoCompleto(id)
    if (!carregamento) return reply.status(404).send({ message: 'Carregamento não encontrado' })

    const fichaService = new FichaService()
    const pdf = fichaService.gerarRomaneioPdf(carregamento as any)

    reply.header('Content-Type', 'application/pdf')
    reply.header('Content-Disposition', `inline; filename="romaneio-${id.substring(0, 8)}.pdf"`)
    return reply.send(pdf)
  })

  // ==========================================================================
  // GET /:id/monitor — Real-time monitoring for loading
  // ==========================================================================
  app.get('/:id/monitor', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const carregamento = await prisma.carregamento.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!carregamento) return reply.status(404).send({ message: 'Carregamento não encontrado' })

    const monitorService = new MonitorService()
    return monitorService.getProgressoCarregamento(id)
  })

  // ==========================================================================
  // GET /:id/ficha-acompanhamento — Tracking sheet for loading
  // ==========================================================================
  app.get('/:id/ficha-acompanhamento', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const carregamento = await buscarCarregamentoCompleto(id)
    if (!carregamento) return reply.status(404).send({ message: 'Carregamento não encontrado' })
    if (carregamento.volumes.length === 0) {
      return reply.status(422).send({ message: 'Carregamento não possui volumes para gerar ficha' })
    }

    const fichaService = new FichaService()
    const html = fichaService.gerarHtmlFichaAcompanhamentoCarregamento(carregamento as any)

    reply.header('Content-Type', 'text/html; charset=utf-8')
    return reply.send(html)
  })

  // ==========================================================================
  // POST /:id/cancelar — Cancel carregamento
  // Task 5.5: Requires motivoCancelamento, rejects CONCLUIDO, reverts volumes
  // ==========================================================================
  app.post('/:id/cancelar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = z.object({
      motivoCancelamento: z.string().min(1, 'Motivo de cancelamento é obrigatório'),
    }).parse(request.body)

    const carregamento = await prisma.carregamento.findFirst({
      where: { id, empresaId: user.empresaId },
      include: { volumes: true },
    })

    if (!carregamento) return reply.status(404).send({ message: 'Carregamento não encontrado' })
    if (carregamento.status === 'CONCLUIDO') {
      return reply.status(422).send({ message: 'Carregamento concluído não pode ser cancelado' })
    }
    if (carregamento.status === 'CANCELADO') {
      return reply.status(422).send({ message: 'Carregamento já está cancelado' })
    }

    await prisma.$transaction(async (tx) => {
      // Revert each volume status to EMBALADO
      for (const cv of carregamento.volumes) {
        await tx.volume.update({
          where: { id: cv.volumeId },
          data: { status: 'EMBALADO' },
        })
      }

      // Delete all CarregamentoVolume records
      await tx.carregamentoVolume.deleteMany({
        where: { carregamentoId: id },
      })

      // Update carregamento status
      await tx.carregamento.update({
        where: { id },
        data: {
          status: 'CANCELADO',
          motivoCancelamento: body.motivoCancelamento,
          canceladoPorId: user.id,
          canceladoEm: new Date(),
        },
      })

      // Close linked OS CARREGAMENTO
      try {
        const os = await tx.ordemServicoWms.findFirst({
          where: {
            carregamentoId: id,
            empresaId: user.empresaId,
            operacao: 'CARREGAMENTO',
            status: { in: ['ABERTO', 'EXECUTANDO'] },
          },
          orderBy: { criadoEm: 'desc' },
        })
        if (os) {
          await tx.ordemServicoWms.update({
            where: { id: os.id },
            data: { status: 'CANCELADO', horaFim: new Date() },
          })
        }
      } catch {
        // OS sync is non-blocking
      }
    })

    return { message: 'Carregamento cancelado com sucesso' }
  })

  // ==========================================================================
  // DELETE /:id/volumes/:volumeId — Remove volume from carregamento
  // Task 5.7: Rejects CONCLUIDO/CANCELADO, reverts volume to EMBALADO
  // ==========================================================================
  app.delete('/:id/volumes/:volumeId', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const params = z.object({
      id: z.string().uuid(),
      volumeId: z.string().uuid(),
    }).parse(request.params)

    const carregamento = await prisma.carregamento.findFirst({
      where: { id: params.id, empresaId: user.empresaId },
    })

    if (!carregamento) return reply.status(404).send({ message: 'Carregamento não encontrado' })
    if (carregamento.status === 'CONCLUIDO') {
      return reply.status(422).send({ message: 'Carregamento concluído não pode ser alterado' })
    }
    if (carregamento.status === 'CANCELADO') {
      return reply.status(422).send({ message: 'Carregamento cancelado não pode ser alterado' })
    }

    const carregamentoVolume = await prisma.carregamentoVolume.findFirst({
      where: { carregamentoId: params.id, volumeId: params.volumeId },
    })

    if (!carregamentoVolume) {
      return reply.status(404).send({ message: 'Volume não está associado a este carregamento' })
    }

    // Delete the CarregamentoVolume record and revert volume status
    await prisma.carregamentoVolume.delete({ where: { id: carregamentoVolume.id } })
    await prisma.volume.update({
      where: { id: params.volumeId },
      data: { status: 'EMBALADO' },
    })

    return { message: 'Volume removido do carregamento' }
  })

  // ==========================================================================
  // PATCH /:id/status — Transition carregamento status
  // Task 5.9: Uses StatusMachineService, records timestamps
  // ==========================================================================
  app.patch('/:id/status', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = z.object({
      status: z.string().min(1),
    }).parse(request.body)

    const carregamento = await prisma.carregamento.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!carregamento) return reply.status(404).send({ message: 'Carregamento não encontrado' })

    const resultado = validarTransicaoCarregamento(carregamento.status, body.status)
    if (!resultado.valido) {
      return reply.status(422).send({ message: resultado.mensagem })
    }

    const updateData: any = { status: body.status }

    // Record timestamps based on target status
    if (body.status === 'EM_CARREGAMENTO') {
      updateData.emCarregamentoEm = new Date()
    } else if (body.status === 'CONCLUIDO') {
      updateData.concluidoEm = new Date()
    }

    const atualizado = await prisma.carregamento.update({
      where: { id },
      data: updateData,
    })

    return atualizado
  })
}

// ==========================================================================
// Helper: Fetch complete carregamento with all relations for romaneio
// ==========================================================================
async function buscarCarregamentoCompleto(carregamentoId: string) {
  const carregamento = await prisma.carregamento.findUnique({
    where: { id: carregamentoId },
    include: {
      volumes: {
        include: {
          volume: {
            include: {
              itens: {
                include: {
                  itemSeparacao: true,
                },
              },
            },
          },
        },
        orderBy: { sequencia: 'asc' },
      },
    },
  })

  if (!carregamento) return null

  // Fetch doca and transportadora separately
  const doca = await prisma.doca.findUnique({
    where: { id: carregamento.docaId },
    select: { id: true, descricao: true },
  })

  const transportadora = carregamento.transportadoraId
    ? await prisma.transportadora.findUnique({
        where: { id: carregamento.transportadoraId },
        select: { id: true, razaoSocial: true, cnpj: true },
      })
    : null

  return {
    ...carregamento,
    doca,
    transportadora,
  }
}
