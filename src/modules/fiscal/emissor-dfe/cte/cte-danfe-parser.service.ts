/**
 * Parser de DANFE (PDF) para extração de dados da NF-e
 * Extrai chave de acesso, emitente, destinatário, valor, peso via regex sobre texto do PDF
 *
 * Limitação: DANFE simplificado (1 página) não tem todos os campos de um XML completo,
 * mas traz o essencial para gerar CT-e: chave, participantes, valor, origem/destino.
 */

// === Extração de texto do PDF ===

export async function extrairTextoDanfePdf(buffer: Buffer): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const uint8 = new Uint8Array(buffer)
  const doc = await pdfjsLib.getDocument({ data: uint8 }).promise

  const textos: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const items = content.items as any[]

    // Agrupar por Y (linhas), ordenar por X
    const linhas = new Map<number, Array<{ x: number; text: string }>>()
    for (const item of items) {
      if (!item.str || !item.str.trim()) continue
      const y = Math.round(item.transform[5])
      if (!linhas.has(y)) linhas.set(y, [])
      linhas.get(y)!.push({ x: item.transform[4], text: item.str })
    }

    // Ordenar linhas de cima para baixo (Y decrescente), itens por X
    const linhasOrdenadas = [...linhas.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([_, items]) => items.sort((a, b) => a.x - b.x).map(i => i.text).join(' '))

    textos.push(linhasOrdenadas.join('\n'))
  }

  return textos.join('\n\n')
}

// === Parser de dados do DANFE ===

export interface DadosDanfeExtraidos {
  chaveAcesso: string | null
  numero: number | null
  serie: number | null
  emitente: {
    cnpj: string
    razaoSocial: string
    endereco: string
    municipio: string
    uf: string
    ie: string
  }
  destinatario: {
    cnpj: string
    cpf: string
    razaoSocial: string
    endereco: string
    municipio: string
    uf: string
    ie: string
  }
  valorTotal: number
  pesoBruto: number
  produtos: string
}

