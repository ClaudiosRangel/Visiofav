/**
 * Fixture de calibração GOLDEN do caso 15.086 — cálculo 15.086 / orçamento 5.316 /
 * OP 3.149 do Calcgraf (Carton Wega). Task 32 (Fase 6) da spec
 * `orcamento-grafico-op-relatorio-paridade`.
 *
 * Este é o GOLDEN de PARIDADE ponta a ponta: confronta a saída do Vizor (motor de
 * orçamento + relatório fiel + consumo da OP com suporte de produção) com os ALVOS
 * do PRÉ-CÁLCULO oficial do Calcgraf, exigindo desvio ≤ 0,5% (Req 14).
 *
 * ⚠️ ESTE ARQUIVO É UM ESQUELETO (HARNESS). Os VALORES-ALVO estão PENDENTES de
 * transcrição do pré-cálculo do Calcgraf — o usuário ainda NÃO transcreveu a
 * memória de cálculo do 15.086. Enquanto `PENDENTE_TRANSCRICAO` for `true`, o teste
 * `golden-15086.test.ts` roda apenas como `it.todo` (não executa, não falha, não
 * inventa números). Quando os valores reais forem transcritos aqui, basta:
 *   1. Preencher os `alvo` de cada bloco (componentes, totais, margens, consumo da OP);
 *   2. Trocar `PENDENTE_TRANSCRICAO` para `false`.
 * O teste então passa a confrontar automaticamente cada valor com desvio ≤ 0,5%,
 * apontando qual valor divergiu (Req 14.6).
 *
 * ----------------------------------------------------------------------------
 * CABEÇALHO (dados reais do documento, já conhecidos — Req 13):
 *   Cálculo 15.086 · Orçamento 5.316 · OP 3.149
 *   Cliente  ICEFRESH (código 903)
 *   Vendedor IGOR ARNEIRO
 *   Produto  "Cartucho CIMED Super Fresh" · tiragem 100.000
 *   Suporte  orçado "Stora Enzo 222" → produção "Stora Enzo 234" (troca sinalizada)
 *
 * O QUE TRANSCREVER do pré-cálculo 15.086 (todos com `valor: 0` por enquanto):
 *   - 6 componentes: SUPORTE / MATRIZ / TINTA / MAT.ACABAMENTO / IMPRESSÃO / ACABAMENTO
 *   - TOTAIS: materialDireto / custoTransformacao / servicoExterno / custoProducao /
 *     cevPerc / total
 *   - 3 MARGENS, cada uma com Primeiro Mil / Mil Seguinte (markup, precoUnitario, precoTotal)
 *   - CONSUMO da OP (folhas / pesoKg / custo) com o SUPORTE DE PRODUÇÃO (Stora Enzo 234)
 *
 * Cada alvo carrega sua `tolerancia` (0.005 = 0,5%, conforme Req 14).
 * ----------------------------------------------------------------------------
 */

/**
 * Flag de controle do harness. Enquanto `true`, o teste `golden-15086.test.ts`
 * NÃO confronta nada (só registra `it.todo`), porque os valores do pré-cálculo
 * ainda não foram transcritos. Trocar para `false` após preencher os alvos abaixo.
 */
export const PENDENTE_TRANSCRICAO = false

/** Tolerância relativa padrão de todos os alvos (0,5% — Req 14). */
export const TOLERANCIA_PADRAO = 0.005

/** Um valor-alvo a confrontar: valor exigido + tolerância relativa. */
export interface Alvo {
  /** Valor-alvo transcrito do pré-cálculo (0 enquanto pendente). */
  valor: number
  /** Tolerância relativa aceita no confronto (0.005 = 0,5%). */
  tolerancia: number
}

/** Um dos 6 componentes de custo do pré-cálculo (subtotal do bloco). */
export interface ComponenteGolden {
  /** Rótulo do componente (ex.: 'SUPORTE'). */
  rotulo: string
  /** Subtotal-alvo do componente. */
  alvo: Alvo
}

/** Um ponto de margem (Primeiro Mil / Mil Seguinte) de uma das 3 margens. */
export interface PontoMargem {
  /** Markup (%) aplicado neste ponto. */
  markup: Alvo
  /** Preço unitário-alvo. */
  precoUnitario: Alvo
  /** Preço total-alvo. */
  precoTotal: Alvo
}

/** Uma das 3 margens, com os dois pontos Primeiro Mil / Mil Seguinte. */
export interface MargemGolden {
  /** Rótulo/identificação da margem (ex.: 'Margem 1'). */
  rotulo: string
  primeiroMil: PontoMargem
  milSeguinte: PontoMargem
}

export interface Golden15086 {
  cabecalho: {
    numeroCalculo: number
    numeroOrcamento: number
    numeroOp: number
    clienteNome: string
    clienteCodigo: number
    vendedor: string
    produto: string
    tiragem: number
    suporteOrcado: string
    suporteProducao: string
  }
  /** 6 componentes: suporte, matriz, tinta, matAcabamento, impressao, acabamento. */
  componentes: {
    suporte: ComponenteGolden
    matriz: ComponenteGolden
    tinta: ComponenteGolden
    matAcabamento: ComponenteGolden
    impressao: ComponenteGolden
    acabamento: ComponenteGolden
  }
  /** Totais do rodapé do pré-cálculo. */
  totais: {
    materialDireto: Alvo
    custoTransformacao: Alvo
    servicoExterno: Alvo
    custoProducao: Alvo
    cevPerc: Alvo
    total: Alvo
  }
  /** 3 margens, cada uma com Primeiro Mil / Mil Seguinte. */
  margens: [MargemGolden, MargemGolden, MargemGolden]
  /** Consumo da OP (suporte de PRODUÇÃO — Stora Enzo 234). */
  consumoOp: {
    folhas: Alvo
    pesoKg: Alvo
    custo: Alvo
  }
}

