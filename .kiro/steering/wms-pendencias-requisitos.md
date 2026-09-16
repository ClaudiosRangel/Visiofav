---
inclusion: auto
---

# Pendências WMS — Requisitos Funcionais (Documento Germano/Alexander, 06/08/2026)

Este arquivo rastreia as lacunas identificadas ao comparar o documento
"1 - Regras de Manutenção dos Estoques.docx" (RF001-RF012) com a
implementação atual do Vizor WMS. Atualizar sempre que uma lacuna for
resolvida ou uma nova for identificada.

---

## Prioridade ALTA 🔴

| # | Lacuna | RF | Status |
|---|--------|-----|--------|
| 1 | **Bloqueio hierárquico** | RF012 | ✅ Implementado |
| 2 | **Quarentena** | RF001/RF002/RF012 | ✅ Implementado |
| 3 | **Transit Point** | RF001 | ✅ Implementado (tipo de endereço + tipo de área) |
| 4 | **Bloqueio de movimentação durante inventário** | Extra | ✅ Implementado |

## Prioridade MÉDIA 🟡

| # | Lacuna | RF | Status |
|---|--------|-----|--------|
| 5 | **Compatibilidade automática de área** | RF004 | ✅ Implementado |
| 6 | **Picking dinâmico (liberação automática)** | RF009 | ✅ Implementado |
| 7 | **Mudança de picking (DE/PARA)** | RF009 | ✅ Implementado |
| 8 | **Limite de SKUs em pulmão misto** | RF011 | ✅ Implementado |
| 9 | **Reabastecimento modo 2** | RF010 | ✅ Implementado (`GET /ressuprimento/pendentes-demanda`) |
| 10 | **Cross docking como tipo de área** | RF002 | ✅ Implementado |
| 11 | **Devoluções como tipo de área** | RF002 | ✅ Implementado |

## Prioridade BAIXA 🟠

| # | Lacuna | RF | Status |
|---|--------|-----|--------|
| 12 | **Família/Subfamília no produto** | RF003 | ✅ Implementado |
| 13 | **Classificação ABC automática** | Extra | ✅ Implementado |
| 14 | **Picking virtual** | RF009 | ✅ Implementado (campo `picking_virtual` + `descricao_virtual` em DadosLogisticosPicking, tipoPicking='VIRTUAL') |
| 15 | **Bloqueio por lote** | RF012 | ✅ Implementado |
| 16 | **Tipos de código de barras diferenciados** | RF003 | ✅ Implementado (campos `tipo_codigo_barra`, `codigo_barra_dun`, `codigo_barra_display` no SKU) |
| 17 | **Pulmão regulador em outro depósito** | RF011 | ✅ Implementado (campo `pulmao_regulador_deposito_id` em DadosLogisticosArmazenagem) |

---

## Resolvido ✅

