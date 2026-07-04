---
inclusion: manual
---

# VisioFab ERP — Roadmap Completo e Contexto do Projeto

## Visão Geral

O VisioFab está evoluindo de um WMS especializado para um **ERP completo** focado no mercado brasileiro. O diferencial competitivo é a combinação de WMS nativo sofisticado + ERP com UX moderna + preço acessível.

## Stack Backend

| Recurso | Tecnologia |
|---------|-----------|
| Runtime | Node.js + tsx |
| Framework | Fastify |
| ORM | Prisma 6 |
| Banco | PostgreSQL (Neon serverless) |
| Validação | Zod |
| Linguagem | TypeScript 100% |
| Deploy | Render (automático via push main) |

---

## Módulos — Ordem de Implementação

### Prioridade 1 (Sem isso não vende ERP no Brasil)

| # | Módulo | Status | Spec |
|---|--------|--------|------|
| 1 | **Fiscal** | ✅ Completo | `erp-modulo-fiscal` + `erp-fiscal-completar` |
| 2 | **Financeiro** | ⚠️ Básico | — |
| 3 | **Cadastros Completos** | ⚠️ Parcial | — |

### Prioridade 2 (Diferencial competitivo)

| # | Módulo | Status | Detalhe |
|---|--------|--------|---------|
| 4 | **Vendas Completo** | ✅ **COMPLETO** | Pedido, Orçamento (PDF), Devolução (NF-e), Relatórios, PDV, Campanhas, Comissão, Workflow, Metas, Bonificação, Encomenda, Consignada, E-commerce |
| 5 | **Compras Completo** | ⚠️ Parcial | Pedido + efetivação + XML ok. Falta cotação, MRP, aprovação |
| 6 | **Devolução** | ✅ Completo | Devolução compra + venda (NF-e finalidade=4) + estorno financeiro + reentrada estoque |
| 7 | **Transferência** | ⚠️ Básico | Transferência estoque entre empresas ok. Falta NF-e de transferência |
| 8 | **Régua de cobrança** | 🔲 Não iniciado | — |
| 9 | **Vizor AI** | ✅ **IMPLEMENTADO** | Chat IA com function calling, upload XML, onboarding, 30+ tools, conhecimento completo do sistema |

### Prioridade 3 (Amadurecimento)

| # | Módulo | Status |
|---|--------|--------|
| 10 | Contábil (exportação para Domínio/Fortes) | 🔲 |
| 11 | Integrações (marketplaces, Open Finance) | ⚠️ Básico (estrutura pronta) |
| 11 | CRM integrado | 🔲 |

---

## Estado Atual Detalhado por Módulo

### 📦 Módulo de Vendas

#### O que JÁ existe (implementado)

| Funcionalidade | Endpoint | Status |
|----------------|----------|--------|
| Pedido de venda (CRUD) | `POST/GET/PUT /api/pedido-venda` | ✅ |
| Confirmar pedido | `PATCH /api/pedido-venda/:id/confirmar` | ✅ |
| Cancelar pedido | `PATCH /api/pedido-venda/:id/cancelar` | ✅ |
| Efetivar venda (emite NF-e) | `POST /api/vendas/efetivar` | ✅ |
| Listar vendas efetivadas | `GET /api/vendas` | ✅ |
| Status de entrega | `PATCH /api/vendas/:id/entrega` | ✅ |
| Relatório comissões | `GET /api/vendas/comissoes` | ✅ |
| Vendedor (CRUD + inativar) | `/api/vendedor` | ✅ |
| Tabela de preço + condições | `/api/tabela-preco` | ✅ |
| Contas a receber automáticas | Gerado na efetivação | ✅ |
| Integração fiscal (NF-e automática) | Via `vendaFiscalService` | ✅ |
| Contingência SEFAZ | Efetiva com flag contingência | ✅ |

#### O que FALTA para módulo completo (padrão Totvs/Omie/Sankhya)

##### ✅ Módulo de Vendas — COMPLETO (implementado nesta sprint)

