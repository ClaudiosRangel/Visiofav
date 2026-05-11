import { prisma } from '../../lib/prisma'

/**
 * Calcula e atualiza a curva ABC de todos os produtos de uma empresa.
 * 
 * Lógica:
 * - Busca volume de vendas (soma de valorTotal dos itens de pedidos de venda efetivados) nos últimos 90 dias
 * - Ordena produtos por volume de vendas decrescente
 * - Top 20% dos produtos (por volume acumulado) = A
 * - Próximos 30% = B
 * - Restantes 50% = C
 * - Produtos sem vendas = null (sem classificação)
 * 
 * Percentuais configuráveis: A=80% do valor, B=15% do valor, C=5% do valor
 * (Pareto: 20% dos produtos representam 80% do valor)
 */
export async function calcularCurvaAbc(empresaId: string): Promise<{ total: number; atualizados: number; classificacao: { A: number; B: number; C: number } }> {
  // 1. Buscar vendas dos últimos 90 dias
  const dataInicio = new Date()
  dataInicio.setDate(dataInicio.getDate() - 90)

  const vendas = await prisma.$queryRaw<Array<{ produtoId: string; totalVendido: number }>>`
    SELECT ipv."produto_id" as "produtoId", SUM(ipv."valor_total") as "totalVendido"
    FROM "item_pedido_venda" ipv
    INNER JOIN "pedido_venda" pv ON pv."id" = ipv."pedido_venda_id"
    INNER JOIN "venda_efetivada" ve ON ve."pedido_venda_id" = pv."id"
    WHERE pv."empresa_id" = ${empresaId}
      AND ve."data_efetivacao" >= ${dataInicio}
    GROUP BY ipv."produto_id"
    ORDER BY SUM(ipv."valor_total") DESC
  `

  if (vendas.length === 0) {
    // Sem vendas — limpar curva de todos os produtos
    await prisma.produto.updateMany({
      where: { empresaId },
      data: { curvaAbc: null },
    })
    return { total: 0, atualizados: 0, classificacao: { A: 0, B: 0, C: 0 } }
  }

  // 2. Calcular valor total e acumulado
  const valorTotal = vendas.reduce((acc, v) => acc + Number(v.totalVendido), 0)
  
  let acumulado = 0
  const classificacoes: Array<{ produtoId: string; curva: 'A' | 'B' | 'C' }> = []

  for (const venda of vendas) {
    acumulado += Number(venda.totalVendido)
    const percentual = (acumulado / valorTotal) * 100

    let curva: 'A' | 'B' | 'C'
    if (percentual <= 80) {
      curva = 'A'
    } else if (percentual <= 95) {
      curva = 'B'
    } else {
      curva = 'C'
    }

    classificacoes.push({ produtoId: venda.produtoId, curva })
  }

  // 3. Atualizar produtos
  const produtosComVenda = classificacoes.map(c => c.produtoId)
  
  // Produtos sem venda = null
  await prisma.produto.updateMany({
    where: { empresaId, id: { notIn: produtosComVenda } },
    data: { curvaAbc: null },
  })

  // Atualizar cada produto com sua curva
  for (const { produtoId, curva } of classificacoes) {
    await prisma.produto.update({
      where: { id: produtoId },
      data: { curvaAbc: curva },
    })
  }

  const contagem = { A: 0, B: 0, C: 0 }
  for (const c of classificacoes) contagem[c.curva]++

  return {
    total: classificacoes.length,
    atualizados: classificacoes.length,
    classificacao: contagem,
  }
}
