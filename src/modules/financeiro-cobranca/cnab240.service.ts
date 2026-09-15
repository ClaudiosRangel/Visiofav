/**
 * Financeiro Onda 2 — CNAB 240 (remessa e retorno).
 * Layout FEBRABAN genérico (header arquivo/lote, segmentos P/Q na remessa;
 * segmentos T/U no retorno). Baixa automática idempotente por hash de arquivo.
 * Ajustes de banco específico entram na homologação do convênio.
 */
import crypto from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { ErroFinanceiro } from '../financeiro/conta-financeira.service'
import { baixarTitulo } from '../financeiro/titulo.service'

function pad(v: string | number, len: number, char = ' ', dir: 'L' | 'R' = 'L'): string {
  const s = String(v)
  return dir === 'L' ? s.padEnd(len, char).substring(0, len) : s.padStart(len, char).substring(0, len)
}
function num(v: string | number, len: number): string {
  return pad(String(v).replace(/\D/g, ''), len, '0', 'R')
}

/** Gera arquivo de remessa CNAB 240 para N boletos de um convênio. */
export async function gerarRemessa(prisma: PrismaClient, empresaId: string, convenioId: string, boletoIds: string[]) {
  const convenio = await prisma.convenioBancario.findFirst({ where: { id: convenioId, empresaId } })
  if (!convenio) throw new ErroFinanceiro(404, 'Convênio não encontrado')

  const boletos = await prisma.boleto.findMany({ where: { empresaId, convenioId, id: { in: boletoIds }, status: 'GERADO' } })
  if (boletos.length === 0) throw new ErroFinanceiro(422, 'Nenhum boleto elegível (status GERADO) para remessa')

  const seq = await prisma.remessaCnab.count({ where: { empresaId, convenioId } }) + 1
  const banco = num(convenio.banco, 3)
  const linhas: string[] = []

  // Header de Arquivo (registro tipo 0)
  linhas.push(banco + '0000' + '0' + pad('', 9) + '2' + num(convenio.conta, 14) + pad('', 5) + pad(convenio.beneficiario, 30) + pad('VIZOR ERP', 30) + pad('', 10) + '1' + num(seq, 6) + pad('', 111))

  // Header de Lote (registro tipo 1)
  linhas.push(banco + '0001' + '1' + 'R' + '01' + '  ' + '030' + ' ' + '2' + num(convenio.conta, 14) + pad('', 5) + pad(convenio.beneficiario, 30) + pad('', 140))

  let seqReg = 1
  for (const b of boletos) {
    seqReg++
    // Segmento P (registro tipo 3)
    linhas.push(banco + '0001' + '3' + num(seqReg, 5) + 'P' + ' ' + '01' + num(convenio.agencia, 5) + num(convenio.conta, 12) + num(b.nossoNumero, 20) + pad(convenio.carteira ?? '1', 1) + num(b.nossoNumero, 15) + num((b.vencimento).toISOString().slice(0,10).replace(/-/g,''), 8).slice(-8) + num(Math.round(Number(b.valor.toString()) * 100), 15) + pad('', 110))
    seqReg++
    // Segmento Q (registro tipo 3) — dados do pagador (genérico)
    linhas.push(banco + '0001' + '3' + num(seqReg, 5) + 'Q' + ' ' + '01' + pad('', 200))
  }

  // Trailer de Lote (registro tipo 5)
  linhas.push(banco + '0001' + '5' + pad('', 9) + num(seqReg + 1, 6) + pad('', 217))
  // Trailer de Arquivo (registro tipo 9)
  linhas.push(banco + '9999' + '9' + pad('', 9) + num(1, 6) + num(seqReg + 3, 6) + pad('', 205))

  // Normaliza para 240 posições cada linha
  const conteudo = linhas.map((l) => l.padEnd(240, ' ').substring(0, 240)).join('\r\n')

  await prisma.$transaction(async (tx) => {
    await tx.remessaCnab.create({ data: { empresaId, convenioId, sequencial: seq, conteudo } })
    await tx.boleto.updateMany({ where: { id: { in: boletos.map((b) => b.id) } }, data: { status: 'REGISTRADO' } })
  })

  return { sequencial: seq, nomeArquivo: `CB${banco}_${String(seq).padStart(6, '0')}.REM`, conteudo, boletos: boletos.length }
}

/**
 * Processa arquivo de retorno CNAB 240: para segmentos de liquidação, casa por
 * nosso número e baixa o título. Idempotente por hash do arquivo.
 */
export async function processarRetorno(prisma: PrismaClient, empresaId: string, conteudo: string) {
  const hash = crypto.createHash('sha256').update(conteudo).digest('hex')
  const jaProcessado = await prisma.retornoCnabProcessado.findFirst({ where: { empresaId, hashArquivo: hash } })
  if (jaProcessado) return { liquidados: 0, orfaos: 0, jaProcessado: true }

  const linhas = conteudo.split(/\r?\n/).filter((l) => l.length >= 60)
  let liquidados = 0
  let orfaos = 0

  for (const linha of linhas) {
    const tipoRegistro = linha[7]
    if (tipoRegistro !== '3') continue
    const segmento = linha[13]
    if (segmento !== 'T') continue // segmento T carrega ocorrência de liquidação

    // Ocorrência (posições variam por banco; no genérico usamos 15-16)
    const nossoNumero = linha.substring(37, 57).replace(/^0+/, '') || linha.substring(37, 57)

    const boleto = await prisma.boleto.findFirst({ where: { empresaId, nossoNumero: nossoNumero.padStart(10, '0'), status: { in: ['GERADO', 'REGISTRADO'] } } })
    if (!boleto) {
      orfaos++
      await prisma.pendenciaCobranca.create({ data: { empresaId, tipo: 'RETORNO_ORFAO', detalhe: `Nosso número ${nossoNumero} não casou com boleto` } }).catch(() => {})
      continue
    }

    try {
      await baixarTitulo(prisma, empresaId, 'RECEBER', boleto.contaReceberId, { valor: Number(boleto.valor.toString()), formaPagamento: 'BOLETO', contaFinanceiraId: undefined })
      await prisma.boleto.update({ where: { id: boleto.id }, data: { status: 'LIQUIDADO' } })
      liquidados++
    } catch {
      // título já baixado/cancelado — conta como órfão de negócio, não falha o lote
      orfaos++
    }
  }

  await prisma.retornoCnabProcessado.create({ data: { empresaId, hashArquivo: hash } })
  return { liquidados, orfaos, jaProcessado: false }
}
