/**
 * Rotas do Editor Visual de Templates (spec comercial-editor-visual-templates).
 * Prefixo /api/orcamento-grafico/templates-visuais. authenticate + isolamento
 * por empresaId EXPLÍCITO. Aditivo — NÃO altera as rotas legadas proposta-pdf /
 * enviar-email.
 */
import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../../middleware/authenticate'
import { prisma } from '../../../lib/prisma'
import {
  listarTemplatesVisuais,
  obterTemplateVisual,
  criarTemplateVisual,
  atualizarTemplateVisual,
  duplicarTemplateVisual,
  definirDefault,
  excluirTemplateVisual,
  resolverTemplateVisual,
  TemplateVisualError,
} from './template-visual.service'
import type { TipoTemplate } from './layout-json.types'
import { LayoutJsonError } from './layout-json.service'
import { renderizarLayout, type ContextoRender } from './renderizador-pdf.service'
import { resolverLogoBuffer } from './logo-buffer'
import { seedTemplatesVisuaisWega } from './seed-default-wega.service'

function tratarErro(err: unknown, reply: any) {
  if (err instanceof TemplateVisualError) {
    return reply.status(err.statusCode).send({ message: err.message, code: err.code })
  }
  if (err instanceof LayoutJsonError) {
    return reply.status(400).send({ message: err.message, code: err.code })
  }
  throw err
}

const tipoSchema = z.enum(['ORCAMENTO', 'PROPOSTA'])

/** Monta o Contexto_de_Geracao real a partir de um orçamento gráfico da empresa. */
async function montarContexto(empresaId: string, orcamentoId: string): Promise<ContextoRender | null> {
  const orc = await prisma.orcamentoGrafico.findFirst({
    where: { id: orcamentoId, empresaId },
    select: {
      numero: true, versao: true, quantidade: true, precoVenda: true, precoUnitario: true,
      validadeAte: true, criadoEm: true, observacoes: true, papelDescricao: true,
      gramatura: true, numCores: true, variacoes: true, clienteId: true, clienteNome: true,
      vendedorId: true,
      tipoEmbalagem: { select: { descricao: true } },
    } as never,
  })
  if (!orc) return null
  const o = orc as Record<string, any>

  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: { razaoSocial: true, cnpj: true, telefone: true, email: true, logo: true },
  })

  let clienteNome = o.clienteNome || 'Cliente não informado'
  let clienteCnpj: string | null = null
  if (o.clienteId) {
    const cli = await prisma.cliente.findFirst({
      where: { id: o.clienteId, empresaId },
      select: { razaoSocial: true, cpfCnpj: true },
    })
    if (cli) { clienteNome = cli.razaoSocial; clienteCnpj = cli.cpfCnpj }
  }

  let vendedorNome: string | null = null
  if (o.vendedorId) {
    const v = await prisma.vendedor.findFirst({ where: { id: o.vendedorId, empresaId }, select: { nome: true } })
    vendedorNome = v?.nome ?? null
  }

  const variacoes = Array.isArray(o.variacoes)
    ? (o.variacoes as Array<{ quantidade: number; precoUnitario: number; precoTotal: number }>)
    : []
  // Sem itens multi-item explícitos aqui; a tabela "itens" espelha as variações
  // com descrição do produto (base editável no template).
  const itens = variacoes.map((v) => ({
    descricao: o.tipoEmbalagem?.descricao || o.papelDescricao || 'Item',
    quantidade: v.quantidade,
    precoUnitario: v.precoUnitario,
    precoTotal: v.precoTotal,
  }))

  const logoBuffer = await resolverLogoBuffer(empresa?.logo ?? null)

  return {
    cliente: { nome: clienteNome, cnpj: clienteCnpj },
    empresa: {
      razaoSocial: empresa?.razaoSocial ?? 'Empresa',
      cnpj: empresa?.cnpj, telefone: empresa?.telefone, email: empresa?.email,
    },
    orcamento: {
      numero: o.numero, versao: o.versao, quantidade: o.quantidade,
      precoVenda: o.precoVenda != null ? Number(o.precoVenda) : null,
      precoUnitario: o.precoUnitario != null ? Number(o.precoUnitario) : null,
      validadeAte: o.validadeAte, criadoEm: o.criadoEm,
      descricao: o.tipoEmbalagem?.descricao || o.papelDescricao || null,
      vendedorNome,
    },
    itens,
    variacoes,
    logoBuffer,
  }
}

