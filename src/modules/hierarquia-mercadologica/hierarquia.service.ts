/**
 * Serviço puro da Hierarquia Mercadológica.
 *
 * 4 níveis fixos encadeados: DEPARTAMENTO → SECAO → CATEGORIA → SUBCATEGORIA
 * (folha). Funções puras (sem I/O) para validação de segmento, composição do
 * código hierárquico e montagem do caminho completo — testáveis isoladamente.
 */

// 4 níveis de agrupamento (padrão SAP Retail / GS1 GPC). O produto/SKU NÃO é
// um nível da árvore — ele se vincula ao nível folha (SUBCATEGORIA, também
// chamada "Subcategoria/Família" no relatório) e usa seu próprio código.
// Estrutura: DEPARTAMENTO → SECAO → CATEGORIA → SUBCATEGORIA (folha).
export type TipoNivel =
  | 'DEPARTAMENTO'
  | 'SECAO'
  | 'CATEGORIA'
  | 'SUBCATEGORIA'

export const TIPOS_NIVEL: TipoNivel[] = [
  'DEPARTAMENTO', 'SECAO', 'CATEGORIA', 'SUBCATEGORIA',
]

/**
 * Largura de dígitos do código de segmento por nível (Req 2.3).
 * Todos os tipos têm uma regra — nenhum segmento é aceito sem largura ativa.
 */
export const LARGURA_SEGMENTO: Record<TipoNivel, number> = {
  DEPARTAMENTO: 2,
  SECAO: 2,
  CATEGORIA: 2,
  // SUBCATEGORIA é o nível folha (Subcategoria/Família) — 3 dígitos, alinhado
  // ao relatório. É o nível ao qual o produto se vincula.
  SUBCATEGORIA: 3,
}

/**
 * Normaliza o código de segmento aplicando zero-padding à esquerda conforme a
 * largura do nível (Ajuste 2). Aceita entradas com menos dígitos que a largura
 * (ex.: "4" no nível CATEGORIA → "04"; "1" no FAMILIA → "001"). Só faz padding
 * quando o valor é puramente numérico e não excede a largura; caso contrário
 * retorna o valor original (a validação posterior rejeita).
 */
export function normalizarCodigoSegmento(tipo: TipoNivel, codigo: string): string {
  // ex.: "4" no CATEGORIA → "04"; "1" no SUBCATEGORIA → "001".
  const largura = LARGURA_SEGMENTO[tipo]
  const bruto = (codigo ?? '').trim()
  if (largura === undefined) return bruto
  if (!/^\d+$/.test(bruto)) return bruto
  if (bruto.length > largura) return bruto // excede → deixa a validação recusar
  return bruto.padStart(largura, '0')
}

/**
 * Tipo do nível pai exigido por tipo de nível filho (Req 1.2).
 * DEPARTAMENTO não tem pai (ausente do mapa).
 */
export const TIPO_PAI_OBRIGATORIO: Partial<Record<TipoNivel, TipoNivel>> = {
  SECAO: 'DEPARTAMENTO',
  CATEGORIA: 'SECAO',
  SUBCATEGORIA: 'CATEGORIA',
}

export interface ValidacaoResult {
  valido: boolean
  erro?: string
}

/**
 * Valida o código de segmento de um nível: apenas dígitos, com a largura
 * exata definida para o tipo. Preserva zeros à esquerda (não normaliza).
 */
export function validarCodigoSegmento(tipo: TipoNivel, codigo: string): ValidacaoResult {
  const largura = LARGURA_SEGMENTO[tipo]
  if (largura === undefined) {
    return { valido: false, erro: `Tipo de nível inválido: ${tipo}` }
  }
  if (!/^\d+$/.test(codigo)) {
    return { valido: false, erro: 'O código de segmento deve conter apenas dígitos.' }
  }
  if (codigo.length !== largura) {
    return { valido: false, erro: `O código do nível ${tipo} deve ter exatamente ${largura} dígitos.` }
  }
  return { valido: true }
}

/**
 * Compõe o código hierárquico do nível a partir do código hierárquico do pai
 * e do código de segmento próprio.
 *
 * - DEPARTAMENTO: retorna apenas o segmento (ex.: "01").
 * - Demais: `${codigoPai}.${segmento}` (ex.: "01.02" + "04" → "01.02.04").
 *
 * Determinístico e sem I/O.
 */
export function composeCodigoHierarquico(
  tipo: TipoNivel,
  codigoHierarquicoPai: string | null,
  codigoSegmento: string,
): string {
  if (tipo === 'DEPARTAMENTO' || !codigoHierarquicoPai) {
    return codigoSegmento
  }
  return `${codigoHierarquicoPai}.${codigoSegmento}`
}

export interface NivelBasico {
  id: string
  tipo: TipoNivel
  codigo: string
  codigoHierarquico: string
  descricao: string
}

/** Nível com o pai aninhado recursivamente (para montar o caminho). */
export interface NivelComPai extends NivelBasico {
  pai?: NivelComPai | null
}

/**
 * Monta o caminho completo do nível raiz (Departamento) até o próprio nível,
 * a partir de um nível com o pai aninhado. Retorna array em ordem
 * hierárquica (Departamento primeiro, folha por último).
 */
export function montarCaminhoCompleto(nivel: NivelComPai): NivelBasico[] {
  const caminho: NivelBasico[] = []
  let atual: NivelComPai | null | undefined = nivel
  const vistos = new Set<string>()
  while (atual) {
    if (vistos.has(atual.id)) break // proteção contra ciclo
    vistos.add(atual.id)
    caminho.unshift({
      id: atual.id,
      tipo: atual.tipo,
      codigo: atual.codigo,
      codigoHierarquico: atual.codigoHierarquico,
      descricao: atual.descricao,
    })
    atual = atual.pai
  }
  return caminho
}
