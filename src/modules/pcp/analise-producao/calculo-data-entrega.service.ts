/**
 * Serviço de Cálculo de Data de Entrega com Capacidade Finita (Ponto 3).
 *
 * Calcula a data de entrega viável de uma OP considerando:
 *  - Tempo de produção: soma dos tempos das etapas (setup + operação + espera)
 *  - Capacidade das máquinas: fila de OPs já programadas em cada centro
 *  - Calendário de turnos: converte minutos de trabalho em datas reais
 *    (respeitando horas/dia disponíveis)
 *
 * Estratégia: Forward scheduling a partir de hoje, considerando a carga
 * atual das máquinas (capacidade finita). Compara com a data desejada.
 *
 * Referência: docs/visao-analise-pedido-para-op.md (Ponto 3 e 4)
 * Padrões SAP (Lead Time Scheduling) e capacidade finita (APS).
 */

import { prisma } from '../../../lib/prisma'

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface EtapaCalculada {
  sequencia: number
  descricao: string
  centroProducaoId: string | null
  centroNome: string | null
  tempoSetupMin: number
  tempoOperacaoMin: number
  tempoEsperaMin: number
  tempoTotalMin: number
  filaAnteriorMin: number // carga já existente no centro (outras OPs)
}

export interface ResultadoCalculoData {
  ordemProducaoId: string
  numero: number
  tempoProducaoTotalMin: number
  tempoProducaoTotalHoras: number
  filaTotalMin: number
  dataInicioEstimada: string
  dataFimEstimada: string
  dataEntregaViavel: string
  dataEntregaDesejada: string | null
  atendeDataDesejada: boolean | null
  diasAtraso: number
  horasUteisPorDia: number
  etapas: EtapaCalculada[]
  avisos: string[]
}

// ─── Constantes ──────────────────────────────────────────────────────────────

const HORAS_UTEIS_PADRAO = 8 // fallback quando não há turno configurado
const LEAD_EXPEDICAO_DIAS = 1 // dias entre fim de produção e entrega ao cliente

// ─── Helpers de calendário ────────────────────────────────────────────────────

/**
 * Avança uma data em N minutos de trabalho, respeitando horas úteis por dia
 * e pulando fins de semana. Simplificação: considera dias úteis seg-sex e
 * `horasUteisPorDia` de capacidade por dia.
 */
function avancarMinutosUteis(inicio: Date, minutos: number, horasUteisPorDia: number): Date {
  const minutosPorDia = horasUteisPorDia * 60
  let restante = minutos
  const data = new Date(inicio)

  // Se não há minutos, retorna a própria data
  if (restante <= 0) return data

  // Distribui os minutos em dias úteis
  while (restante > 0) {
    // Pular fim de semana (0=domingo, 6=sábado)
    const diaSemana = data.getDay()
    if (diaSemana === 0 || diaSemana === 6) {
      data.setDate(data.getDate() + 1)
      data.setHours(8, 0, 0, 0)
      continue
    }

    if (restante <= minutosPorDia) {
      // Cabe no dia atual
      data.setMinutes(data.getMinutes() + restante)
      restante = 0
    } else {
      // Consome o dia inteiro e vai para o próximo dia útil
      restante -= minutosPorDia
      data.setDate(data.getDate() + 1)
      data.setHours(8, 0, 0, 0)
    }
  }

  return data
}

/**
 * Calcula horas úteis por dia a partir dos turnos dos centros da OP.
 * Usa o turno de maior duração como referência (ou padrão se não houver).
 */
async function obterHorasUteisPorDia(empresaId: string, centroIds: string[]): Promise<number> {
  if (centroIds.length === 0) return HORAS_UTEIS_PADRAO

  const centros = await prisma.centroProducao.findMany({
    where: { id: { in: centroIds }, empresaId },
    select: { turnoProducao: { select: { duracaoMinutos: true } } },
  })

  let maiorDuracaoMin = 0
  for (const c of centros) {
    if (c.turnoProducao?.duracaoMinutos && c.turnoProducao.duracaoMinutos > maiorDuracaoMin) {
      maiorDuracaoMin = c.turnoProducao.duracaoMinutos
    }
  }

  return maiorDuracaoMin > 0 ? maiorDuracaoMin / 60 : HORAS_UTEIS_PADRAO
}

// ─── Função principal ─────────────────────────────────────────────────────────

/**
 * Calcula a data de entrega viável de uma OP.
 *
 * @param opId ID da ordem de produção
 * @param empresaId empresa
 */
