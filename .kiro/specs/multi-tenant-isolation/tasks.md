# Implementation Plan: Multi-Tenant Isolation

## Overview

This plan implements complete multi-tenant data isolation using Prisma Client Extensions. The approach is incremental: first build the extension and middleware infrastructure, then migrate the database in 3 phases, update the Prisma schema, and finally wire route handlers to use the scoped client. Each step builds on the previous one and ends with integration into the running system.

## Tasks

- [ ] 1. Create Prisma tenant extension factory
  - [ ] 1.1 Create `src/lib/prisma-tenant.ts` with the `ISOLATED_MODELS` allowlist and `createTenantExtension` function
    - Define the `ISOLATED_MODELS` array with all 20 models listed in the design
    - Implement `Prisma.defineExtension` with `$allOperations` handler
    - Handle read operations (findMany, findFirst, findUnique, findFirstOrThrow, findUniqueOrThrow, count, aggregate, groupBy): inject `empresaId` into `where`
    - Handle create: set `empresaId` in `data`, reject if caller provides a mismatched `empresaId`
    - Handle createMany: map over array data to set `empresaId` on each item
    - Handle update/updateMany: inject `empresaId` into `where`
    - Handle delete/deleteMany: inject `empresaId` into `where`
    - Handle upsert: inject `empresaId` into `where` and set on `create` data
    - Pass through unmodified for non-isolated models
    - _Requirements: 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 6.1, 6.2, 7.7_

  - [ ]* 1.2 Write property tests for tenant extension (fast-check + vitest)
    - **Property 1: Read operations inject empresaId non-destructively**
    - **Property 2: Create operations set empresaId**
    - **Property 3: Mismatched empresaId on create is rejected**
    - **Property 4: Upsert applies empresaId to both where and create**
    - **Property 5: Mutation operations scope by empresaId**
    - **Property 7: Non-isolated models are unaffected**
    - **Validates: Requirements 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 6.1, 6.2**

- [ ] 2. Create Fastify type augmentation and tenant context hook
  - [ ] 2.1 Create `src/types/fastify.d.ts` with `prismaScoped` declaration on `FastifyRequest`
    - Augment the `fastify` module to add `prismaScoped: PrismaClient` to `FastifyRequest`
    - _Requirements: 3.3_

  - [ ] 2.2 Create `src/middleware/tenant-context.ts` with the `registerTenantContext` function
    - Decorate request with `prismaScoped` (initial value `null`)
    - Add `onRequest` hook that runs after authentication
    - Skip if `request.user` is not set (unauthenticated routes)
    - If user perfil is `SUPER_ADMIN`, assign global `prisma` to `request.prismaScoped`
    - If user has no `empresaId` and is not SUPER_ADMIN, reply 403 with `Nenhuma empresa selecionada`
    - Otherwise create scoped client via `prisma.$extends(createTenantExtension(user.empresaId))`
    - _Requirements: 3.1, 3.2, 7.1, 7.2_

  - [ ]* 2.3 Write unit tests for tenant context hook
    - Test SUPER_ADMIN bypass assigns global prisma
    - Test missing empresaId returns 403
    - Test normal user gets scoped client
    - **Property 6: SUPER_ADMIN bypasses tenant filtering**
    - **Property 9: Tenant context rejection for missing empresaId**
    - **Validates: Requirements 3.2, 7.1, 7.2**

- [ ] 3. Register tenant context in server.ts
  - Import and call `registerTenantContext(app)` in `src/server.ts` after the authenticate middleware registration
  - Ensure the hook runs after JWT verification so `request.user` is available
  - _Requirements: 3.1, 3.3_

- [ ] 4. Checkpoint — Verify infrastructure compiles
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Database migration Phase 1 — Add nullable empresa_id columns
  - [ ] 5.1 Create Prisma migration file that adds nullable `empresa_id UUID` column to all 20 affected tables
    - Add FK constraint referencing `empresa(id)` on each column
    - Create index on `empresa_id` for each table
    - Tables: deposito, zona, estrutura, endereco, funcionario, doca, equipamento_movimentacao, funcao, forma_armazenagem, ambiente_armazenagem, classificacao_produto, tipo_carroceria, tipo_carga, veiculo_wms, nota_entrada, saldo_endereco, dados_logisticos_armazenagem, dados_logisticos_picking, dados_logisticos_expedicao, sku
    - _Requirements: 1.1, 1.2, 1.3_

