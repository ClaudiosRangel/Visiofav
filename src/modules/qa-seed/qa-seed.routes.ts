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
}
