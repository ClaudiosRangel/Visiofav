import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { analisarPendenciasLogisticas } from '../pendencia-logistica/pendencia-logistica.routes'

const idParamsSchema = z.object({ id: z.string().uuid() })

function getHojeRange() {
  const hojeStr = new Date().toISOString().split('T')[0]
  const hojeUtc = new Date(hojeStr + 'T00:00:00.000Z')
  const amanhaUtc = new Date(hojeStr + 'T00:00:00.000Z')
  amanhaUtc.setUTCDate(amanhaUtc.getUTCDate() + 1)
  return { hojeUtc, amanhaUtc }
}

const conferirNaPortariaSchema = z.object({
  placa: z.string().min(1),
  motorista: z.string().min(1),
  qtdCaixas: z.number().int().optional(),
  qtdPaletes: z.number().int().optional(),
  itensConferidos: z.array(z.object({
    codigoProduto: z.string(),
    quantidadeConferida: z.number().min(0),
  })).optional(),
  observacao: z.string().optional(),
})

const registroAvulsoSchema = z.object({
  placa: z.string().min(1),
  motorista: z.string().min(1),
  documento: z.string().optional(),
  motivo: z.enum(['CARGA', 'DESCARGA', 'COLETA', 'ENTREGA', 'AVULSO']).default('AVULSO'),
})

