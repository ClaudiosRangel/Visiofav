# VisioFab WMS — Mapa Completo do Sistema

**Data:** Junho/2026  
**Versão:** 2.0 (Fase 1 + Fase 2 concluídas)  
**Tecnologia:** Backend Fastify/Node.js + Prisma/PostgreSQL | Frontend Next.js 15 + Mantine v7 | Mobile React Native (Expo)  
**Infraestrutura:** Render (backend) + Vercel (frontend) + Neon PostgreSQL (banco)

---

## 1. MÓDULOS PRONTOS E EM PRODUÇÃO

### 1.1 Core WMS — Operações Base (Pré-Fase 1)

| Funcionalidade | Status | Descrição |
|---|---|---|
| Multi-empresa / Multi-tenant | ✅ Pronto | Isolamento total por empresa, JWT com empresaId |
| Cadastro de Depósitos e Zonas | ✅ Pronto | Hierarquia: CD → Depósito → Zona → Endereços |
| Formatos de Endereço configuráveis | ✅ Pronto | Templates dinâmicos (rua-prédio-nível-apto) |
| Estruturas de Armazenagem | ✅ Pronto | Porta-palete, blocado, drive-in, flow-rack com capacidades |
| Cadastro de Endereços WMS | ✅ Pronto | Tipos: armazenagem, picking, doca, livre, bloqueado |
| Docas de Carga/Descarga | ✅ Pronto | Entrada, saída, mista — vinculadas a CD/depósito |
| Funcionários e Equipamentos | ✅ Pronto | Operadores, empilhadeiras, coletores |
| SKU e Dados Logísticos | ✅ Pronto | Multi-SKU por produto, dimensões, peso, embalagem |
| Dados Logísticos de Armazenagem | ✅ Pronto | Norma (FEFO/FIFO/LIFO), pulmão, nível min/max |
| Dados Logísticos de Picking | ✅ Pronto | Capacidade, ponto reposição, tipo picking |
| Dados Logísticos de Expedição | ✅ Pronto | Fracionado, absorção palete fechado |
| Agendamento de Recebimento | ✅ Pronto | Agenda com docas, horários, motorista, placa |
| Recebimento / Nota de Entrada | ✅ Pronto | Importação XML NF-e, conferência quantitativa |
| Conferência de Entrada | ✅ Pronto | Item a item, divergências, aprovação/rejeição |
| Endereçamento | ✅ Pronto | Sugestão automática por norma, execução por OS |
| Ordens de Serviço (OS) | ✅ Pronto | CONFERENCIA, ENDERECAMENTO, SEPARACAO, REPOSICAO, INVENTARIO |
| Saldo por Endereço | ✅ Pronto | Controle granular com lote e validade |
| Ondas de Separação | ✅ Pronto | Agrupamento de pedidos, prioridade, doca |
| Separação / Picking | ✅ Pronto | Por onda, por pedido, com divergência |
| Conferência de Saída | ✅ Pronto | Validação item a item pós-separação |
| Embalagem (Packing) | ✅ Pronto | Volumes (caixa, palete, fardo), dimensões, peso |
| Carregamento | ✅ Pronto | Sequência de volumes, doca, motorista, conferência |
| Montagem de Carga | ✅ Pronto | Mapas de carregamento, NFs vinculadas, roteirização |
| Inventário | ✅ Pronto | Geral, parcial, cíclico — contagem e ajuste |
| Log de Movimentações | ✅ Pronto | Auditoria completa de toda movimentação de estoque |
| Fichas Operacionais | ✅ Pronto | Geração, impressão, OCR, confirmação |
| Pendências Logísticas | ✅ Pronto | SKU/dados ausentes → bloqueia até resolução |
| Roteirização e Geolocalização | ✅ Pronto | Geocodificação, otimização de rotas, sequência entregas |

### 1.2 Fase 1 — Profissionalização (Concluída Mai/2026)

| Módulo | Status | Funcionalidades |
|---|---|---|
| **Cross-Docking** | ✅ Pronto | Identificação automática, roteamento staging, priorização, dedução |
| **Logística Reversa** | ✅ Pronto | RA (autorização retorno), recebimento, inspeção, disposição, crédito |
| **KPI / SLA com Alertas** | ✅ Pronto | Regras configuráveis, worker 60s, SSE tempo real, dashboard |
| **Dock Scheduling** | ✅ Pronto | Timeline visual, conflito, bloqueio slots, chegada, estatísticas |
| **Etiquetas ZPL** | ✅ Pronto | Templates versionados, impressão TCP, fila com retry, multi-impressora |

