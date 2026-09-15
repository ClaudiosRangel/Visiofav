# Implementation Plan

Central de Documentos Financeiros — Fase D4 (Contabilidade / Partidas Dobradas)

## Overview

Plano de contas contábil + de/para categoria→conta + lançamento em partidas
dobradas (Σd=Σc) + geração automática best-effort a partir de eventos
financeiros (provisão/liquidação) + razão/balancete. Núcleo puro testável.
Migração idempotente no mesmo commit. Contabilização nunca bloqueia o financeiro.

## Tasks

- [x] 1. Núcleo puro `contabil-core.ts`
  - [x] 1.1 `validarPartidasDobradas`, `montarPartidas`, `saldoPorNatureza`
    - _Requirements: 3.2, 4.1, 4.3, 6.1, 6.2_
  - [x]* 1.2 Testes (unit + property): Property 1/2/3/4 — 10 testes (fc.double)
    - **Validates: Requirements 3.2, 4.1, 4.3, 6.1, 6.2**

- [x] 2. Checkpoint — núcleo puro passa (10 testes)

- [x] 3. Schema + migração idempotente
  - [x] 3.1 Models `ContaContabil`, `MapeamentoContabil`, `LancamentoContabil`, `PartidaContabil` no `schema.prisma`
    - _Requirements: 1.1, 2.1, 3.1_
  - [x] 3.2 `migrate-prod.ts`: 4 CREATE TABLE + índices únicos + FKs try/catch; testado 2x local
    - _Requirements: 1.2, 5.3_

- [x] 4. `contabil.service.ts` (CRUD plano de contas + de/para + lançamento manual)
  - [x] 4.1 Plano de contas + de/para (valida contas analíticas)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 5.1_
  - [x] 4.2 Lançamento manual (valida Σd=Σc + contas analíticas em transação)
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [x] 4.3 Consultas: `razao` e `balancete`
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 5. `contabilizacao.service.ts` (geração automática best-effort)
  - [x] 5.1 `contabilizarProvisao` / `contabilizarLiquidacao`: usa de/para; sem de/para cria PENDENTE; nunca lança erro; empresaId da entidade
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.2_

- [x] 6. Acoplamento aos eventos (mínimo, isolado)
  - [x] 6.1 Após `incluirTitulo` (provisão) e após baixa (liquidação) em conta-pagar/receber, contabilização em try/catch fora da transação financeira
    - _Requirements: 4.1, 4.2, 4.5_

- [x] 7. Rotas `contabil.routes.ts` (sub-rota `/api/financeiro/contabil`)
  - [x] 7.1 contas (GET/POST/PUT), mapeamentos (GET/PUT), lançamentos (GET/POST), razão, balancete
    - _Requirements: 1.1, 2.1, 3.1, 6.1, 6.2_

- [x] 8. Checkpoint backend — build + testes (10 verdes, bundle esbuild OK, diagnostics limpos)

- [x] 9. QA E2E `test_48_contabil.py`
  - [x] 9.1 criar contas; lançamento balanceado (ok) e desbalanceado (422); conta sintética barrada; balancete fecha; isolamento; helpers no `wms_api.py`
    - _Requirements: 3.2, 3.3, 5.1, 6.2_
  - [x] 9.2 Rodado contra produção: 6/6 verde (back 58f752f6a, front 9f11497)

- [x] 10. Documentação + deploy (documento-mestre + steering QA atualizados; back+front pushados; migração aplicada no start do Render; QA 6/6 em produção)

- [ ] 10. Documentação + deploy
  - Atualizar `docs/PROGRAMA-DOCUMENTOS-FINANCEIROS.md` (D4 concluída) + steering QA (front); commit + push back e front (schema + migrate-prod juntos); QA contra produção.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2"] },
    { "id": 3, "tasks": ["3.1"] },
    { "id": 4, "tasks": ["3.2"] },
    { "id": 5, "tasks": ["4.1", "4.2", "4.3"] },
    { "id": 6, "tasks": ["5.1"] },
    { "id": 7, "tasks": ["6.1"] },
    { "id": 8, "tasks": ["7.1"] },
    { "id": 9, "tasks": ["8"] },
    { "id": 10, "tasks": ["9.1"] },
    { "id": 11, "tasks": ["9.2"] },
    { "id": 12, "tasks": ["10"] }
  ]
}
```

## Notes

- Documento-mestre: `docs/PROGRAMA-DOCUMENTOS-FINANCEIROS.md` (atualizar ao fim).
- Reusar `CategoriaFinanceira`, contas a pagar/receber, motor de baixa. Estender, não reescrever.
- Invariante: todo lançamento LANCADO tem Σdébitos = Σcréditos (tolerância R$ 0,01).
- Contabilização é best-effort: nunca bloqueia/desfaz o financeiro (try/catch fora da transação).
- Migração idempotente no MESMO commit; testar 2x local. Lição D2: validar bundle esbuild antes do push; sem crases no ai-system-prompt (D4 não toca IA).
- D4 é base da D5 (exportação ECD/SPED Contábil).
```
