import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'

/**
 * ─────────────────────────────────────────────────────────────────────────
 * MÓDULO DE SEED PARA QA (habilitadores de teste)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Este módulo existe EXCLUSIVAMENTE para habilitar a suíte de QA E2E a
 * exercitar fluxos que, em produção, só são atingidos por efetivação fiscal
 * real (emissão de NF-e à SEFAZ) — inviável de disparar num teste automatizado.
 *
 * O caso concreto: uma Onda de Separação / Cross-dock exige um `PedidoVenda`
 * em status `EM_SEPARACAO`, estado que hoje só é atingido por `POST /vendas`
 * (que emite NF-e à SEFAZ, exigindo certificado A1, comunicação SEFAZ, etc.).
 * Esta rota cria um pedido já em `EM_SEPARACAO` diretamente, permitindo que o
 * QA valide de verdade a geração da onda, a separação, a conferência de saída
 * e a expedição — sem depender de infraestrutura fiscal.
 *
 * ── PROTEÇÃO ──
 * O módulo só é registrado (ver `server.ts`) quando a env `WMS_QA_SEED_KEY`
 * está definida. Além disso, cada requisição exige o header
 * `x-qa-seed-key` batendo com essa env. Em produção normal, a env não é
 * definida → o módulo nem sequer expõe rotas. É um caminho de teste
 * deliberadamente restrito, não uma funcionalidade de negócio.
 *
 * O isolamento multi-tenant é preservado: tudo é criado com o `empresaId` do
 * usuário autenticado (mesmo padrão do restante do backend).
 */

const seedPedidoSchema = z.object({
  itens: z
    .array(
      z.object({
        produtoId: z.string().uuid(),
        quantidade: z.number().positive(),
      }),
    )
    .min(1, 'Pelo menos um item é obrigatório'),
  docaId: z.string().uuid().optional(),
})

const seedNfeSchema = z.object({
  itens: z
    .array(
      z.object({
        produtoId: z.string().uuid(),
        quantidade: z.number().positive(),
      }),
    )
    .min(1, 'Pelo menos um item é obrigatório'),
  // Coordenadas opcionais do cliente da NFE (para exercitar geocodificação/
  // otimização de rota). Quando ausentes, o cliente fica sem geolocalização.
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  // Rota opcional (para agrupar as NFs por rota na montagem de carga).
  rotaId: z.string().uuid().optional(),
  // CPF/CNPJ do cliente da NFE — permite ter clientes distintos por NFE.
  clienteDoc: z.string().optional(),
})

/** Cliente mínimo reaproveitável para o seed de QA. */
async function garantirClienteQa(empresaId: string) {
  const cpfCnpj = '00000000000191' // CNPJ de teste (Banco do Brasil, público)
  const existente = await prisma.cliente.findFirst({
    where: { empresaId, cpfCnpj },
  })
  if (existente) return existente
  return prisma.cliente.create({
    data: {
      empresaId,
      razaoSocial: 'CLIENTE QA SEED (nao usar em producao)',
      nomeFantasia: 'QA SEED',
      cpfCnpj,
      status: true,
    },
  })
}

/** Tabela de preço mínima (com condição à vista) reaproveitável. */
async function garantirTabelaPrecoQa(empresaId: string) {
  const nome = 'TABELA QA SEED'
  const existente = await prisma.tabelaPreco.findFirst({
    where: { empresaId, nome },
    include: { condicoes: true },
  })
  if (existente) return existente
  return prisma.tabelaPreco.create({
    data: {
      empresaId,
      nome,
      status: true,
      condicoes: {
        create: [{ formaPagamento: 'A_VISTA', parcelas: 1, percentual: 100 }],
      },
    },
    include: { condicoes: true },
  })
}

/** Cliente de QA com doc/coordenadas/rota específicos (para montagem de carga). */
async function garantirClienteQaNfe(
  empresaId: string,
  opts: {
    cpfCnpj: string
    latitude?: number
    longitude?: number
    rotaId?: string
  },
) {
  const existente = await prisma.cliente.findFirst({
    where: { empresaId, cpfCnpj: opts.cpfCnpj },
  })
  const dados = {
    razaoSocial: `CLIENTE QA NFE ${opts.cpfCnpj} (nao usar em producao)`,
    nomeFantasia: 'QA NFE',
    latitude: opts.latitude ?? null,
    longitude: opts.longitude ?? null,
    rotaId: opts.rotaId ?? null,
    // Endereço genérico para geocodificação eventual.
    logradouro: 'Avenida Paulista',
    numero: '1000',
    cidade: 'Sao Paulo',
    uf: 'SP',
    cep: '01310-100',
  }
  if (existente) {
    return prisma.cliente.update({ where: { id: existente.id }, data: dados })
  }
  return prisma.cliente.create({
    data: { empresaId, cpfCnpj: opts.cpfCnpj, status: true, ...dados },
  })
}

