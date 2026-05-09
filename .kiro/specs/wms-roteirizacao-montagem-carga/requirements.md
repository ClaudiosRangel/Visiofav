# Requirements Document

## Introduction

This document specifies the requirements for the WMS Routing and Load Assembly (Roteirização e Montagem de Carga) feature. The feature introduces route management, route-client association, route-based load assembly with totalization, enhanced loading map (mapa de carregamento) with sequential numbering, driver assignment, status flow, cancellation, NF transfer between loads, and map closure with delivery confirmation. These capabilities replicate and modernize the legacy Delphi system's routing and expedition workflow within the current Node.js/Fastify/Prisma stack.

## Glossary

- **Sistema**: The WMS application (backend + frontend + mobile)
- **Rota**: A delivery route entity containing code, description, linked carrier, and status, scoped to an empresa
- **Empresa**: The tenant entity representing a company in the multi-tenant system
- **Transportadora**: A carrier company responsible for transporting goods
- **Cliente**: A customer entity that can be associated with a default route
- **Pedido_de_Venda**: A sales order linked to a client
- **NF**: Nota Fiscal (tax invoice) issued for a sale, represented by the Nfe model
- **Volume**: A packed unit (box, pallet, bundle) linked to a picking wave and sales order
- **Carregamento**: A loading operation that groups volumes for dispatch at a dock
- **Mapa_de_Carregamento**: A sequential document that groups NFs/volumes for a specific vehicle/driver dispatch
- **Motorista**: The driver assigned to a loading map or carregamento
- **Doca**: A loading dock where carregamentos are assembled
- **Coletor**: The mobile device (React Native app) used for warehouse operations
- **Usuário**: An authenticated user of the system

## Requirements

### Requirement 1: Route CRUD

**User Story:** As a warehouse manager, I want to create, read, update, and deactivate delivery routes, so that I can organize deliveries geographically.

#### Acceptance Criteria

1. THE Sistema SHALL provide an API endpoint to create a Rota with fields: código (unique per empresa), descrição, transportadoraId (optional), and status (default: active)
2. THE Sistema SHALL enforce uniqueness of Rota código within the same Empresa
3. WHEN a Rota creation request is received with a duplicate código for the same Empresa, THE Sistema SHALL return a conflict error with a descriptive message
4. THE Sistema SHALL provide an API endpoint to list all Rotas for the authenticated Empresa with pagination (page, limit) and optional status filter
5. THE Sistema SHALL provide an API endpoint to retrieve a single Rota by its identifier
6. THE Sistema SHALL provide an API endpoint to update a Rota's descrição, transportadoraId, and status fields
7. WHEN a Rota deactivation request is received, THE Sistema SHALL set the Rota status to inactive without deleting the record
8. THE Sistema SHALL scope all Rota operations to the authenticated user's Empresa (multi-tenant isolation)

---

### Requirement 2: Route-Client Association

**User Story:** As a sales operator, I want each client to have a default route, so that sales orders are automatically associated with the correct delivery route.

#### Acceptance Criteria

1. THE Sistema SHALL store an optional rotaId field on the Cliente model referencing a Rota
2. THE Sistema SHALL provide an API endpoint to assign or update the default Rota for a Cliente
3. WHEN a Pedido_de_Venda is created for a Cliente that has a default Rota, THE Sistema SHALL auto-fill the rotaId on the Pedido_de_Venda
4. WHEN a Pedido_de_Venda is created for a Cliente without a default Rota, THE Sistema SHALL leave the rotaId field empty
5. THE Sistema SHALL allow manual override of the rotaId on a Pedido_de_Venda regardless of the Cliente's default Rota
6. THE Sistema SHALL validate that the assigned rotaId belongs to the same Empresa as the Cliente

---

### Requirement 3: Driver Field on Carregamento

**User Story:** As a logistics coordinator, I want to assign a driver to a carregamento, so that I can track who is responsible for each load.

#### Acceptance Criteria

1. THE Sistema SHALL store an optional motorista field (name, up to 200 characters) on the Carregamento model
2. THE Sistema SHALL store an optional motoristaCpf field (CPF, up to 14 characters) on the Carregamento model
3. THE Sistema SHALL accept motorista and motoristaCpf fields when creating a Carregamento
4. THE Sistema SHALL accept motorista and motoristaCpf fields when updating a Carregamento
5. WHILE a Carregamento has status CONCLUIDO, THE Sistema SHALL reject updates to the motorista and motoristaCpf fields

