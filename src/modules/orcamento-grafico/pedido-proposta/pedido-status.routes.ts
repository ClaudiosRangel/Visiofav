/**
 * Rotas do status fiel do Pedido/Proposta (spec comercial-pedido-status-fiel).
 * Registradas sob o prefixo /api/orcamento-grafico (server.ts). authenticate +
 * empresaId EXPLÍCITO + permissões (Req 12). Mapeia StatusFielError→HTTP+code.
 */
import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../../middleware/authenticate'
import { prisma } from '../../../lib/prisma'
import { verificarPermissaoComercial } from '../permissoes-comercial.routes'
import { registrarEvento, solicitarTransicao } from './servico-eventos.service'
import {
  StatusFielError,
  statusMacroDe,
  setorDe,
  isTerminal,
  derivarTipoPedido,
  transicoesPermitidas,
  SITUACOES_VALIDAS,
  SETORES_VALIDOS,
  type Situacao,
  type Setor,
  type TipoPedido,
  type SituacaoCliente,
  type SituacaoFaca,
  type SituacaoArte,
} from './status-fiel.motor'

type Usuario = { id: string; empresaId: string; perfil?: string }

function tratarErro(err: unknown, reply: any) {
  if (err instanceof StatusFielError) {
    return reply.status(err.statusCode).send({ message: err.message, code: err.code })
  }
  if (err instanceof z.ZodError) {
    const issue = err.issues[0]
    return reply.status(400).send({
      message: `Dados inválidos — ${issue.path.join('.')}: ${issue.message}`,
      code: 'DADOS_INVALIDOS',
      campo: issue.path.join('.'),
    })
  }
  throw err
}

/** Carrega o pedido por empresa (404 cross-empresa — Req 11.4). */
async function carregar(empresaId: string, id: string) {
  const p = await prisma.pedidoProposta.findFirst({
    where: { id, empresaId },
    select: {
      id: true,
      empresaId: true,
      situacaoInterna: true,
      statusMacro: true,
      setorResponsavel: true,
      rodada: true,
      tipoPedidoDerivado: true,
      tipoPedido: true,
      tipoPedidoManual: true,
      situacaoCliente: true,
      situacaoFaca: true,
      numeroMatriz: true,
      situacaoArte: true,
      exigeProva: true,
    },
  })
  if (!p) throw new StatusFielError(404, 'Pedido não encontrado.', 'NAO_ENCONTRADO')
  return p
}

function tipoAtual(p: { tipoPedidoDerivado: string | null; tipoPedido: string | null }): TipoPedido {
  const t = p.tipoPedidoDerivado as TipoPedido | null
  if (t === 'REPETICAO' || t === 'ALTERACAO' || t === 'PRODUTO_NOVO') return t
  return p.tipoPedido === 'REPETICAO' ? 'REPETICAO' : 'PRODUTO_NOVO'
}

/** Status_Macro onde é permitido editar Respostas_Pedido / Tipo (Req 1.9). */
const STATUS_EDITAVEIS = ['RECEBIDO', 'EM_PRE_IMPRESSAO', 'EM_ORCAMENTO']

