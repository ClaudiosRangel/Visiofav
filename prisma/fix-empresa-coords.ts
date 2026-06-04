import { PrismaClient } from '@prisma/client'

async function main() {
  const p = new PrismaClient()
  const r = await p.empresa.updateMany({ data: { latitude: -23.5505, longitude: -46.6333 } })
  console.log('✅ Empresa atualizada com coordenadas SP Centro:', r)
  await p.$disconnect()
}
main()
