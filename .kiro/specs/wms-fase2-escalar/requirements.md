# Requirements Document

## Introduction

Este documento define os requisitos para a Fase 2 de escalonamento do VisioFab WMS. São 5 módulos que permitem o sistema operar em grandes operações logísticas: Faturamento de Armazenagem, Picking por Zona/Cluster, Labor Management System (LMS), Yard Management (Gestão de Pátio) e Multi-CD com Transferências. Todos os módulos operam no contexto multi-tenant existente (empresa + JWT), utilizam o stack Fastify/Prisma/PostgreSQL no backend e Next.js 15/Mantine v7 no frontend, seguindo os mesmos padrões da Fase 1 (services com $transaction, schemas Zod, auditoria, routes com authenticate + moduloGuard).

## Glossary

- **Sistema_WMS**: O sistema VisioFab WMS completo (backend Fastify + frontend Next.js + mobile React Native)
- **Motor_Faturamento**: Subsistema responsável por calcular cobranças de armazenagem, gerar faturas e relatórios financeiros para operadores logísticos
- **Motor_PickingZona**: Subsistema que divide ondas de separação por zona do armazém e gerencia atribuição de separadores dedicados
- **Motor_LMS**: Subsistema de Labor Management que mede produtividade por tarefa, compara tempo real versus meta e gera rankings
- **Motor_Patio**: Subsistema de Yard Management que controla entrada/saída de veículos, fila de espera e chamada à doca
- **Motor_MultiCD**: Subsistema de transferência de estoque entre centros de distribuição com controle de mercadoria em trânsito
- **Contrato_Armazenagem**: Acordo entre operador logístico e cliente definindo tarifas por tipo de serviço (pallet/dia, m³, movimentação, permanência, picking)
- **Medicao_Ocupacao**: Registro periódico automático da ocupação de espaço de cada cliente no armazém
- **Fatura_Armazenagem**: Documento de cobrança gerado periodicamente com base nas medições e tarifas contratuais
- **Zona_Picking**: Divisão lógica do armazém onde separadores dedicados atuam exclusivamente
- **Sub_Onda**: Fragmento de uma onda de separação contendo apenas itens de uma zona específica
- **Ponto_Consolidacao**: Local físico onde itens de diferentes zonas são reunidos para compor o pedido completo
- **Meta_Operacao**: Tempo padrão esperado para execução de uma operação específica (conferência, endereçamento, separação, carregamento)
- **Indicador_Produtividade**: Razão entre tempo meta e tempo real de execução de tarefas por funcionário
- **Veiculo_Patio**: Registro de veículo presente no pátio do centro de distribuição com dados de placa, motorista e operação
- **Fila_Espera**: Sequência ordenada por prioridade de veículos aguardando chamada à doca
- **Chamada_Doca**: Ação de convocar veículo da fila de espera para uma doca específica
- **Solicitacao_Transferencia**: Documento que inicia o processo de transferência de estoque entre dois CDs
- **Documento_Saida_Transferencia**: Registro de saída de mercadoria no CD de origem para transferência
- **Mercadoria_Transito**: Estoque que está em trânsito entre dois CDs, ainda não recebido no destino
- **Centro_Distribuicao**: Unidade física de armazenagem da empresa (modelo CentroDistribuicao existente)
- **AuditLog**: Registro de auditoria existente no sistema para rastreamento de operações

---

## Requirements

---

### Requirement 1: Configuração de Contratos de Armazenagem

**User Story:** Como gerente comercial do operador logístico, eu quero cadastrar contratos de cobrança por cliente com tarifas diferenciadas por tipo de serviço, para que a cobrança seja automatizada conforme condições acordadas.

#### Acceptance Criteria

