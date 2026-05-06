# Requirements Document

## Introduction

This document specifies the requirements for implementing full multi-tenant data isolation in the VisioFab WMS system using the direct `empresaId` column strategy (Option B). The system currently has partial tenant isolation — some tables already carry `empresaId` while others (primarily WMS operational tables) do not. This feature completes the isolation by adding `empresaId` to all remaining tables, enforcing automatic tenant filtering on every query, and preventing cross-tenant data access at the application layer.

## Glossary

- **Tenant**: A single empresa (company) using the VisioFab WMS system; identified by a unique `empresaId`.
- **Empresa**: The entity representing a tenant in the database (`empresa` table).
- **Tenant_Context**: The runtime object that holds the authenticated user's `empresaId`, extracted from the JWT token and made available to all route handlers.
- **Tenant_Middleware**: A Prisma client extension or middleware that automatically injects `empresaId` filters on reads and sets `empresaId` on writes.
- **Super_Admin**: A user with the `SUPER_ADMIN` perfil who can access data across all tenants for support and maintenance purposes.
- **Isolated_Table**: Any database table that carries an `empresa_id` column and is subject to tenant filtering.
- **Backfill_Migration**: A database migration that populates `empresa_id` for existing records that were created before tenant isolation was enforced.
- **Cross_Tenant_Access**: An attempt by a user of one tenant to read, modify, or delete data belonging to a different tenant.

## Requirements

### Requirement 1: Schema Migration — Add empresa_id Column

**User Story:** As a system administrator, I want all WMS operational tables to have an `empresa_id` column, so that every record can be associated with a specific tenant.

#### Acceptance Criteria

1. WHEN the migration is executed, THE Schema_Migration SHALL add a nullable `empresa_id` column of type UUID to each of the following tables: `deposito`, `zona`, `estrutura`, `endereco`, `funcionario`, `doca`, `equipamento_movimentacao`, `funcao`, `forma_armazenagem`, `ambiente_armazenagem`, `classificacao_produto`, `tipo_carroceria`, `tipo_carga`, `veiculo_wms`, `nota_entrada`, `saldo_endereco`, `ordem_servico` (legacy), `dados_logisticos_armazenagem`, `dados_logisticos_picking`, `dados_logisticos_expedicao`, `sku`.
2. WHEN the migration is executed, THE Schema_Migration SHALL add a foreign key constraint from `empresa_id` to the `empresa.id` column on each affected table.
3. WHEN the migration is executed, THE Schema_Migration SHALL create an index on `empresa_id` for each affected table to support efficient tenant-scoped queries.
4. WHEN the backfill step is executed, THE Backfill_Migration SHALL assign the existing default empresa's ID to all records where `empresa_id` is null.
5. WHEN the backfill is complete, THE Schema_Migration SHALL alter the `empresa_id` column to NOT NULL on each affected table.

### Requirement 2: Prisma Schema Update

**User Story:** As a developer, I want the Prisma schema to reflect the new `empresaId` field on all affected models, so that type safety and relations are enforced at the ORM level.

#### Acceptance Criteria

1. THE Prisma_Schema SHALL declare an `empresaId` field with `@map("empresa_id")` and a relation to the `Empresa` model on each of the following models: `Deposito`, `Zona`, `Estrutura`, `Endereco`, `Funcionario`, `Doca`, `EquipamentoMovimentacao`, `Funcao`, `FormaArmazenagem`, `AmbienteArmazenagem`, `ClassificacaoProduto`, `TipoCarroceria`, `TipoCarga`, `VeiculoWms`, `NotaEntrada`, `SaldoEndereco`, `OrdemServico` (legacy), `DadosLogisticosArmazenagem`, `DadosLogisticosPicking`, `DadosLogisticosExpedicao`, `Sku`.
2. THE Prisma_Schema SHALL add corresponding relation arrays on the `Empresa` model for each newly related model.

### Requirement 3: Tenant Context Extraction

**User Story:** As a developer, I want the `empresaId` to be automatically extracted from the JWT token on every authenticated request, so that route handlers can access it without manual parsing.

#### Acceptance Criteria

1. WHEN an authenticated request is received, THE Tenant_Context SHALL extract the `empresaId` claim from the verified JWT payload.
2. IF the JWT payload does not contain an `empresaId` claim and the user's perfil is not `SUPER_ADMIN`, THEN THE Tenant_Context SHALL reject the request with HTTP 403 and a message indicating that no tenant is selected.
3. THE Tenant_Context SHALL make the extracted `empresaId` available on the Fastify request object for all downstream route handlers.

### Requirement 4: Automatic Query Filtering (Reads)

**User Story:** As a product owner, I want every database read to be automatically scoped to the authenticated user's tenant, so that tenants cannot see each other's data.

#### Acceptance Criteria

