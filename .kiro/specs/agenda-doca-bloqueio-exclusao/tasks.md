# Implementation Plan

## Overview

Plano de implementação do bugfix que bloqueia o cancelamento de agendamentos da
Agenda WMS após a autorização de entrada no pátio, exigindo motivo válido quando
o cancelamento é legítimo (status `AGENDADO`). Regra no backend via função pura
`decidirCancelamento`, com auditoria de cancelamento (campos já existentes no
schema — sem migration), e ajuste do frontend. Começa por um teste de exploração
que confirma a existência do bug.

## Tasks

- [x] 1. Escrever teste de exploração da condição de bug C(X)
  - Criar `src/modules/agenda-wms/cancelamento-agenda.service.test.ts` com fast-check, importando `decidirCancelamento` de `./cancelamento-agenda.service` (a ser criado na Tarefa 2).
  - Codificar as propriedades da condição de bug: C1 (cancelamento aceito em estado ≠ `AGENDADO`) e C2 (cancelamento aceito em `AGENDADO` sem motivo válido) NÃO podem ocorrer.
  - Como o service ainda não existe, este teste falha ao rodar (confirma o bug/ausência da regra). Esse é o resultado esperado nesta etapa.
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Criar a função pura `decidirCancelamento`
  - Criar `src/modules/agenda-wms/cancelamento-agenda.service.ts` com `STATUS_PERMITE_CANCELAMENTO = 'AGENDADO'`, `MOTIVO_CANCELAMENTO_MIN = 10`, o tipo `DecisaoCancelamento` e a função `decidirCancelamento(statusAtual, motivoCancelamento)`.
  - Regras: estado ≠ `AGENDADO` → `{ permitido:false, httpStatus:422, mensagem }`; `AGENDADO` com motivo (após trim) < mínimo → `{ permitido:false, httpStatus:400, mensagem }`; `AGENDADO` com motivo válido → `{ permitido:true }`.
  - Função pura, sem acesso a banco. Garantir que os testes da Tarefa 1 passem.
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 3. Aplicar a regra na rota `PATCH /:id/status` (agenda-wms.routes.ts)
  - Estender o `statusSchema` do body para aceitar `motivoCancelamento` opcional.
  - Após carregar o agendamento (já filtrado por `{ id, empresaId }`) e antes da transação, quando `status === 'CANCELADO'`: chamar `decidirCancelamento(ag.status, body.motivoCancelamento)` e, se não permitido, responder com `decisao.httpStatus` e `decisao.mensagem`, sem efetivar.
  - Ao efetivar o cancelamento permitido, gravar `status: 'CANCELADO'`, `motivoCancelamento` (trim), `canceladoPorId: user.id`, `canceladoEm: new Date()`.
  - Não alterar as demais transições de avanço nem seus efeitos colaterais (NA_DOCA/CONFERINDO/RECEBIDO).
  - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3_

- [x] 4. Ajustar o frontend da Agenda WMS (page.tsx)
  - Em `VisioFab.Wms.Front/src/app/(interna)/wms/agenda/page.tsx`, exibir o botão "Cancelar" apenas quando `ag.status === 'AGENDADO'`.
  - Substituir o `confirm()` por um modal (Mantine) com `Textarea` de motivo obrigatório; enviar `{ status: 'CANCELADO', motivoCancelamento }` para `PATCH /agenda-wms/:id/status`.
  - Tratar erros 400/422 exibindo a `message` do backend via `notifications`.
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 5. Verificação final (build, testes, regressão)
  - Rodar os testes property-based/unitários de `cancelamento-agenda.service.test.ts` e confirmar que passam após a implementação.
  - Rodar `tsc --noEmit` no backend e confirmar que a contagem de erros não aumenta em relação à baseline conhecida (~65 erros pré-existentes); `get_diagnostics` limpo no frontend.
  - **CORREÇÃO**: ao contrário do previsto no design, o model `AgendaWms` NÃO possuía os campos de cancelamento (eles pertenciam ao model `Carregamento`). Foi necessário adicionar `motivo_cancelamento`, `cancelado_por_id`, `cancelado_em` ao `schema.prisma` E ao `migrate-prod.ts` (idempotente, testado 2x local sem erro), conforme o processo obrigatório de migrations.
  - Revisar cenários da suíte QA E2E (fluxo recebimento/portaria) que possam depender de cancelamento após entrada no pátio, ajustando para o novo 422.
  - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3_

## Task Dependency Graph

```mermaid
graph TD
  T1[1. teste exploracao C(X)]
  T2[2. decidirCancelamento]
  T3[3. rota PATCH status]
  T4[4. frontend agenda]
  T5[5. verificacao final]

  T1 --> T2
  T2 --> T3
  T2 --> T4
  T3 --> T5
  T4 --> T5
```

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2"] },
    { "wave": 3, "tasks": ["3", "4"] },
    { "wave": 4, "tasks": ["5"] }
  ]
}
```

## Notes

- Bugfix majoritariamente em `VisioFab.Wms.Back` com um ajuste no `VisioFab.Wms.Front` (Tarefa 4).
- Sem migration: `motivoCancelamento`, `canceladoPorId`, `canceladoEm` já existem em `AgendaWms`.
- Não existe DELETE físico de agendamento — o "excluir" percebido é o cancelamento; a trava é aplicada nele.
- Criar branch nova antes de commitar (padrão do repositório).
- Baseline de `tsc`: ~65 erros pré-existentes conhecidos; a mudança não deve aumentar esse número.
