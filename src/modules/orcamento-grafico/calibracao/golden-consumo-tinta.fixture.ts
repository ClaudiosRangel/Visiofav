/**
 * Fixture de calibração do CONSUMO DE TINTA — dado REAL do Calcgraf (memória do
 * pré-cálculo 5355/15185). Tinta "Escala" (process CMYK), suporte Stora/CARTÃO.
 *
 * Memória: TINTA Escala — FIXO 1,60 kg + VAR 12,46 kg = 14,06 kg × 44,0/kg = 618,48.
 * Área impressa = folhas Stora × formato do suporte:
 *   PARTE 01: 10.400 folhas × (0,61 × 0,71) m²
 *   PARTE 02:  5.400 folhas × (0,61 × 0,89) m²
 * Cobertura 80% (CalculoTintas.areaTinta), CoefTinta Stora = 1,5, 4 cores, 2 partes.
 *
 * Ver docs/calcgraf-consumo-tinta.md.
 */

import type { ParamsConsumoTinta } from '../consumo-tinta'

const area =
  10400 * (0.61 * 0.71) + // PARTE 01
  5400 * (0.61 * 0.89) //  PARTE 02

export interface GoldenTinta {
  numero: number
  descricao: string
  params: ParamsConsumoTinta
  consumoFixoReal: number
  consumoVarReal: number
  custoReal: number
  /** tolerância relativa (arredondamento de folhas na memória). */
  tolerancia: number
}

export const GOLDEN_TINTA: GoldenTinta[] = [
  {
    numero: 15185,
    descricao: 'Tinta Escala (CMYK) — Stora/CARTÃO, cobertura 80%, 4 cores, 2 partes',
    params: {
      coefSuporte: 1.5, // CARTÃO
      fatorProcesso: 0.5, // offset
      areaM2: area,
      lados: 1, // 4x0 (só frente)
      cobertura: 0.8,
      densidade: 1.0,
      cores: 4,
      ocorrencias: 2,
      precoKg: 44.0,
      partidaConsumoKg: 0.2,
    },
    consumoFixoReal: 1.6,
    consumoVarReal: 12.46,
    custoReal: 618.48,
    tolerancia: 0.02, // 2% — resíduo do arredondamento de folhas/constante
  },
]
