# Requirements Document

## Introduction

O módulo **Orçamento Gráfico** do Vizor já existe e calcula corretamente (bate
com o Calcgraf via ancoragem no valor real do cálculo migrado; "Puxar Cálculo"
da Biblioteca já copia a engenharia). O problema desta feature é de
**EXPERIÊNCIA / UX**, não de motor de cálculo.

Hoje a tela de editar o item de um orçamento é um **wizard de steps** (Cliente →
Tipo → Medidas → Papel → Cores → Dados Técnicos → Acabamentos → Itens Diversos →
Revisão). O dono da Carton Wega — que está migrando do sistema desktop
Calcgraf/GPrint para o Vizor — relata três dores concretas:

1. **Descoberta dos campos técnicos.** O usuário não acha facilmente onde estão
   nem como preencher os campos técnicos de paridade (Sigla Acabado, Tributação,
   Processo de Impressão, Cobertura de Tinta, Fabricante, Qtd. de Modelos, Arte,
   Microondulado, Fornecido, Observação, Observação de Áreas de OP,
   geometria/montagem/formatos, Acondicionamento, Conteúdo por Volume) — eles
   ficam "escondidos" dentro de um step do wizard.
2. **Preenchimento ao puxar cálculo.** Vários desses campos técnicos nascem
   VAZIOS ao "Puxar Cálculo", porque o mapeamento de puxar
   (`calculoParaItemBody` em `calculo-grafico-mapeamento.ts`, sobre o shape
   `CamposEngenhariaCalculo`) copia apenas os campos de ENGENHARIA (medidas,
   papel/suporte, gramatura, cores, numCores, máquina, matriz, tinta,
   acabamentos ricos, montagem, formato de corte, itens diversos/fornecidos/
   campos livres, aproveitamento, quantidade, margem). Os campos técnicos de
   paridade NÃO fazem parte desse shape, logo NÃO são copiados.
3. **Confiança de paridade.** O cliente precisa SENTIR que o Vizor faz tudo que
   o Calcgraf faz, de forma visualmente clara e intuitiva (planos, estrutura/
   decomposição de custo e fechamento visíveis), não enterrado em steps lineares.

Esta feature reformula a **experiência** de criar/editar um Orçamento Gráfico e
seu item para atingir **paridade de entendimento** com o Calcgraf, com dois
focos explícitos do usuário:

- **(A) O QUE É PREENCHIDO AO PUXAR UM CÁLCULO** — mapear campo a campo o que vem
  do cálculo, o que precisa ser preenchido manualmente, e decidir o que mais
  pode passar a ser copiado quando existir na origem.
- **(B) PROPOSTA VISUAL** — repensar as telas (ver a seção "Proposta de Layout"
  ao final, com wireframes textuais) saindo de um wizard linear para uma visão
  de página única com seções agrupadas e âncoras, estilo "editor de item" do
  Calcgraf, com planos/estrutura/fechamento visíveis.

Escopo majoritariamente **FRONTEND** (reorganização/apresentação) + pequenos
ajustes de **BACKEND** no mapeamento de puxar cálculo (copiar mais campos
técnicos quando existirem na origem) e, se necessário, no retorno das rotas.

### Limites de escopo

- **NÃO** avançar para OP (o fluxo PCP/OP está fora desta feature).
- O **motor de cálculo NÃO é alterado** — preço, ancoragem e decomposição já
  existem e permanecem intactos (não-regressão obrigatória).
- **Caso-piloto de validação visual:** orçamento 3223 (Cartucho Composto,
  Cervejaria Imperial, cálculo 10263).
- **Multi-tenant:** `empresaId` explícito em toda query (padrão do projeto).
- **Desktop-first**, com degradação responsável em telas menores.

## Glossary

- **Vizor**: o ERP gráfico multi-tenant (VisioFab.Wms) alvo desta feature.
- **Calcgraf**: sistema desktop legado (Delphi/PHTech, também chamado GPrint) do
  qual a Carton Wega está migrando; referência de paridade de terminologia e
  organização de tela.