export function parseDanfeTexto(texto: string): DadosDanfeExtraidos {
  // Chave de acesso (44 dígitos consecutivos)
  const chaveMatch = texto.match(/(\d{44})/)
  const chaveAcesso = chaveMatch ? chaveMatch[1] : null

  // Número e série da NF-e
  const nfMatch = texto.match(/N[º°\.]\s*(\d{1,9})/i)
  const numero = nfMatch ? parseInt(nfMatch[1]) : null
  const serieMatch = texto.match(/S[ée]rie[:\s]*(\d{1,3})/i)
  const serie = serieMatch ? parseInt(serieMatch[1]) : null

  // CNPJ do emitente (primeiro CNPJ encontrado, formato XX.XXX.XXX/XXXX-XX ou 14 dígitos)
  const cnpjsEncontrados = texto.match(/\d{2}[\.\s]?\d{3}[\.\s]?\d{3}[\\/]?\d{4}[-\s]?\d{2}/g) || []
  const cnpjEmitente = cnpjsEncontrados[0]?.replace(/\D/g, '') || ''
  const cnpjDest = cnpjsEncontrados.length > 1 ? cnpjsEncontrados[1].replace(/\D/g, '') : ''

  // Razão social do emitente — geralmente logo após o CNPJ ou no topo
  const razaoEmitMatch = texto.match(/(?:Raz[ãa]o\s*Social|Nome\s*\/\s*Raz[ãa]o)[:\s]*(.+?)(?:\n|CNPJ|CPF)/i)
  let razaoEmitente = razaoEmitMatch ? razaoEmitMatch[1].trim() : ''

  // Fallback: linhas próximas ao topo com nome de empresa
  if (!razaoEmitente) {
    const linhas = texto.split('\n').filter(l => l.trim().length > 5)
    for (const linha of linhas.slice(0, 10)) {
      if (linha.match(/ltda|s\.?a\.?|eireli|me\b|epp\b|comercio|industria|transportes|veiculos/i)) {
        razaoEmitente = linha.trim()
        break
      }
    }
  }

  // Destinatário
  const destMatch = texto.match(/DESTINAT[ÁA]RIO[\s\S]{0,500}?(?:Raz[ãa]o|Nome)[:\s]*(.+?)(?:\n|CNPJ)/i)
  let razaoDest = destMatch ? destMatch[1].trim() : ''
  if (!razaoDest && cnpjsEncontrados.length > 1) {
    // Tentar achar nome próximo ao segundo CNPJ
    const idx = texto.indexOf(cnpjsEncontrados[1])
    if (idx > 0) {
      const trecho = texto.substring(Math.max(0, idx - 200), idx + 200)
      const nomeMatch = trecho.match(/(?:Nome|Raz[ãa]o)[:\s]*(.+?)(?:\n|CNPJ)/i)
      if (nomeMatch) razaoDest = nomeMatch[1].trim()
    }
  }

  // UF — buscar pares de 2 letras maiúsculas que são UFs válidas
  const ufsValidas = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']
  const ufsEncontradas = texto.match(/\b([A-Z]{2})\b/g)?.filter(u => ufsValidas.includes(u)) || []
  const ufEmitente = ufsEncontradas[0] || ''
  const ufDest = ufsEncontradas.length > 1 ? ufsEncontradas[1] : ufEmitente

  // Municípios — buscar próximo ao padrão "Município" ou "Cidade"
  const munEmitMatch = texto.match(/(?:Munic[ií]pio|Cidade)[:\s]*([A-Z\u00C0-\u00FF\s]+?)(?:\s{2,}|[-\/]|\n|UF)/i)
  const municipioEmit = munEmitMatch ? munEmitMatch[1].trim() : ''

  const munDestMatch = texto.match(/DESTINAT[\s\S]{0,800}?(?:Munic[ií]pio|Cidade)[:\s]*([A-Z\u00C0-\u00FF\s]+?)(?:\s{2,}|[-\/]|\n|UF)/i)
  const municipioDest = munDestMatch ? munDestMatch[1].trim() : ''

  // Valor total da NF-e
  const valorMatch = texto.match(/(?:V(?:alor)?\.?\s*(?:Total|T\.?\s*(?:da\s*)?N(?:ota|F)))[:\s]*[R\$]?\s*([\d.,]+)/i)
    || texto.match(/(?:VALOR\s*TOTAL\s*DA\s*NOTA)[:\s]*[R\$]?\s*([\d.,]+)/i)
    || texto.match(/vNF[:\s]*([\d.,]+)/i)
  const valorTotal = valorMatch ? parseFloat(valorMatch[1].replace(/\./g, '').replace(',', '.')) : 0

  // Peso bruto
  const pesoMatch = texto.match(/(?:Peso\s*Bruto|PESO\s*B)[:\s]*([\d.,]+)/i)
  const pesoBruto = pesoMatch ? parseFloat(pesoMatch[1].replace(/\./g, '').replace(',', '.')) : 0

  // Produto predominante (primeiro item)
  const prodMatch = texto.match(/(?:Descri[çc][ãa]o|DESCRICAO)[:\s]*(.+?)(?:\n|NCM|CFOP)/i)
  const produtos = prodMatch ? prodMatch[1].trim().substring(0, 60) : ''

  // IE
  const ieMatch = texto.match(/(?:Inscr[:\.]?\s*Estad|I\.?E\.?)[:\s]*([\d.\-\/]+)/i)
  const ieEmitente = ieMatch ? ieMatch[1].replace(/\D/g, '') : ''

  return {
    chaveAcesso,
    numero,
    serie,
    emitente: {
      cnpj: cnpjEmitente,
      razaoSocial: razaoEmitente,
      endereco: '',
      municipio: municipioEmit,
      uf: ufEmitente,
      ie: ieEmitente,
    },
    destinatario: {
      cnpj: cnpjDest,
      cpf: cnpjDest.length === 11 ? cnpjDest : '',
      razaoSocial: razaoDest,
      endereco: '',
      municipio: municipioDest,
      uf: ufDest,
      ie: '',
    },
    valorTotal,
    pesoBruto,
    produtos,
  }
}
