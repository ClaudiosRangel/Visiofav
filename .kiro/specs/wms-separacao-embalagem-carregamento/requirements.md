# Requirements Document

## Introduction

Fluxo completo de saída de mercadorias no WMS (Warehouse Management System), cobrindo desde o agrupamento de pedidos de venda em ondas de separação até a expedição final com carregamento em veículo. O fluxo integra-se ao módulo de Vendas existente (pedidos com status EM_SEPARACAO) e ao sistema de estoque com saldo por endereço. As etapas são: criação de onda → separação (picking) → conferência de saída → embalagem (packing) → carregamento (loading), com dashboard de acompanhamento em tempo real.

## Glossary

- **Sistema_WMS**: Backend Fastify que expõe as rotas REST para o fluxo de saída de mercadorias
- **Frontend_WMS**: Aplicação Next.js com Mantine UI que consome as rotas do Sistema_WMS
- **Onda_Separacao**: Agrupamento de um ou mais pedidos de venda para separação conjunta no armazém
- **Ordem_Separacao**: Conjunto de itens atribuídos a um funcionário para coleta no armazém, gerado a partir de uma Onda_Separacao
- **Item_Separacao**: Linha individual de uma Ordem_Separacao contendo produto, quantidade, endereço de origem e endereço de destino
- **Conferencia_Saida**: Verificação dos itens separados contra os itens do pedido de venda original
- **Volume**: Unidade de embalagem (caixa, palete, fardo) com peso e dimensões, vinculada a um pedido
- **Carregamento**: Registro de vinculação de volumes a um veículo/doca com sequência de carga
- **SaldoEndereco**: Registro de quantidade de um produto em um endereço específico do armazém
- **Estoque**: Registro consolidado de quantidade e reserva de um produto por empresa
- **PedidoVenda**: Pedido de venda existente no sistema com status EM_SEPARACAO quando integrado ao WMS
- **VendaEfetivada**: Registro de venda efetivada vinculado ao PedidoVenda
- **Funcionario**: Operador do armazém que executa tarefas de separação
- **Doca**: Local físico de expedição onde os volumes são preparados para carregamento
- **Endereco**: Posição de armazenagem no armazém (rua, prédio, nível, apto)
- **FIFO**: First In, First Out — regra de seleção de estoque onde o lote mais antigo é separado primeiro
- **Webhook**: Notificação HTTP enviada a sistemas externos quando eventos ocorrem no WMS

## Requirements

### Requirement 1: Criar Onda de Separação

**User Story:** As a operador de expedição, I want to agrupar pedidos de venda em uma onda de separação, so that posso organizar e priorizar a coleta de múltiplos pedidos simultaneamente.

#### Acceptance Criteria

1. WHEN o operador seleciona um ou mais pedidos de venda com status EM_SEPARACAO, THE Sistema_WMS SHALL criar uma Onda_Separacao com número sequencial, prioridade configurável (ALTA, MEDIA, BAIXA) e status PENDENTE
2. THE Sistema_WMS SHALL validar que todos os pedidos selecionados pertencem à mesma empresa do operador e possuem status EM_SEPARACAO
3. IF um pedido de venda selecionado não possuir status EM_SEPARACAO, THEN THE Sistema_WMS SHALL rejeitar a criação da onda e retornar mensagem indicando os pedidos inválidos
4. IF um pedido de venda já estiver vinculado a outra Onda_Separacao ativa (status diferente de CANCELADA e CONCLUIDA), THEN THE Sistema_WMS SHALL rejeitar a inclusão desse pedido e retornar mensagem indicando a onda existente
5. WHEN a Onda_Separacao é criada, THE Sistema_WMS SHALL registrar a data/hora de criação e o identificador do operador que a criou

### Requirement 2: Gerar Ordens e Itens de Separação

**User Story:** As a operador de expedição, I want to gerar automaticamente as ordens de separação ao iniciar uma onda, so that os funcionários recebam listas de coleta com endereços de origem e destino.

#### Acceptance Criteria

