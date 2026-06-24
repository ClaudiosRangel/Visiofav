# Requirements Document

## Introduction

O módulo **agenda-backend** unifica o gerenciamento de agendamentos de docas do WMS, consolidando os módulos `agenda-wms` e `agenda-doca` em uma arquitetura coesa. O sistema controla o ciclo completo de um agendamento — criação com validação de conflitos, transições de status com side-effects atômicos, auto-agendamento inteligente, visualização em timeline, notificações em tempo real e métricas de aderência.

## Glossary

- **AgendaService**: Serviço orquestrador principal que coordena criação, edição, transições de status e enriquecimento de dados de agendamentos.
- **ValidacaoService**: Serviço responsável por validar conflitos de sobreposição temporal, bloqueios de doca, horário operacional e transições de status.
- **AutoSchedulerService**: Serviço que encontra automaticamente o próximo slot disponível para uma doca em um dia, respeitando configurações e bloqueios.
- **TimelineService**: Serviço que gera dados de visualização timeline (dia/semana/mês) para o frontend.
- **EstatisticasService**: Serviço que calcula métricas de aderência e performance de agendamentos.
- **NotificacaoService**: Serviço que gerencia notificações em tempo real via SSE para mudanças de status.
- **AgendaWms**: Entidade principal representando um agendamento de doca com dados de fornecedor, veículo, horário e status.
- **ConfigDoca**: Configuração operacional da empresa contendo horários de abertura/fechamento, buffer entre agendamentos e tolerância de atraso.
- **BloqueioSlotDoca**: Registro de bloqueio temporário de uma doca para manutenção ou outro motivo.
- **StatusAgenda**: Tipo enumerado representando os estados possíveis de um agendamento (AGENDADO, CONFIRMADO, ESPERA, NA_DOCA, CONFERINDO, CONFERIDO, RECEBIDO, CANCELADO).
- **Buffer**: Intervalo mínimo configurável (em minutos) que deve existir entre agendamentos consecutivos na mesma doca.
- **Slot**: Intervalo de tempo definido por horaInicio e horaFim no formato "HH:mm".
- **Side-Effect**: Operações secundárias executadas automaticamente dentro da mesma transação ao alterar um status (criação de NotaEntrada, atualização de OrdemServico, etc.).

## Requirements

### Requirement 1: Criação de Agendamento

**User Story:** As a operador de recebimento, I want to criar agendamentos de doca com validação automática de conflitos, so that I can garantir que não haverá sobreposição de veículos na mesma doca.

#### Acceptance Criteria

1. WHEN um operador submete dados válidos de agendamento, THE AgendaService SHALL criar um novo registro AgendaWms com status AGENDADO e retornar HTTP 201
2. WHEN um operador submete um agendamento cujo slot sobrepõe outro agendamento ativo na mesma doca (considerando o buffer configurado), THE ValidacaoService SHALL rejeitar a criação com HTTP 409 e informar o agendamento conflitante
3. WHEN um operador submete um agendamento com horaInicio ou horaFim fora da janela operacional configurada, THE ValidacaoService SHALL rejeitar a criação com HTTP 422 e informar o horário operacional válido
4. WHEN um operador submete um agendamento para um período em que a doca está bloqueada, THE ValidacaoService SHALL rejeitar a criação com HTTP 409 e informar o motivo do bloqueio
5. WHEN um operador submete um agendamento com dataPrevista no passado, THE ValidacaoService SHALL rejeitar a criação com HTTP 422
6. WHEN um operador submete um agendamento com horaFim menor ou igual a horaInicio, THE ValidacaoService SHALL rejeitar a criação com HTTP 422

### Requirement 2: Auto-Agendamento

**User Story:** As a operador de recebimento, I want to solicitar auto-agendamento para encontrar o próximo horário livre em uma doca, so that I can agilizar o processo sem buscar manualmente por slots disponíveis.

#### Acceptance Criteria

1. WHEN um operador solicita auto-agendamento com autoAgendar=true e uma duração em minutos, THE AutoSchedulerService SHALL encontrar o primeiro slot disponível no dia que comporte a duração solicitada
2. WHEN o AutoSchedulerService encontra um slot disponível, THE AgendaService SHALL criar o agendamento com horaInicio e horaFim do slot encontrado
3. WHEN não existe nenhum slot disponível no dia para a duração solicitada, THE AutoSchedulerService SHALL retornar HTTP 422 informando que não há horário disponível
4. THE AutoSchedulerService SHALL respeitar o buffer configurado entre agendamentos ao calcular slots disponíveis
5. THE AutoSchedulerService SHALL respeitar bloqueios ativos ao calcular slots disponíveis
6. WHEN um operador solicita sugestão de docas disponíveis, THE AutoSchedulerService SHALL retornar múltiplas opções de docas com horários livres ordenadas por disponibilidade

