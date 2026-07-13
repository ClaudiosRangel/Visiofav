/**
 * AgendaService — orquestrador principal das operações de agendamento.
 *
 * Responsabilidades:
 * - Coordenar criação e edição com validação de conflitos
 * - Integrar com AutoSchedulerService para auto-agendamento
 * - Enriquecer dados com fornecedor, pedido, doca, nota fiscal
 * - Bloquear edição/movimentação de agendamentos finalizados (RECEBIDO, CANCELADO)
 * - Validar dataPrevista não no passado e horaFim > horaInicio
 * - Executar transições de status com side-effects atômicos (NA_DOCA, CONFERINDO, RECEBIDO)
 */

import { prisma } from '../../lib/prisma'
import { validacaoService } from './validacao.service'
import { autoSchedulerService } from './auto-scheduler.service'
import { calcularPermanencia } from './agenda.utils'
import { parseNfeXml } from '../nota-entrada/nfe-xml-parser'
import { sincronizarDadosTransporte } from '../agenda-wms/transporte-sync.service'
import {
  CriarAgendamentoInput,
  EditarAgendamentoInput,
  MoverAgendamentoInput,
  ListarAgendamentosFiltros,
  StatusAgenda,
} from './agenda.types'

// ─── Helpers internos ───────────────────────────────────────────────────────────

/**
 * Retorna a data "hoje" no fuso America/Sao_Paulo como string "YYYY-MM-DD".
 */
function getHojeSaoPaulo(): string {
  const now = new Date()
  // Intl para extrair componentes no timezone correto
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(now) // "YYYY-MM-DD"
}

/**
 * Cria um erro HTTP com statusCode e message para ser tratado na camada de rotas.
 */
function httpError(statusCode: number, message: string): never {
  const err: any = new Error(message)
  err.statusCode = statusCode
  throw err
}

// ─── Service ────────────────────────────────────────────────────────────────────

export class AgendaService {
  /**
   * Cria um novo agendamento com validação de conflitos e integração com AutoScheduler.
   *
   * Fluxo:
   * 1. Validar dataPrevista não no passado
   * 2. Se autoAgendar=true e sem horários → usar AutoScheduler
   * 3. Validar horaFim > horaInicio
   * 4. Validar conflito via ValidacaoService
   * 5. Resolver fornecedorId de fornecedorCnpj se necessário
   * 6. Persistir agendamento
   */
  async criarAgendamento(input: CriarAgendamentoInput, empresaId: string) {
    const {
      docaId,
      dataPrevista,
      autoAgendar,
      duracaoMinutos,
      fornecedorCnpj,
      fornecedorId,
      pedidoCompraId,
      motorista,
      placa,
      tipoVeiculo,
      qtdCaixas,
      qtdPaletes,
      observacao,
    } = input

    let horaInicio = input.horaInicio
    let horaFim = input.horaFim

    // 1. Validar dataPrevista não no passado
    const hojeSP = getHojeSaoPaulo()
    const dataStr = dataPrevista.split('T')[0] || dataPrevista

    if (dataStr < hojeSP) {
      httpError(422, 'Não é possível agendar para uma data que já passou')
    }

    // 2. Se autoAgendar=true e sem horários → encontrar próximo slot
    if (autoAgendar && !horaInicio && !horaFim) {
      if (!docaId) {
        httpError(422, 'docaId é obrigatório para auto-agendamento')
      }
      const duracao = duracaoMinutos || 60
      const slot = await autoSchedulerService.encontrarProximoSlot(docaId, dataStr, duracao, empresaId)
      if (!slot) {
        httpError(422, 'Nenhum horário disponível nesta doca para a data selecionada')
      }
      horaInicio = slot.horaInicio
      horaFim = slot.horaFim
    }

    // 3. Validar horaInicio e horaFim presentes
    if (!horaInicio || !horaFim) {
      httpError(400, 'horaInicio e horaFim são obrigatórios (ou use autoAgendar: true)')
    }

    // 4. Validar horaFim > horaInicio
    if (horaFim <= horaInicio) {
      httpError(422, 'horaFim deve ser maior que horaInicio')
    }

    // 5. Validar conflito (se docaId informado)
    if (docaId) {
      const validacao = await validacaoService.validarConflito(
        {
          docaId,
          dataPrevista: dataStr,
          horaInicio,
          horaFim,
        },
        empresaId,
      )
      if (validacao.conflito) {
        httpError(409, validacao.motivo || 'Conflito de agendamento detectado')
      }
    }

    // 6. Resolver fornecedorId pelo CNPJ se não informado diretamente
    let resolvedFornecedorId = fornecedorId || null
    if (!resolvedFornecedorId && fornecedorCnpj) {
      const forn = await prisma.fornecedor.findFirst({
        where: { empresaId, cnpj: fornecedorCnpj },
        select: { id: true },
      })
      if (forn) resolvedFornecedorId = forn.id
    }

    // 7. Persistir
    const agenda = await prisma.$transaction(async (tx) => {
      const criado = await tx.agendaWms.create({
        data: {
          empresaId,
          fornecedorId: resolvedFornecedorId,
          pedidoCompraId: pedidoCompraId || null,
          docaId: docaId || null,
          dataPrevista: new Date(dataStr + 'T00:00:00'),
          horaInicio,
          horaFim,
          motorista: motorista || null,
          placa: placa || null,
          tipoVeiculo: tipoVeiculo || null,
          qtdCaixas: qtdCaixas ?? null,
          qtdPaletes: qtdPaletes ?? null,
          observacao: observacao || null,
        },
      })

      // Sincronização bidirecional (Requirement 1.4): se já existe uma
      // NotaEntrada com dados de transporte para o pedido/fornecedor vinculado,
      // aplica-os na Agenda recém-criada agora.
      await sincronizarDadosTransporte(tx, empresaId, {
        pedidoCompraId: criado.pedidoCompraId,
        fornecedorId: criado.fornecedorId,
      })

      return criado
    })

    return agenda
  }

