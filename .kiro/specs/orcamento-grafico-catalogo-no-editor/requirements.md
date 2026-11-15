# Requisitos — Orçamento Gráfico: Catálogo no Editor do Item (Fase 2)

## Introdução

A Fase 1 (`orcamento-grafico-cadastros-relacoes`, já entregue) criou os cadastros, a tabela de relações, o
catálogo (`GET /catalogo/produto/:id` e `GET /catalogo/plano/:id?produtoId=`) e a seleção de material
(`PUT/GET /selecao-material`). O editor do item do orçamento ainda não usa nada disso: ele lista todas as
atividades do sistema, não pergunta o Produto Gráfico, não sabe qual tipo de plano cada plano é e escolhe
materiais por uma lista geral.

Esta fase liga o editor ao catálogo, **principalmente no front** (`c:\Source\VisioFab.Wms.Front`), com o
mínimo de back. O que o catálogo não cobre para um item sem Produto Gráfico continua igual a hoje. O
orçamento sem produto gráfico (todos os existentes e os puxados do acervo) não muda em nada.

Fora desta fase: aplicar Ajustes de Produtividade, Quebras e Limites de Montagem no motor ou no PCP; valores
dos Campos Livres da solicitação e do pedido (decisão e justificativa no `design.md`, seção 9); linhas
Editorial e Rótulo; dividir por plano o custo dos itens puxados.

## Glossário

- **Produto Gráfico**: tipo de produto de uma linha (Cartuchos, Caixa, Envelope, Sacola…), cadastro da Fase 1.
- **Tipo de Plano**: modelo de plano (Cartão, Microondulado, Base…), cadastro da Fase 1.
- **Plano fixo**: plano único e implícito de uma linha (Cartucho, Lâmina Simples, Sacola). O item não tem
  linhas em `PlanoCalculoGrafico`; os dados do plano ficam no próprio item.
- **Catálogo**: resposta das duas rotas de catálogo, já filtrada por empresa, status e relações.
- **Item sem produto**: item com `produtoGraficoId` nulo. Comportamento atual preservado.
- **Item puxado**: item com `calculoGraficoOrigemId` (veio da biblioteca). Custo ancorado.
- **Seleção de material**: linha em `SelecaoMaterialAcabamento` (uma por item, plano e atividade). Reflete no Json
  `materiaisAcabamento` do item com `origem: 'SELECAO'`.
- **A_VERIFICAR**: situação de parâmetro de material cujo efeito no preço ainda não foi validado (custo zero).
- **Passe de seleções**: gravação das seleções de material pendentes depois que o item existe (tem `id`).

## Requisitos

### Requisito 1: Escolha do Produto Gráfico no editor do item

**User Story:** Como orçamentista, quero escolher o Produto Gráfico do item, para que o editor mostre só o que
aquele produto permite.

#### Acceptance Criteria

1. THE editor SHALL exibir, no topo da seção Produto, um seletor "Produto Gráfico" com os produtos ativos da empresa.
2. WHERE o orçamento tem Linha de Produto, THE seletor SHALL listar somente os produtos dessa linha (`linhaProdutoId`).
3. WHERE o orçamento não tem Linha de Produto, THE seletor SHALL listar todos os produtos ativos.
4. THE seletor SHALL ser opcional e permitir limpar a escolha (volta ao comportamento atual do item).
5. WHEN o usuário escolhe o produto THEN o editor SHALL guardar o id no formulário e gravá-lo em `produtoGraficoId` ao salvar o item.
6. WHEN a Linha de Produto do orçamento é trocada e o produto escolhido não pertence à nova linha THEN o editor SHALL mostrar um aviso e NOT apagar a escolha nem os dados já preenchidos.
7. WHEN um item salvo é reaberto THEN o seletor SHALL vir preenchido com o produto gravado, inclusive se o produto estiver inativo (exibido como inativo, sem poder ser escolhido de novo).
8. THE escolha do Produto Gráfico SHALL NOT alterar o Tipo de Embalagem do item nem o cálculo por si só.

