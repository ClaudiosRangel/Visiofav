import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🔄 Applying production migrations...')

  // Endereco table - new columns
  await prisma.$executeRawUnsafe(`ALTER TABLE "endereco" ADD COLUMN IF NOT EXISTS "codigo_barras" VARCHAR(30)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "endereco" ADD COLUMN IF NOT EXISTS "area_armazenagem" VARCHAR(20)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "endereco" ADD COLUMN IF NOT EXISTS "forma_armazenagem_id" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "endereco" ADD COLUMN IF NOT EXISTS "ambiente_armazenagem_id" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "endereco" ADD COLUMN IF NOT EXISTS "classificacao_produto_id" TEXT`)

  // Estrutura table - capacity fields
  await prisma.$executeRawUnsafe(`ALTER TABLE "estrutura" ADD COLUMN IF NOT EXISTS "capacidade" DECIMAL(10,3)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "estrutura" ADD COLUMN IF NOT EXISTS "largura" DECIMAL(10,3)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "estrutura" ADD COLUMN IF NOT EXISTS "altura" DECIMAL(10,3)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "estrutura" ADD COLUMN IF NOT EXISTS "comprimento" DECIMAL(10,3)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "estrutura" ADD COLUMN IF NOT EXISTS "cubagem" DECIMAL(10,6)`)

  // Doca table - codigo column
  await prisma.$executeRawUnsafe(`ALTER TABLE "doca" ADD COLUMN IF NOT EXISTS "codigo" SERIAL`)

  // Equipamento table - codigo column
  await prisma.$executeRawUnsafe(`ALTER TABLE "equipamento_movimentacao" ADD COLUMN IF NOT EXISTS "codigo" SERIAL`)

  // Funcionario table - codigo column
  await prisma.$executeRawUnsafe(`ALTER TABLE "funcionario" ADD COLUMN IF NOT EXISTS "codigo" SERIAL`)

  // Funcionario table - usuario_id column (direct link to usuario)
  await prisma.$executeRawUnsafe(`ALTER TABLE "funcionario" ADD COLUMN IF NOT EXISTS "usuario_id" TEXT`)

  // Estrutura table - codigo column
  await prisma.$executeRawUnsafe(`ALTER TABLE "estrutura" ADD COLUMN IF NOT EXISTS "codigo" SERIAL`)

  // Multi-tenant: Add empresa_id to WMS tables
  const tenantTables = [
    'deposito', 'zona', 'estrutura', 'endereco', 'funcionario', 'doca',
    'equipamento_movimentacao', 'funcao', 'forma_armazenagem',
    'ambiente_armazenagem', 'classificacao_produto', 'tipo_carroceria',
    'tipo_carga', 'veiculo_wms', 'nota_entrada', 'saldo_endereco', 'sku',
  ]

  for (const table of tenantTables) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "empresa_id" TEXT`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_${table}_empresa_id" ON "${table}"("empresa_id")`)
  }
  console.log('✅ Multi-tenant: empresa_id columns and indexes added')

  // Multi-tenant: Backfill empresa_id with default empresa
  const defaultEmpresa = await prisma.empresa.findFirst({ select: { id: true } })
  if (defaultEmpresa) {
    for (const table of tenantTables) {
      await prisma.$executeRawUnsafe(
        `UPDATE "${table}" SET "empresa_id" = '${defaultEmpresa.id}' WHERE "empresa_id" IS NULL`
      )
    }
    console.log('✅ Multi-tenant: backfill complete with empresa', defaultEmpresa.id)
  }

  console.log('✅ All migrations applied successfully')
}

main()
  .catch((e) => { console.error('❌ Migration failed:', e.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
