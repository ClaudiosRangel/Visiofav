# Requirements Document

## Introduction

This feature unifies the two disconnected operational worlds in the WMS inbound flow — the Agenda/Portaria scheduling system and the Patio yard management module — into a single cohesive vehicle lifecycle. Today, the portaria flow (AgendaWms status transitions) and the patio flow (VeiculoPatio, FilaEsperaPatio, ChamadaDoca) operate independently. Vehicles checked in at the gate never enter the yard queue, dock calls are never triggered during normal operations, and SSE real-time notifications remain unused.

The integration creates a professional WMS inbound standard (comparable to Manhattan, Blue Yonder, SAP EWM): scheduling → gate check-in → yard queue → dock call → dock operations → conference → release, with VeiculoPatio as the single operational record and AgendaWms remaining the planning entity.

## Glossary

- **Sistema_Portaria**: The gate check-in module responsible for verifying vehicle arrivals against schedules and registering drivers/plates
- **Sistema_Patio**: The yard management module responsible for queue management, dock calls, and real-time notifications
- **Sistema_Agenda**: The scheduling module where suppliers book dock slots for deliveries
- **Servico_Fila**: The queue ordering service that determines vehicle priority in FilaEsperaPatio
- **Servico_ChamadaDoca**: The dock call service that emits ChamadaDoca records and SSE notifications
- **Servico_KPI**: The analytics service that computes yard performance indicators
- **AgendaWms**: The scheduling/planning entity containing dock slot reservations with supplier, date, time window, vehicle details, and status flow
- **VeiculoPatio**: The operational execution entity tracking a vehicle from gate entry to release, with timestamps for each lifecycle phase
- **FilaEsperaPatio**: The priority queue holding vehicles awaiting dock assignment, ordered by priority and position
- **ChamadaDoca**: A dock call record representing an invitation for a vehicle to proceed from yard to a specific dock
- **ConfigPatio**: Per-CD configuration controlling priority weights, permanence limits, and alert settings
- **SSE**: Server-Sent Events channel used to push real-time dock call notifications to the yard panel
- **Walk-in**: A vehicle arriving without a prior AgendaWms scheduling record
- **CD**: Centro de Distribuição (Distribution Center)

## Requirements

### Requirement 1: Gate Check-in Creates Yard Record

**User Story:** As a gate operator, I want the portaria check-in to automatically register the vehicle in the yard system, so that a single gate action feeds both the scheduling and operational tracking systems.

#### Acceptance Criteria

1. WHEN a gate operator performs check-in (conferir) on an AgendaWms record with status AGENDADO, THE Sistema_Portaria SHALL create a VeiculoPatio record with status AGUARDANDO, copying placa, motorista, motoristaDocumento, tipoOperacao, and linking agendamentoId to the AgendaWms.id
2. WHEN the VeiculoPatio record is created during check-in, THE Sistema_Portaria SHALL insert a corresponding FilaEsperaPatio record with priority determined by ConfigPatio settings for the CD
3. WHEN the AgendaWms record has a linked agendamentoId, THE Servico_Fila SHALL assign the priority value from ConfigPatio.prioridadeAgendado for that CD
4. WHEN the vehicle is a walk-in (no AgendaWms record), THE Sistema_Portaria SHALL create a VeiculoPatio record with agendamentoId set to null and priority from ConfigPatio.prioridadePadrao
5. IF a VeiculoPatio record with the same placa and status other than LIBERADO already exists, THEN THE Sistema_Portaria SHALL reject the check-in with HTTP 409 and message indicating the vehicle is already in the yard

### Requirement 2: Formal Foreign Key Between VeiculoPatio and AgendaWms

**User Story:** As a developer, I want a formal database relationship between VeiculoPatio.agendamentoId and AgendaWms.id, so that referential integrity is guaranteed and queries can join scheduling with execution data.

#### Acceptance Criteria

1. THE VeiculoPatio model SHALL define agendamentoId as an optional foreign key referencing AgendaWms.id
2. THE AgendaWms model SHALL expose a relation field (veiculoPatio) enabling navigation from schedule to execution record
3. IF a VeiculoPatio record references a non-existent AgendaWms.id, THEN THE database SHALL reject the insert with a foreign key constraint violation
4. WHEN an AgendaWms record is deleted, THE database SHALL set the referencing VeiculoPatio.agendamentoId to null (SET NULL behavior)

### Requirement 3: Dock Call Workflow Replaces Direct Status Transition

**User Story:** As a yard coordinator, I want the dock assignment to follow the ChamadaDoca workflow with SSE notifications, so that drivers receive real-time alerts and the system tracks response times.

#### Acceptance Criteria

