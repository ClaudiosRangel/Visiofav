# Requirements Document

## Introduction

Esta feature entrega ao Vizor o acesso FÁCIL e a manipulação CASO A CASO das
**configurações** do cálculo gráfico que hoje vivem no sistema legado Calcgraf
(Delphi/SQL Server, fechado), de modo que o Vizor possa operar o orçamento
gráfico com paridade ao Calcgraf. A feature tem três eixos:

1. **Estudo / de-para** — mapear as tabelas de CONFIGURAÇÃO do Calcgraf (entrada)
   contra os cadastros que o Vizor já possui, identificando lacunas (ex.: crédito
   PIS/COFINS no papel, tabelas de custo por vigência/coluna, tributação por
   operação).
2. **Centralização e edição caso a caso** — telas de acesso fácil para visualizar
   e editar essas configurações no Vizor, com versionamento/vigência quando
   aplicável.
3. **Demonstração da memória do CalculoSTC** — uma visão (tela/relatório) que
   EXIBE, por cálculo já feito, cada componente de custo registrado na tabela
   `CalculoSTC` (papel/tinta/impressão/acabamentos/matriz) com o valor real do
   Calcgraf, agrupado em MD/CT, somando o custo de produção, e ligando cada linha
   à configuração de entrada que o produziu (via `Itc.Origem`).

Enquadramento CRÍTICO (já alinhado com o usuário): o `CalculoSTC` **NÃO é
configuração** — é o RESULTADO/MEMÓRIA congelada de cada cálculo já feito (o custo
final gravado por componente). Portanto: configurações editáveis = tabelas de
ENTRADA; `CalculoSTC` = SAÍDA/validação/demonstração. A feature trata as duas
coisas de forma claramente separada: a Demonstração do STC é EXIBIÇÃO/evidência,
nunca edição.

Restrições transversais firmadas: isolamento multi-tenant (`empresaId` explícito
em toda operação), não-regressão do motor de cálculo atual
(`calcularOrcamentoGrafico`) e da ancoragem (`ancorarCustoCalcgraf`), e
reaproveitamento dos cadastros que o Vizor já tem (não reinventar — só
complementar/centralizar).

## Glossary

- **Vizor**: o ERP gráfico multi-tenant (VisioFab) que está assumindo o cálculo e
  o orçamento gráfico da Carton Wega.
- **Calcgraf**: sistema legado (Delphi + SQL Server, fechado, da PHTech) usado
  hoje pela Carton Wega para orçamento/cálculo gráfico. Fonte das configurações e
  dos cálculos migrados.
- **Configuração** (tabela de ENTRADA): dado cadastral/paramétrico que ALIMENTA o
  cálculo gráfico e PODE ser editado — ex.: catálogo de itens de custo (`Itc`),
  tabelas de custo por vigência (`TabelasCusto`/`TabelasCustoDetalhe`), preços de
  papel/tinta, custo-hora de máquinas, tributação/margens. É editável caso a caso.
- **Resultado / CalculoSTC** (tabela de SAÍDA): a memória congelada de um cálculo
  JÁ FEITO. A tabela `CalculoSTC` do Calcgraf grava o custo final de CADA
  componente por cálculo (papel, impressão, tinta, acabamentos, matriz). NÃO é
  configuração e NÃO é editável nesta feature — é exibida como evidência.
- **Itc**: catálogo de itens de custo do Calcgraf (≈2346 registros). Cada item tem
  um campo **Origem**.
- **Origem (do Itc)**: classificação do item de custo. Valores:
  `SUPORTE` (papel → MD), `TINTA` (tinta → MD),
  `MAT.ACABAMENTO` e `MATRIZ IMPRESSAO` (material direto → MD),
  `CENTRO DE CUSTO` (máquina / custo de transformação → CT),
  `SERVICO EXTERNO` (serviço externo → SE).
- **MD (Material Direto)**: grupo de custo que agrega papel (SUPORTE), tinta
  (TINTA) e materiais diretos (MAT.ACABAMENTO / MATRIZ IMPRESSAO). Corresponde ao
  Agrupamento 2 do Calcgraf.
- **CT (Custo de Transformação)**: grupo de custo das máquinas/centros
  (`CENTRO DE CUSTO`). Corresponde ao Agrupamento 1 do Calcgraf.
- **SE (Serviço Externo)**: grupo de custo de serviços terceirizados. Corresponde
  ao Agrupamento 3 do Calcgraf.
