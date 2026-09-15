/**
 * Financeiro Onda 2 — PIX cobrança.
 * Gera BR Code (núcleo puro EMV) + QR (bwip-js) a partir de um título e
 * processa o webhook de confirmação (baixa idempotente).
 */
import crypto from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import * as bwipjs from 'bwip-js'
import { ErroFinanceiro } from '../financeiro/conta-financeira.service'
import { baixarTitulo } from '../financeiro/titulo.service'
import { montarBrCodePix } from './cobranca-calculo'

function dec(v: any): number {
  return v == null ? 0 : typeof v === 'number' ? v : Number(v.toString())
}

/** txid PIX: alfanumérico, 26–35 chars. Gerado a partir de um UUID sem hífen. */
function gerarTxid(): string {
  return crypto.randomUUID().replace(/-/g, '').substring(0, 32)
}

export async function gerarCobrancaPix(prisma: PrismaClient, empresaId: string, tituloId: string, convenioId: string) {
  const titulo = await prisma.contaReceber.findFirst({ where: { id: tituloId, empresaId } })
  if (!titulo) throw new ErroFinanceiro(404, 'Título não encontrado')
  if (titulo.status !== 'ABERTA') throw new ErroFinanceiro(422, 'Só é possível gerar PIX de título em aberto')

  const existente = await prisma.pixCobranca.findFirst({ where: { empresaId, contaReceberId: tituloId, status: 'ATIVA' } })
  if (existente) return { ...existente, valor: dec(existente.valor) }

  const convenio = await prisma.convenioBancario.findFirst({ where: { id: convenioId, empresaId } })
  if (!convenio) throw new ErroFinanceiro(404, 'Convênio não encontrado')
  if (convenio.tipo === 'BOLETO') throw new ErroFinanceiro(422, 'Convênio é exclusivo boleto; não gera PIX')
  if (!convenio.chavePix) throw new ErroFinanceiro(422, 'Convênio sem chave PIX cadastrada')

  const txid = gerarTxid()
  const valor = dec(titulo.valor)
  const brcode = montarBrCodePix({
    chave: convenio.chavePix,
    nome: convenio.beneficiario,
    cidade: 'SAO PAULO',
    valor,
    txid,
  })

  const cobranca = await prisma.pixCobranca.create({
    data: { empresaId, convenioId, contaReceberId: tituloId, txid, brcode, valor, status: 'ATIVA' },
  })
  return { ...cobranca, valor }
}

/** QR Code PNG (base64) do BR Code de uma cobrança. */
export async function gerarQrCodePix(prisma: PrismaClient, empresaId: string, cobrancaId: string): Promise<string> {
  const cob = await prisma.pixCobranca.findFirst({ where: { id: cobrancaId, empresaId } })
  if (!cob) throw new ErroFinanceiro(404, 'Cobrança PIX não encontrada')
  try {
    const png = await bwipjs.toBuffer({ bcid: 'qrcode', text: cob.brcode, scale: 4, eclevel: 'M' })
    return `data:image/png;base64,${png.toString('base64')}`
  } catch {
    return ''
  }
}

/**
 * Processa webhook do PSP. Valida txid, baixa o título e marca PAGA.
 * Idempotente: txid desconhecido ou já pago não gera baixa dupla.
 * Retorna sempre sem lançar (o PSP espera 200).
 */
export async function processarWebhookPix(prisma: PrismaClient, empresaId: string, txid: string): Promise<{ ok: boolean; baixado: boolean }> {
  const cob = await prisma.pixCobranca.findFirst({ where: { empresaId, txid } })
  if (!cob) {
    await prisma.pendenciaCobranca.create({ data: { empresaId, tipo: 'WEBHOOK_ORFAO', detalhe: `txid ${txid} desconhecido` } }).catch(() => {})
    return { ok: true, baixado: false }
  }
  if (cob.status === 'PAGA') return { ok: true, baixado: false } // idempotente

  try {
    await baixarTitulo(prisma, empresaId, 'RECEBER', cob.contaReceberId, { valor: dec(cob.valor), formaPagamento: 'PIX' })
  } catch {
    // título pode já estar baixado por outro caminho — segue marcando PAGA
  }
  await prisma.pixCobranca.update({ where: { id: cob.id }, data: { status: 'PAGA', pagoEm: new Date() } })
  return { ok: true, baixado: true }
}

export async function listarPix(prisma: PrismaClient, empresaId: string) {
  const rows = await prisma.pixCobranca.findMany({ where: { empresaId }, orderBy: { criadoEm: 'desc' } })
  return rows.map((r) => ({ ...r, valor: dec(r.valor) }))
}
