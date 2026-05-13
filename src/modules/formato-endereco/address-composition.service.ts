/**
 * AddressCompositionService — Serviço puro (sem I/O) responsável por
 * compor, decompor e validar endereços conforme o formato configurado.
 */

export interface FormatoEnderecoSegmento {
  /** Nome lógico do segmento (ex: "Rua", "Posição", "Corredor") */
  nome: string
  /** Campo físico no modelo Prisma para onde este segmento mapeia */
  campoFisico: 'codigoDeposito' | 'codigoZona' | 'codigoRua' | 'codigoPredio' | 'codigoNivel' | 'codigoApto'
  /** Ordem do segmento na composição do enderecoCompleto (1-based) */
  ordem: number
  /** Se o segmento usa zero-padding numérico (3 dígitos) */
  numerico: boolean
  /** Prefixo fixo opcional (ex: "PICK", "DOCA") */
  prefixo?: string
}

export interface FormatoEndereco {
  id: string
  nome: string
  descricao?: string
  segmentos: FormatoEnderecoSegmento[]
  empresaId: string
  criadoEm: Date
}

export interface ValidacaoResult {
  valido: boolean
  erro?: string
}

export class AddressCompositionService {
  /**
   * Formata um valor de segmento aplicando zero-padding (3 dígitos) para numéricos
   * e prefixo quando configurado.
   *
   * Exemplos:
   *  - numerico=true, valor=1 → "001"
   *  - numerico=true, prefixo="DOCA", valor=1 → "DOCA001"
   *  - numerico=false, prefixo="AVARIA", valor="A" → "AVARIAA"
   */
  formatarSegmento(segmento: FormatoEnderecoSegmento, valor: string | number): string {
    let valorFormatado: string

    if (segmento.numerico) {
      const numVal = typeof valor === 'number' ? valor : parseInt(String(valor), 10)
      valorFormatado = String(numVal).padStart(3, '0')
    } else {
      valorFormatado = String(valor)
    }

    if (segmento.prefixo) {
      return `${segmento.prefixo}${valorFormatado}`
    }

    return valorFormatado
  }

  /**
   * Compõe o enderecoCompleto a partir dos valores dos segmentos ativos.
   * Ordena segmentos por `ordem`, aplica formatarSegmento a cada um,
   * e concatena com hífen.
   *
   * @param formato - O formato de endereço com segmentos definidos
   * @param valores - Mapa de campoFisico → valor bruto
   * @returns enderecoCompleto (ex: "001-002-003")
   */
  compor(formato: FormatoEndereco, valores: Record<string, string | number>): string {
    const segmentosOrdenados = [...formato.segmentos].sort((a, b) => a.ordem - b.ordem)

    const partes = segmentosOrdenados.map((segmento) => {
      const valor = valores[segmento.campoFisico]
      return this.formatarSegmento(segmento, valor ?? '')
    })

    return partes.join('-')
  }

  /**
   * Decompõe um enderecoCompleto nos segmentos individuais.
   * Faz split por hífen, valida número de segmentos, e retorna
   * mapa campoFisico → valor.
   *
   * @param formato - O formato de endereço com segmentos definidos
   * @param enderecoCompleto - String do endereço (ex: "001-002-003")
   * @returns Mapa de campoFisico → valor do segmento
   * @throws Erro se número de segmentos não corresponde ao formato
   */
  decompor(formato: FormatoEndereco, enderecoCompleto: string): Record<string, string> {
    const partes = enderecoCompleto.split('-')
    const segmentosOrdenados = [...formato.segmentos].sort((a, b) => a.ordem - b.ordem)

    if (partes.length !== segmentosOrdenados.length) {
      throw new Error(
        `Endereço '${enderecoCompleto}' não corresponde ao formato '${formato.nome}': esperados ${segmentosOrdenados.length} segmentos, encontrados ${partes.length}`
      )
    }

    const resultado: Record<string, string> = {}

    segmentosOrdenados.forEach((segmento, index) => {
      resultado[segmento.campoFisico] = partes[index]
    })

    return resultado
  }

  /**
   * Valida se um enderecoCompleto é compatível com o formato.
   * Verifica número de segmentos separados por hífen.
   *
   * @param formato - O formato de endereço com segmentos definidos
   * @param enderecoCompleto - String do endereço a validar
   * @returns { valido: true } ou { valido: false, erro: string }
   */
  validar(formato: FormatoEndereco, enderecoCompleto: string): ValidacaoResult {
    const partes = enderecoCompleto.split('-')
    const segmentosOrdenados = [...formato.segmentos].sort((a, b) => a.ordem - b.ordem)

    if (partes.length !== segmentosOrdenados.length) {
      return {
        valido: false,
        erro: `Endereço '${enderecoCompleto}' não corresponde ao formato '${formato.nome}': esperados ${segmentosOrdenados.length} segmentos, encontrados ${partes.length}`,
      }
    }

    return { valido: true }
  }
}
