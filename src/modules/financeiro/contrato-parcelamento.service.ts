/**
 * Financeiro D1 — contrato de parcelamento (financiamento, imposto parcelado,
 * dívida a órgão). Consolida N parcelas como um todo: total, entrada, saldo
 * devedor. Gera os títulos a pagar vinculados (contratoId).
 */
import type { PrismaClient } from '@prisma/client'
import { ErroFinanceiro } from './conta-financeira.service'
import { incluirTitulo } from './inclusao-titulo.service'

function dec(v: any): number {
  return v == null ? 0 : typeof v === 'number' ? v : Number(v.toString())
}

export interface CriarContratoInput {
  descricao: string
  tipo: 'FINANCIAMENTO' | 'IMPOSTO' | 'OUTRO'
  fornecedorId?: string
  parceiroNomeLivre?: string
  valorTotal: number
  entrada?: number
  numeroParcelas: number
  taxaJuros?: number
  dataPrimeira: Date
  categoriaId?: string
  centroCustoId?: string
}

/**
 * Cria o contrato e gera as N parcelas (títulos a pagar) vinculadas.
 * O valor parcelado = total − entrada, dividido em N parcelas mensais.
 */
export async function criarContrato(prisma: PrismaClient, empresaId: string, input: CriarContratoInput) {
  if (input.valorTotal <= 0) throw new ErroFinanceiro(422, 'valorTotal: deve ser maior que zero')
  if (input.numeroParcelas < 1 || input.numeroParcelas > 360) throw new ErroFinanceiro(422, 'numeroParcelas: deve estar entre 1 e 360')

  if (input.fornecedorId) {
    const f = await prisma.fornecedor.findFirst({ where: { id: input.fornecedorId, empresaId } })
    if (!f) throw new ErroFinanceiro(404, 'Fornecedor não encontrado')
  }

  const entrada = input.entrada ?? 0
  const valorParcelado = Math.round((input.valorTotal - entrada) * 100) / 100
  if (valorParcelado <= 0) throw new ErroFinanceiro(422, 'entrada não pode ser maior ou igual ao valor total')

  return prisma.$transaction(async (tx) => {
    const contrato = await tx.contratoParcelamento.create({
      data: {
        empresaId,
        descricao: input.descricao,
        tipo: input.tipo,
        fornecedorId: input.fornecedorId ?? null,
        parceiroNomeLivre: input.fornecedorId ? null : input.parceiroNomeLivre ?? null,
        valorTotal: input.valorTotal,
        entrada: input.entrada ?? null,
        numeroParcelas: input.numeroParcelas,
        taxaJuros: input.taxaJuros ?? null,
        dataPrimeira: input.dataPrimeira,
      },
    })

    // gera os títulos parcelados vinculados ao contrato (reusa incluirTitulo)
    await incluirTitulo(tx as unknown as PrismaClient, empresaId, 'PAGAR', {
      descricao: input.descricao,
      valor: valorParcelado,
      dataVencimento: input.dataPrimeira,
      parceiroId: input.fornecedorId,
      parceiroNomeLivre: input.parceiroNomeLivre,
      categoriaId: input.categoriaId,
      centroCustoId: input.centroCustoId,
      parcelas: input.numeroParcelas,
      tipoDocumento: input.tipo === 'IMPOSTO' ? 'IMPOSTO' : 'FINANCIAMENTO',
      contratoId: contrato.id,
    })

    return contrato
  })
}

export async function listarContratos(prisma: PrismaClient, empresaId: string) {
  const contratos = await prisma.contratoParcelamento.findMany({ where: { empresaId }, orderBy: { criadoEm: 'desc' } })
  return contratos.map((c) => ({ ...c, valorTotal: dec(c.valorTotal), entrada: c.entrada != null ? dec(c.entrada) : null }))
}

/** Detalhe do contrato com saldo devedor (total − parcelas pagas). */
export async function obterContrato(prisma: PrismaClient, empresaId: string, id: string) {
  const contrato = await prisma.contratoParcelamento.findFirst({ where: { id, empresaId } })
  if (!contrato) throw new ErroFinanceiro(404, 'Contrato não encontrado')

  const parcelas = await prisma.contaPagar.findMany({
    where: { empresaId, contratoId: id },
    orderBy: { dataVencimento: 'asc' },
    select: { id: true, descricao: true, valor: true, valorPago: true, dataVencimento: true, dataPagamento: true, status: true, parcela: true, totalParcelas: true },
  })

  const totalPago = parcelas
    .filter((p) => p.status === 'PAGA')
    .reduce((acc, p) => acc + dec(p.valorPago ?? p.valor), 0)
  const total = dec(contrato.valorTotal)
  const entrada = contrato.entrada != null ? dec(contrato.entrada) : 0
  const saldoDevedor = Math.round((total - entrada - totalPago) * 100) / 100

  return {
    contrato: { ...contrato, valorTotal: total, entrada: contrato.entrada != null ? entrada : null },
    parcelas: parcelas.map((p) => ({ ...p, valor: dec(p.valor), valorPago: p.valorPago != null ? dec(p.valorPago) : null })),
    totalPago: Math.round(totalPago * 100) / 100,
    saldoDevedor: saldoDevedor < 0 ? 0 : saldoDevedor,
  }
}
