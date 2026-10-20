# Design Document

## Overview

Adiciona **exceções de calendário por centro e por data** ao motor de agenda do Gantt. Uma exceção sobrepõe o turno-base do centro naquela data específica, nos três modos pedidos: hora extra (estende o expediente), dia extra (torna um dia não-útil trabalhável) e não-trabalho (torna um dia útil não trabalhável).

O coração da mudança é tornar o motor puro (`timeline-agenda.service.ts`) **consciente da data**: hoje ele usa um único turno fixo por centro para qualquer dia. Passará a resolver, para cada dia civil que o cursor atravessa, qual é a **janela trabalhável efetiva** daquele dia: a exceção da data (se houver) ou o turno-base (default). Isso é feito com uma função `janelaDoDia(data, turno, excecoes)` que todas as rotinas de avanço/snap/segmentação consultam.

O recurso é aditivo: sem exceções, `janelaDoDia` devolve exatamente o turno-base e a saída é idêntica à atual.

## Architecture

```
Frontend (pcp/gantt/page.tsx)
  │  GET /pcp/timeline  ──────────────▶ timeline-producao.routes.ts
  │                                        │ carrega etapas + turno por centro
  │                                        │ carrega ExcecaoTurno por empresa/centro
  │                                        │ monta EtapaAgenda + excecoesPorCentro
  │                                        ▼
  │                                     calcularAgenda(etapas, agora, excecoesPorCentro)   (PURO)
  │                                        │  janelaDoDia(data, turnoBase, excecoes)
  │                                        │  calcularFimComTurno / ajustarParaTurno
  │  ◀── timeline + excecoesPorCentro ─────┘
  │
  └─ intervalosForaDoTurno(barra, turno, excecoes)  → segmentação visual

Cadastro de exceções
  CRUD  /pcp/excecoes-turno  ──────────▶ excecao-turno.routes.ts (empresaId explícito)
  Tela  pcp/cadastros/excecoes-calendario/page.tsx
```

## Components and Interfaces

### Backend — model e migração
- `ExcecaoTurno` em `schema.prisma` + `CREATE TABLE IF NOT EXISTS` em `migrate-prod.ts` (mesmo commit, idempotente — steering database-migrations).

### Backend — motor puro (`timeline-agenda.service.ts`)
Novos tipos e funções (aditivos):

```ts
export interface ExcecaoCalendario {
  data: string            // "2026-10-24" (dia civil local)
  tipo: 'HORA_EXTRA' | 'DIA_EXTRA' | 'NAO_TRABALHO'
  horaInicio: string | null  // "17:00"
  horaFim: string | null     // "20:00"
}

/** Janela trabalhável efetiva de um dia: exceção da data sobrepõe o turno-base. */
export function janelaDoDia(
  data: Date,
  turnoBase: TurnoAgenda | null,
  excecoes: ExcecaoCalendario[],
): { trabalha: boolean; inicioMin: number; fimMin: number } | null
```

As funções `calcularFimComTurno`, `ajustarParaTurno` ganham um parâmetro opcional `excecoes: ExcecaoCalendario[]` e passam a resolver a janela por dia via `janelaDoDia`. `EtapaAgenda` ganha `excecoes: ExcecaoCalendario[]` (do centro). `calcularAgenda`/`calcularInicioPorFila`/`calcularTimelineOp` propagam.

Assinaturas mantêm compatibilidade: parâmetro `excecoes` default `[]`.

### Backend — rota do timeline (`timeline-producao.routes.ts`)
- Carrega `ExcecaoTurno` da empresa (filtro `empresaId`), agrupa por `centroProducaoId`.
- Anexa ao `EtapaAgenda` a lista de exceções do centro da etapa.
- No payload de resposta, adiciona `excecoesPorCentro: Record<centroId, ExcecaoCalendario[]>` para o front segmentar.

### Backend — CRUD (`excecao-turno.routes.ts`)
- `GET /pcp/excecoes-turno?centroProducaoId=&mesInicio=&mesFim=` — lista filtrada por empresa.
- `POST /pcp/excecoes-turno` — cria (valida centro da empresa; 409 se duplicado centro+data).
- `PUT /pcp/excecoes-turno/:id` — edita (404 se de outra empresa).
- `DELETE /pcp/excecoes-turno/:id` — exclui (404 se de outra empresa).
- Registrada em `server.ts` com `authenticate` + `moduloGuard('PCP')`, prefixo `/api/pcp`.

