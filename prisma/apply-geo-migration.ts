import { PrismaClient } from '@prisma/client'

async function main() {
  const p = new PrismaClient()
  
  const sqls = [
    `ALTER TABLE "empresa" ADD COLUMN IF NOT EXISTS "latitude" DECIMAL(10,7)`,
    `ALTER TABLE "empresa" ADD COLUMN IF NOT EXISTS "longitude" DECIMAL(10,7)`,
    `ALTER TABLE "cliente" ADD COLUMN IF NOT EXISTS "latitude" DECIMAL(10,7)`,
    `ALTER TABLE "cliente" ADD COLUMN IF NOT EXISTS "longitude" DECIMAL(10,7)`,
    `ALTER TABLE "mapa_carregamento" ADD COLUMN IF NOT EXISTS "distancia_total_km" DECIMAL(10,2)`,
    `ALTER TABLE "mapa_carregamento" ADD COLUMN IF NOT EXISTS "sequencia_valida" BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE "mapa_carregamento_nf" ADD COLUMN IF NOT EXISTS "ordem_entrega" INTEGER`,
    `ALTER TABLE "mapa_carregamento_nf" ADD COLUMN IF NOT EXISTS "distancia_parcial_km" DECIMAL(10,2)`,
  ]

  for (const sql of sqls) {
    try {
      await p.$executeRawUnsafe(sql)
      console.log('✅', sql.substring(0, 80))
    } catch (e: any) {
      if (e.message?.includes('already exists')) {
        console.log('⏭ Já existe:', sql.substring(0, 60))
      } else {
        console.log('❌', sql.substring(0, 60), '→', e.message?.substring(0, 80))
      }
    }
  }
  
  await p.$disconnect()
  console.log('\n✅ Migration de geolocalização aplicada!')
}

main()