- **Editor_de_Item**: a tela reformulada de criar/editar um item de orçamento,
  substituindo o wizard linear por uma página única com seções ancoradas.
- **Painel_Orcamento**: a tela de cabeçalho + grid de itens + painel de
  fechamento de um orçamento (equivalente à tela "Orçamentos" do Calcgraf).
- **Item_Orcamento**: um item do orçamento (`ItemOrcamentoGrafico`), que carrega
  engenharia, campos técnicos de paridade e o resultado de cálculo.
- **Campo_Tecnico**: campo de paridade persistido no `Item_Orcamento` que NÃO
  afeta o custo: Sigla Acabado, Tributação, Processo de Impressão, Cobertura de
  Tinta (texto), Fabricante, Qtd. de Modelos, Arte, Microondulado, Fornecido,
  Observação, Observação de Áreas de OP, Acondicionamento, Conteúdo por Volume.
- **Campo_Engenharia**: campo que afeta o cálculo (medidas, papel/suporte,
  gramatura, cores, número de cores, máquina, matriz, tinta, acabamentos ricos,
  montagem, formato de corte, aproveitamento, quantidade/tiragem, margem).
- **Puxar_Calculo**: ação de criar um `Item_Orcamento` (ou um orçamento novo)
  copiando a foto/engenharia de um `CalculoGrafico` da Biblioteca.
- **Mapeamento_Puxar**: a função `calculoParaItemBody` (sobre
  `CamposEngenhariaCalculo`) que define, campo a campo, o que é copiado ao puxar.
- **Plano**: componente/tipo de plano de um item (ex.: TAMPA, CAIXA, FRENTE/
  COSTA), com suporte/cores/formato/acabamento próprios (`PlanoCalculoGrafico`).
- **Estrutura_Custo**: a decomposição de custo do resultado do cálculo (MD/CT/SE
  por componente: papel, tinta por cor, máquinas, acabamentos), já disponível em
  `resultadoCalculo` e em `custosCalcgraf`.
- **Fechamento**: o bloco de formação de preço (tiragem, margem, contribuição
  marginal, CEV, valor unitário, valor total) do orçamento/item.
- **Tabela_De_Para_Puxar**: a tabela desta spec que lista, campo a campo, o que
  o `Puxar_Calculo` preenche, o que fica manual e o que passará a ser copiado.
- **Secao_Ancorada**: um bloco visual do `Editor_de_Item` acessível por uma
  âncora/menu lateral (ex.: Produto, Planos, Dados Técnicos, Estrutura,
  Fechamento).

## Requirements

### Requirement 1: Organização e navegação do Editor de Item (página única ancorada)

**User Story:** Como orçamentista da Carton Wega, quero editar um item do
orçamento em uma página única com seções agrupadas e navegação por âncoras, para
enxergar toda a engenharia e os dados técnicos de uma vez, como no editor de item
do Calcgraf, em vez de avançar por steps lineares.

#### Acceptance Criteria

1. THE Editor_de_Item SHALL apresentar o conteúdo do item em seções agrupadas em
   uma única página rolável, contendo no mínimo as Secao_Ancorada: Produto,
   Planos, Dados Técnicos, Acabamentos, Estrutura de Custo e Fechamento.
2. THE Editor_de_Item SHALL exibir um índice de navegação por âncoras que lista
   todas as Secao_Ancorada presentes.
3. WHEN o usuário aciona uma âncora do índice de navegação, THE Editor_de_Item
   SHALL rolar a página até a Secao_Ancorada correspondente.
4. WHILE o usuário rola a página do Editor_de_Item, THE Editor_de_Item SHALL
   destacar no índice de navegação a Secao_Ancorada atualmente visível.
