# Requirements Document

## Introduction

Este documento define os requisitos para a Fase 1 de profissionalização do VisioFab WMS. São 5 módulos que elevam o sistema de um WMS operacional para um WMS de nível profissional: Cross-Docking, Logística Reversa, KPI/SLA com Alertas, Dock Scheduling Avançado e Impressão de Etiquetas ZPL. Todos os módulos operam no contexto multi-tenant existente (empresa + JWT), utilizam o stack Fastify/Prisma/PostgreSQL no backend e Next.js 15/Mantine v7 no frontend.

## Glossário

- **Sistema_WMS**: O sistema VisioFab WMS completo (backend Fastify + frontend Next.js + mobile React Native)
- **Motor_CrossDock**: Subsistema responsável por identificar, rotear e priorizar itens elegíveis a cross-docking
- **Modulo_Reversa**: Subsistema de logística reversa que gerencia devoluções, inspeções e disposições
- **Motor_KPI**: Subsistema que avalia regras de KPI/SLA e dispara alertas automaticamente
- **Agenda_Doca**: Subsistema de agendamento visual avançado de docas com gerenciamento de time-slots
- **Motor_Etiquetas**: Subsistema de geração e impressão de etiquetas ZPL via impressoras de rede
- **Cross_Docking_Transito**: Mercadoria pré-alocada a pedidos de saída antes da chegada ao armazém
- **Cross_Docking_Oportunistico**: Redistribuição não planejada de mercadoria recebida diretamente para expedição
- **RA**: Autorização de Retorno — documento que autoriza a devolução de mercadoria pelo cliente
- **Staging_Area**: Área de preparação próxima à doca de saída onde itens cross-dock aguardam expedição
- **ZPL**: Zebra Programming Language — linguagem de comandos para impressoras térmicas industriais
- **KPI**: Key Performance Indicator — indicador chave de desempenho operacional
- **SLA**: Service Level Agreement — acordo de nível de serviço com prazos e metas definidas
- **Time_Slot**: Janela de tempo reservada para operação em uma doca específica
- **Template_Etiqueta**: Modelo configurável de etiqueta com campos variáveis e layout ZPL
- **Nota_Entrada**: Documento fiscal de entrada (NF-e) já existente no sistema
- **Pedido_Venda**: Pedido de venda existente no sistema representando demanda de saída
- **Doca**: Posição física de carga/descarga no centro de distribuição
- **Endereco**: Posição de armazenagem no armazém (rua-prédio-nível-apartamento)
- **AuditLog**: Registro de auditoria existente no sistema para rastreamento de operações

---

## Requisitos

---

### Requirement 1: Identificação de Itens Cross-Dock no Recebimento

**User Story:** Como operador de recebimento, eu quero que o sistema identifique automaticamente itens elegíveis a cross-docking durante a conferência de entrada, para que mercadorias urgentes sigam direto para expedição sem armazenagem.

#### Acceptance Criteria

1. WHEN uma Nota_Entrada é conferida, THE Motor_CrossDock SHALL comparar cada item conferido com os Pedido_Venda pendentes da mesma empresa e marcar como cross-dock os itens com correspondência exata de produto e quantidade disponível
2. WHEN um item é marcado como Cross_Docking_Transito, THE Motor_CrossDock SHALL associar o item ao Pedido_Venda correspondente e registrar a alocação com referência à Nota_Entrada de origem
3. WHEN um operador identifica manualmente um item para Cross_Docking_Oportunistico, THE Motor_CrossDock SHALL validar que o item existe no recebimento em conferência e registrar a decisão com justificativa do operador
4. THE Motor_CrossDock SHALL registrar no AuditLog cada decisão de cross-docking contendo: tipo (trânsito ou oportunístico), item, quantidade, Nota_Entrada de origem e Pedido_Venda de destino
5. IF a Nota_Entrada não possuir itens com correspondência a pedidos pendentes, THEN THE Motor_CrossDock SHALL seguir o fluxo normal de endereçamento sem interrupção

---

### Requirement 2: Roteamento de Itens Cross-Dock para Staging Area

**User Story:** Como gestor de armazém, eu quero que itens cross-dock sejam roteados para a staging area correta próxima à doca de saída, para que o tempo de trânsito interno seja minimizado.

#### Acceptance Criteria

