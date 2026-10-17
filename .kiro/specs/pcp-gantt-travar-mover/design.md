# Design Document — pcp-gantt-travar-mover

## Overview

Transforma o Gantt de Produção de somente-leitura em um planejador visual
editável (padrão APS "pin/freeze"): o planejador pode TRAVAR uma etapa numa
data/hora de início e MOVER (arrastar) blocos para reagendar. O motor da
timeline passa a tratar etapas travadas como pontos fixos e recalcula o resto.

Três camadas:
1. **Schema** (`VisioFab.Wms.Back`): 2 campos novos em `EtapaOrdemProducao` —
   `inicioAgendadoManual` (DateTime?) e `agendaTravada` (Boolean default false)
   — + `migrate-prod.ts` idempotente no mesmo commit (regra do steering
   database-migrations).
2. **Backend**: rotas para travar/destravar/mover a etapa; o `Motor_Timeline`
   (`GET /pcp/timeline`) passa a respeitar as âncoras. Extração do núcleo de
   agendamento para funções puras testáveis.
3. **Frontend** (`VisioFab.Wms.Front`): drag & drop no Gantt + cadeado +
   menu travar/destravar; feedback otimista com rollback.

Invariante central (Req 6.1): **sem nenhuma etapa travada, a timeline é byte a
byte a de hoje** — a âncora é puramente aditiva.

## Architecture

### D1 — Âncora na própria etapa (não tabela separada)

A âncora (`inicioAgendadoManual` + `agendaTravada`) vive na própria
`EtapaOrdemProducao`, não numa tabela nova. Justificativa: é um atributo 1:1 da
etapa, consultado em TODA montagem da timeline (join extra seria custo
desnecessário); o padrão APS trata "pinned start" como propriedade da operação.
Sem FK nova, migração trivial e idempotente.

### D2 — Motor de timeline vira função pura testável

Hoje a lógica de cascata/fila está inline no handler de `GET /pcp/timeline`
(~400 linhas). Extraímos o núcleo determinístico para
`src/modules/pcp/timeline-agenda.service.ts` (funções PURAS, sem Prisma):
dadas as etapas (com tempos, turno, `posicaoFila`, status, datas reais e a
âncora), calcula `inicioPrevisto`/`fimPrevisto` por etapa. Isso permite:
- testar a regra da âncora com vitest (sem banco);
- garantir a não-regressão (Req 6.1) por teste.
O handler da rota passa a só buscar dados (Prisma) e delegar ao serviço puro.

### D3 — Regra do motor com âncora (APS pin)

No cálculo por centro (hoje: ordena por `posicaoFila`, cursor avança somando
durações no turno):
- Etapa **travada** → `inicioPrevisto = inicioAgendadoManual`;
  `fimPrevisto = calcularFimComTurno(inicio, duração, turno)`. Ela NÃO depende
  do cursor da fila; é um ponto fixo.
- Etapa **não travada** → como hoje (cursor da fila), MAS o cursor deve
  "pular" os intervalos ocupados por etapas travadas do mesmo centro (uma
  travada mais à frente no tempo não empurra as não-travadas antes dela; uma
  travada no meio cria uma barreira). Implementação: ao posicionar uma não
  travada, se o intervalo [início, fim] colidir com uma travada, empurrar o
  início para o fim da travada e recalcular.
- Conflitos (Req 4.4): a detecção de sobreposição por centro já existe e
  continua rodando sobre os intervalos finais — inclusive quando a colisão
  vem de uma âncora que o usuário fixou sobre outra etapa (o sistema NÃO
  impede o conflito, apenas sinaliza — como os APS "overload").

### D4 — Rotas de edição de agenda

Novas rotas em `etapa-operacional.routes.ts` (prefixo `/api/pcp`, já com
`authenticate` + `moduloGuard('PCP')`), restritas a perfil planejador/admin
(Req 6.3), isolando por `empresaId` via a OP (steering ATENCAO-pontos):

- `PATCH /pcp/etapas/:id/agendar` — body `{ inicio: ISO, centroProducaoId? }`.
  Trava a etapa (`agendaTravada=true`, `inicioAgendadoManual=inicio`); se vier
  `centroProducaoId`, move de centro (reusa a regra de `/etapas/:id/mover`).
  É a rota que o drag & drop chama. Proteção Req 2.3 (etapa/OP finalizada → 409).
- `PATCH /pcp/etapas/:id/destravar` — limpa a âncora
  (`agendaTravada=false`, `inicioAgendadoManual=null`).
- Ambas gravam `LogOrdemProducao` (Req 2.4) e retornam a etapa atualizada; o
  front então refaz `GET /pcp/timeline` (ou recebe a timeline recalculada).

### D5 — Frontend: drag & drop + cadeado

Aplicar na tela **`/pcp/gantt`** (a mais completa, com cor por OP e setas) como
a "oficial de edição"; `/pcp/timeline/gantt` permanece como visão read-only
(Req 5.4 permite). Usar arraste nativo (pointer events) convertendo o
deslocamento horizontal em delta de tempo (`pixelsPorMinuto`), com snap a
incrementos (ex.: 15 min). Soltar → `PATCH /agendar`. Feedback otimista:
posição aplicada localmente, revertida se a API falhar (Req 3.5). Cadeado no
bloco travado + menu de contexto "Travar/Destravar nesta data" (Req 5.1/5.2).

## Components and Interfaces

### Backend (VisioFab.Wms.Back)

