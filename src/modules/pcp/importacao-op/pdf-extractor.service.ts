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
      const textosPagina = content.items
        .filter((item: any) => 'str' in item)
        .map((item: any) => item.str)
        .join(' ')
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