1. WHEN um item é confirmado como cross-dock, THE Motor_CrossDock SHALL determinar a Doca de saída planejada com base no Pedido_Venda associado e atribuir a Staging_Area mais próxima dessa doca
2. THE Motor_CrossDock SHALL gerar uma OrdemServicoWms do tipo CROSS_DOCK para cada movimentação de item da doca de entrada até a Staging_Area designada
3. WHILE um item cross-dock aguarda na Staging_Area, THE Sistema_WMS SHALL manter o saldo reservado no endereço de staging e impedir realocação para posições de estoque
4. IF a Staging_Area designada estiver com ocupação acima de 90%, THEN THE Motor_CrossDock SHALL sugerir a próxima Staging_Area disponível e notificar o gestor
5. WHEN o item cross-dock é coletado para a onda de separação de saída, THE Motor_CrossDock SHALL baixar automaticamente o saldo da Staging_Area e vincular ao volume de expedição

---

### Requirement 3: Priorização de Itens Cross-Dock em Ondas de Separação

**User Story:** Como planejador de expedição, eu quero que itens cross-dock tenham prioridade nas ondas de separação, para que pedidos urgentes saiam mais rapidamente.

#### Acceptance Criteria

1. WHEN uma OndaSeparacao é gerada, THE Motor_CrossDock SHALL priorizar pedidos que possuem itens em staging area de cross-dock, posicionando-os no topo da fila de separação
2. THE Motor_CrossDock SHALL permitir configuração do fator de prioridade cross-dock (1 a 10) por empresa via tabela de parâmetros
3. WHEN todos os itens de um Pedido_Venda estão disponíveis em staging (cross-dock completo), THE Motor_CrossDock SHALL sinalizar o pedido como "pronto para expedição imediata" no painel de ondas
4. THE Sistema_WMS SHALL exibir indicador visual "CROSS-DOCK" na tela de ondas de separação para pedidos que contêm itens roteados via cross-docking

---

### Requirement 4: Criação de Autorização de Retorno (RA)

**User Story:** Como atendente de pós-venda, eu quero criar uma Autorização de Retorno vinculada à NF-e original, para que a devolução seja rastreável desde a solicitação até a disposição final.

#### Acceptance Criteria

1. WHEN um operador solicita criação de RA, THE Modulo_Reversa SHALL exigir vinculação a pelo menos uma NF-e de saída original emitida pela empresa
2. THE Modulo_Reversa SHALL validar que os itens e quantidades da RA não excedem os itens e quantidades da NF-e original vinculada
3. WHEN a RA é criada, THE Modulo_Reversa SHALL gerar um número sequencial único por empresa no formato RA-YYYY-NNNNNN e registrar status ABERTA
4. THE Modulo_Reversa SHALL registrar na RA: motivo da devolução (seleção de lista configurável), cliente, itens com quantidades, NF-e de referência, data limite para retorno e observações
5. IF uma RA for criada para uma NF-e que já possui outra RA aberta para os mesmos itens, THEN THE Modulo_Reversa SHALL alertar o operador sobre a duplicidade e exigir confirmação explícita

---

### Requirement 5: Recebimento e Inspeção de Devoluções

**User Story:** Como conferente de entrada, eu quero receber mercadorias devolvidas com um fluxo de inspeção dedicado, para que a qualidade e condição sejam avaliadas antes de qualquer movimentação.

#### Acceptance Criteria

1. WHEN mercadoria devolvida chega à doca, THE Modulo_Reversa SHALL vincular o recebimento a uma RA existente com status ABERTA e registrar data/hora de chegada
2. THE Modulo_Reversa SHALL criar uma OrdemServicoWms do tipo INSPECAO_DEVOLUCAO para cada item recebido, atribuindo a um conferente
3. WHEN o conferente inspeciona um item, THE Modulo_Reversa SHALL exigir registro de: condição (PERFEITO, AVARIADO, INCOMPLETO), fotos da inspeção (mínimo 1), e parecer do conferente
4. WHEN a inspeção é concluída para todos os itens da RA, THE Modulo_Reversa SHALL atualizar o status da RA para INSPECIONADA e disponibilizar para decisão de disposição
5. IF a quantidade recebida divergir da quantidade autorizada na RA, THEN THE Modulo_Reversa SHALL registrar a divergência, notificar o gestor e permitir ajuste da RA

---

### Requirement 6: Disposição de Itens Devolvidos

