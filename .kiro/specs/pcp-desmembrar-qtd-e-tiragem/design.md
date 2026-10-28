# Design — Desmembrar com quantidade e tiragem por parte

## Overview

Estende o desmembramento de etapa para um modo aditivo "qtd+tiragem": cada
parte informa quantidade (un) E tiragem (folhas), validadas contra os totais
da etapa e persistidas em `EtapaOrdemProducao`. O modo de base única
(`QUANTIDADE`/`TIRAGEM`) continua intacto (não-regressão). Backend
(`VisioFab.Wms.Back`) + frontend (`VisioFab.Wms.Front`).

## Architecture

- **Schema**: `EtapaOrdemProducao` +`tiragemPrevista Decimal?`. migrate-prod
  idempotente (ADD COLUMN IF NOT EXISTS), mesmo commit.
- **Rota**: `POST /pcp/etapas/:id/desmembrar` ganha um modo novo via o shape das
  partes (quando trazem `tiragem` além de `quantidade`). Mantém a base única.
- **Frontend**: modal de desmembrar com 3ª aba "Quantidade + Tiragem" (dois
  campos por parte + duas somas em tempo real).

## Components and Interfaces

### Backend — `etapa-operacional.routes.ts` (handler desmembrar)
- Body estendido (Zod discriminado por presença de `tiragem`):
  - Modo base única (atual): `{ base: 'QUANTIDADE'|'TIRAGEM', partes: [{ centroProducaoId, quantidade, observacao? }] }`.
  - Modo duplo (novo): `{ base: 'QTD_TIRAGEM', partes: [{ centroProducaoId, quantidade, tiragem, observacao? }] }`.
- Totais de referência:
  - `totalQtd` = `ordemProducao.quantidade` (ou `quantidadePrevista` da etapa se
    for subdivisão — manter regra atual do total de quantidade).
  - `totalTiragem` = tiragem resolvida da etapa (mesma `tiragemDaEtapa(...)` já
    usada hoje para a base TIRAGEM: plano → `[Tiragem]` → fallback).
- Validação modo duplo: `Σquantidade == totalQtd` E `Σtiragem == totalTiragem`
  (tolerância 0.01); 400 com mensagem apontando qual soma falhou; 400 se alguma
  parte não tiver `quantidade` ou `tiragem`.
- Criação das etapas-parte: grava `quantidadePrevista = parte.quantidade` e
  `tiragemPrevista = parte.tiragem`. `descricao` inclui ambos (ex.: "… (77.000
  un / 19.250 folhas)").
- Rateio de `tempoOperacaoCalculado`: `fracao = parte.tiragem / totalTiragem`
  (tiragem dita o tempo de máquina); se `totalTiragem <= 0`, cai para
  `parte.quantidade / totalQtd` (legado).
- Permissão `podeDesmembrar`, `empresaId` explícito, `LogOrdemProducao` com as
  duas bases — tudo preservado.

### Frontend — modal de desmembrar
- 3ª aba "Quantidade + Tiragem": por parte, `NumberInput` de quantidade +
  `NumberInput` de tiragem + seletor de centro. Dois rodapés de soma
  (`Σqtd / total un`, `Σtiragem / total folhas`), verdes quando batem; botão
  "Desmembrar" desabilitado até ambos baterem. Envia `base: 'QTD_TIRAGEM'`.
- Abas "Por Quantidade"/"Por Tiragem" existentes: inalteradas.

## Data Models

```prisma
model EtapaOrdemProducao {
  // ...
  tiragemPrevista Decimal? @map("tiragem_prevista") @db.Decimal(12, 4)
}
```
migrate-prod: `ALTER TABLE etapa_ordem_producao ADD COLUMN IF NOT EXISTS tiragem_prevista DECIMAL(12,4)`.

## Correctness Properties

### Property 1: Conservação das duas bases
No modo qtd+tiragem, a soma das quantidades das partes = total de quantidade E
a soma das tiragens = total de tiragem (dentro da tolerância).
**Validates: Requirements 2.2**

### Property 2: Não-regressão da base única
Desmembrar por base única (QUANTIDADE ou TIRAGEM) produz exatamente o mesmo
resultado de hoje (mesmas etapas, mesmo rateio).
**Validates: Requirements 2.5, 4.1**

## Error Handling
- 400: soma divergente (indica qual base), parte sem quantidade/tiragem.
- 403: sem `podeDesmembrar`. 404: etapa de outra empresa. 400: etapa não
  `PENDENTE` (regra atual preservada).

## Testing Strategy
- Backend: teste da validação das duas somas (golden + casos de erro) e da
  não-regressão da base única. `get_diagnostics` + `prisma generate`.
- Frontend: `get_diagnostics` + `npm run build`. Validação visual do modal.
- Schema + migrate-prod no mesmo commit; testar migrate 2x local se possível.
