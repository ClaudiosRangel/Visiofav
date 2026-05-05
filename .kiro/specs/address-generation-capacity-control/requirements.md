# Requirements Document

## Introduction

This feature implements two capabilities for the VisioFab WMS web system:

1. **Parameterized Automatic Address Generation** — A screen that migrates the batch address generation functionality from the legacy Delphi system (CadEnderecoAutomatico.pas) to the web platform. The screen allows operators to define ranges for Rua, Prédio, Nível, and Apartamento, along with classification parameters, to generate addresses in bulk following the format DEP-ZONA-RUA-PREDIO-NIVEL-APTO.

2. **Weight/Volume Capacity Validation** — A new business rule (not present in the Delphi system) that validates whether a product can be stored at a given address by checking that the cumulative weight and volume of products already stored at that address, plus the incoming product, does not exceed the structure's defined capacity (EST_CAPACIDADE) and volume (EST_CUBAGEM).

## Glossary

- **Sistema_Geracao_Endereco**: The backend module responsible for generating addresses in batch based on parameterized ranges.
- **Tela_Geracao_Endereco**: The web frontend screen that collects generation parameters from the operator.
- **Validador_Capacidade**: The service that validates weight and volume constraints before allowing product storage at an address.
- **Endereco**: A storage position in the warehouse, identified by the composite code DEP-ZONA-RUA-PREDIO-NIVEL-APTO.
- **Estrutura**: The physical racking structure type associated with an address, defining its capacity and volume limits.
- **SaldoEndereco**: The inventory balance record tracking product quantities stored at each address.
- **Sku**: The product unit configuration containing weight (pesoLiquido, pesoBruto) and dimensional (largura, altura, comprimento, volume) data.
- **Deposito**: A warehouse (depot) within a distribution center.
- **Zona**: A zone (neighborhood) within a depot used for logical grouping of addresses.
- **Capacidade**: The maximum weight (in kg) that a structure position can support.
- **Cubagem**: The maximum volume (in m³) that a structure position can accommodate, calculated as Largura × Altura × Comprimento.
- **Codigo_Barras_Endereco**: A barcode generated for each address to enable scanning operations.
- **Area_Armazenagem**: The storage area type, either PULMÃO (bulk/reserve) or PICKING (order picking).
- **Lado**: The side parameter for address generation, either Par (even) or Ímpar (odd).

## Requirements

### Requirement 1: Parameterized Address Generation

**User Story:** As a warehouse operator, I want to generate addresses in batch using parameterized ranges, so that I can quickly set up new storage areas without creating each address manually.

#### Acceptance Criteria

1. WHEN the operator submits generation parameters, THE Sistema_Geracao_Endereco SHALL generate addresses using nested iteration in the order: Rua → Prédio → Nível → Apartamento.
2. THE Tela_Geracao_Endereco SHALL require the following parameters: Depósito, Zona, Estrutura, Classificação de Produto, Ambiente de Armazenagem, Área de Armazenagem (PULMÃO or PICKING), Situação, and Lado (Par or Ímpar).
3. THE Tela_Geracao_Endereco SHALL require start and end range values for each of: Rua, Prédio, Nível, and Apartamento.
4. WHEN generating each address, THE Sistema_Geracao_Endereco SHALL compose the enderecoCompleto field using the format DEP-ZONA-RUA-PREDIO-NIVEL-APTO with each segment zero-padded to 3 digits.
5. WHEN generating each address, THE Sistema_Geracao_Endereco SHALL generate a unique Codigo_Barras_Endereco for the address.
6. WHEN the Lado parameter is set to Par, THE Sistema_Geracao_Endereco SHALL generate only addresses where the Rua number is even.
7. WHEN the Lado parameter is set to Ímpar, THE Sistema_Geracao_Endereco SHALL generate only addresses where the Rua number is odd.

### Requirement 2: Duplicate Address Prevention

**User Story:** As a warehouse operator, I want the system to prevent duplicate addresses from being created, so that data integrity is maintained.

#### Acceptance Criteria

1. WHEN generating addresses, THE Sistema_Geracao_Endereco SHALL check each enderecoCompleto against existing records before creation.
2. IF a generated enderecoCompleto already exists in the database, THEN THE Sistema_Geracao_Endereco SHALL skip that address and continue generating the remaining addresses.
3. WHEN generation completes, THE Sistema_Geracao_Endereco SHALL return a summary containing the count of addresses created and the count of addresses skipped due to duplication.

### Requirement 3: Generation Parameter Validation

**User Story:** As a warehouse operator, I want the system to validate my input parameters before starting generation, so that I do not waste time on invalid configurations.

#### Acceptance Criteria

1. WHEN the operator submits generation parameters, THE Sistema_Geracao_Endereco SHALL validate that the start value is less than or equal to the end value for each range (Rua, Prédio, Nível, Apartamento).
2. WHEN the operator submits generation parameters, THE Sistema_Geracao_Endereco SHALL validate that the referenced Depósito, Zona, and Estrutura exist in the database.
3. IF any validation fails, THEN THE Sistema_Geracao_Endereco SHALL return a descriptive error message identifying the invalid parameter without creating any addresses.
4. WHEN the operator submits generation parameters, THE Sistema_Geracao_Endereco SHALL validate that the Área de Armazenagem value is either PULMÃO or PICKING.

