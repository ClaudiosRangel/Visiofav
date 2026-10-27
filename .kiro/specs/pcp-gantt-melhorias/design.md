# Design — Melhorias no Gantt de Produção (PCP)

## Overview

Evolução aditiva do Gantt existente. Nada é reescrito do zero: estendemos o
motor puro `timeline-agenda.service.ts`, a rota `GET /pcp/timeline`, o schema
de `OrdemProducao` e a tela `/pcp/gantt`. Base de comparação (padrão de
mercado): Bryntum Scheduler/Gantt, DHTMLX, Siemens Preactor/Opcenter,
PlanetTogether, MS Project.

Princípio-guia: **não-regressão** — sem usar nenhuma feature nova, a saída do
motor e o render são idênticos aos de hoje (garantido por testes de propriedade
já existentes + novos).

```mermaid
flowchart LR
  subgraph Back[VisioFab.Wms.Back]
    SCH[(schema.prisma\nOrdemProducao\n+corGantt +statusGanttObs)]
    MIG[migrate-prod.ts\nADD COLUMN IF NOT EXISTS]
    ENG[timeline-agenda.service.ts\n+resolverNoOverlap]
    RT1[GET /pcp/timeline\n+cor/status +ocupacao]
    RT2[PATCH /ordens-producao/:id/gantt\ncor+status]
    RT3[PATCH /pcp/etapas/reordenar\n(reuso)]
  end
  subgraph Front[VisioFab.Wms.Front]
    GANTT[/pcp/gantt/page.tsx/]
    HELPERS[gantt-layout.ts\nstack + ocupacao + setas]
  end
  SCH --> MIG
  ENG --> RT1
  RT1 --> GANTT
  RT2 --> GANTT
  RT3 --> GANTT
  HELPERS --> GANTT
```

## Architecture

Três camadas, todas estendidas (nenhuma reescrita):

- **Backend (`VisioFab.Wms.Back`)** — schema `OrdemProducao` (+`corGantt`,
  +`statusGanttObs`); motor puro `timeline-agenda.service.ts` (+`resolverNoOverlap`);
  rota `GET /pcp/timeline` (expõe cor/status); rota nova
  `PATCH /pcp/ordens-producao/:id/gantt`; reuso de `PATCH /pcp/etapas/reordenar`.
- **Frontend (`VisioFab.Wms.Front`)** — tela `/pcp/gantt/page.tsx` + novo módulo
  puro `gantt-layout.ts` (empilhamento, ocupação, pontos de seta).
- **Transversal** — multi-tenant por `empresaId` explícito; schema+migrate no
  mesmo commit; não-regressão por testes de propriedade.

As seções por requisito abaixo detalham cada componente.

## Components and Interfaces

### Requirement 1 — Visibilidade da OP (confirmação + ajuda)

Sem mudança de regra: o `where` da rota já filtra
`{PROGRAMADA, LIBERADA, EM_PRODUCAO}` com `take: 100` e ordenação
prioridade→entrega→número. Entrega: um ícone de ajuda (`IconInfoCircle` +
`Tooltip`/`Popover`) no cabeçalho do Gantt explicando quando a OP aparece.
Zero backend.

## Requirement 2 — Abrir no "agora" + navegação/zoom

### Frontend
- **Auto-scroll inicial:** após o 1º `carregar()` e o cálculo de `minTime`,
  um `useEffect` posiciona `ganttRef.current.scrollLeft` em
  `((agora - minTime)/60000)*pixelsPorMinuto − viewportWidth*0.3` (margem de
  30% à esquerda). Guardar um flag `jaAncorou` para fazer só na 1ª carga.
- **Botão "Hoje":** `ActionIcon`/`Button` que reexecuta o posicionamento acima.
- **Zoom contínuo:** `pixelsPorMinuto` passa a ser estado numérico contínuo
  (default por visão). Botões `−`/`+` multiplicam por 0.8/1.25 (clamp
  0.05..6). `Ctrl+wheel` sobre a área ajusta o zoom **ancorado no cursor**
  (preserva o instante sob o mouse): calcula o `ms` sob o cursor antes, aplica
  o novo ppm, e recoloca `scrollLeft` para manter esse `ms` fixo.
- **SegmentedControl** 12h/24h/3d/7d mantido: cada opção seta um ppm base, mas
  o usuário pode continuar ajustando com −/+ (as duas coexistem).
- **Auto-refresh sem reset:** o `setInterval(carregar)` NÃO mexe em
  `scrollLeft`/ppm (preserva a posição). Só o 1º load ancora.

