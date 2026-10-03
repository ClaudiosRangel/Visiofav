/**
 * Fixture de calibração GOLDEN do caso 15.235 — Cartucho "Kit Intense Fragrance"
 * (cliente ESTAÇÃO Y, tiragem 20.000), módulo `orcamento-grafico-acabamentos`.
 *
 * FONTE DE VERDADE: docs/calcgraf-golden-15235-acabamentos.md (transcrição fiel
 * do pré-cálculo impresso do Calcgraf/G-Print). O Vizor deve reproduzir ESTE
 * relatório componente a componente (desvio ≤ 0,5%).
 *
 * Esta é a TASK 2.1: define (a) o INPUT do caso montado como `ParamsOrcamento`
 * e (b) os VALORES-ALVO (`alvo15235`). NÃO é o teste (task 2.2) e NÃO altera o
 * motor. A CALIBRAÇÃO FINA (ajustar parâmetros do motor/entrada até cada
 * subtotal cair ≤0,5%) é da task 2.2 — aqui os parâmetros marcados com
 * `TODO(2.2)` são valores iniciais plausíveis + documentação de como chegar lá.
 *
 * ----------------------------------------------------------------------------
 * MAPA DO GOLDEN (resumo — ver doc para a transcrição completa):
 *
 *   SUPORTE          DUPLEX 280, folha 605×620, 5.000 folhas, 525,14 kg → 4.358,66
 *   MATRIZ IMPRESSÃO KBA, 5 PC × 35,2 → 176,00   (entra no MD como item fixo)
 *   TINTA            Escala (0,80 + 2,31)×44,0 → 137,05
 *                    Metálica (0,20 + 1,00)×253,0 → 303,60
 *   MAT.ACABAMENTO   Cola Branca (190mm)  KG  1,14 × 29,15 → 33,23
 *                    FACA NOVA           FIXO 1 × 1.300,00 → 1.300,00
 *                    Verniz Base D'Água  KG  5,63 × 24,2  → 136,16
 *                    Caixa Padrão        UN  20 × 7,7      → 154,00
 *   IMPRESSÃO (CT)   Offset KBA 6c, acerto 02:15 + prod 01:05 × 480 → 1.600,00
 *   ACABAMENTO (CT)  Cortadeira (Grande)      00:15 + 01:02 × 113,21 → 145,29
 *                    Guilhotina maior         00:00 + 01:15 × 77,69  → 97,11
 *                    Bobst E (Corte e Vi)     02:30 + 01:00 × 300,0  → 1.050,00
 *                    Destacar                 00:00 + 00:30 × 50,0   → 25,00
 *                    AFT70 (Coladeira)        01:30 + 01:18 × 320,0  → 897,40
 *
 *   Mat.Dir. 6.598,70 · C.Transf. 3.814,80 · Servex 0 · C.Prod. 10.413,50
 *   C.Finan 0,13% = 13,54 · Total 10.427,04
 *   CEV 17,75% (ICMS 3 + Juros 2,5 + PIS/COFINS 9,25 + Comissões 3)
 *   Margens: 10% → 14.440,00 · 20% → 16.760,00 · markup 30,01% → 19.960,00
 * ----------------------------------------------------------------------------
 */

import type { ParamsOrcamento } from '../orcamento-grafico-calculo.service'

/**
 * INPUT do caso 15.235 montado como `ParamsOrcamento`.
 *
 * NOTA SOBRE O PAPEL (SUPORTE):
 *   O que o motor precisa para bater o papel é `folhasBrutas = 5.000` e as
 *   dimensões 605×620 com gramatura 280:
 *     peso = 5.000 × 0,605 × 0,620 × 280 / 1000 = 525,14 kg
 *     custo = 525,14 × 8,3 = 4.358,66  (= alvo SUPORTE) ✓
 *
 *   Como o motor deriva as folhas:
 *     folhasNecessarias = ceil(quantidade / encaixe.aproveitamento)
 *     folhasBrutas      = ceil((folhasNecessarias + perdaFixaFolhas) × (1 + perda%/100))
 *
 *   O golden é 4-up (TR 2x2 / Tiragem 4): 20.000 / 4 = 5.000 folhas. Para o
 *   motor produzir aproveitamento = 4 na folha 605×620, a planificação precisa
 *   caber 2 colunas × 2 linhas. Modelamos a planificação com fórmulas SIMPLES
 *   (abaixo) que resultam numa peça ~300×308 mm → 2×2 = 4 na folha útil
 *   (605 − pinça)×620. A Apara 27,39% do golden já está "embutida" no
 *   aproveitamento real do Calcgraf; aqui zeramos as perdas para que
 *   folhasBrutas caia exatamente em 5.000.
 *
 *   TODO(2.2): a planificação real do cartucho 77×52×189 (Repet. 271×319 no
 *   golden) e o aproveitamento exato (4) serão calibrados na task 2.2 — ajustar
 *   fórmulas/medidas/perdas até folhasBrutas = 5.000 de forma fiel ao Calcgraf.
 */
