/**
 * Geração do XML de Carta de Correção Eletrônica (CC-e)
 * Evento tipo 110110 conforme layout SEFAZ NF-e 4.00
 *
 * Referência: Manual de Orientação do Contribuinte - Evento de Carta de Correção
 * Schema: envEvento_v1.00.xsd / e110110_v1.00.xsd
 */

export interface ParamsCCeXml {
  /** Chave de acesso da NF-e (44 dígitos) */
  chNFe: string
  /** Data/hora do evento em formato ISO 8601 (ex: 2024-01-15T10:30:00-03:00) */
  dhEvento: string
  /** Número sequencial do evento para esta NF-e (1 a 20) */
  nSeqEvento: number
  /** Texto livre de correção (mín 15, máx 1000 caracteres conforme SEFAZ) */
  xCorrecao: string
  /** CNPJ do emitente (somente dígitos, 14 posições) */
  cnpjEmitente: string
  /** Código do órgão (UF do emitente — 2 dígitos IBGE) */
  cOrgao: string
  /** Tipo de ambiente: 1 = produção, 2 = homologação */
  tpAmb: number
}

export interface ParamsTextoCCe {
  /** Descrição do item (nome do produto) */
  item: string
  /** Quantidade original registrada na NF-e */
  quantidadeOriginal: number
  /** Quantidade corrigida (conferida fisicamente) */
  quantidadeCorrigida: number
}

/**
 * Escapa caracteres especiais para uso em XML
 */
function esc(val: string | undefined | null): string {
  if (!val) return ''
  return val
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Gera o texto de correção padrão para divergência de quantidade.
 * Formato: "Correção da quantidade do item [ITEM]: de [QTD_ORIGINAL] para [QTD_CORRIGIDA]"
 *
 * @param params - Dados do item e quantidades para compor o texto
 * @returns Texto de correção formatado (mín 15 caracteres conforme SEFAZ)
 */
export function gerarTextoCCe(params: ParamsTextoCCe): string {
  const { item, quantidadeOriginal, quantidadeCorrigida } = params
  return `Correção da quantidade do item ${item}: de ${quantidadeOriginal} para ${quantidadeCorrigida}`
}

/**
 * Gera o XML completo do evento CC-e (tipo 110110) conforme layout SEFAZ.
 *
 * O XML gerado segue a estrutura:
 * - envEvento (envelope do lote de eventos)
 *   - idLote
 *   - evento
 *     - infEvento (Id = "ID" + tpEvento + chNFe + nSeqEvento 2 dígitos)
 *       - cOrgao, tpAmb, CNPJ, chNFe, dhEvento, tpEvento, nSeqEvento, verEvento
 *       - detEvento (versao="1.00")
 *         - descEvento = "Carta de Correcao"
 *         - xCorrecao
 *         - xCondUso (texto padrão de condição de uso)
 *
 * @param params - Parâmetros para geração do XML
 * @returns XML completo do envEvento pronto para assinatura
 */
export function gerarXmlCCe(params: ParamsCCeXml): string {
  const { chNFe, dhEvento, nSeqEvento, xCorrecao, cnpjEmitente, cOrgao, tpAmb } = params

  const seqFormatado = String(nSeqEvento).padStart(2, '0')
  const idEvento = `ID110110${chNFe}${seqFormatado}`

  const xCondUso =
    'A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, ' +
    'de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na emissao de ' +
    'documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que determinam o valor ' +
    'do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da operacao ou ' +
    'da prestacao; II - a correcao de dados cadastrais que implique mudanca do remetente ou do destinatario; ' +
    'III - a data de emissao ou de saida.'

  let xml = `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">`
  xml += `<idLote>${Date.now()}</idLote>`
  xml += `<evento versao="1.00">`
  xml += `<infEvento Id="${idEvento}">`
  xml += `<cOrgao>${esc(cOrgao)}</cOrgao>`
  xml += `<tpAmb>${tpAmb}</tpAmb>`
  xml += `<CNPJ>${cnpjEmitente.replace(/\D/g, '')}</CNPJ>`
  xml += `<chNFe>${chNFe}</chNFe>`
  xml += `<dhEvento>${dhEvento}</dhEvento>`
  xml += `<tpEvento>110110</tpEvento>`
  xml += `<nSeqEvento>${nSeqEvento}</nSeqEvento>`
  xml += `<verEvento>1.00</verEvento>`
  xml += `<detEvento versao="1.00">`
  xml += `<descEvento>Carta de Correcao</descEvento>`
  xml += `<xCorrecao>${esc(xCorrecao)}</xCorrecao>`
  xml += `<xCondUso>${xCondUso}</xCondUso>`
  xml += `</detEvento>`
  xml += `</infEvento>`
  xml += `</evento>`
  xml += `</envEvento>`

  return xml
}
