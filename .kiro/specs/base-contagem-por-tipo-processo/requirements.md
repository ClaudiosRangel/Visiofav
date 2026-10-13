# Requirements Document

## Introduction

Esta feature define e padroniza a **base de contagem de produção por Tipo de
Processo** no módulo PCP do Vizor (ERP gráfico — Carton Wega). Na fábrica de
embalagens de papelão/papel, cada `CentroProducao` pertence a um `TipoProcesso`
(Cortadeira, Impressão, Acabamento, Acoplagem, Corte Vinco, Verniz, Colagem,
entre outros). Dependendo do processo, o número que faz sentido comparar/exibir
como progresso e meta de produção é diferente:

- Para **Colagem** (Coladeira/Colagem), a base relevante é a **Unidade** (peças
  montadas finais).
- Para **todos os demais tipos de processo** (Cortadeira, Impressão, Acabamento,
  Acoplagem, Corte Vinco, Verniz), a base relevante é a **Tiragem** (folhas/
  passagens planejadas).

A regra muda apenas a **base de exibição/gráficos/metas** — ou seja, contra qual
valor o progresso de produção é mostrado e comparado em todas as superfícies do
sistema. A regra **não altera o dado bruto gravado no apontamento** do operador:
o valor apontado continua sendo persistido exatamente como hoje; o que muda é a
base contra a qual esse valor é exibido/comparado.

A base é definida **pelo Tipo de Processo do centro** (não pela máquina
específica) e é aplicada **por Plano de Produção** (`PlanoOrdemProducao`), já que
uma Ordem de Produção pode ter vários planos (COMPONENTE ou FACE), cada um com
sua própria tiragem. Etapas sem plano (`planoId` nulo / OPs legadas) são tratadas
como plano único da OS.

Esta é uma feature **aditiva e de consistência**: não deve quebrar o
comportamento atual de OS/plano único, de etapas legadas, nem de centros que já
operam por quantidade; e toda agregação de produção deve respeitar o isolamento
multi-tenant por `empresaId`.

## Glossary

- **Sistema**: o conjunto de módulos do Vizor (PCP e superfícies de exibição de
  produção) que calcula, exibe e compara progresso e metas de produção. Quando um
  requisito se referir a um comportamento transversal, "o Sistema" designa a regra
  única aplicada em todas as superfícies.
- **Tiragem**: número de folhas/passagens planejadas de um Plano de Produção
  (coluna "Tir."/"Tiragem" nas telas). É a medida de quantas vezes o material
  passa pelo processo.
- **Unidade**: número de peças montadas finais (coluna "Qtd"/"UN"). Para um mesmo
  plano, Unidade e Tiragem diferem por aproveitamento/imposição (ex.: 6.160 UN
  provenientes de 1.540 de Tiragem).
- **Plano de Produção** (`PlanoOrdemProducao`): subdivisão de uma Ordem de
  Produção, do tipo COMPONENTE (ex.: TAMPA/CAIXA/BOLSA) ou FACE (FRENTE/COSTA),
  com sua própria tiragem. Uma OP pode ter vários planos.
- **Plano Único / Legado**: etapa de produção sem `planoId` (nulo), tratada como
  o plano único da Ordem de Produção. Representa o comportamento legado anterior
  à introdução dos planos.
- **Tipo de Processo** (`TipoProcesso`): cadastro dinâmico que agrupa centros de
  produção por natureza da operação (Cortadeira, Impressão, Acabamento, Acoplagem,
  Corte Vinco, Verniz, Colagem). Todo `CentroProducao` aponta obrigatoriamente
  para um `TipoProcesso`.
- **Base de Contagem**: a medida (Tiragem ou Unidade) usada como denominador de
  progresso e como alvo de meta na exibição de produção, determinada pelo Tipo de
  Processo do centro. Também referida como "base de exibição".
- **Apontamento**: registro de produção/perda feito pelo operador em uma etapa
  (`ApontamentoEtapa` / `quantidadeProduzida` da etapa). É o dado bruto, não
  alterado por esta feature.
- **Superfície de Exibição**: qualquer tela, painel, gráfico ou relatório que
  mostra número, gráfico ou meta de produção por centro/processo (Dashboard do
  PCP, Gantt, Painel de Programação, Quadro de Produção, Painel de Produção/TV,
  Checkout, Apontamentos do PCP, Relatórios e demais menus equivalentes).

## Requirements

