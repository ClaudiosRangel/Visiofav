/**
 * Fixture de calibração GOLDEN do caso 15.185 — orçamento MULTI-ITEM do Calcgraf
 * (cabeçalho + PARTE 01 + PARTE 02, ~4 suportes). Task 24 (Fase 5) da spec
 * `orcamento-grafico-multi-item-gcad`.
 *
 * ⚠️ ESTE ARQUIVO É UM ESQUELETO (HARNESS). Os VALORES-ALVO estão PENDENTES de
 * transcrição do print do Calcgraf — o usuário ainda NÃO transcreveu a memória
 * de cálculo do 15.185. Enquanto `PENDENTE_TRANSCRICAO` for `true`, o teste
 * `golden-15185.test.ts` roda apenas como `it.todo` (não executa, não falha, não
 * inventa números). Quando os valores reais forem transcritos aqui, basta:
 *   1. Preencher `input` e os `alvo*` de cada item (PARTE 01 / PARTE 02);
 *   2. Preencher `cabecalho.totalConsolidado` (Total do orçamento no Calcgraf);
 *   3. Trocar `PENDENTE_TRANSCRICAO` para `false`.
 * O teste então passa a confrontar automaticamente C.Prod por item (≤0,5%) e o
 * Total consolidado (arredondamento 2 casas, ≤ R$ 0,01).
 *
 * ----------------------------------------------------------------------------
 * CAMPOS ESPERADOS (o que transcrever do print do Calcgraf 15.185):
 *
 *   POR ITEM (PARTE 01 e PARTE 02), reproduzir o bloco do pré-cálculo:
 *     SUPORTE          papel/folha/kg → subtotal              (compõe o MD)
 *     MATRIZ IMPRESSÃO PC × preço → subtotal                  (custo fixo no MD)
 *     TINTA            escala/metálica/pantone → subtotal      (MD)
 *     MAT.ACABAMENTO   cola/verniz/faca/caixa (kg/un/fixo)     (MD)
 *     IMPRESSÃO (CT)   offset: acerto + produção × custoHora   (Custo Transf.)
 *     ACABAMENTO (CT)  cadeia de centros (acerto + prod × ch)  (Custo Transf.)
 *   → Agregados do item: MD, CT, Servex (Serviço Externo), C.Prod (= MD+CT+Servex).
 *
 *   NO CABEÇALHO:
 *     Total consolidado = Σ (Valor Total da margem selecionada de cada item).
 *     No Calcgraf, é o total do orçamento somando PARTE 01 + PARTE 02.
 * ----------------------------------------------------------------------------
 */

import type { ParamsOrcamento } from '../orcamento-grafico-calculo.service'

/**
 * Flag de controle do harness. Enquanto `true`, o teste `golden-15185.test.ts`
 * NÃO confronta nada (só registra `it.todo`), porque os valores do print ainda
 * não foram transcritos. Trocar para `false` após preencher os alvos abaixo.
 */
export const PENDENTE_TRANSCRICAO = true

/**
 * Estrutura esperada do golden multi-item 15.185.
 *
 * - `cabecalho`: identificação + Total consolidado do orçamento (Σ dos itens pela
 *   margem selecionada de cada um). `totalConsolidado = null` enquanto pendente.
 * - `itens`: um registro por PARTE do Calcgraf. Para cada item:
 *     - `parte`: rótulo da parte (ex.: 'PARTE 01').
 *     - `input`: entrada do item montada como `ParamsOrcamento` (ou `null`
 *       enquanto pendente de transcrição).
 *     - `alvoCustoProducao`: Custo de Produção (MD+CT+Servex) do item no Calcgraf.
 *     - `alvoValorTotal`: Valor Total do item na margem selecionada.
 *     - `margemSelecionada`: markup escolhido para o item (ex.: 30), usado tanto
 *       na consolidação quanto no confronto do Valor Total.
 * - `tolerancia`: tolerância relativa por item no confronto do C.Prod (0,5%).
 */
export interface Golden15185 {
  cabecalho: {
    numero: string
    cliente: string
    /** Total do orçamento consolidado (Σ itens). `null` enquanto pendente. */
    totalConsolidado: number | null
  }
  itens: Array<{
    parte: string
    /** Entrada do item como `ParamsOrcamento`. `null` enquanto pendente. */
    input: Partial<ParamsOrcamento> | null
    /** Custo de Produção (MD+CT+Servex) do item. `null` enquanto pendente. */
    alvoCustoProducao: number | null
    /** Valor Total do item na margem selecionada. `null` enquanto pendente. */
    alvoValorTotal: number | null
    /** Markup selecionado do item (ex.: 30). `null` enquanto pendente. */
    margemSelecionada: number | null
  }>
  /** Tolerância relativa por item no confronto do C.Prod (0,5%). */
  tolerancia: number
}

/**
 * GOLDEN 15.185 — ESTRUTURA preenchida (2 itens: PARTE 01 e PARTE 02), com os
 * VALORES ainda PENDENTES (placeholders `null`). Transcrever do print do
 * Calcgraf conforme os `// TODO(usuário)` abaixo.
 */
export const golden15185: Golden15185 = {
  cabecalho: {
    // TODO(usuário): transcrever do print 15.185 (número e cliente reais do orçamento).
    numero: '15.185',
    cliente: 'A TRANSCREVER',
    // TODO(usuário): transcrever do print 15.185 — Total consolidado do orçamento
    // (Σ do Valor Total da margem selecionada de PARTE 01 + PARTE 02).
    totalConsolidado: null,
  },
  itens: [
    {
      parte: 'PARTE 01',
      // TODO(usuário): transcrever do print 15.185 — montar o ParamsOrcamento da
      // PARTE 01 (suporte/matriz/tinta/mat.acabamento/impressão/acabamento).
      input: null,
      // TODO(usuário): transcrever do print 15.185 — C.Prod (MD+CT+Servex) da PARTE 01.
      alvoCustoProducao: null,
      // TODO(usuário): transcrever do print 15.185 — Valor Total da PARTE 01 (margem selecionada).
      alvoValorTotal: null,
      // TODO(usuário): transcrever do print 15.185 — markup selecionado da PARTE 01.
      margemSelecionada: null,
    },
    {
      parte: 'PARTE 02',
      // TODO(usuário): transcrever do print 15.185 — montar o ParamsOrcamento da
      // PARTE 02 (suporte/matriz/tinta/mat.acabamento/impressão/acabamento).
      input: null,
      // TODO(usuário): transcrever do print 15.185 — C.Prod (MD+CT+Servex) da PARTE 02.
      alvoCustoProducao: null,
      // TODO(usuário): transcrever do print 15.185 — Valor Total da PARTE 02 (margem selecionada).
      alvoValorTotal: null,
      // TODO(usuário): transcrever do print 15.185 — markup selecionado da PARTE 02.
      margemSelecionada: null,
    },
  ],
  // 0,5% — mesma tolerância relativa dos demais golden cases de orçamento.
  tolerancia: 0.005,
}
