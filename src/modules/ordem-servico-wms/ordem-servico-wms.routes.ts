import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

export async function ordemServicoWmsRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // GET / — lista OS operacionais
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const q = z.object({
      page: z.coerce.number().default(1),
      limit: z.coerce.number().default(20),
      status: z.string().optional(),
      operacao: z.string().optional(),
      tipo: z.string().optional(),
    }).parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (q.status) where.status = q.status
    if (q.operacao) where.operacao = q.operacao
    if (q.tipo) where.tipo = q.tipo

    const [data, total] = await Promise.all([
      prisma.ordemServicoWms.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { numero: 'desc' },
      }),
      prisma.ordemServicoWms.count({ where }),
    ])

    // Enriquecer com funcionários e nota fiscal
    const enriched = await Promise.all(data.map(async (os) => {
      let funcionario = null
      if (os.funcionarioId) {
        funcionario = await prisma.funcionario.findUnique({
          where: { id: os.funcionarioId },
          select: { nome: true, matricula: true },
        })
      }
      // Buscar nota fiscal vinculada
      let notaEntrada = null
      if (os.notaEntradaId) {
        notaEntrada = await prisma.notaEntrada.findUnique({
          where: { id: os.notaEntradaId },
          select: { numero: true, fornecedor: true, fornecedorDoc: true, status: true },
        })
      }
      // Fallback: buscar NF pela agenda vinculada → pedido de compra → compra efetivada (XML)
      if (!notaEntrada && os.agendaWmsId) {
        const agenda = await prisma.agendaWms.findUnique({
          where: { id: os.agendaWmsId },
          select: { pedidoCompraId: true, fornecedorId: true },
        })
        let compraXml: string | null = null
        if (agenda?.pedidoCompraId) {
          const compra = await prisma.compraEfetivada.findFirst({
            where: { pedidoCompraId: agenda.pedidoCompraId },
            select: { xmlNfe: true },
          })
          compraXml = compra?.xmlNfe ?? null
        }
        // Fallback: buscar compra mais recente do fornecedor
        if (!compraXml && agenda?.fornecedorId) {
          const compra = await prisma.compraEfetivada.findFirst({
            where: {
              pedidoCompra: { fornecedorId: agenda.fornecedorId },
              xmlNfe: { not: null },
            },
            orderBy: { criadoEm: 'desc' },
            select: { xmlNfe: true },
          })
          compraXml = compra?.xmlNfe ?? null
        }
        if (compraXml) {
          const matchNNF = compraXml.match(/<nNF>(\d+)<\/nNF>/)
          const matchSerie = compraXml.match(/<serie>(\d+)<\/serie>/)
          if (matchNNF) {
            notaEntrada = {
              numero: Number(matchNNF[1]),
              fornecedor: null,
              fornecedorDoc: null,
              status: null,
              serie: matchSerie ? matchSerie[1] : null,
            }
          }
        }
      }
      // Buscar todos os funcionários vinculados
      const funcionariosVinculados = await prisma.osFuncionarioWms.findMany({
        where: { ordemServicoId: os.id },
      })
      const funcsEnriched = await Promise.all(funcionariosVinculados.map(async (f) => {
        const func = await prisma.funcionario.findUnique({
          where: { id: f.funcionarioId },
          select: { nome: true, matricula: true },
        })
        return { ...f, funcionario: func }
      }))
      return { ...os, funcionario, notaEntrada, funcionarios: funcsEnriched }
    }))

    return { data: enriched, total, page: q.page, limit: q.limit }
  })

  // GET /:id — detalhe
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const os = await prisma.ordemServicoWms.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!os) return reply.status(404).send({ message: 'OS não encontrada' })

    let funcionario = null
    if (os.funcionarioId) {
      funcionario = await prisma.funcionario.findUnique({
        where: { id: os.funcionarioId },
        select: { nome: true, matricula: true },
      })
    }

    return { ...os, funcionario }
  })

  // PATCH /:id/iniciar — funcionários iniciam a OS (marca hora início)
  app.patch('/:id/iniciar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      funcionarioIds: z.array(z.string().uuid()).min(1),
    }).parse(request.body)

    const os = await prisma.ordemServicoWms.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!os) return reply.status(404).send({ message: 'OS não encontrada' })

    if (!['ABERTO', 'EXECUTANDO'].includes(os.status)) {
      return reply.status(422).send({ message: `OS não pode receber funcionários. Status: ${os.status}` })
    }

    const agora = new Date()

    await prisma.$transaction(async (tx) => {
      // Adicionar funcionários
      for (const funcId of body.funcionarioIds) {
        // Verificar se já está vinculado
        const existe = await tx.osFuncionarioWms.findFirst({
          where: { ordemServicoId: id, funcionarioId: funcId },
        })
        if (!existe) {
          await tx.osFuncionarioWms.create({
            data: { ordemServicoId: id, funcionarioId: funcId, horaInicio: agora },
          })
        }
      }

      // Atualizar OS
      await tx.ordemServicoWms.update({
        where: { id },
        data: {
          status: 'EXECUTANDO',
          funcionarioId: body.funcionarioIds[0], // principal
          horaInicio: os.horaInicio || agora,
        },
      })
    })

    return { message: `OS iniciada com ${body.funcionarioIds.length} funcionário(s)` }
  })

  // PATCH /:id/concluir — funcionário conclui a OS (marca hora fim)
  app.patch('/:id/concluir', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const os = await prisma.ordemServicoWms.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!os) return reply.status(404).send({ message: 'OS não encontrada' })

    if (os.status !== 'EXECUTANDO') {
      return reply.status(422).send({ message: `OS não está em execução. Status: ${os.status}` })
    }

    const atualizado = await prisma.ordemServicoWms.update({
      where: { id },
      data: { status: 'CONCLUIDO', horaFim: new Date() },
    })

    // Calcular tempo de execução
    const tempoMs = os.horaInicio ? new Date().getTime() - new Date(os.horaInicio).getTime() : 0
    const tempoMin = Math.round(tempoMs / 60000)

    return { message: 'OS concluída', os: atualizado, tempoExecucaoMinutos: tempoMin }
  })

  // ==========================================================================
  // PATCH /:id/trocar-funcionario — Troca funcionário ativo, mantendo histórico
  // Finaliza o funcionário atual (horaFim) e adiciona o novo (horaInicio)
  // ==========================================================================
  app.patch('/:id/trocar-funcionario', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      novoFuncionarioId: z.string().uuid(),
    }).parse(request.body)

    const os = await prisma.ordemServicoWms.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!os) return reply.status(404).send({ message: 'OS não encontrada' })

    if (!['ABERTO', 'EXECUTANDO'].includes(os.status)) {
      return reply.status(422).send({ message: `OS não pode trocar funcionário. Status: ${os.status}` })
    }

    const agora = new Date()

    await prisma.$transaction(async (tx) => {
      // Finalizar funcionários ativos (sem horaFim)
      const ativos = await tx.osFuncionarioWms.findMany({
        where: { ordemServicoId: id, horaFim: null },
      })
      for (const ativo of ativos) {
        await tx.osFuncionarioWms.update({
          where: { id: ativo.id },
          data: { horaFim: agora },
        })
      }

      // Adicionar novo funcionário
      await tx.osFuncionarioWms.create({
        data: { ordemServicoId: id, funcionarioId: body.novoFuncionarioId, horaInicio: agora },
      })

      // Atualizar funcionário principal na OS
      await tx.ordemServicoWms.update({
        where: { id },
        data: { funcionarioId: body.novoFuncionarioId, status: 'EXECUTANDO' },
      })
    })

    // Buscar nome do novo funcionário
    const func = await prisma.funcionario.findUnique({
      where: { id: body.novoFuncionarioId },
      select: { nome: true },
    })

    return { message: `Funcionário trocado para ${func?.nome || 'novo funcionário'}` }
  })

  // ==========================================================================
  // GET /:id/historico-funcionarios — Histórico de funcionários da OS
  // ==========================================================================
  app.get('/:id/historico-funcionarios', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const os = await prisma.ordemServicoWms.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!os) return reply.status(404).send({ message: 'OS não encontrada' })

    const registros = await prisma.osFuncionarioWms.findMany({
      where: { ordemServicoId: id },
      orderBy: { horaInicio: 'asc' },
    })

    const historico = await Promise.all(registros.map(async (r) => {
      const func = await prisma.funcionario.findUnique({
        where: { id: r.funcionarioId },
        select: { nome: true, matricula: true },
      })
      const tempoMs = r.horaInicio && r.horaFim
        ? new Date(r.horaFim).getTime() - new Date(r.horaInicio).getTime()
        : r.horaInicio
          ? new Date().getTime() - new Date(r.horaInicio).getTime()
          : 0
      return {
        id: r.id,
        funcionarioId: r.funcionarioId,
        nome: func?.nome || '—',
        matricula: func?.matricula || '—',
        horaInicio: r.horaInicio,
        horaFim: r.horaFim,
        ativo: !r.horaFim,
        tempoMinutos: Math.round(tempoMs / 60000),
      }
    }))

    return { osId: id, historico }
  })

  // GET /historico — lista OS concluídas do funcionário logado, filtradas por data
  app.get('/historico', async (request) => {
    const user = request.user as { id: string; nome: string; empresaId: string }
    const q = z.object({
      data: z.string().optional(), // YYYY-MM-DD — filtra por dia
      dataInicio: z.string().optional(),
      dataFim: z.string().optional(),
      page: z.coerce.number().default(1),
      limit: z.coerce.number().default(50),
    }).parse(request.query)

    // Encontrar funcionário vinculado ao usuário
    const funcionario = await prisma.funcionario.findFirst({
      where: {
        OR: [
          { usuarioId: user.id },
          { nome: { contains: user.nome, mode: 'insensitive' } },
        ]
      }
    })

    if (!funcionario) {
      return { data: [], total: 0 }
    }

    // Buscar OS onde o funcionário participou
    const osFuncionarios = await prisma.osFuncionarioWms.findMany({
      where: { funcionarioId: funcionario.id },
      select: { ordemServicoId: true },
    })

    const osIds = osFuncionarios.map((f) => f.ordemServicoId)
    if (osIds.length === 0) return { data: [], total: 0 }

    const where: any = {
      id: { in: osIds },
      empresaId: user.empresaId,
      status: 'CONCLUIDO',
    }

    // Filtro por data
    if (q.data) {
      const dia = new Date(q.data + 'T00:00:00.000Z')
      const diaFim = new Date(q.data + 'T00:00:00.000Z')
      diaFim.setUTCDate(diaFim.getUTCDate() + 1)
      where.horaFim = { gte: dia, lt: diaFim }
    } else if (q.dataInicio || q.dataFim) {
      where.horaFim = {}
      if (q.dataInicio) where.horaFim.gte = new Date(q.dataInicio + 'T00:00:00.000Z')
      if (q.dataFim) {
        const fim = new Date(q.dataFim + 'T00:00:00.000Z')
        fim.setUTCDate(fim.getUTCDate() + 1)
        where.horaFim.lt = fim
      }
    }

    const [data, total] = await Promise.all([
      prisma.ordemServicoWms.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { horaFim: 'desc' },
      }),
      prisma.ordemServicoWms.count({ where }),
    ])

    // Enriquecer com nota fiscal e tempo
    const enriched = await Promise.all(data.map(async (os) => {
      let notaEntrada = null
      if (os.notaEntradaId) {
        notaEntrada = await prisma.notaEntrada.findUnique({
          where: { id: os.notaEntradaId },
          select: { numero: true, fornecedor: true },
        })
      }
      const tempoMs = os.horaInicio && os.horaFim
        ? new Date(os.horaFim).getTime() - new Date(os.horaInicio).getTime()
        : 0
      return { ...os, notaEntrada, tempoExecucaoMinutos: Math.round(tempoMs / 60000) }
    }))

    return { data: enriched, total }
  })

  // GET /minhas — lista OS em andamento do funcionário logado
  app.get('/minhas', async (request) => {
    const user = request.user as { id: string; nome: string; empresaId: string }

    // Encontrar funcionário vinculado ao usuário (por link direto ou fallback por nome)
    const funcionario = await prisma.funcionario.findFirst({
      where: {
        OR: [
          { usuarioId: user.id },
          { nome: { contains: user.nome, mode: 'insensitive' } },
        ]
      }
    })

    if (!funcionario) {
      return { data: [], total: 0 }
    }

    // Buscar OS onde o funcionário está vinculado e status é EXECUTANDO ou ABERTO
    const osFuncionarios = await prisma.osFuncionarioWms.findMany({
      where: { funcionarioId: funcionario.id },
      select: { ordemServicoId: true },
    })

    const osIds = osFuncionarios.map((f) => f.ordemServicoId)

    if (osIds.length === 0) {
      return { data: [], total: 0 }
    }

    const ordens = await prisma.ordemServicoWms.findMany({
      where: {
        id: { in: osIds },
        empresaId: user.empresaId,
        status: { in: ['EXECUTANDO', 'ABERTO'] },
      },
      include: {
        ondaSeparacao: { select: { numero: true } },
      },
      orderBy: { criadoEm: 'desc' },
    })

    // Enriquecer com nota fiscal
    const enriched = await Promise.all(ordens.map(async (os) => {
      let notaEntrada = null
      if (os.notaEntradaId) {
        notaEntrada = await prisma.notaEntrada.findUnique({
          where: { id: os.notaEntradaId },
          select: { numero: true, fornecedor: true },
        })
      }
      return { ...os, notaEntrada }
    }))

    return { data: enriched, total: enriched.length }
  })

  // GET /pendentes — lista OS abertas para o funcionário assumir
  app.get('/pendentes/lista', async (request) => {
    const user = request.user as { id: string; empresaId: string }

    const pendentes = await prisma.ordemServicoWms.findMany({
      where: { empresaId: user.empresaId, status: 'ABERTO' },
      orderBy: { criadoEm: 'asc' },
    })

    // Enriquecer com nota fiscal
    const enriched = await Promise.all(pendentes.map(async (os) => {
      let notaEntrada = null
      if (os.notaEntradaId) {
        notaEntrada = await prisma.notaEntrada.findUnique({
          where: { id: os.notaEntradaId },
          select: { numero: true, fornecedor: true },
        })
      }
      return { ...os, notaEntrada }
    }))

    return { data: enriched, total: enriched.length }
  })

  // POST /assumir/:id — funcionário do coletor/app assume uma OS (quem pegar primeiro)
  app.post('/assumir/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({ funcionarioId: z.string().uuid() }).parse(request.body)

    const os = await prisma.ordemServicoWms.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!os) return reply.status(404).send({ message: 'OS não encontrada' })

    if (os.status !== 'ABERTO') {
      return reply.status(422).send({ message: 'OS já foi assumida por outro funcionário' })
    }

    const agora = new Date()
    await prisma.$transaction(async (tx) => {
      await tx.ordemServicoWms.update({
        where: { id },
        data: { status: 'EXECUTANDO', funcionarioId: body.funcionarioId, horaInicio: agora },
      })
      await tx.osFuncionarioWms.create({
        data: { ordemServicoId: id, funcionarioId: body.funcionarioId, horaInicio: agora },
      })
    })

    return { message: 'OS assumida com sucesso' }
  })

  // GET /produtividade — relatório de produtividade por funcionário
  app.get('/produtividade', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const q = z.object({
      dataInicio: z.string().optional(),
      dataFim: z.string().optional(),
    }).parse(request.query)

    const where: any = { empresaId: user.empresaId, status: 'CONCLUIDO', horaInicio: { not: null }, horaFim: { not: null } }
    if (q.dataInicio) where.dataAbertura = { ...where.dataAbertura, gte: new Date(q.dataInicio) }
    if (q.dataFim) where.dataAbertura = { ...where.dataAbertura, lte: new Date(q.dataFim) }

    const concluidas = await prisma.ordemServicoWms.findMany({ where, orderBy: { horaFim: 'desc' } })

    // Agrupar por funcionário
    const porFuncionario: Record<string, { total: number; tempoTotalMin: number; operacoes: Record<string, number> }> = {}

    for (const os of concluidas) {
      const funcId = os.funcionarioId || 'sem-funcionario'
      if (!porFuncionario[funcId]) porFuncionario[funcId] = { total: 0, tempoTotalMin: 0, operacoes: {} }

      porFuncionario[funcId].total++
      if (os.horaInicio && os.horaFim) {
        porFuncionario[funcId].tempoTotalMin += Math.round((new Date(os.horaFim).getTime() - new Date(os.horaInicio).getTime()) / 60000)
      }
      porFuncionario[funcId].operacoes[os.operacao] = (porFuncionario[funcId].operacoes[os.operacao] || 0) + 1
    }

    // Enriquecer com nomes
    const resultado = await Promise.all(Object.entries(porFuncionario).map(async ([funcId, dados]) => {
      let nome = 'Sem funcionário'
      if (funcId !== 'sem-funcionario') {
        const func = await prisma.funcionario.findUnique({ where: { id: funcId }, select: { nome: true } })
        if (func) nome = func.nome
      }
      return {
        funcionarioId: funcId,
        nome,
        totalOS: dados.total,
        tempoTotalMinutos: dados.tempoTotalMin,
        tempoMedioMinutos: dados.total > 0 ? Math.round(dados.tempoTotalMin / dados.total) : 0,
        operacoes: dados.operacoes,
      }
    }))

    return { data: resultado, totalConcluidas: concluidas.length }
  })
}
