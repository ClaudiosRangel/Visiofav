// Tipos compartilhados do submódulo Biblioteca de Cálculos Gráficos.
//
// Spec: biblioteca-calculos-graficos (Task 2.1, Req 1.3).
//
// Este arquivo expõe o tipo `CamposEngenhariaCalculo` — as ~30 colunas de
// engenharia COMUNS entre o novo model `CalculoGrafico` (biblioteca, "cálculo
// solto" estilo "Cálculo Padrão" do Calcgraf) e o model já existente
// `ItemOrcamentoGrafico` (item de orçamento). Ter um tipo único evita que os
// dois lados divirjam (lição do steering sobre duplicação de lógica entre
// service e rota — `pcp-wms-integration.service.ts`).
//
// A decisão de modelagem (design §"Decisão de modelagem: entidade nova vs reuso
// de ItemOrcamentoGrafico") é criar uma entidade NOVA com o MESMO shape de
// engenharia do item, porém SEM orçamento pai. Este tipo é o contrato dessa
// sobreposição de shape; as funções de mapeamento `calculoParaItemBody` /
// `itemBodyParaCalculo` (Task 2.2) operam sobre ele.
//
// IMPORTANTE (sem import circular): reaproveitamos APENAS os tipos de entrada
// (`CorInput`, `AcabamentoRicoInput`) de `orcamento-grafico-item.service.ts`.
// São `type import`s (apagados na compilação) — não criam dependência de runtime
// entre os módulos, logo não há ciclo. Nenhuma função/valor é importado aqui.

import type {
  CorInput,
  AcabamentoRicoInput,
} from '../orcamento-grafico-item.service'

// Reexporta os tipos reaproveitados para que o restante do submódulo
// (mapeamentos, service, rotas) os consuma a partir de um ponto único.
export type { CorInput, AcabamentoRicoInput }

/**
 * Item "diverso" lançado diretamente no Material Direto como valor fixo
 * (não escala com a tiragem). Espelha o shape persistido no item do orçamento
 * (`itensDiversos`) — ver `itemOrcamentoBodySchema`/`dadosPersistenciaItem`.
 */
export interface ItemDiversoCalculo {
  descricao: string
  quantidade: number
  valor: number
  /** Quando `true`, `valor` é fixo (não multiplica por `quantidade`). */
  fixo?: boolean
}

/**
 * Item FORNECIDO pelo cliente (entra na descrição/engenharia, mas não soma custo
 * — custo zero no MD). Espelha o `itensFornecidos` do item do orçamento.
 */
export interface ItemFornecidoCalculo {
  descricao: string
  quantidade: number
}

/**
 * Campo livre (rótulo + conteúdo) — somente textual/persistência, não afeta o
 * cálculo. Espelha o `camposLivres` do item do orçamento.
 */
export interface CampoLivreCalculo {
  rotulo: string
  conteudo: string
}

/**
 * Matriz de impressão. Quando presente e `quantidade > 0`, o custo
 * `quantidade × precoUnitario` entra no Material Direto como custo FIXO por
 * ocorrência (não escala com a tiragem). Espelha `matriz` do item.
 */
export interface MatrizCalculo {
  quantidade: number
  precoUnitario: number
}

/**
 * Modo de cálculo da tinta (paridade Calcgraf):
 *  - `COBERTURA`: modelo por cobertura (SPANKS via coefTinta do suporte quando
 *    resolvido, ou legado por cobertura das cores).
 *  - `CONSUMO_DIRETO`: consumo informado diretamente (`consumoKg × precoKg`),
 *    sem SPANKS/cobertura.
 * Espelha a união `tinta` do item do orçamento.
 */
export type TintaCalculo =
  | { modo: 'COBERTURA' }
  | { modo: 'CONSUMO_DIRETO'; consumoKg: number; precoKg: number }

