/**
 * Tipos do Layout_JSON do Editor Visual de Documentos (spec
 * comercial-editor-visual-templates).
 *
 * UNIDADE ÚNICA DE COORDENADAS = pt (points — unidade nativa do pdfkit).
 * A4 = 595 × 842 pt. O preview no front escala pt→px; o PDF usa pt direto.
 * Essa unidade única é o que garante fidelidade preview↔PDF (Req 4).
 */

export type TipoTemplate = 'ORCAMENTO' | 'PROPOSTA'

export const TIPOS_TEMPLATE: readonly TipoTemplate[] = ['ORCAMENTO', 'PROPOSTA'] as const

/** Dimensões A4 em pt (padrão do pdfkit). */
export const A4_LARGURA_PT = 595
export const A4_ALTURA_PT = 842

export type TipoElemento =
  | 'LOGO'
  | 'TEXTO'
  | 'CAMPO_DINAMICO'
  | 'TABELA'
  | 'LINHA'
  | 'BLOCO_CONDICOES'
  | 'ASSINATURA'

export const TIPOS_ELEMENTO: readonly TipoElemento[] = [
  'LOGO', 'TEXTO', 'CAMPO_DINAMICO', 'TABELA', 'LINHA', 'BLOCO_CONDICOES', 'ASSINATURA',
] as const

export type Alinhamento = 'left' | 'center' | 'right'

export interface EstiloTexto {
  fonte: 'Helvetica' | 'Helvetica-Bold'
  tamanhoPt: number
  alinhamento: Alinhamento
  negrito: boolean
  cor: string // hex "#333333"
}

/** Coluna de uma TABELA (binding por célula). */
export interface ColunaTabela {
  titulo: string
  binding: string // ex.: "quantidade", "precoTotal"
  larguraPt: number
  alinhamento: Alinhamento
}

export interface Elemento {
  id: string
  tipo: TipoElemento
  xPt: number
  yPt: number
  larguraPt: number
  alturaPt: number
  estilo?: EstiloTexto
  // Propriedades por tipo (apenas a relevante é preenchida):
  textoEstatico?: string // TEXTO
  binding?: string // CAMPO_DINAMICO ex.: "{{cliente.nome}}"
  tabela?: {
    fonteDados: 'itens' | 'variacoes'
    colunas: ColunaTabela[]
  }
  rotuloAssinatura?: string // ASSINATURA
}

export interface Pagina {
  larguraPt: number
  alturaPt: number
  margemTopoPt: number
  margemBaixoPt: number
  margemEsquerdaPt: number
  margemDireitaPt: number
}

export interface LayoutDocumento {
  versao: 1
  pagina: Pagina
  elementos: Elemento[] // ORDEM = ordem de desenho no PDF (Req 1.6)
}

/** Página A4 padrão com margens de 40pt (base para novos templates). */
export function paginaA4Padrao(): Pagina {
  return {
    larguraPt: A4_LARGURA_PT,
    alturaPt: A4_ALTURA_PT,
    margemTopoPt: 40,
    margemBaixoPt: 40,
    margemEsquerdaPt: 40,
    margemDireitaPt: 40,
  }
}
