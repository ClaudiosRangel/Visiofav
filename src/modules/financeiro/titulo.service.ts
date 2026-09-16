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
import { calcularLiquido } from './baixa-calculo'

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
  numeroDocumento?: string | null
  formaPagamento?: string | null
  tipoDocumento?: string | null
  /** ID do parceiro (grava em fornecedorId p/ PAGAR, clienteId p/ RECEBER). */
  parceiroId?: string | null
  parceiroNomeLivre?: string | null
  parceiroDocLivre?: string | null
}

async function buscar(prisma: PrismaClient, empresaId: string, tipo: TipoTitulo, id: string) {
  const titulo = await (delegate(prisma, tipo) as any).findFirst({ where: { id, empresaId } })
  if (!titulo) throw new ErroFinanceiro(404, 'Título não encontrado')
  return titulo
}

export async function editarTitulo(prisma: PrismaClient, empresaId: string, tipo: TipoTitulo, id: string, dados: EditarTituloInput) {
  const titulo = await buscar(prisma, empresaId, tipo, id)
  if (titulo.status !== 'ABERTA') throw new ErroFinanceiro(409, 'Só títulos em aberto podem ser editados')
  // Campo de parceiro depende do tipo do título
  const campoParceiro = tipo === 'RECEBER' ? 'clienteId' : 'fornecedorId'
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
      ...(dados.numeroDocumento !== undefined ? { numeroDocumento: dados.numeroDocumento } : {}),
      ...(dados.formaPagamento !== undefined ? { formaPagamento: dados.formaPagamento } : {}),
      ...(dados.tipoDocumento !== undefined ? { tipoDocumento: dados.tipoDocumento } : {}),
      ...(dados.parceiroId !== undefined ? { [campoParceiro]: dados.parceiroId } : {}),
      ...(dados.parceiroNomeLivre !== undefined ? { parceiroNomeLivre: dados.parceiroNomeLivre } : {}),
      ...(dados.parceiroDocLivre !== undefined ? { parceiroDocLivre: dados.parceiroDocLivre } : {}),
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

  const limparComponentes = {
    jurosBaixa: null, multaBaixa: null, descontoBaixa: null, tarifaBaixa: null,
    comprovanteNome: null, comprovanteConteudo: null,
  }
  const limpar = tipo === 'RECEBER'
    ? { status: 'ABERTA', valorRecebido: null, dataRecebimento: null, ...limparComponentes }
    : { status: 'ABERTA', valorPago: null, dataPagamento: null, ...limparComponentes }
  return (delegate(prisma, tipo) as any).update({ where: { id }, data: limpar })
}

export interface BaixaInput {
  valor: number
  data?: Date
  formaPagamento: string
  contaFinanceiraId?: string
  categoriaId?: string
  centroCustoId?: string
  // Baixa profissional — ajustes de liquidação (opcionais, retrocompatível)
  juros?: number
  multa?: number
  desconto?: number
  tarifa?: number
  comprovanteNome?: string
  comprovanteConteudo?: string
}

export async function baixarTitulo(prisma: PrismaClient, empresaId: string, tipo: TipoTitulo, id: string, baixa: BaixaInput) {
  const titulo = await buscar(prisma, empresaId, tipo, id)
  if (titulo.status === STATUS_BAIXADO[tipo]) throw new ErroFinanceiro(409, 'Título já baixado')
  if (titulo.status === 'CANCELADA') throw new ErroFinanceiro(409, 'Título cancelado não pode ser baixado')
  const data = baixa.data ?? new Date()
  await assertPeriodoAberto(prisma, empresaId, data)

  // Calcula o valor líquido efetivamente movimentado a partir dos ajustes.
  const calc = calcularLiquido(tipo, {
    valor: baixa.valor,
    juros: baixa.juros,
    multa: baixa.multa,
    desconto: baixa.desconto,
    tarifa: baixa.tarifa,
  })
  if (!calc.valido) throw new ErroFinanceiro(422, 'Desconto maior que valor + acréscimos: o valor líquido ficaria negativo')

  const ajustes = {
    ...(baixa.juros != null ? { jurosBaixa: baixa.juros } : {}),
    ...(baixa.multa != null ? { multaBaixa: baixa.multa } : {}),
    ...(baixa.desconto != null ? { descontoBaixa: baixa.desconto } : {}),
    ...(baixa.tarifa != null ? { tarifaBaixa: baixa.tarifa } : {}),
    ...(baixa.comprovanteNome ? { comprovanteNome: baixa.comprovanteNome } : {}),
    ...(baixa.comprovanteConteudo ? { comprovanteConteudo: baixa.comprovanteConteudo } : {}),
  }
  const comum = {
    status: STATUS_BAIXADO[tipo],
    formaPagamento: baixa.formaPagamento,
    ...(baixa.contaFinanceiraId ? { contaFinanceiraId: baixa.contaFinanceiraId } : {}),
    ...(baixa.categoriaId ? { categoriaId: baixa.categoriaId } : {}),
    ...(baixa.centroCustoId ? { centroCustoId: baixa.centroCustoId } : {}),
    ...ajustes,
  }
  // Persiste o valor LÍQUIDO como valor pago/recebido.
  const especifico = tipo === 'RECEBER'
    ? { valorRecebido: calc.liquido, dataRecebimento: data }
    : { valorPago: calc.liquido, dataPagamento: data }
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
