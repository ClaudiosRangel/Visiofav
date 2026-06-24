# Implementation Plan: Agenda Backend

## Overview

Consolidar os módulos `agenda-wms` e `agenda-doca` em uma arquitetura unificada com service layer coeso. O plano implementa: AgendaService, ValidacaoService, AutoSchedulerService, TimelineService, EstatisticasService e NotificacaoService, com validação robusta de conflitos, máquina de estados com side-effects atômicos, e notificações SSE.

## Tasks

- [x] 1. Estrutura base e utilitários
  - [x] 1.1 Criar diretório `src/modules/agenda/` com arquivo de barrel index e tipos compartilhados
    - Criar `src/modules/agenda/index.ts` com re-exports
    - Criar `src/modules/agenda/agenda.types.ts` com interfaces: `StatusAgenda`, `TRANSICOES_VALIDAS`, `CriarAgendamentoInput`, `EditarAgendamentoInput`, `MoverAgendamentoInput`, `ListarAgendamentosFiltros`, `ValidarConflitoInput`, `ValidacaoResult`, `EstatisticasAderencia`, `TimelineResponse`, `GradeResponse`, `SugestaoSlot`
    - _Requirements: 4.1, 10.1, 10.2_

  - [x] 1.2 Criar `src/modules/agenda/agenda.utils.ts` com funções `toMinutes()` e `fromMinutes()`
    - Implementar `toMinutes(hora: string): number` — converte "HH:mm" para inteiro [0, 1439]
    - Implementar `fromMinutes(minutos: number): string` — converte inteiro [0, 1439] para "HH:mm"
    - Implementar `calcularPermanencia(horaChegadaReal: Date): number` — diferença em minutos entre agora e chegada
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [ ]* 1.3 Write property test for toMinutes/fromMinutes round-trip
    - **Property 7: Round-trip toMinutes/fromMinutes**
    - Usar fast-check para gerar inteiros [0, 1439] e validar `toMinutes(fromMinutes(n)) === n`
    - Usar fast-check para gerar strings "HH:mm" válidas e validar `fromMinutes(toMinutes(s)) === s`
    - **Validates: Requirements 10.3, 10.4**

  - [x] 1.4 Criar `src/modules/agenda/agenda.schemas.ts` com schemas Zod unificados
    - Unificar schemas de `agenda-doca.schemas.ts` e schemas inline de `agenda-wms.routes.ts`
    - Incluir: `criarAgendamentoSchema`, `editarAgendamentoSchema`, `moverAgendamentoSchema`, `alterarStatusSchema`, `timelineQuerySchema`, `gradeQuerySchema`, `estatisticasQuerySchema`, `criarBloqueioSchema`, `configDocaSchema`, `idParamsSchema`, `listQuerySchema`
    - Adicionar `duracaoMinutos` ao schema de criação quando `autoAgendar=true`
    - _Requirements: 11.4, 11.5, 1.6_

- [x] 2. ValidacaoService — validação de conflitos e transições
  - [x] 2.1 Criar `src/modules/agenda/validacao.service.ts`
    - Implementar `validarConflito(input, empresaId)` — valida horário operacional, sobreposição com buffer simétrico, bloqueios
    - Implementar `validarHorarioOperacional(horaInicio, horaFim, config)` — verifica janela operacional
    - Implementar `validarBloqueios(docaId, dataInicio, dataFim, empresaId)` — verifica bloqueios ativos
    - Implementar `validarTransicaoStatus(statusAtual, novoStatus)` — valida contra mapa `TRANSICOES_VALIDAS`
    - Excluir agendamentos CANCELADO da detecção de conflito
    - Excluir o próprio agendamento em edição (via `excluirId`)
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 4.1, 4.2, 4.3, 4.4, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 2.2 Write property test for não-sobreposição de slots
    - **Property 1: Não-sobreposição de slots na mesma doca**
    - Gerar pares de slots arbitrários e verificar que detecção de conflito é simétrica (A conflita com B ⟺ B conflita com A)
    - Verificar que slots com buffer aplicado simetricamente são detectados corretamente
    - **Validates: Requirements 1.2, 6.1, 6.2, 6.5**

  - [ ]* 2.3 Write property test for máquina de estados
    - **Property 4: Máquina de estados — transições válidas e estados finais absorventes**
    - Gerar sequências arbitrárias de status e verificar que estados finais (RECEBIDO, CANCELADO) rejeitam qualquer transição
    - Verificar que apenas transições definidas em `TRANSICOES_VALIDAS` são aceitas
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

  - [ ]* 2.4 Write property test for conflito exclui cancelados e self
    - **Property 10: Conflito exclui agendamentos cancelados e o próprio em edição**
    - Gerar lista de agendamentos com status variados e verificar que CANCELADO nunca participa da detecção
    - Verificar que o agendamento com `excluirId` não causa conflito consigo mesmo
    - **Validates: Requirements 6.3, 6.4**

