/**
 * KG fabricado (R7 — spec apontamentos-melhorias-caio, pedido #7 do Caio).
 *
 * Funções PURAS (sem Prisma) para converter produção apontada (em folhas,
 * base TIRAGEM) em KG de papel fabricado. Mesma fórmula de peso usada no
 * orçamento gráfico (`peso = folhas × larguraM × alturaM × gramatura / 1000`),
 * aqui aplicada à PRODUÇÃO real apontada por máquina.
 *
 * Regras (Req 7.2, 7.6):
 * - Resultado SEMPRE >= 0 (nunca NaN/negativo).
 * - Cresce monotonicamente com as folhas.
 * - 0 quando QUALQUER fator essencial (folhas/largura/altura/gramatura) é
 *   0/ausente/inválido — o relatório segue sem o KG daquela máquina em vez
 *   de quebrar.
 */

/** Converte um valor possivelmente nulo/NaN em número finito >= 0 (senão 0). */
function naoNegativoFinito(v: number | null | undefined): number {
  if (v == null) return 0
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n
}

/**
 * KG de papel fabricado para uma produção em FOLHAS.
 *
 * @param folhas quantidade de folhas produzidas (base TIRAGEM)
 * @param larguraMm largura da folha em milímetros
 * @param alturaMm altura da folha em milímetros
 * @param gramatura gramatura do papel em g/m²
 * @returns KG (>= 0); 0 se qualquer fator essencial faltar
 */
export function kgFabricado(
  folhas: number | null | undefined,
  larguraMm: number | null | undefined,
  alturaMm: number | null | undefined,
  gramatura: number | null | undefined,
): number {
  const f = naoNegativoFinito(folhas)
  const larguraM = naoNegativoFinito(larguraMm) / 1000
  const alturaM = naoNegativoFinito(alturaMm) / 1000
  const g = naoNegativoFinito(gramatura)
  if (f === 0 || larguraM === 0 || alturaM === 0 || g === 0) return 0
  // peso (kg) = folhas × área (m²) × gramatura (g/m²) / 1000
  return (f * larguraM * alturaM * g) / 1000
}

/**
 * Extrai largura/altura (mm) de um formato textual do tipo "600 x 910" ou
 * "650x1225" (padrão das tags [Formato]/formatoFolha do Calcgraf). Retorna
 * `null` quando não for possível interpretar.
 */
export function parseFormatoMm(formato: string | null | undefined): { larguraMm: number; alturaMm: number } | null {
  if (!formato) return null
  const m = String(formato).match(/(\d+[.,]?\d*)\s*[xX]\s*(\d+[.,]?\d*)/)
  if (!m) return null
  const larguraMm = Number(m[1].replace(',', '.'))
  const alturaMm = Number(m[2].replace(',', '.'))
  if (!Number.isFinite(larguraMm) || !Number.isFinite(alturaMm)) return null
  return { larguraMm, alturaMm }
}

/**
 * Extrai a gramatura (g/m²) de uma tag/observação do tipo "...222g..." ou
 * "Gramatura 415". Retorna `null` quando não encontrar.
 */
export function parseGramatura(texto: string | null | undefined): number | null {
  if (!texto) return null
  const m = String(texto).match(/(\d{2,4})\s*g(?:\/?m2|ramatura)?/i) ?? String(texto).match(/gramatura[^\d]*(\d{2,4})/i)
  if (!m) return null
  const g = Number(m[1])
  return Number.isFinite(g) && g > 0 ? g : null
}
