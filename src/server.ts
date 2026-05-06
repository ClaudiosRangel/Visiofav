import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { authRoutes } from './modules/auth/auth.routes'
import { usuarioRoutes } from './modules/usuario/usuario.routes'
import { centroDistRoutes } from './modules/centro-distribuicao/centro-dist.routes'
import { depositoRoutes } from './modules/deposito/deposito.routes'
import { zonaRoutes } from './modules/zona/zona.routes'
import { estruturaRoutes } from './modules/estrutura/estrutura.routes'
import { formaArmazenagemRoutes } from './modules/forma-armazenagem/forma-armazenagem.routes'
import { ambienteArmazenagemRoutes } from './modules/ambiente-armazenagem/ambiente-armazenagem.routes'
import { classificacaoProdutoRoutes } from './modules/classificacao-produto/classificacao-produto.routes'
import { produtoRoutes } from './modules/produto/produto.routes'
import { skuRoutes } from './modules/sku/sku.routes'
import { funcaoRoutes } from './modules/funcao/funcao.routes'
import { funcionarioRoutes } from './modules/funcionario/funcionario.routes'
import { equipamentoRoutes } from './modules/equipamento/equipamento.routes'
import { docaRoutes } from './modules/doca/doca.routes'
import { enderecoRoutes } from './modules/endereco/endereco.routes'
import { tipoCarroceriaRoutes } from './modules/tipo-carroceria/tipo-carroceria.routes'
import { tipoCargaRoutes } from './modules/tipo-carga/tipo-carga.routes'
import { veiculoRoutes } from './modules/veiculo/veiculo.routes'
import { parametroRoutes } from './modules/parametro/parametro.routes'
import { fornecedorRoutes } from './modules/fornecedor/fornecedor.routes'
import { transportadoraRoutes } from './modules/transportadora/transportadora.routes'
import { clienteRoutes } from './modules/cliente/cliente.routes'
import { notaEntradaRoutes } from './modules/nota-entrada/nota-entrada.routes'
import { importarXmlRoutes } from './modules/nota-entrada/importar-xml.routes'
import { conferenciaRoutes } from './modules/conferencia/conferencia.routes'
import { saldoRoutes } from './modules/saldo/saldo.routes'
import { enderecamentoRoutes } from './modules/enderecamento/enderecamento.routes'
import { ordemServicoRoutes } from './modules/ordem-servico/ordem-servico.routes'
import { empresaSelectorRoutes } from './modules/empresa-selector/empresa-selector.routes'
import { vendedorRoutes } from './modules/vendedor/vendedor.routes'
import { pedidoCompraRoutes } from './modules/pedido-compra/pedido-compra.routes'
import { compraRoutes } from './modules/compra/compra.routes'
import { tabelaPrecoRoutes } from './modules/tabela-preco/tabela-preco.routes'
import { pedidoVendaRoutes } from './modules/pedido-venda/pedido-venda.routes'
import { vendaRoutes } from './modules/venda/venda.routes'
import { contaPagarRoutes } from './modules/conta-pagar/conta-pagar.routes'
import { contaReceberRoutes } from './modules/conta-receber/conta-receber.routes'
import { nfeRoutes } from './modules/nfe/nfe.routes'
import { cteRoutes } from './modules/cte/cte.routes'
import { agendaWmsRoutes } from './modules/agenda-wms/agenda-wms.routes'
import { ondaSeparacaoRoutes } from './modules/onda-separacao/onda-separacao.routes'
import { itemSeparacaoRoutes } from './modules/item-separacao/item-separacao.routes'
import { conferenciaSaidaRoutes } from './modules/conferencia-saida/conferencia-saida.routes'
import { volumeRoutes } from './modules/volume/volume.routes'
import { carregamentoRoutes } from './modules/carregamento/carregamento.routes'
import { posicionamentoRoutes } from './modules/posicionamento/posicionamento.routes'
import { portariaRoutes } from './modules/portaria/portaria.routes'
import { manutencaoEstoqueRoutes } from './modules/manutencao-estoque/manutencao-estoque.routes'
import { conferenciaEntradaRoutes } from './modules/conferencia/conferencia-entrada.routes'
import { enderecamentoWmsRoutes } from './modules/enderecamento/enderecamento-wms.routes'
import { etiquetaRoutes } from './modules/etiqueta/etiqueta.routes'
import { ordemServicoWmsRoutes } from './modules/ordem-servico-wms/ordem-servico-wms.routes'
import { apiKeyRoutes } from './modules/integracao/api-key.routes'
import { integracaoRoutes } from './modules/integracao/integracao.routes'
import { webhookRoutes } from './modules/integracao/webhook.routes'
import { dashboardWmsRoutes } from './modules/dashboard-wms/dashboard-wms.routes'
import { inventarioRoutes } from './modules/inventario/inventario.routes'
import { relatoriosWmsRoutes } from './modules/relatorios-wms/relatorios-wms.routes'
import { auditoriaRoutes } from './modules/auditoria/auditoria.routes'
import { ressuprimentoRoutes } from './modules/ressuprimento/ressuprimento.routes'
import { dadosLogisticosRoutes } from './modules/dados-logisticos/dados-logisticos.routes'
import { websocketRoutes } from './modules/websocket/websocket.routes'
import { fichaOperacionalRoutes } from './modules/ficha-operacional/ficha-operacional.routes'
import { ocrRoutes } from './modules/ocr/ocr.routes'
import { scannerRoutes } from './modules/scanner/scanner.routes'
import { stockViewRoutes } from './modules/estoque/stock-view.routes'

