# Implementation Plan: Address Generation & Capacity Control

## Overview

This plan implements parameterized batch address generation (migrating from legacy Delphi) and a new weight/volume capacity validation service. The implementation progresses from database schema changes, through backend services and API endpoints, to frontend screens — each step building on the previous.

## Tasks

- [ ] 1. Database migration — Add capacity fields to Estrutura and new fields to Endereco
  - [ ] 1.1 Create Prisma migration adding `capacidade`, `largura`, `altura`, `comprimento`, `cubagem` columns to `estrutura` table (all Decimal, nullable)
    - `capacidade` Decimal(10,3) — max weight in kg
    - `largura` Decimal(10,3) — width in meters
    - `altura` Decimal(10,3) — height in meters
    - `comprimento` Decimal(10,3) — depth in meters
    - `cubagem` Decimal(10,6) — auto-calculated volume in m³
    - _Requirements: 4.1, 4.2, 4.3_
  - [ ] 1.2 Create Prisma migration adding `codigo_barras`, `area_armazenagem`, `forma_armazenagem_id`, `ambiente_armazenagem_id`, `classificacao_produto_id` columns to `endereco` table
    - `codigo_barras` VarChar(30), nullable
    - `area_armazenagem` VarChar(20), nullable (PULMAO or PICKING)
    - Add foreign key relations for `forma_armazenagem_id`, `ambiente_armazenagem_id`, `classificacao_produto_id`
    - _Requirements: 1.5, 8.1, 8.2, 8.3, 8.4_
  - [ ] 1.3 Update `schema.prisma` model definitions for `Estrutura` and `Endereco` with the new fields and relations
    - _Requirements: 4.1, 4.2, 4.3, 8.1, 8.2, 8.3, 8.4_

- [ ] 2. Implement AddressGenerationService
  - [ ] 2.1 Create `src/modules/endereco/address-generation.service.ts` with the `AddressGenerationService` class
    - Implement `generate(params: GenerationParams): Promise<GenerationResult>`
    - Implement `buildAddressList(params)` with nested iteration: Rua → Prédio → Nível → Apartamento
    - Implement `filterByLado(rua, lado)` — returns true for PAR if rua is even, IMPAR if odd, AMBOS always
    - Implement `formatSegment(value)` — zero-pads to 3 digits
    - Implement `generateBarcode(enderecoCompleto)` — generates unique barcode per address
    - _Requirements: 1.1, 1.4, 1.5, 1.6, 1.7_
  - [ ] 2.2 Implement parameter validation in AddressGenerationService
    - Validate start ≤ end for each range (Rua, Prédio, Nível, Apartamento)
    - Validate referenced Depósito, Zona, Estrutura exist in database
    - Validate Área de Armazenagem is PULMAO or PICKING
    - Return descriptive error messages identifying the invalid parameter
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [ ] 2.3 Implement duplicate detection using Prisma `createMany` with `skipDuplicates`
    - Return summary with `criados` (created count) and `ignorados` (skipped count)
    - Ensure all generated addresses carry estruturaId, zonaId, classificacaoProdutoId, ambienteArmazenagemId
    - _Requirements: 2.1, 2.2, 2.3, 8.1, 8.2, 8.3, 8.4_
  - [ ]* 2.4 Write property tests for address generation (Properties 1, 2, 3, 4, 5, 10, 11)
    - Create `src/modules/endereco/__tests__/address-generation.property.test.ts`
    - **Property 1: Address format composition** — random segments (1-999) produce correct DEP-ZONA-RRR-PPP-NNN-AAA format
    - **Property 2: Lado parity filtering** — PAR generates only even Rua, IMPAR only odd
    - **Property 3: Generation order invariant** — addresses appear in Rua→Prédio→Nível→Apto nested order
    - **Property 4: Duplicate detection count invariant** — criados + ignorados = total candidates
    - **Property 5: Range validation rejects invalid ranges** — start > end always rejected
    - **Property 10: Generated addresses carry all associations** — all FK fields set correctly
    - **Property 11: Barcode uniqueness within batch** — no duplicate barcodes in a batch
    - **Validates: Requirements 1.1, 1.4, 1.5, 1.6, 1.7, 2.2, 2.3, 3.1, 8.1–8.4**

- [ ] 3. Implement ValidadorCapacidade service
  - [ ] 3.1 Create `src/modules/endereco/validador-capacidade.service.ts` with the `ValidadorCapacidade` class
    - Implement `validar(input: CapacityCheckInput): Promise<CapacityCheckResult>`
    - Implement `getUtilization(enderecoId): Promise<CapacityUtilization>`
    - Implement `calcularPesoAtual(enderecoId)` — sums (SaldoEndereco.quantidade × Sku.pesoBruto) for all products at address
    - Implement `calcularVolumeAtual(enderecoId)` — sums (SaldoEndereco.quantidade × Sku.volume) for all products at address
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 7.3, 7.4_
  - [ ] 3.2 Implement graceful degradation rules in ValidadorCapacidade
    - Skip weight validation if Estrutura.capacidade is null/zero or Sku.pesoBruto is null
    - Skip volume validation if Estrutura.cubagem is null/zero or Sku.volume is null
    - Skip all validation if Endereco has no associated Estrutura (allow operation)
    - _Requirements: 5.5, 6.5, 6.6_
  - [ ]* 3.3 Write property tests for capacity validation (Properties 7, 8, 9)
    - Create `src/modules/endereco/__tests__/capacity-validation.property.test.ts`
    - **Property 7: Weight capacity enforcement** — allowed iff currentWeight + incomingWeight ≤ capacidade
    - **Property 8: Volume capacity enforcement** — allowed iff currentVolume + incomingVolume ≤ cubagem
    - **Property 9: Capacity utilization calculation** — percentage = (current / limit) × 100, remaining = limit − current
    - **Validates: Requirements 5.1–5.4, 6.1–6.4, 7.1–7.4**

