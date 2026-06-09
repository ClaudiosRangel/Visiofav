# Implementation Plan: WMS Fase 3 — Diferenciar

## Overview

Plano de implementação dos 4 módulos da Fase 3: Previsão de Demanda/Slotting Inteligente, Portal do Cliente 3PL, Business Intelligence Avançado, e Wave Planning Avançado.

## Tasks

## 1. Infraestrutura e Modelos de Dados

- [ ] 1.1 Criar migration com modelos PrevisaoDemanda, ClassificacaoAbc, SugestaoSlotting e ConfigPrevisao
- [ ] 1.2 Criar migration com modelos PortalUsuario, SolicitacaoExpedicaoPortal, ItemSolicitacaoExpedicaoPortal e NotificacaoPortal
- [ ] 1.3 Criar migration com modelos CustoOperacao, ConfigCusto, SnapshotBI e AlertaCorrelacao
- [ ] 1.4 Criar migration com modelos RegraOnda, PlanejamentoOnda e SimulacaoOnda
- [ ] 1.5 Atualizar schema.prisma com relações entre novos modelos e modelos existentes
- [ ] 1.6 Executar prisma generate e validar schema

## 2. Módulo Previsão de Demanda / Slotting — Backend

- [ ] 2.1 Criar schemas Zod (inteligencia.schemas.ts)
- [ ] 2.2 Implementar worker de previsão de demanda (cálculo diário média móvel + sazonal)
- [ ] 2.3 Implementar algoritmo de classificação ABC (3 critérios)
- [ ] 2.4 Implementar motor de sugestão de slotting (score por frequência + ergonomia + proximidade)
- [ ] 2.5 Implementar simulação what-if (preview de realocação sem aplicar)
- [ ] 2.6 Implementar aplicação de slotting (movimentação real de produtos)
- [ ] 2.7 Implementar CRUD de configuração de previsão
- [ ] 2.8 Implementar endpoint de produtos críticos (ruptura iminente)
- [ ] 2.9 Criar rotas Fastify para inteligência (previsão + abc + slotting + config + críticos)
- [ ] 2.10 Adicionar auditoria

## 3. Módulo Portal do Cliente 3PL — Backend