5. THE Editor_de_Item SHALL preservar todos os campos e capacidades de edição
   hoje disponíveis no wizard de steps (Cliente, Tipo, Medidas, Papel, Cores,
   Dados Técnicos, Acabamentos, Itens Diversos, Revisão), sem remover nenhum.
6. WHERE uma Secao_Ancorada sem dados ainda assim exige atenção do usuário (ex.:
   Dados Técnicos com Campo_Tecnico vazios após o Puxar_Calculo), THE
   Editor_de_Item SHALL exibir a seção com um estado explicativo em vez de
   ocultá-la silenciosamente. A ocultação da Secao_Ancorada "Planos" no caso de
   plano único segue o Requisito 5.2.

### Requirement 2: Painel do Orçamento (cabeçalho + itens + fechamento)

**User Story:** Como orçamentista, quero visualizar o orçamento em uma tela com
cabeçalho, grid de itens e um painel de fechamento, para acompanhar tiragens,
margens e valores de todos os itens de uma vez, como na tela "Orçamentos" do
Calcgraf.

#### Acceptance Criteria

1. THE Painel_Orcamento SHALL exibir um cabeçalho com Série, Número do Orçamento,
   Data, Cliente Principal e o Cálculo utilizado (quando o item tiver origem de
   cálculo).
2. THE Painel_Orcamento SHALL exibir um grid de itens do orçamento com, no
   mínimo, Item (sequência), Cálculo de origem, Tipo de Produto, Descrição,
   Tiragem e Status.
3. THE Painel_Orcamento SHALL exibir um painel de Fechamento consolidado com
   Tiragem, Margem, Contribuição Marginal, Valor Unitário e Valor Total.
4. WHEN o usuário seleciona um item no grid de itens, THE Painel_Orcamento SHALL
   abrir automaticamente o Editor_de_Item correspondente a esse item, sem exigir
   ação adicional.
5. WHERE o orçamento é de repetição (origem em cálculo), THE Painel_Orcamento
   SHALL identificar visualmente o item como "Repetição" e exibir o número do
   cálculo de origem.

### Requirement 3: Descoberta e preenchimento dos Campos Técnicos

**User Story:** Como orçamentista, quero encontrar e preencher com clareza todos
os campos técnicos de paridade em uma seção dedicada, para registrar as mesmas
informações que o Calcgraf exige, sem procurá-las espalhadas pelos steps.

#### Acceptance Criteria

1. THE Editor_de_Item SHALL agrupar em uma Secao_Ancorada "Dados Técnicos" todos
   os Campo_Tecnico: Sigla Acabado, Tributação, Processo de Impressão, Cobertura
   de Tinta, Fabricante, Qtd. de Modelos, Arte, Microondulado, Fornecido,
   Observação, Observação de Áreas de OP, Acondicionamento e Conteúdo por Volume.
2. THE Editor_de_Item SHALL exibir, para cada Campo_Tecnico, um rótulo com a
   terminologia equivalente à do Calcgraf.
3. WHEN o usuário salva o Item_Orcamento, THE Vizor SHALL persistir os valores de
   todos os Campo_Tecnico informados nas colunas correspondentes de
   `ItemOrcamentoGrafico`.
4. THE Editor_de_Item SHALL exibir cada Campo_Tecnico com o tipo de entrada
   adequado ao seu tipo persistido (texto para Sigla Acabado/Tributação/Processo
   de Impressão/Cobertura de Tinta/Fabricante/Arte; inteiro para Qtd. de Modelos
   e Conteúdo por Volume; alternância booleana para Microondulado e Fornecido;
   texto longo para Observação e Observação de Áreas de OP).
5. IF o usuário informa um valor fora do tipo esperado de um Campo_Tecnico,
   THEN THE Editor_de_Item SHALL impedir o salvamento e indicar o campo inválido.
6. THE Editor_de_Item SHALL exibir os Campo_Tecnico sem alterar o resultado de
   cálculo do Item_Orcamento (os Campo_Tecnico não afetam o custo).

