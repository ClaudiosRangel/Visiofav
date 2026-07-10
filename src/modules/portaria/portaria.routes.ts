import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { analisarPendenciasLogisticas } from '../pendencia-logistica/pendencia-logistica.routes'
import { parseNfeXml } from '../nota-entrada/nfe-xml-parser'
import { filaService } from '../patio/fila.service'
import { portariaService } from './portaria.service'
import { autorizarEntradaBodySchema, decidirLiberacaoConferencia } from './liberacao-conferencia.service'

/**
 * Erro lançado dentro da transação de `POST /autorizar-entrada/:id` quando a
 * Liberação_de_Conferência é rejeitada (credenciais de Supervisor ausentes/inválidas).
 * Capturado fora do `$transaction` para responder com o `statusCode` correto,
 * sem que nenhuma alteração de status/OS tenha sido persistida (rollback automático).
 */
class LiberacaoRejeitadaError extends Error {
  constructor(public statusCode: 401 | 422, message: string) {
    super(message)
  }
}

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
  motoristaDocumento: z.string().optional(),
  tipoOperacao: z.enum(['CARGA', 'DESCARGA', 'DEVOLUCAO', 'TRANSFERENCIA']).optional(),
  qtdCaixas: z.number().int().optional(),
  qtdPaletes: z.number().int().optional(),
  itensConferidos: z.array(z.object({
    codigoProduto: z.string(),
    quantidadeConferida: z.number().min(0),
  })).optional(),
  observacao: z.string().optional(),
  cdId: z.string().uuid().optional(),
})

const registroAvulsoSchema = z.object({
  placa: z.string().min(1),
  motorista: z.string().min(1),
  documento: z.string().optional(),
  motivo: z.enum(['CARGA', 'DESCARGA', 'COLETA', 'ENTREGA', 'AVULSO']).default('AVULSO'),
})

// ─── Walk-in (veículo sem agendamento) ──────────────────────────────────────
const PLACA_ANTIGA_REGEX = /^[A-Z]{3}[0-9]{4}$/
const PLACA_MERCOSUL_REGEX = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/

const walkInSchema = z.object({
  placa: z.string().min(1),
  motoristaNome: z.string().min(1),
  motoristaDocumento: z.string().min(1),
  tipoOperacao: z.enum(['CARGA', 'DESCARGA', 'DEVOLUCAO', 'TRANSFERENCIA']),
  transportadoraId: z.string().uuid().optional(),
  cdId: z.string().uuid(),
})

/**
 * Cria NotaEntrada PENDENTE a partir dos dados do AgendaWms (pedido de compra + XML).
 * Retorna o id da nota criada ou null se não houver itens.
 */
