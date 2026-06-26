# Requirements Document

## Introduction

Evolução do fluxo de conferência cega do WMS para suportar integração com sistemas externos e gestão de pendências. Quando há divergência de lote ou validade após a segunda conferência obrigatória, o comportamento varia conforme a configuração de integração: se há integração, gera uma pendência no sistema; se não há integração, envia e-mail automático ao setor fiscal solicitando CC-e ao fornecedor. O cadastro de produto é reformulado para substituir "Divergência de Lote/Validade" por "Bloqueio de Conferência", removendo a opção "Aceitar Livremente" e adicionando "Aceitar com CCE Automática ou Pendente".

## Glossary

- **Sistema_WMS**: Módulo backend Fastify responsável pela lógica de conferência, detecção de divergências e gestão de pendências
- **Frontend_WMS**: Interface web Next.js/Mantine que exibe configurações, cadastros e listagens do WMS
- **Conferencia_Cega**: Modo de conferência onde o conferente não visualiza os dados da NF-e, devendo informar lote e validade de forma independente
- **Segunda_Conferencia**: Segunda contagem obrigatória realizada quando a primeira conferência cega detecta divergência
- **Pendencia**: Registro gerado quando há divergência confirmada de lote ou validade após a segunda conferência em ambiente com integração ativa
- **ConfigIntegracao**: Tabela de configuração que define se o WMS utiliza integração e com qual sistema externo
- **Sistema_Externo**: Sistema ERP ou fiscal integrado ao WMS que consome pendências para tratamento
- **Bloqueio_Conferencia**: Configuração por produto que define a ação a ser tomada quando houver divergência de lote ou validade na conferência
- **Modo_Bloqueio**: Enumeração dos modos de tratamento: ACEITAR_SENHA, ACEITAR_CCE_PENDENTE
- **Setor_Fiscal**: Departamento responsável por solicitar CC-e ao fornecedor quando não há integração ativa
- **CC-e**: Carta de Correção Eletrônica solicitada ao fornecedor para formalizar correção de lote ou validade na NF-e
- **ConfigEmailFiscal**: Configuração do endereço de e-mail do setor fiscal para recebimento de notificações de divergência

## Requirements

### Requirement 1: Configuração de Integração com Sistema Externo

**User Story:** As a administrador do WMS, I want configurar se o WMS utiliza integração e com qual sistema externo, so that o comportamento de divergências de conferência se adapte ao ambiente operacional.

#### Acceptance Criteria

1. THE Sistema_WMS SHALL armazenar na tabela ConfigIntegracao um indicador booleano de integração ativa e o nome do sistema externo associado, com o nome do sistema externo limitado a 100 caracteres
2. THE Sistema_WMS SHALL permitir apenas uma configuração de integração ativa por empresa
3. IF o administrador tentar criar uma segunda configuração de integração para a mesma empresa, THEN THE Sistema_WMS SHALL rejeitar a operação e retornar uma mensagem de erro indicando que já existe uma configuração para essa empresa
4. WHEN a configuração de integração for criada ou atualizada, IF a integração estiver ativa e o nome do sistema externo estiver vazio ou nulo, THEN THE Sistema_WMS SHALL rejeitar a operação e retornar uma mensagem de erro indicando que o nome do sistema externo é obrigatório
5. WHEN a configuração de integração for criada ou atualizada com integração inativa, THE Sistema_WMS SHALL permitir que o nome do sistema externo seja nulo
6. THE Frontend_WMS SHALL exibir um formulário de configuração de integração com campo booleano para ativação e campo de texto para o nome do sistema externo com limite máximo de 100 caracteres
7. WHEN o administrador salvar a configuração de integração com sucesso, THE Sistema_WMS SHALL persistir os dados e o Frontend_WMS SHALL exibir confirmação visual de que a configuração foi salva

### Requirement 2: Configuração de E-mail do Setor Fiscal

**User Story:** As a administrador do WMS, I want configurar o endereço de e-mail do setor fiscal, so that o sistema possa enviar notificações automáticas de divergências quando não houver integração.

#### Acceptance Criteria

1. THE Sistema_WMS SHALL armazenar na tabela ConfigEmailFiscal o endereço de e-mail do setor fiscal associado a uma empresa, com comprimento máximo de 254 caracteres
2. WHEN o endereço de e-mail for informado, THE Sistema_WMS SHALL validar que o e-mail contém exatamente um caractere "@", possui parte local (antes do @) com 1 a 64 caracteres, e possui domínio (após o @) com pelo menos um ponto separando duas partes não vazias
3. IF o formato do e-mail informado for inválido, THEN THE Sistema_WMS SHALL rejeitar o cadastro e exibir mensagem de erro indicando que o formato do e-mail é inválido, preservando o valor digitado no campo
4. THE Sistema_WMS SHALL permitir apenas uma configuração de e-mail fiscal por empresa, substituindo o valor existente quando um novo e-mail for informado para a mesma empresa
5. IF o campo de e-mail for submetido vazio ou contendo apenas espaços em branco, THEN THE Sistema_WMS SHALL rejeitar o cadastro e exibir mensagem de erro indicando que o e-mail é obrigatório
6. THE Frontend_WMS SHALL exibir um campo de configuração de e-mail do setor fiscal na área de configurações gerais do WMS

