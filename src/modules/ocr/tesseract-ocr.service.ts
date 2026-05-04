import { IOcrService, OcrCampo } from './ocr.interface'

const UNIDADES = ['UN', 'RI', 'RL', 'PC', 'CX', 'KG', 'MT', 'M2', 'LT', 'GL', 'FD', 'SC', 'TB', 'PR', 'JG', 'CT', 'PT', 'BD', 'FR', 'GR', 'ML', 'MG', 'M3', 'TON', 'PAR', 'PCT', 'CJ', 'DZ', 'MIL', 'ROL', 'FLS', 'ENV', 'SAC', 'BAR', 'BLD', 'GAL', 'LAT', 'PEL', 'RES', 'VD']
const CODIGO_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{4,}$/

/**
 * Implementação de OCR usando Tesseract.js (gratuito, local).
 * Lê texto de imagens (JPEG, PNG) e extrai códigos de produto + quantidades.
 */
export class TesseractOcrService implements IOcrService {
  async processarImagem(imagem: Buffer, _formato: 'JPEG' | 'PNG' | 'PDF'): Promise<OcrCampo[]> {
    const Tesseract = await import('tesseract.js')

    const worker = await Tesseract.createWorker('por', 1, {
      // @ts-ignore
      logger: () => {}, // silenciar logs
    })

    try {
      const { data } = await worker.recognize(imagem)
      const textoCompleto = data.text
      const confiancaMedia = data.confidence ?? 70

      console.log('[tesseract-ocr] Texto extraído:', textoCompleto.length, 'chars, confiança:', confiancaMedia)

      // Parsear o texto para encontrar códigos e quantidades
      return this.parsearTexto(textoCompleto, confiancaMedia)
    } finally {
      await worker.terminate()
    }
  }

  private parsearTexto(texto: string, confiancaBase: number): OcrCampo[] {
    const linhas = texto.split('\n').map(l => l.trim()).filter(Boolean)
    const campos: OcrCampo[] = []

    for (let i = 0; i < linhas.length; i++) {
      // Formato inline: "1 B17025056 PAPEL... RI 1"
      const matchInline = /^(\d+)\s+([A-Za-z0-9][A-Za-z0-9._/-]{4,})/.exec(linhas[i])
      if (matchInline) {
        const codigo = matchInline[2]
        let textoCompleto = linhas[i]
        let j = i + 1
        while (j < linhas.length && !/^\d+\s+[A-Za-z0-9][A-Za-z0-9._/-]{4,}/.test(linhas[j]) && !CODIGO_RE.test(linhas[j])) {
          textoCompleto += ' ' + linhas[j]
          j++
        }
        const quantidade = this.extrairQuantidade(textoCompleto)
        campos.push({
          nome: codigo,
          valor: String(quantidade),
          confianca: Math.min(confiancaBase, 85),
        })
        continue
      }

      // Formato linhas separadas: número sozinho, código na próxima
      const numLinha = parseInt(linhas[i])
      if (!isNaN(numLinha) && numLinha > 0 && numLinha <= 999 && linhas[i] === String(numLinha)) {
        if (i + 1 < linhas.length && CODIGO_RE.test(linhas[i + 1])) {
          const codigo = linhas[i + 1]
          let quantidade = 0
          for (let j = i + 2; j < Math.min(i + 8, linhas.length); j++) {
            const nextNum = parseInt(linhas[j])
            if (!isNaN(nextNum) && linhas[j] === String(nextNum) && j + 1 < linhas.length && CODIGO_RE.test(linhas[j + 1])) break
            for (const unidade of UNIDADES) {
              if (linhas[j] === unidade && j + 1 < linhas.length) {
                const val = parseFloat(linhas[j + 1].replace(',', '.'))
                if (!isNaN(val)) quantidade = val
                break
              }
            }
            if (quantidade > 0) break
          }
          campos.push({
            nome: codigo,
            valor: String(quantidade),
            confianca: Math.min(confiancaBase, 80),
          })
          i++
        }
      }
    }

    return campos
  }

  private extrairQuantidade(texto: string): number {
    for (const unidade of UNIDADES) {
      const re = new RegExp(`\\b${unidade}\\b\\s+(\\d+[.,]?\\d*)`, 'i')
      const m = re.exec(texto)
      if (m) return parseFloat(m[1].replace(',', '.'))
    }
    const numeros = texto.match(/\b(\d+[.,]?\d*)\b/g)
    if (numeros && numeros.length > 1) {
      return parseFloat(numeros[numeros.length - 1].replace(',', '.'))
    }
    return 0
  }
}
