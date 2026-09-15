/**
 * Financeiro Onda 2 — régua de cobrança.
 * Config de eventos (offset em dias) + envio diário de e-mail (SMTP da empresa),
 * idempotente por (título, evento, dia). Reusa nodemailer + ConfigSmtp.
 */
import type { PrismaClient } from '@prisma/client'
import { ErroFinanceiro } from '../financeiro/conta-financeira.service'

function chaveDia(agora: Date): string {
  return agora.toISOString().slice(0, 10)
}

export interface EventoInput {
  offsetDias: number
  assunto: string
  template: string
}

export async function obterRegua(prisma: PrismaClient, empresaId: string) {
  const regua = await prisma.reguaCobranca.findUnique({ where: { empresaId }, include: { eventos: true } })
  return regua
}

export async function salvarRegua(prisma: PrismaClient, empresaId: string, ativa: boolean, eventos: EventoInput[]) {
  return prisma.$transaction(async (tx) => {
    const regua = await tx.reguaCobranca.upsert({
      where: { empresaId },
      create: { empresaId, ativa },
      update: { ativa },
    })
    await tx.reguaEvento.deleteMany({ where: { reguaId: regua.id } })
    if (eventos.length > 0) {
      await tx.reguaEvento.createMany({ data: eventos.map((e) => ({ reguaId: regua.id, offsetDias: e.offsetDias, assunto: e.assunto, template: e.template })) })
    }
    return tx.reguaCobranca.findUnique({ where: { id: regua.id }, include: { eventos: true } })
  })
}

/**
 * Executa a régua para UMA empresa: para cada título a receber ABERTA, verifica
 * se algum evento é atingido hoje (vencimento + offset == hoje) e envia e-mail,
 * registrando `ReguaEnvio` (idempotente por [título, evento, dia]).
 * `enviarEmail` é injetável (facilita teste). Retorna contagem de envios.
 */
export async function executarReguaEmpresa(
  prisma: PrismaClient,
  empresaId: string,
  agora: Date,
  enviarEmail: (dest: string, assunto: string, corpo: string) => Promise<void>,
): Promise<{ enviados: number; pulados: number }> {
  const regua = await prisma.reguaCobranca.findUnique({ where: { empresaId }, include: { eventos: true } })
  if (!regua || !regua.ativa || regua.eventos.length === 0) return { enviados: 0, pulados: 0 }

  const dia = chaveDia(agora)
  const hojeUtc = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate()))

  const titulos = await prisma.contaReceber.findMany({
    where: { empresaId, status: 'ABERTA' },
    include: { cliente: { select: { email: true, razaoSocial: true, nomeFantasia: true } } },
  })

  let enviados = 0
  let pulados = 0

  for (const titulo of titulos) {
    for (const evento of regua.eventos) {
      const alvo = new Date(hojeUtc.getTime() - evento.offsetDias * 86400000)
      const venc = new Date(Date.UTC(titulo.dataVencimento.getUTCFullYear(), titulo.dataVencimento.getUTCMonth(), titulo.dataVencimento.getUTCDate()))
      if (venc.getTime() !== alvo.getTime()) continue

      const email = (titulo as any).cliente?.email
      if (!email) { pulados++; continue }

      // idempotência diária
      try {
        await prisma.reguaEnvio.create({ data: { empresaId, contaReceberId: titulo.id, eventoId: evento.id, dia } })
      } catch {
        continue // já enviado hoje (unique)
      }

      const corpo = evento.template
        .replace('{cliente}', (titulo as any).cliente?.nomeFantasia || (titulo as any).cliente?.razaoSocial || 'Cliente')
        .replace('{valor}', Number(titulo.valor.toString()).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
        .replace('{vencimento}', titulo.dataVencimento.toLocaleDateString('pt-BR', { timeZone: 'UTC' }))
      try {
        await enviarEmail(email, evento.assunto, corpo)
        enviados++
      } catch {
        pulados++
      }
    }
  }
  return { enviados, pulados }
}

/** Envio real via SMTP da empresa (ConfigSmtp). Retorna função injetável. */
export async function criarEnviadorEmail(prisma: PrismaClient, empresaId: string) {
  const cfg = await prisma.configSmtp.findUnique({ where: { empresaId } })
  const host = cfg?.host || process.env.SMTP_HOST
  const user = cfg?.usuario || process.env.SMTP_USER
  const pass = cfg?.senha || process.env.SMTP_PASS
  const porta = cfg?.porta || Number(process.env.SMTP_PORT) || 587
  if (!host || !user || !pass) return null

  const nodemailer = require('nodemailer')
  const transporter = nodemailer.createTransport({
    host, port: porta, secure: porta === 465,
    auth: { user, pass },
    tls: (cfg?.usarTls ?? true) ? { rejectUnauthorized: false } : undefined,
  })
  const from = cfg?.emailFrom || process.env.SMTP_FROM || user
  return async (dest: string, assunto: string, corpo: string) => {
    await transporter.sendMail({ from, to: dest, subject: assunto, html: `<div style="font-family:Arial,sans-serif">${corpo}</div>` })
  }
}
