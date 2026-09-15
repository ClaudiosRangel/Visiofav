/**
 * Financeiro D4 (Contabilidade) — CRUD do plano de contas, de/para e
 * lançamentos manuais em partidas dobradas + consultas (razão, balancete).
 * Isolado por empresa. Reusa o núcleo puro `contabil-core`.
 */
import type { PrismaClient } from '@prisma/client'
import { ErroFinanceiro } from './conta-financeira.service'
import {
  validarPartidasDobradas,
  saldoPorNatureza,
  temDebitoECredito,
  type PartidaInput,
  type NaturezaConta,
} from './contabil-core'

const NATUREZAS = ['DEVEDORA', 'CREDORA']
const GRUPOS = ['ATIVO', 'PASSIVO', 'PATRIMONIO', 'RECEITA', 'DESPESA']

// ── Plano de contas ────────────────────────────────────────────────────────

export async function criarConta(
  prisma: PrismaClient,
  empresaId: string,
  input: { codigo: string; nome: string; natureza: string; grupo: string; paiId?: string; analitica?: boolean },
) {
  if (!NATUREZAS.includes(input.natureza)) throw new ErroFinanceiro(422, 'natureza: use DEVEDORA ou CREDORA')
  if (!GRUPOS.includes(input.grupo)) throw new ErroFinanceiro(422, 'grupo inválido')
  const dup = await prisma.contaContabil.findFirst({ where: { empresaId, codigo: input.codigo }, select: { id: true } })
  if (dup) throw new ErroFinanceiro(409, `Já existe conta com o código ${input.codigo}`)

  if (input.paiId) {
    const pai = await prisma.contaContabil.findFirst({ where: { id: input.paiId, empresaId }, select: { id: true } })
    if (!pai) throw new ErroFinanceiro(404, 'Conta pai não encontrada')
    // Pai passa a ser sintética (não lança) por ter filha
    await prisma.contaContabil.update({ where: { id: input.paiId }, data: { analitica: false } })
  }

  return prisma.contaContabil.create({
    data: {
      empresaId,
      codigo: input.codigo,
      nome: input.nome,
      natureza: input.natureza,
      grupo: input.grupo,
      paiId: input.paiId ?? null,
      analitica: input.analitica ?? true,
    },
  })
}

export async function listarContas(prisma: PrismaClient, empresaId: string) {
  return prisma.contaContabil.findMany({ where: { empresaId }, orderBy: { codigo: 'asc' } })
}

export async function atualizarConta(
  prisma: PrismaClient,
  empresaId: string,
  id: string,
  input: { nome?: string; status?: boolean; analitica?: boolean },
) {
  const conta = await prisma.contaContabil.findFirst({ where: { id, empresaId }, select: { id: true } })
  if (!conta) throw new ErroFinanceiro(404, 'Conta não encontrada')
  return prisma.contaContabil.update({ where: { id }, data: input })
}

/** Garante que uma conta existe, é da empresa e é analítica (pode lançar). */
async function exigirContaAnalitica(prisma: PrismaClient, empresaId: string, contaId: string) {
  const conta = await prisma.contaContabil.findFirst({ where: { id: contaId, empresaId } })
  if (!conta) throw new ErroFinanceiro(404, 'Conta contábil não encontrada')
  if (!conta.analitica) throw new ErroFinanceiro(422, `Conta ${conta.codigo} é sintética — só contas analíticas recebem lançamento`)
  return conta
}

// ── De/para categoria → conta contábil ───────────────────────────────────────

export async function salvarMapeamento(
  prisma: PrismaClient,
  empresaId: string,
  categoriaId: string,
  input: {
    provisaoDebitoId?: string
    provisaoCreditoId?: string
    liquidacaoDebitoId?: string
    liquidacaoCreditoId?: string
  },
) {
  const categoria = await prisma.categoriaFinanceira.findFirst({ where: { id: categoriaId, empresaId }, select: { id: true } })
  if (!categoria) throw new ErroFinanceiro(404, 'Categoria financeira não encontrada')

  // valida contas informadas (analíticas e da empresa)
  for (const contaId of [input.provisaoDebitoId, input.provisaoCreditoId, input.liquidacaoDebitoId, input.liquidacaoCreditoId]) {
    if (contaId) await exigirContaAnalitica(prisma, empresaId, contaId)
  }

  return prisma.mapeamentoContabil.upsert({
    where: { empresaId_categoriaId: { empresaId, categoriaId } },
    update: {
      provisaoDebitoId: input.provisaoDebitoId ?? null,
      provisaoCreditoId: input.provisaoCreditoId ?? null,
      liquidacaoDebitoId: input.liquidacaoDebitoId ?? null,
      liquidacaoCreditoId: input.liquidacaoCreditoId ?? null,
    },
    create: {
      empresaId,
      categoriaId,
      provisaoDebitoId: input.provisaoDebitoId ?? null,
      provisaoCreditoId: input.provisaoCreditoId ?? null,
      liquidacaoDebitoId: input.liquidacaoDebitoId ?? null,
      liquidacaoCreditoId: input.liquidacaoCreditoId ?? null,
    },
  })
}

export async function listarMapeamentos(prisma: PrismaClient, empresaId: string) {
  return prisma.mapeamentoContabil.findMany({ where: { empresaId } })
}