### Requisito 2: Gravar e devolver produto e tipo de plano (back mínimo)

**User Story:** Como desenvolvedor do editor, quero que a API do item e do plano aceite e devolva o vínculo com o
catálogo, para o editor persistir a escolha.

#### Acceptance Criteria

1. THE `itemOrcamentoBodySchema` SHALL aceitar `produtoGraficoId` (uuid, opcional, anulável) e THE `planoBodySchema` SHALL aceitar `tipoPlanoId` (uuid, opcional, anulável).
2. WHEN o campo não é enviado THEN o sistema SHALL manter o valor já gravado; WHEN é enviado como `null` THEN SHALL limpar.
3. IF o id informado não existir na empresa do usuário THEN o sistema SHALL responder 422 com mensagem legível e NOT gravar.
4. THE `GET /orcamento-grafico/:id` SHALL devolver `produtoGraficoId` em cada item e `tipoPlanoId` em cada plano.
5. THE gravação SHALL usar `empresaId` explícito, sem depender só do isolamento automático.
6. THE alteração SHALL NOT mudar `ancorarCustoCalcgraf`, o motor de cálculo, os testes de decomposição nem o comportamento das rotas de item e plano quando os campos novos não forem enviados.
7. THE alteração SHALL NOT exigir mudança de schema Prisma nem de `migrate-prod.ts` (as colunas já existem), exceto o Requisito 7.9 se aprovado.

### Requisito 3: Carga do catálogo no editor

**User Story:** Como orçamentista, quero que o editor carregue o catálogo do produto escolhido sem travar a tela,
para trabalhar com as listas certas.

#### Acceptance Criteria

1. WHEN o produto é escolhido (ou o item salvo é aberto com produto) THEN o editor SHALL consultar `GET /catalogo/produto/:id` uma vez e reaproveitar o resultado nas seções.
2. THE editor SHALL identificar o plano fixo do produto (tipo de plano com `fixo = true`, ou o único tipo permitido) e consultar `GET /catalogo/plano/:id?produtoId=` para obtê-lo.
3. WHEN o produto tem tipos de plano permitidos que não são fixos THEN o editor SHALL consultar o catálogo de plano sob demanda, por tipo, com cache por sessão do editor.
4. WHILE o catálogo carrega THEN as seções SHALL mostrar estado de carregamento e NOT bloquear o resto do formulário.
5. IF o catálogo falhar (rede ou 4xx/5xx) THEN o editor SHALL exibir aviso legível e voltar às listas gerais atuais, sem perder o que foi preenchido.
6. WHEN o produto é limpo THEN o editor SHALL descartar o catálogo em memória e voltar às listas gerais.

### Requisito 4: Planos com tipo de plano do catálogo

**User Story:** Como orçamentista, quero adicionar planos só dos tipos que o produto permite, para não montar plano
incompatível.

#### Acceptance Criteria

1. WHERE o item tem produto, THE modal "Novo plano" SHALL exibir o seletor "Tipo de plano" com somente os tipos do catálogo do produto, na ordem do catálogo.
2. WHERE o item tem produto e o catálogo tem ao menos um tipo, THE seletor SHALL ser obrigatório para criar plano novo.
3. WHEN o tipo é escolhido THEN o editor SHALL gravar `tipoPlanoId` no plano ao salvar.
4. WHEN o modal edita um plano sem `tipoPlanoId` THEN o seletor SHALL vir vazio e SHALL permitir escolher o tipo, sem obrigar.
5. WHERE o item não tem produto, THE modal SHALL ficar exatamente como hoje (sem seletor de tipo).
6. THE seção Planos do editor (leitura) SHALL exibir a coluna "Tipo de plano" quando houver `tipoPlanoId`, e SHALL NOT mudar para planos sem ele.
7. WHERE o tipo de plano é fixo, THE sistema SHALL NOT oferecê-lo como plano adicional (plano fixo não vira linha de plano).

### Requisito 5: Defaults do produto por plano só em campos vazios

