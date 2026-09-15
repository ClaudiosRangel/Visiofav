/**
 * Vizor AI (D2) — cache temporário de documento financeiro pendente de
 * lançamento. Espelha `ai-xml-pendente.ts`: guarda os campos extraídos (não o
 * arquivo bruto) por empresa, para a confirmação seguinte do usuário.
 * TTL 30 min. Buffer de conversação, não storage.
 */
import type { CamposDocumento } from './extrair-campos-documento'

export interface DocPendente extends CamposDocumento {
  tipo: 'pagar' | 'receber'
  descricaoSugerida?: string
  textoOriginal?: string
}

interface Entry {
  dados: DocPendente
  criadoEm: number
}

const TTL_MS = 30 * 60 * 1000
const cache = new Map<string, Entry>()

function limparExpirados() {
  const agora = Date.now()
  for (const [k, e] of cache) if (agora - e.criadoEm > TTL_MS) cache.delete(k)
}

export function salvarDocPendente(empresaId: string, dados: DocPendente): void {
  limparExpirados()
  cache.set(empresaId, { dados, criadoEm: Date.now() })
}

export function obterDocPendente(empresaId: string): DocPendente | null {
  limparExpirados()
  return cache.get(empresaId)?.dados ?? null
}

export function limparDocPendente(empresaId: string): void {
  cache.delete(empresaId)
}