| # | Lacuna | Resolvido em | Observação |
|---|--------|-------------|------------|
| 1 | **Bloqueio hierárquico** | 08/08/2026 | Tabela `bloqueio_hierarquico` + service + rotas em `/api/bloqueio-wms/bloqueios`. Suporta DEPOSITO, ZONA, RUA, PREDIO, NIVEL, PRODUTO, LOTE |
| 2 | **Quarentena** | 08/08/2026 | Campos `quarentena` em Endereco/Zona + rotas `/api/bloqueio-wms/quarentena/`. Propaga para filhos |
| 3 | **Transit Point** | 08/08/2026 | Novo tipo `TRANSIT_POINT` em Endereco + `tipoArea` em Zona (TRANSIT_POINT, CROSS_DOCKING, DEVOLUCAO, QUARENTENA, NORMAL) |
| 4 | **Bloqueio durante inventário** | 08/08/2026 | Campo `inventario_ativo` em Endereco. Auto-bloqueado ao criar inventário, desbloqueado ao concluir |
| 5 | **Compatibilidade automática** | 08/08/2026 | Service `validarCompatibilidadeArea()` + validação integrada. Campos `classificacao_armazenagem_id` e `ambiente_exigido` no Produto |
| 6 | **Picking dinâmico** | 08/08/2026 | Rota `POST /api/bloqueio-wms/picking/liberar-dinamicos` + service que libera PK quando PK+PL zeram |
| 7 | **Mudança de picking (DE/PARA)** | 08/08/2026 | Tabela `mudanca_picking` + rotas `/api/bloqueio-wms/picking/mudanca` com bloqueio temporário |
| 8 | **Limite de SKUs em pulmão misto** | 08/08/2026 | Campo `max_skus_misto` em Endereco + validação em `validarLimitePulmaoMisto()` |
| 12 | **Família/Subfamília** | 08/08/2026 | Campos `familia` e `sub_familia` no Produto |
| 13 | **Classificação ABC automática** | 08/08/2026 | Rota `POST /api/bloqueio-wms/classificacao-abc/calcular` — calcula a partir de vendas dos últimos 12 meses |
| 15 | **Bloqueio por lote** | 08/08/2026 | Campo `bloqueado` em SaldoEndereco + rota `POST /api/bloqueio-wms/bloqueios/lote` |
| 10 | **Cross docking / Devoluções** | 08/08/2026 | `tipoArea` em Zona suporta CROSS_DOCKING e DEVOLUCAO como tipos dedicados |
| 9 | **Reabastecimento modo 2** | 10/08/2026 | Rota `GET /ressuprimento/pendentes-demanda` — calcula reposição apenas para demanda imediata dos pedidos pendentes |
| 14 | **Picking virtual** | 10/08/2026 | Campos `picking_virtual` e `descricao_virtual` em DadosLogisticosPicking + tipoPicking='VIRTUAL' como orientação para separadores |
| 16 | **Tipos de código de barras** | 10/08/2026 | Campos `tipo_codigo_barra` (EAN13/EAN14_DUN/CODE128/DISPLAY/ITF14), `codigo_barra_dun`, `codigo_barra_display` no SKU |
| 17 | **Pulmão regulador** | 10/08/2026 | Campo `pulmao_regulador_deposito_id` em DadosLogisticosArmazenagem — permite vincular depósito regulador externo |

---

## Correções do cadastro de SKU / dados logísticos (QA humano — 16/09/2026)

QA humano reportou 5 pontos no modal de SKU (`SkuPanel.tsx`) e no cadastro de
Produto (`ProdutoModal.tsx`). Todos corrigidos:

1. **Peso Palete não calculava automático** → agora sugere `pesoBruto × lastro
   × camada` (placeholder "Auto: X"), usado no save se o campo ficar vazio
   (mesmo padrão do Volume = L×A×C/1e6 que já existia).
2. **Unidade / Tipo Palete eram texto livre** → viraram `Select` com legenda
   (`searchable`, aceitam valor livre). Tipo Palete: PBR/CHEP/PER/FER/
   DESCARTAVEL (legenda sugerida — valores oficiais da Carton Wega a confirmar).
3. **Editar limpando um campo não salvava (BUG real)** → o `PUT /skus/:id`
   tratava os campos como `.optional()`; um `undefined` é **ignorado** pelo
   Prisma, então apagar EAN/peso/logística não persistia. Corrigido: o Zod do
   PUT aceita `.nullable()` e o frontend envia `null` (não `undefined`) para
   campos limpados **na edição** (mantém `undefined` = "não alterar"; `null` =
   "limpar"). Padrão a seguir em qualquer PUT que precise permitir limpar
   campo: `campo: z.tipo().nullable().optional()` no back + enviar `null` no
   front ao apagar.
4. **EAN-14 / DUN** → o campo `codigoBarraDun` já existia no schema mas não
   era exposto no modal. Agora tem campo dedicado + botão "varinha" que gera o
   DUN-14 (algoritmo GS1: dígito logístico + 12 dígitos do EAN-13 + novo DV) a
   partir do EAN-13. POST/PUT de `/skus` aceitam `codigoBarraDun`/
   `codigoBarraDisplay`/`tipoCodigoBarra`.
