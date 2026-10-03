# Requirements Document

## Introduction

Esta spec fecha a paridade do **modelo de dados e de cálculo** do orçamento
gráfico do Vizor com o Calcgraf (GPrint), na empresa Carton Wega, de forma que
o cálculo bata 100% com o sistema legado e os operadores reencontrem os mesmos
nomes e conceitos que já usam.

O **núcleo de cálculo** do orçamento gráfico (Material Direto, Custo de
Transformação, Custo de Produção, CEV, gross-up de preço, múltiplas tiragens e
margens) **já está implementado e validado** (desvio ≤ 0,5% nos testes golden
do caso 15.235) e **não é objeto desta spec** — qualquer mudança aqui é
**aditiva e não pode causar regressão** no que já bate.

Esta spec trata exclusivamente das **lacunas de modelo** descobertas na análise
das telas do Calcgraf, que hoje impedem o operador de montar um orçamento igual
ao legado e aplicar corretamente o fator de tinta do suporte:

1. **Conceito "Suporte" separado de "Preço do Papel"** (causa raiz principal).
   No Calcgraf existem dois cadastros distintos: a tabela `Suportes` (78
   registros: Duplex, Triplex, Couchê, Kraft, etc.), que carrega o CoefTinta
   (fator SPANKS), gramaturas e formatos; e os preços por quilograma de cada
   papel comercial (importados no Vizor como `PrecoMateriaPrima`, 1.767 itens).
   No orçamento, o operador escolhe o Suporte (ex.: "Duplex 280"), e o sistema
   deriva o CoefTinta e o preço por quilograma. Hoje o passo "Papel" do wizard
   do Vizor busca apenas em `PrecoMateriaPrima` (onde não existe "Duplex") e o
   cadastro `SuporteGrafico` está vazio em produção.
2. **Tabela de Margem vazia em produção** (`TabelaMargem` com 0 registros na
   Carton Wega), impedindo o orçamento de fechar com margem/impostos padrão.
3. **Parâmetros de Perda** (`ParametroPerda` vazio): perda fixa (folhas de
   acerto) e perda variável (percentual) por processo/centro, cadastro próprio
   do Vizor, exigido para o cálculo do orçamento.
4. **Comissões por agente e juros configuráveis** (menor prioridade): o
   Calcgraf detalha 6 agentes de comissão e juros simples/composto; o Vizor
   hoje colapsa a comissão em uma taxa única no CEV. Tratado como requisito
   opcional, documentado para não bloquear a validação do golden 15.235.

O **alvo de validação** é o pré-cálculo 15.235 do Calcgraf (documentado em
`docs/calcgraf-golden-15235-acabamentos.md`): Suporte "Duplex 280" a R$ 8,30/kg;
Material Direto 6.598,70; Custo de Transformação 3.814,80; Custo de Produção
10.413,50; Total 10.427,04; CEV 17,75%; preço à margem de 30,01% = 19.960,00.

## Glossary

- **Vizor**: ERP gráfico multi-tenant alvo da migração (Fastify + Prisma no
  backend, Next.js + Mantine no frontend).
- **Calcgraf**: sistema legado (GPrint/PHTech) do qual a Carton Wega está sendo
  migrada; fonte de verdade do cálculo a ser reproduzido.
- **Carton Wega**: empresa de embalagens de papel; tenant alvo
  (`empresaId = 75848e24-742e-461d-b913-1642c5b83ae9`).
- **Suporte**: cadastro de tipo de papel/cartão no Calcgraf (ex.: Duplex,
  Triplex, Couchê, Kraft) que carrega o CoefTinta, as gramaturas e os formatos
  disponíveis. No Vizor corresponde ao model `SuporteGrafico`.
- **CoefTinta**: coeficiente de tinta associado ao Suporte, usado como fator
  "Stock" da fórmula SPANKS no cálculo do consumo de tinta (ex.: Kraft 2,2;
  Jornal 1,8).
- **SPANKS**: fórmula clássica da indústria gráfica para estimar o consumo de
  tinta a partir de área impressa, número de lados, cobertura, densidade e um
  fator de suporte (CoefTinta).