- [ ] 6. Database migration Phase 2 — Backfill script
  - [ ] 6.1 Create `prisma/backfill-empresa-id.ts` script
    - Read default empresa ID from `DEFAULT_EMPRESA_ID` env var or query first empresa from DB
    - Iterate over all 20 affected tables
    - Execute `UPDATE table SET empresa_id = $1 WHERE empresa_id IS NULL` for each
    - Log count of updated records per table
    - Skip tables with zero null records and log accordingly
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [ ] 7. Database migration Phase 3 — Set NOT NULL and composite unique constraints
  - [ ] 7.1 Create Prisma migration that sets `empresa_id` to NOT NULL on all 20 tables
    - Add composite unique constraints: (empresa_id, matricula) on funcionario, (empresa_id, placa) on veiculo_wms, (empresa_id, numero) on nota_entrada
    - Drop any conflicting single-column unique constraints
    - _Requirements: 1.5, 9.1, 9.2_

- [ ] 8. Update Prisma schema with empresaId on all affected models
  - [ ] 8.1 Add `empresaId String @map("empresa_id")` field and `empresa Empresa @relation(...)` to each of the 20 affected models in `prisma/schema.prisma`
    - Add corresponding relation arrays on the `Empresa` model (depositos, zonas, estruturas, enderecos, funcionarios, docas, equipamentos, funcoes, formasArmazenagem, ambientesArmazenagem, classificacoesProduto, tiposCarroceria, tiposCarga, veiculosWms, notasEntrada, saldosEndereco, dadosLogisticosArm, dadosLogisticosPick, dadosLogisticosExp, skus)
    - Add `@@unique([empresaId, matricula])` on Funcionario, `@@unique([empresaId, placa])` on VeiculoWms, `@@unique([empresaId, numero])` on NotaEntrada
    - Run `npx prisma generate` to verify schema compiles
    - _Requirements: 2.1, 2.2_

- [ ] 9. Checkpoint — Verify schema and migrations
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Update route handlers to use request.prismaScoped
  - [ ] 10.1 Update WMS operational modules that use newly-isolated models
    - Replace `prisma` with `request.prismaScoped` in: `src/modules/deposito/`, `src/modules/zona/`, `src/modules/estrutura/`, `src/modules/endereco/`, `src/modules/funcionario/`, `src/modules/doca/`, `src/modules/equipamento/`, `src/modules/funcao/`, `src/modules/forma-armazenagem/`, `src/modules/ambiente-armazenagem/`, `src/modules/classificacao-produto/`, `src/modules/tipo-carroceria/`, `src/modules/tipo-carga/`, `src/modules/veiculo/`, `src/modules/nota-entrada/`, `src/modules/saldo/`, `src/modules/dados-logisticos/`, `src/modules/sku/`
    - Remove any manual `empresaId` filtering that existed in these handlers
    - _Requirements: 4.3, 5.1, 6.1, 6.2_

  - [ ] 10.2 Update modules that already had empresaId but used manual filtering
    - Replace manual `where: { empresaId }` patterns with `request.prismaScoped` in modules that already had tenant columns (agenda-wms, produto, fornecedor, cliente, transportadora, vendedor, pedido-compra, pedido-venda, conta-pagar, conta-receber, nfe, cte, estoque, onda-separacao, parametro, ficha-operacional, centro-distribuicao)
    - Verify these modules pass the `prismaScoped` client instead of the global `prisma`
    - _Requirements: 4.3_

  - [ ]* 10.3 Write integration tests for tenant isolation
    - Test full request lifecycle: authenticate → tenant context → scoped query → response contains only tenant data
    - Test cross-tenant isolation: create as tenant A, query as tenant B, verify empty result
    - Test update/delete on record from another tenant returns 404
    - **Property 8: Nested creates propagate empresaId**
    - **Validates: Requirements 4.1, 5.1, 6.3, 10.1**

- [ ] 11. Final checkpoint — Full system verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The 3-phase migration strategy ensures zero downtime: Phase 1 is safe (nullable column), Phase 2 backfills existing data, Phase 3 enforces constraints only after all data is clean
- Route handler updates (task 10) are the largest task by file count but each change is mechanical: replace `prisma` with `request.prismaScoped`
- Task 10 explicitly excludes deployment to production — that is handled outside this spec