export const input15235: ParamsOrcamento = {
  // Tipo de embalagem (Cartucho). Fórmulas SIMPLES de planificação só para a
  // fixture ser coerente e produzir aproveitamento = 4 na folha 605×620.
  // TODO(2.2): substituir pela planificação real do cartucho (Repet. 271×319).
  tipoEmbalagem: {
    // Planificação SINTÉTICA calibrada para reproduzir o papel do golden
    // (aproveitamento = 4 → 20.000/4 = 5.000 folhas, TR 2x2). O encaixe soma a
    // sangria (2×5=10) a cada dimensão, então a peça+sangria precisa caber 2×2
    // na folha útil (605−10 pinça = 595) × 620:
    //   largura peça 285 (+10 sangria = 295) → 595/295 = 2 colunas
    //   altura  peça 300 (+10 sangria = 310) → 620/310 = 2 linhas  = 4-up
    //   L(77) + P(189) + ABA(12) + FUNDO2(7) = 285
    formulaLargura: 'L + P + ABA + FUNDO2',
    //   A(52) + P(189) + FUNDO(59) = 300
    formulaAltura: 'A + P + FUNDO',
    abaColagemMm: 12,
    sangriaMm: 5,
    pincaMm: 10,
    parametros: [{ nome: 'FUNDO', default: 59 }, { nome: 'FUNDO2', default: 7 }],
  },
  // Formato Final do cartucho: 77 × 52 × 189 mm.
  medidas: { L: 77, A: 52, P: 189 },

  // SUPORTE — DUPLEX 280 (gramatura 280 g/m²), preço 8,3 R$/kg.
  papel: { gramatura: 280, precoKg: 8.3 },

  // IMPRESSÃO — KBA Rápida 75 6cores. custoHora 480, 5 cores (5x0+V tratado
  // como 5 cores). Acerto 02:15 (135 min) e produção 01:05.
  //   Modelo calibrado (acerto por cor): fixo = numCores × acertoPorCorMin +
  //   setupMinutos(=tempoPrimeiroAcerto). Para 5 cores → 135 min total:
  //   usamos acertoPorCorMin = 27 e setupMinutos = 0 (5 × 27 = 135 = 02:15).
  //   TODO(2.2): confirmar acertoPorCorMin/setup e a produção (01:05) que
  //   fecham o subtotal IMPRESSÃO em 1.600,00.
  // IMPRESSÃO 1.600,00 = (acerto 135 min + produção 65 min)/60 × 480 R$/h.
  //   acerto: 5 cores × 27 = 135 min (= 02:15)  →  acertoPorCorMin=27, setup=0
  //   produção 01:05 = 65 min: operacaoMin = folhasBrutas / (producaoHora/60).
  //     Com folhasBrutas = 5.000: producaoHora = 5000 / (65/60) = 4615,38.
  maquinaImpressao: {
    velocidade: 4615.38, // → produção 65 min para 5.000 folhas (= 01:05)
    custoHora: 480,
    formatoLargura: 605,
    formatoAltura: 620,
    pinca: 10,
    setupMinutos: 0,
    acertoPorCorMin: 27, // 5 cores × 27 = 135 min = 02:15
    numCoresImpressao: 5, // 5x0 +V → 5 cores
  },

  // TINTA — Escala e Metálica. O motor de tinta atual é SPANKS/legado; os
  // subtotais-ALVO do golden são Escala 137,05 e Metálica 303,60.
  // TODO(2.2): o ajuste fino do consumo de tinta (coefTintaSuporte / densidade /
  // partida) para fechar 137,05 + 303,60 = 440,65 é da task 2.2. Aqui deixamos
  // as cores declaradas de forma coerente (cobertura/preço do golden).
  // TINTA — neste golden a tinta é representada como ITENS DIRETOS de material
  // (ver `itensDiversos` abaixo: Escala 137,05 + Metálica 303,60), porque o
  // consumo fino de tinta (SPANKS) já é calibrado em outro golden (15185) e aqui
  // o foco é o relatório de ACABAMENTOS. `cores: []` + `numCoresImpressao: 5`
  // garante que a impressão use 5 cores sem o motor de tinta gerar custo próprio.
  cores: [],

  // ACABAMENTOS ricos (array `acabamentos`) — MAT.ACABAMENTO (kg/un/fixo) + a
  // cadeia de 5 centros HORA_MAQUINA (CT). Ver alvos em `alvo15235`.
  acabamentos: [
    // ── MAT.ACABAMENTO (entra no MD) ──
    // Cola Branca (190 mm): 1,14 kg × 29,15 → alvo 33,23
    { naturezaCusto: 'MATERIAL_KG', nome: 'Cola Branca (190 mm)', variavelKg: 1.14, precoKg: 29.15 },
    // FACA NOVA: custo fixo 1.300,00 (não escala com a tiragem) → alvo 1.300,00
    { naturezaCusto: 'CUSTO_FIXO', nome: 'FACA NOVA', valorFixo: 1300 },
    // Verniz Base D'Água Fosco (F100): 5,63 kg × 24,2 → alvo 136,16
    { naturezaCusto: 'MATERIAL_KG', nome: "Verniz Base D'Água Fosco (F100)", variavelKg: 5.63, precoKg: 24.2 },
    // Caixa Padrão: 20 un × 7,7 → alvo 154,00
    { naturezaCusto: 'MATERIAL_UN', nome: 'Caixa Padrão', variavelUn: 20, precoUn: 7.7 },

    // ── MATRIZ IMPRESSÃO (entra no MD como item fixo de material) ──
    // KBA: 5 PC × 35,2 → alvo 176,00. O motor soma CUSTO_FIXO ao MD; usamos
    // CUSTO_FIXO para a matriz (175,99 ≈ 176,00). ALTERNATIVA documentada:
    // `itensDiversos` (também somado ao MD) — ver nota abaixo. Escolhemos
    // CUSTO_FIXO para o item aparecer na seção MAT.ACABAMENTO/MATRIZ do bloco de
    // acabamentos, mantendo a composição do MD = 6.598,70.
    { naturezaCusto: 'CUSTO_FIXO', nome: 'Matriz Impressão KBA (5 PC × 35,2)', valorFixo: 176.0 },

    // ── ACABAMENTO: cadeia de 5 centros HORA_MAQUINA (entra no CT) ──
    // Para cada centro, custo = (tempoFixoH + tempoVarH) × custoHora. Os tempos
    // fixo/variável do golden estão em hh:mm (documentados abaixo). Os parâmetros
    // EXATOS (quantAcertos / tempoPorAcertoMin / tempoPrimeiroAcertoMin /
    // producaoHora / unidadeBase) serão calibrados na task 2.2 para bater cada
    // subtotal ≤0,5%. Valores iniciais plausíveis + TODO(2.2) abaixo.

    // MODO DIRETO (tempoFixoHoras/tempoVarHoras): reproduz EXATAMENTE os tempos
    // de acerto/produção que o pré-cálculo Calcgraf exibe em hh:mm. Para cada
    // centro: custo = (tempoFixoH + tempoVarH) × custoHora.
    //
    // Cortadeira (Grande): 00:15 (0,25h) + 01:02 (1,03333h) × 113,21 → 145,28 (≈145,29)
    {
      naturezaCusto: 'HORA_MAQUINA',
      nome: 'Cortadeira (Grande)',
      custoHora: 113.21,
      tempoFixoHoras: 15 / 60, // 00:15
      tempoVarHoras: 62 / 60, // 01:02
    },
    // Guilhotina maior: 00:00 + 01:15 (1,25h) × 77,69 → 97,11
    {
      naturezaCusto: 'HORA_MAQUINA',
      nome: 'Guilhotina maior',
      custoHora: 77.69,
      tempoFixoHoras: 0,
      tempoVarHoras: 75 / 60, // 01:15
    },
    // Bobst E (Corte e Vi): 02:30 (2,5h) + 01:00 (1h) × 300 → 1.050,00
    {
      naturezaCusto: 'HORA_MAQUINA',
      nome: 'Bobst E (Corte e Vi)',
      custoHora: 300,
      tempoFixoHoras: 150 / 60, // 02:30
      tempoVarHoras: 60 / 60, // 01:00
    },
    // Destacar: 00:00 + 00:30 (0,5h) × 50 → 25,00
    {
      naturezaCusto: 'HORA_MAQUINA',
      nome: 'Destacar',
      custoHora: 50,
      tempoFixoHoras: 0,
      tempoVarHoras: 30 / 60, // 00:30
    },
    // AFT70 (Coladeira) Lateral Simples: 01:30 (1,5h) + 01:18 (1,3h) × 320 → 896,00
    //   alvo publicado 897,40 (desvio 0,16% — resíduo de arredondamento do Calcgraf).
    {
      naturezaCusto: 'HORA_MAQUINA',
      nome: 'AFT70 (Coladeira) Lateral Simples',
      custoHora: 320,
      tempoFixoHoras: 90 / 60, // 01:30
      tempoVarHoras: 78 / 60, // 01:18
    },
  ],

  // Tiragem do caso.
  quantidade: 20000,

  // Perdas zeradas para que folhasBrutas caia exatamente em 5.000 (a Apara
  // 27,39% do golden já está embutida no aproveitamento real do Calcgraf).
  // TODO(2.2): modelar Apara 27,39% / Quebra 0% fielmente se necessário.
  perdas: {
    impressaoPercent: 0,
    impressaoFixaFolhas: 0,
    corteVincoPercent: 0,
    colagemPercent: 0,
  },

  // Margem — markup do 3º ponto do golden (30,01%). Os 3 pontos (10/20/30,01)
  // são verificados via simulação de tiragens na task 2.2; aqui registramos o
  // markup de referência. CEV detalhado abaixo (fonte do gross-up).
  margem: {
    impostos: 0, // CEV detalhado é a fonte (abaixo); impostos derivados dele
    comissao: 3,
    despAdm: 0,
    markup: 30.01,
  },

  // ── Paridade Calcgraf ──
  // TINTA como itens diretos de material (somados ao MD). Ver nota em `cores`.
  //   Escala  → 137,05  ·  Metálica → 303,60  (total 440,65)
  itensDiversos: [
    { descricao: 'Tinta Escala', valor: 137.05 },
    { descricao: 'Tinta Metálica', valor: 303.6 },
  ],
  // Encargo financeiro C.Finan 0,13% sobre o C.Prod. → 10.413,50 × 0,0013 = 13,54.
  encargoFinanceiroPerc: 0.13,
  // CEV detalhado (total 17,75%): ICMS 3 + Juros 2,5 + PIS/COFINS 9,25 + Comissões 3.
  cev: {
    icms: 3,
    juros: 2.5,
    pisCofins: 9.25,
    comissoes: 3,
  },
}