- **Preço de Material** (`PrecoMateriaPrima`): tabela de preços por quilograma
  (ou unidade) de cada papel/insumo comercial no Vizor (ex.: "Klabin Advanced
  Triplex 280" a R$ 8,30/kg).
- **Material Direto (MD)**: soma dos custos de materiais do orçamento (papel/
  suporte, tinta, material de acabamento, matriz de impressão).
- **Custo de Transformação (CT)**: soma dos custos de máquina/mão de obra
  (impressão e acabamentos) por tempo fixo (acerto) e variável (produção)
  multiplicado pelo custo-hora de cada centro.
- **Custo de Produção**: Material Direto + Custo de Transformação + Serviços
  Externos.
- **CEV** (Custos Específicos de Venda): percentual aplicado no gross-up do
  preço, composto por ICMS, juros, PIS/COFINS e comissões (17,75% no caso
  15.235).
- **Tabela de Margem** (`TabelaMargem`): cadastro de markup, impostos, comissão
  e desconto usados para formar o preço de venda a partir do custo.
- **ParametroPerda** (`ParametroPerda`): cadastro de perda fixa (folhas de
  acerto) e perda variável (percentual) por processo/centro de produção.
- **Golden 15.235**: pré-cálculo real do Calcgraf usado como referência de
  paridade, transcrito em `docs/calcgraf-golden-15235-acabamentos.md`.
- **Importador**: script `scripts/importar-calcgraf.ts`, idempotente, que
  importa cadastros do banco Calcgraf (SQL Server) para o Vizor, com de-para
  por código.
- **Operador**: usuário da Carton Wega que monta orçamentos no Vizor.

## Requirements

### Requirement 1: Importação de Suportes do Calcgraf

**User Story:** Como operador da Carton Wega, quero que os suportes de papel do
Calcgraf estejam cadastrados no Vizor, para encontrar os mesmos nomes
(ex.: "Duplex 280") que uso hoje e para que o fator de tinta de cada suporte
seja aplicado no cálculo.

#### Acceptance Criteria

1. THE Importador SHALL disponibilizar uma fase dedicada que importa os
   registros da tabela `Suportes` do banco Calcgraf para o model `SuporteGrafico`
   do Vizor, vinculados ao tenant Carton Wega
   (`empresaId = 75848e24-742e-461d-b913-1642c5b83ae9`).
2. WHEN a fase de importação de suportes é executada, THE Importador SHALL
   gravar, para cada suporte, o código, a descrição, o CoefTinta e as gramaturas
   disponíveis extraídos dos campos `Codigo`, `Descricao`, `CoefTinta` e
   gramaturas da tabela `Suportes`.
3. WHERE um suporte com o mesmo código já existe no tenant Carton Wega, THE
   Importador SHALL atualizar o registro existente em vez de criar um duplicado
   (de-para por código).
4. WHEN a fase de importação de suportes é executada mais de uma vez com os
   mesmos dados de origem, THE Importador SHALL produzir o mesmo resultado final
   sem criar registros duplicados (idempotência).
5. WHEN a importação de suportes termina, THE Importador SHALL registrar a
   quantidade de suportes criados e a quantidade de suportes atualizados.
6. IF um registro de suporte da origem não possui código ou descrição, THEN THE
   Importador SHALL ignorar esse registro e registrar o motivo da exclusão sem
   interromper a importação dos demais.
7. WHERE o modo de simulação (`--dry-run`) está ativado, THE Importador SHALL
   relatar as alterações previstas sem gravar nenhuma alteração no banco.

### Requirement 2: Separação entre Suporte e Preço do Papel no wizard

**User Story:** Como operador, quero escolher primeiro o Suporte (ex.: "Duplex
280") e depois o preço do papel/gramatura vinculado a ele, para montar o
orçamento com os mesmos conceitos do Calcgraf.

#### Acceptance Criteria

1. WHEN o operador acessa o passo de material do wizard de novo orçamento, THE
   Vizor SHALL apresentar a lista de Suportes cadastrados para o tenant Carton
   Wega como opção de seleção.
2. WHEN o operador seleciona um Suporte, THE Vizor SHALL derivar o CoefTinta
   associado a esse Suporte para uso no cálculo de tinta.
3. WHEN o operador seleciona um Suporte, THE Vizor SHALL apresentar os preços
   por quilograma (`PrecoMateriaPrima`) vinculados a esse Suporte e à gramatura
   escolhida.
4. IF um Suporte selecionado não possui preço de material vinculado, THEN THE
   Vizor SHALL bloquear o avanço e o cálculo do orçamento até que o operador
   vincule um preço de material ao Suporte.
5. THE Vizor SHALL exibir o nome do Suporte selecionado idêntico ao nome
   cadastrado a partir do Calcgraf.
6. WHEN um orçamento é calculado com um Suporte selecionado, THE Vizor SHALL
   registrar no orçamento o Suporte escolhido e o preço de material aplicado.

### Requirement 3: Aplicação do CoefTinta do Suporte no cálculo de tinta

**User Story:** Como operador, quero que o fator de tinta do Suporte seja usado
no cálculo do consumo de tinta, para que o custo de tinta bata com o Calcgraf.

#### Acceptance Criteria

1. WHEN o custo de tinta de um orçamento é calculado AND há um Suporte
   selecionado com CoefTinta definido, THE Vizor SHALL usar o CoefTinta desse
   Suporte como fator de suporte na fórmula de consumo de tinta.
2. IF nenhum Suporte está selecionado ou o Suporte não possui CoefTinta, THEN
   THE Vizor SHALL usar o comportamento de cálculo de tinta já existente
   (fallback), preservando a não-regressão do núcleo de cálculo.
3. WHEN o orçamento do golden 15.235 é calculado no Vizor com o Suporte
   "Duplex 280" (R$ 8,30/kg), THE Vizor SHALL produzir um Material Direto de
   6.598,70 com desvio não superior a 0,5% em relação ao Calcgraf.
4. WHEN o orçamento do golden 15.235 é calculado no Vizor, THE Vizor SHALL
   produzir um Custo de Produção de 10.413,50 com desvio não superior a 0,5% em
   relação ao Calcgraf.

### Requirement 4: Cadastro e semeadura da Tabela de Margem

**User Story:** Como operador, quero ter uma Tabela de Margem cadastrada para a
Carton Wega, para que o orçamento feche com markup, impostos e comissão padrão.

#### Acceptance Criteria

1. THE Vizor SHALL permitir cadastrar e manter uma ou mais Tabelas de Margem
   (`TabelaMargem`) para o tenant Carton Wega, contendo markup, impostos,
   comissão e desconto.
2. THE Importador SHALL semear ao menos uma Tabela de Margem para a Carton Wega
   com a composição de CEV do caso 15.235 (ICMS 3,00%, juros 2,50%, PIS/COFINS
   9,25% e comissão 3,00%, totalizando 17,75%).
3. WHEN um orçamento é formado usando a Tabela de Margem semeada e a margem de
   30,01%, THE Vizor SHALL produzir o preço de venda de 19.960,00 para a
   tiragem de 20.000 com desvio não superior a 0,5% em relação ao Calcgraf.
4. WHEN a semeadura da Tabela de Margem é executada mais de uma vez, THE
   Importador SHALL produzir o mesmo resultado final sem criar tabelas
   duplicadas (idempotência).
5. WHERE já existe uma Tabela de Margem ajustada manualmente para o tenant, THE
   Importador SHALL preservar a tabela ajustada e não executar a semeadura para
   esse tenant.

### Requirement 5: Parâmetros de Perda

**User Story:** Como operador, quero configurar as perdas de produção (perda
fixa de acerto e perda variável percentual) por processo ou centro, para que o
cálculo de folhas e consumo reflita as perdas reais.

#### Acceptance Criteria

1. THE Vizor SHALL permitir cadastrar e manter Parâmetros de Perda
   (`ParametroPerda`) por processo ou centro de produção para o tenant Carton
   Wega.
2. THE ParametroPerda SHALL permitir configurar uma perda fixa expressa em
   folhas de acerto e uma perda variável expressa em percentual.
3. WHEN um orçamento é calculado e existe um Parametro de Perda aplicável ao
   processo, THE Vizor SHALL aplicar a perda fixa e a perda variável
   correspondentes no cálculo de folhas e consumo.
4. IF nenhum Parametro de Perda está cadastrado para o processo de um orçamento,
   THEN THE Vizor SHALL impedir o cálculo do orçamento e SHALL exigir o cadastro
   de um Parametro de Perda antes de prosseguir.
5. THE Vizor SHALL identificar o cadastro de Parametros de Perda como um
   cadastro próprio do Vizor, não importado diretamente do Calcgraf.

### Requirement 6: Comissões por agente e juros configuráveis (opcional, menor prioridade)

**User Story:** Como gestor comercial, quero detalhar comissões por agente e
configurar juros simples ou composto, para refletir a estrutura comercial da
Carton Wega da mesma forma que o Calcgraf.

#### Acceptance Criteria

1. WHERE o detalhamento de comissões por agente está habilitado, THE Vizor
   SHALL permitir cadastrar comissões para os agentes Agência, Produtor 1,
   Produtor 2, Vendedor 1, Vendedor 2 e Interno.
2. WHERE o detalhamento de comissões por agente está habilitado, THE Vizor
   SHALL permitir configurar juros simples ou composto incidindo à vista ou a
   prazo.
3. WHEN o detalhamento de comissões por agente está desabilitado, THE Vizor
   SHALL manter o comportamento atual de comissão única consolidada no CEV.
4. WHEN apenas o agente Vendedor 1 está ativo com comissão de 3,00% (caso
   15.235), THE Vizor SHALL produzir o mesmo CEV de 17,75% e o mesmo preço de
   venda que o comportamento atual, sem alteração do resultado.

### Requirement 7: Não-regressão do núcleo de cálculo e isolamento multi-tenant

**User Story:** Como responsável pela migração, quero garantir que as mudanças
desta spec sejam aditivas e isoladas por empresa, para não quebrar o cálculo
que já bate nem vazar dados entre empresas.

#### Acceptance Criteria

1. THE Vizor SHALL manter o resultado dos testes golden já existentes do núcleo
   de cálculo (incluindo o caso 15.235) sem regressão após as mudanças desta
   spec.
2. THE Vizor SHALL filtrar todas as consultas e gravações dos cadastros de
   Suporte, Tabela de Margem e Parametro de Perda por `empresaId`, de modo que
   dados de uma empresa não sejam visíveis para outra.
3. WHERE o schema Prisma é alterado por esta spec, THE Vizor SHALL incluir a
   alteração equivalente e idempotente em `prisma/migrate-prod.ts` no mesmo
   commit.
4. WHEN `prisma/migrate-prod.ts` é executado mais de uma vez, THE Vizor SHALL
   concluir sem erro e sem duplicar estruturas (idempotência).
