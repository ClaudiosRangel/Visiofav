import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function safeDelete(table: string) {
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`)
    console.log(`  ✓ ${table}`)
  } catch (e: any) {
    if (e.message?.includes('42P01') || e.message?.includes('não existe') || e.message?.includes('does not exist')) {
      console.log(`  ⏭ ${table} (tabela não existe, pulando)`)
    } else {
      console.log(`  ⚠ ${table}: ${e.message}`)
    }
  }
}

async function safeRaw(sql: string, label: string) {
  try {
    await prisma.$executeRawUnsafe(sql)
    console.log(`  ✓ ${label}`)
  } catch (e: any) {
    console.log(`  ⚠ ${label}: ${e.message}`)
  }
}

async function main() {
  console.log('🧹 Limpando dados de produção...\n')

  // OS WMS related
  console.log('OS WMS:')
  await safeDelete('os_funcionario_wms')
  await safeDelete('log_movimento_wms')
  await safeDelete('ordem_servico_wms')

  // Conferencia
  console.log('\nConferência:')
  await safeDelete('item_conferencia_entrada')
  await safeDelete('conferencia_entrada')

  // Separação/Expedição
  console.log('\nSeparação/Expedição:')
  await safeDelete('item_volume')
  await safeDelete('carregamento_volume')
  await safeDelete('carregamento')
  await safeDelete('volume')
  await safeDelete('item_conferencia_saida')
  await safeDelete('conferencia_saida')
  await safeDelete('item_separacao')
  await safeDelete('ordem_separacao')
  await safeDelete('onda_pedido')
  await safeDelete('onda_separacao')

  // Movimentos e saldos
  console.log('\nMovimentos e saldos:')
  await safeDelete('saldo_endereco')
  await safeDelete('movimento')
  await safeDelete('log_ordem_servico')
  await safeDelete('os_funcionario')
  await safeDelete('ordem_servico')

  // Estoque
  console.log('\nEstoque:')
  await safeDelete('estoque')

  // Notas de entrada
  console.log('\nNotas de entrada:')
  await safeDelete('item_nota_entrada')
  await safeDelete('nota_entrada')

  // Agendamentos
  console.log('\nAgendamentos:')
  await safeDelete('agenda_wms')

  // Vendas
  console.log('\nVendas:')
  await safeDelete('conta_receber')
  await safeDelete('venda_efetivada')
  await safeDelete('item_pedido_venda')
  await safeDelete('pedido_venda')

  // Compras
  console.log('\nCompras:')
  await safeDelete('conta_pagar')
  await safeDelete('item_devolucao_compra')
  await safeDelete('devolucao_compra')
  await safeDelete('compra_efetivada')
  await safeDelete('item_pedido_compra')
  await safeDelete('pedido_compra')

  // Funcionários
  console.log('\nFuncionários:')
  await safeRaw(`UPDATE "funcionario" SET "usuario_id" = NULL`, 'desvincular usuarios')
  await safeDelete('funcionario')

  // Usuarios (manter apenas admin)
  console.log('\nUsuários:')
  await safeRaw(
    `DELETE FROM "usuario_empresa" WHERE "usuario_id" NOT IN (SELECT id FROM "usuario" WHERE email = 'admin@visiofab.com')`,
    'usuario_empresa (não-admin)'
  )
  await safeRaw(
    `DELETE FROM "usuario" WHERE email != 'admin@visiofab.com'`,
    'usuarios não-admin'
  )

  // Endereços
  console.log('\nEndereços:')
  await safeDelete('endereco')

  // Fichas operacionais
  console.log('\nFichas operacionais:')
  await safeDelete('ficha_operacional')

  console.log('\n🎉 Limpeza concluída! Mantidos: empresa, CD, depósitos, zonas, estruturas, docas, produtos, SKUs, parâmetros, admin.')
}

main()
  .catch((e) => { console.error('❌ Erro fatal:', e.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
