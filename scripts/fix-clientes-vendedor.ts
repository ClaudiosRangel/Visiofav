import { prisma } from '../src/lib/prisma'

async function main() {
  const r = await prisma.cliente.updateMany({
    where: {
      id: {
        in: [
          '0b146b1b-b4d1-4bff-9df9-877fbeb5bd5c',
          '1a05d985-8c87-44a6-ad0b-33244ff23a02',
        ],
      },
    },
    data: { vendedorId: '43398945-27a5-4172-9bb4-6b3124b2e157' },
  })
  console.log('Clientes atualizados:', r.count)
  await prisma.$disconnect()
}

main()
