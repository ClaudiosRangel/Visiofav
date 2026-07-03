import { prisma } from '../../lib/prisma'

interface FiltroRelatorio {
  dataInicio?: string
  dataFim?: string
  vendedorId?: string
  clienteId?: string
}

export const relatoriosVendasService = {
  /**
   * Vendas por período — agrupado por dia/semana/mês
   */
  async vendasPorPeriodo(empresaId: string, filtros: FiltroRelatorio & { agrupamento?: 'dia' | 'semana' | 'mes' }) {
    const { dataInicio, dataFim, vendedorId, agrupamento = 'dia' } = filtros

    const where: any = { empresaId }
    if (dataInicio || dataFim) {
      where.dataEfetivacao = {}
      if (dataInicio) where.dataEfetivacao.gte = new Date(dataInicio)
      if (dataFim) where.dataEfetivacao.lte = new Date(dataFim + 'T23:59:59')
    }
    if (vendedorId) where.pedidoVenda = { vendedorId }

    const vendas = await prisma.vendaEfetivada.findMany({
      where,
      select: { dataEfetivacao: true, valorTotal: true },
      orderBy: { dataEfetivacao: 'asc' },
    })

    // Agrupar
    const grupos: Record<string, { total: number; quantidade: number }> = {}
    for (const venda of vendas) {
      const data = venda.dataEfetivacao
      let chave: string
      if (agrupamento === 'mes') {
        chave = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`
      } else if (agrupamento === 'semana') {
        const d = new Date(data)
        d.setDate(d.getDate() - d.getDay())
        chave = d.toISOString().split('T')[0]
      } else {
        chave = data.toISOString().split('T')[0]
      }
      if (!grupos[chave]) grupos[chave] = { total: 0, quantidade: 0 }
      grupos[chave].total += Number(venda.valorTotal)
      grupos[chave].quantidade += 1
    }

    return Object.entries(grupos).map(([periodo, dados]) => ({
      periodo,
      total: Math.round(dados.total * 100) / 100,
      quantidade: dados.quantidade,
      ticketMedio: Math.round((dados.total / dados.quantidade) * 100) / 100,
    }))
  },

  /**
   * Vendas por vendedor — ranking
   */
  async vendasPorVendedor(empresaId: string, filtros: FiltroRelatorio) {
    const { dataInicio, dataFim } = filtros

    const whereDate: any = {}
    if (dataInicio || dataFim) {
      whereDate.dataEfetivacao = {}
      if (dataInicio) whereDate.dataEfetivacao.gte = new Date(dataInicio)
      if (dataFim) whereDate.dataEfetivacao.lte = new Date(dataFim + 'T23:59:59')
    }

    const vendedores = await prisma.vendedor.findMany({
      where: { empresaId, status: true },
      select: {
        id: true,
        nome: true,
        comissao: true,
        pedidosVenda: {
          where: { status: 'EFETIVADO', ...whereDate.dataEfetivacao ? { vendasEfetivadas: { some: whereDate } } : {} },
          select: { valorTotal: true },
        },
      },
    })

    const resultado = vendedores.map(v => {
      const totalVendas = v.pedidosVenda.reduce((acc, p) => acc + Number(p.valorTotal), 0)
      return {
        vendedorId: v.id,
        nome: v.nome,
        totalVendas: Math.round(totalVendas * 100) / 100,
        quantidadePedidos: v.pedidosVenda.length,
        ticketMedio: v.pedidosVenda.length > 0 ? Math.round((totalVendas / v.pedidosVenda.length) * 100) / 100 : 0,
        comissaoPercentual: Number(v.comissao),
        comissaoEstimada: Math.round(totalVendas * Number(v.comissao) / 100 * 100) / 100,
      }
    })

    return resultado.sort((a, b) => b.totalVendas - a.totalVendas)
  },

  /**
   * Vendas por cliente — top clientes
   */
  async vendasPorCliente(empresaId: string, filtros: FiltroRelatorio & { top?: number }) {
    const { dataInicio, dataFim, top = 20 } = filtros

    const whereVenda: any = { empresaId }
    if (dataInicio || dataFim) {
      whereVenda.criadoEm = {}
      if (dataInicio) whereVenda.criadoEm.gte = new Date(dataInicio)
      if (dataFim) whereVenda.criadoEm.lte = new Date(dataFim + 'T23:59:59')
    }
    whereVenda.status = 'EFETIVADO'

    const pedidos = await prisma.pedidoVenda.findMany({
      where: whereVenda,
      select: {
        clienteId: true,
        valorTotal: true,
        cliente: { select: { id: true, razaoSocial: true, nomeFantasia: true } },
      },
    })

    // Agrupar por cliente
    const clientes: Record<string, { nome: string; total: number; qtd: number }> = {}
    for (const p of pedidos) {
      const key = p.clienteId
      if (!clientes[key]) {
        clientes[key] = {
          nome: p.cliente.nomeFantasia || p.cliente.razaoSocial,
          total: 0,
          qtd: 0,
        }
      }
      clientes[key].total += Number(p.valorTotal)
      clientes[key].qtd += 1
    }

    return Object.entries(clientes)
      .map(([clienteId, dados]) => ({
        clienteId,
        nome: dados.nome,
        totalCompras: Math.round(dados.total * 100) / 100,
        quantidadePedidos: dados.qtd,
        ticketMedio: Math.round((dados.total / dados.qtd) * 100) / 100,
      }))
      .sort((a, b) => b.totalCompras - a.totalCompras)
      .slice(0, top)
  },

  /**
   * Curva ABC de produtos vendidos
   */
  async curvaABC(empresaId: string, filtros: FiltroRelatorio) {
    const { dataInicio, dataFim } = filtros

    const whereVenda: any = { empresaId, status: 'EFETIVADO' }
    if (dataInicio || dataFim) {
      whereVenda.criadoEm = {}
      if (dataInicio) whereVenda.criadoEm.gte = new Date(dataInicio)
      if (dataFim) whereVenda.criadoEm.lte = new Date(dataFim + 'T23:59:59')
    }

    const itens = await prisma.itemPedidoVenda.findMany({
      where: { pedidoVenda: whereVenda },
      select: {
        produtoId: true,
        valorTotal: true,
        quantidade: true,
        produto: { select: { id: true, nome: true, codigo: true } },
      },
    })

    // Agrupar por produto
    const produtos: Record<string, { nome: string; codigo: string; total: number; qtd: number }> = {}
    for (const item of itens) {
      const key = item.produtoId
      if (!produtos[key]) {
        produtos[key] = { nome: item.produto.nome, codigo: item.produto.codigo, total: 0, qtd: 0 }
      }
      produtos[key].total += Number(item.valorTotal)
      produtos[key].qtd += Number(item.quantidade)
    }

    // Ordenar por faturamento e calcular classificação ABC
    const produtosList = Object.entries(produtos)
      .map(([produtoId, dados]) => ({ produtoId, ...dados }))
      .sort((a, b) => b.total - a.total)

    const faturamentoTotal = produtosList.reduce((acc, p) => acc + p.total, 0)
    let acumulado = 0

    return produtosList.map(p => {
      acumulado += p.total
      const percentualAcumulado = faturamentoTotal > 0 ? (acumulado / faturamentoTotal) * 100 : 0
      let classificacao: 'A' | 'B' | 'C'
      if (percentualAcumulado <= 80) classificacao = 'A'
      else if (percentualAcumulado <= 95) classificacao = 'B'
      else classificacao = 'C'

      return {
        produtoId: p.produtoId,
        nome: p.nome,
        codigo: p.codigo,
        faturamento: Math.round(p.total * 100) / 100,
        quantidade: Math.round(p.qtd * 100) / 100,
        percentualFaturamento: Math.round((p.total / (faturamentoTotal || 1)) * 10000) / 100,
        percentualAcumulado: Math.round(percentualAcumulado * 100) / 100,
        classificacao,
      }
    })
  },

  /**
   * Resumo geral (KPIs)
   */
  async resumo(empresaId: string, filtros: FiltroRelatorio) {
    const { dataInicio, dataFim } = filtros

    const whereVenda: any = { empresaId, status: 'EFETIVADO' }
    if (dataInicio || dataFim) {
      whereVenda.criadoEm = {}
      if (dataInicio) whereVenda.criadoEm.gte = new Date(dataInicio)
      if (dataFim) whereVenda.criadoEm.lte = new Date(dataFim + 'T23:59:59')
    }

    const [totalPedidos, pedidos, pedidosCancelados] = await Promise.all([
      prisma.pedidoVenda.count({ where: whereVenda }),
      prisma.pedidoVenda.findMany({ where: whereVenda, select: { valorTotal: true } }),
      prisma.pedidoVenda.count({ where: { ...whereVenda, status: 'CANCELADO' } }),
    ])

    const faturamentoTotal = pedidos.reduce((acc, p) => acc + Number(p.valorTotal), 0)
    const ticketMedio = totalPedidos > 0 ? faturamentoTotal / totalPedidos : 0

    return {
      totalPedidos,
      faturamentoTotal: Math.round(faturamentoTotal * 100) / 100,
      ticketMedio: Math.round(ticketMedio * 100) / 100,
      pedidosCancelados,
      taxaCancelamento: totalPedidos > 0 ? Math.round((pedidosCancelados / (totalPedidos + pedidosCancelados)) * 10000) / 100 : 0,
    }
  },
}
