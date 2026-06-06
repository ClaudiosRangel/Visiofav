import { PrismaClient } from '@prisma/client'
async function main() {
  const p = new PrismaClient()
  const empresas = await p.empresa.findMany({ select: { id: true, nomeFantasia: true } })
  console.log('Empresas:', empresas)
  for (const e of empresas) {
    const prods = await p.produto.count({ where: { empresaId: e.id } })
    const clis = await p.cliente.count({ where: { empresaId: e.id } })
    console.log(`  ${e.nomeFantasia}: ${prods} produtos, ${clis} clientes`)
  }
  await p.$disconnect()
}
main()
