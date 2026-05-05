import { prisma } from '../../lib/prisma'

export interface CapacityCheckInput {
  enderecoId: string
  produtoId: string
  quantidade: number
}

export interface CapacityCheckResult {
  permitido: boolean
  pesoAtual: number
  pesoIncoming: number
  pesoLimite: number
  volumeAtual: number
  volumeIncoming: number
  volumeLimite: number
  motivo?: string
}

export interface CapacityUtilization {
  pesoUtilizacao: number
  volumeUtilizacao: number
  pesoDisponivel: number
  volumeDisponivel: number
  pesoAtual: number
  volumeAtual: number
  pesoLimite: number
  volumeLimite: number
}

export class ValidadorCapacidade {
  /**
   * Validates whether a product can be stored at the given address
   * based on weight and volume capacity constraints.
   *
   * Graceful degradation:
   * - If Endereco has no Estrutura → allow (skip all validation)
   * - If Estrutura.capacidade is null/zero or SKU.pesoBruto is null → skip weight check
   * - If Estrutura.cubagem is null/zero or SKU.volume is null → skip volume check
   */
  async validar(input: CapacityCheckInput): Promise<CapacityCheckResult> {
    const { enderecoId, produtoId, quantidade } = input

    // 1. Load Endereco with Estrutura
    const endereco = await prisma.endereco.findUnique({
      where: { id: enderecoId },
      include: { estrutura: true },
    })

    if (!endereco) {
      throw { status: 404, message: 'Endereço não encontrado' }
    }

    // 2. If no Estrutura → skip all validation (allow operation)
    if (!endereco.estrutura) {
      return {
        permitido: true,
        pesoAtual: 0,
        pesoIncoming: 0,
        pesoLimite: 0,
        volumeAtual: 0,
        volumeIncoming: 0,
        volumeLimite: 0,
      }
    }

    const estrutura = endereco.estrutura
    const capacidade = estrutura.capacidade ? Number(estrutura.capacidade) : 0
    const cubagem = estrutura.cubagem ? Number(estrutura.cubagem) : 0

    // 3. Get the SKU for the incoming product (first active SKU)
    const sku = await prisma.sku.findFirst({
      where: { produtoId },
    })

    const skuPesoBruto = sku?.pesoBruto ? Number(sku.pesoBruto) : null
    const skuVolume = sku?.volume ? Number(sku.volume) : null

    // 4. Calculate current weight and volume at address
    const pesoAtual = await this.calcularPesoAtual(enderecoId)
    const volumeAtual = await this.calcularVolumeAtual(enderecoId)

    // 5. Calculate incoming weight and volume
    const pesoIncoming = skuPesoBruto != null ? quantidade * skuPesoBruto : 0
    const volumeIncoming = skuVolume != null ? quantidade * skuVolume : 0

    // 6. Weight check — skip if capacidade is null/zero or pesoBruto is null
    const shouldCheckWeight = capacidade > 0 && skuPesoBruto != null
    if (shouldCheckWeight && pesoAtual + pesoIncoming > capacidade) {
      return {
        permitido: false,
        pesoAtual,
        pesoIncoming,
        pesoLimite: capacidade,
        volumeAtual,
        volumeIncoming,
        volumeLimite: cubagem,
        motivo: 'Capacidade de peso excedida',
      }
    }

    // 7. Volume check — skip if cubagem is null/zero or volume is null
    const shouldCheckVolume = cubagem > 0 && skuVolume != null
    if (shouldCheckVolume && volumeAtual + volumeIncoming > cubagem) {
      return {
        permitido: false,
        pesoAtual,
        pesoIncoming,
        pesoLimite: capacidade,
        volumeAtual,
        volumeIncoming,
        volumeLimite: cubagem,
        motivo: 'Capacidade de volume excedida',
      }
    }

    // 8. Both pass → allow
    return {
      permitido: true,
      pesoAtual,
      pesoIncoming,
      pesoLimite: capacidade,
      volumeAtual,
      volumeIncoming,
      volumeLimite: cubagem,
    }
  }