async function criarNotaEntradaSeNecessario(ag: any, empresaId: string): Promise<string | null> {
  // Buscar dados do fornecedor
  let fornecedorNome = ''
  let fornecedorDoc = ''
  if (ag.fornecedorId) {
    const forn = await prisma.fornecedor.findUnique({ where: { id: ag.fornecedorId }, select: { razaoSocial: true, cnpj: true } })
    if (forn) { fornecedorNome = forn.razaoSocial; fornecedorDoc = forn.cnpj }
  }

  // Buscar itens do pedido de compra OU da compra efetivada do fornecedor
  let itensNota: any[] = []
  let xmlItens: Array<{ codigoProduto: string; lote: string; validade: string | null }> = []
  let transportadoraUf: string | null = null
  let transportadoraRntc: string | null = null

  // Buscar XML da compra efetivada (por pedidoCompraId ou fallback por fornecedorId)
  let compra: { xmlNfe: string | null; pedidoCompraId: string } | null = null
  if (ag.pedidoCompraId) {
    compra = await prisma.compraEfetivada.findFirst({
      where: { pedidoCompraId: ag.pedidoCompraId },
      select: { xmlNfe: true, pedidoCompraId: true },
    })
  }
  if (!compra && ag.fornecedorId) {
    compra = await prisma.compraEfetivada.findFirst({
      where: { pedidoCompra: { fornecedorId: ag.fornecedorId }, xmlNfe: { not: null } },
      orderBy: { criadoEm: 'desc' },
      select: { xmlNfe: true, pedidoCompraId: true },
    })
  }

  // Extrair lote/validade e dados de transporte do XML
  if (compra?.xmlNfe) {
    try {
      const parsed = parseNfeXml(compra.xmlNfe)
      xmlItens = parsed.itens.map(i => ({
        codigoProduto: i.codigoProduto,
        lote: i.lote || '',
        validade: (i as any).validade || null,
      }))
      transportadoraUf = parsed.transporte.ufVeiculo
      transportadoraRntc = parsed.transporte.rntc
    } catch { /* XML inválido, seguir sem lote/validade/transporte */ }
  }

  // Buscar itens do pedido de compra
  const pedidoId = ag.pedidoCompraId || compra?.pedidoCompraId
  if (pedidoId) {
    const pedido = await prisma.pedidoCompra.findUnique({
      where: { id: pedidoId },
      include: { itens: { include: { produto: { select: { nome: true, codigo: true, unidade: true } } } } },
    })
    if (pedido) {
      itensNota = pedido.itens.map((item, idx) => {
        const xmlItem = xmlItens.find(x => x.codigoProduto === item.produto.codigo)
        return {
          item: idx + 1,
          descricao: item.produto.nome,
          codigoProduto: item.produto.codigo,
          unidade: (item as any).unidade || item.produto.unidade,
          quantidade: Number(item.quantidade),
          lote: xmlItem?.lote || undefined,
          validade: xmlItem?.validade ? new Date(xmlItem.validade) : undefined,
        }
      })
    }
  }

  // Só cria se tem itens (pedido vinculado com produtos)
  if (itensNota.length === 0) return null

  // Gerar número sequencial para nota
  const ultimaNota = await prisma.notaEntrada.findFirst({ orderBy: { numero: 'desc' }, select: { numero: true } })
  const proximoNumero = (ultimaNota?.numero ?? 0) + 1

  // Criar nota de entrada PENDENTE (aguardando conferência interna)
  const nota = await prisma.notaEntrada.create({
    data: {
      numero: proximoNumero,
      fornecedor: fornecedorNome,
      fornecedorDoc,
      transportadoraUf,
      transportadoraRntc,
      tipo: 'COMPRA',
      status: 'PENDENTE',
      dataEntrada: new Date(),
      itens: { create: itensNota },
    },
  })

  return nota.id
}

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
            itens: { include: { produto: { select: { id: true, nome: true, codigo: true, unidade: true } } } },
          },
        })
      }
      // Fallback: se não tem pedidoCompraId mas tem fornecedorId, buscar pedido mais recente do fornecedor
      if (!pedido && ag.fornecedorId) {
        pedido = await prisma.pedidoCompra.findFirst({
          where: { fornecedorId: ag.fornecedorId, status: { notIn: ['CANCELADO'] } },
          orderBy: { criadoEm: 'desc' },
          select: {
            numero: true, valorTotal: true,
            itens: { include: { produto: { select: { id: true, nome: true, codigo: true, unidade: true } } } },
          },
        })
      }
      // Enriquecer itens com dados de SKU (lastro, camada) para cálculo de paletes
      if (pedido?.itens) {
        const produtoIds = pedido.itens.map((i: any) => i.produto?.id).filter(Boolean)
        const skus = produtoIds.length > 0
          ? await prisma.sku.findMany({
              where: { produtoId: { in: produtoIds }, status: true },
              select: { produtoId: true, sequencia: true, lastro: true, camada: true, qtdEmbalagem: true, unidade: true },
              orderBy: { sequencia: 'asc' },
            })
          : []
        const skuMap = new Map<string, any>()
        for (const sku of skus) {
          // Usar o primeiro SKU (sequência 1) de cada produto
          if (!skuMap.has(sku.produtoId)) skuMap.set(sku.produtoId, sku)
        }
        ;(pedido as any).itens = pedido.itens.map((item: any) => ({
          ...item,
          sku: item.produto?.id ? skuMap.get(item.produto.id) || null : null,
        }))
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
  // Muda status de AGENDADO → ESPERA + cria VeiculoPatio + FilaEsperaPatio + NotaEntrada PENDENTE
  app.post('/conferir/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }
    const { id } = idParamsSchema.parse(request.params)
    const body = conferirNaPortariaSchema.parse(request.body)

    // Usar o PortariaService para check-in integrado:
    // valida AGENDADO, verifica duplicidade de placa (409), cria VeiculoPatio + FilaEsperaPatio em transação
    let checkinResult: any
    try {
      checkinResult = await portariaService.conferirCheckin(
        user.empresaId,
        id,
        {
          placa: body.placa,
          motorista: body.motorista,
          motoristaDocumento: body.motoristaDocumento,
          tipoOperacao: body.tipoOperacao,
          qtdCaixas: body.qtdCaixas,
          qtdPaletes: body.qtdPaletes,
          observacao: body.observacao,
          cdId: body.cdId,
        },
        user.id,
      )
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message })
    }

    const ag = checkinResult.agendamento

    // Criar NotaEntrada PENDENTE (preservando lógica existente)
    let notaEntradaId: string | null = null
    try {
      notaEntradaId = await criarNotaEntradaSeNecessario(ag, user.empresaId)
    } catch { /* falha na criação da nota não impede o check-in */ }

    return reply.status(200).send({
      message: notaEntradaId
        ? 'Conferência na portaria concluída. Veículo registrado no pátio. Aguardando chamada de doca.'
        : 'Conferência na portaria concluída. Veículo registrado no pátio. Nota de entrada não criada — agendamento sem pedido de compra vinculado.',
      agendamento: checkinResult.agendamento,
      veiculo: checkinResult.veiculo,
      filaPosicao: checkinResult.filaPosicao,
      notaEntradaId,
    })
  })

  // POST /autorizar-entrada/:id — agenda confirmou, portaria autoriza entrada (CONFIRMADO → NA_DOCA)
  // Cria Ordem de Serviço de CONFERENCIA automaticamente
  app.post('/autorizar-entrada/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = autorizarEntradaBodySchema.parse(request.body ?? {})

    const ag = await prisma.agendaWms.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!ag) return reply.status(404).send({ message: 'Agendamento não encontrado' })

    if (ag.status !== 'CONFIRMADO') {
      return reply.status(422).send({ message: `Veículo não está CONFIRMADO. Status atual: ${ag.status}. Aguarde confirmação na agenda.` })
    }

    let result: { atualizado: any; os: any }
    try {
      result = await prisma.$transaction(async (tx) => {
        // Decidir se a liberação exige credenciais de Supervisor (Requirement 5.1-5.7).
        // Reavaliado a cada requisição, consultando o estado atual do banco dentro
        // da transação — sem cache do resultado (Requirement 5.6).
        const decisao = await decidirLiberacaoConferencia(tx, ag, user.empresaId, body)
        if (!decisao.efetivar) {
          throw new LiberacaoRejeitadaError(decisao.erro!.statusCode, decisao.erro!.message)
        }

        const atualizado = await tx.agendaWms.update({
          where: { id },
          data: { status: 'NA_DOCA', supervisorLiberacaoId: decisao.supervisorLiberacaoId },
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
    } catch (err) {
      if (err instanceof LiberacaoRejeitadaError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }

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

  // POST /walk-in — registra veículo walk-in (sem agendamento) no pátio com fila de espera
  app.post('/walk-in', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    const body = walkInSchema.parse(request.body)

    // 1. Validar formato da placa
    const placaNormalizada = body.placa.toUpperCase()
    if (!PLACA_ANTIGA_REGEX.test(placaNormalizada) && !PLACA_MERCOSUL_REGEX.test(placaNormalizada)) {
      return reply.status(422).send({
        message: 'Placa inválida. Use formato antigo (ABC1234) ou Mercosul (ABC1D23)',
      })
    }

    // 2. Verificar duplicidade: veículo com mesma placa que não foi liberado
    const veiculoExistente = await prisma.veiculoPatio.findFirst({
      where: {
        empresaId: user.empresaId,
        placa: placaNormalizada,
        status: { not: 'LIBERADO' },
      },
    })

    if (veiculoExistente) {
      return reply.status(409).send({
        message: `Veículo com placa ${placaNormalizada} já está no pátio`,
      })
    }

    // 3. Calcular prioridade via FilaService (walk-in: isAgendado = false)
    const prioridade = await filaService.calcularPrioridade(
      user.empresaId,
      body.cdId,
      body.tipoOperacao,
      false,
    )

    // 4. Transação: criar VeiculoPatio + inserir na FilaEsperaPatio
    const resultado = await prisma.$transaction(async (tx) => {
      const veiculo = await tx.veiculoPatio.create({
        data: {
          empresaId: user.empresaId!,
          cdId: body.cdId,
          placa: placaNormalizada,
          motoristaNome: body.motoristaNome,
          motoristaDocumento: body.motoristaDocumento,
          transportadoraId: body.transportadoraId || null,
          tipoOperacao: body.tipoOperacao,
          agendamentoId: null,
          status: 'AGUARDANDO',
          entradaEm: new Date(),
          criadoPorId: user.id,
        },
      })

      const fila = await filaService.inserirNaFila(
        tx,
        user.empresaId!,
        body.cdId,
        veiculo.id,
        prioridade,
      )

      return {
        ...veiculo,
        filaPosicao: { posicao: fila.posicao, prioridade: fila.prioridade },
      }
    })

    return reply.status(201).send(resultado)
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
