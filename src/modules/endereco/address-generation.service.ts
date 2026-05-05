import { prisma } from '../../lib/prisma'

export interface GenerationParams {
  centroDistribuicaoId: string
  depositoId: string
  codigoDeposito: string
  codigoZona: string
  zonaId?: string
  estruturaId?: string
  classificacaoProdutoId?: string
  ambienteArmazenagemId?: string
  formaArmazenagemId?: string
  areaArmazenagem?: 'PULMAO' | 'PICKING'
  situacao?: string
  lado?: 'PAR' | 'IMPAR' | 'AMBOS'
  tipo?: string
  ruaInicio: number
  ruaFim: number
  predioInicio: number
  predioFim: number
  nivelInicio: number
  nivelFim: number
  aptoInicio: number
  aptoFim: number
}

export interface GenerationResult {
  criados: number
  ignorados: number
  total: number
  enderecos: Array<{ enderecoCompleto: string; codigoBarras: string }>
}

interface AddressCandidate {
  codigoDeposito: string
  codigoZona: string
  codigoRua: string
  codigoPredio: string
  codigoNivel: string
  codigoApto: string
  enderecoCompleto: string
  codigoBarras: string
  tipo: string
  areaArmazenagem: string
  centroDistribuicaoId: string
  depositoId: string
  zonaId?: string
  estruturaId?: string
  formaArmazenagemId?: string
  ambienteArmazenagemId?: string
  classificacaoProdutoId?: string
}

export class AddressGenerationService {
  /**
   * Generates addresses in batch based on parameterized ranges.
   * Validates parameters, builds the address list, and persists using createMany with skipDuplicates.
   */
  async generate(params: GenerationParams): Promise<GenerationResult> {
    await this.validateParams(params)

    const candidates = this.buildAddressList(params)
    const total = candidates.length

    if (total === 0) {
      return { criados: 0, ignorados: 0, total: 0, enderecos: [] }
    }

    const result = await prisma.endereco.createMany({
      data: candidates,
      skipDuplicates: true,
    })

    const criados = result.count
    const ignorados = total - criados

    const enderecos = candidates.map((c) => ({
      enderecoCompleto: c.enderecoCompleto,
      codigoBarras: c.codigoBarras,
    }))

    return { criados, ignorados, total, enderecos }
  }

  /**
   * Builds the full list of address candidates using nested iteration:
   * Rua → Prédio → Nível → Apartamento (Apto varies fastest).
   * Applies Lado filtering at the Rua level to avoid generating then discarding.
   */
  buildAddressList(params: GenerationParams): AddressCandidate[] {
    const addresses: AddressCandidate[] = []

    for (let rua = params.ruaInicio; rua <= params.ruaFim; rua++) {
      if (!this.filterByLado(rua, params.lado || 'AMBOS')) continue

      for (let predio = params.predioInicio; predio <= params.predioFim; predio++) {
        for (let nivel = params.nivelInicio; nivel <= params.nivelFim; nivel++) {
          for (let apto = params.aptoInicio; apto <= params.aptoFim; apto++) {
            const codigoRua = this.formatSegment(rua)
            const codigoPredio = this.formatSegment(predio)
            const codigoNivel = this.formatSegment(nivel)
            const codigoApto = this.formatSegment(apto)

            const enderecoCompleto = `${params.codigoDeposito}-${params.codigoZona}-${codigoRua}-${codigoPredio}-${codigoNivel}-${codigoApto}`
            const codigoBarras = this.generateBarcode(enderecoCompleto)

            addresses.push({
              codigoDeposito: params.codigoDeposito,
              codigoZona: params.codigoZona,
              codigoRua,
              codigoPredio,
              codigoNivel,
              codigoApto,
              enderecoCompleto,
              codigoBarras,
              tipo: params.situacao || params.tipo || 'ARMAZENAGEM',
              areaArmazenagem: params.areaArmazenagem || 'PULMAO',
              centroDistribuicaoId: params.centroDistribuicaoId,
              depositoId: params.depositoId,
              ...(params.zonaId ? { zonaId: params.zonaId } : {}),
              ...(params.estruturaId ? { estruturaId: params.estruturaId } : {}),
              ...(params.formaArmazenagemId ? { formaArmazenagemId: params.formaArmazenagemId } : {}),
              ...(params.ambienteArmazenagemId ? { ambienteArmazenagemId: params.ambienteArmazenagemId } : {}),
              ...(params.classificacaoProdutoId ? { classificacaoProdutoId: params.classificacaoProdutoId } : {}),
            })
          }
        }
      }
    }

    return addresses
  }