1. WHEN a `findMany`, `findFirst`, `findUnique`, or `count` operation is executed on an Isolated_Table, THE Tenant_Middleware SHALL inject a `where: { empresaId }` filter using the value from the Tenant_Context.
2. WHEN a `findMany` operation is executed on an Isolated_Table, THE Tenant_Middleware SHALL append the `empresaId` filter to any existing `where` clause without overwriting user-provided filters.
3. WHILE the Tenant_Context contains a valid `empresaId`, THE Tenant_Middleware SHALL apply the filter to all read operations without requiring explicit code in each route handler.

### Requirement 5: Automatic Tenant Assignment (Writes)

**User Story:** As a product owner, I want every new record to be automatically tagged with the authenticated user's tenant, so that data ownership is always established at creation time.

#### Acceptance Criteria

1. WHEN a `create` or `createMany` operation is executed on an Isolated_Table, THE Tenant_Middleware SHALL set the `empresaId` field to the value from the Tenant_Context.
2. IF a `create` operation on an Isolated_Table already specifies an `empresaId` value that differs from the Tenant_Context value and the user is not a Super_Admin, THEN THE Tenant_Middleware SHALL reject the operation with an error indicating a tenant mismatch.
3. WHEN an `upsert` operation is executed on an Isolated_Table, THE Tenant_Middleware SHALL apply the `empresaId` filter on the `where` clause and set `empresaId` on the `create` data.

### Requirement 6: Cross-Tenant Mutation Prevention

**User Story:** As a product owner, I want update and delete operations to be restricted to the authenticated user's tenant, so that one tenant cannot modify or remove another tenant's data.

#### Acceptance Criteria

1. WHEN an `update` or `updateMany` operation is executed on an Isolated_Table, THE Tenant_Middleware SHALL inject `empresaId` into the `where` clause to scope the mutation to the current tenant.
2. WHEN a `delete` or `deleteMany` operation is executed on an Isolated_Table, THE Tenant_Middleware SHALL inject `empresaId` into the `where` clause to scope the deletion to the current tenant.
3. IF an `update` or `delete` operation targets a record that does not belong to the current tenant, THEN THE Tenant_Middleware SHALL prevent the operation and return an error indicating the record was not found within the tenant scope.

### Requirement 7: Super-Admin Bypass

**User Story:** As a super-admin, I want to access data across all tenants, so that I can provide support and perform maintenance tasks.

#### Acceptance Criteria

1. WHILE the authenticated user has the `SUPER_ADMIN` perfil, THE Tenant_Middleware SHALL skip automatic `empresaId` filtering on read operations.
2. WHILE the authenticated user has the `SUPER_ADMIN` perfil, THE Tenant_Middleware SHALL allow write operations without injecting or validating `empresaId`.
3. WHERE the Super_Admin provides an explicit `empresaId` in the request body or query parameters, THE Tenant_Middleware SHALL use that value to scope operations to the specified tenant.

### Requirement 8: Backfill Existing Data

**User Story:** As a system administrator, I want all existing records to be assigned to the current empresa, so that the system remains functional after enabling tenant isolation.

#### Acceptance Criteria

1. WHEN the backfill script is executed, THE Backfill_Migration SHALL identify all records in the affected tables where `empresa_id` is NULL.
2. WHEN the backfill script is executed, THE Backfill_Migration SHALL assign the designated default empresa ID to all NULL `empresa_id` records.
3. WHEN the backfill is complete, THE Backfill_Migration SHALL report the count of updated records per table.
4. IF a table has zero records, THEN THE Backfill_Migration SHALL skip that table and log a message indicating no records required backfill.

### Requirement 9: Tenant-Aware Unique Constraints

**User Story:** As a developer, I want unique constraints on tenant-scoped tables to include `empresaId`, so that different tenants can have records with the same natural key without conflicts.

#### Acceptance Criteria

1. WHERE a table has a business-unique field (e.g., `codigo`, `matricula`, `placa`), THE Schema_Migration SHALL create a composite unique constraint that includes `empresa_id` alongside the business key.
2. THE Schema_Migration SHALL drop any existing single-column unique constraints that conflict with the new composite unique constraints.

### Requirement 10: Tenant Isolation for Cascading Relations

**User Story:** As a developer, I want child records that inherit tenant scope through their parent to remain consistent, so that orphaned or cross-tenant child records cannot exist.

#### Acceptance Criteria

1. WHEN a parent record on an Isolated_Table is created, THE Tenant_Middleware SHALL ensure that any nested `create` operations on child Isolated_Tables also receive the same `empresaId`.
2. WHEN a query includes nested `include` or `select` on related Isolated_Tables, THE Tenant_Middleware SHALL apply the `empresaId` filter to the nested relations.
3. IF a child record references a parent record from a different tenant, THEN THE Tenant_Middleware SHALL reject the operation with an error indicating a cross-tenant relation violation.
