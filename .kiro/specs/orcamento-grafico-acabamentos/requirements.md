# Requirements Document

## Introduction

Esta feature fecha a lacuna que hoje impede o Vizor (módulo Orçamento Gráfico)
de reproduzir, componente a componente, o pré-cálculo do Calcgraf/G-Print para
trabalhos com **acabamentos**. O caso de referência (fonte de verdade) é o
pré-cálculo 15.235 — "Cartucho Kit Intense Fragrance", cliente ESTAÇÃO Y,
tiragem 20.000 un — transcrito em
#[[file:docs/calcgraf-golden-15235-acabamentos.md]].

O motor de cálculo (`src/modules/orcamento-grafico/orcamento-grafico-calculo.service.ts`)
já tem calibração **congelada** para Papel, Tinta (SPANKS), Impressão (CT por
acerto-por-cor), decomposição MD/CT/SE, CEV e formação de preço por gross-up
(`formarPrecoVenda`). Esta feature é **aditiva**: estende o que falta para o caso
de acabamentos reproduzir sem alterar o cálculo já congelado. As cinco frentes:

- **(A) Cadastro de Acabamentos**: substituir a lista FIXA de 5 acabamentos
  hardcoded no wizard por um cadastro multi-tenant.
- **(B) Importação das 60 Atividades ativas** do Calcgraf
  (`cartoon/export/Atividades.json`) para o cadastro.
- **(C) Materiais de Acabamento** com múltiplas naturezas num mesmo bloco:
  por KG consumido, custo FIXO (faca/matriz) e por UN.
- **(D) Cadeia de centros de acabamento no Custo de Transformação (CT)**: 5
  centros em sequência, cada um com tempo fixo (acerto) + variável (produção)
  × custo-hora próprio, calibrado como a Impressão já é.
- **(E) Relatório/PDF idêntico ao Calcgraf** (layout do golden).
- **(F) Calibração golden ≤0,5%** contra o 15.235, congelada como teste Vitest.
- **(G) Wizard lendo do cadastro** em vez da lista fixa.

### Restrições de projeto refletidas nos requisitos

- **Multi-tenant**: todo cadastro novo filtra e grava por `empresaId`.
- **Migração de schema**: `prisma/schema.prisma` e `prisma/migrate-prod.ts`
  SEMPRE no mesmo commit; migração idempotente que roda em produção no deploy
  (Postgres local indisponível — validar por diagnostics + Vitest).
- **Não regressão**: a feature de relatório/visual não pode alterar o cálculo já
  congelado (papel/tinta/impressão/preço) — é estritamente aditiva.
- **Importador**: nova fase em `scripts/importar-calcgraf.ts`, padrão `--dry-run`,
  idempotente, de-para por código, sem sobrescrever dados existentes.

## Glossary

- **Vizor**: o ERP gráfico multi-tenant onde esta feature é implementada (backend
  Fastify + Prisma).
- **Calcgraf**: sistema legado (desktop Delphi/G-Print) cujo pré-cálculo é o alvo
  a ser reproduzido pelo Vizor.
- **Golden_15235**: o pré-cálculo de referência 15.235 transcrito em
  `docs/calcgraf-golden-15235-acabamentos.md`; fonte de verdade dos valores-alvo.
- **Cadastro_Acabamento**: a entidade de cadastro de acabamentos nova desta
  feature, por empresa (`empresaId`), que substitui a lista fixa do wizard.
- **Atividade_Calcgraf**: um registro do arquivo `cartoon/export/Atividades.json`
  (campos `Codigo`, `Ativo`, `Nome`, `TipoAtividade`, `PlanoProduto`).
- **Importador_Acabamentos**: a fase nova do script `scripts/importar-calcgraf.ts`
  que carrega as Atividades ativas no Cadastro_Acabamento.
- **Motor_Orcamento**: `orcamento-grafico-calculo.service.ts`, o serviço de
  cálculo do orçamento gráfico.
- **CT (Custo de Transformação)**: custo das operações de máquina (impressão +
  acabamentos), calculado por `custo-transformacao.ts`.
- **MD (Material Direto)**: custo de papel/suporte, tinta, matriz e materiais de
  acabamento.
- **SE (Serviço Externo)**: custo de serviços de terceiros.
- **CEV (Custos de Venda)**: percentuais sobre o preço (ICMS, Juros, PIS/COFINS,
  Comissões) usados no gross-up.