| # | Funcionalidade | Status |
|---|---|---|
| 1 | Orçamento/Proposta (CRUD + workflow + PDF + conversão pedido) | ✅ |
| 2 | Devolução de venda (NF-e finalidade=4 + estorno + reentrada estoque) | ✅ |
| 3 | Relatórios (KPIs, por período, vendedor, cliente, curva ABC) | ✅ |
| 4 | PDV (caixa, sangria, suprimento, venda rápida, pagamentos múltiplos, dark-mode UX) | ✅ |
| 5 | Desconto por campanha/cupom (CRUD + validar + aplicar) | ✅ |
| 6 | Tabela de preço com vigência (data início/fim, por cliente/grupo, prioridade) | ✅ |
| 7 | Força de vendas (metas por vendedor/período, dashboard performance) | ✅ |
| 8 | Bonificação (regras gatilho por produto/quantidade) | ✅ |
| 9 | Venda sob encomenda (make-to-order com link OP) | ✅ |
| 10 | Venda consignada (remessa + retorno parcial) | ✅ |
| 11 | Comissão avançada (por faixa, produto, região, sobre recebimento) | ✅ |
| 12 | Workflow de aprovação (regras + solicitações + aprovar/rejeitar) | ✅ |
| 13 | Integração e-commerce (CRUD integrações + importar pedido) | ✅ |

##### 🤖 Vizor AI — Assistente Inteligente (implementado)

| Funcionalidade | Status |
|---|---|
| Chat com function calling (Claude API) | ✅ |
| 30+ tools (navegar, criar pedido, consultar vendas/estoque/financeiro, etc.) | ✅ |
| Upload XML no chat → extrai dados + concilia pedido + oferece agendamento WMS | ✅ |
| Conhecimento completo do sistema (todas tabelas, regras, pré-requisitos) | ✅ |
| Onboarding automático (detecta sistema vazio, guia configuração) | ✅ |
| Histórico persistente (salva conversas no banco) | ✅ |
| Diagnóstico de pré-requisitos antes de executar ações | ✅ |
| Shortcuts para sugestões (resposta instantânea sem LLM) | ✅ |
| Agendamento REAL de recebimento no WMS (consulta disponibilidade real nas docas, sugere próximos dias se lotado, agenda só após confirmação) | ✅ |
| Configuração de integração com ERP externo (SAP, TOTVS, Sankhya, etc.) via IA | ✅ |
| Onboarding guiado passo-a-passo (segmento, regime tributário, módulos, WMS detalhado, integração ERP, cadastros, certificado digital) | ✅ |
| Importação REAL de XML (cadastra fornecedor/produtos, cria pedido+doc fiscal+conta a pagar, confirmação determinística no chat) | ✅ |
| Onboarding REAL de nova empresa: dados cadastrais, tributação inicial (seed de naturezas de operação/CFOP), CD/depósito/zona/docas/endereços WMS em lote, criação de usuários com nível de acesso, cadastro de funcionários com vínculo a coletor | ✅ |
| Bug corrigido: erro genérico "Erro ao processar" causado por histórico de chat mal formatado (roles não alternando) enviado à Anthropic API | ✅ |
| Busca automática de CEP (ViaCEP) no cadastro de empresa/cliente/fornecedor via chat | ✅ |
| Módulo Distribuição DFe: verificar e baixar NF-e/CT-e emitidas contra o CNPJ da empresa direto na SEFAZ (requer certificado digital ativo) | ✅ backend, 🔲 frontend |

##### 🔧 Infraestrutura (implementado)

| Funcionalidade | Status |
|---|---|
| Token keep-alive (renova automaticamente enquanto usuário ativo) | ✅ |
| PDV: recuperação de venda após relogin | ✅ |
| PDV: busca produto por nome (F3) | ✅ |
| Layout ERP (Sankhya/TOTVS) no pedido de venda | ✅ |
| Limpar dados: filtra por empresa (não global) | ✅ |
| Backup: exportar dados empresa como JSON (download local) | ✅ |
| Restaurar: importar backup JSON com upsert | ✅ |

---

### 🛒 Módulo de Compras

#### O que JÁ existe (implementado)

| Funcionalidade | Endpoint | Status |
|----------------|----------|--------|
| Pedido de compra (CRUD) | `POST/GET/PUT /api/pedido-compra` | ✅ |
| Confirmar pedido | `PATCH /api/pedido-compra/:id/confirmar` | ✅ |
| Cancelar pedido | `PATCH /api/pedido-compra/:id/cancelar` | ✅ |
| Efetivar compra (com/sem XML) | `POST /api/compras/efetivar` | ✅ |
| Importar XML fornecedor | `POST /api/compras/importar-xml` | ✅ |
| Preview XML | `POST /api/compras/preview-xml` | ✅ |
| Auto-criar fornecedor/produto do XML | Na importação | ✅ |
| Contas a pagar automáticas | Gerado na efetivação | ✅ |
| Integração fiscal (DocumentoFiscal entrada) | Via `compraFiscalService` | ✅ |
| Validação XML + duplicidade | CNPJ + nNF + série | ✅ |
| Devolução de compra | `POST /api/compras/:id/devolver` | ✅ |
| Transferência entre empresas | `POST /api/compras/transferir` | ✅ |
| De-para fornecedor/produto | `/api/depara-fornecedor` | ✅ |

