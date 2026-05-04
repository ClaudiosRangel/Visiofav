# Requirements Document

## Introduction

This feature enhances the WMS addressing (endereçamento) flow for received goods by introducing a dual-mode operation: Manual Addressing and Collector/App Monitoring (Acompanhamento). Both modes generate mandatory address labels (etiquetas) after each item is addressed. The feature also improves address suggestion logic using logistics data (DadosLogisticosArmazenagem) and fixes the employee selection dropdown in the addressing modal.

## Glossary

- **Addressing_System**: The WMS module responsible for assigning warehouse addresses to received and checked goods (endereçamento)
- **Manual_Mode**: The addressing operation mode where the operator selects destination addresses via the web interface
- **Collector_Mode**: The addressing operation mode where the operator performs addressing via a mobile barcode scanner/app while the web interface shows real-time monitoring
- **Address_Label**: A printed label (etiqueta de endereço) containing address barcode, product code, product name, quantity, lot, and expiry date
- **Addressing_Sheet**: A printable form (ficha de endereçamento) listing items to be addressed with blank fields for the operator to fill in destination addresses
- **Address_Suggestion_Engine**: The logic component that recommends destination addresses based on logistics data, product consolidation, and available free addresses
- **DadosLogisticosArmazenagem**: The storage logistics data record for a product containing tipoNorma (FEFO/FIFO), enderecoFixoId, and pulmaoRegulador
- **Employee_Selector**: The dropdown component in the addressing modal that loads available warehouse employees (funcionários) for assignment to the addressing work order
- **Nota_Conferida**: An inbound invoice (nota de entrada) that has completed the checking process and is ready for addressing (status = CONFERIDA)
- **SaldoEndereco**: The stock balance record for a product at a specific warehouse address
- **Endereco**: A warehouse address identified by depósito, zona, rua, prédio, nível, and apto codes

## Requirements

### Requirement 1: Dual-Mode Selection

**User Story:** As a warehouse supervisor, I want to choose between manual addressing and collector/app monitoring mode, so that I can operate according to the available resources and workflow preference.

#### Acceptance Criteria

1. WHEN the operator opens the addressing tab for a Nota_Conferida, THE Addressing_System SHALL display a mode selection with two options: Manual_Mode and Collector_Mode
2. WHEN the operator selects Manual_Mode, THE Addressing_System SHALL display the item listing with address suggestions and editable destination fields
3. WHEN the operator selects Collector_Mode, THE Addressing_System SHALL display the real-time monitoring view with progress tracking

### Requirement 2: Manual Addressing Item Listing

**User Story:** As a warehouse operator, I want to see all items to be addressed with suggested addresses, so that I can confirm or change the destination for each item.

#### Acceptance Criteria

1. WHEN Manual_Mode is active for a Nota_Conferida, THE Addressing_System SHALL display a table listing all items with columns: item number, product code, product name, quantity, lot, expiry date, suggested address, and an editable destination address field
2. WHEN the item listing is displayed, THE Address_Suggestion_Engine SHALL compute and display a suggested address for each item based on logistics data
3. WHEN the operator changes the destination address for an item, THE Addressing_System SHALL validate that the selected address exists and is available for storage
4. WHEN the operator confirms all item addresses, THE Addressing_System SHALL execute the addressing for each item by creating SaldoEndereco records and updating stock

### Requirement 3: Address Suggestion Logic

**User Story:** As a warehouse operator, I want the system to suggest optimal addresses based on product logistics data, so that I can address items efficiently following warehouse rules.

#### Acceptance Criteria

1. WHEN a product has a DadosLogisticosArmazenagem record with a non-null enderecoFixoId, THE Address_Suggestion_Engine SHALL suggest the fixed address as the primary recommendation
2. WHEN a product has existing stock (SaldoEndereco with quantity greater than zero) at an address, THE Address_Suggestion_Engine SHALL suggest that address for consolidation
3. WHEN no fixed address or consolidation address is available, THE Address_Suggestion_Engine SHALL suggest the first available free address sorted by rua, then prédio, then nível
4. WHEN the DadosLogisticosArmazenagem.tipoNorma is FEFO, THE Address_Suggestion_Engine SHALL prioritize addresses that group products by expiry date in ascending order
5. WHEN the DadosLogisticosArmazenagem.tipoNorma is FIFO, THE Address_Suggestion_Engine SHALL prioritize addresses that group products by receipt date in ascending order
6. IF no available address is found, THEN THE Address_Suggestion_Engine SHALL display a warning message indicating no addresses are available

### Requirement 4: Addressing Sheet Generation and Import

**User Story:** As a warehouse operator, I want to print an addressing sheet and later import the filled sheet to auto-fill addresses, so that I can perform addressing on paper and digitize the results.

#### Acceptance Criteria