- **Material_Acabamento_KG**: material de acabamento cujo consumo é expresso em
  quilogramas (ex.: Cola, Verniz) — custo = variável(kg) × preço/kg.
- **Material_Acabamento_UN**: material de acabamento cujo consumo é expresso em
  unidades (ex.: Caixa Padrão) — custo = variável(un) × preço/un.
- **Material_Acabamento_Fixo**: item de acabamento com custo fixo que não escala
  com a tiragem (ex.: FACA NOVA = 1 un × 1.300,00).
- **Centro_Acabamento**: um `CentroProducao` usado numa etapa de acabamento, com
  tempo fixo (acerto), tempo variável (produção) e custo-hora próprios.
- **Teste_Golden**: teste de calibração Vitest no padrão de
  `src/modules/orcamento-grafico/calibracao/` (`golden-*.fixture.ts` +
  `golden-*.test.ts`) que congela os valores-alvo.
- **Desvio_Calibracao**: diferença relativa entre o valor calculado pelo Vizor e
  o valor do Golden_15235; a meta é desvio ≤ 0,5%.

## Requirements

### Requirement 1: Cadastro de Acabamentos (multi-tenant)

**User Story:** Como analista de orçamento da Carton Wega, quero um cadastro de
acabamentos no Vizor, para que o orçamento use a lista real de acabamentos da
empresa em vez de uma lista fixa limitada a 5 itens.

#### Acceptance Criteria

1. THE Vizor SHALL persistir cada Cadastro_Acabamento com os campos `empresaId`,
   `codigo`, `nome`, `tipoAtividade`, `planoProduto`, `status` e vínculo opcional
   `centroProducaoId`.
2. WHEN um Cadastro_Acabamento é criado ou consultado, THE Vizor SHALL filtrar e
   gravar os registros pelo `empresaId` da entidade de negócio corrente.
3. THE Vizor SHALL garantir unicidade do Cadastro_Acabamento pela combinação de
   `empresaId` e `codigo`.
4. WHEN uma alteração do Cadastro_Acabamento modifica `prisma/schema.prisma`,
   THE Vizor SHALL incluir no mesmo commit a alteração idempotente equivalente em
   `prisma/migrate-prod.ts`.
5. WHEN `prisma/migrate-prod.ts` é executado duas vezes consecutivas contra o
   mesmo banco, THE Vizor SHALL concluir ambas as execuções sem erro e sem
   duplicar objetos de banco.
6. THE Vizor SHALL expor operações de leitura, criação, edição e ativação/
   inativação do Cadastro_Acabamento filtradas por `empresaId`.

### Requirement 2: Importação das Atividades do Calcgraf

**User Story:** Como responsável pela migração, quero importar os acabamentos
ativos do Calcgraf para o cadastro do Vizor, para que a empresa tenha os 60
acabamentos ativos sem digitação manual.

#### Acceptance Criteria

1. THE Importador_Acabamentos SHALL ler as Atividade_Calcgraf do arquivo
   `cartoon/export/Atividades.json`.
2. WHEN o Importador_Acabamentos processa as Atividade_Calcgraf, THE
   Importador_Acabamentos SHALL importar as Atividade_Calcgraf cujo campo `Ativo`
   tem valor `ATIVO`.
3. WHEN o Importador_Acabamentos encontra uma Atividade_Calcgraf cujo `Codigo` já
   existe como Cadastro_Acabamento da empresa alvo, THE Importador_Acabamentos
   SHALL atualizar os campos de metadados do registro existente (`nome`,
   `tipoAtividade`, `planoProduto`, `status`) com os valores da origem, SEM
   sobrescrever vínculos/custos ajustados manualmente (ex.: `centroProducaoId`,
   preços/tempos cadastrados no Vizor).
4. WHEN o Importador_Acabamentos é executado com a opção `--dry-run`, THE
   Importador_Acabamentos SHALL reportar as ações previstas sem gravar no banco.
5. WHEN o Importador_Acabamentos é executado duas vezes consecutivas sem
   `--dry-run`, THE Importador_Acabamentos SHALL produzir o mesmo estado final no
   cadastro na segunda execução que na primeira.
6. WHERE o campo `TipoAtividade` da Atividade_Calcgraf é `Impressão`, THE
   Importador_Acabamentos SHALL classificar o Cadastro_Acabamento com
   `tipoAtividade` igual a `Impressão` e os demais com `Acabamento`, preservando o
   valor `PlanoProduto` de origem.
