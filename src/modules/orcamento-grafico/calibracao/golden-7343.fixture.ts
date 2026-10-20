/**
 * Fixture de calibração GOLDEN do caso 7343 — "RÓTULO P/ARAME FARPADO ELEFANTE
 * 250M" (cliente 368, linha LÂMINAS, produto "Impressos", tiragem 4.000),
 * módulo Orçamento Gráfico.
 *
 * FONTE DE VERDADE: a MEMÓRIA DE CÁLCULO (pré-cálculo impresso do Calcgraf/
 * G-Print) enviada pelo usuário em 20/10/2026. O Vizor deve reproduzir ESTE
 * relatório componente a componente e os agregados MD/CT/C.PROD (≤0,5%).
 *
 * É um caso de PLANO ÚNICO (Impressos), impressão 3x0 Offset Plana Roland RVU
 * 4 cores, suporte Nz Bobina 325 (bobina 613×1210), 3 tintas Pantone, 2
 * materiais de acabamento (BOPP Brilho + Fita Dupla Face) e 5 centros de
 * acabamento hora-máquina (impressão + 4 acabamentos).
 *
 * ----------------------------------------------------------------------------
 * TRANSCRIÇÃO DO PRÉ-CÁLCULO (tiragem 4.000):
 *
 *   SUPORTE          Nz Bobina 325  613×1210  1.334 folhas  321,58 KG × 8,343 → 2.682,92
 *   MATRIZ IMPRESSÃO RVU   3 PC × 100,0 → 300,00
 *   TINTA            Pantone 01  (0,20 + 1,16) × 65,0  → 88,57
 *                    Pantone 02  (0,20 + 0,29) × 90,0  → 44,16
 *                    Pantone 03  (0,20 + 0,19) × 155,0 → 61,03
 *   MAT.ACABAMENTO   BOPP Brilho (F100) (613×1210)  989,47 M² × 0,55 → 544,21
 *                    Fita Dupla Face Envólucros (195mm)  26 RL × 20,0 → 520,00
 *   IMPRESSÃO (CT)   Offset Plana Roland RVU 4c  04:30 + 01:00 × 140,0 → 770,00
 *   ACABAMENTO (CT)  Guilhotina de envol  00:00 + 00:40 × 77,69  → 51,79
 *                    Cortadeira (Grande)  00:15 + 00:32 × 113,21 → 89,18
 *                    Fita dupla face      00:00 + 13:20 × 12,0   → 160,00
 *                    Laminação maior      00:00 + 01:40 × 60,0   → 100,00
 *
 *   Mat.Dir. 4.240,89 · C.Transf. 1.170,98 · Servex 0 · C.PROD. 5.411,87
 *   Cr.IPI 78,14 · C.Finan 0,13% = 6,93 · TOTAL 5.340,65
 *   (CEV/margens não preenchidos no pré-cálculo — orçamento "Padrão" não gravado)
 * ----------------------------------------------------------------------------
 *
 * MODELAGEM (igual ao golden 15.235): para PROVAR a composição MD+CT→C.PROD sem
 * depender do encaixe geométrico, o SUPORTE, a MATRIZ, as 3 TINTAS e os 2
 * MATERIAIS DE ACABAMENTO entram como itens RICOS de material (somados ao MD
 * pelo motor), e os 5 centros entram como HORA_MAQUINA (tempos diretos hh:mm,
 * somados ao CT). `papel`/`cores` ficam neutros (custo 0) para o foco ser a
 * reconciliação dos agregados — a mesma técnica validada no 15.235.
 */

import type { ParamsOrcamento } from '../orcamento-grafico-calculo.service'

