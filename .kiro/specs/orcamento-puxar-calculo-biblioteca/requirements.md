# Requirements Document

## Introduction

Esta feature traz para o fluxo de criação de orçamento gráfico o comportamento
"Localiza o Cálculo Padrão" que o operador da Carton Wega tinha no Calcgraf: em
vez de montar um orçamento do zero, o operador PUXA um cálculo já existente da
Biblioteca de Cálculos (os 7.951 cálculos migrados) e cria o item do orçamento a
partir dele, por CÓPIA da foto congelada.

Hoje a infraestrutura de busca e de criação de item a partir de cálculo já
existe (rota `POST /api/orcamento-grafico/:id/itens/de-calculo`, busca
`GET /api/calculo-grafico` e o componente `BuscaCalculoModal`), mas só funciona
quando JÁ existe um orçamento. O gap desta feature é de FLUXO/UI: oferecer a
opção de puxar um cálculo LOGO no ponto de criação do orçamento (lista de
Orçamentos Gráficos e/ou tela de novo orçamento), criando o orçamento rascunho
no ato e levando o operador ao detalhe.

O escopo se limita a esse fluxo de reaproveitamento. Não inclui criar cálculo
novo no ato, conferência foto × recálculo, nem alterar o motor de cálculo. Não
toca o PCP.

## Glossary

- **Orcamento_Grafico**: entidade `OrcamentoGrafico` do Vizor (cabeçalho de
  orçamento gráfico), com número sequencial por empresa e status
  (`RASCUNHO | ENVIADO | APROVADO | RECUSADO | VENCIDO`).
- **Item_Orcamento**: entidade `ItemOrcamentoGrafico`, item de engenharia dentro
  de um Orcamento_Grafico.
- **Calculo_Biblioteca**: entidade `CalculoGrafico` da Biblioteca de Cálculos,
  independente do orçamento, contendo a foto congelada (`resultadoCalculo`) e os
  campos de engenharia.
- **Foto_Congelada**: cópia imutável dos campos de engenharia e do
  `resultadoCalculo` de um Calculo_Biblioteca, copiada para o Item_Orcamento sem
  recálculo.
- **Puxar_Calculo**: ação de localizar um Calculo_Biblioteca e criar um
  Orcamento_Grafico com um Item_Orcamento copiado da Foto_Congelada do cálculo.
- **Busca_Calculo**: busca paginada de Calculo_Biblioteca por critérios (cliente,
  linha de produto, produto, descrição, sigla de acabado, nº Calcgraf, nº Vizor).
- **Sistema**: a aplicação Vizor (backend `VisioFab.Wms.Back` e frontend
  `VisioFab.Wms.Front`) no contexto desta feature.
- **Empresa_Id**: identificador de tenant (`empresaId`) usado para isolamento
  multi-empresa.
- **Nova_Quantidade**: tiragem opcional informada ao puxar; quando ausente, o
  Item_Orcamento usa a quantidade do Calculo_Biblioteca.

## Requirements

### Requirement 1: Oferecer "Puxar Cálculo" no ponto de criação

**User Story:** Como operador de orçamento, quero puxar um cálculo da Biblioteca
logo ao criar um orçamento, para reaproveitar um cálculo existente em vez de
montar tudo do zero.

#### Acceptance Criteria

1. WHERE a tela de lista de Orçamentos Gráficos está aberta, THE Sistema SHALL exibir uma ação "Puxar Cálculo" ao lado da ação "Novo Orçamento".
2. WHEN o operador aciona "Puxar Cálculo", THE Sistema SHALL abrir a Busca_Calculo.
3. THE Sistema SHALL manter a ação "Novo Orçamento" em branco disponível como caminho alternativo à ação "Puxar Cálculo".

### Requirement 2: Buscar cálculos na Biblioteca

**User Story:** Como operador de orçamento, quero filtrar os cálculos da
Biblioteca por critérios, para localizar rapidamente o cálculo que vou
reaproveitar.

#### Acceptance Criteria

1. WHEN a Busca_Calculo é aberta, THE Sistema SHALL listar os Calculo_Biblioteca da Empresa_Id corrente de forma paginada.
2. THE Sistema SHALL permitir filtrar a Busca_Calculo por cliente, linha de produto, produto, descrição, sigla de acabado, número Calcgraf e número Vizor.
3. WHEN o operador altera um filtro da Busca_Calculo, THE Sistema SHALL reiniciar a listagem para a primeira página de resultados.
4. WHERE a Busca_Calculo retorna mais resultados que o tamanho de página, THE Sistema SHALL exibir controles de paginação.
5. IF a Busca_Calculo não encontra nenhum Calculo_Biblioteca para os filtros informados, THEN THE Sistema SHALL exibir a indicação de que nenhum cálculo foi encontrado.

