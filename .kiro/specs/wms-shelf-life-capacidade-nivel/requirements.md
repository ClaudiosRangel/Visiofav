# Requirements Document

## Introdução

Este documento especifica os requisitos para a funcionalidade de **Controle de Shelf Life e Capacidade por Nível** no WMS VisioFab. A funcionalidade abrange dois módulos complementares:

1. **Controle de Shelf Life (Validade Mínima)**: Permite configurar por produto a quantidade mínima de dias restantes até o vencimento que o WMS aceita durante o recebimento (conferência de entrada). Produtos com validade insuficiente são rejeitados ou sinalizados.

2. **Capacidade por Nível de Estrutura**: Permite configurar limites de capacidade (peso, volume ou quantidade de paletes) por nível dentro de cada estrutura de armazenagem. Durante o endereçamento (putaway), o sistema valida que o nível não excedeu sua capacidade máxima configurada.

## Glossário

- **Sistema**: A aplicação WMS (backend Fastify + frontend Next.js + app mobile)
- **Empresa**: Entidade tenant no sistema multi-tenant
- **Produto**: Item cadastrado no sistema com código, nome e unidade
- **SKU**: Unidade de manuseio do produto com dimensões e pesos
- **Estrutura**: Tipo de estrutura de armazenagem (porta-palete, blocado, drive-in, flow-rack) com dimensões e capacidade global
- **Endereco**: Posição física no armazém composta por depósito/zona/rua/prédio/nível/apartamento
- **Nivel**: Andar/prateleira dentro de uma estrutura de armazenagem, identificado pelo campo codigoNivel do Endereco
- **Conferencia_Entrada**: Processo de verificação dos itens recebidos contra a nota fiscal de entrada
- **Enderecamento**: Processo de alocação dos itens conferidos em endereços de armazenagem
- **Shelf_Life_Minimo**: Quantidade mínima de dias restantes até o vencimento que o produto deve ter para ser aceito no recebimento
- **Capacidade_Nivel**: Configuração de limite máximo (peso, volume ou paletes) para um nível específico dentro de uma estrutura
- **SaldoEndereco**: Registro de estoque em um endereço específico com produto, quantidade, lote e validade
- **Nota_Entrada**: Nota fiscal de entrada com itens a serem conferidos e endereçados
- **Usuario**: Usuário autenticado do sistema

## Requisitos

### Requisito 1: Configuração de Shelf Life Mínimo no Produto

**User Story:** Como gestor de qualidade, eu quero configurar a quantidade mínima de dias de validade restante por produto, para que o WMS rejeite automaticamente produtos com validade insuficiente durante o recebimento.

#### Critérios de Aceitação

1. THE Sistema SHALL armazenar um campo opcional shelfLifeMinimo (número inteiro, em dias) no modelo Produto
2. THE Sistema SHALL fornecer um endpoint de API para atualizar o campo shelfLifeMinimo de um Produto
3. WHEN o campo shelfLifeMinimo é atualizado com um valor, THE Sistema SHALL validar que o valor é um número inteiro positivo maior que zero
4. THE Sistema SHALL exibir o campo shelfLifeMinimo na interface de cadastro/edição do Produto
5. THE Sistema SHALL permitir que o campo shelfLifeMinimo seja definido como nulo para desabilitar a validação de shelf life para o Produto
6. THE Sistema SHALL restringir operações de shelfLifeMinimo ao escopo da Empresa autenticada (isolamento multi-tenant)

---

### Requisito 2: Validação de Shelf Life na Conferência de Entrada

**User Story:** Como conferente de recebimento, eu quero que o sistema valide automaticamente se a data de validade informada atende ao shelf life mínimo configurado, para que eu não aceite produtos com validade insuficiente.

#### Critérios de Aceitação

