# Requirements: WMS Fase 3 — Diferenciar

## Módulo 1: Previsão de Demanda e Slotting Inteligente

- REQ-1: Sistema de previsão de demanda baseado em histórico de vendas/expedição dos últimos 90 dias, com cálculo de média móvel e ajuste sazonal
- REQ-2: Algoritmo de classificação ABC automática por 3 critérios: frequência de picking, valor monetário, volume expedido
- REQ-3: Motor de sugestão de realocação (slotting) que considera: frequência picking, peso/ergonomia, compatibilidade de produtos, proximidade da doca
- REQ-4: Simulação de cenários what-if para reorganização de layout antes de aplicar
- REQ-5: Dashboard de previsão com gráficos de tendência, acurácia do modelo, e produtos críticos (ruptura iminente)
- REQ-6: Execução automática diária do algoritmo de previsão via worker

## Módulo 2: Portal do Cliente 3PL

- REQ-7: Sistema de autenticação separado para clientes externos (portal público com JWT independente, sem acesso ao sistema interno)
- REQ-8: Visualização de estoque em tempo real por cliente (saldo por produto, lotes, validade, endereço)
- REQ-9: Consulta de faturas e medições do contrato de armazenagem (histórico e pendentes)
- REQ-10: Solicitação de expedição online (cliente cria pedido de saída com produtos e quantidades)
- REQ-11: Relatórios self-service (ocupação mensal, movimentações, custo acumulado)
- REQ-12: Notificações por email para eventos: fatura gerada, expedição concluída, estoque abaixo do mínimo
- REQ-13: Dashboard do cliente com resumo: estoque total, faturas pendentes, últimas movimentações

## Módulo 3: Business Intelligence Avançado

- REQ-14: Dashboard executivo com KPIs agregados: custo por operação, throughput (itens/hora), acurácia de estoque, taxa de ocupação
- REQ-15: Cálculo automático de custo por operação: mão-de-obra (tempo LMS × custo/hora) + equipamento (uso × depreciação) + espaço (m² × valor/m²)
- REQ-16: Análise de produtividade cruzada: correlação LMS × KPI × Custos × Ocupação
- REQ-17: API de dados para integração com Power BI / Tableau (endpoints de consulta otimizados para datasets grandes)
- REQ-18: Alertas inteligentes com correlação de métricas (ex: produtividade caiu E custo subiu → alerta composto)
- REQ-19: Snapshots diários de todos os KPIs para análise histórica e tendência

## Módulo 4: Wave Planning Avançado

- REQ-20: Planejamento automático de ondas baseado em regras configuráveis: corte horário, agrupamento por rota, prioridade, capacidade de doca
- REQ-21: Simulação de onda com preview de carga por doca e zona antes de liberar para separação
- REQ-22: Re-planejamento dinâmico: detecta atrasos (OS com tempo > meta × 2) e redistribui automaticamente
- REQ-23: Dashboard de planejamento com timeline visual (Gantt) mostrando ondas × docas × horários
- REQ-24: Regras de onda configuráveis por empresa (horários de corte, limites por rota, prioridade por cliente)
