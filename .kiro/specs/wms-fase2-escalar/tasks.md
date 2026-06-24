# Implementation Plan: WMS Fase 2 — Escalar

## Overview

Plano de implementação dos 5 módulos da Fase 2 do WMS: Faturamento de Armazenagem, Picking por Zona/Cluster, Labor Management System (LMS), Yard Management (Gestão de Pátio) e Multi-CD com Transferências. Estrutura: infraestrutura (migrations) → backend módulos → frontend páginas → testes → documentação.

## Tasks

## 1. Infraestrutura e Modelos de Dados

- [x] 1.1 Criar migration Prisma com modelos ContratoArmazenagem, TarifaContrato, MedicaoOcupacao, MovimentacaoFaturavel, FaturaArmazenagem e ItemFatura
- [x] 1.2 Criar migration Prisma com modelos ZonaPicking, EnderecoZonaPicking, SeparadorZona, PontoConsolidacao, SubOnda e ItemSubOnda
- [x] 1.3 Criar migration Prisma com modelos MetaOperacao, HistoricoMetaOperacao, RegistroProdutividade, ConfigIncentivo e PausaOperador
- [x] 1.4 Criar migration Prisma com modelos VeiculoPatio, FilaEsperaPatio, ChamadaDoca e ConfigPatio
- [x] 1.5 Criar migration Prisma com modelos SolicitacaoTransferencia, ItemSolicitacaoTransferencia, DocumentoSaidaTransferencia e MercadoriaTransito
- [x] 1.6 Atualizar schema.prisma com relações entre novos modelos e modelos existentes (Empresa, Produto, CentroDistribuicao, Estoque, Doca, etc.)

## 2. Módulo Faturamento de Armazenagem — Backend

- [x] 2.1 Criar schemas Zod de validação para faturamento (faturamento.schemas.ts)
- [x] 2.2 Implementar service de CRUD de contratos (criação com validação de vigência sobreposta, encerramento com fatura proporcional)
- [x] 2.3 Implementar worker de medição automática diária de ocupação (pallets, m³, posições por cliente/contrato)
- [x] 2.4 Implementar registro automático de movimentações faturáveis (hooks nos services de recebimento/expedição/separação)
- [x] 2.5 Implementar service de cálculo e geração de faturas (somatório por tarifa, aplicação de fórmulas, geração de itens)
- [x] 2.6 Implementar CRUD de faturas (ajustes manuais, envio, pagamento, cancelamento com justificativa)
- [ ] 2.7 Implementar relatório consolidado de faturamento por período com exportação CSV
- [ ] 2.8 Implementar reprocessamento de medição para datas faltantes
- [ ] 2.9 Criar rotas Fastify para faturamento (contratos CRUD + medições + faturas CRUD + relatórios + exportar)
- [x] 2.10 Adicionar registros de auditoria para todas as operações de faturamento

## 3. Módulo Picking por Zona/Cluster — Backend

- [ ] 3.1 Criar schemas Zod de validação para picking por zona (picking-zona.schemas.ts)
- [ ] 3.2 Implementar CRUD de zonas de picking (criação, atribuição de endereços com validação de unicidade)
- [ ] 3.3 Implementar atribuição de separadores a zonas (principal e secundária)
- [ ] 3.4 Implementar CRUD de pontos de consolidação
- [ ] 3.5 Implementar service de divisão automática de onda em sub-ondas por zona (agrupamento de itens por endereço → zona)
- [ ] 3.6 Implementar balanceamento de sub-ondas entre separadores da mesma zona (round-robin por carga)
- [ ] 3.7 Implementar lógica de consolidação (gerar OS tipo CONSOLIDACAO quando todas sub-ondas concluídas)
- [ ] 3.8 Implementar hook no service de separação para filtrar itens por zona do separador logado
- [ ] 3.9 Implementar painel de acompanhamento (progresso por zona, percentual concluído, tempo estimado)
- [ ] 3.10 Criar rotas Fastify para picking-zona (zonas CRUD + endereços + separadores + pontos + sub-ondas + dividir + painel)
- [x] 3.11 Adicionar registros de auditoria para operações de picking por zona