1. WHEN um item é conferido com data de validade e o Produto possui shelfLifeMinimo configurado, THE Sistema SHALL calcular os dias restantes subtraindo a data atual da data de validade informada
2. IF os dias restantes até o vencimento forem menores que o shelfLifeMinimo do Produto, THEN THE Sistema SHALL rejeitar a conferência do item com mensagem indicando a validade mínima exigida e a data mínima aceitável
3. WHEN um item é conferido sem data de validade e o Produto possui shelfLifeMinimo configurado, THE Sistema SHALL aceitar a conferência sem validação de shelf life
4. WHEN um item é conferido e o Produto não possui shelfLifeMinimo configurado (nulo), THE Sistema SHALL aceitar a conferência sem validação de shelf life
5. THE Sistema SHALL aplicar a validação de shelf life tanto na conferência individual (conferir-item) quanto na conferência por código de barras (conferir-por-barras)
6. THE Sistema SHALL aplicar a validação de shelf life na conferência em lote (conferir-todos), rejeitando apenas os itens que não atendem ao critério e informando quais itens falharam
7. THE Sistema SHALL incluir na mensagem de rejeição: o nome do produto, o shelfLifeMinimo configurado, os dias restantes calculados e a data mínima de validade aceitável

---

### Requisito 3: Cadastro de Capacidade por Nível de Estrutura

**User Story:** Como gestor de armazém, eu quero configurar a capacidade máxima por nível em cada tipo de estrutura, para que o sistema controle a ocupação e evite sobrecarga nas prateleiras.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer uma tabela de configuração CapacidadeNivel com campos: estruturaId, codigoNivel, pesoMaximo (kg), volumeMaximo (m³), paletesMaximo (quantidade) e status
2. THE Sistema SHALL fornecer um endpoint de API para criar uma configuração de CapacidadeNivel vinculada a uma Estrutura e um nível específico
3. THE Sistema SHALL fornecer um endpoint de API para listar todas as configurações de CapacidadeNivel de uma Estrutura
4. THE Sistema SHALL fornecer um endpoint de API para atualizar uma configuração de CapacidadeNivel existente
5. THE Sistema SHALL fornecer um endpoint de API para excluir uma configuração de CapacidadeNivel
6. THE Sistema SHALL validar que não existe duplicidade de configuração para a mesma combinação de estruturaId e codigoNivel
7. WHEN uma configuração de CapacidadeNivel é criada, THE Sistema SHALL validar que pelo menos um dos campos de limite (pesoMaximo, volumeMaximo ou paletesMaximo) possui valor maior que zero
8. THE Sistema SHALL restringir operações de CapacidadeNivel ao escopo da Empresa autenticada (isolamento multi-tenant)

---

### Requisito 4: Interface de Gerenciamento de Capacidade por Nível

**User Story:** Como gestor de armazém, eu quero uma interface para visualizar e editar as capacidades por nível de cada estrutura, para que eu possa ajustar os limites conforme a necessidade operacional.

#### Critérios de Aceitação

1. THE Sistema SHALL exibir uma tela de configuração de capacidade por nível acessível a partir do cadastro de Estrutura
2. THE Sistema SHALL apresentar uma tabela listando todos os níveis configurados com suas respectivas capacidades (peso, volume, paletes)
3. THE Sistema SHALL permitir adicionar novos níveis com suas capacidades diretamente na interface
4. THE Sistema SHALL permitir editar as capacidades de um nível existente diretamente na tabela (edição inline)
5. THE Sistema SHALL permitir remover uma configuração de nível com confirmação do Usuario
6. THE Sistema SHALL exibir a ocupação atual de cada nível (peso total, volume total, paletes alocados) ao lado da capacidade máxima configurada
7. THE Sistema SHALL destacar visualmente os níveis que estão acima de 80% da capacidade configurada (alerta amarelo) e acima de 95% (alerta vermelho)

---

### Requisito 5: Validação de Capacidade no Endereçamento

