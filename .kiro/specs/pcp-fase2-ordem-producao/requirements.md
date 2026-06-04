# Documento de Requisitos — Fase 2: Ordem de Produção

## Introdução

Este documento especifica os requisitos para o módulo de Ordem de Produção (OP) no backend unificado VisioFab.Wms.Back. A Ordem de Produção é o documento central do PCP que formaliza a intenção de fabricar um produto, definindo quantidade, prazo, materiais necessários e sequência de operações. Este módulo depende dos cadastros da Fase 1 (Centros, Estrutura, Roteiros) e é pré-requisito para a Fase 3 (Integração WMS).

## Glossário

- **Sistema**: O backend VisioFab.Wms.Back (Fastify + Prisma + PostgreSQL)
- **Empresa**: Entidade multi-tenant
- **OrdemProducao (OP)**: Documento que autoriza a fabricação de um produto em determinada quantidade e prazo
- **ItemOrdemProducao**: Material necessário para a OP, derivado da explosão da BOM com ajuste de quantidade
- **EtapaOrdemProducao**: Operação a ser executada na OP, derivada do roteiro com tempos calculados para a quantidade da OP
- **EstruturaProduto**: BOM do produto (Fase 1)
- **RoteiroProducao**: Sequência de operações do produto (Fase 1)
- **PedidoVenda**: Pedido de venda existente no sistema que pode originar uma OP
- **Produto**: Produto acabado a ser fabricado
- **StatusOP**: Ciclo de vida da OP: RASCUNHO → PLANEJADA → PROGRAMADA → LIBERADA → EM_PRODUCAO → CONCLUIDA | CANCELADA
- **Prioridade**: Nível de urgência da OP: BAIXA, NORMAL, ALTA, URGENTE

## Requisitos

### Requisito 1: Criação de Ordem de Produção

**User Story:** Como planejador de produção, quero criar ordens de produção para formalizar a fabricação de produtos, para que a fábrica saiba o que produzir, quanto e quando.

#### Critérios de Aceitação

1. THE Sistema SHALL permitir criar uma OrdemProducao com os campos: produtoId (obrigatório, referência a Produto com classificacaoPcp = PRODUTO_ACABADO ou INTERMEDIARIO), quantidade (decimal > 0, obrigatório), unidadeMedida (obrigatório), dataEmissao (date, default hoje), dataEntregaPrevista (date, obrigatório), prioridade (enum: BAIXA, NORMAL, ALTA, URGENTE — default NORMAL), pedidoVendaId (opcional — vínculo ao pedido que originou a OP), clienteId (opcional — cliente final), lote (opcional, máximo 50 caracteres), cor (opcional — referência a TipoCor), observacoes (opcional, texto livre)
2. WHEN uma OrdemProducao é criada, THE Sistema SHALL atribuir um número sequencial único por empresa (campo `numero`, inteiro auto-incremento por empresa)
3. WHEN uma OrdemProducao é criada, THE Sistema SHALL definir o status inicial como `RASCUNHO`
4. THE Sistema SHALL validar que o produtoId referenciado possui uma EstruturaProduto com status ATIVA antes de permitir a criação
5. IF o produtoId não possuir EstruturaProduto ativa, THEN THE Sistema SHALL retornar erro 400 com mensagem "Produto não possui estrutura (BOM) ativa cadastrada"
6. THE Sistema SHALL filtrar todos os resultados pelo empresaId do usuário autenticado

---

### Requisito 2: Explosão Automática de Materiais (BOM)

**User Story:** Como planejador de produção, quero que ao criar uma OP o sistema calcule automaticamente os materiais necessários com base na BOM, para que eu não precise calcular manualmente.

#### Critérios de Aceitação

1. WHEN uma OrdemProducao é criada ou quando o usuário solicita a explosão, THE Sistema SHALL gerar os registros de ItemOrdemProducao com base na EstruturaProduto ativa do produto
2. THE Sistema SHALL calcular a quantidade necessária de cada material como: `(quantidadeOP / rendimentoBOM) × quantidadeItemEstrutura × (1 + percentualPerda / 100)`
3. THE Sistema SHALL explodir a estrutura em todos os níveis (multinível), listando apenas os componentes folha (MATERIA_PRIMA ou itens sem estrutura própria)
4. EACH ItemOrdemProducao SHALL conter: produtoComponenteId, descricaoProduto, quantidade calculada, unidadeMedida, quantidadeLiberada (default 0), quantidadeConsumida (default 0), e status (PENDENTE)
5. THE Sistema SHALL permitir que o usuário ajuste manualmente a quantidade de qualquer ItemOrdemProducao após a explosão
6. THE Sistema SHALL permitir adicionar itens extras (não previstos na BOM) manualmente
7. THE Sistema SHALL recalcular os materiais quando a quantidade da OP for alterada (com confirmação do usuário)

---

### Requisito 3: Geração Automática de Etapas (Roteiro)

**User Story:** Como planejador de produção, quero que ao criar uma OP o sistema gere automaticamente as etapas de produção com base no roteiro, para que o chão de fábrica saiba a sequência de operações.