- [ ] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Extend Estrutura CRUD with capacity fields and auto-cubagem
  - [ ] 5.1 Update `src/modules/estrutura/estrutura.routes.ts` POST and PUT endpoints
    - Accept `capacidade`, `largura`, `altura`, `comprimento` in request body (Zod schema)
    - Auto-calculate `cubagem = largura × altura × comprimento` when all three dimensions are provided
    - Persist cubagem alongside the other fields
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [ ]* 5.2 Write property test for cubagem auto-calculation (Property 6)
    - Create `src/modules/estrutura/__tests__/estrutura-capacity.property.test.ts`
    - **Property 6: Cubagem auto-calculation** — for any non-null largura, altura, comprimento: cubagem = largura × altura × comprimento
    - **Validates: Requirements 4.3, 4.4**

- [ ] 6. Refactor POST /api/enderecos/gerar endpoint to use AddressGenerationService
  - [ ] 6.1 Replace inline generation logic in `src/modules/endereco/endereco.routes.ts` POST `/gerar`
    - Update Zod schema to accept full GenerationParams (add `lado`, `areaArmazenagem`, `situacao`, `classificacaoProdutoId`, `ambienteArmazenagemId`, `formaArmazenagemId`)
    - Delegate to `AddressGenerationService.generate()`
    - Return `{ criados, ignorados, total }` response
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4_

- [ ] 7. Add capacity API endpoints
  - [ ] 7.1 Add `GET /api/enderecos/:id/capacidade` endpoint in `endereco.routes.ts`
    - Validate endereco exists (404 if not)
    - Call `ValidadorCapacidade.getUtilization(enderecoId)`
    - Return CapacityUtilization JSON
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [ ] 7.2 Add `POST /api/enderecos/validar-capacidade` endpoint in `endereco.routes.ts`
    - Accept `{ enderecoId, produtoId, quantidade }` body
    - Call `ValidadorCapacidade.validar(input)`
    - Return CapacityCheckResult JSON (422 if rejected with motivo)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4_
  - [ ]* 7.3 Write unit tests for capacity endpoints
    - Test 404 for non-existent address
    - Test successful utilization response shape
    - Test 422 rejection when capacity exceeded
    - Test graceful skip when no Estrutura associated
    - _Requirements: 5.5, 6.5, 6.6, 7.1–7.4_

- [ ] 8. Checkpoint — Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Integrate ValidadorCapacidade with enderecamento flow
  - [ ] 9.1 Call `ValidadorCapacidade.validar()` in the enderecamento-automatico and sugestao-endereco services before placing products
    - If validation rejects, return 422 with capacity exceeded message
    - If Endereco has no Estrutura, skip validation (allow operation)
    - _Requirements: 5.3, 5.4, 5.5, 6.3, 6.4_
  - [ ]* 9.2 Write integration tests for capacity validation in enderecamento flow
    - Test that storage is blocked when weight exceeds capacity
    - Test that storage is blocked when volume exceeds cubagem
    - Test that storage proceeds when no Estrutura is associated
    - _Requirements: 5.3, 5.4, 5.5, 6.3, 6.4, 6.5, 6.6_

- [ ] 10. Frontend — Address generation form page
  - [ ] 10.1 Create `VisioFab.Wms.Front/src/app/(interna)/configurador/enderecos/gerar/page.tsx`
    - Form with Mantine UI + React Hook Form
    - Fields: Depósito (select), Zona (select), Estrutura (select), Classificação de Produto (select), Ambiente de Armazenagem (select), Área de Armazenagem (radio: PULMÃO/PICKING), Situação (select), Lado (radio: Par/Ímpar/Ambos)
    - Range inputs for Rua (início/fim), Prédio (início/fim), Nível (início/fim), Apartamento (início/fim)
    - Submit calls `POST /api/enderecos/gerar` via TanStack Query mutation
    - Display result summary (criados, ignorados, total)
    - Client-side validation: start ≤ end for each range
    - _Requirements: 1.2, 1.3_
  - [ ] 10.2 Add navigation entry for the generation page in the configurador sidebar
    - _Requirements: 1.2_

- [ ] 11. Frontend — Estrutura capacity fields in edit form
  - [ ] 11.1 Extend the Estrutura edit form to include capacity fields
    - Add `capacidade` (kg), `largura` (m), `altura` (m), `comprimento` (m) number inputs
    - Display calculated `cubagem` (m³) as read-only field, auto-updated when dimensions change
    - Submit includes capacity fields in PUT request
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [ ] 12. Frontend — Capacity indicator component
  - [ ] 12.1 Create reusable `IndicadorCapacidade` component
    - Visual progress bars for weight utilization (%) and volume utilization (%)
    - Display remaining capacity in kg and m³
    - Color coding: green (< 70%), yellow (70-90%), red (> 90%)
    - Fetch data from `GET /api/enderecos/:id/capacidade`
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [ ] 12.2 Integrate `IndicadorCapacidade` in the endereco detail/list views where applicable
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [ ] 13. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (Properties 1–11)
- The existing `POST /gerar` endpoint is refactored (not duplicated) to use the new service
- ValidadorCapacidade is a standalone service that can be called from any storage operation (enderecamento, ressuprimento, etc.)
