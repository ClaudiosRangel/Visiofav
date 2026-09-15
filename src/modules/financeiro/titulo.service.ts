/**
 * Financeiro Operacional (Onda 1) — regras unificadas de título
 * (ContaReceber / ContaPagar): editar, cancelar, estornar baixa, baixa
 * individual enriquecida e baixa em lote.
 *
 * Multi-tenant normal: toda query filtra por `empresaId`. Baixa em lote
 * particiona sucesso/ignorados sem derrubar o lote inteiro.
 */
import type { PrismaClient } from '@prisma/client'
import { ErroFinanceiro } from './conta-financeira.service'
import { assertPeriodoAberto } from './fechamento.service'

export type TipoTitulo = 'RECEBER' | 'PAGAR'

const STATUS_BAIXADO: Record<TipoTitulo, string> = { RECEBER: 'RECEBIDA', PAGAR: 'PAGA' }

function delegate(prisma: PrismaClient, tipo: TipoTitulo) {
  return tipo === 'RECEBER' ? prisma.contaReceber : prisma.contaPagar
}

export interface EditarTituloInput {
  descricao?: string
  valor?: number
  dataVencimento?: Date
  categoriaId?: string | null
  centroCustoId?: string | null
  contaFinanceiraId?: string | null
  observacao?: string | null
}

async function buscar(prisma: PrismaClient, empresaId: string, tipo: TipoTitulo, id: string) {
  const titulo = await (delegate(prisma, tipo) as any).findFirst({ where: { id, empresaId } })
  if (!titulo) throw new ErroFinanceiro(404, 'Título não encontrado')
  return titulo
}

export async function editarTitulo(prisma: PrismaClient, empresaId: string, tipo: TipoTitulo, id: string, dados: EditarTituloInput) {
  const titulo = await buscar(prisma, empresaId, tipo, id)
  if (titulo.status !== 'ABERTA') throw new ErroFinanceiro(409, 'Só títulos em aberto podem ser editados')
  return (delegate(prisma, tipo) as any).update({
    where: { id },
    data: {
      ...(dados.descricao !== undefined ? { descricao: dados.descricao } : {}),
      ...(dados.valor !== undefined ? { valor: dados.valor } : {}),
      ...(dados.dataVencimento !== undefined ? { dataVencimento: dados.dataVencimento } : {}),
      ...(dados.categoriaId !== undefined ? { categoriaId: dados.categoriaId } : {}),
      ...(dados.centroCustoId !== undefined ? { centroCustoId: dados.centroCustoId } : {}),
      ...(dados.contaFinanceiraId !== undefined ? { contaFinanceiraId: dados.contaFinanceiraId } : {}),
      ...(dados.observacao !== undefined ? { observacao: dados.observacao } : {}),
    },
  })
}

export async function cancelarTitulo(prisma: PrismaClient, empresaId: string, tipo: TipoTitulo, id: string) {
  const titulo = await buscar(prisma, empresaId, tipo, id)
  if (titulo.status === STATUS_BAIXADO[tipo]) throw new ErroFinanceiro(409, 'Título já baixado não pode ser cancelado; estorne antes')
  if (titulo.status === 'CANCELADA') throw new ErroFinanceiro(409, 'Título já cancelado')
  return (delegate(prisma, tipo) as any).update({ where: { id }, data: { status: 'CANCELADA', canceladoEm: new Date() } })
}

export async function estornarBaixa(prisma: PrismaClient, empresaId: string, tipo: TipoTitulo, id: string) {
  const titulo = await buscar(prisma, empresaId, tipo, id)
  if (titulo.status !== STATUS_BAIXADO[tipo]) throw new ErroFinanceiro(409, 'Só títulos baixados podem ser estornados')
  const dataBaixa = tipo === 'RECEBER' ? titulo.dataRecebimento : titulo.dataPagamento
  if (dataBaixa) await assertPeriodoAberto(prisma, empresaId, dataBaixa)

  const limpar = tipo === 'RECEBER'
    ? { status: 'ABERTA', valorRecebido: null, dataRecebimento: null }
    : { status: 'ABERTA', valorPago: null, dataPagamento: null }
  return (delegate(prisma, tipo) as any).update({ where: { id }, data: limpar })
}

export interface BaixaInput {
  valor: number
  data?: Date
  formaPagamento: string
  contaFinanceiraId?: string
  categoriaId?: string
  centroCustoId?: string
}

export async function baixarTitulo(prisma: PrismaClient, empresaId: string, tipo: TipoTitulo, id: string, baixa: BaixaInput) {
  const titulo = await buscar(prisma, empresaId, tipo, id)
  if (titulo.status === STATUS_BAIXADO[tipo]) throw new ErroFinanceiro(409, 'Título já baixado')
  if (titulo.status === 'CANCELADA') throw new ErroFinanceiro(409, 'Título cancelado não pode ser baixado')
  const data = baixa.data ?? new Date()
  await assertPeriodoAberto(prisma, empresaId, data)

  const comum = {
    status: STATUS_BAIXADO[tipo],
    formaPagamento: baixa.formaPagamento,
    ...(baixa.contaFinanceiraId ? { contaFinanceiraId: baixa.contaFinanceiraId } : {}),
    ...(baixa.categoriaId ? { categoriaId: baixa.categoriaId } : {}),
    ...(baixa.centroCustoId ? { centroCustoId: baixa.centroCustoId } : {}),
  }
  const especifico = tipo === 'RECEBER'
    ? { valorRecebido: baixa.valor, dataRecebimento: data }
    : { valorPago: baixa.valor, dataPagamento: data }
  return (delegate(prisma, tipo) as any).update({ where: { id }, data: { ...comum, ...especifico } })
}

export interface BaixaLoteInput {
  data?: Date
  formaPagamento: string
  contaFinanceiraId?: string
  categoriaId?: string
  centroCustoId?: string
}

/**
 * Baixa em lote: cada título é baixado pelo seu valor total. Particiona em
 * `sucesso` e `ignorados` (com motivo) — um título inválido não derruba os
 * demais. Property: todo id de entrada aparece em exatamente um dos dois.
 */
export async function baixarEmLote(
  prisma: PrismaClient,
  empresaId: string,
  tipo: TipoTitulo,
  ids: string[],
  baixa: BaixaLoteInput,
): Promise<{ sucesso: string[]; ignorados: { id: string; motivo: string }[] }> {
  const sucesso: string[] = []
  const ignorados: { id: string; motivo: string }[] = []

  for (const id of ids) {
    try {
      const titulo = await (delegate(prisma, tipo) as any).findFirst({ where: { id, empresaId } })
      if (!titulo) { ignorados.push({ id, motivo: 'não encontrado' }); continue }
      if (titulo.status === STATUS_BAIXADO[tipo]) { ignorados.push({ id, motivo: 'já baixado' }); continue }
      if (titulo.status === 'CANCELADA') { ignorados.push({ id, motivo: 'cancelado' }); continue }

      const valor = Number(titulo.valor.toString())
      await baixarTitulo(prisma, empresaId, tipo, id, { valor, formaPagamento: baixa.formaPagamento, data: baixa.data, contaFinanceiraId: baixa.contaFinanceiraId, categoriaId: baixa.categoriaId, centroCustoId: baixa.centroCustoId })
      sucesso.push(id)
    } catch (e: any) {
      ignorados.push({ id, motivo: e?.message ?? 'erro' })
    }
  }
  return { sucesso, ignorados }
}