export async function portariaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // GET /agendamentos-hoje — lista agendamentos do dia para a portaria
  // Mostra AGENDADO (aguardando chegada), ESPERA (conferido, aguardando confirmação),
  // CONFIRMADO (pronto para entrada), NA_DOCA, CONFERINDO, CONFERIDO
  app.get('/agendamentos-hoje', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { hojeUtc, amanhaUtc } = getHojeRange()

    const agendamentos = await prisma.agendaWms.findMany({
      where: {
        empresaId: user.empresaId,
        status: { notIn: ['CANCELADO'] },
        OR: [
          // Agendamentos de hoje
          { dataPrevista: { gte: hojeUtc, lt: amanhaUtc } },
          // Veículos ainda no pátio (independente da data)
          { status: { in: ['ESPERA', 'CONFIRMADO', 'NA_DOCA', 'CONFERINDO', 'CONFERIDO'] } },
        ],
      },
      orderBy: [{ horaInicio: 'asc' }],
    })

    const enriched = await Promise.all(agendamentos.map(async (ag) => {
      let fornecedor = null
      let pedido = null
      let doca = null
      if (ag.fornecedorId) {
        fornecedor = await prisma.fornecedor.findUnique({
          where: { id: ag.fornecedorId },
          select: { razaoSocial: true, nomeFantasia: true, cnpj: true },
        })
      }
      if (ag.pedidoCompraId) {
        pedido = await prisma.pedidoCompra.findUnique({
          where: { id: ag.pedidoCompraId },
          select: {
            numero: true, valorTotal: true,
            itens: { include: { produto: { select: { nome: true, codigo: true, unidade: true } } } },
          },
        })
      }
      if (ag.docaId) {
        doca = await prisma.doca.findUnique({ where: { id: ag.docaId }, select: { descricao: true, tipo: true } })
      }
      return { ...ag, fornecedor, pedido, doca }
    }))

    const agendados = enriched.filter((a) => a.status === 'AGENDADO').length
    const espera = enriched.filter((a) => a.status === 'ESPERA').length
    const confirmados = enriched.filter((a) => a.status === 'CONFIRMADO').length
    const naDoca = enriched.filter((a) => ['NA_DOCA', 'CONFERINDO'].includes(a.status)).length
    const prontoSair = enriched.filter((a) => a.status === 'CONFERIDO').length
    const recebidos = enriched.filter((a) => a.status === 'RECEBIDO').length

    return { data: enriched, total: enriched.length, agendados, espera, confirmados, naDoca, prontoSair, recebidos }
  })

  // POST /conferir/:id — caminhão chegou, portaria confere nota (informa placa, motorista, quantidades)
  // Muda status de AGENDADO → ESPERA + cria NotaEntrada PENDENTE
  app.post('/conferir/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = conferirNaPortariaSchema.parse(request.body)

    const ag = await prisma.agendaWms.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!ag) return reply.status(404).send({ message: 'Agendamento não encontrado' })

    if (ag.status !== 'AGENDADO') {
      return reply.status(422).send({ message: `Agendamento não está AGENDADO. Status atual: ${ag.status}` })
    }

    const result = await prisma.$transaction(async (tx) => {
      // Atualizar agenda com placa, motorista e status ESPERA
      const atualizado = await tx.agendaWms.update({
        where: { id },
        data: {
          placa: body.placa.toUpperCase(),
          motorista: body.motorista,
          qtdCaixas: body.qtdCaixas,
          qtdPaletes: body.qtdPaletes,
          observacao: body.observacao || ag.observacao,
          status: 'ESPERA',
        },
      })

      // Buscar dados do fornecedor
      let fornecedorNome = ''
      let fornecedorDoc = ''
      if (ag.fornecedorId) {
        const forn = await tx.fornecedor.findUnique({ where: { id: ag.fornecedorId }, select: { razaoSocial: true, cnpj: true } })
        if (forn) { fornecedorNome = forn.razaoSocial; fornecedorDoc = forn.cnpj }
      }

      // Buscar itens do pedido de compra
      let itensNota: any[] = []
      if (ag.pedidoCompraId) {
        const pedido = await tx.pedidoCompra.findUnique({
          where: { id: ag.pedidoCompraId },
          include: { itens: { include: { produto: { select: { nome: true, codigo: true, unidade: true } } } } },
        })
        if (pedido) {
          itensNota = pedido.itens.map((item, idx) => ({
            item: idx + 1,
            descricao: item.produto.nome,
            codigoProduto: item.produto.codigo,
            unidade: item.produto.unidade,
            quantidade: Number(item.quantidade),
          }))
        }
      }

      // Gerar número sequencial para nota
      const ultimaNota = await tx.notaEntrada.findFirst({ orderBy: { numero: 'desc' }, select: { numero: true } })
      const proximoNumero = (ultimaNota?.numero ?? 0) + 1

      // Criar nota de entrada PENDENTE (aguardando conferência interna)
      // Só cria se tem itens (pedido vinculado com produtos)
      let nota = null
      if (itensNota.length > 0) {
        nota = await tx.notaEntrada.create({
          data: {
            numero: proximoNumero,
            fornecedor: fornecedorNome,
            fornecedorDoc,
            tipo: 'COMPRA',
            status: 'PENDENTE',
            dataEntrada: new Date(),
            itens: { create: itensNota },
          },
        })
      }

      return { atualizado, nota }
    })

    return reply.status(200).send({
      message: result.nota
        ? 'Conferência na portaria concluída. Aguardando confirmação na agenda de recebimento.'
        : 'Conferência na portaria concluída. Nota de entrada não criada — agendamento sem pedido de compra vinculado.',
      agendamento: result.atualizado,
      notaEntradaId: result.nota?.id || null,
    })
  })

  // POST /autorizar-entrada/:id — agenda confirmou, portaria autoriza entrada (CONFIRMADO → NA_DOCA)
  // Cria Ordem de Serviço de CONFERENCIA automaticamente
  app.post('/autorizar-entrada/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const ag = await prisma.agendaWms.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!ag) return reply.status(404).send({ message: 'Agendamento não encontrado' })

    if (ag.status !== 'CONFIRMADO') {
      return reply.status(422).send({ message: `Veículo não está CONFIRMADO. Status atual: ${ag.status}. Aguarde confirmação na agenda.` })
    }

    const result = await prisma.$transaction(async (tx) => {
      const atualizado = await tx.agendaWms.update({
        where: { id },
        data: { status: 'NA_DOCA' },
      })

      // Buscar nota de entrada vinculada
      let notaEntradaId: string | null = null
      if (ag.fornecedorId) {
        const { hojeUtc, amanhaUtc } = getHojeRange()
        const forn = await tx.fornecedor.findUnique({ where: { id: ag.fornecedorId }, select: { cnpj: true, razaoSocial: true } })
        if (forn) {
          const nota = await tx.notaEntrada.findFirst({
            where: { fornecedorDoc: forn.cnpj, status: { in: ['PENDENTE', 'EM_CONFERENCIA'] }, dataEntrada: { gte: hojeUtc, lt: amanhaUtc } },
            orderBy: { criadoEm: 'desc' },
          })
          if (nota) {
            notaEntradaId = nota.id
          } else {
            // Nota não existe — criar a partir do XML da compra efetivada
            let compraXml: string | null = null
            if (ag.pedidoCompraId) {
              const compra = await tx.compraEfetivada.findFirst({
                where: { pedidoCompraId: ag.pedidoCompraId },
                select: { xmlNfe: true },
              })
              compraXml = compra?.xmlNfe ?? null
            }
            if (!compraXml) {
              const compra = await tx.compraEfetivada.findFirst({
                where: { pedidoCompra: { fornecedorId: ag.fornecedorId }, xmlNfe: { not: null } },
                orderBy: { criadoEm: 'desc' },
                select: { xmlNfe: true },
              })
              compraXml = compra?.xmlNfe ?? null
            }

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
                const novaNota = await tx.notaEntrada.create({
                  data: {
                    numero: matchNNF ? parseInt(matchNNF[1]) : 0,
                    serie: matchSerie ? matchSerie[1] : null,
                    fornecedor: matchEmit ? matchEmit[1] : (forn.razaoSocial || null),
                    fornecedorDoc: matchCNPJ ? matchCNPJ[1] : forn.cnpj,
                    dataEntrada: new Date(),
                    status: 'PENDENTE',
                    itens: { create: itensXml },
                  },
                })
                notaEntradaId = novaNota.id
              }
            }
          }
        }
      }

      // Criar OS de Conferência
      const ultimaOs = await tx.ordemServicoWms.findFirst({
        where: { empresaId: user.empresaId },
        orderBy: { numero: 'desc' },
        select: { numero: true },
      })
      const numOs = (ultimaOs?.numero ?? 0) + 1

      const os = await tx.ordemServicoWms.create({
        data: {
          empresaId: user.empresaId,
          numero: numOs,
          tipo: 'ENTRADA',
          operacao: 'CONFERENCIA',
          status: 'ABERTO',
          notaEntradaId,
          agendaWmsId: ag.id,
        },
      })

      return { atualizado, os }
    })

    // Analisar pendências logísticas (SKU e dados logísticos) dos itens da nota
    let pendenciasLogisticas = { pendenciasCriadas: 0, itensAnalisados: 0 }
    const notaEntradaIdFinal = result.os.notaEntradaId
    if (notaEntradaIdFinal) {
      pendenciasLogisticas = await analisarPendenciasLogisticas(user.empresaId, notaEntradaIdFinal)
    }

    return {
      message: 'Entrada autorizada — veículo na doca. OS de conferência criada.',
      agendamento: result.atualizado,
      ordemServicoId: result.os.id,
      ordemServicoNumero: result.os.numero,
      pendenciasLogisticas: pendenciasLogisticas.pendenciasCriadas > 0
        ? { total: pendenciasLogisticas.pendenciasCriadas, mensagem: `${pendenciasLogisticas.pendenciasCriadas} pendência(s) logística(s) detectada(s). Conferência bloqueada até resolução.` }
        : null,
    }
  })

  // POST /registrar-saida/:id — registra saída do veículo (CONFERIDO → RECEBIDO)
  app.post('/registrar-saida/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const ag = await prisma.agendaWms.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!ag) return reply.status(404).send({ message: 'Agendamento não encontrado' })

    if (!['NA_DOCA', 'CONFERIDO'].includes(ag.status)) {
      return reply.status(422).send({ message: `Veículo não pode sair. Status atual: ${ag.status}` })
    }

    await prisma.$transaction(async (tx) => {
      await tx.agendaWms.update({ where: { id }, data: { status: 'RECEBIDO' } })
      if (ag.pedidoCompraId) {
        await tx.pedidoCompra.update({ where: { id: ag.pedidoCompraId }, data: { status: 'RECEBIDO' } })
      }
    })

    return { message: 'Saída registrada — recebimento concluído' }
  })

  // POST /entrada-avulsa — registra entrada sem agendamento
  app.post('/entrada-avulsa', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = registroAvulsoSchema.parse(request.body)

    const ag = await prisma.agendaWms.create({
      data: {
        empresaId: user.empresaId,
        placa: body.placa.toUpperCase(),
        motorista: body.motorista,
        dataPrevista: new Date(new Date().toISOString().split('T')[0] + 'T00:00:00.000Z'),
        horaInicio: new Date().toTimeString().substring(0, 5),
        horaFim: new Date(Date.now() + 2 * 60 * 60 * 1000).toTimeString().substring(0, 5),
        status: 'NA_DOCA',
        observacao: `Entrada avulsa - ${body.motivo}. Doc: ${body.documento || 'N/A'}`,
      },
    })

    return reply.status(201).send({ message: 'Entrada avulsa registrada', agendamento: ag })
  })

  // GET /veiculos-patio — lista veículos atualmente no pátio/doca (compat)
  app.get('/veiculos-patio', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { hojeUtc, amanhaUtc } = getHojeRange()

    const veiculos = await prisma.agendaWms.findMany({
      where: {
        empresaId: user.empresaId,
        dataPrevista: { gte: hojeUtc, lt: amanhaUtc },
        status: { in: ['ESPERA', 'CONFIRMADO', 'NA_DOCA', 'CONFERINDO', 'CONFERIDO'] },
      },
      orderBy: { horaInicio: 'asc' },
    })

    const enriched = await Promise.all(veiculos.map(async (v) => {
      let fornecedor = null
      if (v.fornecedorId) {
        fornecedor = await prisma.fornecedor.findUnique({
          where: { id: v.fornecedorId },
          select: { razaoSocial: true, nomeFantasia: true },
        })
      }
      let doca = null
      if (v.docaId) {
        doca = await prisma.doca.findUnique({ where: { id: v.docaId }, select: { descricao: true } })
      }
      return { ...v, fornecedor, doca }
    }))

    return {
      data: enriched,
      total: enriched.length,
      espera: enriched.filter((v) => v.status === 'ESPERA').length,
      confirmados: enriched.filter((v) => v.status === 'CONFIRMADO').length,
      naDoca: enriched.filter((v) => ['NA_DOCA', 'CONFERINDO'].includes(v.status)).length,
      prontoSair: enriched.filter((v) => v.status === 'CONFERIDO').length,
    }
  })

  // GET /validar-placa/:placa — compat: verifica placa (usado pelo campo de busca)
  app.get('/validar-placa/:placa', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { placa } = z.object({ placa: z.string() }).parse(request.params)
    const { hojeUtc, amanhaUtc } = getHojeRange()

    const agendamento = await prisma.agendaWms.findFirst({
      where: {
        empresaId: user.empresaId,
        placa: placa.toUpperCase(),
        dataPrevista: { gte: hojeUtc, lt: amanhaUtc },
        status: { notIn: ['CANCELADO', 'RECEBIDO'] },
      },
    })

    if (!agendamento) {
      return { encontrado: false, liberado: false, mensagem: 'Nenhum agendamento encontrado para esta placa hoje.' }
    }

    let fornecedor = null
    if (agendamento.fornecedorId) {
      fornecedor = await prisma.fornecedor.findUnique({
        where: { id: agendamento.fornecedorId },
        select: { razaoSocial: true, nomeFantasia: true },
      })
    }

    const podeEntrar = agendamento.status === 'CONFIRMADO'
    const podeSair = ['NA_DOCA', 'CONFERIDO'].includes(agendamento.status)

    return {
      encontrado: true,
      liberado: podeEntrar || podeSair,
      agendamentoId: agendamento.id,
      status: agendamento.status,
      podeEntrar,
      podeSair,
      motorista: agendamento.motorista,
      horaInicio: agendamento.horaInicio,
      horaFim: agendamento.horaFim,
      fornecedor,
      mensagem: podeEntrar ? 'Veículo CONFIRMADO — liberar entrada' :
        podeSair ? 'Veículo liberado para SAÍDA' :
        agendamento.status === 'ESPERA' ? 'Aguardando confirmação na agenda de recebimento' :
        `Status: ${agendamento.status}`,
    }
  })
}