  /**
   * Returns the current capacity utilization for an address.
   * Includes weight and volume percentages, remaining capacity, and limits.
   */
  async getUtilization(enderecoId: string): Promise<CapacityUtilization> {
    const endereco = await prisma.endereco.findUnique({
      where: { id: enderecoId },
      include: { estrutura: true },
    })

    if (!endereco) {
      throw { status: 404, message: 'Endereço não encontrado' }
    }

    const estrutura = endereco.estrutura
    const pesoLimite = estrutura?.capacidade ? Number(estrutura.capacidade) : 0
    const volumeLimite = estrutura?.cubagem ? Number(estrutura.cubagem) : 0

    const pesoAtual = await this.calcularPesoAtual(enderecoId)
    const volumeAtual = await this.calcularVolumeAtual(enderecoId)

    const pesoUtilizacao = pesoLimite > 0 ? (pesoAtual / pesoLimite) * 100 : 0
    const volumeUtilizacao = volumeLimite > 0 ? (volumeAtual / volumeLimite) * 100 : 0

    const pesoDisponivel = pesoLimite > 0 ? pesoLimite - pesoAtual : 0
    const volumeDisponivel = volumeLimite > 0 ? volumeLimite - volumeAtual : 0

    return {
      pesoUtilizacao,
      volumeUtilizacao,
      pesoDisponivel,
      volumeDisponivel,
      pesoAtual,
      volumeAtual,
      pesoLimite,
      volumeLimite,
    }
  }

  /**
   * Calculates the current total weight at an address.
   * Sums (SaldoEndereco.quantidade × Sku.pesoBruto) for all products at the address.
   * Products without a SKU or without pesoBruto are excluded from the sum.
   */
  async calcularPesoAtual(enderecoId: string): Promise<number> {
    const saldos = await prisma.saldoEndereco.findMany({
      where: { enderecoId },
    })

    if (saldos.length === 0) return 0

    const produtoIds = [...new Set(saldos.map((s) => s.produtoId))]

    const skus = await prisma.sku.findMany({
      where: { produtoId: { in: produtoIds } },
    })

    // Build a map of produtoId → pesoBruto (use first SKU found for each product)
    const pesoBrutoMap = new Map<string, number>()
    for (const sku of skus) {
      if (sku.pesoBruto != null && !pesoBrutoMap.has(sku.produtoId)) {
        pesoBrutoMap.set(sku.produtoId, Number(sku.pesoBruto))
      }
    }

    let totalPeso = 0
    for (const saldo of saldos) {
      const pesoBruto = pesoBrutoMap.get(saldo.produtoId)
      if (pesoBruto != null) {
        totalPeso += Number(saldo.quantidade) * pesoBruto
      }
    }

    return totalPeso
  }

  /**
   * Calculates the current total volume at an address.
   * Sums (SaldoEndereco.quantidade × Sku.volume) for all products at the address.
   * Products without a SKU or without volume are excluded from the sum.
   */
  async calcularVolumeAtual(enderecoId: string): Promise<number> {
    const saldos = await prisma.saldoEndereco.findMany({
      where: { enderecoId },
    })

    if (saldos.length === 0) return 0

    const produtoIds = [...new Set(saldos.map((s) => s.produtoId))]

    const skus = await prisma.sku.findMany({
      where: { produtoId: { in: produtoIds } },
    })

    // Build a map of produtoId → volume (use first SKU found for each product)
    const volumeMap = new Map<string, number>()
    for (const sku of skus) {
      if (sku.volume != null && !volumeMap.has(sku.produtoId)) {
        volumeMap.set(sku.produtoId, Number(sku.volume))
      }
    }

    let totalVolume = 0
    for (const saldo of saldos) {
      const volume = volumeMap.get(saldo.produtoId)
      if (volume != null) {
        totalVolume += Number(saldo.quantidade) * volume
      }
    }

    return totalVolume
  }
}
