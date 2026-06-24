# Requirements Document

## Introduction

Tratamento de divergências de lote e validade detectadas durante a conferência de entrada no WMS. Quando o conferente informa um lote ou validade diferente do registrado na NF-e, o sistema identifica a divergência e aplica uma política de resolução configurável por produto. Os quatro modos de resolução são: emissão automática de CC-e (ACEITAR_CCE), liberação mediante senha de supervisor (ACEITAR_SENHA), aceitação livre sem restrição (ACEITAR_LIVRE) e bloqueio total da operação (BLOQUEAR).

## Glossary

- **Sistema_Conferencia**: Módulo backend responsável pela lógica de conferência de entrada, detecção de divergências e aplicação de políticas de resolução
- **Frontend_Conferencia**: Interface web Next.js/Mantine que exibe resultados da conferência e permite ao operador resolver divergências
- **ConfigConferenciaProduto**: Tabela de configuração que define a política de resolução de divergência de lote/validade para cada produto
- **Modo_Resolucao**: Enumeração dos modos de tratamento de divergência: ACEITAR_CCE, ACEITAR_SENHA, ACEITAR_LIVRE, BLOQUEAR
- **Divergencia_Lote_Validade**: Registro de divergência do tipo LOTE_DIVERGENTE ou VALIDADE_DIVERGENTE identificado durante a conferência
- **Supervisor**: Usuário com perfil SUPERVISOR ou ADMIN autorizado a liberar divergências no modo ACEITAR_SENHA
- **CC-e**: Carta de Correção Eletrônica emitida à SEFAZ para formalizar a correção de dados divergentes na NF-e
- **CceService**: Serviço existente que orquestra a emissão de CC-e (verificar limite, gerar XML, assinar, transmitir)

## Requirements

### Requirement 1: Configuração de Política por Produto

**User Story:** As a administrador do WMS, I want configurar a política de resolução de divergência de lote/validade por produto, so that cada produto tenha um tratamento adequado conforme sua criticidade.

#### Acceptance Criteria

1. THE Sistema_Conferencia SHALL armazenar a configuração de modo de resolução de divergência de lote na tabela ConfigConferenciaProduto com os valores possíveis ACEITAR_CCE, ACEITAR_SENHA, ACEITAR_LIVRE ou BLOQUEAR
2. THE Sistema_Conferencia SHALL armazenar a configuração de modo de resolução de divergência de validade na tabela ConfigConferenciaProduto com os valores possíveis ACEITAR_CCE, ACEITAR_SENHA, ACEITAR_LIVRE ou BLOQUEAR
3. WHEN nenhuma configuração existir para um produto, THE Sistema_Conferencia SHALL aplicar o modo BLOQUEAR como padrão para divergências de lote e validade
4. THE Sistema_Conferencia SHALL associar cada registro de ConfigConferenciaProduto a exatamente um produto e uma empresa

### Requirement 2: Detecção de Divergência de Lote e Validade

**User Story:** As a conferente, I want que o sistema detecte automaticamente divergências de lote e validade ao conferir os itens, so that eu possa visualizar e tratar cada divergência identificada.

#### Acceptance Criteria

1. WHEN o lote informado pelo conferente diferir do lote registrado na NF-e para um item com exigeLote ativo, THE Sistema_Conferencia SHALL criar um registro de DivergenciaConferencia com tipo LOTE_DIVERGENTE e status PENDENTE
2. WHEN a validade informada pelo conferente diferir da validade registrada na NF-e para um item, THE Sistema_Conferencia SHALL criar um registro de DivergenciaConferencia com tipo VALIDADE_DIVERGENTE e status PENDENTE
3. WHEN uma divergência de lote ou validade for detectada, THE Sistema_Conferencia SHALL registrar o valor esperado (NF-e) e o valor conferido no registro de divergência
4. THE Sistema_Conferencia SHALL consultar a ConfigConferenciaProduto do item divergente para determinar o modo de resolução aplicável

### Requirement 3: Resolução no Modo ACEITAR_LIVRE

**User Story:** As a conferente, I want aceitar divergências de lote/validade livremente quando o produto permite, so that eu possa finalizar a conferência sem impedimentos em casos de baixa criticidade.

#### Acceptance Criteria

1. WHILE o modo de resolução do produto for ACEITAR_LIVRE, WHEN o conferente solicitar a aceitação da divergência, THE Sistema_Conferencia SHALL atualizar o status da divergência para ACEITA sem exigir autenticação adicional
2. WHILE o modo de resolução do produto for ACEITAR_LIVRE, THE Frontend_Conferencia SHALL exibir um botão de aceitação direta na tela de resultado da divergência

### Requirement 4: Resolução no Modo ACEITAR_SENHA

**User Story:** As a conferente, I want solicitar liberação de um supervisor quando o produto exige senha, so that divergências em produtos de média criticidade sejam validadas por um responsável.

#### Acceptance Criteria

