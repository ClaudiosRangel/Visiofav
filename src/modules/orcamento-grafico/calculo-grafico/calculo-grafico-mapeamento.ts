// Mapeamento PURO biblioteca ↔ item do orçamento (Task 2.2).
//
// Spec: biblioteca-calculos-graficos (Req 1.3, 3.2; design §"Decisão de
// modelagem: entidade nova vs reuso de ItemOrcamentoGrafico" e Property 3).
//
// Este arquivo expõe DUAS funções PURAS (sem I/O, sem Prisma) que convertem,
// nos dois sentidos, entre:
//   • o shape de engenharia de um `CalculoGrafico` (`CamposEngenhariaCalculo`) e
//   • o BODY/payload de um item de orçamento (no mesmo shape que o
//     `itemOrcamentoBodySchema` / `montarInputDoItem` / `dadosPersistenciaItem`
//     já consomem em `orcamento-grafico.routes.ts`).
//
// Por que um ÚNICO par de funções (e não dois blocos paralelos):
// `CalculoGrafico` e `ItemOrcamentoGrafico` compartilham ~30 campos de
// engenharia. Ter a transformação centralizada e testada (round-trip, Property
// 3 / Task 2.3) evita que os dois lados divirjam — lição do steering sobre a
// duplicação `pcp-wms-integration.service.ts`.
//
// INVARIANTE (Property 3 — round-trip):
//   itemBodyParaCalculo(calculoParaItemBody(calc)) ≡ calc   (campos de engenharia)
//   calculoParaItemBody(itemBodyParaCalculo(body)) ≡ body   (campos mapeados)
//
// As duas transformações NÃO-triviais são:
//   • matriz:  { quantidade, precoUnitario }  ↔  matrizQuantidade + matrizPrecoUnitario
//   • tinta:   { modo, consumoKg?, precoKg? }  ↔  tintaModo + tintaConsumoKg
//
// Reutiliza os tipos de `calculo-grafico.types.ts` (que por sua vez reusa
// `CorInput`/`AcabamentoRicoInput` do service de item) — nada é duplicado aqui.

import type {
  CamposEngenhariaCalculo,
  CorInput,
  AcabamentoRicoInput,
  ItemDiversoCalculo,
  ItemFornecidoCalculo,
  CampoLivreCalculo,
} from './calculo-grafico.types'

// ============================================================================
// SHAPE DO BODY DE ITEM (subconjunto de engenharia do itemOrcamentoBodySchema)
// ============================================================================

/**
 * BODY/payload de item de orçamento — subconjunto de ENGENHARIA do
 * `itemOrcamentoBodySchema` (orcamento-grafico.routes.ts) que corresponde 1:1 aos
 * campos de `CamposEngenhariaCalculo`. É exatamente o shape que
 * `montarInputDoItem` / `dadosPersistenciaItem` já consomem para esses campos.
 *
 * As diferenças de forma em relação ao `CamposEngenhariaCalculo` (e que estas
 * funções traduzem) são:
 *  - `matriz: { quantidade, precoUnitario }` em vez de
 *    `matrizQuantidade` + `matrizPrecoUnitario`;
 *  - `tinta: { modo, consumoKg?, precoKg? }` em vez de
 *    `tintaModo` + `tintaConsumoKg`.
 *
 * `numCores` é derivado do shape do body (ele carrega `numCores` explícito); no
 * cálculo ele também existe (`CamposEngenhariaCalculo.numCores`), então o
 * round-trip preserva.
 *
 * Observação sobre o preço da tinta no modo `CONSUMO_DIRETO`: o `CalculoGrafico`
 * persiste apenas `tintaConsumoKg` (não o `precoKg` da tinta — igual ao
 * `ItemOrcamentoGrafico`, que também só persiste `tintaConsumoKg`). Portanto, ao
 * ir do cálculo → body, o `precoKg` da tinta direto é reconstruído como `0`
 * (mesmo comportamento de `reconstruirBodyDoItem`/`reconstruirInputBaseDoItem`
 * nas rotas: o preço real é resolvido no cálculo/recalculo, não persistido). O
 * round-trip de engenharia considera `tintaConsumoKg` (persistido), não o
 * `precoKg` (não persistido).
 */
export interface ItemBodyMapeado {
  // ── Geometria / produto ──
  tipoEmbalagemId: string
  descricao?: string | null
  medidas: Record<string, number>

  // ── Papel / suporte ──
  papelId?: string | null
  papelDescricao?: string | null
  suporteId?: string | null
  gramatura: number

  // ── Impressão / cores / máquina ──
  numCores: number
  cores?: CorInput[] | null
  maquinaId?: string | null

