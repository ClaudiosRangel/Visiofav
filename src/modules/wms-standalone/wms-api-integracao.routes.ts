/**
 * API de Integração WMS para ERPs externos.
 * Prefixo: /api/v1/wms
 * 
 * Protegida por API Key (apiKeyGuard) + verificação de integração ativa.
 * Só funciona para empresas com modoOperacao = 'WMS_STANDALONE' + integracaoAtiva = true.
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { apiKeyGuard } from '../integracao/api-key-guard'
import { isIntegracaoAtiva } from './config-standalone.service'
import { dispararWebhook } from '../integracao/webhook-dispatcher'

// ── Middleware: verificar integração ativa ──────────────────────────────

async function verificarIntegracaoAtiva(request: any, reply: any) {
  const empresaId = request.empresaId as string
  if (!empresaId) return reply.status(401).send({ success: false, error: { code: 'NO_EMPRESA', message: 'Empresa não identificada' } })

  const ativa = await isIntegracaoAtiva(empresaId)
  if (!ativa) {
    return reply.status(403).send({
      success: false,
      error: { code: 'INTEGRACAO_DESATIVADA', message: 'Integração WMS está desativada para esta empresa. Contate o administrador.' },
    })
  }
}

// ── Schemas ────────────────────────────────────────────────────────────

const syncProdutoSchema = z.object({
  produtos: z.array(z.object({
    codigo: z.string().min(1),
    nome: z.string().min(1),
    unidade: z.string().default('UN'),
    ean: z.string().max(14).nullable().optional(),
    familia: z.string().max(60).nullable().optional(),
    subFamilia: z.string().max(60).nullable().optional(),
    exigeLote: z.boolean().optional(),
    shelfLifeMinimo: z.number().int().nullable().optional(),
    peso: z.number().nullable().optional(),
    largura: z.number().nullable().optional(),
    altura: z.number().nullable().optional(),
    comprimento: z.number().nullable().optional(),
  })).min(1).max(500),
})

const asnSchema = z.object({
  numeroDocumento: z.string().min(1),
  fornecedorCnpj: z.string().optional(),
  fornecedorNome: z.string().optional(),
  previsaoChegada: z.string().datetime({ offset: true }).optional(),
  itens: z.array(z.object({
    produtoCodigo: z.string().min(1),
    quantidade: z.number().positive(),
    lote: z.string().optional(),
    validade: z.string().optional(),
  })).min(1),
})

const pedidoExpedicaoSchema = z.object({
  referencia: z.string().min(1),
  clienteNome: z.string().optional(),
  clienteDoc: z.string().optional(),
  prioridade: z.enum(['BAIXA', 'NORMAL', 'ALTA', 'URGENTE']).default('NORMAL'),
  itens: z.array(z.object({
    produtoCodigo: z.string().min(1),
    quantidade: z.number().positive(),
  })).min(1),
})

// ── Rotas ──────────────────────────────────────────────────────────────

export async function wmsApiIntegracaoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', apiKeyGuard)
  app.addHook('preHandler', verificarIntegracaoAtiva)

  // ═══════════════════════════════════════════════════════════════════════
  // SINCRONIZAÇÃO DE PRODUTOS
  // ═══════════════════════════════════════════════════════════════════════

  // POST /produtos/sync — ERP envia catálogo (delta ou completo)
  app.post('/produtos/sync', async (request) => {
    const empresaId = (request as any).empresaId as string
    const body = syncProdutoSchema.parse(request.body)

    const resultados: Array<{ codigo: string; status: 'CRIADO' | 'ATUALIZADO' | 'ERRO'; erro?: string }> = []

    for (const item of body.produtos) {
      try {
        const existente = await prisma.produto.findFirst({
          where: { empresaId, codigo: item.codigo },
        })

        if (existente) {
          await prisma.produto.update({
            where: { id: existente.id },
            data: {
              nome: item.nome,
              unidade: item.unidade,
              cEAN: item.ean ?? existente.cEAN,
              familia: item.familia ?? existente.familia,
              subFamilia: item.subFamilia ?? existente.subFamilia,
              exigeLote: item.exigeLote ?? existente.exigeLote,
              shelfLifeMinimo: item.shelfLifeMinimo ?? existente.shelfLifeMinimo,
            },
          })

          // Atualizar SKU se dados físicos informados
          if (item.peso || item.largura || item.altura || item.comprimento) {
            const sku = await prisma.sku.findFirst({ where: { produtoId: existente.id }, orderBy: { sequencia: 'asc' } })
            if (sku) {
              await prisma.sku.update({
                where: { id: sku.id },
                data: {
                  ...(item.peso !== undefined && { pesoBruto: item.peso }),
                  ...(item.largura !== undefined && { largura: item.largura }),
                  ...(item.altura !== undefined && { altura: item.altura }),
                  ...(item.comprimento !== undefined && { comprimento: item.comprimento }),
                  ...(item.ean && { codigoBarra: item.ean }),
                },
              })
            }
          }

          resultados.push({ codigo: item.codigo, status: 'ATUALIZADO' })
        } else {
          const produto = await prisma.produto.create({
            data: {
              empresaId,
              codigo: item.codigo,
              nome: item.nome,
              unidade: item.unidade,
              cEAN: item.ean ?? null,
              familia: item.familia ?? null,
              subFamilia: item.subFamilia ?? null,
              exigeLote: item.exigeLote ?? false,
              shelfLifeMinimo: item.shelfLifeMinimo ?? null,
            },
          })

          // Criar SKU padrão
          await prisma.sku.create({
            data: {
              produtoId: produto.id,
              empresaId,
              sequencia: 1,
              unidade: item.unidade,
              codigoBarra: item.ean ?? null,
              pesoBruto: item.peso ?? null,
              largura: item.largura ?? null,
              altura: item.altura ?? null,
              comprimento: item.comprimento ?? null,
            },
          })

          resultados.push({ codigo: item.codigo, status: 'CRIADO' })
        }
      } catch (err: any) {
        resultados.push({ codigo: item.codigo, status: 'ERRO', erro: err.message?.substring(0, 100) })
      }
    }

    const criados = resultados.filter(r => r.status === 'CRIADO').length
    const atualizados = resultados.filter(r => r.status === 'ATUALIZADO').length
    const erros = resultados.filter(r => r.status === 'ERRO').length

    return { success: true, resumo: { total: body.produtos.length, criados, atualizados, erros }, resultados }
  })

  // ═══════════════════════════════════════════════════════════════════════
  // RECEBIMENTO (ASN — Advanced Shipment Notice)
  // ═══════════════════════════════════════════════════════════════════════

  // POST /recebimento/asn — ERP notifica mercadoria a caminho
  app.post('/recebimento/asn', async (request, reply) => {
    const empresaId = (request as any).empresaId as string
    const body = asnSchema.parse(request.body)

    // Resolver ou auto-criar fornecedor
    let fornecedorNome = body.fornecedorNome || 'Fornecedor via Integração'

    // Resolver produtos
    const itensNota = []
    for (let i = 0; i < body.itens.length; i++) {
      const item = body.itens[i]
      const produto = await prisma.produto.findFirst({ where: { empresaId, codigo: item.produtoCodigo } })

      itensNota.push({
        item: i + 1,
        descricao: produto?.nome || item.produtoCodigo,
        codigoProduto: item.produtoCodigo,
        unidade: produto?.unidade || 'UN',
        quantidade: item.quantidade,
        lote: item.lote,
        validade: item.validade ? new Date(item.validade) : undefined,
      })
    }

    // Gerar próximo número de nota
    const ultimaNota = await prisma.notaEntrada.findFirst({
      where: { empresaId },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    })

    const nota = await prisma.notaEntrada.create({
      data: {
        numero: (ultimaNota?.numero ?? 0) + 1,
        serie: 'INT',
        fornecedor: fornecedorNome,
        fornecedorDoc: body.fornecedorCnpj || null,
        tipo: 'INTEGRACAO',
        status: 'PENDENTE',
        empresaId,
        dataEntrada: new Date(),
        itens: { create: itensNota },
      },
      include: { itens: true },
    })

    return reply.status(201).send({
      success: true,
      data: {
        notaEntradaId: nota.id,
        numero: nota.numero,
        totalItens: nota.itens.length,
        status: nota.status,
      },
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // EXPEDIÇÃO (Pedido de Saída)
  // ═══════════════════════════════════════════════════════════════════════

  // POST /expedicao/pedido — ERP solicita expedição
  app.post('/expedicao/pedido', async (request, reply) => {
    const empresaId = (request as any).empresaId as string
    const body = pedidoExpedicaoSchema.parse(request.body)

    // Resolver cliente se informado
    let clienteId: string | null = null
    if (body.clienteDoc) {
      const cliente = await prisma.cliente.findFirst({
        where: { empresaId, cpfCnpj: body.clienteDoc.replace(/\D/g, '') },
      })
      clienteId = cliente?.id ?? null
    }

    // Resolver produtos e verificar estoque
    const itens = []
    for (const item of body.itens) {
      const produto = await prisma.produto.findFirst({ where: { empresaId, codigo: item.produtoCodigo } })
      if (!produto) {
        return reply.status(404).send({
          success: false,
          error: { code: 'PRODUTO_NOT_FOUND', message: `Produto ${item.produtoCodigo} não encontrado` },
        })
      }
      itens.push({ produtoId: produto.id, quantidade: item.quantidade, precoBase: 0, precoFinal: 0, valorTotal: 0 })
    }

    // Usar PedidoExpedicaoWms (modelo independente do ERP, sem depender de tabela de preço)
    const ultimo = await prisma.pedidoExpedicaoWms.findFirst({
      where: { empresaId },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    })

    const pedido = await prisma.pedidoExpedicaoWms.create({
      data: {
        empresaId,
        numero: (ultimo?.numero ?? 0) + 1,
        referencia: body.referencia,
        clienteNome: body.clienteNome || null,
        clienteDoc: body.clienteDoc || null,
        prioridade: body.prioridade,
        status: 'PENDENTE',
        observacao: `Integração WMS — Ref: ${body.referencia}`,
        itens: {
          create: itens.map(i => ({
            produtoId: i.produtoId,
            quantidade: i.quantidade,
          })),
        },
      },
    })

    return reply.status(201).send({
      success: true,
      data: { pedidoId: pedido.id, numero: pedido.numero, referencia: body.referencia },
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // ESTOQUE (Consulta Expandida)
  // ═══════════════════════════════════════════════════════════════════════

  // GET /estoque — consulta expandida com filtros
  app.get('/estoque', async (request) => {
    const empresaId = (request as any).empresaId as string
    const query = z.object({
      produtoCodigo: z.string().optional(),
      lote: z.string().optional(),
      zona: z.string().optional(),
      enderecoId: z.string().uuid().optional(),
      tipo: z.enum(['consolidado', 'posicional']).default('consolidado'),
    }).parse(request.query)

    if (query.tipo === 'posicional') {
      // Retornar saldo por endereço
      const where: any = { empresaId, quantidade: { gt: 0 } }
      if (query.lote) where.lote = query.lote
      if (query.enderecoId) where.enderecoId = query.enderecoId

      const saldos = await prisma.saldoEndereco.findMany({
        where,
        include: {
          produto: { select: { codigo: true, nome: true } },
          endereco: { select: { enderecoCompleto: true, codigoRua: true, codigoPredio: true, codigoNivel: true } },
        },
        take: 500,
      })

      // Filtrar por código de produto se informado
      const filtrado = query.produtoCodigo
        ? saldos.filter(s => s.produto.codigo === query.produtoCodigo)
        : saldos

      return {
        success: true,
        tipo: 'posicional',
        data: filtrado.map(s => ({
          produtoCodigo: s.produto.codigo,
          produtoNome: s.produto.nome,
          endereco: s.endereco.enderecoCompleto,
          quantidade: Number(s.quantidade),
          lote: s.lote,
          validade: s.validade?.toISOString() ?? null,
        })),
      }
    }

    // Consolidado (como já existe)
    const estoques = await prisma.estoque.findMany({
      where: { empresaId },
      include: { produto: { select: { codigo: true, nome: true, unidade: true } } },
    })

    const filtrado = query.produtoCodigo
      ? estoques.filter(e => e.produto.codigo === query.produtoCodigo)
      : estoques

    return {
      success: true,
      tipo: 'consolidado',
      data: filtrado.map(e => ({
        produtoCodigo: e.produto.codigo,
        produtoNome: e.produto.nome,
        unidade: e.produto.unidade,
        quantidade: Number(e.quantidade),
        reservado: Number(e.reservado),
        disponivel: Number(e.quantidade) - Number(e.reservado),
      })),
    }
  })

  // ═══════════════════════════════════════════════════════════════════════
  // MOVIMENTAÇÕES (Log para reconciliação)
  // ═══════════════════════════════════════════════════════════════════════

  // GET /movimentacoes — ERP consulta movimentações para reconciliar
  app.get('/movimentacoes', async (request) => {
    const empresaId = (request as any).empresaId as string
    const query = z.object({
      desde: z.string().datetime({ offset: true }).optional(),
      limite: z.coerce.number().max(500).default(100),
    }).parse(request.query)

    const where: any = { empresaId }
    if (query.desde) where.criadoEm = { gte: new Date(query.desde) }

    const movimentacoes = await prisma.logMovimentacao.findMany({
      where,
      orderBy: { criadoEm: 'desc' },
      take: query.limite,
    })

    // Enriquecer com código do produto
    const produtoIds = [...new Set(movimentacoes.map(m => m.produtoId))]
    const produtos = await prisma.produto.findMany({
      where: { id: { in: produtoIds } },
      select: { id: true, codigo: true, nome: true },
    })
    const produtoMap = new Map(produtos.map(p => [p.id, p]))

    return {
      success: true,
      data: movimentacoes.map(m => ({
        id: m.id,
        produtoCodigo: produtoMap.get(m.produtoId)?.codigo ?? m.produtoId,
        produtoNome: produtoMap.get(m.produtoId)?.nome ?? '',
        tipo: m.tipo,
        quantidade: Number(m.quantidade),
        saldoAnterior: Number(m.saldoAnterior),
        saldoNovo: Number(m.saldoNovo),
        motivo: m.motivo,
        data: m.criadoEm.toISOString(),
      })),
    }
  })

  // ═══════════════════════════════════════════════════════════════════════
  // STATUS / HEALTH
  // ═══════════════════════════════════════════════════════════════════════

  app.get('/status', async (request) => {
    const empresaId = (request as any).empresaId as string
    return { success: true, status: 'online', empresaId, timestamp: new Date().toISOString() }
  })
}