- [x] 3. AutoSchedulerService — auto-agendamento inteligente
  - [x] 3.1 Criar `src/modules/agenda/auto-scheduler.service.ts`
    - Implementar `encontrarProximoSlot(docaId, data, duracaoMinutos, empresaId)` — busca primeiro gap livre no dia
    - Implementar `sugerirDocaDisponivel(data, duracaoMinutos, empresaId, tipoDoca?)` — retorna múltiplas opções ordenadas
    - Respeitar horário operacional, buffer entre slots, e bloqueios ativos
    - Algoritmo greedy: varrer intervalos ordenados por início, encontrar primeiro gap >= duração
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ]* 3.2 Write property test for AutoScheduler retorna slot válido
    - **Property 6: Auto-scheduler retorna slot válido**
    - Gerar conjuntos arbitrários de agendamentos/bloqueios e duração, verificar que se um slot é retornado ele está dentro do horário operacional, não conflita com existentes e não sobrepõe bloqueios
    - **Validates: Requirements 2.1, 2.4, 2.5**

- [x] 4. Checkpoint - Validar services base
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. AgendaService — orquestrador principal
  - [x] 5.1 Criar `src/modules/agenda/agenda.service.ts`
    - Implementar `criarAgendamento(input, empresaId)` — com validação de conflito e integração com AutoScheduler
    - Implementar `editarAgendamento(id, input, empresaId)` — com revalidação de conflito no novo slot
    - Implementar `moverAgendamento(id, input, empresaId)` — drag-and-drop com validação
    - Implementar `listarAgendamentos(filtros, empresaId)` — com paginação e enriquecimento de dados
    - Implementar `obterDetalhe(id, empresaId)` — com dados enriquecidos (fornecedor, pedido, doca, NF)
    - Bloquear edição/movimentação de agendamentos com status RECEBIDO ou CANCELADO
    - Validar que dataPrevista não está no passado e horaFim > horaInicio
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3_

  - [x] 5.2 Implementar transição de status com side-effects em `agenda.service.ts`
    - Implementar `alterarStatus(id, novoStatus, empresaId, userId)` dentro de `prisma.$transaction`
    - Side-effect `NA_DOCA`: registrar `horaChegadaReal`, criar `NotaEntrada` do XML se não existe
    - Side-effect `CONFERINDO`: atualizar NotaEntrada → EM_CONFERENCIA, criar/atualizar OrdemServicoWms
    - Side-effect `RECEBIDO`: atualizar PedidoCompra → RECEBIDO, calcular `tempoPermDocaMin`
    - Implementar `concluirRecebimento(id, empresaId, userId)` como atalho para RECEBIDO
    - Implementar `registrarChegada(id, empresaId, horaChegada?)` — registra chegada manual
    - Garantir rollback completo se qualquer side-effect falhar
    - _Requirements: 4.1, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [ ]* 5.3 Write property test for atomicidade de side-effects
    - **Property 5: Atomicidade de side-effects**
    - Simular falhas em side-effects individuais e verificar que o status original permanece inalterado após rollback
    - **Validates: Requirements 4.5, 5.7**

  - [ ]* 5.4 Write property test for edição de agendamentos finalizados
    - **Property 9: Edição de agendamentos finalizados é bloqueada**
    - Gerar agendamentos com status RECEBIDO ou CANCELADO e verificar que edição/movimentação retorna erro 422
    - **Validates: Requirements 3.3**

  - [ ]* 5.5 Write property test for duração positiva de slot
    - **Property 12: Duração positiva de slot**
    - Gerar pares (horaInicio, horaFim) arbitrários e verificar que quando horaFim ≤ horaInicio a criação é rejeitada
    - **Validates: Requirements 1.6**