### Requirement 3: Criar orçamento e item a partir do cálculo

**User Story:** Como operador de orçamento, quero escolher um cálculo e clicar
"Usar" para já ter um orçamento criado com o item copiado do cálculo, para não
precisar criar o orçamento manualmente antes.

#### Acceptance Criteria

1. WHEN o operador aciona "Usar" sobre um Calculo_Biblioteca a partir do ponto de criação, THE Sistema SHALL criar um Orcamento_Grafico com status RASCUNHO e um Item_Orcamento copiado da Foto_Congelada do Calculo_Biblioteca.
2. WHEN o Sistema cria o Item_Orcamento a partir do Calculo_Biblioteca, THE Sistema SHALL copiar os campos de engenharia e o resultado congelado do cálculo sem executar recálculo.
3. WHEN o Sistema cria o Orcamento_Grafico a partir do Calculo_Biblioteca, THE Sistema SHALL gerar o número do orçamento como o maior número existente da Empresa_Id acrescido de 1.
4. WHEN o Sistema cria o Item_Orcamento a partir do Calculo_Biblioteca, THE Sistema SHALL gravar a referência ao Calculo_Biblioteca de origem no Item_Orcamento.
5. WHEN o Sistema conclui a criação do Orcamento_Grafico a partir do Calculo_Biblioteca, THE Sistema SHALL direcionar o operador para a tela de detalhe do Orcamento_Grafico criado.

### Requirement 4: Herdar dados do cálculo sem exigir cliente

**User Story:** Como operador de orçamento, quero que o orçamento herde o cliente
e o tipo de embalagem do cálculo quando existirem, para não ter que preencher
dados que o cálculo já traz.

#### Acceptance Criteria

1. WHERE o Calculo_Biblioteca possui cliente associado, THE Sistema SHALL preencher o cliente do Orcamento_Grafico com o cliente do Calculo_Biblioteca.
2. WHERE o Calculo_Biblioteca não possui cliente associado, THE Sistema SHALL criar o Orcamento_Grafico sem cliente.
3. WHEN o Sistema cria o Orcamento_Grafico a partir do Calculo_Biblioteca, THE Sistema SHALL preencher o tipo de embalagem do Orcamento_Grafico com o tipo de embalagem do Calculo_Biblioteca.
4. WHEN o Sistema cria o Orcamento_Grafico a partir do Calculo_Biblioteca, THE Sistema SHALL preencher as medidas do Orcamento_Grafico com as medidas da Foto_Congelada do Calculo_Biblioteca.

### Requirement 5: Nova quantidade opcional ao puxar

**User Story:** Como operador de orçamento, quero informar uma tiragem diferente
ao puxar o cálculo, para ajustar a quantidade sem alterar o cálculo original.

#### Acceptance Criteria

1. WHEN a Busca_Calculo é exibida, THE Sistema SHALL oferecer um campo opcional de Nova_Quantidade.
2. WHERE o operador informa Nova_Quantidade maior que zero, THE Sistema SHALL usar a Nova_Quantidade como quantidade do Item_Orcamento criado.
3. WHERE o operador não informa Nova_Quantidade, THE Sistema SHALL usar a quantidade do Calculo_Biblioteca como quantidade do Item_Orcamento criado.

### Requirement 6: Isolamento multi-tenant por empresa

**User Story:** Como responsável pela operação multi-empresa, quero que um
cálculo de outra empresa não possa ser reaproveitado, para manter o isolamento
de dados entre empresas.

#### Acceptance Criteria

1. THE Sistema SHALL filtrar a Busca_Calculo pela Empresa_Id corrente em toda consulta.
2. IF o operador tenta usar um Calculo_Biblioteca inexistente, THEN THE Sistema SHALL responder com erro de recurso não encontrado.
3. IF o operador tenta usar um Calculo_Biblioteca pertencente a outra Empresa_Id, THEN THE Sistema SHALL responder com erro de acesso negado (403) sem criar o orçamento.
4. WHEN o Sistema cria o Orcamento_Grafico e o Item_Orcamento a partir do Calculo_Biblioteca, THE Sistema SHALL gravar a Empresa_Id corrente em ambos os registros.

### Requirement 7: Retorno de erro na criação

**User Story:** Como operador de orçamento, quero uma mensagem clara quando a
criação a partir do cálculo falhar, para entender o que impediu a operação.

#### Acceptance Criteria

1. IF a criação do Orcamento_Grafico a partir do Calculo_Biblioteca falha, THEN THE Sistema SHALL exibir uma mensagem de erro ao operador e não direcionar para a tela de detalhe.
2. IF ocorre colisão de número de Orcamento_Grafico por Empresa_Id durante a criação, THEN THE Sistema SHALL responder com erro de conflito (409) sem persistir orçamento duplicado.
