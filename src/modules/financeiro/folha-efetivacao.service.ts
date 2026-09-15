/**
 * Financeiro D3 (Folha) — efetivação: transforma uma folha ABERTA em títulos de
 * contas a pagar (1 por funcionário + 1 por encargo), reusando `incluirTitulo`
 * (D1). Atômica (transação) e idempotente (só ABERTA vira EFETIVADA).
 * Grava o `empresaId` da folha (não o do usuário) e vincula os títulos à folha
 * pela descrição (competência), padrão de rastreabilidade da folha.
 */
import type { PrismaClient } from '@prisma/client'
import { ErroFinanceiro } from './conta-financeira.service'
import { incluirTitulo } from './inclusao-titulo.service'

const CATEGORIA_FOLHA = 'Folha de Pagamento'
const CATEGORIA_ENCARGO = 'Encargos e Impostos'

/** Último dia do mês da competência YYYY-MM (fallback de vencimento). */
function fimDaCompetencia(competencia: string): Date {
  const [ano, mes] = competencia.split('-').map(Number)
  return new Date(Date.UTC(ano, mes, 0)) // dia 0 do mês seguinte = último dia do mês
}

/** Resolve (ou cria referência de) categoria por nome, isolada por empresa. */
async function resolverCategoriaId(prisma: PrismaClient, empresaId: string, nome: string): Promise<string | undefined> {
  const cat = await prisma.categoriaFinanceira.findFirst({
    where: { empresaId, nome: { contains: nome, mode: 'insensitive' } },
    select: { id: true },
  })
  return cat?.id
}

export async function efetivarFolha(
  prisma: PrismaClient,
  empresaId: string,
  folhaId: string,
): Promise<{ folhaId: string; competencia: string; titulosFuncionarios: number; titulosEncargos: number }> {
  const folha = await prisma.folhaPagamento.findFirst({ where: { id: folhaId, empresaId } })
  if (!folha) throw new ErroFinanceiro(404, 'Folha não encontrada')
  if (folha.status !== 'ABERTA') throw new ErroFinanceiro(409, 'Folha já efetivada ou cancelada')

  const [itens, encargos] = await Promise.all([
    prisma.itemFolha.findMany({
      where: { folhaId },
      include: { funcionario: { select: { nome: true, cpf: true } } },
    }),
    prisma.encargoFolha.findMany({ where: { folhaId } }),
  ])

  if (itens.length === 0 && encargos.length === 0) {
    throw new ErroFinanceiro(422, 'Folha vazia — adicione itens de funcionário ou encargos antes de efetivar')
  }

  const vencimentoPadrao = folha.dataPagamento ?? fimDaCompetencia(folha.competencia)
  const [catFolha, catEncargo] = await Promise.all([
    resolverCategoriaId(prisma, empresaId, CATEGORIA_FOLHA),
    resolverCategoriaId(prisma, empresaId, CATEGORIA_ENCARGO),
  ])

  let titulosFuncionarios = 0
  let titulosEncargos = 0

  await prisma.$transaction(async (tx) => {
    for (const item of itens) {
      const liquido = Number(item.liquido)
      if (liquido <= 0) continue // não gera título de valor zero/negativo
      await incluirTitulo(tx as unknown as PrismaClient, empresaId, 'PAGAR', {
        descricao: `Folha ${folha.competencia} - ${item.funcionario?.nome ?? 'Funcionário'}`,
        valor: liquido,
        dataVencimento: vencimentoPadrao,
        parceiroNomeLivre: item.funcionario?.nome ?? undefined,
        parceiroDocLivre: item.funcionario?.cpf ?? undefined,
        categoriaId: catFolha,
        tipoDocumento: 'FOLHA',
        competenciaGuia: folha.competencia,
      })
      titulosFuncionarios++
    }

    for (const enc of encargos) {
      const valor = Number(enc.valor)
      if (valor <= 0) continue
      await incluirTitulo(tx as unknown as PrismaClient, empresaId, 'PAGAR', {
        descricao: `Folha ${folha.competencia} - ${enc.tipo} (${enc.beneficiario})`,
        valor,
        dataVencimento: enc.vencimento,
        parceiroNomeLivre: enc.beneficiario,
        categoriaId: catEncargo,
        tipoDocumento: 'IMPOSTO',
        competenciaGuia: folha.competencia,
      })
      titulosEncargos++
    }

    await tx.folhaPagamento.update({
      where: { id: folhaId },
      data: { status: 'EFETIVADA', efetivadaEm: new Date() },
    })
  })

  return { folhaId, competencia: folha.competencia, titulosFuncionarios, titulosEncargos }
}
