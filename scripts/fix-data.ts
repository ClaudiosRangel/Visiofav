import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()

async function main() {
  // 1. Excluir notas de entrada sem itens (órfãs do script de limpeza)
  const notas = await p.notaEntrada.findMany({ include: { itens: true } })
  let removidas = 0
  for (const nota of notas) {
    if (nota.itens.length === 0) {
      await p.notaEntrada.delete({ where: { id: nota.id } })
      console.log(`Nota NF ${nota.numero} removida (sem itens)`)
      removidas++
    }
  }
  console.log(`${removidas} nota(s) órfã(s) removida(s)`)

  // 2. Testar query de docas
  try {
    const docas = await p.doca.findMany({
      orderBy: { criadoEm: 'asc' },
      include: { deposito: { select: { descricao: true } } },
    })
    console.log(`\nDocas encontradas: ${docas.length}`)
    for (const d of docas) {
      console.log(`  ${d.descricao} - tipo: ${d.tipo} - deposito: ${d.deposito?.descricao || 'N/A'}`)
    }
  } catch (err: any) {
    console.error('ERRO ao buscar docas:', err.message)
  }

  // 3. Testar a query exata que o backend faz (com search vazio)
  try {
    const where = {}
    const [data, total] = await Promise.all([
      p.doca.findMany({ where, skip: 0, take: 20, orderBy: { criadoEm: 'asc' }, include: { deposito: { select: { descricao: true } } } }),
      p.doca.count({ where }),
    ])
    console.log(`\nQuery paginada: ${data.length} de ${total}`)
  } catch (err: any) {
    console.error('ERRO na query paginada:', err.message)
  }
}

main().catch(console.error).finally(() => p.$disconnect())
