/**
 * teste-fluxo-representante-e2e.ts
 *
 * Script E2E que simula o fluxo completo do Portal do Representante:
 * 1. Encontra empresa "VisioFab Demo" (ou primeira disponível)
 * 2. Encontra vendedor ATIVO na empresa
 * 3. Cria RepresentanteCredencial (ou pula se já existe)
 * 4. Encontra 2 clientes na empresa
 * 5. Encontra 2-3 produtos na empresa
 * 6. Cria 2 SolicitacaoOrcamentoRep (uma por cliente, com itens)
 * 7. Simula "calcular" — atualiza status para CALCULADO com preços fictícios
 * 8. Simula "converter em pedido" — cria PedidoVenda para cada solicitação
 * 9. Cria OrdemProducao para cada PedidoVenda (status PROGRAMADA)
 * 10. Imprime resumo final
 *
 * ⚠️  RODA CONTRA PRODUÇÃO — apenas cria registros, nunca deleta.
 *
 * Uso: npx tsx scripts/teste-fluxo-representante-e2e.ts
 */

import { prisma } from '../src/lib/prisma'
import bcrypt from 'bcryptjs'

// ─── Helpers ────────────────────────────────────────────────────────────────────

function ts(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

function log(emoji: string, msg: string) {
  console.log(`[${ts()}] ${emoji} ${msg}`)
}

function logError(emoji: string, msg: string, err: unknown) {
  console.error(`[${ts()}] ${emoji} ${msg}`, err instanceof Error ? err.message : err)
}

// ─── Resumo ─────────────────────────────────────────────────────────────────────

interface Resumo {
  empresaId: string
  empresaNome: string
  vendedorId: string
  vendedorNome: string
  representanteId: string
  representanteEmail: string
  representanteSenha: string
  solicitacaoIds: string[]
  pedidoVendaNumeros: number[]
  ordemProducaoNumeros: number[]
}

const resumo: Resumo = {
  empresaId: '',
  empresaNome: '',
  vendedorId: '',
  vendedorNome: '',
  representanteId: '',
  representanteEmail: 'teste-rep@vizor.test',
  representanteSenha: 'Teste123!',
  solicitacaoIds: [],
  pedidoVendaNumeros: [],
  ordemProducaoNumeros: [],
}

// ─── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  log('🚀', '=== INÍCIO DO TESTE E2E — FLUXO REPRESENTANTE ===')

  // ─── STEP 1: Encontrar empresa ──────────────────────────────────────────────
  log('🏢', 'STEP 1: Buscando empresa "VisioFab Demo" (ou primeira disponível)...')
  try {
    let empresa = await prisma.empresa.findFirst({
      where: { nomeFantasia: { contains: 'VisioFab Demo', mode: 'insensitive' } },
    })
    if (!empresa) {
      empresa = await prisma.empresa.findFirst({ where: { status: true } })
    }
    if (!empresa) throw new Error('Nenhuma empresa encontrada no banco!')

    resumo.empresaId = empresa.id
    resumo.empresaNome = empresa.nomeFantasia || empresa.razaoSocial
    log('✅', `Empresa encontrada: "${resumo.empresaNome}" (ID: ${empresa.id})`)
  } catch (err) {
    logError('❌', 'Falha ao buscar empresa — abortando.', err)
    process.exit(1)
  }

  // ─── STEP 2: Encontrar vendedor ATIVO ───────────────────────────────────────
  log('👤', 'STEP 2: Buscando vendedor ATIVO na empresa...')
  try {
    const vendedor = await prisma.vendedor.findFirst({
      where: { empresaId: resumo.empresaId, status: true },
    })
    if (!vendedor) throw new Error('Nenhum vendedor ATIVO encontrado!')

    resumo.vendedorId = vendedor.id
    resumo.vendedorNome = vendedor.nome
    log('✅', `Vendedor: "${vendedor.nome}" (ID: ${vendedor.id}, CPF: ${vendedor.cpf})`)
  } catch (err) {
    logError('❌', 'Falha ao buscar vendedor — abortando.', err)
    process.exit(1)
  }

  // ─── STEP 3: Criar RepresentanteCredencial ─────────────────────────────────
  log('🔐', 'STEP 3: Criando RepresentanteCredencial (idempotente)...')
  try {
    const existente = await prisma.representanteCredencial.findFirst({
      where: { empresaId: resumo.empresaId, email: resumo.representanteEmail },
    })

    if (existente) {
      resumo.representanteId = existente.id
      log('⏭️', `Representante já existe (ID: ${existente.id}) — pulando criação.`)
    } else {
      // Verificar se o vendedor já tem uma credencial (vendedorId é @unique)
      const credencialVendedor = await prisma.representanteCredencial.findFirst({
        where: { vendedorId: resumo.vendedorId },
      })

      if (credencialVendedor) {
        resumo.representanteId = credencialVendedor.id
        resumo.representanteEmail = credencialVendedor.email
        log('⏭️', `Vendedor já tem credencial com email "${credencialVendedor.email}" (ID: ${credencialVendedor.id}) — usando essa.`)
      } else {
        const senhaHash = await bcrypt.hash(resumo.representanteSenha, 10)
        const novoRep = await prisma.representanteCredencial.create({
          data: {
            empresaId: resumo.empresaId,
            vendedorId: resumo.vendedorId,
            email: resumo.representanteEmail,
            senhaHash,
            senhaTemporaria: false,
            status: 'ATIVO',
            notificacaoEmail: true,
          },
        })
        resumo.representanteId = novoRep.id
        log('✅', `Representante criado! ID: ${novoRep.id}, Email: ${resumo.representanteEmail}`)
      }
    }
  } catch (err) {
    logError('❌', 'Falha ao criar representante — abortando.', err)
    process.exit(1)
  }

  // ─── STEP 4: Encontrar 2 clientes ──────────────────────────────────────────
  log('👥', 'STEP 4: Buscando 2 clientes na empresa...')
  let clientes: { id: string; razaoSocial: string; cpfCnpj: string }[] = []
  try {
    clientes = await prisma.cliente.findMany({
      where: { empresaId: resumo.empresaId },
      select: { id: true, razaoSocial: true, cpfCnpj: true },
      take: 2,
    })
    if (clientes.length < 2) {
      log('⚠️', `Apenas ${clientes.length} cliente(s) encontrado(s). Continuando com o que temos.`)
    }
    for (const c of clientes) {
      log('✅', `  Cliente: "${c.razaoSocial}" (ID: ${c.id})`)
    }
    if (clientes.length === 0) throw new Error('Nenhum cliente encontrado!')
  } catch (err) {
    logError('❌', 'Falha ao buscar clientes — abortando.', err)
    process.exit(1)
  }

  // ─── STEP 5: Encontrar 2-3 produtos ────────────────────────────────────────
  log('📦', 'STEP 5: Buscando 2-3 produtos na empresa...')
  let produtos: { id: string; nome: string; codigo: string; precoBase: any }[] = []
  try {
    produtos = await prisma.produto.findMany({
      where: { empresaId: resumo.empresaId, status: true },
      select: { id: true, nome: true, codigo: true, precoBase: true },
      take: 3,
    })
    if (produtos.length < 2) {
      log('⚠️', `Apenas ${produtos.length} produto(s) encontrado(s). Continuando com o que temos.`)
    }
    for (const p of produtos) {
      log('✅', `  Produto: "${p.nome}" (Cód: ${p.codigo}, ID: ${p.id})`)
    }
    if (produtos.length === 0) throw new Error('Nenhum produto encontrado!')
  } catch (err) {
    logError('❌', 'Falha ao buscar produtos — abortando.', err)
    process.exit(1)
  }

  // ─── STEP 6: Criar 2 SolicitacaoOrcamentoRep ──────────────────────────────
  log('📝', 'STEP 6: Criando SolicitacaoOrcamentoRep (uma por cliente)...')
  for (let i = 0; i < Math.min(clientes.length, 2); i++) {
    const cliente = clientes[i]
    try {
      const solicitacao = await prisma.solicitacaoOrcamentoRep.create({
        data: {
          empresaId: resumo.empresaId,
          representanteId: resumo.representanteId,
          vendedorId: resumo.vendedorId,
          clienteId: cliente.id,
          clienteNome: cliente.razaoSocial,
          clienteCpfCnpj: cliente.cpfCnpj,
          tipoEmbalagem: i === 0 ? 'Caixa Papelão Onda B' : 'Cartucho Papel Cartão',
          medidaLargura: i === 0 ? 300 : 150,
          medidaAltura: i === 0 ? 200 : 100,
          medidaComprimento: i === 0 ? 400 : 250,
          quantidade: i === 0 ? 5000 : 10000,
          acabamentos: i === 0 ? 'Impressão 4x0, Verniz UV total' : 'Impressão 2x0, Laminação fosca',
          observacoes: `Solicitação de teste E2E #${i + 1} — criada por script em ${ts()}`,
          status: 'PENDENTE',
        },
      })
      resumo.solicitacaoIds.push(solicitacao.id)
      log('✅', `  Solicitação #${i + 1} criada: ID ${solicitacao.id} | Cliente: ${cliente.razaoSocial}`)
    } catch (err) {
      logError('⚠️', `  Erro ao criar solicitação #${i + 1} — continuando...`, err)
    }
  }
  log('📊', `  Total de solicitações criadas: ${resumo.solicitacaoIds.length}`)

  // ─── STEP 7: Simular "calcular" — atualizar status para CALCULADO ──────────
  log('🧮', 'STEP 7: Simulando cálculo de orçamento (status → CALCULADO + preços)...')
  for (let i = 0; i < resumo.solicitacaoIds.length; i++) {
    const solId = resumo.solicitacaoIds[i]
    try {
      const precoUnitario = i === 0 ? 2.85 : 1.45
      const quantidade = i === 0 ? 5000 : 10000
      const precoVenda = precoUnitario * quantidade

      await prisma.solicitacaoOrcamentoRep.update({
        where: { id: solId },
        data: {
          status: 'CALCULADO',
          precoUnitario,
          precoVenda,
        },
      })
      log('✅', `  Solicitação ${solId.slice(0, 8)}... → CALCULADO | Preço unit: R$${precoUnitario.toFixed(4)} | Total: R$${precoVenda.toFixed(2)}`)
    } catch (err) {
      logError('⚠️', `  Erro ao calcular solicitação ${solId.slice(0, 8)}... — continuando...`, err)
    }
  }

  // ─── STEP 8: Simular "converter em pedido" — criar PedidoVenda ─────────────
  log('🛒', 'STEP 8: Convertendo solicitações em PedidoVenda...')

  // Buscar tabela de preço da empresa (obrigatório para PedidoVenda)
  let tabelaPrecoId: string | null = null
  try {
    let tabela = await prisma.tabelaPreco.findFirst({
      where: { empresaId: resumo.empresaId, status: true },
      select: { id: true, nome: true },
    })
    if (!tabela) {
      log('⚠️', '  Nenhuma tabela de preço ATIVA encontrada — criando uma de teste...')
      tabela = await prisma.tabelaPreco.create({
        data: {
          empresaId: resumo.empresaId,
          nome: 'Tabela Padrão (teste E2E)',
          status: true,
        },
        select: { id: true, nome: true },
      })
      log('✅', `  Tabela de preço criada: "${tabela.nome}" (ID: ${tabela.id})`)
    } else {
      log('📋', `  Tabela de preço: "${tabela.nome}" (ID: ${tabela.id})`)
    }
    tabelaPrecoId = tabela.id
  } catch (err) {
    logError('❌', 'Falha ao buscar/criar tabela de preço — não será possível criar pedidos.', err)
  }

  if (tabelaPrecoId) {
    for (let i = 0; i < resumo.solicitacaoIds.length; i++) {
      const solId = resumo.solicitacaoIds[i]
      const cliente = clientes[i]
      try {
        // Obter próximo número de pedido
        const ultimoPedido = await prisma.pedidoVenda.findFirst({
          where: { empresaId: resumo.empresaId },
          orderBy: { numero: 'desc' },
          select: { numero: true },
        })
        const proximoNumero = (ultimoPedido?.numero ?? 0) + 1

        const precoUnitario = i === 0 ? 2.85 : 1.45
        const quantidade = i === 0 ? 5000 : 10000
        const valorTotal = precoUnitario * quantidade

        // Selecionar produtos para os itens do pedido
        const itensProdutos = produtos.slice(0, Math.min(produtos.length, 2))

        const pedido = await prisma.pedidoVenda.create({
          data: {
            empresaId: resumo.empresaId,
            numero: proximoNumero,
            clienteId: cliente.id,
            vendedorId: resumo.vendedorId,
            tabelaPrecoId,
            valorTotal,
            status: 'CONFIRMADO',
            origemPedido: 'PORTAL_REP',
            observacao: `Pedido gerado via script E2E a partir da solicitação ${solId.slice(0, 8)}... em ${ts()}`,
            itens: {
              create: itensProdutos.map((prod, idx) => ({
                produtoId: prod.id,
                quantidade: Math.ceil(quantidade / itensProdutos.length),
                unidade: 'UN',
                precoBase: precoUnitario,
                desconto: 0,
                precoFinal: precoUnitario,
                valorTotal: precoUnitario * Math.ceil(quantidade / itensProdutos.length),
              })),
            },
          },
        })

        resumo.pedidoVendaNumeros.push(proximoNumero)
        log('✅', `  PedidoVenda #${proximoNumero} criado (ID: ${pedido.id}) | Cliente: ${cliente.razaoSocial} | Valor: R$${valorTotal.toFixed(2)}`)

        // Atualizar solicitação com referência ao pedido (status ENVIADO)
        await prisma.solicitacaoOrcamentoRep.update({
          where: { id: solId },
          data: { status: 'ENVIADO' },
        })
      } catch (err) {
        logError('⚠️', `  Erro ao criar PedidoVenda para solicitação ${solId.slice(0, 8)}... — continuando...`, err)
      }
    }
  }
  log('📊', `  Total de pedidos criados: ${resumo.pedidoVendaNumeros.length}`)

  // ─── STEP 9: Criar OrdemProducao para cada PedidoVenda ─────────────────────
  log('🏭', 'STEP 9: Criando OrdemProducao para cada PedidoVenda (status PROGRAMADA)...')
  for (let i = 0; i < resumo.pedidoVendaNumeros.length; i++) {
    const numPedido = resumo.pedidoVendaNumeros[i]
    try {
      // Buscar o pedido criado
      const pedido = await prisma.pedidoVenda.findFirst({
        where: { empresaId: resumo.empresaId, numero: numPedido },
        select: { id: true, clienteId: true, itens: { select: { produtoId: true, quantidade: true } } },
      })
      if (!pedido) {
        log('⚠️', `  PedidoVenda #${numPedido} não encontrado — pulando.`)
        continue
      }

      // Obter próximo número de OP
      const ultimaOp = await prisma.ordemProducao.findFirst({
        where: { empresaId: resumo.empresaId },
        orderBy: { numero: 'desc' },
        select: { numero: true },
      })
      const proximoNumeroOp = (ultimaOp?.numero ?? 0) + 1

      // Usar o primeiro produto do pedido para a OP
      const itemPrincipal = pedido.itens[0]

      const op = await prisma.ordemProducao.create({
        data: {
          empresaId: resumo.empresaId,
          numero: proximoNumeroOp,
          produtoId: itemPrincipal?.produtoId ?? null,
          quantidade: itemPrincipal?.quantidade ?? 1000,
          unidadeMedida: 'UN',
          status: 'PROGRAMADA',
          prioridade: 'NORMAL',
          pedidoVendaId: pedido.id,
          clienteId: pedido.clienteId,
          origemImportacao: 'MANUAL',
          observacoes: `OP gerada via script E2E — PedidoVenda #${numPedido} em ${ts()}`,
        },
      })

      resumo.ordemProducaoNumeros.push(proximoNumeroOp)
      log('✅', `  OrdemProducao #${proximoNumeroOp} criada (ID: ${op.id}) | Status: PROGRAMADA | Pedido: #${numPedido}`)
    } catch (err) {
      logError('⚠️', `  Erro ao criar OP para PedidoVenda #${numPedido} — continuando...`, err)
    }
  }
  log('📊', `  Total de OPs criadas: ${resumo.ordemProducaoNumeros.length}`)

  // ─── STEP 10: Resumo final ─────────────────────────────────────────────────
  console.log('')
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log('  📋 RESUMO DO TESTE E2E — FLUXO REPRESENTANTE')
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log('')
  console.log(`  🏢 Empresa: ${resumo.empresaNome} (${resumo.empresaId})`)
  console.log(`  👤 Vendedor: ${resumo.vendedorNome} (${resumo.vendedorId})`)
  console.log('')
  console.log('  ─── Credenciais do Representante (para login) ───')
  console.log(`  📧 Email: ${resumo.representanteEmail}`)
  console.log(`  🔑 Senha: ${resumo.representanteSenha}`)
  console.log(`  🆔 ID: ${resumo.representanteId}`)
  console.log('')
  console.log('  ─── Registros criados ───')
  console.log(`  📝 Solicitações: ${resumo.solicitacaoIds.length}`)
  resumo.solicitacaoIds.forEach((id, idx) => {
    console.log(`     ${idx + 1}. ${id}`)
  })
  console.log(`  🛒 Pedidos de Venda: ${resumo.pedidoVendaNumeros.join(', ') || 'nenhum'}`)
  console.log(`  🏭 Ordens de Produção: ${resumo.ordemProducaoNumeros.join(', ') || 'nenhuma'}`)
  console.log('')
  console.log('═══════════════════════════════════════════════════════════════════')
  log('🏁', '=== TESTE E2E CONCLUÍDO ===')
}

// ─── Execute ────────────────────────────────────────────────────────────────────

main()
  .catch((err) => {
    logError('💥', 'Erro fatal não tratado:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
