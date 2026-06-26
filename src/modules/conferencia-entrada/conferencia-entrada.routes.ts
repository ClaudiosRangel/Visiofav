import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import {
  filtrarDadosConforme,
  validarCamposObrigatorios,
  type ConfigConferenciaCega,
  type ItemConferenciaInput,
  type ProdutoConfig,
} from './conferencia-cega.service'
import { compararValidade, verificarProdutoVencido } from './validade.service'
import { CceService } from '../cce/cce.service'
import { registrarSaldoPendente, receberSaldo, verificarNotaCompleta } from './recebimento-parcial.service'
import { registrarMovimentacoesEntradaNota } from '../faturamento/movimentacao-faturavel.service'
import { verificarPendenciasAbertas } from '../pendencia-cce/pendencia-cce.service'
import { notaTemItensPendenteSegundaConferencia } from './divergencia-lote-validade.service'
import { executarSegundaConferencia } from './segunda-conferencia.service'

/**
 * Parseia data no formato DD/MM/AAAA (brasileiro) ou ISO (AAAA-MM-DD).
 */
function parseDateBR(value: string | null | undefined): Date | null {
  if (!value) return null
  const brMatch = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (brMatch) {
    const [, dia, mes, ano] = brMatch
    return new Date(Number(ano), Number(mes) - 1, Number(dia))
  }
  const isoDate = new Date(value)
  if (!isNaN(isoDate.getTime())) return isoDate
  return null
}

const idParamsSchema = z.object({ id: z.string().uuid() })

const conferirItemSchema = z.object({
  itemNotaEntradaId: z.string().uuid(),
  quantidadeConferida: z.number().min(0).optional().nullable(),
  lote: z.string().optional().nullable(),
  validade: z.string().optional().nullable(),
  observacao: z.string().optional().nullable(),
})

const aceitarDivergenciaSchema = z.object({
  itemNotaEntradaId: z.string().uuid(),
  quantidadeAceita: z.number().min(0),
  observacao: z.string().optional().nullable(),
})

const receberSaldoSchema = z.object({
  itemNotaEntradaId: z.string().uuid(),
  quantidadeRecebida: z.number().positive(),
  lote: z.string().optional().nullable(),
  validade: z.string().optional().nullable(),
})

const notaIdParamsSchema = z.object({ notaId: z.string().uuid() })

const segundaConferenciaSchema = z.object({
  itens: z.array(z.object({
    itemNotaEntradaId: z.string().uuid(),
    quantidadeConferida: z.number().min(0),
    lote: z.string().optional(),
    validade: z.string().optional(),
  })),
})