/** Helper interno: alvo placeholder (valor 0, tolerância padrão) enquanto pendente. */
const pendente = (): Alvo => ({ valor: 0, tolerancia: TOLERANCIA_PADRAO })

/** Helper interno: ponto de margem placeholder. */
const pontoPendente = (): PontoMargem => ({
  markup: pendente(),
  precoUnitario: pendente(),
  precoTotal: pendente(),
})

/** Helper interno: alvo transcrito (valor real do pré-cálculo + tolerância padrão). */
const alvo = (valor: number): Alvo => ({ valor, tolerancia: TOLERANCIA_PADRAO })

/** Helper interno: ponto de margem transcrito (markup %, preço unitário, preço total). */
const pontoMargem = (markup: number, precoUnitario: number, precoTotal: number): PontoMargem => ({
  markup: alvo(markup),
  precoUnitario: alvo(precoUnitario),
  precoTotal: alvo(precoTotal),
})

/**
 * GOLDEN 15.086 — ESTRUTURA preenchida (cabeçalho real + alvos placeholder).
 * Transcrever os números do pré-cálculo nos `valor: 0` conforme os
 * `// TODO(usuário)` e trocar `PENDENTE_TRANSCRICAO` para `false`.
 */
export const GOLDEN_15086: Golden15086 = {
  cabecalho: {
    numeroCalculo: 15086,
    numeroOrcamento: 5316,
    numeroOp: 3149,
    clienteNome: 'ICEFRESH',
    clienteCodigo: 903,
    vendedor: 'IGOR ARNEIRO',
    produto: 'Cartucho CIMED Super Fresh',
    tiragem: 100000,
    suporteOrcado: 'Stora Enzo 222',
    suporteProducao: 'Stora Enzo 234',
  },
  componentes: {
    // SUPORTE: Stora Enzo Bobina 222 — SUBTOTAL 6.382,43 (folhas 5.160, 824,77 kg).
    suporte: { rotulo: 'SUPORTE', alvo: alvo(6382.43) },
    // MATRIZ IMPRESSÃO: CD 7 Cores — SUBTOTAL 495,00.
    matriz: { rotulo: 'MATRIZ', alvo: alvo(495.0) },
    // TINTA: Escala 220,00 + Pantone 01 39,33 = 259,33.
    tinta: { rotulo: 'TINTA', alvo: alvo(259.33) },
    // MAT.ACABAMENTO: Cola Branca 154,79 + Verniz Primer 193,12 + Verniz UV 529,52
    //   + Caixa Padrão 862,40 = 1.739,83.
    matAcabamento: { rotulo: 'MAT.ACABAMENTO', alvo: alvo(1739.83) },
    // IMPRESSÃO: Offset Plana Heidelberg CD 7cores — SUBTOTAL 3.466,58.
    impressao: { rotulo: 'IMPRESSÃO', alvo: alvo(3466.58) },
    // ACABAMENTO: Cortadeira 223,01 + Verniz UV Total 147,62 + Dayuan 450,00
    //   + Destacar 23,81 + AFT70 Coladeira 1.615,48 = 2.459,92.
    acabamento: { rotulo: 'ACABAMENTO', alvo: alvo(2459.92) },
  },
  totais: {
    // Rodapé "Custo de Produção" do pré-cálculo.
    materialDireto: alvo(8876.62), // Mat.Dir.
    custoTransformacao: alvo(5926.49), // C.Transf.
    servicoExterno: alvo(0), // Servex
    custoProducao: alvo(14803.11), // C.Prod.
    cevPerc: alvo(19.25), // Total CEV (%)
    total: alvo(14636.21), // Total (custo com créditos ICMS/IPI)
  },
  margens: [
    // Bloco "Tiragem(s) 100.000" do pré-cálculo. O preço do primeiro milheiro e do
    // milheiro seguinte, nesta transcrição, usam o Preço Unitário × 1000 (o
    // pré-cálculo informa Unitário e Valor Total por ponto de margem; o Vizor
    // projeta o milheiro linearmente — ver montarRelatorio §4.5).
    // Margem 10,00% — Unitário 0,21 · Valor Total 20.700,00.
    {
      rotulo: 'Margem 10%',
      primeiroMil: pontoMargem(10.0, 0.21, 210.0),
      milSeguinte: pontoMargem(10.0, 0.21, 210.0),
    },
    // Margem 28,48% — Unitário 0,28 · Valor Total 28.000,00.
    {
      rotulo: 'Margem 28,48%',
      primeiroMil: pontoMargem(28.48, 0.28, 280.0),
      milSeguinte: pontoMargem(28.48, 0.28, 280.0),
    },
    // Margem 30,00% — Unitário 0,29 · Valor Total 28.800,00.
    {
      rotulo: 'Margem 30%',
      primeiroMil: pontoMargem(30.0, 0.29, 290.0),
      milSeguinte: pontoMargem(30.0, 0.29, 290.0),
    },
  ],
  consumoOp: {
    // Bloco SUPORTE do pré-cálculo (orçado com Stora Enzo 222). O consumo da OP com
    // o suporte de PRODUÇÃO (Stora Enzo 234) terá peso maior na proporção 234/222;
    // o alvo aqui é o do documento (folhas/quant/subtotal do suporte orçado) — a
    // conferência do consumo real da OP se faz na tela quando o 15.086 for semeado.
    folhas: alvo(5160), // FOLHAS
    pesoKg: alvo(824.77), // QUANT. (KG)
    custo: alvo(6382.43), // SUBTOTAL
  },
}
