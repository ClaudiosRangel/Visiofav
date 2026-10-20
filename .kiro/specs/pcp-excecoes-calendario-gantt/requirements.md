# Requirements Document

## Glossary

- **Centro de Produção**: máquina/setor/linha (`CentroProducao`) que executa etapas de OP. Possui um turno-base opcional.
- **Turno-base**: horário/dias padrão de operação de um centro (`TurnoProducao`): `horaInicio`, `horaFim`, `diasSemana`, aplicado todo dia útil.
- **Exceção de calendário**: regra pontual, por data e por centro, que SOBREPÕE o turno-base naquela data específica (padrão "calendar exception" de MS Project/DHTMLX/Bryntum).
- **Hora extra**: exceção que ESTENDE o expediente de um dia (fim do turno mais tarde) ou trabalha fora do dia útil.
- **Dia extra**: exceção que torna trabalhável um dia normalmente não trabalhado (ex.: sábado 08:00-14:00).
- **Não-trabalho / parada**: exceção que torna NÃO trabalhável um dia normalmente útil (feriado, manutenção programada, parada coletiva).
- **Gantt**: tela `pcp/gantt` que desenha a timeline preditiva das OPs, segmentando a barra em tempo útil (turno) vs vãos esmaecidos (fora do expediente).
- **Motor de agenda**: `timeline-agenda.service.ts` — funções puras que calculam início/fim previstos respeitando o turno.

## Introduction

Hoje o motor do Gantt respeita apenas o turno-base fixo de cada centro (mesmos horários todo dia útil). Quando a fábrica faz **hora extra** num dia, trabalha num **sábado** pontual, ou tem um **feriado/parada**, o Gantt não reflete isso: continua agendando como se o turno-base valesse sempre. Isso descola o planejamento da realidade — uma OP que caberia com 2h de hora extra aparece empurrada para o dia seguinte, e uma parada não aparece como vão.

Esta feature adiciona **exceções de calendário por centro e por data**, seguindo o padrão consolidado dos melhores sistemas de planejamento (MS Project, DHTMLX Gantt, Bryntum): a exceção de uma data específica sobrepõe o turno-base naquela data. São suportados os três tipos pedidos pelo usuário: hora extra, dia extra trabalhado e não-trabalho/parada.

O recurso é **aditivo e não-regressivo**: sem nenhuma exceção cadastrada, o comportamento do motor e do Gantt é idêntico ao atual.

## Requirements

### Requirement 1: Cadastro de exceção de calendário por centro e data

**User Story:** Como planejador de produção (PCP), quero cadastrar exceções de calendário para uma máquina numa data específica, para que o Gantt reflita hora extra, dia extra ou parada daquele dia.

#### Acceptance Criteria

1. QUANDO o usuário cria uma exceção ENTÃO o sistema DEVE exigir `centroProducaoId`, `data` (dia civil) e `tipo` (`HORA_EXTRA` | `DIA_EXTRA` | `NAO_TRABALHO`).
2. QUANDO o tipo é `HORA_EXTRA` ou `DIA_EXTRA` ENTÃO o sistema DEVE exigir `horaInicio` e `horaFim` no formato `HH:MM`, com `horaFim` > `horaInicio`.
3. QUANDO o tipo é `NAO_TRABALHO` ENTÃO o sistema DEVE ignorar `horaInicio`/`horaFim` (o dia inteiro vira não-trabalhável naquele centro).
4. QUANDO já existe uma exceção para o mesmo `centroProducaoId` + `data` ENTÃO o sistema DEVE rejeitar a criação com erro 409 (uma exceção por centro por data).
5. O sistema DEVE permitir editar e excluir uma exceção existente.
6. O sistema DEVE aceitar uma `observacao` textual opcional.

### Requirement 2: Isolamento multi-tenant das exceções

**User Story:** Como operador de uma empresa, quero que as exceções de calendário sejam isoladas por empresa, para que dados de outra empresa nunca apareçam ou sejam alterados.

#### Acceptance Criteria

1. QUANDO qualquer operação de leitura/escrita de exceção é feita ENTÃO o sistema DEVE filtrar por `empresaId` explícito do usuário.
2. QUANDO uma exceção referencia um centro ENTÃO o sistema DEVE validar que o centro pertence à mesma empresa.
3. QUANDO um usuário tenta ler/editar/excluir uma exceção de outra empresa (por id) ENTÃO o sistema DEVE responder 404.

### Requirement 3: Motor de agenda aplica exceções por data

**User Story:** Como planejador, quero que o cálculo de início/fim previsto das etapas use as exceções da data, para que o agendamento reflita a jornada real daquele dia.

#### Acceptance Criteria

1. QUANDO uma data tem exceção `HORA_EXTRA` ou `DIA_EXTRA` para o centro ENTÃO o motor DEVE usar o intervalo `horaInicio`-`horaFim` da exceção como janela trabalhável DAQUELE dia, em vez do turno-base.
2. QUANDO uma data tem exceção `NAO_TRABALHO` para o centro ENTÃO o motor DEVE tratar o dia inteiro como não trabalhável (nenhuma produção avança naquela data).
3. QUANDO uma data NÃO tem exceção ENTÃO o motor DEVE usar o turno-base (comportamento atual).
4. QUANDO não há nenhuma exceção cadastrada ENTÃO a saída do motor DEVE ser idêntica à atual (não-regressão).
5. QUANDO o motor "snapa" uma âncora para o próximo horário válido ENTÃO ele DEVE considerar as exceções (ex.: um dia extra torna aquele sábado válido como destino do snap).

### Requirement 4: Gantt reflete as exceções na segmentação visual

**User Story:** Como planejador, quero ver no Gantt as janelas de hora extra/dia extra como tempo útil e as paradas como vãos, para entender visualmente o impacto no cronograma.

#### Acceptance Criteria

1. QUANDO uma data tem `HORA_EXTRA`/`DIA_EXTRA` ENTÃO a barra do Gantt DEVE mostrar como tempo útil (não esmaecido) o intervalo estendido/extra daquele dia.
2. QUANDO uma data tem `NAO_TRABALHO` ENTÃO a barra do Gantt DEVE esmaecer o dia inteiro como vão fora do expediente.
3. QUANDO não há exceção ENTÃO a segmentação DEVE permanecer idêntica à atual (turno-base).
4. A rota do timeline DEVE entregar as exceções por centro ao frontend para a segmentação, sem exigir chamada adicional.

### Requirement 5: Persistência consistente com o processo de migração do projeto

**User Story:** Como mantenedor, quero que a nova tabela seja criada em produção pelo processo padrão, para evitar dessincronização schema↔banco.

#### Acceptance Criteria

1. QUANDO o schema Prisma ganha o model de exceção ENTÃO o mesmo commit DEVE incluir o `CREATE TABLE`/índices equivalentes em `prisma/migrate-prod.ts`, idempotente (`IF NOT EXISTS`).
2. QUANDO `migrate-prod.ts` roda duas vezes seguidas ENTÃO a segunda execução NÃO DEVE falhar nem duplicar objetos.
