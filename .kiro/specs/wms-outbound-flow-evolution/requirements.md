# Requirements Document

## Introduction

This feature evolves the WMS outbound flow (Separação → Embalagem → Carregamento) with four key improvements: printable tracking sheets for manual mode operations, real-time monitoring views for supervisor oversight in collector/app mode, automatic status synchronization with Ordens de Serviço (OS), and granular stock balance management that tracks reserved, in-transit, and available quantities across each stage of the outbound process.

## Glossary

- **Sistema_WMS**: The Warehouse Management System backend (Fastify + Prisma + PostgreSQL)
- **Ficha_Acompanhamento**: A printable tracking sheet used by operators in manual mode to guide and record operations at each outbound stage
- **Monitor_Supervisao**: The real-time web interface used by supervisors to track progress of outbound operations performed via mobile app/collector
- **Onda_Separacao**: A wave grouping one or more sales orders for picking, packing, and shipping
- **Ordem_Servico (OS)**: An operational work order (OrdemServicoWms) that tracks who is performing an operation, start/end times, and status
- **Saldo_Endereco**: The stock balance at a specific warehouse address (enderecoId + produtoId + lote)
- **Estoque**: The aggregate stock record per product per company, including total quantity and reserved quantity
- **Item_Separacao**: An individual item to be picked, belonging to an OrdemSeparacao within an Onda
- **Volume**: A packed unit (box, pallet, bundle) containing one or more items ready for loading
- **Carregamento**: A loading operation that groups volumes to be loaded onto a vehicle at a dock
- **Operador**: A warehouse worker (Funcionario) performing physical operations via mobile app or paper sheets
- **Supervisor**: A user monitoring operations via the web interface
- **SKU**: Stock Keeping Unit record containing barcode (codigoBarra), dimensions, and packaging data for a product
- **DadosLogisticos**: Logistics configuration for a product including storage norms (FEFO/FIFO) and address assignments

## Requirements

### Requirement 1: Ficha de Acompanhamento — Separação

**User Story:** As an operator, I want a printable tracking sheet for the picking stage, so that I can follow the collection route and confirm each item manually.

#### Acceptance Criteria

1. WHEN a user requests a separação tracking sheet for an Onda_Separacao, THE Sistema_WMS SHALL generate a printable document containing all Item_Separacao records with product code, product name, barcode (from SKU codigoBarra), source address (enderecoCompleto), quantity to pick, and unit of measure
2. THE Ficha_Acompanhamento for separação SHALL order items by optimized collection route (rua → prédio → nível) consistent with the existing rota-coleta logic
3. WHEN a product has an associated SKU with codigoBarra, THE Sistema_WMS SHALL include the barcode value in the tracking sheet for scanner verification
4. THE Ficha_Acompanhamento for separação SHALL include a header with onda number, date, assigned employee name, and total items count
5. THE Ficha_Acompanhamento for separação SHALL include a checkbox column for the operator to mark each item as picked

### Requirement 2: Ficha de Acompanhamento — Embalagem

**User Story:** As an operator, I want a printable tracking sheet for the packing stage, so that I can verify which items go into each volume and record weight/dimensions.

#### Acceptance Criteria

1. WHEN a user requests an embalagem tracking sheet for an Onda_Separacao, THE Sistema_WMS SHALL generate a printable document grouped by Volume, listing each ItemVolume with product code, product name, quantity, and barcode
2. THE Ficha_Acompanhamento for embalagem SHALL include editable fields for weight (kg), length (cm), width (cm), and height (cm) per volume
3. THE Ficha_Acompanhamento for embalagem SHALL include the volume sequential code and type (CAIXA, PALETE, FARDO)
4. WHEN items from the onda have not yet been assigned to volumes, THE Sistema_WMS SHALL list them in a "Pendentes de Embalagem" section with product and quantity information

### Requirement 3: Ficha de Acompanhamento — Carregamento

**User Story:** As an operator, I want a printable tracking sheet for the loading stage, so that I can follow the loading sequence and confirm each volume is loaded.

#### Acceptance Criteria

1. WHEN a user requests a carregamento tracking sheet, THE Sistema_WMS SHALL generate a printable document listing all CarregamentoVolume records ordered by sequência, with volume code, type, weight, and dimensions
2. THE Ficha_Acompanhamento for carregamento SHALL include vehicle plate, dock description, and transportadora name in the header
3. THE Ficha_Acompanhamento for carregamento SHALL include a checkbox column for the operator to mark each volume as loaded
4. THE Ficha_Acompanhamento for carregamento SHALL display the total weight and total volume count as a summary footer

