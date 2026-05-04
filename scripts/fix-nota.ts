import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()

async function main() {
  // Excluir nota sem itens
  const nota = await p.notaEntrada.findFirst({ where: { id: '9229b95b-fa43-438b-abbe-6206630980c1' } })
  if (nota) {
    await p.notaEntrada.delete({ where: { id: nota.id } })
    console.log(`Nota NF ${nota.numero} excluída (sem itens)`)
  } else {
    console.log('Nota já foi excluída')
  }

  // Verificar se há outras notas sem itens
  const todasNotas = await p.notaEntrada.findMany({ include: { _count: { select: { itens: true } } } })
  for (const n of todasNotas) {
    if (n._count.itens === 0) {
      await p.notaEntrada.delete({ where: { id: n.id } })
      console.log(`Nota NF ${n.numero} excluída (sem itens)`)
    }
  }

  const restantes = await p.notaEntrada.count()
  console.log(`\nNotas restantes: ${restantes}`)
  console.log('\nAgora importe um XML pelo Recebimento para criar uma nota COM itens.')
}

main().catch(console.error).finally(() => p.$disconnect())