1. THE Motor_Faturamento SHALL permitir criação de Contrato_Armazenagem com os campos: cliente, vigência (data início e fim), periodicidade de faturamento (SEMANAL, QUINZENAL, MENSAL), moeda e status (ATIVO, SUSPENSO, ENCERRADO)
2. THE Motor_Faturamento SHALL suportar configuração das seguintes tarifas no contrato: PALLET_DIA (valor por pallet armazenado por dia), METRO_CUBICO (valor por m³ ocupado), MOVIMENTACAO_ENTRADA (valor por operação de entrada), MOVIMENTACAO_SAIDA (valor por operação de saída), PERMANENCIA (valor por dia de permanência além do período de carência), PICKING_UNITARIO (valor por unidade separada)
3. WHEN um contrato é criado, THE Motor_Faturamento SHALL validar que não existe outro contrato ATIVO para o mesmo cliente com vigência sobreposta
4. THE Motor_Faturamento SHALL permitir configuração de carência em dias para a tarifa de PERMANENCIA, período durante o qual a cobrança de permanência não se aplica
5. IF um contrato é encerrado, THEN THE Motor_Faturamento SHALL gerar fatura proporcional aos dias restantes do período corrente e impedir novas medições para o contrato

---

### Requirement 2: Medição Automática de Ocupação

**User Story:** Como analista de faturamento, eu quero que o sistema meça automaticamente a ocupação diária de cada cliente por tipo de tarifa, para que o cálculo de cobrança seja preciso e auditável.

#### Acceptance Criteria

1. THE Motor_Faturamento SHALL executar medição automática diária (configurável por hora) contabilizando: quantidade de pallets armazenados por cliente, volume em m³ ocupado por cliente e dias de permanência por item
2. WHEN a medição diária é executada, THE Motor_Faturamento SHALL registrar snapshot de Medicao_Ocupacao com: clienteId, data da medição, quantidade de pallets, volume em m³, quantidade de posições ocupadas e detalhamento por produto
3. THE Motor_Faturamento SHALL contabilizar movimentações de entrada e saída por cliente ao longo do período, registrando cada operação com data, tipo (ENTRADA ou SAIDA) e quantidade
4. THE Motor_Faturamento SHALL contabilizar operações de picking unitário por cliente ao longo do período, registrando cada separação com data, produto e quantidade de unidades separadas
5. IF a medição automática falhar por indisponibilidade do sistema, THEN THE Motor_Faturamento SHALL registrar a falha, alertar o administrador e permitir reprocessamento manual da data faltante

---

### Requirement 3: Cálculo e Geração de Faturas

**User Story:** Como analista de faturamento, eu quero que o sistema calcule automaticamente os valores devidos por cada cliente e gere faturas detalhadas, para que a cobrança seja transparente e eficiente.

#### Acceptance Criteria

1. WHEN o período de faturamento de um Contrato_Armazenagem é atingido, THE Motor_Faturamento SHALL calcular automaticamente o valor total por tarifa com base nas medições registradas no período
2. THE Motor_Faturamento SHALL gerar Fatura_Armazenagem com: número sequencial, cliente, período de referência, detalhamento por tarifa (tipo, quantidade, valor unitário, subtotal), valor total, data de vencimento e status (GERADA, ENVIADA, PAGA, CANCELADA)
3. THE Motor_Faturamento SHALL aplicar a fórmula: valor PALLET_DIA = soma de (pallets por dia × tarifa) ao longo do período; valor METRO_CUBICO = soma de (m³ por dia × tarifa); valor MOVIMENTACAO = contagem de operações × tarifa; valor PERMANENCIA = dias além da carência × tarifa; valor PICKING = unidades separadas × tarifa
4. THE Motor_Faturamento SHALL permitir revisão manual da fatura antes do envio, possibilitando ajustes de valor com registro de justificativa
5. THE Motor_Faturamento SHALL gerar relatório de faturamento consolidado por período com totais por cliente e por tipo de tarifa
6. IF uma fatura for cancelada, THEN THE Motor_Faturamento SHALL registrar motivo do cancelamento no AuditLog e permitir geração de nova fatura para o mesmo período

---

### Requirement 4: Configuração de Zonas de Picking

**User Story:** Como gestor de armazém, eu quero configurar zonas de picking e atribuir separadores dedicados a cada zona, para que a operação de separação seja paralela e eficiente.

#### Acceptance Criteria

