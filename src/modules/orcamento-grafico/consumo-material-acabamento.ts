/**
 * Consumo de MATERIAL DE ACABAMENTO — paridade com o Calcgraf/G-Print.
 *
 * Módulo PURO que calcula a QUANTIDADE consumida (kg/un) de materiais de
 * acabamento (verniz, cola, caixa). O custo é `consumo × preço`. Decifrado por
 * engenharia reversa do cálculo 15.086 (backup SQL Server CalcgrafCartonWega) +
 * os alvos do pré-cálculo. Ver docs/calcgraf-golden-15086-parametros.md §5.
 *
 * No Calcgraf o motor recebia o PREÇO do material mas o Vizor não calculava a
 * quantidade (variável = 0 → subtotal = 0, −100%). Este módulo fornece a
 * quantidade por natureza, para o acabamento rico (MATERIAL_KG/MATERIAL_UN)
 * entrar corretamente no Material Direto.
 *
 * NATUREZAS suportadas:
 *
 *  • VERNIZ (kg): consumo = áreaImpressaM² × cobertura(0..1) × gramaturaKgM².
 *    A gramatura do verniz (kg/m²) é um parâmetro por material (verniz UV e
 *    primer têm gramaturas levemente distintas). Validado no 15.086:
 *      - Verniz UV   : 3428,64 m² × 0,90 × 0,003000 = 9,257 kg (alvo 9,26) ✓
 *      - Verniz Primer: 3428,64 m² × 1,00 × 0,003220 = 11,040 kg (alvo 11,04) ✓
 *
 *  • COLA (kg): consumo = tiragem × comprimentoColaMm × fatorColaKgPorMmPeca.
 *    A cola de colagem (coladeira AFT70) é proporcional à tiragem e ao
 *    comprimento de aba a colar. Validado no 15.086 (aba 177 mm, 100.000 un):
 *      100000 × 177 × 3,0e-7 = 5,31 kg (alvo 5,31) ✓
 *
 *  • CAIXA (un): consumo = ceil(tiragem / pecasPorCaixa). Caixa de embalagem do
 *    produto acabado. Validado no 15.086: ceil(100000 / 893) = 112 un (alvo 112).
 *    `pecasPorCaixa` é parâmetro da embalagem (default 893 reproduz o 15.086).
 */

export type NaturezaConsumoMatAcab = 'VERNIZ' | 'COLA' | 'CAIXA'

export interface ParamsConsumoVerniz {
  /** Área impressa total em m² (folhas × formato do suporte). */
  areaImpressaM2: number
  /** Cobertura do verniz 0..1 (ex.: UV total 0,90; primer 1,0). */
  cobertura: number
  /** Gramatura do verniz em kg/m² (ex.: 0,003). */
  gramaturaKgM2: number
}

export interface ParamsConsumoCola {
  /** Tiragem (nº de peças coladas). */
  tiragem: number
  /** Comprimento de cola/aba em mm (ex.: 177). */
  comprimentoColaMm: number
  /** Fator de consumo em kg por (mm × peça). Default 3,0e-7 (calibrado 15.086). */
  fatorKgPorMmPeca?: number
}

export interface ParamsConsumoCaixa {
  /** Tiragem (nº de peças a embalar). */
  tiragem: number
  /** Peças por caixa (parâmetro da embalagem). Default 893 (15.086 → 112 un). */
  pecasPorCaixa?: number
}

export const FATOR_COLA_KG_POR_MM_PECA = 3.0e-7
export const PECAS_POR_CAIXA_PADRAO = 893

/** Consumo (kg) de verniz: área × cobertura × gramatura. */
export function consumoVerniz(p: ParamsConsumoVerniz): number {
  const kg = p.areaImpressaM2 * p.cobertura * p.gramaturaKgM2
  return Math.round(kg * 1000) / 1000
}

/** Consumo (kg) de cola: tiragem × comprimento × fator. */
export function consumoCola(p: ParamsConsumoCola): number {
  const fator = p.fatorKgPorMmPeca ?? FATOR_COLA_KG_POR_MM_PECA
  const kg = p.tiragem * p.comprimentoColaMm * fator
  return Math.round(kg * 1000) / 1000
}

/** Consumo (un) de caixa: ceil(tiragem / peçasPorCaixa). */
export function consumoCaixa(p: ParamsConsumoCaixa): number {
  const ppc = p.pecasPorCaixa ?? PECAS_POR_CAIXA_PADRAO
  if (ppc <= 0) return 0
  return Math.ceil(p.tiragem / ppc)
}

/** Dispatcher por natureza (conveniência). Retorna consumo em kg (verniz/cola)
 *  ou un (caixa). */
export function consumoMaterialAcabamento(
  natureza: NaturezaConsumoMatAcab,
  params: ParamsConsumoVerniz | ParamsConsumoCola | ParamsConsumoCaixa,
): number {
  switch (natureza) {
    case 'VERNIZ':
      return consumoVerniz(params as ParamsConsumoVerniz)
    case 'COLA':
      return consumoCola(params as ParamsConsumoCola)
    case 'CAIXA':
      return consumoCaixa(params as ParamsConsumoCaixa)
  }
}
