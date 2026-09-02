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
  veiculos: Array<{ chassi: string; modelo: string; cor: string; cMod: string }>
}

/**
 * Deriva o código do modelo (cMod) para o CT-e a partir da descrição textual
 * do modelo extraída da DANFE. Regra acordada com o cliente (o cMod do CT-e
 * é texto livre, não é cruzado pela SEFAZ — o dado fiscal relevante é o
 * chassi): remove a palavra "Modelo" e usa os 6 primeiros caracteres
 * alfanuméricos (sem espaços) do restante. Ex.: "NEW HRV EXL HS" -> "NEWHRV".
 */
export function derivarCodModelo(descricaoModelo: string): string {
  if (!descricaoModelo) return ''
  // Remover a palavra "Modelo" (com ou sem acento) onde aparecer.
  const semModelo = descricaoModelo.replace(/modelo/gi, ' ')
  // Manter só alfanuméricos, descartando espaços e pontuação.
  const alfanum = semModelo.replace(/[^A-Za-z0-9]/g, '')
  return alfanum.substring(0, 6).toUpperCase()
}

export function parseDanfeTexto(texto: string): DadosDanfeExtraidos {
  // Chave de acesso — pode estar:
  // 1. Como 44 dígitos consecutivos
  // 2. Com espaços entre grupos: 3326 0702 9133 6500 0132 ...
  let chaveAcesso: string | null = null

  const chaveMatch44 = texto.match(/(\d{44})/)
  if (chaveMatch44) {
    chaveAcesso = chaveMatch44[1]
  } else {
    const chaveComEspacos = texto.match(/(\d{4}[\s.]+\d{4}[\s.]+\d{4}[\s.]+\d{4}[\s.]+\d{4}[\s.]+\d{4}[\s.]+\d{4}[\s.]+\d{4}[\s.]+\d{4}[\s.]+\d{4}[\s.]+\d{4})/)
    if (chaveComEspacos) {
      chaveAcesso = chaveComEspacos[1].replace(/\D/g, '')
      if (chaveAcesso.length !== 44) chaveAcesso = null
    }
  }
  if (!chaveAcesso) {
    const blocoNumeros = texto.match(/(?:CHAVE\s*(?:DE\s*)?ACESSO)[:\s]*([\d\s.]{44,60})/i)
    if (blocoNumeros) {
      const limpo = blocoNumeros[1].replace(/\D/g, '')
      if (limpo.length >= 44) chaveAcesso = limpo.substring(0, 44)
    }
  }

  // Número da NF-e — buscar "Nº:" ou "Nr.:" seguido de dígitos
  const nfNumMatch = texto.match(/N[ºr°][.:]?\s*[:\s]*0*(\d+)/i)
  const numero = nfNumMatch ? parseInt(nfNumMatch[1]) : null

  // Série
  const serieMatch = texto.match(/S[ée]rie[:\s]*0*(\d{1,3})/i)
  const serie = serieMatch ? parseInt(serieMatch[1]) : null

  // Valor total — múltiplas tentativas
  let valorTotal = 0
  // Tentativa 1: "VALOR TOTAL: R$ 137.592,00" no cabeçalho
  const valCab = texto.match(/VALOR\s*\n?\s*TOTAL:\s*R\$\s*([\d.,]+)/i)
  if (valCab) {
    valorTotal = parseFloat(valCab[1].replace(/\./g, '').replace(',', '.'))
  }
  // Tentativa 2: "VALOR TOTAL DA NOTA" seguido do valor na mesma ou próxima linha
  if (valorTotal === 0) {
    const valNota = texto.match(/VALOR\s*TOTAL\s*DA\s*NOTA[\s\S]{0,50}?([\d]+[.,][\d.,]+[\d]{2})/i)
    if (valNota) {
      const raw = valNota[1]
      valorTotal = parseFloat(raw.replace(/\./g, '').replace(',', '.'))
    }
  }
  // Tentativa 3: último valor grande antes de "TRANSPORTADOR" (valor total dos produtos)
  if (valorTotal === 0) {
    const valProd = texto.match(/VALOR\s*T\w*\s*(?:DOS\s*)?PRODUTOS[\s\S]{0,200}?([\d]{1,3}(?:\.[\d]{3})*,[\d]{2})/i)
    if (valProd) {
      valorTotal = parseFloat(valProd[1].replace(/\./g, '').replace(',', '.'))
    }
  }

  // Peso bruto
  const pesoMatch = texto.match(/(?:Peso\s*Bruto|PESO\s*B(?:RUTO)?)[:\s]*([\d.,]+)/i)
  const pesoBruto = pesoMatch ? parseFloat(pesoMatch[1].replace(/\./g, '').replace(',', '.')) : 0



  // === EMITENTE ===
  // O nome do emitente geralmente está no topo, antes do DANFE
  // Padrão: "RECEBEMOS DE: <nome>" ou linha com LTDA/S.A./EIRELI no topo
  let razaoEmitente = ''
  const recebemosMatch = texto.match(/RECEBEMOS\s*DE[:\s]*(.+?)(?:\s*OS\s*PRODUTOS|\s*\n)/i)
  if (recebemosMatch) {
    razaoEmitente = recebemosMatch[1].trim()
  }
  if (!razaoEmitente) {
    const linhas = texto.split('\n').filter(l => l.trim().length > 5)
    for (const linha of linhas.slice(0, 15)) {
      if (linha.match(/ltda|s\.?a\.?|eireli|comercio|industria|transportes|veiculos|automotores/i)
        && !linha.match(/DESTINAT|NOME\/RAZ|RECEBEMOS/i)) {
        razaoEmitente = linha.trim().replace(/^#\w+\s*/, '')
        break
      }
    }
  }

  // CNPJs — buscar todos no formato XX.XXX.XXX/XXXX-XX (com separadores)
  const cnpjRegex = /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/g
  const cnpjsRaw = [...texto.matchAll(cnpjRegex)].map(m => m[1].replace(/\D/g, ''))
  // Primeiro CNPJ formatado = emitente; segundo = destinatário
  const cnpjsDistintos = [...new Set(cnpjsRaw.filter(c => c.length === 14))]
  const cnpjEmitente = cnpjsDistintos[0] || ''
  const cnpjDest = cnpjsDistintos.length > 1 ? cnpjsDistintos[1] : ''

  // === DESTINATÁRIO ===
  let razaoDest = ''
  // Padrão 1: "DESTINATÁRIO: XXXXX" no cabeçalho
  const destCab = texto.match(/DESTINAT[ÁA]RIO[:\s]+([A-ZÀ-Ú][A-ZÀ-Ú\s.,&\-]+?(?:LTDA|S\.?A\.?|EIRELI|ME|EPP)[^-\n]*)/i)
  if (destCab) {
    razaoDest = destCab[1].trim().replace(/\s*-\s*$/, '')
  }
  // Padrão 2: buscar após label "NOME/RAZÃO SOCIAL"
  if (!razaoDest) {
    const destNome = texto.match(/NOME\/RAZ[ÃA]O\s*SOCIAL[\s\S]{0,20}?\n([A-ZÀ-Ú][A-ZÀ-Ú\s.,&\-]+?)(?:\s+\d{2}\.\d{3}|\n)/i)
    if (destNome) razaoDest = destNome[1].trim()
  }

  // UFs — extrair do texto, buscar padrões como "NITEROI - RJ" ou "UF\nRJ"
  const ufsValidas = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']
  const ufOcorrencias = [...texto.matchAll(/\b([A-Z]{2})\b/g)]
    .map(m => m[1])
    .filter(u => ufsValidas.includes(u))
  const ufEmitente = ufOcorrencias[0] || ''
  // UF do destinatário — buscar depois da seção DESTINATÁRIO
  const destSection = texto.substring(texto.search(/DESTINAT/i) || 0)
  const ufDestOcorrencias = [...destSection.matchAll(/\b([A-Z]{2})\b/g)]
    .map(m => m[1])
    .filter(u => ufsValidas.includes(u))
  const ufDest = ufDestOcorrencias[0] || ufEmitente

  // Municípios — buscar "CIDADE - UF" no texto (emitente = primeira ocorrência que não é o destino)
  let municipioEmit = ''
  const ufsSet = new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'])
  // Buscar todas as ocorrências de "CIDADE - UF" no texto inteiro
  const linhasTexto = texto.split('\n')
  const cidadesEncontradas: string[] = []
  for (const linha of linhasTexto) {
    const partes = linha.split(/\s+-\s+/)
    if (partes.length >= 2) {
      const cidadeCandidato = partes[0].trim()
      const restante = partes[1].trim()
      const ufCandidato = restante.substring(0, 2)
      if (ufsSet.has(ufCandidato) && cidadeCandidato.length >= 3
        && cidadeCandidato.match(/^[A-ZÀ-Ú]/) && !cidadeCandidato.match(/DESTINAT|VALOR|FOLHA/i)) {
        cidadesEncontradas.push(cidadeCandidato.toUpperCase())
      }
    }
  }
  // Primeira cidade = emitente (local da empresa), segunda = destino (já detectado acima)
  if (cidadesEncontradas.length > 0) {
    municipioEmit = cidadesEncontradas[0]
  }

  let municipioDest = ''
  // Buscar no cabeçalho "DESTINATÁRIO: ... - CIDADE - ..."
  const munDestCab = texto.match(/DESTINAT[ÁA]RIO[:\s]*[^-]*?-\s*([A-ZÀ-Ú\s]+?)\s*-/i)
  if (munDestCab) municipioDest = munDestCab[1].trim()
  // Fallback: buscar "MUNICÍPIO" na seção destinatário
  if (!municipioDest) {
    const destSection2 = texto.substring(texto.search(/DESTINAT[ÁA]RIO\s*REMETENTE/i) || 0)
    const munDest2 = destSection2.match(/\n([A-ZÀ-Ú\s]{3,}?)\s+\d{7,}\s+(RJ|SP|MG)/)
      || destSection2.match(/MUN[IÍ]C[IÍ]PIO[\s\S]{0,50}?\n([A-ZÀ-Ú\s]+?)\s/i)
    if (munDest2) municipioDest = munDest2[1].trim()
  }

  // IE — Inscrição Estadual
  // Buscar todas as ocorrências de números 5-14 dígitos após "INSCRI...ESTADUAL"
  const ieRegex = /INSCRI[^\n]*ESTADUAL[^\n]*\n[^\n]*?(\d{5,14})/gi
  const iesEncontradas: string[] = []
  let ieM
  while ((ieM = ieRegex.exec(texto)) !== null) {
    iesEncontradas.push(ieM[1])
  }
  // Primeira IE = emitente, última IE na seção destinatário
  const ieEmitente = iesEncontradas[0] || ''
  // IE do destinatário: buscar número de 5-14 dígitos sozinho na seção DEST
  let ieDestinatario = ''
  const destSecTexto = texto.substring(texto.search(/DESTINAT/i) || 0)
  // Buscar linhas com apenas um número (5-14 dígitos) após a seção "INSCRIÇÃO ESTADUAL" do dest
  const destLinhas = destSecTexto.split('\n')
  let achouLabelIE = false
  for (const linha of destLinhas) {
    if (linha.match(/INSCRI.*ESTADUAL/i)) {
      achouLabelIE = true
      continue
    }
    if (achouLabelIE) {
      const numSozinho = linha.trim().match(/^(\d{5,14})$/)
      if (numSozinho && numSozinho[1] !== ieEmitente) {
        ieDestinatario = numSozinho[1]
        break
      }
      // Também tentar extrair de uma linha com mais coisas
      const numNaLinha = linha.match(/\b(\d{7,14})\b/)
      if (numNaLinha && numNaLinha[1] !== ieEmitente && !numNaLinha[1].match(/^\d{4}\d{4}$/)) {
        ieDestinatario = numNaLinha[1]
        break
      }
    }
  }

  // Produto / Natureza da operação
  const natOpMatch = texto.match(/NATUREZA\s*(?:DA\s*)?OPERA[ÇC][ÃA]O[:\s]*\n?(.+?)(?:\s+\d{10,}|\n|CNPJ|INSC)/i)
  let produtos = natOpMatch ? natOpMatch[1].trim() : ''
  // Limpar protocolo que pode ter colado (sequencia de dígitos no final)
  produtos = produtos.replace(/\s+\d{10,}.*$/, '').trim()
  if (!produtos) {
    const prodMatch = texto.match(/(?:DESCRI[ÇC][ÃA]O)[:\s]*(.+?)(?:\n|NCM|CFOP)/i)
    if (prodMatch) produtos = prodMatch[1].trim()
  }

  // Veículos — buscar chassi (17 chars alfanuméricos, padrão VIN)
  // Exclui letras I, O, Q conforme regra VIN
  const veiculos: Array<{ chassi: string; modelo: string; cor: string; cMod: string }> = []
  const chassiRegex = /\b([A-HJ-NPR-Z0-9]{17})\b/g
  const chassisEncontrados = [...new Set([...texto.matchAll(chassiRegex)].map(m => m[1]))]
  
  for (const chassi of chassisEncontrados) {
    // Buscar contexto ao redor do chassi (500 chars antes e depois) para localizar modelo e cor
    const chassiIdx = texto.indexOf(chassi)
    const contexto = texto.substring(Math.max(0, chassiIdx - 200), Math.min(texto.length, chassiIdx + 500))

    // Buscar modelo no contexto próximo ao chassi
    let modelo = ''
    const modeloMatch = contexto.match(/(?:Veiculo|Veículo|Modelo)[:\s]*(?:Honda|Toyota|VW|Chevrolet|Fiat|Hyundai|Nissan|Renault|Jeep|Ford|Mitsubishi)?[\/\s]*([A-Za-z0-9\s.]+?)(?:\n|Chassi|Renavam|Motor)/i)
      || contexto.match(/(?:Honda|Toyota|VW|Chevrolet|Fiat|Hyundai|Nissan|Renault|Jeep|Ford|Mitsubishi)\/(?:Modelo\s*)?([A-Za-z0-9\s.]+?)(?:\n|Chassi|Renavam)/i)
    if (modeloMatch) modelo = modeloMatch[1]?.trim().substring(0, 30) || ''

    // Buscar cor externa no contexto próximo ao chassi
    let cor = ''
    const corMatch = contexto.match(/Cor\s*(?:externa|Ext\.?)\s*[:.]?\s*([A-ZÀ-Úa-zà-ú\s]+?)(?:\s{2,}|\n|Cor\s*Int|Num)/i)
    if (corMatch) {
      cor = corMatch[1].trim().toUpperCase()
      // Limitar a 20 chars e remover palavras que não são cor (segurança contra captura de endereço)
      if (cor.length > 20) cor = cor.substring(0, 20).trim()
    }

    veiculos.push({ chassi, modelo, cor, cMod: derivarCodModelo(modelo) })
  }

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
      ie: ieDestinatario,
    },
    valorTotal,
    pesoBruto,
    produtos,
    veiculos,
  }
}