### Requirement 1: Base de Contagem determinada pelo Tipo de Processo

**User Story:** Como gestor de PCP, quero que a base de contagem de cada centro
seja definida pelo Tipo de Processo (não pela máquina específica), para que o
progresso e as metas de produção sejam exibidos na medida correta para cada
natureza de operação.

#### Acceptance Criteria

1. WHERE o Tipo de Processo do centro é Colagem, THE Sistema SHALL definir a Base
   de Contagem desse centro como Unidade.
2. WHEN o Tipo de Processo do centro é Cortadeira, Impressão, Acabamento,
   Acoplagem, Corte Vinco ou Verniz, THE Sistema SHALL definir a Base de Contagem
   desse centro como Tiragem (base padrão), de modo que esses Tipos de Processo
   implicam obrigatoriamente a base padrão Tiragem.
3. THE Sistema SHALL determinar a Base de Contagem a partir do Tipo de Processo do
   centro, sem considerar a máquina específica.
4. WHERE o Tipo de Processo do centro não é Colagem, THE Sistema SHALL definir a
   Base de Contagem desse centro como Tiragem.

### Requirement 2: Distinção entre Tiragem e Unidade

**User Story:** Como gestor de PCP, quero que o Sistema distinga Tiragem de
Unidade de forma consistente, para que a comparação de progresso use sempre o
valor planejado correspondente à base do processo.

#### Acceptance Criteria

1. THE Sistema SHALL representar Tiragem como o número de folhas/passagens
   planejadas de um Plano de Produção.
2. THE Sistema SHALL representar Unidade como o número de peças montadas finais de
   um Plano de Produção.
3. WHEN a Base de Contagem de um centro é Tiragem, THE Sistema SHALL usar o valor
   de Tiragem do Plano de Produção como alvo planejado para exibição e meta.
4. WHEN a Base de Contagem de um centro é Unidade, THE Sistema SHALL usar o valor
   de Unidade do Plano de Produção como alvo planejado para exibição e meta.

### Requirement 3: Preservação do dado bruto apontado

**User Story:** Como operador e como gestor de PCP, quero que o valor apontado na
produção continue sendo gravado exatamente como hoje, para que a mudança de base
de exibição não altere a rastreabilidade nem o histórico de apontamentos.

#### Acceptance Criteria

1. WHEN um operador registra um apontamento de produção, THE Sistema SHALL gravar
   o valor apontado sem conversão em função da Base de Contagem.
2. THE Sistema SHALL aplicar a Base de Contagem apenas sobre a exibição, os
   gráficos e as metas de produção.
3. THE Sistema SHALL preservar o valor bruto apontado como fonte de dado,
   independentemente da Base de Contagem do centro.
4. IF a Base de Contagem de um centro é alterada por reclassificação do Tipo de
   Processo, THEN THE Sistema SHALL manter inalterados os apontamentos já gravados,
   preservando os valores históricos de progresso e meta congelados conforme a Base
   de Contagem vigente no momento de cada apontamento anterior, sem recálculo
   retroativo.
5. WHEN o Sistema exibe progresso ou meta de um apontamento anterior após uma
   reclassificação do Tipo de Processo, THE Sistema SHALL aplicar a Base de Contagem
   que estava vigente no momento daquele apontamento, mantendo o dado bruto apontado
   inalterado conforme o Requirement 3 (o dado bruto nunca muda; a base aplicada a um
   apontamento é a vigente na época dele, não recalculada retroativamente).

> **Nota para o design:** o comportamento exigido é o *congelamento* da base por
> apontamento. O requisito define o COMPORTAMENTO (valores históricos congelados,
> sem recálculo retroativo), não a implementação. A decisão de COMO garantir isso
> — persistir a Base de Contagem vigente no próprio apontamento vs. derivá-la por
> data/histórico de reclassificação — fica para a fase de design.

### Requirement 4: Granularidade por Plano de Produção

**User Story:** Como gestor de PCP, quero que a base de contagem seja aplicada por
Plano de Produção, para que cada componente ou face de uma OP use sua própria
tiragem/unidade na exibição de progresso.

#### Acceptance Criteria

1. THE Sistema SHALL aplicar a Base de Contagem no nível do Plano de Produção.
2. WHEN uma Ordem de Produção possui mais de um Plano de Produção, THE Sistema
   SHALL calcular o progresso e a meta de cada Plano de Produção vinculado à Ordem
   de forma independente, usando a Tiragem ou Unidade do próprio plano, sem
   consolidar uma Base de Contagem única no nível da Ordem de Produção.
