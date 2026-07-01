/**
 * Parser XML → objetos tipados
 * Converte XMLs de NF-e autorizada, retornos SEFAZ e eventos em objetos TypeScript tipados.
 * Usa fast-xml-parser com configuração para ignorar namespaces.
 *
 * Requirements: 36.4
 */

import { XMLParser } from 'fast-xml-parser'

// === Interfaces ===

export interface NFeAutorizada {
  chaveAcesso: string
  protocolo: string
  dataAutorizacao: string
  emitente: { cnpj: string; razaoSocial: string; uf: string }
  destinatario: { cpfCnpj?: string; razaoSocial?: string; uf?: string }
  itens: Array<{ nItem: number; descricao: string; ncm: string; cfop: string; valor: number }>
  totais: { valorProdutos: number; valorTotal: number; valorICMS: number }
}

export interface RetornoSefaz {
  codigoStatus: number
  motivoStatus: string
  protocolo?: string
  dataRecebimento?: string
  xmlRetorno?: string
}

export interface EventoSefaz {
  tipoEvento: string
  sequencia: number
  protocolo?: string
  dataEvento: string
}

// === Parser configurado para ignorar namespaces ===

function createParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: true,
    trimValues: true,
    numberParseOptions: {
      leadingZeros: false,
      hex: false,
      skipLike: /^\d{15,}$/,  // Não parsear números com 15+ dígitos (chaves, protocolos, CNPJ)
    },
    isArray: (name) => {
      // Tags que sempre devem ser tratadas como array
      return name === 'det' || name === 'vol'
    },
  })
}

// === Funções auxiliares ===

function getNestedValue(obj: any, ...paths: string[]): any {
  for (const path of paths) {
    const keys = path.split('.')
    let value = obj
    for (const key of keys) {
      if (value == null) break
      value = value[key]
    }
    if (value != null) return value
  }
  return undefined
}

function toNumber(value: any): number {
  if (value == null) return 0
  const num = Number(value)
  return isNaN(num) ? 0 : num
}

function toString(value: any): string {
  if (value == null) return ''
  return String(value)
}

// === Funções principais de parsing ===

/**
 * Converte XML de NF-e autorizada (nfeProc) em objeto tipado.
 * Aceita tanto o XML com envelope `nfeProc` quanto o XML da `NFe` diretamente.
 */
export function parseNFeAutorizada(xml: string): NFeAutorizada {
  const parser = createParser()
  const parsed = parser.parse(xml)

  // Navegar na estrutura: nfeProc > NFe > infNFe / protNFe
  const nfeProc = parsed.nfeProc || parsed
  const nfe = nfeProc.NFe || nfeProc
  const infNFe = nfe.infNFe || nfe

  // Protocolo de autorização
  const protNFe = nfeProc.protNFe || {}
  const infProt = protNFe.infProt || {}

  // Chave de acesso - pode estar no atributo Id da infNFe ou no protocolo
  const chaveAcesso = toString(infProt.chNFe || extractChaveFromId(infNFe['@_Id']) || '')

  // Dados do emitente
  const emit = infNFe.emit || {}
  const emitente = {
    cnpj: toString(emit.CNPJ),
    razaoSocial: toString(emit.xNome),
    uf: toString(emit.enderEmit?.UF || ''),
  }

  // Dados do destinatário
  const dest = infNFe.dest || {}
  const destinatario = {
    cpfCnpj: toString(dest.CNPJ || dest.CPF || ''),
    razaoSocial: toString(dest.xNome || ''),
    uf: toString(dest.enderDest?.UF || ''),
  }

  // Itens
  const detArray = ensureArray(infNFe.det)
  const itens = detArray.map((det: any) => {
    const prod = det.prod || {}
    return {
      nItem: toNumber(det['@_nItem']),
      descricao: toString(prod.xProd),
      ncm: toString(prod.NCM),
      cfop: toString(prod.CFOP),
      valor: toNumber(prod.vProd),
    }
  })

  // Totais
  const ICMSTot = getNestedValue(infNFe, 'total.ICMSTot') || {}
  const totais = {
    valorProdutos: toNumber(ICMSTot.vProd),
    valorTotal: toNumber(ICMSTot.vNF),
    valorICMS: toNumber(ICMSTot.vICMS),
  }

  return {
    chaveAcesso,
    protocolo: toString(infProt.nProt),
    dataAutorizacao: toString(infProt.dhRecbto),
    emitente,
    destinatario,
    itens,
    totais,
  }
}

/**
 * Converte XML de retorno SEFAZ (retorno de autorização, cancelamento, etc.) em objeto tipado.
 * Suporta múltiplos formatos: retEnviNFe, retConsReciNFe, retConsSitNFe, retCancNFe.
 */
