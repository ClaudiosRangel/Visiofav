import { prisma } from '../../lib/prisma'
import { IOcrService } from './ocr.interface'
import { MockOcrService } from './mock-ocr.service'
import { TesseractOcrService } from './tesseract-ocr.service'

/**
 * Factory que retorna a implementação correta de IOcrService
 * com base no parâmetro `WMS_OCR_PROVIDER` configurado para a empresa.
 *
 * Valores suportados:
 *  - "TESSERACT" (padrão): TesseractOcrService — OCR local gratuito via Tesseract.js
 *  - "MOCK": MockOcrService — campos vazios para preenchimento manual
 *  - "GOOGLE_VISION": placeholder para futura integração com Google Cloud Vision API
 */
export async function criarOcrService(empresaId: string): Promise<IOcrService> {
  const parametro = await prisma.parametro.findUnique({
    where: { empresaId_chave: { empresaId, chave: 'WMS_OCR_PROVIDER' } },
    select: { valor: true },
  })

  const provider = parametro?.valor ?? 'MOCK'

  switch (provider) {
    case 'TESSERACT':
      return new TesseractOcrService()

    case 'GOOGLE_VISION':
      throw new Error('Provedor GOOGLE_VISION ainda não implementado')

    case 'MOCK':
    default:
      return new TesseractOcrService() // Usar Tesseract como padrão em vez de mock
  }
}
