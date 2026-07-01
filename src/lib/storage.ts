import path from 'path'
import fs from 'fs'
import { prisma } from './prisma'

/**
 * Retorna o diretório base para armazenamento local (fallback).
 * Em produção com Persistent Disk, usar env PERSISTENT_STORAGE_PATH.
 * Mas a estratégia principal agora é o banco de dados.
 */
function getStorageBase(): string {
  return process.env.PERSISTENT_STORAGE_PATH || process.cwd()
}

/**
 * Retorna o diretório de uploads de PDFs de OPs (fallback local).
 */
function getLocalOpsPdfDir(): string {
  const dir = path.join(getStorageBase(), 'uploads', 'ops')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * Salva o PDF de uma OP no banco de dados (e opcionalmente no disco local como cache).
 */
export async function salvarOpPdf(opId: string, buffer: Buffer): Promise<void> {
  await prisma.ordemProducao.update({
    where: { id: opId },
    data: { pdfData: buffer },
  })

  // Salvar também no disco como cache (não obrigatório, mas acelera leitura)
  try {
    const dir = getLocalOpsPdfDir()
    fs.writeFileSync(path.join(dir, `${opId}.pdf`), buffer)
  } catch {
    // Ignorar erro de escrita no disco — o banco é a fonte primária
  }
}

/**
 * Carrega o PDF de uma OP. Tenta disco local primeiro (cache), depois banco.
 * Retorna null se não encontrar em nenhum dos dois.
 */
export async function carregarOpPdf(opId: string): Promise<Buffer | null> {
  // Tentar disco local primeiro (cache rápido)
  const localPath = path.join(getLocalOpsPdfDir(), `${opId}.pdf`)
  if (fs.existsSync(localPath)) {
    return fs.readFileSync(localPath)
  }

  // Buscar no banco
  const op = await prisma.ordemProducao.findUnique({
    where: { id: opId },
    select: { pdfData: true },
  })

  if (op?.pdfData) {
    // Restaurar cache local para próximas leituras
    try {
      const dir = getLocalOpsPdfDir()
      fs.writeFileSync(path.join(dir, `${opId}.pdf`), op.pdfData)
    } catch {
      // Ignorar
    }
    return Buffer.from(op.pdfData)
  }

  return null
}

/**
 * Verifica se uma OP possui PDF salvo (banco ou disco).
 */
export async function opTemPdf(opId: string): Promise<boolean> {
  // Check disco local primeiro
  const localPath = path.join(getLocalOpsPdfDir(), `${opId}.pdf`)
  if (fs.existsSync(localPath)) return true

  // Check banco
  const op = await prisma.ordemProducao.findUnique({
    where: { id: opId },
    select: { pdfData: true },
  })
  return op?.pdfData !== null && op?.pdfData !== undefined
}

/**
 * Remove o PDF de uma OP (banco + disco).
 */
export async function removerOpPdf(opId: string): Promise<void> {
  await prisma.ordemProducao.update({
    where: { id: opId },
    data: { pdfData: null },
  })

  const localPath = path.join(getLocalOpsPdfDir(), `${opId}.pdf`)
  if (fs.existsSync(localPath)) {
    fs.unlinkSync(localPath)
  }
}

// =====================================================================
// Funções legadas (backward compat) — usadas em alguns imports diretos
// =====================================================================

/** @deprecated Use salvarOpPdf / carregarOpPdf */
export function getOpsPdfDir(): string {
  return getLocalOpsPdfDir()
}

/** @deprecated Use carregarOpPdf */
export function getOpPdfPath(opId: string): string {
  return path.join(getLocalOpsPdfDir(), `${opId}.pdf`)
}