1. THE Motor_PickingZona SHALL permitir criação de Zona_Picking com: nome, código, cor de identificação, lista de endereços pertencentes à zona e status (ATIVA, INATIVA)
2. THE Motor_PickingZona SHALL permitir atribuição de separadores (usuários com perfil operador) a zonas de picking, com configuração de zona principal e zonas secundárias para flexibilidade
3. THE Motor_PickingZona SHALL validar que cada endereço pertence a no máximo uma Zona_Picking ativa, rejeitando atribuição de endereço já vinculado a outra zona
4. WHEN um separador é atribuído a uma Zona_Picking, THE Motor_PickingZona SHALL exibir apenas itens dessa zona nas tarefas de separação do operador
5. THE Motor_PickingZona SHALL permitir configuração de Ponto_Consolidacao por grupo de zonas, definindo o local físico onde itens de diferentes zonas são reunidos

---

### Requirement 5: Divisão Automática de Ondas por Zona

**User Story:** Como planejador de expedição, eu quero que ondas grandes sejam automaticamente divididas em sub-ondas por zona, para que cada separador trabalhe apenas nos itens da sua área.

#### Acceptance Criteria

1. WHEN uma OndaSeparacao é gerada com itens de múltiplas zonas, THE Motor_PickingZona SHALL dividir automaticamente a onda em Sub_Ondas agrupando itens pela Zona_Picking dos endereços de origem
2. THE Motor_PickingZona SHALL atribuir cada Sub_Onda ao separador disponível da zona correspondente, respeitando balanceamento de carga entre separadores da mesma zona
3. THE Motor_PickingZona SHALL manter rastreabilidade entre a onda original e suas sub-ondas, permitindo consulta do progresso por zona e por onda completa
4. WHEN todas as Sub_Ondas de uma onda são concluídas, THE Motor_PickingZona SHALL gerar tarefa de consolidação no Ponto_Consolidacao configurado, agrupando itens por pedido de venda
5. IF uma Zona_Picking não possuir separadores disponíveis no momento da divisão, THEN THE Motor_PickingZona SHALL alertar o gestor e manter a Sub_Onda em status AGUARDANDO_SEPARADOR
6. THE Motor_PickingZona SHALL exibir painel de acompanhamento mostrando progresso de cada sub-onda por zona com percentual concluído e tempo estimado

---

### Requirement 6: Configuração de Metas por Operação

**User Story:** Como gestor de operações, eu quero configurar tempos meta para cada tipo de operação do armazém, para que o sistema possa medir a produtividade real versus a esperada.

#### Acceptance Criteria

1. THE Motor_LMS SHALL permitir configuração de Meta_Operacao com: tipo de operação (CONFERENCIA, ENDERECAMENTO, SEPARACAO, CARREGAMENTO, INVENTARIO), tempo meta em minutos, unidade de medida (por item, por pallet, por linha de pedido, por volume) e faixa de tolerância em percentual
2. THE Motor_LMS SHALL permitir metas diferenciadas por categoria de produto (peso, volume, fragilidade) para operações onde a complexidade varia
3. WHEN uma Meta_Operacao é criada ou alterada, THE Motor_LMS SHALL registrar no histórico a alteração com data, responsável e valores anterior e novo
4. THE Motor_LMS SHALL calcular automaticamente a meta de tempo para cada tarefa individual com base no tipo de operação, quantidade de itens e categoria dos produtos envolvidos
5. THE Motor_LMS SHALL permitir configuração de incentivos e penalidades por faixa de desempenho: ACIMA_META (acima de 100% + tolerância), NA_META (dentro da faixa), ABAIXO_META (abaixo de 100% - tolerância)

---

### Requirement 7: Medição Automática de Produtividade

**User Story:** Como gestor de operações, eu quero que o sistema meça automaticamente o tempo real de execução de cada tarefa por funcionário, para que eu tenha dados objetivos de produtividade.

#### Acceptance Criteria

1. WHEN um operador inicia uma tarefa (OrdemServicoWms), THE Motor_LMS SHALL registrar automaticamente o timestamp de início associado ao operador
2. WHEN um operador conclui uma tarefa, THE Motor_LMS SHALL registrar o timestamp de conclusão e calcular o tempo real de execução em minutos
3. THE Motor_LMS SHALL calcular o Indicador_Produtividade para cada tarefa concluída usando a fórmula: produtividade = (tempo_meta / tempo_real) × 100, onde valores acima de 100 indicam desempenho superior à meta
4. THE Motor_LMS SHALL descontar automaticamente tempo de pausa registrado (intervalo, almoço) do tempo real de execução da tarefa
5. IF um operador não concluir uma tarefa dentro de 3 vezes o tempo meta, THEN THE Motor_LMS SHALL gerar alerta ao gestor e marcar a tarefa como ATENCAO_NECESSARIA