### Requirement 4: Comportamento do Puxar Cálculo campo-a-campo (De-Para)

**User Story:** Como orçamentista que reaproveita cálculos, quero saber
exatamente o que é preenchido automaticamente ao Puxar Cálculo e o que ainda
preciso completar, para confiar no reaproveitamento e não entregar um orçamento
com campos técnicos vazios.

#### Acceptance Criteria

1. THE Puxar_Calculo SHALL copiar do cálculo de origem todos os Campo_Engenharia
   que o Mapeamento_Puxar já suporta (medidas, papel/suporte, gramatura, cores,
   número de cores, máquina, matriz, tinta, acabamentos ricos, montagem, formato
   de corte, itens diversos/fornecidos/campos livres, aproveitamento, tiragem e
   margem), preservando o comportamento atual.
2. WHERE um Campo_Tecnico existe no cálculo de origem (ex.: Sigla Acabado, que o
   `CalculoGrafico` persiste), THE Puxar_Calculo SHALL copiar esse Campo_Tecnico
   para o Item_Orcamento criado.
3. WHERE um Campo_Tecnico não existe no cálculo de origem, THE Puxar_Calculo
   SHALL deixar esse Campo_Tecnico vazio no Item_Orcamento sem inventar valor.
4. WHEN o Puxar_Calculo cria o Item_Orcamento, THE Editor_de_Item SHALL sinalizar
   visualmente quais Campo_Tecnico ficaram vazios e precisam ser completados
   manualmente.
5. THE Tabela_De_Para_Puxar SHALL documentar, para cada campo do Item_Orcamento,
   se ele é Copiado-do-cálculo, Manual (sem fonte na origem) ou
   Passará-a-ser-copiado (quando houver fonte na origem).
6. THE Puxar_Calculo SHALL preservar a ancoragem do custo real do Calcgraf no
   Item_Orcamento criado, sem alterar o valor consolidado já existente.

### Requirement 5: Planos / Tipos de Plano

**User Story:** Como orçamentista, quero ver e editar os planos (tipos de plano)
de um item em uma seção dedicada, para refletir a estrutura real do produto
(ex.: frente/costa, tampa/caixa), como na tela "Tipos de Plano" do Calcgraf.

#### Acceptance Criteria

1. THE Editor_de_Item SHALL apresentar uma Secao_Ancorada "Planos" com os planos
   do item, exibindo por plano: Nome, Suporte, Cores, Formato e Acabamento.
2. WHERE o item não possui planos (plano único/sem plano), THE Editor_de_Item
   SHALL ocultar inteiramente a Secao_Ancorada "Planos" (inclusive sua entrada no
   índice de navegação por âncoras).
3. WHEN o usuário abre a edição de um plano, THE Editor_de_Item SHALL exibir os
   atributos do plano (Nome, Tiragem, Montagem, Corte, Formato, Cores, Processo
   de Impressão, Cobertura de Tinta e Suporte) com a terminologia do Calcgraf.
4. THE Editor_de_Item SHALL exibir os planos sem alterar o resultado de cálculo
   já existente do Item_Orcamento (apresentação/edição, não recálculo implícito).

### Requirement 6: Visão de Estrutura / Decomposição de Custo

**User Story:** Como orçamentista, quero ver a decomposição de custo do item
(papel, tinta, máquinas, acabamentos) por componente, para conferir de onde vem o
valor, como na tela "Estrutura" do Calcgraf.

#### Acceptance Criteria

1. THE Editor_de_Item SHALL apresentar uma Secao_Ancorada "Estrutura de Custo"
   que lista os componentes de custo do Item_Orcamento agrupados por tipo
   (Material Direto, Custo de Transformação e Serviços Externos).
2. THE Editor_de_Item SHALL exibir, por componente da Estrutura_Custo, a
   descrição e o custo total, a partir do `resultadoCalculo`/`custosCalcgraf` já
   existente.
