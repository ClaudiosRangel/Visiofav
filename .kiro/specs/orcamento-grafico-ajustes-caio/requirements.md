# Requirements Document

Ajustes do Orçamento Gráfico (pontos de Caio)

## Introduction

Esta funcionalidade agrupa um conjunto de ajustes, correções e investigações
no módulo de **Orçamento Gráfico** do Vizor, levantados na comparação com o
sistema legado **Calcgraf** (prints enviados + base restaurada). Dos 12 pontos
documentados no handoff `docs/HANDOFF-orcamento-grafico-ajustes-caio.md`, esta
spec cobre **9 pontos**: as entregas rápidas de interface e as
investigações/correções de cálculo e cadastro.

Pontos cobertos nesta spec: **2** (Itens Diversos no cálculo/gravação),
**3** (campos do pré-cálculo que podem faltar), **5** (Matriz de Impressão
pré-preenchida ao puxar cálculo), **6** (validação dos valores reais por
componente), **8** (rótulos das medidas), **9** (de-para do cliente SOL & NEVE /
código Calcgraf), **10** (Editar Cabeçalho enxuto), **11** (ocultar a tela de
Comparação de Versões) e **12** (remover "Repetição de produto" no orçamento
novo).

Ficam **fora** desta spec, para specs dedicadas: ponto **1** (várias tiragens
por item), ponto **4** (restrições/materiais de acabamento) e ponto **7**
(editor completo de custos + preview de encaixe).

Esta spec documenta requisitos de **backend** (repositório `VisioFab.Wms.Back`)
e de **frontend** (repositório `VisioFab.Wms.Front`) em conjunto; na execução,
cada alteração será aplicada ao repositório correto.

## Glossary

- **Orcamento_Grafico**: entidade/módulo do Vizor que representa um orçamento
  de produto gráfico, composta por um cabeçalho e um ou mais itens
  (`ItemOrcamentoGrafico`).
- **Item_Orcamento**: item de um orçamento gráfico, que carrega a engenharia
  (papel, cores, acabamentos, matriz, itens diversos) e o resultado do cálculo.
- **Motor_Calculo**: componente de backend que calcula o custo e o preço do
  item de orçamento (`orcamento-grafico-item.service.ts` /
  `orcamento-grafico-calculo.service.ts`).
- **Itens_Diversos**: custos avulsos adicionados ao item (fixos ou variáveis),
  armazenados em `item_orcamento_grafico.itens_diversos`.
- **Matriz_Impressao**: clichê/matriz de impressão com quantidade e preço
  unitário, armazenada nos campos `matrizQuantidade` e `matrizPrecoUnitario`
  do item.
- **Puxar_Calculo**: ação de criar um item/orçamento a partir de um cálculo
  existente da Biblioteca de Cálculos, copiando a foto do Calcgraf
  (`POST /orcamento-grafico/de-calculo` e `.../itens/de-calculo`).
- **StepMedidas**: passo "Medidas" do wizard de novo orçamento
  (`VisioFab.Wms.Front/src/app/(interna)/orcamento-grafico/novo/StepMedidas.tsx`).
- **StepCliente**: passo "Cliente" do wizard de novo orçamento
  (`.../novo/StepCliente.tsx`).
- **StepRevisao**: passo "Revisão" do wizard, que exibe a prévia do cálculo
  e dispara `POST /orcamento-grafico/calcular`.
- **Tela_Detalhe_Orcamento**: página de detalhe do orçamento
  (`.../orcamento-grafico/[id]/page.tsx`).
- **Editar_Cabecalho**: ação, na Tela_Detalhe_Orcamento, de editar os dados de
  cabeçalho do orçamento.
- **Comparacao_Versoes**: tela/recurso que compara versões do orçamento por
  quantidade (workaround antigo de "várias tiragens").
- **Pre_Calculo_Calcgraf**: memória/emissão de pré-cálculo do Calcgraf usada
  como referência de valores reais (ex.: cálculo 15466 / orçamento 5521).
- **Codigo_Calcgraf**: código numérico do cliente no Calcgraf (ex.: 13 para
  "SOL & NEVE"), distinto do de-para por CNPJ usado hoje.

## Requirements

### Requirement 1: Itens Diversos no cálculo da Revisão e na gravação (ponto 2)

**User Story:** Como orçamentista, quero que os Itens Diversos informados em um
orçamento novo sejam considerados no cálculo da Revisão e gravados ao salvar,
para que o Custo de Produção reflita todos os custos avulsos informados.