  /**
   * Edita um agendamento existente com revalidação de conflito quando
   * docaId/horaInicio/horaFim são alterados.
   *
   * Bloqueia edição de agendamentos com status RECEBIDO ou CANCELADO (HTTP 422).
   */
  async editarAgendamento(id: string, input: EditarAgendamentoInput, empresaId: string) {
    const ag = await prisma.agendaWms.findFirst({ where: { id, empresaId } })
    if (!ag) {
      httpError(404, 'Agendamento não encontrado')
    }

    // Bloquear estados finais
    if (ag.status === 'RECEBIDO' || ag.status === 'CANCELADO') {
      httpError(422, `Não é possível editar agendamento com status ${ag.status}`)
    }

    const novaDocaId = input.docaId || ag.docaId
    const novaHoraInicio = input.horaInicio || ag.horaInicio
    const novaHoraFim = input.horaFim || ag.horaFim
    const novaDataPrevista = input.dataPrevista || ag.dataPrevista.toISOString().split('T')[0]

    // Validar dataPrevista se fornecida
    if (input.dataPrevista) {
      const hojeSP = getHojeSaoPaulo()
      if (input.dataPrevista < hojeSP) {
        httpError(422, 'Não é possível agendar para uma data que já passou')
      }
    }

    // Validar horaFim > horaInicio (se ambos definidos)
    if (novaHoraInicio && novaHoraFim && novaHoraFim <= novaHoraInicio) {
      httpError(422, 'horaFim deve ser maior que horaInicio')
    }

    // Se mudou doca ou horário, revalidar conflitos (excluindo self)
    const mudouSlot = input.docaId || input.horaInicio || input.horaFim || input.dataPrevista
    if (mudouSlot && novaDocaId && novaHoraInicio && novaHoraFim) {
      const dataStr =
        typeof novaDataPrevista === 'string'
          ? novaDataPrevista.split('T')[0]
          : new Date(novaDataPrevista).toISOString().split('T')[0]

      const validacao = await validacaoService.validarConflito(
        {
          docaId: novaDocaId,
          dataPrevista: dataStr,
          horaInicio: novaHoraInicio,
          horaFim: novaHoraFim,
          excluirId: id,
        },
        empresaId,
      )
      if (validacao.conflito) {
        httpError(409, validacao.motivo || 'Conflito de agendamento detectado')
      }
    }

    // Persistir alterações
    const atualizado = await prisma.agendaWms.update({
      where: { id },
      data: {
        ...(input.docaId !== undefined && { docaId: input.docaId }),
        ...(input.dataPrevista !== undefined && { dataPrevista: new Date(input.dataPrevista + 'T00:00:00') }),
        ...(input.horaInicio !== undefined && { horaInicio: input.horaInicio }),
        ...(input.horaFim !== undefined && { horaFim: input.horaFim }),
        ...(input.fornecedorId !== undefined && { fornecedorId: input.fornecedorId }),
        ...(input.pedidoCompraId !== undefined && { pedidoCompraId: input.pedidoCompraId }),
        ...(input.motorista !== undefined && { motorista: input.motorista || null }),
        ...(input.placa !== undefined && { placa: input.placa || null }),
        ...(input.tipoVeiculo !== undefined && { tipoVeiculo: input.tipoVeiculo || null }),
        ...(input.qtdCaixas !== undefined && { qtdCaixas: input.qtdCaixas }),
        ...(input.qtdPaletes !== undefined && { qtdPaletes: input.qtdPaletes }),
        ...(input.observacao !== undefined && { observacao: input.observacao || null }),
      },
    })

    return atualizado
  }