### Requirement 3: Edição e Movimentação de Agendamento

**User Story:** As a operador de recebimento, I want to editar e mover agendamentos existentes para outras docas ou horários, so that I can ajustar a programação conforme necessidades operacionais.

#### Acceptance Criteria

1. WHEN um operador edita dados de um agendamento com status diferente de RECEBIDO e CANCELADO, THE AgendaService SHALL atualizar o registro aplicando as mesmas validações de conflito da criação
2. WHEN um operador move um agendamento para outra doca ou horário, THE AgendaService SHALL validar conflitos no novo slot antes de confirmar a movimentação
3. WHEN um operador tenta editar um agendamento com status RECEBIDO ou CANCELADO, THE AgendaService SHALL rejeitar a edição com HTTP 422

### Requirement 4: Máquina de Estados e Transição de Status

**User Story:** As a operador de recebimento, I want to avançar o status de um agendamento seguindo um fluxo definido, so that I can acompanhar o progresso do veículo desde a chegada até a conclusão do recebimento.

#### Acceptance Criteria

1. THE ValidacaoService SHALL aceitar apenas as seguintes transições de status: AGENDADO→{CONFIRMADO, ESPERA, NA_DOCA, CANCELADO}, CONFIRMADO→{ESPERA, NA_DOCA, CANCELADO}, ESPERA→{NA_DOCA, CANCELADO}, NA_DOCA→{CONFERINDO, CANCELADO}, CONFERINDO→{CONFERIDO, CANCELADO}, CONFERIDO→{RECEBIDO}
2. WHEN um operador tenta uma transição de status não permitida, THE ValidacaoService SHALL rejeitar com HTTP 422 informando a transição inválida
3. WHILE um agendamento está no status RECEBIDO, THE AgendaService SHALL rejeitar qualquer tentativa de nova transição de status
4. WHILE um agendamento está no status CANCELADO, THE AgendaService SHALL rejeitar qualquer tentativa de nova transição de status
5. WHEN uma transição de status é aceita, THE AgendaService SHALL executar a atualização e seus side-effects dentro de uma transação atômica

### Requirement 5: Side-Effects de Transição de Status

**User Story:** As a operador de recebimento, I want to que o sistema execute automaticamente ações associadas à mudança de status, so that I can não precisar executar manualmente cada etapa operacional.

#### Acceptance Criteria

1. WHEN o status muda para NA_DOCA, THE AgendaService SHALL registrar horaChegadaReal com o timestamp atual se ainda não registrada
2. WHEN o status muda para NA_DOCA, THE AgendaService SHALL criar uma NotaEntrada a partir do XML de compra do fornecedor se nenhuma nota pendente existir
3. WHEN o status muda para CONFERINDO, THE AgendaService SHALL atualizar a NotaEntrada associada para status EM_CONFERENCIA
4. WHEN o status muda para CONFERINDO, THE AgendaService SHALL criar ou atualizar uma OrdemServico de conferência vinculada à nota e ao operador
5. WHEN o status muda para RECEBIDO, THE AgendaService SHALL atualizar o PedidoCompra vinculado para status RECEBIDO
6. WHEN o status muda para RECEBIDO, THE AgendaService SHALL calcular e persistir o tempoPermDocaMin como diferença entre o momento atual e horaChegadaReal
7. IF um side-effect falha durante a transição de status, THEN THE AgendaService SHALL reverter toda a transação, mantendo o status original inalterado

### Requirement 6: Validação de Conflitos

**User Story:** As a operador de recebimento, I want to que o sistema impeça conflitos de agendamento automaticamente, so that I can confiar que a programação de docas é sempre consistente.

#### Acceptance Criteria

1. THE ValidacaoService SHALL considerar dois slots como conflitantes quando o intervalo de um (incluindo buffer) se sobrepõe ao intervalo do outro (incluindo buffer)
2. THE ValidacaoService SHALL aplicar o buffer simetricamente — antes do início e depois do fim de cada slot
3. WHEN o ValidacaoService verifica conflitos, THE ValidacaoService SHALL excluir agendamentos com status CANCELADO da verificação
4. WHEN o ValidacaoService verifica conflitos para edição, THE ValidacaoService SHALL excluir o próprio agendamento sendo editado da verificação
5. THE ValidacaoService SHALL verificar conflitos apenas entre agendamentos da mesma doca e mesma data

### Requirement 7: Visualização Timeline

**User Story:** As a operador de recebimento, I want to visualizar agendamentos em formato de timeline diária, semanal ou mensal, so that I can ter uma visão geral da ocupação das docas.

#### Acceptance Criteria