- [x] 6. TimelineService e EstatisticasService
  - [x] 6.1 Criar `src/modules/agenda/timeline.service.ts`
    - Implementar `getTimeline(data, visualizacao, empresaId)` — retorna docas, agendamentos e bloqueios agrupados
    - Implementar `getGradeDiaria(data, empresaId, slotMinutos?)` — grade com slots configuráveis (padrão 30 min)
    - Calcular indicadores de aderência para cada agendamento (no prazo, atraso leve, atrasado)
    - Suportar visualizações dia (1 dia), semana (7 dias), mês (mês completo)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 6.2 Criar `src/modules/agenda/estatisticas.service.ts`
    - Implementar `calcularEstatisticas(empresaId, dataInicio, dataFim)` — percentual no prazo, tempo médio atraso, permanência média
    - Implementar `detectarAtrasos(empresaId)` — atualiza agendamentos atrasados além da tolerância
    - Excluir agendamentos cancelados; calcular métricas apenas sobre registros com horaChegadaReal
    - Garantir percentualNoPrazo no intervalo [0, 100]
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [ ]* 6.3 Write property test for estatísticas percentual no intervalo válido
    - **Property 8: Estatísticas — percentual no intervalo válido**
    - Gerar conjuntos arbitrários de agendamentos (incluindo vazios) e verificar que percentualNoPrazo ∈ [0, 100]
    - Verificar que métricas são calculadas apenas sobre agendamentos não-cancelados com horaChegadaReal
    - **Validates: Requirements 8.4, 8.5, 8.6**

