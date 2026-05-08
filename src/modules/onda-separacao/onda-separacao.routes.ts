import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { criarOndaSchema, listarOndasSchema, atribuirFuncionariosSchema, idParamsSchema } from './onda-separacao.schemas'
import { criarOnda, iniciarOnda, cancelarOnda, distribuirItensRoundRobin } from './onda-separacao.service'
import { FichaService } from '../ficha-operacional/ficha.service'
import { OsAutoCreateService } from '../ordem-servico-wms/os-auto-create.service'
import { assumirOs, concluirOs } from '../ordem-servico-wms/os-assignment.helper'
import { StockService } from '../estoque/stock.service'
import { MonitorService } from '../monitor/monitor.service'
import crypto from 'node:crypto'

export async function ondaSeparacaoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // GET / — lista paginada de ondas
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { page, limit, status, prioridade } = listarOndasSchema.parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (status) where.status = status
    if (prioridade) where.prioridade = prioridade

    const [data, total] = await Promise.all([
      prisma.ondaSeparacao.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { criadoEm: 'desc' },
        include: {
          pedidos: true,
          ordens: {
            include: {
              itens: { select: { id: true, status: true, quantidadeSolicitada: true, quantidadeSeparada: true } },
            },
          },
        },
      }),
      prisma.ondaSeparacao.count({ where }),
    ])

    // Calcular progresso para cada onda
    const dataComProgresso = await Promise.all(data.map(async (onda) => {
      const todosItens = onda.ordens.flatMap((o) => o.itens)
      const totalItens = todosItens.length
      const separados = todosItens.filter((i) => ['SEPARADO', 'SEPARADO_PARCIAL'].includes(i.status)).length
      const pendentes = todosItens.filter((i) => i.status === 'PENDENTE').length
      const divergencias = todosItens.filter((i) => i.status === 'SEPARADO_PARCIAL').length
      const percentual = totalItens > 0 ? Math.round((separados / totalItens) * 100) : 0

      // Enriquecer com dados do pedido (cliente, NF, valor)
      const pedidoIds = onda.pedidos.map((p) => p.pedidoVendaId)
      const pedidosVenda = pedidoIds.length > 0
        ? await prisma.pedidoVenda.findMany({
            where: { id: { in: pedidoIds } },
            select: { id: true, numero: true, valorTotal: true, cliente: { select: { razaoSocial: true, nomeFantasia: true } } },
          })
        : []

      // Buscar NF-e vinculada
      const nfes = pedidoIds.length > 0
        ? await prisma.nfe.findMany({
            where: { vendaEfetivada: { pedidoVendaId: { in: pedidoIds } } },
            select: { numero: true, serie: true },
          })
        : []

      const clienteNome = pedidosVenda[0]?.cliente?.nomeFantasia || pedidosVenda[0]?.cliente?.razaoSocial || '—'
      const nfNumero = nfes.length > 0 ? `NF ${nfes[0].numero}` : '—'
      const valorTotal = pedidosVenda.reduce((s, p) => s + Number(p.valorTotal), 0)

      return {
        ...onda,
        progresso: { totalItens, separados, pendentes, divergencias, percentual },
        totalPedidos: onda.pedidos.length,
        totalFuncionarios: new Set(onda.ordens.filter((o) => o.funcionarioId).map((o) => o.funcionarioId)).size,
        clienteNome,
        nfNumero,
        valorTotal,
        pedidosVenda,
      }
    }))

    return { data: dataComProgresso, total }
  })

  // POST / — criar onda
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = criarOndaSchema.parse(request.body)

    try {
      const onda = await criarOnda(user.empresaId, body.pedidoVendaIds, body.prioridade, body.docaId, user.id)

      // Iniciar onda automaticamente (gera itens de separação + reserva estoque)
      let initResult = null
      try {
        initResult = await iniciarOnda(onda.id, user.empresaId)
      } catch (initErr: any) {
        // Se falhar ao iniciar (ex: sem saldo), retorna a onda criada mas com aviso
        return reply.status(201).send({
          ...onda,
          ordemServico: null,
          aviso: initErr.message || 'Onda criada mas não foi possível iniciar automaticamente',
        })
      }

      // Criar OS de SEPARACAO automaticamente
      let ordemServico = null
      try {
        const osService = new OsAutoCreateService()
        ordemServico = await osService.criarOsSeparacao(user.empresaId, onda.id)
      } catch {
        // Silenciar erros de criação de OS
      }

      return reply.status(201).send({ ...onda, status: 'EM_SEPARACAO', ordemServico, totalItens: initResult?.totalItens || 0 })
    } catch (err: any) {
      if (err.status) return reply.status(err.status).send({ message: err.message })
      throw err
    }
  })

  // GET /:id — detalhe
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const onda = await prisma.ondaSeparacao.findFirst({
      where: { id, empresaId: user.empresaId },
      include: {
        pedidos: true,
        ordens: {
          include: {
            itens: {
              include: {
                itensConferencia: true,
                itensVolume: true,
              },
            },
          },
        },
        conferencias: true,
        volumes: { include: { itens: true } },
      },
    })

    if (!onda) return reply.status(404).send({ message: 'Onda não encontrada' })

    // Enriquecer itens com produto e endereço
    const todosItens = onda.ordens.flatMap((o) => o.itens)
    const produtoIds = [...new Set(todosItens.map((i) => i.produtoId))]
    const enderecoIds = [...new Set(todosItens.map((i) => i.enderecoOrigemId))]

    const [produtos, enderecos] = await Promise.all([
      prisma.produto.findMany({
        where: { id: { in: produtoIds } },
        select: { id: true, codigo: true, nome: true, unidade: true },
      }),
      prisma.endereco.findMany({
        where: { id: { in: enderecoIds } },
        select: { id: true, enderecoCompleto: true },
      }),
    ])

    const produtoMap = new Map(produtos.map((p) => [p.id, p]))
    const enderecoMap = new Map(enderecos.map((e) => [e.id, e]))

    const ordensEnriquecidas = onda.ordens.map((ordem) => ({
      ...ordem,
      itens: ordem.itens.map((item) => ({
        ...item,
        produto: produtoMap.get(item.produtoId) ?? null,
        enderecoOrigem: enderecoMap.get(item.enderecoOrigemId) ?? null,
      })),
    }))

    // Calcular progresso
    const totalItens = todosItens.length
    const separados = todosItens.filter((i) => ['SEPARADO', 'SEPARADO_PARCIAL'].includes(i.status)).length
    const percentual = totalItens > 0 ? Math.round((separados / totalItens) * 100) : 0

    return { ...onda, ordens: ordensEnriquecidas, progresso: { totalItens, separados, percentual } }
  })

  // PATCH /:id/iniciar — iniciar onda
  app.patch('/:id/iniciar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    try {
      const result = await iniciarOnda(id, user.empresaId)

      // Verificar se já existe OS de SEPARACAO para esta onda (criada ao criar a onda)
      // Se não existir (ondas antigas), criar agora
      let ordemServico = await prisma.ordemServicoWms.findFirst({
        where: { ondaSeparacaoId: id, operacao: 'SEPARACAO', status: { not: 'CONCLUIDO' } },
      })

      if (!ordemServico) {
        try {
          const osService = new OsAutoCreateService()
          ordemServico = await osService.criarOsSeparacao(user.empresaId, id)
        } catch {
          // Silenciar erros
        }
      }

      // OS Sync: Set OS to EXECUTANDO com horaInicio
      if (ordemServico && ordemServico.status === 'ABERTO') {
        await prisma.ordemServicoWms.update({
          where: { id: ordemServico.id },
          data: { status: 'EXECUTANDO', horaInicio: new Date() },
        })
      }

      return { ...result, ordemServico }
    } catch (err: any) {
      if (err.status) return reply.status(err.status).send({ message: err.message })
      throw err
    }
  })

  // PATCH /:id/cancelar — cancelar onda
  app.patch('/:id/cancelar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    try {
      await cancelarOnda(id, user.empresaId)
      return { message: 'Onda cancelada' }
    } catch (err: any) {
      if (err.status) return reply.status(err.status).send({ message: err.message })
      throw err
    }
  })

  // PATCH /:id/funcionarios — atribuir funcionários
  app.patch('/:id/funcionarios', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const { funcionarioIds } = atribuirFuncionariosSchema.parse(request.body)

    const onda = await prisma.ondaSeparacao.findFirst({
      where: { id, empresaId: user.empresaId },
      include: { ordens: { include: { itens: true } } },
    })

    if (!onda) return reply.status(404).send({ message: 'Onda não encontrada' })

    // Coletar todos os itens
    const todosItens = onda.ordens.flatMap((o) => o.itens)

    // Distribuir itens round-robin
    const distribuicao = distribuirItensRoundRobin(todosItens, funcionarioIds.length)

    // Deletar ordens antigas e criar novas com funcionários
    await prisma.$transaction(async (tx) => {
      await tx.itemSeparacao.deleteMany({ where: { ordemSeparacao: { ondaSeparacaoId: id } } })
      await tx.ordemSeparacao.deleteMany({ where: { ondaSeparacaoId: id } })

      for (let i = 0; i < funcionarioIds.length; i++) {
        const itensDoFuncionario = distribuicao[i]
        if (itensDoFuncionario.length === 0) continue

        await tx.ordemSeparacao.create({
          data: {
            ondaSeparacaoId: id,
            funcionarioId: funcionarioIds[i],
            status: 'EM_SEPARACAO',
            itens: {
              create: itensDoFuncionario.map((item) => ({
                pedidoVendaId: item.pedidoVendaId,
                produtoId: item.produtoId,
                enderecoOrigemId: item.enderecoOrigemId,
                enderecoDestinoId: item.enderecoDestinoId,
                quantidadeSolicitada: item.quantidadeSolicitada,
              })),
            },
          },
        })
      }
    })

    // Atualizar OS vinculada com o funcionário principal
    try {
      const os = await prisma.ordemServicoWms.findFirst({
        where: { ondaSeparacaoId: id, empresaId: user.empresaId, operacao: 'SEPARACAO', status: { in: ['ABERTO', 'EXECUTANDO'] } },
        orderBy: { criadoEm: 'desc' },
      })
      if (os) {
        await prisma.ordemServicoWms.update({
          where: { id: os.id },
          data: { funcionarioId: funcionarioIds[0] },
        })
        // Vincular todos os funcionários à OS
        for (const funcId of funcionarioIds) {
          const existe = await prisma.osFuncionarioWms.findFirst({
            where: { ordemServicoId: os.id, funcionarioId: funcId },
          })
          if (!existe) {
            await prisma.osFuncionarioWms.create({
              data: { ordemServicoId: os.id, funcionarioId: funcId, horaInicio: new Date() },
            })
          }
        }
      }
    } catch {
      // Non-blocking
    }

    return { message: 'Funcionários atribuídos', totalFuncionarios: funcionarioIds.length }
  })

  // ==========================================================================
  // GET /:id/rota-coleta — Retorna itens ordenados por rota otimizada de coleta
  // ==========================================================================
  app.get('/:id/rota-coleta', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const onda = await prisma.ondaSeparacao.findFirst({
      where: { id, empresaId: user.empresaId },
      include: {
        ordens: {
          include: { itens: true },
        },
      },
    })

    if (!onda) return reply.status(404).send({ message: 'Onda não encontrada' })

    // Flatten all items from all orders
    const todosItens = onda.ordens.flatMap((o) =>
      o.itens.map((i) => ({ ...i, ordemSeparacaoId: o.id, funcionarioId: o.funcionarioId })),
    )

    if (todosItens.length === 0) {
      return { ondaId: id, numero: onda.numero, itens: [] }
    }

    // Collect unique IDs for enrichment
    const produtoIds = [...new Set(todosItens.map((i) => i.produtoId))]
    const enderecoIds = [...new Set(todosItens.map((i) => i.enderecoOrigemId))]

    // Fetch products, addresses, and logistics data in parallel
    const [produtos, enderecos, dadosLogisticos, saldos] = await Promise.all([
      prisma.produto.findMany({
        where: { id: { in: produtoIds } },
        select: { id: true, codigo: true, nome: true, unidade: true, cEAN: true },
      }),
      prisma.endereco.findMany({
        where: { id: { in: enderecoIds } },
        select: {
          id: true,
          enderecoCompleto: true,
          codigoRua: true,
          codigoPredio: true,
          codigoNivel: true,
          codigoApto: true,
        },
      }),
      prisma.dadosLogisticosArmazenagem.findMany({
        where: { produtoId: { in: produtoIds } },
        select: { produtoId: true, tipoNorma: true },
      }),
      prisma.saldoEndereco.findMany({
        where: {
          enderecoId: { in: enderecoIds },
          produtoId: { in: produtoIds },
        },
        select: { enderecoId: true, produtoId: true, quantidade: true, validade: true, lote: true },
      }),
    ])

    const produtoMap = new Map(produtos.map((p) => [p.id, p]))
    const enderecoMap = new Map(enderecos.map((e) => [e.id, e]))
    const logisticaMap = new Map(dadosLogisticos.map((d) => [d.produtoId, d]))

    // Build saldo lookup: enderecoId+produtoId → saldo info
    const saldoMap = new Map(
      saldos.map((s) => [`${s.enderecoId}:${s.produtoId}`, s]),
    )

    // Enrich items with product, address, and logistics data
    const itensEnriquecidos = todosItens.map((item) => {
      const produto = produtoMap.get(item.produtoId)
      const endereco = enderecoMap.get(item.enderecoOrigemId)
      const logistica = logisticaMap.get(item.produtoId)
      const saldo = saldoMap.get(`${item.enderecoOrigemId}:${item.produtoId}`)

      return {
        id: item.id,
        ordemSeparacaoId: item.ordemSeparacaoId,
        funcionarioId: item.funcionarioId,
        produtoId: item.produtoId,
        enderecoOrigemId: item.enderecoOrigemId,
        enderecoDestinoId: item.enderecoDestinoId,
        pedidoVendaId: item.pedidoVendaId,
        quantidadeSolicitada: item.quantidadeSolicitada,
        quantidadeSeparada: item.quantidadeSeparada,
        status: item.status,
        motivoDivergencia: item.motivoDivergencia,
        separadoEm: item.separadoEm,
        produto: produto ?? null,
        enderecoOrigem: endereco ?? null,
        tipoNorma: logistica?.tipoNorma ?? 'FEFO',
        saldo: saldo
          ? {
              quantidade: saldo.quantidade,
              validade: saldo.validade,
              lote: saldo.lote,
            }
          : null,
      }
    })

    // Sort by optimized collection route: rua → prédio → nível
    // Then apply FEFO/FIFO secondary sort based on product logistics
    itensEnriquecidos.sort((a, b) => {
      const endA = a.enderecoOrigem
      const endB = b.enderecoOrigem

      // Primary sort: rua → prédio → nível (ascending)
      const ruaCompare = (endA?.codigoRua ?? '').localeCompare(endB?.codigoRua ?? '')
      if (ruaCompare !== 0) return ruaCompare

      const predioCompare = (endA?.codigoPredio ?? '').localeCompare(endB?.codigoPredio ?? '')
      if (predioCompare !== 0) return predioCompare

      const nivelCompare = (endA?.codigoNivel ?? '').localeCompare(endB?.codigoNivel ?? '')
      if (nivelCompare !== 0) return nivelCompare

      // Secondary sort: FEFO (by validade ascending) or FIFO (by lote ascending)
      if (a.tipoNorma === 'FEFO' || b.tipoNorma === 'FEFO') {
        const validadeA = a.saldo?.validade ? new Date(a.saldo.validade).getTime() : Infinity
        const validadeB = b.saldo?.validade ? new Date(b.saldo.validade).getTime() : Infinity
        return validadeA - validadeB
      }

      // FIFO: sort by lote (older lots first)
      const loteA = a.saldo?.lote ?? ''
      const loteB = b.saldo?.lote ?? ''
      return loteA.localeCompare(loteB)
    })

    return {
      ondaId: id,
      numero: onda.numero,
      totalItens: itensEnriquecidos.length,
      itens: itensEnriquecidos,
    }
  })

  // ==========================================================================
  // POST /:id/gerar-ficha — Gera FichaOperacional de separação
  // ==========================================================================
  app.post('/:id/gerar-ficha', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const onda = await prisma.ondaSeparacao.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!onda) return reply.status(404).send({ message: 'Onda não encontrada' })

    // Generate a unique barcode for the ficha
    const timestamp = Date.now().toString(36).toUpperCase()
    const random = crypto.randomBytes(3).toString('hex').toUpperCase()
    const codigoBarras = `SEPARACAO-${timestamp}-${random}`

    // Create the FichaOperacional record
    const ficha = await prisma.fichaOperacional.create({
      data: {
        empresaId: user.empresaId,
        tipo: 'SEPARACAO',
        referenciaId: id,
        codigoBarras,
        status: 'GERADA',
      },
    })

    // Optionally generate the HTML to validate the onda has items
    const fichaService = new FichaService()
    const ondaComItens = await prisma.ondaSeparacao.findFirst({
      where: { id, empresaId: user.empresaId },
      include: {
        ordens: {
          include: { itens: true },
        },
      },
    })

    if (!ondaComItens) return reply.status(404).send({ message: 'Onda não encontrada' })

    // Enrich items with product and address data
    const todosItens = ondaComItens.ordens.flatMap((o) => o.itens)
    const produtoIds = [...new Set(todosItens.map((i) => i.produtoId))]
    const enderecoIds = [...new Set(todosItens.map((i) => i.enderecoOrigemId))]

    const [produtos, enderecos] = await Promise.all([
      prisma.produto.findMany({
        where: { id: { in: produtoIds } },
        select: { id: true, codigo: true, nome: true, unidade: true },
      }),
      prisma.endereco.findMany({
        where: { id: { in: enderecoIds } },
        select: { id: true, enderecoCompleto: true },
      }),
    ])

    const produtoMap = new Map(produtos.map((p) => [p.id, p]))
    const enderecoMap = new Map(enderecos.map((e) => [e.id, e]))

    const ordensEnriquecidas = ondaComItens.ordens.map((ordem) => ({
      ...ordem,
      itens: ordem.itens.map((item) => ({
        ...item,
        produto: produtoMap.get(item.produtoId) ?? null,
        enderecoOrigem: enderecoMap.get(item.enderecoOrigemId) ?? null,
      })),
    }))

    const ondaEnriquecida = { ...ondaComItens, ordens: ordensEnriquecidas }

    const html = fichaService.gerarHtmlSeparacao(ondaEnriquecida as any)

    return reply.status(201).send({
      ficha,
      htmlDisponivel: !!html,
    })
  })

  // ==========================================================================
  // POST /:id/assumir-os — Operator takes over an OS linked to this onda
  // Task 13.4: Register employee, start time, status EXECUTANDO.
  // ==========================================================================
  app.post('/:id/assumir-os', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const { funcionarioId, ordemServicoId } = z.object({
      funcionarioId: z.string().uuid(),
      ordemServicoId: z.string().uuid().optional(),
    }).parse(request.body)

    // If ordemServicoId is provided, use it directly. Otherwise, find the OS linked to this onda.
    let osId = ordemServicoId
    if (!osId) {
      const os = await prisma.ordemServicoWms.findFirst({
        where: {
          ondaSeparacaoId: id,
          empresaId: user.empresaId,
          status: { in: ['ABERTO', 'EXECUTANDO'] },
        },
        orderBy: { criadoEm: 'desc' },
        select: { id: true },
      })
      if (!os) return reply.status(404).send({ message: 'Nenhuma OS aberta encontrada para esta onda' })
      osId = os.id
    }

    try {
      const result = await assumirOs(osId, funcionarioId)
      return result
    } catch (err: any) {
      if (err.status) return reply.status(err.status).send({ message: err.message })
      throw err
    }
  })

  // ==========================================================================
  // POST /:id/concluir-os — Complete an OS linked to this onda
  // Task 13.4: Register end time and calculate total time in minutes.
  // ==========================================================================
  app.post('/:id/concluir-os', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const { funcionarioId, ordemServicoId } = z.object({
      funcionarioId: z.string().uuid().optional(),
      ordemServicoId: z.string().uuid().optional(),
    }).parse(request.body)

    // If ordemServicoId is provided, use it directly. Otherwise, find the OS linked to this onda.
    let osId = ordemServicoId
    if (!osId) {
      const os = await prisma.ordemServicoWms.findFirst({
        where: {
          ondaSeparacaoId: id,
          empresaId: user.empresaId,
          status: 'EXECUTANDO',
        },
        orderBy: { criadoEm: 'desc' },
        select: { id: true },
      })
      if (!os) return reply.status(404).send({ message: 'Nenhuma OS em execução encontrada para esta onda' })
      osId = os.id
    }

    try {
      const result = await concluirOs(osId, funcionarioId)
      return result
    } catch (err: any) {
      if (err.status) return reply.status(err.status).send({ message: err.message })
      throw err
    }
  })

  // ==========================================================================
  // GET /:id/monitor/separacao — Real-time monitoring for picking
  // ==========================================================================
  app.get('/:id/monitor/separacao', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const onda = await prisma.ondaSeparacao.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!onda) return reply.status(404).send({ message: 'Onda não encontrada' })

    const monitorService = new MonitorService()
    return monitorService.getProgressoSeparacao(id)
  })

  // ==========================================================================
  // GET /:id/monitor/embalagem — Real-time monitoring for packing
  // ==========================================================================
  app.get('/:id/monitor/embalagem', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const onda = await prisma.ondaSeparacao.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!onda) return reply.status(404).send({ message: 'Onda não encontrada' })

    const monitorService = new MonitorService()
    return monitorService.getProgressoEmbalagem(id)
  })

  // ==========================================================================
  // GET /:id/ficha-acompanhamento/separacao — Tracking sheet for picking
  // ==========================================================================
  app.get('/:id/ficha-acompanhamento/separacao', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const onda = await prisma.ondaSeparacao.findFirst({
      where: { id, empresaId: user.empresaId },
      include: {
        ordens: {
          include: {
            itens: true,
          },
        },
      },
    })
    if (!onda) return reply.status(404).send({ message: 'Onda não encontrada' })

    const todosItens = onda.ordens.flatMap((o) => o.itens)
    if (todosItens.length === 0) {
      return reply.status(422).send({ message: 'Onda não possui itens para gerar ficha' })
    }

    // Enrich items with product, address, and SKU barcode
    const produtoIds = [...new Set(todosItens.map((i) => i.produtoId))]
    const enderecoIds = [...new Set(todosItens.map((i) => i.enderecoOrigemId))]

    const [produtos, enderecos, skus] = await Promise.all([
      prisma.produto.findMany({
        where: { id: { in: produtoIds } },
        select: { id: true, codigo: true, nome: true, unidade: true },
      }),
      prisma.endereco.findMany({
        where: { id: { in: enderecoIds } },
        select: { id: true, enderecoCompleto: true, codigoRua: true, codigoPredio: true, codigoNivel: true },
      }),
      prisma.sku.findMany({
        where: { produtoId: { in: produtoIds } },
        select: { produtoId: true, codigoBarra: true },
      }),
    ])

    const produtoMap = new Map(produtos.map((p) => [p.id, p]))
    const enderecoMap = new Map(enderecos.map((e) => [e.id, e]))
    const skuMap = new Map(skus.filter((s) => s.codigoBarra).map((s) => [s.produtoId, s.codigoBarra]))

    // Get funcionario names
    const funcIds = [...new Set(onda.ordens.filter((o) => o.funcionarioId).map((o) => o.funcionarioId!))]
    const funcionarios = funcIds.length > 0
      ? await prisma.funcionario.findMany({ where: { id: { in: funcIds } }, select: { id: true, nome: true } })
      : []
    const funcMap = new Map(funcionarios.map((f) => [f.id, f.nome]))

    const ordensEnriquecidas = onda.ordens.map((ordem) => ({
      ...ordem,
      funcionario: ordem.funcionarioId ? { nome: funcMap.get(ordem.funcionarioId) ?? '—' } : null,
      itens: ordem.itens.map((item) => ({
        ...item,
        produto: produtoMap.get(item.produtoId) ?? null,
        enderecoOrigem: enderecoMap.get(item.enderecoOrigemId) ?? null,
        codigoBarra: skuMap.get(item.produtoId) ?? null,
      })),
    }))

    const ondaEnriquecida = { ...onda, ordens: ordensEnriquecidas }

    const fichaService = new FichaService()
    const html = fichaService.gerarHtmlFichaAcompanhamentoSeparacao(ondaEnriquecida as any)

    reply.header('Content-Type', 'text/html; charset=utf-8')
    return reply.send(html)
  })

  // ==========================================================================
  // GET /:id/ficha-acompanhamento/embalagem — Tracking sheet for packing
  // ==========================================================================
  app.get('/:id/ficha-acompanhamento/embalagem', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const onda = await prisma.ondaSeparacao.findFirst({
      where: { id, empresaId: user.empresaId },
      include: {
        ordens: { include: { itens: true } },
        volumes: {
          include: {
            itens: { include: { itemSeparacao: true } },
          },
        },
      },
    })
    if (!onda) return reply.status(404).send({ message: 'Onda não encontrada' })

    const todosItens = onda.ordens.flatMap((o) => o.itens)
    if (todosItens.length === 0) {
      return reply.status(422).send({ message: 'Onda não possui itens para gerar ficha' })
    }

    // Enrich with product data and SKU barcodes
    const produtoIds = [...new Set(todosItens.map((i) => i.produtoId))]
    const [produtos, skus] = await Promise.all([
      prisma.produto.findMany({
        where: { id: { in: produtoIds } },
        select: { id: true, codigo: true, nome: true, unidade: true },
      }),
      prisma.sku.findMany({
        where: { produtoId: { in: produtoIds } },
        select: { produtoId: true, codigoBarra: true },
      }),
    ])

    const produtoMap = new Map(produtos.map((p) => [p.id, p]))
    const skuMap = new Map(skus.filter((s) => s.codigoBarra).map((s) => [s.produtoId, s.codigoBarra]))

    // Find items not yet assigned to volumes
    const itensEmVolumes = new Set<string>()
    for (const vol of onda.volumes) {
      for (const iv of vol.itens) {
        itensEmVolumes.add(iv.itemSeparacaoId)
      }
    }

    const itensPendentes = todosItens
      .filter((i) => ['SEPARADO', 'SEPARADO_PARCIAL'].includes(i.status) && !itensEmVolumes.has(i.id))
      .map((i) => ({
        ...i,
        produto: produtoMap.get(i.produtoId) ?? null,
        codigoBarra: skuMap.get(i.produtoId) ?? null,
      }))

    // Enrich volumes
    const volumesEnriquecidos = onda.volumes.map((vol) => ({
      ...vol,
      itens: vol.itens.map((iv) => ({
        ...iv,
        itemSeparacao: iv.itemSeparacao
          ? {
              ...iv.itemSeparacao,
              produto: produtoMap.get(iv.itemSeparacao.produtoId) ?? null,
              codigoBarra: skuMap.get(iv.itemSeparacao.produtoId) ?? null,
            }
          : null,
      })),
    }))

    const ondaEnriquecida = { ...onda, volumes: volumesEnriquecidos, itensPendentes }

    const fichaService = new FichaService()
    const html = fichaService.gerarHtmlFichaAcompanhamentoEmbalagem(ondaEnriquecida as any)

    reply.header('Content-Type', 'text/html; charset=utf-8')
    return reply.send(html)
  })
}
