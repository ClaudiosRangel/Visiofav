# Requirements Document

Melhorias no Gantt de Produção (PCP).

## Introduction

O PCP já possui um Gantt de produção maduro em `/pcp/gantt`
(`VisioFab.Wms.Front/src/app/(interna)/pcp/gantt/page.tsx`), alimentado pela
rota `GET /pcp/timeline` (`VisioFab.Wms.Back/src/modules/pcp/
timeline-producao.routes.ts`) e pelo motor puro de agendamento
`timeline-agenda.service.ts`. Hoje ele já faz: raias por centro de produção
agrupadas por tipo de processo, cascata preditiva com turno/exceções de
calendário, travar/mover blocos (âncora de agenda), segmentação visual de
vãos fora do turno, detecção de conflitos, linha "agora", marcadores de
entrega e indicadores de desvio.

Esta spec evolui o Gantt para o patamar dos melhores APS/MES do mercado
(Siemens Opcenter/Preactor, Bryntum Gantt/Scheduler, DHTMLX, PlanetTogether,
MS Project) atendendo 5 pedidos do usuário mais 8 melhorias complementares,
TODAS aditivas e sem regressão do comportamento atual.

Decisões já firmadas com o usuário:
- **D1** — Cor e observação-de-status são **por OP** (não por etapa): a cor
  identifica o trabalho atravessando as máquinas (padrão *event color* do
  mercado).
- **D2** — "Não sobrepor" implementa **os dois níveis** do padrão de mercado:
  empilhamento visual (nunca um bloco por cima do outro) **e** empurrão
  automático por capacidade finita (uma máquina roda 1 job por vez) ao
  mover/soltar, com botão de resolver conflito em 1 clique.
- **D3** — Tudo deve seguir padrão de mercado e ser profissional.

## Glossary
- **Raia (lane/row):** linha horizontal do Gantt correspondente a um
  `CentroProducao` (máquina/recurso).
- **Barra (bar/event):** bloco que representa uma `EtapaOrdemProducao`
  (operação) numa raia, posicionada no eixo de tempo.
- **Âncora de agenda (pin):** etapa travada numa data manual
  (`agendaTravada`+`inicioAgendadoManual`), já existente.
- **No-overlap / capacidade finita:** regra de que uma máquina executa no
  máximo 1 operação por vez (sem sobreposição temporal na mesma raia).
- **Cascata:** encadeamento sequência→sequência das etapas de uma mesma OP.

## Requirements

### Requirement 1: Visibilidade da OP no Gantt (confirmação de comportamento)

**User Story:** Como planejador, quero entender e confiar em QUANDO uma OP
aparece no Gantt, para saber que o quadro reflete a carga firme de produção.

#### Acceptance Criteria
1. WHEN uma OP tem status em `{PROGRAMADA, LIBERADA, EM_PRODUCAO}` E possui ao
   menos uma etapa com `centroProducao` e tempos previstos THEN o sistema SHALL
   exibi-la no Gantt.
2. WHEN uma OP está em `{RASCUNHO, PLANEJADA}` THEN o sistema SHALL NÃO exibi-la
   no Gantt (ainda não sequenciada).
3. WHEN uma OP está em `{CONCLUIDA, CANCELADA}` THEN o sistema SHALL NÃO
   exibi-la no Gantt ativo.
4. O sistema SHALL preservar o limite e a ordenação de carga atuais (até 100
   OPs por consulta, ordenadas por prioridade → data de entrega → número) sem
   regressão.
5. O comportamento acima SHALL ser documentado de forma visível ao usuário (ex.:
   tooltip de ajuda / legenda no cabeçalho do Gantt) para eliminar a dúvida.

### Requirement 2: Abrir ancorado no "agora" + navegação/zoom profissional

**User Story:** Como planejador, ao abrir o Gantt quero ver imediatamente o
dia/hora atual e navegar/aproximar o tempo com fluidez, como nos APS de
mercado.

#### Acceptance Criteria
1. WHEN o Gantt carrega pela primeira vez THEN o sistema SHALL posicionar o
   scroll horizontal de modo que a linha "agora" esteja visível (centralizada
   ou próxima da borda esquerda com margem), sem exigir ação do usuário.
2. The system SHALL fornecer um botão **"Hoje"** que recentraliza o scroll na
   linha "agora" a qualquer momento.
3. The system SHALL preservar as visões rápidas existentes (12h/24h/3d/7d) E
   adicionar navegação contínua: rolar para o passado/futuro e um controle de
   **zoom in/out** incremental (ex.: botões −/+ ou Ctrl+scroll) que ajusta
   `pixelsPorMinuto` de forma contínua.