5. **Código de Produto automático** → nova rota `GET /produtos/proximo-codigo`
   (`peekProximoCodigo` em `codigo-sequencial.service.ts` — LÊ o próximo valor
   sem consumir o contador; o código definitivo é resolvido no create).
   `ProdutoModal` ganhou botão "varinha" no campo Código (só em novo produto).

Nenhuma alteração de schema Prisma (as colunas DUN/display/tipo já existiam —
item 16 acima). Sem migração nova.

---

## Pendência Futura — WMS Standalone (Integração sem dependência do Vizor ERP)

### Visão Geral

Separar o WMS para funcionar como produto independente, integrado a ERPs
externos (SAP, TOTVS, Sankhya, Omie, Bling, etc.). O WMS será acessível
por URL direta, com controle de acesso e menus próprios, recebendo toda
configuração via integração.

---

### BACKEND — Pendências para Implementação

#### 1. Autenticação Standalone (sem depender do login ERP Vizor)

| # | Item | Descrição |
|---|------|-----------|
| B1 | **Modo de autenticação dual** | Permitir que uma empresa opere no modo `STANDALONE` (só WMS) ou `INTEGRADO` (parte do ERP Vizor). Flag em `Empresa.modoOperacao` (STANDALONE/ERP_COMPLETO) |
| B2 | **Login direto para operadores WMS** | Rota `/api/wms-auth/login` separada do `/api/auth/login`, aceita credenciais de operadores WMS sem exigir acesso ao ERP. Token JWT com scope `WMS_OPERADOR` |
| B3 | **API Key para ERP externo (já existe)** | O módulo `/api/v1/integracao/` com `apiKeyGuard` já funciona. Expandir com permissões granulares (read-only stock, write orders, full admin) |
| B4 | **OAuth2 / Bearer Token para ERPs corporativos** | Implementar fluxo client_credentials para SAP/TOTVS que preferem OAuth. Rota `/api/wms-auth/token` retornando access_token com expiração |
| B5 | **Multi-tenant por API Key** | Cada API Key já está vinculada a uma `empresaId`. Manter esse isolamento e documentar |

#### 2. API de Integração WMS (expandir o módulo existente)

| # | Item | Descrição |
|---|------|-----------|
| B6 | **Sincronização de Produtos (bidirecional)** | `POST /api/v1/wms/produtos/sync` — ERP envia catálogo completo ou delta. WMS cria/atualiza `Produto` + `Sku` + `DadosLogisticosArmazenagem`/`Picking`. Retorna status por item |
| B7 | **Sincronização de Clientes/Fornecedores** | `POST /api/v1/wms/entidades/sync` — ERP envia cadastros. WMS mantém espelho local para vincular notas e pedidos |
| B8 | **Recebimento (ASN — Advanced Shipment Notice)** | `POST /api/v1/wms/recebimento/asn` — ERP notifica que mercadoria está a caminho. WMS cria `NotaEntrada` com status `AGUARDANDO_CHEGADA`. Substitui importação de XML para clientes sem NF-e |
| B9 | **Confirmação de Recebimento** | `POST /api/v1/wms/recebimento/:id/confirmar` — WMS confirma ao ERP que a mercadoria foi conferida e endereçada. Dispara webhook `nota.recebida` (já existe) |
| B10 | **Pedido de Expedição** | `POST /api/v1/wms/expedicao/pedido` — ERP envia pedido de venda/transferência. WMS cria `PedidoVenda` ou equivalente para gerar onda de separação |
| B11 | **Status de Expedição (callback)** | `POST /api/v1/wms/expedicao/:id/status` — WMS notifica ERP quando separação/conferência/carregamento são concluídos. Via webhook + endpoint de consulta |
| B12 | **Consulta de Estoque em Tempo Real** | `GET /api/v1/wms/estoque` — já existe. Expandir para filtros: por endereço, por lote, por validade, por zona, consolidado vs posicional |
| B13 | **Movimentações de Estoque (log)** | `GET /api/v1/wms/movimentacoes` — ERP pode consultar todos os movimentos (entrada, saída, ajuste, transferência) para reconciliação |
| B14 | **Inventário** | `GET /api/v1/wms/inventario/divergencias` — ERP consulta divergências do último inventário para decidir se aplica ajuste no lado fiscal |
| B15 | **Configuração remota de endereços/zonas** | `POST /api/v1/wms/config/enderecos` — ERP pode provisionar a estrutura de armazém (criar depósito, zonas, endereços em lote) sem acesso à UI |
| B16 | **Webhook expandido** | Adicionar eventos: `inventario.concluido`, `recebimento.enderecado`, `transferencia.concluida`, `bloqueio.criado`, `picking.abastecido` |