1. WHEN a dock becomes available, THE Servico_ChamadaDoca SHALL suggest the next vehicle from FilaEsperaPatio ordered by highest prioridade then lowest posicao for the same CD
2. WHEN the yard coordinator confirms a dock call, THE Servico_ChamadaDoca SHALL create a ChamadaDoca record with status CHAMADO, set VeiculoPatio.chamadaDocaEm to current timestamp, and update VeiculoPatio.status to CHAMADO
3. WHEN a ChamadaDoca record is created, THE Servico_ChamadaDoca SHALL emit an SSE event of type "chamada-doca" to all connected clients for that empresaId, containing veiculoId, placa, docaId, and doca name
4. WHEN the vehicle arrives at the dock and the operator confirms arrival, THE Servico_ChamadaDoca SHALL update ChamadaDoca.status to ATENDIDO, set VeiculoPatio.chegadaDocaEm, assign VeiculoPatio.docaId, update VeiculoPatio.status to NA_DOCA, and remove the vehicle from FilaEsperaPatio
5. IF a dock call is not attended within the time limit defined in ConfigPatio.limitePermMinutos, THEN THE Servico_ChamadaDoca SHALL emit an SSE event of type "chamada-expirada" and allow the coordinator to cancel or re-call
6. WHEN a dock call is cancelled, THE Servico_ChamadaDoca SHALL update ChamadaDoca.status to CANCELADO, record motivoCancelamento, reset VeiculoPatio.status to AGUARDANDO, and restore the vehicle in FilaEsperaPatio at its original priority

### Requirement 4: AgendaWms Status Synchronization with VeiculoPatio

**User Story:** As a logistics manager, I want the AgendaWms status to reflect the actual vehicle lifecycle tracked in VeiculoPatio, so that the scheduling view always shows accurate current state.

#### Acceptance Criteria

1. WHEN VeiculoPatio.status transitions to AGUARDANDO (check-in complete), THE Sistema_Portaria SHALL update the linked AgendaWms.status to ESPERA and set AgendaWms.horaChegadaReal to the current timestamp
2. WHEN VeiculoPatio.status transitions to NA_DOCA (dock arrival confirmed), THE Sistema_Portaria SHALL update the linked AgendaWms.status to NA_DOCA
3. WHEN VeiculoPatio.status transitions to CONFERINDO (conference started), THE Sistema_Portaria SHALL update the linked AgendaWms.status to CONFERINDO
4. WHEN VeiculoPatio.status transitions to CONFERIDO (conference complete), THE Sistema_Portaria SHALL update the linked AgendaWms.status to CONFERIDO
5. WHEN VeiculoPatio.status transitions to LIBERADO (vehicle released), THE Sistema_Portaria SHALL update the linked AgendaWms.status to RECEBIDO and set AgendaWms.tempoPermDocaMin to VeiculoPatio.tempoPermMinutos
6. WHILE VeiculoPatio.agendamentoId is null (walk-in vehicle), THE Sistema_Portaria SHALL skip AgendaWms status synchronization for that vehicle

### Requirement 5: Walk-in Vehicle Support Through Portaria

**User Story:** As a gate operator, I want to register vehicles without a prior scheduling, so that unplanned deliveries and pickups enter the standard yard workflow.

#### Acceptance Criteria

1. THE Sistema_Portaria SHALL provide a walk-in registration endpoint accepting placa, motoristaNome, motoristaDocumento, tipoOperacao (CARGA, DESCARGA, DEVOLUCAO, TRANSFERENCIA), transportadoraId (optional), and cdId
2. WHEN a walk-in vehicle is registered, THE Sistema_Portaria SHALL create a VeiculoPatio record with agendamentoId null and status AGUARDANDO
3. WHEN a walk-in vehicle is registered, THE Servico_Fila SHALL assign priority based on ConfigPatio: prioridadeDescarga for DESCARGA, prioridadeCarga for CARGA, prioridadePadrao for other types
4. WHEN a walk-in vehicle is registered, THE Servico_Fila SHALL insert the vehicle in FilaEsperaPatio at the next available posicao for the given CD

### Requirement 6: Conference Lifecycle Integration

**User Story:** As a dock operator, I want starting and completing conference to update the vehicle status, so that the system tracks the full inbound timeline without manual status changes.

#### Acceptance Criteria

1. WHEN the dock operator starts an inbound conference (creates or links a NotaEntrada for the vehicle at the dock), THE Sistema_Portaria SHALL update VeiculoPatio.status to CONFERINDO
2. WHEN all items on the NotaEntrada are verified and the conference is marked complete, THE Sistema_Portaria SHALL update VeiculoPatio.status to CONFERIDO
3. IF the operator attempts to start a conference on a VeiculoPatio that is not in status NA_DOCA, THEN THE Sistema_Portaria SHALL reject with HTTP 422 and message indicating vehicle must be at dock

### Requirement 7: Vehicle Release and Time Tracking

**User Story:** As a logistics manager, I want vehicle release to capture permanence time and free the dock for the next vehicle, so that KPI data is accurate and dock throughput is maximized.

#### Acceptance Criteria

1. WHEN the dock operator releases a vehicle, THE Sistema_Patio SHALL set VeiculoPatio.status to LIBERADO, record VeiculoPatio.saidaEm as current timestamp, and calculate tempoPermMinutos as the difference in minutes between saidaEm and entradaEm
2. WHEN a vehicle is released from a dock, THE Sistema_Patio SHALL clear VeiculoPatio.docaId and emit an SSE event of type "doca-liberada" containing the docaId, enabling the next dock call suggestion
3. IF the operator attempts to release a VeiculoPatio that is not in status CONFERIDO, THEN THE Sistema_Patio SHALL reject with HTTP 422 and message indicating conference must be completed before release

