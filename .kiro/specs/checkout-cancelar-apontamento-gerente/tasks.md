# Implementation Plan — Cancelar Apontamento com Autorização do Gerente

## Overview

Backend (`VisioFab.Wms.Back`): 4 colunas aditivas em `ApontamentoEtapa` +
migrate-prod + `cancelarApontamento` (estorno simétrico + autorização de gerente
+ auditoria) + rota + campos no histórico. Frontend do Checkout
(`VisioFab.Wms.Back/VisioFab.Checkout`): ação "Cancelar" por item no histórico da
tela `etapa/[id]`.

Convenções (steering): schema + migrate-prod no MESMO commit (idempotente;
Postgres local off → roda no deploy); `empresaId` explícito; não-regressão
(apontar/retroativo/concluir inalterados); `get_diagnostics` limpo. Tarefas `*`
são testes (opcionais p/ MVP), fast-check nas de propriedade. Commits ficam com o
usuário.

## Tasks

- [x] 1. [BACK] Schema — colunas de cancelamento em `ApontamentoEtapa`
  - [x] 1.1 Adicionar `cancelado`, `canceladoEm`, `canceladoPorUsuarioId`,
        `motivoCancelamento` (nullable/aditivo) ao model + `npx prisma generate`.
    - _Requirements: 1.1, 4.1, 6.1_
  - [x] 1.2 `migrate-prod.ts` idempotente: 4 `ALTER TABLE ... ADD COLUMN IF NOT
        EXISTS`. Testar 2× local se houver DB.
    - _Requirements: 6.1_

- [x] 2. [BACK] Serviço `cancelarApontamento`
  - [x] 2.1 Função pura `calcularEstorno(totalAtual, apontado) = max(0, t−a)`.
    - _Requirements: 2.4_
  - [x] 2.2 `cancelarApontamento(apontamentoId, checkoutUser, { motivo },
        autorizacaoSupervisor)` em `checkout.service.ts`:
    - valida motivo + autorização (zod); `validarCredenciaisSupervisorTerminal`
      ANTES de escrever (401/403 se inválida — Req 1.2);
    - resolve o apontamento por `empresaId` (etapa.ordemProducao.empresaId);
      404 indistinguível (Req 1.4);
    - guardas: já cancelado → 400 (Req 3.1); tipo ∉ {PRODUCAO,PERDA,RETRABALHO}
      → 400 (Req 3.2);
    - `$transaction`: estorno simétrico na etapa com piso 0 (Req 2) + marca
      `cancelado/canceladoEm/canceladoPorUsuarioId/motivoCancelamento` (Req 1.1);
    - retorna apontamento + novos totais da etapa. empresaId explícito.
    - _Requirements: 1, 2, 3_
  - [ ]* 2.3 Testes de propriedade/serviço
    - P1 estorno nunca negativo (fast-check); P2 idempotência (mock); P3
      autorização obrigatória (mock); P4 isolamento multi-tenant (mock).
    - _Validates: 1.2, 2.4, 3.1, 1.4_

- [x] 3. [BACK] Rota de terminal
  - [x] 3.1 `POST /checkout/apontamentos/:id/cancelar` (checkoutAuth): body
        `{ motivo, autorizacaoSupervisor: { email, senha } }`; delega para 2.2;
        try/catch + `CheckoutError` (mesmo padrão do `/retroativo`).
    - _Requirements: 1, 5.2_

- [x] 4. [BACK] Histórico expõe o cancelamento
  - [x] 4.1 `listarHistoricoApontamentos` inclui `cancelado`, `canceladoEm`,
        `canceladoPorUsuarioId`, `motivoCancelamento` no retorno (itens
        cancelados permanecem na lista).
    - _Requirements: 4_

- [x] 5. [FRONT-CHECKOUT] Ação "Cancelar" no histórico da etapa
  - [x] 5.1 `etapa/[id]/page.tsx`: `ApontamentoHistorico` ganha os campos de
        cancelamento; cada item PRODUCAO/PERDA/RETRABALHO não cancelado mostra
        "Cancelar" → bloco inline (motivo + email/senha do gerente) → `POST
        /apontamentos/:id/cancelar` → recarrega histórico. Item cancelado:
        riscado + badge "Cancelado" + motivo, sem botão.
    - _Requirements: 4.2, 5_

- [ ] 6. [BACK/FRONT] Checkpoint — verificação
  - `get_diagnostics` limpo (back + checkout). Apontar/retroativo/concluir
    inalterados. Migração roda no deploy (idempotente).

## Notes

- Soft-cancel + estorno (não DELETE físico) — preserva auditoria e retroativos.
- Reusa `validarCredenciaisSupervisorTerminal` ("login do gerente").
- Dívida conhecida (fora de escopo): filtrar `cancelado:false` em agregações de
  produtividade/valorização que leem `ApontamentoEtapa` direto — só se o cliente
  relatar distorção.
- Commit (back): schema.prisma + migrate-prod.ts juntos.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2"] },
    { "id": 2, "tasks": ["2.3", "3.1", "4.1"] },
    { "id": 3, "tasks": ["5.1"] }
  ]
}
```
