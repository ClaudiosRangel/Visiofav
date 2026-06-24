import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const tabelas = [
    'apontamento_etapa',
    'apontamento_producao',
    'log_ordem_producao',
    'item_liberacao',
    'liberacao_material',
    'variacao_ordem_producao',
    'programacao_entrega',
    'etapa_ordem_producao',
    'item_ordem_producao',
    'ordem_producao',
  ]

  for (const tabela of tabelas) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tabela}" CASCADE`)
      console.log(`✓ ${tabela}`)
    } catch (e: any) {
      console.log(`⚠ ${tabela}: ${e.message?.substring(0, 60)}`)
    }
  }

  console.log('\n✅ Lançamentos de OS/OP limpos!')
  await prisma.$disconnect()
}

main()
