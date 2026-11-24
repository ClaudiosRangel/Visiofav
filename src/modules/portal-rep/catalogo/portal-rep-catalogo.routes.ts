/**
 * Rotas de catálogo do Portal do Representante.
 *
 * Fornece dados de referência (tipos de embalagem, acabamentos) para
 * que o representante preencha solicitações de orçamento com opções
 * do cadastro real da empresa.
 *
 * Rotas protegidas por `portalRepAuth`.
 */

import { FastifyInstance } from 'fastify'
import { prisma } from '../../../lib/prisma'
import { portalRepAuth } from '../auth/portal-rep-auth.middleware'

export async function portalRepCatalogoRoutes(app: FastifyInstance) {

  // GET /catalogo/tipos-embalagem — lista tipos de embalagem da empresa
  app.get('/tipos-embalagem', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const { empresaId } = request.portalRepUser

    const tipos = await prisma.tipoEmbalagem.findMany({
      where: { empresaId, status: true },
      select: {
        id: true,
        codigo: true,
        descricao: true,
      },
      orderBy: { descricao: 'asc' },
    })

    return reply.status(200).send(tipos)
  })

  // GET /catalogo/meus-produtos — produtos "do representante" para o pedido de
  // REPETIÇÃO. Reúne, sem duplicar, produtos ligados a ele por:
  //  (a) pedidos/propostas dele que já têm produto vinculado;
  //  (b) produtos criados a partir de pedidos/propostas dele (origem);
  //  (c) itens de pedidos de venda do vendedor dele;
  //  (d) solicitações anteriores dele que reproduziram um produto.
  // Filtros opcionais: clienteId (só produtos daquele cliente) e busca (nome/código).
  // Isolamento: empresaId + representanteId/vendedorId SEMPRE do token.
  app.get('/meus-produtos', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const { empresaId, representanteId, vendedorId } = request.portalRepUser
    const { clienteId, busca } = request.query as { clienteId?: string; busca?: string }

    const [propostas, vendas, solicitacoes] = await Promise.all([
      prisma.pedidoProposta.findMany({
        where: { empresaId, representanteId, ...(clienteId ? { clienteId } : {}) },
        select: { id: true, produtoId: true, clienteNome: true, criadoEm: true },
      }),
      prisma.itemPedidoVenda.findMany({
        where: {
          pedidoVenda: { empresaId, vendedorId, ...(clienteId ? { clienteId } : {}) },
        },
        select: { produtoId: true, pedidoVenda: { select: { criadoEm: true } } },
      }),
      prisma.solicitacaoOrcamentoRep.findMany({
        where: { empresaId, representanteId, produtoId: { not: null }, ...(clienteId ? { clienteId } : {}) },
        select: { produtoId: true, criadoEm: true },
      }),
    ])

    const ultimoUso = new Map<string, Date>()
    const marcar = (id: string | null | undefined, data: Date) => {
      if (!id) return
      const atual = ultimoUso.get(id)
      if (!atual || data > atual) ultimoUso.set(id, data)
    }
    for (const p of propostas) marcar(p.produtoId, p.criadoEm)
    for (const v of vendas) marcar(v.produtoId, v.pedidoVenda.criadoEm)
    for (const s of solicitacoes) marcar(s.produtoId, s.criadoEm)

    const propostaIds = propostas.map((p) => p.id)
    const deOrigem = propostaIds.length
      ? await prisma.produto.findMany({
          where: { empresaId, pedidoPropostaOrigemId: { in: propostaIds } },
          select: { id: true, criadoEm: true },
        } as never) as unknown as Array<{ id: string; criadoEm: Date }>
      : []
    for (const o of deOrigem) marcar(o.id, o.criadoEm)

    const ids = [...ultimoUso.keys()]
    if (ids.length === 0) return reply.status(200).send([])

    const termo = busca?.trim()
    const produtos = await prisma.produto.findMany({
      where: {
        empresaId,
        id: { in: ids },
        status: true, // exclui provisórios/inativos (ainda não aprovados)
        ...(termo
          ? { OR: [
              { nome: { contains: termo, mode: 'insensitive' } },
              { codigo: { contains: termo, mode: 'insensitive' } },
            ] }
          : {}),
      },
      select: { id: true, codigo: true, nome: true },
    })

    const resultado = produtos
      .map((p) => ({ ...p, ultimoPedidoEm: ultimoUso.get(p.id) ?? null }))
      .sort((a, b) => (b.ultimoPedidoEm?.getTime() ?? 0) - (a.ultimoPedidoEm?.getTime() ?? 0))
      .slice(0, 200)
    return reply.status(200).send(resultado)
  })

  // GET /catalogo/acabamentos — lista acabamentos disponíveis (fixos + parametros-perda)
  app.get('/acabamentos', { preHandler: [portalRepAuth] }, async (request, reply) => {
    // Acabamentos são um catálogo fixo da indústria gráfica
    // mas podemos enriquecer com os processos cadastrados nos centros de produção
    const { empresaId } = request.portalRepUser

    // Buscar tipos de processo distintos (que representam acabamentos)
    const tiposProcesso = await prisma.tipoProcesso.findMany({
      where: { empresaId, status: true },
      select: { codigo: true, descricao: true },
      orderBy: { posicao: 'asc' },
    })

    // Combinar com acabamentos padrão da indústria
    const acabamentosPadrao = [
      { codigo: 'CORTE_VINCO', descricao: 'Corte e Vinco' },
      { codigo: 'COLAGEM', descricao: 'Colagem' },
      { codigo: 'VERNIZ_UV', descricao: 'Verniz UV' },
      { codigo: 'LAMINACAO_BOPP', descricao: 'Laminação BOPP' },
      { codigo: 'LAMINACAO_FOSCA', descricao: 'Laminação Fosca' },
      { codigo: 'HOT_STAMPING', descricao: 'Hot Stamping' },
      { codigo: 'RELEVO_SECO', descricao: 'Relevo Seco' },
      { codigo: 'VERNIZ_AQUOSO', descricao: 'Verniz Aquoso' },
      { codigo: 'PLASTIFICACAO', descricao: 'Plastificação' },
    ]

    // Mesclar: processos da empresa + padrão (sem duplicar por código)
    const codigos = new Set<string>()
    const resultado: Array<{ codigo: string; descricao: string }> = []

    for (const tp of tiposProcesso) {
      if (!codigos.has(tp.codigo)) {
        codigos.add(tp.codigo)
        resultado.push({ codigo: tp.codigo, descricao: tp.descricao })
      }
    }

    for (const ap of acabamentosPadrao) {
      if (!codigos.has(ap.codigo)) {
        codigos.add(ap.codigo)
        resultado.push(ap)
      }
    }

    return reply.status(200).send(resultado)
  })
}