  /**
   * Move um agendamento para nova doca e/ou novo horário (drag-and-drop).
   *
   * Bloqueia movimentação de agendamentos com status RECEBIDO ou CANCELADO (HTTP 422).
   * Valida conflitos no novo slot (excluindo self).
   */
  async moverAgendamento(id: string, input: MoverAgendamentoInput, empresaId: string) {
    const ag = await prisma.agendaWms.findFirst({ where: { id, empresaId } })
    if (!ag) {
      httpError(404, 'Agendamento não encontrado')
    }

    // Bloquear estados finais
    if (ag.status === 'RECEBIDO' || ag.status === 'CANCELADO') {
      httpError(422, `Não é possível mover agendamento com status ${ag.status}`)
    }

    const novaDocaId = input.docaId || ag.docaId
    const { horaInicio, horaFim } = input

    // Validar horaFim > horaInicio
    if (horaFim <= horaInicio) {
      httpError(422, 'horaFim deve ser maior que horaInicio')
    }

    // Validar conflitos no novo slot
    if (novaDocaId) {
      const dataStr = ag.dataPrevista.toISOString().split('T')[0]
      const validacao = await validacaoService.validarConflito(
        {
          docaId: novaDocaId,
          dataPrevista: dataStr,
          horaInicio,
          horaFim,
          excluirId: id,
        },
        empresaId,
      )
      if (validacao.conflito) {
        httpError(409, validacao.motivo || 'Conflito de agendamento detectado')
      }
    }

    // Persistir
    const atualizado = await prisma.agendaWms.update({
      where: { id },
      data: {
        ...(input.docaId && { docaId: input.docaId }),
        horaInicio,
        horaFim,
      },
    })

    return atualizado
  }

