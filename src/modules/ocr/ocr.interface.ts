/**
 * Tipo que representa um campo extraído pelo serviço de OCR.
 */
export interface OcrCampo {
  nome: string
  valor: string
  confianca: number // 0-100
  boundingBox?: { x: number; y: number; width: number; height: number }
}

/**
 * Interface abstrata para serviços de OCR.
 *
 * Permite trocar a implementação (mock, Google Vision, etc.)
 * sem alterar as rotas ou lógica de negócio.
 */
export interface IOcrService {
  processarImagem(imagem: Buffer, formato: 'JPEG' | 'PNG' | 'PDF'): Promise<OcrCampo[]>
}