## 4. Módulo Labor Management System (LMS) — Backend

- [ ] 4.1 Criar schemas Zod de validação para LMS (lms.schemas.ts)
- [ ] 4.2 Implementar CRUD de metas por operação com histórico de alterações
- [ ] 4.3 Implementar medição automática de produtividade (hook em OS: timestamp início/conclusão, cálculo tempo real)
- [x] 4.4 Implementar cálculo de meta por tarefa (tempoMeta × quantidade × categoria produto)
- [x] 4.5 Implementar desconto de pausas registradas do tempo real de execução
- [x] 4.6 Implementar cálculo de índice de produtividade e classificação por faixa (ACIMA_META, NA_META, ABAIXO_META)
- [x] 4.7 Implementar worker de alerta para tarefas com tempo > 3x meta
- [x] 4.8 Implementar ranking de funcionários por período (dia, semana, mês)
- [x] 4.9 Implementar relatório individual por funcionário (tarefas, tempo médio, evolução, comparativo)
- [x] 4.10 Implementar relatório por tipo de operação (tempo médio, distribuição, gargalos)
- [ ] 4.11 Implementar configuração e aplicação de incentivos/penalidades por faixa
- [ ] 4.12 Implementar registro de pausas (iniciar/encerrar)
- [ ] 4.13 Implementar exportação de relatórios em CSV
- [ ] 4.14 Criar rotas Fastify para LMS (metas CRUD + produtividade + ranking + relatórios + incentivos + pausas + exportar)
- [x] 4.15 Adicionar registros de auditoria para operações de LMS

## 5. Módulo Yard Management (Gestão de Pátio) — Backend

- [ ] 5.1 Criar schemas Zod de validação para pátio (patio.schemas.ts)
- [ ] 5.2 Implementar registro de entrada de veículos (validação placa antigo/Mercosul, verificação duplicata, inserção em fila)
- [ ] 5.3 Implementar registro de saída de veículos (cálculo tempo permanência)
- [ ] 5.4 Implementar fila de espera com prioridade (ordenação, ajuste manual com justificativa)
- [ ] 5.5 Implementar sugestão de próximo veículo por doca (compatibilidade tipo operação + prioridade)
- [ ] 5.6 Implementar chamada à doca (emissão, atendimento, cancelamento com retorno à fila)
- [x] 5.7 Implementar worker de alerta de permanência excessiva (veículos além do limite configurado)
- [x] 5.8 Implementar relatórios de pátio (permanência, fila de espera, ocupação) com filtros e exportação CSV
- [x] 5.9 Implementar configuração de pátio (limites, prioridades por tipo)
- [ ] 5.10 Criar rotas Fastify para pátio (veículos + fila + chamada + sugestão + config + relatórios + exportar)
- [ ] 5.11 Integrar notificação SSE para chamada à doca (painel pátio + app motorista)
- [x] 5.12 Adicionar registros de auditoria para operações de pátio

## 6. Módulo Multi-CD com Transferências — Backend

- [ ] 6.1 Criar schemas Zod de validação para multi-cd (multi-cd.schemas.ts)
- [ ] 6.2 Implementar service de criação de solicitação de transferência (validação CDs mesma empresa, saldo disponível, geração número TRF)
- [ ] 6.3 Implementar aprovação de solicitação (registro aprovador + data)
- [ ] 6.4 Implementar expedição em transação (gerar doc saída + baixa estoque origem + criar MercadoriaTransito + atualizar status)
- [ ] 6.5 Implementar recebimento no CD destino em transação (conferência + crédito saldo destino + baixa trânsito + registro divergências)
- [ ] 6.6 Implementar cancelamento de solicitação com validação de status
- [ ] 6.7 Implementar worker de alerta de trânsito > 48h
- [ ] 6.8 Implementar painel consolidado de transferências (filtros, totalizadores, timeline por solicitação)
- [ ] 6.9 Implementar exportação de dados de transferências em CSV
- [ ] 6.10 Criar rotas Fastify para multi-cd (solicitações CRUD + aprovar + expedir + receber + trânsito + painel + exportar)
- [x] 6.11 Adicionar registros de auditoria para operações de transferência