### Requirement 4: Structure Capacity and Volume Configuration

**User Story:** As a warehouse administrator, I want to define weight capacity and volume limits for each structure type, so that the system can enforce physical constraints during storage operations.

#### Acceptance Criteria

1. THE Estrutura model SHALL store a capacidade field representing the maximum weight (in kg) that each position of that structure type can support.
2. THE Estrutura model SHALL store largura, altura, and comprimento fields representing the physical dimensions (in meters) of each position.
3. THE Estrutura model SHALL store a cubagem field representing the maximum volume (in m³) calculated as largura × altura × comprimento.
4. WHEN the administrator saves an Estrutura with largura, altura, and comprimento values, THE Sistema_Geracao_Endereco SHALL automatically calculate and persist the cubagem value.

### Requirement 5: Weight Capacity Validation on Storage

**User Story:** As a warehouse operator, I want the system to validate weight capacity before storing products at an address, so that I do not overload the physical structure.

#### Acceptance Criteria

1. WHEN a product storage operation is requested for an Endereco, THE Validador_Capacidade SHALL calculate the total current weight at that address by summing (SaldoEndereco.quantidade × Sku.pesoBruto) for all products stored at that address.
2. WHEN a product storage operation is requested, THE Validador_Capacidade SHALL calculate the incoming weight as the quantity to be stored multiplied by the Sku.pesoBruto of the product.
3. WHEN the sum of current weight plus incoming weight exceeds the Estrutura.capacidade associated with the Endereco, THE Validador_Capacidade SHALL reject the storage operation with an error message indicating the weight limit would be exceeded.
4. WHEN the sum of current weight plus incoming weight is within the Estrutura.capacidade, THE Validador_Capacidade SHALL allow the storage operation to proceed.
5. IF the Endereco has no associated Estrutura, THEN THE Validador_Capacidade SHALL allow the storage operation without weight validation.

### Requirement 6: Volume Capacity Validation on Storage

**User Story:** As a warehouse operator, I want the system to validate volume capacity before storing products at an address, so that I do not exceed the physical space available.

#### Acceptance Criteria

1. WHEN a product storage operation is requested for an Endereco, THE Validador_Capacidade SHALL calculate the total current volume at that address by summing (SaldoEndereco.quantidade × Sku.volume) for all products stored at that address.
2. WHEN a product storage operation is requested, THE Validador_Capacidade SHALL calculate the incoming volume as the quantity to be stored multiplied by the Sku.volume of the product.
3. WHEN the sum of current volume plus incoming volume exceeds the Estrutura.cubagem associated with the Endereco, THE Validador_Capacidade SHALL reject the storage operation with an error message indicating the volume limit would be exceeded.
4. WHEN the sum of current volume plus incoming volume is within the Estrutura.cubagem, THE Validador_Capacidade SHALL allow the storage operation to proceed.
5. IF the Sku does not have volume data defined, THEN THE Validador_Capacidade SHALL skip volume validation and allow the storage operation based on weight validation only.
6. IF the Estrutura does not have cubagem defined (value is zero or null), THEN THE Validador_Capacidade SHALL skip volume validation for that address.

### Requirement 7: Capacity Utilization Query

**User Story:** As a warehouse operator, I want to see the current capacity utilization of an address, so that I can make informed decisions about where to store products.

#### Acceptance Criteria

1. WHEN the operator queries an Endereco, THE Validador_Capacidade SHALL return the current weight utilization as a percentage of the Estrutura.capacidade.
2. WHEN the operator queries an Endereco, THE Validador_Capacidade SHALL return the current volume utilization as a percentage of the Estrutura.cubagem.
3. WHEN the operator queries an Endereco, THE Validador_Capacidade SHALL return the remaining available weight capacity in kg.
4. WHEN the operator queries an Endereco, THE Validador_Capacidade SHALL return the remaining available volume capacity in m³.

### Requirement 8: Address Generation with Structure Association

**User Story:** As a warehouse operator, I want generated addresses to be automatically associated with the selected structure, so that capacity validation is immediately available for new addresses.

#### Acceptance Criteria

1. WHEN generating addresses with an Estrutura parameter specified, THE Sistema_Geracao_Endereco SHALL associate each generated Endereco with the specified Estrutura via the estruturaId field.
2. WHEN generating addresses, THE Sistema_Geracao_Endereco SHALL associate each generated Endereco with the specified Zona via the zonaId field.
3. WHEN generating addresses, THE Sistema_Geracao_Endereco SHALL associate each generated Endereco with the specified Classificação de Produto via the classificacaoProdutoId field.
4. WHEN generating addresses, THE Sistema_Geracao_Endereco SHALL associate each generated Endereco with the specified Ambiente de Armazenagem via the ambienteArmazenagemId field.
