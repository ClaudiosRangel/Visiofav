# Requirements Document

Contagem por Contador de Máquina (Checkout).

## Introduction

Hoje o apontamento de **Produção** no Checkout é por **quantidade digitada**
(o operador informa quanto produziu no intervalo). Este recurso adiciona um
**segundo modo de contagem**, configurável **por Centro de Produção**:
leitura do **numerador (contador/odômetro) do display físico da máquina**.

No modo contador, o operador informa a **leitura final** do display; a
**quantidade produzida** do apontamento é calculada como
`leituraFinal − leituraInicial`. A **leitura inicial** vem automaticamente da
**última leitura final** daquela máquina (o display é acumulativo), de modo que
o operador não a redigita. Alguns displays **zeram no início do dia** (primeiro
turno) — para esses, no primeiro apontamento de cada dia a leitura inicial
assumida é **0**.

Correções de leituras passadas são feitas apenas pelo **histórico de contagem**
(não no apontamento), com **log de auditoria** e **validação de consistência**
contra as leituras vizinhas (o sistema conhece o valor esperado e tenta impedir
que o operador erre).

Este recurso é **aditivo e não-destrutivo**: o modo atual (quantidade digitada)
continua sendo o padrão (`QUANTIDADE`); só os centros configurados como
`CONTADOR` mudam de comportamento. Perda e Retrabalho **sempre** permanecem por
quantidade digitada, independentemente do modo do centro. Isolamento
multi-tenant por `empresaId` em toda query (padrão do projeto).

## Glossary

- **Modo de Contagem**: configuração do `CentroProducao` que define como a
  **Produção** é apontada: `QUANTIDADE` (digitada) ou `CONTADOR` (leitura do
  display).
- **Contador / Numerador**: display físico acumulativo da máquina (odômetro)
  que conta o total de folhas/peças processadas.
- **Leitura Inicial**: valor do contador no início do intervalo apontado.
  Preenchida automaticamente (última leitura final anterior, ou 0 no 1º
  apontamento do dia quando o centro zera diariamente). Travada no apontamento.
- **Leitura Final**: valor do contador no fim do intervalo, informado pelo
  operador no apontamento de Produção (modo CONTADOR).
- **Zera Diariamente**: flag do `CentroProducao` indicando que o display reseta
  no início do primeiro turno de cada dia (logo, a 1ª leitura inicial do dia = 0).
- **Leitura de Contador**: registro persistido de cada apontamento em modo
  contador (`inicial`, `final`, `quantidade`, data/hora, etapa, operador),
  usado para montar o histórico e derivar a próxima inicial.
- **Último Contador do Centro**: a última leitura final registrada para um
  Centro de Produção — vira a inicial do próximo apontamento daquele centro.

## Requirements

### Requirement 1: Configuração do Modo de Contagem no Centro de Produção

**User Story:** Como administrador de PCP, quero configurar, por Centro de
Produção, se a Produção é apontada por quantidade digitada ou pela leitura do
contador da máquina, para refletir como cada máquina opera.

#### Acceptance Criteria

1. THE `CentroProducao` SHALL possuir um campo `modoContagem` com valores
   `QUANTIDADE` (padrão) ou `CONTADOR`.
2. THE `CentroProducao` SHALL possuir um campo booleano
   `contadorZeraDiariamente` (padrão `false`), relevante apenas quando
   `modoContagem = CONTADOR`.
3. WHEN o modo é `QUANTIDADE`, THE sistema SHALL manter EXATAMENTE o
   comportamento atual de apontamento (quantidade digitada), sem alteração.
4. THE tela de cadastro de Centros de Produção SHALL permitir editar
   `modoContagem` e `contadorZeraDiariamente`.
5. THE campo `contadorZeraDiariamente` SHALL ser exibido/aplicável somente
   quando `modoContagem = CONTADOR`.

### Requirement 2: Apontamento de Produção por Contador

**User Story:** Como operador de uma máquina com display contador, quero
informar apenas a leitura final do display, para que o sistema calcule quanto
produzi no intervalo sem eu precisar fazer a conta.

#### Acceptance Criteria

1. WHEN o Centro de Produção da etapa tem `modoContagem = CONTADOR` E o tipo do
   apontamento é `PRODUCAO`, THE tela de apontar SHALL exibir a **leitura
   inicial** (somente leitura) e um campo para a **leitura final**, no lugar do
   campo de quantidade.
2. THE leitura inicial exibida SHALL ser derivada automaticamente (Requirement
   3) — o operador NÃO a digita no apontamento.
3. WHEN o operador confirma o apontamento de Produção em modo contador, THE
   sistema SHALL calcular `quantidade = leituraFinal − leituraInicial` e
   registrar o `ApontamentoEtapa` de `PRODUCAO` com essa quantidade.
