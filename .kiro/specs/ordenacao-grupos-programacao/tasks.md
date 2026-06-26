# Implementation Plan: Ordenação de Grupos de Programação

## Overview

Implementação da reordenação manual de centros de produção no painel PCP via drag-and-drop. O backend recebe um campo `posicao` no modelo `CentroProducao`, um endpoint PATCH para reordenação em batch, e ajustes na listagem/criação. O frontend integra @dnd-kit com optimistic updates via @tanstack/react-query.

## Tasks

- [x] 1. Migração Prisma e modelo de dados
  - [x] 1.1 Criar migração Prisma adicionando campo `posicao` ao model CentroProducao
    - Adicionar `posicao Int @default(0)` ao model `CentroProducao` em `prisma/schema.prisma`
    - Criar migration com `npx prisma migrate dev --name add-posicao-centro-producao`
    - Incluir SQL de backfill na migration: atribuir posições sequenciais (ROW_NUMBER - 1) particionado por `empresa_id`, ordenado por `codigo ASC`
    - Executar `npx prisma generate` para atualizar o client
    - _Requirements: 1.1, 1.3_

- [x] 2. Lógica de negócio — funções puras de ordenação
  - [x] 2.1 Implementar função `calcularNovaPosicao`
    - Criar arquivo `src/modules/centro-producao/ordenacao.utils.ts`
    - Implementar `calcularNovaPosicao(existingPositions: number[]): number` que retorna `max(positions) + 1` (ou 0 se vazio)
    - Exportar a função para uso no handler de criação e nos testes
    - _Requirements: 1.2, 6.1_

  - [ ]* 2.2 Write property test for `calcularNovaPosicao`
    - **Property 1: Position auto-increment on creation**
    - **Property 6: Creation preserves existing positions**
    - **Validates: Requirements 1.2, 1.3, 6.1, 6.2**
    - Criar arquivo `tests/centro-producao/ordenacao.property.test.ts`
    - Usar fast-check para gerar arrays arbitrários de posições e verificar que o resultado é sempre `max + 1`
    - Verificar que array vazio retorna 0

  - [x] 2.3 Implementar função `aplicarReordenacao`
    - No mesmo arquivo `ordenacao.utils.ts`
    - Implementar `aplicarReordenacao(centros: {id: string, posicao: number}[], itens: {id: string, posicao: number}[]): {id: string, posicao: number}[]`
    - A função aplica as novas posições aos centros correspondentes
    - _Requirements: 2.1_

  - [ ]* 2.4 Write property test for `aplicarReordenacao`
    - **Property 2: Reorder updates all positions correctly**
    - **Validates: Requirements 2.1**
    - Gerar centros arbitrários e reordenações válidas, verificar que cada centro fica com a posição especificada

  - [x] 2.5 Implementar função `validarEmpresaCentros`
    - No mesmo arquivo `ordenacao.utils.ts`
    - Implementar `validarEmpresaCentros(idsRequisicao: string[], idsCentrosEmpresa: string[]): boolean`
    - Retorna `true` se todos os IDs da requisição pertencem à empresa
    - _Requirements: 2.2, 2.3_

  - [ ]* 2.6 Write property test for `validarEmpresaCentros`
    - **Property 3: Reorder rejects foreign IDs atomically**
    - **Validates: Requirements 2.2, 2.3**
    - Gerar conjuntos arbitrários de IDs, verificar que a função rejeita quando há IDs estranhos e aceita quando todos pertencem

  - [x] 2.7 Implementar função `ordenarCentros`
    - No mesmo arquivo `ordenacao.utils.ts`
    - Implementar `ordenarCentros(centros: {posicao: number, codigo: string}[]): typeof centros`
    - Ordena por `posicao ASC`, desempata por `codigo ASC`
    - _Requirements: 3.1, 3.2_

  - [ ]* 2.8 Write property test for `ordenarCentros`
    - **Property 5: List ordering invariant**
    - **Validates: Requirements 3.1, 3.2**
    - Gerar listas arbitrárias de centros, verificar que o resultado está ordenado por posicao ASC e desempatado por codigo ASC

