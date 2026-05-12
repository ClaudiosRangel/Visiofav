# Documento de Requisitos — Abastecimento Automático do Picking no Endereçamento

## Introdução

Este documento especifica os requisitos para implementar o abastecimento automático do picking durante o fluxo de endereçamento de mercadorias no WMS VisioFab. A lógica é baseada no procedimento `EnderecarPicking` do WMS Delphi legado, adaptada para a arquitetura Node.js/Prisma do sistema atual.

No fluxo de endereçamento automático, antes de distribuir a mercadoria no pulmão (níveis 002+), o sistema deve verificar se o endereço de picking (nível 001) do produto precisa de abastecimento. Se necessário, aloca parte da quantidade recebida no picking e distribui o restante no pulmão usando o motor de distribuição inteligente existente.

## Glossário

- **Sistema_Enderecamento**: Módulo de endereçamento automático do WMS VisioFab responsável por alocar mercadorias recebidas nos endereços do armazém
- **Servico_Abastecimento_Picking**: Serviço puro (sem side-effects) que calcula a quantidade a ser alocada no picking durante o endereçamento
- **Picking**: Área de separação de pedidos localizada no nível mais baixo (nível 001/térreo) de cada prédio do armazém
- **Pulmão**: Área de armazenagem de reserva localizada nos níveis superiores (002+) de cada prédio
- **Capacidade_Picking**: Quantidade máxima que o endereço de picking comporta para um determinado produto, definida em `DadosLogisticosPicking.capacidade`
- **Saldo_Picking**: Quantidade física atual armazenada no endereço de picking do produto
- **Ponto_Reposicao**: Nível mínimo de estoque no picking que dispara a necessidade de abastecimento, definido em `DadosLogisticosPicking.pontoReposicao`
- **DadosLogisticosPicking**: Cadastro que define o endereço de picking, capacidade e ponto de reposição para cada produto
- **Quantidade_Abastecimento**: Quantidade calculada para abastecer o picking: `min(qtdRestante, capacidadePicking - saldoAtualPicking)`
- **Motor_Distribuicao**: Motor de distribuição inteligente existente que aloca mercadorias no pulmão com split por capacidade

## Requisitos

### Requisito 1: Verificação de Necessidade de Abastecimento

**User Story:** Como operador de armazém, eu quero que o sistema verifique automaticamente se o picking precisa de abastecimento durante o endereçamento, para que a área de separação esteja sempre abastecida sem intervenção manual.

#### Critérios de Aceitação

1. WHEN o Sistema_Enderecamento inicia a distribuição automática de uma mercadoria (produtoId, empresaId, quantidadeRestante), THE Servico_Abastecimento_Picking SHALL buscar o registro de DadosLogisticosPicking filtrando por produtoId e empresaId da empresa corrente
2. WHEN o registro de DadosLogisticosPicking existe e possui enderecoPickingId não nulo, THE Servico_Abastecimento_Picking SHALL buscar o saldo físico atual (quantidade em estoque) do produto no endereço de picking identificado
3. WHEN o registro de DadosLogisticosPicking não existe para o produto na empresa corrente, THE Servico_Abastecimento_Picking SHALL retornar quantidade de abastecimento igual a zero e indicar que toda a quantidadeRestante deve ser distribuída no pulmão
4. WHEN o enderecoPickingId do DadosLogisticosPicking é nulo, THE Servico_Abastecimento_Picking SHALL retornar quantidade de abastecimento igual a zero e indicar que toda a quantidadeRestante deve ser distribuída no pulmão
5. IF o saldo físico do endereço de picking não pode ser determinado (endereço sem registros de estoque), THEN THE Servico_Abastecimento_Picking SHALL considerar o saldo como zero e prosseguir com o cálculo de abastecimento normalmente

### Requisito 2: Cálculo da Quantidade de Abastecimento

**User Story:** Como gestor de logística, eu quero que o sistema calcule a quantidade exata para abastecer o picking sem exceder a capacidade, para evitar sobrecarga no endereço de separação.

#### Critérios de Aceitação