### Requirement 4: Monitor de Supervisão — Separação

**User Story:** As a supervisor, I want a real-time monitoring view of the picking operation, so that I can track progress without interrupting operators.

#### Acceptance Criteria

1. WHEN a supervisor accesses the separação monitoring view for an Onda_Separacao, THE Sistema_WMS SHALL return a progress summary with total items, items completed (SEPARADO or SEPARADO_PARCIAL), and items pending (PENDENTE)
2. THE Monitor_Supervisao for separação SHALL provide item-level detail including product name, source address, quantity requested, quantity picked, and current status (Pendente, Em Andamento, Concluído)
3. THE Monitor_Supervisao for separação SHALL support polling at 5-second intervals by returning data with a timestamp for client-side auto-refresh
4. WHEN an Item_Separacao status changes, THE Sistema_WMS SHALL reflect the updated status in the next monitoring response within 5 seconds

### Requirement 5: Monitor de Supervisão — Embalagem

**User Story:** As a supervisor, I want a real-time monitoring view of the packing operation, so that I can see how many items have been packed into volumes.

#### Acceptance Criteria

1. WHEN a supervisor accesses the embalagem monitoring view for an Onda_Separacao, THE Sistema_WMS SHALL return a progress summary with total separated items, items packed (linked to volumes), and items pending packing
2. THE Monitor_Supervisao for embalagem SHALL provide volume-level detail including volume code, type, item count, and completion percentage
3. THE Monitor_Supervisao for embalagem SHALL support polling at 5-second intervals by returning data with a timestamp for client-side auto-refresh
4. WHEN an ItemVolume is created, THE Sistema_WMS SHALL reflect the updated packing progress in the next monitoring response within 5 seconds

### Requirement 6: Monitor de Supervisão — Carregamento

**User Story:** As a supervisor, I want a real-time monitoring view of the loading operation, so that I can see which volumes have been loaded onto the vehicle.

#### Acceptance Criteria

1. WHEN a supervisor accesses the carregamento monitoring view, THE Sistema_WMS SHALL return a progress summary with total volumes, volumes loaded (carregadoEm not null), and volumes pending
2. THE Monitor_Supervisao for carregamento SHALL provide volume-level detail including sequence number, volume code, type, weight, and loading status (Pendente, Concluído)
3. THE Monitor_Supervisao for carregamento SHALL support polling at 5-second intervals by returning data with a timestamp for client-side auto-refresh
4. WHEN a CarregamentoVolume.carregadoEm is set, THE Sistema_WMS SHALL reflect the updated loading progress in the next monitoring response within 5 seconds

### Requirement 7: Status Synchronization — Separação OS

**User Story:** As a warehouse manager, I want the OS status to automatically reflect the separação progress, so that I have accurate operational tracking without manual updates.

#### Acceptance Criteria

1. WHEN separação starts for an Onda_Separacao (status changes to EM_SEPARACAO), THE Sistema_WMS SHALL update the linked OS with operacao SEPARACAO to status EXECUTANDO, set horaInicio to the current timestamp, and record the funcionarioId
2. WHEN separação completes for an Onda_Separacao (all items reach SEPARADO or SEPARADO_PARCIAL), THE Sistema_WMS SHALL update the linked OS with operacao SEPARACAO to status CONCLUIDO and set horaFim to the current timestamp
3. THE Sistema_WMS SHALL calculate tempoTotal as the difference between horaFim and horaInicio in minutes and store it in the OS record

### Requirement 8: Status Synchronization — Embalagem OS

**User Story:** As a warehouse manager, I want the OS status to automatically reflect the embalagem progress, so that packing time and personnel are tracked.

#### Acceptance Criteria

1. WHEN the first volume is created for an Onda_Separacao, THE Sistema_WMS SHALL update the linked OS with operacao EMBALAGEM to status EXECUTANDO, set horaInicio to the current timestamp, and record the funcionarioId
2. WHEN all separated items are fully packed into volumes (onda status becomes EMBALADA), THE Sistema_WMS SHALL update the linked OS with operacao EMBALAGEM to status CONCLUIDO and set horaFim to the current timestamp
3. THE Sistema_WMS SHALL calculate tempoTotal as the difference between horaFim and horaInicio in minutes and store it in the OS record