1. WHEN o operador inicia uma Onda_Separacao (altera status para EM_SEPARACAO), THE Sistema_WMS SHALL gerar Item_Separacao para cada combinação de produto e quantidade dos pedidos da onda
2. WHEN o Sistema_WMS gera os itens de separação, THE Sistema_WMS SHALL selecionar os endereços de origem usando regra FIFO baseada na data de entrada do lote no SaldoEndereco
3. WHEN o Sistema_WMS seleciona endereços de origem, THE Sistema_WMS SHALL distribuir a quantidade solicitada entre múltiplos endereços caso um único endereço não possua saldo suficiente
4. THE Sistema_WMS SHALL definir o endereço de destino de cada Item_Separacao como a Doca de expedição configurada para a onda
5. IF o saldo total disponível (não reservado) de um produto for insuficiente para atender a quantidade solicitada, THEN THE Sistema_WMS SHALL gerar itens de separação para a quantidade disponível e registrar a quantidade faltante como pendência
6. WHEN os itens de separação são gerados, THE Sistema_WMS SHALL agrupar os itens em Ordem_Separacao atribuíveis a funcionários

### Requirement 3: Reservar Estoque na Criação da Onda

**User Story:** As a gestor de armazém, I want to reservar o estoque ao iniciar a onda de separação, so that outros processos não consumam o mesmo estoque simultaneamente.

#### Acceptance Criteria

1. WHEN a Onda_Separacao é iniciada, THE Sistema_WMS SHALL incrementar o campo reservado no registro Estoque para cada produto e quantidade incluídos na onda
2. THE Sistema_WMS SHALL garantir que a reserva ocorra dentro de uma transação atômica junto com a geração dos itens de separação
3. IF a quantidade disponível (quantidade - reservado) no Estoque for menor que a quantidade solicitada no momento da reserva, THEN THE Sistema_WMS SHALL reservar apenas a quantidade disponível e registrar a diferença como falta
4. WHEN uma Onda_Separacao é cancelada, THE Sistema_WMS SHALL decrementar o campo reservado no Estoque para cada produto e quantidade que havia sido reservada

### Requirement 4: Atribuir Funcionários à Onda

**User Story:** As a operador de expedição, I want to atribuir funcionários a uma onda de separação, so that cada funcionário saiba quais itens deve coletar.

#### Acceptance Criteria

1. WHEN o operador atribui um ou mais funcionários a uma Onda_Separacao, THE Sistema_WMS SHALL vincular cada funcionário a uma Ordem_Separacao da onda
2. THE Sistema_WMS SHALL validar que os funcionários atribuídos pertencem ao mesmo centro de distribuição da onda
3. IF um funcionário já estiver atribuído a outra Onda_Separacao com status EM_SEPARACAO, THEN THE Sistema_WMS SHALL retornar aviso informando a onda em que o funcionário está alocado
4. WHEN funcionários são atribuídos, THE Sistema_WMS SHALL distribuir os itens de separação entre as ordens de separação dos funcionários de forma balanceada por quantidade de itens

### Requirement 5: Executar Separação (Picking)

**User Story:** As a funcionário de armazém, I want to confirmar a coleta de cada item da minha ordem de separação, so that o sistema atualize o estoque e registre o progresso.

#### Acceptance Criteria

1. WHEN o funcionário confirma a separação de um Item_Separacao, THE Sistema_WMS SHALL registrar a quantidade separada, a data/hora da confirmação e o identificador do funcionário
2. WHEN um Item_Separacao é confirmado com a quantidade total, THE Sistema_WMS SHALL atualizar o status do item para SEPARADO
3. WHEN um Item_Separacao é confirmado, THE Sistema_WMS SHALL decrementar o saldo no SaldoEndereco do endereço de origem pela quantidade separada
4. WHEN um Item_Separacao é confirmado, THE Sistema_WMS SHALL decrementar o campo reservado e o campo quantidade no registro Estoque pela quantidade separada
5. WHEN o funcionário confirma quantidade menor que a solicitada, THE Sistema_WMS SHALL registrar a divergência com motivo (PRODUTO_NAO_ENCONTRADO, QUANTIDADE_INSUFICIENTE, AVARIA) e atualizar o status do item para SEPARADO_PARCIAL
6. IF o endereço de origem ficar com saldo zero após a separação, THEN THE Sistema_WMS SHALL atualizar o estado do Endereco para LIVRE

