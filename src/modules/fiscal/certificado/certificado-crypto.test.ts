import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { encryptPfx, decryptPfx, encryptSenha, decryptSenha } from './certificado-crypto'
import { ErroFiscal } from '../erros'

describe('certificado-crypto', () => {
  const originalEnv = process.env.FISCAL_CERT_ENCRYPTION_KEY

  beforeEach(() => {
    // Chave de 32 bytes para testes
    process.env.FISCAL_CERT_ENCRYPTION_KEY = 'a'.repeat(32)
  })

  afterEach(() => {
    process.env.FISCAL_CERT_ENCRYPTION_KEY = originalEnv
  })

  describe('encryptPfx / decryptPfx', () => {
    it('round-trip: encrypts and decrypts PFX buffer correctly', () => {
      const pfx = Buffer.from('fake-pfx-content-for-testing-purposes', 'utf-8')
      const encrypted = encryptPfx(pfx)
      const decrypted = decryptPfx(encrypted)

      expect(decrypted).toEqual(pfx)
    })

    it('returns base64 string on encrypt', () => {
      const pfx = Buffer.from('test-data', 'utf-8')
      const encrypted = encryptPfx(pfx)

      // Should be valid base64
      expect(() => Buffer.from(encrypted, 'base64')).not.toThrow()
      // Should contain iv (16) + authTag (16) + ciphertext (>= 1 byte)
      const data = Buffer.from(encrypted, 'base64')
      expect(data.length).toBeGreaterThan(32)
    })

    it('produces different ciphertext each time (random IV)', () => {
      const pfx = Buffer.from('same-data', 'utf-8')
      const enc1 = encryptPfx(pfx)
      const enc2 = encryptPfx(pfx)

      expect(enc1).not.toBe(enc2)
    })

    it('handles empty buffer', () => {
      const pfx = Buffer.alloc(0)
      const encrypted = encryptPfx(pfx)
      const decrypted = decryptPfx(encrypted)

      expect(decrypted).toEqual(pfx)
    })

    it('handles large buffer (simulating real PFX file)', () => {
      const pfx = Buffer.alloc(4096, 0xAB)
      const encrypted = encryptPfx(pfx)
      const decrypted = decryptPfx(encrypted)

      expect(decrypted).toEqual(pfx)
    })
  })

  describe('encryptSenha / decryptSenha', () => {
    it('round-trip: encrypts and decrypts password correctly', () => {
      const senha = 'minhaSenhaSecreta123!@#'
      const encrypted = encryptSenha(senha)
      const decrypted = decryptSenha(encrypted)

      expect(decrypted).toBe(senha)
    })

    it('produces different ciphertext each time (random IV)', () => {
      const senha = 'same-password'
      const enc1 = encryptSenha(senha)
      const enc2 = encryptSenha(senha)

      expect(enc1).not.toBe(enc2)
    })

    it('handles empty string', () => {
      const senha = ''
      const encrypted = encryptSenha(senha)
      const decrypted = decryptSenha(encrypted)

      expect(decrypted).toBe(senha)
    })

    it('handles special characters and UTF-8', () => {
      const senha = 'São Paulo ñ ü @#$%^&*()_+ 日本語'
      const encrypted = encryptSenha(senha)
      const decrypted = decryptSenha(encrypted)

      expect(decrypted).toBe(senha)
    })
  })

  describe('key derivation', () => {
    it('works with key shorter than 32 bytes (derives via scrypt)', () => {
      process.env.FISCAL_CERT_ENCRYPTION_KEY = 'short-key'
      const pfx = Buffer.from('test-data', 'utf-8')
      const encrypted = encryptPfx(pfx)
      const decrypted = decryptPfx(encrypted)

      expect(decrypted).toEqual(pfx)
    })

    it('works with key longer than 32 bytes (derives via scrypt)', () => {
      process.env.FISCAL_CERT_ENCRYPTION_KEY = 'b'.repeat(64)
      const senha = 'teste'
      const encrypted = encryptSenha(senha)
      const decrypted = decryptSenha(encrypted)

      expect(decrypted).toBe(senha)
    })

    it('uses key directly when exactly 32 bytes', () => {
      process.env.FISCAL_CERT_ENCRYPTION_KEY = 'x'.repeat(32)
      const senha = 'teste'
      const encrypted = encryptSenha(senha)
      const decrypted = decryptSenha(encrypted)

      expect(decrypted).toBe(senha)
    })
  })

  describe('error handling', () => {
    it('throws ErroFiscal when FISCAL_CERT_ENCRYPTION_KEY is not set', () => {
      delete process.env.FISCAL_CERT_ENCRYPTION_KEY

      expect(() => encryptPfx(Buffer.from('test'))).toThrow(ErroFiscal)
      expect(() => decryptPfx('dGVzdA==')).toThrow(ErroFiscal)
      expect(() => encryptSenha('test')).toThrow(ErroFiscal)
      expect(() => decryptSenha('dGVzdA==')).toThrow(ErroFiscal)
    })

    it('throws when decrypting tampered data (auth tag validation)', () => {
      const encrypted = encryptPfx(Buffer.from('test-data'))
      // Tamper with the base64 data
      const data = Buffer.from(encrypted, 'base64')
      data[20] = data[20] ^ 0xFF // Flip a bit in the auth tag area
      const tampered = data.toString('base64')

      expect(() => decryptPfx(tampered)).toThrow()
    })
  })
})
