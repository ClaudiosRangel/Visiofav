/**
 * Parser de XML de NF-e (Nota Fiscal Eletrônica)
 * Extrai dados do cabeçalho e itens incluindo cEAN, cEANTrib, uTrib, qTrib.
 */

import { extrairBlocoTransporte, DadosTransporteXml } from './transporte-xml-parser'

function getTag(tag: string, source: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i')
  const match = source.match(regex)
  return match ? match[1].trim() : ''
}

function getBlock(tag: string, source: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  const match = source.match(regex)
  return match ? match[1] : ''
}

function getAllBlocks(tag: string, source: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, 'gi')
  return source.match(regex) || []
}

/**
 * Normaliza valores EAN: "SEM GTIN" e strings vazias viram null.
 */
function normalizeEan(value: string): string | null {
  if (!value || value.trim() === '' || value.trim().toUpperCase() === 'SEM GTIN') {
    return null
  }
  return value.trim()
}

export function formatCnpj(cnpj: string): string {
  if (!cnpj || cnpj.length !== 14) return cnpj
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`
}

export function parseNfeXml(xml: string) {
  // Dados da NF
  const ide = getBlock('ide', xml)
  const numero = parseInt(getTag('nNF', ide)) || 0
  const serie = getTag('serie', ide)
  const dataEmissao = getTag('dhEmi', ide).substring(0, 10) // YYYY-MM-DD

  // Emitente (fornecedor)
  const emit = getBlock('emit', xml)
  const fornecedor = getTag('xNome', emit)
  const fornecedorDoc = getTag('CNPJ', emit)

  // Transportadora
  const transp = getBlock('transp', xml)
  const transportadoraBlock = getBlock('transporta', transp)
  const transportadora = getTag('xNome', transportadoraBlock)

  // Bloco de transporte (placa, UF, RNTC, motorista) — implementação única compartilhada
  const transporte: DadosTransporteXml = extrairBlocoTransporte(xml)

  // Itens
  const dets = getAllBlocks('det', xml)
  const itens = dets.map((det, index) => {
    const prod = getBlock('prod', det)
    const rawCEAN = getTag('cEAN', prod)
    const rawCEANTrib = getTag('cEANTrib', prod)
    const rawUTrib = getTag('uTrib', prod)
    const rawQTrib = getTag('qTrib', prod)

    // Extrair lote e validade do bloco <rastro> dentro do item
    const rastros = getAllBlocks('rastro', prod)
    let lote = ''
    let validade: string | null = null
    if (rastros.length > 0) {
      // Usar o primeiro rastro do item
      lote = getTag('nLote', rastros[0]) || ''
      const dFab = getTag('dFab', rastros[0]) // data fabricação
      const dVal = getTag('dVal', rastros[0]) // data validade
      validade = dVal || null
    }

    return {
      item: index + 1,
      codigoProduto: getTag('cProd', prod),
      descricao: getTag('xProd', prod),
      unidade: getTag('uCom', prod),
      quantidade: parseFloat(getTag('qCom', prod)) || 0,
      valorUnitario: parseFloat(getTag('vUnCom', prod)) || 0,
      valorTotal: parseFloat(getTag('vProd', prod)) || 0,
      ncm: getTag('NCM', prod),
      ean: normalizeEan(rawCEAN) || '',
      cEAN: normalizeEan(rawCEAN),
      cEANTrib: normalizeEan(rawCEANTrib),
      uTrib: rawUTrib || null,
      qTrib: rawQTrib ? parseFloat(rawQTrib) || null : null,
      lote,
      validade,
    }
  })

  return {
    numero,
    serie,
    dataEmissao,
    fornecedor,
    fornecedorDoc: formatCnpj(fornecedorDoc),
    fornecedorDocRaw: fornecedorDoc,
    transportadora,
    transporte,
    tipo: 'COMPRA',
    itens,
  }
}
