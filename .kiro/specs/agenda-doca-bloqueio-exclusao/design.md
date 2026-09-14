# Design — Bloqueio de cancelamento de agendamento após entrada no pátio

## Overview

Este bugfix adiciona uma regra de máquina de estados ao cancelamento de
agendamentos da Agenda WMS: cancelar só é permitido enquanto o agendamento está
em `AGENDADO` (antes da entrada no pátio) e exige motivo válido. A partir de
`ESPERA` (veículo autorizado a entrar no pátio) o cancelamento é rejeitado.

A regra vive no backend (fonte da verdade), extraída para uma função pura
testável, e o frontend passa a refletir a regra (botão só em `AGENDADO`, modal
com motivo). Nenhuma alteração de schema — os campos de auditoria de
cancelamento já existem em `AgendaWms`.

## Architecture

```
Frontend  /wms/agenda/page.tsx
  └── botão "Cancelar" (só em AGENDADO) → modal com motivo
        └── PATCH /agenda-wms/:id/status { status: 'CANCELADO', motivoCancelamento }

Backend  agenda-wms.routes.ts  PATCH /:id/status
  └── decidirCancelamento(statusAtual, motivo)   [função pura, novo módulo]
        ├── statusAtual != AGENDADO            → { permitido: false, http: 422 }
        ├── motivo ausente/curto               → { permitido: false, http: 400 }
        └── AGENDADO + motivo válido           → { permitido: true }
  └── se permitido: grava status/ motivoCancelamento / canceladoPorId / canceladoEm
```

## Components and Interfaces

### 1. Função pura de decisão (novo arquivo)

`src/modules/agenda-wms/cancelamento-agenda.service.ts`

```ts
export const STATUS_PERMITE_CANCELAMENTO = 'AGENDADO' as const
export const MOTIVO_CANCELAMENTO_MIN = 10

export type DecisaoCancelamento =
  | { permitido: true }
  | { permitido: false; httpStatus: 422; mensagem: string }   // estado pós-entrada
  | { permitido: false; httpStatus: 400; mensagem: string }   // motivo inválido

export function decidirCancelamento(
  statusAtual: string,
  motivoCancelamento: string | null | undefined,
): DecisaoCancelamento {
  if (statusAtual !== STATUS_PERMITE_CANCELAMENTO) {
    return {
      permitido: false, httpStatus: 422,
      mensagem: `Não é possível cancelar: o veículo já foi autorizado a entrar no pátio (status atual: ${statusAtual}). Após a entrada, o agendamento deve seguir o fluxo.`,
    }
  }
  const motivo = (motivoCancelamento ?? '').trim()
  if (motivo.length < MOTIVO_CANCELAMENTO_MIN) {
    return {
      permitido: false, httpStatus: 400,
      mensagem: `Informe um motivo de cancelamento com ao menos ${MOTIVO_CANCELAMENTO_MIN} caracteres.`,
    }
  }
  return { permitido: true }
}
```

Só depende de `statusAtual` e `motivo` — sem acesso a banco, trivialmente testável
por property-based. `RECEBIDO`/`CANCELADO` também caem no ramo 422 (não são
`AGENDADO`), mantendo o bloqueio já existente.

### 2. Rota `PATCH /:id/status` (`agenda-wms.routes.ts`)

- Estender o schema do body para aceitar `motivoCancelamento` opcional:
  ```ts
  const statusSchema = z.object({
    status: z.enum([... , 'CANCELADO']),
    motivoCancelamento: z.string().optional(),
  })
  ```
- Após carregar `ag` (já filtrado por `{ id, empresaId }`), **antes** da
  transação, quando `status === 'CANCELADO'`:
  ```ts
  const decisao = decidirCancelamento(ag.status, body.motivoCancelamento)
  if (!decisao.permitido) return reply.status(decisao.httpStatus).send({ message: decisao.mensagem })
  ```
- Ao efetivar o cancelamento, gravar auditoria:
  ```ts
  data: { status: 'CANCELADO', motivoCancelamento: body.motivoCancelamento!.trim(),
           canceladoPorId: user.id, canceladoEm: new Date() }
  ```
- As demais transições (avanço de status) seguem exatamente como hoje, incluindo
  os efeitos colaterais (`NA_DOCA`/`CONFERINDO`/`RECEBIDO`). Só o ramo de
  cancelamento ganha a trava e a auditoria.

### 3. Frontend (`/wms/agenda/page.tsx`)

- Botão "Cancelar" renderizado **apenas** quando `ag.status === 'AGENDADO'`
  (hoje é `!= RECEBIDO && != CANCELADO`).
- Substituir o `confirm('Cancelar agendamento?')` por um modal (Mantine) com um
  `Textarea` de motivo (obrigatório) e botão confirmar.
- A mutation `avancarStatus`/uma nova `cancelarAgendamento` envia
  `{ status: 'CANCELADO', motivoCancelamento }`. Em erro 400/422, exibir a
  `message` do backend via `notifications`.

## Data Models

Nenhuma alteração de schema. O model `AgendaWms` (`prisma/schema.prisma`) **já
possui**: `motivoCancelamento String?`, `canceladoPorId String?`,
`canceladoEm DateTime?`. Passam a ser preenchidos no cancelamento.

**Checklist `database-migrations.md`: nenhum item aplicável — `schema.prisma` e
`migrate-prod.ts` não mudam.**

## Correctness Properties

### Property 1: Cancelamento bloqueado após entrada no pátio

Para qualquer `statusAtual != 'AGENDADO'` e qualquer motivo, `decidirCancelamento`
retorna `permitido: false` com `httpStatus: 422`.

**Validates: Requirements 1.1**

### Property 2: Cancelamento em AGENDADO exige motivo válido

Para `statusAtual == 'AGENDADO'`, `decidirCancelamento` retorna `permitido: true`
se, e somente se, o motivo (após trim) tiver comprimento ≥ `MOTIVO_CANCELAMENTO_MIN`;
caso contrário, `permitido: false` com `httpStatus: 400`.

**Validates: Requirements 1.2**

### Property 3: Determinismo e ausência de efeito colateral

`decidirCancelamento` é pura: mesma entrada produz sempre a mesma saída, sem
acesso a banco nem dependência de estado externo.

**Validates: Requirements 1.3**

## Error Handling

- Estado pós-entrada (`ESPERA`/`CONFIRMADO`/`NA_DOCA`/`CONFERINDO`/`CONFERIDO`/
  `RECEBIDO`/`CANCELADO`) → **HTTP 422** com mensagem explicativa; nada é gravado.
- `AGENDADO` sem motivo válido → **HTTP 400**; nada é gravado.
- Agendamento inexistente / de outra empresa → **HTTP 404** (comportamento atual
  já presente na rota via `findFirst({ id, empresaId })`).
- Frontend exibe a `message` do backend nos casos 400/422.

## Testing Strategy

- Property-based (fast-check) sobre `decidirCancelamento` cobrindo P1–P3.
- Testes de exemplo:
  - `AGENDADO` + motivo ≥ 10 chars → permitido.
  - `AGENDADO` + motivo vazio/curto → 400.
  - cada estado pós-entrada + motivo qualquer → 422.
- `tsc --noEmit` sem aumentar a baseline (~65 erros).
- Frontend: botão só em `AGENDADO`; modal exige motivo; erro do backend exibido.
- Revisar a suíte QA E2E (fluxo recebimento/portaria) para o novo 422.
