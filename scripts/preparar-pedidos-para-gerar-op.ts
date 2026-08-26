/**
 * Prepara 3 pedidos APROVADOS/CONFIRMADOS, sem OP ativa, para aparecerem na
 * aba "Gerar OP" da tela de Análise de Produção (PCP).
 *
 * Empresa alvo: VisioFab Demo (59512845-a692-4429-ace4-627566065fd4).
 *
 * Contexto (ver fluxo real do sistema):
 *   - Aprovar um orçamento gráfico cria um PedidoVenda em status RASCUNHO
 *     (origemPedido = ORCAMENTO_GRAFICO, orcamentoOrigemId apontando pro orçamento).
 *   - A partir de agora, confirmar o pedido NÃO gera OP automaticamente; a OP
 *     só é gerada pela tela de Análise de Produção.
 *   - listarPedidosElegiveis (aba "Gerar OP") mostra pedidos com status em
 *     [CONFIRMADO, APROVADO, EM_PRODUCAO, FATURADO] que NÃO tenham OP ativa.
 *
 * O que este script faz (idempotente):
 *   1. Para cada orçamento APROVADO da empresa que ainda não tem pedido
 *      confirmado sem OP, garante um PedidoVenda CONFIRMADO e sem OP ativa.
 *      - Se o orçamento já tem pedido em RASCUNHO → promove para CONFIRMADO.
 *      - Se o orçamento não tem pedido → cria um PedidoVenda CONFIRMADO
 *        (mesmo padrão de campos da rota /aprovar).
 *      - Se o pedido existente já tem OP ativa → cancela essa OP (reversível)
 *        para o pedido voltar a ser elegível.
 *   2. Para até 3 orçamentos, deixando-os prontos.
 *
 * Uso:
 *   $env:DATABASE_URL="<conn neon>"; npx tsx scripts/preparar-pedidos-para-gerar-op.ts
 */
import { prisma } from '../src/lib/prisma'

const EMPRESA_ID = '59512845-a692-4429-ace4-627566065fd4'
const META_PEDIDOS = 3

async function garantirTabelaPreco(empresaId: string): Promise<string> {
  const existente = await prisma.tabelaPreco.findFirst({
    where: { empresaId, status: true },
    select: { id: true },
  })
  if (existente) return existente.id

  const nova = await prisma.tabelaPreco.create({
    data: {
      empresaId,
      nome: 'Tabela Padrão (auto)',
      status: true,
    },
    select: { id: true },
  })
  console.log(`  → Tabela de preço criada: ${nova.id}`)
  return nova.id
}

async function proximoNumeroPedido(empresaId: string): Promise<number> {
  const ultimo = await prisma.pedidoVenda.findFirst({
    where: { empresaId },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  })
  return (ultimo?.numero ?? 0) + 1
}

/** Cancela qualquer OP ativa (não CANCELADA) vinculada ao pedido. */
async function cancelarOpsDoPedido(empresaId: string, pedidoVendaId: string, motivo: string) {
  const ops = await prisma.ordemProducao.findMany({
    where: { empresaId, pedidoVendaId, status: { not: 'CANCELADA' } },
    select: { id: true, numero: true },
  })
  for (const op of ops) {
    await prisma.ordemProducao.update({
      where: { id: op.id },
      data: { status: 'CANCELADA', motivoCancelamento: motivo },
    })
    await prisma.logOrdemProducao.create({
      data: {
        ordemProducaoId: op.id,
        statusAnterior: '',
        statusNovo: 'CANCELADA',
        usuarioId: null as any,
        observacao: motivo,
      },
    }).catch(() => { /* log opcional */ })
    console.log(`  → OP #${op.numero} cancelada (para reabrir o pedido na aba Gerar OP)`)
  }
}