**User Story:** Como gestor de logística reversa, eu quero decidir a disposição de cada item inspecionado (reestoque, avaria, descarte, retorno ao fornecedor), para que o destino correto seja aplicado.

#### Acceptance Criteria

1. WHEN uma RA atinge status INSPECIONADA, THE Modulo_Reversa SHALL apresentar cada item com resultado da inspeção e opções de disposição: REESTOQUE, AVARIA, DESCARTE, RETORNO_FORNECEDOR
2. WHEN a disposição REESTOQUE é selecionada, THE Modulo_Reversa SHALL encaminhar o item para o fluxo de endereçamento inteligente existente e atualizar saldo de estoque
3. WHEN a disposição AVARIA é selecionada, THE Modulo_Reversa SHALL mover o item para endereço de avaria configurado e gerar entrada no estoque de avariados
4. WHEN a disposição DESCARTE é selecionada, THE Modulo_Reversa SHALL registrar o motivo, baixar o item do estoque e registrar no AuditLog para conformidade fiscal
5. WHEN a disposição RETORNO_FORNECEDOR é selecionada, THE Modulo_Reversa SHALL gerar uma pendência de devolução a fornecedor e associar ao fornecedor original do produto
6. WHEN todas as disposições da RA são definidas, THE Modulo_Reversa SHALL atualizar o status da RA para CONCLUIDA e gerar nota de crédito quando aplicável

---

### Requirement 7: Configuração de Regras de KPI/SLA

**User Story:** Como gestor operacional, eu quero configurar regras de KPI e SLA com condições, thresholds e ações, para que o sistema monitore automaticamente os indicadores e alerte sobre desvios.

#### Acceptance Criteria

1. THE Motor_KPI SHALL permitir criação de regras com os campos: nome, entidade monitorada (PEDIDO, CONFERENCIA, RECEBIMENTO, OCUPACAO, SEPARACAO), condição (operador lógico + threshold), janela de avaliação (minutos ou percentual) e ações de alerta
2. WHEN uma regra de KPI é criada, THE Motor_KPI SHALL validar que a combinação entidade + condição é sintaticamente válida e que o threshold é um valor numérico positivo
3. THE Motor_KPI SHALL suportar as seguintes condições: TEMPO_EXCEDIDO (minutos), PERCENTUAL_ACIMA (%), PERCENTUAL_ABAIXO (%), QUANTIDADE_ACIMA (unidades), QUANTIDADE_ABAIXO (unidades)
4. THE Motor_KPI SHALL permitir configuração de múltiplas ações por regra: NOTIFICACAO_APP, EMAIL, WEBHOOK, ESCALAR_GESTOR
5. THE Motor_KPI SHALL armazenar histórico de todas as alterações em regras de KPI com data, usuário e valores anterior/posterior
6. IF uma regra de KPI for desativada, THEN THE Motor_KPI SHALL cessar a avaliação imediatamente e registrar a desativação no AuditLog

---

### Requirement 8: Avaliação Automática e Disparo de Alertas

**User Story:** Como operador de turno, eu quero receber alertas automáticos quando um KPI/SLA está em risco ou violado, para que eu possa agir proativamente.

#### Acceptance Criteria

1. THE Motor_KPI SHALL avaliar todas as regras ativas a cada 60 segundos para a empresa correspondente
2. WHEN uma regra de KPI é violada, THE Motor_KPI SHALL gerar um alerta com: severidade (INFO, WARNING, CRITICAL), regra violada, valor atual, threshold configurado, entidade afetada e timestamp
3. WHEN a ação NOTIFICACAO_APP é configurada, THE Motor_KPI SHALL enviar notificação em tempo real via SSE para os usuários da empresa logados no sistema
4. WHEN a ação EMAIL é configurada, THE Motor_KPI SHALL enviar e-mail aos destinatários configurados na regra com detalhes do alerta
5. WHILE uma regra permanece violada, THE Motor_KPI SHALL reenviar alertas apenas no intervalo de cooldown configurado (padrão 30 minutos) para evitar spam de notificações
6. WHEN a condição de uma regra retorna ao estado normal, THE Motor_KPI SHALL gerar notificação de resolução e fechar o alerta pendente

---

### Requirement 9: Dashboard de KPIs em Tempo Real

**User Story:** Como gestor de CD, eu quero visualizar um dashboard com cards de KPI em tempo real e histórico de tendências, para que eu tenha visão consolidada da operação.