1. WHEN o saldo atual do picking é menor que a capacidade definida, THE Servico_Abastecimento_Picking SHALL calcular a quantidade de abastecimento como: `min(quantidadeRestante, capacidadePicking - saldoAtualPicking)`, onde todas as quantidades são números inteiros representando unidades e quantidadeRestante >= 0, saldoAtualPicking >= 0, e capacidadePicking >= 1
2. IF o saldo atual do picking é igual ou maior que a capacidade definida, THEN THE Servico_Abastecimento_Picking SHALL retornar quantidade de abastecimento igual a zero
3. WHEN a quantidade restante para endereçar é menor que o espaço disponível no picking (capacidadePicking - saldoAtualPicking), THE Servico_Abastecimento_Picking SHALL alocar toda a quantidade restante no picking
4. WHEN a quantidade restante para endereçar é maior ou igual ao espaço disponível no picking, THE Servico_Abastecimento_Picking SHALL alocar apenas o espaço disponível (capacidadePicking - saldoAtualPicking) no picking
5. THE Servico_Abastecimento_Picking SHALL garantir que a quantidade de abastecimento calculada é sempre maior ou igual a zero, mesmo que os valores de entrada resultem em cálculo negativo (neste caso, retornar zero)
6. THE Servico_Abastecimento_Picking SHALL garantir que (saldoAtualPicking + quantidadeAbastecimento) é menor ou igual à capacidadePicking após o cálculo
7. IF qualquer valor de entrada (quantidadeRestante ou saldoAtualPicking) for negativo, ou capacidadePicking for menor que 1, THEN THE Servico_Abastecimento_Picking SHALL rejeitar o cálculo e retornar uma indicação de erro informando que os parâmetros de entrada são inválidos, sem realizar o abastecimento

### Requisito 3: Alocação no Endereço de Picking

**User Story:** Como operador de armazém, eu quero que a mercadoria seja alocada automaticamente no endereço de picking quando necessário, para que eu não precise fazer transferências manuais depois.

#### Critérios de Aceitação

1. WHEN a quantidade de abastecimento calculada é maior que zero, THE Sistema_Enderecamento SHALL criar uma alocação no endereço de picking contendo enderecoId (do picking), produtoId, quantidade calculada, lote e validade (quando aplicáveis), com areaArmazenagem identificada como PICKING
2. WHEN a quantidade de abastecimento é alocada no picking, THE Sistema_Enderecamento SHALL decrementar a quantidade restante disponível para distribuição no pulmão de forma que quantidadeRestante seja igual a quantidadeOriginal menos quantidadeAbastecimento
3. WHEN o operador confirma o endereçamento que inclui alocação no picking, THE Sistema_Enderecamento SHALL registrar um LogMovimentacao do tipo ENDERECAMENTO para o endereço de picking contendo enderecoId, produtoId, quantidade, lote, validade, empresaId do usuário logado, saldoAnterior e saldoNovo do endereço de picking
4. IF o endereço de picking está com status inativo (status=false), THEN THE Servico_Abastecimento_Picking SHALL pular a etapa de abastecimento e encaminhar toda a quantidade para o pulmão
5. IF o endereço de picking está com status inativo (status=false) e a quantidade de abastecimento seria maior que zero, THEN THE Sistema_Enderecamento SHALL não criar alocação no picking e disponibilizar a quantidade total original para distribuição no pulmão

### Requisito 4: Integração com Fluxo de Endereçamento Existente

**User Story:** Como desenvolvedor, eu quero que o abastecimento do picking seja integrado ao fluxo de endereçamento automático existente, para que a sequência de operações siga a mesma lógica do WMS Delphi legado.

#### Critérios de Aceitação