#### Acceptance Criteria

1. WHEN o StepRevisao solicita a prévia de cálculo de um orçamento novo, THE StepRevisao SHALL incluir os Itens_Diversos informados no corpo enviado a `POST /orcamento-grafico/calcular`.
2. WHEN a rota `POST /orcamento-grafico/calcular` recebe Itens_Diversos no corpo, THE Motor_Calculo SHALL somar os Itens_Diversos ao Custo de Produção do resultado retornado.
3. WHEN um Item_Orcamento com Itens_Diversos é salvo, THE Orcamento_Grafico SHALL persistir os Itens_Diversos no campo `item_orcamento_grafico.itens_diversos`.
4. WHEN um Item_Orcamento previamente salvo com Itens_Diversos é recarregado, THE Orcamento_Grafico SHALL retornar os mesmos Itens_Diversos que foram persistidos.
5. IF um orçamento novo não possui Itens_Diversos, THEN THE Motor_Calculo SHALL calcular o Custo de Produção com o mesmo resultado do comportamento atual.

### Requirement 2: Levantamento dos campos do pré-cálculo (ponto 3)

**User Story:** Como analista de paridade, quero um levantamento de quais campos
do pré-cálculo do Calcgraf já existem no Vizor e quais faltam, para que
decisões de persistência e exibição sejam tomadas com base em dados concretos.

#### Acceptance Criteria

1. THE levantamento SHALL comparar os campos do Pre_Calculo_Calcgraf (Formato Final, Programação de Entrega "a combinar", Repetição TR, Corte/Formato/Aproveitamento por plano, Quebra percentual, Apara percentual, Produção por Hora, Prazos de Produção/Armazenagem/Pagamento/Financiamento, Condição de Pagamento) com os campos persistidos em `ItemOrcamentoGrafico` e em `resultadoCalculo`.
2. THE levantamento SHALL classificar cada campo comparado como "já persistido", "persistido parcialmente" ou "ausente" no Vizor.
3. WHERE um campo é classificado como ausente ou parcial, THE levantamento SHALL registrar a decisão de tratamento como persistir, exibir a partir da foto, ou adiar.
4. THE levantamento SHALL ser registrado no documento de design desta spec antes da criação das tarefas.

### Requirement 3: Matriz de Impressão preenchida ao puxar cálculo (ponto 5)

**User Story:** Como orçamentista, quero que a Matriz de Impressão venha
preenchida ao puxar um cálculo existente, para que a quantidade e o preço da
matriz entrem no Material Direto sem digitação manual.

#### Acceptance Criteria

1. WHEN um Item_Orcamento é criado por Puxar_Calculo e o cálculo de origem possui matriz de impressão, THE Orcamento_Grafico SHALL preencher `matrizQuantidade` e `matrizPrecoUnitario` do item com os valores do cálculo de origem.
2. WHEN um Item_Orcamento possui `matrizQuantidade` maior que zero e `matrizPrecoUnitario` maior que zero, THE Motor_Calculo SHALL somar o produto de `matrizQuantidade` por `matrizPrecoUnitario` ao Material Direto.
3. WHEN a Tela_Detalhe_Orcamento exibe um Item_Orcamento com matriz preenchida, THE Tela_Detalhe_Orcamento SHALL exibir a quantidade de matrizes e o preço unitário da matriz.
4. IF o cálculo de origem não possui matriz de impressão, THEN THE Orcamento_Grafico SHALL manter `matrizQuantidade` e `matrizPrecoUnitario` com valor zero.

### Requirement 4: Validação dos valores reais por componente (ponto 6)

**User Story:** Como analista de paridade, quero conferir que os valores por
componente do orçamento batem com o pré-cálculo do Calcgraf, para que o
orçamento exiba números reais e confiáveis.

#### Acceptance Criteria

1. THE validação SHALL comparar, para os casos de referência 15466 (orçamento 5521) e 15221/15222/15223, o valor do papel por quilograma, o valor da tinta por cor e o valor dos acabamentos entre o Vizor e o Pre_Calculo_Calcgraf.
2. WHEN a comparação de um componente apresenta divergência superior a 0,5 por cento em relação ao Pre_Calculo_Calcgraf, THE validação SHALL registrar o componente divergente e a causa provável.
3. THE validação SHALL registrar o resultado da comparação no documento de design desta spec.
4. WHERE uma divergência decorre de dado ausente no item puxado, THE validação SHALL identificar o campo ausente e a origem do valor correto em `CalculoSTC` ou na foto rica.