3. WHEN uma etapa de produção possui `planoId` definido, THE Sistema SHALL usar os
   valores planejados do plano correspondente como base de exibição da etapa.

### Requirement 5: Compatibilidade com Plano Único e etapas legadas (não-regressão)

**User Story:** Como gestor de PCP, quero que OPs e etapas sem plano continuem
funcionando como hoje, para que a feature não cause regressão em dados existentes.

#### Acceptance Criteria

1. WHEN uma etapa de produção possui `planoId` nulo, THE Sistema SHALL tratar a
   etapa como pertencente ao plano único da Ordem de Produção.
2. WHEN uma etapa pertence a um Plano Único ou legado (`planoId` nulo), THE Sistema
   SHALL recalcular o progresso e a meta por meio da mesma estrutura de cálculo dos
   Planos de Produção, tratando o Plano Único como um plano implícito (caso
   particular) da Ordem de Produção, usando os valores planejados da Ordem de
   Produção como fonte do plano implícito, sem um caminho de cálculo separado e
   preservando a não-regressão do resultado exibido.
3. THE Sistema SHALL preservar o comportamento atual de exibição para centros que
   já operam por quantidade, aplicando a Base de Contagem sem alterar o fluxo de
   apontamento existente.
4. THE Sistema SHALL manter o comportamento de exibição das Ordens de Produção
   existentes que não forem reimportadas com planos.

### Requirement 6: Consistência da regra em todas as Superfícies de Exibição

**User Story:** Como gestor de PCP, quero a mesma base de contagem aplicada em
todos os lugares que mostram número/gráfico/meta de produção, para que não haja
divergência de valores entre telas.

#### Acceptance Criteria

1. THE Sistema SHALL aplicar a mesma regra de Base de Contagem por Tipo de
   Processo em todas as Superfícies de Exibição.
2. WHEN o mesmo Plano de Produção é exibido simultaneamente em mais de uma
   Superfície de Exibição e os dados de produção são atualizados, THE Sistema SHALL
   apresentar a mesma Base de Contagem e o mesmo valor de progresso e meta em todas
   as superfícies, derivando-os de uma única fonte de verdade (função única de
   cálculo), de modo que não haja divergência de valores entre as telas.
3. THE Sistema SHALL identificar, na fase de design, o conjunto exato de pontos do
   sistema que exibem número, gráfico ou meta de produção por centro/processo.

> **Nota para o design:** "tempo real" neste requisito significa *recalcular na
> renderização/refetch a partir da mesma fonte de verdade* (função única de
> cálculo), garantindo que não haja divergência entre telas. O requisito é de
> CONSISTÊNCIA (mesma fonte/função de cálculo em todas as superfícies) e **não**
> implica necessariamente mecanismo de push/websocket.

### Requirement 7: Dashboard do PCP

**User Story:** Como gestor de PCP, quero que os indicadores e gráficos de produção
do Dashboard do PCP usem a base de contagem correta por Tipo de Processo, para que
os números do painel executivo sejam coerentes.

#### Acceptance Criteria

1. WHERE um indicador do Dashboard do PCP exibe produção de um centro de Colagem,
   THE Sistema SHALL exibir o progresso e a meta na base Unidade.
2. WHERE um indicador do Dashboard do PCP exibe produção de um centro de Tipo de
   Processo diferente de Colagem, THE Sistema SHALL exibir o progresso e a meta na
   base Tiragem.

### Requirement 8: Gantt de Produção

**User Story:** Como gestor de PCP, quero que o Gantt de Produção reflita a base de
contagem correta por Tipo de Processo, para que a visão de cronograma mostre
progresso coerente com cada processo.

#### Acceptance Criteria

1. WHERE uma etapa exibida no Gantt de Produção pertence a um centro de Colagem,
   THE Sistema SHALL exibir o progresso na base Unidade.
2. WHERE uma etapa exibida no Gantt de Produção pertence a um centro de Tipo de
   Processo diferente de Colagem, THE Sistema SHALL exibir o progresso na base
   Tiragem.

### Requirement 9: Painel de Programação e Quadro de Produção

**User Story:** Como supervisor de produção, quero que o Painel de Programação e o
Quadro de Produção mostrem a base de contagem correta por Tipo de Processo, para
que a fila de produção exiba progresso coerente.