  // ── Matriz / tinta (shape de OBJETO no body) ──
  matriz?: { quantidade: number; precoUnitario: number } | null
  tinta?:
    | { modo: 'COBERTURA' }
    | { modo: 'CONSUMO_DIRETO'; consumoKg: number; precoKg: number }
    | null

  // ── Acabamentos ricos / faca / montagem ──
  acabamentosRicos?: AcabamentoRicoInput[] | null
  modeloFacaId?: string | null
  aproveitamentoManual?: number | null
  montagemLinhas?: number | null
  montagemColunas?: number | null
  formatoCorteLarguraMm?: number | null
  formatoCorteAlturaMm?: number | null

  // ── Itens diversos / fornecidos / campos livres ──
  itensDiversos?: ItemDiversoCalculo[] | null
  itensFornecidos?: ItemFornecidoCalculo[] | null
  camposLivres?: CampoLivreCalculo[] | null

  // ── Tiragem e fechamento ──
  quantidade: number
  margemSelecionada?: number | null
}

// ============================================================================
// HELPERS DE NORMALIZAÇÃO (round-trip estável)
// ============================================================================

/** `undefined`/`null` → `null`; mantém o valor caso contrário. */
function nuloOuValor<T>(v: T | null | undefined): T | null {
  return v == null ? null : v
}

// ============================================================================
// CALCULO → BODY DE ITEM
// ============================================================================

/**
 * Mapeia os campos de engenharia de um `CalculoGrafico` (shape
 * `CamposEngenhariaCalculo`) para o BODY equivalente de um item de orçamento.
 *
 * Transformações não-triviais:
 *  - `matrizQuantidade` + `matrizPrecoUnitario` → objeto `matriz` (só quando
 *    AMBOS presentes; caso contrário `matriz = null`, igual à rota);
 *  - `tintaModo` + `tintaConsumoKg` → objeto `tinta`:
 *      • `COBERTURA`      → `{ modo: 'COBERTURA' }`;
 *      • `CONSUMO_DIRETO` → `{ modo: 'CONSUMO_DIRETO', consumoKg, precoKg: 0 }`
 *        (preço da tinta NÃO é persistido no cálculo — reconstruído como 0, como
 *        já fazem `reconstruirBodyDoItem`/`reconstruirInputBaseDoItem`);
 *      • ausente          → `tinta = null`.
 *
 * Nota de round-trip (`gramatura`): o body de item exige `gramatura: number`
 * (schema real `z.number().positive()`), enquanto no cálculo ela é
 * `number | null`. Um `CalculoGrafico` válido (criado a partir de um body)
 * sempre tem gramatura numérica; o fallback `?? 0` só cobre o estado defensivo
 * `null`/`undefined` (inválido para body). Para o PBT de round-trip (Task 2.3),
 * gerar `gramatura` como número > 0 mantém a igualdade exata nos dois sentidos.
 *
 * Função PURA: não toca banco, não calcula, não resolve cadastro.
 */
export function calculoParaItemBody(
  calculo: CamposEngenhariaCalculo,
): ItemBodyMapeado {
  // matriz: objeto só quando AMBOS os campos estão presentes (espelha a rota).
  const matriz =
    calculo.matrizQuantidade != null && calculo.matrizPrecoUnitario != null
      ? { quantidade: calculo.matrizQuantidade, precoUnitario: calculo.matrizPrecoUnitario }
      : null

  // tinta: reconstrói o objeto a partir de tintaModo + tintaConsumoKg.
  let tinta: ItemBodyMapeado['tinta'] = null
  if (calculo.tintaModo === 'CONSUMO_DIRETO') {
    tinta = {
      modo: 'CONSUMO_DIRETO',
      // consumoKg persistido; 0 se ausente (defensivo — o modo exige consumo).
      consumoKg: calculo.tintaConsumoKg ?? 0,
      // precoKg NÃO é persistido no cálculo → reconstruído como 0.
      precoKg: 0,
    }
  } else if (calculo.tintaModo === 'COBERTURA') {
    tinta = { modo: 'COBERTURA' }
  }

  return {
    // ── Geometria / produto ──
    tipoEmbalagemId: calculo.tipoEmbalagemId,
    descricao: nuloOuValor(calculo.descricao),
    medidas: calculo.medidas,

    // ── Papel / suporte ──
    papelId: nuloOuValor(calculo.papelId),
    papelDescricao: nuloOuValor(calculo.papelDescricao),
    suporteId: nuloOuValor(calculo.suporteId),
    gramatura: calculo.gramatura ?? 0,

    // ── Impressão / cores / máquina ──
    numCores: calculo.numCores,
    cores: nuloOuValor(calculo.cores),
    maquinaId: nuloOuValor(calculo.maquinaId),

    // ── Matriz / tinta (objeto) ──
    matriz,
    tinta,

    // ── Acabamentos ricos / faca / montagem ──
    acabamentosRicos: nuloOuValor(calculo.acabamentosRicos),
    modeloFacaId: nuloOuValor(calculo.modeloFacaId),
    aproveitamentoManual: nuloOuValor(calculo.aproveitamentoManual),
    montagemLinhas: nuloOuValor(calculo.montagemLinhas),
    montagemColunas: nuloOuValor(calculo.montagemColunas),
    formatoCorteLarguraMm: nuloOuValor(calculo.formatoCorteLarguraMm),
    formatoCorteAlturaMm: nuloOuValor(calculo.formatoCorteAlturaMm),

    // ── Itens diversos / fornecidos / campos livres ──
    itensDiversos: nuloOuValor(calculo.itensDiversos),
    itensFornecidos: nuloOuValor(calculo.itensFornecidos),
    camposLivres: nuloOuValor(calculo.camposLivres),

    // ── Tiragem e fechamento ──
    quantidade: calculo.quantidade,
    margemSelecionada: nuloOuValor(calculo.margemSelecionada),
  }
}

