# Documento de Requisitos — Endereçamento Inteligente com Distribuição por Capacidade e Visualização Gráfica

## Introdução

Este documento especifica os requisitos para o módulo de Endereçamento Inteligente do WMS VisioFab. O sistema atual (`SugestaoEnderecoService`) sugere um único endereço para toda a quantidade de um item, sem considerar a capacidade física da posição. O novo módulo implementa distribuição por capacidade (split), alocação por proximidade baseada no algoritmo Delphi de referência, validação de cubagem, e uma visualização gráfica interativa do mapa do armazém.

## Glossário

- **Motor_Enderecamento**: Serviço backend responsável por calcular a distribuição de quantidades entre múltiplos endereços, considerando capacidade física, peso e volume.
- **Validador_Cubagem**: Componente que verifica se um SKU cabe fisicamente em uma posição de estrutura, comparando dimensões do SKU com dimensões da Estrutura.
- **Alocador_Proximidade**: Componente que ordena endereços candidatos por proximidade ao endereço de picking ou endereço fixo, seguindo a lógica par/ímpar de prédios (mesmo lado → lado oposto → próxima rua).
- **Mapa_Armazem**: Componente frontend que renderiza a visualização gráfica do depósito com ruas, prédios, níveis e apartamentos.
- **SKU**: Stock Keeping Unit — unidade de armazenagem com dimensões (largura, altura, comprimento, volume, pesoBruto, lastro, camada).
- **Estrutura**: Tipo de rack/estante com dimensões e capacidade máxima.
- **CapacidadeNivel**: Configuração de limites (peso, volume, paletes) por nível de uma estrutura.
- **Endereco**: Posição física no armazém identificada por rua, prédio, nível e apartamento.
- **SaldoEndereco**: Registro de estoque em um endereço específico (produto, quantidade, lote, validade).
- **Lastro**: Quantidade de caixas na base de um palete.
- **Camada**: Quantidade de camadas empilhadas no palete.
- **Capacidade_Palete**: Quantidade máxima de caixas por posição de palete = lastro × camada.
- **Predio_Mesmo_Lado**: Prédios com diferença par (+2, +4, ...) em relação ao prédio de origem.
- **Predio_Lado_Oposto**: Prédios com diferença ímpar (+1, +3, ...) em relação ao prédio de origem.
- **DadosLogisticosArmazenagem**: Configuração logística do produto contendo endereço fixo, norma (FEFO/FIFO), níveis min/max.
- **DadosLogisticosPicking**: Configuração do endereço de picking do produto.
- **Distribuicao_Resultado**: Objeto retornado pelo Motor_Enderecamento contendo a lista de endereços com suas respectivas quantidades alocadas.

## Requisitos

### Requisito 1: Cálculo de Capacidade por Posição

**User Story:** Como operador de armazém, eu quero que o sistema calcule quantas caixas cabem em cada posição de endereço, para que a distribuição respeite os limites físicos reais.

#### Critérios de Aceitação

1. WHEN um SKU com lastro e camada definidos é informado, THE Motor_Enderecamento SHALL calcular a Capacidade_Palete como lastro × camada.
2. WHEN um SKU sem lastro ou camada definidos é informado, THE Motor_Enderecamento SHALL utilizar a capacidade da Estrutura associada ao endereço como limite.
3. THE Validador_Cubagem SHALL verificar que as dimensões do SKU (largura × altura × comprimento) cabem nas dimensões da Estrutura (largura × altura × comprimento) antes de permitir alocação.
4. THE Validador_Cubagem SHALL rejeitar a alocação WHEN o peso total (pesoBruto × quantidade) exceder o pesoMaximo definido em CapacidadeNivel.
5. THE Validador_Cubagem SHALL rejeitar a alocação WHEN o volume total (volume × quantidade) exceder o volumeMaximo definido em CapacidadeNivel.
6. WHEN CapacidadeNivel não estiver configurada para o nível do endereço, THE Validador_Cubagem SHALL permitir a alocação sem restrição de peso e volume.

### Requisito 2: Distribuição por Capacidade (Split)

**User Story:** Como operador de armazém, eu quero que o sistema distribua automaticamente a quantidade entre múltiplos endereços quando um único endereço não comporta toda a carga, para que eu não precise calcular manualmente a divisão.

#### Critérios de Aceitação

1. WHEN a quantidade solicitada excede a Capacidade_Palete de um endereço, THE Motor_Enderecamento SHALL dividir a quantidade entre múltiplos endereços.
2. THE Motor_Enderecamento SHALL alocar a quantidade máxima possível em cada endereço antes de passar para o próximo.
3. THE Motor_Enderecamento SHALL retornar uma lista ordenada de alocações contendo enderecoId, quantidade alocada e endereço completo para cada posição.
4. WHEN a quantidade total não puder ser alocada em nenhuma combinação de endereços disponíveis, THE Motor_Enderecamento SHALL retornar as alocações parciais realizadas e indicar a quantidade restante não alocada.
5. THE Motor_Enderecamento SHALL considerar o saldo já existente em cada endereço ao calcular a capacidade disponível restante.
6. FOR ALL distribuições realizadas, a soma das quantidades alocadas em cada endereço SHALL ser igual à quantidade total solicitada (quando há capacidade suficiente).

### Requisito 3: Alocação por Proximidade

**User Story:** Como gerente de logística, eu quero que o sistema aloque endereços próximos entre si para o mesmo produto, para que a operação de picking seja eficiente.

#### Critérios de Aceitação