  /**
   * Lista agendamentos com filtros, paginação e enriquecimento de dados.
   *
   * Filtros suportados:
   * - status: StatusAgenda (string ou array)
   * - dataPrevista (data): filtra dia específico + sempre inclui NA_DOCA/CONFERINDO
   * - dataInicio/dataFim: filtra range + sempre inclui NA_DOCA/CONFERINDO
   * - docaId: filtra por doca
   * - page/limit: paginação
   *
   * Enriquecimento: fornecedor, pedido (com itens), doca, notaEntrada
   */
  async listarAgendamentos(filtros: ListarAgendamentosFiltros, empresaId: string) {
    const { status, dataPrevista, dataInicio, dataFim, docaId, page = 1, limit = 50 } = filtros

    const where: any = { empresaId }

    if (status) {
      where.status = Array.isArray(status) ? { in: status } : status
    }
    if (docaId) {
      where.docaId = docaId
    }

    // Filtro por dia específico — mas SEMPRE inclui agendamentos em andamento
    if (dataPrevista) {
      const dia = new Date(dataPrevista + 'T00:00:00.000Z')
      const diaFim = new Date(dataPrevista + 'T00:00:00.000Z')
      diaFim.setUTCDate(diaFim.getUTCDate() + 1)
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

    const [dataResult, total] = await Promise.all([
      prisma.agendaWms.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ dataPrevista: 'asc' }, { horaInicio: 'asc' }],
      }),
      prisma.agendaWms.count({ where }),
    ])

    // Enriquecer com dados do pedido, fornecedor, doca e nota fiscal
    const enriched = await Promise.all(
      dataResult.map(async (ag) => {
        let pedido: any = null
        let fornecedor: any = null
        let doca: any = null
        let notaEntrada: any = null

        // Pedido e NF via XML
        if (ag.pedidoCompraId) {
          pedido = await prisma.pedidoCompra.findUnique({
            where: { id: ag.pedidoCompraId },
            select: {
              numero: true,
              valorTotal: true,
              itens: { include: { produto: { select: { nome: true, codigo: true } } } },
            },
          })

          // Buscar NF via compra efetivada
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

        // Fallback NF: buscar nota de entrada pelo fornecedor
        if (!notaEntrada && ag.fornecedorId) {
          const forn = await prisma.fornecedor.findUnique({
            where: { id: ag.fornecedorId },
            select: { cnpj: true },
          })
          if (forn) {
            const nota = await prisma.notaEntrada.findFirst({
              where: { fornecedorDoc: forn.cnpj },
              orderBy: { criadoEm: 'desc' },
              select: { numero: true, serie: true },
            })
            if (nota) {
              notaEntrada = { numero: String(nota.numero), serie: nota.serie }
            }
          }
        }

        // Fallback NF: usar número do pedido
        if (!notaEntrada && pedido) {
          notaEntrada = { numero: String(pedido.numero), serie: null }
        }

        // Fallback NF: buscar compra efetivada recente do fornecedor
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

        // Fornecedor
        if (ag.fornecedorId) {
          fornecedor = await prisma.fornecedor.findUnique({
            where: { id: ag.fornecedorId },
            select: { razaoSocial: true, nomeFantasia: true, cnpj: true },
          })
        }

        // Doca
        if (ag.docaId) {
          doca = await prisma.doca.findUnique({
            where: { id: ag.docaId },
            select: { descricao: true, tipo: true },
          })
        }

        return { ...ag, pedido, fornecedor, doca, notaEntrada }
      }),
    )

    return { data: enriched, total }
  }

  /**
   * Obtém detalhe de um agendamento com dados enriquecidos:
   * fornecedor completo, pedido com itens, doca, nota fiscal.
   */
  async obterDetalhe(id: string, empresaId: string) {
    const ag = await prisma.agendaWms.findFirst({ where: { id, empresaId } })
    if (!ag) {
      httpError(404, 'Agendamento não encontrado')
    }

    let pedido: any = null
    let fornecedor: any = null
    let doca: any = null
    let notaEntrada: any = null

    if (ag.pedidoCompraId) {
      pedido = await prisma.pedidoCompra.findUnique({
        where: { id: ag.pedidoCompraId },
        include: {
          itens: { include: { produto: { select: { nome: true, codigo: true } } } },
        },
      })

      // Buscar NF via compra efetivada
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

    // Fallback NF: nota de entrada pelo fornecedor
    if (!notaEntrada && ag.fornecedorId) {
      const forn = await prisma.fornecedor.findUnique({
        where: { id: ag.fornecedorId },
        select: { cnpj: true },
      })
      if (forn) {
        const nota = await prisma.notaEntrada.findFirst({
          where: { fornecedorDoc: forn.cnpj },
          orderBy: { criadoEm: 'desc' },
          select: { numero: true, serie: true },
        })
        if (nota) {
          notaEntrada = { numero: String(nota.numero), serie: nota.serie }
        }
      }
    }

    if (ag.fornecedorId) {
      fornecedor = await prisma.fornecedor.findUnique({ where: { id: ag.fornecedorId } })
    }

    if (ag.docaId) {
      doca = await prisma.doca.findUnique({ where: { id: ag.docaId } })
    }

    return { ...ag, pedido, fornecedor, doca, notaEntrada }
  }

  // ─── Transição de Status com Side-Effects ───────────────────────────────────

  /**
   * Altera o status de um agendamento dentro de uma transação atômica,
   * executando side-effects correspondentes ao novo status.
   *
   * Side-effects:
   * - NA_DOCA: registra horaChegadaReal, cria NotaEntrada do XML se não existe
   * - CONFERINDO: atualiza NotaEntrada → EM_CONFERENCIA, cria/atualiza OrdemServicoWms
   * - RECEBIDO: atualiza PedidoCompra → RECEBIDO, calcula tempoPermDocaMin
   *
   * Rollback completo se qualquer side-effect falhar.
   *
   * @throws 404 se agendamento não encontrado
   * @throws 422 se transição de status inválida
   */
  async alterarStatus(id: string, novoStatus: StatusAgenda, empresaId: string, userId: string) {
    return prisma.$transaction(async (tx) => {
      const ag = await tx.agendaWms.findFirst({ where: { id, empresaId } })
      if (!ag) {
        httpError(404, 'Agendamento não encontrado')
      }

      // Validar transição de status
      const erro = validacaoService.validarTransicaoStatus(ag.status as StatusAgenda, novoStatus)
      if (erro) {
        httpError(422, erro.message)
      }

      // Helper: buscar CNPJ do fornecedor
      let fornecedorDoc = ''
      if (ag.fornecedorId) {
        const forn = await tx.fornecedor.findUnique({
          where: { id: ag.fornecedorId },
          select: { cnpj: true },
        })
        if (forn) fornecedorDoc = forn.cnpj
      }

      // Helper: buscar XML da compra efetivada
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

      // Helper: criar NotaEntrada a partir de XML
      const criarNotaEntradaDoXml = async (xml: string) => {
        const parsed = parseNfeXml(xml)

        const itensXml = parsed.itens.map((i) => ({
          item: i.item,
          descricao: i.descricao,
          codigoProduto: i.codigoProduto,
          unidade: i.unidade || 'UN',
          quantidade: i.quantidade,
          lote: i.lote || null,
          validade: i.validade ? new Date(i.validade) : null,
        }))

        if (itensXml.length > 0) {
          const nota = await tx.notaEntrada.create({
            data: {
              numero: parsed.numero,
              serie: parsed.serie || null,
              fornecedor: parsed.fornecedor || null,
              fornecedorDoc: parsed.fornecedorDocRaw || fornecedorDoc,
              transportadoraUf: parsed.transporte.ufVeiculo,
              transportadoraRntc: parsed.transporte.rntc,
              dataEntrada: new Date(),
              status: 'PENDENTE',
              itens: { create: itensXml },
            },
          })

          await sincronizarDadosTransporte(tx, empresaId, {
            pedidoCompraId: ag.pedidoCompraId,
            fornecedorId: ag.fornecedorId,
          })

          return nota
        }
        return null
      }

      // ── Side-effect: NA_DOCA ──
      if (novoStatus === 'NA_DOCA') {
        // Verificar se já existe nota pendente para este fornecedor
        const notaExistente = await tx.notaEntrada.findFirst({
          where: { fornecedorDoc, status: { in: ['PENDENTE', 'EM_CONFERENCIA'] } },
          orderBy: { criadoEm: 'desc' },
        })

        if (!notaExistente) {
          const compraXml = await buscarXmlCompra()
          if (compraXml) {
            await criarNotaEntradaDoXml(compraXml)
          }
        }
      }

      // ── Side-effect: CONFERINDO ──
      if (novoStatus === 'CONFERINDO') {
        // Garantir que a nota existe (caso NA_DOCA tenha sido pulado)
        let nota = await tx.notaEntrada.findFirst({
          where: { fornecedorDoc, status: { in: ['PENDENTE', 'EM_CONFERENCIA'] } },
          orderBy: { criadoEm: 'desc' },
        })

        // Se não existe, criar a partir do XML da compra
        if (!nota) {
          const compraXml = await buscarXmlCompra()
          if (compraXml) {
            nota = await criarNotaEntradaDoXml(compraXml)
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
            where: {
              agendaWmsId: ag.id,
              operacao: 'CONFERENCIA',
              status: { in: ['ABERTO', 'EXECUTANDO'] },
            },
          })
          if (osConferencia) {
            await tx.ordemServicoWms.update({
              where: { id: osConferencia.id },
              data: {
                notaEntradaId: nota.id,
                status: 'EXECUTANDO',
                horaInicio: osConferencia.horaInicio || new Date(),
              },
            })
          } else {
            // Criar OS se não existe
            const ultimaOs = await tx.ordemServicoWms.findFirst({
              where: { empresaId },
              orderBy: { numero: 'desc' },
              select: { numero: true },
            })
            await tx.ordemServicoWms.create({
              data: {
                empresaId,
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

      // ── Side-effect: RECEBIDO ──
      if (novoStatus === 'RECEBIDO') {
        if (ag.pedidoCompraId) {
          await tx.pedidoCompra.update({
            where: { id: ag.pedidoCompraId },
            data: { status: 'RECEBIDO' },
          })
        }
      }

      // Atualizar status + campos calculados
      const atualizado = await tx.agendaWms.update({
        where: { id },
        data: {
          status: novoStatus,
          ...(novoStatus === 'NA_DOCA' && !ag.horaChegadaReal
            ? { horaChegadaReal: new Date() }
            : {}),
          ...(novoStatus === 'RECEBIDO' && ag.horaChegadaReal
            ? { tempoPermDocaMin: calcularPermanencia(ag.horaChegadaReal) }
            : {}),
        },
      })

      return atualizado
    })
  }

  /**
   * Atalho para concluir recebimento — valida que não está já RECEBIDO e
   * chama alterarStatus com 'RECEBIDO'.
   *
   * @throws 404 se agendamento não encontrado
   * @throws 422 se já está com status RECEBIDO
   */
  async concluirRecebimento(id: string, empresaId: string, userId: string) {
    const ag = await prisma.agendaWms.findFirst({ where: { id, empresaId } })
    if (!ag) {
      httpError(404, 'Agendamento não encontrado')
    }
    if (ag.status === 'RECEBIDO') {
      httpError(422, 'Já concluído')
    }

    await this.alterarStatus(id, 'RECEBIDO', empresaId, userId)
    return { message: 'Recebimento concluído' }
  }

  /**
   * Registra a chegada manual de um veículo na doca.
   * Atualiza horaChegadaReal e muda status para NA_DOCA.
   *
   * @param horaChegada - Timestamp ISO opcional; se não fornecido, usa Date.now()
   * @throws 404 se agendamento não encontrado
   */
  async registrarChegada(id: string, empresaId: string, horaChegada?: string) {
    const ag = await prisma.agendaWms.findFirst({ where: { id, empresaId } })
    if (!ag) {
      httpError(404, 'Agendamento não encontrado')
    }

    const horaChegadaReal = horaChegada ? new Date(horaChegada) : new Date()

    const atualizado = await prisma.agendaWms.update({
      where: { id },
      data: {
        horaChegadaReal,
        status: 'NA_DOCA',
      },
    })

    return atualizado
  }
}


export const agendaService = new AgendaService()