#### Acceptance Criteria

1. THE Sistema_WMS SHALL exibir um dashboard com cards de KPI mostrando: valor atual, tendência (seta para cima/baixo), status (normal/alerta/crítico) e meta configurada
2. THE Sistema_WMS SHALL atualizar os valores dos cards a cada 30 segundos via polling ou SSE sem necessidade de refresh manual da página
3. WHEN o usuário clica em um card de KPI, THE Sistema_WMS SHALL exibir gráfico de tendência histórica do indicador nos últimos 7 dias com granularidade horária
4. THE Sistema_WMS SHALL exibir painel de alertas ativos com filtro por severidade, entidade e período, ordenados por timestamp decrescente
5. THE Sistema_WMS SHALL permitir exportação dos dados de KPI em formato CSV para análise externa

---

### Requirement 10: Calendário Visual de Agendamento de Docas

**User Story:** Como coordenador de recebimento, eu quero visualizar um calendário com timeline das docas mostrando agendamentos, disponibilidade e ocupação, para que eu possa planejar a operação.

#### Acceptance Criteria

1. THE Agenda_Doca SHALL exibir visualização de calendário em formato timeline (eixo X = horas do dia, eixo Y = docas) com blocos coloridos representando agendamentos
2. THE Agenda_Doca SHALL exibir estados visuais distintos por status do agendamento: AGENDADO (azul), CONFIRMADO (verde), NA_DOCA (amarelo), ATRASADO (vermelho), CANCELADO (cinza)
3. WHEN o usuário arrasta um bloco de agendamento para outro horário ou doca, THE Agenda_Doca SHALL validar conflitos e atualizar o registro AgendaWms correspondente
4. THE Agenda_Doca SHALL permitir alternância entre visualizações: dia, semana e mês
5. WHEN o usuário clica em um time-slot vazio, THE Agenda_Doca SHALL abrir formulário de criação de agendamento pré-preenchido com doca e horário selecionados

---

### Requirement 11: Gerenciamento de Time-Slots e Detecção de Conflitos

**User Story:** Como coordenador de pátio, eu quero que o sistema detecte automaticamente conflitos de agendamento e impeça sobreposição de horários na mesma doca, para que a operação flua sem gargalos.

#### Acceptance Criteria

1. WHEN um novo agendamento é criado ou movido, THE Agenda_Doca SHALL verificar se existe sobreposição de horário na mesma doca e rejeitar a operação com mensagem indicando o agendamento conflitante
2. THE Agenda_Doca SHALL permitir configuração de tempo mínimo entre agendamentos por doca (buffer de limpeza/preparação) em minutos
3. WHEN um agendamento é criado, THE Agenda_Doca SHALL validar que o horário está dentro da janela operacional configurada para o centro de distribuição (horário de funcionamento)
4. THE Agenda_Doca SHALL permitir bloqueio manual de time-slots para manutenção de doca com registro de motivo e período
5. IF um agendamento CONFIRMADO não registrar chegada dentro de 30 minutos após o horário previsto, THEN THE Agenda_Doca SHALL atualizar automaticamente o status para ATRASADO e notificar o coordenador

---

### Requirement 12: Rastreamento de Chegada (Previsto vs. Real)

**User Story:** Como analista de operações, eu quero comparar horários previstos e reais de chegada nas docas, para que eu possa identificar padrões de atraso e melhorar o planejamento.

#### Acceptance Criteria

1. WHEN um veículo chega na portaria, THE Agenda_Doca SHALL registrar o horário real de chegada e calcular a diferença em minutos entre previsto e real
2. THE Agenda_Doca SHALL exibir na timeline um indicador visual de aderência: verde (dentro de 15 min), amarelo (15-30 min de atraso), vermelho (mais de 30 min de atraso)
3. THE Agenda_Doca SHALL manter histórico de todas as chegadas com dados: agendamento, horário previsto, horário real, tempo de permanência na doca, doca utilizada
4. WHEN o usuário acessa a tela de estatísticas, THE Agenda_Doca SHALL apresentar métricas de aderência: % de chegadas no prazo, tempo médio de atraso, tempo médio de permanência por doca

---

### Requirement 13: Gerenciamento de Templates de Etiquetas ZPL