1. WHEN o produto possui endereço de picking configurado (DadosLogisticosPicking.enderecoPickingId), THE Alocador_Proximidade SHALL iniciar a busca a partir do prédio desse endereço.
2. WHEN o produto possui endereço fixo configurado (DadosLogisticosArmazenagem.enderecoFixoId), THE Alocador_Proximidade SHALL iniciar a busca a partir do prédio desse endereço fixo.
3. THE Alocador_Proximidade SHALL priorizar endereços no mesmo prédio de origem, percorrendo todos os níveis disponíveis (entre nivelMinPP e nivelMaxPP).
4. WHEN o prédio de origem estiver cheio, THE Alocador_Proximidade SHALL buscar prédios do mesmo lado (diferença par: +2, -2, +4, -4) antes de buscar prédios do lado oposto.
5. WHEN prédios do mesmo lado estiverem cheios, THE Alocador_Proximidade SHALL buscar prédios do lado oposto (diferença ímpar: +1, -1, +3, -3).
6. WHEN todos os prédios da rua atual estiverem cheios, THE Alocador_Proximidade SHALL expandir para a próxima rua disponível.
7. THE Alocador_Proximidade SHALL respeitar a classificação de produto do endereço (classificacaoProdutoId) ao filtrar endereços candidatos.
8. THE Alocador_Proximidade SHALL filtrar endereços por compatibilidade de lote quando o produto exigir controle de lote.

### Requisito 4: Visualização Gráfica do Mapa do Armazém

**User Story:** Como operador de armazém, eu quero visualizar graficamente o layout do depósito com a ocupação de cada posição, para que eu tenha visibilidade imediata do estado do estoque.

#### Critérios de Aceitação

1. THE Mapa_Armazem SHALL renderizar a estrutura do depósito organizada por ruas, prédios, níveis e apartamentos.
2. THE Mapa_Armazem SHALL exibir cada posição com código de cores: verde para vazio, amarelo para parcialmente ocupado, vermelho para cheio, azul para reservado/bloqueado.
3. WHEN o Motor_Enderecamento gera uma sugestão de distribuição, THE Mapa_Armazem SHALL destacar as posições sugeridas com uma cor diferenciada (roxo ou laranja).
4. WHEN o usuário clica em uma posição ocupada, THE Mapa_Armazem SHALL exibir um painel de detalhes contendo: nome do produto, quantidade, lote, validade e percentual de ocupação.
5. THE Mapa_Armazem SHALL permitir filtrar a visualização por rua, prédio ou produto específico.
6. THE Mapa_Armazem SHALL atualizar os dados de ocupação ao ser carregado, refletindo o estado atual do SaldoEndereco.
7. WHILE o usuário está na tela de endereçamento, THE Mapa_Armazem SHALL exibir a quantidade sugerida para cada posição destacada.

### Requisito 5: Integração com Fluxo de Endereçamento Existente

**User Story:** Como desenvolvedor, eu quero que o novo motor de endereçamento substitua o serviço atual de sugestão, para que o fluxo de recebimento utilize a distribuição por capacidade automaticamente.

#### Critérios de Aceitação

1. THE Motor_Enderecamento SHALL substituir o método `sugerirLote()` do SugestaoEnderecoService existente, retornando múltiplas alocações por item quando necessário.
2. WHEN o Motor_Enderecamento é invocado para um item, THE Motor_Enderecamento SHALL primeiro verificar endereço fixo, depois consolidação, e por último endereços livres com distribuição por capacidade.
3. THE Motor_Enderecamento SHALL expor um endpoint REST que receba produtoId, quantidade, lote e validade, e retorne a Distribuicao_Resultado.
4. THE Motor_Enderecamento SHALL registrar cada alocação sugerida como um LogMovimentacao do tipo ENDERECAMENTO quando confirmada pelo operador.
5. IF o produto não possuir SKU master com dimensões cadastradas, THEN THE Motor_Enderecamento SHALL retornar um erro indicando que o cadastro de SKU está incompleto.

### Requisito 6: Conversão de Unidades entre SKUs

**User Story:** Como operador de armazém, eu quero que o sistema converta automaticamente entre unidades de expedição e unidades de armazenagem, para que a distribuição considere a unidade correta de paletização.

#### Critérios de Aceitação

1. WHEN a quantidade de entrada está em unidade de expedição (SKU expedição), THE Motor_Enderecamento SHALL converter para unidade de armazenagem (SKU master) usando a relação qtdEmbalagem entre os SKUs.
2. THE Motor_Enderecamento SHALL utilizar o SKU master (maior sequência com lastro e camada definidos) para calcular a capacidade de palete.
3. IF o produto não possuir SKU master cadastrado, THEN THE Motor_Enderecamento SHALL rejeitar o endereçamento com mensagem descritiva.

### Requisito 7: API de Ocupação do Armazém para Visualização

**User Story:** Como frontend, eu quero um endpoint que retorne o estado de ocupação de todos os endereços de um depósito, para que o Mapa_Armazem possa renderizar a visualização.

#### Critérios de Aceitação

1. THE Motor_Enderecamento SHALL expor um endpoint GET que retorne todos os endereços de um depósito com seu estado de ocupação (vazio, parcial, cheio, bloqueado).
2. THE Motor_Enderecamento SHALL calcular o percentual de ocupação de cada endereço baseado na relação entre saldo atual e Capacidade_Palete.
3. WHEN um endereço possui saldo maior que zero e menor que a Capacidade_Palete, THE Motor_Enderecamento SHALL classificá-lo como parcialmente ocupado.
4. WHEN um endereço possui saldo igual ou superior à Capacidade_Palete, THE Motor_Enderecamento SHALL classificá-lo como cheio.
5. THE Motor_Enderecamento SHALL incluir na resposta: enderecoId, enderecoCompleto, rua, predio, nivel, apto, status de ocupação, percentual, produto (se ocupado), quantidade e lote.
