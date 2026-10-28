# Implementation Plan — Desmembrar com quantidade e tiragem por parte

## Overview

Ordem: schema+migração → rota (modo qtd+tiragem, não-regressivo) → frontend
(3ª aba do modal) → verificação. Backend e frontend são repos separados.
Schema + `migrate-prod.ts` no MESMO commit.

## Tasks

- [x] 1. Schema `tiragemPrevista` + migração (`VisioFab.Wms.Back`)
  - [x] 1.1 Em `prisma/schema.prisma`, `EtapaOrdemProducao`: adicionar
    `tiragemPrevista Decimal? @map("tiragem_prevista") @db.Decimal(12, 4)`.
  - [x] 1.2 `prisma/migrate-prod.ts`: `ALTER TABLE etapa_ordem_producao ADD
    COLUMN IF NOT EXISTS tiragem_prevista DECIMAL(12,4)` (idempotente).
    `npx prisma generate`.
  - _Requisitos: 1.1, 1.2, 1.3, 4.3_

- [x] 2. Rota desmembrar — modo qtd+tiragem (`VisioFab.Wms.Back`)
  - [x] 2.1 Em `etapa-operacional.routes.ts` (handler `POST /etapas/:id/
    desmembrar`): aceitar `base: 'QTD_TIRAGEM'` com partes
    `{ centroProducaoId, quantidade, tiragem, observacao? }`; validar as DUAS
    somas (Σqtd==totalQtd, Σtiragem==totalTiragem, tol. 0.01) com 400 claro;
    400 se parte sem quantidade/tiragem.
  - [x] 2.2 Criar etapas-parte gravando `quantidadePrevista` + `tiragemPrevista`;
    rateio do tempo por tiragem (fallback quantidade); descrição com os dois
    valores; `LogOrdemProducao` com as duas bases. Preservar permissão/empresaId
    e o modo de base única intacto.
  - [x] 2.3 Teste da validação (golden + erros) e não-regressão da base única.
    `get_diagnostics` limpo.
  - _Requisitos: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 4.1_

- [x] 3. Frontend — 3ª aba do modal de desmembrar (`VisioFab.Wms.Front`)
  - [x] 3.1 Adicionar aba "Quantidade + Tiragem": por parte, dois NumberInputs
    (qtd + tiragem) + centro; duas somas em tempo real; botão habilita só quando
    ambas batem; envia `base: 'QTD_TIRAGEM'`. Abas existentes inalteradas.
  - [x] 3.2 `get_diagnostics` limpo.
  - _Requisitos: 3.1, 3.2, 3.3, 3.4_

- [x] 4. Verificação final
  - [x] 4.1 Backend: `get_diagnostics` limpo, `prisma generate`.
  - [x] 4.2 Frontend: `get_diagnostics` limpo + `npm run build` (Next).
  - [x] 4.3 Commits separados (back: schema+migrate+rota; front: modal).
  - _Requisitos: 4.1, 4.2, 4.3_

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2"] },
    { "wave": 3, "tasks": ["3"] },
    { "wave": 4, "tasks": ["4"] }
  ]
}
```

## Notes

- Não-regressão: base única (QUANTIDADE/TIRAGEM) continua igual.
- Tiragem resolvida da etapa via a mesma função já usada hoje (`tiragemDaEtapa`).
- Rateio de tempo por tiragem (dita o tempo de máquina); fallback quantidade.
