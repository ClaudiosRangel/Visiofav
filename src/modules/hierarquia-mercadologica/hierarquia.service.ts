/**
 * Serviço puro da Hierarquia Mercadológica.
 *
 * 5 níveis fixos encadeados: DEPARTAMENTO → SECAO → CATEGORIA → SUBCATEGORIA →
 * FAMILIA. Funções puras (sem I/O) para validação de segmento, composição do
 * código hierárquico e montagem do caminho completo — testáveis isoladamente.
 */

export type TipoNivel =
  | 'DEPARTAMENTO'
  | 'SECAO'
  | 'CATEGORIA'
  | 'SUBCATEGORIA'
  | 'FAMILIA'

export const TIPOS_NIVEL: TipoNivel[] = [
  'DEPARTAMENTO', 'SECAO', 'CATEGORIA', 'SUBCATEGORIA', 'FAMILIA',
]

/**
 * Largura de dígitos do código de segmento por nível (Req 2.3).
 * Todos os 5 tipos têm uma regra — nenhum segmento é aceito sem largura ativa.
 */
export const LARGURA_SEGMENTO: Record<TipoNivel, number> = {
  DEPARTAMENTO: 2,
  SECAO: 2,
  CATEGORIA: 2,
  SUBCATEGORIA: 2,
  FAMILIA: 3,
}

/**
 * Tipo do nível pai exigido por tipo de nível filho (Req 1.2).
 * DEPARTAMENTO não tem pai (ausente do mapa).
 */
export const TIPO_PAI_OBRIGATORIO: Partial<Record<TipoNivel, TipoNivel>> = {
  SECAO: 'DEPARTAMENTO',
  CATEGORIA: 'SECAO',
  SUBCATEGORIA: 'CATEGORIA',
  FAMILIA: 'SUBCATEGORIA',
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
