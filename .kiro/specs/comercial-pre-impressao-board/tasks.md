# Implementation Plan

## Overview

Board da PrÃ©-ImpressÃ£o (Frente 2). Motor puro + testes â†’ schema/migraÃ§Ã£o â†’
service â†’ gancho na FundaÃ§Ã£o â†’ rotas â†’ testes de integraÃ§Ã£o â†’ front â†’ verificaÃ§Ã£o
e commit. Reusa o Servico_Eventos da FundaÃ§Ã£o.

## Tasks

- [x] 1. Motor puro `pre-impressao.motor.ts` + testes
  - Criar o motor (ETAPAS, StatusEtapa, Caminho, `etapasRelevantes`, `boardConcluido`, `validarStatus`, `PreImpressaoError`) e `pre-impressao.motor.test.ts` (P1â€“P3).
  - _Requirements: 7.1, 7.2_

- [x] 2. Schema + migrate-prod (etapa_pre_impressao)
  - Model `EtapaPreImpressao` + relaÃ§Ã£o inversa em `PedidoProposta`; `migrate-prod.ts` idempotente (CREATE TABLE/INDEX/UNIQUE IF NOT EXISTS + FK try/catch); `prisma generate`.
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 3. Service `pre-impressao.service.ts`
  - `garantirBoard` (idempotente, evento BOARD_CRIADO), `obterBoard`, `listarPedidosEmPreImpressao`, `mudarStatusEtapa` (datas + evento + PRE_IMPRESSAO_CONCLUIDA quando board concluÃ­do). empresaId explÃ­cito; best-effort no Servico_Eventos.
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 2.1, 2.2, 2.3, 2.5, 2.6, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4_

- [x] 4. Gancho na FundaÃ§Ã£o (aoEntrarPreImpressao)
  - Em `pedido-integracoes.service.ts`, `aoEntrarPreImpressao` chamando `garantirBoard` em try/catch; acionar best-effort quando a transiÃ§Ã£o leva a PRE_IMPRESSAO_EM_ANDAMENTO.
  - _Requirements: 1.1, 3.4_

- [x] 5. Rotas `pre-impressao.routes.ts`
  - GET `/pre-impressao/pedidos`, GET `/pedidos-proposta/:id/board`, POST `/pedidos-proposta/:id/board/garantir`, PATCH `/pedidos-proposta/:id/board/:etapa`; authenticate + permissÃ£o; 404 cross-empresa; registrar no server.ts.
  - _Requirements: 1.4, 2.4, 4.1, 4.2, 6.5_

- [x] 6. Testes de integraÃ§Ã£o (mock de Prisma)
  - `pre-impressao.service.test.ts`: idempotÃªncia de garantirBoard, isolamento por empresaId, mudanÃ§a de status + evento, board concluÃ­do.
  - _Requirements: 7.3_

- [x] 7. Front â€” tela de PrÃ©-ImpressÃ£o (board)
  - `orcamento-grafico/pre-impressao/page.tsx`: lista de pedidos em prÃ©-impressÃ£o + progresso; board com 4 etapas (iniciar/concluir/voltar + observaÃ§Ã£o); item no menu Comercial.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 8. VerificaÃ§Ã£o e commit
  - Testes (motor + integraÃ§Ã£o); get_diagnostics limpo (back e front); next build; migrate-prod idempotente. Commits separados (back: schema+migrate juntos; front Ã  parte). NÃ£o commitar configurador/produtos nem useProduto.
  - _Requirements: 5.1, 7.2, 7.3_

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2"] },
    { "wave": 2, "tasks": ["3"] },
    { "wave": 3, "tasks": ["4", "5", "6"] },
    { "wave": 4, "tasks": ["7"] },
    { "wave": 5, "tasks": ["8"] }
  ]
}
```

```mermaid
flowchart TB
  T1[1. Motor + testes] --> T3[3. Service]
  T2[2. Schema/migrate] --> T3
  T3 --> T4[4. Gancho Fundacao]
  T3 --> T5[5. Rotas]
  T3 --> T6[6. Testes integracao]
  T5 --> T7[7. Front]
  T4 --> T8[8. Verificacao + commit]
  T6 --> T8
  T7 --> T8
```

## Notes

- Back e Front repos separados. 1â€“6 no Back; 7 no Front; 8 fecha.
- schema.prisma + migrate-prod.ts no mesmo commit; idempotente.
- Reusa Servico_Eventos; nÃ£o altera a mÃ¡quina de estados da FundaÃ§Ã£o.
- empresaId explÃ­cito; ganchos best-effort.
- Scripts temporÃ¡rios `_tmp-`, removidos apÃ³s uso.