---

### Requirement 8: Rankings e Relatórios de Produtividade

**User Story:** Como gestor de RH e operações, eu quero visualizar rankings de produtividade e relatórios detalhados por funcionário e por operação, para tomar decisões de incentivo e treinamento.

#### Acceptance Criteria

1. THE Motor_LMS SHALL gerar ranking de funcionários por produtividade agregada em período configurável (dia, semana, mês), ordenado por índice médio de produtividade
2. THE Motor_LMS SHALL apresentar relatório individual por funcionário contendo: tarefas concluídas, tempo médio por operação, índice de produtividade por tipo de operação, evolução ao longo do tempo e comparativo com média da equipe
3. THE Motor_LMS SHALL apresentar relatório por tipo de operação contendo: quantidade de tarefas realizadas, tempo médio real, comparativo com meta, distribuição de desempenho (histograma) e identificação de gargalos
4. THE Motor_LMS SHALL permitir exportação dos relatórios em formato CSV para análise externa
5. THE Motor_LMS SHALL aplicar regras de incentivo e penalidade configuradas, exibindo no relatório do funcionário os pontos de incentivo acumulados e ocorrências de penalidade no período

---

### Requirement 9: Registro de Entrada e Saída de Veículos no Pátio

**User Story:** Como porteiro do CD, eu quero registrar a entrada e saída de veículos no pátio com dados completos, para que o controle de acesso e permanência seja preciso.

#### Acceptance Criteria

1. WHEN um veículo chega ao CD, THE Motor_Patio SHALL registrar entrada com: placa, motorista (nome e documento), transportadora, tipo de operação (CARGA, DESCARGA, DEVOLUCAO, TRANSFERENCIA), número do agendamento (se houver) e timestamp de entrada
2. WHEN um veículo sai do CD, THE Motor_Patio SHALL registrar saída com timestamp e calcular tempo total de permanência em minutos
3. THE Motor_Patio SHALL manter painel em tempo real de todos os veículos presentes no pátio com: placa, motorista, tempo de permanência atual, tipo de operação e status (AGUARDANDO, NA_DOCA, LIBERADO)
4. THE Motor_Patio SHALL validar placa do veículo no formato padrão brasileiro (antigo e Mercosul) e impedir registro duplicado de veículo já presente no pátio
5. IF um veículo permanecer no pátio além do limite configurado (padrão 4 horas), THEN THE Motor_Patio SHALL gerar alerta automático ao coordenador de pátio com dados do veículo e tempo excedido

---

### Requirement 10: Fila de Espera com Prioridade e Chamada à Doca

**User Story:** Como coordenador de pátio, eu quero gerenciar a fila de espera de veículos com prioridade e convocar veículos para as docas disponíveis, para que a operação flua de forma organizada.

#### Acceptance Criteria

1. WHEN um veículo é registrado na entrada, THE Motor_Patio SHALL adicioná-lo à Fila_Espera com prioridade baseada em: presença de agendamento (prioridade alta), tipo de operação (DESCARGA prioriza sobre CARGA) e ordem de chegada
2. THE Motor_Patio SHALL permitir ajuste manual de prioridade na fila por um coordenador, registrando justificativa da alteração
3. WHEN uma doca fica disponível, THE Motor_Patio SHALL sugerir o próximo veículo da fila baseado em prioridade e compatibilidade da doca com o tipo de operação
4. WHEN uma Chamada_Doca é emitida, THE Motor_Patio SHALL registrar horário da chamada, veículo chamado, doca destino e exibir notificação no painel do pátio e no app do motorista
5. WHEN o veículo chega à doca após chamada, THE Motor_Patio SHALL registrar horário de chegada à doca e calcular tempo de resposta (chamada até chegada)
6. THE Motor_Patio SHALL permitir cancelamento de chamada com registro de motivo, retornando o veículo à fila na posição adequada

---

