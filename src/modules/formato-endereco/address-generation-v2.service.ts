import { prisma } from '../../lib/prisma'
import { AddressCompositionService, FormatoEndereco } from './address-composition.service'
import { validarEndereco } from './address-validation.service'
import { ALL_CAMPOS, CampoFisico } from './formato-endereco.types'
import * as FormatoEnderecoService from './formato-endereco.service'

export interface GenerationParamsV2 {
  centroDistribuicaoId: string
  depositoId: string
  zonaId?: string
  formatoEnderecoId?: string

  /** Faixas de geração — apenas os segmentos ativos do formato */
  faixas: Array<{
    campoFisico: string
    inicio: number
    fim: number
  }>

  // Campos opcionais existentes
  estruturaId?: string
  classificacaoProdutoId?: string
  ambienteArmazenagemId?: string
  formaArmazenagemId?: string
  areaArmazenagem?: 'PULMAO' | 'PICKING'
  tipo?: string
  lado?: 'PAR' | 'IMPAR' | 'AMBOS'
  nivelPicking?: number
  empresaId?: string
}

export interface GenerationResultV2 {
  criados: number
  ignorados: number
  total: number
  enderecos: Array<{ enderecoCompleto: string; codigoBarras: string }>
}

export class AddressGenerationV2Service {
  private compositionService = new AddressCompositionService()

  /**
   * Gera endereços em batch baseado em faixas para segmentos ativos do formato.
   * 1. Resolve formato
   * 2. Valida faixas
   * 3. Gera combinações cartesianas
   * 4. Compõe enderecoCompleto, gera barcode, valida, persiste
   */
  async gerarEnderecos(params: GenerationParamsV2): Promise<GenerationResultV2> {
    // 1. Resolver formato
    const formato = params.formatoEnderecoId
      ? await this.resolverFormatoPorId(params.formatoEnderecoId)
      : await FormatoEnderecoService.resolverFormato(params.depositoId, params.zonaId)

    // 2. Validar faixas
    this.validarFaixas(params.faixas, formato)

    // 3. Gerar combinações cartesianas com filtro de lado
    const combinacoes = this.gerarCombinacoes(params.faixas, params.lado)

    if (combinacoes.length === 0) {
      return { criados: 0, ignorados: 0, total: 0, enderecos: [] }
    }

    // 4. Para cada combinação: compor, gerar barcode, validar, persistir
    const candidates = this.buildCandidates(combinacoes, formato, params)

    const result = await prisma.endereco.createMany({
      data: candidates,
      skipDuplicates: true,
    })

    const criados = result.count
    const ignorados = candidates.length - criados

    const enderecos = candidates.map((c) => ({
      enderecoCompleto: c.enderecoCompleto!,
      codigoBarras: c.codigoBarras!,
    }))

    return { criados, ignorados, total: candidates.length, enderecos }
  }

  /**
   * Resolve formato por ID direto.
   */
  private async resolverFormatoPorId(formatoEnderecoId: string): Promise<FormatoEndereco> {
    const formato = await FormatoEnderecoService.buscarPorId(formatoEnderecoId)
    if (!formato) {
      throw { status: 404, message: 'Formato de endereço não encontrado' }
    }
    return formato
  }

  /**
   * Valida que todas as faixas têm inicio <= fim e correspondem a segmentos ativos.
   */
  private validarFaixas(
    faixas: GenerationParamsV2['faixas'],
    formato: FormatoEndereco
  ): void {
    const camposAtivos = new Set(formato.segmentos.map((s) => s.campoFisico))

    for (const faixa of faixas) {
      if (faixa.inicio > faixa.fim) {
        const segmento = formato.segmentos.find((s) => s.campoFisico === faixa.campoFisico)
        const nomeSegmento = segmento?.nome ?? faixa.campoFisico
        throw {
          status: 400,
          message: `Valor inicial de ${nomeSegmento} deve ser menor ou igual ao valor final`,
        }
      }

      if (!camposAtivos.has(faixa.campoFisico as CampoFisico)) {
        throw {
          status: 400,
          message: `Campo '${faixa.campoFisico}' não é um segmento ativo do formato '${formato.nome}'`,
        }
      }
    }
  }

  /**
   * Gera o produto cartesiano de todas as faixas.
   * Aplica filtro de lado (PAR/IMPAR) na primeira faixa.
   */
  private gerarCombinacoes(
    faixas: GenerationParamsV2['faixas'],
    lado?: 'PAR' | 'IMPAR' | 'AMBOS'
  ): Array<Record<string, number>> {
    if (faixas.length === 0) return []

    // Gerar valores para cada faixa
    const faixasExpandidas = faixas.map((faixa, index) => {
      const valores: number[] = []
      for (let i = faixa.inicio; i <= faixa.fim; i++) {
        // Aplicar filtro de lado na primeira faixa
        if (index === 0 && lado && lado !== 'AMBOS') {
          if (lado === 'PAR' && i % 2 !== 0) continue
          if (lado === 'IMPAR' && i % 2 === 0) continue
        }
        valores.push(i)
      }
      return { campoFisico: faixa.campoFisico, valores }
    })

    // Produto cartesiano
    return this.produtoCartesiano(faixasExpandidas)
  }