4. WHEN o usuário troca de visão/zoom THEN o sistema SHALL manter o instante
   central do viewport estável (zoom ancorado no centro), padrão de mercado.
5. The system SHALL manter o auto-refresh de 60s SEM resetar a posição de
   scroll/zoom escolhida pelo usuário.

### Requirement 3: Cor única padrão + cor e status editáveis por OP

**User Story:** Como planejador, quero que todas as OPs tenham por padrão a
mesma cor neutra e poder atribuir manualmente uma cor e uma observação de
status a cada OP, para organizar visualmente o quadro do meu jeito.

#### Acceptance Criteria
1. WHEN uma OP não tem cor manual definida THEN o sistema SHALL exibir todas as
   barras com UMA cor neutra padrão única (não mais o ciclo de 20 cores por OP).
2. The system SHALL permitir, a partir do bloco/menu da OP no Gantt, definir
   uma **cor livre** (color picker) para a OP.
3. The system SHALL permitir, no mesmo editor, definir uma **observação de
   status** (texto livre curto, ex.: "Aguardando cliente", "Faltou chapa").
4. WHEN uma cor/observação é definida THEN o sistema SHALL persisti-la na OP
   (campos novos `corGantt`, `statusGanttObs` em `OrdemProducao`) e aplicá-la a
   TODAS as etapas daquela OP em TODAS as raias.
5. WHEN uma OP tem observação de status THEN o sistema SHALL exibi-la no tooltip
   e como um selo/legenda discreta no bloco.
6. The system SHALL permitir limpar a cor (voltar à cor padrão) e limpar a
   observação.
7. The persistence SHALL isolar por `empresaId` da OP real (multi-tenant) e
   registrar auditoria em `LogOrdemProducao`.
8. O campo existente `OrdemProducao.cor` (cor de impressão gráfica) SHALL NÃO
   ser reutilizado nem alterado — os campos do Gantt são novos e dedicados.

### Requirement 4: Não sobrepor OPs na mesma máquina (capacidade finita)

**User Story:** Como planejador, quero que duas operações nunca apareçam uma
por cima da outra na mesma máquina e que, ao reagendar, o sistema mantenha a
máquina rodando um trabalho de cada vez, como num APS de capacidade finita.

#### Acceptance Criteria
1. WHEN duas ou mais barras de uma mesma raia se sobrepõem no tempo THEN o
   sistema SHALL empilhá-las em sub-linhas dentro da raia (layout *stack*),
   nunca desenhando uma barra por cima da outra.
2. WHEN o usuário arrasta/solta (ou trava) uma etapa de modo a colidir com
   outra na mesma máquina THEN o motor de agendamento SHALL empurrar
   automaticamente as etapas subsequentes daquela máquina para eliminar a
   sobreposição (capacidade finita = 1 operação por máquina por vez),
   respeitando turno/exceções e âncoras já travadas.
3. The system SHALL preservar a prioridade da OP e as travas existentes ao
   empurrar: etapas travadas são pontos fixos; não travadas cedem lugar.
4. The system SHALL manter o painel de conflitos existente E oferecer um botão
   **"Resolver conflitos da máquina"** que reaplica o no-overlap na raia
   selecionada (sequencia os blocos um após o outro conforme fila/prioridade),
   em 1 clique.
5. WHEN não há sobreposição THEN a saída do motor SHALL ser idêntica à atual
   (Property de não-regressão: sem colisões, nada muda).
6. O motor de no-overlap SHALL ser determinístico (mesmas entradas ⇒ mesma
   saída) e implementado no núcleo puro `timeline-agenda.service.ts`, com
   testes (vitest + fast-check).

### Requirement 5: Filtrar por máquina/tipo/status e ver a cascata da OP com setas

**User Story:** Como planejador, quero filtrar o Gantt por máquina, tipo de
processo e status, e, ao focar uma OP, ver o fluxo sequência-a-sequência dela
ligado por setas (para frente e para trás no tempo), como no MS Project/Bryntum.

#### Acceptance Criteria
1. The system SHALL fornecer filtros (multiseleção) por **centro de produção
   (máquina)** e por **tipo de processo**, exibindo apenas as raias que
   atendem ao filtro.
2. The system SHALL fornecer filtro por **status da OP/indicador** (ex.:
   atrasado, risco de entrega, em andamento) além da busca por OP/cliente já
   existente.
3. WHEN o usuário seleciona/clica em uma OP THEN o sistema SHALL **realçar** todas
   as barras daquela OP (as demais ficam esmaecidas) em todas as raias.