3. WHERE a decomposição `custosCalcgraf` (detalhe por componente) está disponível
   no cálculo de origem, THE Editor_de_Item SHALL exibir o detalhamento por
   componente (papel, tinta por cor, máquinas, acabamentos).
4. WHERE apenas os totais consolidados (MD/CT/SE) estão disponíveis, THE
   Editor_de_Item SHALL exibir os totais consolidados e indicar que o
   detalhamento por componente não está disponível.
5. THE Editor_de_Item SHALL exibir a Estrutura_Custo em modo leitura (não edita o
   resultado de cálculo).

### Requirement 7: Fechamento visível (margens / CEV / valores)

**User Story:** Como orçamentista, quero visualizar o fechamento do item (tiragem,
margem, contribuição marginal, CEV e valores) de forma clara, para entender a
formação do preço, como na tela "Fechamento" do Calcgraf.

#### Acceptance Criteria

1. THE Editor_de_Item SHALL apresentar uma Secao_Ancorada "Fechamento" com
   Tiragem, Margem, Contribuição Marginal, CEV, Valor Unitário e Valor Total do
   Item_Orcamento.
2. THE Editor_de_Item SHALL exibir os valores de Fechamento a partir do
   `resultadoCalculo`/fechamento consolidado já existente.
3. WHERE o cálculo de origem fornece faixas de margem alternativas, THE
   Editor_de_Item SHALL exibir as faixas de margem e destacar a margem
   selecionada.
4. WHEN o usuário escolhe uma faixa de margem alternativa, THE Editor_de_Item
   SHALL atualizar o Fechamento exibido (Valor Unitário, Valor Total e
   Contribuição Marginal) conforme a faixa escolhida, sem persistir essa troca
   nem alterar o valor consolidado já gravado do Item_Orcamento.
5. THE Editor_de_Item SHALL exibir o Fechamento sem alterar o valor consolidado
   já persistido do Item_Orcamento enquanto o usuário não confirmar explicitamente
   uma mudança de margem.

### Requirement 8: Paridade de terminologia com o Calcgraf

**User Story:** Como usuário migrando do Calcgraf, quero ver os mesmos nomes de
campos e seções que eu já conheço, para reconhecer o Vizor como equivalente ao
Calcgraf sem reaprender a nomenclatura.

#### Acceptance Criteria

1. THE Editor_de_Item SHALL usar, nos rótulos dos campos e seções, a terminologia
   equivalente à do Calcgraf (ex.: "Sigla Acabado", "Tipos de Plano",
   "Acondicionamento", "Conteúdo por Volume", "Estrutura", "Fechamento").
2. THE Painel_Orcamento SHALL usar, nos títulos de colunas e painéis, a
   terminologia equivalente à do Calcgraf (ex.: "Itens do Orçamento",
   "Fechamento").
3. WHERE um termo do Vizor diverge do termo do Calcgraf, THE Vizor SHALL adotar o
   termo do Calcgraf como rótulo exibido ao usuário nos elementos cobertos pelos
   critérios 8.1 e 8.2 (Editor_de_Item e Painel_Orcamento), sem exigir alteração
   de terminologia nas demais telas, mensagens ou relatórios do módulo.

### Requirement 9: Acessibilidade e responsividade (desktop-first)

**User Story:** Como usuário que opera em desktop mas eventualmente acessa em
telas menores, quero uma interface acessível e que se adapte ao tamanho da tela,
para trabalhar com conforto e sem perder funcionalidade.

#### Acceptance Criteria

1. THE Editor_de_Item SHALL priorizar o layout desktop, mantendo as
   Secao_Ancorada legíveis e utilizáveis em telas menores por meio de
   reempilhamento das seções.
2. THE Editor_de_Item SHALL permitir navegação por teclado entre as
   Secao_Ancorada e os campos de formulário.
