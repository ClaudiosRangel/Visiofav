/**
 * Tempo trabalhável dentro do turno — regra PURA (spec pcp-pausa-fim-turno).
 *
 * Problema (pedido do Caio, Carton Wega): quando o operador inicia uma etapa e
 * NÃO pausa no fim do turno, o tempo decorrido (agora − início) acumula a noite
 * toda, inflando duração/velocidade e poluindo indicadores. Pedido literal:
 * "colocar uma pausa pelo fim do turno e não contabilizar hora parada".
 *
 * Solução de mercado (OEE/MES — inmation, Epicor, MachineMetrics): o tempo FORA
 * da janela do turno é "não-agendado" e NÃO conta. Aqui a abordagem é o
 * "cálculo esperto" (aprovado pelo usuário): dado um intervalo [inicio, agora]
 * e o turno da máquina, retornamos apenas os minutos DENTRO do turno. Sem job
 * de cron; o desconto é feito no momento da leitura (painel/quadro/checkout).
 *
 * Centro sem turno (opera 24h) → tempo corrido (não-regressão).
 *
 * Módulo PURO (sem Prisma/IO) para teste isolado com fast-check.
 */

export interface TurnoBasico {
  /** 'HH:MM' (24h local Brasília). */
  horaInicio: string
  /** 'HH:MM' (24h local Brasília). Pode ser < horaInicio (turno que cruza meia-noite). */
  horaFim: string
  /** Dias da semana do turno: 1=segunda ... 7=domingo (padrão do projeto). */
  diasSemana: number[]
}

/** Converte 'HH:MM' em minutos desde 00:00. Inválido → 0. */
function hhmmParaMin(hhmm: string): number {
  const [h, m] = (hhmm || '0:0').split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0
  return h * 60 + m
}

/** Dia da semana no formato do projeto (1=seg..7=dom) para uma data LOCAL (-3h). */
function diaSemanaBrasilia(instante: Date): number {
  const br = new Date(instante.getTime() - 3 * 60 * 60 * 1000)
  const js = br.getUTCDay() // 0=dom..6=sáb (no horário local deslocado)
  return js === 0 ? 7 : js
}

/** Minuto-do-dia LOCAL (Brasília) de um instante (0..1439). */
function minutoDoDiaBrasilia(instante: Date): number {
  const br = new Date(instante.getTime() - 3 * 60 * 60 * 1000)
  return br.getUTCHours() * 60 + br.getUTCMinutes()
}

/** Zera para o início do dia LOCAL (00:00 Brasília) retornando o instante UTC. */
function inicioDoDiaBrasilia(instante: Date): Date {
  const br = new Date(instante.getTime() - 3 * 60 * 60 * 1000)
  br.setUTCHours(0, 0, 0, 0)
  // volta para UTC real somando as 3h
  return new Date(br.getTime() + 3 * 60 * 60 * 1000)
}

/**
 * Minutos de [inicio, fim] que caem DENTRO do turno da máquina.
 *
 * - Sem turno (null) → duração corrida total (não-regressão).
 * - Com turno → soma, dia a dia (data civil local), a interseção do intervalo
 *   com a janela [horaInicio, horaFim] nos diasSemana do turno. Suporta turno
 *   que cruza a meia-noite (horaFim < horaInicio → janela parte em dois:
 *   [horaInicio, 24h) e [0, horaFim]).
 *
 * Determinístico e seguro (limite de 400 dias de varredura).
 */
export function minutosDentroDoTurno(
  inicio: Date,
  fim: Date,
  turno: TurnoBasico | null | undefined,
): number {
  const totalMin = Math.max(0, Math.round((fim.getTime() - inicio.getTime()) / 60000))
  if (!turno || !turno.diasSemana || turno.diasSemana.length === 0) return totalMin
  if (totalMin === 0) return 0

  const ini = hhmmParaMin(turno.horaInicio)
  const fimT = hhmmParaMin(turno.horaFim)
  const cruzaMeiaNoite = fimT <= ini

  // Janelas de minuto-do-dia [a, b) cobertas pelo turno. Para turno normal é uma
  // só; para turno que cruza meia-noite são duas (fim do dia + começo do dia).
  const janelasDoDia: Array<[number, number]> = cruzaMeiaNoite
    ? [[ini, 1440], [0, fimT]]
    : [[ini, fimT]]

  let acumulado = 0
  let cursorDia = inicioDoDiaBrasilia(inicio)
  const fimMs = fim.getTime()
  let guard = 0

  while (cursorDia.getTime() <= fimMs && guard < 400) {
    guard++
    const dia = diaSemanaBrasilia(cursorDia)
    if (turno.diasSemana.includes(dia)) {
      for (const [a, b] of janelasDoDia) {
        // Instantes absolutos da janela neste dia.
        const janInicio = new Date(cursorDia.getTime() + a * 60000)
        const janFim = new Date(cursorDia.getTime() + b * 60000)
        // Interseção com [inicio, fim].
        const lo = Math.max(inicio.getTime(), janInicio.getTime())
        const hi = Math.min(fim.getTime(), janFim.getTime())
        if (hi > lo) acumulado += Math.round((hi - lo) / 60000)
      }
    }
    // Próximo dia civil.
    cursorDia = new Date(cursorDia.getTime() + 24 * 60 * 60 * 1000)
    // Reancora ao 00:00 local (evita deriva por DST — aqui Brasília sem DST).
    cursorDia = inicioDoDiaBrasilia(cursorDia)
  }

  // Nunca exceder o total corrido (defensivo).
  return Math.min(acumulado, totalMin)
}