### Requirement 6: Acompanhar Progresso da Onda em Tempo Real

**User Story:** As a operador de expedição, I want to acompanhar o progresso de separação de cada onda em tempo real, so that posso identificar gargalos e tomar ações corretivas.

#### Acceptance Criteria

1. WHEN o operador consulta uma Onda_Separacao, THE Sistema_WMS SHALL retornar o percentual de itens separados (total separados / total itens × 100), a quantidade de itens pendentes e a quantidade de divergências
2. WHEN o operador consulta a lista de ondas, THE Frontend_WMS SHALL exibir barra de progresso com percentual de conclusão para cada onda
3. WHEN todos os itens de uma Onda_Separacao atingem status SEPARADO ou SEPARADO_PARCIAL, THE Sistema_WMS SHALL atualizar o status da onda para SEPARADA
4. THE Frontend_WMS SHALL exibir indicadores visuais diferenciados para itens pendentes, separados e com divergência

### Requirement 7: Conferência de Saída

**User Story:** As a conferente de expedição, I want to conferir os itens separados contra o pedido de venda, so that posso garantir que a quantidade e os produtos estão corretos antes da embalagem.

#### Acceptance Criteria

1. WHEN o conferente inicia a conferência de uma Onda_Separacao com status SEPARADA, THE Sistema_WMS SHALL criar um registro de Conferencia_Saida com status EM_CONFERENCIA
2. WHEN o conferente registra a conferência de um item, THE Sistema_WMS SHALL comparar a quantidade conferida com a quantidade separada e registrar o resultado (CONFORME, DIVERGENTE)
3. IF a quantidade conferida divergir da quantidade separada, THEN THE Sistema_WMS SHALL registrar a divergência com tipo (FALTA, EXCESSO, PRODUTO_ERRADO) e observação
4. WHEN todos os itens da conferência são registrados, THE Sistema_WMS SHALL permitir que o conferente aprove (status APROVADA) ou rejeite (status REJEITADA) a conferência
5. IF a conferência for rejeitada, THEN THE Sistema_WMS SHALL retornar a Onda_Separacao ao status EM_SEPARACAO para correção dos itens divergentes
6. WHEN a conferência é aprovada, THE Sistema_WMS SHALL atualizar o status da Onda_Separacao para CONFERIDA

### Requirement 8: Embalagem (Packing)

**User Story:** As a operador de embalagem, I want to registrar os volumes embalados com peso e dimensões, so that posso rastrear cada volume e gerar etiquetas para expedição.

#### Acceptance Criteria

1. WHEN o operador inicia a embalagem de uma Onda_Separacao com status CONFERIDA, THE Sistema_WMS SHALL permitir a criação de registros de Volume com tipo (CAIXA, PALETE, FARDO), peso em kg e dimensões (comprimento, largura, altura em cm)
2. WHEN o operador cria um Volume, THE Sistema_WMS SHALL gerar um código de identificação único sequencial para o volume e vincular o volume ao pedido de venda e ao cliente
3. WHEN o operador vincula itens a um Volume, THE Sistema_WMS SHALL validar que os itens pertencem à mesma Onda_Separacao e que a quantidade vinculada não excede a quantidade separada
4. THE Sistema_WMS SHALL fornecer endpoint para geração de etiqueta de volume contendo: código do volume, cliente, pedido, peso e quantidade de itens
5. WHEN todos os itens separados da onda estão vinculados a volumes, THE Sistema_WMS SHALL atualizar o status da Onda_Separacao para EMBALADA
6. IF o operador tentar embalar itens de uma onda sem status CONFERIDA, THEN THE Sistema_WMS SHALL rejeitar a operação e retornar mensagem informando o status atual da onda

### Requirement 9: Carregamento (Loading)

**User Story:** As a operador de expedição, I want to registrar o carregamento dos volumes em um veículo, so that posso controlar a sequência de carga e confirmar a expedição.

#### Acceptance Criteria

