/**
 * Financeiro Onda 2 — service de boleto.
 * Emite boleto a partir de uma conta a receber: gera nosso número sequencial
 * do convênio, monta linha digitável e código de barras (núcleo puro FEBRABAN).
 * Idempotente por título. Modo genérico "pronto para integrar" — o campo livre
 * segue um layout padrão (agência/conta/carteira/nosso número); ajustes por
 * banco específico entram na homologação do convênio.
 */
import type { PrismaClient } from '@prisma/client'
import { ErroFinanceiro } from '../financeiro/conta-financeira.service'
import { montarCodigoBarras, montarLinhaDigitavel, modulo10 } from './cobranca-calculo'

function dec(v: any): number {
  return v == null ? 0 : typeof v === 'number' ? v : Number(v.toString())
}

/**
 * Monta o campo livre (25 pos) genérico: agência(4)+conta(8)+carteira(3)+
 * nossoNumero(10). É o esqueleto FEBRABAN comum; bancos específicos têm
 * variações tratadas na homologação do convênio.
 */
function montarCampoLivre(agencia: string, conta: string, carteira: string, nossoNumero: string): string {
  const ag = agencia.replace(/\D/g, '').padStart(4, '0').slice(-4)
  const cc = conta.replace(/\D/g, '').padStart(8, '0').slice(-8)
  const cart = carteira.replace(/\D/g, '').padStart(3, '0').slice(-3)
  const nn = nossoNumero.replace(/\D/g, '').padStart(10, '0').slice(-10)
  return (ag + cc + cart + nn).padEnd(25, '0').substring(0, 25)
}

export async function emitirBoleto(prisma: PrismaClient, empresaId: string, tituloId: string, convenioId: string) {
  const titulo = await prisma.contaReceber.findFirst({ where: { id: tituloId, empresaId } })
  if (!titulo) throw new ErroFinanceiro(404, 'Título não encontrado')
  if (titulo.status !== 'ABERTA') throw new ErroFinanceiro(422, 'Só é possível emitir boleto de título em aberto')

  // Idempotência: se já há boleto ativo para o título, retorna-o
  const existente = await prisma.boleto.findFirst({ where: { empresaId, contaReceberId: tituloId, status: { in: ['GERADO', 'REGISTRADO'] } } })
  if (existente) return existente

  const convenio = await prisma.convenioBancario.findFirst({ where: { id: convenioId, empresaId } })
  if (!convenio) throw new ErroFinanceiro(404, 'Convênio não encontrado')
  if (convenio.tipo === 'PIX') throw new ErroFinanceiro(422, 'Convênio é exclusivo PIX; não emite boleto')

  // Gera nosso número sequencial (transação para não colidir)
  const boleto = await prisma.$transaction(async (tx) => {
    const conv = await tx.convenioBancario.update({
      where: { id: convenioId },
      data: { proxNossoNumero: { increment: 1 } },
      select: { proxNossoNumero: true, agencia: true, conta: true, carteira: true, banco: true },
    })
    const nossoNumero = String(Number(conv.proxNossoNumero) - 1).padStart(10, '0')

    const valor = dec(titulo.valor)
    const campoLivre = montarCampoLivre(conv.agencia, conv.conta, conv.carteira ?? '0', nossoNumero)
    const codigoBarras = montarCodigoBarras({
      codigoBanco: conv.banco,
      moeda: 9,
      vencimento: titulo.dataVencimento,
      valor,
      campoLivre,
    })
    const linhaDigitavel = montarLinhaDigitavel(codigoBarras)

    return tx.boleto.create({
      data: {
        empresaId,
        convenioId,
        contaReceberId: tituloId,
        nossoNumero,
        linhaDigitavel,
        codigoBarras,
        valor,
        vencimento: titulo.dataVencimento,
        status: 'GERADO',
      },
    })
  })
  return boleto
}

export async function listarBoletos(prisma: PrismaClient, empresaId: string, filtros?: { status?: string; convenioId?: string }) {
  return prisma.boleto.findMany({
    where: { empresaId, ...(filtros?.status ? { status: filtros.status } : {}), ...(filtros?.convenioId ? { convenioId: filtros.convenioId } : {}) },
    orderBy: { criadoEm: 'desc' },
  })
}

export async function obterBoleto(prisma: PrismaClient, empresaId: string, id: string) {
  const boleto = await prisma.boleto.findFirst({ where: { id, empresaId } })
  if (!boleto) throw new ErroFinanceiro(404, 'Boleto não encontrado')
  return boleto
}
