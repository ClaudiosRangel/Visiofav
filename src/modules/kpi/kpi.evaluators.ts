import { prisma } from '../../lib/prisma'
import { RegraKpi } from '@prisma/client'

export interface EvaluationResult {
  violated: boolean
  valorAtual: number
  entidadeId?: string // ID of the specific entity that triggered the violation
  mensagem: string
}

type Evaluator = (regra: RegraKpi, empresaId: string) => Promise<EvaluationResult>

/**
 * PEDIDO evaluator:
 * - TEMPO_EXCEDIDO: Finds pedidos with status CONFIRMADO or EM_SEPARACAO older than threshold minutes
 * - QUANTIDADE_ACIMA/ABAIXO: Count of pending pedidos
 */
async function evaluarPedido(regra: RegraKpi, empresaId: string): Promise<EvaluationResult> {
  if (regra.condicao === 'TEMPO_EXCEDIDO') {
    const thresholdMs = Number(regra.threshold) * 60 * 1000
    const limiteData = new Date(Date.now() - thresholdMs)

    const pedidoAtrasado = await prisma.pedidoVenda.findFirst({
      where: {
        empresaId,
        status: { in: ['CONFIRMADO', 'EM_SEPARACAO'] },
        criadoEm: { lt: limiteData },
      },
      orderBy: { criadoEm: 'asc' },
      select: { id: true, numero: true, criadoEm: true },
    })

    if (pedidoAtrasado) {
      const minutosDecorridos = Math.round((Date.now() - pedidoAtrasado.criadoEm.getTime()) / 60000)
      return {
        violated: true,
        valorAtual: minutosDecorridos,
        entidadeId: pedidoAtrasado.id,
        mensagem: `Pedido #${pedidoAtrasado.numero} aguardando há ${minutosDecorridos} min (limite: ${Number(regra.threshold)} min)`,
      }
    }
    return { violated: false, valorAtual: 0, mensagem: 'Todos os pedidos dentro do prazo' }
  }

  // QUANTIDADE_ACIMA / QUANTIDADE_ABAIXO: count pending orders
  const count = await prisma.pedidoVenda.count({
    where: { empresaId, status: { in: ['CONFIRMADO', 'EM_SEPARACAO'] } },
  })

  const violated =
    regra.condicao === 'QUANTIDADE_ACIMA'
      ? count > Number(regra.threshold)
      : count < Number(regra.threshold)

  return {
    violated,
    valorAtual: count,
    mensagem: violated
      ? `${count} pedidos pendentes (limite: ${Number(regra.threshold)})`
      : `${count} pedidos pendentes — normal`,
  }
}

/**
 * CONFERENCIA evaluator:
 * - TEMPO_EXCEDIDO: Conferências (OS com operação CONFERENCIA) em execução há mais que threshold minutos
 */
async function evaluarConferencia(regra: RegraKpi, empresaId: string): Promise<EvaluationResult> {
  if (regra.condicao === 'TEMPO_EXCEDIDO') {
    const thresholdMs = Number(regra.threshold) * 60 * 1000
    const limiteData = new Date(Date.now() - thresholdMs)

    const osAtrasada = await prisma.ordemServicoWms.findFirst({
      where: {
        empresaId,
        operacao: 'CONFERENCIA',
        status: 'EXECUTANDO',
        horaInicio: { lt: limiteData },
      },
      orderBy: { horaInicio: 'asc' },
      select: { id: true, numero: true, horaInicio: true },
    })

    if (osAtrasada && osAtrasada.horaInicio) {
      const minutosDecorridos = Math.round((Date.now() - osAtrasada.horaInicio.getTime()) / 60000)
      return {
        violated: true,
        valorAtual: minutosDecorridos,
        entidadeId: osAtrasada.id,
        mensagem: `Conferência OS #${osAtrasada.numero} em andamento há ${minutosDecorridos} min`,
      }
    }
    return { violated: false, valorAtual: 0, mensagem: 'Conferências dentro do prazo' }
  }

  return { violated: false, valorAtual: 0, mensagem: 'Sem avaliação aplicável' }
}

/**
 * RECEBIMENTO evaluator:
 * - TEMPO_EXCEDIDO: Agendamentos na doca há mais tempo que threshold
 */