7. IF o arquivo `cartoon/export/Atividades.json` não é encontrado ou não contém
   JSON válido, THEN THE Importador_Acabamentos SHALL encerrar com mensagem de
   erro descritiva e sem gravar no banco.

### Requirement 3: Materiais de Acabamento por KG, por UN e com custo fixo

**User Story:** Como analista de orçamento, quero que o bloco MAT.ACABAMENTO
calcule corretamente materiais por quilograma, por unidade e com custo fixo, para
que o Material Direto bata com o Calcgraf em trabalhos com faca/cola/verniz/caixa.

#### Acceptance Criteria

1. WHEN um Material_Acabamento_KG é incluído no orçamento, THE Motor_Orcamento
   SHALL calcular o subtotal como `quantidade_variavel_kg × preço_por_kg`.
2. WHEN um Material_Acabamento_UN é incluído no orçamento, THE Motor_Orcamento
   SHALL calcular o subtotal como `quantidade_variavel_un × preço_por_un`.
3. WHEN um Material_Acabamento_Fixo é incluído no orçamento, THE Motor_Orcamento
   SHALL aplicar o subtotal como custo fixo do orçamento independente da tiragem.
4. THE Motor_Orcamento SHALL incluir os subtotais de Material_Acabamento_KG,
   Material_Acabamento_UN e Material_Acabamento_Fixo na composição do MD.
5. WHEN os quatro itens de MAT.ACABAMENTO do Golden_15235 são calculados (Cola
   Branca 1,14 kg × 29,15; FACA NOVA 1 × 1.300,00; Verniz 5,63 kg × 24,2; Caixa
   Padrão 20 un × 7,7), THE Motor_Orcamento SHALL produzir os subtotais 33,23;
   1.300,00; 136,16 e 154,00 com Desvio_Calibracao menor ou igual a 0,5%.
6. WHEN um orçamento com itens de acabamento é calculado, THE Motor_Orcamento
   SHALL calcular os componentes de acabamento (MAT.ACABAMENTO e cadeia de
   centros) E, conjuntamente, manter inalterados os resultados já congelados de
   papel, tinta, impressão e formação de preço.

### Requirement 4: Cadeia de centros de acabamento no Custo de Transformação

**User Story:** Como analista de orçamento, quero que a cadeia de centros de
acabamento seja calculada no CT calibrado, para que o Custo de Transformação bata
com o Calcgraf em trabalhos com corte, guilhotina, vinco, destaque e colagem.

#### Acceptance Criteria

1. THE Motor_Orcamento SHALL calcular o custo de cada Centro_Acabamento como
   `(tempo_fixo_horas + tempo_variavel_horas) × custo_hora` do centro.
2. THE Motor_Orcamento SHALL somar os custos de todos os Centro_Acabamento da
   sequência do orçamento ao Custo de Transformação.
3. THE Motor_Orcamento SHALL preservar a entrada da Impressão no Custo de
   Transformação já calibrada, somando os acabamentos de forma aditiva.
4. WHEN os cinco centros de acabamento do Golden_15235 são calculados (Cortadeira
   Grande 145,29; Guilhotina maior 97,11; Bobst E 1.050,00; Destacar 25,00; AFT70
   Coladeira 897,40), THE Motor_Orcamento SHALL produzir cada subtotal com
   Desvio_Calibracao menor ou igual a 0,5%.
5. WHEN o Custo de Transformação total do Golden_15235 é calculado, THE
   Motor_Orcamento SHALL produzir 3.814,80 (Impressão 1.600,00 + acabamentos
   2.214,80) com Desvio_Calibracao menor ou igual a 0,5%.

### Requirement 5: Relatório do orçamento idêntico ao Calcgraf

**User Story:** Como analista de orçamento, quero emitir um relatório idêntico ao
pré-cálculo do Calcgraf, para que eu possa comparar e validar o orçamento do Vizor
lado a lado com o sistema legado.

#### Acceptance Criteria

1. WHEN um relatório de orçamento é gerado, THE Vizor SHALL incluir as seções
   Cabeçalho, Plano, SUPORTE, MATRIZ IMPRESSÃO, TINTA, MAT.ACABAMENTO, IMPRESSÃO
   e ACABAMENTO, na mesma ordem do Golden_15235.
2. WHEN um relatório de orçamento é gerado, THE Vizor SHALL incluir a seção Custo
   de Produção com os campos Mat.Dir., C.Transf., Servex, C.Prod., C.Finan. e
   Total.