async function main() {
  console.log(`Empresa: VisioFab Demo (${EMPRESA_ID})`)

  // Orçamentos APROVADOS da empresa (candidatos)
  const orcamentos = await prisma.orcamentoGrafico.findMany({
    where: { empresaId: EMPRESA_ID, status: 'APROVADO' },
    select: {
      id: true, numero: true, clienteId: true, clienteNome: true,
      vendedorId: true, precoVenda: true, pedidoVendaId: true,
    },
    orderBy: { numero: 'asc' },
  })

  console.log(`Orçamentos APROVADOS encontrados: ${orcamentos.length}`)

  const tabelaPrecoId = await garantirTabelaPreco(EMPRESA_ID)
  let preparados = 0

  for (const orc of orcamentos) {
    if (preparados >= META_PEDIDOS) break

    // Resolver clienteId: orçamentos podem ter só o nome (clienteNome) sem
    // vínculo formal. Nesse caso, localiza um Cliente pelo nome ou cria um
    // cadastro básico (razaoSocial + CNPJ placeholder), e vincula ao orçamento.
    let clienteId = orc.clienteId
    if (!clienteId) {
      const nome = (orc.clienteNome || '').trim()
      if (!nome) {
        console.log(`ORC #${orc.numero}: sem cliente (nem nome) — pulado.`)
        continue
      }
      const clienteExistente = await prisma.cliente.findFirst({
        where: {
          empresaId: EMPRESA_ID,
          OR: [
            { razaoSocial: { equals: nome, mode: 'insensitive' } },
            { nomeFantasia: { equals: nome, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      })
      if (clienteExistente) {
        clienteId = clienteExistente.id
        console.log(`ORC #${orc.numero} (${nome}): cliente localizado pelo nome.`)
      } else {
        // CNPJ placeholder único (14 dígitos derivados do id do orçamento)
        const cnpjPlaceholder = orc.id.replace(/\D/g, '').slice(0, 14).padEnd(14, '0')
        const novoCliente = await prisma.cliente.create({
          data: {
            empresaId: EMPRESA_ID,
            razaoSocial: nome,
            nomeFantasia: nome,
            cpfCnpj: cnpjPlaceholder,
            vendedorId: orc.vendedorId ?? undefined,
          },
          select: { id: true },
        })
        clienteId = novoCliente.id
        console.log(`ORC #${orc.numero} (${nome}): cliente criado (CNPJ placeholder ${cnpjPlaceholder}).`)
      }
      // Vincular clienteId de volta ao orçamento
      await prisma.orcamentoGrafico.update({
        where: { id: orc.id },
        data: { clienteId },
      }).catch(() => { /* ignora se falhar */ })
    }

    // Já existe pedido vinculado a este orçamento?
    const pedidoExistente = await prisma.pedidoVenda.findFirst({
      where: { empresaId: EMPRESA_ID, orcamentoOrigemId: orc.id, status: { not: 'CANCELADO' } },
      select: { id: true, numero: true, status: true },
    })

    let pedidoId: string
    let pedidoNumero: number

    if (pedidoExistente) {
      pedidoId = pedidoExistente.id
      pedidoNumero = pedidoExistente.numero
      // Promover para CONFIRMADO se ainda estiver em RASCUNHO
      if (pedidoExistente.status !== 'CONFIRMADO') {
        await prisma.pedidoVenda.update({
          where: { id: pedidoId },
          data: { status: 'CONFIRMADO' },
        })
        console.log(`ORC #${orc.numero} (${orc.clienteNome}): pedido #${pedidoNumero} ${pedidoExistente.status} → CONFIRMADO`)
      } else {
        console.log(`ORC #${orc.numero} (${orc.clienteNome}): pedido #${pedidoNumero} já CONFIRMADO`)
      }
    } else {
      // Criar pedido novo (mesmo padrão da rota /aprovar), já CONFIRMADO
      const numeroPedido = await proximoNumeroPedido(EMPRESA_ID)
      const novo = await prisma.pedidoVenda.create({
        data: {
          empresaId: EMPRESA_ID,
          numero: numeroPedido,
          clienteId,
          vendedorId: orc.vendedorId ?? undefined,
          tabelaPrecoId,
          valorTotal: orc.precoVenda ?? 0,
          status: 'CONFIRMADO',
          origemPedido: 'ORCAMENTO_GRAFICO',
          orcamentoOrigemId: orc.id,
        },
        select: { id: true, numero: true },
      })
      // Vincular o pedido de volta ao orçamento (como faz a rota /aprovar)
      await prisma.orcamentoGrafico.update({
        where: { id: orc.id },
        data: { pedidoVendaId: novo.id },
      }).catch(() => { /* campo pode já estar preenchido */ })
      pedidoId = novo.id
      pedidoNumero = novo.numero
      console.log(`ORC #${orc.numero} (${orc.clienteNome}): pedido #${pedidoNumero} CRIADO (CONFIRMADO)`)
    }

    // Garantir que não haja OP ativa (senão o pedido não aparece na aba)
    await cancelarOpsDoPedido(
      EMPRESA_ID,
      pedidoId,
      `Cancelada por script de preparação da demo — reabrir geração de OP via Análise de Produção`,
    )

    preparados++
  }

  console.log(`\n✅ ${preparados} pedido(s) preparado(s) e elegível(is) na aba "Gerar OP".`)
  if (preparados < META_PEDIDOS) {
    console.log(`⚠️ Só havia ${preparados} orçamento(s) aprovado(s) com cliente. Aprove mais orçamentos (ENVIADO → Aprovar) se quiser chegar a ${META_PEDIDOS}.`)
  }

  // Conferência final: o que a aba "Gerar OP" vai mostrar
  const statusAprovados = ['CONFIRMADO', 'APROVADO', 'EM_PRODUCAO', 'FATURADO']
  const elegiveis = await prisma.pedidoVenda.findMany({
    where: { empresaId: EMPRESA_ID, status: { in: statusAprovados } },
    select: { id: true, numero: true, status: true, cliente: { select: { razaoSocial: true, nomeFantasia: true } } },
  })
  const comOp = await prisma.ordemProducao.findMany({
    where: { empresaId: EMPRESA_ID, pedidoVendaId: { in: elegiveis.map(e => e.id) }, status: { not: 'CANCELADA' } },
    select: { pedidoVendaId: true },
  })
  const setComOp = new Set(comOp.map(o => o.pedidoVendaId))
  const finalElegiveis = elegiveis.filter(e => !setComOp.has(e.id))
  console.log(`\n=== Pedidos que aparecerão na aba "Gerar OP" (${finalElegiveis.length}) ===`)
  for (const e of finalElegiveis) {
    console.log(`  PED #${e.numero} | ${e.status} | ${e.cliente?.nomeFantasia || e.cliente?.razaoSocial || '—'}`)
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
