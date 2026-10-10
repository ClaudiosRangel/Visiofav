// Consumo de material da OP com o SUPORTE DE PRODUÇÃO — serviço PURO
// (sem dependências de banco; não grava nada; cálculo puro).
//
// Frente C / Task 15 da spec `orcamento-grafico-op-relatorio-paridade` (design §4.3).
//
// Princípio-mestre (design §1.1-c): o consumo da OP é um cálculo INDEPENDENTE do
// custo do orçamento. O orçamento é fechado com o Suporte Orçado e permanece
// imutável (Req 8.2); a OP calcula folhas/kg com o Suporte de Produção (Req 8.1/8.3).
// São dois cálculos sobre a MESMA geometria — só mudam gramatura/dimensão/preço do
// suporte.
//
// IDENTIDADE (Req 8.4): quando o suporte de produção é IDÊNTICO ao orçado, o
// consumo tem de bater EXATAMENTE (até a 2ª casa no custo) com o papel orçado.
// Para garantir isso SEM risco de divergência de arredondamento, este serviço NÃO
// reimplementa a fórmula: delega a `calcularPapel` do motor
// (`orcamento-grafico-calculo.service.ts`), que é a MESMA função que fecha o
// orçamento orçado. Assim a identidade é estrutural (mesmo código), não só numérica.
//
// SEQUÊNCIA DE ARREDONDAMENTO ADOTADA (espelha `calcularPapel` do motor — NÃO a
// reinventa):
//   1. folhasBrutas = ceil((folhas + perdaFixaFolhas) × (1 + perdaPercent/100))
//   2. pesoKg (interno, SEM arredondar) = folhasBrutas × larg(m) × alt(m) × gramatura / 1000
//   3. custo = round(pesoKg_naoArredondado × precoKg, 2 casas)
//   4. pesoKg EXPOSTO = round(pesoKg, 3 casas)
// Observação importante: o motor arredonda o CUSTO a partir do peso NÃO-arredondado
// e expõe o peso com 3 casas. O rascunho inicial da task arredondava o peso a 2
// casas ANTES do custo — isso quebraria a identidade do Req 8.4. Por isso delegamos
// ao motor e espelhamos exatamente a sua sequência.

import { calcularPapel } from './orcamento-grafico-calculo.service'

export interface ParamsConsumo {
  /** Folhas necessárias da geometria/montagem (igual ao orçamento). */
  folhasNecessarias: number
  /** Largura da folha em METROS. */
  larguraFolhaM: number
  /** Altura da folha em METROS. */
  alturaFolhaM: number
  /** Gramatura (g/m²) DO SUPORTE DE PRODUÇÃO. */
  gramatura: number
  /** Preço por kg DO SUPORTE DE PRODUÇÃO. */
  precoKg: number
  /**
   * Perda percentual aplicada às folhas (opcional, default 0). Quando o consumo
   * precisa bater com o papel orçado (Req 8.4), passe a MESMA perda usada no
   * orçamento; omitido = sem perda.
   */
  perdaPercent?: number
  /**
   * Perda fixa em folhas (acerto/setup) (opcional, default 0). Igual acima: para
   * a identidade com o orçado, passe o MESMO valor do orçamento.
   */
  perdaFixaFolhas?: number
}

export interface ResultadoConsumo {
  /** Folhas brutas efetivamente consumidas (com perda e ceil), como no motor. */
  folhas: number
  /** Peso em kg (3 casas decimais — igual ao motor). */
  pesoKg: number
  /** Custo em R$ (2 casas decimais — igual ao motor). */
  custo: number
}

/**
 * Consumo de material da OP com o SUPORTE DE PRODUÇÃO (Req 8.1/8.3).
 *
 * peso(kg) = folhas × largura(m) × altura(m) × gramatura / 1000; custo = peso × preçoKg.
 * Usa a MESMA fórmula/arredondamento de `calcularPapel` do motor — NÃO reinventa
 * (delega a ele). Suporte de produção = orçado → resultado idêntico (2 casas no
 * custo) ao orçado (Req 8.4).
 *
 * Função pura: não grava no item (orçamento orçado preservado, Req 8.2).
 */
export function consumoMaterialOp(p: ParamsConsumo): ResultadoConsumo {
  // `calcularPapel` recebe dimensões em MILÍMETROS (converte /1000 internamente);
  // os params do consumo chegam em METROS, então convertemos de volta para mm
  // antes de delegar, preservando a fórmula exata do motor.
  const r = calcularPapel({
    folhasNecessarias: p.folhasNecessarias,
    larguraMm: p.larguraFolhaM * 1000,
    alturaMm: p.alturaFolhaM * 1000,
    gramaturaGm2: p.gramatura,
    precoKg: p.precoKg,
    perdaPercent: p.perdaPercent ?? 0,
    perdaFixaFolhas: p.perdaFixaFolhas ?? 0,
  })

  return {
    folhas: r.folhasBrutas,
    pesoKg: r.pesoKg, // 3 casas (motor)
    custo: r.custo, // 2 casas (motor)
  }
}
