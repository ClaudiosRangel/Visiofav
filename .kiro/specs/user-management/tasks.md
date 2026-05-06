# Implementation Plan: User Management

## Overview

Full-stack implementation of the User Management feature for VisioFab WMS. The backend extends the existing Fastify + Prisma stack with enhanced `/api/usuarios` endpoints (pagination, filtering, permissions, coletor linking) protected by a new `perfilGuard` middleware. The frontend evolves the existing `UsuariosPage` into a complete management screen with modal forms, permission checkboxes, and coletor toggle. The auth login endpoint is updated to reject deactivated users.

## Tasks

- [ ] 1. Create perfilGuard middleware
  - [ ] 1.1 Create `src/middleware/perfil-guard.ts` implementing the `perfilGuard` factory function
    - Accept a spread of perfil strings (e.g., `'ADMIN'`)
    - Extract `request.user.perfil` and return 403 `{ message: 'Acesso não autorizado' }` if not included
    - Follow the same Fastify preHandler pattern as `modulo-guard.ts`
    - _Requirements: 7.1_

  - [ ]* 1.2 Write property test for perfilGuard (Property 9)
    - **Property 9: Non-ADMIN users are denied access to user management**
    - For any authenticated user with perfil other than ADMIN, the guard SHALL return 403
    - For any user with perfil ADMIN, the guard SHALL allow the request through
    - Use fast-check to generate arbitrary perfil strings and verify behavior
    - **Validates: Requirements 7.1**