#### 3. Independência de dados (sem depender de módulos ERP)

| # | Item | Descrição |
|---|------|-----------|
| B17 | **Pedido de Expedição WMS (modelo own)** | Hoje o WMS cria `OndaSeparacao` a partir de `PedidoVenda` (módulo Vendas). Para standalone, criar `PedidoExpedicaoWms` que não depende de tabela preço, vendedor, etc. — só precisa: cliente, itens (produtoId + quantidade), prioridade, rota |
| B18 | **Nota de Entrada sem módulo Compras** | Hoje `importar-xml` usa `PedidoCompra` + `CompraEfetivada`. Para standalone, permitir criar `NotaEntrada` direto via API sem efetivação de compra (já parcialmente suportado por `nota-entrada.routes.ts`) |
| B19 | **Produto sem campos fiscais obrigatórios** | No standalone, os campos fiscais (NCM, CFOP, CST, etc.) são opcionais — não bloquear criação de produto por falta deles |
| B20 | **Remover dependência de `moduloGuard('WMS')`** | No modo standalone, todas as rotas WMS devem funcionar sem o guard de módulo (empresa standalone sempre tem WMS habilitado). Implementar via `modoOperacao` check |

#### 4. Infraestrutura e Deploy

| # | Item | Descrição |
|---|------|-----------|
| B21 | **URL separada para WMS** | Deploy do frontend WMS em domínio/subdomínio próprio (`wms.vizorerp.com.br` ou domínio do cliente) sem precisar do frontend ERP |
| B22 | **Rate limiting por API Key** | Já existe `rateLimiter` no módulo de integração. Configurar limites por plano (basic: 100/min, pro: 1000/min) |
| B23 | **Documentação OpenAPI/Swagger** | Gerar spec OpenAPI para as rotas `/api/v1/wms/*` para que ERPs externos possam integrar facilmente |
| B24 | **SDK/Client libraries** | Opcional: gerar SDKs em TypeScript e C# para ERPs .NET que queiram integrar |

---

### FRONTEND — Pendências para Implementação

#### 5. Layout WMS Standalone (sem menus ERP)

| # | Item | Descrição |
|---|------|-----------|
| F1 | **Route group `(wms-standalone)`** | Novo route group no Next.js com layout próprio (`layout.tsx`) que NÃO inclui `ModuleSidebar` com módulos ERP (Vendas, Compras, Fiscal, etc.) — só menu WMS |
| F2 | **Sidebar exclusiva WMS** | Menu lateral com APENAS as seções WMS: Dashboard, Recebimento, Endereçamento, Estoque, Picking/Separação, Expedição, Inventário, Relatórios, Configurações WMS |
| F3 | **Login page WMS** | Tela de login com branding do cliente (logo configurável), sem menção ao "Vizor ERP". Rota: `/login` do domínio WMS standalone |
| F4 | **Dashboard WMS dedicado** | Página inicial com KPIs operacionais: notas pendentes, pickings em andamento, endereços ocupados, produtividade do turno. Sem cards de vendas/financeiro/fiscal |
| F5 | **Seletor de empresa simplificado** | No modo standalone, se a API Key vincula a 1 empresa, pular tela de seleção. Se vincula a múltiplas (operador logístico), mostrar seletor simplificado |