**User Story:** Como administrador do sistema, eu quero criar e editar templates de etiquetas com campos variáveis em linguagem ZPL, para que as etiquetas atendam às necessidades operacionais de cada tipo de operação.

#### Acceptance Criteria

1. THE Motor_Etiquetas SHALL permitir criação de templates com: nome, tipo (PRODUTO, ENDERECO, PALETE, EXPEDIÇÃO), código ZPL com placeholders de variáveis entre chaves duplas, e dimensões (largura x altura em mm)
2. THE Motor_Etiquetas SHALL validar a sintaxe ZPL básica do template no momento da gravação (verificando abertura/fechamento de comandos ^XA/^XZ)
3. THE Motor_Etiquetas SHALL suportar os seguintes tipos de campos variáveis: texto livre, código de barras (Code128, EAN13, QR Code), data/hora, sequencial numérico e campo de banco de dados
4. WHEN o usuário edita um template, THE Motor_Etiquetas SHALL exibir preview renderizado da etiqueta com dados de exemplo antes da gravação
5. THE Motor_Etiquetas SHALL manter versionamento de templates com possibilidade de reverter para versões anteriores
6. THE Motor_Etiquetas SHALL fornecer templates padrão pré-configurados para os tipos: etiqueta de produto com EAN, etiqueta de endereço com código de barras, etiqueta de palete com QR e etiqueta de expedição com dados do destinatário

---

### Requirement 14: Gerenciamento de Impressoras de Rede

**User Story:** Como administrador de TI, eu quero cadastrar e gerenciar impressoras térmicas de rede (Zebra/Elgin) com monitoramento de status, para que a impressão ocorra de forma confiável.

#### Acceptance Criteria

1. THE Motor_Etiquetas SHALL permitir cadastro de impressoras com: nome, modelo (ZEBRA, ELGIN, GENERICA), endereço IP, porta TCP (padrão 9100), localização no CD e status (ONLINE, OFFLINE, ERRO)
2. WHEN uma impressora é cadastrada, THE Motor_Etiquetas SHALL testar a conexão TCP/IP e reportar resultado ao usuário com tempo de resposta em milissegundos
3. THE Motor_Etiquetas SHALL verificar status de conectividade de todas as impressoras cadastradas a cada 5 minutos e atualizar o indicador visual na tela de gerenciamento
4. IF uma impressora muda de status ONLINE para OFFLINE, THEN THE Motor_Etiquetas SHALL notificar o administrador e redirecionar trabalhos pendentes da fila para a próxima impressora disponível do mesmo setor
5. THE Motor_Etiquetas SHALL permitir associação de impressoras a setores/zonas do armazém para roteamento automático de impressão baseado na localização da operação

---

### Requirement 15: Fila de Impressão e Impressão em Lote

**User Story:** Como operador de recebimento/separação, eu quero imprimir etiquetas em lote com controle de fila, para que a identificação de volumes e produtos seja eficiente.

#### Acceptance Criteria

1. WHEN um operador solicita impressão, THE Motor_Etiquetas SHALL adicionar o trabalho à fila com: template selecionado, dados variáveis, quantidade de cópias, impressora destino e prioridade
2. THE Motor_Etiquetas SHALL processar a fila em ordem de prioridade (URGENTE > NORMAL > BAIXA) e dentro da mesma prioridade por ordem de criação (FIFO)
3. WHEN um trabalho de impressão é processado, THE Motor_Etiquetas SHALL substituir os placeholders do template ZPL pelos dados reais, enviar via TCP/IP à impressora e registrar resultado (SUCESSO, FALHA, TIMEOUT)
4. THE Motor_Etiquetas SHALL suportar impressão em lote para operações de: recebimento (etiquetas de todos os itens da NF-e), separação (etiquetas de volumes da onda), expedição (etiquetas de todos os volumes do carregamento)
5. IF a impressão falhar por timeout de conexão (10 segundos), THEN THE Motor_Etiquetas SHALL reenfileirar o trabalho com até 3 tentativas e alertar o operador em caso de falha definitiva
6. THE Motor_Etiquetas SHALL registrar no AuditLog cada impressão realizada com: template, impressora, quantidade, operador, operação vinculada e timestamp

---

### Requirement 16: Telas de Cross-Docking no Frontend

**User Story:** Como operador, eu quero telas dedicadas para visualizar e gerenciar operações de cross-docking, para que eu possa acompanhar o fluxo de itens desde a entrada até a expedição.

