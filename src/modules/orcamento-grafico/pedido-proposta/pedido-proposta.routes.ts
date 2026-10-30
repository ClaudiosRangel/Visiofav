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
  tiragensTexto: z.string().max(200).optional().nullable(),
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
  // Características do produto (para pré-preencher o RFQ). Consolida o cadastro
  // de Produto + (se houver) o CalculoGrafico migrado do Calcgraf que casa pelo
  // nome/descrição, trazendo cartão/suporte, gramatura, cores, medidas, formato.
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/caracteristicas-produto/:produtoId', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { produtoId } = z.object({ produtoId: z.string().uuid() }).parse(request.params)

    const produto = await prisma.produto.findFirst({
      where: { id: produtoId, empresaId: user.empresaId },
      select: { id: true, nome: true, codigo: true, descricao: true, imagemUrl: true },
    })
    if (!produto) return reply.status(404).send({ message: 'Produto não encontrado.' })

    // Casa o produto com um CalculoGrafico migrado. IMPORTANTE: nos cálculos
    // migrados do Calcgraf, o nome vive em `descricao` (o campo `produto` é
    // null) — então o match é por `descricao`/`produto` via ILIKE NO BANCO
    // (há ~8 mil cálculos; filtrar em memória com take limitado perdia o
    // casamento). Busca o MAIS RECENTE que casa exato; senão, por "contém".
    let calc: {
      medidas: unknown; gramatura: unknown; papelDescricao: string | null; numCores: number
      cores: unknown; formatoCorteLarguraMm: unknown; formatoCorteAlturaMm: unknown
      acabamentosRicos: unknown; matrizQuantidade: unknown
    } | null = null
    const selCalc = {
      produto: true, descricao: true, medidas: true, gramatura: true, papelDescricao: true,
      numCores: true, cores: true, formatoCorteLarguraMm: true, formatoCorteAlturaMm: true,
      acabamentosRicos: true, matrizQuantidade: true,
    } as const
    const nomeAlvo = (produto.nome ?? '').trim()
    try {
      if (nomeAlvo.length >= 3) {
        // 1) match EXATO (case-insensitive) por descrição ou produto.
        calc = await prisma.calculoGrafico.findFirst({
          where: {
            empresaId: user.empresaId, status: 'ATIVO',
            OR: [
              { descricao: { equals: nomeAlvo, mode: 'insensitive' } },
              { produto: { equals: nomeAlvo, mode: 'insensitive' } },
            ],
          },
          orderBy: { criadoEm: 'desc' },
          select: selCalc,
        })
        // 2) fallback por "contém" (pega o mais recente que contém o nome).
        if (!calc) {
          calc = await prisma.calculoGrafico.findFirst({
            where: {
              empresaId: user.empresaId, status: 'ATIVO',
              OR: [
                { descricao: { contains: nomeAlvo, mode: 'insensitive' } },
                { produto: { contains: nomeAlvo, mode: 'insensitive' } },
              ],
            },
            orderBy: { criadoEm: 'desc' },
            select: selCalc,
          })
        }
      }
    } catch { /* biblioteca pode não existir — segue só com o produto */ }

    // Monta um resumo de cores em texto (nome + cobertura) a partir do JSON.
    function resumoCores(cores: unknown, n: number): string | null {
      if (Array.isArray(cores) && cores.length > 0) {
        const nomes = cores
          .map((c) => (c && typeof c === 'object' ? (c as { nome?: string }).nome : null))
          .filter(Boolean)
        if (nomes.length) return nomes.join(', ')
      }
      return n ? `${n} cores` : null
    }
    function medidasTexto(medidas: unknown): string | null {
      const m = (medidas ?? {}) as Record<string, unknown>
      const c = Number(m.P ?? m.comprimento)
      const l = Number(m.L ?? m.largura)
      const a = Number(m.A ?? m.altura)
      const partes = [c, l, a].filter((x) => Number.isFinite(x) && x > 0)
      return partes.length ? partes.join(' x ') : null
    }

    const caracteristicas = calc
      ? {
          cartao: calc.papelDescricao ?? null,
          gramatura: calc.gramatura != null ? String(Number(calc.gramatura)) : null,
          cores: resumoCores(calc.cores, calc.numCores),
          medidasTexto: medidasTexto(calc.medidas),
          formatoCorte:
            calc.formatoCorteLarguraMm != null && calc.formatoCorteAlturaMm != null
              ? `${Number(calc.formatoCorteLarguraMm)} x ${Number(calc.formatoCorteAlturaMm)}`
              : null,
          temCalculo: true,
        }
      : { cartao: null, gramatura: null, cores: null, medidasTexto: null, formatoCorte: null, temCalculo: false }

    return {
      produto: { id: produto.id, nome: produto.nome, codigo: produto.codigo, descricao: produto.descricao, imagemUrl: produto.imagemUrl },
      caracteristicas,
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