#### 6. Telas de Configuração WMS Standalone

| # | Item | Descrição |
|---|------|-----------|
| F6 | **Configuração de Integração** | Tela para: URL do ERP externo, API Key do Vizor (para gerar), eventos webhook habilitados, teste de conectividade. Localizada em `/wms/configuracoes/integracao` |
| F7 | **Cadastro de Produtos (simplificado)** | Versão do cadastro de produto que mostra APENAS campos WMS: código, nome, unidade, EAN, dimensões, peso, lastro, camada, família, classe ABC, exigeLote, shelfLife. Sem campos fiscais (NCM, CFOP, alíquotas) |
| F8 | **Tela de Webhooks** | Já existe parcialmente (se houver rota GET /webhooks). Garantir que esteja disponível no menu WMS standalone para configurar notificações de eventos |
| F9 | **Tela de API Keys** | Gerenciar chaves de acesso para ERP externo. CRUD + permissões granulares + rotação de chave |
| F10 | **White-label** | Permitir que o operador logístico configure: logo, cor primária, nome do sistema — armazenado em `Empresa.configWhiteLabel` (JSON) |

#### 7. Telas Operacionais (adaptação mínima)

| # | Item | Descrição |
|---|------|-----------|
| F11 | **Recebimento sem NF-e** | Adaptar tela de conferência para funcionar com ASN (dados vêm do ERP externo, não de XML). Já funciona hoje via `NotaEntrada` manual — garantir que UX é adequada |
| F12 | **Expedição sem Pedido de Venda** | Adaptar onda de separação para funcionar com `PedidoExpedicaoWms` em vez de `PedidoVenda`. Ou: manter compatibilidade se o pedido de venda for criado pela API |
| F13 | **Tela de Bloqueios/Quarentena** | Nova tela para gerenciar bloqueios hierárquicos (listar, criar, liberar) e quarentena (implementado no backend, precisa de UI). Localização: `/wms/bloqueios` |
| F14 | **Tela de Mudança de Picking** | UI para solicitar/executar/acompanhar mudanças DE/PARA de picking. Localização: `/wms/picking/mudancas` |
| F15 | **Painel de Inventário com bloqueio visível** | Indicar visualmente na tela de inventário quais endereços estão bloqueados para movimentação. Badge/ícone de cadeado |
| F16 | **Classificação ABC** | Tela para disparar cálculo ABC + visualizar resultado (tabela de produtos com coluna curva). Localização: `/wms/estoque-visao/abc` |
| F17 | **Compatibilidade de Área** | Na tela de endereçamento, mostrar alerta visual quando a sugestão detecta incompatibilidade (produto químico em área de alimentos, etc.) |

#### 8. App Mobile (VisioFab.App — Expo)

| # | Item | Descrição |
|---|------|-----------|
| F18 | **Login standalone no app** | O app hoje faz login no ERP completo. Para standalone, permitir login via URL de API configurável (o operador digita a URL do seu WMS ao configurar o app) |
| F19 | **Tela de configuração de servidor** | Primeira tela ao abrir o app: "Informe o endereço do seu WMS" (`https://wms.clientex.com.br`) — salva no AsyncStorage |
| F20 | **Operações via coletor sem ERP** | Conferência, endereçamento, separação via coletor já funcionam. Garantir que não chamam rotas que dependem de módulos ERP (fiscal, vendas) |

---

### Decisões Pendentes (PENSAR antes de implementar)

