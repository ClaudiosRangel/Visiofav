import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()

async function main() {
  // Verificar docas
  const docas = await p.doca.findMany()
  console.log('=== DOCAS ===')
  console.log('Total:', docas.length)
  if (docas.length > 0) {
    console.log('Primeira:', JSON.stringify(docas[0], null, 2))
  }

  // Verificar notas de entrada com itens
  const notas = await p.notaEntrada.findMany({ include: { itens: true } })
  console.log('\n=== NOTAS DE ENTRADA ===')
  console.log('Total:', notas.length)
  for (const n of notas) {
    console.log(`  NF ${n.numero} - status: ${n.status} - itens: ${n.itens.length}`)
    for (const item of n.itens) {
      console.log(`    [${item.item}] ${item.codigoProduto} - ${item.descricao} - qtd: ${item.quantidade}`)
    }
  }

  // Verificar itens separadamente
  const itens = await p.itemNotaEntrada.findMany()
  console.log('\n=== ITENS NOTA ENTRADA (direto) ===')
  console.log('Total:', itens.length)
  for (const i of itens) {
    console.log(`  notaId: ${i.notaEntradaId} - item: ${i.item} - ${i.descricao}`)
  }
}

main().catch(console.error).finally(() => p.$disconnect())