3. WHEN um relatório de orçamento é gerado, THE Vizor SHALL incluir a seção CEV
   com os percentuais de ICMS, Juros, PIS/COFINS e Comissões e o total do CEV.
4. WHEN um relatório de orçamento é gerado, THE Vizor SHALL incluir a tabela de
   Margem/Contribuição Marginal por tiragem com as colunas Margem %, Margem $,
   C.Marg.%, C.Marg.$, Unitário e Valor Total.
5. WHEN o relatório é gerado para o Golden_15235, THE Vizor SHALL exibir os
   agregados Mat.Dir. 6.598,70; C.Transf. 3.814,80; C.Prod. 10.413,50 e Total
   10.427,04 com Desvio_Calibracao menor ou igual a 0,5%.
6. WHEN o relatório é gerado para o Golden_15235, THE Vizor SHALL exibir os três
   pontos de margem (10%, 20% e markup) com os totais 14.440,00; 16.760,00 e
   19.960,00 com Desvio_Calibracao menor ou igual a 0,5%.
7. WHILE a feature de relatório é executada, THE Vizor SHALL manter inalterados os
   valores de cálculo já congelados de papel, tinta, impressão e preço.

### Requirement 6: Calibração golden do caso 15.235

**User Story:** Como responsável pela qualidade da migração, quero um teste de
calibração que congele o caso 15.235, para que qualquer regressão futura no
cálculo de acabamentos seja detectada automaticamente.

#### Acceptance Criteria

1. THE Vizor SHALL incluir um Teste_Golden do caso 15.235 no diretório
   `src/modules/orcamento-grafico/calibracao/`, composto por um arquivo
   `golden-*.fixture.ts` e um arquivo `golden-*.test.ts`, no padrão dos testes de
   calibração existentes.
2. WHEN o Teste_Golden é executado com os mesmos dados de entrada do Golden_15235,
   THE Teste_Golden SHALL verificar que cada subtotal de componente (SUPORTE,
   MATRIZ IMPRESSÃO, TINTA, MAT.ACABAMENTO, IMPRESSÃO, ACABAMENTO) tem
   Desvio_Calibracao menor ou igual a 0,5%.
3. WHEN o Teste_Golden é executado, THE Teste_Golden SHALL verificar que os
   agregados Mat.Dir. 6.598,70; C.Transf. 3.814,80; C.Prod. 10.413,50 e Total
   10.427,04 têm Desvio_Calibracao menor ou igual a 0,5%.
4. WHEN o Teste_Golden é executado, THE Teste_Golden SHALL verificar que os três
   pontos de margem produzem os totais 14.440,00; 16.760,00 e 19.960,00 com
   Desvio_Calibracao menor ou igual a 0,5%.
5. IF algum valor calculado apresenta Desvio_Calibracao maior que 0,5% em relação
   ao Golden_15235, THEN THE Teste_Golden SHALL falhar e bloquear a suíte
   (impedindo que a validação seja considerada bem-sucedida), identificando o
   componente divergente.
6. WHEN a suíte de testes do módulo orcamento-grafico é executada após esta
   feature, THE Vizor SHALL manter aprovados os Teste_Golden pré-existentes
   (não regressão).

### Requirement 7: Wizard lendo do cadastro de acabamentos

**User Story:** Como analista de orçamento, quero que o wizard de novo orçamento
ofereça os acabamentos a partir do cadastro, para que eu selecione qualquer um dos
acabamentos ativos da empresa em vez dos 5 fixos.

#### Acceptance Criteria

1. WHEN o passo de acabamentos do wizard de orçamento é aberto, THE Vizor SHALL
   oferecer as opções a partir do Cadastro_Acabamento da empresa corrente.
2. THE Vizor SHALL apresentar no wizard somente os Cadastro_Acabamento com
   `status` ativo.
3. WHEN um Cadastro_Acabamento está vinculado a um Centro_Acabamento, THE Vizor
   SHALL associar a seleção do wizard a esse centro para o cálculo do CT.
4. WHEN um orçamento é calculado a partir das seleções do wizard, THE
   Motor_Orcamento SHALL calcular os materiais e centros de acabamento conforme os
   Requirements 3 e 4.
5. THE Vizor SHALL remover do código do wizard a lista fixa de 5 acabamentos
   hardcoded, substituindo-a pela leitura do Cadastro_Acabamento — propriedade
   estrutural verificável por inspeção de código/configuração, independente do
   estado de runtime do wizard.