| # | Decisão | Opções | Impacto |
|---|---------|--------|---------|
| D1 | **Modelo de licenciamento** | SaaS multi-tenant (hoje) vs Instalação on-premise (Docker) vs Hybrid | Deploy, billing, isolamento de dados |
| D2 | **Sincronização de estoque** | Unidirecional (WMS → ERP) vs Bidirecional (WMS ↔ ERP) | Complexidade de conflitos, reconciliação |
| D3 | **Quem é o master de produto?** | ERP externo (WMS recebe) vs WMS (ERP consulta) vs Dual-master com merge | Auto-criação, enriquecimento, conflitos |
| D4 | **Autenticação operadores** | JWT do Vizor (hoje) vs PIN+Terminal (Checkout, hoje) vs SSO do cliente (LDAP/AD) vs Todos | Complexidade de implementação |
| D5 | **Frontend: app separado ou rota do mesmo?** | Novo next.js app (`wms-standalone/`) vs Route group no mesmo (`/(wms-standalone)/`) vs Feature flag no layout existente | Manutenção, deploy, duplicação de código |
| D6 | **Billing: como cobrar WMS standalone?** | Por transação (notas/mês) vs Por endereço ativo vs Por usuário vs Fixo por CD | Modelo comercial |
| D7 | **On-premise: banco separado?** | Banco Neon compartilhado (hoje) vs Banco dedicado por cliente vs Self-hosted PostgreSQL | Isolamento, custo, compliance |

---

### Ordem Sugerida de Implementação

| Fase | Escopo | Status |
|------|--------|--------|
| **Fase 1** | B1-B5 (Auth standalone) + B20 (moduloGuard bypass) + F1-F5 (Layout) | ⚠️ Parcial — Config + API base implementados |
| **Fase 2** | B6-B11 (API de Integração WMS) + B16 (Webhooks) + F6-F9 (Config) | ✅ B6, B8, B10, B12, B13, F6 implementados |
| **Fase 3** | B17-B19 (Independência de dados) + F11-F12 (Telas operacionais) | ⏳ Pendente |
| **Fase 4** | F13-F17 (Telas novas de bloqueio/picking/ABC) + F18-F20 (App mobile) | ✅ F13, F14, F16 implementados (item 1) |
| **Fase 5** | B21-B24 (Infra/docs) + F10 (White-label) | ⏳ Pendente |

---

### O que JÁ existe e pode ser reaproveitado

| Recurso | Status | Observação |
|---------|--------|------------|
| API Key + apiKeyGuard | ✅ | Protege `/api/v1/integracao/` |
| Webhooks (6 eventos) | ✅ | Modelo `WebhookConfig` + `WebhookEntrega` + dispatcher |
| `POST /api/v1/integracao/produtos` (upsert) | ✅ | Cria/atualiza produto por código |
| `POST /api/v1/integracao/notas-entrada` | ✅ | Cria pedido de compra (precisa adaptação para standalone) |
| `GET /api/v1/integracao/estoque` | ✅ | Consulta saldo disponível |
| `POST /api/v1/integracao/pedidos-separacao` | ✅ | Cria pedido de venda para separação |
| Conferência via coletor (app) | ✅ | `/api/enderecamento-wms/confirmar-coletor` |
| Log de integração | ✅ | Tabela `log_integracao` com apiKeyId, endpoint, tempo |
| Checkout (terminal PIN) | ✅ | Auth independente por PIN de operador — modelo para standalone |
| Auto-criação de produto (import XML) | ✅ | `resolverOuCriarProduto` + código sequencial + enriquecimento |
| De-Para fornecedor | ✅ | Cadeia de resolução completa (cProd → EAN → SKU) |

---

## Referência do Documento

- **Título**: Documento de Requisitos Funcionais e Regras de Negócio — Sistema de Gerenciamento de Centro de Distribuição – VIZOR WMS — Parte 1
- **Autores**: Germano James Morris (Diretor) / Alexander Morris (Gerente de Projetos)
- **Data**: 06/08/2026
- **Arquivo**: `1 - Regras de Manutenção dos Estoques.docx` (raiz do projeto)