#### Critérios de Aceitação

1. WHEN uma OrdemProducao é criada ou quando o usuário solicita a geração de etapas, THE Sistema SHALL gerar os registros de EtapaOrdemProducao com base no RoteiroProducao ativo do produto
2. EACH EtapaOrdemProducao SHALL conter: sequencia, descricao, centroProducaoId, tempoSetupMinutos (copiado do roteiro), tempoOperacaoCalculado (tempoOperacaoMinutos × quantidadeOP), tempoEsperaMinutos, recursoId (opcional), status (PENDENTE), dataInicioPrevista (calculada), dataFimPrevista (calculada)
3. THE Sistema SHALL calcular as datas previstas de cada etapa sequencialmente: dataInicioPrevista da etapa N = dataFimPrevista da etapa N-1
4. THE Sistema SHALL considerar o calendário de turnos do CentroProducao ao calcular datas previstas
5. IF o produto não possuir RoteiroProducao ativo, THEN THE Sistema SHALL criar a OP sem etapas e registrar um aviso (a OP pode ser executada sem roteiro formal)
6. THE Sistema SHALL permitir que o usuário ajuste manualmente tempos e datas das etapas

---

### Requisito 4: Fluxo de Status da Ordem de Produção

**User Story:** Como gestor de produção, quero que a OP siga um fluxo de status controlado, para que eu tenha visibilidade do progresso de cada ordem.

#### Critérios de Aceitação

1. THE Sistema SHALL enforçar as seguintes transições de status válidas:
   - `RASCUNHO` → `PLANEJADA` (materiais e etapas gerados)
   - `PLANEJADA` → `PROGRAMADA` (datas definidas, sequenciada)
   - `PROGRAMADA` → `LIBERADA` (autorizada para produção)
   - `LIBERADA` → `EM_PRODUCAO` (primeiro apontamento realizado)
   - `EM_PRODUCAO` → `CONCLUIDA` (quantidade produzida atingida)
   - `RASCUNHO` → `CANCELADA`
   - `PLANEJADA` → `CANCELADA`
   - `PROGRAMADA` → `CANCELADA`
   - `LIBERADA` → `CANCELADA`
2. IF uma transição de status inválida for solicitada, THEN THE Sistema SHALL retornar erro 400 com mensagem indicando o status atual e as transições permitidas
3. WHEN uma OP é cancelada, THE Sistema SHALL exigir um campo `motivoCancelamento` (mínimo 10 caracteres)
4. WHEN uma OP transiciona para `PLANEJADA`, THE Sistema SHALL validar que possui pelo menos um ItemOrdemProducao
5. WHEN uma OP transiciona para `CONCLUIDA`, THE Sistema SHALL registrar a dataFimReal e calcular o tempoTotalProducao
6. THE Sistema SHALL registrar cada mudança de status em um log (LogOrdemProducao) com: statusAnterior, statusNovo, dataHora, usuarioId, observacao

---

### Requisito 5: Listagem e Filtros de Ordens de Produção

**User Story:** Como planejador de produção, quero listar e filtrar ordens de produção por diversos critérios, para que eu possa gerenciar o planejamento de forma eficiente.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer um endpoint de listagem com paginação (page, limit) e os seguintes filtros opcionais: status (aceita múltiplos valores), prioridade, produtoId, clienteId, pedidoVendaId, dataEmissaoDe/dataEmissaoAte, dataEntregaDe/dataEntregaAte, numero (busca exata)
2. THE Sistema SHALL suportar ordenação por: numero, dataEmissao, dataEntregaPrevista, prioridade, status
3. THE Sistema SHALL retornar na listagem: numero, produto (código + descrição), quantidade, unidade, status, prioridade, dataEntregaPrevista, clienteNome, percentualConcluido
4. THE Sistema SHALL calcular `percentualConcluido` como: `(quantidadeProduzida / quantidade) × 100`
5. THE Sistema SHALL fornecer um endpoint de detalhe que retorna a OP completa com: dados da OP, itens de material (com saldo disponível no WMS), etapas do roteiro, log de status, e apontamentos realizados
6. THE Sistema SHALL filtrar todos os resultados pelo empresaId do usuário autenticado

---

### Requisito 6: Verificação de Disponibilidade de Materiais

**User Story:** Como planejador de produção, quero verificar se há estoque suficiente de matérias-primas para uma OP antes de liberá-la, para evitar paradas de produção por falta de material.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer um endpoint `GET /api/ordens-producao/:id/verificar-materiais` que retorna para cada ItemOrdemProducao: produtoComponenteId, descricao, quantidadeNecessaria, estoqueDisponivel (do WMS), estoqueReservado, saldoLivre (disponivel - reservado), situacao (SUFICIENTE | INSUFICIENTE | SEM_ESTOQUE)
2. THE Sistema SHALL consultar o modelo Estoque existente para obter quantidade e reservado por produto/empresa
3. THE Sistema SHALL retornar um resumo geral: totalItens, itensSuficientes, itensInsuficientes, itensSemEstoque, e flag `podeLiberar` (true se todos SUFICIENTE)
4. IF algum item estiver com situacao INSUFICIENTE ou SEM_ESTOQUE, THE Sistema SHALL incluir sugestão de quantidade a comprar (quantidadeNecessaria - saldoLivre)
5. THE Sistema SHALL considerar reservas de outras OPs já liberadas ao calcular o saldo livre
6. THE Sistema SHALL permitir que a OP seja liberada mesmo com materiais insuficientes (com confirmação explícita do usuário via flag `forcarLiberacao`)

