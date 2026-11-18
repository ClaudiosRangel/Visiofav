# Requirements Document

## Introduction

Reforma do front do Orçamento Gráfico do Vizor para refletir a hierarquia **ORÇAMENTO (1) → ITEM (N) → PLANO (N)**, separando visualmente os dados do orçamento, do item e do plano, com o **Fechamento** totalizando todos os itens do orçamento. Hoje o `EditorItem` mistura tudo em 8 âncoras numa única página, o plano é editado em modal separado e o Fechamento é uma seção dentro do item.

Fontes de verdade (aprovadas pelo usuário):

- `.kiro/steering/orcamento-grafico-visao-front-calcgraf.md` (visão obrigatória, seções 1 a 6).
- `docs/orcamento-grafico-wireframe-hierarquia.md` (desenho das 3 telas, mapa campo → dado, lacunas e respostas do usuário de 17/11/2026).

Escopo de código:

- Front: `c:\Source\VisioFab.Wms.Front\src\app\(interna)\orcamento-grafico\` (páginas `[id]`, `[id]/editor`, `PlanosDoItem*`, `FechamentoOrcamento`).
- Back: ajustes pontuais e **aditivos** (`schema.prisma` + `prisma/migrate-prod.ts` idempotente no mesmo commit). O motor de cálculo e `ancorarCustoCalcgraf` não são alterados.

Princípio central: **não engessar**. A tela do item é dirigida pelo cadastro do Produto Gráfico (`modoFormato`, `formatoPadraoLargura/Altura`, `exibeRestricoes`, `exibeInformacoesComplementares`, `semImpressao`, `DefaultProdutoPlano`), nunca por nome de produto no código. A decisão entre plano único e multi-plano vem do cadastro (`TipoPlanoGrafico.fixo` e linha de produto).

Entrega em fases, começando pela Tela 1 (grid de itens + Fechamento totalizador). O desenho geral das telas já foi aprovado; cada fase confere o wireframe antes de codar.

## Glossary

- **Vizor**: ERP VisioFab, sistema alvo desta reforma.
- **Orcamento**: registro `OrcamentoGrafico`; contém N itens.
- **Item**: registro `ItemOrcamentoGrafico`; dados comuns do produto, comuns a todos os planos.
- **Plano**: especificação própria de um conjunto de suporte, cores, formato e acabamentos; registro `PlanoCalculoGrafico` (multi-plano) ou plano implícito nos campos achatados do Item (plano único).
- **Plano_Unico**: Item cujo Produto_Grafico aponta para um `TipoPlanoGrafico` com `fixo = true` (linhas Cartucho e Lâmina Simples hoje). Não tem grid de planos.
- **Multi_Plano**: Item cujo Produto_Grafico não tem plano fixo. Tem grid "Tipos de Plano".
- **Produto_Grafico**: cadastro `ProdutoGrafico` que dirige a tela do Item.
- **Modo_Formato**: campo `modoFormato` do Produto_Grafico (`TRES_DIMENSOES`, `DUAS_DIMENSOES`, `ABERTO_FECHADO`, `SANFONA_ABAS`, `PAGINA`).
- **Tela_Orcamento**: Tela 1 (`/orcamento-grafico/[id]`): cabeçalho, grid de itens, painel Dados do Item, abas Fechamento e Comissões.
- **Tela_Item**: Tela 2: dados do produto e, em Plano_Unico, os campos do plano embutidos.
- **Tela_Plano**: Tela 3 ("Inclusão/Alteração de Tipo de Plano"), usada só em Multi_Plano.
- **Grid_Itens**: grid "Itens do Orçamento" com colunas item, Cálculo, Linha de Produto, Tipo de Produto, Tiragens, Descrição, Status.
- **Grid_Planos**: grid "Tipos de Plano" com colunas Nome, Suporte, Cores, Formato, Acabamento.
- **Painel_Dados_Item**: resumo somente leitura do Item selecionado na Tela_Orcamento.
- **Ficha_Master**: ficha gráfica do produto (`FichaGraficaProduto`, com imagem de corte e dados gráficos) e arte versionada (`ArteRevisaoProduto`), gravadas pela Pré-Impressão no cadastro do `Produto`.
- **Preview_Ficha_Master**: tela somente leitura, aberta por botão da Tela_Orcamento, que mostra a Ficha_Master do produto do Orcamento (corte, arte e dados gráficos). Não pertence ao Grid_Itens.
- **Fechamento**: grid `Tiragem | Margem | C.Marg. | Valor Unitário | Valor Total`, uma linha por tiragem, somando todos os itens do Orcamento.
- **Atividade**: acabamento/atividade marcável (`AcabamentoGrafico`).
- **Restricao**: `RestricaoAcabamento`, filha de uma Atividade.
- **Material_Atividade**: `MaterialAcabamento`, com `tipoParam` (ex.: Cola Branca/Cola Quente com "Medida em mm").
- **Suporte_Nao_Cadastrado**: fluxo do botão NC que cadastra na hora um papel fora do catálogo.
- **Preco_Provisorio**: `PrecoMateriaPrima` criado pelo NC, marcado como provisório para regularização.
- **Especificacao_Plano**: Json aditivo proposto em `PlanoCalculoGrafico` para campos de plano sem coluna própria (decisão aberta D1).
- **Ancoragem**: função `ancorarCustoCalcgraf`, que projeta no resultado do item o custo real do cálculo de origem; não pode ser alterada.
- **Token_Adaptativo**: token de cor/estilo do Mantine que segue o tema ativo (ex.: `--mantine-color-body`, `*-light`).
- **Texto_Visivel**: qualquer texto renderizado ao usuário (labels, títulos, placeholders, mensagens, tooltips).
- **Marca_Legada**: nomes do sistema de origem (Calcgraf, G-Print, GPrint e variações), proibidos em Texto_Visivel.

## Requirements

### Requirement 1: Separação visual em três níveis

**User Story:** Como orçamentista, quero ver separados os dados do orçamento, do item e do plano, para saber exatamente em que nível estou editando cada informação.

#### Acceptance Criteria

1. THE Vizor SHALL apresentar o Orcamento em uma Tela_Orcamento, o Item em uma Tela_Item e o Plano em uma Tela_Plano, cada uma com título visível que contém o rótulo do seu nível ("Orçamento", "Item" ou "Plano") seguido do identificador do registro (número do orçamento, nome do produto do item ou nome do plano, respectivamente).
2. THE Tela_Orcamento SHALL exibir somente: os campos do Orcamento (Série, Número do Orçamento, Data, Cliente Principal e a opção "Reforma Tributária 2027"), o Grid_Itens, o Painel_Dados_Item somente leitura, as abas Fechamento e Comissões e o botão "Preview" do Requirement 21, sem exibir nenhum campo editável de Item ou de Plano e sem exibir upload de imagem da faca.
3. WHILE o Item é Multi_Plano, THE Tela_Item SHALL omitir os campos de plano (suporte, cores, processo de impressão, cobertura de tinta, formato de corte, acabamento de plano) e SHALL exibir o grid de planos com as colunas Nome, Suporte, Cores, Formato e Acabamento e as ações Incluir, Copiar, Excluir, Reordenar e Desfazer.
4. THE Tela_Plano SHALL exibir somente campos de Plano (tipo de plano, nome, tiragem, montagem, formato de corte, formato aberto, formato final, cores, processo de impressão, cobertura de tinta, suportes, fibra, acabamento do plano) e SHALL omitir todos os campos de Item (descrição, sigla acabado, tributação, tiragens do item, modelos, acabamentos de produto, acondicionamento).
5. THE Vizor SHALL substituir o `EditorItem` de 8 âncoras por Tela_Item e Tela_Plano, de modo que nenhuma rota do orçamento gráfico renderize campos de Item e campos de Plano de item Multi_Plano na mesma tela, e que o `EditorItem` não seja reaproveitado como está.
6. WHEN o usuário abre um Item a partir da Tela_Orcamento (duplo clique na linha do Grid_Itens ou ação Abrir), THE Vizor SHALL navegar para a Tela_Item do Item escolhido em até 2 segundos.
7. WHILE o Item é de plano único (definido pelo cadastro do Produto, não pelo nome do produto), THE Tela_Item SHALL exibir os campos do plano único na própria tela e SHALL omitir o grid de planos.
8. WHEN o usuário clica em um plano no grid de planos da Tela_Item, THE Vizor SHALL navegar para a Tela_Plano do plano escolhido, e WHEN o usuário aciona Incluir, THE Vizor SHALL abrir a Tela_Plano vazia para um novo plano do mesmo Item.
9. IF o Item ou o Plano solicitado não existe ou pertence a outra empresa, THEN THE Vizor SHALL permanecer na tela de origem, exibir uma mensagem de erro indicando que o registro não foi encontrado e não alterar nenhum dado.

### Requirement 2: Tela 1 — cabeçalho do orçamento e grid de itens

**User Story:** Como orçamentista, quero uma lista dos itens do orçamento com os dados-chave, para navegar entre vários itens e abrir o que preciso.

#### Acceptance Criteria

1. WHEN o usuário abre a Tela_Orcamento, THE Tela_Orcamento SHALL exibir no cabeçalho Série, Número do Orçamento, Data (formato dd/mm/aaaa) e Cliente Principal (código, nome e campo de busca), com os valores salvos do Orçamento.
2. WHEN o usuário abre a Tela_Orcamento, THE Tela_Orcamento SHALL exibir o checkbox "Reforma Tributária 2027" refletindo o valor salvo no Orçamento, desmarcado em Orçamento novo.
3. THE Grid_Itens SHALL exibir as colunas item, Cálculo, Linha de Produto, Tipo de Produto, Tiragens, Descrição e Status, com uma linha por Item do Orcamento, ordenadas por número do item crescente, com Tiragens formatadas com separador de milhar (ex.: 6.000) e, quando houver mais de uma Tiragem, todas listadas separadas por " / ".
4. WHEN o usuário seleciona uma linha do Grid_Itens, THE Tela_Orcamento SHALL atualizar o Painel_Dados_Item com o Item selecionado em até 500 ms, sem abrir a Tela_Item.
5. WHEN o usuário dá duplo clique em uma linha do Grid_Itens ou aciona "Abrir item" com uma linha selecionada, THE Tela_Orcamento SHALL abrir a Tela_Item do Item selecionado.
6. THE Tela_Orcamento SHALL oferecer as ações Incluir item, Abrir item, Copiar item e Excluir item sobre o Grid_Itens.
7. WHILE nenhuma linha do Grid_Itens está selecionada, THE Tela_Orcamento SHALL manter desabilitadas as ações Abrir item, Copiar item e Excluir item e manter habilitada a ação Incluir item.
8. WHEN o usuário aciona Copiar item, THE Tela_Orcamento SHALL criar um novo Item no mesmo Orcamento com os dados do Item selecionado (inclusive seus planos), numerado como o próximo número de item livre, e exibi-lo no Grid_Itens selecionado.
9. WHEN o usuário aciona Excluir item, THE Tela_Orcamento SHALL exibir uma confirmação com as opções Confirmar e Cancelar antes de remover o Item, e SHALL remover o Item e atualizar o Grid_Itens somente após Confirmar, mantendo o Item inalterado se o usuário escolher Cancelar.
10. IF a carga do Grid_Itens, a cópia ou a exclusão de um Item falhar, THEN THE Tela_Orcamento SHALL exibir uma mensagem de erro indicando a operação que falhou e SHALL manter o Grid_Itens e os dados dos Itens como estavam antes da operação.
11. WHEN o Orcamento não tem itens, THE Grid_Itens SHALL exibir um estado vazio com a ação Incluir item e SHALL manter o Painel_Dados_Item sem Item selecionado.
12. THE Grid_Itens SHALL seguir o padrão de grids do projeto definido em `.kiro/specs/padronizacao-grids/requirements.md`.

### Requirement 3: Painel Dados do Item (somente leitura)

**User Story:** Como orçamentista, quero um resumo em texto do item selecionado, para conferir o que está especificado sem abrir o item.

#### Acceptance Criteria

1. THE Painel_Dados_Item SHALL ser somente leitura, sem nenhum campo editável, botão de gravação ou ação que altere dados do Item.
2. WHILE o Item selecionado é Multi_Plano, THE Painel_Dados_Item SHALL exibir, nesta ordem, quatro seções: Especificações Gerais (formato e modelos), Tipos de Plano (suporte, cores, formato e acabamentos de cada Plano, com no máximo uma linha de texto por Plano), Acabamentos de produto e Itens Diversos.
3. WHILE o Item selecionado é Plano_Unico, THE Painel_Dados_Item SHALL exibir, nesta ordem, cinco seções: Formato, Suporte, Cores, Acabamento (com os detalhes cadastrados no Item: folhas, fibra e matriz/faca) e Itens Diversos.
4. WHEN o usuário seleciona um Item diferente no grid de Itens do Orçamento, THE Painel_Dados_Item SHALL substituir todo o conteúdo exibido pelos dados do novo Item em até 1 segundo, sem exigir ação adicional do usuário.
5. IF uma seção do Painel_Dados_Item não tem valor cadastrado no Item selecionado, THEN THE Painel_Dados_Item SHALL manter o título da seção visível e exibir um texto indicando que não há informação cadastrada.
6. WHEN nenhum Item está selecionado, THE Painel_Dados_Item SHALL exibir uma mensagem orientando a selecionar um item no grid de Itens do Orçamento e SHALL ocultar todas as seções de dados.
7. IF o carregamento dos dados do Item selecionado falhar, THEN THE Painel_Dados_Item SHALL exibir uma mensagem de erro indicando que não foi possível carregar os dados e SHALL oferecer uma ação para tentar novamente, sem exibir dados do Item anteriormente selecionado.

### Requirement 4: Fechamento totalizador do orçamento

**User Story:** Como orçamentista, quero um Fechamento que some todos os itens por tiragem, para ver o valor total do orçamento com as margens.

#### Acceptance Criteria

1. THE Tela_Orcamento SHALL exibir o Fechamento em aba própria, fora da Tela_Item.
2. WHEN o usuário abre a aba Fechamento, THE Fechamento SHALL exibir as colunas Tiragem, Margem (percentual com duas casas decimais), C.Marg. (percentual com duas casas decimais), Valor Unitário e Valor Total, com exatamente uma linha por tiragem distinta dos Itens do Orcamento, ordenadas da menor para a maior tiragem.
3. WHEN o Orcamento tem mais de um Item, THE Fechamento SHALL somar, para cada tiragem, os valores de todos os Itens do Orcamento com custo calculado, incluindo os lançamentos de cada Item, de modo que o Valor Total da linha seja igual à soma dos Valores Totais dos Itens naquela tiragem.
4. WHEN o usuário altera a margem ou os lançamentos de um Item e salva a alteração, THE Fechamento SHALL exibir os novos valores em até 2 segundos após a confirmação do salvamento, sem recarregar a página.
5. IF um ou mais Itens do Orcamento não têm custo calculado, THEN THE Fechamento SHALL exibir uma lista com o número e a descrição de cada Item sem cálculo, excluir esses Itens dos totais de todas as linhas e exibir um aviso informando a quantidade de Itens excluídos.
6. IF todos os Itens do Orcamento estão sem custo calculado ou o Orcamento não tem Itens, THEN THE Fechamento SHALL exibir uma mensagem informando que não há valores a totalizar e nenhuma linha de tiragem.
7. IF a atualização do Fechamento falha após a alteração de um Item, THEN THE Fechamento SHALL manter os últimos valores exibidos, exibir uma mensagem de erro indicando que os totais podem estar desatualizados e disponibilizar uma ação para tentar novamente.
8. THE Fechamento SHALL exibir valores monetários em reais (R$) arredondados para duas casas decimais, com separador de milhar e vírgula decimal.
9. THE Fechamento SHALL ler o custo de cada Item a partir do resultado persistido, sem recalcular pelo motor de cálculo e sem alterar a Ancoragem.

### Requirement 5: Aba Comissões

**User Story:** Como gestor comercial, quero a aba Comissões no nível do orçamento, para ver as comissões junto ao Fechamento.

#### Acceptance Criteria

1. WHEN o usuário abre a Tela_Orcamento, THE Tela_Orcamento SHALL exibir a aba Comissões imediatamente ao lado da aba Fechamento, na mesma barra de abas, e ambas SHALL estar visíveis sem rolagem horizontal.
2. WHEN o usuário seleciona a aba Comissões, THE aba Comissões SHALL exibir em até 2 segundos as comissões do Orcamento calculadas no back (percentual `Vendedor.comissao` do vendedor do Orcamento multiplicado por `valorTotalConsolidado`, arredondado a 2 casas), sendo uma linha por comissão, com os valores exatamente como retornados pelo back.
3. THE aba Comissões SHALL NOT calcular, recalcular, arredondar nem derivar valores de comissão no front.
4. WHILE a aba Comissões aguarda a resposta do back, THE aba Comissões SHALL exibir um indicador de carregamento até a resposta chegar ou o tempo de 10 segundos esgotar.
5. IF o back responde com sucesso e sem registros de comissão para o Orcamento, THEN THE aba Comissões SHALL exibir um estado vazio com a mensagem de que não há comissões a exibir.
6. IF o Orcamento não tem vendedor, ou o vendedor não tem percentual de comissão, THEN o back SHALL responder lista vazia e THE aba Comissões SHALL exibir um estado vazio com a mensagem de que não há comissões a exibir.
7. IF a requisição das comissões falha (erro do servidor, falha de rede ou tempo de 10 segundos esgotado), THEN THE aba Comissões SHALL exibir uma mensagem de erro distinta do estado vazio, com a opção de tentar novamente, e SHALL manter a aba Fechamento e o restante da Tela_Orcamento utilizáveis.
8. WHEN o usuário alterna entre as abas Fechamento e Comissões, THE Tela_Orcamento SHALL preservar o estado e os valores já exibidos em cada aba, sem alterar nenhum dado do Orcamento.

### Requirement 6: Tela 2 — dados comuns do Item

**User Story:** Como orçamentista, quero uma tela do item com os dados comuns do produto, para preenchê-los uma única vez para todos os planos.

#### Acceptance Criteria

1. WHEN o usuário abre o Item, THE Tela_Item SHALL exibir como título o nome do Produto_Grafico do Item.
2. WHEN o usuário abre o Item, THE Tela_Item SHALL exibir os campos Produto (somente leitura), Tipo de Produto, Descrição (até 200 caracteres), Sigla Acabado (com busca, até 60 caracteres), Tributação, Tiragens (de 1 a 10 valores inteiros entre 1 e 999.999.999) e Modelos (inteiro entre 1 e 999, valor padrão 1).
3. WHEN o usuário abre o Item, THE Tela_Item SHALL exibir a lista de Acabamentos de Produto (Atividades marcáveis do produto), com marcação independente por Atividade e indicação de lista vazia quando o produto não tiver Atividades.
4. WHEN o usuário abre o Item, THE Tela_Item SHALL exibir Acondicionamento (duas listas marcáveis) e Conteúdo por volume (inteiro entre 1 e 999.999).
5. WHEN o usuário abre o Item, THE Tela_Item SHALL oferecer acesso a Itens Diversos, Itens Fornecidos, Campos Livres, Observação (até 2.000 caracteres) e Obs. Áreas de Op (até 2.000 caracteres), sem descartar os dados do Item ainda não salvos.
6. WHEN o usuário salva o Item com dados válidos, THE Tela_Item SHALL gravar os campos do Item nas colunas existentes de `ItemOrcamentoGrafico` e confirmar a gravação ao usuário, sem alterar a Ancoragem.
7. WHEN o usuário salva o Item, THE Tela_Item SHALL manter o valor de custo ancorado do Item puxado de cálculo existente idêntico ao valor anterior ao salvamento (diferença de R$ 0,00).
8. IF o salvamento falhar por campo obrigatório vazio, valor fora dos limites ou erro do servidor, THEN THE Tela_Item SHALL não gravar nenhuma alteração, manter na tela os valores digitados e indicar o campo e o motivo da falha.
9. WHERE o Produto_Grafico é multi-plano, THE Tela_Item SHALL exibir o grid Tipos de Plano e SHALL NOT exibir campos de suporte, cores, formato ou acabamento de plano fora desse grid.
10. WHERE o Produto_Grafico é de plano único, THE Tela_Item SHALL exibir na mesma tela os campos do plano único (Cores, Processo de Impressão, Cobertura de Tinta, Fabricante, Suporte e bloco Acabamento) e SHALL NOT exibir grid de planos.

### Requirement 7: Tela do Item dirigida pelo cadastro (formato)

**User Story:** Como administrador do cadastro, quero que a tela do item mostre os campos de formato conforme o cadastro do produto, para criar e ajustar produtos sem alterar código.

#### Acceptance Criteria

1. WHILE o Modo_Formato do Produto_Grafico é `TRES_DIMENSOES`, THE Tela_Item SHALL exibir os campos Comprimento, Largura, Altura, Aba Cola e Aba Fechamento, exibir o campo Altura da Tampa somente se o cadastro do Produto_Grafico indica que o produto possui Altura da Tampa, e não exibir Formato Final, Formato Fechado nem Formato Aberto.
2. WHILE o Modo_Formato é `DUAS_DIMENSOES`, THE Tela_Item SHALL exibir o campo Formato Final com duas dimensões (Largura x Altura) e não exibir Comprimento, Altura, Aba Cola, Aba Fechamento, Altura da Tampa, Formato Fechado nem Formato Aberto.
3. WHILE o Modo_Formato é `ABERTO_FECHADO`, THE Tela_Item SHALL exibir os campos Formato Fechado e Formato Aberto, cada um com duas dimensões (Largura x Altura), e não exibir Comprimento x Largura x Altura nem Formato Final.
4. WHILE o Modo_Formato é `SANFONA_ABAS` ou `PAGINA`, THE Tela_Item SHALL exibir exatamente os campos de formato listados para esse modo no wireframe aprovado pelo usuário e nenhum outro campo de formato.
5. WHEN o usuário seleciona um Produto_Grafico que tem `formatoPadraoLargura` e `formatoPadraoAltura` definidos (ambos maiores que 0) e os campos de formato do Item estão vazios, THE Tela_Item SHALL preencher o formato do Item com esses dois valores e manter o preenchimento editável.
6. WHILE `semImpressao` do Produto_Grafico é verdadeiro, THE Tela_Item SHALL ocultar os campos Cores, Processo de Impressão e Cobertura de Tinta, e WHILE `semImpressao` é falso, THE Tela_Item SHALL exibir esses três campos.
7. WHILE `exibeInformacoesComplementares` do Produto_Grafico é verdadeiro, THE Tela_Item SHALL exibir o campo Informações Complementares, de texto livre com no máximo 1.000 caracteres, abaixo da lista de Atividades, e WHILE é falso, THE Tela_Item SHALL ocultar esse campo.
8. WHEN o usuário troca o Produto_Grafico do Item, THE Tela_Item SHALL, em até 500 ms, reaplicar a visibilidade de campos e os padrões do novo produto, preservar os valores já informados nos campos que continuam visíveis, não sobrescrever com padrão um campo de formato que já tenha valor informado, e não gravar ao salvar o Item os valores dos campos que passaram a ficar ocultos.
9. THE Tela_Item SHALL decidir a visibilidade de cada campo de formato apenas por atributos do cadastro do Produto_Grafico (`modoFormato`, `formatoPadraoLargura`, `formatoPadraoAltura`, `exibeRestricoes`, `exibeInformacoesComplementares`, `semImpressao`), de modo que dois Produtos_Graficos com os mesmos valores de atributos e nomes, códigos ou linhas de produto diferentes exibam o mesmo conjunto de campos.
10. THE Tela_Item SHALL exibir, sem alteração de código, o conjunto de campos correto para qualquer Produto_Grafico criado ou alterado pelo cadastro com qualquer combinação válida de `modoFormato` (5 valores) e dos atributos booleanos `exibeRestricoes`, `exibeInformacoesComplementares` e `semImpressao`.
11. IF o usuário informa em um campo de dimensão (Comprimento, Largura, Altura, Aba Cola, Aba Fechamento, Altura da Tampa ou dimensões de Formato Final, Fechado e Aberto) um valor menor ou igual a 0, maior que 99.999,99 mm ou com mais de 2 casas decimais, THEN THE Tela_Item SHALL indicar o erro no próprio campo, impedir a gravação do Item e manter todos os valores digitados nos demais campos.
12. IF o Produto_Grafico selecionado tem `modoFormato` ausente ou com valor diferente dos 5 modos definidos, THEN THE Tela_Item SHALL não exibir nenhum campo de formato, exibir uma mensagem indicando que o cadastro do produto está incompleto, impedir a gravação do Item e manter os demais valores já informados.

### Requirement 8: Item de plano único

**User Story:** Como orçamentista, quero que produtos de plano único mostrem os campos do plano na própria tela do item, para não gerenciar um grid de planos desnecessário.

#### Acceptance Criteria

1. WHILE o Item é Plano_Unico, THE Tela_Item SHALL exibir, na mesma tela e sem abrir modal ou tela separada de plano, os campos do plano implícito: Cores, Processo de Impressão (com botão Pré e cadeado), Cobertura de Tinta, Fabricante, Suporte (com NC), Fornecido, Microondulado, Fibra, Montagem, Formato de Corte e Ajuste Corte Micro (mm).
2. WHILE o Item é Plano_Unico, THE Tela_Item SHALL omitir o Grid_Planos e os botões Incluir, Copiar, Excluir, Trocar/Reordenar e Desfazer do Grid_Planos.
3. WHILE o Item é Plano_Unico, THE Tela_Item SHALL exibir o bloco Acabamento com a lista de Atividades ativas no cadastro, cada uma marcável e desmarcável pelo usuário, com as Atividades pré-marcadas do cadastro do Produto_Grafico já marcadas ao criar o Item.
4. WHEN a Tela_Item abre um Item, THE Tela_Item SHALL classificar o Item como Plano_Unico se `TipoPlanoGrafico.fixo` do Produto_Grafico for verdadeiro, e como Multi_Plano nos demais casos, usando o `DefaultProdutoPlano` do Produto_Grafico como valores iniciais dos campos do plano implícito de um Item novo.
5. IF o Item é Plano_Unico e o cadastro do Produto_Grafico não prevê Microondulado, THEN THE Tela_Item SHALL ocultar o campo Microondulado e o campo Ajuste Corte Micro (mm); IF o cadastro não prevê Fibra, THEN THE Tela_Item SHALL ocultar o campo Fibra, avaliando cada campo de forma independente.
6. WHEN o usuário salva um Item de Plano_Unico, THE Tela_Item SHALL gravar os campos do plano implícito nas colunas achatadas existentes de `ItemOrcamentoGrafico` e não criar nenhum registro de `PlanoCalculoGrafico` para o Item.
7. IF a gravação de um Item de Plano_Unico falhar, THEN THE Tela_Item SHALL exibir uma mensagem de erro indicando a falha, manter na tela os valores digitados pelo usuário e não persistir nenhum campo do Item de forma parcial.
8. WHILE o Item é Plano_Unico, THE Tela_Item SHALL exibir Montagem e Formato de Corte como valores calculados e somente leitura, recalculados quando o usuário altera Suporte, Cores ou as medidas do Item.
9. IF o usuário informar em Ajuste Corte Micro (mm) um valor não numérico, negativo, maior que 100,00 ou com mais de 2 casas decimais, THEN THE Tela_Item SHALL rejeitar o valor, indicar o campo com erro e impedir o salvamento do Item até a correção.
10. THE Tela_Item SHALL produzir, para um Item de Plano_Unico com os mesmos dados de entrada, custo de produção e preço de venda por tiragem idênticos aos de antes da reforma, com diferença de R$ 0,00, e manter a Ancoragem do Item (`ancorarCustoCalcgraf`) inalterada nos momentos de abrir, editar e salvar.

### Requirement 9: Item multi-plano e Grid de Planos

**User Story:** Como orçamentista, quero um grid de planos no item, para incluir, copiar, excluir e reordenar os planos de um produto composto.

#### Acceptance Criteria

1. WHILE o Item é Multi_Plano, THE Tela_Item SHALL exibir o Grid_Planos com as colunas Nome, Suporte, Cores, Formato e Acabamento, nessa ordem, com uma linha por Plano na ordem de sequência persistida, e com a coluna Acabamento listando os nomes das atividades marcadas no Plano separados por vírgula.
2. WHILE o Item é Multi_Plano, THE Tela_Item SHALL oferecer as ações Incluir, Copiar, Excluir, Trocar/Reordenar e Desfazer sobre o Grid_Planos, mantendo Incluir sempre habilitada, Copiar e Excluir habilitadas somente com exatamente 1 Plano selecionado, Trocar/Reordenar habilitada somente com 2 ou mais Planos e Desfazer habilitada somente quando houver ação a desfazer.
3. WHEN o usuário aciona Incluir, THE Tela_Item SHALL abrir a Tela_Plano com todos os campos vazios ou com os valores padrão do Tipo de Plano, adicionar o novo Plano ao final do Grid_Planos ao salvar e manter o Grid_Planos inalterado se o usuário cancelar.
4. WHEN o usuário clica em um Plano do Grid_Planos, THE Tela_Item SHALL abrir a Tela_Plano com os dados desse Plano e, ao salvar, atualizar a linha correspondente do Grid_Planos sem alterar a posição do Plano.
5. WHEN o usuário aciona Copiar sobre um Plano selecionado, THE Tela_Item SHALL criar, imediatamente abaixo do original, um novo Plano com os mesmos valores de todos os campos e com o nome "<nome original> (Cópia)", usando "(Cópia 2)", "(Cópia 3)" e assim por diante quando o nome já existir no Item, limitado a 60 caracteres, e manter o Plano original inalterado.
6. WHEN o usuário aciona Excluir sobre um Plano, THE Tela_Item SHALL pedir confirmação, remover o Plano somente se o usuário confirmar, manter a ordem relativa dos Planos restantes e manter o Grid_Planos inalterado se o usuário cancelar.
7. WHEN o usuário aciona Desfazer após Incluir, Copiar, Excluir ou Trocar/Reordenar, THE Tela_Item SHALL restaurar o estado do Grid_Planos (conjunto de Planos e ordem) anterior à última ação, permitindo desfazer até as 20 últimas ações na sessão de edição do Item, uma por acionamento, em ordem inversa.
8. WHEN o usuário aciona Trocar/Reordenar e conclui a alteração da ordem, THE Tela_Item SHALL exibir os Planos na nova ordem e persisti-la, de modo que a mesma ordem seja exibida ao reabrir o Item.
9. WHEN o Item Multi_Plano não tem Planos, THE Grid_Planos SHALL exibir um estado vazio com mensagem indicando que não há Planos e com a ação Incluir, mantendo Copiar, Excluir e Trocar/Reordenar desabilitadas.
10. THE Tela_Item SHALL manter os "Acabamentos de Produto" no nível do Item, fora do Grid_Planos, e não exibir campos de suporte, cores, formato ou acabamento de Plano fora do Grid_Planos e da Tela_Plano.
11. IF a persistência de Incluir, Copiar, Excluir ou Trocar/Reordenar falhar, THEN THE Tela_Item SHALL manter o Grid_Planos no estado anterior à ação, exibir uma mensagem de erro indicando que a operação não foi salva e manter a ação disponível para nova tentativa.
12. IF o Item já possui 20 Planos e o usuário aciona Incluir ou Copiar, THEN THE Tela_Item SHALL não criar o Plano e SHALL exibir uma mensagem informando o limite máximo de 20 Planos por Item, mantendo o Grid_Planos inalterado.

### Requirement 10: Tela 3 — Plano

**User Story:** Como orçamentista, quero uma tela própria para a especificação de cada plano, para detalhar suporte, cores, formato e acabamentos por plano.

#### Acceptance Criteria

1. THE Tela_Plano SHALL exibir os campos Tipo de Plano, Nome (texto de 1 a 100 caracteres), Ocorrências (inteiro de 1 a 99) e Tiragem do plano (inteiro de 1 a 999.999.999), com a Tiragem preenchida inicialmente com o mesmo valor da tiragem do Item enquanto o usuário não informar valor próprio.
2. THE Tela_Plano SHALL exibir Montagem, Corte, Formato Aberto e Formato Final (Comprimento x Largura x Altura x Altura da Tampa), aceitando em cada dimensão valores numéricos de 0,00 a 99.999,99 mm com até 2 casas decimais.
3. THE Tela_Plano SHALL exibir Cores (formato "NxM", com N e M inteiros de 0 a 12), Processo de Impressão (com botão Pré e cadeado) e Cobertura de Tinta (0 a 100 %, com até 2 casas decimais).
4. WHERE o Tipo de Plano prevê capa externa, THE Tela_Plano SHALL exibir Fabricante, Suporte (com NC e Fornecido) e Fibra da capa externa.
5. WHERE o Tipo de Plano prevê microondulado, THE Tela_Plano SHALL exibir Fabricante, Suporte (com NC e Fornecido), Sentido da onda e Ajuste Corte Micro (mm, de -99,99 a 99,99, com até 2 casas decimais).
6. WHERE o Tipo de Plano prevê capa interna, THE Tela_Plano SHALL exibir Fabricante, Suporte (com NC e Fornecido), Cores, Processo de Impressão e Cobertura de Tinta da capa interna.
7. THE Tela_Plano SHALL exibir o bloco Acabamento com a lista de Atividades do Plano, permitindo marcar e desmarcar cada Atividade individualmente.
8. THE Tela_Plano SHALL decidir quais blocos exibir a partir dos atributos do `TipoPlanoGrafico` selecionado, sem comparar nome de tipo fixo no código-fonte.
9. WHEN o usuário aciona OK, THE Tela_Plano SHALL validar os campos obrigatórios, gravar o Plano apenas com os dados dos blocos exibidos para o Tipo de Plano selecionado (descartando valores de blocos ocultados por troca de tipo), retornar à Tela_Item e exibir o Plano gravado no Grid_Planos, tudo em até 3 segundos em condições normais de rede.
10. WHEN o usuário aciona Cancelar, THE Tela_Plano SHALL descartar todas as alterações feitas desde a abertura, retornar à Tela_Item e manter o Grid_Planos exatamente como estava antes da abertura.
11. WHEN o usuário seleciona um Tipo de Plano em um novo Plano, THE Tela_Plano SHALL preencher cores, processo de impressão, cobertura de tinta e Atividades marcadas com os padrões do `DefaultProdutoPlano` do Produto_Grafico para esse tipo, mantendo os campos em branco e as Atividades desmarcadas quando o tipo não tiver `DefaultProdutoPlano`.
12. IF a validação dos campos obrigatórios falha, THEN THE Tela_Plano SHALL indicar cada campo inválido com mensagem junto ao campo, manter o formulário aberto com os valores digitados preservados e não gravar o Plano. São obrigatórios Tipo de Plano, Nome, Tiragem e, em cada bloco exibido, Cores, Processo de Impressão e Suporte.
13. IF a gravação do Plano falha após a validação (erro de comunicação ou de servidor), THEN THE Tela_Plano SHALL exibir mensagem de erro indicando que o Plano não foi gravado, manter o formulário aberto com os valores digitados preservados e não alterar o Grid_Planos.
14. WHEN o usuário seleciona um Plano já existente no Grid_Planos, THE Tela_Plano SHALL abrir com todos os valores gravados desse Plano preenchidos, sem reaplicar os padrões do `DefaultProdutoPlano`.

### Requirement 11: Atividades com Restrições e Materiais

**User Story:** Como orçamentista, quero ver as Restrições e os Materiais da atividade em foco, para ajustar acerto e colagem (ex.: Cola Branca com Medida em mm) em qualquer produto.

#### Acceptance Criteria

1. THE Tela_Item (Plano_Unico) e THE Tela_Plano SHALL exibir, ao lado da lista de Atividades, uma área com a lista de Restrições (`RestricaoAcabamento`) e a lista de Materiais (`MaterialAcabamento`) da Atividade em foco, cada lista com título próprio e uma linha por registro mostrando o nome.
2. WHEN o usuário marca ou foca uma Atividade, THE Vizor SHALL carregar as Restrições e os Materiais cadastrados para essa Atividade e exibi-los em até 2 segundos, substituindo o conteúdo da Atividade anteriormente em foco.
3. IF o carregamento das Restrições ou dos Materiais falhar, THEN THE Vizor SHALL exibir na área uma mensagem de erro indicando a falha ao carregar, oferecer a ação "Tentar novamente" e manter inalteradas as seleções já feitas no item ou plano.
4. WHERE um Material_Atividade tem `tipoParam`, THE Vizor SHALL exibir ao lado do Material um campo de parâmetro com o rótulo correspondente (ex.: "Medida em mm").
5. WHEN o usuário informa um valor no campo de parâmetro, THE Vizor SHALL aceitar somente números maiores que 0 e menores ou iguais a 99.999,99, com até 2 casas decimais, e gravar o valor junto à seleção do Material.
6. IF o valor informado no campo de parâmetro estiver vazio, for menor ou igual a 0, exceder 99.999,99 ou não for numérico, THEN THE Vizor SHALL exibir mensagem de erro no campo indicando o intervalo permitido, não gravar o valor e manter o valor gravado anteriormente.
7. THE Vizor SHALL exibir Restrições e Materiais em todos os produtos, independentemente do valor de `exibeRestricoes` do Produto_Grafico.
8. WHERE `exibeRestricoes` do Produto_Grafico é falso, THE Vizor SHALL exibir a lista de Restrições recolhida ao abrir a tela, mostrando apenas o título e a quantidade de Restrições, e SHALL permitir expandi-la e recolhê-la pelo usuário.
9. WHEN a Atividade em foco não tem Restrições cadastradas, THE Vizor SHALL exibir na lista de Restrições um estado vazio com a mensagem "Nenhuma restrição cadastrada".
10. WHEN a Atividade em foco não tem Materiais cadastrados, THE Vizor SHALL exibir na lista de Materiais um estado vazio com a mensagem "Nenhum material cadastrado".
11. WHILE nenhuma Atividade estiver marcada ou em foco, THE Vizor SHALL exibir na área um texto orientando o usuário a selecionar uma Atividade.
12. WHEN o usuário seleciona ou desmarca uma Restrição ou um Material, THE Vizor SHALL gravar a seleção usando as estruturas já existentes do item ou do plano, sem alterar o cálculo de custo e preço, de modo que o resultado do cálculo antes e depois da seleção seja idêntico.
13. IF a gravação de uma seleção de Restrição ou Material falhar, THEN THE Vizor SHALL exibir uma mensagem de erro indicando que a seleção não foi gravada e SHALL restaurar a seleção ao estado anterior à tentativa.

### Requirement 12: Suporte Não Cadastrado (botão NC)

**User Story:** Como orçamentista, quero cadastrar na hora um papel que não está no catálogo, para não travar o orçamento enquanto o comprador regulariza o cadastro.

#### Acceptance Criteria

1. THE Tela_Item (Plano_Unico) e THE Tela_Plano SHALL exibir o botão NC ao lado de cada campo Suporte (no multi-plano: capa externa, microondulado e capa interna).
2. WHEN o usuário aciona NC, THE Vizor SHALL abrir o formulário Suporte Não Cadastrado com os campos Nome, Gramatura, Espessura G/, Espessura (micras), Formato, Fibra, Tira/Retira, Consumo de Tinta (Tipo de Suporte e Coeficiente de Consumo), Unidades (Custo em KG e Cálculo em FL), Custo por Kg, Custo de Frete por Kg, Pacotes com, Crédito ICMS % e Crédito IPI %, mantendo o orçamento aberto e sem alterações até a confirmação.
3. WHEN o usuário confirma o formulário com dados válidos, THE Vizor SHALL criar um `SuporteGrafico` e um Preco_Provisorio vinculados à empresa da sessão e selecionar o novo suporte no campo Suporte que originou a ação.
4. WHEN o Preco_Provisorio é criado, THE Vizor SHALL marcá-lo como provisório e listá-lo no filtro de preços provisórios do comprador até que ele seja regularizado.
5. IF Nome está vazio ou excede 120 caracteres, Gramatura não está entre 1 e 2.000 g/m², ou Custo por Kg não está entre 0,01 e 999.999,99, THEN THE formulário Suporte Não Cadastrado SHALL destacar cada campo inválido com indicação do motivo, impedir o cadastro e preservar os dados já digitados.
6. IF Espessura (micras), Custo de Frete por Kg, Crédito ICMS % ou Crédito IPI % são informados fora da faixa (Espessura 0 a 10.000 micras; Frete 0 a 999.999,99; Créditos 0 a 100), THEN THE formulário Suporte Não Cadastrado SHALL destacar o campo, indicar o motivo e impedir o cadastro.
7. IF já existe suporte da mesma empresa com o mesmo Nome (sem diferenciar maiúsculas e minúsculas) e a mesma Gramatura, THEN THE Vizor SHALL oferecer selecionar o suporte existente ou cancelar, sem criar duplicata.
8. IF a criação do suporte ou do Preco_Provisorio falha, THEN THE Vizor SHALL exibir mensagem de erro indicando a falha, não criar nenhum dos dois registros e manter o formulário aberto com os dados digitados.
9. THE Vizor SHALL gravar o suporte e o preço com `empresaId` da empresa da sessão, de forma explícita na consulta e na criação.
10. THE Vizor SHALL manter o fluxo NC sem alterar o motor de cálculo; o suporte novo é consumido pelo motor como qualquer suporte cadastrado.

### Requirement 13: Botão de propriedades (pendente de definição)

**User Story:** Como orçamentista, quero um botão de propriedades ao lado de Ajuste Corte Micro, para acessar informações do corte e do produto.

#### Acceptance Criteria

1. WHILE a Tela_Item de um item de Plano_Unico ou a Tela_Plano estiver aberta, THE Vizor SHALL exibir um botão com o rótulo "Propriedades/Preview" imediatamente ao lado do campo Ajuste Corte Micro (mm). O botão deve estar habilitado e visível em ambas as telas.
2. WHEN o usuário aciona o botão Propriedades/Preview e a decisão aberta D2 ainda não foi tomada, THE Vizor SHALL abrir um painel com mensagem indicando que o recurso ainda não está disponível. O painel não deve exibir nenhum dado de corte ou de produto, e deve ter um controle de fechar.
3. WHEN o usuário fecha o painel de aviso, THE Vizor SHALL retornar à tela de origem, com todos os campos preenchidos mantidos exatamente como estavam antes da abertura do painel.
4. WHEN o usuário aciona o botão Propriedades/Preview, THE Vizor SHALL NOT alterar nenhum dado do item, do plano nem do orçamento, e SHALL NOT disparar recálculo ou gravação.
5. THE Vizor SHALL manter o conteúdo do botão Propriedades/Preview como decisão pendente D2 nesta spec e SHALL NOT implementar nenhum comportamento além do painel de aviso até que D2 seja decidida. A hipótese de trabalho (não confirmada) é que o botão abra o mesmo Preview_Ficha_Master do Requirement 21; isso só vale após confirmação do usuário.

### Requirement 14: Dados de plano sem coluna própria (decisão pendente)

**User Story:** Como mantenedor, quero decidir como persistir os campos de plano que o back ainda não tem, para a Tela_Plano ser fiel sem afetar o custo.

#### Acceptance Criteria

1. WHILE a decisão D1 estiver sem resolução, THE Vizor SHALL manter D1 registrada como aberta nesta spec, com duas alternativas: gravar no Json aditivo `especificacao` de `PlanoCalculoGrafico`, ou gravar em colunas novas de `PlanoCalculoGrafico`. D1 cobre os campos ocorrências, tiragem do plano, montagem, formato de corte, formato aberto, formato final, processo, cobertura, fabricante, fornecido, fibra, capa externa, micro, capa interna, sentido da onda e ajuste micro.
2. WHILE a decisão D3 estiver sem resolução, THE Vizor SHALL manter D3 registrada como aberta nesta spec, com duas alternativas: gravar em colunas novas de `ItemOrcamentoGrafico`, ou gravar no Json `medidas` existente. D3 cobre os campos Formato Fechado, Formato Aberto, Formato Final e Altura da Tampa.
3. WHEN o mantenedor registrar a decisão D1 ou D3 nesta spec, THE Vizor SHALL entregar a persistência escolhida em um único commit que contenha `schema.prisma` e `prisma/migrate-prod.ts`. As alterações no `migrate-prod.ts` SHALL usar apenas `ADD COLUMN IF NOT EXISTS` e `CREATE TABLE IF NOT EXISTS`, e SHALL rodar duas vezes seguidas sem erro, sem duplicar objetos e sem remover coluna ou dado existente.
4. THE Vizor SHALL manter o custo de produção, o preço de venda e o resultado do cálculo de um Item ou Plano iguais, ao centavo, antes e depois de qualquer campo novo de Item ou Plano ser preenchido ou alterado. Isso vale para o motor de cálculo e para `ancorarCustoCalcgraf`, até que o mantenedor registre decisão explícita em contrário nesta spec.
5. IF um Plano ou Item existente não tem valor gravado para um campo novo, THEN THE Vizor SHALL exibir o campo vazio na Tela_Plano ou na tela do Item. O Vizor SHALL gravar valor para esse campo somente quando o usuário preenchê-lo e salvar, e SHALL manter inalterados os demais campos já gravados.
6. WHEN um Item ou Plano criado antes da reforma for aberto, salvo ou recalculado, THE Vizor SHALL ler e gravar os campos já existentes com os mesmos valores de antes. Isso SHALL ocorrer sem apagar, converter ou reescrever dados existentes, e sem exigir preenchimento dos campos novos.
7. IF a gravação de um campo novo de Item ou Plano falhar, THEN THE Vizor SHALL exibir mensagem de erro indicando que o Item ou Plano não foi salvo. O Vizor SHALL manter os valores anteriores gravados e manter na tela os valores digitados pelo usuário.

### Requirement 15: Preservação do cálculo e da ancoragem

**User Story:** Como gestor, quero que a reforma não altere nenhum valor de orçamento, para manter a paridade já validada com os cálculos migrados.

#### Acceptance Criteria

1. THE Vizor SHALL manter inalterados o código-fonte e o comportamento do motor `calcularOrcamentoGrafico` e da função `ancorarCustoCalcgraf`, de modo que, para as mesmas entradas, ambos produzam saídas idênticas às anteriores à reforma.
2. WHEN um Item puxado de cálculo existente é aberto e salvo pelas novas telas sem alteração de dados, THE Vizor SHALL manter `custoProducao` e `precoVenda` do Item com diferença de 0,00 (R$) em relação aos valores anteriores ao salvamento, para cada tiragem do Item.
3. WHEN as novas telas chamam as rotas de calcular item e de salvar item, THE Vizor SHALL enviar ao back o mesmo conjunto de campos de engenharia que o front anterior à reforma envia, incluindo `aproveitamentoManual`, `formatoCorteLarguraMm`, `formatoCorteAlturaMm` e `papelId`.
4. IF a requisição de calcular ou salvar item enviada pelas novas telas omitir algum campo de engenharia do item (por exemplo `aproveitamentoManual` ou o formato de corte), THEN THE Vizor SHALL calcular e salvar com o valor já persistido no item para esse campo, sem gravar `null` nem alterar o aproveitamento e o formato de corte do Item.
5. WHEN o Item é Multi_Plano, THE Vizor SHALL calcular o Item pela soma dos `PlanoCalculoGrafico` do Item no motor.
6. WHEN o Item é de Plano_Unico, THE Vizor SHALL calcular o Item pelos campos de engenharia do próprio Item e manter em 0 o número de `PlanoCalculoGrafico` criados para ele pelas novas telas.
7. WHEN o orçamento é aberto, recalculado ou salvo, THE Vizor SHALL exibir no Fechamento o mesmo `custoProducao` do Item puxado nos três momentos (abrir, editar/recalcular e salvar), com diferença de 0,00 (R$) entre eles.
8. THE Vizor SHALL cobrir com teste automatizado a igualdade de `custoProducao` e `precoVenda` antes e depois da reforma, com diferença de 0,00 (R$), para cada Item de teste definido na fase de design, incluindo no mínimo um Item de Plano_Unico e um Item Multi_Plano.
9. IF o teste automatizado de igualdade de `custoProducao` encontrar diferença diferente de 0,00 (R$) em qualquer Item de teste, THEN THE Vizor SHALL reprovar a execução de testes e indicar o Item e o valor divergente.

### Requirement 16: Isolamento por empresa

**User Story:** Como administrador de múltiplas empresas, quero que nenhuma tela ou rota nova exiba dados de outra empresa, para manter o isolamento multi-tenant.

#### Acceptance Criteria

1. THE Vizor SHALL aplicar o filtro `empresaId` da sessão de forma explícita no `where` de toda consulta, alteração e exclusão nova ou alterada no back por esta reforma, sem depender apenas de `request.prismaScoped`. Isso inclui a sessão de SUPER_ADMIN, para a qual `prismaScoped` não isola.
2. THE Vizor SHALL aplicar o filtro `empresaId` da sessão em Plano, Suporte e Preco_Provisorio por meio da relação com o pai (Orcamento ou Item) no `where` aninhado, nas entidades filhas que não têm `empresaId` próprio.
3. IF o usuário solicita por id um Orcamento, Item, Plano, Suporte, Preco_Provisorio ou Cadastro que pertence a outra empresa, THEN THE Vizor SHALL responder HTTP 404 com a mesma mensagem usada para id inexistente, sem incluir no corpo nenhum campo do registro nem o `empresaId` dele, e SHALL preservar o registro sem alteração.
4. IF o usuário envia uma gravação (criação, alteração ou exclusão) cujo id de Orcamento, Item, Plano ou Cadastro referenciado pertence a outra empresa, THEN THE Vizor SHALL responder HTTP 404 e SHALL NOT gravar nenhuma alteração.
5. WHEN o Vizor cria um Plano, um Suporte ou um Preco_Provisorio, THE Vizor SHALL gravar nele o `empresaId` do Orcamento ou do Item pai, lido do registro pai, e SHALL NOT gravar o `empresaId` do usuário quando os dois forem diferentes.
6. THE Vizor SHALL retornar nas listagens novas ou alteradas por esta reforma (Itens do Orcamento, Planos do Item, Fechamento) somente registros cujo `empresaId` seja igual ao da sessão. O Fechamento SHALL totalizar somente Itens do Orcamento solicitado que pertençam à empresa da sessão.
7. THE Vizor SHALL manter o token e a empresa selecionada da sessão da Tela_Orcamento, Tela_Item e Tela_Plano em `sessionStorage`, por aba, via `authStorage.ts`. THE Vizor SHALL NOT ler nem gravar esse estado diretamente em `localStorage`, exceto pela semente que `authStorage.ts` já usa.
8. WHILE duas abas do mesmo navegador estão abertas com empresas diferentes, THE Vizor SHALL exibir e gravar em cada aba somente dados da empresa selecionada nela. Selecionar outra empresa em uma aba SHALL NOT alterar a empresa nem recarregar a outra aba.

### Requirement 17: Textos visíveis sem a marca do sistema legado

**User Story:** Como gestor, quero que nenhuma tela cite o sistema de origem, para manter a identidade do Vizor.

#### Acceptance Criteria

1. THE Vizor SHALL omitir Marca_Legada de todo Texto_Visivel das telas novas ou alteradas desta reforma, considerando como Texto_Visivel títulos, rótulos, textos de botões, placeholders, dicas (tooltips), cabeçalhos de coluna, mensagens de sucesso, erro e confirmação, e textos de estado vazio. A Marca_Legada compreende os termos "Calcgraf", "Calcograf", "G-Print", "GPrint" e "PHTech". A comparação ignora maiúsculas/minúsculas, acentos e a presença de hífen ou espaço entre as partes do termo.
2. WHEN uma fase da reforma é concluída, THE teste `texto-visivel-sem-marca-legada.test.ts` SHALL terminar com 0 falhas e 0 violações, antes de a fase ser considerada concluída.
3. WHEN novas pastas ou arquivos de telas são criados nesta reforma, THE teste `texto-visivel-sem-marca-legada.test.ts` SHALL varrê-los na execução seguinte, sem exigir edição manual da lista de arquivos do teste.
4. IF o teste `texto-visivel-sem-marca-legada.test.ts` encontrar Marca_Legada em algum Texto_Visivel, THEN THE teste SHALL falhar e informar, para cada ocorrência, o caminho do arquivo, o número da linha e o trecho de texto encontrado.

### Requirement 18: Tema e estilo

**User Story:** Como usuário em tema claro ou escuro, quero telas legíveis nos dois temas, para trabalhar sem problemas de contraste.

#### Acceptance Criteria

1. THE Vizor SHALL usar apenas Token_Adaptativo do Mantine (variáveis `--mantine-color-body`, `--mantine-color-text`, `--mantine-color-default`, `--mantine-color-default-border`, `--mantine-color-dimmed` e variantes `*-light`/`*-light-color`) para cores de fundo, borda e texto nas telas novas ou alteradas.
2. THE Vizor SHALL omitir cores fixas em fundos e textos das telas novas ou alteradas, entendidas como valores hexadecimais, `rgb()`/`rgba()`, `white`/`black`, tons numerados `dark-N` e tons numerados `gray-N`, exceto cores semânticas de status (verde, amarelo, vermelho, azul) aplicadas por token `*-light`/`*-filled`/`*-light-color` do Mantine.
3. WHILE o tema ativo é claro, THE Vizor SHALL exibir texto, ícones e bordas com razão de contraste mínima de 4,5:1 (texto normal), 3:1 (texto com 18 px ou mais, ou 14 px em negrito, e bordas de campos) contra o fundo, em Grid_Itens, Fechamento, Grid_Planos e formulários.
4. WHILE o tema ativo é escuro, THE Vizor SHALL exibir texto, ícones e bordas com razão de contraste mínima de 4,5:1 (texto normal), 3:1 (texto com 18 px ou mais, ou 14 px em negrito, e bordas de campos) contra o fundo, em Grid_Itens, Fechamento, Grid_Planos e formulários.
5. WHEN o usuário alterna o tema entre claro e escuro, THE Vizor SHALL reaplicar as cores de Grid_Itens, Fechamento, Grid_Planos e formulários ao novo tema em até 500 ms, sem recarregar a página e sem perder valores já digitados nos campos.
6. IF uma tela nova ou alterada contém texto sobre fundo de cor saturada (por exemplo, barra ou selo de status), THEN THE Vizor SHALL manter nesse texto razão de contraste mínima de 4,5:1 em ambos os temas.

### Requirement 19: Entrega em fases

**User Story:** Como responsável pelo projeto, quero entregas incrementais, para validar cada nível da hierarquia antes de avançar.

#### Acceptance Criteria

1. THE Vizor SHALL entregar a Fase 1 com a Tela_Orcamento contendo cabeçalho, Grid_Itens, Painel_Dados_Item, Fechamento totalizador e botão Preview, com todos os critérios de aceitação dos Requirements 2, 3, 4, 5 e 21 atendidos e com os critérios 1.1, 1.2, 1.6 e 1.9 do Requirement 1 atendidos. Os critérios 1.3, 1.4, 1.5, 1.7 e 1.8 completam nas Fases 2 e 3.
2. THE Vizor SHALL entregar a Fase 2 com a Tela_Item dirigida pelo cadastro do Produto Gráfico, incluindo Plano_Unico e acesso às ações do Item, com todos os critérios de aceitação dos Requirements 6, 7, 8 e 11 atendidos.
3. WHEN a decisão D1 estiver registrada por escrito pelo usuário, THE Vizor SHALL entregar a Fase 3 com o Grid_Planos e a Tela_Plano, com todos os critérios de aceitação dos Requirements 9 e 10 atendidos.
4. THE Vizor SHALL entregar a Fase 4 com o fluxo Suporte Não Cadastrado, com todos os critérios de aceitação do Requirement 12 atendidos.
5. WHEN a decisão D2 estiver registrada por escrito pelo usuário, THE Vizor SHALL entregar o botão Propriedades/Preview com o conteúdo definido no Requirement 13.
6. WHILE uma fase seguinte não tiver sido entregue, THE Vizor SHALL manter funcionais, sem erro e sem alteração nos valores de custo e preço já calculados, as ações do fluxo de orçamento existente: criar orçamento, puxar cálculo, editar item, calcular, salvar item, enviar proposta e aprovar gerando Pedido de Venda.
7. WHEN o início de uma fase for solicitado, THE Vizor SHALL apresentar ao usuário o wireframe em texto daquela fase, tomando como base `docs/orcamento-grafico-wireframe-hierarquia.md`, antes de qualquer codificação da fase.
8. THE Vizor SHALL manter todas as alterações sem commit e sem push até o usuário solicitar explicitamente o commit.
9. IF o usuário não tiver confirmado explicitamente o wireframe de uma fase, THEN THE Vizor SHALL NOT iniciar a codificação dessa fase e SHALL aguardar a confirmação ou os ajustes do usuário.
10. IF alguma ação do fluxo de orçamento existente listada no critério 6 falhar durante a validação de uma fase, THEN THE Vizor SHALL NOT considerar a fase entregue e SHALL informar ao usuário qual ação falhou e o motivo.

### Requirement 20: Round-trip e consistência de dados dos itens e planos

**User Story:** Como mantenedor, quero que o que as telas gravam seja lido de volta idêntico, para evitar perda silenciosa de campos (ex.: `aproveitamentoManual` ausente em um `select`).

#### Acceptance Criteria

1. WHEN um Item ou Plano válido é gravado pelas novas telas e lido de volta pela API, THE Vizor SHALL retornar, em cada campo editável nas telas de Item e de Plano, valor igual ao gravado. A comparação é estrita para texto, inteiros, booleanos, listas e identificadores, e aceita diferença absoluta de no máximo 0,0001 para números decimais (propriedade de round-trip, verificada para qualquer Item ou Plano válido).
2. WHEN um campo de engenharia usado pelo motor é adicionado ou lido pelas telas, THE Vizor SHALL incluí-lo em todos os `select` que hidratam as telas (`GET /:id`, leitura de item e leitura de plano), de modo que as três leituras devolvam o campo com o valor persistido.
3. WHEN a decisão Plano_Unico/Multi_Plano é aplicada duas vezes consecutivas sobre o mesmo cadastro de Produto_Grafico, sem alteração do cadastro entre as aplicações, THE função de resolução de layout do Item SHALL produzir resultados idênticos nas duas aplicações. O resultado compreende a decisão Plano_Unico/Multi_Plano e o conjunto de campos visíveis (idempotência da resolução de layout).
4. WHEN a função de resolução de layout do Item é executada para dois cadastros de Produto_Grafico que diferem apenas no nome, THE função de resolução de layout do Item SHALL produzir o mesmo conjunto de campos visíveis e a mesma decisão Plano_Unico/Multi_Plano. A decisão deriva somente dos atributos do cadastro (`modoFormato`, `exibeRestricoes`, `exibeInformacoesComplementares`, `semImpressao` e plano fixo do Tipo de Plano).
5. WHEN um Item ou Plano é lido e um campo de engenharia está sem valor no cadastro, THE Vizor SHALL devolver esse campo como `null`, sem substituí-lo por `0`, texto vazio ou valor padrão. O recálculo a partir desse registro SHALL tratar `null` como "não informado".
6. IF a gravação de um Item ou Plano for rejeitada por validação ou falhar na persistência, THEN THE Vizor SHALL manter inalterados os valores previamente persistidos do Item e do Plano. THE Vizor SHALL também exibir ao usuário uma mensagem de erro que indique o campo rejeitado, quando a causa for validação, ou a falha de gravação, quando a causa for persistência.

### Requirement 21: Preview da Ficha Master no Orçamento

**User Story:** Como orçamentista, quero um botão Preview na tela do orçamento que mostre as imagens de corte e arte do produto, para conferir o produto sem fazer upload de imagem na tela do orçamento.

#### Acceptance Criteria

1. THE Tela_Orcamento SHALL exibir um botão com o rótulo "Preview" no cabeçalho ou na barra de ações do Orcamento, habilitado em todo Orcamento aberto, e SHALL NOT exibir esse botão como ação de linha do Grid_Itens.
2. WHEN o usuário aciona o botão Preview, THE Vizor SHALL abrir o Preview_Ficha_Master em modo somente leitura, com a imagem de corte, a arte aprovada mais recente e os dados gráficos (cartão, gramatura, número de cores, cores, acabamentos e matriz) da Ficha_Master do produto do Orcamento.
3. THE Preview_Ficha_Master SHALL obter os dados do produto vinculado ao Orcamento (`produtoId`); IF o Orcamento não tem produto vinculado e tem pedido-proposta de origem, THEN THE Preview_Ficha_Master SHALL usar a ficha em rascunho da Pré-Impressão desse pedido; IF não há nenhuma das duas fontes, THEN THE Preview_Ficha_Master SHALL usar somente a imagem da faca já gravada no Orcamento, se existir.
4. THE Preview_Ficha_Master SHALL NOT depender da linha selecionada no Grid_Itens, SHALL NOT oferecer upload nem edição de imagem e SHALL NOT gravar, recalcular ou chamar o motor de cálculo.
5. IF o produto não tem Ficha_Master nem arte aprovada (e não há fonte de rascunho nem imagem da faca no Orcamento), THEN THE Preview_Ficha_Master SHALL exibir um estado vazio com a mensagem de que o produto não tem Ficha Master nem arte, indicando que elas são cadastradas pela Pré-Impressão, e o botão Preview SHALL continuar habilitado.
6. IF a leitura da Ficha_Master falha (erro do servidor, falha de rede ou tempo esgotado), THEN THE Preview_Ficha_Master SHALL exibir uma mensagem de erro distinta do estado vazio, com a opção de tentar novamente, e SHALL manter a Tela_Orcamento utilizável.
7. IF o Orcamento solicitado não existe ou pertence a outra empresa, THEN THE Vizor SHALL responder HTTP 404 com mensagem fixa, sem eco de campos do registro, e SHALL NOT retornar nenhuma imagem; a leitura SHALL filtrar `empresaId` de forma explícita em toda consulta (Orcamento, `FichaGraficaProduto`, `ArteRevisaoProduto`, pedido-proposta e anexo).
8. THE Tela_Orcamento SHALL NOT exibir o componente de upload da imagem da faca (`ProdutoEspecificacao`); a imagem de corte vem exclusivamente da Ficha_Master gravada pela Pré-Impressão.

## Decisões abertas (pendentes com o usuário)

| ID | Decisão | Opções | Impacto |
|----|---------|--------|---------|
| D1 | Persistência dos campos de plano sem coluna (ocorrências, tiragem do plano, montagem, formato de corte, processo, cobertura, fabricante, fornecido, fibra, capas, sentido da onda, ajuste micro) | (a) Json aditivo `especificacao` em `PlanoCalculoGrafico` (sugerida); (b) colunas novas | Bloqueia a Fase 3 |
| D2 | Conteúdo do botão de propriedades ao lado de Ajuste Corte Micro | Hipótese: abre o mesmo Preview_Ficha_Master do Requirement 21 (imagens de corte e arte); pendente de confirmação do usuário (decisão de 17/11/2026 manteve D2 aberta) | Bloqueia Requirement 13 além do painel de aviso |
| D3 | Persistência de Formato Fechado/Aberto/Final e Altura da Tampa no Item | (a) colunas novas; (b) Json `medidas` existente | Define Requirement 7 (itens 1 a 4) na Fase 2 |

## Fora de escopo

- Alterar o motor de cálculo, `ancorarCustoCalcgraf` ou a importação do acervo.
- Fazer campos novos influenciarem custo.
- Remover o wizard `/novo` antes de as telas novas cobrirem criação de orçamento (decisão na fase de design).
- Implementar o conteúdo do botão Propriedades/Preview (D2).
- Commits (ficam com o usuário).
