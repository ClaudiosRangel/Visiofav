import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Criando tabela cor_veiculo...')
  
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "cor_veiculo" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "empresa_id" UUID NOT NULL REFERENCES "empresa"("id"),
      "codigo" VARCHAR(4) NOT NULL,
      "descricao" VARCHAR(60) NOT NULL,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT now()
    )
  `)
  
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "cor_veiculo_empresa_id_codigo_key"
    ON "cor_veiculo" ("empresa_id", "codigo")
  `)
  
  console.log('✅ Tabela cor_veiculo criada com sucesso')
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('❌ Erro:', e.message)
  process.exit(1)
})
