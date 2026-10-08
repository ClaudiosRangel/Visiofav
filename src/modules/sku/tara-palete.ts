/**
 * Tara (peso próprio) do palete por tipo — Ocorrência 5 do "3 - Relatório de
 * Ocorrências e Ajustes".
 *
 * O relatório pede incluir o peso da tara do palete (25–60 kg conforme o tipo)
 * no cálculo da capacidade de suporte da porta-paletes, para não estourar o
 * limite da estrutura. Estes são defaults razoáveis de mercado por tipo; o SKU
 * pode informar `pesoPalete` manual (peso do palete montado, que já embute a
 * tara) — nesse caso o manual tem prioridade.
 *
 * Códigos alinhados com o seletor do frontend (`SkuPanel` TIPOS_PALETE):
 * PBR, CHEP, PER, FER, DESCARTAVEL.
 */

export const TARA_PALETE_PADRAO_KG = 25

const TARAS_POR_TIPO: Record<string, number> = {
  PBR: 25, // Palete Padrão Brasil (1,00 × 1,20 m) — madeira
  CHEP: 30, // Palete azul locado (CHEP)
  PER: 35, // Palete retornável
  FER: 40, // Palete de madeira (fixo), mais robusto
  DESCARTAVEL: 10, // Palete descartável (mais leve)
}

/**
 * Retorna a tara (kg) para o tipo de palete informado. Tipo desconhecido/ausente
 * cai no padrão. A comparação é case-insensitive e tolera espaços.
 */
export function taraPalete(tipoPalete: string | null | undefined): number {
  if (!tipoPalete) return TARA_PALETE_PADRAO_KG
  const chave = String(tipoPalete).trim().toUpperCase()
  return TARAS_POR_TIPO[chave] ?? TARA_PALETE_PADRAO_KG
}
