# Requirements Document

## Introdução

O painel de Programação por Centro (PCP) exibe centros de produção organizados em abas por tipo de máquina (Cortadeira, Impressão, Acabamento, Todos). Atualmente a listagem dos centros dentro de cada aba segue ordem alfabética fixa pelo campo `codigo`. Esta feature permite ao usuário reordenar manualmente os centros de produção dentro de cada aba, persistindo a configuração por empresa no banco de dados.

## Glossário

- **Painel_PCP**: Tela de Programação por Centro no frontend que exibe centros de produção agrupados em abas por tipoMaquina
- **Centro_Producao**: Entidade que representa uma máquina, setor ou linha de produção, identificada por código único por empresa
- **Aba**: Agrupamento visual dos centros por categoria (Cortadeira, Impressão, Acabamento, Todos)
- **Posicao**: Campo numérico inteiro no modelo CentroProducao que determina a ordem de exibição do centro dentro da sua aba
- **API_Ordenacao**: Endpoint PATCH /api/centros-producao/ordenar responsável por persistir a nova sequência de posições
- **Empresa**: Entidade de contexto do usuário autenticado que isola dados entre organizações

## Requisitos

### Requisito 1: Campo de posição no modelo de dados

**User Story:** Como administrador do sistema, eu quero que cada centro de produção tenha um campo de posição numérica, para que a ordem de exibição possa ser configurada e persistida.

#### Critérios de Aceitação

1. THE Centro_Producao SHALL possuir um campo Posicao do tipo inteiro com valor padrão 0
2. WHEN um novo Centro_Producao é criado, THE Sistema SHALL atribuir ao campo Posicao o valor correspondente à última posição existente para a mesma empresa acrescido de 1
3. THE Centro_Producao SHALL manter o campo Posicao isolado por Empresa, de forma que empresas distintas possuam sequências de posição independentes

### Requisito 2: Endpoint de reordenação

**User Story:** Como desenvolvedor frontend, eu quero um endpoint que receba a nova ordem dos centros, para que a reordenação feita pelo usuário seja salva no banco.

#### Critérios de Aceitação

1. WHEN uma requisição PATCH é enviada para a API_Ordenacao com uma lista de objetos contendo id e posicao, THE API_Ordenacao SHALL atualizar o campo Posicao de cada Centro_Producao informado
2. THE API_Ordenacao SHALL validar que todos os ids pertencem à mesma Empresa do usuário autenticado
3. IF algum id informado na requisição não pertencer à Empresa do usuário, THEN THE API_Ordenacao SHALL retornar erro HTTP 403 sem modificar nenhum registro
4. IF a lista de ordenação estiver vazia ou com formato inválido, THEN THE API_Ordenacao SHALL retornar erro HTTP 400 com mensagem descritiva
5. THE API_Ordenacao SHALL exigir autenticação e permissão do módulo PCP

### Requisito 3: Listagem ordenada dos centros

**User Story:** Como usuário do Painel PCP, eu quero que os centros apareçam na ordem que configurei, para que eu visualize as máquinas na sequência de prioridade do meu processo produtivo.

#### Critérios de Aceitação

1. WHEN o Painel_PCP solicita a lista de centros de produção, THE API SHALL retornar os centros ordenados pelo campo Posicao em ordem crescente
2. WHEN dois centros possuem o mesmo valor de Posicao, THE API SHALL desempatar ordenando pelo campo codigo em ordem alfabética crescente
3. THE Painel_PCP SHALL exibir os centros dentro de cada Aba respeitando a ordenação retornada pela API

### Requisito 4: Interface de drag-and-drop para reordenação

**User Story:** Como usuário do Painel PCP, eu quero arrastar e soltar os centros para reordená-los visualmente, para que a configuração de ordem seja intuitiva.

#### Critérios de Aceitação

1. THE Painel_PCP SHALL exibir um ícone de arraste (grip) ao lado de cada centro dentro da aba ativa
2. WHEN o usuário arrasta um centro para uma nova posição dentro da mesma aba, THE Painel_PCP SHALL reposicionar visualmente o centro na lista em tempo real
3. WHEN o usuário solta o centro na nova posição, THE Painel_PCP SHALL enviar a nova sequência de posições para a API_Ordenacao
4. WHILE a requisição de reordenação está em andamento, THE Painel_PCP SHALL exibir indicação visual de salvamento em progresso
5. IF a requisição de reordenação falhar, THEN THE Painel_PCP SHALL reverter a lista para a ordem anterior e exibir notificação de erro ao usuário

### Requisito 5: Persistência entre sessões

**User Story:** Como usuário do Painel PCP, eu quero que a ordem configurada persista entre sessões, para que eu não precise reordenar os centros toda vez que acesso o sistema.

#### Critérios de Aceitação

1. WHEN o usuário fecha e reabre o Painel_PCP, THE Painel_PCP SHALL exibir os centros na última ordem salva
2. WHEN outro usuário da mesma Empresa acessa o Painel_PCP, THE Painel_PCP SHALL exibir os centros na ordem configurada para aquela Empresa
3. THE Sistema SHALL manter a ordem configurada inalterada até que um usuário da mesma Empresa execute uma nova reordenação

### Requisito 6: Centros novos no final da lista

**User Story:** Como administrador, eu quero que centros recém-cadastrados apareçam no final da lista, para que a ordem existente dos demais centros não seja afetada.

#### Critérios de Aceitação

1. WHEN um novo Centro_Producao é criado, THE Sistema SHALL atribuir ao campo Posicao um valor maior que todas as posições existentes para a mesma Empresa
2. THE Sistema SHALL garantir que centros existentes mantêm suas posições inalteradas quando um novo centro é adicionado
