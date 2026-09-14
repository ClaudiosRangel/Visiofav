/**
 * Financeiro Operacional F1 — lançamentos manuais de caixa.
 *
 * Entrada/saída manual não originada de venda/compra. Atualiza o saldo da
 * conta (derivado em `listarContasComSaldo`) e respeita período fechado.
 * Rateio opcional entre centros de custo, validado por `validarRateio`.
 */
import type { PrismaClient } from '@prisma/client'
import { ErroFinanceiro } from './conta-financeira.service'
import { assertPeriodoAberto } from './fechamento.service'
import { validarRateio } from './financeiro-calculo'
import type { TipoLancamento, ParteRateio } from './financeiro.types'

export interface CriarLancamentoInput {
  contaFinanceiraId: string
  tipo: TipoLancamento
  valor: number
  data: Date
  dataCompetencia?: Date
  descricao: string
  categoriaId?: string
  rateio?: ParteRateio[]
}

export async function criarLancamento(prisma: PrismaClient, empresaId: string, input: CriarLancamentoInput) {
  if (input.valor <= 0) throw new ErroFinanceiro(422, 'valor: deve ser maior que zero')

  const conta = await prisma.contaFinanceira.findFirst({ where: { id: input.contaFinanceiraId, empresaId } })
  if (!conta) throw new ErroFinanceiro(404, 'Conta financeira não encontrada')

  const competencia = input.dataCompetencia ?? input.data
  await assertPeriodoAberto(prisma, empresaId, competencia)

  if (input.rateio && input.rateio.length > 0 && !validarRateio(input.valor, input.rateio)) {
    throw new ErroFinanceiro(422, 'rateio: a soma das partes deve ser igual ao valor do lançamento')
  }

  return prisma.$transaction(async (tx) => {
    const lancamento = await tx.lancamentoCaixa.create({
      data: {
        empresaId,
        contaFinanceiraId: input.contaFinanceiraId,
        tipo: input.tipo,
        valor: input.valor,
        data: input.data,
        dataCompetencia: competencia,
        descricao: input.descricao,
        categoriaId: input.categoriaId,
      },
    })
    if (input.rateio && input.rateio.length > 0) {
      await tx.rateioCentroCusto.createMany({
        data: input.rateio.map((p) => ({ lancamentoId: lancamento.id, centroCustoId: p.centroCustoId, valor: p.valor })),
      })
    }
    return lancamento
  })
}

/** Estorna um lançamento: marca `estornado` (reverte efeito no saldo) e
 * preserva o registro original para auditoria. */
export async function estornarLancamento(prisma: PrismaClient, empresaId: string, id: string) {
  const lancamento = await prisma.lancamentoCaixa.findFirst({ where: { id, empresaId } })
  if (!lancamento) throw new ErroFinanceiro(404, 'Lançamento não encontrado')
  if (lancamento.estornado) throw new ErroFinanceiro(409, 'Lançamento já estornado')

  await assertPeriodoAberto(prisma, empresaId, lancamento.dataCompetencia)
  return prisma.lancamentoCaixa.update({ where: { id }, data: { estornado: true } })
}

export async function listarLancamentos(prisma: PrismaClient, empresaId: string, filtros?: { contaFinanceiraId?: string }) {
  return prisma.lancamentoCaixa.findMany({
    where: { empresaId, ...(filtros?.contaFinanceiraId ? { contaFinanceiraId: filtros.contaFinanceiraId } : {}) },
    orderBy: { data: 'desc' },
  })
}
