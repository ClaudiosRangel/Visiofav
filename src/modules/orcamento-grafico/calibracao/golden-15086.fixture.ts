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
export const PENDENTE_TRANSCRICAO = true

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
    // TODO(usuário): transcrever do pré-cálculo 15.086 — subtotal do SUPORTE (papel).
    suporte: { rotulo: 'SUPORTE', alvo: pendente() },
    // TODO(usuário): transcrever do pré-cálculo 15.086 — subtotal da MATRIZ (faca/clichê).
    matriz: { rotulo: 'MATRIZ', alvo: pendente() },
    // TODO(usuário): transcrever do pré-cálculo 15.086 — subtotal da TINTA.
    tinta: { rotulo: 'TINTA', alvo: pendente() },
    // TODO(usuário): transcrever do pré-cálculo 15.086 — subtotal de MAT.ACABAMENTO.
    matAcabamento: { rotulo: 'MAT.ACABAMENTO', alvo: pendente() },
    // TODO(usuário): transcrever do pré-cálculo 15.086 — custo de IMPRESSÃO (CT offset).
    impressao: { rotulo: 'IMPRESSÃO', alvo: pendente() },
    // TODO(usuário): transcrever do pré-cálculo 15.086 — custo de ACABAMENTO (CT).
    acabamento: { rotulo: 'ACABAMENTO', alvo: pendente() },
  },
  totais: {
    // TODO(usuário): transcrever do pré-cálculo 15.086 — Material Direto (MD).
    materialDireto: pendente(),
    // TODO(usuário): transcrever do pré-cálculo 15.086 — Custo de Transformação (CT).
    custoTransformacao: pendente(),
    // TODO(usuário): transcrever do pré-cálculo 15.086 — Serviço Externo.
    servicoExterno: pendente(),
    // TODO(usuário): transcrever do pré-cálculo 15.086 — Custo de Produção (MD+CT+Servex).
    custoProducao: pendente(),
    // TODO(usuário): transcrever do pré-cálculo 15.086 — CEV (%).
    cevPerc: pendente(),
    // TODO(usuário): transcrever do pré-cálculo 15.086 — Total do orçamento.
    total: pendente(),
  },
  margens: [
    // TODO(usuário): transcrever do pré-cálculo 15.086 — Margem 1 (Primeiro Mil / Mil Seguinte).
    { rotulo: 'Margem 1', primeiroMil: pontoPendente(), milSeguinte: pontoPendente() },
    // TODO(usuário): transcrever do pré-cálculo 15.086 — Margem 2 (Primeiro Mil / Mil Seguinte).
    { rotulo: 'Margem 2', primeiroMil: pontoPendente(), milSeguinte: pontoPendente() },
    // TODO(usuário): transcrever do pré-cálculo 15.086 — Margem 3 (Primeiro Mil / Mil Seguinte).
    { rotulo: 'Margem 3', primeiroMil: pontoPendente(), milSeguinte: pontoPendente() },
  ],
  consumoOp: {
    // TODO(usuário): transcrever do pré-cálculo 15.086 — folhas da OP (suporte de produção 234).
    folhas: pendente(),
    // TODO(usuário): transcrever do pré-cálculo 15.086 — peso (kg) da OP (suporte de produção 234).
    pesoKg: pendente(),
    // TODO(usuário): transcrever do pré-cálculo 15.086 — custo do consumo da OP (suporte de produção 234).
    custo: pendente(),
  },
}