  /**
   * Calcula o produto cartesiano de múltiplas faixas expandidas.
   */
  private produtoCartesiano(
    faixas: Array<{ campoFisico: string; valores: number[] }>
  ): Array<Record<string, number>> {
    if (faixas.length === 0) return [{}]

    const [primeira, ...restantes] = faixas
    const subCombinacoes = this.produtoCartesiano(restantes)

    const resultado: Array<Record<string, number>> = []
    for (const valor of primeira.valores) {
      for (const sub of subCombinacoes) {
        resultado.push({ [primeira.campoFisico]: valor, ...sub })
      }
    }

    return resultado
  }

  /**
   * Constrói os candidatos de endereço a partir das combinações.
   * Para cada combinação:
   * - Preenche campos ativos, mantém inativos como null
   * - Compõe enderecoCompleto
   * - Gera código de barras
   * - Valida via AddressValidationService
   */
  private buildCandidates(
    combinacoes: Array<Record<string, number>>,
    formato: FormatoEndereco,
    params: GenerationParamsV2
  ): any[] {
    const camposAtivos = new Set<string>(formato.segmentos.map((s) => s.campoFisico))
    const candidates: any[] = []

    for (const combinacao of combinacoes) {
      // Construir valores para composição (formatados)
      const valoresComposicao: Record<string, string | number> = {}
      // Construir dados do endereço com campos ativos preenchidos e inativos como null
      const dadosEndereco: Record<string, string | null> = {}

      for (const campo of ALL_CAMPOS) {
        if (camposAtivos.has(campo)) {
          const valor = combinacao[campo]
          if (valor !== undefined) {
            const segmento = formato.segmentos.find((s) => s.campoFisico === campo)!
            const valorFormatado = this.compositionService.formatarSegmento(segmento, valor)
            valoresComposicao[campo] = valor
            dadosEndereco[campo] = valorFormatado
          } else {
            dadosEndereco[campo] = null
          }
        } else {
          dadosEndereco[campo] = null
        }
      }

      // Compor enderecoCompleto
      const enderecoCompleto = this.compositionService.compor(formato, valoresComposicao)

      // Gerar código de barras
      const codigoBarras = this.generateBarcode(enderecoCompleto)

      // Validar via AddressValidationService
      const validacao = validarEndereco(formato, dadosEndereco)
      if (!validacao.valido) {
        // Skip invalid addresses (shouldn't happen with correct generation, but safety check)
        continue
      }

      // Determinar área de armazenagem
      const nivelValor = combinacao['codigoNivel']
      const areaArmazenagem = this.determinarAreaArmazenagem(params, nivelValor)

      candidates.push({
        codigoDeposito: dadosEndereco['codigoDeposito'],
        codigoZona: dadosEndereco['codigoZona'],
        codigoRua: dadosEndereco['codigoRua'],
        codigoPredio: dadosEndereco['codigoPredio'],
        codigoNivel: dadosEndereco['codigoNivel'],
        codigoApto: dadosEndereco['codigoApto'],
        enderecoCompleto,
        codigoBarras,
        tipo: params.tipo || 'ARMAZENAGEM',
        areaArmazenagem,
        centroDistribuicaoId: params.centroDistribuicaoId,
        depositoId: params.depositoId,
        ...(params.zonaId ? { zonaId: params.zonaId } : {}),
        ...(params.estruturaId ? { estruturaId: params.estruturaId } : {}),
        ...(params.formaArmazenagemId ? { formaArmazenagemId: params.formaArmazenagemId } : {}),
        ...(params.ambienteArmazenagemId ? { ambienteArmazenagemId: params.ambienteArmazenagemId } : {}),
        ...(params.classificacaoProdutoId ? { classificacaoProdutoId: params.classificacaoProdutoId } : {}),
        ...(params.empresaId ? { empresaId: params.empresaId } : {}),
      })
    }

    return candidates
  }

  /**
   * Determines areaArmazenagem based on params and nivel value.
   */
  private determinarAreaArmazenagem(params: GenerationParamsV2, nivel?: number): string {
    if (params.areaArmazenagem) return params.areaArmazenagem
    if (params.tipo === 'PICKING') return 'PICKING'
    if (params.nivelPicking && params.nivelPicking > 0 && nivel && nivel <= params.nivelPicking) {
      return 'PICKING'
    }
    return 'PULMAO'
  }

  /**
   * Generates a barcode string for a given enderecoCompleto.
   * Format: "E" + numeric hash (8 digits) + check digit (1 digit).
   * Same algorithm as the v1 service for consistency.
   */
  generateBarcode(enderecoCompleto: string): string {
    const hash = this.numericHash(enderecoCompleto)
    const hashStr = String(hash).padStart(8, '0').slice(0, 8)
    const checkDigit = this.calculateCheckDigit(hashStr)
    return `E${hashStr}${checkDigit}`
  }

  /**
   * Produces a numeric hash from a string.
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
      const weight = i % 2 === 0 ? 1 : 3
      sum += digit * weight
    }
    return (10 - (sum % 10)) % 10
  }
}