---

### Requirement 4: Carregamento Cancellation

**User Story:** As a logistics coordinator, I want to cancel a carregamento with a reason, so that I can handle operational changes and return NFs/volumes to the available pool.

#### Acceptance Criteria

1. THE Sistema SHALL provide an API endpoint to cancel a Carregamento by setting its status to CANCELADO
2. WHEN a cancellation request is received, THE Sistema SHALL require a motivoCancelamento field (non-empty text)
3. WHEN a Carregamento is cancelled, THE Sistema SHALL dissociate all CarregamentoVolume records from the Carregamento
4. WHEN a Carregamento is cancelled, THE Sistema SHALL revert the status of each dissociated Volume back to EMBALADO
5. IF a cancellation request is received for a Carregamento with status CONCLUIDO, THEN THE Sistema SHALL reject the request with an error message indicating concluded loads cannot be cancelled
6. THE Sistema SHALL record the cancellation timestamp and the Usuário who performed the cancellation

---

### Requirement 5: Remove Volume from Carregamento

**User Story:** As a warehouse operator, I want to remove individual volumes from a carregamento, so that I can correct loading errors without cancelling the entire load.

#### Acceptance Criteria

1. THE Sistema SHALL provide an API endpoint to remove a specific Volume from a Carregamento by deleting the CarregamentoVolume record
2. WHEN a Volume is removed from a Carregamento, THE Sistema SHALL revert the Volume status back to EMBALADO
3. IF a removal request is received for a Carregamento with status CONCLUIDO, THEN THE Sistema SHALL reject the request with an error message
4. IF a removal request references a Volume not associated with the specified Carregamento, THEN THE Sistema SHALL return a not-found error
5. WHEN the last Volume is removed from a Carregamento, THE Sistema SHALL keep the Carregamento in its current status (not auto-cancel)

---

### Requirement 6: Carregamento Status Validation

**User Story:** As a system administrator, I want the system to enforce valid status transitions on carregamentos, so that operational integrity is maintained.

#### Acceptance Criteria

1. THE Sistema SHALL enforce the following valid Carregamento status transitions: PENDENTE → EM_CARREGAMENTO, EM_CARREGAMENTO → CONCLUIDO, PENDENTE → CANCELADO, EM_CARREGAMENTO → CANCELADO
2. IF a status transition request violates the allowed transitions, THEN THE Sistema SHALL reject the request with an error message specifying the current status and the attempted transition
3. WHEN a Carregamento transitions to EM_CARREGAMENTO, THE Sistema SHALL record the timestamp of the transition
4. WHEN a Carregamento transitions to CONCLUIDO, THE Sistema SHALL record the concluidoEm timestamp
5. WHILE a Carregamento has status CANCELADO, THE Sistema SHALL reject any further status transitions

---

### Requirement 7: Route Filter on Load Assembly

**User Story:** As a logistics coordinator, I want to filter NFs and volumes by route when assembling loads, so that I can group deliveries geographically.

#### Acceptance Criteria

1. THE Sistema SHALL provide an API endpoint to list available NFs/volumes for load assembly with an optional rotaId filter parameter
2. WHEN a rotaId filter is provided, THE Sistema SHALL return only NFs/volumes whose associated Pedido_de_Venda has the matching rotaId
3. THE Sistema SHALL support additional filter parameters: clienteId, nfNumero, serie, cidade, bairro, vendedorId, and date range (período)
4. THE Sistema SHALL support ordering of results by: NF number, route code, city, and bairro
5. THE Sistema SHALL return only NFs/volumes that are not already associated with an active (non-cancelled) Carregamento

---

### Requirement 8: Route Totalization

**User Story:** As a logistics coordinator, I want to see totals grouped by route when assembling loads, so that I can make informed decisions about load composition.

#### Acceptance Criteria

1. THE Sistema SHALL provide an API endpoint that returns totalization data grouped by Rota for the current filter criteria
2. THE Sistema SHALL calculate per-route totals including: quantity of NFs, total monetary value, total weight in kg, total number of boxes (volumes)
3. THE Sistema SHALL calculate a general totalization across all routes for the current filter criteria
4. WHEN items are marked (selected) for a load, THE Sistema SHALL recalculate totals based only on the marked items
5. THE Sistema SHALL return totalization data with precision of 2 decimal places for monetary values and 3 decimal places for weight

---

### Requirement 9: NF Selection for Load (Mark/Unmark)

