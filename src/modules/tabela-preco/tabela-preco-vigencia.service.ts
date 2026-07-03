import { prisma } from '../../lib/prisma'

export const tabelaPrecoVigenciaService = {
  /**
   * Busca o preço vigente para um produto, resolvendo a hierarquia de prioridade:
   * 1. Tabela específica do cliente (maior prioridade)
   * 2. Tabela do grupo de clientes
   * 3. Tabela geral vigente (maior prioridade numérica)
   */
  async buscarPrecoVigente(
    empresaId: string,
    produtoId: string,
    clienteId?: string,
    data?: Date
  ) {
    const dataRef = data || new Date()

    // Buscar cliente para obter grupo, se aplicável
    let grupoCliente: string | null = null
    if (clienteId) {
      const cliente = await prisma.cliente.findFirst({
        where: { id: clienteId, empresaId },
        select: { id: true },
      })
      if (!cliente) return null
    }

    // Buscar tabelas vigentes na data de referência, ordenadas por prioridade
    const tabelasVigentes = await prisma.tabelaPreco.findMany({
      where: {
        empresaId,
        status: true,
        OR: [
          { dataInicio: null, dataFim: null }, // Sem vigência = sempre válida
          {
            dataInicio: { lte: dataRef },
            dataFim: { gte: dataRef },
          },
          {
            dataInicio: { lte: dataRef },
            dataFim: null,
          },
          {
            dataInicio: null,
            dataFim: { gte: dataRef },
          },
        ],
      },
      include: { condicoes: true },
      orderBy: { prioridade: 'desc' },
    })

    if (tabelasVigentes.length === 0) return null

    // Hierarquia: cliente específico > grupo > geral
    if (clienteId) {
      const tabelaCliente = tabelasVigentes.find((t) => t.clienteId === clienteId)
      if (tabelaCliente) return tabelaCliente
    }

    if (grupoCliente) {
      const tabelaGrupo = tabelasVigentes.find((t) => t.grupoCliente === grupoCliente)
      if (tabelaGrupo) return tabelaGrupo
    }

    // Retorna a tabela geral com maior prioridade (sem cliente/grupo vinculado)
    const tabelaGeral = tabelasVigentes.find((t) => !t.clienteId && !t.grupoCliente)
    return tabelaGeral || tabelasVigentes[0]
  },
}