### 1.3 Fase 2 — Escalar (Concluída Jun/2026)

| Módulo | Status | Funcionalidades |
|---|---|---|
| **Faturamento de Armazenagem** | ✅ Pronto | Contratos, tarifas (6 tipos), medição automática diária, geração de faturas, CRUD faturas, relatório consolidado, exportação CSV |
| **Picking por Zona/Cluster** | ✅ Pronto | Zonas com cores, endereços vinculados, separadores principal/secundária, divisão automática de onda por zona, balanceamento round-robin, consolidação, painel progresso, mobile separador |
| **LMS (Labor Management)** | ✅ Pronto | Metas por operação/categoria, medição automática (hook em OS), cálculo produtividade com desconto pausas, índice/faixa, ranking dia/semana/mês, relatório individual, relatório operação, incentivos, pausas, CSV, worker alerta 3x meta |
| **Yard Management (Pátio)** | ✅ Pronto | Entrada com validação placa (antigo + Mercosul), fila com prioridade, chamada à doca com SSE, sugestão automática por compatibilidade, saída com cálculo permanência, worker alerta excesso, relatórios (permanência/fila/ocupação), config por CD, portaria mobile |
| **Multi-CD / Transferências** | ✅ Pronto | Solicitação com validação saldo, aprovação, expedição em transação (baixa origem + trânsito), recebimento com divergências (crédito destino), cancelamento, painel consolidado, timeline completa, worker alerta >48h, exportação CSV |

---

## 2. MÓDULOS COMPLEMENTARES EXISTENTES

| Módulo | Status | Descrição |
|---|---|---|
| **Compras** | ✅ Pronto | Pedidos, efetivação, XML NF-e, contas a pagar |
| **Vendas** | ✅ Pronto | Pedidos, efetivação, NF-e, contas a receber, comissão |
| **Fiscal (NF-e / CT-e)** | ✅ Pronto | Emissão, transmissão SEFAZ, cancelamento |
| **Financeiro** | ✅ Pronto | Contas a pagar/receber, parcelas |
| **Integração Externa** | ✅ Pronto | API Keys, webhooks, logs de integração |
| **PCP (Produção)** | ✅ Pronto | Estrutura produto, roteiros, OPs, apontamentos, liberação material, variações, programação entrega |
| **De-Para Fornecedor** | ✅ Pronto | Mapeamento código fornecedor → produto interno com fator conversão |

---

## 3. NÚMEROS DO SISTEMA ATUAL

| Métrica | Valor |
|---|---|
| Total de endpoints API | 130+ |
| Tabelas no banco | 85+ |
| Workers de background | 7 (KPI, etiquetas, faturamento medição, LMS alerta, pátio permanência, multi-CD trânsito, faturamento) |
| Páginas frontend WMS | 60+ |
| Módulos WMS | 12 (core + 5 fase 1 + 5 fase 2 + complementares) |
| Eventos SSE tempo real | KPI alertas, chamada doca |

---

## 4. FASE 3 — DIFERENCIAR (Planejado)

### 4.1 Inteligência Artificial e Machine Learning

| Funcionalidade | Descrição | Impacto |
|---|---|---|
| Previsão de Demanda | Algoritmo baseado em histórico de vendas/sazonalidade para prever necessidade de estoque | Reduz ruptura e excesso |
| Slotting Inteligente | IA sugere realocação de produtos por curva ABC + frequência de picking | Reduz tempo de separação em 20-30% |
| Otimização de Layout | Análise de fluxo para sugerir reorganização de zonas/endereços | Reduz deslocamento |
| Detecção de Anomalias | ML identifica padrões anômalos em movimentações (furto, erro operacional) | Segurança e acurácia |

### 4.2 IoT e Automação

| Funcionalidade | Descrição | Impacto |
|---|---|---|
| Sensores de Temperatura | Monitoramento câmaras frias com alerta automático | Compliance cadeia frio |
| RFID / Leitura Automática | Identificação de paletes/volumes sem scan manual | Velocidade +40% |
| Balanças Integradas | Conferência por peso automática em doca/embalagem | Reduz erro conferência |
| AGV Integration | Interface para veículos guiados autônomos | Automação movimentação |