3. THE Editor_de_Item SHALL associar rótulo a cada campo de formulário de modo
   programático (rótulo vinculado ao controle).
4. WHERE o índice de navegação por âncoras não couber ao lado do conteúdo em
   telas menores, THE Editor_de_Item SHALL reposicioná-lo abaixo do conteúdo
   mantendo o formato expandido (lista completa de âncoras visível), sem removê-lo.

### Requirement 10: Validação no caso-piloto (orçamento 3223)

**User Story:** Como dono da Carton Wega, quero validar a nova experiência no
orçamento 3223 (Cartucho Composto, Cervejaria Imperial, cálculo 10263), para
confirmar visualmente que o Vizor cobre o que o Calcgraf cobre.

#### Acceptance Criteria

1. WHEN o orçamento 3223 é aberto no Painel_Orcamento, THE Painel_Orcamento SHALL
   exibir o cabeçalho, o grid de itens e o Fechamento consolidado sem erro.
2. WHEN o item do orçamento 3223 é aberto no Editor_de_Item, THE Editor_de_Item
   SHALL exibir as Secao_Ancorada Produto, Planos, Dados Técnicos, Acabamentos,
   Estrutura de Custo e Fechamento com os dados do cálculo 10263.
3. THE Editor_de_Item SHALL sinalizar no orçamento 3223 quais Campo_Tecnico
   ficaram vazios após o Puxar_Calculo, conforme a Tabela_De_Para_Puxar.

## Tabela De-Para do Puxar Cálculo (campo a campo)

Esta tabela cumpre o foco (A) do usuário e serve de base para o design e para os
critérios do Requisito 4. Classificação:

- **Copiado**: o `Mapeamento_Puxar` já copia hoje (campo de engenharia).
- **Manual**: não há fonte no cálculo de origem — permanece manual.
- **Passa a copiar**: há fonte na origem (`CalculoGrafico`) e o design deve
  estender o mapeamento para copiá-lo.

### Campos de Engenharia (já copiados — preservar)

| Campo do Item | Origem no cálculo | Classificação |
|---|---|---|
| Tipo de embalagem | `tipoEmbalagemId` | Copiado |
| Medidas (produto) | `medidas` | Copiado |
| Papel / Suporte | `papelId` / `suporteId` / `papelDescricao` | Copiado |
| Gramatura | `gramatura` | Copiado |
| Cores (nome/tipo/cobertura/preço) | `cores` | Copiado |
| Número de cores | `numCores` | Copiado |
| Máquina de impressão | `maquinaId` | Copiado |
| Matriz (qtd/preço) | `matrizQuantidade`/`matrizPrecoUnitario` (ou derivada de STC/foto) | Copiado |
| Tinta (modo/consumo) | `tintaModo`/`tintaConsumoKg` | Copiado |
| Acabamentos ricos | `acabamentosRicos` | Copiado |
| Modelo/Faca | `modeloFacaId` | Copiado |
| Aproveitamento | `aproveitamentoManual` | Copiado |
| Montagem (linhas/colunas) | `montagemLinhas`/`montagemColunas` | Copiado |
| Formato de corte | `formatoCorteLarguraMm`/`formatoCorteAlturaMm` | Copiado |
| Itens diversos / fornecidos / campos livres | `itensDiversos`/`itensFornecidos`/`camposLivres` | Copiado |
| Tiragem | `quantidade` | Copiado |
| Margem selecionada | `margemSelecionada` | Copiado |
| Custo/valor consolidado (ancoragem) | foto `resultadoCalculo` + `custoProducao`/`valorTotal` | Copiado |

### Campos Técnicos de Paridade (hoje NÃO copiados)