**User Story:** Como orçamentista, quero que o plano e o item já venham com os padrões do produto, para digitar
menos, sem perder o que já escrevi.

#### Acceptance Criteria

1. WHEN o produto é escolhido em item NOVO, THE editor SHALL aplicar os defaults do plano fixo (processo de impressão, cobertura de tinta, fabricante do suporte) apenas nos campos vazios do item.
2. WHEN o tipo de plano é escolhido no modal, THE editor SHALL aplicar apenas nos campos vazios do plano: nome (nome do tipo), número de cores (frente + verso do default), suporte e gramatura padrão do tipo.
3. THE aplicação SHALL NOT sobrescrever campo já preenchido pelo usuário ou vindo de item salvo, e SHALL ser idempotente (aplicar duas vezes dá o mesmo resultado).
4. THE aplicação SHALL NOT mexer na lista de cores do item (o item já nasce com cores iniciais); o número de cores do default é exibido como referência.
5. WHERE o item é puxado do acervo (`calculoGraficoOrigemId`), THE editor SHALL NOT aplicar defaults nem pré-marcar atividades.
6. WHERE o item salvo já tem produto, THE reabertura SHALL NOT reaplicar defaults.
7. THE função de aplicação SHALL ser pura e testável, sem dependência de React, de rede ou de banco.

### Requisito 6: Acabamentos do catálogo

**User Story:** Como orçamentista, quero ver só as atividades do produto e do plano, na ordem do roteiro, com o
acondicionamento separado, para marcar rápido o que se aplica.

#### Acceptance Criteria

1. WHERE o item tem produto, THE seção Acabamentos SHALL listar somente as atividades do catálogo: as de plano (do plano fixo, ou do tipo de cada plano) e as de produto.
2. THE listagem SHALL seguir a ordem do catálogo (roteiro importado; sem ordem, por nome) e SHALL mostrar o acondicionamento em grupo separado, com título próprio.
3. WHEN o item é novo e o produto é escolhido THEN o editor SHALL pré-marcar as atividades de `atividadesPreMarcadas` do default, só se o item ainda não tem acabamentos marcados.
4. WHERE uma atividade já marcada no item não está no catálogo, THE editor SHALL mantê-la marcada e exibi-la num grupo "Fora do catálogo do produto", com aviso discreto e SHALL permitir desmarcar.
5. WHEN a atividade tem restrições no catálogo THEN o editor SHALL oferecer a escolha da restrição e SHALL exigir a escolha quando a atividade exige restrição, como hoje.
6. THE valores de custo, produção, acertos e tempos de cada atividade marcada SHALL continuar vindo do cadastro de Acabamentos e SHALL continuar editáveis como hoje.
7. WHERE o item não tem produto, THE seção SHALL continuar com a lista geral, busca, filtro por natureza e ordenação atuais.
8. WHERE o item tem planos de tipo definido, THE modal do plano SHALL listar as atividades do catálogo daquele tipo de plano e gravar a marcação em `acabamentosRicos` do plano.
9. THE busca por texto SHALL continuar disponível dentro da lista do catálogo.

### Requisito 7: Materiais permitidos e seleção por atividade

**User Story:** Como orçamentista, quero escolher, para cada atividade marcada, o material permitido (ex.: Cola
Quente em vez de Cola Branca), para o preço refletir a escolha.

#### Acceptance Criteria