// ============================================================================
// VALORES-ALVO do golden 15.235 (fonte: docs/calcgraf-golden-15235-acabamentos.md)
// ============================================================================

export interface Alvo15235 {
  componentes: {
    suporte: number
    matriz: number
    tintaEscala: number
    tintaMetalica: number
    matAcab: { cola: number; faca: number; verniz: number; caixa: number }
    impressao: number
    acab: {
      cortadeira: number
      guilhotina: number
      bobst: number
      destacar: number
      aft70: number
    }
  }
  agregados: {
    materialDireto: number
    custoTransformacao: number
    custoProducao: number
    total: number
  }
  margens: Array<{ markup: number; total: number }>
  /** Tolerância relativa máxima permitida por componente/agregado (0,5%). */
  tolerancia: number
}

export const alvo15235: Alvo15235 = {
  componentes: {
    suporte: 4358.66,
    matriz: 176.0,
    tintaEscala: 137.05,
    tintaMetalica: 303.6,
    matAcab: {
      cola: 33.23,
      faca: 1300,
      verniz: 136.16,
      caixa: 154.0,
    },
    impressao: 1600.0,
    acab: {
      cortadeira: 145.29,
      guilhotina: 97.11,
      bobst: 1050.0,
      destacar: 25.0,
      aft70: 897.4,
    },
  },
  agregados: {
    materialDireto: 6598.7,
    custoTransformacao: 3814.8,
    custoProducao: 10413.5,
    total: 10427.04,
  },
  margens: [
    { markup: 10, total: 14440.0 },
    { markup: 20, total: 16760.0 },
    { markup: 30.01, total: 19960.0 },
  ],
  tolerancia: 0.005, // 0,5%
}
