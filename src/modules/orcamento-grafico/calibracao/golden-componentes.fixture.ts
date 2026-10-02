/**
 * Fixtures de calibração de COMPONENTES de custo (Nível B) — dados REAIS do
 * Calcgraf (pré-cálculos reais, docs/calcgraf-golden-cases-precalculo.md).
 *
 * Validam que o motor do Vizor reproduz, componente a componente, o custo que
 * o Calcgraf calcula. Começamos pelo PAPEL (≈70% do Material Direto) — o maior
 * e mais sensível. Fórmula do papel (Vizor `calcularPapel`):
 *   peso(kg) = folhas × (larguraM × alturaM × gramatura) / 1000
 *   custo    = peso × precoKg
 *
 * CodAgrupamento do Calcgraf: 1=Custo de Transformação, 2=Materiais Diretos,
 * 3=Serviços Externos (tabela `Agrupamentos`).
 */

export interface GoldenPapel {
  descricao: string
  folhas: number
  formatoLarguraMm: number
  formatoAlturaMm: number
  gramatura: number
  precoKg: number
  // Alvos reais do Calcgraf
  pesoKgReal: number
  subtotalReal: number
}

export const GOLDEN_PAPEL: GoldenPapel[] = [
  // Caso 1 (GRANVITA 5.371) — plano Cartão, suporte Stora Enzo Bobina 199
  {
    descricao: 'Stora Enzo Bobina 199 — 620x920, 50.000 folhas',
    folhas: 50000,
    formatoLarguraMm: 620,
    formatoAlturaMm: 920,
    gramatura: 199,
    precoKg: 7.73839,
    pesoKgReal: 5675.48,
    subtotalReal: 43919.08,
  },
  // Caso 1 — plano Cartão (M), suporte Micro Pardo Formato 280
  {
    descricao: 'Micro Pardo Formato 280 — 610x910, 50.000 folhas',
    folhas: 50000,
    formatoLarguraMm: 610,
    formatoAlturaMm: 910,
    gramatura: 280,
    precoKg: 8.66745,
    pesoKgReal: 7771.40,
    subtotalReal: 67368.22,
  },
  // Caso 2 (GRANVITA 5.369) — Stora Enzo Bobina 199, 670x890
  {
    descricao: 'Stora Enzo Bobina 199 — 670x890, 50.000 folhas',
    folhas: 50000,
    formatoLarguraMm: 670,
    formatoAlturaMm: 890,
    gramatura: 199,
    precoKg: 7.73839,
    pesoKgReal: 5933.18,
    subtotalReal: 45913.30,
  },
]