- [ ] 2. Enhance usuario.routes.ts with full CRUD, permissions, and coletor endpoints
  - [ ] 2.1 Implement `GET /usuarios` with pagination, search, and funcionário join
    - Accept query params: `page` (default 1), `limit` (default 20), `search` (optional)
    - Filter by nome or email case-insensitive using Prisma `contains` with `mode: 'insensitive'`
    - Include funcionário relation via `Funcionario` where `usuarioId` matches
    - Return `{ data, total, page, limit, totalPages }`
    - Apply `authenticate` + `perfilGuard('ADMIN')` as preHandlers
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6_

  - [ ]* 2.2 Write property test for search filter (Property 1)
    - **Property 1: Search filter returns only matching results**
    - For any list of users and any non-empty search term, all returned users must contain the term in nome or email (case-insensitive)
    - Use fast-check to generate arbitrary user lists and search terms
    - **Validates: Requirements 1.4**

  - [ ] 2.3 Implement `GET /usuarios/:id` with permissions and funcionário link
    - Return single user with their `UsuarioEmpresa.modulos` and linked `Funcionario`
    - Return 404 if user not found
    - Apply `authenticate` + `perfilGuard('ADMIN')` as preHandlers
    - _Requirements: 3.1, 4.5_

  - [ ] 2.4 Implement `POST /usuarios` for admin user creation
    - Validate body with Zod: nome (min 3), email (valid email), senha (min 6), perfil (enum), funcionarioId (optional uuid)
    - Hash password with bcrypt before storing
    - Create `UsuarioEmpresa` record linking to the admin's current empresa with modulos `"*"`
    - If `funcionarioId` provided, update `Funcionario.usuarioId` to the new user's id
    - Return 409 if email already exists, 404 if funcionarioId not found, 409 if funcionario already linked
    - Apply `authenticate` + `perfilGuard('ADMIN')` as preHandlers
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ]* 2.5 Write property test for input validation (Property 2)
    - **Property 2: Input validation correctness**
    - For any nome < 3 chars, invalid email, or senha < 6 chars, validation SHALL reject
    - For any valid nome >= 3, valid email, and senha >= 6, validation SHALL pass
    - Use fast-check to generate arbitrary strings and verify Zod schema behavior
    - **Validates: Requirements 2.2**

  - [ ]* 2.6 Write property test for password hashing (Property 3)
    - **Property 3: Password is always stored as a bcrypt hash**
    - For any plain-text password, the stored value SHALL be a valid bcrypt hash and SHALL NOT equal the input
    - Use fast-check to generate arbitrary password strings
    - **Validates: Requirements 2.3, 3.3**

  - [ ] 2.7 Implement `PUT /usuarios/:id` for updating user fields
    - Validate body with Zod: nome (optional), perfil (optional enum), status (optional boolean), senha (optional string min 6)
    - If senha provided and non-empty, hash with bcrypt before updating
    - If senha absent or empty string, do not modify the existing senha
    - Return 404 if user not found
    - Apply `authenticate` + `perfilGuard('ADMIN')` as preHandlers
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ]* 2.8 Write property test for password preservation (Property 4)
    - **Property 4: Omitting password preserves existing hash**
    - For any update request without senha (or with empty string), the stored senha SHALL remain unchanged
    - Use fast-check to generate arbitrary update payloads
    - **Validates: Requirements 3.4**

  - [ ] 2.9 Implement `PUT /usuarios/:id/modulos` for module permission management
    - Validate body: `{ modulos: string[] }` where each item is one of WMS, COMPRAS, VENDAS, FINANCEIRO, FISCAL (or `["*"]`)
    - If all 5 modules selected, store as `"*"`; otherwise store as comma-separated string
    - Update the `UsuarioEmpresa` record for the user's empresa
    - Return 404 if user or UsuarioEmpresa not found
    - Apply `authenticate` + `perfilGuard('ADMIN')` as preHandlers
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 2.10 Write property test for module serialization (Property 5)
    - **Property 5: Module selection serialization round-trip**
    - For any subset of modules, storing and reading back SHALL produce the same set
    - When all modules selected, stored value SHALL be `"*"`; parsing `"*"` SHALL expand to full set
    - Use fast-check to generate arbitrary subsets of the module list
    - **Validates: Requirements 4.2, 4.3**

  - [ ] 2.11 Implement `PUT /usuarios/:id/coletor` for funcionário linking
    - Validate body: `{ enabled: boolean, funcionarioId?: string }`
    - When `enabled=true`: require `funcionarioId`, verify funcionario exists and is not linked to another user, set `Funcionario.usuarioId` to current user id
    - When `enabled=false`: find the funcionario currently linked to this user and set its `usuarioId` to null
    - Return 404 if funcionario not found, 409 if already linked to another user
    - Apply `authenticate` + `perfilGuard('ADMIN')` as preHandlers
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6, 5.7_

  - [ ]* 2.12 Write property test for available funcionarios filter (Property 6)
    - **Property 6: Available funcionarios excludes already-linked ones**
    - For any set of funcionarios, the available query SHALL return only those with `usuarioId IS NULL` or `usuarioId` equals the current user
    - No funcionario linked to a different user SHALL appear
    - Use fast-check to generate arbitrary funcionario sets with various linking states
    - **Validates: Requirements 5.6**

  - [ ] 2.13 Implement `DELETE /usuarios/:id` as soft delete (set status=false)
    - Instead of deleting the record, update `status` to `false`
    - Return 404 if user not found
    - Apply `authenticate` + `perfilGuard('ADMIN')` as preHandlers
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 2.14 Write property test for soft delete (Property 7)
    - **Property 7: Soft delete preserves record with inactive status**
    - For any user deactivation, the record SHALL still exist with `status = false`
    - The total count of user records SHALL not decrease
    - Use fast-check to generate arbitrary user records and verify post-delete state
    - **Validates: Requirements 6.2, 6.3**

  - [ ] 2.15 Add `GET /usuarios/funcionarios-disponiveis` endpoint
    - Return funcionarios where `usuarioId IS NULL` (available for linking)
    - Accept optional `usuarioId` query param to also include the funcionario currently linked to that user
    - Apply `authenticate` + `perfilGuard('ADMIN')` as preHandlers
    - _Requirements: 5.6_

- [ ] 3. Update auth login to reject deactivated users
  - [ ] 3.1 Modify `POST /auth/login` in `src/modules/auth/auth.routes.ts`
    - After finding the user by email, check if `usuario.status === false`
    - If deactivated, return 401 with `{ message: 'Conta desativada. Contate o administrador' }` before password comparison
    - _Requirements: 6.6_

  - [ ]* 3.2 Write property test for deactivated user login rejection (Property 8)
    - **Property 8: Deactivated users cannot authenticate**
    - For any user with `status = false` and any valid credentials, login SHALL be rejected
    - Use fast-check to generate arbitrary credential pairs for deactivated users
    - **Validates: Requirements 6.6**

