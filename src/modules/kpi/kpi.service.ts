import { prisma } from '../../lib/prisma'
import { RegraKpi } from '@prisma/client'

interface CriarRegraInput {
  nome: string
  descricao?: string
  entidade: string
  condicao: string
  threshold: number
  unidade: string
  janelaMinutos?: number
  cooldownMinutos?: number
  severidade?: string
  acoes?: string[]
  destinatarios?: string[]
}

export class KpiService {
  async criarRegra(input: CriarRegraInput, empresaId: string, userId: string): Promise<RegraKpi> {
    return prisma.regraKpi.create({
      data: {
        empresaId,
        nome: input.nome,
        descricao: input.descricao || null,
        entidade: input.entidade,
        condicao: input.condicao,
        threshold: input.threshold,
        unidade: input.unidade,
        janelaMinutos: input.janelaMinutos || null,
        cooldownMinutos: input.cooldownMinutos || 30,
        severidade: input.severidade || 'WARNING',
        acoes: input.acoes || [],
        destinatarios: input.destinatarios || [],
        criadoPorId: userId,
      },
    })
  }

  async atualizarRegra(
    regraId: string,
    input: Partial<CriarRegraInput>,
    empresaId: string,
    userId: string,
  ): Promise<RegraKpi> {
    // 1. Buscar regra atual para comparar e registrar histórico
    const regraAtual = await prisma.regraKpi.findFirst({
      where: { id: regraId, empresaId },
    })
    if (!regraAtual) throw { statusCode: 404, message: 'Regra KPI não encontrada' }

    // 2. Registrar histórico para cada campo alterado
    const campos = Object.keys(input) as Array<keyof typeof input>
    for (const campo of campos) {
      const valorAnterior = (regraAtual as any)[campo]
      const valorNovo = input[campo]
      if (JSON.stringify(valorAnterior) !== JSON.stringify(valorNovo)) {
        await prisma.historicoRegraKpi.create({
          data: {
            regraKpiId: regraId,
            usuarioId: userId,
            campo,
            valorAnterior: valorAnterior != null ? String(valorAnterior) : null,
            valorNovo: valorNovo != null ? String(valorNovo) : null,
          },
        })
      }
    }

    // 3. Atualizar regra
    return prisma.regraKpi.update({
      where: { id: regraId },
      data: input,
    })
  }

  async desativarRegra(regraId: string, empresaId: string, userId: string): Promise<RegraKpi> {
    const regra = await prisma.regraKpi.findFirst({
      where: { id: regraId, empresaId },
    })
    if (!regra) throw { statusCode: 404, message: 'Regra KPI não encontrada' }

    // Registrar histórico de desativação
    await prisma.historicoRegraKpi.create({
      data: {
        regraKpiId: regraId,
        usuarioId: userId,
        campo: 'ativo',
        valorAnterior: 'true',
        valorNovo: 'false',
      },
    })

    return prisma.regraKpi.update({
      where: { id: regraId },
      data: { ativo: false },
    })
  }

  async listarRegras(empresaId: string, filtros: { ativo?: boolean; entidade?: string; page: number; limit: number }) {
    const where: any = { empresaId }
    if (filtros.ativo !== undefined) where.ativo = filtros.ativo
    if (filtros.entidade) where.entidade = filtros.entidade

    const [data, total] = await Promise.all([
      prisma.regraKpi.findMany({
        where,
        skip: (filtros.page - 1) * filtros.limit,
        take: filtros.limit,
        orderBy: { criadoEm: 'desc' },
      }),
      prisma.regraKpi.count({ where }),
    ])

    return { data, total, page: filtros.page, limit: filtros.limit, totalPages: Math.ceil(total / filtros.limit) }
  }

  async obterRegra(regraId: string, empresaId: string) {
    const regra = await prisma.regraKpi.findFirst({
      where: { id: regraId, empresaId },
      include: {
        historico: { orderBy: { criadoEm: 'desc' }, take: 20 },
        alertas: { where: { status: 'ABERTO' }, orderBy: { criadoEm: 'desc' }, take: 5 },
      },
    })
    if (!regra) throw { statusCode: 404, message: 'Regra KPI não encontrada' }
    return regra
  }
}

export const kpiService = new KpiService()
