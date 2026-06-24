# Implementation Plan: Integração Agenda/Portaria ↔ Pátio/Doca

## Overview

Plano de implementação para unificar os módulos Agenda/Portaria e Pátio/Doca em um ciclo de vida completo do veículo no WMS inbound. A implementação segue ordem incremental: migração de dados, serviços de fila e prioridade, refatoração do check-in portaria, fluxo de chamada de doca com SSE, sincronização de status AgendaWms, liberação e KPIs, e por fim o endpoint unificado do painel operacional.

## Tasks

- [x] 1. Migração Prisma e modelos de dados
  - [x] 1.1 Adicionar FK agendamentoId no modelo VeiculoPatio
    - Adicionar campo `agendamentoId String? @map("agendamento_id")` no model VeiculoPatio
    - Adicionar relação `agendamento AgendaWms? @relation(fields: [agendamentoId], references: [id], onDelete: SetNull)`
    - Adicionar valor CHAMADO ao enum/campo status de VeiculoPatio (AGUARDANDO | CHAMADO | NA_DOCA | CONFERINDO | CONFERIDO | LIBERADO)
    - _Requirements: 2.1, 2.4_

  - [x] 1.2 Adicionar relação reversa no modelo AgendaWms
    - Adicionar campo `veiculoPatio VeiculoPatio?` no model AgendaWms para navegação inversa
    - _Requirements: 2.2_

  - [x] 1.3 Verificar modelo ConfigPatio com campos de prioridade
    - Garantir que ConfigPatio possui campos: prioridadeAgendado (default 10), prioridadeDescarga (default 5), prioridadeCarga (default 3), prioridadePadrao (default 1), limitePermMinutos, alertaPermAtivo
    - Criar campos caso não existam
    - _Requirements: 8.4, 11.1_

  - [x] 1.4 Gerar e aplicar migração Prisma
    - Executar `npx prisma migrate dev --name integracao-agenda-patio-doca`
    - Verificar que a migração foi aplicada sem erros e FK constraint funciona
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 2. Implementar FilaService (serviço de fila e prioridade)
  - [x] 2.1 Criar FilaService com lógica de prioridade
    - Criar `src/modules/patio/fila.service.ts` com classe `FilaService`
    - Implementar `calcularPrioridade(empresaId, cdId, tipoOperacao, isAgendado)`: retorna prioridade baseada em ConfigPatio
    - Implementar `inserirNaFila(tx, empresaId, cdId, veiculoId, prioridade)`: insere com posicao = max(posicao para o CD) + 1
    - Implementar `removerDaFila(tx, empresaId, veiculoId)`: remove registro de FilaEsperaPatio
    - Implementar `reinserirComPrioridade(tx, empresaId, cdId, veiculoId, prioridade)`: re-insere veículo na fila com prioridade elevada
    - _Requirements: 1.2, 1.3, 5.3, 5.4, 8.1, 8.2, 8.4_

  - [ ]* 2.2 Escrever teste de propriedade para atribuição de prioridade
    - **Property 1: Priority Assignment Follows ConfigPatio Rules**
    - **Validates: Requirements 1.2, 1.3, 1.4, 5.3**

  - [ ]* 2.3 Escrever teste de propriedade para ordenação da fila
    - **Property 2: Queue Ordering Invariant**
    - **Validates: Requirements 3.1, 8.1**

  - [ ]* 2.4 Escrever teste de propriedade para monotonicidade de posição
    - **Property 10: Position Monotonicity**
    - **Validates: Requirements 5.4, 8.2**

  - [x] 2.5 Implementar endpoint de override manual de prioridade
    - Criar endpoint `PATCH /api/patio/fila/:veiculoId/prioridade`
    - Aceitar nova prioridade e justificativaPrioridade
    - Atualizar FilaEsperaPatio.prioridade e registrar justificativa
    - _Requirements: 8.3_

