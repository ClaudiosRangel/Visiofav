import { describe, it, expect } from 'vitest'
import { CONFIG_PUTAWAY_DEFAULT } from './wms-putaway-config'

describe('wms-putaway-config — defaults de mercado', () => {
  it('put-away incompleto bloqueia por default (não deixa mercadoria sem destino)', () => {
    expect(CONFIG_PUTAWAY_DEFAULT.politicaIncompleto).toBe('BLOQUEAR')
  })

  it('overflow tem teto físico default (nunca capacidade infinita)', () => {
    expect(CONFIG_PUTAWAY_DEFAULT.overflowCapacidadePadrao).toBeGreaterThan(0)
  })

  it('varredura de 3 prédios por lado (RF008.7) e ABC desligado por default', () => {
    expect(CONFIG_PUTAWAY_DEFAULT.prediosVarreduraPorLado).toBe(3)
    expect(CONFIG_PUTAWAY_DEFAULT.usarClasseAbc).toBe(false)
  })
})