| Campo Técnico do Item | Existe no `CalculoGrafico` de origem? | Classificação alvo |
|---|---|---|
| Sigla Acabado (`siglaAcabado`) | Sim (`CalculoGrafico.siglaAcabado`) | **Passa a copiar** |
| Tributação (`tributacao`) | Não | Manual |
| Processo de Impressão (`processoImpressao`) | Não (texto; há `maquinaId` de engenharia, mas não o texto de processo) | Manual |
| Cobertura de Tinta — texto (`coberturaTintaTexto`) | Não (há cobertura por cor na engenharia, não o texto de paridade) | Manual |
| Fabricante (`fabricante`) | Não | Manual |
| Qtd. de Modelos (`qtdModelos`) | Não | Manual |
| Arte (`arte`) | Não | Manual |
| Microondulado (`microondulado`) | Não | Manual |
| Fornecido (`fornecido`) | Não | Manual |
| Observação (`observacao`) | Não | Manual |
| Observação de Áreas de OP (`observacaoAreasOp`) | Não | Manual |
| Acondicionamento (`acondicionamento`) | Não | Manual |
| Conteúdo por Volume (`conteudoVolume`) | Não | Manual |

> Observação de design: o único Campo_Tecnico com fonte garantida na origem
> migrada é a **Sigla Acabado**. O design deve estender o `Mapeamento_Puxar`
> (shape `CamposEngenhariaCalculo` → body do item) para copiá-la, e os demais
> permanecem Manual até que uma fonte confiável exista na origem (nunca
> inventar valor — regra do projeto). Caso no futuro a foto rica/engenharia do
> cálculo passe a trazer outros campos técnicos (ex.: fabricante, processo), o
> design deve prever a extensão incremental sem regressão.

## Proposta de Layout (wireframe textual)

Esta seção cumpre o foco (B) do usuário: um desenho textual de como repensar as
telas. A proposta é **visão de página única com seções agrupadas e âncoras**,
inspirada no editor de item do Calcgraf, substituindo o wizard linear.

