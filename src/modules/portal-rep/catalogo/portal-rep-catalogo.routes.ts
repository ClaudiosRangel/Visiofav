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
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { obterCatalogoComercial } from '../../orcamento-grafico/pedido-proposta/catalogo-comercial.service'
import { historicoPrazosCliente } from '../../orcamento-grafico/prazo-orcamento.service'
import { portalRepAuth } from '../auth/portal-rep-auth.middleware'
import { buscarMunicipiosIBGE } from '../../fiscal/emissor-dfe/cte/cte-municipios.routes'

export async function portalRepCatalogoRoutes(app: FastifyInstance) {

  // GET /catalogo/comercial - listas unicas (mesmas de Pedidos/Propostas):
  // tipos de embalagem, acabamentos, acondicionamentos, suportes e prazos.
  app.get('/comercial', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const { empresaId } = request.portalRepUser
    return reply.status(200).send(await obterCatalogoComercial(empresaId))
  })

  // GET /catalogo/clientes/:clienteId/prazo-padrao - prazo mais usado pelo cliente (spec
  // orcamento-prazos-cliente-margem R4), para já vir preenchido na solicitação nova.
  app.get('/clientes/:clienteId/prazo-padrao', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const { empresaId } = request.portalRepUser
    const parsed = z.object({ clienteId: z.string().uuid() }).safeParse(request.params)
    if (!parsed.success) return reply.status(400).send({ message: 'Cliente inválido.' })
    const cliente = await prisma.cliente.findFirst({ where: { id: parsed.data.clienteId, empresaId }, select: { id: true } })
    if (!cliente) return reply.status(404).send({ message: 'Cliente não encontrado.' })
    const { padrao } = await historicoPrazosCliente(empresaId, cliente.id)
    return reply.status(200).send({ padrao })
  })

  // POST /catalogo/prazos-pagamento - o representante cria um prazo novo (mesmo cadastro do
  // Comercial: aparece em Pedidos/Propostas e no orçamento). Se já existir um prazo ativo com a
  // mesma descrição (sem diferenciar maiúsculas), devolve o existente em vez de duplicar.
  app.post('/prazos-pagamento', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const { empresaId, representanteId } = request.portalRepUser
    const parsed = z.object({
      descricao: z.string().trim().min(2, 'Informe a descrição do prazo.').max(120),
      dias: z.coerce.number().int().min(0).max(720).default(0),
      parcelas: z.coerce.number().int().min(1).max(60).default(1),
    }).safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message || 'Dados inválidos.', code: 'DADOS_INVALIDOS' })
    }
    const { descricao, dias, parcelas } = parsed.data

    const existente = await prisma.condicaoPagamentoComercial.findFirst({
      where: { empresaId, descricao: { equals: descricao, mode: 'insensitive' } },
      select: { id: true, descricao: true, status: true },
    })
    if (existente) {
      if (!existente.status) {
        return reply.status(409).send({
          message: 'Esse prazo existe, mas está inativo. Fale com o Comercial para reativá-lo.',
          code: 'PRAZO_INATIVO',
        })
      }
      return reply.status(200).send({ id: existente.id, descricao: existente.descricao, reaproveitado: true })
    }

    const criado = await prisma.condicaoPagamentoComercial.create({
      data: { empresaId, descricao, dias, parcelas },
      select: { id: true, descricao: true },
    })
    await prisma.logAuditoriaRep.create({
      data: {
        empresaId,
        representanteId,
        acao: 'PRAZO_PAGAMENTO_CRIADO',
        detalhes: `Prazo criado pelo portal: ${descricao} (${dias} dias, ${parcelas}x)`,
      },
    })
    return reply.status(201).send({ ...criado, reaproveitado: false })
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

  // GET /catalogo/meus-produtos/:produtoId/pedidos — pedidos CONCLUÍDOS do produto para o
  // representante escolher qual repetir. Cada pedido traz `dados` para preencher o formulário.
  // Concluído = proposta ACEITA, solicitação CONVERTIDA ou pedido de venda fora de RASCUNHO/CANCELADO.
  // Isolamento: empresaId + representanteId/vendedorId SEMPRE do token.
  app.get('/meus-produtos/:produtoId/pedidos', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const { empresaId, representanteId, vendedorId } = request.portalRepUser
    const { produtoId } = request.params as { produtoId: string }
    const { clienteId } = request.query as { clienteId?: string }
    if (!/^[0-9a-f-]{36}$/i.test(produtoId)) return reply.status(400).send({ message: 'Produto inválido.' })

    const produto = await prisma.produto.findFirst({
      where: { id: produtoId, empresaId, status: true },
      select: { id: true, codigo: true, nome: true },
    })
    if (!produto) return reply.status(404).send({ message: 'Produto não encontrado.' })

    const filtroCliente = clienteId ? { clienteId } : {}
    const [propostas, solicitacoes, itensVenda] = await Promise.all([
      prisma.pedidoProposta.findMany({
        where: { empresaId, representanteId, produtoId, estado: 'ACEITO', ...filtroCliente },
        orderBy: { criadoEm: 'desc' },
        take: 50,
      }),
      prisma.solicitacaoOrcamentoRep.findMany({
        where: { empresaId, representanteId, produtoId, status: 'CONVERTIDA', ...filtroCliente },
        orderBy: { criadoEm: 'desc' },
        take: 50,
      }),
      prisma.itemPedidoVenda.findMany({
        where: {
          produtoId,
          pedidoVenda: { empresaId, vendedorId, status: { notIn: ['RASCUNHO', 'CANCELADO'] }, ...filtroCliente },
        },
        select: { quantidade: true, pedidoVenda: { select: { id: true, numero: true, status: true, criadoEm: true } } },
        orderBy: { pedidoVenda: { criadoEm: 'desc' } },
        take: 50,
      }),
    ])

    const txt = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '')
    const medidasDe = (c?: unknown, l?: unknown, a?: unknown) =>
      [c, l, a].map((x) => (x == null ? 0 : Number(x))).filter((x) => x > 0).join(' x ')

    type Dados = {
      tipoEmbalagem: string; medidasTexto: string; cartao: string; gramatura: string
      camadas: Array<{ funcao: string; suporte: string; gramatura: string }>
      acabamentos: Array<{ acabamentoId: string | null; nome: string }>
      variacoesArte: string; situacaoFaca: string; numeroMatriz: string
      cartaoFsc: boolean; corteInternoVerso: boolean; passtime: boolean
      quantidadePorVolume: string; acondicionamento: string; tiragensTexto: string
    }
    const acabamentosDe = (sel: unknown, texto: unknown) => {
      if (Array.isArray(sel) && sel.length) {
        return (sel as Array<{ acabamentoId?: string | null; nome?: string; marcado?: boolean }>)
          .filter((a) => a?.nome && a.marcado !== false)
          .map((a) => ({ acabamentoId: a.acabamentoId ?? null, nome: String(a.nome) }))
      }
      return txt(texto).split(',').map((n) => n.trim()).filter(Boolean).map((nome) => ({ acabamentoId: null, nome }))
    }
    const camadasDe = (c: unknown) =>
      Array.isArray(c)
        ? (c as Array<{ funcao?: string; suporte?: string; gramatura?: string | null }>)
            .filter((x) => x?.suporte)
            .map((x) => ({ funcao: x.funcao ?? 'Cartão', suporte: String(x.suporte), gramatura: x.gramatura ?? '' }))
        : []

    const pedidos: Array<{
      chave: string; origem: 'PROPOSTA' | 'SOLICITACAO' | 'VENDA'; numero: number | null
      data: Date; quantidade: number | null; situacao: string; resumo: string; dados: Dados | null
    }> = []

    for (const p of propostas) {
      const camadas = camadasDe(p.materiaPrimaCamadas)
      pedidos.push({
        chave: `P-${p.id}`, origem: 'PROPOSTA', numero: p.numero, data: p.criadoEm,
        quantidade: p.quantidade ?? null, situacao: 'Aceito',
        resumo: [txt(p.tipoEmbalagem), txt(p.medidasTexto), txt(p.cartao)].filter(Boolean).join(' · '),
        dados: {
          tipoEmbalagem: txt(p.tipoEmbalagem), medidasTexto: txt(p.medidasTexto),
          cartao: txt(p.cartao), gramatura: txt(p.gramatura), camadas,
          acabamentos: acabamentosDe(p.acabamentosSelecionados, p.acabamentos),
          variacoesArte: txt(p.variacoesArte),
          situacaoFaca: txt(p.situacaoFaca) === 'EXISTENTE' || txt(p.matriz) ? 'EXISTENTE' : 'NOVA',
          numeroMatriz: txt(p.numeroMatriz) || txt(p.matriz),
          cartaoFsc: !!p.cartaoFsc, corteInternoVerso: !!p.corteInternoVerso, passtime: !!p.passtime,
          quantidadePorVolume: txt(p.quantidadePorVolume), acondicionamento: txt(p.acondicionamento),
          tiragensTexto: txt(p.tiragensTexto) || (p.quantidade ? String(p.quantidade) : ''),
        },
      })
    }
    for (const s of solicitacoes) {
      const camadas = camadasDe(s.materiaPrimaCamadas)
      const medidas = txt(s.medidasTexto) || medidasDe(s.medidaComprimento, s.medidaLargura, s.medidaAltura)
      pedidos.push({
        chave: `S-${s.id}`, origem: 'SOLICITACAO', numero: null, data: s.criadoEm,
        quantidade: s.quantidade ?? null, situacao: 'Convertido em pedido',
        resumo: [txt(s.tipoEmbalagem), medidas, txt(s.cartao)].filter(Boolean).join(' · '),
        dados: {
          tipoEmbalagem: txt(s.tipoEmbalagem), medidasTexto: medidas,
          cartao: txt(s.cartao), gramatura: txt(s.gramaturaTexto), camadas,
          acabamentos: acabamentosDe(null, s.acabamentos),
          variacoesArte: txt(s.variacoesArte),
          situacaoFaca: txt(s.matriz) ? 'EXISTENTE' : 'NOVA', numeroMatriz: txt(s.matriz),
          cartaoFsc: !!s.cartaoFsc, corteInternoVerso: !!s.corteInternoVerso, passtime: !!s.passtime,
          quantidadePorVolume: txt(s.quantidadePorVolume), acondicionamento: '',
          tiragensTexto: txt(s.tiragensTexto) || String(s.quantidade),
        },
      })
    }
    // Pedidos de venda não guardam a especificação: reaproveitam a do pedido mais recente que a tem.
    const base = pedidos.find((x) => x.dados)?.dados ?? null
    for (const i of itensVenda) {
      const pv = i.pedidoVenda
      pedidos.push({
        chave: `V-${pv.id}`, origem: 'VENDA', numero: pv.numero, data: pv.criadoEm,
        quantidade: Number(i.quantidade), situacao: 'Pedido de venda',
        resumo: base ? [base.tipoEmbalagem, base.medidasTexto, base.cartao].filter(Boolean).join(' · ') : '',
        dados: base ? { ...base, tiragensTexto: String(Math.round(Number(i.quantidade))) } : null,
      })
    }
    pedidos.sort((a, b) => b.data.getTime() - a.data.getTime())
    return reply.status(200).send({ produto, pedidos: pedidos.slice(0, 50) })
  })

  // GET /catalogo/acabamentos — acabamentos do produto (cadastro comercial).
  app.get('/acabamentos', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const { empresaId } = request.portalRepUser
    const { acabamentos } = await obterCatalogoComercial(empresaId)
    return reply.status(200).send(acabamentos.map((a) => ({ codigo: a.codigo, descricao: a.nome, id: a.id })))
  })}