export async function templateVisualRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // ── Semear modelos default da Carton Wega (idempotente) ──
  app.post('/seed-wega', async (request, reply) => {
    const user = request.user as { empresaId: string }
    try {
      const r = await seedTemplatesVisuaisWega(user.empresaId)
      return reply.send(r)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // ── Listar por tipo ──
  app.get('/', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const { tipo } = z.object({ tipo: tipoSchema }).parse(request.query)
    try {
      return await listarTemplatesVisuais(user.empresaId, tipo as TipoTemplate)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // ── Detalhe ──
  app.get('/:id', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    try {
      return await obterTemplateVisual(user.empresaId, id)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // ── Criar ──
  app.post('/', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const body = z.object({
      nome: z.string().min(1).max(120),
      tipo: tipoSchema,
      layoutJson: z.unknown(),
    }).parse(request.body)
    try {
      const r = await criarTemplateVisual(user.empresaId, body)
      return reply.status(201).send(r)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // ── Atualizar ──
  app.put('/:id', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      nome: z.string().min(1).max(120).optional(),
      layoutJson: z.unknown().optional(),
    }).parse(request.body)
    try {
      return await atualizarTemplateVisual(user.empresaId, id, body)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // ── Duplicar ──
  app.post('/:id/duplicar', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    try {
      const r = await duplicarTemplateVisual(user.empresaId, id)
      return reply.status(201).send(r)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // ── Definir default ──
  app.patch('/:id/default', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    try {
      await definirDefault(user.empresaId, id)
      return { ok: true }
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // ── Excluir ──
  app.delete('/:id', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    try {
      await excluirTemplateVisual(user.empresaId, id)
      return reply.status(204).send()
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // ── Preview PDF (dados de exemplo — não exige orçamento) ──
  app.post('/:id/preview-pdf', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    try {
      const tpl = await obterTemplateVisual(user.empresaId, id)
      const empresa = await prisma.empresa.findUnique({
        where: { id: user.empresaId },
        select: { razaoSocial: true, cnpj: true, telefone: true, email: true, logo: true },
      })
      const ctx: ContextoRender = {
        cliente: { nome: 'CLIENTE EXEMPLO LTDA', cnpj: '00.000.000/0001-00' },
        empresa: {
          razaoSocial: empresa?.razaoSocial ?? 'Empresa', cnpj: empresa?.cnpj,
          telefone: empresa?.telefone, email: empresa?.email,
        },
        orcamento: {
          numero: 1234, versao: 1, quantidade: 5000, precoVenda: 12500, precoUnitario: 2.5,
          validadeAte: new Date(Date.now() + 10 * 864e5), criadoEm: new Date(),
          descricao: 'Produto de exemplo', vendedorNome: 'Vendedor Exemplo',
        },
        itens: [
          { descricao: 'Item de exemplo A', quantidade: 5000, precoUnitario: 2.5, precoTotal: 12500 },
          { descricao: 'Item de exemplo B', quantidade: 10000, precoUnitario: 2.1, precoTotal: 21000 },
        ],
        variacoes: [
          { quantidade: 5000, precoUnitario: 2.5, precoTotal: 12500 },
          { quantidade: 10000, precoUnitario: 2.1, precoTotal: 21000 },
        ],
        logoBuffer: await resolverLogoBuffer(empresa?.logo ?? null),
      }
      const pdf = await renderizarLayout(tpl.layoutJson, ctx)
      return reply.type('application/pdf')
        .header('Content-Disposition', `inline; filename="preview-${tpl.id}.pdf"`)
        .send(pdf)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // ── Gerar PDF real a partir de um orçamento ──
  app.post('/gerar-pdf', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const body = z.object({
      orcamentoId: z.string().uuid(),
      templateId: z.string().uuid().optional(),
      tipo: tipoSchema,
    }).parse(request.body)
    try {
      const tpl = await resolverTemplateVisual(user.empresaId, body.tipo as TipoTemplate, body.templateId)
      const ctx = await montarContexto(user.empresaId, body.orcamentoId)
      if (!ctx) return reply.status(404).send({ message: 'Orçamento não encontrado.', code: 'NAO_ENCONTRADO' })

      if (!tpl) {
        // Sem template visual → cai no Fluxo_Legado (proposta WEGA/PADRAO atual).
        // Só aplicável a PROPOSTA; para ORCAMENTO sem template, informa.
        if (body.tipo === 'PROPOSTA') {
          return reply.status(409).send({
            message: 'Nenhum template visual de proposta. Use a proposta padrão (botão Proposta do orçamento) ou crie um template.',
            code: 'SEM_TEMPLATE_VISUAL',
          })
        }
        return reply.status(409).send({ message: 'Nenhum template visual de orçamento definido.', code: 'SEM_TEMPLATE_VISUAL' })
      }

      const pdf = await renderizarLayout(tpl.layoutJson, ctx)
      return reply.type('application/pdf')
        .header('Content-Disposition', `inline; filename="documento-${body.tipo.toLowerCase()}.pdf"`)
        .send(pdf)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })
}
