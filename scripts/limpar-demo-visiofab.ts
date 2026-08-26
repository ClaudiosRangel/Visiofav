/**
 * LIMPEZA TOTAL dos dados de teste da empresa VisioFab Demo.
 *
 * ATENÇÃO: Este script só apaga dados da empresa 59512845-a692-4429-ace4-627566065fd4.
 * Não toca em nenhuma outra empresa (Carton Wega, etc).
 *
 * Módulos limpos: Portal Representante, Pedidos de Venda, Orçamento Gráfico,
 * PCP (OPs, etapas, apontamentos, materiais, logs, reservas, sugestões), Clientes.
 *
 * Uso:
 *   $env:DATABASE_URL="<conn neon>"; npx tsx scripts/limpar-demo-visiofab.ts
 */
import { prisma } from '../src/lib/prisma'

const EMPRESA_ID = '59512845-a692-4429-ace4-627566065fd4'

async function confirmarEmpresa() {
  const emp = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, select: { razaoSocial: true, nomeFantasia: true } })
  if (!emp) throw new Error(`Empresa ${EMPRESA_ID} não encontrada!`)
  console.log(`Empresa: ${emp.nomeFantasia || emp.razaoSocial} (${EMPRESA_ID})`)
  // Dupla verificação: NÃO é Carton Wega
  if ((emp.razaoSocial || '').toLowerCase().includes('carton') || (emp.nomeFantasia || '').toLowerCase().includes('carton')) {
    throw new Error('ABORTADO: esta empresa parece ser a Carton Wega! Script só deve rodar na VisioFab Demo.')
  }
}

async function main() {
  await confirmarEmpresa()
  console.log('\n🗑️  Iniciando limpeza...')

  // 1. PCP — apontamentos, reservas, sugestões, logs, etapas, itens, liberações, OPs
  const opIds = (await prisma.ordemProducao.findMany({ where: { empresaId: EMPRESA_ID }, select: { id: true } })).map(o => o.id)
  if (opIds.length > 0) {
    await prisma.apontamentoEtapa.deleteMany({ where: { etapaOrdemProducao: { ordemProducaoId: { in: opIds } } } })
    await prisma.apontamentoProducao.deleteMany({ where: { ordemProducaoId: { in: opIds } } })
    await prisma.logOrdemProducao.deleteMany({ where: { ordemProducaoId: { in: opIds } } })
    await prisma.programacaoEntrega.deleteMany({ where: { ordemProducaoId: { in: opIds } } })
    await prisma.etapaOrdemProducao.deleteMany({ where: { ordemProducaoId: { in: opIds } } })
    await prisma.itemOrdemProducao.deleteMany({ where: { ordemProducaoId: { in: opIds } } })
    // Liberações e itens de liberação
    const libIds = (await prisma.liberacaoMaterial.findMany({ where: { ordemProducaoId: { in: opIds } }, select: { id: true } })).map(l => l.id)
    if (libIds.length > 0) {
      await prisma.itemLiberacao.deleteMany({ where: { liberacaoMaterialId: { in: libIds } } })
      await prisma.liberacaoMaterial.deleteMany({ where: { id: { in: libIds } } })
    }
    // Reservas e sugestões de compra
    await prisma.reservaProducao.deleteMany({ where: { ordemProducaoId: { in: opIds } } }).catch(() => {})
    await prisma.sugestaoCompra.deleteMany({ where: { ordemProducaoId: { in: opIds } } }).catch(() => {})
    // Variações
    await prisma.variacaoOrdemProducao.deleteMany({ where: { ordemProducaoId: { in: opIds } } }).catch(() => {})
    // OPs
    await prisma.ordemProducao.deleteMany({ where: { empresaId: EMPRESA_ID } })
    console.log(`  ✅ PCP: ${opIds.length} OPs e todas as dependências apagadas`)
  } else {
    console.log('  — Nenhuma OP encontrada')
  }

  // 2. Orçamento Gráfico
  const orcDel = await prisma.orcamentoGrafico.deleteMany({ where: { empresaId: EMPRESA_ID } })
  console.log(`  ✅ Orçamentos Gráficos: ${orcDel.count} apagados`)

  // 3. Pedidos de Venda (itens, depois pedidos)
  const pedIds = (await prisma.pedidoVenda.findMany({ where: { empresaId: EMPRESA_ID }, select: { id: true } })).map(p => p.id)
  if (pedIds.length > 0) {
    await prisma.itemPedidoVenda.deleteMany({ where: { pedidoVendaId: { in: pedIds } } })
    await prisma.pedidoVenda.deleteMany({ where: { empresaId: EMPRESA_ID } })
    console.log(`  ✅ Pedidos de Venda: ${pedIds.length} apagados (com itens)`)
  } else {
    console.log('  — Nenhum pedido encontrado')
  }

  // 4. Portal Representante — solicitações (se existir no schema)
  try {
    const solDel = await (prisma as any).solicitacaoOrcamento.deleteMany({ where: { empresaId: EMPRESA_ID } })
    console.log(`  ✅ Portal Representante: ${solDel.count} solicitações apagadas`)
  } catch {
    console.log('  — Portal Representante: tabela de solicitações não disponível, pulando')
  }

  // 5. Clientes demo — tentativa. Se falhar por FK, apenas reporta (clientes
  // serão reaproveitados pelo script de carga, não causam problema se ficarem).
  try {
    // Limpar FKs conhecidas para cliente
    const clienteIds = (await prisma.cliente.findMany({ where: { empresaId: EMPRESA_ID }, select: { id: true } })).map(c => c.id)
    if (clienteIds.length > 0) {
      await prisma.$executeRawUnsafe(`DELETE FROM contrato_armazenagem WHERE cliente_id = ANY($1::text[])`, clienteIds).catch(() => {})
      await prisma.$executeRawUnsafe(`DELETE FROM conta_receber WHERE cliente_id = ANY($1::text[])`, clienteIds).catch(() => {})
      await prisma.$executeRawUnsafe(`DELETE FROM orcamento WHERE cliente_id = ANY($1::text[])`, clienteIds).catch(() => {})
      const cliDel = await prisma.cliente.deleteMany({ where: { empresaId: EMPRESA_ID } })
      console.log(`  ✅ Clientes: ${cliDel.count} apagados`)
    } else {
      console.log('  — Nenhum cliente encontrado')
    }
  } catch (e: any) {
    console.log(`  ⚠️ Clientes: não foi possível apagar todos (FK pendente: ${e?.meta?.constraint || e.message}). Serão reaproveitados.`)
  }

  // 6. Centros de produção, tipos de processo, roteiros, estruturas (demo)
  // NÃO apagamos: se quiser manter o cadastro base para o script de carga.
  // Se precisar limpar, descomentar:
  // await prisma.centroProducao.deleteMany({ where: { empresaId: EMPRESA_ID } })
  // await prisma.tipoProcesso.deleteMany({ where: { empresaId: EMPRESA_ID } })

  // 7. De/Para de importação
  await prisma.deParaImportacao.deleteMany({ where: { empresaId: EMPRESA_ID } }).catch(() => {})
  console.log('  ✅ De/Para importação limpo')

  console.log('\n✅ Limpeza concluída. VisioFab Demo está zerada para nova carga.')
}

main().then(() => process.exit(0)).catch((e) => { console.error('❌', e); process.exit(1) })