| Arquivo | Mudança |
|---|---|
| `prisma/schema.prisma` | `EtapaOrdemProducao`: `inicioAgendadoManual DateTime?`, `agendaTravada Boolean @default(false)`. |
| `prisma/migrate-prod.ts` | `ADD COLUMN IF NOT EXISTS` dos 2 campos (idempotente). |
| `src/modules/pcp/timeline-agenda.service.ts` (NOVO) | Núcleo puro do agendamento (cascata + fila + âncora + turno). |
| `src/modules/pcp/timeline-agenda.service.test.ts` (NOVO) | vitest: Correctness Properties. |
| `src/modules/pcp/timeline-producao.routes.ts` | Passa a buscar os 2 campos e delegar ao serviço puro. |
| `src/modules/pcp/etapa-operacional.routes.ts` | `PATCH /etapas/:id/agendar` + `/etapas/:id/destravar`. |

### Frontend (VisioFab.Wms.Front)

| Arquivo | Mudança |
|---|---|
| `src/app/(interna)/pcp/gantt/page.tsx` | drag & drop; cadeado; menu travar/destravar; consome os campos de âncora. |

## Data Models

Alteração em `EtapaOrdemProducao` (schema + migrate-prod no MESMO commit):

```prisma
model EtapaOrdemProducao {
  // ... campos atuais ...
  /** Início manual travado pelo planejador no Gantt (APS pin). null = calculado. */
  inicioAgendadoManual DateTime? @map("inicio_agendado_manual")
  /** true = etapa é ponto fixo no motor (não recalcula o início pela fila). */
  agendaTravada        Boolean   @default(false) @map("agenda_travada")
}
```

`migrate-prod.ts` (idempotente, testado 2× local):

```sql
ALTER TABLE etapa_ordem_producao ADD COLUMN IF NOT EXISTS inicio_agendado_manual TIMESTAMP(3);
ALTER TABLE etapa_ordem_producao ADD COLUMN IF NOT EXISTS agenda_travada BOOLEAN NOT NULL DEFAULT false;
```

Contrato das rotas:
- `PATCH /pcp/etapas/:id/agendar` → body `{ inicio: string(ISO), centroProducaoId?: string }` → `{ etapa }`.
- `PATCH /pcp/etapas/:id/destravar` → `{ etapa }`.
- `GET /pcp/timeline` (estendido): cada etapa ganha `agendaTravada: boolean` e
  `inicioAgendadoManual: string|null` no payload (aditivo).

## Correctness Properties

Propriedades do núcleo puro `timeline-agenda.service.ts` (base dos testes).

### Property 1: Não-regressão sem âncora
Com todas as etapas `agendaTravada=false`, a saída (inícios/fins por etapa) é
idêntica à do cálculo atual (fila + cascata + turno).
**Validates: Requirements 6.1**

### Property 2: Âncora é respeitada
Para uma etapa travada, `inicioPrevisto == inicioAgendadoManual` exatamente,
independente da posição na fila.
**Validates: Requirements 4.1**

### Property 3: Fim deriva do início travado + duração no turno
Para uma etapa travada, `fimPrevisto == calcularFimComTurno(inicioAgendadoManual, setup+operacao, turno)`.
**Validates: Requirements 4.2**

### Property 4: Travada ocupa a janela para as não-travadas
Uma etapa não travada do mesmo centro nunca recebe um intervalo que se
sobreponha a uma travada quando há espaço depois dela (o cursor pula a janela
ocupada pela travada).
**Validates: Requirements 4.3**

### Property 5: Destravar remove o efeito da âncora
Removida a âncora (`agendaTravada=false`, `inicioAgendadoManual=null`), a etapa
volta ao início calculado pela fila (igual ao caso sem âncora).
**Validates: Requirements 4.5**

### Property 6: Determinismo
Mesmas entradas (etapas + âncoras + turno + "agora") produzem sempre a mesma
saída.
**Validates: Requirements 6.1**

## Error Handling

- Travar/mover etapa `CONCLUIDA` ou OP `CONCLUIDA`/`CANCELADA` → 409 com
  mensagem (Req 2.3 / 3.4). O front reverte o bloco à posição original.
- `inicio` ausente/inválido no `PATCH /agendar` → 400 (Zod) (Req 2.5).
- Mover para outro centro inexistente/da outra empresa → 404/validação.
- Concorrência (Req 6.4): a gravação é um `update` simples por `id` dentro de
  `where { id, ordemProducao: { empresaId } }`; última gravação válida vence,
  sem corromper (campos independentes). Sem transação longa.
- Falha de rede no drag → front reverte a posição otimista (Req 3.5).

## Testing Strategy

- **Unit (vitest) no backend**: `timeline-agenda.service.test.ts` cobrindo as 6
  Correctness Properties, incluindo um golden case que reproduz a timeline
  atual (não-regressão) e casos com 1 e 2 etapas travadas no mesmo centro.
- **Migração**: rodar `npx tsx prisma/migrate-prod.ts` 2× local (idempotência)
  antes do push; `schema.prisma` + `migrate-prod.ts` no mesmo commit.
- **Diagnostics/build**: `get_diagnostics` nos arquivos tocados; `prisma
  generate` OK no backend; `npm run build` (next) no frontend.
- **Validação manual**: travar uma etapa numa data, recarregar (persistiu);
  mover um bloco e ver o resto recalcular; destravar e ver voltar ao
  automático; conferir que sem travas a timeline é a de antes.

## Rastreabilidade (decisão → requisito)

- D1 (âncora na etapa) + D2 (motor puro) → Req 1, 6.1, 6.2.
- D3 (regra APS no motor) → Req 4.1–4.5.
- D4 (rotas agendar/destravar) → Req 2, 3, 6.3, 6.4.
- D5 (drag & drop + cadeado) → Req 3, 5.