1. WHEN um operador solicita a timeline com visualização "dia", THE TimelineService SHALL retornar todos os agendamentos e bloqueios da data especificada, agrupados por doca
2. WHEN um operador solicita a timeline com visualização "semana", THE TimelineService SHALL retornar dados de 7 dias a partir da data especificada
3. WHEN um operador solicita a timeline com visualização "mês", THE TimelineService SHALL retornar dados do mês completo da data especificada
4. WHEN um operador solicita a grade diária, THE TimelineService SHALL retornar os dados divididos em slots de duração configurável (padrão 30 minutos)
5. THE TimelineService SHALL incluir indicadores de aderência para cada agendamento (no prazo, atraso leve, atrasado)

### Requirement 8: Estatísticas e Métricas de Aderência

**User Story:** As a gestor de operações, I want to consultar métricas de aderência de agendamentos, so that I can identificar gargalos e melhorar a eficiência operacional das docas.

#### Acceptance Criteria

1. WHEN um gestor consulta estatísticas para um período, THE EstatisticasService SHALL calcular o percentual de agendamentos no prazo (chegada real até 15 minutos após horário previsto)
2. WHEN um gestor consulta estatísticas para um período, THE EstatisticasService SHALL calcular o tempo médio de atraso entre agendamentos atrasados
3. WHEN um gestor consulta estatísticas para um período, THE EstatisticasService SHALL calcular o tempo médio de permanência na doca
4. THE EstatisticasService SHALL excluir agendamentos cancelados do cálculo de métricas
5. THE EstatisticasService SHALL calcular métricas somente sobre agendamentos que possuem horaChegadaReal registrada
6. WHEN o percentual de aderência é solicitado, THE EstatisticasService SHALL retornar um valor no intervalo de 0 a 100

### Requirement 9: Notificações em Tempo Real

**User Story:** As a operador de recebimento, I want to receber notificações em tempo real sobre mudanças de status e conflitos, so that I can reagir rapidamente a eventos operacionais.

#### Acceptance Criteria

1. WHEN um agendamento é criado, THE NotificacaoService SHALL emitir um evento SSE do tipo "agendamento-criado" para os clientes conectados da mesma empresa
2. WHEN o status de um agendamento é alterado, THE NotificacaoService SHALL emitir um evento SSE do tipo "status-alterado" com o status anterior e o novo status
3. WHEN um atraso é detectado além da tolerância configurada, THE NotificacaoService SHALL emitir um evento SSE do tipo "atraso-detectado" com os minutos de atraso
4. THE NotificacaoService SHALL agrupar notificações para evitar excesso de eventos em sequência rápida

### Requirement 10: Conversão de Tempo (toMinutes / fromMinutes)

**User Story:** As a desenvolvedor do sistema, I want to converter entre formato "HH:mm" e minutos do dia de forma confiável, so that I can realizar cálculos de sobreposição e slots corretamente.

#### Acceptance Criteria

1. THE toMinutes SHALL converter uma string "HH:mm" válida em um inteiro no intervalo de 0 a 1439
2. THE fromMinutes SHALL converter um inteiro no intervalo de 0 a 1439 em uma string no formato "HH:mm"
3. FOR ALL inteiros n no intervalo de 0 a 1439, toMinutes(fromMinutes(n)) SHALL produzir o valor n original (round-trip)
4. FOR ALL strings s válidas no formato "HH:mm", fromMinutes(toMinutes(s)) SHALL produzir a string s original (round-trip)

### Requirement 11: Isolamento Multi-Tenant e Segurança

**User Story:** As a administrador do sistema, I want to que cada empresa acesse apenas seus próprios dados, so that I can garantir isolamento e segurança entre clientes.

#### Acceptance Criteria

1. THE AgendaService SHALL filtrar todas as consultas por empresaId do usuário autenticado
2. THE AgendaService SHALL validar autenticação JWT em todas as rotas via hook authenticate
3. THE AgendaService SHALL restringir acesso a usuários com permissão do módulo WMS via hook moduloGuard
4. THE AgendaService SHALL validar todos os inputs com schemas Zod antes de processamento
5. THE AgendaService SHALL validar que todos os IDs recebidos são UUIDs válidos antes de uso em queries

### Requirement 12: Bloqueio de Doca

**User Story:** As a gestor de operações, I want to bloquear slots de docas para manutenção ou outros motivos, so that I can impedir agendamentos durante períodos indisponíveis.

#### Acceptance Criteria

1. WHEN um gestor cria um bloqueio de doca, THE AgendaService SHALL registrar o período bloqueado com motivo obrigatório (1 a 200 caracteres)
2. WHEN um gestor tenta criar um bloqueio com dataFim menor ou igual a dataInicio, THE AgendaService SHALL rejeitar com HTTP 422
3. WHEN um gestor tenta criar um bloqueio que conflite com agendamentos já confirmados no mesmo período, THE AgendaService SHALL rejeitar com HTTP 409