## 7. Frontend — Faturamento de Armazenagem

- [ ] 7.1 Criar página de listagem de contratos com filtros (status, cliente, vigência)
- [ ] 7.2 Criar formulário de criação/edição de contrato com configuração de tarifas
- [ ] 7.3 Criar página de detalhes do contrato (tarifas, medições, faturas vinculadas)
- [ ] 7.4 Criar página de listagem de faturas com filtros (status, cliente, período)
- [ ] 7.5 Criar página de detalhes da fatura (itens, valores por tarifa, ações de enviar/pagar/cancelar)
- [ ] 7.6 Criar página de relatórios de faturamento com gráficos e exportação CSV
- [ ] 7.7 Criar dashboard de faturamento com totalizadores (faturado, a receber, inadimplente)

## 8. Frontend — Picking por Zona/Cluster

- [ ] 8.1 Criar página de configuração de zonas (listagem, criação, mapa visual de endereços por zona com cores)
- [ ] 8.2 Criar página de atribuição de separadores a zonas (drag-and-drop ou formulário)
- [ ] 8.3 Criar página de pontos de consolidação (CRUD)
- [ ] 8.4 Criar painel de acompanhamento de sub-ondas por zona (progresso, percentual, tempo estimado)
- [ ] 8.5 Criar tela de divisão manual de onda (botão de dividir + preview por zona)
- [ ] 8.6 Adaptar tela mobile de separação para exibir apenas itens da zona do separador logado

## 9. Frontend — Labor Management System (LMS)

- [ ] 9.1 Criar dashboard de produtividade com indicadores gerais (média, top performers, alertas)
- [ ] 9.2 Criar página de configuração de metas por operação (formulário CRUD)
- [ ] 9.3 Criar página de ranking de funcionários com filtros por período e operação
- [ ] 9.4 Criar página de relatório individual do funcionário (gráficos de evolução, comparativo)
- [ ] 9.5 Criar página de relatório por tipo de operação (histograma, gargalos)
- [ ] 9.6 Criar página de configuração de incentivos/penalidades
- [ ] 9.7 Implementar botão de registro de pausa no app mobile do operador
- [ ] 9.8 Implementar exportação CSV nos relatórios

## 10. Frontend — Yard Management (Gestão de Pátio)

- [ ] 10.1 Criar painel de pátio em tempo real (veículos presentes, status, tempo permanência com atualização automática)
- [ ] 10.2 Criar tela de registro de entrada de veículos (formulário com validação de placa)
- [ ] 10.3 Criar tela de fila de espera (ordenada por prioridade, com drag-and-drop para reordenar)
- [ ] 10.4 Criar tela de chamada à doca (seleção de doca + sugestão automática + botão chamar)
- [ ] 10.5 Criar tela de configurações do pátio (limites, prioridades)
- [ ] 10.6 Criar tela de relatórios de pátio (permanência, fila, ocupação) com gráficos e exportação
- [ ] 10.7 Implementar notificação visual/sonora de chamada à doca via SSE
- [ ] 10.8 Implementar tela de portaria no app mobile (registro rápido de entrada/saída)

## 11. Frontend — Multi-CD com Transferências

- [ ] 11.1 Criar painel de transferências com listagem e filtros (status, CD, período, prioridade)
- [ ] 11.2 Criar formulário de criação de solicitação de transferência (seleção CD origem/destino, itens, quantidades)
- [ ] 11.3 Criar página de detalhes da solicitação com timeline completa (etapas, datas, responsáveis)
- [ ] 11.4 Criar tela de "Estoque em Trânsito" (listagem com totalizadores e alertas)
- [ ] 11.5 Criar tela de recebimento de transferência no CD destino (conferência quantitativa)
- [ ] 11.6 Implementar exportação CSV no painel de transferências
- [ ] 11.7 Criar tela de aprovação de solicitações pendentes

