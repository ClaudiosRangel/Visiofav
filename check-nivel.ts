import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Check what codigoNivel values exist for Nv 001 addresses
  const enderecos = await prisma.endereco.findMany({
    where: { enderecoCompleto: { contains: '001-001-001' } },
    select: { id: true, enderecoCompleto: true, codigoNivel: true, areaArmazenagem: true },
    take: 10,
    orderBy: { enderecoCompleto: 'asc' },
  })
  
  console.log('Endereços encontrados:')
  for (const e of enderecos) {
    console.log(`  ${e.enderecoCompleto} | codigoNivel="${e.codigoNivel}" | areaArmazenagem="${e.areaArmazenagem}"`)
  }

  // Also check distinct codigoNivel values
  const niveis = await prisma.endereco.findMany({
    distinct: ['codigoNivel'],
    select: { codigoNivel: true },
    orderBy: { codigoNivel: 'asc' },
  })
  console.log('\nNíveis distintos:', niveis.map(n => `"${n.codigoNivel}"`).join(', '))

  await prisma.$disconnect()
}

main().catch(console.error)
