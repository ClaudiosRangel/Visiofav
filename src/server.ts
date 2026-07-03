// Set timezone to Brasília
process.env.TZ = 'America/Sao_Paulo'

import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import cookie from '@fastify/cookie'
import { authRoutes } from './modules/auth/auth.routes'
import { usuarioRoutes } from './modules/usuario/usuario.routes'
import { preferenciasRoutes } from './modules/usuario/preferencias.routes'
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
import { rotaRoutes } from './modules/rota/rota.routes'
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
import { orcamentoRoutes } from './modules/orcamento/orcamento.routes'
import { devolucaoVendaRoutes } from './modules/devolucao-venda/devolucao-venda.routes'
import { relatoriosVendasRoutes } from './modules/relatorios-vendas/relatorios-vendas.routes'
import { vendaRoutes } from './modules/venda/venda.routes'
import { contaPagarRoutes } from './modules/conta-pagar/conta-pagar.routes'
import { contaReceberRoutes } from './modules/conta-receber/conta-receber.routes'
import { nfeRoutes } from './modules/nfe/nfe.routes'
import { cteRoutes } from './modules/cte/cte.routes'
import { agendaWmsRoutes } from './modules/agenda-wms/agenda-wms.routes'

// Módulo Vendas — Avançado
import { campanhaDescontoRoutes } from './modules/campanha-desconto/campanha-desconto.routes'
import { comissaoAvancadaRoutes } from './modules/comissao-avancada/comissao-avancada.routes'
import { workflowAprovacaoRoutes } from './modules/workflow-aprovacao/workflow-aprovacao.routes'
import { forcaVendasRoutes } from './modules/forca-vendas/forca-vendas.routes'
import { bonificacaoRoutes } from './modules/bonificacao/bonificacao.routes'
import { vendaEncomendaRoutes } from './modules/venda-encomenda/venda-encomenda.routes'
import { vendaConsignadaRoutes } from './modules/venda-consignada/venda-consignada.routes'
import { integracaoEcommerceRoutes } from './modules/integracao-ecommerce/integracao-ecommerce.routes'
import { pdvRoutes } from './modules/pdv/pdv.routes'

// Módulo Agenda unificado (coexiste com agenda-wms e agenda-doca)
import { agendaRoutes } from './modules/agenda/agenda.routes'
import { agendaTimelineRoutes } from './modules/agenda/agenda-timeline.routes'
import { agendaBloqueiosRoutes } from './modules/agenda/agenda-bloqueios.routes'
import { agendaConfigRoutes } from './modules/agenda/agenda-config.routes'
import { agendaEstatisticasRoutes } from './modules/agenda/agenda-estatisticas.routes'
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
import { pendenciaLogisticaRoutes } from './modules/pendencia-logistica/pendencia-logistica.routes'
import { apiKeyRoutes } from './modules/integracao/api-key.routes'
import { integracaoRoutes } from './modules/integracao/integracao.routes'
import { webhookRoutes } from './modules/integracao/webhook.routes'
import { dashboardWmsRoutes } from './modules/dashboard-wms/dashboard-wms.routes'
import { inventarioRoutes } from './modules/inventario/inventario.routes'
import { relatoriosWmsRoutes } from './modules/relatorios-wms/relatorios-wms.routes'
import { auditoriaRoutes } from './modules/auditoria/auditoria.routes'
import { securityDashboardRoutes } from './modules/auditoria/security-dashboard.routes'
import { ressuprimentoRoutes } from './modules/ressuprimento/ressuprimento.routes'
import { dadosLogisticosRoutes } from './modules/dados-logisticos/dados-logisticos.routes'
import { websocketRoutes } from './modules/websocket/websocket.routes'
import { fichaOperacionalRoutes } from './modules/ficha-operacional/ficha-operacional.routes'
import { ocrRoutes } from './modules/ocr/ocr.routes'
import { scannerRoutes } from './modules/scanner/scanner.routes'
import { stockViewRoutes } from './modules/estoque/stock-view.routes'
import { mapaCarregamentoRoutes } from './modules/mapa-carregamento/mapa-carregamento.routes'
import { relatorioExpedicaoRoutes } from './modules/relatorio-expedicao/relatorio-expedicao.routes'
import { deparaFornecedorRoutes } from './modules/depara-fornecedor/depara-fornecedor.routes'
import { importarXmlDeparaRoutes } from './modules/nota-entrada/importar-xml-depara.routes'
import { capacidadeNivelRoutes } from './modules/capacidade-nivel/capacidade-nivel.routes'
import { enderecamentoInteligenteRoutes } from './modules/enderecamento-inteligente/enderecamento-inteligente.routes'
import { formatoEnderecoRoutes } from './modules/formato-endereco/formato-endereco.routes'
import { geoRoutes } from './modules/geolocalizacao/geo.routes'
import { cceRoutes } from './modules/cce/cce.routes'
import { configEmailFiscalRoutes } from './modules/config-email-fiscal/config-email-fiscal.routes'
import { configIntegracaoRoutes } from './modules/config-integracao/config-integracao.routes'
import { pendenciaCceRoutes } from './modules/pendencia-cce/pendencia-cce.routes'
import { pendenciaCceExternaRoutes } from './modules/pendencia-cce/pendencia-cce-externa.routes'
import { fiscalRoutes } from './modules/fiscal/fiscal.routes'

