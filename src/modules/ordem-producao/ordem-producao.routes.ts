import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { getOpPdfPath, getOpsPdfDir, salvarOpPdf, carregarOpPdf, opTemPdf, removerOpPdf } from '../../lib/storage'
import {
  validarTransicaoStatus,
  getTransicoesPermitidas,
  getTransicoesForcadas,
  proximoNumeroOp,
  explodirBomParaOp,
  gerarEtapasOp,
  calcularConsumoAutomatico,
} from './ordem-producao.service'
import { reordenarFilaAutomaticamente } from '../pcp/fila-ordenacao.service'
import { verificarAcessoMenu } from '../pcp/permissoes-pcp.routes'
import { gerarOpPdf } from './op-pdf-gerado.service'
import { cancelarReservasOp, consumirReservasOp, criarReservasOp } from '../pcp/analise-producao/reserva-producao.service'
import { verificarEstoqueOp } from '../pcp/analise-producao/verificacao-estoque.service'

/**
 * Extrai o nome do cliente salvo na tag [Cliente] das observações da OP.
 * OPs importadas via PDF (GPrint/Calcograf) frequentemente não têm clienteId
 * vinculado a um cadastro de Cliente — o nome real extraído do PDF fica salvo
 * nessa tag. Mesmo padrão usado em etapa-operacional.routes.ts (painel de programação).
 */
function extrairClienteObs(obs: string | null): string | null {
  if (!obs) return null
  const m = obs.match(/\[Cliente\]\s*(.+?)(?:\n|$)/)
  return m ? m[1].trim() : null
}

const idParamsSchema = z.object({ id: z.string().uuid() })

const criarOpSchema = z.object({
  produtoId: z.string().uuid(),
  quantidade: z.number().positive('Quantidade deve ser maior que zero'),
  unidadeMedida: z.string().min(1).max(10),
  dataEntregaPrevista: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  prioridade: z.enum(['BAIXA', 'NORMAL', 'ALTA', 'URGENTE']).optional().default('NORMAL'),
  pedidoVendaId: z.string().uuid().optional().nullable(),
  clienteId: z.string().uuid().optional().nullable(),
  lote: z.string().max(50).optional().nullable(),
  cor: z.string().max(50).optional().nullable(),
  observacoes: z.string().optional().nullable(),
  explodirBom: z.boolean().optional().default(true),
  gerarEtapas: z.boolean().optional().default(true),
})

const listQuerySchema = z.object({
  status: z.string().optional(),
  prioridade: z.enum(['BAIXA', 'NORMAL', 'ALTA', 'URGENTE']).optional(),
  produtoId: z.string().uuid().optional(),
  clienteId: z.string().uuid().optional(),
  pedidoVendaId: z.string().uuid().optional(),
  cliente: z.string().optional(),
  produto: z.string().optional(),
  dataEntregaDe: z.string().optional(),
  dataEntregaAte: z.string().optional(),
  numero: z.coerce.number().int().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  orderBy: z.enum(['numero', 'dataEmissao', 'dataEntregaPrevista', 'prioridade']).optional().default('numero'),
  orderDir: z.enum(['asc', 'desc']).optional().default('desc'),
})