### Requirement 5: Rótulos das medidas (ponto 8)

**User Story:** Como orçamentista, quero que os rótulos dos campos de medida no
StepMedidas estejam corretos, para que eu informe comprimento, largura e altura
sem ambiguidade.

#### Acceptance Criteria

1. THE StepMedidas SHALL rotular os três campos de medida como "Comprimento", "Largura" e "Altura", nessa ordem.
2. THE StepMedidas SHALL substituir o rótulo duplicado "Largura" atualmente exibido, de modo que nenhum rótulo de medida apareça repetido.
3. WHEN o StepMedidas altera apenas os rótulos exibidos, THE StepMedidas SHALL manter o mapeamento dos valores para os mesmos campos de dados usados hoje pelo Motor_Calculo.

### Requirement 6: De-para do cliente com código Calcgraf (ponto 9)

**User Story:** Como analista de cadastro, quero verificar se o cliente
"SOL & NEVE" existe no Vizor e como o código Calcgraf se relaciona ao cadastro,
para que o de-para de cliente no Puxar_Calculo seja confiável.

#### Acceptance Criteria

1. THE investigação SHALL verificar se existe no Vizor um cliente correspondente a "SOL & NEVE" com Codigo_Calcgraf 13.
2. THE investigação SHALL confirmar se o de-para de cliente no Puxar_Calculo é resolvido por CNPJ normalizado.
3. WHERE o cliente "SOL & NEVE" não possui CNPJ no cadastro de origem, THE investigação SHALL registrar a razão pela qual o de-para por CNPJ não o resolve.
4. THE investigação SHALL registrar no documento de design a conclusão sobre a relevância do Codigo_Calcgraf 13 para o de-para.

### Requirement 7: Editar Cabeçalho enxuto (ponto 10)

**User Story:** Como orçamentista, quero que "Editar Cabeçalho" permita alterar
apenas o cliente e o representante/vendedor, para que o ajuste do cabeçalho seja
rápido e não reabra o wizard inteiro.

#### Acceptance Criteria

1. WHEN o usuário aciona Editar_Cabecalho na Tela_Detalhe_Orcamento, THE Tela_Detalhe_Orcamento SHALL exibir um formulário que permite editar somente o cliente e o representante/vendedor.
2. WHEN o usuário confirma a edição do cabeçalho, THE Orcamento_Grafico SHALL atualizar somente o cliente e o representante/vendedor do orçamento.
3. THE Editar_Cabecalho SHALL preservar inalterados os demais dados do orçamento, incluindo tipo de embalagem, medidas, itens e resultado do cálculo.
4. IF o usuário aciona Editar_Cabecalho de um orçamento de outra empresa, THEN THE Orcamento_Grafico SHALL recusar a atualização e manter o orçamento inalterado.

### Requirement 8: Ocultar a tela de Comparação de Versões (ponto 11)

**User Story:** Como gestor do produto, quero ocultar a tela de Comparação de
Versões por enquanto, para que os usuários não acessem um recurso que será
substituído pelo conceito de várias tiragens por item.

#### Acceptance Criteria

1. THE interface SHALL ocultar o ponto de acesso, menu ou botão, à Comparacao_Versoes.
2. WHILE a Comparacao_Versoes está oculta, THE interface SHALL manter acessíveis as demais ações da Tela_Detalhe_Orcamento.
3. THE ocultação SHALL preservar o código da Comparacao_Versoes sem remoção, de modo que a tela possa ser reexibida posteriormente.

### Requirement 9: Remover "Repetição de produto" no orçamento novo (ponto 12)

**User Story:** Como orçamentista, quero que o campo "Repetição de produto" não
apareça ao criar um orçamento do zero, para que o fluxo de orçamento novo não
ofereça uma opção que só faz sentido na reimpressão.

#### Acceptance Criteria

1. WHILE o wizard está no fluxo de orçamento novo, THE StepCliente SHALL ocultar o campo "Repetição de produto".
2. WHEN o StepCliente oculta o campo "Repetição de produto", THE StepCliente SHALL permitir a conclusão do passo sem informar `produtoId`.
3. WHERE o fluxo é de repetição de produto, THE StepCliente SHALL exibir o campo "Repetição de produto".
