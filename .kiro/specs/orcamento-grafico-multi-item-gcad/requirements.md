# Requirements Document

## Introduction

Esta spec evolui o módulo de **Orçamento Gráfico** do Vizor (ERP gráfico da Carton
Wega) para que o Vizor passe a **gerar** orçamentos gráficos fiéis ao sistema
legado Calcgraf/GPrint, **sem depender de importação**. O objetivo-mestre é que o
Orçamento Gráfico do Vizor reproduza o pré-cálculo do Calcgraf **componente a
componente** (Suporte, Matriz de Impressão, Tinta, Material de Acabamento,
Impressão, Acabamento) e os totais (MD, CT, Servex, Custo de Produção, Custo
Financeiro, Total, CEV, Margem/Contribuição Marginal/Unitário/Total por tiragem),
com tolerância verificável, validada por golden cases congelados como testes.

Hoje o motor de cálculo puro (`orcamento-grafico-calculo.service.ts`) já reproduz
o golden de item único (15.235) nos testes automatizados (desvio ≤0,5%). O que
falta é a **estrutura em volta** e os ajustes de tela que afetam o resultado:

1. **Orçamento multi-item** — hoje um `OrcamentoGrafico` é 1 item; precisa virar
   cabeçalho (Série, Nº, Data, Cliente Principal, Status) + lista de itens, onde
   cada item é um cálculo próprio com fechamento próprio, e o orçamento consolida.
2. **Catálogo de Facas/Modelos (GCad)** — cadastro de facas/modelos reais que, ao
   serem selecionados num item, preenchem geometria e imposição/encaixe reais
   (resolve a divergência de 3 vs 4 peças por folha do cálculo geométrico atual).
3. **Restrições por atividade de acabamento** — sub-opções de cada atividade de
   acabamento (ex.: coladeira "Lateral Simples" vs "Fundo Automático Normal") que
   alteram o acerto/tempo e, portanto, o Custo de Transformação.
4. **Ajustes de calibração do 15.235** que afetam o resultado na tela — seletor de
   máquina de impressão, preço de materiais de acabamento, matriz de impressão no
   MD, tinta por cobertura ou consumo direto, validação sempre com tiragem 20.000.
5. **UI para Itens Diversos, Itens Fornecidos e Campos Livres** no item (o motor já
   suporta; falta expor na tela).

O trabalho é organizado em cinco fases: Fase 1 estrutura multi-item; Fase 2
GCad/encaixe real; Fase 3 restrições de acabamento; Fase 4 ajustes de calibração e
UI; Fase 5 validação golden. Um requisito transversal crítico (fidelidade ao
Calcgraf) atravessa todas as fases, com golden cases 15.235 (item único) e 15.185
(multi-item) congelados como testes.

Restrições técnicas do projeto que atravessam toda a spec: multi-tenant por
`empresaId`; toda alteração de `prisma/schema.prisma` com equivalente idempotente
em `prisma/migrate-prod.ts` no mesmo commit; enums gravados como VARCHAR;
aditividade/não-regressão (o motor puro atual continua batendo o golden de item
único e a suíte `orcamento-grafico` permanece verde); e propriedades de correção
executáveis (property-based testing).

## Glossary

- **Vizor**: ERP gráfico multi-tenant alvo desta migração, usado pela Carton Wega.
- **Calcgraf / GPrint**: sistema legado (desktop Delphi, PHTech) de orçamento/OP
  gráfico que a Carton Wega opera hoje e cujo resultado o Vizor deve reproduzir.
- **Orçamento (cabeçalho)**: entidade que agrupa dados comerciais comuns (Série,
  Número, Data, Cliente Principal, Status) e uma lista de itens. Equivale ao
  "Orçamento" do Calcgraf (ex.: nº 5.377).
- **Item de Orçamento**: um cálculo gráfico próprio dentro de um orçamento, com
  Linha de Produto, suporte, cores, acabamentos, tiragem e fechamento próprios.
  Equivale ao "Cálculo" do Calcgraf (ex.: 15.235).
- **Linha de Produto / Tipo de Embalagem**: família de produto (CARTUCHO, CARTUCHO
  COMPOSTO, LÂMINA SIMPLES, LÂMINAS, SACOLA) que determina a geometria/planificação
  do item. No Vizor corresponde a `TipoEmbalagem`.