### Requirement 11: Relatórios de Gestão de Pátio

**User Story:** Como coordenador de operações, eu quero relatórios de permanência, tempo de resposta e ocupação do pátio, para que eu possa otimizar a operação e identificar gargalos.

#### Acceptance Criteria

1. THE Motor_Patio SHALL gerar relatório de permanência contendo: tempo médio de permanência por tipo de operação, veículos com permanência acima do limite, distribuição de tempos por faixa horária
2. THE Motor_Patio SHALL gerar relatório de fila de espera contendo: tempo médio em fila, tempo médio de resposta à chamada, quantidade de veículos atendidos por período
3. THE Motor_Patio SHALL gerar relatório de ocupação do pátio contendo: pico de ocupação por dia, média de veículos simultâneos, utilização de docas por período
4. THE Motor_Patio SHALL permitir filtro dos relatórios por período, transportadora, tipo de operação e turno
5. THE Motor_Patio SHALL permitir exportação dos relatórios em formato CSV para análise externa

---

### Requirement 12: Criação de Solicitação de Transferência entre CDs

**User Story:** Como gestor de estoque, eu quero criar solicitações de transferência de mercadoria entre centros de distribuição, para que a distribuição de estoque seja balanceada conforme demanda regional.

#### Acceptance Criteria

1. THE Motor_MultiCD SHALL permitir criação de Solicitacao_Transferencia com: CD de origem, CD de destino, lista de itens (produto + quantidade), motivo, prioridade (NORMAL, URGENTE) e data prevista de envio
2. WHEN uma solicitação é criada, THE Motor_MultiCD SHALL validar que o CD de origem possui saldo disponível (não reservado) dos itens solicitados nas quantidades indicadas
3. WHEN uma solicitação é criada, THE Motor_MultiCD SHALL validar que o CD de origem e o CD de destino pertencem à mesma empresa
4. THE Motor_MultiCD SHALL gerar número sequencial para a solicitação no formato TRF-YYYY-NNNNNN por empresa
5. THE Motor_MultiCD SHALL manter status da solicitação: PENDENTE, APROVADA, EM_SEPARACAO, EXPEDIDA, EM_TRANSITO, RECEBIDA, CANCELADA
6. IF a quantidade solicitada for superior ao saldo disponível no CD de origem, THEN THE Motor_MultiCD SHALL rejeitar a solicitação com detalhamento dos itens com saldo insuficiente

---

### Requirement 13: Expedição e Controle de Mercadoria em Trânsito

**User Story:** Como operador de expedição, eu quero dar saída na mercadoria transferida e acompanhar o trânsito até o CD de destino, para que a rastreabilidade seja completa.

#### Acceptance Criteria

1. WHEN uma Solicitacao_Transferencia é aprovada, THE Motor_MultiCD SHALL gerar OrdemServicoWms de separação dos itens no CD de origem seguindo o fluxo de separação existente
2. WHEN a separação é concluída, THE Motor_MultiCD SHALL gerar Documento_Saida_Transferencia com: itens expedidos, quantidades, data de saída, veículo (placa e motorista) e previsão de chegada
3. WHEN o Documento_Saida_Transferencia é emitido, THE Motor_MultiCD SHALL dar baixa no saldo do CD de origem e registrar os itens como Mercadoria_Transito com status EM_TRANSITO
4. WHILE mercadoria está em trânsito, THE Motor_MultiCD SHALL exibir os itens no painel de transferências com: origem, destino, data de saída, previsão de chegada e tempo em trânsito
5. IF a mercadoria não for recebida no CD de destino dentro de 48 horas após a saída, THEN THE Motor_MultiCD SHALL gerar alerta ao gestor indicando possível atraso na transferência

---

### Requirement 14: Recebimento de Transferência no CD de Destino

**User Story:** Como conferente do CD de destino, eu quero receber e conferir a mercadoria transferida, para que o estoque seja atualizado corretamente.

#### Acceptance Criteria

