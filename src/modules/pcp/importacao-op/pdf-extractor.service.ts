/**
 * Serviço de extração de texto de PDF.
 * Usa pdfjs-dist (legacy build) para extrair texto de arquivos PDF.
 */

export interface PdfExtractionResult {
  texto: string
  paginas: string[]
  totalPaginas: number
  temTexto: boolean
}

/**
 * Reconstrói o texto de uma página preservando linhas e colunas.
 *
 * `page.getTextContent()` retorna os itens de texto SEM ordem geométrica
 * garantida e sem quebras de linha — cada item tem apenas a string e uma
 * matriz de transformação (`transform`), onde `transform[4]` é a posição X
 * e `transform[5]` é a posição Y na página.
 *
 * Antes esta função fazia `items.map(i => i.str).join(' ')`, que colava
 * TODAS as palavras da página em uma única linha com um espaço entre elas.
 * Isso destrói o alinhamento em colunas de tabelas (ex: seção "Materiais"
 * do PDF de OP), fazendo com que colunas como "Pantone 01 (VERDE 7476C)
 * (6%)" e sua quantidade/unidade fiquem coladas com o item seguinte,
 * impedindo o parser de separar nome/quantidade/unidade corretamente.
 *
 * Esta versão agrupa itens pela posição Y (mesma linha, com tolerância),
 * ordena por X dentro da linha, e insere múltiplos espaços quando o
 * espaçamento entre itens é maior que uma largura de caractere — replicando
 * o espaçamento visual de colunas em texto puro, exatamente como os regexes
 * do parser (`\s{2,}`) esperam.
 */
function reconstruirTextoPagina(items: any[]): string {
  const textos = items.filter((item) => typeof item.str === 'string' && item.str.length > 0)
  if (textos.length === 0) return ''

  // Agrupa por linha (posição Y), com tolerância para pequenas variações de baseline
  const TOLERANCIA_Y = 2
  type ItemPos = { str: string; x: number; y: number; largura: number }
  const posicoes: ItemPos[] = textos.map((item) => ({
    str: item.str,
    x: item.transform[4],
    y: item.transform[5],
    largura: item.width || 0,
  }))

  const linhasMap: ItemPos[][] = []
  for (const pos of posicoes) {
    let linha = linhasMap.find((l) => Math.abs(l[0].y - pos.y) <= TOLERANCIA_Y)
    if (!linha) {
      linha = []
      linhasMap.push(linha)
    }
    linha.push(pos)
  }

  // Ordena linhas de cima para baixo (Y maior = mais acima no PDF)
  linhasMap.sort((a, b) => b[0].y - a[0].y)

  const linhasTexto = linhasMap.map((linha) => {
    // Ordena itens da linha da esquerda para a direita
    linha.sort((a, b) => a.x - b.x)

    let linhaStr = ''
    let posEsperada = linha.length > 0 ? linha[0].x : 0
    for (const item of linha) {
      const gap = item.x - posEsperada
      // Largura média de caractere ~ para decidir quantos espaços inserir.
      // Gap pequeno (próxima palavra na mesma "célula"): 1 espaço.
      // Gap grande (nova coluna da tabela): múltiplos espaços, para que os
      // regexes `\s{2,}` do parser identifiquem a quebra de coluna.
      if (linhaStr.length === 0) {
        linhaStr = item.str
      } else if (gap > 8) {
        linhaStr += '  ' + item.str // 2+ espaços = fronteira de coluna
      } else {
        linhaStr += ' ' + item.str
      }
      posEsperada = item.x + item.largura
    }
    return linhaStr
  })

  return linhasTexto.join('\n')
}

/**
 * Extrai texto de um buffer PDF.
 * Retorna o texto completo e metadados.
 */
export async function extrairTextoPdf(buffer: Buffer): Promise<PdfExtractionResult> {
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const uint8 = new Uint8Array(buffer)
    const doc = await pdfjsLib.getDocument({ data: uint8 }).promise

    const paginas: string[] = []

    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      const textosPagina = reconstruirTextoPagina(content.items as any[])
      paginas.push(textosPagina)
    }

    const texto = paginas.join('\n\n')
    const temTexto = texto.replace(/\s/g, '').length > 50

    return {
      texto,
      paginas,
      totalPaginas: doc.numPages,
      temTexto,
    }
  } catch (err: any) {
    if (err.message?.includes('Invalid') || err.message?.includes('invalid')) {
      throw new Error('Arquivo PDF inválido ou corrompido')
    }
    if (err.message?.includes('password') || err.message?.includes('encrypted')) {
      throw new Error('PDF protegido por senha. Remova a proteção antes de importar.')
    }
    throw new Error(`Erro ao processar PDF: ${err.message}`)
  }
}