export async function obterMapeamento(prisma: PrismaClient, empresaId: string, categoriaId: string) {
  return prisma.mapeamentoContabil.findFirst({ where: { empresaId, categoriaId } })
}

// ── Lançamento manual (partidas dobradas) ────────────────────────────────────

export async function criarLancamentoManual(
  prisma: PrismaClient,
  empresaId: string,
  input: { data: Date; historico: string; partidas: PartidaInput[] },
) {
  if (!input.partidas || input.partidas.length < 2) throw new ErroFinanceiro(422, 'Informe ao menos duas partidas')
  if (!temDebitoECredito(input.partidas)) throw new ErroFinanceiro(422, 'Informe ao menos um débito e um crédito')

  const { balanceado, totalDebito, totalCredito } = validarPartidasDobradas(input.partidas)
  if (!balanceado) {
    throw new ErroFinanceiro(422, `Lançamento não fecha: débitos R$ ${totalDebito.toFixed(2)} ≠ créditos R$ ${totalCredito.toFixed(2)}`)
  }

  // valida que todas as contas são analíticas e da empresa
  for (const p of input.partidas) await exigirContaAnalitica(prisma, empresaId, p.contaId)

  return prisma.$transaction(async (tx) => {
    const lanc = await tx.lancamentoContabil.create({
      data: { empresaId, data: input.data, historico: input.historico, origem: 'MANUAL', status: 'LANCADO' },
    })
    await tx.partidaContabil.createMany({
      data: input.partidas.map((p) => ({ lancamentoId: lanc.id, contaId: p.contaId, tipo: p.tipo, valor: Math.abs(Number(p.valor)) })),
    })
    return lanc
  })
}

export async function listarLancamentos(
  prisma: PrismaClient,
  empresaId: string,
  filtro?: { inicio?: Date; fim?: Date },
) {
  const where: any = { empresaId }
  if (filtro?.inicio || filtro?.fim) {
    where.data = {}
    if (filtro.inicio) where.data.gte = filtro.inicio
    if (filtro.fim) where.data.lte = filtro.fim
  }
  return prisma.lancamentoContabil.findMany({
    where,
    include: { partidas: { include: { conta: { select: { codigo: true, nome: true } } } } },
    orderBy: { data: 'desc' },
    take: 500,
  })
}

// ── Consultas: razão e balancete ─────────────────────────────────────────────

export async function razao(prisma: PrismaClient, empresaId: string, contaId: string, inicio?: Date, fim?: Date) {
  const conta = await prisma.contaContabil.findFirst({ where: { id: contaId, empresaId } })
  if (!conta) throw new ErroFinanceiro(404, 'Conta não encontrada')

  const whereLanc: any = { empresaId, status: 'LANCADO' }
  if (inicio || fim) {
    whereLanc.data = {}
    if (inicio) whereLanc.data.gte = inicio
    if (fim) whereLanc.data.lte = fim
  }
  const partidas = await prisma.partidaContabil.findMany({
    where: { contaId, lancamento: whereLanc },
    include: { lancamento: { select: { data: true, historico: true } } },
    orderBy: { lancamento: { data: 'asc' } },
  })

  let totalDebito = 0
  let totalCredito = 0
  const linhas = partidas.map((p) => {
    const v = Number(p.valor)
    if (p.tipo === 'DEBITO') totalDebito += v
    else totalCredito += v
    return { data: p.lancamento.data, historico: p.lancamento.historico, tipo: p.tipo, valor: v }
  })
  const saldo = saldoPorNatureza(conta.natureza as NaturezaConta, totalDebito, totalCredito)
  return { conta: { id: conta.id, codigo: conta.codigo, nome: conta.nome, natureza: conta.natureza }, linhas, totalDebito, totalCredito, saldo }
}

export async function balancete(prisma: PrismaClient, empresaId: string, inicio?: Date, fim?: Date) {
  const whereLanc: any = { empresaId, status: 'LANCADO' }
  if (inicio || fim) {
    whereLanc.data = {}
    if (inicio) whereLanc.data.gte = inicio
    if (fim) whereLanc.data.lte = fim
  }
  const partidas = await prisma.partidaContabil.findMany({
    where: { lancamento: whereLanc },
    include: { conta: { select: { id: true, codigo: true, nome: true, natureza: true } } },
  })

  const porConta = new Map<string, { codigo: string; nome: string; natureza: string; debito: number; credito: number }>()
  let totalGeralDebito = 0
  let totalGeralCredito = 0
  for (const p of partidas) {
    const c = p.conta
    if (!porConta.has(c.id)) porConta.set(c.id, { codigo: c.codigo, nome: c.nome, natureza: c.natureza, debito: 0, credito: 0 })
    const linha = porConta.get(c.id)!
    const v = Number(p.valor)
    if (p.tipo === 'DEBITO') { linha.debito += v; totalGeralDebito += v }
    else { linha.credito += v; totalGeralCredito += v }
  }

  const contas = Array.from(porConta.values())
    .map((l) => ({ ...l, saldo: saldoPorNatureza(l.natureza as NaturezaConta, l.debito, l.credito) }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo))

  return {
    contas,
    totalDebito: Math.round(totalGeralDebito * 100) / 100,
    totalCredito: Math.round(totalGeralCredito * 100) / 100,
    fecha: Math.abs(totalGeralDebito - totalGeralCredito) <= 0.01,
  }
}