- **Imposição / Encaixe**: arranjo das peças (poses) dentro da folha de impressão,
  incluindo linhas e colunas. Determina quantas peças saem por folha.
- **Step-and-repeat**: repetição da peça em grade na folha (ex.: TR 2x2 = duas por
  duas), usada para montar a imposição.
- **GCad / Faca (Modelo)**: cadastro de uma faca/gabarito técnico real, com cliente,
  modelo, serviço, dimensões, repetição/encaixe, formato de corte, tipo de cartucho,
  suporte e gramatura. Selecionar um modelo preenche a geometria e o encaixe reais
  do item.
- **Formato de Corte**: dimensão da folha de corte do modelo/faca (ex.: 605 x 620).
- **Restrição de Acabamento**: sub-opção de uma atividade de acabamento que altera o
  acerto/tempo e o custo (ex.: na coladeira AFT70: "Lateral Simples", "Fundo
  Automático Normal", "Acerto Acoplado Colagem Lateral", "Acerto Trocando Versão").
- **Suporte**: substrato/papel-cartão do item (ex.: DUPLEX 280), com coeficiente de
  tinta (CoefTinta) usado no modelo de consumo de tinta.
- **MD (Material Direto)**: soma dos materiais diretos do item (Suporte + Matriz de
  Impressão + Tinta + Material de Acabamento). Corresponde ao agrupamento 2 do
  Calcgraf.
- **CT (Custo de Transformação)**: soma dos custos de máquina (Impressão +
  Acabamentos), tempo fixo (acerto) + tempo variável (produção) × custo-hora.
  Corresponde ao agrupamento 1 do Calcgraf.
- **Servex (Serviços Externos)**: custos de serviços terceirizados. Agrupamento 3 do
  Calcgraf.
- **Custo de Produção (C.Prod)**: MD + CT + Servex.
- **C.Finan (Custo Financeiro)**: encargo financeiro aplicado sobre o Custo de
  Produção em função do prazo (ex.: 0,13%).
- **CEV (Custos de Venda)**: percentuais incidentes sobre o preço de venda (ICMS,
  Juros, PIS/COFINS, Comissões).
- **Margem**: markup percentual aplicado para formar o preço de venda.
- **C.Marg (Contribuição Marginal)**: percentual e valor da contribuição marginal
  por tiragem no fechamento.
- **Fechamento**: resultado comercial de um item por tiragem (Margem, C.Marg,
  Unitário, Total). No multi-item, o fechamento é por item e o orçamento soma.
- **Gross-up**: método de formação de preço por divisor único,
  `preço = custoBase / (1 − margem% − CEV%)`.
- **Golden case**: cálculo real do Calcgraf (entrada → saída) usado como teste
  congelado de fidelidade. Casos de referência: 15.235 (item único) e 15.185
  (multi-item).
- **Itens Diversos**: custos avulsos/fixos do item que não escalam com a tiragem
  (ex.: FACA NOVA, CLICHÊS HOT).
- **Itens Fornecidos**: material fornecido pelo cliente, não cobrado como material
  direto.
- **Campos Livres**: campos textuais do item (ex.: ARTE, PADRÃO).
- **Tiragem**: quantidade de peças a produzir (ex.: 20.000).
- **Aproveitamento / poses por folha**: número de peças obtidas por folha segundo a
  imposição.
- **Não-regressão (aditividade)**: garantia de que as mudanças de estrutura não
  alteram o resultado de orçamentos de item único já suportados pelo motor puro.

## Requirements

### Fase 1 — Estrutura Multi-Item

### Requirement 1: Cabeçalho de Orçamento com Lista de Itens

**User Story:** Como vendedor da Carton Wega, quero que um orçamento gráfico tenha
um cabeçalho comercial e uma lista de itens de cálculo, para reproduzir a estrutura
"Orçamento = N itens" do Calcgraf em um único documento.

#### Acceptance Criteria

1. THE Orcamento_Grafico SHALL armazenar um cabeçalho com os campos Série (texto de 1 a 10 caracteres), Número (inteiro maior ou igual a 1), Data, Cliente Principal e Status, onde Status assume exatamente um dos valores RASCUNHO, ABERTO, APROVADO, REPROVADO ou CANCELADO.
2. THE Orcamento_Grafico SHALL conter uma lista de 0 a 999 Itens de Orçamento, cada um com Linha de Produto, suporte, cores, acabamentos, tiragem e fechamento próprios.
3. WHEN o vendedor cria um novo orçamento, THE Orcamento_Grafico SHALL atribuir ao cabeçalho um Número inteiro único dentro do escopo da empresa e inicializar o Status como RASCUNHO.
4. IF o vendedor cria um novo orçamento e o Número gerado já existe para a mesma empresa, THEN THE Orcamento_Grafico SHALL rejeitar a criação, preservar os orçamentos existentes e retornar um erro indicando conflito de Número, sem persistir o cabeçalho duplicado.
5. WHEN o vendedor adiciona um Item de Orçamento a um orçamento existente, THE Orcamento_Grafico SHALL vincular o item ao cabeçalho e atribuir ao item um identificador de sequência inteiro único dentro do orçamento, igual ao maior identificador de sequência existente no orçamento mais 1.
6. WHEN o vendedor remove um Item de Orçamento de um orçamento, THE Orcamento_Grafico SHALL excluir o item e recalcular os totais consolidados do orçamento, zerando os totais consolidados quando o orçamento ficar sem itens.
7. THE Orcamento_Grafico SHALL filtrar toda leitura e escrita de orçamentos e itens pelo `empresaId` da entidade de negócio.

### Requirement 2: Cálculo e Fechamento por Item

**User Story:** Como vendedor, quero que cada item do orçamento tenha seu próprio
cálculo e fechamento por tiragem, para que cada peça seja precificada individualmente
como no Calcgraf.

#### Acceptance Criteria

1. WHEN o cálculo de um Item de Orçamento é disparado, THE Item_Orcamento SHALL calcular MD, CT, Servex, Custo de Produção, Custo Financeiro e Total usando exclusivamente os parâmetros do próprio item, sem que os valores calculados sejam alterados por nenhum outro item do mesmo orçamento.
2. WHEN o cálculo de um Item de Orçamento conclui, THE Item_Orcamento SHALL produzir um fechamento próprio para cada tiragem configurada no item, contendo Margem%, Margem$, C.Marg%, C.Marg$, Valor Unitário e Valor Total.
3. WHEN um ou mais parâmetros de um Item de Orçamento são alterados, THE Item_Orcamento SHALL recalcular apenas o fechamento desse item, mantendo inalterados os valores de fechamento de todos os demais itens do orçamento.
4. WHEN o cálculo de um Item de Orçamento é disparado E a soma (margem% + CEV%) é menor que 100%, THE Item_Orcamento SHALL formar o preço de venda por gross-up aplicando `preço = custoBase / (1 − margem% − CEV%)`.
5. IF a soma (margem% + CEV%) de um Item de Orçamento é maior ou igual a 100%, THEN THE Item_Orcamento SHALL rejeitar o cálculo, preservar os valores de fechamento anteriores do item e retornar uma indicação de erro informando que o denominador do gross-up é inválido.

### Requirement 3: Consolidação do Orçamento

**User Story:** Como vendedor, quero que o orçamento consolide os valores de todos os
seus itens, para apresentar ao cliente um total único coerente com a soma dos itens.

#### Acceptance Criteria

1. THE Orcamento_Grafico SHALL calcular o Valor Total consolidado como a soma, com arredondamento a duas casas decimais, dos Valores Totais de fechamento de todos os seus itens, considerando para cada item o Valor Total da margem selecionada daquele item.
2. THE Orcamento_Grafico SHALL calcular o Custo de Produção consolidado como a soma, com arredondamento a duas casas decimais, dos Custos de Produção de todos os seus itens.
3. WHILE um orçamento não possui nenhum Item de Orçamento, THE Orcamento_Grafico SHALL apresentar o Valor Total consolidado e o Custo de Produção consolidado iguais a 0,00.
4. WHEN um Item de Orçamento é adicionado, tem seus parâmetros alterados ou é removido, THE Orcamento_Grafico SHALL recalcular, na mesma operação, o Valor Total consolidado e o Custo de Produção consolidado antes de retornar o orçamento.
5. FOR ALL orçamentos, a diferença absoluta entre a soma dos Valores Totais de fechamento dos itens (cada um na margem selecionada do item) e o Valor Total consolidado do orçamento SHALL ser menor ou igual a 0,01.

### Requirement 4: Compatibilidade e Não-Regressão de Item Único

**User Story:** Como responsável técnico, quero que orçamentos de um único item
existentes continuem funcionando sem alteração de resultado, para que a migração
estrutural não quebre dados nem a calibração já congelada.

#### Acceptance Criteria

1. WHERE um orçamento possui exatamente um item, THE Orcamento_Grafico SHALL produzir, para o mesmo conjunto de parâmetros, valores de MD, CT, Servex, Custo de Produção, Custo Financeiro, Total e cada campo de fechamento (Margem%, Margem$, C.Marg%, C.Marg$, Valor Unitário e Valor Total) iguais aos produzidos pelo motor puro atual, considerados iguais quando coincidem até a segunda casa decimal.
2. WHERE os campos introduzidos por esta spec (itens múltiplos, modelo GCad e restrições de acabamento) estão ausentes ou nulos em um item, THE Motor_Calculo SHALL produzir resultado igual campo a campo (MD, CT, Servex, Custo de Produção, Custo Financeiro, Total e fechamento) ao resultado do motor puro congelado, considerados iguais quando coincidem até a segunda casa decimal.
3. WHEN a suíte de testes `orcamento-grafico` é executada após as alterações estruturais, THE Suite_Testes SHALL manter aprovados todos os testes que estavam aprovados no estado imediatamente anterior às alterações, sem nenhum teste novo em falha.
4. WHEN o usuário abre um orçamento de item único já existente na base, THE Orcamento_Grafico SHALL carregar o orçamento sem erro e exibir seus itens e fechamento.
5. WHEN o usuário edita e salva um orçamento de item único já existente, THE Orcamento_Grafico SHALL persistir a alteração e preservar os dados não editados do orçamento.
6. IF um orçamento de item único pré-existente não possui os campos de cabeçalho ou de estrutura multi-item introduzidos por esta spec, THEN THE Orcamento_Grafico SHALL tratá-lo como orçamento de um único item aplicando valores default para os campos ausentes, sem alterar os valores de MD, CT, Servex, Custo de Produção, Custo Financeiro, Total e fechamento do item.

### Fase 2 — Catálogo de Facas / Modelos (GCad)

### Requirement 5: Cadastro de Modelos/Facas (GCad)

**User Story:** Como preparador/orçamentista, quero cadastrar modelos/facas reais com
suas dimensões e encaixe, para selecioná-los nos itens e usar a imposição real em vez
da planificação esquemática.

#### Acceptance Criteria

1. THE Catalogo_GCad SHALL permitir cadastrar um Modelo com os campos Cliente, Modelo, Serviço, Dimensões (largura e altura em milímetros, cada uma maior que 0), Repetição/Encaixe (número de linhas e número de colunas, cada um inteiro maior ou igual a 1), Formato de Corte (largura e altura em milímetros, cada uma maior que 0), Tipo Cartucho, Suporte e Gramatura.
2. THE Catalogo_GCad SHALL fornecer operações de criação, leitura, atualização e exclusão de Modelos, filtradas por `empresaId`.
3. WHEN o orçamentista filtra Modelos por Cliente ou por Modelo, THE Catalogo_GCad SHALL retornar os Modelos da empresa cujo Cliente ou Modelo contém o termo informado, em correspondência parcial e sem distinção de maiúsculas e minúsculas.
4. IF um Modelo é cadastrado ou atualizado com qualquer um dos campos obrigatórios (Cliente, Modelo, Serviço, Dimensões, Repetição/Encaixe, Formato de Corte, Tipo Cartucho, Suporte, Gramatura) ausente ou vazio, THEN THE Catalogo_GCad SHALL rejeitar a operação, preservar o registro existente e retornar uma mensagem indicando o campo obrigatório ausente.
5. IF o número de linhas ou o número de colunas da Repetição/Encaixe é menor que 1, ou qualquer dimensão informada é menor ou igual a 0, THEN THE Catalogo_GCad SHALL rejeitar a operação e retornar uma mensagem indicando o campo com valor inválido.
6. IF o orçamentista solicita a exclusão de um Modelo que está vinculado a pelo menos um Item de Orçamento, THEN THE Catalogo_GCad SHALL rejeitar a exclusão, preservar o Modelo e retornar uma mensagem indicando a existência de vínculo.

### Requirement 6: Seleção de Modelo Preenche Geometria e Encaixe Reais

**User Story:** Como orçamentista, quero selecionar um modelo do GCad num item para
que a geometria e o encaixe reais sejam preenchidos automaticamente, resolvendo a
divergência de peças por folha do cálculo geométrico.

#### Acceptance Criteria

1. WHEN o orçamentista seleciona um Modelo do GCad em um Item de Orçamento, THE Item_Orcamento SHALL sobrescrever as dimensões, a repetição/encaixe, o formato de corte e o suporte do item com os valores do Modelo selecionado.
2. WHEN o orçamentista seleciona um Modelo do GCad em um Item de Orçamento, THE Item_Orcamento SHALL recalcular o fechamento do item com a geometria e o encaixe do Modelo.
3. WHERE um Item de Orçamento tem um Modelo do GCad selecionado, THE Motor_Calculo SHALL usar o aproveitamento (poses por folha) igual ao produto do número de linhas pelo número de colunas da repetição/encaixe do Modelo para calcular o número de folhas e o consumo de suporte.
4. WHERE um Item de Orçamento não tem Modelo do GCad selecionado, THE Motor_Calculo SHALL usar o cálculo geométrico de encaixe atual (comportamento legado), produzindo o mesmo resultado do motor puro congelado.
5. FOR ALL itens com Modelo do GCad selecionado, o número de peças por folha calculado SHALL ser igual ao produto do número de linhas pelo número de colunas da repetição/encaixe do Modelo.
6. FOR ALL itens com Modelo do GCad selecionado, a área total ocupada pelas poses da imposição SHALL ser menor ou igual à área da folha do formato de corte, admitida uma folga de no máximo 0,5% da área da folha.
7. IF o Modelo selecionado possui número de linhas ou de colunas menor ou igual a 0, THEN THE Item_Orcamento SHALL rejeitar a seleção, preservar o estado anterior do item e retornar uma mensagem indicando o encaixe inválido.

### Fase 3 — Restrições por Atividade de Acabamento

### Requirement 7: Restrições (Sub-opções) por Atividade de Acabamento

**User Story:** Como orçamentista, quero escolher a restrição aplicável de cada
atividade de acabamento, para que o acerto e o tempo reflitam a sub-opção escolhida e
o Custo de Transformação bata com o Calcgraf.

#### Acceptance Criteria

1. THE Cadastro_Acabamento SHALL permitir associar a uma atividade de acabamento uma lista de zero ou mais Restrições, cada uma com nome de no mínimo 1 e no máximo 100 caracteres, um tempo de acerto em minutos de 0 a 999 e um tempo de operação em minutos de 0 a 999, ambos valores não negativos.
2. THE Cadastro_Acabamento SHALL registrar, para cada atividade de acabamento, um indicador booleano que define se a atividade exige a escolha de uma Restrição, com valor padrão falso.
3. WHEN o orçamentista seleciona uma atividade de acabamento que possui ao menos uma Restrição em um item, THE Item_Orcamento SHALL exibir, em até 2 segundos, as Restrições disponíveis daquela atividade para seleção, ordenadas por nome em ordem crescente.
4. WHEN o orçamentista seleciona uma Restrição de uma atividade de acabamento, THE Motor_Calculo SHALL aplicar o tempo de acerto e o tempo de operação da Restrição selecionada e recalcular o Custo de Transformação daquela atividade.
5. WHERE uma atividade de acabamento selecionada não possui nenhuma Restrição, THE Motor_Calculo SHALL aplicar o tempo de acerto e o tempo de operação padrão da atividade.
6. IF uma atividade de acabamento cujo indicador de exigência de Restrição é verdadeiro é selecionada em um item sem uma Restrição escolhida, THEN THE Item_Orcamento SHALL marcar o item como pendente com uma indicação visível de Restrição ausente, preservar os demais parâmetros já informados do item e impedir o fechamento do item até que uma Restrição seja escolhida.

### Fase 4 — Ajustes de Calibração e UI

### Requirement 8: Seletor de Máquina de Impressão

**User Story:** Como orçamentista, quero escolher a máquina de impressão do item,
para que o cálculo use a máquina correta (ex.: KBA-75-6) em vez da primeira máquina
por posição.

#### Acceptance Criteria

1. THE Item_Orcamento SHALL permitir selecionar a máquina de impressão entre as máquinas do tipo IMPRESSÃO com status ativo cadastradas na empresa do item, filtradas por `empresaId`.
2. WHEN o orçamentista seleciona ou troca a máquina de impressão de um item, THE Item_Orcamento SHALL persistir o identificador da máquina selecionada vinculado ao item e recalcular o fechamento daquele item com a máquina escolhida.
3. WHERE uma máquina de impressão está selecionada em um item, THE Motor_Calculo SHALL usar o acerto por cor e o custo-hora da máquina selecionada no cálculo da Impressão.
4. IF um item cujo número de cores de impressão é maior ou igual a 1 não tem máquina de impressão selecionada, THEN THE Item_Orcamento SHALL sinalizar a pendência ao orçamentista e impedir o fechamento até que uma máquina seja selecionada.
5. IF não existe nenhuma máquina do tipo IMPRESSÃO com status ativo cadastrada na empresa do item, THEN THE Item_Orcamento SHALL impedir a seleção, apresentar uma indicação de que não há máquina de impressão ativa disponível e impedir o fechamento do item.
6. IF a máquina de impressão selecionada não possui acerto por cor ou custo-hora cadastrados, THEN THE Item_Orcamento SHALL sinalizar a pendência ao orçamentista, preservar a seleção do item e impedir o fechamento até que os parâmetros estejam cadastrados.

### Requirement 9: Preço dos Materiais de Acabamento

**User Story:** Como orçamentista, quero que os materiais de acabamento (Cola, Verniz,
Caixa Padrão) tenham preço definido, para que o Material Direto fique completo e bata
com o Calcgraf.

#### Acceptance Criteria

1. THE Cadastro_Acabamento SHALL permitir registrar o preço unitário de um material de acabamento classificado como material por quilograma ou material por unidade, armazenando o preço unitário como valor maior que 0 e menor ou igual a 999.999.999,99, com precisão de duas casas decimais.
2. IF o orçamentista tenta registrar um material de acabamento com preço unitário ausente, menor ou igual a 0, ou fora do intervalo de 0,01 a 999.999.999,99, THEN THE Cadastro_Acabamento SHALL rejeitar o registro, preservar o valor anterior do cadastro e retornar uma mensagem indicando o campo de preço unitário inválido.
3. WHERE um material de acabamento tem preço unitário cadastrado, THE Motor_Calculo SHALL usar o preço unitário do cadastro no cálculo do Material Direto.
4. WHERE um material de acabamento não tem preço unitário cadastrado, THE Item_Orcamento SHALL permitir que o orçamentista informe o consumo (em quilogramas para material por quilograma, ou em unidades para material por unidade) e o preço unitário na tela do item, ambos como valores maiores que 0, menores ou iguais a 999.999.999,99 e com precisão de duas casas decimais.
5. IF o orçamentista informa consumo ou preço unitário de um material de acabamento no item com valor ausente, menor ou igual a 0, ou fora do intervalo de 0,01 a 999.999.999,99, THEN THE Item_Orcamento SHALL sinalizar o campo inválido e impedir o fechamento do item até que valores válidos sejam informados.
6. WHEN o orçamentista informa consumo e preço unitário de um material de acabamento no item, THE Motor_Calculo SHALL usar os valores informados no item com precedência sobre o preço do cadastro.
7. THE Motor_Calculo SHALL incluir no Material Direto do item o custo de cada material de acabamento igual ao consumo multiplicado pelo preço unitário aplicável, arredondado a duas casas decimais.

### Requirement 10: Matriz de Impressão no Material Direto

**User Story:** Como orçamentista, quero que a matriz de impressão seja contabilizada
no Material Direto, para reproduzir o pré-cálculo do Calcgraf, onde a matriz entra no
MD.

#### Acceptance Criteria

1. THE Item_Orcamento SHALL permitir informar a matriz de impressão com uma quantidade maior que zero e um preço unitário maior ou igual a zero.
2. IF a matriz de impressão é informada com quantidade menor ou igual a zero ou com preço unitário negativo, THEN THE Item_Orcamento SHALL rejeitar a entrada, preservar o valor anterior da matriz e retornar uma mensagem indicando o campo inválido.
3. WHEN a matriz de impressão é informada com quantidade e preço unitário válidos, THE Motor_Calculo SHALL calcular o custo da matriz como o produto da quantidade pelo preço unitário e incluí-lo no Material Direto do item.
4. WHILE um item possui matriz de impressão informada, THE Motor_Calculo SHALL tratar o custo da matriz como custo fixo por ocorrência, mantendo-o constante para qualquer tiragem de 1 a 100.000.000 peças.
5. WHERE um Item de Orçamento não possui matriz de impressão informada, THE Motor_Calculo SHALL manter o Material Direto do item sem qualquer parcela de matriz de impressão.

### Requirement 11: Tinta por Cobertura ou Consumo Direto

**User Story:** Como orçamentista, quero informar a tinta por cobertura (modelo SPANKS)
ou por consumo direto, para calibrar o consumo de tinta de acordo com o caso.

#### Acceptance Criteria

1. THE Item_Orcamento SHALL permitir informar a tinta em exatamente um de dois modos mutuamente exclusivos por item: por cobertura percentual (valor de 0 a 100) ou por consumo direto em quilogramas (valor maior que 0).
2. WHERE a tinta é informada por cobertura, THE Motor_Calculo SHALL calcular o consumo de tinta em quilogramas pelo modelo SPANKS usando densidade padrão igual a 1,0 e a cobertura percentual informada.
3. WHERE a tinta é informada por consumo direto, THE Motor_Calculo SHALL usar o consumo em quilogramas informado no cálculo do Material Direto, sem aplicar o modelo SPANKS.
4. IF a tinta é informada por cobertura com valor fora do intervalo de 0 a 100, ou por consumo direto com valor menor ou igual a 0, THEN THE Item_Orcamento SHALL rejeitar o valor, retornar uma mensagem indicando o campo inválido e o intervalo aceito, e impedir o fechamento do item até que um valor válido seja informado.
5. THE Motor_Calculo SHALL incluir o custo da tinta no Material Direto do item.

### Requirement 12: Itens Diversos, Itens Fornecidos e Campos Livres na UI

**User Story:** Como orçamentista, quero informar itens diversos, itens fornecidos e
campos livres no item pela tela, para registrar custos avulsos, material do cliente e
textos como ARTE e PADRÃO.

#### Acceptance Criteria

1. THE Item_Orcamento SHALL permitir cadastrar até 50 Itens Diversos por item, cada um com descrição textual de 1 a 200 caracteres, quantidade de 0,001 a 999.999,999 e valor de 0,01 a 9.999.999,99, e um indicador booleano de custo fixo, representando custos avulsos.
2. WHERE um Item Diverso está marcado como fixo, THE Motor_Calculo SHALL tratar seu valor como custo que não escala com a tiragem, mantendo o valor constante para qualquer tiragem.
3. WHERE um Item Diverso não está marcado como fixo, THE Motor_Calculo SHALL tratar seu valor como custo unitário que escala multiplicando pela tiragem.
4. THE Item_Orcamento SHALL permitir cadastrar até 50 Itens Fornecidos pelo cliente por item, cada um com descrição textual de 1 a 200 caracteres e quantidade de 0,001 a 999.999,999, e SHALL excluí-los do cálculo do Material Direto do item.
5. THE Item_Orcamento SHALL permitir registrar até 20 Campos Livres textuais por item, cada um com rótulo de 1 a 50 caracteres e conteúdo de 0 a 500 caracteres, persistidos e associados ao item.
6. IF o orçamentista tenta salvar um Item Diverso, um Item Fornecido ou um Campo Livre com descrição ou rótulo vazio, ou com quantidade ou valor fora das faixas definidas, THEN THE Item_Orcamento SHALL rejeitar o registro, preservar os dados já informados no item e retornar uma mensagem indicando o campo inválido e a faixa esperada.

### Fase 5 — Validação Golden e Fidelidade

### Requirement 13: Fidelidade ao Calcgraf (Transversal)

**User Story:** Como responsável pela migração, quero que o orçamento gerado pelo Vizor
reproduza o pré-cálculo do Calcgraf componente a componente e nos totais, para
substituir o Calcgraf sem divergência de valores.

#### Acceptance Criteria

1. WHEN um Item de Orçamento é calculado com o mesmo conjunto de entradas de um golden case de referência, THE Orcamento_Grafico SHALL reproduzir cada um dos seis componentes do pré-cálculo do Calcgraf — Suporte, Matriz de Impressão, Tinta, Material de Acabamento, Impressão e Acabamento — com desvio menor ou igual a 0,5% em relação ao valor congelado do Calcgraf para o componente correspondente.
2. WHEN um Item de Orçamento é calculado com o mesmo conjunto de entradas de um golden case de referência, THE Orcamento_Grafico SHALL reproduzir cada um dos totais do pré-cálculo do Calcgraf — MD, CT, Servex, Custo de Produção, Custo Financeiro, Total e CEV — com desvio menor ou igual a 0,5% em relação ao valor congelado do Calcgraf para o total correspondente.
3. FOR ALL golden cases de referência (15.235 e 15.185), THE Orcamento_Grafico SHALL produzir o Valor Unitário por tiragem com desvio menor ou igual a 0,5% em relação ao valor congelado do Calcgraf.
4. WHEN a Suite_Testes executa o golden case 15.235 (item único) com tiragem 20.000, THE Suite_Testes SHALL confrontar cada um dos seis componentes e cada um dos totais do item contra os valores congelados do Calcgraf, aprovando apenas quando todos os desvios forem menores ou iguais a 0,5%.
5. WHEN a Suite_Testes executa o golden case 15.185 (multi-item), THE Suite_Testes SHALL confrontar o Custo de Produção de cada item contra o valor congelado do Calcgraf com desvio menor ou igual a 0,5% e confrontar o Total consolidado contra o valor congelado do Calcgraf respeitada a tolerância de arredondamento de duas casas decimais.
6. IF, em qualquer golden case de referência, o desvio de um componente, de um total ou do Valor Unitário exceder 0,5% (ou exceder o arredondamento de duas casas decimais no caso do Total consolidado), THEN THE Suite_Testes SHALL reprovar o caso e indicar qual componente ou total divergiu e o desvio apurado.
7. WHEN o orçamentista solicita o relatório de um orçamento, THE Orcamento_Grafico SHALL apresentar os seis componentes (Suporte, Matriz de Impressão, Tinta, Material de Acabamento, Impressão e Acabamento) e os totais (MD, CT, Servex, Custo de Produção, Custo Financeiro, Total e CEV) do pré-cálculo do Calcgraf.

### Requirement 14: Propriedades de Correção (Property-Based Testing)

**User Story:** Como responsável pela qualidade, quero propriedades de correção
executáveis sobre o cálculo e a consolidação, para proteger as invariantes do módulo
contra regressões.

#### Acceptance Criteria

1. THE Suite_Testes SHALL verificar que, para toda tiragem inteira no intervalo de 1 a 1.000.000 peças, o custo de um Item Diverso marcado como fixo permanece exatamente igual (desvio zero) ao seu valor cadastrado, não escalando com a tiragem.
2. THE Suite_Testes SHALL verificar que, para todo orçamento gerado com 1 a 50 Itens de Orçamento, a soma dos Valores Totais de fechamento dos itens é igual ao Valor Total consolidado do orçamento, com desvio absoluto menor ou igual a R$ 0,01 (tolerância de arredondamento de duas casas decimais).
3. THE Suite_Testes SHALL verificar que, para todo Item de Orçamento com Modelo do GCad selecionado, o número de poses da imposição é igual ao produto das linhas pelas colunas da repetição/encaixe do Modelo e a área total ocupada por essas poses é menor ou igual à área da folha do formato de corte (sem exceder a área da folha).
4. THE Suite_Testes SHALL verificar que, para todo orçamento de item único sem Modelo do GCad, sem restrição de acabamento e sem itens múltiplos, o resultado do Motor_Calculo (MD, CT, Custo de Produção, Total e fechamento) é idêntico, com desvio zero, ao resultado do motor puro congelado (equivalência legado).

## Constraints (Restrições Técnicas Transversais)

1. THE Orcamento_Grafico SHALL isolar todos os dados por `empresaId`, filtrando toda
   query Prisma pela empresa da entidade de negócio e nunca confiando apenas no
   mecanismo `prismaScoped` para isolamento.
2. WHERE o `prisma/schema.prisma` é alterado, THE Projeto SHALL incluir no mesmo commit
   a alteração idempotente equivalente em `prisma/migrate-prod.ts`, testada executando
   `prisma/migrate-prod.ts` duas vezes sem erro.
3. THE Schema SHALL gravar enums como VARCHAR, mantendo o `migrate-prod.ts` idempotente.
4. THE Motor_Calculo SHALL preservar os testes verdes atuais da suíte `orcamento-grafico`
   (não-regressão), mantendo o resultado do motor puro para orçamentos de item único.
5. THE Suite_Testes SHALL incluir property-based testing para as propriedades de
   correção do Requisito 14.
