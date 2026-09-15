/**
 * Financeiro D3 (Folha) — CRUD de folha, itens e encargos + importação de CSV.
 * Isolado por empresa. Só altera itens/encargos enquanto a folha está ABERTA.
 * O Vizor NÃO calcula folha — apenas consolida o resultado do período.
 */
import type { PrismaClient } from '@prisma/client'
import { ErroFinanceiro } from './conta-financeira.service'
import { calcularLiquido, calcularTotaisFolha, parsearCsvFolha } from './folha-parser'

const RE_COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/

/** Recalcula e persiste os totais da folha a partir de itens/encargos atuais. */
async function recalcularTotais(prisma: PrismaClient, folhaId: string): Promise<void> {
  const [itens, encargos] = await Promise.all([
    prisma.itemFolha.findMany({ where: { folhaId }, select: { liquido: true } }),
    prisma.encargoFolha.findMany({ where: { folhaId }, select: { valor: true } }),
  ])
  const t = calcularTotaisFolha(
    itens.map((i) => ({ liquido: Number(i.liquido) })),
    encargos.map((e) => ({ valor: Number(e.valor) })),
  )
  await prisma.folhaPagamento.update({
    where: { id: folhaId },
    data: { totalLiquido: t.totalLiquido, totalEncargos: t.totalEncargos },
  })
}

/** Carrega a folha garantindo isolamento por empresa. Lança 404 se não achar. */
async function carregarFolha(prisma: PrismaClient, empresaId: string, folhaId: string) {
  const folha = await prisma.folhaPagamento.findFirst({ where: { id: folhaId, empresaId } })
  if (!folha) throw new ErroFinanceiro(404, 'Folha não encontrada')
  return folha
}

function exigirAberta(folha: { status: string }): void {
  if (folha.status !== 'ABERTA') throw new ErroFinanceiro(409, 'Folha não está ABERTA — não pode ser alterada')
}

export async function criarFolha(
  prisma: PrismaClient,
  empresaId: string,
  input: { competencia: string; descricao?: string; dataPagamento?: Date },
) {
  if (!RE_COMPETENCIA.test(input.competencia)) {
    throw new ErroFinanceiro(422, 'competencia: formato esperado YYYY-MM')
  }
  const existente = await prisma.folhaPagamento.findFirst({
    where: { empresaId, competencia: input.competencia, status: 'ABERTA' },
    select: { id: true },
  })
  if (existente) throw new ErroFinanceiro(409, `Já existe folha ABERTA para a competência ${input.competencia}`)

  return prisma.folhaPagamento.create({
    data: {
      empresaId,
      competencia: input.competencia,
      descricao: input.descricao ?? null,
      dataPagamento: input.dataPagamento ?? null,
    },
  })
}

export async function listarFolhas(prisma: PrismaClient, empresaId: string) {
  return prisma.folhaPagamento.findMany({ where: { empresaId }, orderBy: { competencia: 'desc' } })
}

export async function obterFolha(prisma: PrismaClient, empresaId: string, folhaId: string) {
  const folha = await carregarFolha(prisma, empresaId, folhaId)
  const [itens, encargos] = await Promise.all([
    prisma.itemFolha.findMany({
      where: { folhaId },
      include: { funcionario: { select: { nome: true, matricula: true, cpf: true } } },
    }),
    prisma.encargoFolha.findMany({ where: { folhaId }, orderBy: { vencimento: 'asc' } }),
  ])
  const totais = calcularTotaisFolha(
    itens.map((i) => ({ liquido: Number(i.liquido) })),
    encargos.map((e) => ({ valor: Number(e.valor) })),
  )
  return { ...folha, itens, encargos, totais }
}

export async function adicionarItem(
  prisma: PrismaClient,
  empresaId: string,
  folhaId: string,
  input: { funcionarioId: string; proventos: number; descontos: number },
) {
  const folha = await carregarFolha(prisma, empresaId, folhaId)
  exigirAberta(folha)
  const func = await prisma.funcionario.findFirst({ where: { id: input.funcionarioId, empresaId }, select: { id: true } })
  if (!func) throw new ErroFinanceiro(404, 'Funcionário não encontrado nesta empresa')
  const liquido = calcularLiquido(input.proventos, input.descontos)
  const item = await prisma.itemFolha.create({
    data: { folhaId, funcionarioId: input.funcionarioId, proventos: input.proventos, descontos: input.descontos, liquido },
  })
  await recalcularTotais(prisma, folhaId)
  return item
}