// Fase 1 — Profissionalização WMS
import { crossDockRoutes } from './modules/cross-dock/cross-dock.routes'
import { logisticaReversaRoutes } from './modules/logistica-reversa/logistica-reversa.routes'
import { kpiRoutes } from './modules/kpi/kpi.routes'
import { agendaDocaRoutes } from './modules/agenda-doca/agenda-doca.routes'
import { etiquetasZplRoutes } from './modules/etiquetas-zpl/etiquetas-zpl.routes'
import { iniciarKpiWorker } from './modules/kpi/kpi.worker'
import { iniciarEtiquetasWorker } from './modules/etiquetas-zpl/etiquetas-zpl.worker'
import { startFaturamentoWorker } from './modules/faturamento/faturamento.worker'
import { startLmsWorker } from './modules/lms/lms.worker'
import { startMultiCdWorker } from './modules/multi-cd/multi-cd.worker'
import { startPatioWorker } from './modules/patio/patio.worker'

// Fase 2 — Escalar WMS
import { faturamentoRoutes } from './modules/faturamento/faturamento.routes'
import { pickingZonaRoutes } from './modules/picking-zona/picking-zona.routes'
import { lmsRoutes } from './modules/lms/lms.routes'
import { patioRoutes } from './modules/patio/patio.routes'
import { chamadaDocaRoutes } from './modules/patio/chamada-doca.routes'
import { painelOperacionalRoutes } from './modules/painel-operacional/painel-operacional.routes'
import { multiCdRoutes } from './modules/multi-cd/multi-cd.routes'

// Fase 3 — Diferenciar WMS
import { demandaRoutes } from './modules/demanda/demanda.routes'
import { portalRoutes } from './modules/portal/portal.routes'
import { biRoutes } from './modules/bi/bi.routes'
import { waveRoutes } from './modules/wave/wave.routes'
import { startDemandaWorker } from './modules/demanda/demanda.worker'
import { startPortalWorker } from './modules/portal/portal.worker'
import { startBiWorkers } from './modules/bi/bi.worker'
import { startWaveWorker } from './modules/wave/wave.worker'

// PCP — Planejamento e Controle da Produção
import { centroProducaoRoutes } from './modules/centro-producao/centro-producao.routes'
import { recursoProducaoRoutes } from './modules/recurso-producao/recurso-producao.routes'
import { turnoProducaoRoutes } from './modules/turno-producao/turno-producao.routes'
import { estruturaProdutoRoutes } from './modules/estrutura-produto/estrutura-produto.routes'
import { roteiroProducaoRoutes } from './modules/roteiro-producao/roteiro-producao.routes'
import { atributoGraficoRoutes } from './modules/atributo-grafico/atributo-grafico.routes'
import { conversaoUnidadesRoutes } from './modules/pcp/conversao-unidades.routes'
import { controleBobinaRoutes } from './modules/pcp/controle-bobina.routes'
import { estoqueTerceirosRoutes } from './modules/pcp/estoque-terceiros.routes'
import { paletizacaoRoutes } from './modules/pcp/paletizacao.routes'
import { configuracaoPcpRoutes } from './modules/pcp/configuracao-pcp.routes'
import { calculoConsumoGraficoRoutes } from './modules/pcp/calculo-consumo-grafico.routes'
import { etapaOperacionalRoutes } from './modules/pcp/etapa-operacional.routes'
import { dashboardUnificadoRoutes } from './modules/pcp/dashboard-unificado.routes'
import { acompanhamentoClienteRoutes } from './modules/pcp/acompanhamento-cliente.routes'
import { importacaoOpRoutes } from './modules/pcp/importacao-op/importacao-op.routes'
import { adminPcpRoutes } from './modules/pcp/admin-pcp.routes'
import { firebaseAuthAdapter } from './middleware/firebase-auth-adapter'
import { ordemProducaoRoutes } from './modules/ordem-producao/ordem-producao.routes'
import { variacoesEntregaRoutes } from './modules/ordem-producao/variacoes-entrega.routes'
import { liberacaoMaterialRoutes } from './modules/liberacao-material/liberacao-material.routes'
import { apontamentoProducaoRoutes } from './modules/apontamento-producao/apontamento-producao.routes'

