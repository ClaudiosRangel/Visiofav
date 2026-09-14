/**
 * Financeiro Operacional F1 — cadastros de categoria (plano de contas
 * gerencial) e centro de custo. Multi-tenant normal (filtro por empresaId).
 */
import type { PrismaClient } from '@prisma/client'
import { ErroFinanceiro } from './conta-financeira.service'
import type { TipoCategoria } from './financeiro.types'

export interface CriarCategoriaInput {
  tipo: TipoCategoria
  codigo: string
  nome: string
  paiId?: string
}

async function assertCodigoCategoriaUnico(prisma: PrismaClient, empresaId: string, codigo: string, ignorarId?: string) {
  const existente = await prisma.categoriaFinanceira.findFirst({ where: { empresaId, codigo } })
  if (existente && existente.id !== ignorarId) {
    throw new ErroFinanceiro(409, `Já existe categoria com o código ${codigo}`)
  }
}

export async function criarCategoria(prisma: PrismaClient, empresaId: string, input: CriarCategoriaInput) {
  await assertCodigoCategoriaUnico(prisma, empresaId, input.codigo)
  if (input.paiId) {
    const pai = await prisma.categoriaFinanceira.findFirst({ where: { id: input.paiId, empresaId } })
    if (!pai) throw new ErroFinanceiro(404, 'Categoria pai não encontrada')
  }
  return prisma.categoriaFinanceira.create({
    data: { empresaId, tipo: input.tipo, codigo: input.codigo, nome: input.nome, paiId: input.paiId },
  })
}

export async function listarCategorias(prisma: PrismaClient, empresaId: string) {
  return prisma.categoriaFinanceira.findMany({ where: { empresaId }, orderBy: { codigo: 'asc' } })
}

export async function inativarCategoria(prisma: PrismaClient, empresaId: string, id: string) {
  const cat = await prisma.categoriaFinanceira.findFirst({ where: { id, empresaId } })
  if (!cat) throw new ErroFinanceiro(404, 'Categoria não encontrada')
  return prisma.categoriaFinanceira.update({ where: { id }, data: { status: false } })
}

export interface CriarCentroCustoInput {
  codigo: string
  nome: string
}

export async function criarCentroCusto(prisma: PrismaClient, empresaId: string, input: CriarCentroCustoInput) {
  const existente = await prisma.centroCusto.findFirst({ where: { empresaId, codigo: input.codigo } })
  if (existente) throw new ErroFinanceiro(409, `Já existe centro de custo com o código ${input.codigo}`)
  return prisma.centroCusto.create({ data: { empresaId, codigo: input.codigo, nome: input.nome } })
}

export async function listarCentrosCusto(prisma: PrismaClient, empresaId: string) {
  return prisma.centroCusto.findMany({ where: { empresaId }, orderBy: { codigo: 'asc' } })
}

export async function inativarCentroCusto(prisma: PrismaClient, empresaId: string, id: string) {
  const c = await prisma.centroCusto.findFirst({ where: { id, empresaId } })
  if (!c) throw new ErroFinanceiro(404, 'Centro de custo não encontrado')
  return prisma.centroCusto.update({ where: { id }, data: { status: false } })
}
