# Implementation Plan — Parada de Máquina sem OP (Checkout)

## Overview

Feature majoritariamente **BACKEND** (`VisioFab.Wms.Back`): novo model
`ParadaCentro` + rotas de terminal no Checkout (registrar/encerrar/consultar
parada sem OP) + leitura no PCP + inclusão no Pareto do relatório mensal. O
**frontend do Checkout** (`VisioFab.Wms.Back/VisioFab.Checkout`, app Next dentro
do repo do backend) ganha o botão/indicador de parada.

Convenções (steering):
- Schema + `migrate-prod.ts` idempotente no MESMO commit (Postgres local off;
  roda no deploy). Rodar `npx tsx prisma/migrate-prod.ts` 2× local se houver DB.
- `empresaId` + `centroProducaoId` EXPLÍCITOS em toda query (multi-tenant).
- Não-regressão: pausa de etapa e Pareto existentes inalterados; `get_diagnostics`
  limpo; suíte do relatório mensal verde.
- Commits ficam com o usuário.
- Tarefas `*` são testes (opcionais p/ MVP); as de propriedade usam fast-check.

## Tasks

- [x] 1. [BACK] Schema `ParadaCentro` + migração idempotente
  - [x] 1.1 Adicionar o model `ParadaCentro` e a relação inversa em `CentroProducao`
    - Em `prisma/schema.prisma`: criar model `ParadaCentro` (tabela `parada_centro`)
      conforme design (id, empresaId, centroProducaoId+relation, motivoParada,
      codigoParadaId?, observacao?, funcionarioId?, inicio, fim?, duracaoMinutos?,
      criadoEm) + `@@index([empresaId, centroProducaoId])` e `@@index([empresaId, inicio])`.
    - Adicionar `paradasCentro ParadaCentro[]` em `CentroProducao` (aditivo).
    - Rodar `npx prisma generate`.
    - _Requirements: 1, 6.2_
  - [x] 1.2 Equivalente idempotente em `migrate-prod.ts`
    - `CREATE TABLE IF NOT EXISTS parada_centro (...)` + os 2 `CREATE INDEX IF NOT
      EXISTS`; FK de `centro_producao_id` via `ADD CONSTRAINT` em try/catch.
    - Testar 2× local se houver DB; garantir idempotência.
    - _Requirements: 6.2_

- [x] 2. [BACK] Serviço de parada no Checkout
  - [x] 2.1 Função pura `calcularDuracaoParada`
    - Em `checkout.service.ts` (ou helper próprio): `calcularDuracaoParada(inicio,
      fim) → minutos inteiros >= 0` (`fim < inicio ⇒ 0`).
    - _Requirements: 2.1, 2.4_
  - [x] 2.2 `registrarParadaCentro` / `encerrarParadaCentro` / `paradaAbertaDoCentro`
    - `registrarParadaCentro(checkoutUser, dados)`: valida (zod); recusa se já há
      Parada_Aberta p/ `(empresaId, centroProducaoId)` (400); cria `ParadaCentro`
      (`inicio=now`, `fim=null`). NÃO toca OP/etapa. empresaId+centro explícitos.
    - `encerrarParadaCentro(checkoutUser)`: busca Parada_Aberta do terminal; sem
      ela → 400; grava `fim=now` + `duracaoMinutos` (via 2.1).
    - `paradaAbertaDoCentro(checkoutUser)`: retorna a parada aberta ou null.
    - Reutilizar `CheckoutError`.
    - _Requirements: 1, 2, 3.1_
  - [ ]* 2.3 Testes de propriedade/serviço
    - **P1 duração nunca negativa** (fast-check, ≥100 it.).
    - **P2 no máximo uma parada aberta por centro** (mock Prisma): 2ª criação sem
      encerrar falha; após encerrar, nova criação ok.
    - **P3 isolamento multi-tenant** (mock): registrar/encerrar/consultar não
      vazam entre empresas.
    - _Validates: Requirements 1.3, 2, 6.3_

- [x] 3. [BACK] Rotas de terminal (checkout.routes.ts, `checkoutAuth`)
  - [x] 3.1 POST `/checkout/parada-maquina`, PATCH `/checkout/parada-maquina/encerrar`,
        GET `/checkout/parada-maquina`
    - Schemas zod locais (motivoParada enum, codigoParadaId uuid?, observacao?).
      Delegam para o serviço (2.2). Isolamento pela sessão do terminal.
    - _Requirements: 1, 2, 3_

- [x] 4. [BACK] Leitura no PCP (ERP)
  - [x] 4.1 GET `/api/pcp/centros/:id/paradas`
    - Novo `parada-centro-pcp.routes.ts` (ou anexo a routes PCP existente):
      lista `ParadaCentro` do centro por período (dataInicio/dataFim opcionais),
      ordem cronológica, `empresaId` explícito (centro de outra empresa → 404).
      `authenticate` + `moduloGuard('PCP')`. Registrar em `server.ts`.
    - _Requirements: 5_

- [x] 5. [BACK] Pareto do relatório mensal inclui paradas sem OP
  - [x] 5.1 Estender `paretoParadas` em `relatorio-producao.service.ts`
    - Somar as `ParadaCentro` encerradas do período (mesmo intervalo BRT),
      agregando por `codigoParadaId` (fallback `motivoParada`) + somando
      `duracaoMinutos`, aditivo às paradas por etapa. empresaId explícito.
    - _Requirements: 4_
  - [ ]* 5.2 Golden de não-regressão + inclusão
    - Sem `ParadaCentro` ⇒ Pareto idêntico ao atual; com uma parada de centro,
      ela soma no balde do código/motivo correto.
    - _Validates: Requirements 4.3, 6.1_

- [x] 6. [FRONT-CHECKOUT] Indicador + ações de parada no painel
  - [x] 6.1 Painel do Checkout: registrar/encerrar parada da máquina
    - `VisioFab.Checkout/src/app/painel/page.tsx`: carregar `GET
      /checkout/parada-maquina`; sem parada → botão "Registrar parada da máquina"
      (modal: motivo select + código de parada via `GET /checkout/codigos-parada`
      + observação) → POST; com parada → faixa de destaque ("Máquina em parada:
      MOTIVO desde HH:MM") + "Encerrar parada" → PATCH. Disponível mesmo sem
      etapas/RCs na fila.
    - _Requirements: 3_

- [ ] 7. [BACK/FRONT] Checkpoint final — verificação
  - `get_diagnostics` limpo nos arquivos tocados (back + checkout). Build do
    Checkout (se aplicável) OK. Suíte do relatório mensal verde. Migração roda no
    deploy (idempotente). Pausa de etapa inalterada.

## Notes

- Não-regressão é gate: o `PATCH /checkout/etapas/:id/pausar` e o
  `ApontamentoEtapa` tipo PARADA NÃO mudam. O novo fluxo é paralelo.
- `ParadaCentro` é por RECURSO (máquina), não por ordem — padrão MES.
- Commits (back) incluem schema.prisma + migrate-prod.ts juntos.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2"] },
    { "id": 2, "tasks": ["2.3", "3.1", "4.1", "5.1"] },
    { "id": 3, "tasks": ["5.2", "6.1"] }
  ]
}
```