### Tela 1 — Painel do Orçamento (equivalente à tela "Orçamentos" do Calcgraf)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Orçamento  ◂ Série: 3223   Nº: 3223   Data: 00/00/0000                      │
│ Cliente Principal: Cervejaria Imperial            [ Puxar Cálculo ] [ Novo ]│
├───────────────────────────────────────────────────────────────────────────┤
│ ITENS DO ORÇAMENTO                                                          │
│ ┌────┬──────────┬──────────────────┬───────────────┬─────────┬───────────┐ │
│ │ #  │ Cálculo  │ Tipo de Produto  │ Descrição     │ Tiragem │ Status    │ │
│ ├────┼──────────┼──────────────────┼───────────────┼─────────┼───────────┤ │
│ │ 1  │ 10263 ◂  │ Cartucho Composto│ CARTUCHO ...  │  50.000 │ Repetição │ │ ← clique abre o Editor de Item
│ └────┴──────────┴──────────────────┴───────────────┴─────────┴───────────┘ │
├───────────────────────────────────────────────────────────────────────────┤
│ FECHAMENTO (consolidado)                                                    │
│  Tiragem   Margem   C.Marg   Valor Unitário   Valor Total                   │
│   50.000    30%      27,1%        R$ 0,000        R$ 0,00                     │
└───────────────────────────────────────────────────────────────────────────┘
```

### Tela 2 — Editor de Item (página única com âncoras, estilo Calcgraf)

```
┌─ Editar Item — Cartucho Composto (Cálculo 10263) ───────────────────────────┐
│ ┌──────────────┐ ┌────────────────────────────────────────────────────────┐ │
│ │ ÂNCORAS      │ │ ▸ PRODUTO                                                │ │
│ │ ▸ Produto    │ │   Tipo: Cartucho Composto   Tributação: [____]           │ │
│ │ ▸ Planos     │ │   Sigla Acabado: [CTC]  (copiado)                        │ │
│ │ ▸ Dados Téc. │ │   Comp × Larg × Alt: [__]×[__]×[__]  Aba Cola/Fec: [__]  │ │
│ │ ▸ Acabamentos│ │   Tiragem: [50.000]   Qtd. Modelos: [__]                 │ │
│ │ ▸ Estrutura  │ ├────────────────────────────────────────────────────────┤ │
│ │ ▸ Fechamento │ │ ▸ PLANOS (Tipos de Plano)                                │ │
│ │              │ │   ┌──────┬─────────┬──────┬─────────┬───────────────┐    │ │
│ │ [legenda]    │ │   │ Nome │ Suporte │Cores │ Formato │ Acabamento    │    │ │
│ │ ● copiado    │ │   │ Base │ Stora.. │ 5x0  │ 650x910 │ Lamin., Corte │    │ │
│ │ ○ manual     │ │   └──────┴─────────┴──────┴─────────┴───────────────┘    │ │
│ │ (vazio)      │ │   (plano único → "Este item usa plano único")           │ │
│ │              │ ├────────────────────────────────────────────────────────┤ │
│ │              │ │ ▸ DADOS TÉCNICOS                                         │ │
│ │              │ │   Processo Impressão: [____]  Cobertura Tinta: [____]    │ │
│ │              │ │   Fabricante: [____]   Arte: [____]                      │ │
│ │              │ │   ☐ Microondulado   ☐ Fornecido                          │ │
│ │              │ │   Acondicionamento: [____]  Conteúdo/Volume: [__]        │ │
│ │              │ │   Observação: [______________________________________]  │ │
│ │              │ │   Obs. Áreas de OP: [________________________________]   │ │
│ │              │ │   ⚠ Campos vazios após puxar: Tributação, Fabricante…    │ │
│ │              │ ├────────────────────────────────────────────────────────┤ │
│ │              │ │ ▸ ACABAMENTOS  (lista de atividades com custo)           │ │
│ │              │ ├────────────────────────────────────────────────────────┤ │
│ │              │ │ ▸ ESTRUTURA DE CUSTO  (leitura)                          │ │
│ │              │ │   MD  Papel Stora Enzo 415 ........... R$ 3.010,75       │ │
│ │              │ │   MD  Pantone 01/02/03 .............. R$ 221,37          │ │
│ │              │ │   CT  Impressão Roland .............. R$ 732,79          │ │
│ │              │ │   CT  Guilhotina / Cortadeira ....... R$ 245,32          │ │
│ │              │ ├────────────────────────────────────────────────────────┤ │
│ │              │ │ ▸ FECHAMENTO                                             │ │
│ │              │ │   Tiragem 50.000 · Margem 30% · C.Marg 27,1% · CEV 21,25%│ │
│ │              │ │   Valor Unitário R$ 0,000 · Valor Total R$ 0,00          │ │
│ │              │ │   Faixas de margem: 10% | 15,9% | [30% ✓]                │ │
│ └──────────────┘ └────────────────────────────────────────────────────────┘ │
│                                        [ Cancelar ]   [ Salvar Item ]        │
└──────────────────────────────────────────────────────────────────────────────┘
```

Notas da proposta:

- O índice de ÂNCORAS fica fixo à esquerda em desktop; em telas menores é
  reposicionado abaixo do conteúdo, mantendo a lista completa visível (Req 9.4).
- A âncora "Planos" só aparece quando o item tem planos; em item de plano único
  a seção e sua âncora são ocultadas inteiramente (Req 5.2). O wireframe acima
  mostra o caso COM planos.
- A legenda `● copiado / ○ manual / (vazio)` materializa a Tabela_De_Para_Puxar
  diretamente na tela, sinalizando ao usuário o que falta completar (Req 4.4).
- Estrutura de Custo é **somente leitura** (Req 6.5). O Fechamento é leitura, mas
  o usuário pode pré-visualizar faixas de margem alternativas; a troca só altera
  a exibição e não persiste nem muda o valor consolidado sem confirmação
  explícita (Req 7.4, 7.5).
- Nada aqui aciona o fluxo de OP (fora de escopo).