1. WHEN o operador cria um Carregamento, THE Sistema_WMS SHALL vincular o carregamento a uma Doca, a um veículo (placa) e opcionalmente a uma transportadora
2. WHEN o operador adiciona volumes ao Carregamento, THE Sistema_WMS SHALL registrar a sequência de carregamento de cada volume (último a carregar = primeiro a descarregar)
3. WHEN o operador confirma o carregamento de um Volume, THE Sistema_WMS SHALL atualizar o status do volume para CARREGADO e registrar a data/hora de carregamento
4. THE Sistema_WMS SHALL validar que todos os volumes adicionados ao carregamento possuem status EMBALADO antes de permitir a confirmação
5. WHEN todos os volumes de um Carregamento são confirmados, THE Sistema_WMS SHALL atualizar o status do Carregamento para CONCLUIDO
6. WHEN o Carregamento é concluído, THE Sistema_WMS SHALL atualizar o status de cada PedidoVenda vinculado para FATURADO e o statusEntrega da VendaEfetivada para EM_TRANSITO
7. WHEN o Carregamento é concluído, THE Sistema_WMS SHALL disparar o webhook com evento 'expedicao.carregada' contendo os identificadores do carregamento, dos pedidos e dos volumes

### Requirement 10: Dashboard de Expedição

**User Story:** As a gestor de armazém, I want to visualizar um dashboard com indicadores de expedição, so that posso monitorar o fluxo de saída e a produtividade da equipe.

#### Acceptance Criteria

1. THE Frontend_WMS SHALL exibir cards com contadores de pedidos por status: pendentes (EM_SEPARACAO), em separação, separados, conferidos, embalados e carregados
2. THE Frontend_WMS SHALL exibir lista de ondas ativas com número, quantidade de pedidos, quantidade de itens, barra de progresso, funcionários atribuídos e status
3. THE Frontend_WMS SHALL exibir indicador de produtividade por funcionário contendo: nome, quantidade de itens separados no dia e tempo médio de separação por item
4. WHEN o operador acessa a aba "Montagem de Carga", THE Frontend_WMS SHALL exibir lista de ondas com status EMBALADA disponíveis para carregamento, com cliente, quantidade de volumes e peso total
5. WHEN o operador acessa a aba "Mapa de Carregamento", THE Frontend_WMS SHALL exibir os carregamentos ativos com veículo, doca, volumes carregados/total e progresso

### Requirement 11: Modelo de Dados para Separação

**User Story:** As a desenvolvedor, I want to ter modelos de dados Prisma para onda de separação, ordem de separação e item de separação, so that posso persistir e consultar os dados do fluxo de separação.

#### Acceptance Criteria

1. THE Sistema_WMS SHALL definir o modelo OndaSeparacao no schema Prisma com campos: id (UUID), empresaId, numero (sequencial por empresa), prioridade (ALTA, MEDIA, BAIXA), status (PENDENTE, EM_SEPARACAO, SEPARADA, CONFERIDA, EMBALADA, CONCLUIDA, CANCELADA), docaId, criadoPorId, criadoEm e atualizadoEm
2. THE Sistema_WMS SHALL definir o modelo OrdemSeparacao no schema Prisma com campos: id (UUID), ondaSeparacaoId, funcionarioId, status (PENDENTE, EM_SEPARACAO, CONCLUIDA) e criadoEm
3. THE Sistema_WMS SHALL definir o modelo ItemSeparacao no schema Prisma com campos: id (UUID), ordemSeparacaoId, pedidoVendaId, produtoId, enderecoOrigemId, enderecoDestinoId, quantidadeSolicitada, quantidadeSeparada, status (PENDENTE, SEPARADO, SEPARADO_PARCIAL), motivoDivergencia, separadoEm
4. THE Sistema_WMS SHALL definir a relação entre OndaSeparacao e PedidoVenda como muitos-para-muitos através de tabela intermediária OndaPedido
5. THE Sistema_WMS SHALL definir constraint unique em OndaSeparacao para (empresaId, numero)

### Requirement 12: Modelo de Dados para Embalagem

**User Story:** As a desenvolvedor, I want to ter modelo de dados Prisma para volumes de embalagem, so that posso persistir e consultar os dados de embalagem.

#### Acceptance Criteria