#### Acceptance Criteria

1. THE Sistema_WMS SHALL exibir tela de "Painel Cross-Dock" com listagem de itens em cross-docking ativo, mostrando: produto, quantidade, NF-e origem, pedido destino, staging area, status e tempo decorrido
2. WHEN o usuário filtra por status, THE Sistema_WMS SHALL apresentar os itens cross-dock filtrados por: IDENTIFICADO, EM_TRANSITO, EM_STAGING, EXPEDIDO
3. THE Sistema_WMS SHALL exibir indicadores no dashboard de recebimento mostrando quantidade de itens identificados para cross-dock na conferência atual
4. WHEN o operador confirma itens cross-dock no recebimento mobile, THE Sistema_WMS SHALL exibir destino (staging area + doca de saída) em destaque no dispositivo móvel

---

### Requirement 17: Telas de Logística Reversa no Frontend

**User Story:** Como atendente/gestor, eu quero telas dedicadas para gerenciar todo o ciclo de devoluções, desde a criação da RA até a disposição final.

#### Acceptance Criteria

1. THE Sistema_WMS SHALL exibir tela de listagem de RAs com filtros por: status (ABERTA, RECEBIDA, INSPECIONADA, CONCLUIDA, CANCELADA), cliente, período e número da RA
2. THE Sistema_WMS SHALL fornecer formulário de criação de RA com busca de NF-e por número/chave, seleção de itens com quantidade, e campo de motivo obrigatório
3. THE Sistema_WMS SHALL exibir tela de inspeção de devolução no mobile com: checklist de condição, captura de fotos, campo de parecer e botões de classificação (PERFEITO, AVARIADO, INCOMPLETO)
4. THE Sistema_WMS SHALL exibir tela de disposição com listagem de itens inspecionados, resultado da inspeção, fotos e seletor de ação (REESTOQUE, AVARIA, DESCARTE, RETORNO_FORNECEDOR)
5. THE Sistema_WMS SHALL exibir timeline visual do ciclo de vida da RA mostrando todas as etapas com datas e responsáveis

---

### Requirement 18: Consistência Transacional e Auditoria

**User Story:** Como auditor do sistema, eu quero que todas as operações críticas sejam executadas de forma transacional e auditada, para que a integridade dos dados seja garantida.

#### Acceptance Criteria

1. THE Sistema_WMS SHALL executar operações de cross-docking (identificação + alocação + geração de OS) dentro de uma única transação de banco de dados, revertendo tudo em caso de falha parcial
2. THE Sistema_WMS SHALL executar operações de disposição de devolução (atualização de status + movimentação de estoque + geração de nota de crédito) dentro de uma única transação de banco de dados
3. THE Sistema_WMS SHALL registrar no AuditLog cada operação de criação, atualização ou exclusão nos módulos de cross-docking, logística reversa, KPI e agenda de docas, com dados: entidade, entidadeId, ação, usuárioId, dadosAnteriores, dadosNovos, timestamp
4. IF uma transação falha, THEN THE Sistema_WMS SHALL retornar mensagem de erro descritiva ao usuário sem expor detalhes internos de implementação e registrar o erro completo nos logs do servidor
5. THE Sistema_WMS SHALL validar todos os dados de entrada nas APIs com schemas Zod, rejeitando requisições inválidas com código HTTP 422 e detalhamento dos campos com erro

---

### Requirement 19: Multi-Tenancy e Permissões

**User Story:** Como administrador, eu quero que todos os módulos da Fase 1 respeitem o isolamento multi-tenant e o controle de permissões existente, para que dados de uma empresa não sejam acessíveis por outra.

#### Acceptance Criteria

1. THE Sistema_WMS SHALL filtrar todos os dados dos módulos Fase 1 pelo empresaId extraído do token JWT do usuário autenticado
2. THE Sistema_WMS SHALL incluir verificação de módulo nos endpoints dos 5 módulos, impedindo acesso por usuários sem permissão ao módulo WMS
3. THE Sistema_WMS SHALL impedir que operações cross-tenant (cross-dock referenciando NF-e de outra empresa, RA vinculada a NF-e de outra empresa) sejam processadas, retornando código HTTP 403
4. WHEN um novo registro é criado em qualquer módulo Fase 1, THE Sistema_WMS SHALL gravar automaticamente o empresaId do contexto do usuário sem depender do corpo da requisição
