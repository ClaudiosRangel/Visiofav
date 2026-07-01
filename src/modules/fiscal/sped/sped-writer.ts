/**
 * SPED Writer Streaming
 * 
 * Gera arquivos SPED no formato oficial:
 * - Encoding: ISO-8859-1 (latin1)
 * - Delimitador de campo: pipe (|)
 * - Delimitador de registro: CR+LF (\r\n)
 * - Geração automática do Bloco 9 (controle e encerramento)
 * 
 * Abordagem streaming: acumula chunks de Buffer para eficiência de memória
 * em arquivos grandes (100k+ registros).
 * 
 * @see Requirements 14.5
 */

import { BlocoSPED, type RegistroSPED, type SPEDWriterConfig } from './tipos'

const DEFAULT_CONFIG: Required<SPEDWriterConfig> = {
  encoding: 'ISO-8859-1',
  delimitadorCampo: '|',
  delimitadorRegistro: '\r\n',
}

/**
 * Contadores internos por bloco para geração do Bloco 9
 */
interface BlocoCounter {
  /** Total de registros no bloco (incluindo abertura e encerramento) */
  totalRegistros: number
  /** Contagem por tipo de registro dentro do bloco (ex: C100: 5, C170: 20) */
  registrosPorTipo: Map<string, number>
}

/**
 * SPEDWriter - Writer streaming para geração de arquivos SPED
 * 
 * Uso:
 * ```ts
 * const writer = new SPEDWriter()
 * writer.writeRegistro('0', '0000', ['campo1', 'campo2', ...])
 * writer.writeRegistro('C', 'C100', ['campo1', 'campo2', ...])
 * // ... mais registros
 * const arquivo = writer.finalize()
 * ```
 */
export class SPEDWriter {
  private readonly config: Required<SPEDWriterConfig>
  private readonly chunks: Buffer[] = []
  private readonly counters: Map<string, BlocoCounter> = new Map()
  private totalRegistros = 0
  private finalized = false