4. IF a leitura final informada for menor que a leitura inicial, THEN THE
   sistema SHALL rejeitar o apontamento com mensagem clara (não trata rollover
   nesta fase — ver §Fora de Escopo).
5. IF a leitura final for igual à inicial, THEN THE quantidade produzida é 0 e o
   apontamento SHALL ser aceito (intervalo sem produção).
6. THE apontamento em modo contador SHALL persistir uma **Leitura de Contador**
   (inicial, final, quantidade, etapa, operador, data/hora) vinculada ao
   `ApontamentoEtapa` criado.
7. WHEN o tipo do apontamento é `PERDA` ou `RETRABALHO`, THE sistema SHALL usar
   SEMPRE quantidade digitada, mesmo que o centro seja `CONTADOR`.

### Requirement 3: Derivação da Leitura Inicial

**User Story:** Como operador, quero que a leitura inicial já venha preenchida
com o valor correto, para não precisar lembrar/consultar o contador anterior.

#### Acceptance Criteria

1. WHEN existe uma Leitura de Contador anterior para o Centro de Produção, THE
   leitura inicial do novo apontamento SHALL ser a **última leitura final**
   registrada para aquele centro.
2. WHEN o Centro tem `contadorZeraDiariamente = true` E o novo apontamento é o
   **primeiro apontamento de contador do dia** (data civil local — America/
   Sao_Paulo) para aquele centro, THE leitura inicial SHALL ser **0**,
   ignorando a última final do dia anterior.
3. WHEN não existe nenhuma Leitura de Contador anterior para o Centro (primeira
   vez), THE leitura inicial SHALL ser **0**.
4. THE sistema SHALL armazenar a leitura final de cada apontamento como o
   **Último Contador do Centro**, para servir de inicial do próximo.

### Requirement 4: Histórico de Contagem e Correção Auditável

**User Story:** Como supervisor, quero corrigir uma leitura lançada errada pelo
histórico de contagem, com registro de quem alterou e validação de
consistência, para manter a cadeia de contadores coerente.

#### Acceptance Criteria

1. THE sistema SHALL disponibilizar um **histórico de leituras de contador** por
   Centro de Produção (e/ou por etapa), em ordem cronológica, exibindo inicial,
   final, quantidade, operador e data/hora.
2. THE correção de uma leitura SHALL ser feita SOMENTE pelo histórico de
   contagem (não pela tela de apontamento).
3. WHEN uma leitura é corrigida, THE sistema SHALL registrar um **log de
   auditoria** com o valor anterior, o novo valor, quem alterou e quando.
4. WHEN o usuário edita uma leitura, THE sistema SHALL validar a **consistência
   com as leituras vizinhas**: a final de uma leitura deve casar com a inicial
   da leitura seguinte do mesmo centro (respeitando o reset diário quando
   aplicável), e a quantidade recalculada não pode ser negativa.
5. IF a correção quebrar a consistência da cadeia (ex.: gerar quantidade
   negativa ou descasar da leitura seguinte), THEN THE sistema SHALL exibir o
   **valor esperado** e impedir a gravação até o usuário corrigir.
6. WHEN uma leitura é corrigida, THE sistema SHALL recalcular a quantidade
   produzida daquele apontamento e refletir o ajuste no total da etapa.

### Requirement 5: Isolamento Multi-tenant e Não-regressão

**User Story:** Como responsável técnico, quero que o recurso seja isolado por
empresa e não altere o comportamento atual dos centros em modo quantidade.

#### Acceptance Criteria

1. THE toda consulta/gravação de Leitura de Contador e Último Contador SHALL ser
   filtrada por `empresaId` (da entidade real — a OP/centro), nunca só pelo
   usuário.
2. THE centros com `modoContagem = QUANTIDADE` SHALL manter o fluxo de
   apontamento atual byte-a-byte (nenhuma mudança observável).
3. THE migração de schema SHALL ser idempotente e defaultar `modoContagem =
   QUANTIDADE` para todos os centros existentes (nenhum passa a usar contador
   sem configuração explícita).

## Fora de Escopo (fases futuras)

- **Rollover do contador no meio da contagem** (display estoura e volta a 0 no
  meio de um intervalo): decisão do usuário de NÃO tratar nesta fase.
- **Reset por turno específico** (horário do primeiro turno cadastrado): nesta
  fase o "início do dia" é a **data civil local** (America/Sao_Paulo). Refinar
  por `TurnoProducao.horaInicio` fica para fase futura, se necessário.
- **Integração automática com o display da máquina** (JDF/JMF, OPC-UA, IoT):
  nesta fase a leitura é **digitada** pelo operador; a captura automática é a
  fase 4/5 já prevista no spec `checkout-apontamento`.