- [x] 3. Checkpoint — Verificar FilaService
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Refatorar PortariaService para check-in integrado
  - [x] 4.1 Implementar conferirCheckin com criação de VeiculoPatio + FilaEsperaPatio
    - Refatorar método de check-in em `src/modules/portaria/portaria.service.ts`
    - Validar que AgendaWms está com status AGENDADO
    - Validar que não existe VeiculoPatio com mesma placa e status != LIBERADO (rejeitar com HTTP 409)
    - Em uma transação Prisma: atualizar AgendaWms status → ESPERA + setar horaChegadaReal, criar VeiculoPatio com status AGUARDANDO copiando placa/motorista/motoristaDocumento/tipoOperacao, inserir FilaEsperaPatio via FilaService
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 4.1, 12.1_

  - [ ]* 4.2 Escrever teste de propriedade para rejeição de veículo duplicado
    - **Property 5: Duplicate Vehicle Rejection**
    - **Validates: Requirements 1.5**

  - [x] 4.3 Implementar endpoint de walk-in
    - Criar endpoint `POST /api/portaria/walk-in`
    - Aceitar: placa, motoristaNome, motoristaDocumento, tipoOperacao, transportadoraId (opcional), cdId
    - Validar formato de placa (ABC1234 ou ABC1D23)
    - Validar duplicidade de placa no pátio (HTTP 409)
    - Criar VeiculoPatio com agendamentoId null, status AGUARDANDO
    - Inserir na FilaEsperaPatio com prioridade calculada por FilaService (prioridadeDescarga para DESCARGA, prioridadeCarga para CARGA, prioridadePadrao para outros)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 1.4_

  - [ ]* 4.4 Escrever teste de propriedade para isolamento walk-in do AgendaWms
    - **Property 4: Walk-in Isolation from AgendaWms**
    - **Validates: Requirements 4.6**

- [x] 5. Checkpoint — Verificar check-in e walk-in
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implementar ChamadaDocaService (fluxo de chamada de doca)
  - [x] 6.1 Criar ChamadaDocaService com sugestão de próximo veículo
    - Criar `src/modules/patio/chamada-doca.service.ts` com classe `ChamadaDocaService`
    - Implementar `sugerirProximo(empresaId, docaId)`: buscar próximo veículo de FilaEsperaPatio ordenado por prioridade DESC, posicao ASC para o CD da doca
    - _Requirements: 3.1_

  - [x] 6.2 Implementar emissão de chamada de doca
    - Implementar `emitirChamada(empresaId, {veiculoId, docaId}, usuarioId)`: em transação, criar ChamadaDoca com status CHAMADO, atualizar VeiculoPatio.status → CHAMADO + setar chamadaDocaEm, emitir SSE "chamada-doca" com veiculoId, placa, docaId, doca name
    - Validar que veículo está AGUARDANDO (senão HTTP 422)
    - _Requirements: 3.2, 3.3_

  - [x] 6.3 Implementar confirmação de chegada à doca
    - Implementar `confirmarChegada(empresaId, chamadaId)`: em transação, atualizar ChamadaDoca.status → ATENDIDO, atualizar VeiculoPatio (status → NA_DOCA, chegadaDocaEm, docaId), remover da FilaEsperaPatio, sincronizar AgendaWms.status → NA_DOCA
    - _Requirements: 3.4, 4.2, 12.2_

  - [x] 6.4 Implementar cancelamento de chamada com re-enfileiramento
    - Implementar `cancelarChamada(empresaId, chamadaId, motivo)`: em transação, atualizar ChamadaDoca.status → CANCELADO + motivoCancelamento, resetar VeiculoPatio.status → AGUARDANDO + limpar chamadaDocaEm, re-inserir na FilaEsperaPatio com prioridade original ou elevada
    - Validar que ChamadaDoca está CHAMADO (senão HTTP 422)
    - _Requirements: 3.6_

  - [ ]* 6.5 Escrever teste de propriedade para round-trip de cancelamento
    - **Property 6: Dock Call Cancellation Round-Trip**
    - **Validates: Requirements 3.6**

  - [ ]* 6.6 Escrever teste de propriedade para lifecycle de chamada de doca
    - **Property 11: Dock Call Lifecycle State Transitions**
    - **Validates: Requirements 3.2, 3.4**

  - [x] 6.7 Criar rotas HTTP para ChamadaDocaService
    - `GET /api/patio/chamada-doca/sugerir?docaId=<uuid>` — sugestão próximo
    - `POST /api/patio/chamada-doca` — emitir chamada
    - `PATCH /api/patio/chamada-doca/:id/confirmar` — confirmar chegada
    - `PATCH /api/patio/chamada-doca/:id/cancelar` — cancelar chamada
    - Registrar rotas com autenticação e moduloGuard
    - _Requirements: 3.1, 3.2, 3.4, 3.6_