export async function qaSeedRoutes(app: FastifyInstance) {
  const seedKey = process.env.WMS_QA_SEED_KEY

  app.addHook('onRequest', authenticate)

  // Guarda: exige perfil SUPER_ADMIN (proteção primária, mesmo padrão do
  // adminPcpRoutes). Se WMS_QA_SEED_KEY estiver definida, exige adicionalmente
  // o header x-qa-seed-key batendo com ela (camada extra opcional).
  app.addHook('preHandler', async (request, reply) => {
    const user = request.user as { perfil?: string } | undefined
    if (user?.perfil !== 'SUPER_ADMIN' && user?.perfil !== 'ADMIN') {
      return reply
        .status(403)
        .send({ message: 'Seed de QA requer perfil ADMIN/SUPER_ADMIN' })
    }
    if (seedKey) {
      const provided = request.headers['x-qa-seed-key']
      if (provided !== seedKey) {
        return reply
          .status(403)
          .send({ message: 'Seed de QA não autorizado (chave inválida)' })
      }
    }
  })

  /**
   * POST /pedido-em-separacao
   * Cria um PedidoVenda já em EM_SEPARACAO (habilitador de onda/cross-dock).
   * Reaproveita/cria cliente e tabela de preço mínimos de QA.
   */
  app.post('/pedido-em-separacao', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = seedPedidoSchema.parse(request.body)

    // Validar produtos pertencem à empresa
    const produtoIds = body.itens.map((i) => i.produtoId)
    const produtos = await prisma.produto.findMany({
      where: { id: { in: produtoIds }, empresaId: user.empresaId },
      select: { id: true, precoBase: true, unidade: true },
    })
    if (produtos.length !== new Set(produtoIds).size) {
      return reply
        .status(422)
        .send({ message: 'Um ou mais produtos não pertencem à empresa' })
    }
    const produtoMap = new Map(produtos.map((p) => [p.id, p]))

    const cliente = await garantirClienteQa(user.empresaId)
    const tabela = await garantirTabelaPrecoQa(user.empresaId)

    // Número sequencial do pedido
    const ultimo = await prisma.pedidoVenda.findFirst({
      where: { empresaId: user.empresaId },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    })

    const itensData = body.itens.map((item) => {
      const prod = produtoMap.get(item.produtoId)!
      const precoBase = Number(prod.precoBase) || 1
      const valorTotal = Number((precoBase * item.quantidade).toFixed(2))
      return {
        produtoId: item.produtoId,
        quantidade: item.quantidade,
        unidade: prod.unidade || 'UN',
        precoBase,
        desconto: 0,
        precoFinal: precoBase,
        valorTotal,
      }
    })

    const valorTotalPedido = itensData.reduce((s, i) => s + i.valorTotal, 0)

    const pedido = await prisma.pedidoVenda.create({
      data: {
        empresaId: user.empresaId,
        numero: (ultimo?.numero ?? 0) + 1,
        clienteId: cliente.id,
        tabelaPrecoId: tabela.id,
        condicaoPagId: tabela.condicoes[0]?.id ?? null,
        valorTotal: valorTotalPedido,
        status: 'EM_SEPARACAO',
        origemPedido: 'MANUAL',
        prioridade: 'NORMAL',
        observacao: 'Pedido criado via seed de QA (fluxo de onda/expedição).',
        itens: { create: itensData },
      },
      include: { itens: true },
    })

    return reply.status(201).send({
      id: pedido.id,
      numero: pedido.numero,
      status: pedido.status,
      clienteId: pedido.clienteId,
      itens: pedido.itens.map((i) => ({
        id: i.id,
        produtoId: i.produtoId,
        quantidade: Number(i.quantidade),
      })),
    })
  })

  /**
   * POST /rota
   * Cria (ou reaproveita) uma Rota de QA para agrupar NFs na montagem de carga.
   */
  app.post('/rota', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { codigo } = z
      .object({ codigo: z.string().min(1).max(20).optional() })
      .parse(request.body ?? {})
    const cod = codigo || 'QA-ROTA'

    const existente = await prisma.rota.findFirst({
      where: { empresaId: user.empresaId, codigo: cod },
    })
    if (existente) return reply.status(200).send(existente)

    const rota = await prisma.rota.create({
      data: {
        empresaId: user.empresaId,
        codigo: cod,
        descricao: 'Rota de QA (montagem de carga) — nao usar em producao',
      },
    })
    return reply.status(201).send(rota)
  })

  /**
   * POST /nfe-para-mapa
   * Cria a cadeia fiscal fake (sem SEFAZ) que torna uma NF disponível para a
   * montagem de carga: cliente (com coords/rota opcionais) → PedidoVenda →
   * VendaEfetivada → DocumentoFiscal tipo NFE (status AUTORIZADO) + itens.
   * Retorna { nfeId, clienteId, numero }.
   */
  app.post('/nfe-para-mapa', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = seedNfeSchema.parse(request.body)

    const produtoIds = body.itens.map((i) => i.produtoId)
    const produtos = await prisma.produto.findMany({
      where: { id: { in: produtoIds }, empresaId: user.empresaId },
      select: { id: true, precoBase: true, unidade: true, codigo: true, nome: true },
    })
    if (produtos.length !== new Set(produtoIds).size) {
      return reply
        .status(422)
        .send({ message: 'Um ou mais produtos não pertencem à empresa' })
    }
    const produtoMap = new Map(produtos.map((p) => [p.id, p]))

    // Validar rota (se informada)
    if (body.rotaId) {
      const rota = await prisma.rota.findFirst({
        where: { id: body.rotaId, empresaId: user.empresaId },
      })
      if (!rota) return reply.status(422).send({ message: 'Rota não pertence à empresa' })
    }

    const cpfCnpj = body.clienteDoc || `QANFE${Math.floor(Math.random() * 1e8)}`
    const cliente = await garantirClienteQaNfe(user.empresaId, {
      cpfCnpj,
      latitude: body.latitude,
      longitude: body.longitude,
      rotaId: body.rotaId,
    })
    const tabela = await garantirTabelaPrecoQa(user.empresaId)

    // Itens (pedido + NFE compartilham valores)
    const itensCalc = body.itens.map((item) => {
      const prod = produtoMap.get(item.produtoId)!
      const precoBase = Number(prod.precoBase) || 1
      const valorTotal = Number((precoBase * item.quantidade).toFixed(2))
      return { prod, item, precoBase, valorTotal }
    })
    const valorTotalDoc = itensCalc.reduce((s, i) => s + i.valorTotal, 0)

    const resultado = await prisma.$transaction(async (tx) => {
      const ultimoPedido = await tx.pedidoVenda.findFirst({
        where: { empresaId: user.empresaId },
        orderBy: { numero: 'desc' },
        select: { numero: true },
      })
      const pedido = await tx.pedidoVenda.create({
        data: {
          empresaId: user.empresaId,
          numero: (ultimoPedido?.numero ?? 0) + 1,
          clienteId: cliente.id,
          tabelaPrecoId: tabela.id,
          condicaoPagId: tabela.condicoes[0]?.id ?? null,
          rotaId: body.rotaId ?? null,
          valorTotal: valorTotalDoc,
          status: 'FATURADO',
          origemPedido: 'MANUAL',
          prioridade: 'NORMAL',
          observacao: 'Pedido criado via seed de QA (montagem de carga).',
          itens: {
            create: itensCalc.map((c) => ({
              produtoId: c.item.produtoId,
              quantidade: c.item.quantidade,
              unidade: c.prod.unidade || 'UN',
              precoBase: c.precoBase,
              desconto: 0,
              precoFinal: c.precoBase,
              valorTotal: c.valorTotal,
            })),
          },
        },
      })

      const venda = await tx.vendaEfetivada.create({
        data: {
          empresaId: user.empresaId,
          pedidoVendaId: pedido.id,
          valorTotal: valorTotalDoc,
          statusEntrega: 'PENDENTE',
        },
      })

      // Próximo número de NFE (série 1, ambiente 2/homologação para o QA)
      const ultimoDoc = await tx.documentoFiscal.findFirst({
        where: { empresaId: user.empresaId, tipo: 'NFE', serie: 1, ambiente: 2 },
        orderBy: { numero: 'desc' },
        select: { numero: true },
      })
      const doc = await tx.documentoFiscal.create({
        data: {
          empresaId: user.empresaId,
          tipo: 'NFE',
          modelo: 55,
          serie: 1,
          numero: (ultimoDoc?.numero ?? 0) + 1,
          status: 'AUTORIZADO',
          dataEmissao: new Date(),
          tipoOperacao: 1,
          emitenteCnpj: '00000000000000',
          emitenteRazao: 'EMITENTE QA',
          emitenteUf: 'SP',
          destRazao: cliente.razaoSocial,
          destUf: 'SP',
          valorProdutos: valorTotalDoc,
          valorTotal: valorTotalDoc,
          ambiente: 2,
          vendaEfetivadaId: venda.id,
          itens: {
            create: itensCalc.map((c, idx) => ({
              nItem: idx + 1,
              produtoId: c.item.produtoId,
              codigoProd: c.prod.codigo,
              descricao: (c.prod.nome || c.prod.codigo).substring(0, 120),
              ncm: '00000000',
              cfop: '5102',
              unidade: c.prod.unidade || 'UN',
              quantidade: c.item.quantidade,
              valorUnitario: c.precoBase,
              valorTotal: c.valorTotal,
            })),
          },
        },
      })

      return { pedido, venda, doc }
    })

    return reply.status(201).send({
      nfeId: resultado.doc.id,
      numero: resultado.doc.numero,
      clienteId: cliente.id,
      pedidoId: resultado.pedido.id,
    })
  })
}
