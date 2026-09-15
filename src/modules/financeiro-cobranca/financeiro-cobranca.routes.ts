/**
 * Financeiro Onda 2 — rotas de cobrança bancária (prefixo /api/financeiro-cobranca).
 * Auth + moduloGuard('FINANCEIRO'). O webhook PIX fica em rota separada (pública).
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { ErroFinanceiro } from '../financeiro/conta-financeira.service'
import * as convenios from './convenio.service'
import * as boletos from './boleto.service'
import { gerarBoletoPdf } from './boleto-pdf.service'
import * as cnab from './cnab240.service'
import * as pix from './pix-cobranca.service'
import * as regua from './regua-cobranca.service'

const idParams = z.object({ id: z.string().uuid() })

function tratar(reply: any, err: any) {
  if (err instanceof ErroFinanceiro) return reply.status(err.status).send({ message: err.message })
  if (err?.name === 'ZodError') return reply.status(422).send({ message: 'Dados inválidos', erros: err.errors })
  throw err
}

const convenioSchema = z.object({
  contaFinanceiraId: z.string().uuid(),
  tipo: z.enum(['BOLETO', 'PIX', 'AMBOS']),
  banco: z.string().min(1).max(5),
  agencia: z.string().min(1).max(10),
  conta: z.string().min(1).max(15),
  beneficiario: z.string().min(1).max(120),
  carteira: z.string().max(5).optional(),
  codigoConvenio: z.string().max(20).optional(),
  chavePix: z.string().max(80).optional(),
  psp: z.string().max(30).optional(),
  clientId: z.string().max(200).optional(),
  clientSecret: z.string().optional(),
  certificadoPix: z.string().optional(),
  webhookSecret: z.string().max(200).optional(),
})

export async function financeiroCobrancaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('FINANCEIRO'))

  // ---- Convênios ----
  app.get('/convenios', async (request) => {
    const user = request.user as { empresaId: string }
    return convenios.listarConvenios(prisma, user.empresaId)
  })
  app.post('/convenios', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const body = convenioSchema.parse(request.body)
      return reply.status(201).send(await convenios.criarConvenio(prisma, user.empresaId, body))
    } catch (err) { return tratar(reply, err) }
  })
  app.get('/convenios/:id', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const { id } = idParams.parse(request.params)
      return await convenios.obterConvenio(prisma, user.empresaId, id)
    } catch (err) { return tratar(reply, err) }
  })
  app.patch('/convenios/:id/inativar', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const { id } = idParams.parse(request.params)
      return await convenios.inativarConvenio(prisma, user.empresaId, id)
    } catch (err) { return tratar(reply, err) }
  })

  // ---- Boletos ----
  app.get('/boletos', async (request) => {
    const user = request.user as { empresaId: string }
    const q = z.object({ status: z.string().optional(), convenioId: z.string().uuid().optional() }).parse(request.query)
    return boletos.listarBoletos(prisma, user.empresaId, q)
  })
  app.post('/boletos/emitir', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const body = z.object({ tituloId: z.string().uuid(), convenioId: z.string().uuid() }).parse(request.body)
      return reply.status(201).send(await boletos.emitirBoleto(prisma, user.empresaId, body.tituloId, body.convenioId))
    } catch (err) { return tratar(reply, err) }
  })
  app.get('/boletos/:id/pdf', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const { id } = idParams.parse(request.params)
      const boleto = await boletos.obterBoleto(prisma, user.empresaId, id)
      const convenio = await convenios.obterConvenio(prisma, user.empresaId, boleto.convenioId)
      const pdf = await gerarBoletoPdf({
        beneficiario: (convenio as any).beneficiario,
        banco: (convenio as any).banco,
        agencia: (convenio as any).agencia,
        conta: (convenio as any).conta,
        pagador: 'Pagador',
        nossoNumero: boleto.nossoNumero,
        linhaDigitavel: boleto.linhaDigitavel,
        codigoBarras: boleto.codigoBarras,
        valor: Number(boleto.valor.toString()),
        vencimento: boleto.vencimento,
      })
      reply.header('Content-Type', 'application/pdf')
      reply.header('Content-Disposition', `inline; filename="boleto-${boleto.nossoNumero}.pdf"`)
      return reply.send(pdf)
    } catch (err) { return tratar(reply, err) }
  })

  // ---- CNAB ----
  app.post('/cnab/remessa', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const body = z.object({ convenioId: z.string().uuid(), boletoIds: z.array(z.string().uuid()).min(1) }).parse(request.body)
      return await cnab.gerarRemessa(prisma, user.empresaId, body.convenioId, body.boletoIds)
    } catch (err) { return tratar(reply, err) }
  })
  app.post('/cnab/retorno', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const body = z.object({ conteudo: z.string().min(1) }).parse(request.body)
      return await cnab.processarRetorno(prisma, user.empresaId, body.conteudo)
    } catch (err) { return tratar(reply, err) }
  })

  // ---- PIX ----
  app.get('/pix', async (request) => {
    const user = request.user as { empresaId: string }
    return pix.listarPix(prisma, user.empresaId)
  })
  app.post('/pix/gerar', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const body = z.object({ tituloId: z.string().uuid(), convenioId: z.string().uuid() }).parse(request.body)
      return reply.status(201).send(await pix.gerarCobrancaPix(prisma, user.empresaId, body.tituloId, body.convenioId))
    } catch (err) { return tratar(reply, err) }
  })
  app.get('/pix/:id/qrcode', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const { id } = idParams.parse(request.params)
      return { qrcode: await pix.gerarQrCodePix(prisma, user.empresaId, id) }
    } catch (err) { return tratar(reply, err) }
  })

  // ---- Régua ----
  app.get('/regua', async (request) => {
    const user = request.user as { empresaId: string }
    return regua.obterRegua(prisma, user.empresaId)
  })
  app.put('/regua', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const body = z.object({
        ativa: z.boolean(),
        eventos: z.array(z.object({ offsetDias: z.number().int(), assunto: z.string().min(1).max(200), template: z.string().min(1) })),
      }).parse(request.body)
      return await regua.salvarRegua(prisma, user.empresaId, body.ativa, body.eventos)
    } catch (err) { return tratar(reply, err) }
  })
}

/**
 * Rota de webhook PIX — PÚBLICA (o PSP chama). SEM authenticate/moduloGuard.
 * O empresaId vem na URL; a segurança real é o txid existir + (opcional)
 * validação de segredo do convênio. Nunca confia cegamente no corpo.
 */
export async function pixWebhookRoutes(app: FastifyInstance) {
  app.post('/:empresaId', async (request, reply) => {
    try {
      const { empresaId } = z.object({ empresaId: z.string().uuid() }).parse(request.params)
      const body = z.object({ txid: z.string().min(1) }).parse(request.body)
      const res = await pix.processarWebhookPix(prisma, empresaId, body.txid)
      return reply.status(200).send(res)
    } catch {
      // webhook nunca deve devolver erro que faça o PSP reenviar infinitamente
      return reply.status(200).send({ ok: true, baixado: false })
    }
  })
}