export function parseRetornoSefaz(xml: string): RetornoSefaz {
  const parser = createParser()
  const parsed = parser.parse(xml)

  // Tentar localizar o nó de protocolo em diferentes formatos de retorno
  const infProt = findInfProt(parsed)
  const infRet = findInfRet(parsed)

  // Priorizar infProt se presente (retorno de autorização com protocolo)
  if (infProt) {
    return {
      codigoStatus: toNumber(infProt.cStat),
      motivoStatus: toString(infProt.xMotivo),
      protocolo: infProt.nProt ? toString(infProt.nProt) : undefined,
      dataRecebimento: infProt.dhRecbto ? toString(infProt.dhRecbto) : undefined,
      xmlRetorno: xml,
    }
  }

  // Retorno sem protocolo específico (status de lote, rejeição, etc.)
  if (infRet) {
    return {
      codigoStatus: toNumber(infRet.cStat),
      motivoStatus: toString(infRet.xMotivo),
      protocolo: infRet.nProt ? toString(infRet.nProt) : undefined,
      dataRecebimento: infRet.dhRecbto ? toString(infRet.dhRecbto) : undefined,
      xmlRetorno: xml,
    }
  }

  // Fallback: tentar extrair de qualquer nó raiz que tenha cStat
  const root = findRootWithStatus(parsed)
  return {
    codigoStatus: toNumber(root?.cStat ?? 0),
    motivoStatus: toString(root?.xMotivo ?? ''),
    protocolo: root?.nProt ? toString(root.nProt) : undefined,
    dataRecebimento: root?.dhRecbto ? toString(root.dhRecbto) : undefined,
    xmlRetorno: xml,
  }
}

/**
 * Converte XML de evento SEFAZ (cancelamento, CC-e, manifestação, etc.) em objeto tipado.
 * Suporta tanto o procEventoNFe (evento + retorno) quanto o retEvento isolado.
 */
export function parseEventoSefaz(xml: string): EventoSefaz {
  const parser = createParser()
  const parsed = parser.parse(xml)

  // Procurar infEvento no procEventoNFe ou evento isolado
  const procEvento = parsed.procEventoNFe || parsed
  const evento = procEvento.evento || procEvento
  const infEvento = evento.infEvento || {}

  // Procurar retEvento para obter protocolo
  const retEvento = procEvento.retEvento || {}
  const infEventoRet = retEvento.infEvento || {}

  return {
    tipoEvento: toString(infEvento.tpEvento),
    sequencia: toNumber(infEvento.nSeqEvento),
    protocolo: infEventoRet.nProt
      ? toString(infEventoRet.nProt)
      : (infEvento.nProt ? toString(infEvento.nProt) : undefined),
    dataEvento: toString(infEvento.dhEvento || infEventoRet.dhRegEvento || ''),
  }
}

// === Helpers internos ===

function ensureArray(value: any): any[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function extractChaveFromId(id: string | undefined): string | undefined {
  if (!id) return undefined
  // O Id normalmente é "NFe" + 44 dígitos da chave
  const match = id.match(/\d{44}/)
  return match ? match[0] : undefined
}

/**
 * Busca recursivamente o nó infProt em retornos SEFAZ.
 */
function findInfProt(obj: any): any {
  if (obj == null || typeof obj !== 'object') return null

  if (obj.infProt) return obj.infProt

  // Procurar em protNFe (retorno de autorização)
  if (obj.protNFe?.infProt) return obj.protNFe.infProt

  // Procurar em retorno de recibo (retConsReciNFe > protNFe)
  for (const key of Object.keys(obj)) {
    if (key.startsWith('ret') || key === 'protNFe') {
      const found = findInfProt(obj[key])
      if (found) return found
    }
  }

  return null
}

/**
 * Busca nó raiz de retorno (retEnviNFe, retConsReciNFe, retConsSitNFe, etc.)
 * que contém diretamente cStat e xMotivo.
 */
function findInfRet(obj: any): any {
  if (obj == null || typeof obj !== 'object') return null

  for (const key of Object.keys(obj)) {
    if (key.startsWith('ret') || key.startsWith('inf')) {
      const node = obj[key]
      if (node && typeof node === 'object' && node.cStat != null) {
        return node
      }
      // Procurar um nível mais fundo
      if (node && typeof node === 'object') {
        for (const subKey of Object.keys(node)) {
          if (subKey.startsWith('inf')) {
            const subNode = node[subKey]
            if (subNode && subNode.cStat != null) return subNode
          }
        }
      }
    }
  }

  return null
}

/**
 * Fallback: encontrar qualquer nó que possua cStat.
 */
function findRootWithStatus(obj: any): any {
  if (obj == null || typeof obj !== 'object') return null
  if (obj.cStat != null) return obj

  for (const key of Object.keys(obj)) {
    const found = findRootWithStatus(obj[key])
    if (found) return found
  }

  return null
}
