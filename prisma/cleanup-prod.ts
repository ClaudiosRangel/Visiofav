import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🧹 Limpando dados de produção...\n')

  // Use TRUNCATE CASCADE to bypass FK constraints
  const tablesToClean = [
    'os_funcionario_wms',
    'log_movimento_wms',
    'ordem_servico_wms',
    'item_conferencia_entrada',
    'conferencia_entrada',
    'item_volume',
    'carregamento_volume',
    'carregamento',
    'volume',
    'item_conferencia_saida',
    'conferencia_saida',
    'item_separacao',
    'ordem_separacao',
    'onda_pedido',
    'onda_separacao',
    'saldo_endereco',
    'movimento',
    'log_ordem_servico',
    'os_funcionario',
    'ordem_servico',
    'estoque',
    'item_nota_entrada',
    'nota_entrada',
    'agenda_wms',
    'conta_receber',
    'venda_efetivada',
    'item_pedido_venda',
    'pedido_venda',
    'conta_pagar',
    'item_devolucao_compra',
    'devolucao_compra',
    'compra_efetivada',
    'item_pedido_compra',
    'pedido_compra',
    'funcionario',
    'endereco',
    'ficha_operacional',
  ]

  for (const table of tablesToClean) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`)
      console.log(`  ✓ ${table}`)
    } catch (e: any) {
      if (e.message?.includes('42P01') || e.message?.includes('não existe') || e.message?.includes('does not exist')) {
        console.log(`  ⏭ ${table} (não existe)`)
      } else {
        console.log(`  ⚠ ${table}: ${e.message?.substring(0, 100)}`)
      }
    }
  }

  // Usuarios (manter apenas admin)
  console.log('\nUsuários:')
  try {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "usuario_empresa" WHERE "usuario_id" NOT IN (SELECT id FROM "usuario" WHERE email = 'admin@visiofab.com')`
    )
    console.log('  ✓ usuario_empresa (não-admin)')
  } catch (e: any) {
    console.log(`  ⚠ usuario_empresa: ${e.message?.substring(0, 100)}`)
  }

  try {
    await prisma.$executeRawUnsafe(`DELETE FROM "usuario" WHERE email != 'admin@visiofab.com'`)
    console.log('  ✓ usuarios não-admin removidos')
  } catch (e: any) {
    console.log(`  ⚠ usuario: ${e.message?.substring(0, 100)}`)
  }

  console.log('\n🎉 Limpeza concluída!')
}

main()
  .catch((e) => { console.error('❌ Erro fatal:', e.message); process.exit(0) })
  .finally(() => prisma.$disconnect())
