import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadFiscalConfig, resetFiscalConfig } from './config'

describe('fiscal config', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    resetFiscalConfig()
    // Set all required env vars with valid defaults
    process.env.FISCAL_CERT_ENCRYPTION_KEY = 'a'.repeat(32)
    process.env.SEFAZ_AMBIENTE = '2'
    process.env.SEFAZ_TIMEOUT_MS = '30000'
    process.env.CONTINGENCIA_MAX_FILA = '500'
  })

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv }
    resetFiscalConfig()
  })

  describe('FISCAL_CERT_ENCRYPTION_KEY', () => {
    it('loads successfully with 32+ char key', () => {
      process.env.FISCAL_CERT_ENCRYPTION_KEY = 'x'.repeat(64)
      const config = loadFiscalConfig()
      expect(config.FISCAL_CERT_ENCRYPTION_KEY).toBe('x'.repeat(64))
    })

    it('throws when missing', () => {
      delete process.env.FISCAL_CERT_ENCRYPTION_KEY
      expect(() => loadFiscalConfig()).toThrow('FISCAL_CERT_ENCRYPTION_KEY')
    })

    it('throws when shorter than 32 chars', () => {
      process.env.FISCAL_CERT_ENCRYPTION_KEY = 'short'
      expect(() => loadFiscalConfig()).toThrow('32 caracteres')
    })
  })

  describe('SEFAZ_AMBIENTE', () => {
    it('defaults to 2 (homologação) when not set', () => {
      delete process.env.SEFAZ_AMBIENTE
      const config = loadFiscalConfig()
      expect(config.SEFAZ_AMBIENTE).toBe(2)
    })

    it('accepts 1 for produção', () => {
      process.env.SEFAZ_AMBIENTE = '1'
      const config = loadFiscalConfig()
      expect(config.SEFAZ_AMBIENTE).toBe(1)
    })

    it('accepts 2 for homologação', () => {
      process.env.SEFAZ_AMBIENTE = '2'
      const config = loadFiscalConfig()
      expect(config.SEFAZ_AMBIENTE).toBe(2)
    })

    it('throws for invalid value', () => {
      process.env.SEFAZ_AMBIENTE = '3'
      expect(() => loadFiscalConfig()).toThrow('SEFAZ_AMBIENTE')
    })
  })

  describe('SEFAZ_TIMEOUT_MS', () => {
    it('defaults to 30000 when not set', () => {
      delete process.env.SEFAZ_TIMEOUT_MS
      const config = loadFiscalConfig()
      expect(config.SEFAZ_TIMEOUT_MS).toBe(30000)
    })

    it('accepts valid value within range', () => {
      process.env.SEFAZ_TIMEOUT_MS = '60000'
      const config = loadFiscalConfig()
      expect(config.SEFAZ_TIMEOUT_MS).toBe(60000)
    })

    it('throws when below 5000ms', () => {
      process.env.SEFAZ_TIMEOUT_MS = '1000'
      expect(() => loadFiscalConfig()).toThrow('5000')
    })

    it('throws when above 120000ms', () => {
      process.env.SEFAZ_TIMEOUT_MS = '200000'
      expect(() => loadFiscalConfig()).toThrow('120000')
    })
  })

  describe('CONTINGENCIA_MAX_FILA', () => {
    it('defaults to 500 when not set', () => {
      delete process.env.CONTINGENCIA_MAX_FILA
      const config = loadFiscalConfig()
      expect(config.CONTINGENCIA_MAX_FILA).toBe(500)
    })

    it('accepts custom value', () => {
      process.env.CONTINGENCIA_MAX_FILA = '1000'
      const config = loadFiscalConfig()
      expect(config.CONTINGENCIA_MAX_FILA).toBe(1000)
    })

    it('throws when less than 1', () => {
      process.env.CONTINGENCIA_MAX_FILA = '0'
      expect(() => loadFiscalConfig()).toThrow('mínimo 1')
    })
  })

  describe('caching', () => {
    it('caches config after first load', () => {
      const config1 = loadFiscalConfig()
      // Change env after load
      process.env.SEFAZ_AMBIENTE = '1'
      const config2 = loadFiscalConfig()
      // Should still return cached value
      expect(config2.SEFAZ_AMBIENTE).toBe(config1.SEFAZ_AMBIENTE)
    })

    it('reloads after resetFiscalConfig', () => {
      loadFiscalConfig()
      resetFiscalConfig()
      process.env.SEFAZ_AMBIENTE = '1'
      const config = loadFiscalConfig()
      expect(config.SEFAZ_AMBIENTE).toBe(1)
    })
  })
})
