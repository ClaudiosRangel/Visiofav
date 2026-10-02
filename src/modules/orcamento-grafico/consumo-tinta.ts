/**
 * Consumo de TINTA — paridade com o Calcgraf/G-Print.
 *
 * Módulo PURO que reproduz como o Calcgraf calcula o consumo (kg) e o custo de
 * tinta de uma impressão offset. Decifrado por engenharia reversa (memória do
 * pré-cálculo 5355/15185) + a fórmula clássica da indústria gráfica "SPANKS".
 * Ver docs/calcgraf-consumo-tinta.md.
 *
 * MODELO (validado no 15185 com desvio ~1,3% no custo total):
 *
 *   consumoVar_kg = (S × P × A × N × K × D) / CONST_SPANKS
 *     S = CoefTinta do SUPORTE (fator "Stock" do SPANKS; no Calcgraf é
 *         Suportes.CoefTinta — ex. CARTÃO 1,5; KRAFT 2,2; OFFSET 1,6; JORNAL 1,8)
 *     P = fator PROCESSO (offset = 0,5; tipografia = 1,0)
 *     A = ÁREA impressa em m² (folhas × formato do suporte)
 *     N = NÚMERO de lados impressos
 *     K = COBERTURA de tinta (0..1) — Calcgraf: CalculoTintas.areaTinta/100
 *     D = densidade/peso específico da tinta (preto 1,0; process 1,3; etc.)
 *     CONST_SPANKS = 353 (constante clássica da fórmula)
 *
 *   consumoFixo_kg = partidaConsumoKg × cores × ocorrencias
 *     (Calcgraf: parâmetro "Partida de consumo de tinta" = 200 g = 0,2 kg;
 *      é o consumo de arranque/acerto, por cor e por parte do plano)
 *
 *   custo = (consumoFixo_kg + consumoVar_kg) × precoKg
 *
 * NOTA sobre o fator S (Stock): no Calcgraf o `CoefTinta` por tipo de suporte
 * (tabela `DefTipoSuportesxCoefTinta` / `Suportes.CoefTinta`) corresponde EXATO
 * ao fator Stock do SPANKS (KRAFT=2,2=rough cartridge; JORNAL=1,8=newsprint).
 */

export const CONST_SPANKS = 353
export const PARTIDA_CONSUMO_KG_PADRAO = 0.2 // "Partida de consumo de tinta" = 200 g

export interface ParamsConsumoTinta {
  /** Fator Stock = CoefTinta do suporte (ex.: cartão 1,5). */
  coefSuporte: number
  /** Fator processo: 0,5 offset, 1,0 tipografia. */
  fatorProcesso?: number
  /** Área impressa total em m² (folhas × formato do suporte). */
  areaM2: number
  /** Número de lados impressos (frente=1, frente+verso=2). */
  lados: number
  /** Cobertura de tinta 0..1 (ex.: 0,8). */
  cobertura: number
  /** Densidade/peso específico da tinta (preto 1,0; process 1,3; branco 2,0). */
  densidade?: number
  /** Nº de cores (para o consumo fixo/partida). */
  cores: number
  /** Nº de ocorrências/partes do plano que repetem a impressão. */
  ocorrencias?: number
  /** Preço por kg da tinta. */
  precoKg: number
  /** Partida de consumo (kg) — default 0,2 kg (parâmetro do Calcgraf). */
  partidaConsumoKg?: number
}

export interface ResultadoConsumoTinta {
  consumoFixoKg: number
  consumoVarKg: number
  consumoTotalKg: number
  custo: number
}

/** Consumo variável (kg) pela fórmula SPANKS. */
export function consumoVariavelTinta(p: ParamsConsumoTinta): number {
  const P = p.fatorProcesso ?? 0.5
  const D = p.densidade ?? 1.0
  const kg = (p.coefSuporte * P * p.areaM2 * p.lados * p.cobertura * D) / CONST_SPANKS
  return kg
}

/** Consumo fixo/partida (kg): partida × cores × ocorrências. */
export function consumoFixoTinta(p: ParamsConsumoTinta): number {
  const partida = p.partidaConsumoKg ?? PARTIDA_CONSUMO_KG_PADRAO
  const ocor = p.ocorrencias ?? 1
  return partida * p.cores * ocor
}

export function calcularConsumoTinta(p: ParamsConsumoTinta): ResultadoConsumoTinta {
  const consumoFixoKg = consumoFixoTinta(p)
  const consumoVarKg = consumoVariavelTinta(p)
  const consumoTotalKg = consumoFixoKg + consumoVarKg
  const custo = consumoTotalKg * p.precoKg
  return {
    consumoFixoKg: Math.round(consumoFixoKg * 1000) / 1000,
    consumoVarKg: Math.round(consumoVarKg * 1000) / 1000,
    consumoTotalKg: Math.round(consumoTotalKg * 1000) / 1000,
    custo: Math.round(custo * 100) / 100,
  }
}
