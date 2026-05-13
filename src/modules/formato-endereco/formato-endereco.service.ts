import { prisma } from '../../lib/prisma'
import { FormatoEndereco, FormatoEnderecoSegmento } from './formato-endereco.types'

/**
 * FormatoEnderecoService — CRUD de formatos de endereço e resolução de formato aplicável.
 */

export interface CriarFormatoDto {
  nome: string
  descricao?: string
  segmentos: FormatoEnderecoSegmento[]
  empresaId: string
}

export interface AtualizarFormatoDto {
  nome?: string
  descricao?: string
  segmentos?: FormatoEnderecoSegmento[]
  status?: boolean
}

function validarSegmentos(segmentos: FormatoEnderecoSegmento[]): void {
  if (!segmentos || segmentos.length === 0) {
    throw { status: 400, message: 'Formato de endereço deve ter pelo menos um segmento ativo' }
  }
}

function mapToFormatoEndereco(record: any): FormatoEndereco {
  return {
    id: record.id,
    nome: record.nome,
    descricao: record.descricao ?? undefined,
    segmentos: record.segmentos as FormatoEnderecoSegmento[],
    empresaId: record.empresaId,
    criadoEm: record.criadoEm,
  }
}

export async function criar(data: CriarFormatoDto): Promise<FormatoEndereco> {
  validarSegmentos(data.segmentos)

  const record = await prisma.formatoEndereco.create({
    data: {
      nome: data.nome,
      descricao: data.descricao,
      segmentos: data.segmentos as any,
      empresaId: data.empresaId,
    },
  })

  return mapToFormatoEndereco(record)
}

export async function atualizar(id: string, data: AtualizarFormatoDto): Promise<FormatoEndereco> {
  if (data.segmentos !== undefined) {
    validarSegmentos(data.segmentos)
  }

  const existing = await prisma.formatoEndereco.findUnique({ where: { id } })
  if (!existing) {
    throw { status: 404, message: 'Formato de endereço não encontrado' }
  }

  const record = await prisma.formatoEndereco.update({
    where: { id },
    data: {
      ...(data.nome !== undefined && { nome: data.nome }),
      ...(data.descricao !== undefined && { descricao: data.descricao }),
      ...(data.segmentos !== undefined && { segmentos: data.segmentos as any }),
      ...(data.status !== undefined && { status: data.status }),
    },
  })

  return mapToFormatoEndereco(record)
}

export async function buscarPorId(id: string): Promise<FormatoEndereco | null> {
  const record = await prisma.formatoEndereco.findUnique({ where: { id } })
  if (!record) return null
  return mapToFormatoEndereco(record)
}

export async function listar(empresaId: string): Promise<FormatoEndereco[]> {
  const records = await prisma.formatoEndereco.findMany({
    where: { empresaId },
    orderBy: { criadoEm: 'asc' },
  })

  return records.map(mapToFormatoEndereco)
}

export async function excluir(id: string): Promise<void> {
  const existing = await prisma.formatoEndereco.findUnique({ where: { id } })
  if (!existing) {
    throw { status: 404, message: 'Formato de endereço não encontrado' }
  }

  const [depositoCount, zonaCount] = await Promise.all([
    prisma.deposito.count({ where: { formatoEnderecoId: id } }),
    prisma.zona.count({ where: { formatoEnderecoId: id } }),
  ])

  if (depositoCount > 0 || zonaCount > 0) {
    throw {
      status: 409,
      message: `Formato de endereço está associado a ${depositoCount} depósito(s) e ${zonaCount} zona(s)`,
    }
  }

  await prisma.formatoEndereco.delete({ where: { id } })
}

/**
 * Resolve o formato de endereço aplicável seguindo a hierarquia: Zona > Depósito > Padrão.
 * - Se zonaId fornecido e a zona possui formatoEnderecoId → retorna formato da zona
 * - Se zona não tem formato → verifica depósito → retorna formato do depósito
 * - Se nenhum tem formato → retorna formato padrão de 6 segmentos
 */
export async function resolverFormato(depositoId: string, zonaId?: string): Promise<FormatoEndereco> {
  if (zonaId) {
    const zona = await prisma.zona.findUnique({
      where: { id: zonaId },
      include: { formatoEndereco: true },
    })

    if (zona?.formatoEndereco) {
      return mapToFormatoEndereco(zona.formatoEndereco)
    }
  }

  const deposito = await prisma.deposito.findUnique({
    where: { id: depositoId },
    include: { formatoEndereco: true },
  })

  if (deposito?.formatoEndereco) {
    return mapToFormatoEndereco(deposito.formatoEndereco)
  }

  return getFormatoPadrao()
}

/**
 * Retorna o formato padrão legado de 6 segmentos (Depósito-Zona-Rua-Prédio-Nível-Apto).
 * Não requer acesso ao banco de dados.
 */
export function getFormatoPadrao(): FormatoEndereco {
  return {
    id: 'padrao',
    nome: 'Porta-palete (6 segmentos)',
    descricao: 'Formato legado padrão com 6 segmentos: Depósito-Zona-Rua-Prédio-Nível-Apto',
    segmentos: [
      { nome: 'Depósito', campoFisico: 'codigoDeposito', ordem: 1, numerico: true },
      { nome: 'Zona', campoFisico: 'codigoZona', ordem: 2, numerico: true },
      { nome: 'Rua', campoFisico: 'codigoRua', ordem: 3, numerico: true },
      { nome: 'Prédio', campoFisico: 'codigoPredio', ordem: 4, numerico: true },
      { nome: 'Nível', campoFisico: 'codigoNivel', ordem: 5, numerico: true },
      { nome: 'Apto', campoFisico: 'codigoApto', ordem: 6, numerico: true },
    ],
    empresaId: '',
    criadoEm: new Date(0),
  }
}
