# Bugfix — Bloquear cancelamento de agendamento após autorização de entrada no pátio

## Introduction

Na Agenda de Docas (Agenda WMS), o botão "Cancelar" (ícone X vermelho) da tela
`/wms/agenda` dispara `PATCH /agenda-wms/:id/status` com `status: 'CANCELADO'`,
**sem exigir motivo** e **disponível em qualquer status** exceto `RECEBIDO` e
`CANCELADO`. Isso permite remover da operação um agendamento cujo veículo **já foi
autorizado a entrar no pátio** — em fila para conferência, na doca, sendo conferido
ou já conferido — abrindo uma brecha de integridade que deixa `VeiculoPatio`,
`NotaEntrada`, ordens de serviço e fila do pátio inconsistentes com o agendamento.

O objetivo é separar claramente **cancelamento** (desistência legítima, só antes da
entrada no pátio e sempre com motivo) de qualquer remoção após a entrada (que passa
a ser proibida — o fluxo deve seguir seu curso).

## Bug Analysis

### Bug Condition C(X)

Seja X = (agendamento `AgendaWms` no estado S, requisição de transição para
`CANCELADO`). A condição de bug **C(X)** é verdadeira quando o sistema **efetiva**
o cancelamento em qualquer uma destas situações:

- **C1**: o veículo já foi autorizado a entrar no pátio —
  `S ∈ { ESPERA, CONFIRMADO, NA_DOCA, CONFERINDO, CONFERIDO }`. Deveria ser
  rejeitado (422), mas hoje é aceito.
- **C2**: `S == AGENDADO` (cancelamento legítimo), porém efetivado **sem
  `motivoCancelamento` válido** (ausente ou abaixo do mínimo de caracteres).

O fix torna C(X) sempre falsa: cancelamento só é efetivado quando `S == AGENDADO`
**e** há motivo válido; em qualquer outro caso, é rejeitado.

### Ordem dos estados (fonte: código)

`AGENDADO → ESPERA → CONFIRMADO → NA_DOCA → CONFERINDO → CONFERIDO → RECEBIDO`

A "entrada no pátio" acontece na Portaria (`POST /autorizar-entrada/:id`), que move
o agendamento de `AGENDADO` para `ESPERA` e cria o `VeiculoPatio`. Divisor:
**`AGENDADO` (pré-pátio) vs. tudo a partir de `ESPERA` (pós-entrada)**.

### Root Cause

1. `PATCH /agenda-wms/:id/status` (`agenda-wms.routes.ts`) aplica qualquer transição
   do `statusSchema` sem validar a origem nem exigir motivo para `CANCELADO` — não há
   máquina de estados restringindo o cancelamento.
2. O frontend (`/wms/agenda/page.tsx`) expõe o botão "Cancelar" para todo status
   `!= RECEBIDO && != CANCELADO`, com um `confirm()` simples.
3. Não existe rota de DELETE físico de agendamento — o "excluir" percebido pelo
   usuário é esse cancelamento sem trava.
4. Não é bug de dados nem de migration: os campos `motivoCancelamento`,
   `canceladoPorId` e `canceladoEm` **já existem** no model `AgendaWms`
   (`prisma/schema.prisma`) — hoje não são preenchidos nem validados.

### Current Behavior (Defect)

- Cancelamento aceito em qualquer estado (exceto `RECEBIDO`/`CANCELADO`), inclusive
  após a entrada no pátio (C1).
- Cancelamento efetivado sem `motivoCancelamento` (C2); os campos de auditoria de
  cancelamento ficam nulos.
- Frontend mostra o botão "Cancelar" em quase todos os estados, com `confirm()` seco.

### Expected Behavior (Correct)

- Cancelamento **permitido apenas em `AGENDADO`** e **sempre com motivo válido**
  (mínimo ~10 caracteres, mesmo padrão de outros cancelamentos do sistema).
- Transição para `CANCELADO` a partir de `ESPERA`/`CONFIRMADO`/`NA_DOCA`/
  `CONFERINDO`/`CONFERIDO` **rejeitada com HTTP 422** e mensagem explicativa.
- Ao cancelar, gravar `motivoCancelamento`, `canceladoPorId = user.id` e
  `canceladoEm = new Date()` além de `status = 'CANCELADO'`.
- Frontend exibe o botão "Cancelar" **apenas em `AGENDADO`**, com modal que exige o
  motivo; trata 400/422 exibindo a mensagem do backend.

### Unchanged Behavior (Regression Prevention)

- Transições de avanço (`AGENDADO→ESPERA→…→RECEBIDO`) e seus efeitos colaterais no
  `PATCH /:id/status` (criação de `NotaEntrada`, OS de conferência, atualização do
  pedido de compra) permanecem inalterados.
- Cancelamento legítimo em `AGENDADO` continua funcionando (agora com motivo).
- `RECEBIDO`/`CANCELADO` continuam sem cancelamento.
- Sem alteração de schema Prisma (campos já existem) → sem migration.
- Isolamento multi-tenant preservado (rota já busca por `{ id, empresaId }`).
- Tela `agenda-doca` (timeline) não é afetada.

## Fix Approach

**Backend** — `agenda-wms.routes.ts` (`PATCH /:id/status`):
- Estender o schema do body para aceitar `motivoCancelamento` opcional.
- Quando `status === 'CANCELADO'`:
  - Se `ag.status !== 'AGENDADO'` → HTTP 422 (mensagem sobre entrada no pátio já autorizada).
  - Se `motivoCancelamento` ausente/curto → HTTP 400.
  - Ao efetivar, gravar `motivoCancelamento`, `canceladoPorId`, `canceladoEm`.
- Extrair a decisão para uma função pura testável (estado atual + motivo → permitido/erro).

**Frontend** — `/wms/agenda/page.tsx`:
- Botão "Cancelar" só quando `ag.status === 'AGENDADO'`.
- Modal com textarea de motivo, enviando `{ status: 'CANCELADO', motivoCancelamento }`.
- Exibir mensagem de erro do backend em 400/422.

## Verification

- Testes da função de decisão de cancelamento:
  - `AGENDADO` + motivo válido → efetiva; grava motivo/quem/quando.
  - `AGENDADO` sem motivo (ou curto) → 400, não efetiva.
  - `ESPERA`/`CONFIRMADO`/`NA_DOCA`/`CONFERINDO`/`CONFERIDO` + qualquer motivo → 422.
  - `RECEBIDO`/`CANCELADO` → permanece rejeitado.
- Property-based (fast-check): para qualquer estado ≠ `AGENDADO`, cancelamento sempre
  rejeitado (C1 falsa); para `AGENDADO`, aceito somente com motivo válido (C2 falsa).
- `tsc --noEmit` sem aumentar a baseline conhecida (~65 erros).
- Frontend: botão só em `AGENDADO`; modal exige motivo.
- Revisar a suíte QA E2E (fluxo recebimento/portaria) para o novo 422.