- [x] 7. Checkpoint — Verificar fluxo de chamada de doca
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implementar sincronização de status AgendaWms e guards
  - [x] 8.1 Implementar sincronizarAgendaStatus no PortariaService
    - Criar método `sincronizarAgendaStatus(tx, veiculoId, novoStatus)` que aplica a tabela de mapeamento: AGUARDANDO→ESPERA, NA_DOCA→NA_DOCA, CONFERINDO→CONFERINDO, CONFERIDO→CONFERIDO, LIBERADO→RECEBIDO
    - Pular sincronização quando agendamentoId é null (walk-in)
    - Setar AgendaWms.tempoPermDocaMin quando status LIBERADO
    - Integrar chamadas nos métodos de ChamadaDocaService e PatioService
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [ ]* 8.2 Escrever teste de propriedade para mapeamento de status
    - **Property 3: Status Synchronization Mapping**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

  - [x] 8.3 Implementar guards de transição de status para conferência e liberação
    - No PatioService, validar que só aceita iniciar conferência se VeiculoPatio.status == NA_DOCA (senão HTTP 422)
    - Validar que só aceita liberação se VeiculoPatio.status == CONFERIDO (senão HTTP 422)
    - _Requirements: 6.3, 7.3_

  - [ ]* 8.4 Escrever teste de propriedade para enforcement de guards
    - **Property 7: Status Guard Enforcement**
    - **Validates: Requirements 6.3, 7.3**

- [x] 9. Implementar conference lifecycle e release
  - [x] 9.1 Implementar hooks de conferência no PatioService
    - Implementar `iniciarConferencia(empresaId, veiculoId)`: validar status NA_DOCA, atualizar VeiculoPatio.status → CONFERINDO, sincronizar AgendaWms
    - Implementar `concluirConferencia(empresaId, veiculoId)`: atualizar VeiculoPatio.status → CONFERIDO, sincronizar AgendaWms
    - _Requirements: 6.1, 6.2, 4.3, 4.4_

  - [x] 9.2 Implementar liberação de veículo
    - Implementar `liberarVeiculo(empresaId, veiculoId)`: validar status CONFERIDO, em transação: setar VeiculoPatio.status → LIBERADO + saidaEm + calcular tempoPermMinutos, limpar docaId, sincronizar AgendaWms (RECEBIDO + tempoPermDocaMin), emitir SSE "doca-liberada" com docaId
    - _Requirements: 7.1, 7.2, 4.5, 12.4_

  - [ ]* 9.3 Escrever teste de propriedade para computação de tempos
    - **Property 8: Time Computation Correctness**
    - **Validates: Requirements 7.1, 9.1, 9.2**

  - [x] 9.4 Criar rotas HTTP para conferência e liberação
    - `PATCH /api/patio/veiculos/:id/iniciar-conferencia`
    - `PATCH /api/patio/veiculos/:id/concluir-conferencia`
    - `PATCH /api/patio/veiculos/:id/liberar`
    - Registrar rotas com autenticação e moduloGuard
    - _Requirements: 6.1, 6.2, 7.1_

