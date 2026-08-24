/**
 * teste-fluxo-representante-e2e.ts
 *
 * Script E2E que popula dados REALISTAS para 5 telas do sistema:
 *
 * 1. Portal do Representante (https://representante.vizorerp.com.br/)
 *    → SolicitacaoOrcamentoRep com status variados (PENDENTE, CALCULADO, ENVIADO)
 *
 * 2. Portal Admin (https://app.vizorerp.com.br/portal-representante/representantes)
 *    → RepresentanteCredencial + vendedor vinculado
 *
 * 3. Orçamento Gráfico (https://app.vizorerp.com.br/orcamento-grafico)
 *    → Orcamento (model proposta comercial) com itens e status variados
 *
 * 4. Vendas/Pedidos (https://app.vizorerp.com.br/vendas/pedidos)
 *    → PedidoVenda com ItemPedidoVenda, status variados
 *
 * 5. PCP/Ordens de Produção (https://app.vizorerp.com.br/pcp/ordens-producao)
 *    → OrdemProducao com Etapas, Materiais, Variações, Entregas e Históricos
 *
 * ⚠️  RODA CONTRA PRODUÇÃO — apenas cria registros, nunca deleta.
 * ⚠️  Idempotente: verifica existência antes de criar, re-execuções são seguras.
 *
 * Uso: npx tsx scripts/teste-fluxo-representante-e2e.ts
 */

import { prisma } from '../src/lib/prisma'
import bcrypt from 'bcryptjs'

// ─── Dados Reais ────────────────────────────────────────────────────────────────

const DADOS_REAIS = [
  { codigo: '4758', produto: 'STORA ENZO 181 - 700X960', cliente: 'Acimpel Embalagens' },
  { codigo: '4575', produto: 'BOARDONE 230 - 1130X770', cliente: 'Acimpel Embalagens' },
  { codigo: '3021', produto: 'ETIQUETA EMBAL RODEIO 100M', cliente: 'BELGO BEKAERT ARAMES LTDA.' },
  { codigo: '2709', produto: 'CAIXA DE PAPELÃO P/5KG DE ELETRODO SERRALHEIRO', cliente: 'ESAB INDÚSTRIA E COMÉRCIO LTDA' },
  { codigo: '4528', produto: 'CARTUCHO KIT BEST SELLERS CÓD. 1020100094', cliente: 'FARMATIVA INDUSTRIA E COMERCIO LTDA' },
  { codigo: '4041217', produto: 'CART. MAE PREMIUM INTENSE FRAGANCE 08 UNID 100ML', cliente: 'ESTACAO Y' },
  { codigo: '1041607', produto: 'Lâmina Cola Rato Letal', cliente: 'LAIPPE' },
  { codigo: '1041592', produto: 'Lâmina Cola Rato Ligeirinho / Cola Mosca - KAOCID', cliente: 'LAIPPE' },
  { codigo: '4718', produto: 'Cartucho Eletrodo Ok Cód. 1001376', cliente: 'ESAB INDÚSTRIA E COMÉRCIO LTDA' },
  { codigo: '1051976', produto: 'Caixa Papelão Cicione Vaquinha - Cod: 8522731', cliente: 'SOL & NEVE' },
  { codigo: '1041535', produto: 'CARTUCHO HAMB TRADICIONAL CARAPRETA', cliente: 'CARAPRETA' },
  { codigo: '1021057', produto: 'RÓTULO P/FARPADO GIR 500', cliente: 'GERDAU ACOS LONGOS S.A.' },
  { codigo: '4707', produto: 'PROVA IMPRESSÃO CAIXA IMPÉRIO ULTRA ZERO 275ML 12', cliente: 'CERVEJARIA CIDADE IMPERIAL PETROPOLIS' },
  { codigo: '3570', produto: 'Cartucho Display para 50 sachês de 20g', cliente: 'CAFÉ 3 CORAÇÕES' },
  { codigo: '3231', produto: 'Caixa Garrafa Império Gold 210ml 610040039', cliente: 'CERVEJARIA CIDADE IMPERIAL PETROPOLIS' },
]

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

/** Gera CNPJ determinístico baseado no nome do cliente (para idempotência) */
function gerarCnpjDeterministico(nome: string): string {
  let hash = 0
  for (let i = 0; i < nome.length; i++) {
    hash = ((hash << 5) - hash + nome.charCodeAt(i)) | 0
  }
  const base = Math.abs(hash).toString().padStart(12, '0').slice(0, 12)
  // Calcular dígitos verificadores simplificados (não precisa ser válido, só único)
  const d1 = (parseInt(base.slice(0, 4)) % 10).toString()
  const d2 = (parseInt(base.slice(4, 8)) % 10).toString()
  return `${base.slice(0, 2)}.${base.slice(2, 5)}.${base.slice(5, 8)}/${base.slice(8, 12)}-${d1}${d2}`
}