async function evaluarRecebimento(regra: RegraKpi, empresaId: string): Promise<EvaluationResult> {
  if (regra.condicao === 'TEMPO_EXCEDIDO') {
    const thresholdMs = Number(regra.threshold) * 60 * 1000
    const limiteData = new Date(Date.now() - thresholdMs)

    const agendaAtrasada = await prisma.agendaWms.findFirst({
      where: {
        empresaId,
        status: 'NA_DOCA',
        horaChegadaReal: { lt: limiteData },
      },
      orderBy: { horaChegadaReal: 'asc' },
      select: { id: true, motorista: true, horaChegadaReal: true },
    })

    if (agendaAtrasada && agendaAtrasada.horaChegadaReal) {
      const minutosDecorridos = Math.round(
        (Date.now() - agendaAtrasada.horaChegadaReal.getTime()) / 60000,
      )
      return {
        violated: true,
        valorAtual: minutosDecorridos,
        entidadeId: agendaAtrasada.id,
        mensagem: `Recebimento (${agendaAtrasada.motorista || 'veículo'}) na doca há ${minutosDecorridos} min`,
      }
    }
    return { violated: false, valorAtual: 0, mensagem: 'Recebimentos dentro do prazo' }
  }

  return { violated: false, valorAtual: 0, mensagem: 'Sem avaliação aplicável' }
}

/**
 * OCUPACAO evaluator:
 * - PERCENTUAL_ACIMA: % de endereços ocupados acima do threshold
 * - PERCENTUAL_ABAIXO: % de endereços ocupados abaixo do threshold
 */
async function evaluarOcupacao(regra: RegraKpi, empresaId: string): Promise<EvaluationResult> {
  const totalEnderecos = await prisma.endereco.count({
    where: { empresaId, status: true },
  })

  if (totalEnderecos === 0) {
    return { violated: false, valorAtual: 0, mensagem: 'Nenhum endereço cadastrado' }
  }

  const enderecosOcupados = await prisma.saldoEndereco.groupBy({
    by: ['enderecoId'],
    where: { empresaId },
  })

  const percentualOcupacao = Math.round((enderecosOcupados.length / totalEnderecos) * 100)

  const violated =
    regra.condicao === 'PERCENTUAL_ACIMA'
      ? percentualOcupacao > Number(regra.threshold)
      : percentualOcupacao < Number(regra.threshold)

  return {
    violated,
    valorAtual: percentualOcupacao,
    mensagem: violated
      ? `Ocupação em ${percentualOcupacao}% (limite: ${Number(regra.threshold)}%)`
      : `Ocupação em ${percentualOcupacao}% — normal`,
  }
}

/**
 * SEPARACAO evaluator:
 * - TEMPO_EXCEDIDO: Ondas de separação abertas há mais que threshold minutos
 * - QUANTIDADE_ACIMA/ABAIXO: Ondas pendentes acima/abaixo do threshold
 */
async function evaluarSeparacao(regra: RegraKpi, empresaId: string): Promise<EvaluationResult> {
  if (regra.condicao === 'TEMPO_EXCEDIDO') {
    const thresholdMs = Number(regra.threshold) * 60 * 1000
    const limiteData = new Date(Date.now() - thresholdMs)

    const ondaAtrasada = await prisma.ondaSeparacao.findFirst({
      where: {
        empresaId,
        status: { in: ['PENDENTE', 'EM_SEPARACAO'] },
        criadoEm: { lt: limiteData },
      },
      orderBy: { criadoEm: 'asc' },
      select: { id: true, numero: true, criadoEm: true },
    })

    if (ondaAtrasada) {
      const minutosDecorridos = Math.round((Date.now() - ondaAtrasada.criadoEm.getTime()) / 60000)
      return {
        violated: true,
        valorAtual: minutosDecorridos,
        entidadeId: ondaAtrasada.id,
        mensagem: `Onda #${ondaAtrasada.numero} pendente há ${minutosDecorridos} min`,
      }
    }
    return { violated: false, valorAtual: 0, mensagem: 'Separações dentro do prazo' }
  }

  // QUANTIDADE_ACIMA / QUANTIDADE_ABAIXO
  const count = await prisma.ondaSeparacao.count({
    where: { empresaId, status: { in: ['PENDENTE', 'EM_SEPARACAO'] } },
  })

  const violated =
    regra.condicao === 'QUANTIDADE_ACIMA'
      ? count > Number(regra.threshold)
      : count < Number(regra.threshold)

  return {
    violated,
    valorAtual: count,
    mensagem: violated
      ? `${count} ondas pendentes (limite: ${Number(regra.threshold)})`
      : `${count} ondas pendentes — normal`,
  }
}

// Registry of evaluators by entity
const EVALUATORS: Record<string, Evaluator> = {
  PEDIDO: evaluarPedido,
  CONFERENCIA: evaluarConferencia,
  RECEBIMENTO: evaluarRecebimento,
  OCUPACAO: evaluarOcupacao,
  SEPARACAO: evaluarSeparacao,
}

/**
 * Evaluates a single KPI rule and returns the result.
 */
export async function evaluarRegra(regra: RegraKpi, empresaId: string): Promise<EvaluationResult> {
  const evaluator = EVALUATORS[regra.entidade]
  if (!evaluator) {
    return { violated: false, valorAtual: 0, mensagem: `Entidade ${regra.entidade} não suportada` }
  }
  return evaluator(regra, empresaId)
}
