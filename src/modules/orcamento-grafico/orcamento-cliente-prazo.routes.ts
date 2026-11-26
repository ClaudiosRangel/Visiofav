import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { FluxoOperacaoError } from './fluxo-operacao/fluxo-operacao.motor'
import { exigirSetorPodeAgirNoOrcamento } from './fluxo-operacao/fluxo-pedido.service'
import {
  historicoPrazosCliente,
  PrazoOrcamentoError,
  situacaoPrazoDoPedido,
  trocarPrazoDoOrcamento,
} from './prazo-orcamento.service'

/**
 * Rotas da spec orcamento-prazos-cliente-margem (prefixo /api/orcamento-grafico):
 *  - PUT  /:id/prazo                         troca o prazo do orçamento (R1)
 *  - GET  /pedidos-proposta/:id/situacao-prazo  prazo travado no Pedido/Proposta? (R1)
 *  - GET  /clientes/:clienteId/prazos        histórico de prazos + padrão (R4)
 *  - GET  /clientes/:clienteId/ultimo-calculo   último cálculo do cliente (R2)
 *  - POST /clientes/rapido                   cadastro rápido de cliente (R3)
 *  - GET  /:id/log-valores                   log de alteração manual de valor (R5)
 * empresaId EXPLÍCITO (da sessão) em toda query.
 */

export const soDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

/** CPF (11) ou CNPJ (14) só com dígitos e sem sequência repetida. */
export function documentoValido(doc: string): boolean {
  return (doc.length === 11 || doc.length === 14) && !/^(\d)\1+$/.test(doc)
}

const clienteRapidoSchema = z.object({
  cpfCnpj: z.string().trim().min(1, 'CNPJ/CPF é obrigatório').max(20),
  razaoSocial: z.string().trim().min(1, 'Razão Social é obrigatória').max(200),
  nomeFantasia: z.string().trim().max(200).optional().nullable(),
  telefone: z.string().trim().max(20).optional().nullable(),
  email: z.string().trim().max(200).email('E-mail inválido').optional().nullable().or(z.literal('')),
  uf: z.string().trim().max(2).optional().nullable(),
  cidade: z.string().trim().max(100).optional().nullable(),
  cep: z.string().trim().max(10).optional().nullable(),
  logradouro: z.string().trim().max(200).optional().nullable(),
  numero: z.string().trim().max(20).optional().nullable(),
  bairro: z.string().trim().max(100).optional().nullable(),
})