- [ ] 3.1 Criar schemas Zod (portal.schemas.ts)
- [ ] 3.2 Implementar autenticação do portal (login, JWT separado, middleware portalAuth)
- [ ] 3.3 Implementar CRUD de usuários do portal (vinculados a Cliente + Empresa)
- [ ] 3.4 Implementar consulta de estoque por cliente (saldo, lotes, validade)
- [ ] 3.5 Implementar consulta de faturas e medições do contrato
- [ ] 3.6 Implementar solicitação de expedição (cliente cria pedido de saída)
- [ ] 3.7 Implementar relatórios self-service (ocupação, movimentações, custo)
- [ ] 3.8 Implementar sistema de notificações (fatura gerada, expedição concluída, estoque mínimo)
- [ ] 3.9 Implementar worker de envio de emails (notificações pendentes)
- [ ] 3.10 Criar rotas Fastify para portal (/api/portal/*)
- [ ] 3.11 Adicionar auditoria

## 4. Módulo BI Avançado — Backend

- [ ] 4.1 Criar schemas Zod (bi.schemas.ts)
- [ ] 4.2 Implementar CRUD de configuração de custos (custo/hora operador, equipamento, m²)
- [ ] 4.3 Implementar worker de cálculo diário de custo por operação
- [ ] 4.4 Implementar worker de snapshots diários (throughput, acurácia, ocupação, produtividade)
- [ ] 4.5 Implementar dashboard executivo (agregação de KPIs)
- [ ] 4.6 Implementar análise de produtividade cruzada (correlação métricas)
- [ ] 4.7 Implementar alertas de correlação (produtividade ↓ E custo ↑)
- [ ] 4.8 Implementar API de dados para Power BI (endpoints otimizados, paginação cursor)
- [ ] 4.9 Criar rotas Fastify para BI (/api/bi/*)
- [ ] 4.10 Adicionar auditoria

## 5. Módulo Wave Planning — Backend

- [ ] 5.1 Criar schemas Zod (wave-planning.schemas.ts)
- [ ] 5.2 Implementar CRUD de regras de onda (configuráveis por empresa)
- [ ] 5.3 Implementar motor de planejamento automático (aplica regras em sequência)
- [ ] 5.4 Implementar simulação de onda (preview sem confirmar)
- [ ] 5.5 Implementar confirmação de planejamento (gera ondas reais)
- [ ] 5.6 Implementar re-planejamento dinâmico (detecta atrasos, redistribui)
- [ ] 5.7 Implementar worker de monitoramento de ondas (detecta atrasos)
- [ ] 5.8 Criar rotas Fastify para wave-planning (/api/wave-planning/*)
- [ ] 5.9 Adicionar auditoria

## 6. Frontend — Previsão de Demanda / Slotting

- [ ] 6.1 Criar dashboard de previsão (gráficos tendência, acurácia, produtos críticos)
- [ ] 6.2 Criar página de classificação ABC (tabela com filtros, gráfico Pareto)
- [ ] 6.3 Criar página de sugestões de slotting (lista priorizada, ações aplicar/rejeitar)
- [ ] 6.4 Criar página de simulação what-if (arrastar produtos, ver score)
- [ ] 6.5 Criar página de configuração de previsão
- [ ] 6.6 Criar página de histórico de realocações

## 7. Frontend — Portal do Cliente 3PL

- [ ] 7.1 Criar layout e autenticação do portal (login separado, tema customizado)
- [ ] 7.2 Criar dashboard do portal (resumo estoque, faturas, movimentações)
- [ ] 7.3 Criar página de consulta de estoque (tabela com filtros, export)
- [ ] 7.4 Criar página de faturas (lista, detalhes, status)
- [ ] 7.5 Criar formulário de solicitação de expedição
- [ ] 7.6 Criar página de relatórios self-service
- [ ] 7.7 Criar página de notificações (inbox com marcar como lida)
- [ ] 7.8 Criar gestão de usuários do portal (admin da empresa cadastra clientes)

## 8. Frontend — BI Avançado

- [ ] 8.1 Criar dashboard executivo (cards KPI + gráficos de tendência)
- [ ] 8.2 Criar página de custo por operação (breakdown por tipo, por dia, por funcionário)
- [ ] 8.3 Criar página de análise cruzada (scatter plots, correlações)
- [ ] 8.4 Criar página de alertas inteligentes (correlação, histórico)
- [ ] 8.5 Criar página de configuração de custos
- [ ] 8.6 Criar página de exportação Power BI (documentação de endpoints + tester)

## 9. Frontend — Wave Planning

- [ ] 9.1 Criar dashboard de wave planning com timeline visual (Gantt)
- [ ] 9.2 Criar página de regras de onda (CRUD configurável)
- [ ] 9.3 Criar página de simulação de onda (preview por doca/zona)
- [ ] 9.4 Criar página de confirmação/liberação de ondas
- [ ] 9.5 Criar página de monitoramento em tempo real (progresso ondas ativas)

## 10. Testes

- [ ] 10.1 Testes unitários para algoritmo de previsão de demanda
- [ ] 10.2 Testes unitários para classificação ABC
- [ ] 10.3 Testes unitários para motor de slotting (score calculation)
- [ ] 10.4 Testes unitários para cálculo de custo por operação
- [ ] 10.5 Testes de integração para fluxo portal 3PL (login → solicitação → expedição)
- [ ] 10.6 Testes de integração para wave planning (regras → simulação → confirmação)

## 11. Integração e Documentação

- [ ] 11.1 Registrar rotas dos 4 módulos no server.ts
- [ ] 11.2 Documentar APIs (JSDoc)
- [ ] 11.3 Criar seed de dados demo (previsões, classificações, custos, regras onda)
- [ ] 11.4 Criar documentação de integração Power BI


## Task Dependency Graph

```json
{
  "waves": [
    {
      "description": "Infraestrutura",
      "tasks": ["1.1", "1.2", "1.3", "1.4"]
    },
    {
      "description": "Schema relações",
      "dependsOn": [0],
      "tasks": ["1.5", "1.6"]
    },
    {
      "description": "Backend — Todos os módulos em paralelo",
      "dependsOn": [1],
      "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "2.8", "2.9", "2.10", "3.1", "3.2", "3.3", "3.4", "3.5", "3.6", "3.7", "3.8", "3.9", "3.10", "3.11", "4.1", "4.2", "4.3", "4.4", "4.5", "4.6", "4.7", "4.8", "4.9", "4.10", "5.1", "5.2", "5.3", "5.4", "5.5", "5.6", "5.7", "5.8", "5.9"]
    },
    {
      "description": "Frontend — Todos os módulos em paralelo",
      "dependsOn": [2],
      "tasks": ["6.1", "6.2", "6.3", "6.4", "6.5", "6.6", "7.1", "7.2", "7.3", "7.4", "7.5", "7.6", "7.7", "7.8", "8.1", "8.2", "8.3", "8.4", "8.5", "8.6", "9.1", "9.2", "9.3", "9.4", "9.5"]
    },
    {
      "description": "Testes",
      "dependsOn": [2],
      "tasks": ["10.1", "10.2", "10.3", "10.4", "10.5", "10.6"]
    },
    {
      "description": "Integração e Documentação",
      "dependsOn": [2, 3],
      "tasks": ["11.1", "11.2", "11.3", "11.4"]
    }
  ]
}
```

## Notes

- Mesmos padrões Fase 1/2: Prisma $transaction, Zod schemas, auditoria, authenticate + moduloGuard
- Portal 3PL usa autenticação separada (portalAuth middleware), não compartilha JWT com sistema interno
- Workers de IA executam diariamente (previsão, ABC, custo, snapshots)
- Wave Planning integra com OndaSeparacao existente
- Frontend BI pode usar gráficos simples (recharts ou mantine-charts) sem dependência pesada
