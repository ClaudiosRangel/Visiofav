import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🧹 Limpando dados de produção...')

  // Order matters due to FK constraints — delete children first

  // OS WMS related
  await prisma.$executeRawUnsafe(`DELETE FROM "os_funcionario_wms"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "log_movimento_wms"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "ordem_servico_wms"`)
  console.log('✅ OS WMS limpa')

  // Conferencia
  await prisma.$executeRawUnsafe(`DELETE FROM "item_conferencia_entrada"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "conferencia_entrada"`)
  console.log('✅ Conferência limpa')

  // Movimentos e saldos
  await prisma.$executeRawUnsafe(`DELETE FROM "saldo_endereco"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "movimento"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "log_ordem_servico"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "os_funcionario"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "ordem_servico"`)
  console.log('✅ Movimentos e saldos limpos')

  // Estoque
  await prisma.$executeRawUnsafe(`DELETE FROM "estoque"`)
  console.log('✅ Estoque limpo')

  // Notas de entrada
  await prisma.$executeRawUnsafe(`DELETE FROM "item_nota_entrada"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "nota_entrada"`)
  console.log('✅ Notas de entrada limpas')

  // Agendamentos
  await prisma.$executeRawUnsafe(`DELETE FROM "agenda_wms"`)
  console.log('✅ Agendamentos limpos')

  // Separação/Expedição
  await prisma.$executeRawUnsafe(`DELETE FROM "item_volume"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "carregamento_volume"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "carregamento"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "volume"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "item_conferencia_saida"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "conferencia_saida"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "item_separacao"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "ordem_separacao"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "onda_pedido"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "onda_separacao"`)
  console.log('✅ Separação/Expedição limpa')

  // Vendas
  await prisma.$executeRawUnsafe(`DELETE FROM "conta_receber"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "venda_efetivada"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "item_pedido_venda"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "pedido_venda"`)
  console.log('✅ Vendas limpas')

  // Compras
  await prisma.$executeRawUnsafe(`DELETE FROM "conta_pagar"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "item_devolucao_compra"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "devolucao_compra"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "compra_efetivada"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "item_pedido_compra"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "pedido_compra"`)
  console.log('✅ Compras limpas')

  // Funcionários (limpar vínculo com usuario primeiro)
  await prisma.$executeRawUnsafe(`UPDATE "funcionario" SET "usuario_id" = NULL`)
  await prisma.$executeRawUnsafe(`DELETE FROM "funcionario"`)
  console.log('✅ Funcionários limpos')

  // Usuarios (manter apenas admin)
  await prisma.$executeRawUnsafe(`DELETE FROM "usuario_empresa" WHERE "usuario_id" NOT IN (SELECT id FROM "usuario" WHERE email = 'admin@visiofab.com')`)
  await prisma.$executeRawUnsafe(`DELETE FROM "usuario" WHERE email != 'admin@visiofab.com'`)
  console.log('✅ Usuários limpos (mantido admin)')

  // Endereços
  await prisma.$executeRawUnsafe(`DELETE FROM "endereco"`)
  console.log('✅ Endereços limpos')

  // Fichas operacionais
  await prisma.$executeRawUnsafe(`DELETE FROM "ficha_operacional"`)
  console.log('✅ Fichas operacionais limpas')

  console.log('\n🎉 Limpeza concluída! Mantidos: empresa, CD, depósitos, zonas, estruturas, docas, produtos, SKUs, parâmetros, admin.')
}

main()
  .catch((e) => { console.error('❌ Erro:', e.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
