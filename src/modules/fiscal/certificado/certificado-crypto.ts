import crypto from 'node:crypto'
import { CodigoErroFiscal, ErroFiscal } from '../erros'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16
const KEY_LENGTH = 32

/**
 * Obtém a chave de criptografia a partir da env var FISCAL_CERT_ENCRYPTION_KEY.
 * Se a chave tiver exatamente 32 bytes, usa diretamente.
 * Caso contrário, deriva uma chave de 32 bytes via scrypt com salt fixo.
 */
function getEncryptionKey(): Buffer {
  const envKey = process.env.FISCAL_CERT_ENCRYPTION_KEY

  if (!envKey) {
    throw new ErroFiscal(
      CodigoErroFiscal.CERTIFICADO_NAO_ENCONTRADO,
      'Variável de ambiente FISCAL_CERT_ENCRYPTION_KEY não configurada'
    )
  }

  const keyBuffer = Buffer.from(envKey, 'utf-8')

  if (keyBuffer.length === KEY_LENGTH) {
    return keyBuffer
  }

  // Deriva chave de 32 bytes via scrypt com salt fixo determinístico
  const salt = Buffer.from('visiofab-fiscal-cert-salt', 'utf-8')
  return crypto.scryptSync(keyBuffer, salt, KEY_LENGTH)
}

/**
 * Criptografa um buffer PFX usando AES-256-GCM.
 * Retorna string base64 no formato: base64(iv + authTag + ciphertext)
 */
export function encryptPfx(pfxBuffer: Buffer): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(pfxBuffer), cipher.final()])
  const authTag = cipher.getAuthTag()

  // Formato: iv (16 bytes) + authTag (16 bytes) + ciphertext
  const result = Buffer.concat([iv, authTag, encrypted])
  return result.toString('base64')
}

/**
 * Descriptografa uma string base64 de volta para o buffer PFX original.
 * Espera formato: base64(iv + authTag + ciphertext)
 */
export function decryptPfx(encrypted: string): Buffer {
  const key = getEncryptionKey()
  const data = Buffer.from(encrypted, 'base64')

  const iv = data.subarray(0, IV_LENGTH)
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH)

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

/**
 * Criptografa uma senha (string) usando AES-256-GCM.
 * Retorna string base64 no formato: base64(iv + authTag + ciphertext)
 */
export function encryptSenha(senha: string): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(senha, 'utf-8')),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  const result = Buffer.concat([iv, authTag, encrypted])
  return result.toString('base64')
}

/**
 * Descriptografa uma senha criptografada de volta para string.
 * Espera formato: base64(iv + authTag + ciphertext)
 */
export function decryptSenha(encrypted: string): string {
  const key = getEncryptionKey()
  const data = Buffer.from(encrypted, 'base64')

  const iv = data.subarray(0, IV_LENGTH)
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH)

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return decrypted.toString('utf-8')
}
