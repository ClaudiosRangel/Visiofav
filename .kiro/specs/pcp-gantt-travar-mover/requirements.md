# Requirements Document

## Introduction

Esta feature atende o **item 4** da reunião com a Carton Wega (15/10/2026):
"poder travar um bloco do Gantt e uma data, e poder mover no Gantt também",
com o pedido explícito de "seguir a funcionalidade como os melhores sistemas
do mercado nesse aspecto" (planejamento visual tipo APS — Advanced Planning &
Scheduling: Preactor, Asprova, SAP PP/DS).

Hoje o Gantt de Produção (telas `/pcp/gantt` e `/pcp/timeline/gantt`) é
**somente leitura**: as datas `inicioPrevistoAt`/`fimPrevistoAt` de cada etapa
são 100% CALCULADAS em tempo real pelo endpoint `GET /pcp/timeline`, a partir
da posição na fila do centro (`posicaoFila`) e dos tempos (setup + operação),
respeitando o turno. Não há persistência de agenda nem de bloqueio — portanto
não há como "fixar" uma etapa numa data nem reposicioná-la arrastando.

A feature introduz uma **âncora de agenda por etapa**: o planejador pode
TRAVAR uma etapa numa data/hora de início específica e MOVER (arrastar) um
bloco no Gantt para reagendá-lo. O motor de cálculo passa a RESPEITAR as
âncoras travadas como pontos fixos, recalculando apenas o que não está travado
(mesma lógica dos sistemas APS: "frozen"/"pinned" operations). Requer mudança
de schema (campos de âncora na etapa) propagada em `migrate-prod.ts`, novas
rotas de backend e drag & drop no frontend.

### Escopo

- Travar/destravar uma etapa numa data/hora de início (âncora manual).
- Mover (drag & drop) um bloco do Gantt → grava nova data de início como
  âncora manual (o ato de mover trava a etapa naquela data).
- O motor da timeline respeita as âncoras travadas e recalcula o restante.
- Feedback visual: bloco travado tem marca (cadeado); conflitos continuam
  sendo detectados e sinalizados (já existe detecção de sobreposição).

### Fora de escopo (explícito)

- Reagendamento automático/otimização global (algoritmo APS completo). Aqui é
  manual: o usuário trava e move; o motor só respeita e projeta o resto.
- Alteração da lógica de apontamento/execução de chão de fábrica.
- Capacidade finita multi-recurso avançada (apenas a fila por centro atual).
- As telas de visualização de planos (itens 1–3) são a Spec A, já entregue.

## Glossary

- **Etapa**: `EtapaOrdemProducao` — uma operação de produção de uma OP num
  centro, com `posicaoFila`, tempos (setup/operação) e status.
- **Ancora_Agenda**: dados persistidos na Etapa que fixam seu início: uma
  data/hora de início manual (`inicioAgendadoManual`) + um indicador de
  travamento (`agendaTravada`). Quando `agendaTravada = true`, a Etapa é um
  ponto fixo para o motor.
- **Motor_Timeline**: o cálculo preditivo de `GET /pcp/timeline` que projeta
  `inicioPrevistoAt`/`fimPrevistoAt` por etapa a partir da fila do centro e
  dos tempos, respeitando o turno.
- **Bloco_Gantt**: a barra visual de uma Etapa numa das telas de Gantt.
- **Mover_Bloco**: arrastar um Bloco_Gantt no eixo do tempo (e opcionalmente
  para outro centro) para definir uma nova data/hora de início.
- **Travar**: marcar a Etapa como `agendaTravada = true` numa data manual.
- **Destravar**: limpar a âncora (`agendaTravada = false`,
  `inicioAgendadoManual = null`), devolvendo a Etapa ao cálculo automático.
- **Planejador**: usuário de PCP com permissão para operar o Gantt editável.
- **Turno**: janela de trabalho do centro (`TurnoProducao`) já usada pelo motor.

## Requirements

### Requirement 1: Persistir a âncora de agenda na etapa

**User Story:** Como planejador de PCP, quero que a data/hora travada de uma
etapa fique gravada, para que o planejamento sobreviva a recargas e seja a
mesma para todos os usuários.

#### Acceptance Criteria

1. THE sistema SHALL persistir, por Etapa, um campo de data/hora de início
   manual (`inicioAgendadoManual`, nullable) e um indicador booleano de
   travamento (`agendaTravada`, default `false`).
2. WHEN a migração de produção (`migrate-prod.ts`) é executada, THE sistema
   SHALL adicionar esses campos de forma idempotente, sem perder dados
   existentes e sem exigir valores para etapas já criadas.
3. WHERE uma Etapa nunca foi travada, THE sistema SHALL manter
   `agendaTravada = false` e `inicioAgendadoManual = null` (comportamento
   atual, 100% calculado).
4. THE sistema SHALL isolar toda leitura/escrita da Ancora_Agenda por
   `empresaId` da OP da Etapa.

### Requirement 2: Travar e destravar uma etapa numa data

**User Story:** Como planejador, quero travar uma etapa numa data/hora de
início (e poder destravar), para fixar operações críticas no plano.

#### Acceptance Criteria

1. WHEN o Planejador trava uma Etapa informando uma data/hora de início, THE
   sistema SHALL gravar `agendaTravada = true` e `inicioAgendadoManual` com a
   data/hora informada.