- **Agrupamentos (Calcgraf)**: 1 = Custo de Transformação (CT), 2 = Material
  Direto (MD), 3 = Serviço Externo (SE).
- **Custo de Produção (C.PROD)**: soma dos componentes do cálculo (MD + CT + SE +
  créditos aplicáveis). Para o cálculo exemplo 12992, soma R$ 5.192,05 (MD
  4.113,94 + CT 1.078,11).
- **Tabela de Custo por vigência/coluna**: `TabelasCusto` do Calcgraf — versões de
  valores com validade por período (ex.: "Padrão" vigente até 02/12/2024, "Teste"
  vigente a partir de 03/12/2024). `TabelasCustoDetalhe` traz os valores por item
  e por COLUNA (ValorTotal, ValorDireto, Depreciacao, Administracao, Outros,
  FreteKg).
- **Crédito fiscal do papel**: desconto de PIS/COFINS (9,25%) aplicado pelo
  Calcgraf ao custo do papel (material direto), que faz o preço do papel cair de
  R$ 7,45 para R$ 6,83 por kg (6,83 = 7,45 ÷ 1,0925). Achado documentado; é uma
  lacuna de configuração no Vizor.
- **Cálculo exemplo 12992**: cálculo do acervo (cliente Gerdau, "Rótulo p/ farpado
  GIR 500M", tiragem 4.000) usado como caso de validação. CalculoSTC soma R$
  5.192,05 exato, decomposto em papel 3.010,75 / impressão Roland 732,79 / BOPP
  581,82 / matriz RVU 300 / guilhotina 155,38 / 3 Pantones 221,37 / laminação 100
  / cortadeira 89,94.
- **Ancoragem (`ancorarCustoCalcgraf`)**: mecanismo existente que projeta o custo
  real do Calcgraf no item puxado, garantindo diferença ZERO ao cliente nos
  cálculos de repetição. Não deve regredir.
- **Motor (`calcularOrcamentoGrafico`)**: motor de cálculo de orçamento gráfico já
  existente no Vizor. Não deve regredir.
- **custosCalcgraf**: coluna JSON existente em `CalculoGrafico` que já guarda a
  decomposição do `CalculoSTC` para os 7.926 cálculos migrados em produção (Wega).

## Requirements

### Requirement 1: Estudo e de-para das configurações do Calcgraf

**User Story:** Como analista de migração da Carton Wega, quero um estudo
documentado que relacione cada tabela de configuração do Calcgraf com o cadastro
equivalente do Vizor e aponte as lacunas, para saber o que já existe e o que
precisa ser criado antes de operar o orçamento gráfico só no Vizor.

#### Acceptance Criteria

1. THE Vizor SHALL produzir um documento de de-para que relaciona, para cada
   tabela de configuração do Calcgraf listada no escopo (`Itc`, `TabelasCusto`,
   `TabelasCustoDetalhe`, suportes/papel, tintas, `CentrosProducao`, `Atividades`,
   `TributacaoVenda`, `CalculoTaxas`, `CalculoMargens`, `Agrupamentos`), o cadastro
   correspondente do Vizor (`PrecoMateriaPrima`, `SuporteGrafico`,
   `CentroProducao`, `AcabamentoGrafico`, `TipoEmbalagem`, `TabelaMargem`,
   `ParametroPerda`) ou a marcação "sem equivalente".
2. WHERE uma configuração do Calcgraf não possui equivalente no Vizor, THE Vizor
   SHALL registrar a lacuna no documento de de-para com descrição e impacto no
   cálculo.
3. THE Vizor SHALL registrar no de-para a lacuna do crédito fiscal do papel
   (PIS/COFINS 9,25%), informando que o Calcgraf desconta o crédito do custo do
   material direto e o Vizor migrou o preço bruto.
4. THE Vizor SHALL registrar no de-para a lacuna das tabelas de custo por vigência
   e por coluna (`TabelasCusto` / `TabelasCustoDetalhe`), informando que o Vizor
   hoje não versiona valores por período.
5. THE Vizor SHALL registrar no de-para a lacuna da tributação por operação
   (`TributacaoVenda`, `CalculoTaxas`, `CalculoMargens`), informando quais
   componentes do CEV são parametrizáveis por caso.

### Requirement 2: Catálogo centralizado de itens de custo com classificação por Origem

**User Story:** Como orçamentista da Carton Wega, quero visualizar e editar no
Vizor o catálogo de itens de custo (equivalente ao `Itc` do Calcgraf) com a
classificação de Origem de cada item, para manter a fonte de classificação
(MD/CT/SE) centralizada e consistente com o cálculo.

#### Acceptance Criteria

1. THE Vizor SHALL exibir, por empresa, a lista de itens de custo com o campo
   Origem classificado em um dos valores: `SUPORTE`, `TINTA`, `MAT.ACABAMENTO`,
   `MATRIZ IMPRESSAO`, `CENTRO DE CUSTO`, `SERVICO EXTERNO`.
2. WHEN o orçamentista edita um item de custo, THE Vizor SHALL persistir a
   alteração com o `empresaId` da empresa ativa.
3. THE Vizor SHALL derivar o grupo de custo (MD, CT ou SE) de cada item a partir
   do valor de Origem, aplicando a regra: `SUPORTE`/`TINTA`/`MAT.ACABAMENTO`/
   `MATRIZ IMPRESSAO` = MD, `CENTRO DE CUSTO` = CT, `SERVICO EXTERNO` = SE.
4. IF o orçamentista tenta salvar um item de custo com Origem fora dos valores
   permitidos, THEN THE Vizor SHALL rejeitar a alteração e retornar uma mensagem
   indicando os valores de Origem válidos.
5. WHEN o orçamentista consulta itens de custo de uma empresa, THE Vizor SHALL
   retornar, como resposta a essa consulta, somente os itens cujo `empresaId`
   corresponde à empresa ativa do solicitante.

### Requirement 3: Edição caso a caso das configurações de cálculo centralizadas

**User Story:** Como orçamentista da Carton Wega, quero editar caso a caso as
configurações de cálculo centralizadas no Vizor (preço de papel com crédito
fiscal, preço/consumo de tinta, custo-hora e acerto de máquinas, custo de
acabamentos, tributação/margens), para ajustar o orçamento gráfico sem depender do
Calcgraf.

#### Acceptance Criteria

1. THE Vizor SHALL permitir a edição do preço por kg de cada papel no cadastro de
   suportes/papel, com o `empresaId` da empresa ativa.
2. THE Vizor SHALL permitir registrar, por papel, o crédito fiscal de PIS/COFINS
   aplicável, de modo que o custo do material direto reflita o preço líquido do
   crédito.
3. WHEN o orçamentista registra um crédito fiscal de 9,25% sobre um papel com
   preço bruto de R$ 7,45 por kg, THE Vizor SHALL calcular o preço líquido como R$
   6,83 por kg (7,45 ÷ 1,0925), arredondado a duas casas decimais.
4. THE Vizor SHALL permitir a edição do custo-hora, da produção por hora e do
   acerto por cor de cada máquina/centro de produção, com o `empresaId` da empresa
   ativa.
5. THE Vizor SHALL permitir a edição do custo de cada acabamento (custo-hora e
   produção por hora, ou preço de material), com o `empresaId` da empresa ativa.
6. THE Vizor SHALL permitir a edição dos parâmetros de tributação e margem
   (PIS/COFINS, ICMS, comissões, encargo financeiro, faixas de margem) usados na
   formação do preço de venda, com o `empresaId` da empresa ativa.
7. WHEN o orçamentista salva qualquer configuração de cálculo, THE Vizor SHALL
   persistir a alteração associada ao `empresaId` da empresa ativa.

### Requirement 4: Versionamento e vigência das tabelas de custo

**User Story:** Como orçamentista da Carton Wega, quero manter versões das tabelas
de custo com validade por período (equivalente ao `TabelasCusto` do Calcgraf),
para que um cálculo use os valores vigentes na sua data e eu possa manter uma
versão de teste em paralelo.

#### Acceptance Criteria

1. THE Vizor SHALL permitir cadastrar múltiplas versões de tabela de custo por
   empresa, cada uma com nome, data de início de vigência e data de fim de
   vigência opcional.
2. THE Vizor SHALL armazenar, por versão de tabela de custo, os valores por item e
   por coluna (ValorTotal, ValorDireto, Depreciacao, Administracao, Outros,
   FreteKg).
3. IF o orçamentista tenta salvar uma versão de tabela de custo cuja vigência se
   sobrepõe à vigência de outra versão existente da mesma empresa, THEN THE Vizor
   SHALL rejeitar o salvamento informando o conflito de vigência.
4. IF nenhuma versão de tabela de custo cobre a data consultada, THEN THE Vizor
   SHALL retornar uma indicação de que não há tabela de custo vigente para a data.
5. WHEN o orçamentista consulta versões de tabela de custo de uma empresa, THE
   Vizor SHALL retornar somente as versões cujo `empresaId` corresponde à empresa
   ativa.
6. WHEN o orçamentista consulta a versão de tabela de custo vigente numa data,
   THE Vizor SHALL retornar, no máximo, a única versão da empresa ativa cuja
   vigência cobre essa data, visto que o Vizor impede o salvamento de versões com
   vigência sobreposta.

### Requirement 5: Demonstração da memória do CalculoSTC por cálculo

**User Story:** Como orçamentista da Carton Wega, quero uma visão que exiba, por
cálculo, cada componente de custo registrado no `CalculoSTC` com o valor real do
Calcgraf agrupado em MD/CT/SE e somando o custo de produção, para ter a evidência
de "de onde veio cada número" sem poder alterar a memória.

#### Acceptance Criteria

1. WHEN o orçamentista abre a demonstração de um cálculo, THE Vizor SHALL exibir
   cada componente de custo do `CalculoSTC` daquele cálculo com descrição e valor
   real do Calcgraf.
2. THE Vizor SHALL agrupar os componentes exibidos em MD, CT e SE conforme a
   Origem do item de custo associado.
3. WHEN o Vizor exibe os subtotais da demonstração de um cálculo, THE Vizor SHALL
   apresentar, em conjunto, o subtotal de MD, o subtotal de CT, o subtotal de SE
   e o total de custo de produção do cálculo, estando o requisito violado se
   qualquer um desses quatro valores estiver ausente.
4. WHEN o orçamentista abre a demonstração do cálculo exemplo 12992, THE Vizor
   SHALL exibir o subtotal de MD igual a R$ 4.113,94, o subtotal de CT igual a R$
   1.078,11 e o total de custo de produção igual a R$ 5.192,05.
5. THE Vizor SHALL ligar cada componente exibido ao item de custo de configuração
   que o produziu, identificando a Origem correspondente.
6. WHEN o Vizor apresenta a demonstração do `CalculoSTC`, THE Vizor SHALL exibir
   os valores em modo somente leitura, sem oferecer ação de edição desses valores
   na tela de demonstração.
7. WHERE um cálculo não possui linha correspondente no `CalculoSTC`, THE Vizor
   SHALL exibir uma indicação de que não há memória de custo registrada para o
   cálculo.
8. WHEN o orçamentista consulta a demonstração de um cálculo, THE Vizor SHALL
   retornar os dados somente quando o `empresaId` do cálculo corresponde à empresa
   ativa.

### Requirement 6: Isolamento multi-tenant

**User Story:** Como administrador do Vizor, quero que toda configuração e toda
demonstração de cálculo sejam isoladas por empresa, para que nenhuma empresa veja
ou altere dados de outra.

#### Acceptance Criteria

1. THE Vizor SHALL filtrar toda consulta de configuração e de memória de cálculo
   pelo `empresaId` da empresa ativa de forma explícita.
2. IF uma requisição referencia um registro de configuração ou de cálculo cujo
   `empresaId` difere do `empresaId` da empresa ativa do solicitante, THEN THE
   Vizor SHALL negar o acesso com status de acesso negado.
3. WHEN o Vizor grava um registro de configuração, THE Vizor SHALL associar o
   `empresaId` da empresa de negócio correspondente ao registro.

### Requirement 7: Não-regressão do motor de cálculo e da ancoragem

**User Story:** Como orçamentista da Carton Wega, quero que a centralização das
configurações e a demonstração do CalculoSTC não alterem o resultado do motor de
cálculo atual nem a ancoragem, para que os orçamentos de repetição continuem com
diferença zero ao cliente.

#### Acceptance Criteria

1. WHEN um cálculo de repetição é puxado após a entrega desta feature, THE Vizor
   SHALL manter o custo de produção ancorado idêntico ao valor real do Calcgraf
   gravado para o cálculo de origem.
2. THE Vizor SHALL manter inalterado o resultado do motor `calcularOrcamentoGrafico`
   para entradas que não utilizam as novas configurações.
3. WHEN o cálculo exemplo 12992 é puxado, THE Vizor SHALL manter o custo de
   produção do item igual a R$ 5.192,05.
4. THE Vizor SHALL exibir a memória do `CalculoSTC` sem modificar os valores
   persistidos no cálculo (`custosCalcgraf`) nem a foto de resultado do cálculo.