  constructor(config?: SPEDWriterConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Escreve um registro (linha) no arquivo SPED.
   * 
   * Formato: |TIPO|campo1|campo2|...|campoN|\r\n
   * 
   * @param bloco - Identificador do bloco (0, C, D, E, etc.)
   * @param tipo - Tipo do registro (ex: '0000', 'C100', 'E110')
   * @param campos - Array de valores dos campos (strings)
   * @throws Error se o writer já foi finalizado
   */
  writeRegistro(bloco: string, tipo: string, campos: string[]): void {
    if (this.finalized) {
      throw new Error('SPEDWriter já foi finalizado. Crie uma nova instância para um novo arquivo.')
    }

    // Monta a linha no formato SPED: |TIPO|campo1|campo2|...|
    const delim = this.config.delimitadorCampo
    const linha = `${delim}${tipo}${delim}${campos.join(delim)}${delim}${this.config.delimitadorRegistro}`

    // Converte para ISO-8859-1 e adiciona ao buffer
    const buffer = Buffer.from(linha, 'latin1')
    this.chunks.push(buffer)

    // Atualiza contadores
    this.incrementarContador(bloco, tipo)
    this.totalRegistros++
  }

  /**
   * Finaliza o arquivo SPED gerando automaticamente o Bloco 9.
   * 
   * O Bloco 9 contém:
   * - Registro 9001 (abertura do bloco)
   * - Registros 9900 (contagem de registros por tipo em cada bloco)
   * - Registro 9990 (total de registros do Bloco 9)
   * - Registro 9999 (total geral de registros do arquivo)
   * 
   * @returns Buffer com o conteúdo completo do arquivo em ISO-8859-1
   * @throws Error se já foi finalizado anteriormente
   */
  finalize(): Buffer {
    if (this.finalized) {
      throw new Error('SPEDWriter já foi finalizado.')
    }

    this.finalized = true

    // Gera registros do Bloco 9
    const bloco9Registros = this.gerarBloco9()

    // Adiciona Bloco 9 ao buffer
    const delim = this.config.delimitadorCampo
    for (const reg of bloco9Registros) {
      const linha = `${delim}${reg.tipo}${delim}${reg.campos.join(delim)}${delim}${this.config.delimitadorRegistro}`
      const buffer = Buffer.from(linha, 'latin1')
      this.chunks.push(buffer)
    }

    return Buffer.concat(this.chunks)
  }

  /**
   * Retorna a contagem de registros por bloco (sem Bloco 9).
   * Útil para validação antes de finalizar.
   */
  getContadores(): Record<string, number> {
    const result: Record<string, number> = {}
    for (const [bloco, counter] of this.counters) {
      result[bloco] = counter.totalRegistros
    }
    return result
  }

  /**
   * Retorna o total de registros escritos até o momento (sem Bloco 9).
   */
  getTotalRegistros(): number {
    return this.totalRegistros
  }

  /**
   * Verifica se o writer já foi finalizado.
   */
  isFinalized(): boolean {
    return this.finalized
  }

  // === Private Methods ===

  private incrementarContador(bloco: string, tipo: string): void {
    if (!this.counters.has(bloco)) {
      this.counters.set(bloco, {
        totalRegistros: 0,
        registrosPorTipo: new Map(),
      })
    }

    const counter = this.counters.get(bloco)!
    counter.totalRegistros++

    const currentCount = counter.registrosPorTipo.get(tipo) ?? 0
    counter.registrosPorTipo.set(tipo, currentCount + 1)
  }

  /**
   * Gera os registros do Bloco 9 (controle e encerramento).
   * 
   * Estrutura:
   * - 9001: Abertura do Bloco 9 (0 = com dados)
   * - 9900: Um registro para cada tipo de registro existente no arquivo
   *         (incluindo os do próprio Bloco 9)
   * - 9990: Encerramento com total de linhas do Bloco 9
   * - 9999: Total geral do arquivo
   */
  private gerarBloco9(): RegistroSPED[] {
    const registros: RegistroSPED[] = []

    // 9001 - Abertura do Bloco 9 (IND_MOV: 0 = com movimento)
    registros.push({
      bloco: '9',
      tipo: '9001',
      campos: ['0'],
    })

    // 9900 - Um para cada tipo de registro no arquivo
    // Coleta todos os tipos de registro de todos os blocos
    const registrosPorTipo = new Map<string, number>()

    for (const [, counter] of this.counters) {
      for (const [tipo, count] of counter.registrosPorTipo) {
        const current = registrosPorTipo.get(tipo) ?? 0
        registrosPorTipo.set(tipo, current + count)
      }
    }

    // Ordena por tipo de registro para consistência
    const tiposOrdenados = Array.from(registrosPorTipo.entries()).sort(
      ([a], [b]) => a.localeCompare(b)
    )

    // Calcula quantos registros 9900 teremos
    // Para cada tipo existente + 9001 + 9900 + 9990 + 9999
    const total9900 = tiposOrdenados.length + 4 // +4 pelos registros do próprio Bloco 9

    for (const [tipo, count] of tiposOrdenados) {
      registros.push({
        bloco: '9',
        tipo: '9900',
        campos: [tipo, String(count)],
      })
    }

    // 9900 para os registros do próprio Bloco 9
    registros.push({
      bloco: '9',
      tipo: '9900',
      campos: ['9001', '1'],
    })
    registros.push({
      bloco: '9',
      tipo: '9900',
      campos: ['9900', String(total9900)],
    })
    registros.push({
      bloco: '9',
      tipo: '9900',
      campos: ['9990', '1'],
    })
    registros.push({
      bloco: '9',
      tipo: '9900',
      campos: ['9999', '1'],
    })

    // 9990 - Encerramento do Bloco 9 (total de linhas do Bloco 9)
    // Total = 9001(1) + 9900(total9900) + 9990(1) + 9999(1)
    const totalBloco9 = 1 + total9900 + 1 + 1
    registros.push({
      bloco: '9',
      tipo: '9990',
      campos: [String(totalBloco9)],
    })

    // 9999 - Encerramento do arquivo (total geral de registros)
    // Total de registros = registros já escritos + registros do Bloco 9
    const totalGeral = this.totalRegistros + totalBloco9
    registros.push({
      bloco: '9',
      tipo: '9999',
      campos: [String(totalGeral)],
    })

    return registros
  }
}