4. WHEN uma OP está em foco THEN o sistema SHALL desenhar **setas de dependência
   reais** ligando o fim de cada etapa ao início da etapa seguinte (na ordem de
   `sequencia`), inclusive quando a etapa seguinte está mais cedo no tempo (seta
   apontando "para trás"), evidenciando a cascata/retorno de fluxo.
5. The system SHALL manter o desempenho aceitável com o realce/setas ativos
   (desenho vetorial leve, sem recomputar a carga inteira).
6. The filters and focus SHALL ser apenas de VISUALIZAÇÃO (não alteram dados) e
   SHALL poder ser limpos facilmente.

### Requirement 6: Reordenar a fila da máquina arrastando no próprio Gantt

**User Story:** Como planejador, quero reordenar a fila de uma máquina
arrastando os blocos no próprio Gantt (vertical/entre posições), sem precisar
ir ao painel de Programação.

#### Acceptance Criteria
1. WHEN o usuário reordena blocos de uma mesma raia THEN o sistema SHALL
   recalcular `posicaoFila` daquele centro (1..N) reutilizando a regra já
   existente de reordenação de fila do PCP.
2. The system SHALL refletir a nova ordem na cascata/no-overlap imediatamente
   após o reordenamento.
3. A reordenação SHALL respeitar e coexistir com as âncoras (etapas travadas) e
   com o drag temporal já existente (as duas interações não podem se anular).
4. The persistence SHALL isolar por `empresaId` e registrar auditoria.

### Requirement 7: Carga/ocupação por máquina (gargalos)

**User Story:** Como planejador, quero ver o percentual de ocupação de cada
máquina no período, para identificar gargalos e capacidade ociosa.

#### Acceptance Criteria
1. The system SHALL calcular, por raia e por dia visível, o **percentual de
   ocupação** = tempo planejado de operações ÷ tempo útil da janela de turno
   (considerando exceções de calendário).
2. The system SHALL exibir esse indicador de forma discreta (ex.: barra/heat
   na faixa da raia ou um selo por dia), sem poluir o Gantt.
3. WHEN a ocupação ultrapassa 100% (sobrecarga) THEN o sistema SHALL destacá-la
   visualmente (cor de alerta).
4. O cálculo SHALL ser derivado dos dados já carregados (sem query extra pesada)
   e isolado por `empresaId`.

### Requirement 8: Unificação das telas de Gantt/Timeline

**User Story:** Como usuário, quero uma única tela de Gantt oficial, para não
me confundir entre versões duplicadas.

#### Acceptance Criteria
1. The system SHALL consolidar a experiência de Gantt em `/pcp/gantt` (a versão
   rica e editável) como tela oficial.
2. The legacy `/pcp/timeline/gantt` (tabela read-only duplicada) SHALL ser
   removida OU transformada em redirecionamento para `/pcp/gantt`, eliminando
   código duplicado — sem quebrar links/menu.
3. The list view `/pcp/timeline` (resumo por OP) SHALL ser preservada (não é
   duplicata do Gantt; é uma visão complementar) e seu link para o Gantt SHALL
   apontar para `/pcp/gantt`.
4. The menu/sidebar SHALL refletir a tela oficial única.

### Requirement 9: Performance com volume (virtualização)

**User Story:** Como usuário com muitas OPs/etapas, quero o Gantt fluido, sem
travar.

#### Acceptance Criteria
1. WHEN há muitas raias/barras THEN o sistema SHALL renderizar de forma
   performática (ex.: virtualização de linhas e/ou memoização adequada),
   evitando recomputar/desenhar o DOM inteiro a cada interação.
2. The interactions (drag, zoom, scroll, realce) SHALL permanecer responsivas
   (sem travamento perceptível) em carga típica.
3. As otimizações SHALL preservar o comportamento visual e funcional dos demais
   requisitos (sem regressão).

### Requirement 10: Não-regressão e multi-tenant (transversal)

**User Story:** Como responsável técnico, quero que todas as melhorias sejam
aditivas, isoladas por empresa e migradas corretamente, para não quebrar o
comportamento atual nem vazar dados entre empresas.

#### Acceptance Criteria
1. The system SHALL preservar TODO o comportamento atual do Gantt quando
   nenhuma das novas features é usada (cor padrão, sem filtro, sem foco, sem
   colisão) — provado por testes do motor.
2. Toda query/persistência nova SHALL filtrar `empresaId` EXPLÍCITO da entidade
   real (OP), nunca confiar só em `prismaScoped` (bypass SUPER_ADMIN).
3. Mudanças de schema SHALL vir acompanhadas da alteração idempotente
   equivalente em `prisma/migrate-prod.ts`, no mesmo commit (steering
   database-migrations).
