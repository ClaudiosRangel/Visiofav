# Implementation Plan

## Overview

Implementar exceções de calendário por centro/data no motor do Gantt, com CRUD, persistência idempotente e reflexo na segmentação visual. Ordem: schema+migração → motor puro + testes → rota do timeline → CRUD → frontend (cadastro + Gantt).

## Task Dependency Graph

```json
{
  "waves": [
    ["1"],
    ["2", "3"],
    ["4", "5"],
    ["6", "7"]
  ],
  "dependencies": {
    "1": [],
    "2": ["1"],
    "3": ["2"],
    "4": ["1", "2"],
    "5": ["1"],
    "6": ["5"],
    "7": ["4"]
  }
}
```

## Tasks

- [x] 1. Schema `ExcecaoTurno` + migração idempotente
  - Adicionar model `ExcecaoTurno` em `prisma/schema.prisma` + relação inversa em `CentroProducao`.
  - Adicionar `CREATE TABLE IF NOT EXISTS excecao_turno` + índices em `prisma/migrate-prod.ts` (idempotente).
  - `npx prisma generate`.
  - _Requirements: 1.1, 5.1, 5.2_

- [x] 2. Motor puro: `janelaDoDia` + exceções em avançar/snap
  - Em `timeline-agenda.service.ts`: tipo `ExcecaoCalendario`, função `janelaDoDia`, parâmetro `excecoes` em `calcularFimComTurno`/`ajustarParaTurno`, campo `excecoes` em `EtapaAgenda`, propagação em `calcularInicioPorFila`/`calcularTimelineOp`/`calcularAgenda`.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Testes do motor (vitest + fast-check)
  - Estender `timeline-agenda.service.test.ts`: Properties 1-4 + goldens (hora extra, dia extra, não-trabalho).
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. Rota do timeline carrega e entrega exceções
  - `timeline-producao.routes.ts`: carregar `ExcecaoTurno` por empresa, agrupar por centro, anexar a `EtapaAgenda`, incluir `excecoesPorCentro` no payload.
  - _Requirements: 4.4_

- [x] 5. CRUD `excecao-turno.routes.ts` + registro em server.ts
  - GET/POST/PUT/DELETE com `empresaId` explícito, validação Zod, 409 duplicado, 404 cross-empresa.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3_

- [x] 6. Frontend — tela de cadastro de exceções
  - `pcp/cadastros/excecoes-calendario/page.tsx` (seletor centro + DataTablePadrao + modal). Item no ModuleSidebar.
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6_

- [x] 7. Frontend — Gantt reflete exceções na segmentação
  - `pcp/gantt/page.tsx`: `intervalosForaDoTurno` consome `excecoesPorCentro` via porta JS de `janelaDoDia`.
  - _Requirements: 4.1, 4.2, 4.3_

## Notes

- Backend e frontend são repos separados; schema.prisma + migrate-prod.ts no MESMO commit.
- Recurso aditivo: sem exceções, comportamento idêntico ao atual (Property 1).
- Postgres local indisponível → idempotência garantida por `IF NOT EXISTS`.