export async function orcamentoClientePrazoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  const erro = (reply: any, e: unknown) => {
    if (e instanceof PrazoOrcamentoError) return reply.status(e.statusCode).send({ message: e.message, code: e.code })
    throw e
  }

  // R1 — troca o prazo do orçamento.
  app.put('/:id/prazo', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({ prazoPagamentoId: z.string().uuid().nullable() }).parse(request.body)
    try {
      // Mesma trava de setor das demais escritas do orçamento (etapa do pedido em andamento).
      await exigirSetorPodeAgirNoOrcamento(user.empresaId, id, 'ORCAMENTO')
      return await trocarPrazoDoOrcamento(user.empresaId, id, body.prazoPagamentoId)
    } catch (e) {
      if (e instanceof FluxoOperacaoError) return reply.status(e.statusCode).send({ message: e.message, code: e.code })
      return erro(reply, e)
    }
  })

  // R1 — situação do prazo no Pedido/Proposta (para a tela bloquear o campo).
  app.get('/pedidos-proposta/:id/situacao-prazo', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    return situacaoPrazoDoPedido(user.empresaId, id)
  })

  // R4 — histórico de prazos do cliente e o padrão (mais usado).
  app.get('/clientes/:clienteId/prazos', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { clienteId } = z.object({ clienteId: z.string().uuid() }).parse(request.params)
    const cliente = await prisma.cliente.findFirst({ where: { id: clienteId, empresaId: user.empresaId }, select: { id: true } })
    if (!cliente) return reply.status(404).send({ message: 'Cliente não encontrado' })
    return historicoPrazosCliente(user.empresaId, clienteId)
  })

  // R2 — último cálculo do cliente (biblioteca por cliente/CNPJ/código legado e itens de orçamentos).
  app.get('/clientes/:clienteId/ultimo-calculo', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { clienteId } = z.object({ clienteId: z.string().uuid() }).parse(request.params)
    const cliente = await prisma.cliente.findFirst({
      where: { id: clienteId, empresaId: user.empresaId },
      select: { id: true, cpfCnpj: true, codigoCalcgraf: true },
    })
    if (!cliente) return reply.status(404).send({ message: 'Cliente não encontrado' })

    const doc = soDigitos(cliente.cpfCnpj)
    const ou: Record<string, unknown>[] = [{ clienteId: cliente.id }]
    if (doc.length >= 11) ou.push({ clienteDoc: doc })
    if (cliente.codigoCalcgraf != null) ou.push({ clienteCodigo: cliente.codigoCalcgraf })
    const selectCalculo = {
      id: true, numero: true, numeroCalcgraf: true, dataCalculo: true, descricao: true, produto: true,
      linhaProduto: true, quantidade: true, valorTotal: true,
    } as const

    const [daBiblioteca, itemDeOrcamento] = await Promise.all([
      prisma.calculoGrafico.findFirst({
        where: { empresaId: user.empresaId, status: { notIn: ['ARQUIVADO', 'CANCELADO'] }, OR: ou },
        orderBy: [{ dataCalculo: 'desc' }, { numero: 'desc' }],
        select: selectCalculo,
      }),
      prisma.itemOrcamentoGrafico.findFirst({
        where: { empresaId: user.empresaId, calculoGraficoOrigemId: { not: null }, orcamento: { clienteId: cliente.id } },
        orderBy: { criadoEm: 'desc' },
        select: { calculoGraficoOrigemId: true, criadoEm: true },
      }),
    ])
    let escolhido = daBiblioteca
    let usadoEm: Date | null = null
    if (itemDeOrcamento?.calculoGraficoOrigemId) {
      const doItem = await prisma.calculoGrafico.findFirst({
        where: { id: itemDeOrcamento.calculoGraficoOrigemId, empresaId: user.empresaId },
        select: selectCalculo,
      })
      if (doItem && (!escolhido || itemDeOrcamento.criadoEm > escolhido.dataCalculo)) {
        escolhido = doItem
        usadoEm = itemDeOrcamento.criadoEm
      }
    }
    if (!escolhido) return { calculo: null }
    return {
      calculo: {
        id: escolhido.id,
        numero: escolhido.numeroCalcgraf ?? escolhido.numero,
        data: (usadoEm ?? escolhido.dataCalculo).toISOString(),
        descricao: escolhido.descricao ?? escolhido.produto ?? escolhido.linhaProduto ?? null,
        tiragem: escolhido.quantidade,
        valorTotal: escolhido.valorTotal != null ? Number(escolhido.valorTotal) : null,
        usadoEmOrcamento: usadoEm != null,
      },
    }
  })

  // R3 — cadastro rápido de cliente (orçamento em rascunho). Não duplica CNPJ/CPF.
  app.post('/clientes/rapido', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const parsed = clienteRapidoSchema.safeParse(request.body)
    if (!parsed.success) {
      const i = parsed.error.issues[0]
      return reply.status(400).send({ message: `${i?.path.join('.') || 'dados'}: ${i?.message ?? 'inválido'}` })
    }
    const d = parsed.data
    const doc = soDigitos(d.cpfCnpj)
    if (!documentoValido(doc)) return reply.status(400).send({ message: 'cpfCnpj: informe um CPF (11) ou CNPJ (14 dígitos) válido' })

    const candidatos = await prisma.cliente.findMany({
      where: { empresaId: user.empresaId, cpfCnpj: { contains: doc.slice(-6) } },
      select: { id: true, razaoSocial: true, nomeFantasia: true, cpfCnpj: true, codigoCalcgraf: true },
    })
    const existente = candidatos.find((c) => soDigitos(c.cpfCnpj) === doc)
    if (existente) {
      return reply.status(409).send({ message: 'Já existe um cliente com este CNPJ/CPF.', code: 'CLIENTE_EXISTENTE', cliente: existente })
    }

    const criado = await prisma.cliente.create({
      data: {
        empresaId: user.empresaId,
        cpfCnpj: doc,
        razaoSocial: d.razaoSocial,
        nomeFantasia: d.nomeFantasia || null,
        telefone: d.telefone || null,
        email: d.email || null,
        uf: d.uf ? d.uf.toUpperCase() : null,
        cidade: d.cidade || null,
        cep: d.cep ? soDigitos(d.cep) : null,
        logradouro: d.logradouro || null,
        numero: d.numero || null,
        bairro: d.bairro || null,
      } as never,
      select: { id: true, razaoSocial: true, nomeFantasia: true, cpfCnpj: true, codigoCalcgraf: true },
    })
    return reply.status(201).send(criado)
  })

  // R5 — log de alterações manuais de valor das tiragens.
  app.get('/:id/log-valores', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const orc = await prisma.orcamentoGrafico.findFirst({ where: { id, empresaId: user.empresaId }, select: { id: true } })
    if (!orc) return reply.status(404).send({ message: 'Orçamento não encontrado' })
    const linhas = await prisma.logValorOrcamentoGrafico.findMany({
      where: { empresaId: user.empresaId, orcamentoId: id },
      orderBy: { criadoEm: 'desc' },
      take: 500,
    })
    return linhas.map((l) => ({
      ...l,
      valorAnterior: l.valorAnterior != null ? Number(l.valorAnterior) : null,
      valorNovo: l.valorNovo != null ? Number(l.valorNovo) : null,
      margemAnterior: l.margemAnterior != null ? Number(l.margemAnterior) : null,
      margemNova: l.margemNova != null ? Number(l.margemNova) : null,
      margemMinima: l.margemMinima != null ? Number(l.margemMinima) : null,
    }))
  })
}