// ============================================================================
// BODY DE ITEM → CALCULO
// ============================================================================

/**
 * Transformação INVERSA de `calculoParaItemBody`: mapeia o BODY de um item de
 * orçamento de volta para os campos de engenharia de um `CalculoGrafico`
 * (`CamposEngenhariaCalculo`).
 *
 * Transformações não-triviais (inversas):
 *  - objeto `matriz` → `matrizQuantidade` + `matrizPrecoUnitario` (ambos `null`
 *    quando `matriz` ausente);
 *  - objeto `tinta` → `tintaModo` + `tintaConsumoKg`:
 *      • `COBERTURA`      → `tintaModo='COBERTURA'`, `tintaConsumoKg=null`;
 *      • `CONSUMO_DIRETO` → `tintaModo='CONSUMO_DIRETO'`, `tintaConsumoKg=consumoKg`
 *        (o `precoKg` do body NÃO é levado ao cálculo — não é campo do cálculo);
 *      • ausente          → `tintaModo=null`, `tintaConsumoKg=null`.
 *
 * Função PURA: não toca banco, não calcula, não resolve cadastro.
 */
export function itemBodyParaCalculo(
  body: ItemBodyMapeado,
): CamposEngenhariaCalculo {
  // matriz → matrizQuantidade + matrizPrecoUnitario.
  const matrizQuantidade = body.matriz != null ? body.matriz.quantidade : null
  const matrizPrecoUnitario = body.matriz != null ? body.matriz.precoUnitario : null

  // tinta → tintaModo + tintaConsumoKg.
  let tintaModo: CamposEngenhariaCalculo['tintaModo'] = null
  let tintaConsumoKg: number | null = null
  if (body.tinta) {
    tintaModo = body.tinta.modo
    tintaConsumoKg = body.tinta.modo === 'CONSUMO_DIRETO' ? body.tinta.consumoKg : null
  }

  return {
    // ── Geometria / produto ──
    tipoEmbalagemId: body.tipoEmbalagemId,
    descricao: nuloOuValor(body.descricao),
    medidas: body.medidas,

    // ── Papel / suporte ──
    papelId: nuloOuValor(body.papelId),
    papelDescricao: nuloOuValor(body.papelDescricao),
    suporteId: nuloOuValor(body.suporteId),
    gramatura: nuloOuValor(body.gramatura),

    // ── Impressão / cores / máquina ──
    numCores: body.numCores,
    cores: nuloOuValor(body.cores),
    maquinaId: nuloOuValor(body.maquinaId),

    // ── Matriz / tinta (campos planos) ──
    matrizQuantidade,
    matrizPrecoUnitario,
    tintaModo,
    tintaConsumoKg,

    // ── Acabamentos ricos / faca / montagem ──
    acabamentosRicos: nuloOuValor(body.acabamentosRicos),
    modeloFacaId: nuloOuValor(body.modeloFacaId),
    aproveitamentoManual: nuloOuValor(body.aproveitamentoManual),
    montagemLinhas: nuloOuValor(body.montagemLinhas),
    montagemColunas: nuloOuValor(body.montagemColunas),
    formatoCorteLarguraMm: nuloOuValor(body.formatoCorteLarguraMm),
    formatoCorteAlturaMm: nuloOuValor(body.formatoCorteAlturaMm),

    // ── Itens diversos / fornecidos / campos livres ──
    itensDiversos: nuloOuValor(body.itensDiversos),
    itensFornecidos: nuloOuValor(body.itensFornecidos),
    camposLivres: nuloOuValor(body.camposLivres),

    // ── Tiragem e fechamento ──
    quantidade: body.quantidade,
    margemSelecionada: nuloOuValor(body.margemSelecionada),
  }
}
