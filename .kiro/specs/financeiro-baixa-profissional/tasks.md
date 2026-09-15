# Implementation Plan

Baixa Profissional de Títulos (Liquidação) — Contas a Pagar e a Receber

## Overview

Liquidação de nível de mercado: ajustes (juros/multa/desconto/tarifa), conta,
data, comprovante, resumo de cálculo. Núcleo puro testável; backend persiste
componentes + líquido; frontend com modal rico e resumo em tempo real (individual
e lote). Retrocompatível. Migração idempotente no mesmo commit.

## Tasks

- [x] 1. Núcleo puro `baixa-calculo.ts`
  - [x] 1.1 `calcularLiquido(tipo, componentes)` (pagar soma tarifa, receber subtrai; líquido nunca negativo → valido=false)
    - _Requirements: 1.2, 1.3, 5.1_
  - [x]* 1.2 Testes (unit + property): Property 1/2/3/4 — 8 testes
    - **Validates: Requirements 1.2, 1.3, 5.1**

- [x] 2. Checkpoint — núcleo puro passa (8 testes)

- [x] 3. Schema + migração idempotente
  - [x] 3.1 6 colunas nullable em `conta_pagar` e `conta_receber`
    - _Requirements: 1.4, 2.3, 5.4_
  - [x] 3.2 `migrate-prod.ts`: ADD COLUMN IF NOT EXISTS (12 colunas); testado 2x local
    - _Requirements: 5.4_

- [x] 4. Backend — `BaixaInput` estendido + baixa/estorno
  - [x] 4.1 `baixarTitulo` calcula líquido, persiste componentes+comprovante+conta+data; rejeita líquido negativo (422)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 5.2_
  - [x] 4.2 `estornarBaixa` limpa também os novos campos
    - _Requirements: 5.3_
  - [x] 4.3 Rotas pagar/receber: body Zod aceita novos campos; contabilização usa o líquido
    - _Requirements: 1.1, 2.1, 5.2, 6.1, 6.2_

- [x] 5. Frontend — modal de baixa rico (pagar e receber)
  - [x] 5.1 `lib/financeiro/baixa.ts` + `BaixaTituloModal` (resumo em tempo real, bloqueia líquido<0)
    - _Requirements: 3.1, 3.2, 3.3, 1.1, 2.1_
  - [x] 5.2 Integrado na tela Contas a Pagar + total consolidado no lote
    - _Requirements: 4.1, 4.3_
  - [x] 5.3 Integrado na tela Contas a Receber (mesmo componente)
    - _Requirements: 4.1, 4.3_

- [x] 6. Checkpoint — build + testes (8 verdes, bundle esbuild OK, tsc front sem erros novos)

- [x] 7. QA E2E `test_49_baixa.py`
  - [x] 7.1 baixa com juros/multa/desconto; desconto excessivo (422); estorno limpa; isolamento; helpers no `wms_api.py`
    - _Requirements: 1.2, 1.3, 5.3, 6.1_
  - [x] 7.2 Rodado contra produção: 4/4 verde (back 40398edc1, front 4d5f8f9)

- [x] 8. Documentação + deploy (documento-mestre + steering QA atualizados; back+front pushados; migração aplicada no start do Render; QA 4/4 em produção)

- [ ] 8. Documentação + deploy
  - Atualizar `docs/PROGRAMA-DOCUMENTOS-FINANCEIROS.md` (baixa profissional) + steering QA (front); commit + push back e front (schema + migrate-prod juntos); QA contra produção.

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
    { "id": 7, "tasks": ["5.2", "5.3"] },
    { "id": 8, "tasks": ["6"] },
    { "id": 9, "tasks": ["7.1"] },
    { "id": 10, "tasks": ["7.2"] },
    { "id": 11, "tasks": ["8"] }
  ]
}
```

## Notes

- Documento-mestre: `docs/PROGRAMA-DOCUMENTOS-FINANCEIROS.md` (registrar ao fim).
- Estender `titulo.service.ts`; retrocompatível (chamadores sem os campos → líquido = valor).
- Reusar valorPago/valorRecebido para o líquido; só 6 colunas novas por tabela.
- Não quebrar D4 (contabilização best-effort da liquidação usa o líquido).
- Migração idempotente no MESMO commit; testar 2x local. Lição D2: validar bundle esbuild antes do push.
```