### Frontend — tela de cadastro
- `pcp/cadastros/excecoes-calendario/page.tsx`: seletor de centro + lista de exceções (DataTablePadrao) + modal de criação (tipo, data, hora início/fim condicionais, observação).

### Frontend — Gantt (`pcp/gantt/page.tsx`)
- `intervalosForaDoTurno()` passa a receber as exceções do centro da barra e usa `janelaDoDia` (porta JS equivalente) para desenhar janelas extras como úteis e não-trabalho como vãos.

## Data Models

```prisma
model ExcecaoTurno {
  id               String   @id @default(uuid())
  empresaId        String   @map("empresa_id")
  centroProducaoId String   @map("centro_producao_id")
  data             DateTime @db.Date
  tipo             String   @db.VarChar(20) // HORA_EXTRA | DIA_EXTRA | NAO_TRABALHO
  horaInicio       String?  @map("hora_inicio") @db.VarChar(5)
  horaFim          String?  @map("hora_fim") @db.VarChar(5)
  observacao       String?  @db.VarChar(300)
  criadoEm         DateTime @default(now()) @map("criado_em")
  atualizadoEm     DateTime @updatedAt @map("atualizado_em")

  centroProducao CentroProducao @relation(fields: [centroProducaoId], references: [id], onDelete: Cascade)

  @@unique([centroProducaoId, data])
  @@index([empresaId])
  @@map("excecao_turno")
}
```
`CentroProducao` ganha `excecoesTurno ExcecaoTurno[]` (lado inverso).

## Correctness Properties

### Property 1: Não-regressão sem exceções
Para qualquer conjunto de etapas e `agora`, `calcularAgenda(etapas, agora, {})` (sem exceções) produz exatamente o mesmo resultado que a versão atual do motor.
**Validates: Requirements 3.4**

### Property 2: HORA_EXTRA/DIA_EXTRA estende a janela do dia
Dada uma etapa cujo processamento alcança uma data `D` com exceção `HORA_EXTRA`/`DIA_EXTRA` de janela `[hi,hf]`, o motor consome tempo dentro de `[hi,hf]` nessa data (mesmo que `D` não seja dia útil no turno-base ou que `[hi,hf]` ultrapasse o fim do turno-base).
**Validates: Requirements 3.1, 3.5**

### Property 3: NAO_TRABALHO bloqueia o dia
Dada uma data `D` com exceção `NAO_TRABALHO` para o centro, nenhum minuto de produção é alocado em `D`; o cursor salta para o próximo dia trabalhável.
**Validates: Requirements 3.2**

### Property 4: Prioridade exceção > turno-base
Para qualquer data com exceção, `janelaDoDia` retorna a janela da exceção; para datas sem exceção, retorna o turno-base.
**Validates: Requirements 3.1, 3.2, 3.3**

### Property 5: Unicidade centro+data
Não é possível persistir duas exceções com o mesmo `centroProducaoId` e `data` (constraint única + validação 409).
**Validates: Requirements 1.4**

## Error Handling

- Validação Zod nas rotas: `tipo` em enum; `data` ISO; `horaInicio`/`horaFim` `HH:MM` obrigatórios quando `tipo != NAO_TRABALHO`, com `horaFim > horaInicio`.
- 409 em violação de unicidade centro+data (checar antes do insert e capturar P2002 como rede de segurança).
- 404 quando a exceção/centro não pertence à empresa do usuário.
- Motor puro: janela inválida (hf <= hi) é tratada como dia não trabalhável defensivamente (não lança — evita travar o cálculo do Gantt inteiro por 1 dado ruim).

## Testing Strategy

- **Unit/property (vitest + fast-check)** em `timeline-agenda.service.test.ts` (estender o arquivo existente): Properties 1-4. Property 1 compara com um "oráculo" congelado (snapshot do cálculo sem exceções). Casos golden: hora extra que faz caber uma OP no mesmo dia; sábado como dia extra; feriado que empurra a OP.
- **Unit** de `janelaDoDia`: exceção vence turno; não-trabalho; dia sem exceção; janela inválida.
- Backend de rota: isolamento (empresaId), 409 duplicado, 404 cross-empresa — cobertos por revisão + testes de serviço se houver mock de prisma; a validação Zod é testável isoladamente.
- Verificação final: `get_diagnostics` nos arquivos tocados; build Next do front; `migrate-prod.ts` idempotente (rodar 2× local quando Postgres disponível, senão garantido por `IF NOT EXISTS`).