**User Story:** Como operador de armazém, eu quero que o sistema valide a capacidade do nível antes de endereçar um produto, para que eu não exceda os limites de peso ou volume da prateleira.

#### Critérios de Aceitação

1. WHEN um endereçamento manual é solicitado para um Endereco, THE Sistema SHALL verificar se existe configuração de CapacidadeNivel para a Estrutura e nível do Endereco de destino
2. IF existe configuração de CapacidadeNivel e o peso total do nível após o endereçamento exceder o pesoMaximo configurado, THEN THE Sistema SHALL rejeitar o endereçamento com mensagem indicando o peso atual, o peso do item e o limite máximo do nível
3. IF existe configuração de CapacidadeNivel e o volume total do nível após o endereçamento exceder o volumeMaximo configurado, THEN THE Sistema SHALL rejeitar o endereçamento com mensagem indicando o volume atual, o volume do item e o limite máximo do nível
4. IF existe configuração de CapacidadeNivel e a quantidade de paletes no nível após o endereçamento exceder o paletesMaximo configurado, THEN THE Sistema SHALL rejeitar o endereçamento com mensagem indicando a quantidade atual de paletes e o limite máximo do nível
5. WHEN não existe configuração de CapacidadeNivel para a Estrutura e nível do Endereco de destino, THE Sistema SHALL permitir o endereçamento sem validação de capacidade
6. THE Sistema SHALL aplicar a validação de capacidade tanto no endereçamento manual quanto no endereçamento automático
7. WHEN o endereçamento automático encontra um nível com capacidade excedida, THE Sistema SHALL buscar o próximo endereço disponível em um nível com capacidade suficiente

---

### Requisito 6: Cálculo de Ocupação do Nível

**User Story:** Como gestor de armazém, eu quero que o sistema calcule a ocupação atual de cada nível com base nos saldos de estoque, para que as validações de capacidade sejam precisas.

#### Critérios de Aceitação

1. THE Sistema SHALL calcular o peso total de um nível somando o peso bruto (pesoBruto do SKU) multiplicado pela quantidade de cada SaldoEndereco nos endereços daquele nível e estrutura
2. THE Sistema SHALL calcular o volume total de um nível somando o volume (volume do SKU) multiplicado pela quantidade de cada SaldoEndereco nos endereços daquele nível e estrutura
3. THE Sistema SHALL calcular a quantidade de paletes de um nível contando os registros distintos de SaldoEndereco com quantidade maior que zero nos endereços daquele nível e estrutura
4. WHEN um Produto não possui SKU com peso ou volume cadastrado, THE Sistema SHALL considerar peso e volume como zero para fins de cálculo de ocupação
5. THE Sistema SHALL fornecer um endpoint de API para consultar a ocupação atual de todos os níveis de uma Estrutura
6. THE Sistema SHALL retornar para cada nível: peso atual, peso máximo, percentual de ocupação por peso, volume atual, volume máximo, percentual de ocupação por volume, paletes atuais, paletes máximo e percentual de ocupação por paletes

---

### Requisito 7: Configuração de Shelf Life via Importação em Lote

**User Story:** Como gestor de qualidade, eu quero atualizar o shelf life mínimo de múltiplos produtos de uma vez, para que eu possa configurar rapidamente toda a base de produtos.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer um endpoint de API para atualização em lote do campo shelfLifeMinimo de múltiplos Produtos
2. WHEN uma atualização em lote é recebida, THE Sistema SHALL aceitar uma lista de objetos contendo produtoId (ou codigo) e shelfLifeMinimo
3. WHEN uma atualização em lote é recebida, THE Sistema SHALL validar cada item individualmente e retornar um relatório com sucessos e falhas
4. IF um item da lista possui produtoId ou codigo inválido, THEN THE Sistema SHALL registrar o erro para aquele item e continuar processando os demais
5. THE Sistema SHALL restringir a atualização em lote ao escopo da Empresa autenticada (isolamento multi-tenant)
