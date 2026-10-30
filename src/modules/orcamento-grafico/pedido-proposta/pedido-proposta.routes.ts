/**
 * Rotas do Pedido/Proposta (RFQ) — spec comercial-pedido-proposta.
 * Prefixo /api/orcamento-grafico (registrado no server.ts). authenticate +
 * isolamento por empresaId EXPLÍCITO em toda rota.
 */
import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../../middleware/authenticate'
import { prisma } from '../../../lib/prisma'
import {
  criarPedidoProposta,
  atualizarPedidoProposta,
  obterPedidoProposta,
  listarPedidosProposta,
  transicionarEstado,
} from './pedido-proposta.service'
import {
  adicionarAnexo,
  obterAnexoBinario,
  removerAnexo,
  listarAnexosMetadados,
} from './anexo-pedido-proposta.service'
import { criarOrcamentoDePedidoProposta } from './encaminhar-orcamento.service'
import { liberarPedidoDePedidoProposta, type FasePendente } from './liberar-pedido-proposta.service'
import { ESTADOS_VALIDOS, PedidoPropostaError, type EstadoProposta } from './pedido-proposta-estado.service'
import { enriquecerCnpj } from '../../prospeccao/provider'
import { verificarPermissaoComercial } from '../permissoes-comercial.routes'

function tratarErro(err: unknown, reply: any) {
  if (err instanceof PedidoPropostaError) {
    const body: Record<string, unknown> = { message: err.message }
    if (err.code) body.code = err.code
    const fases = (err as PedidoPropostaError & { fasesPendentes?: FasePendente[] }).fasesPendentes
    if (fases) body.fasesPendentes = fases
    return reply.status(err.statusCode).send(body)
  }
  throw err
}

const corpoCriar = z.object({
  origem: z.enum(['REPRESENTANTE', 'VENDEDOR', 'INTERNA']),
  representanteId: z.string().uuid().optional().nullable(),
  vendedorId: z.string().uuid().optional().nullable(),
  tipoPedido: z.enum(['REPETICAO', 'MOSTRUARIO', 'NOVO']),
  clienteId: z.string().uuid().optional().nullable(),
  clienteNome: z.string().max(200).optional().nullable(),
  clienteCpfCnpj: z.string().max(20).optional().nullable(),
  jaCliente: z.boolean().optional(),
  mercado: z.string().min(1).max(120),
  ufOrigem: z.string().max(2).optional().nullable(),
  cidade: z.string().max(120).optional().nullable(),
  tipoEntrega: z.enum(['UNICA', 'FRACIONADA']).optional().nullable(),
  entregaFracionadaDias: z.string().max(60).optional().nullable(),
  prazoPagamento: z.string().max(60).optional().nullable(),
  produtoNome: z.string().max(200).optional().nullable(),
  tipoEmbalagem: z.string().max(120).optional().nullable(),
  quantidade: z.coerce.number().int().positive().optional().nullable(),
  cartao: z.string().max(120).optional().nullable(),
  gramatura: z.string().max(60).optional().nullable(),
  medidasTexto: z.string().max(120).optional().nullable(),
  cartaoFsc: z.boolean().optional(),
  corteInternoVerso: z.boolean().optional(),
  passtime: z.boolean().optional(),
  acabamentos: z.string().optional().nullable(),
  matriz: z.string().max(200).optional().nullable(),
  acabamentoManual: z.boolean().optional(),
  quantidadePorVolume: z.string().max(60).optional().nullable(),
  variacoesArte: z.string().max(60).optional().nullable(),
  exportacao: z.enum(['COMUM', 'EXPORTACAO']).optional().nullable(),
  dataValidade: z.string().max(60).optional().nullable(),
  discriminacao: z.string().optional().nullable(),
  observacoes: z.string().optional().nullable(),
  exigeAmostra: z.boolean().optional(),
  // Revisão 3
  produtoId: z.string().uuid().optional().nullable(),
  prazoPagamentoId: z.string().uuid().optional().nullable(),
  acabamentosSelecionados: z.array(z.object({
    acabamentoId: z.string().uuid().optional().nullable(),
    nome: z.string().max(200),
    marcado: z.boolean(),
    detalhe: z.string().max(500).optional().nullable(),
  })).optional().nullable(),
})