1. WHERE o item tem produto e a atividade marcada tem materiais no catálogo, THE editor SHALL exibir o seletor "Material" com somente esses materiais, com o padrão do catálogo pré-selecionado quando houver.
2. WHEN o usuário escolhe o material THEN o editor SHALL gravar a seleção por `PUT /selecao-material` (item, plano opcional, atividade, material, restrição opcional, `tipoParam`, parâmetros) e SHALL atualizar a linha correspondente em `materiaisAcabamento` do formulário com `origem: 'SELECAO'` e `selecaoId`.
3. IF a API responder 422 (material não permitido) THEN o editor SHALL mostrar a lista de permitidos devolvida e NOT alterar a seleção anterior.
4. WHERE o item é puxado, THE seleção SHALL ser gravada como informativa (`aplicaNoPreco = false`); o custo ancorado SHALL permanecer intacto e a tela SHALL indicar "informativo, não altera o preço".
5. WHERE a situação do parâmetro é A_VERIFICAR (TipoParam 2 ou 3, preço ausente, área ausente), THE editor SHALL exibir um aviso discreto com tooltip ("Parâmetro a verificar; não altera o preço") e SHALL NOT bloquear nem alterar o total.
6. WHEN a atividade é desmarcada OU o material é removido THEN o editor SHALL remover a seleção correspondente por `DELETE /selecao-material` e a linha de `materiaisAcabamento` com `origem: 'SELECAO'`.
7. THE editor SHALL pedir os parâmetros do material conforme o `tipoParam` (TipoParam 1: % frente e verso; TipoParam 4: peças por unidade; TipoParam 0: sem parâmetro; TipoParam 2 e 3: informativos).
8. THE editor SHALL exibir, por seleção, o consumo, a unidade e o custo devolvidos pela API (valor unitário congelado no momento da seleção).
9. IF a decisão 3 do `design.md` for aprovada, THEN `MaterialAcabamento` SHALL ganhar a coluna aditiva `tipoParam` (nula por padrão) e o importador SHALL preenchê-la; enquanto nula, o editor SHALL deduzir o `tipoParam` pelo `tipoMaterial` com o mapa provisório do `design.md`.
10. WHERE o item é novo e ainda não tem `id`, THE editor SHALL guardar as seleções como pendentes e aplicá-las no passe de seleções logo depois do primeiro salvamento.
11. THE material e o preço SHALL ser os do catálogo da empresa; nenhum valor SHALL ser digitado livremente na seleção (para valor livre, vale a seção atual de materiais manuais).

### Requisito 8: Preservar as seleções ao salvar e refletir no preço

**User Story:** Como orçamentista, quero que salvar o item não apague as seleções de material e que o preço ao
vivo as considere, para não perder a escolha nem ver valores diferentes dos gravados.

#### Acceptance Criteria

1. WHEN o item é salvo THEN o payload SHALL incluir `materiaisAcabamento` com TODAS as linhas `origem: 'SELECAO'` (inclusive as de `computarCusto = false`) e as linhas manuais marcadas, preservando `origem` e `selecaoId`.
2. WHEN um item salvo é reaberto THEN o formulário SHALL hidratar `materiaisAcabamento` com `origem` e `selecaoId` (hoje essas marcas se perdem na hidratação).
3. THE página do orçamento SHALL passar ao editor `materiaisAcabamento` e `produtoGraficoId` do item.
4. WHERE o item tem produto, THE cálculo ao vivo SHALL enviar `materiaisAcabamento` (linhas com custo computado) para os KPIs refletirem a seleção; WHERE não tem produto, THE payload do cálculo ao vivo SHALL ficar idêntico ao atual.
5. WHEN há seleções novas ou removidas depois do salvamento THEN o editor SHALL regravar o item (passe de recálculo) para o resultado e o consolidado refletirem a escolha, usando a rota existente de edição do item.
6. THE regravação SHALL NOT sobrescrever as linhas manuais de materiais.
7. THE comportamento para item sem produto e sem linhas `SELECAO` SHALL ficar idêntico ao atual (mesmo payload).

### Requisito 9: Itens diversos automáticos sugeridos

**User Story:** Como orçamentista, quero ver os itens diversos que o plano exige, para não esquecer nenhum.

#### Acceptance Criteria