### Requirement 3: Reformulação do Cadastro de Produto — Bloqueio de Conferência

**User Story:** As a administrador do WMS, I want configurar o bloqueio de conferência por produto com opções restritas, so that nenhum produto permita aceitação livre de divergências de lote ou validade.

#### Acceptance Criteria

1. THE Frontend_WMS SHALL exibir no cadastro de produto a seção "Bloqueio de Conferência" em substituição à seção "Divergência de Lote" e "Divergência de Validade"
2. THE Frontend_WMS SHALL exibir checkboxes para as opções de ação: "Aceitar com senha supervisor" e "Aceitar com CCE Automática ou Pendente"
3. THE Frontend_WMS SHALL NOT exibir a opção "Aceitar Livremente" no cadastro de produto
4. THE Sistema_WMS SHALL armazenar a configuração de Bloqueio_Conferencia por produto com os modos ACEITAR_SENHA e ACEITAR_CCE_PENDENTE como valores booleanos independentes
5. WHEN nenhuma opção de bloqueio estiver selecionada para um produto, THE Sistema_WMS SHALL aplicar bloqueio total como padrão, exigindo reconferência obrigatória sem possibilidade de aceitação imediata
6. THE Sistema_WMS SHALL permitir que ambas as opções estejam selecionadas simultaneamente para um produto, oferecendo ao conferente a escolha no momento da divergência
7. WHEN o administrador salvar as configurações de Bloqueio_Conferencia, THE Sistema_WMS SHALL persistir as alterações e o Frontend_WMS SHALL exibir confirmação visual

### Requirement 4: Geração de Pendências após Segunda Conferência com Integração Ativa

**User Story:** As a operador do WMS, I want que divergências confirmadas de lote ou validade após a segunda conferência gerem pendências automaticamente, so that o sistema externo integrado possa consumir e tratar as pendências.

#### Acceptance Criteria

1. WHILE a configuração de integração estiver ativa, WHEN a segunda conferência confirmar divergência de lote ou validade, THE Sistema_WMS SHALL criar um registro de Pendencia com status AGUARDANDO_CCE em até 5 segundos após a confirmação da divergência
2. THE Sistema_WMS SHALL registrar na Pendencia os seguintes campos obrigatórios: empresaId, notaEntradaId, codigoProduto (máximo 60 caracteres), descricaoProduto (máximo 200 caracteres), fornecedor (máximo 200 caracteres), e tipo com valor "LOTE" ou "VALIDADE" conforme o tipo de divergência detectada
3. IF a divergência for do tipo lote, THEN THE Sistema_WMS SHALL definir o motivo da Pendencia como "Aguardando CCE de lote"; IF a divergência for do tipo validade, THEN THE Sistema_WMS SHALL definir o motivo como "Aguardando CCE de validade"
4. WHEN a Pendencia for criada, THE Sistema_WMS SHALL associar o registro à empresa (empresaId) e ao recebimento de origem (notaEntradaId), garantindo que ambos referenciem registros existentes
5. THE Sistema_WMS SHALL expor um endpoint autenticado via API Key (header X-Api-Key) que permita ao sistema externo listar pendências filtradas por status e atualizar o status de uma pendência específica para RESOLVIDA, retornando erro 404 se a pendência não existir

### Requirement 5: Envio de E-mail ao Setor Fiscal sem Integração Ativa

**User Story:** As a operador do WMS, I want que divergências confirmadas de lote ou validade gerem um e-mail automático ao setor fiscal quando não há integração, so that o departamento fiscal possa solicitar CC-e ao fornecedor.

#### Acceptance Criteria

1. WHILE a configuração de integração estiver inativa, WHEN a segunda conferência confirmar divergência de lote ou validade, THE Sistema_WMS SHALL enviar um e-mail automático para o endereço configurado em ConfigEmailFiscal dentro de no máximo 30 segundos após a confirmação da divergência
2. THE Sistema_WMS SHALL incluir no e-mail: nome do fornecedor, número da nota fiscal, data de emissão da nota fiscal, descrição do produto, lote ou validade divergente e os valores esperado versus conferido, com um assunto que identifique a nota fiscal e o tipo de divergência
3. IF o endereço de e-mail do setor fiscal não estiver configurado em ConfigEmailFiscal, THEN THE Sistema_WMS SHALL registrar um log de erro e exibir uma notificação não-bloqueante ao operador informando que o e-mail fiscal não está configurado, permitindo que o operador continue suas atividades
4. WHEN o e-mail for enviado com sucesso, THE Sistema_WMS SHALL registrar a data e hora do envio vinculado à divergência para fins de rastreabilidade
5. IF o envio do e-mail falhar após até 3 tentativas com intervalo de 10 segundos entre cada tentativa, THEN THE Sistema_WMS SHALL registrar um log de erro com o motivo da falha, exibir uma notificação não-bloqueante ao operador informando a falha no envio, e marcar a divergência como pendente de notificação fiscal

