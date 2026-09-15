# Implementation Plan: Financeiro Operacional Completo — Onda 1

## Overview

Transforma o backend financeiro existente em produto operável: dashboard,
baixa em lote, edição/cancelamento/estorno de títulos, extrato por conta,
relatórios, telas frontend faltantes, e QA E2E. Estende o que existe; migração
idempotente no mesmo commit; isolamento multi-tenant explícito.

## Tasks

- [ ] 1. Schema + migração idempotente (colunas aditivas de título)
  - Adicionar `canceladoEm` e `observacao` (nullable) a `ContaReceber` e `ContaPagar` em `schema.prisma`; equivalente idempotente em `migrate-prod.ts` (`ADD COLUMN IF NOT EXISTS`), testado 2x local. `prisma generate`.
  - _Requirements: 3.3, 9.3_

- [ ] 2. `titulo.service.ts` — regras unificadas de título (receber/pagar)
  - [ ] 2.1 Implementar `editarTitulo`, `cancelarTitulo`, `estornarBaixa`, `baixarTitulo` (enriquecida), `baixarEmLote`
    - Reuso de `assertPeriodoAberto`. Baixa em lote particiona sucesso/ignorados sem derrubar o lote. Isolamento por `empresaId`.
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 9.4_
  - [ ]* 2.2 Testes unitários do `titulo.service` (Vitest)
    - **Property 1** (lote particiona), **Property 2** (estorno reverte saldo), **Property 5** (edição só em aberto)
    - **Validates: Requirements 2.1, 2.3, 3.1, 3.2, 3.4**

- [ ] 3. `extrato.service.ts` + `dashboard.service.ts` + `relatorios.service.ts`
  - [ ] 3.1 `extrato.service.ts` (movimentação consolidada por conta com saldo corrente)
    - _Requirements: 5.1, 5.2, 5.3_
  - [ ] 3.2 `dashboard.service.ts` (saldos, a receber/pagar, resultado do mês, fluxo, top devedores, despesas por categoria)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [ ] 3.3 `relatorios.service.ts` (inadimplência, contas por período)
    - _Requirements: 6.1, 6.2, 6.4_
  - [ ]* 3.4 Testes unitários (Vitest) de extrato (acumula) e dashboard/relatórios (isolamento)
    - **Property 3** (extrato acumula), **Property 4** (isolamento)
    - **Validates: Requirements 5.1, 5.2, 1.5, 6.4**

- [ ] 4. Rotas — estender conta-pagar/conta-receber + financeiro
  - [ ] 4.1 `conta-pagar.routes.ts` / `conta-receber.routes.ts`: `PUT /:id`, `PATCH /:id/cancelar`, `PATCH /:id/estornar`, `POST /baixar-lote`, enriquecer `/:id/pagar|receber` com conta/categoria/centro
    - _Requirements: 2.1, 2.2, 3.x, 4.x, 9.2_
  - [ ] 4.2 `financeiro.routes.ts`: `GET /dashboard`, `GET /extrato`, `GET /relatorios/inadimplencia`, `GET /relatorios/contas`
    - _Requirements: 1.x, 5.x, 6.x_

- [ ] 5. Checkpoint backend — build + testes unitários passam
  - `npx vitest run src/modules/financeiro/`; `tsc` sem novos erros; migração 2x.

- [ ] 6. Frontend — camada de API e telas novas
  - [ ] 6.1 Estender `useFinanceiroApi.ts` com todos os novos endpoints e `format.ts` conforme necessário
    - _Requirements: 7.x_
  - [ ] 6.2 Página Dashboard (`/financeiro/dashboard`) com cards e resumo de fluxo/aging/top devedores
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 7.1_
  - [ ] 6.3 Páginas de cadastro: Categorias, Centros de Custo, Lançamentos de Caixa (com rateio), Fechamento, DRE, Extrato
    - _Requirements: 7.1_
  - [ ] 6.4 Enriquecer Contas a Pagar/Receber: seleção múltipla + baixa em lote (modal conta/forma/data), editar, cancelar, estornar
    - _Requirements: 2.1, 2.2, 3.x, 4.x, 7.2_
  - [ ] 6.5 Conciliação completa (detalhe de linha/título, não só IDs) + relatórios com export CSV
    - _Requirements: 6.3, 7.3_
  - [ ] 6.6 Menu: adicionar entradas novas (Dashboard, Categorias, Centros de Custo, Lançamentos, Fechamento, DRE, Extrato, Relatórios)
    - _Requirements: 7.1_
  - [ ]* 6.7 Teste unitário de funções puras novas do front (format/CSV) — Vitest
    - _Requirements: 6.3_

- [ ] 7. Checkpoint frontend — build passa
  - `npx next build` sem erro; telas renderizam.

- [ ] 8. QA E2E + seed
  - [ ] 8.1 Estender `qa-seed` (backend) com seed financeiro opcional (título vinculado a doc fiscal) — restrito por `WMS_QA_SEED_KEY`
    - _Requirements: 8.3_
  - [ ] 8.2 Helpers no `wms_api.py` (contas a pagar/receber, baixa/lote/editar/cancelar/estornar, conta financeira, lançamento, ofx, dashboard, extrato, relatórios)
    - _Requirements: 8.1_
  - [ ] 8.3 `test_43_financeiro.py`: fluxo completo + isolamento multi-tenant
    - _Requirements: 8.1, 8.2_
  - [ ] 8.4 Rodar a suíte de financeiro e reportar (passou/skip honesto)
    - _Requirements: 8.1_

- [ ] 9. Documentação + roadmap
  - Atualizar `docs/financeiro-operacional-f1.md` (ou novo doc da Onda 1) e `.kiro/steering/erp-roadmap.md`; atualizar steering de QA com o novo módulo de teste.

- [ ] 10. Checkpoint final + deploy
  - Todos os testes passam; migração idempotente 2x; commit + push back e front para `main` (deploy automático).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "3.2", "3.3"] },
    { "id": 2, "tasks": ["2.2", "3.4", "4.1", "4.2"] },
    { "id": 3, "tasks": ["5"] },
    { "id": 4, "tasks": ["6.1"] },
    { "id": 5, "tasks": ["6.2", "6.3", "6.4", "6.5", "6.6", "6.7"] },
    { "id": 6, "tasks": ["7"] },
    { "id": 7, "tasks": ["8.1", "8.2"] },
    { "id": 8, "tasks": ["8.3", "8.4"] },
    { "id": 9, "tasks": ["9", "10"] }
  ]
}
```

## Notes

- Tarefas `*` são testes; as demais são obrigatórias.
- Estender, não reescrever: rotas e telas existentes continuam funcionando.
- Migração idempotente no mesmo commit do schema (steering database-migrations).
- QA no padrão Python+Playwright existente (steering qa-automatizado).
