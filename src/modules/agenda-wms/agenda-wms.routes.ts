import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const idParamsSchema = z.object({ id: z.string().uuid() })

const listQuerySchema = z.object({
  status: z.string().optional(),
  data: z.string().optional(), // YYYY-MM-DD — filtra por dia específico
  dataInicio: z.string().optional(),
  dataFim: z.string().optional(),
  docaId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
})

const criarAgendaSchema = z.object({
  fornecedorId: z.string().uuid().optional(),
  fornecedorCnpj: z.string().optional(),
  pedidoCompraId: z.string().uuid().optional(),
  docaId: z.string().uuid(),
  dataPrevista: z.string(), // YYYY-MM-DD
  horaInicio: z.string().regex(/^\d{2}:\d{2}$/, 'Formato HH:MM').optional(),
  horaFim: z.string().regex(/^\d{2}:\d{2}$/, 'Formato HH:MM').optional(),
  autoAgendar: z.boolean().optional(),
  motorista: z.string().optional(),
  placa: z.string().optional(),
  tipoVeiculo: z.string().optional(),
  qtdCaixas: z.number().int().optional(),
  qtdPaletes: z.number().int().optional(),
  observacao: z.string().optional(),
})

const statusSchema = z.object({
  status: z.enum(['AGENDADO', 'CONFIRMADO', 'ESPERA', 'NA_DOCA', 'CONFERINDO', 'CONFERIDO', 'RECEBIDO', 'CANCELADO']),
})

