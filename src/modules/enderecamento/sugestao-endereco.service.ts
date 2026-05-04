import { prisma } from '../../lib/prisma'

export interface SugestaoInput {
  produtoId: string
  empresaId: string
  quantidade: number
  lote?: string
  validade?: Date
}

export interface SugestaoResultado {
  sugestao: 'ENDERECO_FIXO' | 'CONSOLIDAR' | 'ENDERECO_LIVRE'
  enderecoId: string
  enderecoCompleto: string
  motivo: string
  rua: string | null
  predio: string | null
  nivel: string | null
  apto: string | null
}

export class SugestaoEnderecoService {
  /**
   * Computes the best address suggestion for a product following priority:
   * 1. Fixed address (DadosLogisticosArmazenagem.enderecoFixoId)
   * 2. Consolidation (existing SaldoEndereco > 0 for same product)
   * 3. Norm-based ordering (FEFO by expiry, FIFO by receipt date)
   * 4. First available free address (sorted by rua, prédio, nível, apto)
   */
  async sugerir(
    input: SugestaoInput,
    excludeEnderecoIds: Set<string> = new Set(),
  ): Promise<SugestaoResultado | null> {
    // 1. Check for fixed address via DadosLogisticosArmazenagem
    const dadosLogisticos = await prisma.dadosLogisticosArmazenagem.findFirst({
      where: { produtoId: input.produtoId },
    })

    if (dadosLogisticos?.enderecoFixoId) {
      const enderecoFixo = await prisma.endereco.findFirst({
        where: {
          id: dadosLogisticos.enderecoFixoId,
          status: true,
        },
      })

      if (enderecoFixo) {
        return {
          sugestao: 'ENDERECO_FIXO',
          enderecoId: enderecoFixo.id,
          enderecoCompleto: enderecoFixo.enderecoCompleto ?? '',
          motivo: 'Endereço fixo definido nos dados logísticos do produto',
          rua: enderecoFixo.codigoRua,
          predio: enderecoFixo.codigoPredio,
          nivel: enderecoFixo.codigoNivel,
          apto: enderecoFixo.codigoApto,
        }
      }
    }

    // 2. Check for consolidation (existing stock of the same product)
    const saldoExistente = await prisma.saldoEndereco.findFirst({
      where: {
        produtoId: input.produtoId,
        quantidade: { gt: 0 },
        endereco: { status: true },
      },
      include: { endereco: true },
      orderBy: { atualizadoEm: 'desc' },
    })

    if (saldoExistente) {
      return {
        sugestao: 'CONSOLIDAR',
        enderecoId: saldoExistente.enderecoId,
        enderecoCompleto: saldoExistente.endereco.enderecoCompleto ?? '',
        motivo: `Consolidar com estoque existente (saldo: ${Number(saldoExistente.quantidade)})`,
        rua: saldoExistente.endereco.codigoRua,
        predio: saldoExistente.endereco.codigoPredio,
        nivel: saldoExistente.endereco.codigoNivel,
        apto: saldoExistente.endereco.codigoApto,
      }
    }

    // 3. Norm-based ordering (FEFO / FIFO) — find addresses with existing stock
    //    sorted by the appropriate criterion
    const tipoNorma = dadosLogisticos?.tipoNorma ?? 'FEFO'

    if (tipoNorma === 'FEFO') {
      // Prefer addresses where existing stock has the earliest expiry date
      const saldoFefo = await prisma.saldoEndereco.findFirst({
        where: {
          quantidade: { gt: 0 },
          validade: { not: null },
          endereco: {
            tipo: { in: ['ARMAZENAGEM', 'LIVRE'] },
            status: true,
            id: { notIn: Array.from(excludeEnderecoIds) },
          },
        },
        include: { endereco: true },
        orderBy: { validade: 'asc' },
      })

      if (saldoFefo) {
        return {
          sugestao: 'ENDERECO_LIVRE',
          enderecoId: saldoFefo.enderecoId,
          enderecoCompleto: saldoFefo.endereco.enderecoCompleto ?? '',
          motivo: `Endereço com validade mais próxima (FEFO)`,
          rua: saldoFefo.endereco.codigoRua,
          predio: saldoFefo.endereco.codigoPredio,
          nivel: saldoFefo.endereco.codigoNivel,
          apto: saldoFefo.endereco.codigoApto,
        }
      }
    } else if (tipoNorma === 'FIFO') {
      // Prefer addresses where existing stock has the earliest receipt date
      const saldoFifo = await prisma.saldoEndereco.findFirst({
        where: {
          quantidade: { gt: 0 },
          endereco: {
            tipo: { in: ['ARMAZENAGEM', 'LIVRE'] },
            status: true,
            id: { notIn: Array.from(excludeEnderecoIds) },
          },
        },
        include: { endereco: true },
        orderBy: { atualizadoEm: 'asc' },
      })

      if (saldoFifo) {
        return {
          sugestao: 'ENDERECO_LIVRE',
          enderecoId: saldoFifo.enderecoId,
          enderecoCompleto: saldoFifo.endereco.enderecoCompleto ?? '',
          motivo: `Endereço com recebimento mais antigo (FIFO)`,
          rua: saldoFifo.endereco.codigoRua,
          predio: saldoFifo.endereco.codigoPredio,
          nivel: saldoFifo.endereco.codigoNivel,
          apto: saldoFifo.endereco.codigoApto,
        }
      }
    }

    // 4. Fall back to first free address (no stock) sorted by rua, prédio, nível, apto
    const enderecoLivre = await prisma.endereco.findFirst({
      where: {
        tipo: { in: ['ARMAZENAGEM', 'LIVRE'] },
        status: true,
        id: { notIn: Array.from(excludeEnderecoIds) },
        saldos: { none: { quantidade: { gt: 0 } } },
      },
      orderBy: [
        { codigoRua: 'asc' },
        { codigoPredio: 'asc' },
        { codigoNivel: 'asc' },
        { codigoApto: 'asc' },
      ],
    })

    if (enderecoLivre) {
      return {
        sugestao: 'ENDERECO_LIVRE',
        enderecoId: enderecoLivre.id,
        enderecoCompleto: enderecoLivre.enderecoCompleto ?? '',
        motivo: 'Primeiro endereço livre disponível',
        rua: enderecoLivre.codigoRua,
        predio: enderecoLivre.codigoPredio,
        nivel: enderecoLivre.codigoNivel,
        apto: enderecoLivre.codigoApto,
      }
    }

    // 5. No address available
    return null
  }

  /**
   * Batch suggestion for all items of a nota.
   * Ensures no two items are suggested the same free address.
   */
  async sugerirLote(
    itens: Array<{
      itemId: string
      produtoId: string
      quantidade: number
      lote?: string
      validade?: Date
    }>,
    empresaId: string,
  ): Promise<Map<string, SugestaoResultado | null>> {
    const resultados = new Map<string, SugestaoResultado | null>()
    const enderecosSugeridos = new Set<string>()

    for (const item of itens) {
      const sugestao = await this.sugerir(
        {
          produtoId: item.produtoId,
          empresaId,
          quantidade: item.quantidade,
          lote: item.lote,
          validade: item.validade,
        },
        enderecosSugeridos,
      )

      resultados.set(item.itemId, sugestao)

      // Track suggested free addresses to avoid duplicates
      if (sugestao && sugestao.sugestao === 'ENDERECO_LIVRE') {
        enderecosSugeridos.add(sugestao.enderecoId)
      }
    }

    return resultados
  }
}
