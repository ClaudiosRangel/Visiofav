import { prisma } from '../../lib/prisma'
import type { CreateRegraAprovacaoInput, EditRegraAprovacaoInput, CreateSolicitacaoInput, ResolverSolicitacaoInput } from './workflow-aprovacao.schemas'

export const workflowAprovacaoService = {
  // ── Regras ──
  async listarRegras(empresaId: string, filtros: { page?: number; limit?: number; tipo?: string }) {
    const { page = 1, limit = 20, tipo } = filtros
    const where: any = { empresaId }
    if (tipo) where.tipo = tipo

    const [data, total] = await Promise.all([
      prisma.regraAprovacao.findMany({
        where,
        orderBy: { criadoEm: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.regraAprovacao.count({ where }),
    ])

    return { data, total, page, limit }
  },

  async buscarRegraPorId(empresaId: string, id: string) {
    return prisma.regraAprovacao.findFirst({ where: { id, empresaId } })
  },

  async criarRegra(empresaId: string, input: CreateRegraAprovacaoInput) {
    return prisma.regraAprovacao.create({
      data: {
        empresaId,
        tipo: input.tipo,
        condicao: input.condicao,
        valor: input.valor,
        aprovadorId: input.aprovadorId,
        ativo: input.ativo ?? true,
      },
    })
  },

  async editarRegra(empresaId: string, id: string, input: EditRegraAprovacaoInput) {
    const regra = await prisma.regraAprovacao.findFirst({ where: { id, empresaId } })
    if (!regra) return { error: { status: 404, message: 'Regra de aprovação não encontrada' } }

    const updated = await prisma.regraAprovacao.update({ where: { id }, data: input })
    return { data: updated }
  },

  // ── Solicitações ──
  async listarSolicitacoes(empresaId: string, filtros: { page?: number; limit?: number; status?: string; aprovadorId?: string }) {
    const { page = 1, limit = 20, status, aprovadorId } = filtros
    const where: any = { empresaId }
    if (status) where.status = status
    if (aprovadorId) where.aprovadorId = aprovadorId

    const [data, total] = await Promise.all([
      prisma.solicitacaoAprovacao.findMany({
        where,
        orderBy: { criadoEm: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.solicitacaoAprovacao.count({ where }),
    ])

    return { data, total, page, limit }
  },

  async criarSolicitacao(empresaId: string, solicitanteId: string, input: CreateSolicitacaoInput) {
    const regra = await prisma.regraAprovacao.findFirst({ where: { id: input.regraId, empresaId, ativo: true } })
    if (!regra) return { error: { status: 404, message: 'Regra de aprovação não encontrada ou inativa' } }

    return prisma.solicitacaoAprovacao.create({
      data: {
        empresaId,
        regraId: input.regraId,
        pedidoVendaId: input.pedidoVendaId,
        solicitanteId,
        aprovadorId: regra.aprovadorId,
        motivo: input.motivo,
      },
    })
  },

  async resolverSolicitacao(empresaId: string, id: string, input: ResolverSolicitacaoInput) {
    const solicitacao = await prisma.solicitacaoAprovacao.findFirst({ where: { id, empresaId, status: 'PENDENTE' } })
    if (!solicitacao) return { error: { status: 404, message: 'Solicitação não encontrada ou já resolvida' } }

    const updated = await prisma.solicitacaoAprovacao.update({
      where: { id },
      data: {
        status: input.status,
        motivo: input.motivo,
        resolvidoEm: new Date(),
      },
    })

    return { data: updated }
  },

  /**
   * Verifica se uma operação precisa de aprovação baseado nas regras configuradas
   */
  async verificarNecessidadeAprovacao(empresaId: string, tipo: string, valor: number) {
    const regras = await prisma.regraAprovacao.findMany({
      where: { empresaId, tipo, ativo: true },
    })

    const regraAplicavel = regras.find((r) => {
      if (r.condicao === 'MAIOR_QUE') return valor > Number(r.valor)
      if (r.condicao === 'MENOR_QUE') return valor < Number(r.valor)
      return false
    })

    return regraAplicavel ? { necessario: true, regra: regraAplicavel } : { necessario: false }
  },
}