export async function agendaWmsRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // GET / — lista agendamentos com filtros
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { status, data, dataInicio, dataFim, docaId, page, limit } = listQuerySchema.parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (status) where.status = status
    if (docaId) where.docaId = docaId

    // Filtro por dia específico — mas SEMPRE inclui agendamentos em andamento (NA_DOCA, CONFERINDO)
    if (data) {
      const dia = new Date(data)
      const diaFim = new Date(data)
      diaFim.setDate(diaFim.getDate() + 1)
      where.OR = [
        { dataPrevista: { gte: dia, lt: diaFim } },
        { status: { in: ['NA_DOCA', 'CONFERINDO'] } },
      ]
    } else if (dataInicio || dataFim) {
      where.OR = [
        {
          dataPrevista: {
            ...(dataInicio ? { gte: new Date(dataInicio) } : {}),
            ...(dataFim ? { lte: new Date(dataFim) } : {}),
          },
        },
        { status: { in: ['NA_DOCA', 'CONFERINDO'] } },
      ]
    }

    const [data_result, total] = await Promise.all([
      prisma.agendaWms.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ dataPrevista: 'asc' }, { horaInicio: 'asc' }],
      }),
      prisma.agendaWms.count({ where }),
    ])

    // Enriquecer com dados do pedido e fornecedor
    const enriched = await Promise.all(data_result.map(async (ag) => {
      let pedido = null
      let fornecedor = null
      let doca = null
      let notaEntrada = null
      if (ag.pedidoCompraId) {
        pedido = await prisma.pedidoCompra.findUnique({
          where: { id: ag.pedidoCompraId },
          select: { numero: true, valorTotal: true, itens: { include: { produto: { select: { nome: true, codigo: true } } } } },
        })
        // Buscar compra efetivada para extrair NF do XML
        const compra = await prisma.compraEfetivada.findFirst({
          where: { pedidoCompraId: ag.pedidoCompraId },
          select: { xmlNfe: true },
        })
        if (compra?.xmlNfe) {
          const matchNNF = compra.xmlNfe.match(/<nNF>(\d+)<\/nNF>/)
          const matchSerie = compra.xmlNfe.match(/<serie>(\d+)<\/serie>/)
          notaEntrada = {
            numero: matchNNF ? matchNNF[1] : null,
            serie: matchSerie ? matchSerie[1] : null,
          }
        }
      }
      // Se não achou NF pelo XML, buscar nota de entrada pelo fornecedor
      if (!notaEntrada && ag.fornecedorId) {
        const forn = await prisma.fornecedor.findUnique({ where: { id: ag.fornecedorId }, select: { cnpj: true } })
        if (forn) {
          const nota = await prisma.notaEntrada.findFirst({
            where: { fornecedorDoc: forn.cnpj },
            orderBy: { criadoEm: 'desc' },
            select: { numero: true, serie: true },
          })
          if (nota) notaEntrada = { numero: String(nota.numero), serie: nota.serie }
        }
      }
      // Fallback: se ainda não achou NF e tem pedido de compra, usar número do pedido como referência
      if (!notaEntrada && pedido) {
        notaEntrada = { numero: String(pedido.numero), serie: null }
      }
      // Fallback 2: se não tem pedidoCompraId mas tem fornecedorId, buscar compra efetivada mais recente do fornecedor
      if (!notaEntrada && !ag.pedidoCompraId && ag.fornecedorId) {
        const compraRecente = await prisma.compraEfetivada.findFirst({
          where: {
            pedidoCompra: { fornecedorId: ag.fornecedorId },
            xmlNfe: { not: null },
          },
          orderBy: { criadoEm: 'desc' },
          select: { xmlNfe: true, pedidoCompra: { select: { numero: true } } },
        })
        if (compraRecente?.xmlNfe) {
          const matchNNF = compraRecente.xmlNfe.match(/<nNF>(\d+)<\/nNF>/)
          const matchSerie = compraRecente.xmlNfe.match(/<serie>(\d+)<\/serie>/)
          if (matchNNF) {
            notaEntrada = {
              numero: matchNNF[1],
              serie: matchSerie ? matchSerie[1] : null,
            }
          }
        }
        if (!notaEntrada && compraRecente?.pedidoCompra) {
          notaEntrada = { numero: String(compraRecente.pedidoCompra.numero), serie: null }
        }
      }
      if (ag.fornecedorId) {
        fornecedor = await prisma.fornecedor.findUnique({
          where: { id: ag.fornecedorId },
          select: { razaoSocial: true, nomeFantasia: true, cnpj: true },
        })
      }
      if (ag.docaId) {
        doca = await prisma.doca.findUnique({
          where: { id: ag.docaId },
          select: { descricao: true, tipo: true },
        })
      }
      return { ...ag, pedido, fornecedor, doca, notaEntrada }
    }))

    return { data: enriched, total }
  })

  // GET /docas — lista docas disponíveis para o calendário
  app.get('/docas', async () => {
    const docas = await prisma.doca.findMany({
      where: { status: true },
      orderBy: { descricao: 'asc' },
    })
    return docas
  })

  // GET /grade/:data — retorna grade visual de horários por doca para um dia
  // Slots de 30 minutos, das 06:00 às 22:00
  app.get('/grade/:data', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { data } = z.object({ data: z.string() }).parse(request.params) // YYYY-MM-DD

    const dia = new Date(data + 'T00:00:00.000Z')
    const diaFim = new Date(data + 'T00:00:00.000Z')
    diaFim.setUTCDate(diaFim.getUTCDate() + 1)

    // Buscar docas ativas
    const docas = await prisma.doca.findMany({
      where: { status: true },
      orderBy: { descricao: 'asc' },
    })

    // Buscar agendamentos do dia
    const agendamentos = await prisma.agendaWms.findMany({
      where: {
        empresaId: user.empresaId,
        dataPrevista: { gte: dia, lt: diaFim },
        status: { notIn: ['CANCELADO'] },
      },
    })

    // Enriquecer agendamentos
    const agendamentosEnriched = await Promise.all(agendamentos.map(async (ag) => {
      let fornecedor = null
      if (ag.fornecedorId) {
        fornecedor = await prisma.fornecedor.findUnique({
          where: { id: ag.fornecedorId },
          select: { razaoSocial: true, nomeFantasia: true },
        })
      }
      return { ...ag, fornecedor }
    }))

    // Gerar slots de 30 minutos (06:00 a 22:00 = 32 slots)
    const slots: string[] = []
    for (let h = 6; h < 22; h++) {
      slots.push(`${String(h).padStart(2, '0')}:00`)
      slots.push(`${String(h).padStart(2, '0')}:30`)
    }

    // Montar grade: para cada doca, marcar quais slots estão ocupados
    const grade = docas.map((doca) => {
      const docaAgendamentos = agendamentosEnriched.filter((ag) => ag.docaId === doca.id)

      const slotsStatus = slots.map((slot) => {
        const slotHora = slot
        const slotFim = slots[slots.indexOf(slot) + 1] || '22:00'

        // Verificar se algum agendamento ocupa este slot
        const ocupante = docaAgendamentos.find((ag) => {
          if (!ag.horaInicio || !ag.horaFim) return false
          return ag.horaInicio < slotFim && ag.horaFim > slotHora
        })

        return {
          horario: slot,
          ocupado: !!ocupante,
          agendamentoId: ocupante?.id || null,
          status: ocupante?.status || null,
          fornecedor: ocupante?.fornecedor?.nomeFantasia || ocupante?.fornecedor?.razaoSocial || null,
          motorista: ocupante?.motorista || null,
          placa: ocupante?.placa || null,
        }
      })

      return {
        docaId: doca.id,
        descricao: doca.descricao,
        tipo: doca.tipo,
        slots: slotsStatus,
      }
    })

    return { data: data, slots, grade, totalDocas: docas.length }
  })

  // GET /disponibilidade — verifica disponibilidade de uma doca em um horário
  app.get('/disponibilidade', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { docaId, data, horaInicio, horaFim } = z.object({
      docaId: z.string().uuid(),
      data: z.string(),
      horaInicio: z.string(),
      horaFim: z.string(),
    }).parse(request.query)

    const dia = new Date(data)
    const diaFim = new Date(data)
    diaFim.setDate(diaFim.getDate() + 1)

    // Buscar agendamentos da doca no dia que conflitam com o horário
    const conflitos = await prisma.agendaWms.findMany({
      where: {
        empresaId: user.empresaId,
        docaId,
        dataPrevista: { gte: dia, lt: diaFim },
        status: { notIn: ['CANCELADO', 'RECEBIDO'] },
        OR: [
          { horaInicio: { lte: horaFim }, horaFim: { gte: horaInicio } },
        ],
      },
    })

    return {
      disponivel: conflitos.length === 0,
      conflitos: conflitos.length,
      agendamentos: conflitos.map((c) => ({
        id: c.id,
        horaInicio: c.horaInicio,
        horaFim: c.horaFim,
        status: c.status,
      })),
    }
  })

  // POST / — criar agendamento manual
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = criarAgendaSchema.parse(request.body)

    // Se autoAgendar e sem horários, encontrar próximo slot disponível de 1h
    let horaInicio = body.horaInicio
    let horaFim = body.horaFim

    if (body.autoAgendar && !horaInicio && !horaFim) {
      const dia = new Date(body.dataPrevista)
      const diaFimRange = new Date(body.dataPrevista)
      diaFimRange.setDate(diaFimRange.getDate() + 1)

      // Buscar agendamentos existentes na doca para o dia
      const agendamentosExistentes = await prisma.agendaWms.findMany({
        where: {
          empresaId: user.empresaId,
          docaId: body.docaId,
          dataPrevista: { gte: dia, lt: diaFimRange },
          status: { notIn: ['CANCELADO', 'RECEBIDO'] },
        },
        select: { horaInicio: true, horaFim: true },
      })

      // Procurar slot livre de 1h entre 06:00 e 22:00
      let slotEncontrado = false
      for (let h = 6; h < 22; h++) {
        const candidatoInicio = `${String(h).padStart(2, '0')}:00`
        const candidatoFim = `${String(h + 1).padStart(2, '0')}:00`

        const temConflito = agendamentosExistentes.some((ag) => {
          if (!ag.horaInicio || !ag.horaFim) return false
          return ag.horaInicio < candidatoFim && ag.horaFim > candidatoInicio
        })

        if (!temConflito) {
          horaInicio = candidatoInicio
          horaFim = candidatoFim
          slotEncontrado = true
          break
        }
      }

      if (!slotEncontrado) {
        return reply.status(422).send({
          message: 'Nenhum horário disponível nesta doca para a data selecionada (06:00-22:00)',
        })
      }
    }

    // Validar que horaInicio e horaFim estão presentes
    if (!horaInicio || !horaFim) {
      return reply.status(400).send({
        message: 'horaInicio e horaFim são obrigatórios (ou use autoAgendar: true)',
      })
    }

    // Validar que não está agendando no passado (mesmo dia, horário já passou)
    const agora = new Date()
    const dataPrevista = new Date(body.dataPrevista)
    const hojeStr = agora.toISOString().split('T')[0]
    const dataStr = body.dataPrevista.split('T')[0] || body.dataPrevista

    if (dataStr === hojeStr) {
      // Mesmo dia — verificar se o horário já passou
      const horaAtual = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`
      if (horaInicio < horaAtual) {
        return reply.status(422).send({
          message: `Não é possível agendar para um horário que já passou (${horaInicio}). Horário atual: ${horaAtual}`,
        })
      }
    } else if (dataPrevista < new Date(hojeStr)) {
      // Data no passado
      return reply.status(422).send({
        message: 'Não é possível agendar para uma data que já passou',
      })
    }

    // Validar disponibilidade
    const dia = new Date(body.dataPrevista)
    const diaFim = new Date(body.dataPrevista)
    diaFim.setDate(diaFim.getDate() + 1)

    const conflitos = await prisma.agendaWms.findMany({
      where: {
        empresaId: user.empresaId,
        docaId: body.docaId,
        dataPrevista: { gte: dia, lt: diaFim },
        status: { notIn: ['CANCELADO', 'RECEBIDO'] },
        horaInicio: { lt: horaFim },
        horaFim: { gt: horaInicio },
      },
    })

    if (conflitos.length > 0) {
      return reply.status(422).send({
        message: `Doca ocupada neste horário. Conflito com ${conflitos.length} agendamento(s): ${conflitos.map((c) => `${c.horaInicio}-${c.horaFim}`).join(', ')}`,
      })
    }

    // Resolver fornecedorId pelo CNPJ se não informado diretamente
    let resolvedFornecedorId = body.fornecedorId || null
    if (!resolvedFornecedorId && body.fornecedorCnpj) {
      const forn = await prisma.fornecedor.findFirst({
        where: { empresaId: user.empresaId, cnpj: body.fornecedorCnpj },
        select: { id: true },
      })
      if (forn) resolvedFornecedorId = forn.id
    }

    const agenda = await prisma.agendaWms.create({
      data: {
        empresaId: user.empresaId,
        fornecedorId: resolvedFornecedorId,
        pedidoCompraId: body.pedidoCompraId,
        docaId: body.docaId,
        dataPrevista: dia,
        horaInicio,
        horaFim,
        motorista: body.motorista,
        placa: body.placa,
        tipoVeiculo: body.tipoVeiculo,
        qtdCaixas: body.qtdCaixas,
        qtdPaletes: body.qtdPaletes,
        observacao: body.observacao,
      },
    })

    return reply.status(201).send(agenda)
  })

  // GET /:id — detalhe
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const ag = await prisma.agendaWms.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!ag) return reply.status(404).send({ message: 'Agendamento não encontrado' })

    let pedido = null, fornecedor = null, doca = null
    if (ag.pedidoCompraId) pedido = await prisma.pedidoCompra.findUnique({ where: { id: ag.pedidoCompraId }, include: { itens: { include: { produto: { select: { nome: true, codigo: true } } } } } })
    if (ag.fornecedorId) fornecedor = await prisma.fornecedor.findUnique({ where: { id: ag.fornecedorId } })
    if (ag.docaId) doca = await prisma.doca.findUnique({ where: { id: ag.docaId } })

    return { ...ag, pedido, fornecedor, doca }
  })

  // PATCH /:id — editar dados do agendamento (motorista, placa, caixas, paletes, etc.)
  app.patch('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const editSchema = z.object({
      motorista: z.string().optional(),
      placa: z.string().optional(),
      tipoVeiculo: z.string().optional(),
      qtdCaixas: z.number().int().nullable().optional(),
      qtdPaletes: z.number().int().nullable().optional(),
      observacao: z.string().optional(),
      horaInicio: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      horaFim: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      docaId: z.string().uuid().optional(),
      fornecedorId: z.string().uuid().nullable().optional(),
    })

    const body = editSchema.parse(request.body)

    const ag = await prisma.agendaWms.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!ag) return reply.status(404).send({ message: 'Agendamento não encontrado' })
    if (ag.status === 'RECEBIDO' || ag.status === 'CANCELADO') {
      return reply.status(422).send({ message: `Não é possível editar agendamento com status ${ag.status}` })
    }

    // Se mudou doca ou horário, validar disponibilidade
    const novaDocaId = body.docaId || ag.docaId
    const novaHoraInicio = body.horaInicio || ag.horaInicio
    const novaHoraFim = body.horaFim || ag.horaFim

    if (novaDocaId && novaHoraInicio && novaHoraFim && (body.docaId || body.horaInicio || body.horaFim)) {
      const dia = new Date(ag.dataPrevista)
      const diaFim = new Date(ag.dataPrevista)
      diaFim.setDate(diaFim.getDate() + 1)

      const conflitos = await prisma.agendaWms.findMany({
        where: {
          id: { not: id },
          empresaId: user.empresaId,
          docaId: novaDocaId,
          dataPrevista: { gte: dia, lt: diaFim },
          status: { notIn: ['CANCELADO', 'RECEBIDO'] },
          horaInicio: { lt: novaHoraFim },
          horaFim: { gt: novaHoraInicio },
        },
      })

      if (conflitos.length > 0) {
        return reply.status(422).send({ message: `Doca ocupada neste horário` })
      }
    }

    const atualizado = await prisma.agendaWms.update({
      where: { id },
      data: {
        ...(body.motorista !== undefined && { motorista: body.motorista || null }),
        ...(body.placa !== undefined && { placa: body.placa || null }),
        ...(body.tipoVeiculo !== undefined && { tipoVeiculo: body.tipoVeiculo || null }),
        ...(body.qtdCaixas !== undefined && { qtdCaixas: body.qtdCaixas }),
        ...(body.qtdPaletes !== undefined && { qtdPaletes: body.qtdPaletes }),
        ...(body.observacao !== undefined && { observacao: body.observacao || null }),
        ...(body.horaInicio && { horaInicio: body.horaInicio }),
        ...(body.horaFim && { horaFim: body.horaFim }),
        ...(body.docaId && { docaId: body.docaId }),
        ...(body.fornecedorId !== undefined && { fornecedorId: body.fornecedorId }),
      },
    })

    return atualizado
  })

  // PATCH /:id/status — alterar status
  app.patch('/:id/status', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const { status } = statusSchema.parse(request.body)

    const ag = await prisma.agendaWms.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!ag) return reply.status(404).send({ message: 'Agendamento não encontrado' })

    const result = await prisma.$transaction(async (tx) => {
      const atualizado = await tx.agendaWms.update({ where: { id }, data: { status } })

      // Helper: buscar CNPJ do fornecedor
      let fornecedorDoc = ''
      if (ag.fornecedorId) {
        const forn = await tx.fornecedor.findUnique({ where: { id: ag.fornecedorId }, select: { cnpj: true, razaoSocial: true } })
        if (forn) fornecedorDoc = forn.cnpj
      }

      // Helper: buscar XML da compra efetivada (por pedidoCompraId ou fornecedorId)
      const buscarXmlCompra = async (): Promise<string | null> => {
        if (ag.pedidoCompraId) {
          const compra = await tx.compraEfetivada.findFirst({
            where: { pedidoCompraId: ag.pedidoCompraId },
            select: { xmlNfe: true },
          })
          if (compra?.xmlNfe) return compra.xmlNfe
        }
        if (ag.fornecedorId) {
          const compra = await tx.compraEfetivada.findFirst({
            where: {
              pedidoCompra: { fornecedorId: ag.fornecedorId },
              xmlNfe: { not: null },
            },
            orderBy: { criadoEm: 'desc' },
            select: { xmlNfe: true },
          })
          if (compra?.xmlNfe) return compra.xmlNfe
        }
        return null
      }

      // ── NA_DOCA: criar nota de entrada automaticamente se não existir ──
      if (status === 'NA_DOCA') {
        // Verificar se já existe nota pendente para este fornecedor
        const notaExistente = await tx.notaEntrada.findFirst({
          where: { fornecedorDoc, status: { in: ['PENDENTE', 'EM_CONFERENCIA'] } },
          orderBy: { criadoEm: 'desc' },
        })

        if (!notaExistente) {
          const compraXml = await buscarXmlCompra()
          if (compraXml) {
            const matchNNF = compraXml.match(/<nNF>(\d+)<\/nNF>/)
            const matchSerie = compraXml.match(/<serie>(\d+)<\/serie>/)
            const matchEmit = compraXml.match(/<emit>[\s\S]*?<xNome>([^<]*)<\/xNome>/)
            const matchCNPJ = compraXml.match(/<emit>[\s\S]*?<CNPJ>([^<]*)<\/CNPJ>/)

            const detMatches = compraXml.match(/<det\s[^>]*>[\s\S]*?<\/det>/g) || []
            const itensXml = detMatches.map((det, idx) => {
              const prod = det.match(/<prod>([\s\S]*?)<\/prod>/)?.[1] || ''
              const cProd = prod.match(/<cProd>([^<]*)<\/cProd>/)?.[1] || ''
              const xProd = prod.match(/<xProd>([^<]*)<\/xProd>/)?.[1] || ''
              const uCom = prod.match(/<uCom>([^<]*)<\/uCom>/)?.[1] || 'UN'
              const qCom = parseFloat(prod.match(/<qCom>([^<]*)<\/qCom>/)?.[1] || '0')
              return { item: idx + 1, descricao: xProd, codigoProduto: cProd, unidade: uCom, quantidade: qCom }
            })

            if (itensXml.length > 0) {
              await tx.notaEntrada.create({
                data: {
                  numero: matchNNF ? parseInt(matchNNF[1]) : 0,
                  serie: matchSerie ? matchSerie[1] : null,
                  fornecedor: matchEmit ? matchEmit[1] : null,
                  fornecedorDoc: matchCNPJ ? matchCNPJ[1] : fornecedorDoc,
                  dataEntrada: new Date(),
                  status: 'PENDENTE',
                  itens: { create: itensXml },
                },
              })
            }
          }
        }
      }

      // ── CONFERINDO: criar nota se não existir + mudar para EM_CONFERENCIA + atualizar OS ──
      if (status === 'CONFERINDO') {
        // Primeiro, garantir que a nota existe (caso NA_DOCA tenha sido pulado)
        let nota = await tx.notaEntrada.findFirst({
          where: { fornecedorDoc, status: { in: ['PENDENTE', 'EM_CONFERENCIA'] } },
          orderBy: { criadoEm: 'desc' },
        })

        // Se não existe, criar a partir do XML da compra
        if (!nota) {
          const compraXml = await buscarXmlCompra()
          if (compraXml) {
            const matchNNF = compraXml.match(/<nNF>(\d+)<\/nNF>/)
            const matchSerie = compraXml.match(/<serie>(\d+)<\/serie>/)
            const matchEmit = compraXml.match(/<emit>[\s\S]*?<xNome>([^<]*)<\/xNome>/)
            const matchCNPJ = compraXml.match(/<emit>[\s\S]*?<CNPJ>([^<]*)<\/CNPJ>/)

            const detMatches = compraXml.match(/<det\s[^>]*>[\s\S]*?<\/det>/g) || []
            const itensXml = detMatches.map((det, idx) => {
              const prod = det.match(/<prod>([\s\S]*?)<\/prod>/)?.[1] || ''
              const cProd = prod.match(/<cProd>([^<]*)<\/cProd>/)?.[1] || ''
              const xProd = prod.match(/<xProd>([^<]*)<\/xProd>/)?.[1] || ''
              const uCom = prod.match(/<uCom>([^<]*)<\/uCom>/)?.[1] || 'UN'
              const qCom = parseFloat(prod.match(/<qCom>([^<]*)<\/qCom>/)?.[1] || '0')
              return { item: idx + 1, descricao: xProd, codigoProduto: cProd, unidade: uCom, quantidade: qCom }
            })

            if (itensXml.length > 0) {
              nota = await tx.notaEntrada.create({
                data: {
                  numero: matchNNF ? parseInt(matchNNF[1]) : 0,
                  serie: matchSerie ? matchSerie[1] : null,
                  fornecedor: matchEmit ? matchEmit[1] : null,
                  fornecedorDoc: matchCNPJ ? matchCNPJ[1] : fornecedorDoc,
                  dataEntrada: new Date(),
                  status: 'PENDENTE',
                  itens: { create: itensXml },
                },
              })
            }
          }
        }

        // Mudar nota para EM_CONFERENCIA
        if (nota && nota.status === 'PENDENTE') {
          await tx.notaEntrada.update({
            where: { id: nota.id },
            data: { status: 'EM_CONFERENCIA' },
          })
        }

        // Atualizar ou criar OS de conferência
        if (nota) {
          const osConferencia = await tx.ordemServicoWms.findFirst({
            where: { agendaWmsId: ag.id, operacao: 'CONFERENCIA', status: { in: ['ABERTO', 'EXECUTANDO'] } },
          })
          if (osConferencia) {
            await tx.ordemServicoWms.update({
              where: { id: osConferencia.id },
              data: { notaEntradaId: nota.id, status: 'EXECUTANDO', horaInicio: osConferencia.horaInicio || new Date() },
            })
          } else {
            // Criar OS se não existe
            const ultimaOs = await tx.ordemServicoWms.findFirst({
              where: { empresaId: user.empresaId },
              orderBy: { numero: 'desc' },
              select: { numero: true },
            })
            await tx.ordemServicoWms.create({
              data: {
                empresaId: user.empresaId,
                numero: (ultimaOs?.numero ?? 0) + 1,
                tipo: 'ENTRADA',
                operacao: 'CONFERENCIA',
                status: 'EXECUTANDO',
                notaEntradaId: nota.id,
                agendaWmsId: ag.id,
                horaInicio: new Date(),
              },
            })
          }
        }
      }

      // Se RECEBIDO, atualizar pedido de compra
      if (status === 'RECEBIDO' && ag.pedidoCompraId) {
        await tx.pedidoCompra.update({ where: { id: ag.pedidoCompraId }, data: { status: 'RECEBIDO' } })
      }

      return atualizado
    })

    return result
  })

  // PATCH /:id/concluir — atalho para marcar como RECEBIDO
  app.patch('/:id/concluir', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const ag = await prisma.agendaWms.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!ag) return reply.status(404).send({ message: 'Agendamento não encontrado' })
    if (ag.status === 'RECEBIDO') return reply.status(422).send({ message: 'Já concluído' })

    await prisma.$transaction(async (tx) => {
      await tx.agendaWms.update({ where: { id }, data: { status: 'RECEBIDO' } })
      if (ag.pedidoCompraId) {
        await tx.pedidoCompra.update({ where: { id: ag.pedidoCompraId }, data: { status: 'RECEBIDO' } })
      }
    })

    return { message: 'Recebimento concluído' }
  })
}