- [x] 3. Checkpoint — Validar funções puras
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Endpoint PATCH de reordenação
  - [x] 4.1 Criar schema Zod de validação para o endpoint de reordenação
    - Adicionar schema `ordenarBodySchema` em `src/modules/centro-producao/centro-producao.schemas.ts` (ou arquivo de schemas existente)
    - Validar: array não vazio de objetos `{id: uuid, posicao: int >= 0}`
    - _Requirements: 2.4_

  - [ ]* 4.2 Write unit tests for validação do schema Zod
    - **Property 4: Invalid input validation**
    - **Validates: Requirements 2.4**
    - Testar casos concretos: array vazio, UUID inválido, posicao negativa, posicao decimal, campo faltando, body não-array
    - Arquivo: `tests/centro-producao/ordenacao.schema.test.ts`

  - [x] 4.3 Implementar handler do endpoint `PATCH /api/centros-producao/ordenar`
    - Adicionar rota em `src/modules/centro-producao/centro-producao.routes.ts`
    - Aplicar autenticação e `moduloGuard('PCP')` (já no escopo do plugin)
    - Validar body com schema Zod
    - Buscar centros da empresa do usuário para validação de propriedade
    - Usar `validarEmpresaCentros` para rejeitar IDs de outra empresa (403)
    - Executar `prisma.$transaction()` para atualizar posições em batch
    - Retornar `{ message: "Ordem atualizada com sucesso", count: N }`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 4.4 Write integration tests for endpoint de reordenação
    - Testar cenários: reordenação válida (200), IDs de outra empresa (403), payload inválido (400), sem autenticação (401)
    - Arquivo: `tests/centro-producao/ordenacao.integration.test.ts`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 5. Modificação na listagem e criação de centros
  - [x] 5.1 Alterar listagem `GET /api/centros-producao` para ordenar por posição
    - Modificar `orderBy` para `[{ posicao: 'asc' }, { codigo: 'asc' }]` no handler de listagem
    - Usar função `ordenarCentros` como referência de lógica
    - _Requirements: 3.1, 3.2_

  - [x] 5.2 Alterar criação `POST /api/centros-producao` para atribuir posição automática
    - Antes de criar, consultar `MAX(posicao)` para a empresa do usuário
    - Usar `calcularNovaPosicao` para determinar o valor
    - Atribuir `posicao = resultado` no novo registro
    - _Requirements: 1.2, 6.1, 6.2_

  - [ ]* 5.3 Write unit tests for criação com posição automática
    - Verificar que novo centro recebe posição correta
    - Verificar que centros existentes não são alterados
    - _Requirements: 1.2, 6.1, 6.2_

- [x] 6. Checkpoint — Validar backend completo
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Frontend — Hook de reordenação e integração @dnd-kit
  - [x] 7.1 Criar hook `useCentrosOrdenacao` com optimistic update
    - Criar em `src/hooks/useCentrosOrdenacao.ts` (workspace VisioFab.Wms.Front)
    - Usar `useMutation` do @tanstack/react-query
    - Implementar `onMutate` com optimistic update no cache da query de centros
    - Implementar `onError` com rollback usando snapshot do `onMutate`
    - Implementar `onSettled` para invalidar query
    - Chamar `PATCH /api/centros-producao/ordenar` via axios
    - _Requirements: 4.3, 4.5, 5.1_

  - [x] 7.2 Criar componente `SortableCentroItem` com @dnd-kit
    - Criar em `src/components/pcp/SortableCentroItem.tsx` (workspace VisioFab.Wms.Front)
    - Usar `useSortable` do `@dnd-kit/sortable`
    - Renderizar grip icon (ícone de arraste) com `listeners` e `attributes`
    - Aplicar `transform` e `transition` do CSS do @dnd-kit
    - _Requirements: 4.1, 4.2_

  - [x] 7.3 Integrar drag-and-drop na lista de centros do painel PCP
    - Adicionar `DndContext` + `SortableContext` no componente de abas PCP existente
    - Implementar handler `onDragEnd` que calcula novas posições e chama `useCentrosOrdenacao.mutate()`
    - Adicionar indicador visual de salvamento (spinner/opacity) enquanto mutação está pendente
    - Usar `closestCenter` como collision detection strategy
    - _Requirements: 4.2, 4.3, 4.4_

  - [ ]* 7.4 Write unit tests for hook `useCentrosOrdenacao`
    - Testar optimistic update no cache
    - Testar rollback em caso de erro
    - _Requirements: 4.3, 4.5_

  - [ ]* 7.5 Write unit tests for componente de lista com ordenação
    - Verificar renderização na ordem correta
    - Verificar presença do grip icon em cada item
    - _Requirements: 4.1, 3.3_

- [ ] 8. Frontend — Testes E2E
  - [ ]* 8.1 Write E2E tests para fluxo de drag-and-drop
    - Arquivo: `tests/e2e/ordenacao-centros.spec.ts` (workspace VisioFab.Wms.Front)
    - Testar fluxo completo: arrastar centro, verificar chamada API, verificar ordem final persistida
    - Testar cenário de erro: simular falha de rede, verificar rollback visual
    - _Requirements: 4.2, 4.3, 4.5, 5.1, 5.2_

- [x] 9. Final checkpoint — Validar integração completa
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The backend workspace is `VisioFab.Wms.Back`, frontend workspace is `VisioFab.Wms.Front`
- Prisma migration includes backfill SQL to assign sequential positions to existing records
- All backend logic uses `prisma.$transaction()` for atomicity
- Frontend uses last-write-wins strategy for concurrent edits (no optimistic locking needed)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.3", "2.5", "2.7", "4.1"] },
    { "id": 2, "tasks": ["2.2", "2.4", "2.6", "2.8", "4.2"] },
    { "id": 3, "tasks": ["4.3", "5.1", "5.2"] },
    { "id": 4, "tasks": ["4.4", "5.3", "7.1", "7.2"] },
    { "id": 5, "tasks": ["7.3", "7.4", "7.5"] },
    { "id": 6, "tasks": ["8.1"] }
  ]
}
```