1. WHERE o item tem produto, THE seção Itens Complementares SHALL exibir o bloco "Sugeridos pelo plano" com os itens diversos automáticos do catálogo do plano fixo ou do tipo de plano dos planos do item.
2. THE editor SHALL oferecer "Adicionar" por item e "Adicionar todos"; NOT adicionar nenhum item sozinho.
3. THE editor SHALL NOT sugerir item cuja descrição (sem acento e sem diferença de caixa) já esteja nos itens diversos do item.
4. WHEN um sugerido é adicionado THEN o editor SHALL criar a linha com descrição, quantidade e valor vindos do cadastro (`nome`, `quantidadePorUnidade`, `custoInformado`) e SHALL marcar visualmente a linha sem custo cadastrado, para o usuário informar o valor.
5. THE itens diversos SHALL continuar sendo salvos no formato atual (`descricao`, `quantidade`, `valor`, `fixo`).
6. WHERE o item não tem produto, THE seção SHALL ficar como hoje.

### Requisito 10: Campos livres da solicitação (decisão de escopo)

**User Story:** Como responsável pelo produto, quero que fique registrado onde ARTE e PADRÃO entram, para não
misturar fontes de dado.

#### Acceptance Criteria

1. THE spec SHALL registrar no `design.md` a decisão sobre campos livres e sua justificativa.
2. THE Fase 2 SHALL NOT criar tabela de valores de campos livres nem alterar Portal do Representante, Solicitação ou Pedido-Proposta.
3. THE editor do item SHALL manter o bloco de campos livres atual (rótulo e conteúdo), sem mudança.
4. IF o usuário aprovar a tarefa opcional correspondente, THEN o editor SHALL poder oferecer os rótulos dos campos livres configurados como sugestão de rótulo no bloco atual, sem gravar em outro lugar.

### Requisito 11: Não-regressão

**User Story:** Como responsável técnico, quero que nada do que funciona hoje mude, para entregar sem risco.

#### Acceptance Criteria

1. WHERE o item não tem `produtoGraficoId`, THE editor, o payload de salvar e o payload de cálculo SHALL ser idênticos aos atuais (listas gerais, mesmos campos).
2. THE orçamentos existentes e os puxados do acervo SHALL abrir, calcular e salvar com os mesmos valores de hoje.
3. THE `ancorarCustoCalcgraf`, o motor de cálculo e os testes de decomposição (`decomposicao-stc.service.test.ts`) SHALL permanecer sem alteração e verdes.
4. THE Ajustes de Produtividade, Quebras e Limites de Montagem SHALL NOT influenciar o cálculo nem o PCP.
5. THE suíte existente do módulo de orçamento gráfico (back) e os testes do editor (front) SHALL continuar passando.
6. THE wizard antigo (`ItemWizardModal`, `/novo`) SHALL ficar sem mudança nesta fase.

### Requisito 12: Remover seleção de material (back mínimo)

**User Story:** Como orçamentista, quero desfazer a escolha de um material ou desmarcar a atividade, para a seleção
antiga não voltar ao salvar.

#### Acceptance Criteria

1. THE sistema SHALL oferecer `DELETE /orcamento-grafico/cadastros/selecao-material?itemId=&acabamentoId=&planoId=` que remove a seleção do par (item, plano, atividade).
2. WHEN a seleção é removida THEN o sistema SHALL refazer o reflexo no Json `materiaisAcabamento` do item com `refletirSelecoesNoJson` e SHALL devolver o resumo de custos, na mesma transação.
3. THE remoção SHALL manter as linhas manuais do Json e SHALL ser idempotente (remover o que não existe devolve 200 com `removidas: 0`).
4. THE rota SHALL usar `empresaId` explícito e responder 404 quando o item não for da empresa.
5. THE remoção SHALL NOT recalcular o `resultadoCalculo` do item; o recálculo ocorre no passe do Requisito 8.5.

### Requisito 13: Isolamento, interface e acessibilidade

**User Story:** Como usuário, quero uma tela clara e consistente, para usar o catálogo sem estranhar.

#### Acceptance Criteria

