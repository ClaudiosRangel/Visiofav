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
import { obterCatalogoComercial } from '../../orcamento-grafico/pedido-proposta/catalogo-comercial.service'
import { portalRepAuth } from '../auth/portal-rep-auth.middleware'
import { buscarMunicipiosIBGE } from '../../fiscal/emissor-dfe/cte/cte-municipios.routes'

export async function portalRepCatalogoRoutes(app: FastifyInstance) {

  // GET /catalogo/comercial - listas unicas (mesmas de Pedidos/Propostas):
  // tipos de embalagem, acabamentos, acondicionamentos, suportes e prazos.
  app.get('/comercial', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const { empresaId } = request.portalRepUser
    return reply.status(200).send(await obterCatalogoComercial(empresaId))
  })

  // GET /catalogo/municipios?uf=RJ - municípios do IBGE (busca de cidade).
  app.get('/municipios', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const { uf } = request.query as { uf?: string }
    if (!uf || !/^[A-Za-z]{2}$/.test(uf)) return reply.status(400).send({ message: 'Informe a UF (2 letras).' })
    return reply.status(200).send(await buscarMunicipiosIBGE(uf.toUpperCase()))
  })

  // Compatibilidade com versoes antigas do app (mesma fonte do /comercial).
  app.get('/tipos-embalagem', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const { empresaId } = request.portalRepUser
    const { tiposEmbalagem } = await obterCatalogoComercial(empresaId)
    return reply.status(200).send(tiposEmbalagem)
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

  // GET /catalogo/acabamentos — acabamentos do produto (cadastro comercial).
  app.get('/acabamentos', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const { empresaId } = request.portalRepUser
    const { acabamentos } = await obterCatalogoComercial(empresaId)
    return reply.status(200).send(acabamentos.map((a) => ({ codigo: a.codigo, descricao: a.nome, id: a.id })))
  })}