1. WHEN o endereçamento automático é executado para um item, THE Sistema_Enderecamento SHALL invocar o Servico_Abastecimento_Picking com o produtoId, quantidade total e empresaId ANTES de invocar o Motor_Distribuicao para o pulmão
2. WHEN o abastecimento do picking consome parte da quantidade (quantidadeAbastecimento > 0 AND quantidadeAbastecimento < quantidadeTotal), THE Sistema_Enderecamento SHALL invocar o Motor_Distribuicao existente passando apenas a quantidade restante (quantidadeTotal - quantidadeAbastecimento) para distribuição no pulmão
3. WHEN o abastecimento do picking consome toda a quantidade disponível (quantidadeAbastecimento = quantidadeTotal), THE Sistema_Enderecamento SHALL retornar a distribuição com flag completa=true, quantidadeRestante=0 e lista de alocações contendo apenas a alocação do picking, sem invocar o Motor_Distribuicao
4. WHEN o Servico_Abastecimento_Picking retorna quantidade de abastecimento igual a zero, THE Sistema_Enderecamento SHALL invocar o Motor_Distribuicao passando a quantidade total original sem modificação
5. THE Sistema_Enderecamento SHALL manter o fluxo de endereçamento manual (confirmar-coletor) inalterado, ou seja, o endpoint e a lógica do confirmar-coletor SHALL NOT invocar o Servico_Abastecimento_Picking e SHALL continuar operando com alocação direta no endereço informado pelo operador
6. FOR ALL distribuições realizadas pelo endereçamento automático, a soma da quantidade alocada no picking mais a soma das quantidades alocadas no pulmão SHALL ser igual à quantidade total de entrada (quando Motor_Distribuicao retorna completa=true)
7. IF o Motor_Distribuicao falha ou retorna completa=false após a alocação no picking ter sido calculada, THEN THE Sistema_Enderecamento SHALL retornar o resultado parcial incluindo a alocação do picking já calculada, a quantidade alocada no pulmão (se houver) e a quantidade restante não alocada

### Requisito 5: Resultado da Distribuição com Picking

**User Story:** Como operador de armazém, eu quero visualizar claramente quais quantidades foram alocadas no picking e quais no pulmão, para confirmar o endereçamento com segurança.

#### Critérios de Aceitação

1. WHEN a distribuição aloca quantidade ao endereço de picking do produto (DadosLogisticosPicking.enderecoPickingId), THE Sistema_Enderecamento SHALL incluir a alocação do picking como primeiro item na lista de alocações retornada, seguida pelas alocações de pulmão na ordem de proximidade calculada pelo Alocador_Proximidade
2. WHEN a distribuição é retornada ao operador, THE Sistema_Enderecamento SHALL identificar cada alocação com o tipo de área (PICKING ou PULMAO) como atributo do objeto de alocação
3. WHEN a distribuição inclui alocação no picking, THE Sistema_Enderecamento SHALL retornar a capacidade total do picking (em unidade master) e o saldo resultante após o abastecimento (saldo anterior + quantidade alocada)
4. THE Sistema_Enderecamento SHALL retornar o resultado da distribuição contendo: lista de alocações (enderecoId, quantidade, areaArmazenagem), quantidade total alocada, quantidade restante e flag de distribuição completa
5. IF o produto não possuir endereço de picking configurado (DadosLogisticosPicking ausente ou enderecoPickingId nulo), THEN THE Sistema_Enderecamento SHALL retornar a distribuição apenas com alocações do tipo PULMAO, sem erro
6. IF o endereço de picking estiver com saldo igual ou superior à sua capacidade, THEN THE Sistema_Enderecamento SHALL omitir a alocação de picking do resultado e distribuir toda a quantidade nos endereços de pulmão

### Requisito 6: Validação de Ponto de Reposição

**User Story:** Como gestor de logística, eu quero configurar quando o picking deve ser abastecido usando o ponto de reposição, para otimizar o momento do abastecimento.

#### Critérios de Aceitação