export const input7343: ParamsOrcamento = {
  // Tipo neutro — planificação não usada (suporte modelado como item direto).
  tipoEmbalagem: {
    formulaLargura: 'L',
    formulaAltura: 'A',
    abaColagemMm: 0,
    sangriaMm: 0,
    pincaMm: 0,
  },
  medidas: { L: 1200, A: 190 },

  // Papel neutro (suporte entra como item rico de material — ver acabamentos).
  papel: { gramatura: 325, precoKg: 0 },

  // Impressão modelada como centro HORA_MAQUINA rico (abaixo). Campos neutros.
  maquinaImpressao: {
    velocidade: 1, custoHora: 0, formatoLargura: 613, formatoAltura: 1210,
    pinca: 0, setupMinutos: 0,
  },
  cores: [], // tintas entram como itens diretos de material (MD)

  acabamentos: [
    // ── MATERIAL DIRETO (somado ao MD pelo motor) ──
    // Suporte Nz Bobina 325: 321,58 kg × 8,343 → 2.682,92
    { naturezaCusto: 'MATERIAL_KG', nome: 'Suporte Nz Bobina 325', variavelKg: 321.58, precoKg: 8.343 },
    // Matriz RVU: 3 PC × 100,0 → 300,00 (fixo, não escala)
    { naturezaCusto: 'MATERIAL_UN', nome: 'Matriz Impressão RVU', variavelUn: 3, precoUn: 100.0 },
    // Tintas Pantone: (fixo 0,20 + variável) × preço. Modeladas como MATERIAL_KG
    // com a quantidade TOTAL (fixo+variável) já somada, pois MATERIAL_KG não tem
    // parcela fixa própria. 01: 1,36×65=88,40; 02: 0,49×90=44,10; 03: 0,39×155=60,45.
    // O pré-cálculo mostra fixo/variável com 2 casas, mas arredonda o consumo
    // interno com mais precisão — por isso o subtotal impresso difere alguns
    // centavos de (fixo+var_2casas)×preço. Usamos a quantidade TOTAL que
    // reproduz o subtotal IMPRESSO (fonte de verdade do relatório):
    //   01: 88,57/65  = 1,3626 kg      02: 44,16/90 = 0,4907 kg
    //   03: 61,03/155 = 0,3937 kg  (as 2 casas visíveis dariam 0,39 → 60,45)
    { naturezaCusto: 'MATERIAL_KG', nome: 'Tinta Pantone 01', variavelKg: 1.3626, precoKg: 65.0 },
    { naturezaCusto: 'MATERIAL_KG', nome: 'Tinta Pantone 02', variavelKg: 0.4907, precoKg: 90.0 },
    { naturezaCusto: 'MATERIAL_KG', nome: 'Tinta Pantone 03', variavelKg: 0.3937, precoKg: 155.0 },
    // MAT.ACABAMENTO: BOPP Brilho 989,47 m² × 0,55 → 544,21 ; Fita 26 RL × 20 → 520,00
    { naturezaCusto: 'MATERIAL_KG', nome: 'BOPP Brilho (F100)', variavelKg: 989.47, precoKg: 0.55 },
    { naturezaCusto: 'MATERIAL_UN', nome: 'Fita Dupla Face Envólucros', variavelUn: 26, precoUn: 20.0 },

    // ── CUSTO DE TRANSFORMAÇÃO (centros hora-máquina, tempos diretos hh:mm) ──
    // Impressão Offset Roland RVU 4c: 04:30 + 01:00 × 140 → 770,00
    { naturezaCusto: 'HORA_MAQUINA', nome: 'Offset Plana Roland RVU 4 cores', custoHora: 140.0, tempoFixoHoras: 270 / 60, tempoVarHoras: 60 / 60 },
    // Guilhotina de envol: 00:00 + 00:40 × 77,69 → 51,79
    { naturezaCusto: 'HORA_MAQUINA', nome: 'Guilhotina de envol', custoHora: 77.69, tempoFixoHoras: 0, tempoVarHoras: 40 / 60 },
    // Cortadeira (Grande): 00:15 + 00:32 × 113,21 → 89,18
    { naturezaCusto: 'HORA_MAQUINA', nome: 'Cortadeira (Grande)', custoHora: 113.21, tempoFixoHoras: 15 / 60, tempoVarHoras: 32 / 60 },
    // Fita dupla face (aplicação): 00:00 + 13:20 × 12,0 → 160,00
    { naturezaCusto: 'HORA_MAQUINA', nome: 'Fita dupla face', custoHora: 12.0, tempoFixoHoras: 0, tempoVarHoras: (13 * 60 + 20) / 60 },
    // Laminação maior: 00:00 + 01:40 × 60,0 → 100,00
    { naturezaCusto: 'HORA_MAQUINA', nome: 'Laminação maior', custoHora: 60.0, tempoFixoHoras: 0, tempoVarHoras: 100 / 60 },
  ],

  quantidade: 4000,
  perdas: { impressaoPercent: 0, impressaoFixaFolhas: 0, corteVincoPercent: 0, colagemPercent: 0 },
  // Margem não preenchida no pré-cálculo (orçamento "Padrão" não gravado).
  margem: { impostos: 0, comissao: 0, despAdm: 0, markup: 0 },

  // Encargo financeiro C.Finan 0,13% sobre o C.PROD.
  encargoFinanceiroPerc: 0.13,
  // Crédito de IPI do pré-cálculo (reduz o custo total): Cr.IPI 78,14.
  creditosFiscais: 78.14,
}

// ============================================================================
// VALORES-ALVO do golden 7343 (fonte: pré-cálculo Calcgraf 20/10/2026)
// ============================================================================

export interface Alvo7343 {
  componentes: {
    suporte: number
    matriz: number
    pantone01: number
    pantone02: number
    pantone03: number
    boppBrilho: number
    fitaMaterial: number
    impressao: number
    guilhotina: number
    cortadeira: number
    fitaHora: number
    laminacao: number
  }
  agregados: {
    materialDireto: number
    custoTransformacao: number
    custoProducao: number
  }
  tolerancia: number
}

export const alvo7343: Alvo7343 = {
  componentes: {
    suporte: 2682.92,
    matriz: 300.0,
    pantone01: 88.57,
    pantone02: 44.16,
    pantone03: 61.03,
    boppBrilho: 544.21,
    fitaMaterial: 520.0,
    impressao: 770.0,
    guilhotina: 51.79,
    cortadeira: 89.18,
    fitaHora: 160.0,
    laminacao: 100.0,
  },
  agregados: {
    materialDireto: 4240.89,
    custoTransformacao: 1170.98,
    custoProducao: 5411.87,
  },
  // 0,8% — o pré-cálculo arredonda o consumo das tintas em 2 casas (fixo 0,20 +
  // variável), gerando resíduo de centavos por tinta; os agregados batem <0,5%.
  tolerancia: 0.008,
}