---

### Requisito 7: Geração de OP a partir de Pedido de Venda

**User Story:** Como planejador de produção, quero gerar OPs automaticamente a partir de pedidos de venda confirmados, para que a produção seja disparada pela demanda comercial.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer um endpoint `POST /api/ordens-producao/gerar-de-pedido` que aceita: pedidoVendaId (obrigatório) e itens (array com itemPedidoVendaId e quantidade a produzir)
2. WHEN uma OP é gerada a partir de um pedido, THE Sistema SHALL vincular a OP ao pedidoVendaId e ao clienteId do pedido
3. THE Sistema SHALL permitir gerar múltiplas OPs a partir de um mesmo pedido (um produto por OP)
4. THE Sistema SHALL validar que o Produto do item do pedido possui EstruturaProduto ativa
5. IF o Produto do item não possuir estrutura, THEN THE Sistema SHALL retornar aviso indicando que o item não pode ser produzido (apenas vendido do estoque)
6. WHEN a OP gerada é concluída, THE Sistema SHALL notificar o módulo de Vendas para atualizar o status do PedidoVenda (via evento interno)
7. THE Sistema SHALL impedir geração duplicada: se já existe OP ativa para o mesmo itemPedidoVendaId, retornar aviso

---

### Requisito 8: Programação e Sequenciamento de OPs

**User Story:** Como programador de produção, quero sequenciar as OPs nos centros produtivos respeitando capacidade e prioridade, para otimizar o uso das máquinas.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer um endpoint `POST /api/ordens-producao/programar` que aceita um array de OPs com suas datas de início desejadas
2. THE Sistema SHALL validar conflitos de capacidade: se duas OPs estão programadas para o mesmo CentroProducao no mesmo período, retornar aviso de sobreposição
3. THE Sistema SHALL fornecer um endpoint `GET /api/ordens-producao/programacao` que retorna a visão de programação (timeline) por CentroProducao em um período, incluindo: OP número, produto, quantidade, dataInicio, dataFim, status, prioridade
4. THE Sistema SHALL permitir reprogramar uma OP (alterar datas) enquanto o status for PLANEJADA ou PROGRAMADA
5. WHEN uma OP é programada, THE Sistema SHALL transicionar seu status para `PROGRAMADA`
6. THE Sistema SHALL ordenar OPs por prioridade (URGENTE > ALTA > NORMAL > BAIXA) e depois por dataEntregaPrevista ao sugerir sequenciamento
7. THE Sistema SHALL calcular a data de término prevista com base no tempo total do roteiro e na quantidade da OP

---

### Requisito 9: Agrupamento de OPs

**User Story:** Como planejador de produção, quero agrupar OPs do mesmo produto para otimizar setup de máquina, para reduzir tempo improdutivo.

#### Critérios de Aceitação

1. THE Sistema SHALL permitir criar um agrupamento de OPs (campo `grupoOpId` compartilhado) para OPs do mesmo produtoId
2. THE Sistema SHALL fornecer um endpoint `POST /api/ordens-producao/agrupar` que aceita um array de opIds e cria o agrupamento
3. WHEN OPs são agrupadas, THE Sistema SHALL somar as quantidades para efeito de programação no centro produtivo (um único setup para o grupo)
4. THE Sistema SHALL permitir desagrupar OPs individualmente
5. THE Sistema SHALL validar que todas as OPs do grupo pertencem ao mesmo produtoId e à mesma empresa
6. THE Sistema SHALL exibir OPs agrupadas de forma visual na programação (timeline)

---

### Requisito 10: Dashboard PCP

**User Story:** Como gestor de produção, quero um dashboard com indicadores de produção, para ter visibilidade rápida do status da fábrica.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer um endpoint `GET /api/pcp/dashboard` que retorna:
   - Total de OPs por status (contagem)
   - OPs atrasadas (dataEntregaPrevista < hoje e status != CONCLUIDA/CANCELADA)
   - OPs com material insuficiente (flag)
   - Ocupação dos centros produtivos (% do tempo programado vs disponível) para o período atual
   - Produção do dia (quantidade produzida via apontamentos de hoje)
   - Top 5 produtos mais produzidos no mês
2. THE Sistema SHALL aceitar parâmetro de período (dataInicio, dataFim) para filtrar os indicadores
3. THE Sistema SHALL retornar os dados em formato adequado para renderização de gráficos (arrays de labels + values)
4. THE Sistema SHALL filtrar todos os dados pelo empresaId do usuário autenticado
