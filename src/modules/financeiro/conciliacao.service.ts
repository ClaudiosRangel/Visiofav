/**
 * Financeiro Operacional F1 — conciliação bancária (import OFX + matching).
 *
 * Parser OFX mínimo (extrai as tags STMTTRN essenciais) sem dependência
 * externa. Import idempotente por (contaFinanceiraId, fitid). Matching sugere
 * título por valor + janela de data; conciliar dá baixa e atualiza saldo.
 */
import type { PrismaClient } from '@prisma/client'
import { ErroFinanceiro } from './conta-financeira.service'

export interface LinhaOfx {
  fitid: string
  data: Date
  valor: number // positivo = crédito, negativo = débito
  descricao: string
}

/** Parseia o corpo OFX em linhas de transação. Tolerante a SGML e XML OFX. */
export function parseOfx(conteudo: string): LinhaOfx[] {
  const linhas: LinhaOfx[] = []
  const blocos = conteudo.split(/<STMTTRN>/i).slice(1)
  for (const bloco of blocos) {
    const trn = bloco.split(/<\/STMTTRN>/i)[0]
    const pega = (tag: string): string | null => {
      const m = trn.match(new RegExp(`<${tag}>\\s*([^<\\r\\n]+)`, 'i'))
      return m ? m[1].trim() : null
    }
    const fitid = pega('FITID')
    const valorStr = pega('TRNAMT')
    const dataStr = pega('DTPOSTED')
    if (!fitid || !valorStr || !dataStr) continue

    // DTPOSTED: YYYYMMDD (podem vir hora/timezone após; pega os 8 primeiros)
    const d = dataStr.replace(/[^0-9]/g, '').slice(0, 8)
    const ano = Number(d.slice(0, 4))
    const mes = Number(d.slice(4, 6)) - 1
    const dia = Number(d.slice(6, 8))
    linhas.push({
      fitid,
      data: new Date(Date.UTC(ano, mes, dia)),
      valor: Number(valorStr.replace(',', '.')),
      descricao: (pega('MEMO') || pega('NAME') || 'Transação').substring(0, 300),
    })
  }
  return linhas
}

/** Importa um extrato OFX, ignorando transações já importadas (idempotente). */
export async function importarOfx(prisma: PrismaClient, empresaId: string, contaFinanceiraId: string, conteudo: string) {
  const conta = await prisma.contaFinanceira.findFirst({ where: { id: contaFinanceiraId, empresaId } })
  if (!conta) throw new ErroFinanceiro(404, 'Conta financeira não encontrada')

  const linhas = parseOfx(conteudo)
  let importadas = 0
  let ignoradas = 0
  for (const l of linhas) {
    const existe = await prisma.extratoBancario.findFirst({ where: { contaFinanceiraId, fitid: l.fitid } })
    if (existe) {
      ignoradas++
      continue
    }
    await prisma.extratoBancario.create({
      data: { empresaId, contaFinanceiraId, fitid: l.fitid, data: l.data, valor: l.valor, descricao: l.descricao },
    })
    importadas++
  }
  return { importadas, ignoradas, total: linhas.length }
}

/** Sugere matches: linha não conciliada × título em aberto com mesmo valor
 * (crédito→receber, débito→pagar) e vencimento dentro de ±5 dias. */
export async function sugerirMatches(prisma: PrismaClient, empresaId: string, contaFinanceiraId: string) {
  const linhas = await prisma.extratoBancario.findMany({
    where: { empresaId, contaFinanceiraId, conciliado: false },
  })
  const JANELA = 5 * 86400000
  const sugestoes: Array<{ linhaId: string; tituloId: string; tipo: 'RECEBER' | 'PAGAR' }> = []

  for (const linha of linhas) {
    const valorAbs = Math.abs(Number(linha.valor.toString()))
    if (Number(linha.valor.toString()) >= 0) {
      const titulo = await prisma.contaReceber.findFirst({
        where: {
          empresaId,
          status: 'ABERTA',
          valor: valorAbs,
          dataVencimento: { gte: new Date(linha.data.getTime() - JANELA), lte: new Date(linha.data.getTime() + JANELA) },
        },
      })
      if (titulo) sugestoes.push({ linhaId: linha.id, tituloId: titulo.id, tipo: 'RECEBER' })
    } else {
      const titulo = await prisma.contaPagar.findFirst({
        where: {
          empresaId,
          status: 'ABERTA',
          valor: valorAbs,
          dataVencimento: { gte: new Date(linha.data.getTime() - JANELA), lte: new Date(linha.data.getTime() + JANELA) },
        },
      })
      if (titulo) sugestoes.push({ linhaId: linha.id, tituloId: titulo.id, tipo: 'PAGAR' })
    }
  }
  return sugestoes
}

/** Concilia: dá baixa no título + marca linha conciliada, atômico. */
export async function conciliar(prisma: PrismaClient, empresaId: string, linhaId: string, tituloId: string, tipo: 'RECEBER' | 'PAGAR') {
  const linha = await prisma.extratoBancario.findFirst({ where: { id: linhaId, empresaId } })
  if (!linha) throw new ErroFinanceiro(404, 'Linha de extrato não encontrada')
  if (linha.conciliado) throw new ErroFinanceiro(409, 'Linha já conciliada')

  return prisma.$transaction(async (tx) => {
    if (tipo === 'RECEBER') {
      const titulo = await tx.contaReceber.findFirst({ where: { id: tituloId, empresaId } })
      if (!titulo) throw new ErroFinanceiro(404, 'Título a receber não encontrado')
      await tx.contaReceber.update({
        where: { id: tituloId },
        data: { status: 'RECEBIDA', valorRecebido: Math.abs(Number(linha.valor.toString())), dataRecebimento: linha.data, contaFinanceiraId: linha.contaFinanceiraId },
      })
      await tx.extratoBancario.update({ where: { id: linhaId }, data: { conciliado: true, contaReceberId: tituloId } })
    } else {
      const titulo = await tx.contaPagar.findFirst({ where: { id: tituloId, empresaId } })
      if (!titulo) throw new ErroFinanceiro(404, 'Título a pagar não encontrado')
      await tx.contaPagar.update({
        where: { id: tituloId },
        data: { status: 'PAGA', valorPago: Math.abs(Number(linha.valor.toString())), dataPagamento: linha.data, contaFinanceiraId: linha.contaFinanceiraId },
      })
      await tx.extratoBancario.update({ where: { id: linhaId }, data: { conciliado: true, contaPagarId: tituloId } })
    }
    return { conciliado: true }
  })
}

/** Desfaz conciliação: reverte a baixa do título e a marca da linha. */
export async function desfazerConciliacao(prisma: PrismaClient, empresaId: string, linhaId: string) {
  const linha = await prisma.extratoBancario.findFirst({ where: { id: linhaId, empresaId } })
  if (!linha) throw new ErroFinanceiro(404, 'Linha de extrato não encontrada')
  if (!linha.conciliado) throw new ErroFinanceiro(409, 'Linha não está conciliada')

  return prisma.$transaction(async (tx) => {
    if (linha.contaReceberId) {
      await tx.contaReceber.update({ where: { id: linha.contaReceberId }, data: { status: 'ABERTA', valorRecebido: null, dataRecebimento: null } })
    }
    if (linha.contaPagarId) {
      await tx.contaPagar.update({ where: { id: linha.contaPagarId }, data: { status: 'ABERTA', valorPago: null, dataPagamento: null } })
    }
    await tx.extratoBancario.update({ where: { id: linhaId }, data: { conciliado: false, contaReceberId: null, contaPagarId: null } })
    return { desfeito: true }
  })
}
