import { IOcrService, OcrCampo } from './ocr.interface'

/**
 * Implementação placeholder do serviço de OCR.
 *
 * Retorna um array vazio de campos, permitindo que o fluxo manual
 * funcione sem um provedor de OCR real — o operador preenche
 * manualmente todos os campos.
 */
export class MockOcrService implements IOcrService {
  async processarImagem(_imagem: Buffer, _formato: 'JPEG' | 'PNG' | 'PDF'): Promise<OcrCampo[]> {
    return []
  }
}