export async function editarItem(
  prisma: PrismaClient,
  empresaId: string,
  folhaId: string,
  itemId: string,
  input: { proventos: number; descontos: number },
) {
  const folha = await carregarFolha(prisma, empresaId, folhaId)
  exigirAberta(folha)
  const item = await prisma.itemFolha.findFirst({ where: { id: itemId, folhaId } })
  if (!item) throw new ErroFinanceiro(404, 'Item de folha não encontrado')
  const liquido = calcularLiquido(input.proventos, input.descontos)
  const atualizado = await prisma.itemFolha.update({
    where: { id: itemId },
    data: { proventos: input.proventos, descontos: input.descontos, liquido },
  })
  await recalcularTotais(prisma, folhaId)
  return atualizado
}

export async function removerItem(prisma: PrismaClient, empresaId: string, folhaId: string, itemId: string) {
  const folha = await carregarFolha(prisma, empresaId, folhaId)
  exigirAberta(folha)
  const item = await prisma.itemFolha.findFirst({ where: { id: itemId, folhaId }, select: { id: true } })
  if (!item) throw new ErroFinanceiro(404, 'Item de folha não encontrado')
  await prisma.itemFolha.delete({ where: { id: itemId } })
  await recalcularTotais(prisma, folhaId)
  return { removido: true }
}

export async function adicionarEncargo(
  prisma: PrismaClient,
  empresaId: string,
  folhaId: string,
  input: { tipo: string; beneficiario: string; valor: number; vencimento: Date },
) {
  const folha = await carregarFolha(prisma, empresaId, folhaId)
  exigirAberta(folha)
  if (input.valor <= 0) throw new ErroFinanceiro(422, 'valor: deve ser maior que zero')
  const encargo = await prisma.encargoFolha.create({
    data: {
      folhaId,
      tipo: (input.tipo || 'OUTRO').toUpperCase(),
      beneficiario: input.beneficiario,
      valor: input.valor,
      vencimento: input.vencimento,
    },
  })
  await recalcularTotais(prisma, folhaId)
  return encargo
}

export async function removerEncargo(prisma: PrismaClient, empresaId: string, folhaId: string, encargoId: string) {
  const folha = await carregarFolha(prisma, empresaId, folhaId)
  exigirAberta(folha)
  const enc = await prisma.encargoFolha.findFirst({ where: { id: encargoId, folhaId }, select: { id: true } })
  if (!enc) throw new ErroFinanceiro(404, 'Encargo não encontrado')
  await prisma.encargoFolha.delete({ where: { id: encargoId } })
  await recalcularTotais(prisma, folhaId)
  return { removido: true }
}

/**
 * Importa itens a partir de um CSV de resultado de folha. Resolve o funcionário
 * por CPF (dígitos) ou matrícula dentro da empresa; cria itens para os
 * resolvidos e retorna a lista de pendentes (linhas não resolvidas) sem abortar.
 */
export async function importarCsv(
  prisma: PrismaClient,
  empresaId: string,
  folhaId: string,
  conteudo: string,
) {
  const folha = await carregarFolha(prisma, empresaId, folhaId)
  exigirAberta(folha)

  const { linhas, erros } = parsearCsvFolha(conteudo)
  if (linhas.length === 0) {
    throw new ErroFinanceiro(422, erros[0] || 'CSV inválido')
  }

  const funcionarios = await prisma.funcionario.findMany({
    where: { empresaId },
    select: { id: true, cpf: true, matricula: true },
  })
  const porCpf = new Map<string, string>()
  const porMatricula = new Map<string, string>()
  for (const f of funcionarios) {
    if (f.cpf) porCpf.set(f.cpf.replace(/\D/g, ''), f.id)
    if (f.matricula) porMatricula.set(f.matricula.trim().toLowerCase(), f.id)
  }

  const pendentes: Array<{ identificador: string; motivo: string }> = []
  const divergentes: string[] = []
  let criados = 0

  for (const l of linhas) {
    const soDigitos = l.identificador.replace(/\D/g, '')
    const funcionarioId = (soDigitos.length === 11 && porCpf.get(soDigitos)) || porMatricula.get(l.identificador.trim().toLowerCase())
    if (!funcionarioId) {
      pendentes.push({ identificador: l.identificador, motivo: 'funcionário não encontrado (CPF/matrícula)' })
      continue
    }
    if (l.divergencia) divergentes.push(l.identificador)
    await prisma.itemFolha.create({
      data: { folhaId, funcionarioId, proventos: l.proventos, descontos: l.descontos, liquido: l.liquido },
    })
    criados++
  }

  await recalcularTotais(prisma, folhaId)
  return { criados, pendentes, divergentes, avisos: erros }
}
