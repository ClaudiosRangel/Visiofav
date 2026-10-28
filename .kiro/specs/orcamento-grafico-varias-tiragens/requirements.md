# Requirements Document

Várias Tiragens por Item (grade Tiragem × Margem) — paridade Calcgraf (P1)

## Introduction

No Calcgraf, um orçamento/OS calcula de uma vez VÁRIAS tiragens do mesmo item e
exibe uma **grade Tiragem × Margem** no Fechamento (aba "Preço de Venda"): para
cada tiragem (ex.: 5.000 / 10.000 / 50.000) há colunas de Margem%, Margem$,
Valor Unitário, Valor Total, Contribuição Marginal (% e $), "Primeiro Mil" e
"Mil Seguinte". O operador escolhe a faixa de tiragem/margem que define o preço
daquele item. O campo "Tiragens" do item aceita múltiplos valores
(ex.: "5.000,10.000,50.000").

Esta funcionalidade traz esse comportamento ao Vizor. **Decisão de escopo
central (a confirmar com o usuário):** o Vizor JÁ calcula preço por faixa de
tiragem — existem as rotas `POST /orcamento-grafico/simular-tiragens` (nível OS)
e `POST /orcamento-grafico/:id/itens/:itemId/simular-tiragens` (nível item), e o
StepRevisao já exibe um "Comparativo por Tiragem". Portanto a hipótese de
trabalho é que esta spec é majoritariamente de **EXIBIÇÃO da grade + SELEÇÃO da
faixa** (que grava a `quantidade` do item), SEM criar persistência de N tiragens
por item — alinhado ao próprio Calcgraf, que só grava a tiragem SELECIONADA e
recalcula as demais faixas na tela. A persistência de N faixas por item (tabela
nova) fica como alternativa a avaliar no design, apenas se necessário.

Esta feature substitui o antigo workaround "Comparação de Versões" (já ocultado
— ver backlog P8/P11). Documenta requisitos de **backend** (`VisioFab.Wms.Back`)
e **frontend** (`VisioFab.Wms.Front`); na execução cada mudança vai ao repo
correto.

## Glossary

- **Item_Orcamento**: item de um orçamento gráfico (`ItemOrcamentoGrafico`), com
  uma `quantidade` (tiragem) e um resultado de cálculo.
- **Faixa_Tiragem**: uma quantidade candidata para a qual o preço é calculado
  (ex.: 5.000). Um item pode ter várias faixas calculadas para comparação.
- **Grade_Tiragem_Margem**: tabela que cruza cada Faixa_Tiragem com seus valores
  calculados (Margem%, Margem$, Valor Unitário, Valor Total, CM% e CM$, e
  opcionalmente "Primeiro Mil" / "Mil Seguinte").
- **Faixa_Selecionada**: a Faixa_Tiragem escolhida pelo operador, cuja
  quantidade passa a ser a `quantidade` oficial do Item_Orcamento e cujo preço
  vira o preço do item.
- **Simular_Tiragens**: as rotas existentes que calculam, sem persistir, o preço
  de uma lista de quantidades — `POST /orcamento-grafico/simular-tiragens` (OS) e
  `POST /orcamento-grafico/:id/itens/:itemId/simular-tiragens` (item).
- **Primeiro_Mil / Mil_Seguinte**: colunas do Calcgraf que expressam o preço do
  primeiro milheiro e o preço do milheiro adicional (decomposição marginal da
  tiragem).
- **StepRevisao**: passo "Revisão" do wizard de item
  (`.../orcamento-grafico/novo/StepRevisao.tsx`, reusado no `ItemWizardModal`),
  onde hoje já aparece o "Comparativo por Tiragem".
- **Motor_Calculo**: serviço de cálculo do orçamento
  (`orcamento-grafico-calculo.service.ts` / `orcamento-grafico-item.service.ts`).

## Requirements

### Requirement 1: Informar múltiplas faixas de tiragem para um item

**User Story:** Como orçamentista, quero informar várias tiragens para o mesmo
item (ex.: 5.000, 10.000, 50.000), para comparar preço e margem por faixa sem
criar itens/orçamentos separados.

#### Acceptance Criteria

1. WHEN o usuário edita um Item_Orcamento no StepRevisao, THE StepRevisao SHALL permitir informar uma lista de Faixa_Tiragem (múltiplas quantidades) para cálculo comparativo.
2. THE StepRevisao SHALL aceitar no mínimo 1 e no máximo 20 faixas de tiragem (limite já praticado por `Simular_Tiragens`).
3. WHERE o usuário não informa faixas adicionais, THE StepRevisao SHALL usar as faixas automáticas atuais (derivadas da quantidade do item), preservando o comportamento existente.
4. THE StepRevisao SHALL sempre incluir a `quantidade` atual do item entre as faixas exibidas, destacando-a.

### Requirement 2: Exibir a grade Tiragem × Margem

**User Story:** Como orçamentista, quero ver uma grade com uma linha por tiragem
e colunas de margem/valores, para comparar as opções de preço lado a lado.