export async function pedidoStatusRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    if (!request.headers.authorization) {
      const q = request.query as { token?: string } | undefined
      if (q?.token) request.headers.authorization = `Bearer ${q.token}`
    }
  })
  app.addHook('onRequest', authenticate)

  // ── GET transições permitidas (Req 6.9) ──────────────────────────────────
  app.get('/pedidos-proposta/:id/transicoes', async (request, reply) => {
    const user = request.user as Usuario
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    try {
      const p = await carregar(user.empresaId, id)
      const atual = (p.situacaoInterna as Situacao) ?? 'TRIAGEM'
      const t = transicoesPermitidas(atual, tipoAtual(p))
      return { situacaoAtual: atual, ...t }
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // ── POST transição (Req 6) ────────────────────────────────────────────────
  app.post('/pedidos-proposta/:id/transicao', async (request, reply) => {
    const user = request.user as Usuario
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      destino: z.enum(SITUACOES_VALIDAS as [string, ...string[]]),
      motivo: z.string().max(500).optional(),
      idempotenciaChave: z.string().min(1).max(100).optional(),
    }).parse(request.body)
    try {
      const p = await carregar(user.empresaId, id)
      const destino = body.destino as Situacao

      // permissões por destino (Req 12)
      const acao =
        destino === 'APROVADO' ? 'podeAprovarOrcamento'
          : destino === 'EM_PRODUCAO' ? 'podeConverterPedido'
            : destino === 'PROPOSTA_ENVIADA_AGUARDA_CLIENTE' ? 'podeEnviarProposta'
              : destino === 'PERDIDO' || destino === 'CANCELADO' ? 'podeVerComercial'
                : 'podeVerComercial'
      if (!(await verificarPermissaoComercial(user.empresaId, user.id, user.perfil, acao))) {
        return reply.status(403).send({ message: 'Sem permissão para esta transição.', code: 'PERMISSAO_NEGADA' })
      }

      const r = await solicitarTransicao({
        empresaId: user.empresaId,
        pedidoId: id,
        destino,
        origem: `usuario:${user.id}`,
        motivo: body.motivo,
        idempotenciaChave: body.idempotenciaChave ?? `tr-${id}-${Date.now()}`,
      })
      return r
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // ── POST devolver (Retorno — Req 7) ───────────────────────────────────────
  app.post('/pedidos-proposta/:id/devolver', async (request, reply) => {
    const user = request.user as Usuario
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      setorDestino: z.enum(SETORES_VALIDOS as [string, ...string[]]),
      motivo: z.string().min(1).max(500),
      idempotenciaChave: z.string().min(1).max(100).optional(),
    }).parse(request.body)
    try {
      await carregar(user.empresaId, id)
      if (!(await verificarPermissaoComercial(user.empresaId, user.id, user.perfil, 'podeVerComercial'))) {
        return reply.status(403).send({ message: 'Sem permissão para devolver.', code: 'PERMISSAO_NEGADA' })
      }
      const r = await solicitarTransicao({
        empresaId: user.empresaId,
        pedidoId: id,
        destino: { setor: body.setorDestino as Setor },
        origem: `usuario:${user.id}`,
        motivo: body.motivo,
        idempotenciaChave: body.idempotenciaChave ?? `dv-${id}-${Date.now()}`,
        intencao: 'DEVOLVER',
      })
      return r
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // ── GET linha do tempo (Req 8.6) ──────────────────────────────────────────
  app.get('/pedidos-proposta/:id/linha-do-tempo', async (request, reply) => {
    const user = request.user as Usuario
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const q = z.object({
      page: z.coerce.number().int().min(1).optional().default(1),
      size: z.coerce.number().int().min(1).max(200).optional().default(50),
    }).parse(request.query)
    try {
      await carregar(user.empresaId, id)
      const [itens, total] = await Promise.all([
        prisma.logPedidoProposta.findMany({
          where: { empresaId: user.empresaId, pedidoPropostaId: id },
          orderBy: { criadoEm: 'asc' },
          skip: (q.page - 1) * q.size,
          take: q.size,
          select: {
            id: true, tipoEvento: true, origem: true, usuarioId: true, motivo: true,
            setorOrigem: true, setorDestino: true, situacaoAnterior: true, situacaoNova: true,
            estadoAnterior: true, estadoNovo: true, criadoEm: true,
          },
        }),
        prisma.logPedidoProposta.count({ where: { empresaId: user.empresaId, pedidoPropostaId: id } }),
      ])
      return { itens, total, page: q.page, size: q.size }
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // ── PATCH respostas do pedido (Req 1) ─────────────────────────────────────
  app.patch('/pedidos-proposta/:id/respostas', async (request, reply) => {
    const user = request.user as Usuario
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      situacaoCliente: z.enum(['NOVO', 'EXISTENTE']).optional(),
      situacaoFaca: z.enum(['NOVA', 'EXISTENTE', 'NAO_INFORMADA']).optional(),
      numeroMatriz: z.string().max(80).optional().nullable(),
      situacaoArte: z.enum(['CRIAR', 'CLIENTE_ENVIA', 'EXISTENTE_SEM_ALTERACAO', 'EXISTENTE_COM_ALTERACAO', 'NAO_INFORMADA']).optional(),
      exigeProva: z.boolean().optional(),
      referenciaOrigemTipo: z.enum(['CALCULO', 'PROPOSTA', 'OP', 'PEDIDO']).optional().nullable(),
      referenciaOrigemNumero: z.string().max(60).optional().nullable(),
    }).parse(request.body)
    try {
      const p = await carregar(user.empresaId, id)
      if (!(await verificarPermissaoComercial(user.empresaId, user.id, user.perfil, 'podeVerComercial'))) {
        return reply.status(403).send({ message: 'Sem permissão.', code: 'PERMISSAO_NEGADA' })
      }
      const macro = p.statusMacro ?? statusMacroDe((p.situacaoInterna as Situacao) ?? 'TRIAGEM')
      if (!STATUS_EDITAVEIS.includes(macro)) {
        return reply.status(409).send({ message: 'Respostas só podem ser alteradas em Recebido/Pré-Impressão/Orçamento.', code: 'TIPO_PEDIDO_BLOQUEADO' })
      }

      const novoCliente = (body.situacaoCliente ?? p.situacaoCliente) as SituacaoCliente | null
      const novaFaca = (body.situacaoFaca ?? p.situacaoFaca) as SituacaoFaca | null
      const novaArte = (body.situacaoArte ?? p.situacaoArte) as SituacaoArte | null
      const novaProva = body.exigeProva ?? p.exigeProva

      // resolve referência de origem (Req 1.12/1.13)
      let refCalculoId: string | null = null
      let refNaoLocalizada = false
      if (body.referenciaOrigemTipo && body.referenciaOrigemNumero) {
        if (body.referenciaOrigemTipo === 'CALCULO') {
          const num = parseInt(body.referenciaOrigemNumero.replace(/\D/g, ''), 10)
          const calc = Number.isFinite(num)
            ? await prisma.calculoGrafico.findFirst({
                where: { empresaId: user.empresaId, OR: [{ numero: num }, { numeroCalcgraf: num }] },
                select: { id: true },
              })
            : null
          if (calc) refCalculoId = calc.id
          else refNaoLocalizada = true
        } else {
          refNaoLocalizada = true // outros tipos: guarda texto, sem vínculo nesta fase
        }
      }

      // rederiva o tipo quando não está travado manualmente (Req 1.8)
      const deriv = derivarTipoPedido({ situacaoFaca: novaFaca, situacaoArte: novaArte, exigeProva: novaProva })
      const divergente = p.tipoPedidoManual ? deriv.tipo !== (p.tipoPedidoDerivado as TipoPedido) : false

      await prisma.pedidoProposta.update({
        where: { id },
        data: {
          situacaoCliente: novoCliente,
          situacaoFaca: novaFaca,
          numeroMatriz: novaFaca === 'EXISTENTE' ? (body.numeroMatriz ?? p.numeroMatriz ?? null) : null,
          situacaoArte: novaArte,
          exigeProva: novaProva ?? false,
          referenciaOrigemTipo: body.referenciaOrigemTipo ?? undefined,
          referenciaOrigemNumero: body.referenciaOrigemNumero ?? undefined,
          referenciaOrigemTexto: refNaoLocalizada ? `${body.referenciaOrigemTipo} ${body.referenciaOrigemNumero}` : null,
          referenciaOrigemCalculoId: refCalculoId,
          referenciaOrigemNaoLocalizada: refNaoLocalizada,
          ...(p.tipoPedidoManual
            ? { tipoPedidoDivergente: divergente }
            : { tipoPedidoDerivado: deriv.tipo, classificacaoAConfirmar: deriv.aConfirmar }),
        },
      })

      await registrarEvento({
        empresaId: user.empresaId,
        pedidoId: id,
        tipoEvento: 'RESPOSTAS_ALTERADAS',
        origem: `usuario:${user.id}`,
        dados: { situacaoCliente: novoCliente, situacaoFaca: novaFaca, situacaoArte: novaArte, exigeProva: novaProva },
        idempotenciaChave: `rp-${id}-${Date.now()}`,
      })

      return carregar(user.empresaId, id)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // ── PATCH correção manual do Tipo_Pedido (Req 1.7) ────────────────────────
  app.patch('/pedidos-proposta/:id/tipo-pedido', async (request, reply) => {
    const user = request.user as Usuario
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      tipoPedido: z.enum(['REPETICAO', 'ALTERACAO', 'PRODUTO_NOVO']),
      motivo: z.string().min(5).max(500),
    }).parse(request.body)
    try {
      const p = await carregar(user.empresaId, id)
      if (!(await verificarPermissaoComercial(user.empresaId, user.id, user.perfil, 'podeVerComercial'))) {
        return reply.status(403).send({ message: 'Sem permissão.', code: 'PERMISSAO_NEGADA' })
      }
      const macro = p.statusMacro ?? statusMacroDe((p.situacaoInterna as Situacao) ?? 'TRIAGEM')
      if (!STATUS_EDITAVEIS.includes(macro)) {
        return reply.status(409).send({ message: 'Tipo do pedido não pode ser alterado nesta fase.', code: 'TIPO_PEDIDO_BLOQUEADO' })
      }
      const anterior = p.tipoPedidoDerivado
      await prisma.pedidoProposta.update({
        where: { id },
        data: {
          tipoPedidoDerivado: body.tipoPedido,
          tipoPedidoManual: true,
          tipoPedidoDivergente: false,
          classificacaoAConfirmar: false,
        },
      })
      await registrarEvento({
        empresaId: user.empresaId,
        pedidoId: id,
        tipoEvento: 'TIPO_CORRIGIDO',
        origem: `usuario:${user.id}`,
        motivo: body.motivo,
        dados: { de: anterior, para: body.tipoPedido },
        idempotenciaChave: `tp-${id}-${Date.now()}`,
      })
      return carregar(user.empresaId, id)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // ── POST registro manual da aprovação de arte do cliente (Req 2.7) ────────
  app.post('/pedidos-proposta/:id/aprovacao-arte', async (request, reply) => {
    const user = request.user as Usuario
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      forma: z.enum(['REPRESENTANTE', 'EMAIL', 'PRESENCIAL']),
      data: z.coerce.date().optional(),
      observacao: z.string().max(500).optional(),
    }).parse(request.body)
    try {
      await carregar(user.empresaId, id)
      if (!(await verificarPermissaoComercial(user.empresaId, user.id, user.perfil, 'podeVerComercial'))) {
        return reply.status(403).send({ message: 'Sem permissão.', code: 'PERMISSAO_NEGADA' })
      }
      await prisma.pedidoProposta.update({
        where: { id },
        data: { aprovacaoArteEm: body.data ?? new Date(), aprovacaoArteForma: body.forma },
      })
      await registrarEvento({
        empresaId: user.empresaId,
        pedidoId: id,
        tipoEvento: 'APROVACAO_ARTE',
        origem: `usuario:${user.id}`,
        motivo: body.observacao,
        dados: { forma: body.forma },
        idempotenciaChave: `aa-${id}-${Date.now()}`,
      })
      return carregar(user.empresaId, id)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // ── Helper de leitura de setor/tempo parado (usado pela listagem futura) ──
  app.get('/pedidos-proposta/:id/situacao', async (request, reply) => {
    const user = request.user as Usuario
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    try {
      const p = await prisma.pedidoProposta.findFirst({
        where: { id, empresaId: user.empresaId },
        select: { situacaoInterna: true, statusMacro: true, setorResponsavel: true, responsavelDesde: true, rodada: true },
      })
      if (!p) throw new StatusFielError(404, 'Pedido não encontrado.', 'NAO_ENCONTRADO')
      const situacao = (p.situacaoInterna as Situacao) ?? 'TRIAGEM'
      const terminal = isTerminal(situacao)
      const tempoParadoMin = terminal || !p.responsavelDesde
        ? null
        : Math.floor((Date.now() - new Date(p.responsavelDesde).getTime()) / 60000)
      return {
        situacaoInterna: situacao,
        statusMacro: p.statusMacro ?? statusMacroDe(situacao),
        setorResponsavel: terminal ? null : (p.setorResponsavel ?? setorDe(situacao)),
        rodada: p.rodada,
        tempoParadoMinutos: tempoParadoMin,
      }
    } catch (err) {
      return tratarErro(err, reply)
    }
  })
}