#### Acceptance Criteria

1. WHERE um card ou linha do Painel de Programação pertence a um centro de Colagem,
   THE Sistema SHALL exibir o progresso e a meta na base Unidade.
2. WHERE um card ou linha do Painel de Programação pertence a um centro de Tipo de
   Processo diferente de Colagem, THE Sistema SHALL exibir o progresso e a meta na
   base Tiragem.
3. THE Sistema SHALL aplicar no Quadro de Produção a mesma Base de Contagem por
   Tipo de Processo usada no Painel de Programação.

### Requirement 10: Painel de Produção (TV) e monitores

**User Story:** Como equipe de chão de fábrica, quero que o Painel de Produção
exibido em TV/monitores mostre a base de contagem correta por Tipo de Processo,
para que o acompanhamento visual seja coerente com os demais painéis.

#### Acceptance Criteria

1. WHERE um item do Painel de Produção (TV) pertence a um centro de Colagem, THE
   Sistema SHALL exibir o progresso e a meta na base Unidade.
2. WHERE um item do Painel de Produção (TV) pertence a um centro de Tipo de
   Processo diferente de Colagem, THE Sistema SHALL exibir o progresso e a meta na
   base Tiragem.

### Requirement 11: Checkout (app do operador) e telas de Apontamentos do PCP

**User Story:** Como operador no Checkout e como analista nas telas de Apontamentos
do PCP, quero ver o progresso na base de contagem correta por Tipo de Processo,
para que a meta exibida corresponda ao processo da etapa, sem alterar como aponto.

#### Acceptance Criteria

1. WHERE a etapa apontada no Checkout pertence a um centro de Colagem, THE Sistema
   SHALL exibir o progresso e a meta na base Unidade.
2. WHERE a etapa apontada no Checkout pertence a um centro de Tipo de Processo
   diferente de Colagem, THE Sistema SHALL exibir o progresso e a meta na base
   Tiragem.
3. THE Sistema SHALL aplicar nas telas de Apontamentos do PCP a mesma Base de
   Contagem por Tipo de Processo usada no Checkout.
4. THE Sistema SHALL registrar o apontamento do operador no Checkout e preservar o
   valor bruto apontado inalterado em função da Base de Contagem.

### Requirement 12: Relatórios de produção e análise

**User Story:** Como gestor de PCP, quero que os relatórios de produção e análise
usem a base de contagem correta por Tipo de Processo, para que os relatórios sejam
coerentes com os painéis.

#### Acceptance Criteria

1. WHERE um relatório apresenta produção de um centro de Colagem, THE Sistema SHALL
   apresentar o progresso e a meta na base Unidade.
2. WHERE um relatório apresenta produção de um centro de Tipo de Processo diferente
   de Colagem, THE Sistema SHALL apresentar o progresso e a meta na base Tiragem.

### Requirement 13: Demais menus que exibem progresso/meta por centro ou processo

**User Story:** Como gestor de PCP, quero que qualquer outro menu que exiba
progresso ou meta de produção por centro/processo use a base de contagem correta,
para que não reste nenhum ponto do sistema divergindo da regra.

#### Acceptance Criteria

1. WHERE uma Superfície de Exibição adicional apresenta progresso ou meta de
   produção por centro ou processo, THE Sistema SHALL aplicar a Base de Contagem
   por Tipo de Processo definida nesta feature.
2. THE Sistema SHALL registrar, na fase de design, cada menu adicional identificado
   que exibe progresso ou meta de produção por centro ou processo.

### Requirement 14: Isolamento multi-tenant das agregações

**User Story:** Como administrador multi-empresa, quero que toda agregação de
produção respeite o isolamento por empresa, para que dados de uma empresa não
vazem para outra ao calcular base, progresso ou meta.

#### Acceptance Criteria

1. WHEN o Sistema agrega produção para exibir progresso ou meta, THE Sistema SHALL
   restringir a agregação aos registros da empresa correspondente, identificada
   por `empresaId`.
2. WHEN o Sistema resolve a Base de Contagem de uma etapa a partir do centro e do
   plano, THE Sistema SHALL usar o `empresaId` da Ordem de Produção real como
   referência de isolamento.
3. IF uma consulta de agregação de produção não puder determinar o `empresaId` de
   escopo, THEN THE Sistema SHALL rejeitar a consulta com um erro explícito, sem
   retornar resultado vazio nem aplicar um escopo de empresa padrão.