- [x] 7. NotificacaoService — SSE em tempo real
  - [x] 7.1 Criar `src/modules/agenda/notificacao.service.ts`
    - Implementar `notificarCriacao(agendamento, empresaId)` — emite evento SSE "agendamento-criado"
    - Implementar `notificarStatusAlterado(agendamento, statusAnterior, empresaId)` — emite "status-alterado"
    - Implementar `notificarAtraso(agendamento, minutosAtraso, empresaId)` — emite "atraso-detectado"
    - Integrar com `sseService` existente em `src/modules/patio/sse.service.ts`
    - Implementar agrupamento de notificações (debounce/throttle) para evitar spam em sequência rápida
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x] 8. Checkpoint - Validar service layer completo
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Routes — camada de rotas unificada
  - [x] 9.1 Criar `src/modules/agenda/agenda.routes.ts` — rotas CRUD e status
    - `GET /api/agenda` — listar com filtros (status, data, docaId, paginação)
    - `POST /api/agenda` — criar agendamento (com suporte a autoAgendar)
    - `GET /api/agenda/:id` — detalhe enriquecido
    - `PATCH /api/agenda/:id` — editar dados
    - `PATCH /api/agenda/:id/status` — transição de status
    - `PATCH /api/agenda/:id/concluir` — atalho para RECEBIDO
    - `PUT /api/agenda/:id/mover` — mover agendamento (drag-and-drop)
    - `PUT /api/agenda/:id/chegada` — registrar chegada
    - `GET /api/agenda/docas` — listar docas ativas
    - `GET /api/agenda/disponibilidade` — verificar disponibilidade
    - Aplicar hooks `authenticate` e `moduloGuard('WMS')` em todas as rotas
    - Validar inputs com Zod schemas do arquivo unificado
    - _Requirements: 1.1, 3.1, 3.2, 4.5, 11.2, 11.3, 11.4, 11.5_

  - [x] 9.2 Criar `src/modules/agenda/agenda-timeline.routes.ts` — rotas de visualização
    - `GET /api/agenda/timeline` — timeline dia/semana/mês
    - `GET /api/agenda/grade/:data` — grade diária por doca
    - `GET /api/agenda/sugestoes` — sugerir docas disponíveis (AutoScheduler)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 2.6_

  - [x] 9.3 Criar `src/modules/agenda/agenda-bloqueios.routes.ts` — rotas de bloqueios
    - `GET /api/agenda/bloqueios` — listar bloqueios
    - `POST /api/agenda/bloqueios` — criar bloqueio (validar dataFim > dataInicio, motivo 1-200 chars, sem conflito com confirmados)
    - `DELETE /api/agenda/bloqueios/:id` — remover bloqueio
    - _Requirements: 12.1, 12.2, 12.3_

  - [x] 9.4 Criar `src/modules/agenda/agenda-config.routes.ts` — rotas de configuração
    - `GET /api/agenda/config` — obter configuração (ou defaults)
    - `PUT /api/agenda/config` — upsert configuração
    - _Requirements: 11.1_

  - [x] 9.5 Criar `src/modules/agenda/agenda-estatisticas.routes.ts` — rotas de métricas
    - `GET /api/agenda/estatisticas` — métricas de aderência por período
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 10. Integração e registro de rotas
  - [x] 10.1 Registrar rotas do módulo agenda no app Fastify principal
    - Adicionar prefix `/api/agenda` com todas as sub-rotas
    - Integrar NotificacaoService nos métodos do AgendaService (criarAgendamento, alterarStatus)
    - Integrar chamadas do AutoScheduler no fluxo de criação quando `autoAgendar=true`
    - Garantir que o módulo existente `agenda-wms` e `agenda-doca` continuam funcionando em paralelo (backward compatibility) ou criar redirect
    - _Requirements: 11.2, 11.3, 9.1, 9.2_

  - [ ]* 10.2 Write property test for isolamento multi-tenant
    - **Property 11: Isolamento multi-tenant**
    - Gerar operações com diferentes empresaId e verificar que nenhum dado de outra empresa é acessível ou retornado
    - **Validates: Requirements 11.1**

  - [ ]* 10.3 Write property test for horário operacional
    - **Property 2: Horário operacional**
    - Gerar agendamentos com horaInicio/horaFim arbitrários e verificar que apenas os que respeitam a janela operacional são aceitos
    - **Validates: Requirements 1.3**

  - [ ]* 10.4 Write property test for sem agendamento em doca bloqueada
    - **Property 3: Sem agendamento em doca bloqueada**
    - Gerar bloqueios e agendamentos sobrepostos e verificar que a criação é sempre rejeitada
    - **Validates: Requirements 1.4, 12.3**

- [x] 11. Final checkpoint - Validar integração completa
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- O módulo existente (`agenda-wms`, `agenda-doca`) permanece funcional durante a migração — as rotas novas coexistem até a migração completa do frontend
- Os modelos Prisma (AgendaWms, Doca, ConfigDoca, BloqueioSlotDoca) já existem — nenhuma migration é necessária
- O SSE service existente em `src/modules/patio/sse.service.ts` é reutilizado pelo NotificacaoService

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.4"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "2.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.4", "3.1"] },
    { "id": 4, "tasks": ["3.2", "5.1"] },
    { "id": 5, "tasks": ["5.2", "6.1", "6.2"] },
    { "id": 6, "tasks": ["5.3", "5.4", "5.5", "6.3", "7.1"] },
    { "id": 7, "tasks": ["9.1", "9.2", "9.3", "9.4", "9.5"] },
    { "id": 8, "tasks": ["10.1"] },
    { "id": 9, "tasks": ["10.2", "10.3", "10.4"] }
  ]
}
```