/**
 * Colunas de ENGENHARIA comuns a `CalculoGrafico` (biblioteca) e
 * `ItemOrcamentoGrafico` (item de orçamento). ~30 campos, agrupados como no
 * schema do design. Tipos coerentes com o já existente no módulo:
 *  - ids (`string`), descrições (`string`);
 *  - valores numéricos de engenharia (`number`) — as colunas `Decimal`/`Int` do
 *    Prisma são representadas em TS como `number` (como o input/body já fazem);
 *  - `medidas` como `Record<string, number>` (igual a `ItemOrcamentoInput`);
 *  - `cores`/`acabamentosRicos`/`itens*`/`camposLivres` como JSON estruturado,
 *    reutilizando os tipos de entrada do service de item.
 *
 * Campos de biblioteca (`numero`, `numeroCalcgraf`, `origem`, `status`,
 * cliente/linha), a FOTO congelada (`resultadoCalculo`) e os metadados
 * (datas/autor) NÃO fazem parte deste tipo — eles são próprios do model
 * `CalculoGrafico`/`ItemOrcamentoGrafico` e tratados fora do shape de
 * engenharia compartilhado.
 */
export interface CamposEngenhariaCalculo {
  // ── Geometria / produto ──
  /** Tipo de embalagem (FK `TipoEmbalagem`). */
  tipoEmbalagemId: string
  /** Descrição livre do cálculo/item. */
  descricao?: string | null
  /** Medidas do produto (nome do parâmetro → valor em mm). */
  medidas: Record<string, number>

  // ── Papel / suporte ──
  /** Preço de material (papel) de origem (FK `PrecoMateriaPrima`). */
  papelId?: string | null
  /** Descrição textual do papel (desnormalizada para exibição). */
  papelDescricao?: string | null
  /** Suporte gráfico (FK `SuporteGrafico`), fonte do coefTinta (SPANKS). */
  suporteId?: string | null
  /** Gramatura do papel em g/m². */
  gramatura?: number | null

  // ── Impressão / cores / máquina ──
  /** Número de cores de impressão. */
  numCores: number
  /** Cores de impressão (nome/tipo/cobertura/preço). */
  cores?: CorInput[] | null
  /** Máquina de impressão (FK `CentroProducao` IMPRESSAO). */
  maquinaId?: string | null

  // ── Matriz / tinta ──
  /** Quantidade de matrizes de impressão. */
  matrizQuantidade?: number | null
  /** Preço unitário da matriz de impressão. */
  matrizPrecoUnitario?: number | null
  /** Modo de cálculo da tinta (`COBERTURA` | `CONSUMO_DIRETO`). */
  tintaModo?: 'COBERTURA' | 'CONSUMO_DIRETO' | null
  /** Consumo de tinta em kg (modo `CONSUMO_DIRETO`). */
  tintaConsumoKg?: number | null

  // ── Acabamentos ricos / faca / montagem ──
  /** Acabamentos ricos (cadastro + overrides). */
  acabamentosRicos?: AcabamentoRicoInput[] | null
  /** Modelo/Faca do catálogo GCad (FK `ModeloFaca`) — imposição real. */
  modeloFacaId?: string | null
  /** Override do aproveitamento (peças/folha) — imposição real da faca. */
  aproveitamentoManual?: number | null
  /** Montagem: número de linhas da imposição. */
  montagemLinhas?: number | null
  /** Montagem: número de colunas da imposição. */
  montagemColunas?: number | null
  /** Formato de corte (folha) — largura em mm. */
  formatoCorteLarguraMm?: number | null
  /** Formato de corte (folha) — altura em mm. */
  formatoCorteAlturaMm?: number | null

  // ── Itens diversos / fornecidos / campos livres ──
  /** Itens diversos (valor fixo no MD). */
  itensDiversos?: ItemDiversoCalculo[] | null
  /** Itens fornecidos pelo cliente (custo zero). */
  itensFornecidos?: ItemFornecidoCalculo[] | null
  /** Campos livres (rótulo/conteúdo) — somente textual. */
  camposLivres?: CampoLivreCalculo[] | null

  // ── Tiragem e fechamento ──
  /** Tiragem base do cálculo. */
  quantidade: number
  /** Margem (markup) selecionada para o Valor Total. */
  margemSelecionada?: number | null
}