export async function calcularDataEntrega(
  opId: string,
  empresaId: string,
): Promise<ResultadoCalculoData> {
  const op = await prisma.ordemProducao.findFirst({
    where: { id: opId, empresaId },
    select: {
      id: true,
      numero: true,
      dataEntregaPrevista: true,
      etapas: {
        select: {
          sequencia: true,
          descricao: true,
          centroProducaoId: true,
          tempoSetupMinutos: true,
          tempoOperacaoCalculado: true,
          tempoEsperaMinutos: true,
          centroProducao: { select: { descricao: true } },
        },
        orderBy: { sequencia: 'asc' },
      },
    },
  })

  if (!op) {
    throw { statusCode: 404, message: 'Ordem de produção não encontrada' }
  }

  const avisos: string[] = []

  if (op.etapas.length === 0) {
    avisos.push('OP sem etapas de roteiro — não é possível calcular tempo de produção.')
  }

  // ─── Calcular fila (capacidade) de cada centro envolvido ──────────────
  const centroIds = [...new Set(op.etapas.map((e) => e.centroProducaoId).filter(Boolean))] as string[]

  // Carga existente por centro = soma dos tempos das etapas ativas de OUTRAS OPs
  const filaPorCentro = new Map<string, number>()
  for (const centroId of centroIds) {
    const etapasFila = await prisma.etapaOrdemProducao.findMany({
      where: {
        centroProducaoId: centroId,
        status: { in: ['PENDENTE', 'EM_ANDAMENTO', 'PAUSADA'] },
        ordemProducaoId: { not: opId },
        ordemProducao: {
          empresaId,
          status: { in: ['PROGRAMADA', 'LIBERADA', 'EM_PRODUCAO'] },
        },
      },
      select: {
        tempoSetupMinutos: true,
        tempoOperacaoCalculado: true,
        tempoEsperaMinutos: true,
      },
    })
    const cargaMin = etapasFila.reduce(
      (acc, e) =>
        acc + Number(e.tempoSetupMinutos) + Number(e.tempoOperacaoCalculado) + Number(e.tempoEsperaMinutos),
      0,
    )
    filaPorCentro.set(centroId, cargaMin)
  }

  // ─── Montar etapas calculadas e somar tempo de produção ───────────────
  const etapasCalculadas: EtapaCalculada[] = []
  let tempoProducaoTotal = 0
  let filaTotal = 0

  for (const etapa of op.etapas) {
    const setup = Number(etapa.tempoSetupMinutos)
    const operacao = Number(etapa.tempoOperacaoCalculado)
    const espera = Number(etapa.tempoEsperaMinutos)
    const total = setup + operacao + espera
    const filaAnterior = etapa.centroProducaoId ? filaPorCentro.get(etapa.centroProducaoId) ?? 0 : 0

    tempoProducaoTotal += total

    etapasCalculadas.push({
      sequencia: etapa.sequencia,
      descricao: etapa.descricao,
      centroProducaoId: etapa.centroProducaoId,
      centroNome: etapa.centroProducao?.descricao ?? null,
      tempoSetupMin: setup,
      tempoOperacaoMin: operacao,
      tempoEsperaMin: espera,
      tempoTotalMin: total,
      filaAnteriorMin: filaAnterior,
    })
  }

  // Fila total = maior carga entre os centros (gargalo), não a soma
  // (as filas dos centros correm em paralelo; o gargalo determina o atraso)
  filaTotal = Math.max(0, ...Array.from(filaPorCentro.values()))

  // ─── Calcular datas ───────────────────────────────────────────────────
  const horasUteisPorDia = await obterHorasUteisPorDia(empresaId, centroIds)
  const agora = new Date()

  // Início considerando a fila (gargalo) — a produção só começa quando o
  // centro mais carregado libera
  const dataInicio = avancarMinutosUteis(agora, filaTotal, horasUteisPorDia)

  // Fim = início + tempo de produção da OP
  const dataFim = avancarMinutosUteis(dataInicio, tempoProducaoTotal, horasUteisPorDia)

  // Entrega viável = fim de produção + lead de expedição (dias úteis)
  const dataEntregaViavel = avancarMinutosUteis(dataFim, LEAD_EXPEDICAO_DIAS * horasUteisPorDia * 60, horasUteisPorDia)

  // ─── Comparar com data desejada ───────────────────────────────────────
  let atendeDataDesejada: boolean | null = null
  let diasAtraso = 0
  if (op.dataEntregaPrevista) {
    const desejada = new Date(op.dataEntregaPrevista)
    atendeDataDesejada = dataEntregaViavel <= desejada
    if (!atendeDataDesejada) {
      const msAtraso = dataEntregaViavel.getTime() - desejada.getTime()
      diasAtraso = Math.ceil(msAtraso / (1000 * 60 * 60 * 24))
      avisos.push(`Entrega viável ${diasAtraso} dia(s) após a data desejada.`)
    }
  } else {
    avisos.push('OP sem data de entrega prevista — comparação não realizada.')
  }

  return {
    ordemProducaoId: op.id,
    numero: op.numero,
    tempoProducaoTotalMin: Math.round(tempoProducaoTotal),
    tempoProducaoTotalHoras: Math.round((tempoProducaoTotal / 60) * 100) / 100,
    filaTotalMin: Math.round(filaTotal),
    dataInicioEstimada: dataInicio.toISOString(),
    dataFimEstimada: dataFim.toISOString(),
    dataEntregaViavel: dataEntregaViavel.toISOString(),
    dataEntregaDesejada: op.dataEntregaPrevista ? new Date(op.dataEntregaPrevista).toISOString() : null,
    atendeDataDesejada,
    diasAtraso,
    horasUteisPorDia,
    etapas: etapasCalculadas,
    avisos,
  }
}