export async function pedidoPropostaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // ── Consulta CNPJ (autopreenchimento) — reusa enriquecerCnpj ──
  app.get('/cnpj/:cnpj', async (request, reply) => {
    const { cnpj } = z.object({ cnpj: z.string() }).parse(request.params)
    const digits = (cnpj || '').replace(/\D/g, '')
    if (digits.length !== 14) {
      return reply.status(400).send({ message: 'CNPJ inválido.', code: 'CNPJ_INVALIDO' })
    }
    try {
      const dados = await enriquecerCnpj(digits)
      if (!dados) return reply.status(422).send({ message: 'CNPJ não encontrado.' })
      return dados
    } catch (err: any) {
      return reply.status(502).send({ message: err?.message || 'Falha ao consultar CNPJ.' })
    }
  })

  // ── Listagem (gestão central) ──
  app.get('/pedidos-proposta', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const q = z.object({
      estado: z.string().optional(),
      origem: z.string().optional(),
      tipoPedido: z.string().optional(),
      busca: z.string().optional(),
    }).parse(request.query)
    try {
      return await listarPedidosProposta(user.empresaId, q)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // ── Criar ──
  app.post('/pedidos-proposta', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil?: string }
    if (!(await verificarPermissaoComercial(user.empresaId, user.id, user.perfil, 'podeCriarOrcamento'))) {
      return reply.status(403).send({ message: 'Sem permissão para criar pedidos/propostas.' })
    }
    const body = corpoCriar.parse(request.body)
    try {
      const r = await criarPedidoProposta(user.empresaId, user.id, body)
      return reply.status(201).send(r)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // ── Detalhe ──
  app.get('/pedidos-proposta/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    try {
      return await obterPedidoProposta(user.empresaId, id)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // ── Atualizar ──
  app.put('/pedidos-proposta/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = corpoCriar.partial().parse(request.body)
    try {
      await atualizarPedidoProposta(user.empresaId, id, body)
      return { ok: true }
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // ── Transição de estado ──
  app.patch('/pedidos-proposta/:id/estado', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      estado: z.enum(ESTADOS_VALIDOS as [EstadoProposta, ...EstadoProposta[]]),
      motivo: z.string().optional(),
    }).parse(request.body)
    try {
      return await transicionarEstado(user.empresaId, id, user.id, body.estado, body.motivo)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // ── Encaminhar para orçamento ──
  app.post('/pedidos-proposta/:id/encaminhar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil?: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({ tipoEmbalagemIdOverride: z.string().uuid().optional() }).parse(request.body ?? {})
    if (!(await verificarPermissaoComercial(user.empresaId, user.id, user.perfil, 'podeCriarOrcamento'))) {
      return reply.status(403).send({ message: 'Sem permissão para encaminhar ao orçamento.' })
    }
    try {
      const r = await criarOrcamentoDePedidoProposta(user.empresaId, id, user.id, body.tipoEmbalagemIdOverride)
      return reply.status(201).send(r)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // ── Liberar a PCP/Faturamento ──
  app.post('/pedidos-proposta/:id/liberar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil?: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({ senha: z.string().optional() }).parse(request.body ?? {})
    try {
      return await liberarPedidoDePedidoProposta(user.empresaId, id, user.id, user.perfil, { senha: body.senha })
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // ── Anexos: adicionar (multipart, 1 imagem) ──
  app.post('/pedidos-proposta/:id/anexos', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const file = await (request as any).file?.()
    if (!file) return reply.status(400).send({ message: 'Nenhum arquivo enviado (multipart/form-data).' })
    try {
      const buffer = await file.toBuffer()
      const r = await adicionarAnexo(user.empresaId, id, {
        nome: file.filename || 'imagem',
        mime: file.mimetype || '',
        buffer,
      })
      return reply.status(201).send(r)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // ── Anexos: listar metadados ──
  app.get('/pedidos-proposta/:id/anexos', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    try {
      return await listarAnexosMetadados(user.empresaId, id)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // ── Anexos: servir binário (aceita token via query p/ abrir em nova aba) ──
  app.get('/pedidos-proposta/:id/anexos/:anexoId', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id, anexoId } = z.object({ id: z.string().uuid(), anexoId: z.string().uuid() }).parse(request.params)
    try {
      const anexo = await obterAnexoBinario(user.empresaId, id, anexoId)
      return reply
        .type(anexo.tipo)
        .header('Content-Disposition', `inline; filename="${anexo.nome}"`)
        .send(anexo.dados)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // ── Anexos: remover ──
  app.delete('/pedidos-proposta/:id/anexos/:anexoId', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id, anexoId } = z.object({ id: z.string().uuid(), anexoId: z.string().uuid() }).parse(request.params)
    try {
      await removerAnexo(user.empresaId, id, anexoId)
      return reply.status(204).send()
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // ── Ver proposta a partir do orçamento (somente-leitura + metadados anexos) ──
  app.get('/pedidos-proposta/por-orcamento/:orcamentoId', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { orcamentoId } = z.object({ orcamentoId: z.string().uuid() }).parse(request.params)

    // Confirma que o orçamento é da empresa (senão 404 — não expõe dados).
    const orc = await prisma.orcamentoGrafico.findFirst({
      where: { id: orcamentoId, empresaId: user.empresaId },
      select: { id: true, pedidoPropostaId: true },
    })
    if (!orc) return reply.status(404).send({ message: 'Orçamento não encontrado.', code: 'NAO_ENCONTRADO' })
    if (!orc.pedidoPropostaId) return { proposta: null }

    try {
      const proposta = await obterPedidoProposta(user.empresaId, orc.pedidoPropostaId)
      return { proposta }
    } catch {
      return { proposta: null }
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Cadastro de Prazos / Condições de Pagamento (ligado ao Financeiro)
  // ═══════════════════════════════════════════════════════════════════════════

  // Lista os prazos ativos da empresa (para o Select do RFQ e cadastro).
  app.get('/prazos-pagamento', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const q = z.object({ incluirInativos: z.coerce.boolean().optional() }).parse(request.query)
    return prisma.condicaoPagamentoComercial.findMany({
      where: { empresaId: user.empresaId, ...(q.incluirInativos ? {} : { status: true }) },
      orderBy: [{ dias: 'asc' }, { descricao: 'asc' }],
      select: { id: true, descricao: true, dias: true, parcelas: true, observacao: true, status: true },
    })
  })

  app.post('/prazos-pagamento', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil?: string }
    if (!(await verificarPermissaoComercial(user.empresaId, user.id, user.perfil, 'podeEditarCadastros'))) {
      return reply.status(403).send({ message: 'Sem permissão para editar cadastros.' })
    }
    const body = z.object({
      descricao: z.string().min(1).max(120),
      dias: z.coerce.number().int().min(0).default(0),
      parcelas: z.coerce.number().int().min(1).default(1),
      observacao: z.string().optional().nullable(),
    }).parse(request.body)
    try {
      const criado = await prisma.condicaoPagamentoComercial.create({
        data: { empresaId: user.empresaId, ...body },
        select: { id: true, descricao: true, dias: true, parcelas: true, status: true },
      })
      return reply.status(201).send(criado)
    } catch (err: any) {
      if (err?.code === 'P2002') return reply.status(409).send({ message: 'Já existe um prazo com essa descrição.', code: 'DUPLICADO' })
      throw err
    }
  })

  app.put('/prazos-pagamento/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil?: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    if (!(await verificarPermissaoComercial(user.empresaId, user.id, user.perfil, 'podeEditarCadastros'))) {
      return reply.status(403).send({ message: 'Sem permissão para editar cadastros.' })
    }
    const body = z.object({
      descricao: z.string().min(1).max(120).optional(),
      dias: z.coerce.number().int().min(0).optional(),
      parcelas: z.coerce.number().int().min(1).optional(),
      observacao: z.string().optional().nullable(),
      status: z.boolean().optional(),
    }).parse(request.body)
    const existente = await prisma.condicaoPagamentoComercial.findFirst({ where: { id, empresaId: user.empresaId }, select: { id: true } })
    if (!existente) return reply.status(404).send({ message: 'Prazo não encontrado.' })
    await prisma.condicaoPagamentoComercial.update({ where: { id }, data: body })
    return { ok: true }
  })

  app.delete('/prazos-pagamento/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil?: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    if (!(await verificarPermissaoComercial(user.empresaId, user.id, user.perfil, 'podeEditarCadastros'))) {
      return reply.status(403).send({ message: 'Sem permissão para editar cadastros.' })
    }
    const existente = await prisma.condicaoPagamentoComercial.findFirst({ where: { id, empresaId: user.empresaId }, select: { id: true } })
    if (!existente) return reply.status(404).send({ message: 'Prazo não encontrado.' })
    // Soft delete (inativa) — mantém o vínculo histórico em pedidos que já usaram.
    await prisma.condicaoPagamentoComercial.update({ where: { id }, data: { status: false } })
    return reply.status(204).send()
  })
}