1. WHERE o campo `pontoReposicao` do DadosLogisticosPicking do produto é não-nulo e maior que zero, WHEN o saldo atual do picking é maior que o valor de `pontoReposicao`, THE Servico_Abastecimento_Picking SHALL retornar quantidade de abastecimento igual a zero e encaminhar toda a quantidade restante para distribuição no pulmão
2. WHERE o campo `pontoReposicao` do DadosLogisticosPicking do produto é não-nulo e maior que zero, WHEN o saldo atual do picking é menor ou igual ao valor de `pontoReposicao`, THE Servico_Abastecimento_Picking SHALL calcular a quantidade de abastecimento usando a fórmula `min(quantidadeRestante, capacidadePicking - saldoAtualPicking)`
3. WHERE o campo `pontoReposicao` do DadosLogisticosPicking do produto é nulo ou igual a zero, THE Servico_Abastecimento_Picking SHALL calcular a quantidade de abastecimento usando a fórmula `min(quantidadeRestante, capacidadePicking - saldoAtualPicking)` sempre que houver espaço disponível (capacidadePicking > saldoAtualPicking)
4. IF o campo `pontoReposicao` possui valor negativo, THEN THE Servico_Abastecimento_Picking SHALL tratar como configuração inativa e calcular o abastecimento sempre que houver espaço disponível no picking

### Requisito 7: Isolamento Multi-Tenant

**User Story:** Como administrador do sistema, eu quero que o abastecimento do picking respeite o isolamento entre empresas, para garantir que dados de uma empresa não interfiram em outra.

#### Critérios de Aceitação

1. THE Servico_Abastecimento_Picking SHALL filtrar DadosLogisticosPicking pelo produtoId vinculado à empresa (empresaId) do usuário logado, excluindo registros de qualquer outra empresa dos resultados
2. THE Servico_Abastecimento_Picking SHALL buscar saldos do picking apenas em endereços cujo empresaId seja igual ao empresaId do usuário logado, excluindo endereços de outras empresas dos resultados
3. WHEN o Sistema_Enderecamento registrar uma LogMovimentacao, THE Sistema_Enderecamento SHALL persistir o empresaId do usuário logado no registro de LogMovimentacao
4. IF o empresaId do usuário logado não estiver disponível no contexto de autenticação, THEN THE Servico_Abastecimento_Picking SHALL rejeitar a operação e retornar uma mensagem de erro indicando contexto de empresa ausente, sem retornar nenhum dado
5. IF uma consulta retornar registros cujo empresaId não corresponda ao empresaId do usuário logado, THEN THE Servico_Abastecimento_Picking SHALL excluir esses registros do resultado antes de retorná-lo ao solicitante

### Requisito 8: Tratamento de Erros e Casos Especiais

**User Story:** Como operador de armazém, eu quero que o sistema trate graciosamente situações inesperadas no abastecimento do picking, para que o endereçamento não seja bloqueado por problemas no picking.

#### Critérios de Aceitação

1. IF o endereço de picking referenciado em DadosLogisticosPicking não existe no banco de dados, THEN THE Servico_Abastecimento_Picking SHALL registrar um log de aviso contendo o produtoId e o enderecoPickingId inexistente, e pular o abastecimento para esse endereço de picking
2. IF ocorre um erro ao buscar o saldo do picking, THEN THE Servico_Abastecimento_Picking SHALL registrar o erro e pular o abastecimento, direcionando a quantidade integral do produto para distribuição exclusiva no pulmão
3. IF a capacidade definida em DadosLogisticosPicking é zero ou negativa, THEN THE Servico_Abastecimento_Picking SHALL pular o abastecimento para o produto e registrar um log de aviso contendo o produtoId e o valor inválido de capacidade
4. IF múltiplos registros de DadosLogisticosPicking existem para o mesmo produto, THEN THE Servico_Abastecimento_Picking SHALL processar cada endereço de picking em ordem crescente do campo sequência de DadosLogisticosPicking
5. IF não existem registros de DadosLogisticosPicking para o produto, THEN THE Servico_Abastecimento_Picking SHALL pular a etapa de abastecimento de picking e direcionar a quantidade integral do produto para distribuição no pulmão
6. IF qualquer erro não previsto ocorre durante o processamento de abastecimento de picking, THEN THE Servico_Abastecimento_Picking SHALL capturar a exceção, registrar o erro, e permitir que o fluxo principal de endereçamento continue sem interrupção