- [x] 10. Checkpoint — Verificar lifecycle completo
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implementar SseService e notificações em tempo real
  - [x] 11.1 Criar ou refatorar SseService centralizado
    - Criar/refatorar `src/modules/patio/sse.service.ts` com classe `SseService`
    - Implementar `addConnection(empresaId, reply)`: registrar conexão SSE
    - Implementar `removeConnection(empresaId, reply)`: remover cliente desconectado
    - Implementar `broadcast(empresaId, event)`: enviar evento para todos os clientes da empresa
    - Implementar keepalive ping a cada 30 segundos
    - _Requirements: 3.3, 3.5, 7.2, 11.2_

  - [x] 11.2 Criar endpoint SSE de conexão
    - Criar endpoint `GET /api/patio/sse` que registra cliente SSE com empresaId do usuário autenticado
    - Configurar headers: Content-Type text/event-stream, Cache-Control no-cache, Connection keep-alive
    - Remover conexão no close do request
    - _Requirements: 3.3_

  - [x] 11.3 Integrar emissão SSE nos serviços existentes
    - Emitir "chamada-doca" após commit bem-sucedido em emitirChamada
    - Emitir "chamada-expirada" quando chamada expira
    - Emitir "doca-liberada" após commit em liberarVeiculo
    - Emitir "alerta-permanencia" no PatioWorker
    - Garantir que SSE só é emitido após commit da transação
    - _Requirements: 3.3, 3.5, 7.2, 11.2_

- [x] 12. Implementar PatioWorker para alertas de permanência
  - [x] 12.1 Implementar job de verificação de permanência excessiva
    - No PatioWorker existente (ou criar se não existe), adicionar ciclo periódico
    - Buscar veículos com status NA_DOCA ou CONFERINDO cujo tempo desde chegadaDocaEm excede ConfigPatio.limitePermMinutos
    - Filtrar apenas CDs com ConfigPatio.alertaPermAtivo = true
    - Para cada veículo excedente, emitir SSE "alerta-permanencia" com veiculoId, placa, docaId, minutos decorridos
    - Isolar erros por veículo (não travar loop)
    - _Requirements: 11.1, 11.2, 11.3_

- [x] 13. Implementar KpiService
  - [x] 13.1 Criar KpiService com computação de métricas
    - Criar `src/modules/patio/kpi.service.ts` com classe `KpiService`
    - Implementar `computarMetricas(empresaId, filters)`: consultar VeiculoPatio com status LIBERADO no período
    - Calcular: tempoEsperaMedio, tempoEsperaMax, tempoEsperaP90, tempoDocaMedio, tempoDocaMax, tempoDocaP90, aderenciaMedia, pontualidade, totalVeiculos
    - tempo_espera = chamadaDocaEm - entradaEm (minutos)
    - tempo_doca = saidaEm - chegadaDocaEm (minutos)
    - aderencia = abs(entradaEm - scheduled_time) (minutos)
    - pontualidade = count(aderencia ≤ 30) / count(scheduled) × 100
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [ ]* 13.2 Escrever teste de propriedade para aderência de agendamento
    - **Property 9: Schedule Adherence Computation**
    - **Validates: Requirements 9.3, 9.4**

  - [x] 13.3 Criar endpoint de métricas KPI
    - Criar endpoint `GET /api/patio/kpis?cdId=<uuid>&dataInicio=<date>&dataFim=<date>`
    - Retornar KpiMetrics agregados filtráveis por cdId e período
    - Registrar rota com autenticação
    - _Requirements: 9.5_

