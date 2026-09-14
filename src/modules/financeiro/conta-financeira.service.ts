/**
 * Financeiro Operacional F1 — service de contas financeiras (caixa/banco).
 *
 * Multi-tenant NORMAL: toda query filtra explicitamente por `empresaId`.
 * O saldo atual é derivado do saldo inicial + movimentos REALIZADOS
 * (lançamentos de caixa não estornados + baixas de títulos), usando o núcleo
 * puro `calcularSaldoConta`.
 */
import type { PrismaClient, Prisma } from '@prisma/client'
import { calcularSaldoConta } from './financeiro-calculo'
import type { MovimentoConta, TipoConta } from './financeiro.types'

export class ErroFinanceiro extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ErroFinanceiro'
  }
}

function dec(v: Prisma.Decimal | number | null | undefined): number {
  if (v == null) return 0
  return typeof v === 'number' ? v : Number(v.toString())
}

export interface CriarContaInput {
  tipo: TipoConta
  nome: string
  banco?: string
  agencia?: string
  conta?: string
  saldoInicial?: number
}

export async function criarConta(prisma: PrismaClient, empresaId: string, input: CriarContaInput) {
  return prisma.contaFinanceira.create({
    data: {
      empresaId,
      tipo: input.tipo,
      nome: input.nome,
      banco: input.banco,
      agencia: input.agencia,
      conta: input.conta,
      saldoInicial: input.saldoInicial ?? 0,
    },
  })
}

/** Movimentos realizados de uma conta: lançamentos + baixas de títulos. */
async function movimentosRealizados(prisma: PrismaClient, empresaId: string, contaId: string): Promise<MovimentoConta[]> {
  const [lancamentos, receber, pagar] = await Promise.all([
    prisma.lancamentoCaixa.findMany({
      where: { empresaId, contaFinanceiraId: contaId, estornado: false },
      select: { tipo: true, valor: true },
    }),
    prisma.contaReceber.findMany({
      where: { empresaId, contaFinanceiraId: contaId, status: 'RECEBIDA' },
      select: { valorRecebido: true, valor: true },
    }),
    prisma.contaPagar.findMany({
      where: { empresaId, contaFinanceiraId: contaId, status: 'PAGA' },
      select: { valorPago: true, valor: true },
    }),
  ])

  const movs: MovimentoConta[] = []
  for (const l of lancamentos) movs.push({ tipo: l.tipo as 'ENTRADA' | 'SAIDA', valor: dec(l.valor), realizado: true })
  for (const r of receber) movs.push({ tipo: 'ENTRADA', valor: dec(r.valorRecebido ?? r.valor), realizado: true })
  for (const p of pagar) movs.push({ tipo: 'SAIDA', valor: dec(p.valorPago ?? p.valor), realizado: true })
  return movs
}

export async function listarContasComSaldo(prisma: PrismaClient, empresaId: string) {
  const contas = await prisma.contaFinanceira.findMany({
    where: { empresaId },
    orderBy: { nome: 'asc' },
  })
  return Promise.all(
    contas.map(async (c) => {
      const movs = await movimentosRealizados(prisma, empresaId, c.id)
      return { ...c, saldoAtual: calcularSaldoConta(dec(c.saldoInicial), movs) }
    }),
  )
}

/** Conta com movimento não pode ser excluída (409); só inativada. */
export async function inativarConta(prisma: PrismaClient, empresaId: string, contaId: string) {
  const conta = await prisma.contaFinanceira.findFirst({ where: { id: contaId, empresaId } })
  if (!conta) throw new ErroFinanceiro(404, 'Conta não encontrada')
  return prisma.contaFinanceira.update({ where: { id: contaId }, data: { status: false } })
}

export async function excluirConta(prisma: PrismaClient, empresaId: string, contaId: string) {
  const conta = await prisma.contaFinanceira.findFirst({ where: { id: contaId, empresaId } })
  if (!conta) throw new ErroFinanceiro(404, 'Conta não encontrada')

  const movimento = await prisma.lancamentoCaixa.count({ where: { empresaId, contaFinanceiraId: contaId } })
  if (movimento > 0) throw new ErroFinanceiro(409, 'Conta possui movimento; inative em vez de excluir')
  return prisma.contaFinanceira.delete({ where: { id: contaId } })
}

export interface TransferenciaInput {
  contaOrigemId: string
  contaDestinoId: string
  valor: number
  data: Date
  descricao?: string
}

/**
 * Transferência entre contas: débito na origem + crédito no destino, atômico.
 * NÃO afeta o resultado (DRE) — os lançamentos ficam sem categoria de
 * receita/despesa (transferência é movimento neutro).
 */
export async function transferirEntreContas(prisma: PrismaClient, empresaId: string, input: TransferenciaInput) {
  if (input.contaOrigemId === input.contaDestinoId) {
    throw new ErroFinanceiro(422, 'Conta de origem e destino devem ser diferentes')
  }
  const [origem, destino] = await Promise.all([
    prisma.contaFinanceira.findFirst({ where: { id: input.contaOrigemId, empresaId } }),
    prisma.contaFinanceira.findFirst({ where: { id: input.contaDestinoId, empresaId } }),
  ])
  if (!origem || !destino) throw new ErroFinanceiro(404, 'Conta de origem ou destino não encontrada')

  const descricao = input.descricao ?? `Transferência ${origem.nome} → ${destino.nome}`
  const competencia = input.data

  return prisma.$transaction(async (tx) => {
    const saida = await tx.lancamentoCaixa.create({
      data: {
        empresaId,
        contaFinanceiraId: input.contaOrigemId,
        tipo: 'SAIDA',
        valor: input.valor,
        data: input.data,
        dataCompetencia: competencia,
        descricao,
        categoriaId: null, // transferência é neutra no DRE
      },
    })
    const entrada = await tx.lancamentoCaixa.create({
      data: {
        empresaId,
        contaFinanceiraId: input.contaDestinoId,
        tipo: 'ENTRADA',
        valor: input.valor,
        data: input.data,
        dataCompetencia: competencia,
        descricao,
        categoriaId: null,
      },
    })
    return { saida, entrada }
  })
}
