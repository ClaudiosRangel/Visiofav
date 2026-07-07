/**
 * Script para limpar dados de Compras e WMS.
 * Executa: npx tsx scripts/limpar-dados.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🧹 Iniciando limpeza de dados...\n')

  // ============================================================
  // 1. COMPRAS — Zerar pedidos, notas efetivadas
  // ============================================================
  console.log('--- COMPRAS ---')

  // Módulo Fiscal — documentos fiscais gerados na importação de XML de compra
  // (precisam ser removidos ANTES de compraEfetivada/pedidoCompra, senão o
  // documento_fiscal fica órfão e bloqueia reimportação da mesma NF-e)
  try {
    const gnre = await prisma.gnre.deleteMany({ where: { documentoFiscal: { compraEfetivadaId: { not: null } } } })
    console.log(`  Gnre (de compras): ${gnre.count} removidos`)
    const fc = await prisma.filaContingencia.deleteMany({ where: { documentoFiscal: { compraEfetivadaId: { not: null } } } })
    console.log(`  Fila contingência (de compras): ${fc.count} removidos`)
    const edf = await prisma.eventoDocumentoFiscal.deleteMany({ where: { documentoFiscal: { compraEfetivadaId: { not: null } } } })
    console.log(`  Eventos documento fiscal (de compras): ${edf.count} removidos`)
    const idf = await prisma.itemDocumentoFiscal.deleteMany({ where: { documentoFiscal: { compraEfetivadaId: { not: null } } } })
    console.log(`  Itens documento fiscal (de compras): ${idf.count} removidos`)
    const df = await prisma.documentoFiscal.deleteMany({ where: { compraEfetivadaId: { not: null } } })
    console.log(`  Documentos fiscais (de compras): ${df.count} removidos`)
  } catch { console.log('  Documentos fiscais: tabelas não existem (ok)') }

  // Contas a pagar vinculadas a compras
  const cp = await prisma.contaPagar.deleteMany({ where: { compraEfetivadaId: { not: null } } })
  console.log(`  Contas a pagar (de compras): ${cp.count} removidas`)

  // Itens de devolução
  const idv = await prisma.itemDevolucaoCompra.deleteMany({})
  console.log(`  Itens devolução compra: ${idv.count} removidos`)

  // Devoluções
  const dv = await prisma.devolucaoCompra.deleteMany({})
  console.log(`  Devoluções compra: ${dv.count} removidas`)

  // Compras efetivadas
  const ce = await prisma.compraEfetivada.deleteMany({})
  console.log(`  Compras efetivadas: ${ce.count} removidas`)

  // Itens de pedido de compra
  const ipc = await prisma.itemPedidoCompra.deleteMany({})
  console.log(`  Itens pedido compra: ${ipc.count} removidos`)

  // Pedidos de compra
  const pc = await prisma.pedidoCompra.deleteMany({})
  console.log(`  Pedidos de compra: ${pc.count} removidos`)

  console.log('  ✅ Compras zeradas\n')

  // ============================================================
  // 2. WMS — Zerar recebimentos, saldos, agendas
  // ============================================================
  console.log('--- WMS ---')

  // Log de movimentações
  try {
    const lm = await prisma.logMovimentacao.deleteMany({})
    console.log(`  Log movimentações: ${lm.count} removidos`)
  } catch { console.log('  Log movimentações: tabela não existe (ok)') }

  // Itens de inventário
  try {
    const ii = await prisma.itemInventario.deleteMany({})
    console.log(`  Itens inventário: ${ii.count} removidos`)
    const inv = await prisma.inventario.deleteMany({})
    console.log(`  Inventários: ${inv.count} removidos`)
  } catch { console.log('  Inventários: tabela não existe (ok)') }

  // Audit log
  try {
    const al = await prisma.auditLog.deleteMany({})
    console.log(`  Audit logs: ${al.count} removidos`)
  } catch { console.log('  Audit logs: tabela não existe (ok)') }

  // Carregamento → volumes
  const cvol = await prisma.carregamentoVolume.deleteMany({})
  console.log(`  Carregamento volumes: ${cvol.count} removidos`)

  const carr = await prisma.carregamento.deleteMany({})
  console.log(`  Carregamentos: ${carr.count} removidos`)

  // Volumes → itens
  const ivol = await prisma.itemVolume.deleteMany({})
  console.log(`  Itens volume: ${ivol.count} removidos`)

  const vol = await prisma.volume.deleteMany({})
  console.log(`  Volumes: ${vol.count} removidos`)

  // Conferência de saída → itens
  const ics = await prisma.itemConferenciaSaida.deleteMany({})
  console.log(`  Itens conferência saída: ${ics.count} removidos`)

  const cs = await prisma.conferenciaSaida.deleteMany({})
  console.log(`  Conferências saída: ${cs.count} removidas`)

  // Itens de separação
  const isep = await prisma.itemSeparacao.deleteMany({})
  console.log(`  Itens separação: ${isep.count} removidos`)

  // Ordens de separação
  const osep = await prisma.ordemSeparacao.deleteMany({})
  console.log(`  Ordens separação: ${osep.count} removidas`)

  // Onda → pedidos
  const op = await prisma.ondaPedido.deleteMany({})
  console.log(`  Onda pedidos: ${op.count} removidos`)

  // Ondas de separação
  const onda = await prisma.ondaSeparacao.deleteMany({})
  console.log(`  Ondas separação: ${onda.count} removidas`)

  // OS WMS → funcionários
  const osf = await prisma.osFuncionarioWms.deleteMany({})
  console.log(`  OS funcionários WMS: ${osf.count} removidos`)

  // Ordens de serviço WMS
  const osw = await prisma.ordemServicoWms.deleteMany({})
  console.log(`  Ordens serviço WMS: ${osw.count} removidas`)

  // Saldos por endereço
  const se = await prisma.saldoEndereco.deleteMany({})
  console.log(`  Saldos endereço: ${se.count} removidos`)

  // Estoque consolidado
  const est = await prisma.estoque.deleteMany({})
  console.log(`  Estoque consolidado: ${est.count} removidos`)

  // Registros de conferência avançada e pendências vinculados a nota_entrada
  // (FK RESTRICT — precisam ser removidos antes de notaEntrada)
  try {
    const cc = await prisma.cartaCorrecao.deleteMany({})
    console.log(`  Cartas de correção: ${cc.count} removidas`)
    const dc = await prisma.divergenciaConferencia.deleteMany({})
    console.log(`  Divergências conferência: ${dc.count} removidas`)
    const spi = await prisma.saldoPendenteItem.deleteMany({})
    console.log(`  Saldos pendentes item: ${spi.count} removidos`)
    const pcce = await prisma.pendenciaCce.deleteMany({})
    console.log(`  Pendências CCE: ${pcce.count} removidas`)
    const pl = await prisma.pendenciaLogistica.deleteMany({})
    console.log(`  Pendências logísticas: ${pl.count} removidas`)
    const cdi = await prisma.crossDockItem.deleteMany({})
    console.log(`  Cross dock itens: ${cdi.count} removidos`)
  } catch { console.log('  Conferência avançada/pendências: tabelas não existem (ok)') }

  // Itens nota de entrada
  const ine = await prisma.itemNotaEntrada.deleteMany({})
  console.log(`  Itens nota entrada: ${ine.count} removidos`)

  // Notas de entrada
  const ne = await prisma.notaEntrada.deleteMany({})
  console.log(`  Notas de entrada: ${ne.count} removidas`)

  // Conferências (modelo antigo)
  try {
    // @ts-ignore
    const confItens = await prisma.itemConferencia?.deleteMany?.({})
    if (confItens) console.log(`  Itens conferência: ${confItens.count} removidos`)
  } catch { /* modelo pode não existir */ }

  try {
    // @ts-ignore
    const conf = await prisma.conferencia?.deleteMany?.({})
    if (conf) console.log(`  Conferências: ${conf.count} removidas`)
  } catch { /* modelo pode não existir */ }

  // Agenda WMS
  const ag = await prisma.agendaWms.deleteMany({})
  console.log(`  Agendas WMS: ${ag.count} removidas`)

  console.log('  ✅ WMS zerado\n')

  console.log('🎉 Limpeza concluída!')
}

main()
  .catch((e) => { console.error('❌ Erro:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