**User Story:** As a logistics coordinator, I want to mark and unmark NFs for inclusion in a load, so that I can control exactly which deliveries go into each carregamento.

#### Acceptance Criteria

1. THE Sistema SHALL provide an API endpoint to mark one or more NFs as selected for load assembly (batch operation)
2. THE Sistema SHALL provide an API endpoint to unmark one or more NFs from load selection (batch operation)
3. THE Sistema SHALL provide an API endpoint to mark all NFs for a specific Rota in a single operation
4. THE Sistema SHALL provide an API endpoint to unmark all NFs for a specific Rota in a single operation
5. WHEN an NF is marked, THE Sistema SHALL set a flag (mapaOk) on the NF record indicating selection
6. THE Sistema SHALL persist the selection state so that it survives page navigation and session changes
7. IF a mark request references an NF already associated with an active Carregamento, THEN THE Sistema SHALL reject the request with an error message

---

### Requirement 10: Loading Map (Mapa de Carregamento) Generation

**User Story:** As a logistics coordinator, I want to generate a loading map with sequential numbering that groups all marked NFs, so that I have a formal dispatch document.

#### Acceptance Criteria

1. WHEN a loading map generation is requested, THE Sistema SHALL create a Mapa_de_Carregamento record with a sequential number unique per Empresa
2. THE Sistema SHALL assign the next sequential number by incrementing the highest existing map number for the Empresa
3. WHEN a Mapa_de_Carregamento is generated, THE Sistema SHALL associate all currently marked (mapaOk) NFs with the map
4. THE Sistema SHALL record on the Mapa_de_Carregamento: empresaId, número, data de emissão, veículo placa, motorista, motoristaCpf, observações, status, and the creating Usuário
5. THE Sistema SHALL set the initial Mapa_de_Carregamento status based on Coletor usage: AGUARDANDO_SEPARACAO when Coletor is enabled, EM_CARREGAMENTO when Coletor is not enabled
6. WHEN a Mapa_de_Carregamento is generated, THE Sistema SHALL clear the mapaOk flag on all associated NFs and store the map number reference instead
7. IF no NFs are currently marked, THEN THE Sistema SHALL reject the map generation request with an error message

---

### Requirement 11: Loading Map Status Flow

**User Story:** As a logistics coordinator, I want the loading map to follow a defined status flow, so that I can track the progress of each dispatch.

#### Acceptance Criteria

1. THE Sistema SHALL enforce the following Mapa_de_Carregamento status transitions: AGUARDANDO_SEPARACAO → EM_CARREGAMENTO → FINALIZADO
2. THE Sistema SHALL also allow the transition: EM_CARREGAMENTO → CANCELADO
3. THE Sistema SHALL also allow the transition: AGUARDANDO_SEPARACAO → CANCELADO
4. IF a status transition request violates the allowed transitions, THEN THE Sistema SHALL reject the request with a descriptive error message
5. WHEN a Mapa_de_Carregamento transitions to FINALIZADO, THE Sistema SHALL record the finalization timestamp

---

### Requirement 12: Loading Map Cancellation

**User Story:** As a logistics coordinator, I want to cancel a loading map, so that I can return NFs to the available pool when plans change.

#### Acceptance Criteria

1. THE Sistema SHALL provide an API endpoint to cancel a Mapa_de_Carregamento
2. WHEN a cancellation request is received, THE Sistema SHALL require a motivoCancelamento field (non-empty text)
3. WHEN a Mapa_de_Carregamento is cancelled, THE Sistema SHALL dissociate all NFs from the map, returning them to the available pool
4. WHEN a Mapa_de_Carregamento is cancelled, THE Sistema SHALL set the map status to CANCELADO
5. IF a cancellation request is received for a Mapa_de_Carregamento with status FINALIZADO, THEN THE Sistema SHALL reject the request
6. THE Sistema SHALL record the cancellation timestamp and the Usuário who performed the cancellation

---

### Requirement 13: Transfer NFs Between Loading Maps

**User Story:** As a logistics coordinator, I want to transfer NFs from one loading map to another, so that I can reorganize dispatches without cancelling entire maps.

#### Acceptance Criteria

