# Requirements Document

## Introduction

O Portal do Representante é uma interface web dedicada a representantes comerciais externos da empresa. O portal permite que representantes autenticados criem solicitações de orçamento, acompanhem o pipeline de seus pedidos (desde o orçamento até a entrega), visualizem comissões projetadas e realizadas, e gerenciem sua carteira de clientes. O representante não tem acesso a custos, margens ou ao motor de cálculo interno — recebe apenas o preço de venda final calculado pelo ERP.

## Glossary

- **Portal_Representante**: Interface web externa destinada ao uso exclusivo de representantes comerciais cadastrados pela empresa.
- **Representante**: Vendedor externo autenticado no Portal, vinculado ao cadastro de `Vendedor` existente no ERP. Possui credenciais próprias (e-mail + senha) criadas pelo administrador.
- **ERP_Admin**: Usuário interno do ERP com perfil ADMIN ou SUPER_ADMIN, responsável por criar e gerenciar credenciais de representantes.
- **Solicitacao_Orcamento**: Pedido criado pelo Representante contendo cliente, produto(s), quantidade e especificações. Não contém informações de custo ou margem.
- **Pipeline**: Sequência de etapas de um pedido: Orçamento → Aprovação → Pedido de Venda → Ordem de Produção → Produção → Expedição → Entrega.
- **Comissao**: Valor percentual sobre o preço de venda devido ao Representante após a entrega/faturamento. Pode ser fixa (por representante) ou variável (por produto/tabela).
- **Carteira_Clientes**: Conjunto de clientes/prospects vinculados a um Representante específico.
- **Preco_Venda**: Valor final de venda calculado pelo motor de orçamento gráfico do ERP, devolvido ao Representante sem detalhamento de composição de custos.
- **Sistema_Vendas**: Módulo de Vendas existente no ERP (cadastros de Cliente, PedidoVenda, Faturamento, NF-e).

## Requirements

### Requisito 1: Autenticação do Representante

**User Story:** Como um representante comercial, eu quero acessar o portal com credenciais seguras criadas pelo administrador, para que eu possa operar de forma independente e protegida.

#### Critérios de Aceite

1. WHEN o ERP_Admin cria uma conta de representante, THE Portal_Representante SHALL gerar credenciais (e-mail + senha temporária) vinculadas ao cadastro de Vendedor existente.
2. WHEN o Representante realiza login pela primeira vez, THE Portal_Representante SHALL exigir a troca obrigatória da senha temporária antes de permitir acesso às funcionalidades.
3. WHEN o Representante informa credenciais válidas e já trocou a senha, THE Portal_Representante SHALL emitir um token JWT com dados de sessão (representanteId, empresaId, vendedorId).
4. IF o Representante informar credenciais inválidas 5 vezes consecutivas, THEN THE Portal_Representante SHALL bloquear temporariamente o acesso por 15 minutos.
5. THE Portal_Representante SHALL isolar completamente os dados por empresaId, garantindo que um representante acesse somente dados da empresa à qual está vinculado.
6. WHEN o ERP_Admin inativa a conta do representante, THE Portal_Representante SHALL revogar o acesso imediatamente na próxima requisição autenticada.

---

### Requisito 2: Criação de Solicitação de Orçamento

**User Story:** Como um representante comercial, eu quero criar solicitações de orçamento de forma simplificada, para que eu possa apresentar preços aos meus clientes rapidamente sem precisar entender o motor de cálculo.

#### Critérios de Aceite

1. WHEN o Representante preenche o formulário de solicitação (cliente, produto/tipo de embalagem, quantidade, especificações), THE Portal_Representante SHALL criar uma Solicitacao_Orcamento vinculada ao vendedorId do representante.
2. THE Portal_Representante SHALL apresentar ao Representante apenas campos simplificados: cliente, tipo de embalagem, medidas, quantidade, acabamentos desejados e observações.
3. THE Portal_Representante SHALL ocultar do Representante todos os campos de custo, margem, markup, taxas e composição de preço.
4. WHEN o ERP recebe a Solicitacao_Orcamento, THE Portal_Representante SHALL calcular internamente o orçamento gráfico completo e devolver ao Representante exclusivamente o Preco_Venda final e o preço unitário.
5. WHEN o cálculo do orçamento é concluído pelo ERP, THE Portal_Representante SHALL atualizar o status da solicitação e notificar o Representante que o preço está disponível.
6. IF o Representante selecionar um cliente não cadastrado, THEN THE Portal_Representante SHALL permitir o preenchimento de um prospect (nome + CNPJ/CPF) diretamente no formulário de solicitação.