### Requirement 8: Priority Queue Ordering Rules

**User Story:** As a yard coordinator, I want vehicles to be queued by configurable priority, so that scheduled vehicles and urgent operations are served before walk-ins.

#### Acceptance Criteria

1. THE Servico_Fila SHALL order FilaEsperaPatio by prioridade descending (higher value = higher priority), then by posicao ascending (first-in first-served within same priority)
2. WHEN a new vehicle enters the queue, THE Servico_Fila SHALL assign posicao as the next sequential integer for that CD, regardless of priority level
3. WHEN a yard coordinator manually overrides a vehicle priority, THE Servico_Fila SHALL update FilaEsperaPatio.prioridade and record the justificativaPrioridade
4. THE ConfigPatio SHALL define default priority values per CD: prioridadeAgendado (default 10), prioridadeDescarga (default 5), prioridadeCarga (default 3), prioridadePadrao (default 1)

### Requirement 9: KPI Metrics Computation

**User Story:** As a logistics manager, I want automated KPI computation for yard operations, so that I can measure dock efficiency, schedule adherence, and identify bottlenecks.

#### Acceptance Criteria

1. THE Servico_KPI SHALL compute tempo_espera as the difference in minutes between VeiculoPatio.entradaEm and VeiculoPatio.chamadaDocaEm for each released vehicle
2. THE Servico_KPI SHALL compute tempo_doca as the difference in minutes between VeiculoPatio.chegadaDocaEm and VeiculoPatio.saidaEm for each released vehicle
3. WHEN a released vehicle has a linked AgendaWms with dataPrevista and horaInicio, THE Servico_KPI SHALL compute aderencia_agendamento as the absolute difference in minutes between the scheduled arrival time and VeiculoPatio.entradaEm
4. THE Servico_KPI SHALL compute pontualidade as the percentage of vehicles that arrived within 30 minutes of their scheduled time window, over a configurable date range
5. THE Servico_KPI SHALL expose an endpoint returning aggregated metrics (averages, maximums, percentiles) filterable by cdId and date range

### Requirement 10: Unified Frontend View

**User Story:** As a logistics coordinator, I want a single dashboard showing scheduling, queue, and dock status together, so that I can manage the entire inbound flow from one screen.

#### Acceptance Criteria

1. THE Sistema_Portaria SHALL provide an API endpoint returning a unified view combining: today's AgendaWms records, current FilaEsperaPatio queue, and current dock occupation (VeiculoPatio with status NA_DOCA or CONFERINDO)
2. WHEN a ChamadaDoca SSE event is emitted, THE frontend SHALL display a real-time notification with vehicle placa and target dock name
3. THE unified endpoint SHALL include for each vehicle: placa, motorista, tipoOperacao, current status, queue position (if in queue), assigned dock (if at dock), and time elapsed since entry
4. WHILE a vehicle is in the queue, THE frontend SHALL display its position, priority level, and waiting time updated in real-time via periodic polling or SSE
5. THE unified endpoint SHALL support filtering by cdId and return data scoped to the authenticated user's empresaId

### Requirement 11: Excessive Permanence Alert Integration

**User Story:** As a yard coordinator, I want to receive alerts when vehicles exceed the configured permanence limit, so that I can take action on stalled operations.

#### Acceptance Criteria

1. WHILE ConfigPatio.alertaPermAtivo is true for a CD, THE Sistema_Patio SHALL monitor vehicles with status NA_DOCA or CONFERINDO whose elapsed dock time exceeds ConfigPatio.limitePermMinutos
2. WHEN a vehicle exceeds the permanence limit, THE Sistema_Patio SHALL emit an SSE event of type "alerta-permanencia" containing veiculoId, placa, docaId, and elapsed minutes
3. THE Sistema_Patio SHALL evaluate permanence limits periodically using the existing PatioWorker background job, checking all active vehicles per CD

### Requirement 12: Transactional Consistency

**User Story:** As a developer, I want all multi-record operations to be atomic, so that the system never ends in an inconsistent state between AgendaWms, VeiculoPatio, FilaEsperaPatio, and ChamadaDoca.

#### Acceptance Criteria

1. WHEN gate check-in is performed, THE Sistema_Portaria SHALL execute AgendaWms update, VeiculoPatio creation, and FilaEsperaPatio insertion within a single database transaction
2. WHEN a dock call is attended, THE Servico_ChamadaDoca SHALL execute ChamadaDoca update, VeiculoPatio update, AgendaWms status sync, and FilaEsperaPatio deletion within a single database transaction
3. IF any step within a transaction fails, THEN THE system SHALL rollback all changes and return an appropriate error response with HTTP 500
4. WHEN vehicle release is performed, THE Sistema_Patio SHALL execute VeiculoPatio update and AgendaWms status sync within a single database transaction