1. WHEN the operator requests to print the addressing sheet in Manual_Mode, THE Addressing_System SHALL generate an HTML document listing all items with blank address fields and a unique barcode identifier
2. THE Addressing_System SHALL format the addressing sheet with columns: item number, product code, product name, quantity, lot, expiry date, and a blank destination address field
3. WHEN the operator uploads a filled addressing sheet (PDF or image), THE Addressing_System SHALL process the document using OCR to extract destination addresses for each item
4. WHEN OCR processing completes, THE Addressing_System SHALL display the extracted addresses with confidence scores for operator review and correction
5. WHEN the operator confirms the OCR-extracted addresses, THE Addressing_System SHALL populate the destination address fields in the item listing

### Requirement 5: Collector/App Monitoring Mode

**User Story:** As a warehouse supervisor, I want to monitor addressing progress in real-time while operators use mobile collectors, so that I can track completion without interrupting the workflow.

#### Acceptance Criteria

1. WHEN Collector_Mode is active, THE Addressing_System SHALL display a progress bar showing the ratio of addressed items to total items (X/Y format)
2. WHILE Collector_Mode is active, THE Addressing_System SHALL auto-refresh the addressing status every 5 seconds
3. WHEN an item is addressed via the mobile app, THE Addressing_System SHALL update the monitoring view to reflect the new status within the next refresh cycle
4. WHEN all items are addressed in Collector_Mode, THE Addressing_System SHALL display a completion indicator and enable the finalization action
5. THE Addressing_System SHALL display a monitoring table with columns: item number, product code, product name, quantity, destination address, and status (Pendente/Endereçado)

### Requirement 6: Mandatory Address Labels

**User Story:** As a warehouse operator, I want address labels generated for every addressed item, so that I can physically identify products at their storage locations.

#### Acceptance Criteria

1. WHEN an item is successfully addressed in Manual_Mode, THE Addressing_System SHALL generate an address label for that item
2. WHEN an item is successfully addressed in Collector_Mode, THE Addressing_System SHALL generate an address label for that item automatically
3. THE Addressing_System SHALL include the following data on each address label: address barcode (scannable), product code, product name, quantity, lot number, and expiry date
4. WHEN the operator requests label output, THE Addressing_System SHALL support HTML format for browser-based printing
5. WHEN the operator requests label output, THE Addressing_System SHALL support ZPL format for thermal label printers
6. WHEN batch addressing completes (all items of a Nota_Conferida), THE Addressing_System SHALL offer a batch print option for all generated labels

### Requirement 7: Employee Selection Fix

**User Story:** As a warehouse supervisor, I want the employee selection dropdown to load correctly in the addressing modal, so that I can assign operators to the addressing work order.

#### Acceptance Criteria

1. WHEN the addressing modal opens and requires employee assignment, THE Employee_Selector SHALL load the list of available employees from the API
2. THE Employee_Selector SHALL enable the query only when the modal is visible (enabled condition based on modal open state)
3. WHEN the employee list loads successfully, THE Employee_Selector SHALL display employees formatted as "matricula — nome"
4. IF the employee API request fails, THEN THE Employee_Selector SHALL display an error notification and allow retry

### Requirement 8: Address Label Format — HTML

**User Story:** As a warehouse operator, I want to print address labels from the browser, so that I can use a standard printer when a thermal printer is unavailable.

#### Acceptance Criteria

1. THE Addressing_System SHALL generate HTML labels with a layout suitable for printing on A4 paper (multiple labels per page)
2. THE Addressing_System SHALL render the address barcode as a Code128 barcode image within the HTML label
3. THE Addressing_System SHALL format the label with clearly separated fields: barcode at top, product code and name in the middle, quantity and lot/expiry at the bottom

### Requirement 9: Address Label Format — ZPL

**User Story:** As a warehouse operator, I want to generate ZPL commands for thermal printers, so that I can print durable labels directly on Zebra-compatible printers.

#### Acceptance Criteria

1. THE Addressing_System SHALL generate valid ZPL II commands for each address label
2. THE Addressing_System SHALL encode the address barcode using Code128 in the ZPL output
3. THE Addressing_System SHALL format the ZPL label to fit standard 100mm x 50mm thermal label stock
4. WHEN the operator requests ZPL output, THE Addressing_System SHALL return the ZPL commands as a downloadable text file or send directly to a configured printer endpoint

### Requirement 10: Addressing Completion and Status Update

**User Story:** As a warehouse supervisor, I want the system to update the nota status and close the work order when all items are addressed, so that the inbound flow is properly concluded.

#### Acceptance Criteria

1. WHEN all items of a Nota_Conferida are addressed, THE Addressing_System SHALL update the nota status from CONFERIDA to ENDERECADA
2. WHEN addressing completes, THE Addressing_System SHALL close the associated ENDERECAMENTO work order (OrdemServicoWms) with status CONCLUIDO
3. WHEN addressing completes, THE Addressing_System SHALL record a LogMovimentacao entry for each addressed item with tipo ENDERECAMENTO
4. WHEN addressing completes in Manual_Mode, THE Addressing_System SHALL trigger batch label generation for all addressed items