Sem backend.

## Requirement 3 — Cor única padrão + cor/status por OP

### Schema (`OrdemProducao`)
```prisma
corGantt       String? @map("cor_gantt") @db.VarChar(9)   // "#RRGGBB" ou "#RRGGBBAA"
statusGanttObs String? @map("status_gantt_obs") @db.VarChar(120)
```
NÃO tocar o campo existente `cor` (impressão gráfica). `migrate-prod.ts`:
dois `ALTER TABLE ordem_producao ADD COLUMN IF NOT EXISTS ...` idempotentes.

### Backend
- `GET /pcp/timeline`: incluir `corGantt` e `statusGanttObs` no `select` da OP
  e propagá-los em cada `OpTimeline` (campos `corGantt`, `statusObs`).
- **Nova rota** `PATCH /api/pcp/ordens-producao/:id/gantt`
  (em `timeline-producao.routes.ts`, mesmo prefixo `/pcp`):
  - Body Zod: `{ corGantt?: string|null; statusGanttObs?: string|null }`
    (cor validada por regex `^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$` quando
    presente; `null` limpa).
  - Isolamento: `findFirst({ where: { id, empresaId: user.empresaId } })`;
    404 se não achar (multi-tenant).
  - `update` + `LogOrdemProducao` (statusAnterior/Novo = "GANTT_VISUAL",
    observação com os valores).
  - Reusa permissão de planejador já usada pelo `/agendar` (`podeMover`).

### Frontend
- `COR_PADRAO = '#4C6EF5'` (azul neutro Mantine indigo-6). `getOpColor` passa a
  retornar `op.corGantt || COR_PADRAO` (remove o ciclo de 20 cores; o mapa de
  cores por índice é descontinuado).
- Editor: item no `Menu.Dropdown` do bloco → abre um `Popover`/`Modal` com
  `ColorInput` (Mantine, com swatches) + `TextInput` (status) + botões Salvar /
  Limpar cor / Limpar status. Salva via `PATCH .../gantt`, atualização otimista
  + `carregar()`.
- Render: selo discreto com `statusObs` no canto do bloco (quando largura
  comporta) + linha no tooltip. A cor aplica a TODAS as barras da OP (já que
  `getOpColor` usa `opId`→`corGantt`).

## Requirement 4 — No-overlap (empilhamento + empurrão + 1 clique)

### 4a. Empilhamento visual (frontend, `gantt-layout.ts`)
Função pura `empilharBarras(barras): BarraComLinha[]` — algoritmo clássico de
*interval partitioning* (lane assignment): ordena por início, atribui cada
barra à primeira sub-linha cujo fim anterior ≤ início atual; cria nova
sub-linha se necessário. Retorna `subLinha` (0..k) por barra e `maxSubLinhas`
por raia. A altura da raia passa a ser `max(1, maxSubLinhas) * SUBLINHA_H`.
Determinístico; testável isoladamente (vitest).

### 4b. Empurrão automático (motor puro — `timeline-agenda.service.ts`)
Nova função `resolverNoOverlap(etapasDoCentro, turno, excecoes)`:
- Entrada: etapas de UM centro já com `inicioPrevisto` calculado + flags de
  trava + fila.
- Regra (capacidade finita = 1 por vez): percorre em ordem de início efetivo;
  mantém um `cursorLivre` (fim da última barra alocada). Para cada etapa:
  - **Travada:** é ponto fixo; não se move; `cursorLivre = max(cursorLivre,
    fimDela)`. Se uma não-travada estava sobreposta, foi empurrada antes.
  - **Não travada:** `inicio = max(inicioAtual, cursorLivre)` (empurra para o
    primeiro instante livre), respeitando turno (`avancar`); recalcula fim;
    `cursorLivre = fim`.
- Integra em `calcularInicioPorFila`/`calcularAgenda` **atrás de um flag**
  `noOverlap` (default **true** na rota; mas a NÃO-REGRESSÃO vale porque, sem
  colisão, `max(inicioAtual, cursorLivre) == inicioAtual`). Property test:
  sem sobreposição de entrada ⇒ saída idêntica.
- Determinístico; não quebra âncoras (travadas vencem).

### 4c. Resolver conflito em 1 clique (frontend + reuso)
Botão "Resolver conflitos" por raia (ou global): reaplica a fila sequencial
chamando `PATCH /pcp/etapas/reordenar` (já existe) com a ordem por início e,
em seguida, `carregar()` — o motor com `noOverlap` sequencia. Mantém o painel
de conflitos atual como diagnóstico.