## 12. Testes e Qualidade

- [ ] 12.1 Escrever testes unitários para cálculo de faturamento (fórmulas por tarifa, carência, proporcional)
- [ ] 12.2 Escrever testes unitários para divisão de onda por zona (agrupamento correto, balanceamento)
- [ ] 12.3 Escrever testes unitários para cálculo de produtividade LMS (índice, faixa, desconto pausa)
- [ ] 12.4 Escrever testes unitários para validação de placa (antigo e Mercosul) e lógica de fila
- [ ] 12.5 Escrever testes unitários para validação de saldo em transferências (disponível vs reservado)
- [ ] 12.6 Escrever testes de integração para fluxo completo de faturamento (contrato → medição → fatura)
- [ ] 12.7 Escrever testes de integração para fluxo completo de transferência (solicitação → expedição → recebimento)
- [ ] 12.8 Escrever testes de integração para fluxo de picking por zona (onda → divisão → sub-ondas → consolidação)

## 13. Registros e Documentação

- [ ] 13.1 Registrar rotas dos 5 módulos no server.ts com authenticate + moduloGuard
- [ ] 13.2 Documentar APIs dos módulos (comentários JSDoc nas rotas)
- [ ] 13.3 Criar seed de dados de exemplo para demonstração (contrato com tarifas, zonas de picking, metas operação, config pátio)


## Task Dependency Graph

```json
{
  "waves": [
    {
      "description": "Infraestrutura e Modelos de Dados",
      "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5"]
    },
    {
      "description": "Atualização de relações no schema",
      "dependsOn": [0],
      "tasks": ["1.6"]
    },
    {
      "description": "Backend - Todos os módulos (em paralelo)",
      "dependsOn": [1],
      "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "2.8", "2.9", "2.10", "3.1", "3.2", "3.3", "3.4", "3.5", "3.6", "3.7", "3.8", "3.9", "3.10", "3.11", "4.1", "4.2", "4.3", "4.4", "4.5", "4.6", "4.7", "4.8", "4.9", "4.10", "4.11", "4.12", "4.13", "4.14", "4.15", "5.1", "5.2", "5.3", "5.4", "5.5", "5.6", "5.7", "5.8", "5.9", "5.10", "5.11", "5.12", "6.1", "6.2", "6.3", "6.4", "6.5", "6.6", "6.7", "6.8", "6.9", "6.10", "6.11"]
    },
    {
      "description": "Frontend - Todos os módulos (em paralelo)",
      "dependsOn": [2],
      "tasks": ["7.1", "7.2", "7.3", "7.4", "7.5", "7.6", "7.7", "8.1", "8.2", "8.3", "8.4", "8.5", "8.6", "9.1", "9.2", "9.3", "9.4", "9.5", "9.6", "9.7", "9.8", "10.1", "10.2", "10.3", "10.4", "10.5", "10.6", "10.7", "10.8", "11.1", "11.2", "11.3", "11.4", "11.5", "11.6", "11.7"]
    },
    {
      "description": "Testes e Qualidade",
      "dependsOn": [2],
      "tasks": ["12.1", "12.2", "12.3", "12.4", "12.5", "12.6", "12.7", "12.8"]
    },
    {
      "description": "Registros e Documentação",
      "dependsOn": [2, 3],
      "tasks": ["13.1", "13.2", "13.3"]
    }
  ]
}
```

## Notes

- Seguir exatamente os padrões da Fase 1: services com `prisma.$transaction()`, schemas Zod, auditoria via `logMovimentoWms`, rotas com `authenticate` + `moduloGuard`
- Workers (medição, alertas) implementados como setInterval no processo Fastify principal
- Frontend usa TanStack Query para data fetching e Mantine v7 para UI
- Multi-tenancy garantido pelo middleware `tenant-context` que extrai `empresaId` do JWT
- Todos os endpoints novos devem incluir validação Zod retornando HTTP 422 para dados inválidos