1. WHILE o modo de resolução do produto for ACEITAR_SENHA, THE Frontend_Conferencia SHALL exibir um formulário solicitando credenciais de supervisor (usuário e senha)
2. WHEN o conferente submeter as credenciais de supervisor, THE Sistema_Conferencia SHALL validar que o usuário informado possui perfil SUPERVISOR ou ADMIN na mesma empresa
3. WHEN o conferente submeter as credenciais de supervisor, THE Sistema_Conferencia SHALL validar que a senha informada corresponde ao usuário supervisor
4. WHEN as credenciais de supervisor forem válidas, THE Sistema_Conferencia SHALL atualizar o status da divergência para ACEITA e registrar o identificador do supervisor que autorizou
5. IF as credenciais de supervisor forem inválidas, THEN THE Sistema_Conferencia SHALL retornar mensagem de erro informando que as credenciais são inválidas sem revelar qual campo está incorreto
6. IF o usuário informado não possuir perfil SUPERVISOR ou ADMIN, THEN THE Sistema_Conferencia SHALL retornar mensagem de erro informando perfil insuficiente

### Requirement 5: Resolução no Modo ACEITAR_CCE

**User Story:** As a conferente, I want que o sistema emita automaticamente uma CC-e ao aceitar a divergência, so that a correção fique formalizada junto à SEFAZ sem intervenção manual.

#### Acceptance Criteria

1. WHILE o modo de resolução do produto for ACEITAR_CCE, WHEN o conferente solicitar a aceitação da divergência, THE Sistema_Conferencia SHALL emitir uma CC-e através do CceService com o texto de correção descrevendo a alteração de lote ou validade
2. WHEN a CC-e for autorizada pela SEFAZ, THE Sistema_Conferencia SHALL atualizar o status da divergência para ACEITA
3. IF a CC-e for rejeitada pela SEFAZ, THEN THE Sistema_Conferencia SHALL manter o status da divergência como PENDENTE_CCE e registrar o motivo da rejeição
4. IF o limite de 20 CC-e por NF-e estiver atingido, THEN THE Sistema_Conferencia SHALL retornar mensagem de erro informando que o limite foi excedido e a divergência permanece pendente
5. WHILE o modo de resolução do produto for ACEITAR_CCE, THE Frontend_Conferencia SHALL exibir um botão de aceitação com indicação de que uma CC-e será emitida automaticamente

### Requirement 6: Resolução no Modo BLOQUEAR

**User Story:** As a administrador, I want bloquear a aceitação de divergências para produtos de alta criticidade, so that nenhum operador possa aceitar lotes ou validades divergentes sem intervenção no cadastro.

#### Acceptance Criteria

1. WHILE o modo de resolução do produto for BLOQUEAR, THE Sistema_Conferencia SHALL rejeitar qualquer tentativa de aceitação da divergência e retornar mensagem informando que o produto não permite aceitação de divergência de lote ou validade
2. WHILE o modo de resolução do produto for BLOQUEAR, THE Frontend_Conferencia SHALL exibir a divergência com indicação visual de bloqueio e sem opção de aceitação
3. WHILE o modo de resolução do produto for BLOQUEAR, THE Frontend_Conferencia SHALL exibir orientação para o conferente entrar em contato com o administrador

### Requirement 7: Interface de Resultado com Divergências

**User Story:** As a conferente, I want visualizar as divergências de lote/validade de forma clara na tela de resultado, so that eu possa entender rapidamente o que divergiu e tomar a ação correta.

#### Acceptance Criteria

1. WHEN divergências de lote ou validade forem detectadas na conferência, THE Frontend_Conferencia SHALL exibir uma seção dedicada de divergências na tela de resultado, separada das divergências de quantidade
2. THE Frontend_Conferencia SHALL exibir para cada divergência: descrição do produto, tipo da divergência, valor esperado (NF-e), valor conferido e modo de resolução aplicável
3. THE Frontend_Conferencia SHALL aplicar diferenciação visual por modo de resolução utilizando cores ou ícones distintos para ACEITAR_LIVRE, ACEITAR_SENHA, ACEITAR_CCE e BLOQUEAR
4. WHEN todas as divergências de uma nota forem resolvidas (aceitas ou bloqueadas com registro), THE Frontend_Conferencia SHALL habilitar a finalização da conferência
5. WHILE existirem divergências com status PENDENTE, THE Frontend_Conferencia SHALL manter o botão de finalização desabilitado com mensagem explicativa

### Requirement 8: Endpoint de Resolução de Divergência

**User Story:** As a desenvolvedor frontend, I want um endpoint unificado para resolver divergências de lote/validade, so that a interface possa tratar todos os modos de resolução com uma chamada consistente.

#### Acceptance Criteria

1. THE Sistema_Conferencia SHALL expor um endpoint POST para resolver divergências de lote/validade recebendo o identificador da divergência, a ação solicitada e credenciais de supervisor quando aplicável
2. WHEN o endpoint receber uma requisição, THE Sistema_Conferencia SHALL validar que a divergência pertence à empresa do usuário autenticado
3. WHEN o endpoint receber uma requisição, THE Sistema_Conferencia SHALL consultar a ConfigConferenciaProduto para determinar o modo de resolução e aplicar a lógica correspondente
4. THE Sistema_Conferencia SHALL retornar na resposta o status atualizado da divergência, resultado da CC-e quando aplicável e mensagem descritiva do resultado
5. IF a divergência informada não existir ou não pertencer à empresa do usuário, THEN THE Sistema_Conferencia SHALL retornar erro 404 com mensagem genérica