import { registerTenantContext } from './middleware/tenant-context'
import { registerSecurityAuditHook } from './middleware/security-audit'
import multipart from '@fastify/multipart'

const app = Fastify({ logger: true })

async function bootstrap() {
  // ── Segurança: JWT_SECRET obrigatório em produção ──
  const JWT_SECRET = process.env.JWT_SECRET
  if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
    throw new Error('❌ JWT_SECRET é obrigatório em produção. Configure a variável de ambiente.')
  }

  // ── Segurança: CORS restrito a origens permitidas ──
  const allowedOrigins = [
    'https://visiofav-front-wofr.vercel.app',
    'https://app.vizorerp.com.br',
    'http://localhost:3000',
    'http://localhost:3001',
  ]
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) {
        cb(null, true)
      } else {
        cb(new Error('CORS: Origem não permitida'), false)
      }
    },
    credentials: true,
  })

  await app.register(jwt, { secret: JWT_SECRET || 'dev-secret-only-for-local' })

  // ── Segurança: Cookies httpOnly para tokens de autenticação ──
  await app.register(cookie, {
    secret: JWT_SECRET || 'dev-cookie-secret',
    parseOptions: {},
  })

  // ── Segurança: Headers de proteção (XSS, Clickjacking, Sniffing) ──
  await app.register(helmet, {
    contentSecurityPolicy: false, // Desabilitar CSP pois é API (não serve HTML)
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // Permitir recursos cross-origin
  })

  // ── Segurança: Rate Limiting global (proteção contra brute-force e DDoS) ──
  await app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
    // Limites mais restritivos aplicados por rota abaixo
  })

  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } })

  registerTenantContext(app)

  // ── Segurança: Auditoria automática de eventos de segurança ──
  registerSecurityAuditHook(app)

  // Adapter Firebase Auth (período de migração)
  app.addHook('onRequest', firebaseAuthAdapter)

  // Auth
  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(usuarioRoutes, { prefix: '/api/usuarios' })
  await app.register(preferenciasRoutes, { prefix: '/api/usuarios' })

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
  await app.register(orcamentoRoutes, { prefix: '/api/orcamentos' })
  await app.register(devolucaoVendaRoutes, { prefix: '/api/devolucoes-venda' })
  await app.register(relatoriosVendasRoutes, { prefix: '/api/relatorios/vendas' })

  // Módulo Vendas — Avançado
  await app.register(campanhaDescontoRoutes, { prefix: '/api/campanhas-desconto' })
  await app.register(comissaoAvancadaRoutes, { prefix: '/api/comissoes-avancadas' })
  await app.register(workflowAprovacaoRoutes, { prefix: '/api/workflow-aprovacao' })
  await app.register(forcaVendasRoutes, { prefix: '/api/forca-vendas' })
  await app.register(bonificacaoRoutes, { prefix: '/api/bonificacoes' })
  await app.register(vendaEncomendaRoutes, { prefix: '/api/vendas-encomenda' })
  await app.register(vendaConsignadaRoutes, { prefix: '/api/vendas-consignadas' })
  await app.register(integracaoEcommerceRoutes, { prefix: '/api/integracao-ecommerce' })

  // Módulo PDV — Ponto de Venda
  await app.register(pdvRoutes, { prefix: '/api/pdv' })

  // Módulo Financeiro
  await app.register(contaPagarRoutes, { prefix: '/api/contas-pagar' })
  await app.register(contaReceberRoutes, { prefix: '/api/contas-receber' })

  // Módulo Fiscal — NF-e
  await app.register(nfeRoutes, { prefix: '/api/nfe' })
  await app.register(cteRoutes, { prefix: '/api/cte' })
  await app.register(cceRoutes, { prefix: '/api/cce' })

  // Módulo Fiscal — Plugin completo (motor tributário, emissor, SPED, apuração, cadastros, etc.)
  await app.register(fiscalRoutes, { prefix: '/api/fiscal' })

  // Integração WMS
  await app.register(dashboardWmsRoutes, { prefix: '/api/dashboard-wms' })
  await app.register(inventarioRoutes, { prefix: '/api/inventarios' })
  await app.register(relatoriosWmsRoutes, { prefix: '/api/relatorios-wms' })
  await app.register(auditoriaRoutes, { prefix: '/api/auditoria' })
  await app.register(securityDashboardRoutes, { prefix: '/api/seguranca' })
  await app.register(ressuprimentoRoutes, { prefix: '/api/ressuprimento' })
  await app.register(dadosLogisticosRoutes, { prefix: '/api/dados-logisticos' })
  await app.register(agendaWmsRoutes, { prefix: '/api/agenda-wms' })

  // Módulo Agenda unificado (coexiste com agenda-wms e agenda-doca para backward compatibility)
  await app.register(agendaRoutes, { prefix: '/api/agenda' })
  await app.register(agendaTimelineRoutes, { prefix: '/api/agenda' })
  await app.register(agendaBloqueiosRoutes, { prefix: '/api/agenda/bloqueios' })
  await app.register(agendaConfigRoutes, { prefix: '/api/agenda/config' })
  await app.register(agendaEstatisticasRoutes, { prefix: '/api/agenda/estatisticas' })
  await app.register(ondaSeparacaoRoutes, { prefix: '/api/ondas-separacao' })
  await app.register(itemSeparacaoRoutes, { prefix: '/api/itens-separacao' })
  await app.register(conferenciaSaidaRoutes, { prefix: '/api/conferencias-saida' })
  await app.register(volumeRoutes, { prefix: '/api/volumes' })
  await app.register(carregamentoRoutes, { prefix: '/api/carregamentos' })
  await app.register(mapaCarregamentoRoutes, { prefix: '/api/mapas-carregamento' })
  await app.register(relatorioExpedicaoRoutes, { prefix: '/api/relatorios/expedicao' })
  await app.register(posicionamentoRoutes, { prefix: '/api/posicionamento' })
  await app.register(portariaRoutes, { prefix: '/api/portaria' })
  await app.register(manutencaoEstoqueRoutes, { prefix: '/api/manutencao-estoque' })
  await app.register(conferenciaEntradaRoutes, { prefix: '/api/conferencia-entrada' })
  await app.register(configEmailFiscalRoutes, { prefix: '/api/config-email-fiscal' })
  await app.register(pendenciaCceRoutes, { prefix: '/api/pendencias-cce' })
  await app.register(enderecamentoWmsRoutes, { prefix: '/api/enderecamento-wms' })
  await app.register(etiquetaRoutes, { prefix: '/api/etiquetas' })
  await app.register(ordemServicoWmsRoutes, { prefix: '/api/os-wms' })
  await app.register(pendenciaLogisticaRoutes, { prefix: '/api/pendencias-logisticas' })
  await app.register(capacidadeNivelRoutes, { prefix: '/api/capacidades-nivel' })
  await app.register(enderecamentoInteligenteRoutes, { prefix: '/api/enderecamento-inteligente' })
  await app.register(formatoEnderecoRoutes, { prefix: '/api/formato-endereco' })

  // Módulo Geolocalização — Roteirização
  await app.register(geoRoutes, { prefix: '/api/geo' })

  // Fase 1 — Profissionalização WMS
  await app.register(crossDockRoutes, { prefix: '/api/cross-dock' })
  await app.register(logisticaReversaRoutes, { prefix: '/api/logistica-reversa' })
  await app.register(kpiRoutes, { prefix: '/api/kpi' })
  await app.register(agendaDocaRoutes, { prefix: '/api/agenda-doca' })
  await app.register(etiquetasZplRoutes, { prefix: '/api/etiquetas-zpl' })

  // Fase 2 — Escalar WMS
  await app.register(faturamentoRoutes, { prefix: '/api/faturamento' })
  await app.register(pickingZonaRoutes, { prefix: '/api/picking-zona' })
  await app.register(lmsRoutes, { prefix: '/api/lms' })
  await app.register(patioRoutes, { prefix: '/api/patio' })
  await app.register(chamadaDocaRoutes, { prefix: '/api/patio/chamada-doca' })
  await app.register(painelOperacionalRoutes, { prefix: '/api/painel-operacional' })
  await app.register(multiCdRoutes, { prefix: '/api/multi-cd' })

  // Fase 3 — Diferenciar WMS
  await app.register(demandaRoutes, { prefix: '/api/demanda' })
  await app.register(portalRoutes, { prefix: '/api/portal' })
  await app.register(biRoutes, { prefix: '/api/bi' })
  await app.register(waveRoutes, { prefix: '/api/wave' })

  // Módulo PCP — Planejamento e Controle da Produção
  await app.register(centroProducaoRoutes, { prefix: '/api/centros-producao' })
  await app.register(recursoProducaoRoutes, { prefix: '/api/recursos-producao' })
  await app.register(turnoProducaoRoutes, { prefix: '/api/turnos-producao' })
  await app.register(estruturaProdutoRoutes, { prefix: '/api/estruturas-produto' })
  await app.register(roteiroProducaoRoutes, { prefix: '/api/roteiros-producao' })
  await app.register(atributoGraficoRoutes, { prefix: '/api/atributos-graficos' })
  await app.register(ordemProducaoRoutes, { prefix: '/api/ordens-producao' })
  await app.register(variacoesEntregaRoutes, { prefix: '/api/ordens-producao' })
  await app.register(liberacaoMaterialRoutes, { prefix: '/api/liberacoes-material' })
  await app.register(apontamentoProducaoRoutes, { prefix: '/api/apontamentos-producao' })
  await app.register(conversaoUnidadesRoutes, { prefix: '/api/pcp' })
  await app.register(controleBobinaRoutes, { prefix: '/api/pcp' })
  await app.register(estoqueTerceirosRoutes, { prefix: '/api/pcp' })
  await app.register(paletizacaoRoutes, { prefix: '/api/pcp' })
  await app.register(configuracaoPcpRoutes, { prefix: '/api/pcp' })
  await app.register(calculoConsumoGraficoRoutes, { prefix: '/api/pcp' })
  await app.register(etapaOperacionalRoutes, { prefix: '/api/pcp' })
  await app.register(dashboardUnificadoRoutes, { prefix: '/api/pcp' })
  await app.register(importacaoOpRoutes, { prefix: '/api/pcp' })

  // Admin — Operações destrutivas (limpar dados)
  await app.register(adminPcpRoutes, { prefix: '/api/admin' })

  // Acompanhamento público (sem auth) — visão do cliente
  await app.register(acompanhamentoClienteRoutes, { prefix: '/api/acompanhamento' })

  // Fichas Operacionais, OCR e Scanner
  await app.register(fichaOperacionalRoutes, { prefix: '/api/fichas-operacionais' })
  await app.register(ocrRoutes, { prefix: '/api/ocr' })
  await app.register(scannerRoutes, { prefix: '/api/scanner' })

  // Estoque — Visão de Saldo
  await app.register(stockViewRoutes, { prefix: '/api/estoque' })

  // Configuração de Integração (Conferência)
  await app.register(configIntegracaoRoutes, { prefix: '/api/config-integracao' })

  // Integração Externa
  await app.register(apiKeyRoutes, { prefix: '/api/api-keys' })
  await app.register(integracaoRoutes, { prefix: '/api/v1/integracao' })
  await app.register(pendenciaCceExternaRoutes, { prefix: '/api/v1/integracao/pendencias-cce' })
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
  await app.register(rotaRoutes, { prefix: '/api/rotas' })
  await app.register(clienteRoutes, { prefix: '/api/clientes' })

  // Operacional
  await app.register(notaEntradaRoutes, { prefix: '/api/notas-entrada' })
  await app.register(importarXmlRoutes, { prefix: '/api/notas-entrada' })
  await app.register(importarXmlDeparaRoutes, { prefix: '/api/notas-entrada' })
  await app.register(deparaFornecedorRoutes, { prefix: '/api/depara-fornecedor' })
  await app.register(conferenciaRoutes, { prefix: '/api/conferencias' })
  await app.register(saldoRoutes, { prefix: '/api/saldos' })
  await app.register(enderecamentoRoutes, { prefix: '/api/operacoes' })
  await app.register(ordemServicoRoutes, { prefix: '/api/ordens-servico' })

  // Health check
  const BUILD_DATE = new Date().toISOString()
  app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString(), buildDate: BUILD_DATE }))

  // ── REMOVIDO: Endpoints admin com senha hardcoded (vulnerabilidade de segurança) ──
  // Os endpoints /api/admin/fix-columns, /api/admin/fix-admin e /api/admin/cleanup
  // foram removidos por expor senhas no código-fonte e permitir destruição de dados.
  // Use migrations (prisma migrate) para alterações de schema.
  // Use o módulo adminPcpRoutes para limpeza de dados (requer auth + perfil SUPER_ADMIN/ADMIN).

  // SSE (Server-Sent Events) para notificações em tempo real
  await app.register(websocketRoutes)

  const port = Number(process.env.PORT) || 3333
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`🚀 VisioFab WMS API rodando em http://localhost:${port}`)

  // Iniciar workers de background
  iniciarKpiWorker()
  iniciarEtiquetasWorker()
  startFaturamentoWorker()
  startLmsWorker()
  startMultiCdWorker()
  startPatioWorker()
  startDemandaWorker()
  startPortalWorker()
  startBiWorkers()
  startWaveWorker()
}

bootstrap()