### Requirement 6: Menu de Listagem de Pendências

**User Story:** As a operador do WMS, I want visualizar todas as pendências de CCE em uma listagem centralizada, so that eu possa acompanhar o status de cada divergência aguardando correção.

#### Acceptance Criteria

1. THE Frontend_WMS SHALL exibir um item de menu "Pendências" no módulo de conferência do WMS
2. THE Frontend_WMS SHALL exibir na listagem de pendências as colunas: Fornecedor, Nota Fiscal, Data de Criação, Produto, Motivo e Status, ordenadas por data de criação decrescente (mais recentes primeiro)
3. THE Frontend_WMS SHALL exibir o motivo da pendência com os valores "Aguardando CCE de lote" ou "Aguardando CCE de validade"
4. THE Frontend_WMS SHALL exibir o status da pendência com os valores "Pendente", "CCE Emitida" ou "Resolvida"
5. THE Frontend_WMS SHALL permitir filtrar a listagem de pendências por fornecedor (busca parcial por nome), por intervalo de datas (data inicial e data final) e por status (seleção exata)
6. WHEN o operador abrir ou atualizar a página de listagem de pendências, THE Frontend_WMS SHALL exibir os dados de pendências com o status mais recente disponível na API
7. IF a listagem de pendências não contiver nenhum registro (ou nenhum resultado para os filtros aplicados), THEN THE Frontend_WMS SHALL exibir uma mensagem indicando que não há pendências encontradas

### Requirement 7: Resolução de Pendências

**User Story:** As a administrador do WMS, I want resolver pendências manualmente ou via integração, so that itens aguardando CCE possam ser liberados para endereçamento após a correção.

#### Acceptance Criteria

1. THE Sistema_WMS SHALL expor um endpoint para resolução manual de pendências recebendo o identificador da pendência (UUID) e o novo status (RESOLVIDA ou CANCELADA)
2. WHEN uma pendência for resolvida ou cancelada, THE Sistema_WMS SHALL atualizar o status correspondente e registrar a data da operação e o identificador do usuário responsável
3. WHEN uma pendência for resolvida via integração, THE Sistema_WMS SHALL validar que a requisição provém do sistema externo autorizado configurado em ConfigIntegracao
4. IF a validação de origem da integração falhar, THEN THE Sistema_WMS SHALL rejeitar a requisição com erro indicando falha de autorização e manter o status da pendência inalterado
5. WHILE uma pendência estiver com status AGUARDANDO_CCE, THE Sistema_WMS SHALL rejeitar requisições de finalização do recebimento dos itens associados à pendência retornando erro indicando que existem pendências não resolvidas
6. WHEN todas as pendências de um recebimento estiverem com status RESOLVIDA ou CANCELADA, THE Sistema_WMS SHALL atualizar o status do recebimento para liberado para endereçamento
7. IF o identificador da pendência não existir ou a pendência já estiver com status diferente de AGUARDANDO_CCE, THEN THE Sistema_WMS SHALL rejeitar a requisição com erro indicando que a pendência não foi encontrada ou já foi processada

### Requirement 8: Fluxo de Conferência Cega com Segunda Conferência Obrigatória

**User Story:** As a conferente, I want que a segunda conferência seja obrigatória quando a primeira detectar divergência de lote ou validade, so that erros de digitação sejam eliminados antes de gerar pendências ou notificações.

#### Acceptance Criteria

1. WHEN a conferência cega detectar divergência de lote ou validade na primeira contagem, THE Sistema_WMS SHALL marcar o item com status PENDENTE_SEGUNDA_CONFERENCIA e impedir a finalização do recebimento desse item até a conclusão da segunda conferência
2. THE Sistema_WMS SHALL exigir que a segunda conferência seja realizada por um conferente diferente ou pelo mesmo conferente em uma nova ação de conferência (submissão separada da primeira contagem)
3. WHEN a segunda conferência informar valores de lote ou validade que também divergem dos valores da NF-e, THE Sistema_WMS SHALL considerar a divergência como confirmada e acionar o fluxo de pendência ou e-mail conforme a configuração de integração
4. WHEN a segunda conferência informar valores de lote e validade que coincidem com os valores da NF-e, THE Sistema_WMS SHALL resolver a divergência automaticamente, atualizar o status do item para CONFERIDO e liberar o item para endereçamento
5. IF a segunda conferência informar um valor diferente tanto da NF-e quanto da primeira contagem, THEN THE Sistema_WMS SHALL tratar como divergência confirmada e acionar o fluxo de pendência ou e-mail conforme a configuração de integração
6. IF o produto possuir Bloqueio_Conferencia com modo ACEITAR_SENHA selecionado, THEN THE Sistema_WMS SHALL oferecer ao conferente a opção de liberação por supervisor com senha após a segunda conferência confirmar divergência e antes de gerar pendência ou enviar e-mail
7. IF o produto possuir Bloqueio_Conferencia com modo ACEITAR_CCE_PENDENTE selecionado, THEN THE Sistema_WMS SHALL gerar a pendência ou enviar e-mail conforme a configuração de integração