1. THE Sistema_WMS SHALL definir o modelo Volume no schema Prisma com campos: id (UUID), ondaSeparacaoId, pedidoVendaId, codigo (sequencial), tipo (CAIXA, PALETE, FARDO), pesoKg (Decimal), comprimentoCm (Decimal), larguraCm (Decimal), alturaCm (Decimal), status (EMBALADO, CARREGADO), criadoEm
2. THE Sistema_WMS SHALL definir o modelo ItemVolume no schema Prisma com campos: id (UUID), volumeId, itemSeparacaoId, quantidade (Decimal)
3. THE Sistema_WMS SHALL definir constraint unique em Volume para (ondaSeparacaoId, codigo)

### Requirement 13: Modelo de Dados para Carregamento

**User Story:** As a desenvolvedor, I want to ter modelo de dados Prisma para carregamento, so that posso persistir e consultar os dados de carregamento e expedição.

#### Acceptance Criteria

1. THE Sistema_WMS SHALL definir o modelo Carregamento no schema Prisma com campos: id (UUID), empresaId, docaId, veiculoPlaca (VarChar 10), transportadoraId (opcional), status (PENDENTE, EM_CARREGAMENTO, CONCLUIDO), criadoEm, concluidoEm
2. THE Sistema_WMS SHALL definir o modelo CarregamentoVolume no schema Prisma com campos: id (UUID), carregamentoId, volumeId, sequencia (Int), carregadoEm (DateTime opcional)
3. THE Sistema_WMS SHALL definir constraint unique em CarregamentoVolume para (carregamentoId, volumeId)

### Requirement 14: Conferência de Saída — Modelo de Dados

**User Story:** As a desenvolvedor, I want to ter modelo de dados Prisma para conferência de saída, so that posso persistir e consultar os dados de conferência.

#### Acceptance Criteria

1. THE Sistema_WMS SHALL definir o modelo ConferenciaSaida no schema Prisma com campos: id (UUID), ondaSeparacaoId, conferenteId (funcionarioId), status (EM_CONFERENCIA, APROVADA, REJEITADA), criadoEm, concluidaEm
2. THE Sistema_WMS SHALL definir o modelo ItemConferenciaSaida no schema Prisma com campos: id (UUID), conferenciaSaidaId, itemSeparacaoId, quantidadeConferida (Decimal), resultado (CONFORME, DIVERGENTE), tipoDivergencia (FALTA, EXCESSO, PRODUTO_ERRADO, nullable), observacao (Text, nullable)

### Requirement 15: Rotas REST para Onda de Separação

**User Story:** As a desenvolvedor frontend, I want to ter endpoints REST para gerenciar ondas de separação, so that posso integrar o frontend com o backend.

#### Acceptance Criteria

1. THE Sistema_WMS SHALL expor rota GET /api/ondas-separacao que retorna lista paginada de ondas com filtros por status, prioridade e data, incluindo contadores de progresso
2. THE Sistema_WMS SHALL expor rota POST /api/ondas-separacao que cria uma nova onda recebendo array de pedidoVendaIds, prioridade e docaId
3. THE Sistema_WMS SHALL expor rota GET /api/ondas-separacao/:id que retorna detalhes da onda com ordens de separação, itens, funcionários e progresso
4. THE Sistema_WMS SHALL expor rota PATCH /api/ondas-separacao/:id/iniciar que inicia a onda (gera itens, reserva estoque, altera status para EM_SEPARACAO)
5. THE Sistema_WMS SHALL expor rota PATCH /api/ondas-separacao/:id/cancelar que cancela a onda e libera as reservas de estoque
6. THE Sistema_WMS SHALL proteger todas as rotas de onda de separação com autenticação JWT e moduloGuard WMS

### Requirement 16: Rotas REST para Separação e Conferência

**User Story:** As a desenvolvedor frontend, I want to ter endpoints REST para operações de separação e conferência, so that posso integrar as telas de picking e conferência.

#### Acceptance Criteria

