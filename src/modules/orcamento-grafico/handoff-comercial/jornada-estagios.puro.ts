/**
 * Régua de estágios da jornada do pedido (R9) — função PURA (sem Prisma), para
 * teste rápido e reuso pelo serviço de agregação `jornada-pedido.service.ts`.
 */

export type EstadoEstagio = 'CONCLUIDO' | 'ATUAL' | 'PENDENTE' | 'BLOQUEADO'

export interface EstagioJornada {
  chave: string
  titulo: string
  estado: EstadoEstagio
  detalhe?: string
}

const STATUS_PEDIDO_ORDEM = ['RASCUNHO', 'CONFIRMADO', 'EM_SEPARACAO', 'EFETIVADO', 'FATURADO']

/** Deriva os estágios da régua a partir do estado do pedido/amostra/OPs. */
export function montarEstagios(input: {
  statusPedido: string
  orcamento: { status: string } | null
  exigeAmostra: boolean
  amostraAprovada: boolean
  temAmostra: boolean
  ops: Array<{ status: string }>
}): EstagioJornada[] {
  const { statusPedido, orcamento, exigeAmostra, amostraAprovada, temAmostra, ops } = input
  const idxPedido = STATUS_PEDIDO_ORDEM.indexOf(statusPedido)

  const estagios: EstagioJornada[] = []

  estagios.push({
    chave: 'ORCAMENTO',
    titulo: 'Orçamento',
    estado: 'CONCLUIDO',
    detalhe: orcamento ? 'Orçamento aprovado' : 'Pedido direto',
  })

  if (exigeAmostra) {
    estagios.push({
      chave: 'AMOSTRA',
      titulo: 'Amostra',
      estado: amostraAprovada ? 'CONCLUIDO' : temAmostra ? 'ATUAL' : 'PENDENTE',
      detalhe: amostraAprovada ? 'Aprovada' : temAmostra ? 'Em aprovação' : 'Não solicitada',
    })
  }

  estagios.push({
    chave: 'PEDIDO',
    titulo: 'Pedido confirmado',
    estado: statusPedido === 'CANCELADO' ? 'BLOQUEADO' : idxPedido >= 1 ? 'CONCLUIDO' : 'ATUAL',
    detalhe: statusPedido,
  })

  const opsConcluidas = ops.filter((o) => o.status === 'CONCLUIDA').length
  const temOp = ops.length > 0
  const todasOpsConcluidas = temOp && opsConcluidas === ops.length
  estagios.push({
    chave: 'PRODUCAO',
    titulo: 'Produção (PCP)',
    estado: todasOpsConcluidas ? 'CONCLUIDO' : temOp ? 'ATUAL' : 'PENDENTE',
    detalhe: temOp ? `${opsConcluidas}/${ops.length} OP(s) concluída(s)` : 'Não liberado',
  })

  estagios.push({
    chave: 'FATURAMENTO',
    titulo: 'Faturamento',
    estado: statusPedido === 'FATURADO' ? 'CONCLUIDO' : statusPedido === 'EFETIVADO' ? 'ATUAL' : 'PENDENTE',
    detalhe: statusPedido === 'FATURADO' ? 'Faturado' : statusPedido === 'EFETIVADO' ? 'Pronto para faturar' : 'Aguardando produção',
  })

  return estagios
}