export async function conferenciaEntradaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // GET /notas-pendentes — notas de entrada pendentes de conferência
  app.get('/notas-pendentes', async () => {
    const notas = await prisma.notaEntrada.findMany({
      where: { status: { in: ['PENDENTE', 'EM_CONFERENCIA'] } },
      orderBy: { criadoEm: 'desc' },
      include: { itens: true },
    })

    return notas.map((n) => {
      const totalItens = n.itens.length
      // Conferência cega: não mostra quantidades esperadas
      return {
        id: n.id,
        numero: n.numero,
        serie: n.serie,
        fornecedor: n.fornecedor,
        fornecedorDoc: n.fornecedorDoc,
        dataEntrada: n.dataEntrada,
        status: n.status,
        totalItens,
      }
    })
  })

  // GET /notas-parciais — notas com saldo pendente (PARCIALMENTE_RECEBIDO)
  // Registered BEFORE /:id to avoid Fastify interpreting "notas-parciais" as an :id param
  app.get('/notas-parciais', async (request) => {
    const user = request.user as { id: string; empresaId?: string }
    const empresaId = user.empresaId

    if (!empresaId) {
      return []
    }

    const notas = await prisma.notaEntrada.findMany({
      where: {
        empresaId,
        statusRecebimento: 'PARCIALMENTE_RECEBIDO',
      },
      orderBy: { criadoEm: 'desc' },
      include: {
        itens: true,
        saldosPendentes: {
          where: { status: 'PENDENTE' },
        },
      },
    })

    return notas.map((nota) => ({
      id: nota.id,
      numero: nota.numero,
      serie: nota.serie,
      fornecedor: nota.fornecedor,
      fornecedorDoc: nota.fornecedorDoc,
      dataEntrada: nota.dataEntrada,
      statusRecebimento: nota.statusRecebimento,
      totalItens: nota.itens.length,
      itensPendentes: nota.saldosPendentes.map((saldo) => ({
        id: saldo.id,
        itemNotaEntradaId: saldo.itemNotaEntradaId,
        quantidadeNf: Number(saldo.quantidadeNf),
        quantidadeRecebida: Number(saldo.quantidadeRecebida),
        saldoPendente: Number(saldo.saldoPendente),
        status: saldo.status,
      })),
    }))
  })

  // GET /:id — detalhe da nota para conferência
  app.get('/:id', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)
    const user = request.user as { id: string; empresaId?: string }

    const nota = await prisma.notaEntrada.findUnique({
      where: { id },
      include: { itens: true },
    })

    if (!nota) return reply.status(404).send({ message: 'Nota não encontrada' })

    // Buscar configurações de conferência cega da Empresa
    const empresaId = user.empresaId || nota.empresaId
    let config: ConfigConferenciaCega = {
      conferenciaQuantidadeCega: false,
      conferenciaLoteCega: false,
    }

    if (empresaId) {
      const empresa = await prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { conferenciaQuantidadeCega: true, conferenciaLoteCega: true },
      })
      if (empresa) {
        config = {
          conferenciaQuantidadeCega: empresa.conferenciaQuantidadeCega,
          conferenciaLoteCega: empresa.conferenciaLoteCega,
        }
      }
    }

    // Buscar exigeLote de cada produto (pelo codigoProduto)
    const codigosProduto = nota.itens
      .map((item) => item.codigoProduto)
      .filter((c): c is string => c !== null)

    const produtosMap = new Map<string, boolean>()
    if (codigosProduto.length > 0 && empresaId) {
      const produtos = await prisma.produto.findMany({
        where: { empresaId, codigo: { in: codigosProduto } },
        select: { codigo: true, exigeLote: true },
      })
      for (const p of produtos) {
        produtosMap.set(p.codigo, p.exigeLote)
      }
    }

    // Aplicar filtrarDadosConforme para cada item do DTO de resposta
    const itens = nota.itens.map((item) => {
      const input: ItemConferenciaInput = {
        id: item.id,
        descricao: item.descricao,
        codigoProduto: item.codigoProduto ?? '',
        unidade: item.unidade,
        quantidadeEsperada: Number(item.quantidade),
        lote: item.lote,
        validade: item.validade,
      }

      const dto = filtrarDadosConforme(input, config)

      return {
        ...dto,
        item: item.item,
        exigeLote: item.codigoProduto ? (produtosMap.get(item.codigoProduto) ?? false) : false,
      }
    })

    const { itens: _rawItens, ...notaData } = nota as any
    return { ...notaData, itens }
  })

  // POST /iniciar/:id — inicia conferência de uma nota
  app.post('/iniciar/:id', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)

    const nota = await prisma.notaEntrada.findUnique({ where: { id } })
    if (!nota) return reply.status(404).send({ message: 'Nota não encontrada' })
    if (nota.status !== 'PENDENTE') return reply.status(422).send({ message: `Nota em status ${nota.status}` })

    await prisma.notaEntrada.update({ where: { id }, data: { status: 'EM_CONFERENCIA' } })
    return { message: 'Conferência iniciada' }
  })

  // POST /:id/conferir-item — conferir um item com validação avançada
  app.post('/:id/conferir-item', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)
    const body = conferirItemSchema.parse(request.body)

    const user = request.user as { id: string; empresaId?: string }
    const empresaId = user.empresaId

    const nota = await prisma.notaEntrada.findUnique({ where: { id } })
    if (!nota) return reply.status(404).send({ message: 'Nota não encontrada' })

    const item = await prisma.itemNotaEntrada.findUnique({ where: { id: body.itemNotaEntradaId } })
    if (!item) return reply.status(404).send({ message: 'Item não encontrado' })
    if (item.notaEntradaId !== id) return reply.status(404).send({ message: 'Item não pertence a esta nota' })

    // ─── Buscar configurações da empresa ─────────────────────────────────────
    let config: ConfigConferenciaCega = {
      conferenciaQuantidadeCega: false,
      conferenciaLoteCega: false,
    }

    if (empresaId) {
      const empresa = await prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { conferenciaQuantidadeCega: true, conferenciaLoteCega: true },
      })
      if (empresa) {
        config = {
          conferenciaQuantidadeCega: empresa.conferenciaQuantidadeCega,
          conferenciaLoteCega: empresa.conferenciaLoteCega,
        }
      }
    }

    // ─── Buscar configuração do produto (exigeLote) ──────────────────────────
    let produtoConfig: ProdutoConfig = { exigeLote: false }

    if (item.codigoProduto && empresaId) {
      const produto = await prisma.produto.findFirst({
        where: { codigo: item.codigoProduto, empresaId },
        select: { exigeLote: true },
      })
      if (produto) {
        produtoConfig = { exigeLote: produto.exigeLote }
      }
    }

    // ─── Validar campos obrigatórios (conferência cega + exigeLote) ──────────
    const validacao = validarCamposObrigatorios(
      {
        itemNotaEntradaId: body.itemNotaEntradaId,
        quantidadeConferida: body.quantidadeConferida,
        lote: body.lote,
        validade: body.validade,
        observacao: body.observacao,
      },
      config,
      produtoConfig
    )

    if (!validacao.valido) {
      return reply.status(400).send({
        message: validacao.erro,
        campo: validacao.campo,
      })
    }

    // ─── Verificar produto vencido ───────────────────────────────────────────
    const validadeDigitada = parseDateBR(body.validade)

    const bloqueioVencimento = verificarProdutoVencido(validadeDigitada, new Date())
    if (bloqueioVencimento) {
      // Registrar divergência de produto vencido
      if (empresaId) {
        await prisma.divergenciaConferencia.create({
          data: {
            empresaId,
            notaEntradaId: id,
            itemNotaEntradaId: body.itemNotaEntradaId,
            tipo: 'PRODUTO_VENCIDO',
            validadeConferida: validadeDigitada,
            observacao: 'Produto com validade vencida detectado na conferência',
          },
        })
      }

      return reply.status(422).send({
        message: bloqueioVencimento.alerta,
        tipo: 'PRODUTO_VENCIDO',
        validadeDigitada: validadeDigitada,
        dataAtual: bloqueioVencimento.dataAtual,
      })
    }

    // ─── Comparar validade com a NF ──────────────────────────────────────────
    const validadeNf = item.validade
    const divergenciaValidade = compararValidade(validadeDigitada, validadeNf)

    if (divergenciaValidade) {
      // Registrar divergência de validade
      let divergenciaRegistrada = null
      if (empresaId) {
        divergenciaRegistrada = await prisma.divergenciaConferencia.create({
          data: {
            empresaId,
            notaEntradaId: id,
            itemNotaEntradaId: body.itemNotaEntradaId,
            tipo: divergenciaValidade.tipo,
            validadeEsperada: validadeNf,
            validadeConferida: validadeDigitada,
            observacao: body.observacao,
          },
        })
      }

      return {
        itemId: item.id,
        descricao: item.descricao,
        resultado: 'DIVERGENTE',
        tipoDivergencia: divergenciaValidade.tipo,
        divergenciaId: divergenciaRegistrada?.id ?? null,
        validadeEsperada: validadeNf,
        validadeConferida: validadeDigitada,
      }
    }

    // ─── Comparar quantidade ─────────────────────────────────────────────────
    const quantidadeEsperada = Number(item.quantidade)
    const quantidadeConferida = body.quantidadeConferida ?? quantidadeEsperada
    const resultado = quantidadeConferida === quantidadeEsperada ? 'CONFORME' : 'DIVERGENTE'
    const tipoDivergencia = quantidadeConferida < quantidadeEsperada
      ? 'QUANTIDADE_FALTA'
      : quantidadeConferida > quantidadeEsperada
        ? 'QUANTIDADE_EXCESSO'
        : null

    // Registrar divergência de quantidade se detectada
    let divergenciaRegistrada = null
    if (tipoDivergencia && empresaId) {
      divergenciaRegistrada = await prisma.divergenciaConferencia.create({
        data: {
          empresaId,
          notaEntradaId: id,
          itemNotaEntradaId: body.itemNotaEntradaId,
          tipo: tipoDivergencia,
          quantidadeEsperada: quantidadeEsperada,
          quantidadeConferida: quantidadeConferida,
          observacao: body.observacao,
        },
      })
    }

    // ─── Comparar lote (se lote da NF existe) ────────────────────────────────
    let divergenciaLote = null
    if (item.lote && body.lote && item.lote !== body.lote && empresaId) {
      divergenciaLote = await prisma.divergenciaConferencia.create({
        data: {
          empresaId,
          notaEntradaId: id,
          itemNotaEntradaId: body.itemNotaEntradaId,
          tipo: 'LOTE_DIVERGENTE',
          loteEsperado: item.lote,
          loteConferido: body.lote,
          observacao: body.observacao,
        },
      })
    }

    // ─── Atualizar item com lote/validade se informados ──────────────────────
    if (body.lote || body.validade) {
      await prisma.itemNotaEntrada.update({
        where: { id: body.itemNotaEntradaId },
        data: {
          lote: body.lote || item.lote,
          validade: validadeDigitada ?? item.validade,
        },
      })
    }

    // ─── Retornar resultado ao conferente ────────────────────────────────────
    const divergencias = [
      ...(divergenciaRegistrada ? [{ id: divergenciaRegistrada.id, tipo: tipoDivergencia }] : []),
      ...(divergenciaLote ? [{ id: divergenciaLote.id, tipo: 'LOTE_DIVERGENTE' }] : []),
    ]

    return {
      itemId: item.id,
      descricao: item.descricao,
      quantidadeEsperada,
      quantidadeConferida,
      resultado: divergencias.length > 0 ? 'DIVERGENTE' : resultado,
      tipoDivergencia: divergencias.length > 0
        ? divergencias.map(d => d.tipo).join(', ')
        : tipoDivergencia,
      divergencias: divergencias.length > 0 ? divergencias : undefined,
    }
  })

  // POST /:id/aceitar-divergencia — aceita divergência e dispara CC-e
  app.post('/:id/aceitar-divergencia', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)
    const body = aceitarDivergenciaSchema.parse(request.body)

    const user = request.user as { id: string; empresaId?: string }
    const empresaId = user.empresaId

    if (!empresaId) {
      return reply.status(400).send({ message: 'empresaId não identificado no usuário' })
    }

    // Validar que a nota existe
    const nota = await prisma.notaEntrada.findUnique({ where: { id } })
    if (!nota) return reply.status(404).send({ message: 'Nota não encontrada' })

    // Buscar divergência PENDENTE do item nesta nota
    const divergencia = await prisma.divergenciaConferencia.findFirst({
      where: {
        notaEntradaId: id,
        itemNotaEntradaId: body.itemNotaEntradaId,
        empresaId,
        status: 'PENDENTE',
      },
    })

    if (!divergencia) {
      return reply.status(404).send({ message: 'Divergência pendente não encontrada para este item' })
    }

    // Buscar item da nota para dados de quantidade NF
    const itemNota = await prisma.itemNotaEntrada.findUnique({
      where: { id: body.itemNotaEntradaId },
    })

    if (!itemNota || itemNota.notaEntradaId !== id) {
      return reply.status(404).send({ message: 'Item não pertence a esta nota' })
    }

    // Atualizar status da divergência para ACEITA
    await prisma.divergenciaConferencia.update({
      where: { id: divergencia.id },
      data: {
        status: 'ACEITA',
        observacao: body.observacao || divergencia.observacao,
      },
    })

    let resultadoCCe = null

    // Se divergência de quantidade: emitir CC-e automaticamente
    const isDivergenciaQuantidade = divergencia.tipo === 'QUANTIDADE_FALTA' || divergencia.tipo === 'QUANTIDADE_EXCESSO'

    if (isDivergenciaQuantidade) {
      const cceService = new CceService()
      resultadoCCe = await cceService.emitirCCe({
        empresaId,
        notaEntradaId: id,
        divergenciaId: divergencia.id,
        item: itemNota.descricao || `Item ${itemNota.item}`,
        quantidadeOriginal: Number(divergencia.quantidadeEsperada ?? itemNota.quantidade),
        quantidadeCorrigida: body.quantidadeAceita,
      })
    }

    // Se config permiteRecebimentoParcial ativa e quantidade aceita < quantidade NF: registrar saldo pendente
    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { permiteRecebimentoParcial: true },
    })

    const quantidadeNf = Number(itemNota.quantidade)
    let saldoPendente = null

    if (empresa?.permiteRecebimentoParcial && body.quantidadeAceita < quantidadeNf) {
      saldoPendente = await registrarSaldoPendente({
        empresaId,
        notaEntradaId: id,
        itemNotaEntradaId: body.itemNotaEntradaId,
        quantidadeNf,
        quantidadeRecebida: body.quantidadeAceita,
      })
    }

    return {
      message: 'Divergência aceita com sucesso',
      divergenciaId: divergencia.id,
      status: 'ACEITA',
      cce: resultadoCCe,
      saldoPendente: saldoPendente
        ? {
            id: saldoPendente.id,
            saldo: Number(saldoPendente.saldoPendente),
            quantidadeRecebida: body.quantidadeAceita,
            quantidadeNf,
          }
        : null,
    }
  })

  // POST /:id/receber-saldo — receber saldo pendente de nota parcial
  app.post('/:id/receber-saldo', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)
    const body = receberSaldoSchema.parse(request.body)

    const user = request.user as { id: string; empresaId?: string }
    const empresaId = user.empresaId

    if (!empresaId) {
      return reply.status(400).send({ message: 'empresaId não identificado no usuário' })
    }

    // Validar que a nota existe
    const nota = await prisma.notaEntrada.findUnique({ where: { id } })
    if (!nota) return reply.status(404).send({ message: 'Nota não encontrada' })

    // Buscar SaldoPendenteItem para o item informado
    const saldoItem = await prisma.saldoPendenteItem.findFirst({
      where: {
        notaEntradaId: id,
        itemNotaEntradaId: body.itemNotaEntradaId,
        empresaId,
        status: 'PENDENTE',
      },
    })

    if (!saldoItem) {
      return reply.status(404).send({ message: 'Saldo pendente não encontrado para este item' })
    }

    // Validar que a quantidade recebida não excede o saldo pendente
    const saldoDisponivel = Number(saldoItem.saldoPendente)
    if (body.quantidadeRecebida > saldoDisponivel) {
      return reply.status(422).send({
        message: `Quantidade recebida (${body.quantidadeRecebida}) excede o saldo pendente (${saldoDisponivel})`,
        saldoDisponivel,
        quantidadeRecebida: body.quantidadeRecebida,
      })
    }

    // Atualizar saldo
    const resultado = await receberSaldo(saldoItem.id, body.quantidadeRecebida)

    // Atualizar lote/validade no item se informados
    if (body.lote || body.validade) {
      const validadeDate = body.validade ? parseDateBR(body.validade) : undefined
      await prisma.itemNotaEntrada.update({
        where: { id: body.itemNotaEntradaId },
        data: {
          ...(body.lote ? { lote: body.lote } : {}),
          ...(validadeDate ? { validade: validadeDate } : {}),
        },
      })
    }

    // Verificar se nota completa (todos os saldos recebidos)
    const notaCompleta = await verificarNotaCompleta(id)

    return {
      message: resultado.completou
        ? 'Saldo recebido integralmente — item completo'
        : 'Saldo parcialmente recebido',
      saldoAtualizado: resultado.saldoAtualizado,
      completouItem: resultado.completou,
      notaCompleta,
    }
  })

  // POST /:id/concluir — conclui conferência
  app.post('/:id/concluir', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)

    const nota = await prisma.notaEntrada.findUnique({ where: { id }, include: { itens: true } })
    if (!nota) return reply.status(404).send({ message: 'Nota não encontrada' })

    // Bloqueio: verificar pendências CC-e abertas (Requirements 7.5, 7.6)
    const temPendenciasAbertas = await verificarPendenciasAbertas(id)
    if (temPendenciasAbertas) {
      return reply.status(422).send({
        error: {
          code: 'PENDENCIAS_NAO_RESOLVIDAS',
          message: 'Existem pendências CC-e não resolvidas para esta nota',
        },
      })
    }

    // Bloqueio: verificar itens pendentes de segunda conferência (Requirement 8.1)
    const temItensPendentes = await notaTemItensPendenteSegundaConferencia(id)
    if (temItensPendentes) {
      return reply.status(422).send({
        error: {
          code: 'ITENS_PENDENTES_SEGUNDA_CONFERENCIA',
          message: 'Existem itens pendentes de segunda conferência',
        },
      })
    }

    await prisma.notaEntrada.update({ where: { id }, data: { status: 'CONFERIDA' } })

    // Hook faturamento: registrar movimentações de entrada (non-blocking, pós-commit)
    const empresaId = (request.user as any).empresaId
    if (empresaId) {
      registrarMovimentacoesEntradaNota(empresaId, id).catch(() => {})
    }

    return { message: 'Conferência concluída', totalItens: nota.itens.length }
  })

  // POST /segunda-conferencia/:notaId — submete segunda conferência obrigatória
  app.post('/segunda-conferencia/:notaId', async (request, reply) => {
    const { notaId } = notaIdParamsSchema.parse(request.params)
    const { itens } = segundaConferenciaSchema.parse(request.body)

    const user = request.user as { id: string; empresaId?: string }
    const empresaId = user.empresaId

    if (!empresaId) {
      return reply.status(400).send({ message: 'empresaId não identificado no usuário' })
    }

    const resultado = await executarSegundaConferencia(notaId, itens, empresaId, user.id)

    // Mapear resultado para resposta com indicadores de ações tomadas
    const divergenciaResolvida = resultado.itens.some((i) => i.resultado.status === 'resolvido')
    const pendenciaCriada = resultado.itens.some((i) => i.resultado.status === 'pendenciaCriada')
    const emailEnviado = resultado.itens.some((i) => i.resultado.status === 'emailEnviado')
    const requerSenha = resultado.itens.some((i) => i.resultado.status === 'requerSenha')

    return {
      divergenciaResolvida,
      pendenciaCriada,
      emailEnviado,
      requerSenha,
      itens: resultado.itens,
    }
  })
}