#### O que FALTA para módulo completo

| Funcionalidade | Prioridade | Descrição |
|----------------|-----------|-----------|
| **Cotação / Solicitação de compra** | Alta | Solicitar cotação a N fornecedores, comparar preços, selecionar melhor |
| **MRP (Planejamento de Necessidades)** | Alta | Sugestão automática baseada em estoque mínimo, demanda, lead time |
| **Workflow de aprovação** | Alta | Aprovação por alçada (valor, centro de custo, gestor) |
| **Follow-up de entregas** | Média | Acompanhamento de prazos, alertas de atraso, replanejamento |
| **Avaliação de fornecedor** | Média | Nota por prazo, qualidade, preço; ranking automático |
| **Acordo comercial** | Média | Condições negociadas: prazo, desconto progressivo, volume mínimo |
| **NF-e de devolução ao fornecedor** | Alta | Emissão de NF-e de saída com finalidade=4 (devolução) referenciando a NF-e de entrada |
| **Recebimento parcial** | Média | Receber apenas parte dos itens, manter pedido aberto para restante |
| **Compra de serviço** | Baixa | Pedido sem movimentação de estoque (serviço, consultoria) |
| **Importação (exterior)** | Baixa | DI, LI, despesas de importação, rateio |
| **Relatórios compras** | Alta | Volume por fornecedor, saving, evolução preços, lead time médio |

---

### ↩️ Módulo de Devolução

#### O que JÁ existe (implementado)

| Funcionalidade | Local | Status |
|----------------|-------|--------|
| Devolução de compra (parcial/total) | `POST /api/compras/:id/devolver` | ✅ |
| Estorno financeiro automático | Conta a pagar negativa | ✅ |
| Logística reversa (RA) | `/api/logistica-reversa/ra` | ✅ |
| Recebimento da devolução | `POST /ra/:id/receber` | ✅ |
| Inspeção de itens | `POST /ra/:id/inspecionar` | ✅ |
| Disposição (reestoque/descarte/reparo) | `POST /ra/:id/dispor` | ✅ |
| Motivos configuráveis | `GET/POST /motivos` | ✅ |
| NF-e de crédito (nota de crédito) | Via `logisticaReversaService` | ✅ |

#### O que FALTA

| Funcionalidade | Prioridade | Descrição |
|----------------|-----------|-----------|
| **Devolução de venda completa (fiscal)** | Alta | Emitir NF-e de entrada (finalidade=4) referenciando a NF-e de saída original |
| **Estorno financeiro de venda** | Alta | Cancelar/estornar contas a receber vinculadas, gerar crédito ao cliente |
| **Reentrada estoque automática** | Alta | Ao receber devolução de venda: incrementar estoque automaticamente |
| **Troca (devolução + nova venda)** | Média | Workflow de troca: recebe item devolvido e emite novo pedido com crédito |
| **Garantia** | Baixa | Controle de prazo de garantia por produto/lote vendido |
| **Dashboard devoluções** | Média | Taxa de devolução, motivos mais frequentes, custo operacional |

---

### 🔄 Módulo de Transferência

#### O que JÁ existe (implementado)

| Funcionalidade | Local | Status |
|----------------|-------|--------|
| Transferência de estoque entre empresas | `POST /api/compras/transferir` | ✅ |
| Validação de saldo disponível | Deduz reservado | ✅ |
| Upsert estoque destino | Cria se não existe | ✅ |
| Registro de transferência | `TransferenciaEstoque` + itens | ✅ |

#### O que FALTA

| Funcionalidade | Prioridade | Descrição |
|----------------|-----------|-----------|
| **NF-e de transferência** | Alta | Emissão de NF-e com CFOP 5152/6152 (transferência mercadoria) |
| **NF-e de remessa para industrialização** | Média | CFOP 5901/6901 (enviar para beneficiamento) |
| **NF-e de retorno de industrialização** | Média | CFOP 5902/6902 (receber de volta) |
| **Controle de filiais** | Média | Visão consolidada multi-empresa, saldo unificado |
| **Transferência entre depósitos** | Alta | Dentro da mesma empresa (sem NF-e), de CD para loja |
| **Transferência com romaneio** | Baixa | Documento de transporte vinculado à transferência |
| **Relatório de movimentação** | Média | Histórico de transferências, custos de movimentação |

---

## Módulo Fiscal (✅ Completo)