- [ ] 4. Checkpoint - Backend complete
  - Ensure all backend tests pass, ask the user if questions arise.

- [ ] 5. Create frontend usePerfilGuard hook and update navigation
  - [ ] 5.1 Create `src/hooks/usePerfilGuard.ts` hook
    - Decode JWT from localStorage to extract user perfil
    - If perfil does not match the required value, redirect to `/dashboard` and show notification "Acesso não autorizado"
    - Follow the same pattern as `useModuloGuard.ts`
    - _Requirements: 7.1, 7.2_

  - [ ] 5.2 Hide "Usuários" menu item from navigation for non-ADMIN users
    - Conditionally render the menu item based on decoded JWT perfil
    - _Requirements: 7.3_

- [ ] 6. Implement enhanced UsuariosPage with paginated table and server-side search
  - [ ] 6.1 Refactor `src/app/(interna)/configurador/usuarios/page.tsx`
    - Add `usePerfilGuard('ADMIN')` call on mount
    - Replace client-side filtering with server-side search via `GET /usuarios?page=X&search=Y`
    - Add debounced search input (300ms) that triggers server-side filtering
    - Implement pagination controls using the `totalPages` from API response
    - Add columns: Nome, Email, Perfil, Status (Ativo/Inativo badge), Coletor (funcionário nome or "—"), Ações
    - Add loading overlay while fetching
    - Show "Nenhum registro encontrado" empty state
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ] 6.2 Add row actions: Edit (pencil icon) and Deactivate (trash icon)
    - Edit opens the UserFormModal in edit mode
    - Deactivate shows confirmation dialog "Deseja desativar o usuário [nome]?" then calls `DELETE /usuarios/:id`
    - Refresh list after successful deactivation
    - _Requirements: 6.1, 6.4_

- [ ] 7. Implement UserFormModal component (create and edit modes)
  - [ ] 7.1 Create `UserFormModal` component with shared form for create/edit
    - **Create mode**: fields nome, email, senha (required), perfil select, funcionario select (optional)
    - **Edit mode**: email read-only, senha optional (placeholder "Deixe vazio para manter"), perfil, status toggle, nome
    - Use React Hook Form with Zod validation
    - On successful submit: close modal, show success notification, invalidate query cache
    - On error: show error notification with message from API
    - _Requirements: 2.1, 2.2, 2.4, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ] 7.2 Add PermissionsSection to edit modal
    - Render checkboxes for: WMS, COMPRAS, VENDAS, FINANCEIRO, FISCAL
    - Add "Selecionar todos" checkbox that toggles all
    - Show warning text "Usuário ficará sem acesso a módulos" when none selected
    - Load current permissions from `GET /usuarios/:id` response
    - Save via `PUT /usuarios/:id/modulos` on form submit
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ] 7.3 Add ColetorToggle section to edit modal
    - Switch component for enabling/disabling coletor access
    - When enabled: show Select dropdown populated from `GET /usuarios/funcionarios-disponiveis?usuarioId=X`
    - Show validation error "Selecione um funcionário para habilitar o acesso ao coletor" if enabled without selection
    - Save via `PUT /usuarios/:id/coletor` on form submit
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

- [ ] 8. Checkpoint - Frontend complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ]* 9. Write integration tests for critical flows
  - [ ]* 9.1 Write integration test: create user → verify hashed password and UsuarioEmpresa record
    - **Validates: Requirements 2.3, 2.5**
  - [ ]* 9.2 Write integration test: update modules → verify UsuarioEmpresa.modulos field
    - **Validates: Requirements 4.2, 4.3**
  - [ ]* 9.3 Write integration test: enable/disable coletor → verify Funcionario.usuarioId linking
    - **Validates: Requirements 5.3, 5.4**
  - [ ]* 9.4 Write integration test: deactivate user → verify status=false and login rejection
    - **Validates: Requirements 6.2, 6.6**

- [ ] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties using fast-check
- Unit tests validate specific examples and edge cases
- The existing `UsuariosPage` already has basic structure — task 6 refactors it rather than creating from scratch
- No database schema changes are needed; all models already exist in Prisma