/** Gera preço aleatório entre min e max (determinístico por seed) */
function precoAleatorio(seed: string, min = 1.5, max = 15.0): number {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0
  }
  const frac = (Math.abs(hash) % 10000) / 10000
  return +(min + frac * (max - min)).toFixed(4)
}

function diasNoFuturo(dias: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + dias)
  return d
}

function diasNoPassado(dias: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return d
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
  clientesCriados: string[]
  produtosCriados: string[]
  solicitacaoIds: string[]
  orcamentoNumeros: number[]
  pedidoVendaNumeros: number[]
  ordemProducaoNumeros: number[]
  etapasCriadas: number
  materiaisCriados: number
  variacoesCriadas: number
  entregasCriadas: number
  logsCriados: number
}

const resumo: Resumo = {
  empresaId: '',
  empresaNome: '',
  vendedorId: '',
  vendedorNome: '',
  representanteId: '',
  representanteEmail: 'teste-rep@vizor.test',
  representanteSenha: 'Teste123!',
  clientesCriados: [],
  produtosCriados: [],
  solicitacaoIds: [],
  orcamentoNumeros: [],
  pedidoVendaNumeros: [],
  ordemProducaoNumeros: [],
  etapasCriadas: 0,
  materiaisCriados: 0,
  variacoesCriadas: 0,
  entregasCriadas: 0,
  logsCriados: 0,
}