## Requirement 5 — Filtros + foco + setas de dependência reais

### Filtros (frontend, estado local)
- `filtroCentros: string[]`, `filtroTipos: string[]`, `filtroIndicador: string|null`.
- Aplicados na montagem das `raias`/`timeline` (visual apenas): raia some se o
  centro/tipo não está no filtro; OP some do foco se o indicador não bate.
- UI: `MultiSelect` (centros e tipos, populados do próprio payload) +
  `Select` (indicador) + a busca atual. Botão "Limpar filtros".

### Foco da OP + setas
- `opEmFoco: string|null` (clicar numa barra seta/limpa). Barras da OP em foco
  ficam opacas; demais com `opacity 0.25`.
- **Setas reais:** um overlay `<svg>` absoluto sobre a área do Gantt (um por
  render), desenhando, para a OP em foco, um caminho do ponto (fimX, yRaia) da
  etapa `n` ao ponto (inicioX, yRaia) da etapa `n+1` (ordem `sequencia`). Usa
  `<path>` com curva (bezier) + `<marker>` de seta. Suporta "para trás"
  (quando `inicioX(n+1) < fimX(n)`) desenhando a curva com laço/retorno, padrão
  MS Project (Finish-to-Start reverso). Coordenadas derivadas do mesmo mapa
  `raiaTop`/`barLeft` já usado nas barras (sem novo cálculo de carga).
- Leve: SVG só desenha as setas da OP focada (poucas linhas), não de todas.

Sem backend (sequência já vem no payload).

## Requirement 6 — Reordenar fila arrastando no Gantt

- Adicionar um "handle" de reordenação OU detectar drag **vertical dominante**
  dentro da mesma raia como reordenação (vs. drag horizontal = reagendar
  temporal, já existente). Para não conflitar com o drag temporal, o modo
  reordenar fila fica num **toggle** ("Modo: Reagendar | Reordenar fila") no
  cabeçalho — padrão claro e sem ambiguidade (evita heurística frágil de
  eixo). Em "Reordenar fila", arrastar um bloco sobre outro da mesma raia
  reposiciona na fila.
- Ao soltar: `PATCH /pcp/etapas/reordenar` com `{ centroProducaoId, etapaIds }`
  na nova ordem (rota já existente; renumera `posicaoFila` 1..N). `carregar()`
  recalcula cascata + no-overlap.
- Coexiste com âncoras (travadas continuam pontos fixos).

## Requirement 7 — Ocupação por máquina

- Função pura `ocupacaoPorDia(barrasDaRaia, turno, excecoes, diasVisiveis)`
  (frontend `gantt-layout.ts`): para cada dia visível, soma minutos de operação
  das barras naquele dia ÷ minutos úteis da janela de turno do dia (usa a mesma
  `janelaDoDia` portada). Retorna `%` por dia.
- UI: uma mini-faixa no rótulo da raia (coluna fixa) com a média de ocupação do
  período + cor (verde <70%, âmbar 70–100%, vermelho >100%). Opcional: heat por
  dia na própria raia (atrás das barras), discreto. Sem query extra.

## Requirement 8 — Unificação de telas

- `/pcp/timeline/gantt/page.tsx` → vira redirect para `/pcp/gantt`
  (`redirect('/pcp/gantt')` do Next) OU remoção do arquivo + ajuste do link em
  `/pcp/timeline/page.tsx` (hoje aponta para `/pcp/timeline/gantt`) para
  `/pcp/gantt`. Escolha: **redirect** (menos risco de link quebrado externo).
- Verificar `ModuleSidebar` para garantir item único apontando `/pcp/gantt`.

## Requirement 9 — Performance

- Extrair helpers puros para `gantt-layout.ts` (empilhamento, ocupação, setas)
  e memoizar por raia.
- Virtualização de raias: renderizar só as raias no viewport vertical
  (janela + buffer) usando o `scrollTop` já sincronizado. Como o layout é
  absoluto por `top`, dá para pular o desenho de barras de raias fora da
  janela. Alternativa mínima: `content-visibility: auto` + `contain` nos
  blocos de grupo. Preferir a virtualização por faixa visível.
- Garantir que drag/zoom usem refs (já é o padrão) e não disparem re-render da
  carga inteira.

## Requirement 10 — Transversal