---

### Requisito 3: Acompanhamento do Pipeline de Pedidos

**User Story:** Como um representante comercial, eu quero acompanhar em tempo real o andamento dos meus pedidos em todas as etapas, para que eu possa informar meus clientes sobre prazos e status.

#### Critérios de Aceite

1. THE Portal_Representante SHALL exibir o pipeline exclusivamente dos pedidos vinculados ao vendedorId do Representante autenticado.
2. THE Portal_Representante SHALL apresentar as etapas do pipeline na sequência: Orçamento → Aprovação → Pedido de Venda → Ordem de Produção → Em Produção → Expedição → Entregue.
3. WHEN o status de um pedido muda em qualquer etapa no ERP, THE Portal_Representante SHALL refletir a mudança na visualização do Representante em até 30 segundos após polling ou atualização manual da tela.
4. WHILE um pedido estiver na etapa "Em Produção", THE Portal_Representante SHALL exibir o percentual de progresso baseado nas etapas de produção concluídas da Ordem de Produção correspondente.
5. THE Portal_Representante SHALL permitir filtros por: status atual, cliente, período de criação e número do pedido.
6. THE Portal_Representante SHALL apresentar a interface de pipeline em formato responsivo (mobile-friendly), com visualização step-by-step simplificada similar ao acompanhamento de cliente existente.

---

### Requisito 4: Comissão — Previsão e Histórico

**User Story:** Como um representante comercial, eu quero visualizar minhas comissões projetadas e já realizadas, para que eu tenha previsibilidade financeira e transparência na remuneração.

#### Critérios de Aceite

1. THE Portal_Representante SHALL exibir a comissão projetada para cada pedido individual, calculada com base no percentual configurado (fixo por representante OU variável por produto/tabela).
2. WHEN o ERP_Admin configura comissão fixa para o representante, THE Portal_Representante SHALL aplicar esse percentual sobre o Preco_Venda de todos os pedidos do representante.
3. WHEN o ERP_Admin configura comissão variável por produto ou tabela de preço, THE Portal_Representante SHALL aplicar o percentual específico de cada produto/tabela ao calcular a comissão do pedido.
4. WHEN um pedido atinge o status "Entregue" (ou o critério de creditamento definido pelo ERP_Admin), THE Portal_Representante SHALL marcar a comissão como "Realizada" e incluí-la no total do período.
5. THE Portal_Representante SHALL exibir um resumo por período (mês) com: total projetado (pedidos em andamento), total realizado (pedidos entregues/faturados) e total geral.
6. THE Portal_Representante SHALL permitir ao Representante filtrar comissões por período, cliente e status (projetada/realizada).
7. THE Portal_Representante SHALL ocultar do Representante o valor de custo e margem — exibindo apenas o preço de venda e o valor da comissão resultante.

---

### Requisito 5: Gestão da Carteira de Clientes

**User Story:** Como um representante comercial, eu quero cadastrar e gerenciar meus clientes e prospects, para que eu possa criar orçamentos rapidamente e manter minha base atualizada.

#### Critérios de Aceite

1. THE Portal_Representante SHALL exibir ao Representante apenas os clientes vinculados ao seu vendedorId (carteira própria).
2. WHEN o Representante cadastra um novo cliente/prospect, THE Portal_Representante SHALL criar automaticamente o registro correspondente no cadastro de Cliente do Sistema_Vendas com os campos obrigatórios para faturamento (razão social, CPF/CNPJ, endereço).
3. WHEN o Representante cadastra um cliente, THE Portal_Representante SHALL vincular automaticamente o cliente ao vendedorId do representante (campo de vendedor responsável).
4. THE Portal_Representante SHALL validar CPF/CNPJ antes de persistir o cadastro e rejeitar valores duplicados dentro da mesma empresa.
5. IF o Representante tentar cadastrar um cliente cujo CPF/CNPJ já existe na empresa, THEN THE Portal_Representante SHALL informar que o cliente já existe e oferecer vinculação à carteira do representante (mediante aprovação do ERP_Admin quando o cliente pertence a outro vendedor).
6. THE Portal_Representante SHALL permitir ao Representante editar dados complementares dos clientes de sua carteira (telefone, e-mail, endereço), propagando as alterações para o cadastro central do Sistema_Vendas.
7. WHEN o Representante edita campos fiscais obrigatórios (razão social, CPF/CNPJ, inscrição estadual), THE Portal_Representante SHALL submeter a alteração para aprovação do ERP_Admin antes de efetivar.