#### Acceptance Criteria

1. WHEN o cálculo comparativo retorna, THE Grade_Tiragem_Margem SHALL exibir uma linha por Faixa_Tiragem.
2. THE Grade_Tiragem_Margem SHALL exibir, por linha, no mínimo: quantidade, Valor Unitário, Valor Total, Margem (%), e Contribuição Marginal (% e valor).
3. WHERE os valores de "Primeiro Mil" e "Mil Seguinte" puderem ser derivados do cálculo por faixa, THE Grade_Tiragem_Margem SHALL exibi-los como colunas adicionais.
4. THE Grade_Tiragem_Margem SHALL destacar visualmente a Faixa_Selecionada (ou a quantidade atual do item, quando nenhuma faixa foi escolhida ainda).
5. IF o cálculo de uma faixa falhar, THEN THE Grade_Tiragem_Margem SHALL indicar a falha naquela linha sem impedir a exibição das demais.

### Requirement 3: Selecionar a faixa que define o preço do item

**User Story:** Como orçamentista, quero escolher uma das tiragens da grade para
que ela vire a tiragem e o preço oficiais do item, para fechar o orçamento com a
opção escolhida pelo cliente.

#### Acceptance Criteria

1. WHEN o usuário seleciona uma Faixa_Tiragem na grade, THE Item_Orcamento SHALL adotar a quantidade dessa faixa como sua `quantidade`.
2. WHEN a Faixa_Selecionada é definida e o item é salvo, THE Item_Orcamento SHALL persistir a `quantidade` escolhida e o resultado de cálculo correspondente a essa quantidade.
3. THE seleção da faixa SHALL recalcular/atualizar o resultado exibido do item para a quantidade escolhida, mantendo consistência com o valor salvo.
4. WHERE o usuário não seleciona nenhuma faixa, THE Item_Orcamento SHALL manter a `quantidade` atual (nenhuma regressão de comportamento).

### Requirement 4: Reaproveitar o cálculo por faixa já existente

**User Story:** Como mantenedor, quero que a grade use o cálculo por tiragem que
já existe no backend, para não duplicar a lógica de precificação nem arriscar a
paridade com o Calcgraf já calibrada.

#### Acceptance Criteria

1. THE Grade_Tiragem_Margem SHALL obter os valores por faixa a partir das rotas Simular_Tiragens existentes (OS e/ou item), sem reimplementar o Motor_Calculo.
2. WHERE uma coluna exibida (ex.: Primeiro_Mil / Mil_Seguinte) não for retornada hoje pelas rotas Simular_Tiragens, THE design SHALL registrar se o valor é derivado no frontend a partir dos valores por faixa OU adicionado ao retorno do backend, escolhendo a opção de menor risco.
3. THE feature SHALL preservar a paridade de preço já calibrada (o cálculo por faixa continua produzindo os mesmos valores que hoje para uma dada quantidade).

### Requirement 5: Levantar o modelo do Calcgraf e decidir persistência

**User Story:** Como analista, quero que o design registre como o Calcgraf
modela várias tiragens e qual a estratégia de persistência no Vizor, para a
decisão de schema ser baseada em evidência.

#### Acceptance Criteria

1. THE design SHALL registrar como o Calcgraf armazena as tiragens/margens (tabelas `CalculoTiragens`/`CalculoMargens`) e o fato de que só a faixa SELECIONADA é gravada, com as demais recalculadas na tela (conforme steering `migracao-calcgraf-carton-wega`).
2. THE design SHALL decidir entre (a) NÃO persistir N faixas (só a selecionada grava a `quantidade` do item — sem schema novo) ou (b) persistir N faixas por item (tabela nova), recomendando a opção de menor risco que atenda o comportamento do Calcgraf.
3. IF a opção escolhida exigir alteração de schema, THEN THE design e a implementação SHALL seguir a regra de `database-migrations` (alterar `schema.prisma` e `prisma/migrate-prod.ts` no mesmo commit, de forma idempotente, testado 2× localmente).
4. WHERE a opção (a) for suficiente, THE spec SHALL confirmar que NÃO há alteração de schema.

### Requirement 6: Múltiplos itens de tiragem na mesma OS (contexto Calcgraf)

**User Story:** Como orçamentista, quero entender se as "várias tiragens" são por
item ou por OS, para a grade refletir o fluxo real (uma OS com itens
15221/15222/15223).

#### Acceptance Criteria

1. THE design SHALL esclarecer se a grade Tiragem × Margem é por ITEM (cada item com suas faixas) ou pela OS inteira, confirmando com o usuário na fase de requisitos.
2. WHERE o modelo for por item, THE Orcamento_Grafico SHALL continuar suportando múltiplos itens por OS (comportamento multi-item já existente), cada item com sua própria grade/faixa selecionada.
3. THE feature SHALL manter o isolamento multi-tenant por `empresaId` explícito em toda rota/consulta tocada (steering `ATENCAO-pontos-verificar`).
