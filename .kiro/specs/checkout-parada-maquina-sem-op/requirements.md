# Requirements — Parada de Máquina sem OP (Checkout)

## Introdução

Hoje, no Checkout de Apontamento (app do chão de fábrica), **toda parada é
registrada no contexto de uma `EtapaOrdemProducao`** — a rota `PATCH
/checkout/etapas/:id/pausar` exige o `etapaId` e grava um `ApontamentoEtapa`
tipo `PARADA` vinculado à etapa. O `ApontamentoEtapa.etapaOrdemProducaoId` é
**obrigatório** no schema (`onDelete: Cascade`).

O problema, relatado pelo cliente (Caio Filho, Carton Wega): uma máquina deu
problema e precisou de **manutenção enquanto NÃO estava rodando nenhuma OP**.
Para registrar essa parada no coletor, o operador foi obrigado a **entrar numa
OP** e marcá-la como "parada por manutenção" — o que é incorreto (nenhuma OP
estava em produção naquela máquina) e contamina os dados da OP escolhida.

Esta feature permite registrar uma **parada de máquina/centro independente de
OP** — o padrão de mercado em sistemas MES (downtime é um evento do RECURSO, não
da ordem). A parada pertence ao Centro de Produção (máquina) da sessão do
terminal, tem início/fim, motivo e código de parada, e **não cria nem altera
nenhuma OP ou etapa**. Também aparece nos relatórios de parada (Pareto) junto das
paradas por etapa, para que o tempo de manutenção da máquina seja contabilizado.

## Glossário

- **Parada_De_Centro**: evento de parada (downtime) de um Centro de Produção
  (máquina), SEM vínculo com `EtapaOrdemProducao`/`OrdemProducao`. Tem motivo,
  código de parada opcional, observação, início e (quando encerrada) fim.
- **Centro_Do_Terminal**: o `CentroProducao` resolvido pela sessão do terminal
  (`checkoutUser.centroProducaoId` + `empresaId`).
- **Código_De_Parada**: registro de `CodigoParada` cadastrado em PCP → Gerencial
  → Códigos de Parada (já existente), reutilizado aqui.
- **Parada_Aberta**: uma Parada_De_Centro com `fim = null` (máquina ainda
  parada). Só pode existir uma Parada_Aberta por Centro_Do_Terminal por vez.

## Requirements

### Requisito 1 — Registrar parada de máquina sem OP

**User Story:** Como operador do chão de fábrica, quero registrar que a minha
máquina está parada (ex.: manutenção) sem precisar entrar numa OP, para que a
parada fique correta mesmo quando nenhuma OP está rodando.

#### Acceptance Criteria

1. QUANDO o operador aciona "Registrar parada da máquina" no Checkout THEN o
   sistema SHALL criar uma Parada_De_Centro vinculada ao Centro_Do_Terminal,
   com `inicio = agora`, `fim = null`, sem vincular a nenhuma OP/etapa.
2. O sistema SHALL exigir um motivo de parada (enum `MANUTENCAO |
   FALTA_MATERIAL | ACERTO_MAQUINA | TROCA_TURNO | OUTRO`) e SHALL aceitar
   opcionalmente um Código_De_Parada e uma observação.
3. QUANDO já existir uma Parada_Aberta para o Centro_Do_Terminal THEN o sistema
   SHALL recusar a criação de uma nova (400, mensagem clara), para não haver duas
   paradas abertas simultâneas na mesma máquina.
4. O `empresaId` gravado SHALL ser o da sessão do terminal
   (`checkoutUser.empresaId`), e o `centroProducaoId` SHALL ser o
   `checkoutUser.centroProducaoId` — isolamento multi-tenant explícito.
5. O registro da Parada_De_Centro NÃO SHALL criar, alterar status, nem gravar
   apontamento em nenhuma `OrdemProducao`/`EtapaOrdemProducao`.

### Requisito 2 — Encerrar a parada

**User Story:** Como operador, quero encerrar a parada quando a máquina voltar a
funcionar, para que o tempo de downtime fique registrado corretamente.

#### Acceptance Criteria

1. QUANDO o operador aciona "Encerrar parada" THEN o sistema SHALL gravar
   `fim = agora` e calcular `duracaoMinutos` da Parada_Aberta do
   Centro_Do_Terminal.
2. SE não houver Parada_Aberta para o Centro_Do_Terminal THEN o sistema SHALL
   retornar 400 com mensagem clara ("Não há parada de máquina em aberto").
3. O encerramento SHALL ser restrito à parada do próprio Centro_Do_Terminal
   (isolamento por `empresaId` + `centroProducaoId`); uma parada de outro centro/
   empresa NÃO SHALL ser encerrada por este terminal (404).
4. `duracaoMinutos` SHALL ser `>= 0`; se `fim < inicio` por qualquer razão o
   sistema SHALL tratar como 0 (nunca negativo).

### Requisito 3 — Visibilidade no terminal

**User Story:** Como operador, quero ver claramente se a minha máquina está em
parada registrada, para não registrar duas vezes e saber quando encerrar.

#### Acceptance Criteria

1. O painel do Checkout SHALL exibir, no cabeçalho da máquina, um indicador
   quando houver Parada_Aberta (motivo + desde quando).
2. QUANDO há Parada_Aberta THEN o botão principal da seção SHALL oferecer
   "Encerrar parada"; caso contrário, "Registrar parada da máquina".
3. A ação de registrar/encerrar parada SHALL estar disponível
   **independentemente de haver etapas/OPs na fila** do terminal.

### Requisito 4 — Contabilização em relatórios (Pareto de paradas)

**User Story:** Como gestor, quero que as paradas de máquina sem OP apareçam no
relatório de paradas (Pareto), para medir o downtime real por motivo/código.

#### Acceptance Criteria

1. O relatório mensal de produção (Pareto de Paradas, PCP → Gerencial) SHALL
   incluir as Parada_De_Centro encerradas do período, agregadas por
   Código_De_Parada (fallback para o enum `motivoParada`), somando
   `duracaoMinutos`.
2. A agregação SHALL respeitar o `empresaId` explícito (multi-tenant).
3. A inclusão das paradas sem OP NÃO SHALL alterar a contabilização já existente
   das paradas por etapa (ambas somam no mesmo Pareto, sem dupla contagem).

### Requisito 5 — Histórico/consulta no ERP

**User Story:** Como supervisor, quero consultar as paradas de máquina de um
centro, para acompanhar manutenções e justificar tempo parado.

#### Acceptance Criteria

1. O ERP (PCP) SHALL expor um endpoint de leitura das Parada_De_Centro por
   centro e período, isolado por `empresaId` explícito (centro de outra empresa
   → 404/vazio).
2. A listagem SHALL retornar motivo, código de parada (quando houver), início,
   fim, duração e observação, em ordem cronológica.

### Requisito 6 — Não-regressão

#### Acceptance Criteria

1. A pausa de etapa existente (`PATCH /checkout/etapas/:id/pausar`) e o
   `ApontamentoEtapa` tipo `PARADA` NÃO SHALL ser alterados em comportamento.
2. A mudança de schema SHALL ser **aditiva** (novo model + índice), com o
   equivalente idempotente em `prisma/migrate-prod.ts` no mesmo commit (padrão
   do projeto — Postgres local off; roda no deploy).
3. Toda nova query SHALL filtrar `empresaId` explicitamente (prismaScoped não
   isola SUPER_ADMIN).
