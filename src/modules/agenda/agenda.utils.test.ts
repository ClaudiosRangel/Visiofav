import { describe, it, expect, vi, afterEach } from 'vitest'
import { toMinutes, fromMinutes, calcularPermanencia } from './agenda.utils'

describe('toMinutes', () => {
  it('converte "00:00" para 0', () => {
    expect(toMinutes('00:00')).toBe(0)
  })

  it('converte "23:59" para 1439', () => {
    expect(toMinutes('23:59')).toBe(1439)
  })

  it('converte "08:30" para 510', () => {
    expect(toMinutes('08:30')).toBe(510)
  })

  it('converte "12:00" para 720', () => {
    expect(toMinutes('12:00')).toBe(720)
  })

  it('converte "06:15" para 375', () => {
    expect(toMinutes('06:15')).toBe(375)
  })
})

describe('fromMinutes', () => {
  it('converte 0 para "00:00"', () => {
    expect(fromMinutes(0)).toBe('00:00')
  })

  it('converte 1439 para "23:59"', () => {
    expect(fromMinutes(1439)).toBe('23:59')
  })

  it('converte 510 para "08:30"', () => {
    expect(fromMinutes(510)).toBe('08:30')
  })

  it('converte 720 para "12:00"', () => {
    expect(fromMinutes(720)).toBe('12:00')
  })

  it('converte 5 para "00:05" (padding correto)', () => {
    expect(fromMinutes(5)).toBe('00:05')
  })
})

describe('calcularPermanencia', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('retorna diferença em minutos entre agora e horaChegadaReal', () => {
    vi.useFakeTimers()
    const agora = new Date('2025-01-15T10:30:00.000Z')
    vi.setSystemTime(agora)

    const chegada = new Date('2025-01-15T09:00:00.000Z')
    expect(calcularPermanencia(chegada)).toBe(90)
  })

  it('retorna 0 quando chegada é agora', () => {
    vi.useFakeTimers()
    const agora = new Date('2025-01-15T10:00:00.000Z')
    vi.setSystemTime(agora)

    expect(calcularPermanencia(agora)).toBe(0)
  })

  it('arredonda corretamente frações de minuto', () => {
    vi.useFakeTimers()
    // 2 minutos e 31 segundos = 2.517 min → arredonda para 3
    const agora = new Date('2025-01-15T10:02:31.000Z')
    vi.setSystemTime(agora)

    const chegada = new Date('2025-01-15T10:00:00.000Z')
    expect(calcularPermanencia(chegada)).toBe(3)
  })
})