---

### Requisito 6: Configuração Administrativa do Portal

**User Story:** Como um administrador do ERP, eu quero gerenciar os representantes e suas configurações de comissão, para que eu tenha controle total sobre quem acessa o portal e como são remunerados.

#### Critérios de Aceite

1. THE ERP_Admin SHALL poder criar, editar, ativar e inativar contas de representante no portal diretamente pela interface administrativa do ERP.
2. WHEN o ERP_Admin cria uma conta de representante, THE Portal_Representante SHALL exigir a vinculação a um cadastro de Vendedor existente (relação 1:1 entre conta do portal e vendedor).
3. THE ERP_Admin SHALL poder configurar o tipo de comissão para cada representante: percentual fixo sobre preço de venda OU variável conforme tabela de preço/produto.
4. WHEN o tipo de comissão é "variável", THE ERP_Admin SHALL poder definir percentuais diferenciados por produto, categoria de produto ou tabela de preço.
5. THE ERP_Admin SHALL poder visualizar o histórico de solicitações de orçamento e pedidos de qualquer representante.
6. WHEN uma Solicitacao_Orcamento é recebida, THE ERP_Admin SHALL poder processá-la pelo motor de orçamento gráfico existente e devolver o preço de venda ao representante.
7. THE ERP_Admin SHALL poder definir se o creditamento da comissão ocorre na entrega, no faturamento ou na confirmação de pagamento.

---

### Requisito 7: Segurança e Isolamento de Dados

**User Story:** Como um administrador do ERP, eu quero garantir que cada representante veja apenas seus próprios dados, para que informações comerciais sensíveis não vazem entre representantes ou para terceiros.

#### Critérios de Aceite

1. THE Portal_Representante SHALL filtrar todas as queries por empresaId E vendedorId, garantindo que um representante acesse exclusivamente pedidos, orçamentos, clientes e comissões vinculados a si próprio.
2. THE Portal_Representante SHALL utilizar um sistema de autenticação separado do login interno do ERP (tabela/model dedicado para credenciais de representante, não compartilhando a tabela Usuario).
3. IF um token JWT expirar ou for revogado, THEN THE Portal_Representante SHALL retornar HTTP 401 e redirecionar para a tela de login.
4. THE Portal_Representante SHALL registrar em log de auditoria cada login, tentativa de acesso negado e ação relevante (criação de solicitação, cadastro de cliente).
5. THE Portal_Representante SHALL impedir que o Representante acesse rotas administrativas do ERP, endpoints de cálculo de custo, ou qualquer informação de margem/markup.
6. WHILE o Representante estiver autenticado, THE Portal_Representante SHALL renovar o token automaticamente antes da expiração, mantendo a sessão ativa sem necessidade de relogin durante o uso contínuo.

---

### Requisito 8: Notificações ao Representante

**User Story:** Como um representante comercial, eu quero ser notificado sobre atualizações relevantes nos meus pedidos, para que eu possa agir proativamente com meus clientes.

#### Critérios de Aceite

1. WHEN o preço de venda de uma Solicitacao_Orcamento é calculado e disponibilizado, THE Portal_Representante SHALL notificar o Representante na interface (badge/indicador visual).
2. WHEN um pedido do Representante muda de etapa no pipeline, THE Portal_Representante SHALL registrar uma notificação na central de notificações do portal.
3. WHEN uma comissão é creditada (status muda para "Realizada"), THE Portal_Representante SHALL notificar o Representante.
4. THE Portal_Representante SHALL manter um histórico de notificações com indicador de lida/não-lida.
5. WHERE o ERP_Admin habilitar notificações por e-mail para o representante, THE Portal_Representante SHALL enviar e-mail nas transições de status críticas (preço disponível, pedido expedido, comissão creditada).
