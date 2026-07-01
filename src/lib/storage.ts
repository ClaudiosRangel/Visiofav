import path from 'path'
import fs from 'fs'

/**
 * Retorna o diretório base para armazenamento persistente.
 *
 * Em produção (Render com Persistent Disk), usar env PERSISTENT_STORAGE_PATH
 * apontando para o mount path do disco (ex: /var/data).
 *
 * Em desenvolvimento, usa o diretório do projeto.
 */
export function getStorageBase(): string {
  return process.env.PERSISTENT_STORAGE_PATH || process.cwd()
}

/**
 * Retorna o diretório de uploads de PDFs de OPs.
 * Cria o diretório se não existir.
 */
export function getOpsPdfDir(): string {
  const dir = path.join(getStorageBase(), 'uploads', 'ops')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * Retorna o caminho completo do PDF de uma OP específica.
 */
export function getOpPdfPath(opId: string): string {
  return path.join(getOpsPdfDir(), `${opId}.pdf`)
}
