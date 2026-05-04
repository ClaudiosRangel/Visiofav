import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()

async function main() {
  // 1. Todas as notas de entrada
  const notas = await p.notaEntrada.findMany({ include: { itens: true } })
  console.log('=== NOTAS DE ENTRADA ===')
  console.log('Total:', notas.length)
  for (const n of notas) {
    console.log(`  ID: ${n.id}`)
    console.log(`  NF: ${n.numero} | Fornecedor: ${n.fornecedor} | Status: ${n.status}`)
    console.log(`  Itens: ${n.itens.length}`)
    for (const i of n.itens) {
      console.log(`    [${i.item}] ${i.codigoProduto} - ${i.descricao} - qtd: ${i.quantidade} - un: ${i.unidade}`)
    }
    console.log('')
  }

  // 2. Itens órfãos
  const itens = await p.itemNotaEntrada.findMany()
  console.log('=== ITENS NOTA ENTRADA (todos) ===')
  console.log('Total:', itens.length)
  for (const i of itens) {
    console.log(`  notaId: ${i.notaEntradaId} | item: ${i.item} | ${i.codigoProduto} | ${i.descricao} | qtd: ${i.quantidade}`)
  }

  // 3. Simular o que o POST /iniciar retorna
  if (notas.length > 0) {
    const nota = notas[0]
    console.log('\n=== SIMULAÇÃO POST /iniciar ===')
    console.log('Retorno seria:')
    console.log(JSON.stringify({
      nota: { id: nota.id, numero: nota.numero, fornecedor: nota.fornecedor, status: nota.status },
      itens: nota.itens.map((item) => ({
        id: item.id,
        item: item.item,
        descricao: item.descricao,
        codigoProduto: item.codigoProduto,
        unidade: item.unidade,
      })),
    }, null, 2))
  }
}

main().catch(console.error).finally(() => p.$disconnect())