1. THE chamadas novas SHALL usar o `empresaId` da sessão no back (explícito em toda query); o front SHALL NOT enviar `empresaId`.
2. THE telas SHALL NOT exibir o nome do sistema legado em nenhum texto, tooltip ou mensagem.
3. THE componentes SHALL usar tokens adaptativos do Mantine (`*-light`, `default`, `body`, `dimmed`) e funcionar nos temas claro e escuro, sem cor fixa de fundo.
4. THE seletores e listas novas SHALL ter estados de carregamento, vazio e erro, com mensagem legível.
5. THE avisos A_VERIFICAR e "Fora do catálogo" SHALL ser discretos (texto pequeno, ícone e tooltip), sem alertas bloqueantes.
6. THE mensagens de erro da API SHALL ser mostradas como a API devolve (`message`), sem texto técnico de validação.
7. THE Ajustes, Quebras e Limites SHALL continuar fora: nenhuma tela do editor SHALL sugerir que eles alteram o cálculo.

### Requisito 14: Verificação

**User Story:** Como responsável técnico, quero provas de que nada quebrou, para aprovar a entrega.

#### Acceptance Criteria

1. THE funções puras novas (aplicar defaults em campos vazios, filtrar e ordenar atividades pelo catálogo, mesclar linhas de seleção, sugerir itens diversos, deduzir `tipoParam`) SHALL ter testes de unidade com Vitest e propriedades com fast-check (as de propriedade são opcionais).
2. THE back SHALL ter testes de rota para o aceite e a devolução dos campos novos e para o DELETE da seleção, com Prisma mockado, incluindo isolamento por empresa.
3. THE regressão SHALL rodar a suíte do módulo `orcamento-grafico` (back) e os testes de `editor/` (front, com `--pool=threads`).
4. THE verificação SHALL usar `get_diagnostics` nos arquivos tocados; NOT rodar `tsc` inteiro nem `next build` nesta máquina.
5. THE conferência manual SHALL cobrir: item sem produto igual ao de hoje; item puxado com seleção informativa; item novo com produto, atividades, material e itens diversos sugeridos; plano com tipo.

## Pontos a verificar o funcionamento exato (não bloqueiam a entrega)

- Relação entre Produto Gráfico e Tipo de Embalagem: hoje não existe vínculo no cadastro. A fase mantém os dois seletores independentes; um vínculo futuro pode pré-selecionar o tipo.
- `tipoParam` de cada material: não está no cadastro. Mapa provisório por `tipoMaterial` e coluna opcional `tipoParam` (decisão 3).
- Fórmulas dos TipoParam 2 e 3 e parâmetro 2 do TipoParam 3: seguem informativos (custo zero, A_VERIFICAR).
- Se `/orcamento-grafico/suportes` e a relação PLANO→SUPORTE usam os mesmos ids (`SuporteGrafico`); confirmar antes de restringir o seletor de suporte do plano.
- Limite de 100 acabamentos por página em `StepAcabamentos` (a empresa tem cerca de 67; confirmar se o catálogo cabe).
- `abrirEditorPagina` (`[id]/page.tsx`) monta o item com um subconjunto de campos; conferir quais outros campos técnicos ficam de fora ao reabrir e se isso é intencional.
- Se `reaproveitar` e `de-calculo` devem copiar `produtoGraficoId` e `tipoPlanoId`.
- O cálculo ao vivo hoje não envia `materiaisAcabamento`; só passa a enviar quando o item tem produto (não-regressão). Decidir depois se vale corrigir para todos.
- `itensDiversos` normaliza `valor` mínimo de 0,01 no payload; item sugerido sem custo cadastrado fica com 0,01 até o usuário editar.
- Itens puxados sem plano em `PlanoCalculoGrafico`: a escolha de tipo de plano só vale para itens com planos de cálculo.

## Dependências

- Fase 1 no ar (back `a28fa0b33`, front `41dd0c2`) com a importação da Wega gravada (11 produtos, 14 planos, 16 defaults, 1.575 relações, 22 itens diversos).
- Os 249 itens não casados da importação (centros, suportes, tintas e matrizes) podem deixar atividades ou suportes fora do catálogo; não bloqueia, mas afeta a cobertura.
- Autorização do usuário para a decisão 3 (coluna `tipoParam`) e, se aprovada, para rodar o importador em produção (dry-run revisado antes).
- Deploy do back (Render) antes do front usar os campos novos.