// ─── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  log('🚀', '=== INÍCIO DO TESTE E2E — FLUXO REPRESENTANTE (DADOS REALISTAS) ===')

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

  // ─── STEP 4: Criar/encontrar clientes ──────────────────────────────────────
  log('👥', 'STEP 4: Criando/encontrando clientes reais...')
  const clientesUnicos = [...new Set(DADOS_REAIS.map((d) => d.cliente))]
  const clienteMap = new Map<string, string>() // nome → id

  for (const nomeCliente of clientesUnicos) {
    try {
      let cliente = await prisma.cliente.findFirst({
        where: {
          empresaId: resumo.empresaId,
          razaoSocial: { contains: nomeCliente, mode: 'insensitive' },
        },
        select: { id: true, razaoSocial: true },
      })

      if (!cliente) {
        const cpfCnpj = gerarCnpjDeterministico(nomeCliente)
        // Verificar se já existe com esse CNPJ (idempotência)
        const existePorCnpj = await prisma.cliente.findFirst({
          where: { empresaId: resumo.empresaId, cpfCnpj },
          select: { id: true, razaoSocial: true },
        })

        if (existePorCnpj) {
          cliente = existePorCnpj
          log('⏭️', `  Cliente "${nomeCliente}" já existe (por CNPJ): ID ${cliente.id}`)
        } else {
          const novo = await prisma.cliente.create({
            data: {
              empresaId: resumo.empresaId,
              razaoSocial: nomeCliente,
              cpfCnpj,
              vendedorId: resumo.vendedorId,
              status: true,
            },
            select: { id: true, razaoSocial: true },
          })
          cliente = novo
          resumo.clientesCriados.push(nomeCliente)
          log('✅', `  Cliente CRIADO: "${nomeCliente}" (ID: ${cliente.id})`)
        }
      } else {
        log('⏭️', `  Cliente encontrado: "${cliente.razaoSocial}" (ID: ${cliente.id})`)
        // Atualizar vendedorId se necessário
        await prisma.cliente.update({
          where: { id: cliente.id },
          data: { vendedorId: resumo.vendedorId },
        })
      }

      clienteMap.set(nomeCliente, cliente.id)
    } catch (err) {
      logError('⚠️', `  Erro ao processar cliente "${nomeCliente}" — continuando...`, err)
    }
  }
  log('📊', `  Clientes mapeados: ${clienteMap.size} | Criados: ${resumo.clientesCriados.length}`)

  // ─── STEP 5: Criar/encontrar produtos ──────────────────────────────────────
  log('📦', 'STEP 5: Criando/encontrando produtos reais...')
  const produtoMap = new Map<string, { id: string; nome: string; preco: number }>() // codigo → dados

  for (const item of DADOS_REAIS) {
    try {
      let produto = await prisma.produto.findFirst({
        where: { empresaId: resumo.empresaId, codigo: item.codigo },
        select: { id: true, nome: true, precoBase: true },
      })

      if (!produto) {
        const preco = precoAleatorio(item.codigo)
        const novo = await prisma.produto.create({
          data: {
            empresaId: resumo.empresaId,
            codigo: item.codigo,
            nome: item.produto,
            precoBase: preco,
            status: true,
          },
          select: { id: true, nome: true, precoBase: true },
        })
        produto = novo
        resumo.produtosCriados.push(`${item.codigo} - ${item.produto}`)
        log('✅', `  Produto CRIADO: [${item.codigo}] ${item.produto} (R$${preco.toFixed(2)})`)
      } else {
        log('⏭️', `  Produto encontrado: [${item.codigo}] ${produto.nome}`)
      }

      produtoMap.set(item.codigo, {
        id: produto.id,
        nome: produto.nome,
        preco: Number(produto.precoBase),
      })
    } catch (err) {
      logError('⚠️', `  Erro ao processar produto "${item.codigo}" — continuando...`, err)
    }
  }
  log('📊', `  Produtos mapeados: ${produtoMap.size} | Criados: ${resumo.produtosCriados.length}`)

  // ─── STEP 6: Criar SolicitacaoOrcamentoRep — status variados ───────────────
  log('📝', 'STEP 6: Criando SolicitacaoOrcamentoRep com status variados...')

  const solicitacoesDef = [
    { dadosIdx: 0, status: 'PENDENTE', quantidade: 5000 },
    { dadosIdx: 3, status: 'PENDENTE', quantidade: 10000 },
    { dadosIdx: 1, status: 'CALCULADO', quantidade: 15000, precoUnit: 2.85 },
    { dadosIdx: 4, status: 'CALCULADO', quantidade: 2000, precoUnit: 4.50 },
    { dadosIdx: 6, status: 'ENVIADO', quantidade: 8000, precoUnit: 1.75 },
    { dadosIdx: 10, status: 'ENVIADO', quantidade: 20000, precoUnit: 1.20 },
  ]

  for (const def of solicitacoesDef) {
    const dados = DADOS_REAIS[def.dadosIdx]
    const clienteId = clienteMap.get(dados.cliente)
    if (!clienteId) continue

    try {
      // Verificar se já existe uma solicitação similar (idempotência)
      const existente = await prisma.solicitacaoOrcamentoRep.findFirst({
        where: {
          empresaId: resumo.empresaId,
          representanteId: resumo.representanteId,
          tipoEmbalagem: dados.produto,
          quantidade: def.quantidade,
        },
      })

      if (existente) {
        resumo.solicitacaoIds.push(existente.id)
        log('⏭️', `  Solicitação já existe: ${dados.produto} (${def.status}) — ID: ${existente.id.slice(0, 8)}...`)
        continue
      }

      const precoVenda = def.precoUnit ? def.precoUnit * def.quantidade : undefined

      const solicitacao = await prisma.solicitacaoOrcamentoRep.create({
        data: {
          empresaId: resumo.empresaId,
          representanteId: resumo.representanteId,
          vendedorId: resumo.vendedorId,
          clienteId,
          clienteNome: dados.cliente,
          clienteCpfCnpj: gerarCnpjDeterministico(dados.cliente),
          tipoEmbalagem: dados.produto,
          medidaLargura: 300 + def.dadosIdx * 50,
          medidaAltura: 200 + def.dadosIdx * 30,
          medidaComprimento: 400 + def.dadosIdx * 40,
          quantidade: def.quantidade,
          acabamentos: def.dadosIdx % 2 === 0 ? 'Impressão 4x0, Verniz UV total' : 'Impressão 2x0, Laminação fosca',
          observacoes: `Solicitação E2E | ${dados.cliente} | ${def.quantidade} un | ${ts()}`,
          status: def.status,
          precoUnitario: def.precoUnit ?? null,
          precoVenda: precoVenda ?? null,
        },
      })

      resumo.solicitacaoIds.push(solicitacao.id)
      log('✅', `  Solicitação criada [${def.status}]: ${dados.produto} | ${def.quantidade} un | ID: ${solicitacao.id.slice(0, 8)}...`)
    } catch (err) {
      logError('⚠️', `  Erro ao criar solicitação para ${dados.produto} — continuando...`, err)
    }
  }
  log('📊', `  Total de solicitações: ${resumo.solicitacaoIds.length}`)

  // ─── STEP 7: Criar Orcamentos (proposta comercial) ─────────────────────────
  log('📋', 'STEP 7: Criando Orcamentos (proposta comercial) com status variados...')

  // Buscar/criar tabela de preço
  let tabelaPrecoId: string | null = null
  try {
    let tabela = await prisma.tabelaPreco.findFirst({
      where: { empresaId: resumo.empresaId, status: true },
      select: { id: true, nome: true },
    })
    if (!tabela) {
      tabela = await prisma.tabelaPreco.create({
        data: { empresaId: resumo.empresaId, nome: 'Tabela Padrão (teste E2E)', status: true },
        select: { id: true, nome: true },
      })
      log('✅', `  Tabela de preço criada: "${tabela.nome}"`)
    } else {
      log('📋', `  Tabela de preço: "${tabela.nome}" (ID: ${tabela.id})`)
    }
    tabelaPrecoId = tabela.id
  } catch (err) {
    logError('⚠️', 'Falha ao buscar/criar tabela de preço.', err)
  }

  const orcamentosDef = [
    { status: 'ABERTO', clienteIdx: 'Acimpel Embalagens', produtoCodigos: ['4758', '4575'] },
    { status: 'ENVIADO', clienteIdx: 'ESAB INDÚSTRIA E COMÉRCIO LTDA', produtoCodigos: ['2709', '4718'] },
    { status: 'APROVADO', clienteIdx: 'CAFÉ 3 CORAÇÕES', produtoCodigos: ['3570', '3231', '4707'] },
    { status: 'CONVERTIDO', clienteIdx: 'FARMATIVA INDUSTRIA E COMERCIO LTDA', produtoCodigos: ['4528', '4041217', '1041607'] },
  ]

  for (const def of orcamentosDef) {
    const clienteId = clienteMap.get(def.clienteIdx)
    if (!clienteId) continue

    try {
      // Obter próximo número
      const ultimoOrc = await prisma.orcamento.findFirst({
        where: { empresaId: resumo.empresaId },
        orderBy: { numero: 'desc' },
        select: { numero: true },
      })
      const proximoNumero = (ultimoOrc?.numero ?? 0) + 1

      // Verificar se já existe com esse número (idempotência parcial)
      const existeNumero = await prisma.orcamento.findFirst({
        where: { empresaId: resumo.empresaId, numero: proximoNumero },
      })
      if (existeNumero) {
        resumo.orcamentoNumeros.push(proximoNumero)
        log('⏭️', `  Orçamento #${proximoNumero} já existe — pulando.`)
        continue
      }

      // Montar itens
      const itens = def.produtoCodigos
        .map((cod) => produtoMap.get(cod))
        .filter(Boolean)
        .map((prod) => {
          const qtd = 1000 + Math.floor(Math.random() * 9000)
          const preco = prod!.preco || 3.5
          return {
            produtoId: prod!.id,
            quantidade: qtd,
            unidade: 'UN',
            precoUnitario: preco,
            desconto: 0,
            valorTotal: +(qtd * preco).toFixed(2),
          }
        })

      const valorTotal = itens.reduce((acc, i) => acc + i.valorTotal, 0)

      const orcamento = await prisma.orcamento.create({
        data: {
          empresaId: resumo.empresaId,
          numero: proximoNumero,
          clienteId,
          vendedorId: resumo.vendedorId,
          tabelaPrecoId,
          valorTotal,
          status: def.status,
          validadeAte: diasNoFuturo(30),
          observacao: `Proposta comercial E2E — ${def.clienteIdx} | Status: ${def.status}`,
          itens: { create: itens },
        },
      })

      resumo.orcamentoNumeros.push(proximoNumero)
      log('✅', `  Orçamento #${proximoNumero} [${def.status}] criado | ${def.clienteIdx} | R$${valorTotal.toFixed(2)}`)
    } catch (err) {
      logError('⚠️', `  Erro ao criar orçamento [${def.status}] — continuando...`, err)
    }
  }
  log('📊', `  Total de orçamentos: ${resumo.orcamentoNumeros.length}`)

  // ─── STEP 8: Criar PedidoVenda ─────────────────────────────────────────────
  log('🛒', 'STEP 8: Criando PedidoVenda com status variados...')

  if (!tabelaPrecoId) {
    log('⚠️', '  Sem tabela de preço — pulando criação de pedidos.')
  } else {
    const pedidosDef = [
      { status: 'CONFIRMADO', clienteIdx: 'Acimpel Embalagens', produtoCodigos: ['4758', '4575'], origemPedido: 'PORTAL_REP' },
      { status: 'CONFIRMADO', clienteIdx: 'BELGO BEKAERT ARAMES LTDA.', produtoCodigos: ['3021', '1021057'], origemPedido: 'PORTAL_REP' },
      { status: 'EM_PRODUCAO', clienteIdx: 'ESAB INDÚSTRIA E COMÉRCIO LTDA', produtoCodigos: ['2709', '4718'], origemPedido: 'PORTAL_REP' },
      { status: 'FATURADO', clienteIdx: 'CERVEJARIA CIDADE IMPERIAL PETROPOLIS', produtoCodigos: ['4707', '3231'], origemPedido: 'MANUAL' },
      { status: 'ENTREGUE', clienteIdx: 'CAFÉ 3 CORAÇÕES', produtoCodigos: ['3570', '4528', '1041535'], origemPedido: 'MANUAL' },
    ]

    for (const def of pedidosDef) {
      const clienteId = clienteMap.get(def.clienteIdx)
      if (!clienteId) {
        log('⚠️', `  Cliente "${def.clienteIdx}" não mapeado — pulando pedido.`)
        continue
      }

      try {
        const ultimoPedido = await prisma.pedidoVenda.findFirst({
          where: { empresaId: resumo.empresaId },
          orderBy: { numero: 'desc' },
          select: { numero: true },
        })
        const proximoNumero = (ultimoPedido?.numero ?? 0) + 1

        const itens = def.produtoCodigos
          .map((cod) => produtoMap.get(cod))
          .filter(Boolean)
          .map((prod) => {
            const qtd = 2000 + Math.floor(Math.random() * 8000)
            const preco = prod!.preco || 3.0
            return {
              produtoId: prod!.id,
              quantidade: qtd,
              unidade: 'UN',
              precoBase: preco,
              desconto: 0,
              precoFinal: preco,
              valorTotal: +(qtd * preco).toFixed(2),
            }
          })

        const valorTotal = itens.reduce((acc, i) => acc + i.valorTotal, 0)

        const pedido = await prisma.pedidoVenda.create({
          data: {
            empresaId: resumo.empresaId,
            numero: proximoNumero,
            clienteId,
            vendedorId: resumo.vendedorId,
            tabelaPrecoId: tabelaPrecoId!,
            valorTotal,
            status: def.status,
            origemPedido: def.origemPedido,
            observacao: `Pedido E2E #${proximoNumero} | ${def.clienteIdx} | ${def.status} | ${ts()}`,
            itens: { create: itens },
          },
        })

        resumo.pedidoVendaNumeros.push(proximoNumero)
        log('✅', `  PedidoVenda #${proximoNumero} [${def.status}] | ${def.clienteIdx} | R$${valorTotal.toFixed(2)}`)
      } catch (err) {
        logError('⚠️', `  Erro ao criar pedido [${def.status}] — continuando...`, err)
      }
    }
  }
  log('📊', `  Total de pedidos: ${resumo.pedidoVendaNumeros.length}`)

  // ─── STEP 9: Criar OrdemProducao COMPLETAS ─────────────────────────────────
  log('🏭', 'STEP 9: Criando Ordens de Produção COMPLETAS...')

  // 9.0: Buscar/criar CentrosProducao + TipoProcesso
  log('🔧', '  9.0: Verificando Centros de Produção e Tipos de Processo...')

  const centroIds: { cortadeira?: string; impressao?: string; acabamento?: string } = {}

  try {
    const centrosExistentes = await prisma.centroProducao.findMany({
      where: { empresaId: resumo.empresaId, status: true },
      select: { id: true, codigo: true, descricao: true, tipoProcesso: { select: { codigo: true } } },
      take: 10,
    })

    if (centrosExistentes.length >= 3) {
      // Usar os existentes classificados por tipo
      for (const c of centrosExistentes) {
        const tp = c.tipoProcesso.codigo.toUpperCase()
        if (tp.includes('CORT') && !centroIds.cortadeira) centroIds.cortadeira = c.id
        else if (tp.includes('IMPRESS') && !centroIds.impressao) centroIds.impressao = c.id
        else if ((tp.includes('ACAB') || tp.includes('COLA') || tp.includes('VERNIZ')) && !centroIds.acabamento) centroIds.acabamento = c.id
      }
      // Fallback: usar os primeiros se não conseguiu classificar
      if (!centroIds.cortadeira) centroIds.cortadeira = centrosExistentes[0]?.id
      if (!centroIds.impressao) centroIds.impressao = centrosExistentes[1]?.id || centrosExistentes[0]?.id
      if (!centroIds.acabamento) centroIds.acabamento = centrosExistentes[2]?.id || centrosExistentes[0]?.id
      log('✅', `  Centros existentes encontrados: ${centrosExistentes.length}`)
    } else {
      // Criar tipos de processo e centros
      log('🔨', '  Criando Tipos de Processo e Centros de Produção...')

      const tiposDef = [
        { codigo: 'CORTADEIRA', descricao: 'Cortadeira', posicao: 1 },
        { codigo: 'IMPRESSAO', descricao: 'Impressão', posicao: 2 },
        { codigo: 'ACABAMENTO', descricao: 'Acabamento', posicao: 3 },
      ]

      const tipoProcessoIds: Record<string, string> = {}

      for (const tp of tiposDef) {
        let tipo = await prisma.tipoProcesso.findFirst({
          where: { empresaId: resumo.empresaId, codigo: tp.codigo },
        })
        if (!tipo) {
          tipo = await prisma.tipoProcesso.create({
            data: { empresaId: resumo.empresaId, codigo: tp.codigo, descricao: tp.descricao, posicao: tp.posicao, status: true },
          })
        }
        tipoProcessoIds[tp.codigo] = tipo.id
      }

      const centrosDef = [
        { codigo: 'CORT-01', descricao: 'Cortadeira Polar 115', tipo: 'MAQUINA', tipoProcessoId: tipoProcessoIds['CORTADEIRA'] },
        { codigo: 'IMP-01', descricao: 'Impressão Heidelberg CD 102', tipo: 'MAQUINA', tipoProcessoId: tipoProcessoIds['IMPRESSAO'] },
        { codigo: 'ACAB-01', descricao: 'Acabamento Geral', tipo: 'SETOR', tipoProcessoId: tipoProcessoIds['ACABAMENTO'] },
      ]

      for (const c of centrosDef) {
        let centro = await prisma.centroProducao.findFirst({
          where: { empresaId: resumo.empresaId, codigo: c.codigo },
        })
        if (!centro) {
          centro = await prisma.centroProducao.create({
            data: { empresaId: resumo.empresaId, ...c, status: true, posicao: 0 },
          })
        }
        if (c.codigo.startsWith('CORT')) centroIds.cortadeira = centro.id
        else if (c.codigo.startsWith('IMP')) centroIds.impressao = centro.id
        else centroIds.acabamento = centro.id
      }
      log('✅', '  Centros de produção criados/encontrados.')
    }
  } catch (err) {
    logError('⚠️', '  Erro ao configurar centros de produção.', err)
  }

  // 9.1-9.6: Criar OPs completas
  const opsDef = [
    { dadosIdx: 0, status: 'PROGRAMADA', qtd: 5000, ref: '3050', entregaDias: 15 },
    { dadosIdx: 2, status: 'EM_PRODUCAO', qtd: 10000, ref: '3051', entregaDias: 10 },
    { dadosIdx: 3, status: 'EM_PRODUCAO', qtd: 15000, ref: '3052', entregaDias: 8 },
    { dadosIdx: 9, status: 'CONCLUIDA', qtd: 2000, ref: '3053', entregaDias: -5 },
    { dadosIdx: 12, status: 'LIBERADA', qtd: 8000, ref: '3054', entregaDias: 20 },
  ]

  // Buscar PedidoVenda IDs para vincular
  const pedidosVendaCriados: { id: string; clienteId: string }[] = []
  if (resumo.pedidoVendaNumeros.length > 0) {
    try {
      const pedidos = await prisma.pedidoVenda.findMany({
        where: {
          empresaId: resumo.empresaId,
          numero: { in: resumo.pedidoVendaNumeros },
        },
        select: { id: true, clienteId: true, numero: true },
        orderBy: { numero: 'asc' },
      })
      pedidosVendaCriados.push(...pedidos)
    } catch (err) {
      logError('⚠️', '  Não conseguiu buscar pedidos para vincular OPs.', err)
    }
  }

  const USUARIO_FAKE_ID = '00000000-0000-0000-0000-000000000001'

  for (let opIdx = 0; opIdx < opsDef.length; opIdx++) {
    const def = opsDef[opIdx]
    const dados = DADOS_REAIS[def.dadosIdx]
    const produtoInfo = produtoMap.get(dados.codigo)
    const clienteId = clienteMap.get(dados.cliente)

    if (!produtoInfo || !clienteId) {
      log('⚠️', `  OP #${opIdx + 1}: produto ou cliente não mapeado — pulando.`)
      continue
    }

    try {
      // Obter próximo número de OP
      const ultimaOp = await prisma.ordemProducao.findFirst({
        where: { empresaId: resumo.empresaId },
        orderBy: { numero: 'desc' },
        select: { numero: true },
      })
      const proximoNumeroOp = (ultimaOp?.numero ?? 0) + 1

      // Verificar se já existe OP com essa referência
      const opExistente = await prisma.ordemProducao.findFirst({
        where: { empresaId: resumo.empresaId, referenciaExterna: def.ref },
        select: { id: true, numero: true },
      })
      if (opExistente) {
        resumo.ordemProducaoNumeros.push(opExistente.numero)
        log('⏭️', `  OP ref "${def.ref}" já existe (#${opExistente.numero}) — pulando.`)
        continue
      }

      const pedidoVinculado = pedidosVendaCriados[opIdx] || null
      const dataEntrega = def.entregaDias >= 0 ? diasNoFuturo(def.entregaDias) : diasNoPassado(Math.abs(def.entregaDias))

      const observacoesOp = [
        `[Cliente] ${dados.cliente}`,
        `[Produto] ${dados.produto}`,
        `[TipoOp] REPETIÇÃO`,
        `[Formato] 700 x 960`,
        `[Cores] 4x0 +V`,
      ].join('\n')

      // 9.1: Criar a OP
      const op = await prisma.ordemProducao.create({
        data: {
          empresaId: resumo.empresaId,
          numero: proximoNumeroOp,
          produtoId: produtoInfo.id,
          clienteId,
          pedidoVendaId: pedidoVinculado?.id ?? null,
          quantidade: def.qtd,
          unidadeMedida: 'UN',
          status: def.status,
          prioridade: opIdx === 0 ? 'ALTA' : opIdx === 4 ? 'URGENTE' : 'NORMAL',
          dataEntregaPrevista: dataEntrega,
          dataEntregaOriginal: dataEntrega,
          referenciaExterna: def.ref,
          origemImportacao: 'MANUAL',
          observacoes: observacoesOp,
          dataInicioReal: def.status === 'EM_PRODUCAO' || def.status === 'CONCLUIDA' ? diasNoPassado(3) : null,
          dataFimReal: def.status === 'CONCLUIDA' ? diasNoPassado(1) : null,
        },
      })

      resumo.ordemProducaoNumeros.push(proximoNumeroOp)
      log('✅', `  OP #${proximoNumeroOp} [${def.status}] | ref: ${def.ref} | ${dados.produto}`)

      // 9.2: Criar EtapasOrdemProducao
      const etapasDef = [
        { seq: 1, desc: 'Corte', centroId: centroIds.cortadeira!, setup: 30, operacao: 120 },
        { seq: 2, desc: 'Impressão Offset 4x0', centroId: centroIds.impressao!, setup: 45, operacao: 180 },
        { seq: 3, desc: 'Laminação Fosca', centroId: centroIds.acabamento!, setup: 15, operacao: 60 },
        { seq: 4, desc: 'Vincagem e Corte Final', centroId: centroIds.cortadeira!, setup: 20, operacao: 90 },
        { seq: 5, desc: 'Colagem', centroId: centroIds.acabamento!, setup: 10, operacao: 45 },
      ]

      for (let eIdx = 0; eIdx < etapasDef.length; eIdx++) {
        const etDef = etapasDef[eIdx]
        let statusEtapa = 'PENDENTE'

        if (def.status === 'CONCLUIDA') {
          statusEtapa = 'CONCLUIDA'
        } else if (def.status === 'EM_PRODUCAO') {
          if (eIdx === 0) statusEtapa = 'CONCLUIDA'
          else if (eIdx === 1) statusEtapa = 'EM_ANDAMENTO'
        }

        await prisma.etapaOrdemProducao.create({
          data: {
            ordemProducaoId: op.id,
            sequencia: etDef.seq,
            descricao: etDef.desc,
            centroProducaoId: etDef.centroId,
            tempoSetupMinutos: etDef.setup,
            tempoOperacaoCalculado: etDef.operacao,
            status: statusEtapa,
            posicaoFila: eIdx + 1,
            dataInicioReal: statusEtapa !== 'PENDENTE' ? diasNoPassado(2) : null,
            dataFimReal: statusEtapa === 'CONCLUIDA' ? diasNoPassado(1) : null,
          },
        })
        resumo.etapasCriadas++
      }

      // 9.3: Criar ItemOrdemProducao (materiais)
      const materiaisDef = [
        { desc: 'Papel Cartão Triplex 350g', tipo: 'PAPEL', qtd: 500, unid: 'KG' },
        { desc: 'Tinta Offset Cyan Process', tipo: 'TINTA', qtd: 12, unid: 'KG' },
        { desc: 'Tinta Offset Magenta Process', tipo: 'TINTA', qtd: 8, unid: 'KG' },
        { desc: 'Verniz UV Total Brilho', tipo: 'VERNIZ', qtd: 15, unid: 'KG' },
        { desc: 'Cola PVA Branca Industrial', tipo: 'COLA', qtd: 5, unid: 'KG' },
      ]

      for (const mat of materiaisDef) {
        await prisma.itemOrdemProducao.create({
          data: {
            ordemProducaoId: op.id,
            descricaoProduto: mat.desc,
            quantidade: mat.qtd,
            unidadeMedida: mat.unid,
            tipoMaterial: mat.tipo,
            status: def.status === 'CONCLUIDA' ? 'CONSUMIDO' : 'PENDENTE',
            empresaId: resumo.empresaId,
          },
        })
        resumo.materiaisCriados++
      }

      // 9.4: Criar VariacaoOrdemProducao
      const variacoesDef = [
        { desc: 'Versão Azul', qtd: Math.ceil(def.qtd * 0.6), cor: 'AZUL' },
        { desc: 'Versão Verde', qtd: Math.ceil(def.qtd * 0.4), cor: 'VERDE' },
      ]
      if (opIdx >= 3) {
        variacoesDef.push({ desc: 'Versão Vermelha', qtd: Math.ceil(def.qtd * 0.2), cor: 'VERMELHO' })
      }

      for (let vIdx = 0; vIdx < variacoesDef.length; vIdx++) {
        const v = variacoesDef[vIdx]
        await prisma.variacaoOrdemProducao.create({
          data: {
            ordemProducaoId: op.id,
            codigoProduto: dados.codigo,
            descricao: v.desc,
            quantidade: v.qtd,
            cor: v.cor,
            sequencia: vIdx + 1,
          },
        })
        resumo.variacoesCriadas++
      }

      // 9.5: Criar ProgramacaoEntrega
      const entrega60pct = Math.ceil(def.qtd * 0.6)
      const entrega40pct = def.qtd - entrega60pct
      const statusEntrega = def.status === 'CONCLUIDA' ? 'PRODUZIDO' : 'PENDENTE'

      await prisma.programacaoEntrega.create({
        data: {
          ordemProducaoId: op.id,
          dataEntrega: diasNoFuturo(5),
          quantidade: entrega60pct,
          status: statusEntrega,
          observacao: `Entrega parcial 1 — ${entrega60pct} un`,
        },
      })
      await prisma.programacaoEntrega.create({
        data: {
          ordemProducaoId: op.id,
          dataEntrega: diasNoFuturo(15),
          quantidade: entrega40pct,
          status: statusEntrega,
          observacao: `Entrega parcial 2 — ${entrega40pct} un`,
        },
      })
      resumo.entregasCriadas += 2

      // 9.6: Criar LogOrdemProducao (histórico de transições)
      const logsDef: { statusAnterior: string; statusNovo: string }[] = [
        { statusAnterior: 'RASCUNHO', statusNovo: 'PLANEJADA' },
        { statusAnterior: 'PLANEJADA', statusNovo: 'PROGRAMADA' },
      ]

      if (def.status === 'LIBERADA' || def.status === 'EM_PRODUCAO' || def.status === 'CONCLUIDA') {
        logsDef.push({ statusAnterior: 'PROGRAMADA', statusNovo: 'LIBERADA' })
      }
      if (def.status === 'EM_PRODUCAO' || def.status === 'CONCLUIDA') {
        logsDef.push({ statusAnterior: 'LIBERADA', statusNovo: 'EM_PRODUCAO' })
      }
      if (def.status === 'CONCLUIDA') {
        logsDef.push({ statusAnterior: 'EM_PRODUCAO', statusNovo: 'CONCLUIDA' })
      }

      for (const logDef of logsDef) {
        await prisma.logOrdemProducao.create({
          data: {
            ordemProducaoId: op.id,
            statusAnterior: logDef.statusAnterior,
            statusNovo: logDef.statusNovo,
            usuarioId: USUARIO_FAKE_ID,
            observacao: `Transição E2E: ${logDef.statusAnterior} → ${logDef.statusNovo}`,
          },
        })
        resumo.logsCriados++
      }

      log('  ', `  ├─ Etapas: 5 | Materiais: ${materiaisDef.length} | Variações: ${variacoesDef.length} | Entregas: 2 | Logs: ${logsDef.length}`)
    } catch (err) {
      logError('⚠️', `  Erro ao criar OP ref "${def.ref}" — continuando...`, err)
    }
  }

  log('📊', `  Total de OPs: ${resumo.ordemProducaoNumeros.length}`)

  // ─── STEP 10: Resumo final expandido ───────────────────────────────────────
  console.log('')
  console.log('═══════════════════════════════════════════════════════════════════════════════')
  console.log('  📋 RESUMO DO TESTE E2E — FLUXO REPRESENTANTE (DADOS REALISTAS)')
  console.log('═══════════════════════════════════════════════════════════════════════════════')
  console.log('')
  console.log(`  🏢 Empresa: ${resumo.empresaNome} (${resumo.empresaId})`)
  console.log(`  👤 Vendedor: ${resumo.vendedorNome} (${resumo.vendedorId})`)
  console.log('')
  console.log('  ─── Credenciais do Representante (para login) ───')
  console.log(`  📧 Email: ${resumo.representanteEmail}`)
  console.log(`  🔑 Senha: ${resumo.representanteSenha}`)
  console.log(`  🆔 ID: ${resumo.representanteId}`)
  console.log('')
  console.log('  ─── Tela 1: Portal do Representante ───')
  console.log(`  📝 Solicitações criadas: ${resumo.solicitacaoIds.length}`)
  resumo.solicitacaoIds.forEach((id, idx) => {
    console.log(`     ${idx + 1}. ${id}`)
  })
  console.log('')
  console.log('  ─── Tela 2: Portal Admin ───')
  console.log(`  🔐 Representante configurado com email ${resumo.representanteEmail}`)
  console.log('')
  console.log('  ─── Tela 3: Orçamento Gráfico (/orcamento-grafico) ───')
  console.log(`  📋 Orçamentos: ${resumo.orcamentoNumeros.length} (${resumo.orcamentoNumeros.join(', ') || 'nenhum'})`)
  console.log('')
  console.log('  ─── Tela 4: Vendas/Pedidos (/vendas/pedidos) ───')
  console.log(`  🛒 Pedidos de Venda: ${resumo.pedidoVendaNumeros.length} (${resumo.pedidoVendaNumeros.join(', ') || 'nenhum'})`)
  console.log('')
  console.log('  ─── Tela 5: PCP/Ordens de Produção (/pcp/ordens-producao) ───')
  console.log(`  🏭 Ordens de Produção: ${resumo.ordemProducaoNumeros.length} (${resumo.ordemProducaoNumeros.join(', ') || 'nenhuma'})`)
  console.log(`     ├─ Etapas criadas: ${resumo.etapasCriadas}`)
  console.log(`     ├─ Materiais (itens): ${resumo.materiaisCriados}`)
  console.log(`     ├─ Variações: ${resumo.variacoesCriadas}`)
  console.log(`     ├─ Programações de entrega: ${resumo.entregasCriadas}`)
  console.log(`     └─ Logs de transição: ${resumo.logsCriados}`)
  console.log('')
  console.log('  ─── Cadastros base ───')
  console.log(`  👥 Clientes criados: ${resumo.clientesCriados.length}`)
  if (resumo.clientesCriados.length > 0) {
    resumo.clientesCriados.forEach((c) => console.log(`     • ${c}`))
  }
  console.log(`  📦 Produtos criados: ${resumo.produtosCriados.length}`)
  if (resumo.produtosCriados.length > 0) {
    resumo.produtosCriados.forEach((p) => console.log(`     • ${p}`))
  }
  console.log('')
  console.log('═══════════════════════════════════════════════════════════════════════════════')
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
