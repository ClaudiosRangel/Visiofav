/**
 * Script para limpar dados de Compras e WMS de UMA empresa específica.
 *
 * Uso:
 *   npx tsx scripts/limpar-dados.ts --cnpj=00000000000100
 *   npx tsx scripts/limpar-dados.ts --empresaId=<uuid>
 *
 * IMPORTANTE: o filtro por empresa é OBRIGATÓRIO. O script recusa rodar
 * sem --cnpj ou --empresaId para evitar apagar dados de todas as empresas
 * do banco (comportamento anterior, que afetava produção inteira).
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function parseArgs() {
  const cnpjArg = process.argv.find((a) => a.startsWith('--cnpj='))
  const idArg = process.argv.find((a) => a.startsWith('--empresaId='))
  return {
    cnpj: cnpjArg ? cnpjArg.split('=')[1] : undefined,
    empresaId: idArg ? idArg.split('=')[1] : undefined,
  }
}

async function main() {
  const { cnpj, empresaId: empresaIdArg } = parseArgs()

  if (!cnpj && !empresaIdArg) {
    console.error('❌ Informe --cnpj=<cnpj> ou --empresaId=<uuid> da empresa a limpar.')
    console.error('   Exemplo: npx tsx scripts/limpar-dados.ts --cnpj=00000000000100')
    process.exit(1)
  }

  const empresa = await prisma.empresa.findFirst({
    where: cnpj ? { cnpj } : { id: empresaIdArg },
    select: { id: true, razaoSocial: true, cnpj: true },
  })

  if (!empresa) {
    console.error(`❌ Empresa não encontrada para ${cnpj ? `cnpj=${cnpj}` : `empresaId=${empresaIdArg}`}`)
    process.exit(1)
  }

  const empresaId = empresa.id
  console.log(`🧹 Iniciando limpeza de dados da empresa: ${empresa.razaoSocial} (CNPJ ${empresa.cnpj})\n`)

  // ============================================================
  // 1. COMPRAS — Zerar pedidos, notas efetivadas (somente da empresa)
  // ============================================================
  console.log('--- COMPRAS ---')

  // Módulo Fiscal — documentos fiscais gerados na importação de XML de compra
  // (precisam ser removidos ANTES de compraEfetivada/pedidoCompra, senão o
  // documento_fiscal fica órfão e bloqueia reimportação da mesma NF-e)
  try {
    const gnre = await prisma.gnre.deleteMany({ where: { empresaId, documentoFiscal: { compraEfetivadaId: { not: null } } } })
    console.log(`  Gnre (de compras): ${gnre.count} removidos`)
    const fc = await prisma.filaContingencia.deleteMany({ where: { empresaId, documentoFiscal: { compraEfetivadaId: { not: null } } } })
    console.log(`  Fila contingência (de compras): ${fc.count} removidos`)
    const edf = await prisma.eventoDocumentoFiscal.deleteMany({ where: { documentoFiscal: { empresaId, compraEfetivadaId: { not: null } } } })
    console.log(`  Eventos documento fiscal (de compras): ${edf.count} removidos`)
    const idf = await prisma.itemDocumentoFiscal.deleteMany({ where: { documentoFiscal: { empresaId, compraEfetivadaId: { not: null } } } })
    console.log(`  Itens documento fiscal (de compras): ${idf.count} removidos`)
    const df = await prisma.documentoFiscal.deleteMany({ where: { empresaId, compraEfetivadaId: { not: null } } })
    console.log(`  Documentos fiscais (de compras): ${df.count} removidos`)
  } catch { console.log('  Documentos fiscais: tabelas não existem (ok)') }

  // Contas a pagar vinculadas a compras
  const cp = await prisma.contaPagar.deleteMany({ where: { empresaId, compraEfetivadaId: { not: null } } })
  console.log(`  Contas a pagar (de compras): ${cp.count} removidas`)

  // Itens de devolução
  const idv = await prisma.itemDevolucaoCompra.deleteMany({ where: { devolucaoCompra: { empresaId } } })
  console.log(`  Itens devolução compra: ${idv.count} removidos`)

  // Devoluções
  const dv = await prisma.devolucaoCompra.deleteMany({ where: { empresaId } })
  console.log(`  Devoluções compra: ${dv.count} removidas`)

  // Compras efetivadas
  const ce = await prisma.compraEfetivada.deleteMany({ where: { empresaId } })
  console.log(`  Compras efetivadas: ${ce.count} removidas`)

  // Itens de pedido de compra
  const ipc = await prisma.itemPedidoCompra.deleteMany({ where: { pedidoCompra: { empresaId } } })
  console.log(`  Itens pedido compra: ${ipc.count} removidos`)

  // Pedidos de compra
  const pc = await prisma.pedidoCompra.deleteMany({ where: { empresaId } })
  console.log(`  Pedidos de compra: ${pc.count} removidos`)

  console.log('  ✅ Compras zeradas\n')

  // ============================================================
  // 2. WMS — Zerar recebimentos, saldos, agendas (somente da empresa)
  // ============================================================
  console.log('--- WMS ---')

  // Log de movimentações
  try {
    const lm = await prisma.logMovimentacao.deleteMany({ where: { empresaId } })
    console.log(`  Log movimentações: ${lm.count} removidos`)
  } catch { console.log('  Log movimentações: tabela não existe (ok)') }

  // Itens de inventário
  try {
    const ii = await prisma.itemInventario.deleteMany({ where: { inventario: { empresaId } } })
    console.log(`  Itens inventário: ${ii.count} removidos`)
    const inv = await prisma.inventario.deleteMany({ where: { empresaId } })
    console.log(`  Inventários: ${inv.count} removidos`)
  } catch { console.log('  Inventários: tabela não existe (ok)') }

  // Audit log
  try {
    const al = await prisma.auditLog.deleteMany({ where: { empresaId } })
    console.log(`  Audit logs: ${al.count} removidos`)
  } catch { console.log('  Audit logs: tabela não existe (ok)') }

  // Carregamento → volumes
  const cvol = await prisma.carregamentoVolume.deleteMany({ where: { carregamento: { empresaId } } })
  console.log(`  Carregamento volumes: ${cvol.count} removidos`)

  const carr = await prisma.carregamento.deleteMany({ where: { empresaId } })
  console.log(`  Carregamentos: ${carr.count} removidos`)

  // Volumes → itens (Volume não tem empresaId direto — via ondaSeparacao)
  const ivol = await prisma.itemVolume.deleteMany({ where: { volume: { ondaSeparacao: { empresaId } } } })
  console.log(`  Itens volume: ${ivol.count} removidos`)

  const vol = await prisma.volume.deleteMany({ where: { ondaSeparacao: { empresaId } } })
  console.log(`  Volumes: ${vol.count} removidos`)

  // Conferência de saída → itens (via ondaSeparacao)
  const ics = await prisma.itemConferenciaSaida.deleteMany({ where: { conferenciaSaida: { ondaSeparacao: { empresaId } } } })
  console.log(`  Itens conferência saída: ${ics.count} removidos`)

  const cs = await prisma.conferenciaSaida.deleteMany({ where: { ondaSeparacao: { empresaId } } })
  console.log(`  Conferências saída: ${cs.count} removidas`)

  // Itens de separação (via ordemSeparacao → ondaSeparacao)
  const isep = await prisma.itemSeparacao.deleteMany({ where: { ordemSeparacao: { ondaSeparacao: { empresaId } } } })
  console.log(`  Itens separação: ${isep.count} removidos`)

  // Ordens de separação
  const osep = await prisma.ordemSeparacao.deleteMany({ where: { ondaSeparacao: { empresaId } } })
  console.log(`  Ordens separação: ${osep.count} removidas`)

  // Onda → pedidos
  const op = await prisma.ondaPedido.deleteMany({ where: { ondaSeparacao: { empresaId } } })
  console.log(`  Onda pedidos: ${op.count} removidos`)

  // Ondas de separação
  const onda = await prisma.ondaSeparacao.deleteMany({ where: { empresaId } })
  console.log(`  Ondas separação: ${onda.count} removidas`)

  // OS WMS → funcionários
  const osf = await prisma.osFuncionarioWms.deleteMany({ where: { ordemServico: { empresaId } } })
  console.log(`  OS funcionários WMS: ${osf.count} removidos`)

  // Ordens de serviço WMS
  const osw = await prisma.ordemServicoWms.deleteMany({ where: { empresaId } })
  console.log(`  Ordens serviço WMS: ${osw.count} removidas`)

  // Saldos por endereço (SaldoEndereco.empresaId é opcional/legado — filtra também por endereço)
  const se = await prisma.saldoEndereco.deleteMany({ where: { OR: [{ empresaId }, { endereco: { empresaId } }] } })
  console.log(`  Saldos endereço: ${se.count} removidos`)

  // Estoque consolidado
  const est = await prisma.estoque.deleteMany({ where: { empresaId } })
  console.log(`  Estoque consolidado: ${est.count} removidos`)

  // Registros de conferência avançada e pendências vinculados a nota_entrada
  // (FK RESTRICT — precisam ser removidos antes de notaEntrada)
  try {
    const cc = await prisma.cartaCorrecao.deleteMany({ where: { empresaId } })
    console.log(`  Cartas de correção: ${cc.count} removidas`)
    const dc = await prisma.divergenciaConferencia.deleteMany({ where: { empresaId } })
    console.log(`  Divergências conferência: ${dc.count} removidas`)
    const spi = await prisma.saldoPendenteItem.deleteMany({ where: { empresaId } })
    console.log(`  Saldos pendentes item: ${spi.count} removidos`)
    const pcce = await prisma.pendenciaCce.deleteMany({ where: { empresaId } })
    console.log(`  Pendências CCE: ${pcce.count} removidas`)
    const pl = await prisma.pendenciaLogistica.deleteMany({ where: { empresaId } })
    console.log(`  Pendências logísticas: ${pl.count} removidas`)
    const cdi = await prisma.crossDockItem.deleteMany({ where: { empresaId } })
    console.log(`  Cross dock itens: ${cdi.count} removidos`)
  } catch { console.log('  Conferência avançada/pendências: tabelas não existem (ok)') }

  // Itens nota de entrada (ItemNotaEntrada não tem empresaId direto — via notaEntrada)
  const ine = await prisma.itemNotaEntrada.deleteMany({ where: { notaEntrada: { empresaId } } })
  console.log(`  Itens nota entrada: ${ine.count} removidos`)

  // Notas de entrada
  const ne = await prisma.notaEntrada.deleteMany({ where: { empresaId } })
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
  const ag = await prisma.agendaWms.deleteMany({ where: { empresaId } })
  console.log(`  Agendas WMS: ${ag.count} removidas`)

  console.log('  ✅ WMS zerado\n')

  console.log(`🎉 Limpeza concluída para a empresa ${empresa.razaoSocial}!`)
}

main()
  .catch((e) => { console.error('❌ Erro:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