  /**
   * Filters Rua numbers by the Lado parameter.
   * PAR = only even rua numbers, IMPAR = only odd rua numbers, AMBOS = all.
   */
  filterByLado(rua: number, lado: 'PAR' | 'IMPAR' | 'AMBOS'): boolean {
    if (lado === 'AMBOS') return true
    if (lado === 'PAR') return rua % 2 === 0
    return rua % 2 !== 0 // IMPAR
  }

  /**
   * Zero-pads a number to exactly 3 digits.
   * e.g., 1 → "001", 42 → "042", 999 → "999"
   */
  formatSegment(value: number): string {
    return String(value).padStart(3, '0')
  }

  /**
   * Generates a barcode string for a given enderecoCompleto.
   * Format: "E" + numeric hash (8 digits) + check digit (1 digit).
   */
  generateBarcode(enderecoCompleto: string): string {
    const hash = this.numericHash(enderecoCompleto)
    const hashStr = String(hash).padStart(8, '0').slice(0, 8)
    const checkDigit = this.calculateCheckDigit(hashStr)
    return `E${hashStr}${checkDigit}`
  }

  /**
   * Validates generation parameters:
   * - start ≤ end for all ranges
   * - Referenced entities exist in DB
   * - areaArmazenagem is valid
   */
  private async validateParams(params: GenerationParams): Promise<void> {
    // Validate ranges
    if (params.ruaInicio > params.ruaFim) {
      throw { status: 400, message: 'Valor inicial da Rua deve ser menor ou igual ao valor final' }
    }
    if (params.predioInicio > params.predioFim) {
      throw { status: 400, message: 'Valor inicial do Prédio deve ser menor ou igual ao valor final' }
    }
    if (params.nivelInicio > params.nivelFim) {
      throw { status: 400, message: 'Valor inicial do Nível deve ser menor ou igual ao valor final' }
    }
    if (params.aptoInicio > params.aptoFim) {
      throw { status: 400, message: 'Valor inicial do Apartamento deve ser menor ou igual ao valor final' }
    }

    // Validate areaArmazenagem
    if (params.areaArmazenagem && !['PULMAO', 'PICKING'].includes(params.areaArmazenagem)) {
      throw { status: 400, message: 'Área de armazenagem deve ser PULMAO ou PICKING' }
    }

    // Validate referenced entities exist
    const deposito = await prisma.deposito.findUnique({ where: { id: params.depositoId } })
    if (!deposito) {
      throw { status: 404, message: 'Depósito não encontrado' }
    }

    if (params.zonaId) {
      const zona = await prisma.zona.findUnique({ where: { id: params.zonaId } })
      if (!zona) {
        throw { status: 404, message: 'Zona não encontrada' }
      }
    }

    if (params.estruturaId) {
      const estrutura = await prisma.estrutura.findUnique({ where: { id: params.estruturaId } })
      if (!estrutura) {
        throw { status: 404, message: 'Estrutura não encontrada' }
      }
    }
  }

  /**
   * Produces a numeric hash from a string.
   * Uses a simple but effective hashing approach to generate an 8-digit number.
   */
  private numericHash(input: string): number {
    let hash = 0
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i)
      hash = ((hash << 5) - hash + char) | 0
    }
    return Math.abs(hash) % 100000000
  }

  /**
   * Calculates a single check digit using the Luhn-like algorithm (mod 10).
   */
  private calculateCheckDigit(digits: string): number {
    let sum = 0
    for (let i = 0; i < digits.length; i++) {
      const digit = Number(digits[i])
      const weight = (i % 2 === 0) ? 1 : 3
      sum += digit * weight
    }
    return (10 - (sum % 10)) % 10
  }
}