import { registerTenantContext } from './middleware/tenant-context'
import multipart from '@fastify/multipart'

const app = Fastify({ logger: true })

async function bootstrap() {
  await app.register(cors, { origin: true })
  await app.register(jwt, { secret: process.env.JWT_SECRET || 'dev-secret' })
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } })

  registerTenantContext(app)

  // Auth
  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(usuarioRoutes, { prefix: '/api/usuarios' })

  // Seleção de empresa (pré-módulo — sem moduloGuard)
  await app.register(empresaSelectorRoutes, { prefix: '/api/empresas' })

  // Módulo Vendas — Vendedores
  await app.register(vendedorRoutes, { prefix: '/api/vendedores' })

  // Módulo Compras
  await app.register(pedidoCompraRoutes, { prefix: '/api/pedidos-compra' })
  await app.register(compraRoutes, { prefix: '/api/compras' })

  // Módulo Vendas — Tabela de Preço
  await app.register(tabelaPrecoRoutes, { prefix: '/api/tabelas-preco' })
  await app.register(pedidoVendaRoutes, { prefix: '/api/pedidos-venda' })
  await app.register(vendaRoutes, { prefix: '/api/vendas' })

  // Módulo Financeiro
  await app.register(contaPagarRoutes, { prefix: '/api/contas-pagar' })
  await app.register(contaReceberRoutes, { prefix: '/api/contas-receber' })

  // Módulo Fiscal — NF-e
  await app.register(nfeRoutes, { prefix: '/api/nfe' })
  await app.register(cteRoutes, { prefix: '/api/cte' })

  // Integração WMS
  await app.register(dashboardWmsRoutes, { prefix: '/api/dashboard-wms' })
  await app.register(inventarioRoutes, { prefix: '/api/inventarios' })
  await app.register(relatoriosWmsRoutes, { prefix: '/api/relatorios-wms' })
  await app.register(auditoriaRoutes, { prefix: '/api/auditoria' })
  await app.register(ressuprimentoRoutes, { prefix: '/api/ressuprimento' })
  await app.register(dadosLogisticosRoutes, { prefix: '/api/dados-logisticos' })
  await app.register(agendaWmsRoutes, { prefix: '/api/agenda-wms' })
  await app.register(ondaSeparacaoRoutes, { prefix: '/api/ondas-separacao' })
  await app.register(itemSeparacaoRoutes, { prefix: '/api/itens-separacao' })
  await app.register(conferenciaSaidaRoutes, { prefix: '/api/conferencias-saida' })
  await app.register(volumeRoutes, { prefix: '/api/volumes' })
  await app.register(carregamentoRoutes, { prefix: '/api/carregamentos' })
  await app.register(posicionamentoRoutes, { prefix: '/api/posicionamento' })
  await app.register(portariaRoutes, { prefix: '/api/portaria' })
  await app.register(manutencaoEstoqueRoutes, { prefix: '/api/manutencao-estoque' })
  await app.register(conferenciaEntradaRoutes, { prefix: '/api/conferencia-entrada' })
  await app.register(enderecamentoWmsRoutes, { prefix: '/api/enderecamento-wms' })
  await app.register(etiquetaRoutes, { prefix: '/api/etiquetas' })
  await app.register(ordemServicoWmsRoutes, { prefix: '/api/os-wms' })

  // Fichas Operacionais, OCR e Scanner
  await app.register(fichaOperacionalRoutes, { prefix: '/api/fichas-operacionais' })
  await app.register(ocrRoutes, { prefix: '/api/ocr' })
  await app.register(scannerRoutes, { prefix: '/api/scanner' })

  // Estoque — Visão de Saldo
  await app.register(stockViewRoutes, { prefix: '/api/estoque' })

  // Integração Externa
  await app.register(apiKeyRoutes, { prefix: '/api/api-keys' })
  await app.register(integracaoRoutes, { prefix: '/api/v1/integracao' })
  await app.register(webhookRoutes, { prefix: '/api/webhooks' })

  // Cadastros
  await app.register(centroDistRoutes, { prefix: '/api/centros-distribuicao' })
  await app.register(depositoRoutes, { prefix: '/api/depositos' })
  await app.register(zonaRoutes, { prefix: '/api/zonas' })
  await app.register(estruturaRoutes, { prefix: '/api/estruturas' })
  await app.register(formaArmazenagemRoutes, { prefix: '/api/formas-armazenagem' })
  await app.register(ambienteArmazenagemRoutes, { prefix: '/api/ambientes-armazenagem' })
  await app.register(classificacaoProdutoRoutes, { prefix: '/api/classificacoes-produto' })
  await app.register(produtoRoutes, { prefix: '/api/produtos' })
  await app.register(skuRoutes, { prefix: '/api/skus' })
  await app.register(funcaoRoutes, { prefix: '/api/funcoes' })
  await app.register(funcionarioRoutes, { prefix: '/api/funcionarios' })
  await app.register(equipamentoRoutes, { prefix: '/api/equipamentos' })
  await app.register(docaRoutes, { prefix: '/api/docas' })
  await app.register(enderecoRoutes, { prefix: '/api/enderecos' })
  await app.register(tipoCarroceriaRoutes, { prefix: '/api/tipos-carroceria' })
  await app.register(tipoCargaRoutes, { prefix: '/api/tipos-carga' })
  await app.register(veiculoRoutes, { prefix: '/api/veiculos' })
  await app.register(parametroRoutes, { prefix: '/api/parametros' })
  await app.register(fornecedorRoutes, { prefix: '/api/fornecedores' })
  await app.register(transportadoraRoutes, { prefix: '/api/transportadoras' })
  await app.register(clienteRoutes, { prefix: '/api/clientes' })

  // Operacional
  await app.register(notaEntradaRoutes, { prefix: '/api/notas-entrada' })
  await app.register(importarXmlRoutes, { prefix: '/api/notas-entrada' })
  await app.register(conferenciaRoutes, { prefix: '/api/conferencias' })
  await app.register(saldoRoutes, { prefix: '/api/saldos' })
  await app.register(enderecamentoRoutes, { prefix: '/api/operacoes' })
  await app.register(ordemServicoRoutes, { prefix: '/api/ordens-servico' })

  // Health check
  app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  // Fix admin user (one-time, remove after use)
  app.post('/api/admin/fix-admin', async (request, reply) => {
    const { senha } = request.body as { senha?: string }
    if (senha !== 'caio1420') {
      return reply.status(403).send({ error: 'Senha inválida' })
    }

    const { PrismaClient } = await import('@prisma/client')
    const bcryptModule = await import('bcryptjs')
    const bcrypt = bcryptModule.default || bcryptModule
    const db = new PrismaClient()
    const senhaHash = await bcrypt.hash('123456', 10)

    // Update admin user
    await db.$executeRawUnsafe(
      `UPDATE "usuario" SET nome = 'Admin', perfil = 'SUPER_ADMIN', senha = '${senhaHash}' WHERE email = 'admin@visiofab.com'`
    )

    // Ensure usuario_empresa has all modules
    const admin = await db.usuario.findUnique({ where: { email: 'admin@visiofab.com' } })
    if (admin) {
      const empresa = await db.empresa.findFirst()
      if (empresa) {
        await db.$executeRawUnsafe(
          `INSERT INTO "usuario_empresa" ("usuario_id", "empresa_id", "modulos") VALUES ('${admin.id}', '${empresa.id}', '*') ON CONFLICT ("usuario_id", "empresa_id") DO UPDATE SET modulos = '*'`
        )
      }
    }

    await db.$disconnect()
    return { done: true, message: 'Admin atualizado: nome=Admin, perfil=SUPER_ADMIN, senha=123456, modulos=*' }
  })

  // Admin cleanup endpoint (password-protected)
  app.post('/api/admin/cleanup', async (request, reply) => {
    const { senha } = request.body as { senha?: string }
    if (senha !== 'caio1420') {
      return reply.status(403).send({ error: 'Senha inválida' })
    }

    const { PrismaClient } = await import('@prisma/client')
    const db = new PrismaClient()
    const results: string[] = []

    const tables = [
      'os_funcionario_wms', 'log_movimento_wms', 'ordem_servico_wms',
      'item_conferencia_entrada', 'conferencia_entrada',
      'item_volume', 'carregamento_volume', 'carregamento', 'volume',
      'item_conferencia_saida', 'conferencia_saida',
      'item_separacao', 'ordem_separacao', 'onda_pedido', 'onda_separacao',
      'saldo_endereco', 'movimento', 'log_ordem_servico', 'os_funcionario', 'ordem_servico',
      'estoque', 'item_nota_entrada', 'nota_entrada', 'agenda_wms',
      'conta_receber', 'venda_efetivada', 'item_pedido_venda', 'pedido_venda',
      'conta_pagar', 'item_devolucao_compra', 'devolucao_compra', 'compra_efetivada',
      'item_pedido_compra', 'pedido_compra',
      'funcionario', 'endereco', 'ficha_operacional',
    ]

    for (const table of tables) {
      try {
        await db.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`)
        results.push(`✓ ${table}`)
      } catch (e: any) {
        if (e.message?.includes('42P01') || e.message?.includes('não existe') || e.message?.includes('does not exist')) {
          results.push(`⏭ ${table} (não existe)`)
        } else {
          results.push(`✗ ${table}: ${e.message?.substring(0, 80)}`)
        }
      }
    }

    // Clean users except admin
    try {
      await db.$executeRawUnsafe(`DELETE FROM "usuario_empresa" WHERE "usuario_id" NOT IN (SELECT id FROM "usuario" WHERE email = 'admin@visiofab.com')`)
      results.push('✓ usuario_empresa (non-admin)')
    } catch (e: any) { results.push(`✗ usuario_empresa: ${e.message?.substring(0, 80)}`) }

    try {
      await db.$executeRawUnsafe(`DELETE FROM "usuario" WHERE email != 'admin@visiofab.com'`)
      results.push('✓ usuarios non-admin')
    } catch (e: any) { results.push(`✗ usuario: ${e.message?.substring(0, 80)}`) }

    await db.$disconnect()
    return { done: true, results }
  })

  // SSE (Server-Sent Events) para notificações em tempo real
  await app.register(websocketRoutes)

  const port = Number(process.env.PORT) || 3333
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`🚀 VisioFab WMS API rodando em http://localhost:${port}`)
}

bootstrap()