1. WHEN mercadoria transferida chega ao CD de destino, THE Motor_MultiCD SHALL vincular o recebimento ao Documento_Saida_Transferencia correspondente e registrar data/hora de chegada
2. THE Motor_MultiCD SHALL exigir conferência quantitativa dos itens recebidos, comparando com as quantidades expedidas no documento de saída
3. WHEN a conferência é concluída sem divergências, THE Motor_MultiCD SHALL creditar o saldo no estoque do CD de destino, baixar a Mercadoria_Transito e atualizar o status da solicitação para RECEBIDA
4. IF houver divergência de quantidade entre expedido e recebido, THEN THE Motor_MultiCD SHALL registrar a divergência com detalhamento por item, notificar o gestor e permitir recebimento parcial
5. WHEN a transferência é concluída, THE Motor_MultiCD SHALL registrar no AuditLog a operação completa com: solicitação, itens, quantidades, CDs envolvidos, datas e operadores responsáveis

---

### Requirement 15: Painel de Transferências e Estoque em Trânsito

**User Story:** Como gestor de estoque multi-CD, eu quero visualizar um painel consolidado de todas as transferências e mercadorias em trânsito, para que eu tenha visibilidade completa da movimentação entre CDs.

#### Acceptance Criteria

1. THE Motor_MultiCD SHALL exibir painel de transferências com listagem de todas as solicitações filtráveis por: status, CD origem, CD destino, período e prioridade
2. THE Motor_MultiCD SHALL exibir seção de "Estoque em Trânsito" mostrando: produto, quantidade, CD origem, CD destino, data de saída, previsão de chegada e dias em trânsito
3. THE Motor_MultiCD SHALL exibir totalizadores: quantidade de transferências por status, valor estimado em trânsito, tempo médio de trânsito por rota (origem → destino)
4. THE Motor_MultiCD SHALL permitir exportação dos dados de transferências em formato CSV para análise externa
5. WHEN o usuário clica em uma solicitação, THE Motor_MultiCD SHALL exibir timeline completa da transferência com todas as etapas, datas, responsáveis e status atual

---

### Requirement 16: Consistência Transacional e Auditoria Fase 2

**User Story:** Como auditor do sistema, eu quero que todas as operações críticas da Fase 2 sejam executadas de forma transacional e auditada, para que a integridade dos dados e rastreabilidade sejam garantidas.

#### Acceptance Criteria

1. THE Sistema_WMS SHALL executar operações de faturamento (cálculo + geração de fatura + registro de medições) dentro de uma única transação de banco de dados, revertendo tudo em caso de falha parcial
2. THE Sistema_WMS SHALL executar operações de transferência (baixa saldo origem + registro trânsito + crédito destino) dentro de uma única transação de banco de dados
3. THE Sistema_WMS SHALL registrar no AuditLog cada operação de criação, atualização ou exclusão nos módulos de Faturamento, Picking por Zona, LMS, Yard Management e Multi-CD, com dados: entidade, entidadeId, ação, usuárioId, dadosAnteriores, dadosNovos, timestamp
4. THE Sistema_WMS SHALL validar todos os dados de entrada nas APIs da Fase 2 com schemas Zod, rejeitando requisições inválidas com código HTTP 422 e detalhamento dos campos com erro
5. IF uma transação falha, THEN THE Sistema_WMS SHALL retornar mensagem de erro descritiva ao usuário sem expor detalhes internos de implementação e registrar o erro completo nos logs do servidor

---

### Requirement 17: Multi-Tenancy e Permissões Fase 2

**User Story:** Como administrador, eu quero que todos os módulos da Fase 2 respeitem o isolamento multi-tenant e o controle de permissões existente, para que dados de uma empresa não sejam acessíveis por outra.

#### Acceptance Criteria

1. THE Sistema_WMS SHALL filtrar todos os dados dos módulos Fase 2 pelo empresaId extraído do token JWT do usuário autenticado
2. THE Sistema_WMS SHALL incluir verificação de módulo nos endpoints dos 5 módulos da Fase 2, impedindo acesso por usuários sem permissão ao módulo WMS
3. THE Sistema_WMS SHALL impedir operações cross-tenant (transferência entre CDs de empresas diferentes, contrato referenciando cliente de outra empresa) retornando código HTTP 403
4. WHEN um novo registro é criado em qualquer módulo Fase 2, THE Sistema_WMS SHALL gravar automaticamente o empresaId do contexto do usuário sem depender do corpo da requisição