### Requirement 9: Status Synchronization — Carregamento OS

**User Story:** As a warehouse manager, I want the OS status to automatically reflect the carregamento progress, so that loading time and personnel are tracked.

#### Acceptance Criteria

1. WHEN the first volume is confirmed loaded in a Carregamento (first carregadoEm is set), THE Sistema_WMS SHALL update the linked OS with operacao CARREGAMENTO to status EXECUTANDO, set horaInicio to the current timestamp, and record the funcionarioId
2. WHEN all volumes in a Carregamento are confirmed loaded (carregamento status becomes CONCLUIDO), THE Sistema_WMS SHALL update the linked OS with operacao CARREGAMENTO to status CONCLUIDO and set horaFim to the current timestamp
3. THE Sistema_WMS SHALL calculate tempoTotal as the difference between horaFim and horaInicio in minutes and store it in the OS record

### Requirement 10: Stock Reservation on Onda Initiation

**User Story:** As a warehouse manager, I want stock to be reserved when a wave is initiated, so that other operations cannot allocate the same stock.

#### Acceptance Criteria

1. WHEN an Onda_Separacao is initiated (status changes to EM_SEPARACAO), THE Sistema_WMS SHALL increment Estoque.reservado by the total quantity requested across all Item_Separacao records for each product
2. WHILE an Onda_Separacao is in status EM_SEPARACAO, THE Sistema_WMS SHALL maintain SaldoEndereco.quantidade unchanged (stock remains physically at the address)
3. THE Sistema_WMS SHALL validate that Estoque.quantidade minus Estoque.reservado is greater than or equal to zero before allowing reservation
4. IF Estoque.quantidade minus existing Estoque.reservado is less than the requested reservation quantity, THEN THE Sistema_WMS SHALL return an error indicating insufficient available stock for the product

### Requirement 11: Stock Deduction on Separação Confirmation

**User Story:** As a warehouse manager, I want stock to leave the address when picking is confirmed, so that the address balance reflects physical reality.

#### Acceptance Criteria

1. WHEN an Item_Separacao is confirmed as separated (status changes to SEPARADO or SEPARADO_PARCIAL), THE Sistema_WMS SHALL decrement SaldoEndereco.quantidade by the quantidadeSeparada for the corresponding enderecoOrigemId and produtoId
2. WHEN an Item_Separacao is confirmed as separated, THE Sistema_WMS SHALL record a LogMovimentacao entry with tipo "SEPARACAO" capturing saldoAnterior and saldoNovo
3. IF SaldoEndereco.quantidade would become negative after deduction, THEN THE Sistema_WMS SHALL reject the confirmation and return an error indicating insufficient address balance

### Requirement 12: Final Stock Deduction on Carregamento Confirmation

**User Story:** As a warehouse manager, I want the final stock deduction to occur when loading is confirmed, so that the aggregate stock reflects goods that have left the warehouse.

#### Acceptance Criteria

1. WHEN a Carregamento is confirmed as CONCLUIDO, THE Sistema_WMS SHALL decrement Estoque.quantidade by the total quantity of all items across all loaded volumes
2. WHEN a Carregamento is confirmed as CONCLUIDO, THE Sistema_WMS SHALL decrement Estoque.reservado by the same quantity (releasing the reservation)
3. THE Sistema_WMS SHALL validate that Estoque.quantidade minus the deduction amount is greater than or equal to zero before applying the final deduction
4. IF the final deduction would result in negative Estoque.quantidade, THEN THE Sistema_WMS SHALL reject the carregamento confirmation and return an error indicating stock inconsistency

### Requirement 13: Stock View with Status Breakdown

**User Story:** As a warehouse manager, I want to see stock broken down by status (available, reserved, in transit), so that I can make informed allocation decisions.

#### Acceptance Criteria

1. WHEN a user queries the stock view for a product, THE Sistema_WMS SHALL return: quantidade total (Estoque.quantidade), reservado (Estoque.reservado), em trânsito (calculated from confirmed separações not yet loaded), and disponível (quantidade minus reservado minus em trânsito)
2. THE Sistema_WMS SHALL calculate "em trânsito" as the sum of quantidadeSeparada for all Item_Separacao with status SEPARADO or SEPARADO_PARCIAL whose parent Onda_Separacao has not yet reached status CONCLUIDA
3. THE Sistema_WMS SHALL return the stock breakdown in a single API response suitable for frontend rendering with distinct visual indicators per status
