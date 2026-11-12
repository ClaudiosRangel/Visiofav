// Mapeador PURO dos planos da FOTO RICA (FotoPlano) para o shape de persistência
// de um plano de item de orçamento (PlanoMapeado).
//
// Spec: orcamento-grafico-planos-fieis-calcgraf (Req 1.2/1.3, 7.1/7.2/7.3).
//
// Contexto: no Calcgraf todo cálculo tem ao menos 1 PLANO (suporte+cores+formato
// +acabamentos). A foto rica de cada cálculo migrado já guarda esses planos em
// `resultado_calculo.planos[]` (FotoPlano). O fluxo de "Puxar Cálculo" não os
// materializava — este mapeador converte a foto em bodies prontos para criar os
// `PlanoCalculoGrafico` do item, SEM recalcular e SEM inventar dado.
//
// Função PURA: não toca banco, não resolve cadastro, não lança. Resiliente a
// campos ausentes/mal formatados (parsing tolerante).

import type { FotoPlano } from './foto-rica.types'

/** Plano derivado da foto, pronto para virar um `PlanoCalculoGrafico`. */
export interface PlanoMapeado {
  nome: string
  /** Nome textual do suporte vindo da foto (o suporteId do cadastro NÃO é
   *  resolvido aqui — fica null; o operador seleciona o suporte na tela). */
  suporteDescricao: string | null
  gramatura: number | null
  numCores: number
  formatoLarguraMm: number | null
  formatoAlturaMm: number | null
  aproveitamento: number | null
  tiragem: number | null
}

/** Converte "123" / "123,5" / "123.5" em número; null quando inválido. */
function parseNumero(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/**
 * Extrai largura×altura de um texto "L x A" (ex.: "284 x 488", "1092 x 887",
 * "284x488"). Aceita separador decimal `.` ou `,`. Retorna `{null, null}` quando
 * o texto não casa (nunca lança).
 */
export function parseFormato(texto: string | null | undefined): {
  largura: number | null
  altura: number | null
} {
  if (!texto) return { largura: null, altura: null }
  const m = String(texto).match(/(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)/i)
  if (!m) return { largura: null, altura: null }
  return { largura: parseNumero(m[1]), altura: parseNumero(m[2]) }
}

/**
 * Deriva o número de cores de um texto no formato "NxM" ou "N/M" (frente×verso),
 * ex.: "2x0", "6x0", "4/0", "7x5". Regra: soma dos dois lados (frente+verso);
 * quando só um lado tem valor > 0, usa o maior. Fallback 0 (nunca lança).
 */
export function parseCores(texto: string | null | undefined): number {
  if (!texto) return 0
  const m = String(texto).match(/(\d+)\s*[x\/]\s*(\d+)/i)
  if (m) {
    const frente = parseInt(m[1], 10) || 0
    const verso = parseInt(m[2], 10) || 0
    const soma = frente + verso
    if (soma > 0) return soma
    return Math.max(frente, verso)
  }
  // Só um número (ex.: "4") → usa direto.
  const unico = String(texto).match(/(\d+)/)
  return unico ? parseInt(unico[1], 10) || 0 : 0
}

/**
 * Mapeia os planos da foto rica para `PlanoMapeado[]`, 1:1 (conservação). Cada
 * plano ausente de nome recebe "Plano N". Campos nulos permanecem nulos.
 */
export function mapearFotoPlanos(
  planos: FotoPlano[] | undefined,
): PlanoMapeado[] {
  if (!Array.isArray(planos)) return []
  return planos.map((p, i) => {
    // Formato aberto é a folha de corte/plano; fallback para formatoCorte.
    const fmt = parseFormato(p.formatoAberto ?? p.formatoCorte)
    const nome =
      typeof p.nome === 'string' && p.nome.trim().length > 0
        ? p.nome.trim()
        : `Plano ${i + 1}`
    return {
      nome,
      suporteDescricao:
        typeof p.suporte === 'string' && p.suporte.trim().length > 0
          ? p.suporte.trim()
          : null,
      gramatura: parseNumero(p.gramatura),
      numCores: parseCores(p.coresFV),
      formatoLarguraMm: fmt.largura,
      formatoAlturaMm: fmt.altura,
      aproveitamento: parseNumero(p.aproveitamento),
      tiragem: parseNumero(p.tiragem),
    }
  })
}