1. THE Sistema SHALL provide an API endpoint to transfer one or more NFs from a source Mapa_de_Carregamento to a target Mapa_de_Carregamento
2. IF the source Mapa_de_Carregamento has status FINALIZADO, THEN THE Sistema SHALL reject the transfer request
3. IF the target Mapa_de_Carregamento has status FINALIZADO or CANCELADO, THEN THE Sistema SHALL reject the transfer request
4. WHEN NFs are transferred, THE Sistema SHALL update the map number reference on each transferred NF to the target map
5. THE Sistema SHALL record an audit log entry for each NF transfer operation including source map, target map, NF identifier, and Usuário

---

### Requirement 14: Loading Map Reissue

**User Story:** As a logistics coordinator, I want to reissue (reprint) a loading map, so that I can obtain a new copy of the dispatch document when needed.

#### Acceptance Criteria

1. THE Sistema SHALL provide an API endpoint to retrieve the complete data of a Mapa_de_Carregamento for reissue/reprint
2. THE Sistema SHALL return all associated NFs with their details (number, série, client, route, value, weight, volumes)
3. THE Sistema SHALL include the map header data: número, emissão, placa, motorista, observações, status
4. THE Sistema SHALL allow reissue for maps in any status (including CANCELADO and FINALIZADO) for historical reference

---

### Requirement 15: Map Closure (Fechamento do Mapa)

**User Story:** As a logistics coordinator, I want to close a loading map by confirming delivery receipt and recording merchandise returns, so that I can finalize the dispatch cycle.

#### Acceptance Criteria

1. THE Sistema SHALL provide an API endpoint to close (finalize) a Mapa_de_Carregamento
2. WHEN a closure request is received, THE Sistema SHALL accept a list of NFs with their delivery status (ENTREGUE or DEVOLVIDO)
3. WHEN an NF is marked as DEVOLVIDO, THE Sistema SHALL require a motivo (reason) for the return
4. WHEN a Mapa_de_Carregamento is closed, THE Sistema SHALL transition its status to FINALIZADO
5. IF a closure request is received for a Mapa_de_Carregamento not in status EM_CARREGAMENTO, THEN THE Sistema SHALL reject the request
6. THE Sistema SHALL record the closure timestamp and the Usuário who performed the closure

---

### Requirement 16: Route Field on Carregamento

**User Story:** As a logistics coordinator, I want to associate a route with a carregamento, so that I can filter and organize carregamentos by delivery route.

#### Acceptance Criteria

1. THE Sistema SHALL store an optional rotaId field on the Carregamento model referencing a Rota
2. THE Sistema SHALL accept rotaId when creating a Carregamento
3. THE Sistema SHALL accept rotaId when updating a Carregamento (if status is not CONCLUIDO or CANCELADO)
4. THE Sistema SHALL support filtering the carregamento list endpoint by rotaId
5. THE Sistema SHALL validate that the provided rotaId belongs to the same Empresa as the Carregamento

---

### Requirement 17: Expedition Reports

**User Story:** As a logistics manager, I want to generate expedition reports grouped by route and totals, so that I can monitor dispatch operations and plan logistics.

#### Acceptance Criteria

1. THE Sistema SHALL provide an API endpoint for "Total por Roteiro" report returning totals (NFs, value, weight, volumes) grouped by Rota for a given date range
2. THE Sistema SHALL provide an API endpoint for "Total Expedição" report returning overall expedition totals for a given date range
3. THE Sistema SHALL provide an API endpoint for "Consulta Mapa de Carregamento" returning a list of maps with filters: número, date range, status, motorista, placa
4. THE Sistema SHALL provide an API endpoint for "Romaneio" (packing list) report including route information and delivery sequence for a specific Mapa_de_Carregamento
5. THE Sistema SHALL return report data in a format suitable for both screen display and PDF generation
6. THE Sistema SHALL scope all report data to the authenticated user's Empresa

---

### Requirement 18: Route on Pedido de Venda

**User Story:** As a sales operator, I want the sales order to carry a route reference, so that downstream logistics processes can use it for load assembly.

#### Acceptance Criteria

1. THE Sistema SHALL store an optional rotaId field on the Pedido_de_Venda model referencing a Rota
2. WHEN a Pedido_de_Venda is created and the Cliente has a default Rota, THE Sistema SHALL auto-populate the rotaId from the Cliente's default Rota
3. THE Sistema SHALL allow the rotaId to be manually set or changed on a Pedido_de_Venda in status RASCUNHO
4. THE Sistema SHALL validate that the provided rotaId belongs to the same Empresa as the Pedido_de_Venda
5. WHILE a Pedido_de_Venda has status different from RASCUNHO, THE Sistema SHALL reject changes to the rotaId field unless performed by a user with administrative privileges