- [x] 14. Implementar endpoint unificado do Painel Operacional
  - [x] 14.1 Criar endpoint do Painel Operacional
    - Criar endpoint `GET /api/painel-operacional?cdId=<uuid>`
    - Retornar: agendamentosHoje (AgendaWms do dia com enriquecimento), filaEspera (FilaEsperaPatio com dados do veículo), docasOcupadas (VeiculoPatio com status NA_DOCA ou CONFERINDO), metricas resumidas (totalFila, tempoMedioEspera, docasDisponiveis)
    - Filtrar por cdId e scopar por empresaId do usuário autenticado
    - _Requirements: 10.1, 10.3, 10.4, 10.5_

  - [ ]* 14.2 Escrever teste de propriedade para data scoping
    - **Property 12: Data Scoping Invariant**
    - **Validates: Requirements 10.5**

  - [x] 14.3 Garantir que SSE notificações alimentam frontend real-time
    - Documentar no painel que "chamada-doca" SSE deve exibir notificação com placa e nome da doca
    - Integrar evento "alerta-permanencia" para destaque visual no painel
    - _Requirements: 10.2, 10.4_

- [x] 15. Checkpoint — Verificar integração completa
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Wiring final e registro de rotas
  - [x] 16.1 Registrar todas as novas rotas no server.ts
    - Registrar rotas de `/api/patio/fila` (FilaService endpoints)
    - Registrar rotas de `/api/patio/chamada-doca` (ChamadaDocaService endpoints)
    - Registrar rotas de `/api/patio/veiculos` (conferência e liberação)
    - Registrar rotas de `/api/patio/sse` (SSE connection)
    - Registrar rotas de `/api/patio/kpis` (KpiService endpoints)
    - Registrar rota de `/api/painel-operacional` (dashboard unificado)
    - Registrar rota de `/api/portaria/walk-in` (walk-in endpoint)
    - Adicionar autenticação e moduloGuard em todas as rotas
    - _Requirements: 5.1, 9.5, 10.1_

  - [x] 16.2 Verificar transacionalidade end-to-end
    - Revisar que check-in executa AgendaWms update + VeiculoPatio create + FilaEsperaPatio insert em uma transação
    - Revisar que dock arrival executa ChamadaDoca update + VeiculoPatio update + AgendaWms sync + FilaEsperaPatio delete em uma transação
    - Revisar que release executa VeiculoPatio update + AgendaWms sync em uma transação
    - Garantir que SSE é emitido apenas após commit bem-sucedido
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [x] 17. Final checkpoint — Verificar tudo integrado
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marcadas com `*` são opcionais e podem ser puladas para um MVP mais rápido
- Cada task referencia requirements específicos para rastreabilidade
- Checkpoints garantem validação incremental
- Testes de propriedade validam propriedades universais de corretude definidas no design
- Testes unitários validam exemplos específicos e edge cases
- Todas as operações multi-tabela devem usar `prisma.$transaction()` (modo interativo)
- SSE nunca deve ser emitido dentro da transação — sempre após commit bem-sucedido
- O projeto usa TypeScript com Fastify + Prisma no backend
- VeiculoPatio é o registro operacional único; AgendaWms é apenas entidade de planejamento

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["1.4"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.4", "2.5"] },
    { "id": 4, "tasks": ["4.1", "4.3"] },
    { "id": 5, "tasks": ["4.2", "4.4"] },
    { "id": 6, "tasks": ["6.1"] },
    { "id": 7, "tasks": ["6.2", "6.3", "6.4", "6.7"] },
    { "id": 8, "tasks": ["6.5", "6.6"] },
    { "id": 9, "tasks": ["8.1"] },
    { "id": 10, "tasks": ["8.2", "8.3"] },
    { "id": 11, "tasks": ["8.4", "9.1", "9.2"] },
    { "id": 12, "tasks": ["9.3", "9.4"] },
    { "id": 13, "tasks": ["11.1"] },
    { "id": 14, "tasks": ["11.2", "11.3"] },
    { "id": 15, "tasks": ["12.1"] },
    { "id": 16, "tasks": ["13.1"] },
    { "id": 17, "tasks": ["13.2", "13.3"] },
    { "id": 18, "tasks": ["14.1"] },
    { "id": 19, "tasks": ["14.2", "14.3"] },
    { "id": 20, "tasks": ["16.1", "16.2"] }
  ]
}
```