export async function ordemProducaoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  // =========================================================================
  // GET /api/ordens-producao — Listagem com filtros
  // =========================================================================
  app.get('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil?: string }
    if (!await verificarAcessoMenu(user.empresaId, user.id, user.perfil, 'ordens-producao', 'visualizar')) {
      return reply.status(403).send({ message: 'Sem permissão para visualizar ordens de produção' })
    }
    const query = listQuerySchema.parse(request.query)

    const where: any = { empresaId: user.empresaId }

    if (query.status) {
      const statusList = query.status.split(',').map((s) => s.trim())
      where.status = { in: statusList }
    }
    if (query.prioridade) where.prioridade = query.prioridade
    if (query.produtoId) where.produtoId = query.produtoId
    if (query.clienteId) where.clienteId = query.clienteId
    if (query.pedidoVendaId) where.pedidoVendaId = query.pedidoVendaId
    if (query.numero) where.numero = query.numero
    // Filtro por texto de cliente (busca na tag [Cliente] nas observações)
    if (query.cliente) {
      where.observacoes = { ...(where.observacoes || {}), contains: query.cliente, mode: 'insensitive' }
    }
    // Filtro por texto de produto (busca na tag [Produto] nas observações)
    if (query.produto) {
      // Se já tem filtro de observações (cliente), combina com AND
      if (where.observacoes) {
        where.AND = [
          ...(where.AND || []),
          { observacoes: { contains: query.produto, mode: 'insensitive' } },
        ]
      } else {
        where.observacoes = { contains: query.produto, mode: 'insensitive' }
      }
    }

    if (query.dataEntregaDe || query.dataEntregaAte) {
      where.dataEntregaPrevista = {}
      if (query.dataEntregaDe) where.dataEntregaPrevista.gte = new Date(query.dataEntregaDe)
      if (query.dataEntregaAte) where.dataEntregaPrevista.lte = new Date(query.dataEntregaAte)
    }

    const [data, total] = await Promise.all([
      prisma.ordemProducao.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { [query.orderBy]: query.orderDir },
        // IMPORTANTE: usar `select` (não `omit`) para excluir pdfData (BYTEA).
        // `select` é traduzido direto para a cláusula SQL SELECT — o campo nunca
        // sai do banco. `omit` filtra só na serialização e já causou o backend
        // materializar ~15MB de PDFs em memória numa única listagem paginada
        // (limit=20), estourando o limite de memória da instância no Render.
        select: {
          id: true,
          empresaId: true,
          numero: true,
          produtoId: true,
          estruturaProdutoId: true,
          quantidade: true,
          unidadeMedida: true,
          quantidadeProduzida: true,
          quantidadeRejeitada: true,
          status: true,
          prioridade: true,
          dataEmissao: true,
          dataEntregaPrevista: true,
          dataEntregaOriginal: true,
          vezesPostergada: true,
          dataInicioPrevista: true,
          dataFimPrevista: true,
          dataInicioReal: true,
          dataFimReal: true,
          pedidoVendaId: true,
          clienteId: true,
          lote: true,
          cor: true,
          grupoOpId: true,
          quantidadeExcedente: true,
          motivoCancelamento: true,
          observacoes: true,
          referenciaExterna: true,
          origemImportacao: true,
          criadoPorId: true,
          criadoEm: true,
          atualizadoEm: true,
        },
      }),
      prisma.ordemProducao.count({ where }),
    ])

    // Calcula percentual concluído e busca nomes dos produtos e clientes
    const produtoIds = [...new Set(data.map((op) => op.produtoId).filter((id): id is string => id !== null))]
    const produtos = produtoIds.length > 0 ? await prisma.produto.findMany({
      where: { id: { in: produtoIds } },
      select: { id: true, codigo: true, nome: true },
    }) : []
    const produtoMap = new Map(produtos.map((p) => [p.id, `${p.codigo} - ${p.nome}`]))

    const clienteIds = [...new Set(data.map((op) => op.clienteId).filter((id): id is string => id !== null))]
    const clientes = clienteIds.length > 0 ? await prisma.cliente.findMany({
      where: { id: { in: clienteIds } },
      select: { id: true, razaoSocial: true, nomeFantasia: true },
    }) : []
    const clienteMap = new Map(clientes.map((c) => [c.id, c.nomeFantasia || c.razaoSocial]))

    const dataComPercentual = data.map((op) => ({
      ...op,
      produtoNome: (op.produtoId && produtoMap.get(op.produtoId)) || op.produtoId || 'Produto não vinculado',
      // OPs importadas via PDF (PDF_GPRINT) muitas vezes não têm clienteId vinculado
      // a um cadastro de Cliente — o nome real do cliente do PDF fica salvo na tag
      // [Cliente] dentro de observacoes. Priorizar essa tag e só cair para o
      // relacionamento clienteId como fallback (mesmo padrão usado no painel de
      // programação, ver extrairClienteObs em etapa-operacional.routes.ts).
      clienteNome: extrairClienteObs(op.observacoes) || (op.clienteId && clienteMap.get(op.clienteId)) || null,
      percentualConcluido: Number(op.quantidade) > 0
        ? Math.min(100, Math.round((Number(op.quantidadeProduzida) / Number(op.quantidade)) * 100))
        : 0,
    }))

    return { data: dataComPercentual, total, page: query.page, limit: query.limit }
  })

  // =========================================================================
  // GET /api/ordens-producao/clientes-distintos — Lista nomes de clientes
  // usados em Ordens de Produção, sem duplicar. Combina duas fontes:
  // 1) Cadastro formal (tabela Cliente, vinculado via clienteId)
  // 2) Nome extraído da tag [Cliente] das observações — a maioria das OPs
  //    importadas via PDF não tem clienteId vinculado, só esse texto.
  // Usado para autocomplete (ex: modal de OP Avulsa), onde "buscar cliente"
  // deve considerar todos os nomes já vistos, não só os formalmente cadastrados.
  // =========================================================================
  app.get('/clientes-distintos', async (request) => {
    const user = request.user as { id: string; empresaId: string }

    const ops = await prisma.ordemProducao.findMany({
      where: { empresaId: user.empresaId },
      select: { clienteId: true, observacoes: true },
    })

    const clienteIds = [...new Set(ops.map((op) => op.clienteId).filter((id): id is string => id !== null))]
    const clientesCadastrados = clienteIds.length > 0 ? await prisma.cliente.findMany({
      where: { id: { in: clienteIds } },
      select: { id: true, razaoSocial: true, nomeFantasia: true },
    }) : []
    const clienteMap = new Map(clientesCadastrados.map((c) => [c.id, c.nomeFantasia || c.razaoSocial]))

    // Dedupe case-insensitive (ex: "Frescatto" e "FRESCATTO" contam como um só),
    // preservando a primeira grafia encontrada. Cada entrada guarda também o
    // clienteId real quando existe cadastro formal — nomes vindos só da tag
    // [Cliente] do PDF (a maioria) não têm clienteId, apenas o nome em texto.
    const vistos = new Map<string, { nome: string; clienteId: string | null }>()
    for (const op of ops) {
      const nomeTag = extrairClienteObs(op.observacoes)
      const nomeCadastro = op.clienteId ? clienteMap.get(op.clienteId) : null
      const nome = nomeTag || nomeCadastro
      if (!nome) continue
      const chave = nome.trim().toUpperCase()
      if (!vistos.has(chave)) {
        // Só associa clienteId se o nome vier do cadastro (nomeTag ausente) —
        // evita associar um clienteId a um nome de tag que pode ser diferente.
        vistos.set(chave, { nome: nome.trim(), clienteId: !nomeTag && op.clienteId ? op.clienteId : null })
      }
    }

    const resultado = [...vistos.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    return { data: resultado, total: resultado.length }
  })

  // =========================================================================
  // GET /api/ordens-producao/:id — Detalhe completo
  // =========================================================================
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil?: string }
    if (!await verificarAcessoMenu(user.empresaId, user.id, user.perfil, 'ordens-producao', 'visualizar')) {
      return reply.status(403).send({ message: 'Sem permissão para visualizar ordens de produção' })
    }
    const { id } = idParamsSchema.parse(request.params)

    const op = await prisma.ordemProducao.findFirst({
      where: { id, empresaId: user.empresaId },
      select: {
        id: true,
        empresaId: true,
        numero: true,
        produtoId: true,
        estruturaProdutoId: true,
        quantidade: true,
        unidadeMedida: true,
        quantidadeProduzida: true,
        quantidadeRejeitada: true,
        status: true,
        prioridade: true,
        dataEmissao: true,
        dataEntregaPrevista: true,
        dataEntregaOriginal: true,
        vezesPostergada: true,
        dataInicioPrevista: true,
        dataFimPrevista: true,
        dataInicioReal: true,
        dataFimReal: true,
        pedidoVendaId: true,
        clienteId: true,
        lote: true,
        cor: true,
        grupoOpId: true,
        quantidadeExcedente: true,
        motivoCancelamento: true,
        observacoes: true,
        referenciaExterna: true,
        origemImportacao: true,
        criadoPorId: true,
        criadoEm: true,
        atualizadoEm: true,
        // BYTEA pesado — omitido via select (usar rota dedicada de PDF), nunca sai do banco
        itens: { orderBy: { descricaoProduto: 'asc' } },
        etapas: {
          orderBy: { sequencia: 'asc' },
          include: {
            centroProducao: { select: { id: true, codigo: true, descricao: true } },
            recurso: { select: { id: true, codigo: true, descricao: true } },
          },
        },
        apontamentos: { orderBy: { criadoEm: 'desc' }, take: 20 },
        logs: { orderBy: { criadoEm: 'desc' } },
        liberacoes: { orderBy: { criadoEm: 'desc' } },
      },
    })

    if (!op) {
      return reply.status(404).send({ message: 'Ordem de produção não encontrada' })
    }

    // Busca nome do produto
    const produto = op.produtoId ? await prisma.produto.findFirst({
      where: { id: op.produtoId, empresaId: user.empresaId },
      select: { codigo: true, nome: true },
    }) : null

    // Busca nome do cliente
    const cliente = op.clienteId ? await prisma.cliente.findFirst({
      where: { id: op.clienteId, empresaId: user.empresaId },
      select: { razaoSocial: true, nomeFantasia: true },
    }) : null

    const percentualConcluido = Number(op.quantidade) > 0
      ? Math.min(100, Math.round((Number(op.quantidadeProduzida) / Number(op.quantidade)) * 100))
      : 0

    // OPs importadas via PDF muitas vezes não têm clienteId vinculado a um cadastro
    // de Cliente — o nome real do cliente do PDF fica salvo na tag [Cliente] dentro
    // de observacoes. Priorizar essa tag e só cair para o relacionamento clienteId
    // como fallback (mesmo padrão usado no painel de programação).
    const clienteNome = extrairClienteObs(op.observacoes) || (cliente ? (cliente.nomeFantasia || cliente.razaoSocial) : null)

    return { ...op, produtoNome: produto ? `${produto.codigo} - ${produto.nome}` : (op.produtoId || 'Produto não vinculado'), clienteNome, percentualConcluido, transicoesPermitidas: getTransicoesPermitidas(op.status) }
  })

  // =========================================================================
  // GET /api/ordens-producao/:id/historico — Timeline completa da OP
  // Unifica logs de transição, apontamentos de etapa, liberações de material
  // e marcos importantes numa lista cronológica.
  // =========================================================================
  app.get('/:id/historico', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil?: string }
    if (!await verificarAcessoMenu(user.empresaId, user.id, user.perfil, 'ordens-producao', 'visualizar')) {
      return reply.status(403).send({ message: 'Sem permissão para visualizar ordens de produção' })
    }
    const { id } = idParamsSchema.parse(request.params)

    const op = await prisma.ordemProducao.findFirst({
      where: { id, empresaId: user.empresaId },
      select: {
        id: true, numero: true, referenciaExterna: true, status: true,
        origemImportacao: true, criadoEm: true, dataInicioReal: true, dataFimReal: true,
        observacoes: true, produtoId: true, clienteId: true,
      },
    })
    if (!op) {
      return reply.status(404).send({ message: 'Ordem de produção não encontrada' })
    }

    // 1. Logs de transição de status
    const logs = await prisma.logOrdemProducao.findMany({
      where: { ordemProducaoId: id },
      orderBy: { criadoEm: 'asc' },
    })

    // 2. Apontamentos de etapa (granulares)
    const etapas = await prisma.etapaOrdemProducao.findMany({
      where: { ordemProducaoId: id },
      select: { id: true, descricao: true, sequencia: true, centroProducao: { select: { codigo: true, descricao: true } } },
    })
    const etapaIds = etapas.map(e => e.id)
    const apontamentosEtapa = etapaIds.length > 0
      ? await prisma.apontamentoEtapa.findMany({
          where: { etapaOrdemProducaoId: { in: etapaIds } },
          orderBy: { dataHora: 'asc' },
        })
      : []

    // 3. Liberações de material
    const liberacoes = await prisma.liberacaoMaterial.findMany({
      where: { ordemProducaoId: id },
      orderBy: { criadoEm: 'asc' },
      include: { itens: { select: { quantidadeSolicitada: true, itemOrdemProducao: { select: { descricaoProduto: true } } } } },
    })

    // 4. Buscar nomes de usuários envolvidos
    const todosUsuarioIds = [
      ...logs.map(l => l.usuarioId),
      ...apontamentosEtapa.map(a => a.funcionarioId).filter(Boolean),
    ].filter(Boolean) as string[]
    const uniqueUsuarioIds = [...new Set(todosUsuarioIds)]
    const usuarios = uniqueUsuarioIds.length > 0
      ? await prisma.usuario.findMany({ where: { id: { in: uniqueUsuarioIds } }, select: { id: true, nome: true } })
      : []
    const usuarioMap = new Map(usuarios.map(u => [u.id, u.nome]))

    // Mapa de etapas
    const etapaMap = new Map(etapas.map(e => [e.id, e]))

    // Montar timeline unificada
    type EventoTimeline = {
      tipo: string
      data: string
      titulo: string
      descricao: string | null
      usuario: string | null
      cor: string
      icone: string
    }

    const eventos: EventoTimeline[] = []

    // Evento de criação da OP
    eventos.push({
      tipo: 'criacao',
      data: op.criadoEm.toISOString(),
      titulo: `OP criada${op.origemImportacao === 'PDF_GPRINT' ? ' (importação PDF GPrint)' : op.origemImportacao === 'AVULSA' ? ' (avulsa)' : ''}`,
      descricao: null,
      usuario: null,
      cor: 'blue',
      icone: 'plus',
    })

    // Logs de transição
    for (const log of logs) {
      eventos.push({
        tipo: 'transicao',
        data: log.criadoEm.toISOString(),
        titulo: `Status: ${log.statusAnterior || '—'} → ${log.statusNovo}`,
        descricao: log.observacao,
        usuario: usuarioMap.get(log.usuarioId) || null,
        cor: log.statusNovo === 'CANCELADA' ? 'red' : log.statusNovo === 'CONCLUIDA' ? 'green' : log.statusNovo === 'EM_PRODUCAO' ? 'orange' : 'blue',
        icone: log.statusNovo === 'CANCELADA' ? 'x' : log.statusNovo === 'CONCLUIDA' ? 'check' : 'arrow-right',
      })
    }

    // Apontamentos de etapa
    for (const ap of apontamentosEtapa) {
      const etapa = etapaMap.get(ap.etapaOrdemProducaoId)
      const centroNome = etapa?.centroProducao?.codigo || etapa?.centroProducao?.descricao || ''
      const etapaDesc = etapa?.descricao || `Etapa ${etapa?.sequencia || '?'}`

      let titulo = ''
      let cor = 'gray'
      let icone = 'note'
      switch (ap.tipo) {
        case 'PRODUCAO':
          titulo = `Produção: ${Number(ap.quantidadeProduzida || 0).toLocaleString('pt-BR')} un — ${etapaDesc} (${centroNome})`
          cor = 'green'
          icone = 'hammer'
          break
        case 'PERDA':
          titulo = `Perda: ${Number(ap.quantidadePerda || 0).toLocaleString('pt-BR')} un — ${etapaDesc} (${centroNome})`
          cor = 'red'
          icone = 'alert'
          break
        case 'PARADA':
          titulo = `Parada: ${ap.motivoParada || 'sem motivo'} — ${etapaDesc} (${centroNome})`
          cor = 'yellow'
          icone = 'pause'
          break
        case 'RETOMADA':
          titulo = `Retomada — ${etapaDesc} (${centroNome})`
          cor = 'teal'
          icone = 'play'
          break
        default:
          titulo = `${ap.tipo} — ${etapaDesc} (${centroNome})`
      }

      eventos.push({
        tipo: 'apontamento',
        data: ap.dataHora.toISOString(),
        titulo,
        descricao: ap.observacao || null,
        usuario: ap.funcionarioId ? (usuarioMap.get(ap.funcionarioId) || null) : null,
        cor,
        icone,
      })
    }

    // Liberações de material
    for (const lib of liberacoes) {
      const materiaisResumo = lib.itens.slice(0, 3).map((i: any) => i.itemOrdemProducao?.descricaoProduto || 'item').join(', ')
      eventos.push({
        tipo: 'liberacao',
        data: lib.criadoEm.toISOString(),
        titulo: `Liberação de material — ${lib.status}`,
        descricao: materiaisResumo + (lib.itens.length > 3 ? ` (+${lib.itens.length - 3} itens)` : ''),
        usuario: null,
        cor: lib.status === 'ENTREGUE' ? 'green' : lib.status === 'CANCELADA' ? 'red' : 'cyan',
        icone: 'package',
      })
    }

    // Ordenar por data
    eventos.sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime())

    return {
      op: {
        id: op.id,
        numero: op.referenciaExterna || String(op.numero),
        status: op.status,
        origemImportacao: op.origemImportacao,
      },
      eventos,
      totalEventos: eventos.length,
    }
  })

  // =========================================================================
  // POST /api/ordens-producao — Criar OP
  // =========================================================================
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil?: string }
    if (!await verificarAcessoMenu(user.empresaId, user.id, user.perfil, 'ordens-producao', 'criar')) {
      return reply.status(403).send({ message: 'Sem permissão para criar ordens de produção' })
    }
    const body = criarOpSchema.parse(request.body)

    // Valida produto
    const produto = await prisma.produto.findFirst({
      where: { id: body.produtoId, empresaId: user.empresaId },
    })
    if (!produto) {
      return reply.status(400).send({ message: 'Produto não encontrado nesta empresa' })
    }

    // Busca estrutura ativa
    const estrutura = await prisma.estruturaProduto.findFirst({
      where: { empresaId: user.empresaId, produtoId: body.produtoId, status: 'ATIVA' },
    })
    if (!estrutura) {
      return reply.status(400).send({ message: 'Produto não possui estrutura (BOM) ativa cadastrada' })
    }

    const numero = await proximoNumeroOp(user.empresaId)

    const op = await prisma.ordemProducao.create({
      data: {
        empresaId: user.empresaId,
        numero,
        produtoId: body.produtoId,
        estruturaProdutoId: estrutura.id,
        quantidade: body.quantidade,
        unidadeMedida: body.unidadeMedida,
        dataEntregaPrevista: new Date(body.dataEntregaPrevista),
        prioridade: body.prioridade,
        pedidoVendaId: body.pedidoVendaId ?? undefined,
        clienteId: body.clienteId ?? undefined,
        lote: body.lote ?? undefined,
        cor: body.cor ?? undefined,
        observacoes: body.observacoes ?? undefined,
      },
    })

    // Explode BOM automaticamente
    let itensGerados = { total: 0 }
    if (body.explodirBom) {
      itensGerados = await explodirBomParaOp(op.id, estrutura.id, body.quantidade, user.empresaId)
    }

    // Gera etapas do roteiro
    let etapasGeradas = { total: 0 }
    if (body.gerarEtapas) {
      etapasGeradas = await gerarEtapasOp(op.id, body.produtoId, body.quantidade, user.empresaId)
    }

    // Log de criação
    await prisma.logOrdemProducao.create({
      data: {
        ordemProducaoId: op.id,
        statusAnterior: '',
        statusNovo: 'RASCUNHO',
        usuarioId: user.id,
        observacao: 'Ordem de produção criada',
      },
    })

    // 3. Cálculo automático de consumo gráfico (folhas/metros → kg)
    const consumoGrafico = await calcularConsumoAutomatico(op.id, body.produtoId, body.quantidade, user.empresaId)

    return reply.status(201).send({
      ...op,
      itensGerados: itensGerados.total,
      etapasGeradas: etapasGeradas.total,
      consumoGrafico,
    })
  })

  // =========================================================================
  // PATCH /api/ordens-producao/:id/status — Transição de status
  // =========================================================================
  app.patch('/:id/status', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil?: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = z.object({
      status: z.string(),
      motivoCancelamento: z.string().min(10).optional(),
      observacao: z.string().optional(),
    }).parse(request.body)

    // Cancelamento exige permissão específica 'cancelar'; demais transições exigem 'alterar-status'
    const acaoNecessaria = body.status === 'CANCELADA' ? 'cancelar' : 'alterar-status'
    if (!await verificarAcessoMenu(user.empresaId, user.id, user.perfil, 'ordens-producao', acaoNecessaria)) {
      return reply.status(403).send({ message: `Sem permissão para ${acaoNecessaria === 'cancelar' ? 'cancelar' : 'alterar status de'} ordens de produção` })
    }

    const op = await prisma.ordemProducao.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true, status: true, dataInicioReal: true },
    })

    if (!op) {
      return reply.status(404).send({ message: 'Ordem de produção não encontrada' })
    }

    if (!validarTransicaoStatus(op.status, body.status)) {
      const permitidas = getTransicoesPermitidas(op.status)
      return reply.status(400).send({
        message: `Transição de '${op.status}' para '${body.status}' não é permitida. Transições válidas: ${permitidas.join(', ') || 'nenhuma'}`,
      })
    }

    if (body.status === 'CANCELADA' && !body.motivoCancelamento) {
      return reply.status(400).send({ message: 'Motivo de cancelamento é obrigatório (mínimo 10 caracteres)' })
    }

    // Validações específicas por transição
    if (body.status === 'PLANEJADA') {
      const itensCount = await prisma.itemOrdemProducao.count({ where: { ordemProducaoId: id } })
      if (itensCount === 0) {
        return reply.status(400).send({ message: 'A OP precisa ter pelo menos um item de material para ser planejada' })
      }
    }

    const dataUpdate: any = { status: body.status }

    if (body.status === 'CANCELADA') {
      dataUpdate.motivoCancelamento = body.motivoCancelamento
    }
    if (body.status === 'EM_PRODUCAO' && !op.dataInicioReal) {
      dataUpdate.dataInicioReal = new Date()
    }
    if (body.status === 'CONCLUIDA') {
      dataUpdate.dataFimReal = new Date()
    }

    // IMPORTANTE: usar `select` (não retornar tudo) para excluir pdfData
    // (BYTEA) — sem isso, cada troca de status materializa o PDF completo da
    // OP em memória e o serializa de volta na resposta sem necessidade,
    // causando lentidão perceptível no botão de avançar status (mesma causa
    // já corrigida antes na listagem e no detalhe da OP).
    const atualizada = await prisma.ordemProducao.update({
      where: { id },
      data: dataUpdate,
      select: {
        id: true, empresaId: true, numero: true, produtoId: true, estruturaProdutoId: true,
        quantidade: true, unidadeMedida: true, quantidadeProduzida: true, quantidadeRejeitada: true,
        status: true, prioridade: true, dataEmissao: true, dataEntregaPrevista: true,
        dataEntregaOriginal: true, vezesPostergada: true, dataInicioPrevista: true, dataFimPrevista: true,
        dataInicioReal: true, dataFimReal: true, pedidoVendaId: true, clienteId: true, lote: true, cor: true,
        grupoOpId: true, quantidadeExcedente: true, motivoCancelamento: true, observacoes: true,
        referenciaExterna: true, origemImportacao: true, criadoPorId: true, criadoEm: true, atualizadoEm: true,
      },
    })

    // Log de transição
    await prisma.logOrdemProducao.create({
      data: {
        ordemProducaoId: id,
        statusAnterior: op.status,
        statusNovo: body.status,
        usuarioId: user.id,
        observacao: body.observacao || body.motivoCancelamento || null,
      },
    })

    // Gestão automática de reservas de material conforme a transição:
    // - CANCELADA → libera (cancela) as reservas ativas
    // - CONCLUIDA → marca as reservas como consumidas
    try {
      if (body.status === 'CANCELADA') {
        await cancelarReservasOp(id, user.empresaId)
      } else if (body.status === 'CONCLUIDA') {
        await consumirReservasOp(id, user.empresaId)
      }
    } catch (e) {
      // Falha na gestão de reservas não deve bloquear a transição de status
      console.warn('[ordem-producao] Falha ao atualizar reservas na transição:', e)
    }

    // Automação de estoque conforme transição
    let verificacaoEstoque: any = null
    let reservasMateriais: any = null
    let sugestoesCompra: any = null

    try {
      if (body.status === 'PROGRAMADA') {
        // Verificação automática de estoque ao programar
        verificacaoEstoque = await verificarEstoqueOp(id, user.empresaId)

        // Se houver materiais em falta, gerar sugestões de compra
        if (verificacaoEstoque && !verificacaoEstoque.resumo.todosDisponiveis) {
          const sugestoesCriadas = []
          for (const mat of verificacaoEstoque.materiais) {
            if (mat.situacao !== 'SUFICIENTE' && mat.produtoComponenteId && mat.falta > 0) {
              // Verificar se já existe sugestão PENDENTE para este produto+OP
              const existente = await prisma.sugestaoCompra.findFirst({
                where: {
                  empresaId: user.empresaId,
                  ordemProducaoId: id,
                  produtoId: mat.produtoComponenteId,
                  status: 'PENDENTE',
                },
              })
              if (!existente) {
                const sugestao = await prisma.sugestaoCompra.create({
                  data: {
                    empresaId: user.empresaId,
                    ordemProducaoId: id,
                    produtoId: mat.produtoComponenteId,
                    descricao: mat.descricao,
                    quantidade: mat.falta,
                    unidadeMedida: mat.unidade,
                    dataNecessidade: atualizada.dataEntregaPrevista,
                    status: 'PENDENTE',
                  },
                })
                sugestoesCriadas.push(sugestao)
              }
            }
          }
          sugestoesCompra = { criadas: sugestoesCriadas.length }
        }
      }

      if (body.status === 'LIBERADA') {
        // Reserva automática de materiais ao liberar
        reservasMateriais = await criarReservasOp(id, user.empresaId)
      }
    } catch (e) {
      // Falha na verificação/reserva não deve bloquear a transição
      console.warn('[ordem-producao] Falha na automação de estoque:', e)
    }

    return {
      ...atualizada,
      transicoesPermitidas: getTransicoesPermitidas(body.status),
      verificacaoEstoque,
      reservasMateriais,
      sugestoesCompra,
    }
  })

  // =========================================================================
  // GET /api/ordens-producao/:id/verificar-materiais
  // =========================================================================
  app.get('/:id/verificar-materiais', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const op = await prisma.ordemProducao.findFirst({
      where: { id, empresaId: user.empresaId },
      include: { itens: true },
    })

    if (!op) {
      return reply.status(404).send({ message: 'Ordem de produção não encontrada' })
    }

    const verificacao = await Promise.all(
      op.itens.map(async (item) => {
        const estoque = await prisma.estoque.findUnique({
          where: { empresaId_produtoId: { empresaId: user.empresaId, produtoId: item.produtoComponenteId } },
        })

        const estoqueDisponivel = estoque ? Number(estoque.quantidade) : 0
        const estoqueReservado = estoque ? Number(estoque.reservado) : 0
        const saldoLivre = estoqueDisponivel - estoqueReservado
        const quantidadeNecessaria = Number(item.quantidade) - Number(item.quantidadeLiberada)

        let situacao: 'SUFICIENTE' | 'INSUFICIENTE' | 'SEM_ESTOQUE'
        if (estoqueDisponivel === 0) situacao = 'SEM_ESTOQUE'
        else if (saldoLivre >= quantidadeNecessaria) situacao = 'SUFICIENTE'
        else situacao = 'INSUFICIENTE'

        return {
          produtoComponenteId: item.produtoComponenteId,
          descricao: item.descricaoProduto,
          unidade: item.unidadeMedida,
          quantidadeNecessaria: Math.round(quantidadeNecessaria * 10000) / 10000,
          estoqueDisponivel,
          estoqueReservado,
          saldoLivre: Math.round(saldoLivre * 10000) / 10000,
          situacao,
          quantidadeAComprar: situacao !== 'SUFICIENTE' ? Math.max(0, quantidadeNecessaria - saldoLivre) : 0,
        }
      }),
    )

    const totalItens = verificacao.length
    const itensSuficientes = verificacao.filter((v) => v.situacao === 'SUFICIENTE').length
    const itensInsuficientes = verificacao.filter((v) => v.situacao === 'INSUFICIENTE').length
    const itensSemEstoque = verificacao.filter((v) => v.situacao === 'SEM_ESTOQUE').length

    return {
      ordemProducaoId: id,
      numero: op.numero,
      totalItens,
      itensSuficientes,
      itensInsuficientes,
      itensSemEstoque,
      podeLiberar: itensSuficientes === totalItens,
      itens: verificacao,
    }
  })

  // =========================================================================
  // POST /api/ordens-producao/:id/explodir-bom — Re-explosão manual
  // =========================================================================
  app.post('/:id/explodir-bom', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const op = await prisma.ordemProducao.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!op) {
      return reply.status(404).send({ message: 'Ordem de produção não encontrada' })
    }

    if (op.status !== 'RASCUNHO') {
      return reply.status(400).send({ message: 'Explosão de BOM só é permitida em OPs com status RASCUNHO' })
    }

    if (!op.estruturaProdutoId) {
      return reply.status(400).send({ message: 'OP não possui estrutura vinculada' })
    }

    // Remove itens existentes
    await prisma.itemOrdemProducao.deleteMany({ where: { ordemProducaoId: id } })

    // Re-explode
    const resultado = await explodirBomParaOp(id, op.estruturaProdutoId, Number(op.quantidade), user.empresaId)

    return { message: 'BOM explodida com sucesso', itensGerados: resultado.total }
  })

  // =========================================================================
  // POST /api/ordens-producao/gerar-de-pedido — DESATIVADA
  // =========================================================================
  // A geração de OP a partir de pedido de venda foi centralizada na tela de
  // Análise de Produção (PCP → Análise de Produção → aba "Gerar OP", rota
  // POST /pcp/analise-producao/pedidos/:id/gerar-op). Este caminho paralelo
  // foi desativado para evitar OPs criadas sem passar pela análise de
  // estoque/capacidade/compras. A importação de OP por PDF (GPrint) e a
  // criação manual/avulsa de OP continuam funcionando normalmente.
  app.post('/gerar-de-pedido', async (_request, reply) => {
    return reply.status(410).send({
      message: 'A geração de OP a partir de pedido agora é feita pela tela de Análise de Produção (PCP → Análise de Produção → Gerar OP).',
      code: 'USE_ANALISE_PRODUCAO',
    })
  })

  // Trecho legado mantido apenas como referência histórica (nunca executado):
  const _gerarDePedidoLegado = async (request: any, reply: any) => {
    const user = request.user as { id: string; empresaId: string }
    const body = z.object({
      pedidoVendaId: z.string().uuid(),
      itens: z.array(z.object({
        itemPedidoVendaId: z.string().uuid(),
        quantidade: z.number().positive(),
      })).min(1),
    }).parse(request.body)

    // Valida pedido
    const pedido = await prisma.pedidoVenda.findFirst({
      where: { id: body.pedidoVendaId, empresaId: user.empresaId },
      include: { itens: true },
    })

    if (!pedido) {
      return reply.status(404).send({ message: 'Pedido de venda não encontrado' })
    }

    const opsGeradas: Array<{ opId: string; numero: number; produtoId: string; quantidade: number }> = []
    const erros: Array<{ itemPedidoVendaId: string; erro: string }> = []

    for (const itemReq of body.itens) {
      const itemPedido = pedido.itens.find((i) => i.id === itemReq.itemPedidoVendaId)
      if (!itemPedido) {
        erros.push({ itemPedidoVendaId: itemReq.itemPedidoVendaId, erro: 'Item não encontrado no pedido' })
        continue
      }

      // Verifica se tem estrutura
      const estrutura = await prisma.estruturaProduto.findFirst({
        where: { empresaId: user.empresaId, produtoId: itemPedido.produtoId, status: 'ATIVA' },
      })

      if (!estrutura) {
        erros.push({ itemPedidoVendaId: itemReq.itemPedidoVendaId, erro: 'Produto não possui estrutura (BOM) ativa' })
        continue
      }

      // Verifica duplicidade
      const opExistente = await prisma.ordemProducao.findFirst({
        where: {
          empresaId: user.empresaId,
          pedidoVendaId: body.pedidoVendaId,
          produtoId: itemPedido.produtoId,
          status: { notIn: ['CANCELADA', 'CONCLUIDA'] },
        },
      })

      if (opExistente) {
        erros.push({ itemPedidoVendaId: itemReq.itemPedidoVendaId, erro: `Já existe OP ativa (#${opExistente.numero}) para este produto neste pedido` })
        continue
      }

      const numero = await proximoNumeroOp(user.empresaId)

      const op = await prisma.ordemProducao.create({
        data: {
          empresaId: user.empresaId,
          numero,
          produtoId: itemPedido.produtoId,
          estruturaProdutoId: estrutura.id,
          quantidade: itemReq.quantidade,
          unidadeMedida: itemPedido.unidade,
          dataEntregaPrevista: pedido.criadoEm, // usa data do pedido como referência
          prioridade: 'NORMAL',
          pedidoVendaId: body.pedidoVendaId,
          clienteId: pedido.clienteId,
        },
      })

      await explodirBomParaOp(op.id, estrutura.id, itemReq.quantidade, user.empresaId)
      await gerarEtapasOp(op.id, itemPedido.produtoId, itemReq.quantidade, user.empresaId)

      await prisma.logOrdemProducao.create({
        data: {
          ordemProducaoId: op.id,
          statusAnterior: '',
          statusNovo: 'RASCUNHO',
          usuarioId: user.id,
          observacao: `Gerada a partir do pedido de venda #${pedido.numero}`,
        },
      })

      opsGeradas.push({ opId: op.id, numero, produtoId: itemPedido.produtoId, quantidade: itemReq.quantidade })
    }

    return reply.status(201).send({
      pedidoVendaId: body.pedidoVendaId,
      opsGeradas,
      erros,
      totalGeradas: opsGeradas.length,
      totalErros: erros.length,
    })
  }
  void _gerarDePedidoLegado // referência mantida, não usada

  // =========================================================================
  // GET /api/ordens-producao/kanban — Visão Kanban
  // =========================================================================
  app.get('/kanban', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { prioridade, clienteId } = z.object({
      prioridade: z.enum(['BAIXA', 'NORMAL', 'ALTA', 'URGENTE']).optional(),
      clienteId: z.string().uuid().optional(),
    }).parse(request.query)

    const where: any = {
      empresaId: user.empresaId,
      status: { notIn: ['CANCELADA'] },
    }
    if (prioridade) where.prioridade = prioridade
    if (clienteId) where.clienteId = clienteId

    const ops = await prisma.ordemProducao.findMany({
      where,
      orderBy: [
        { prioridade: 'desc' },
        { dataEntregaPrevista: 'asc' },
      ],
      omit: { pdfData: true }, // BYTEA pesado — não precisa no kanban
    })

    const colunas: Record<string, any[]> = {
      RASCUNHO: [],
      PLANEJADA: [],
      PROGRAMADA: [],
      LIBERADA: [],
      EM_PRODUCAO: [],
      CONCLUIDA: [],
    }

    for (const op of ops) {
      const percentual = Number(op.quantidade) > 0
        ? Math.min(100, Math.round((Number(op.quantidadeProduzida) / Number(op.quantidade)) * 100))
        : 0

      const item = {
        id: op.id,
        numero: op.numero,
        produtoId: op.produtoId,
        quantidade: Number(op.quantidade),
        unidadeMedida: op.unidadeMedida,
        prioridade: op.prioridade,
        dataEntregaPrevista: op.dataEntregaPrevista,
        clienteId: op.clienteId,
        lote: op.lote,
        percentualConcluido: percentual,
      }

      if (colunas[op.status]) {
        colunas[op.status].push(item)
      }
    }

    const contadores = Object.entries(colunas).map(([status, items]) => ({
      status,
      total: items.length,
      quantidadeTotal: items.reduce((acc, i) => acc + i.quantidade, 0),
    }))

    return { colunas, contadores }
  })

  // =========================================================================
  // PATCH /api/ordens-producao/:id — Atualização parcial
  // =========================================================================
  app.patch('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil?: string }
    if (!await verificarAcessoMenu(user.empresaId, user.id, user.perfil, 'ordens-producao', 'editar')) {
      return reply.status(403).send({ message: 'Sem permissão para editar ordens de produção' })
    }
    const { id } = idParamsSchema.parse(request.params)
    const body = z.object({
      quantidade: z.number().positive().optional(),
      unidadeMedida: z.string().max(10).optional(),
      dataEntregaPrevista: z.string().optional(),
      prioridade: z.enum(['BAIXA', 'NORMAL', 'ALTA', 'URGENTE']).optional(),
      lote: z.string().max(50).optional().nullable(),
      cor: z.string().max(50).optional().nullable(),
      observacoes: z.string().optional().nullable(),
      dataInicioPrevista: z.string().optional().nullable(),
      dataFimPrevista: z.string().optional().nullable(),
    }).parse(request.body)

    const op = await prisma.ordemProducao.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true, status: true },
    })

    if (!op) {
      return reply.status(404).send({ message: 'Ordem de produção não encontrada' })
    }

    if (['CONCLUIDA', 'CANCELADA'].includes(op.status)) {
      return reply.status(400).send({ message: 'Não é possível editar uma OP concluída ou cancelada' })
    }

    const data: any = {}
    if (body.quantidade !== undefined) data.quantidade = body.quantidade
    if (body.unidadeMedida !== undefined) data.unidadeMedida = body.unidadeMedida
    if (body.dataEntregaPrevista !== undefined) data.dataEntregaPrevista = new Date(body.dataEntregaPrevista)
    if (body.prioridade !== undefined) data.prioridade = body.prioridade
    if (body.lote !== undefined) data.lote = body.lote
    if (body.cor !== undefined) data.cor = body.cor
    if (body.observacoes !== undefined) data.observacoes = body.observacoes
    if (body.dataInicioPrevista !== undefined) data.dataInicioPrevista = body.dataInicioPrevista ? new Date(body.dataInicioPrevista) : null
    if (body.dataFimPrevista !== undefined) data.dataFimPrevista = body.dataFimPrevista ? new Date(body.dataFimPrevista) : null

    // select explícito para excluir pdfData (BYTEA) da resposta — ver comentário
    // detalhado no handler PATCH /:id/status acima.
    const atualizada = await prisma.ordemProducao.update({
      where: { id },
      data,
      select: {
        id: true, empresaId: true, numero: true, produtoId: true, estruturaProdutoId: true,
        quantidade: true, unidadeMedida: true, quantidadeProduzida: true, quantidadeRejeitada: true,
        status: true, prioridade: true, dataEmissao: true, dataEntregaPrevista: true,
        dataEntregaOriginal: true, vezesPostergada: true, dataInicioPrevista: true, dataFimPrevista: true,
        dataInicioReal: true, dataFimReal: true, pedidoVendaId: true, clienteId: true, lote: true, cor: true,
        grupoOpId: true, quantidadeExcedente: true, motivoCancelamento: true, observacoes: true,
        referenciaExterna: true, origemImportacao: true, criadoPorId: true, criadoEm: true, atualizadoEm: true,
      },
    })

    // Log de auditoria — edição parcial
    const camposAlterados = Object.keys(data).filter(k => k !== 'observacoes').join(', ')
    if (camposAlterados) {
      await prisma.logOrdemProducao.create({
        data: {
          ordemProducaoId: id,
          statusAnterior: op.status,
          statusNovo: op.status,
          usuarioId: user.id,
          observacao: `Campos alterados: ${camposAlterados}${body.prioridade ? ` (prioridade: ${body.prioridade})` : ''}${body.quantidade ? ` (quantidade: ${body.quantidade})` : ''}`,
        },
      })
    }

    return atualizada
  })

  // =========================================================================
  // PATCH /api/ordens-producao/:id/quantidade-produzida — Registrar/corrigir
  // quantidade produzida (uso principal: OPs antigas que foram concluídas
  // pelo painel de Programação antes da correção que propaga automaticamente
  // a quantidade apontada nas etapas — ver etapa-operacional.routes.ts,
  // rota /etapas/:id/concluir). Diferente do PATCH /:id genérico, esta rota
  // permite editar mesmo com a OP já CONCLUIDA, pois é exatamente o caso de
  // uso: corrigir o %Concluído de uma OP finalizada que ficou com 0%.
  // =========================================================================
  app.patch('/:id/quantidade-produzida', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = z.object({
      quantidadeProduzida: z.number().min(0),
      quantidadeRejeitada: z.number().min(0).optional(),
    }).parse(request.body)

    const op = await prisma.ordemProducao.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true, status: true, quantidade: true },
    })
    if (!op) {
      return reply.status(404).send({ message: 'Ordem de produção não encontrada' })
    }
    if (op.status === 'CANCELADA') {
      return reply.status(400).send({ message: 'Não é possível editar uma OP cancelada' })
    }

    const data: any = { quantidadeProduzida: body.quantidadeProduzida }
    if (body.quantidadeRejeitada !== undefined) data.quantidadeRejeitada = body.quantidadeRejeitada

    const atualizada = await prisma.ordemProducao.update({
      where: { id },
      data,
      select: {
        id: true, empresaId: true, numero: true, produtoId: true, estruturaProdutoId: true,
        quantidade: true, unidadeMedida: true, quantidadeProduzida: true, quantidadeRejeitada: true,
        status: true, prioridade: true, dataEmissao: true, dataEntregaPrevista: true,
        dataEntregaOriginal: true, vezesPostergada: true, dataInicioPrevista: true, dataFimPrevista: true,
        dataInicioReal: true, dataFimReal: true, pedidoVendaId: true, clienteId: true, lote: true, cor: true,
        grupoOpId: true, quantidadeExcedente: true, motivoCancelamento: true, observacoes: true,
        referenciaExterna: true, origemImportacao: true, criadoPorId: true, criadoEm: true, atualizadoEm: true,
      },
    })

    await prisma.logOrdemProducao.create({
      data: {
        ordemProducaoId: id,
        statusAnterior: op.status,
        statusNovo: op.status,
        usuarioId: user.id,
        observacao: `Quantidade produzida registrada/corrigida manualmente: ${body.quantidadeProduzida}`,
      },
    })

    const percentualConcluido = Number(op.quantidade) > 0
      ? Math.min(100, Math.round((Number(atualizada.quantidadeProduzida) / Number(op.quantidade)) * 100))
      : 0

    return { ...atualizada, percentualConcluido }
  })

  // =========================================================================
  // POST /api/ordens-producao/:id/etapas — Criar etapa manualmente na OP
  // visualizada (tela de detalhe da OP, aba Etapas). Diferente da rota
  // /pcp/etapas/adicionar-manual (usada no painel de Programação, que busca
  // a OP pelo número), esta já recebe o ID da OP direto da tela de detalhe,
  // e permite informar setup/operação/espera — os mesmos campos exibidos na
  // tabela de Etapas dessa tela.
  // =========================================================================
  app.post('/:id/etapas', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = z.object({
      descricao: z.string().min(1, 'Descrição é obrigatória').max(200),
      centroProducaoId: z.string().uuid().nullable().optional(),
      tempoSetupMinutos: z.number().min(0).optional().default(0),
      tempoOperacaoMinutos: z.number().min(0).optional().default(0),
      tempoEsperaMinutos: z.number().min(0).optional().default(0),
    }).parse(request.body)

    const op = await prisma.ordemProducao.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true, status: true },
    })
    if (!op) {
      return reply.status(404).send({ message: 'Ordem de produção não encontrada' })
    }
    if (['CONCLUIDA', 'CANCELADA'].includes(op.status)) {
      return reply.status(400).send({ message: `Não é possível adicionar etapa a uma OP ${op.status.toLowerCase()}` })
    }

    if (body.centroProducaoId) {
      const centro = await prisma.centroProducao.findFirst({
        where: { id: body.centroProducaoId, empresaId: user.empresaId },
        select: { id: true },
      })
      if (!centro) {
        return reply.status(404).send({ message: 'Centro de produção não encontrado' })
      }
    }

    const maxSeq = await prisma.etapaOrdemProducao.aggregate({
      where: { ordemProducaoId: id },
      _max: { sequencia: true },
    })

    // Posição de fila só faz sentido se a etapa já nasce vinculada a um
    // centro — mesma lógica usada em /pcp/etapas/adicionar-manual, para a
    // etapa entrar no fim da fila daquele centro no painel de Programação.
    let posicaoFila: number | null = null
    if (body.centroProducaoId) {
      const maxPos = await prisma.etapaOrdemProducao.aggregate({
        where: { centroProducaoId: body.centroProducaoId, status: { in: ['PENDENTE', 'EM_ANDAMENTO', 'PAUSADA'] } },
        _max: { posicaoFila: true },
      })
      posicaoFila = (maxPos._max.posicaoFila || 0) + 1
    }

    const etapa = await prisma.etapaOrdemProducao.create({
      data: {
        ordemProducaoId: id,
        sequencia: (maxSeq._max.sequencia || 0) + 1,
        descricao: body.descricao,
        centroProducaoId: body.centroProducaoId || null,
        tempoSetupMinutos: body.tempoSetupMinutos,
        tempoOperacaoCalculado: body.tempoOperacaoMinutos,
        tempoEsperaMinutos: body.tempoEsperaMinutos,
        status: 'PENDENTE',
        posicaoFila,
      },
      include: { centroProducao: { select: { id: true, descricao: true } } },
    })

    return reply.status(201).send(etapa)
  })

  // =========================================================================
  // GET /api/ordens-producao/:id/pdf — Servir PDF importado
  // =========================================================================
  app.get('/:id/pdf', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const op = await prisma.ordemProducao.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!op) return reply.status(404).send({ message: 'OP não encontrada' })

    const pdfBuffer = await carregarOpPdf(id)
    if (!pdfBuffer) {
      return reply.status(404).send({ message: 'PDF não encontrado para esta OP' })
    }

    return reply.type('application/pdf').send(pdfBuffer)
  })

  // =========================================================================
  // GET /api/ordens-producao/:id/pdf-gerado — Gera PDF profissional da OP nativa
  // =========================================================================
  app.get('/:id/pdf-gerado', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    try {
      const pdfBuffer = await gerarOpPdf(id, user.empresaId)
      const op = await prisma.ordemProducao.findFirst({
        where: { id, empresaId: user.empresaId },
        select: { numero: true },
      })
      const nomeArquivo = `OP-${op?.numero ?? id}.pdf`
      return reply
        .type('application/pdf')
        .header('Content-Disposition', `inline; filename="${nomeArquivo}"`)
        .send(pdfBuffer)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro ao gerar PDF da OP' })
    }
  })

  // =========================================================================
  // POST /api/ordens-producao/pdf-status — Verifica quais OPs possuem PDF salvo (em lote)
  // =========================================================================
  app.post('/pdf-status', async (request, reply) => {
    const body = z.object({ ids: z.array(z.string().uuid()).max(100) }).parse(request.body)

    // Verificar no banco quais OPs têm pdfData preenchido
    const opsComPdf = await prisma.ordemProducao.findMany({
      where: { id: { in: body.ids }, pdfData: { not: null } },
      select: { id: true },
    })
    const idsComPdf = new Set(opsComPdf.map(op => op.id))

    // Também verificar disco local (para OPs migradas que ainda não estão no banco)
    const fs = require('fs')
    const result: Record<string, boolean> = {}
    for (const id of body.ids) {
      result[id] = idsComPdf.has(id) || fs.existsSync(getOpPdfPath(id))
    }
    return result
  })

  // =========================================================================
  // PUT /api/ordens-producao/:id/pdf — Upload/substituição de PDF para uma OP existente
  // =========================================================================
  app.put('/:id/pdf', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const op = await prisma.ordemProducao.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true, numero: true },
    })
    if (!op) return reply.status(404).send({ message: 'OP não encontrada' })

    const file = await request.file()
    if (!file) {
      return reply.status(400).send({ message: 'Nenhum arquivo enviado. Envie um PDF via multipart/form-data.' })
    }
    if (!file.mimetype.includes('pdf')) {
      return reply.status(400).send({ message: 'Formato inválido. Envie um arquivo PDF.' })
    }

    const buffer = await file.toBuffer()
    if (buffer.length > 10 * 1024 * 1024) {
      return reply.status(400).send({ message: 'Arquivo excede o limite de 10MB.' })
    }

    await salvarOpPdf(id, buffer)

    return { message: `PDF salvo para OP #${op.numero}`, temPdf: true }
  })

  // =========================================================================
  // PATCH /api/ordens-producao/:id/cancelar-forcado — Cancela OP em qualquer
  // status (incluindo EM_PRODUCAO e CONCLUIDA), exigindo senha de admin
  // =========================================================================
  app.patch('/:id/cancelar-forcado', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = z.object({
      motivoCancelamento: z.string().min(10, 'Motivo deve ter pelo menos 10 caracteres'),
      emailAdmin: z.string().min(1),
      senhaAdmin: z.string().min(1),
    }).parse(request.body)

    // Verificar credenciais do admin
    const bcrypt = await import('bcryptjs')
    let admin = await prisma.usuario.findFirst({ where: { email: body.emailAdmin } })
    if (!admin) {
      admin = await prisma.usuario.findFirst({
        where: { email: { contains: body.emailAdmin, mode: 'insensitive' } },
      })
    }
    if (!admin) {
      return reply.status(401).send({ message: 'Credenciais de administrador inválidas' })
    }
    const senhaValida = bcrypt.default.compareSync(body.senhaAdmin, admin.senha)
    if (!senhaValida) {
      return reply.status(401).send({ message: 'Credenciais de administrador inválidas' })
    }
    if (!['SUPER_ADMIN', 'ADMIN'].includes(admin.perfil)) {
      return reply.status(403).send({ message: 'Apenas ADMIN pode cancelar OPs em produção/concluídas' })
    }

    const op = await prisma.ordemProducao.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true, numero: true, status: true, empresaId: true },
    })

    if (!op) {
      return reply.status(404).send({ message: 'Ordem de produção não encontrada' })
    }

    if (op.status === 'CANCELADA') {
      return reply.status(400).send({ message: 'OP já está cancelada' })
    }

    const statusAnterior = op.status

    await prisma.ordemProducao.update({
      where: { id },
      data: { status: 'CANCELADA', motivoCancelamento: body.motivoCancelamento },
    })

    // Log de auditoria
    await prisma.logOrdemProducao.create({
      data: {
        ordemProducaoId: id,
        usuarioId: admin.id,
        statusAnterior,
        statusNovo: 'CANCELADA',
        observacao: `Cancelamento forçado por ${admin.nome} (${admin.email}). Motivo: ${body.motivoCancelamento}`,
      },
    })

    return { message: `OP #${op.numero} cancelada com sucesso` }
  })

  // =========================================================================
  // PATCH /api/ordens-producao/:id/forcar-status — Transição forçada (SUPER_ADMIN)
  // Permite alterar o status de uma OP concluída/cancelada para qualquer outro.
  // =========================================================================
  app.patch('/:id/forcar-status', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil?: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = z.object({
      status: z.string(),
      motivoAlteracao: z.string().min(10, 'Motivo deve ter pelo menos 10 caracteres'),
      emailAdmin: z.string().min(1),
      senhaAdmin: z.string().min(1),
    }).parse(request.body)

    // Verificar credenciais do admin
    const bcrypt = await import('bcryptjs')
    let admin = await prisma.usuario.findFirst({ where: { email: body.emailAdmin } })
    if (!admin) {
      admin = await prisma.usuario.findFirst({
        where: { email: { contains: body.emailAdmin, mode: 'insensitive' } },
      })
    }
    if (!admin) {
      return reply.status(401).send({ message: 'Credenciais de administrador inválidas' })
    }
    const senhaValida = bcrypt.default.compareSync(body.senhaAdmin, admin.senha)
    if (!senhaValida) {
      return reply.status(401).send({ message: 'Credenciais de administrador inválidas' })
    }
    if (admin.perfil !== 'SUPER_ADMIN') {
      return reply.status(403).send({ message: 'Apenas SUPER_ADMIN pode forçar transição de status' })
    }

    const op = await prisma.ordemProducao.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true, numero: true, status: true, empresaId: true, referenciaExterna: true },
    })

    if (!op) {
      return reply.status(404).send({ message: 'Ordem de produção não encontrada' })
    }

    if (op.status === body.status) {
      return reply.status(400).send({ message: `OP já está no status ${body.status}` })
    }

    // Validar que o novo status é um status válido do sistema
    const statusValidos = getTransicoesForcadas(op.status)
    if (!statusValidos.includes(body.status)) {
      return reply.status(400).send({ message: `Status '${body.status}' não é um status válido do sistema` })
    }

    const statusAnterior = op.status
    const dataUpdate: any = { status: body.status }

    // Se está voltando de CONCLUIDA, limpar dataFimReal
    if (statusAnterior === 'CONCLUIDA' && body.status !== 'CONCLUIDA') {
      dataUpdate.dataFimReal = null
    }
    // Se está indo para CONCLUIDA, setar dataFimReal
    if (body.status === 'CONCLUIDA') {
      dataUpdate.dataFimReal = new Date()
    }
    // Se está voltando para antes de EM_PRODUCAO, limpar dataInicioReal
    if (['RASCUNHO', 'PLANEJADA', 'PROGRAMADA', 'LIBERADA'].includes(body.status) && statusAnterior === 'EM_PRODUCAO') {
      dataUpdate.dataInicioReal = null
    }
    // Se está indo para EM_PRODUCAO, setar dataInicioReal
    if (body.status === 'EM_PRODUCAO') {
      dataUpdate.dataInicioReal = new Date()
    }
    // Se estiver saindo de CANCELADA, limpar motivoCancelamento
    if (statusAnterior === 'CANCELADA' && body.status !== 'CANCELADA') {
      dataUpdate.motivoCancelamento = null
    }
    // Se está indo para CANCELADA, a motivoAlteracao serve como motivo
    if (body.status === 'CANCELADA') {
      dataUpdate.motivoCancelamento = body.motivoAlteracao
    }

    await prisma.ordemProducao.update({
      where: { id },
      data: dataUpdate,
    })

    // Log de auditoria
    await prisma.logOrdemProducao.create({
      data: {
        ordemProducaoId: id,
        usuarioId: admin.id,
        statusAnterior,
        statusNovo: body.status,
        observacao: `Transição forçada por ${admin.nome} (${admin.email}): ${statusAnterior} → ${body.status}. Motivo: ${body.motivoAlteracao}`,
      },
    })

    return {
      message: `OP #${op.referenciaExterna || op.numero} alterada de ${statusAnterior} para ${body.status}`,
      statusAnterior,
      statusNovo: body.status,
    }
  })

  // =========================================================================
  // DELETE /api/ordens-producao/:id — Exclui OP que não tem apontamento/não iniciada
  // =========================================================================
  app.delete('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil?: string }
    if (!await verificarAcessoMenu(user.empresaId, user.id, user.perfil, 'ordens-producao', 'excluir')) {
      return reply.status(403).send({ message: 'Sem permissão para excluir ordens de produção' })
    }
    const { id } = idParamsSchema.parse(request.params)

    const op = await prisma.ordemProducao.findFirst({
      where: { id, empresaId: user.empresaId },
      include: {
        etapas: { select: { id: true, status: true } },
        apontamentos: { select: { id: true }, take: 1 },
      },
    })

    if (!op) {
      return reply.status(404).send({ message: 'Ordem de produção não encontrada' })
    }

    // Não permitir exclusão se OP já foi concluída
    if (op.status === 'CONCLUIDA') {
      return reply.status(400).send({ message: 'Não é possível excluir uma OP já concluída.' })
    }

    // Não permitir se há apontamentos de produção registrados
    if (op.apontamentos.length > 0) {
      return reply.status(400).send({ message: 'Não é possível excluir OP que já possui apontamentos de produção.' })
    }

    // Não permitir se alguma etapa já foi iniciada (EM_ANDAMENTO ou CONCLUIDA)
    const etapaIniciada = op.etapas.find(e => ['EM_ANDAMENTO', 'CONCLUIDA'].includes(e.status))
    if (etapaIniciada) {
      return reply.status(400).send({ message: 'Não é possível excluir OP que já possui etapas em andamento ou concluídas.' })
    }

    // Verificar apontamentos por etapa também
    const apontamentosEtapa = await prisma.apontamentoEtapa.findFirst({
      where: { etapaOrdemProducao: { ordemProducaoId: id } },
    })
    if (apontamentosEtapa) {
      return reply.status(400).send({ message: 'Não é possível excluir OP que já possui apontamentos registrados nas etapas.' })
    }

    // Pode excluir — remover dependências em cascata
    await prisma.$transaction([
      prisma.itemLiberacao.deleteMany({ where: { liberacaoMaterial: { ordemProducaoId: id } } }),
      prisma.liberacaoMaterial.deleteMany({ where: { ordemProducaoId: id } }),
      prisma.apontamentoEtapa.deleteMany({ where: { etapaOrdemProducao: { ordemProducaoId: id } } }),
      prisma.etapaOrdemProducao.deleteMany({ where: { ordemProducaoId: id } }),
      prisma.itemOrdemProducao.deleteMany({ where: { ordemProducaoId: id } }),
      prisma.logOrdemProducao.deleteMany({ where: { ordemProducaoId: id } }),
      prisma.programacaoEntrega.deleteMany({ where: { ordemProducaoId: id } }),
      prisma.variacaoOrdemProducao.deleteMany({ where: { ordemProducaoId: id } }),
      prisma.ordemProducao.delete({ where: { id } }),
    ])

    // Remover PDF do disco se existir
    await removerOpPdf(id)

    return { message: `OP #${op.numero} excluída com sucesso` }
  })
}