1. THE Sistema_WMS SHALL expor rota PATCH /api/itens-separacao/:id/confirmar que recebe quantidadeSeparada e motivoDivergencia opcional, atualiza saldo e status do item
2. THE Sistema_WMS SHALL expor rota POST /api/ondas-separacao/:id/conferencia que cria uma conferência de saída para a onda
3. THE Sistema_WMS SHALL expor rota PATCH /api/conferencias-saida/:id/itens/:itemId que registra a conferência de um item com quantidadeConferida e resultado
4. THE Sistema_WMS SHALL expor rota PATCH /api/conferencias-saida/:id/aprovar que aprova a conferência e atualiza o status da onda para CONFERIDA
5. THE Sistema_WMS SHALL expor rota PATCH /api/conferencias-saida/:id/rejeitar que rejeita a conferência e retorna a onda ao status EM_SEPARACAO

### Requirement 17: Rotas REST para Embalagem e Carregamento

**User Story:** As a desenvolvedor frontend, I want to ter endpoints REST para operações de embalagem e carregamento, so that posso integrar as telas de packing e loading.

#### Acceptance Criteria

1. THE Sistema_WMS SHALL expor rota POST /api/ondas-separacao/:id/volumes que cria um volume vinculado à onda com tipo, peso e dimensões
2. THE Sistema_WMS SHALL expor rota POST /api/volumes/:id/itens que vincula itens separados ao volume com quantidade
3. THE Sistema_WMS SHALL expor rota GET /api/volumes/:id/etiqueta que retorna dados formatados para impressão de etiqueta do volume
4. THE Sistema_WMS SHALL expor rota POST /api/carregamentos que cria um carregamento com docaId, veiculoPlaca e transportadoraId opcional
5. THE Sistema_WMS SHALL expor rota POST /api/carregamentos/:id/volumes que adiciona volumes ao carregamento com sequência
6. THE Sistema_WMS SHALL expor rota PATCH /api/carregamentos/:id/confirmar que confirma o carregamento, atualiza status dos pedidos para FATURADO e dispara webhook 'expedicao.carregada'

### Requirement 18: Frontend — Página de Picking com Dados Reais

**User Story:** As a operador de expedição, I want to que a página de Picking exiba dados reais do backend, so that posso gerenciar ondas de separação com informações atualizadas.

#### Acceptance Criteria

1. WHEN o operador acessa a página de Picking, THE Frontend_WMS SHALL buscar dados de ondas de separação via GET /api/ondas-separacao e exibir na tabela existente substituindo os dados mockados
2. WHEN o operador clica em "Nova Onda", THE Frontend_WMS SHALL exibir modal com lista de pedidos de venda com status EM_SEPARACAO para seleção, campo de prioridade e seleção de doca
3. WHEN o operador clica em "Iniciar" em uma onda PENDENTE, THE Frontend_WMS SHALL chamar PATCH /api/ondas-separacao/:id/iniciar e atualizar a lista
4. THE Frontend_WMS SHALL exibir os cards de estatísticas (Ondas Ativas, Itens Pendentes, Separados Hoje, Divergências) com dados calculados a partir das respostas da API
5. WHEN o operador clica em "Acompanhar" em uma onda EM_SEPARACAO, THE Frontend_WMS SHALL navegar para página de detalhe da onda com lista de itens e progresso por funcionário

### Requirement 19: Frontend — Página de Expedição com Dados Reais

**User Story:** As a operador de expedição, I want to que a página de Expedição exiba dados reais do backend, so that posso gerenciar conferência, embalagem e carregamento com informações atualizadas.

#### Acceptance Criteria

1. WHEN o operador acessa a aba "Separação" da página de Expedição, THE Frontend_WMS SHALL buscar dados via GET /api/ondas-separacao com filtro de status e exibir na tabela existente substituindo os dados mockados
2. WHEN o operador acessa a aba "Montagem de Carga", THE Frontend_WMS SHALL exibir ondas com status EMBALADA com opção de criar carregamento e adicionar volumes
3. WHEN o operador acessa a aba "Mapa de Carregamento", THE Frontend_WMS SHALL exibir carregamentos ativos via GET /api/carregamentos com progresso de volumes carregados
4. WHEN o operador clica em "Montar Carga" em uma onda SEPARADA, THE Frontend_WMS SHALL exibir fluxo de conferência seguido de embalagem
5. THE Frontend_WMS SHALL utilizar TanStack Query para gerenciamento de cache e revalidação automática dos dados em todas as consultas