### 4.3 Portal do Cliente (3PL)

| Funcionalidade | Descrição | Impacto |
|---|---|---|
| Visão de Estoque | Cliente 3PL consulta saldo em tempo real | Autonomia cliente |
| Faturas e Medições | Visualiza faturas, medições, histórico | Transparência |
| Solicitações | Solicita expedição, devolução, transferência online | Agilidade |
| Relatórios Self-Service | Gera relatórios sem depender do operador | Reduz suporte |

### 4.4 App Mobile Nativo (Evolução)

| Funcionalidade | Descrição | Impacto |
|---|---|---|
| Offline-First | Operações continuam sem internet, sincroniza depois | Zero parada |
| Push Notifications | Alertas de OS, chamada doca, alerta KPI no celular | Reação imediata |
| Câmera para OCR | Leitura de NF via câmera, conferência por foto | Elimina papel |
| Voice Picking | Separação por comandos de voz | Mãos livres |

### 4.5 Business Intelligence Avançado

| Funcionalidade | Descrição | Impacto |
|---|---|---|
| Dashboards Customizáveis | Drag-and-drop de widgets, salva favoritos | Visão gerencial |
| Drill-Down Multi-nível | Do KPI geral até a OS individual em 3 cliques | Análise rápida |
| Exportação Power BI | Conector para Power BI / Tableau | Integração BI corporativo |
| Custo por Operação | Cálculo automático de custo (mão-de-obra + equipamento + espaço) | Margem real |

---

## 5. ROADMAP TEMPORAL

```
           2026                                    2027
    Mai    Jun    Jul    Ago    Set    Out    Nov    Dez    Jan    Fev
    ├──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
    │ F1 ✅│ F2 ✅│◄─── Fase 3A (IA + Portal) ───►│      │      │
    │      │      │      │      │◄── Fase 3B (IoT + Mobile) ──►│  │
    │      │      │      │      │      │      │◄── Fase 3C (BI) ──►│
```

**Fase 3A (Jul–Set 2026):** IA/ML + Portal Cliente 3PL  
**Fase 3B (Set–Nov 2026):** IoT + App Mobile Nativo offline-first  
**Fase 3C (Nov 2026–Fev 2027):** BI avançado + Custo por operação

---

## 6. DIFERENCIAIS COMPETITIVOS

| vs Concorrente | VisioFab WMS |
|---|---|
| TOTVS Logística | Multi-empresa nativo, SaaS, custo 80% menor, deploy em horas |
| Sênior WMS | LMS integrado, IA planejada, interface moderna (não é tela texto) |
| Manhattan WMS | Escala para PME, sem hardware proprietário, API-first |
| SAP EWM | Implementação em semanas (não meses), custo acessível |

**Segmentos atendidos:** Atacado, varejo, 3PL, indústria (gráfica, alimentos, farmacêutica)  
**Modelo:** SaaS multi-tenant com cobrança por módulo/operação

---

## 7. ARQUITETURA TÉCNICA

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND                              │
│  Next.js 15 (App Router) + Mantine v7 + TanStack Query      │
│  Vercel (auto-deploy) | PWA ready                           │
├─────────────────────────────────────────────────────────────┤
│                        BACKEND                               │
│  Fastify + Prisma ORM + Zod validation                       │
│  JWT Auth + Multi-tenant middleware                          │
│  Workers (setInterval) + SSE (Server-Sent Events)           │
│  Render (auto-deploy) | Auto-scaling                        │
├─────────────────────────────────────────────────────────────┤
│                       DATABASE                               │
│  PostgreSQL (Neon) | 85+ tabelas | Pooled connections       │
├─────────────────────────────────────────────────────────────┤
│                        MOBILE                                │
│  React Native (Expo) | Compartilha lógica com web           │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. CONTATOS E ACESSOS

| Item | Valor |
|---|---|
| Backend Produção | https://visiofav.onrender.com |
| Frontend Produção | Vercel (auto-deploy do GitHub) |
| Repositório Backend | github.com/ClaudiosRangel/Visiofav |
| Repositório Frontend | github.com/ClaudiosRangel/Visiofav-Front- |
| Banco Produção | Neon PostgreSQL (us-east-1) |

---

*Documento gerado em Junho/2026 — VisioFab WMS v2.0*