- Testes do motor (`timeline-agenda.service.test.ts`): manter os existentes +
  adicionar Properties do no-overlap (sem colisão ⇒ idêntico; nunca gera
  sobreposição na saída; respeita travadas; determinismo).
- Multi-tenant: nova rota `/:id/gantt` e reordenar filtram `empresaId`
  explícito.
- Schema + migrate-prod no mesmo commit.

## Data Models

```prisma
model OrdemProducao {
  // ... campos existentes ...
  corGantt       String? @map("cor_gantt") @db.VarChar(9)
  statusGanttObs String? @map("status_gantt_obs") @db.VarChar(120)
}
```
`migrate-prod.ts` (idempotente):
```sql
ALTER TABLE ordem_producao ADD COLUMN IF NOT EXISTS cor_gantt VARCHAR(9);
ALTER TABLE ordem_producao ADD COLUMN IF NOT EXISTS status_gantt_obs VARCHAR(120);
```

## Contratos de API

### GET /pcp/timeline (estendido, aditivo)
Cada `OpTimeline` ganha: `corGantt: string|null`, `statusObs: string|null`.
(Ocupação é calculada no front a partir dos dados já presentes.)

### PATCH /api/pcp/ordens-producao/:id/gantt (novo)
Request: `{ corGantt?: string|null, statusGanttObs?: string|null }`
Response: `{ id, corGantt, statusGanttObs }`
Erros: 400 (cor inválida), 403 (sem permissão), 404 (OP de outra empresa).

### PATCH /api/pcp/etapas/reordenar (reuso, Req 6/4c)
Já existente: `{ centroProducaoId, etapaIds }` → renumera `posicaoFila`.

## Correctness Properties

### Property 1: Não-regressão
Sem nenhuma colisão nas entradas, a saída de `calcularAgenda` com `noOverlap`
é idêntica à saída atual (sem no-overlap).
**Validates: Requirements 4.5, 10.1**

### Property 2: Sem sobreposição
Após `resolverNoOverlap`, não existe par de etapas não-travadas da mesma raia
com intervalos `[inicio,fim)` sobrepostos.
**Validates: Requirements 4.2**

### Property 3: Travadas preservadas
Etapas com `agendaTravada` mantêm exatamente seu `inicioAgendadoManual`
(ajustado ao turno) após o no-overlap.
**Validates: Requirements 4.3**

### Property 4: Determinismo
Mesmas entradas ⇒ mesma saída.
**Validates: Requirements 4.6**

### Property 5: Empilhamento
`empilharBarras` nunca coloca duas barras com sobreposição temporal na mesma
sub-linha; usa o número mínimo de sub-linhas.
**Validates: Requirements 4.1**

### Property 6: Ocupação
`ocupacaoPorDia` = soma de minutos de operação no dia ÷ minutos úteis da
janela; retorna 0 quando não há janela útil (evita divisão por zero).
**Validates: Requirements 7.1**

## Error Handling

- `PATCH /pcp/ordens-producao/:id/gantt`: 400 para cor fora do padrão hex;
  404 quando a OP não pertence à `empresaId` do usuário; 403 sem permissão
  `podeMover`. Status/cor `null` são válidos (limpar).
- Front: atualização otimista com rollback em erro (mesmo padrão do
  `agendarEtapa` atual); `notifications.show` com a mensagem do backend.
- Motor: `resolverNoOverlap` tem guarda de iterações (teto) para não entrar em
  laço; sem turno trata como tempo linear (fallback já existente).

## Testing Strategy

- **Motor (vitest + fast-check):** Properties P1–P4 do no-overlap (além dos
  testes atuais do `timeline-agenda.service.test.ts`, que permanecem verdes).
- **Helpers de layout (vitest):** P5 (empilhamento) e P6 (ocupação) no
  `gantt-layout.ts`.
- **Front:** `get_diagnostics` limpo + `npm run build` (Next) OK. Validação
  visual (ancorar hoje, cor/status, empilhar, filtros, setas, reordenar,
  ocupação) com o usuário.
- Backend/Front são repos SEPARADOS (commits independentes). Schema+migrate
  juntos.

## Decisões de Design (resumo)
- Cor/status **por OP** (D1).
- No-overlap = **visual (stack) + motor (empurrão) + 1 clique** (D2).
- Reordenar fila por **toggle de modo** (evita heurística de eixo ambígua).
- Setas desenhadas só para a **OP em foco** (performance + clareza).
- `/pcp/gantt` é a tela oficial; legada vira redirect.