### Endpoints existentes em `/api/fiscal/`:
- Motor tributário (CRUD + simulação com fallback)
- NF-e (emissão, cancelamento, CC-e, inutilização, DANFE PDF)
- NFC-e (emissão modelo 65, contingência offline)
- CT-e (emissão modelo 57, cancelamento, CC-e, DACTE)
- MDF-e (emissão modelo 58, encerramento)
- NFS-e (adaptadores multi-prefeitura)
- SPED (geração + histórico)
- Apuração (ICMS, ICMS-ST, PIS/COFINS, IPI)
- Certificados digitais (upload A1, validação)
- Contingência (fila, retransmissão automática, status SEFAZ)
- GNRE (geração, pagamento)
- Importação XML (upload, de-para, gerar entrada)
- Manifesto destinatário
- Auditoria fiscal
- Dashboard métricas

---

## Módulo Financeiro (⚠️ Básico)

### O que JÁ existe

| Funcionalidade | Endpoint | Status |
|----------------|----------|--------|
| Contas a receber (CRUD + recebimento) | `/api/conta-receber` | ✅ |
| Contas a pagar (CRUD + pagamento) | `/api/conta-pagar` | ✅ |
| Geração automática de parcelas (vendas) | Na efetivação | ✅ |
| Geração automática de parcelas (compras) | Na efetivação | ✅ |
| Estorno por devolução de compra | Conta negativa | ✅ |

### O que FALTA para módulo completo

| Funcionalidade | Prioridade | Descrição |
|----------------|-----------|-----------|
| **CNAB 240/400** | Alta | Remessa/retorno bancário (Itaú, Bradesco, BB, Santander, Sicoob) |
| **Boleto registrado** | Alta | Geração PDF, registro bancário, baixa automática por retorno |
| **PIX API** | Alta | Cobrança por QRCode estático/dinâmico, webhook de confirmação |
| **DDA (Débito Direto Autorizado)** | Média | Receber títulos a pagar do banco automaticamente |
| **OFX / Extrato bancário** | Média | Importar extrato para conciliação |
| **Conciliação bancária** | Alta | Match automático extrato vs. contas, baixa em lote |
| **Fluxo de caixa** | Alta | Projeção por período, multi-conta, visão realizado vs. previsto |
| **Multi-conta bancária** | Alta | Cadastro de contas, saldo por conta, transferência entre contas |
| **Borderô** | Média | Agrupar títulos para envio ao banco em lote |
| **Rateio centro de custo** | Média | Dividir despesa entre centros de custo/projeto |
| **Cheques** | Baixa | Emissão, custódia, compensação, cheque devolvido |
| **Conciliação de cartões** | Média | Importar vendas de adquirentes, conferir taxas, antecipação |
| **Contratos recorrentes** | Média | Mensalidade, aluguel — gerar parcelas automaticamente |
| **Régua de cobrança** | Alta | Notificações automáticas: email/SMS antes e após vencimento |
| **Aging (análise de vencimento)** | Média | Relatório por faixa de atraso (30/60/90/120+ dias) |
| **Provisão** | Baixa | Reconhecer despesas futuras antes do pagamento efetivo |

---

## Próximos Passos Sugeridos (ordem de impacto)

| Ordem | Spec a Criar | Impacto |
|-------|-------------|---------|
| 1 | `erp-financeiro-completo` | Sem financeiro robusto, não sustenta operação real |
| 2 | `erp-vendas-completo` | PDV + orçamento + devolução de venda = operação comercial completa |
| 3 | `erp-compras-completo` | Cotação + MRP + aprovação = gestão de suprimentos profissional |
| 4 | `erp-devolucao-venda` | NF-e de devolução + estorno = compliance fiscal |
| 5 | `erp-transferencia-fiscal` | NF-e de transferência = operação multi-filial regularizada |

---

## Padrões de Desenvolvimento

1. Cada módulo vive em `src/modules/{modulo}/`
2. Rotas Fastify com prefixo `/api/{modulo}/`
3. Validação com Zod em todas as rotas
4. Middleware `moduloGuard` para controle de acesso por módulo
5. `ALL_MODULOS` em `empresa-selector.routes.ts` deve ser atualizado ao adicionar módulo novo
6. Prisma migrations para schema do banco
7. Testes com vitest
8. Integração fiscal via services (`vendaFiscalService`, `compraFiscalService`, `nfeEmissaoService`)
9. XML builders como funções puras (testáveis isoladamente)
10. Contingência automática (3 falhas → fila → retransmissão)

## Referências
- Spec fiscal: `.kiro/specs/erp-modulo-fiscal/` e `.kiro/specs/erp-fiscal-completar/`
- WMS specs: `.kiro/specs/wms-*`
- Logística reversa: `src/modules/logistica-reversa/`
- Financeiro básico: `src/modules/conta-pagar/` e `src/modules/conta-receber/`