2. WHEN o Planejador destrava uma Etapa, THE sistema SHALL gravar
   `agendaTravada = false` e `inicioAgendadoManual = null`.
3. IF a Etapa está `CONCLUIDA` ou a OP está `CONCLUIDA`/`CANCELADA`, THEN THE
   sistema SHALL rejeitar o travamento/alteração de agenda com erro explicativo.
4. THE sistema SHALL registrar a mudança de agenda (travar/mover/destravar) no
   log de auditoria da OP (`LogOrdemProducao`), com usuário e data.
5. WHERE a data/hora informada é inválida ou ausente ao travar, THE sistema
   SHALL rejeitar a operação com erro de validação.

### Requirement 3: Mover um bloco no Gantt (drag & drop)

**User Story:** Como planejador, quero arrastar um bloco no Gantt para outra
data/hora (e opcionalmente outro centro), para reorganizar a produção
visualmente como nos melhores sistemas do mercado.

#### Acceptance Criteria

1. WHEN o Planejador solta um Bloco_Gantt numa nova posição temporal, THE
   sistema SHALL gravar o novo `inicioAgendadoManual` correspondente e marcar
   `agendaTravada = true` (mover = fixar naquela data).
2. WHERE o Planejador move o Bloco_Gantt para outro centro de produção, THE
   sistema SHALL atualizar o `centroProducaoId` da Etapa além da data,
   reutilizando a regra existente de mudança de centro.
3. WHEN um movimento é concluído, THE sistema SHALL retornar a timeline
   recalculada (ou dados suficientes para o front atualizar) refletindo a nova
   âncora, sem recarregar a página inteira.
4. IF o movimento posicionaria a Etapa em uma Etapa/OP finalizada ou violaria
   a proteção do Requirement 2.3, THEN THE sistema SHALL rejeitar o movimento
   com erro e o Bloco_Gantt SHALL retornar à posição original.
5. THE front SHALL dar feedback otimista durante o arraste e reverter a
   posição visual se a gravação falhar.

### Requirement 4: Motor respeita as âncoras travadas

**User Story:** Como planejador, quero que o cálculo da timeline respeite as
etapas travadas como pontos fixos, para que o resto do plano se ajuste em
torno delas (comportamento APS).

#### Acceptance Criteria

1. WHERE uma Etapa tem `agendaTravada = true`, THE Motor_Timeline SHALL usar
   `inicioAgendadoManual` como `inicioPrevistoAt` dessa Etapa, em vez de
   derivar da fila.
2. WHERE uma Etapa está travada, THE Motor_Timeline SHALL calcular seu
   `fimPrevistoAt` a partir do início travado + duração prevista, respeitando
   o turno do centro.
3. WHERE uma Etapa NÃO está travada, THE Motor_Timeline SHALL calcular seu
   início como antes (fila do centro + cascata), MAS considerando as etapas
   travadas do mesmo centro como já ocupando aquele intervalo.
4. THE Motor_Timeline SHALL continuar detectando e sinalizando conflitos de
   sobreposição no mesmo centro, inclusive quando um conflito é causado por
   uma âncora travada.
5. WHERE a remoção/destrave de uma âncora ocorre, THE Motor_Timeline SHALL
   voltar a calcular a Etapa automaticamente (sem resíduo da âncora).

### Requirement 5: Feedback visual de travamento no Gantt

**User Story:** Como planejador, quero ver claramente quais blocos estão
travados, para distinguir o que é fixo do que é calculado.

#### Acceptance Criteria

1. WHERE um Bloco_Gantt corresponde a uma Etapa travada, THE front SHALL
   exibir um indicador visual de travamento (ex.: ícone de cadeado) no bloco.
2. THE front SHALL permitir travar/destravar um bloco por uma ação direta
   (ex.: menu de contexto ou botão no bloco), além do movimento por arraste.
3. WHEN uma Etapa está travada, THE front SHALL exibir no tooltip a data/hora
   manual de início e a indicação de que está travada.
4. THE front SHALL aplicar o drag & drop e os indicadores em pelo menos a tela
   de Gantt definida como a oficial para edição (as duas telas podem
   compartilhar o componente; a decisão de qual recebe edição fica no design).

### Requirement 6: Não-regressão e segurança

**User Story:** Como usuário de PCP, quero que a edição do Gantt não quebre o
comportamento atual nem permita ações inválidas.

#### Acceptance Criteria

1. WHERE nenhuma Etapa está travada, THE Motor_Timeline SHALL produzir
   exatamente a mesma timeline de hoje (não-regressão do cálculo).
2. THE sistema SHALL manter o schema e o `migrate-prod.ts` no mesmo commit
   (regra de migração do projeto), testado 2× local (idempotência).
3. THE sistema SHALL exigir autenticação e módulo PCP nas novas rotas, e
   restringir a edição do Gantt a perfis autorizados (planejador/admin).
4. IF duas requisições concorrentes tentam mover a mesma Etapa, THEN THE
   sistema SHALL persistir de forma consistente (última gravação válida vence)
   sem corromper a âncora.
5. THE sistema SHALL preservar a detecção de conflitos existente e as demais
   funcionalidades do Gantt (zoom, filtros, agrupamento por centro).
