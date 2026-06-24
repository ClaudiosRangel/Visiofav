/**
 * Utilitários de conversão de tempo para o módulo Agenda.
 * Funções puras para manipulação de horários no formato "HH:mm" e minutos do dia.
 */

/**
 * Converte uma string "HH:mm" para inteiro representando minutos desde 00:00.
 *
 * @param hora - String no formato "HH:mm" (ex: "08:30")
 * @returns Inteiro no intervalo [0, 1439]
 *
 * @precondition hora deve estar no formato "HH:mm" com HH em [00,23] e mm em [00,59]
 * @postcondition toMinutes(fromMinutes(n)) === n para todo n em [0, 1439]
 */
export function toMinutes(hora: string): number {
  const [h, m] = hora.split(':').map(Number)
  return h * 60 + m
}

/**
 * Converte um inteiro de minutos desde 00:00 para string "HH:mm".
 *
 * @param minutos - Inteiro no intervalo [0, 1439]
 * @returns String no formato "HH:mm" (ex: "08:30")
 *
 * @precondition minutos é inteiro no intervalo [0, 1439]
 * @postcondition fromMinutes(toMinutes(s)) === s para toda string válida s
 */
export function fromMinutes(minutos: number): string {
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Calcula a permanência em minutos entre a hora de chegada real e o momento atual.
 *
 * @param horaChegadaReal - Timestamp de quando o veículo chegou à doca
 * @returns Diferença em minutos (arredondada) entre agora e horaChegadaReal
 */
export function calcularPermanencia(horaChegadaReal: Date): number {
  const agora = new Date()
  return Math.round((agora.getTime() - horaChegadaReal.getTime()) / 60000)
}
