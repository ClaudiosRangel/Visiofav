# Requirements Document

**Requisitos — Orçamento Gráfico: Produto × Embalagem e Acabamentos da Fase 3**

## Introduction

A Fase 2 (`orcamento-grafico-catalogo-no-editor`, já entregue) ligou o editor do item ao catálogo do Produto
Gráfico. Ficaram abertos os itens do backlog da seção 20 do `docs/orcamento-planos-calcgraf-HANDOFF.md`. Esta
fase trata esses itens, nesta ordem:

1. Vínculo Produto Gráfico × Tipo de Embalagem: o produto passa a sugerir o Tipo de Embalagem e, quando
   existirem, o suporte e a gramatura padrão do plano. Hoje os dois seletores são independentes e o
   salvamento responde 400 (`tipoEmbalagemId`, `gramatura`, `precoKg`) enquanto os campos estão em branco.
2. Campos livres (ARTE, PADRÃO) como sugestão de rótulos e opções no item (tarefa 4.14 adiada na Fase 2).
3. Acondicionamento: "Caixa Padrão" e "Embalar" aparecem no grupo "Atividades" no produto Cartucho Composto.
4. As rotas `POST /orcamento-grafico/:id/reaproveitar` e `POST /orcamento-grafico/de-calculo` passam a copiar
   `produtoGraficoId` e `tipoPlanoId`.
5. Seletor de material por atividade também para produtos sem plano fixo (vários tipos de plano), no modal de plano.
6. Pendências da Fase 2: campos técnicos que o editor não repassa ao reabrir o item, falha de seleção de
   material no primeiro salvamento que fecha o editor, e o limite de 100 acabamentos carregados.

O trabalho é majoritariamente aditivo: nenhum orçamento sem Produto Gráfico muda, e nenhum valor de item
puxado do acervo muda. O front fica em `c:\Source\VisioFab.Wms.Front`; o back em `c:\Source\VisioFab.Wms.Back`.

### Decisão em aberto, a validar no `design.md` (não decidida nestes requisitos)

**Onde guardar o vínculo Produto Gráfico → Tipo de Embalagem.** Há duas opções:

- **Opção A:** campo opcional em `ProdutoGrafico` apontando para `TipoEmbalagem` (mudança de schema e
  `migrate-prod.ts` idempotente no mesmo commit).
- **Opção B:** linha na tabela genérica `relacao_cadastro_grafico` (`tipoOrigem = PRODUTO`,
  `tipoDestino = TIPO_EMBALAGEM`), que exige incluir o par em `relacoes-permitidas.ts` e não altera o schema.

Os requisitos abaixo descrevem o comportamento esperado, independente da opção escolhida. O design deve
comparar as duas e registrar a decisão para aprovação do usuário.

### Fora desta fase

- Fazer Ajustes de Produtividade, Quebras e Limites de Montagem influenciarem o motor ou o PCP.
- Alterar `ancorarCustoCalcgraf` ou o motor de cálculo.
- Criar tabela de valores de campos livres da Solicitação ou do Pedido, ou alterar Portal do Representante,
  Solicitação e Pedido-Proposta.
- Rodar a fase `materiais-tipo-param` do importador em produção (continua dependendo de novo export do
  legado e de dry-run autorizado).

## Glossary

- **Produto_Grafico**: cadastro de tipo de produto de uma linha (`ProdutoGrafico`), da Fase 1.
- **Tipo_Embalagem**: cadastro `TipoEmbalagem`, que traz a fórmula de planificação usada pelo cálculo. O
  item o grava em `tipoEmbalagemId`.
- **Vinculo_Embalagem**: associação configurável entre um Produto_Grafico e um Tipo_Embalagem. O local de
  armazenamento é a decisão em aberto acima.
- **Tipo_Plano**: cadastro `TipoPlanoGrafico`, com `suportePadraoId` e `gramaturaPadrao` opcionais.
- **Plano_Fixo**: plano único e implícito de uma linha, sem linhas em `PlanoCalculoGrafico`.
- **Editor**: editor do item do orçamento, em `src/app/(interna)/orcamento-grafico/[id]/editor` do front.
- **Item_Novo**: item sem `calculoGraficoOrigemId` e ainda sem `id` ou recém-aberto para edição inicial.
- **Item_Puxado**: item com `calculoGraficoOrigemId` (veio da biblioteca). Mantém o custo ancorado.
- **Campo_Preenchido**: campo do formulário com valor informado pelo usuário ou vindo de item salvo.
- **Sugestao**: valor exibido ao usuário e aplicado somente em Campo vazio; nunca sobrescreve um Campo_Preenchido.
- **Campo_Livre**: cadastro `CampoLivre` (proprietário SOLICITACAO, PEDIDO, RECUSA ou INSUMO), com opções
  quando o tipo é LISTA.
- **Campos_Livres_Item**: Json `camposLivres` do item (lista de `{ rotulo, conteudo }`), já existente.
- **Acondicionamento**: atividade de embalagem e expedição (ex.: Caixa Padrão, Embalar) que o catálogo
  separa em grupo próprio.
- **Catalogo**: resposta das rotas `GET /catalogo/produto/:id` e `GET /catalogo/plano/:id?produtoId=`.
- **Selecao_Material**: linha de `SelecaoMaterialAcabamento` (item, plano, atividade) refletida no Json
  `materiaisAcabamento` com `origem: 'SELECAO'`.
- **Importador_Cadastros**: `scripts/importar-cadastros-orcamento.ts`, idempotente por `codigoOrigem`.
- **Campos_Tecnicos**: campos do item que o `abrirEditorPagina` não repassa ao reabrir (lista no Requirement 9).
- **Sistema_Back**: API do orçamento gráfico em `VisioFab.Wms.Back`.
- **Sistema_Front**: telas do orçamento gráfico em `VisioFab.Wms.Front`.

## Requirements

### Requirement 1: Configurar o vínculo Produto Gráfico × Tipo de Embalagem no cadastro

**User Story:** Como administrador do cadastro, quero indicar, na tela de Produtos, qual Tipo de Embalagem
cada Produto Gráfico usa, para o editor poder sugeri-lo.

#### Acceptance Criteria

1. WHEN o usuário abre o formulário de criação ou edição de produto na tela de Produtos do orçamento gráfico, THE Sistema_Front SHALL exibir o seletor "Tipo de Embalagem" listando os Tipo_Embalagem com status ativo da empresa da sessão, ordenados por nome, e SHALL pré-selecionar o Tipo_Embalagem do Vinculo_Embalagem quando o produto já tiver um.
2. THE seletor SHALL ser opcional, aceitar no máximo 1 Tipo_Embalagem por Produto_Grafico e oferecer ação de limpar a escolha.
3. WHEN o usuário salva o produto com um Tipo_Embalagem escolhido, THE Sistema_Back SHALL gravar o Vinculo_Embalagem e SHALL devolver o `tipoEmbalagemId` (nulo quando não houver vínculo) no corpo da resposta de gravação e em toda leitura do produto (listagem e detalhe).
4. IF o Tipo_Embalagem informado não existir na empresa do usuário, THEN THE Sistema_Back SHALL responder 422 com mensagem legível indicando que o Tipo de Embalagem é inválido, SHALL NOT gravar o Vinculo_Embalagem e SHALL manter inalterados os demais campos do produto, e THE Sistema_Front SHALL exibir a mensagem e manter o formulário preenchido.
5. WHEN o usuário limpa o seletor e salva, THE Sistema_Back SHALL remover o Vinculo_Embalagem do produto e SHALL devolver `tipoEmbalagemId` nulo, sem alterar os demais campos do produto.
6. IF um Tipo_Embalagem vinculado ao produto estiver inativo, THEN THE Sistema_Front SHALL exibi-lo no seletor, na tela de Produtos, com a marcação "inativo", SHALL NOT removê-lo do Vinculo_Embalagem ao salvar sem alteração do seletor e SHALL NOT oferecê-lo como nova escolha para outros produtos.
7. THE Sistema_Back SHALL aplicar `empresaId` explícito (o da sessão, não o enviado pelo cliente) em toda consulta e gravação do Vinculo_Embalagem, incluindo a validação do Tipo_Embalagem, e SHALL tratar como inexistente (422) um Tipo_Embalagem de outra empresa.
8. THE `design.md` SHALL comparar a Opção A e a Opção B pelo menos quanto a mudança de schema, migração de produção, reversibilidade e consistência com `relacao_cadastro_grafico`, SHALL registrar a recomendação e SHALL aguardar aprovação do usuário antes de qualquer mudança de schema.
9. IF a decisão aprovada alterar `schema.prisma`, THEN o mesmo commit SHALL incluir a alteração idempotente equivalente em `prisma/migrate-prod.ts`, e a execução de `migrate-prod.ts` duas vezes seguidas SHALL terminar sem erro e sem alterar dados na segunda execução.
10. THE Vinculo_Embalagem SHALL ser aditivo: para todo produto sem vínculo, a leitura (com `tipoEmbalagemId` nulo), a gravação e o comportamento do editor SHALL permanecer iguais aos de antes desta fase, e nenhum produto existente SHALL ter vínculo criado, alterado ou removido por esta fase fora de ação do usuário (a importação é tratada no Requirement 2).

### Requirement 2: Importação de produtos existentes sem quebra

**User Story:** Como responsável técnico, quero que a importação dos produtos existentes continue funcionando
com o vínculo novo, para não perder os 11 produtos da Carton Wega nem duplicá-los.

#### Acceptance Criteria

1. WHEN o Importador_Cadastros roda a fase de produtos sobre produtos já importados, THE Importador_Cadastros SHALL manter inalterados `codigoOrigem`, nome, linha e tributação de cada Produto_Grafico existente (zero diferenças na comparação campo a campo antes e depois) e SHALL manter a contagem de Produto_Grafico da empresa igual à anterior (zero duplicados).
2. WHEN o Importador_Cadastros roda a fase de produtos e um Produto_Grafico já tem Vinculo_Embalagem preenchido, THE Importador_Cadastros SHALL manter esse vínculo com o mesmo valor, mesmo que o legado informe um Tipo_Embalagem diferente.
3. WHERE o legado informa o tipo de embalagem do produto, WHEN o Importador_Cadastros roda a fase de produtos e o par casa com exatamente 1 Tipo_Embalagem da empresa por `codigoOrigem` ou por código `CG-EMB-<n>`, THE Importador_Cadastros SHALL preencher o Vinculo_Embalagem somente se ele estiver vazio.
4. IF o legado não informar o tipo de embalagem do produto, ou o casamento tiver 0 ou 2 ou mais candidatos, THEN THE Importador_Cadastros SHALL deixar o Vinculo_Embalagem vazio, SHALL continuar importando o produto normalmente e SHALL listar no relatório de não casados o `codigoOrigem` do produto com o motivo (sem informação, nenhum candidato ou mais de um candidato).
5. WHEN o Importador_Cadastros roda com `--dry-run`, THE Importador_Cadastros SHALL gravar 0 registros e SHALL exibir a contagem de produtos criados, atualizados, com vínculo preenchido e não casados.
6. THE execução do Importador_Cadastros em produção SHALL ocorrer somente após dry-run revisado pelo usuário e autorização explícita do usuário.
7. WHEN o Importador_Cadastros roda uma segunda vez seguida com o mesmo arquivo de origem, THE Importador_Cadastros SHALL criar 0 registros e alterar 0 registros (idempotência).
8. IF a gravação de um produto falhar durante a importação, THEN THE Importador_Cadastros SHALL desfazer as alterações daquele produto, SHALL registrar no relatório o `codigoOrigem` e a mensagem da falha, SHALL continuar com os demais produtos e SHALL terminar com código de saída diferente de zero.
9. IF a decisão aprovada para o Vinculo_Embalagem alterar `schema.prisma`, THEN o `prisma/migrate-prod.ts` SHALL rodar duas vezes seguidas sem erro, e a segunda execução SHALL NOT alterar nenhum dado existente.

### Requirement 3: Produto sugere o Tipo de Embalagem no editor

**User Story:** Como orçamentista, quero que, ao escolher o Produto Gráfico, o editor já sugira o Tipo de
Embalagem, para não precisar escolher os dois separadamente.

#### Acceptance Criteria

1. WHEN o usuário escolhe um Produto_Grafico que tem Vinculo_Embalagem com Tipo_Embalagem ativo, em um Item_Novo cujo campo Tipo de Embalagem está vazio, THE Editor SHALL preencher o campo com o Tipo_Embalagem do vínculo em até 1 segundo após a escolha, sem nenhuma outra ação do usuário.
2. WHERE o campo Tipo de Embalagem do item é um Campo_Preenchido (valor digitado, escolhido ou vindo de item salvo), THE Editor SHALL manter o valor existente e NOT substituí-lo pelo do vínculo.
3. WHEN o Tipo_Embalagem foi preenchido por Sugestao do produto, THE Editor SHALL exibir junto ao campo o texto pequeno "sugerido pelo produto" e SHALL permitir trocar ou limpar a escolha. Após a troca ou a limpeza, o texto SHALL desaparecer.
4. WHEN o usuário troca ou limpa o Produto_Grafico, THE Editor SHALL manter o valor do campo Tipo de Embalagem igual ao anterior à troca, inclusive quando ele veio de Sugestao, e SHALL NOT aplicar nova Sugestao sobre um campo já preenchido.
5. WHERE o Produto_Grafico escolhido não tem Vinculo_Embalagem, THE Editor SHALL deixar o campo Tipo de Embalagem inalterado e sem indicação de sugestão.
6. IF o Tipo_Embalagem do vínculo está inativo, THEN THE Editor SHALL NOT preencher o campo e SHALL exibir o aviso discreto "tipo de embalagem do produto está inativo", mantendo o campo vazio para escolha manual.
7. WHEN um item salvo é reaberto, THE Editor SHALL exibir o Tipo_Embalagem gravado no item e SHALL NOT aplicar Sugestao de Tipo_Embalagem, mesmo que o campo esteja vazio.
8. WHERE o item é Item_Puxado, THE Editor SHALL NOT aplicar Sugestao de Tipo_Embalagem.
9. WHEN o Tipo_Embalagem é preenchido por Sugestao, THE Editor SHALL aplicar o mesmo tratamento que a escolha manual do tipo recebe (por exemplo, recarregar as variáveis de medida da fórmula), e o valor calculado do item SHALL ser igual ao obtido quando o usuário escolhe o mesmo tipo manualmente.
10. THE função que decide a Sugestao de Tipo_Embalagem SHALL receber somente valores simples (produto escolhido, vínculo, valor atual do campo, flags de Item_Novo, Item_Puxado e item salvo) e devolver o Tipo_Embalagem a aplicar ou "nenhum". Ela SHALL ser pura (sem React, rede ou banco) e coberta por testes de unidade.
11. THE Sugestao de Tipo_Embalagem SHALL ser idempotente: aplicá-la duas vezes sobre o mesmo estado SHALL produzir o mesmo formulário que aplicá-la uma vez.

### Requirement 4: Suporte e gramatura padrão do plano

**User Story:** Como orçamentista, quero que o suporte e a gramatura padrão do plano venham preenchidos
quando existirem, para não ficarem em branco e obrigatórios.

#### Acceptance Criteria

1. WHEN o usuário escolhe um Produto_Grafico em Item_Novo cujo Plano_Fixo tem `suportePadraoId`, THE Editor SHALL preencher o campo de suporte com esse suporte como Sugestao, somente se o campo estiver vazio (sem valor ou valor nulo).
2. WHEN o usuário escolhe um Produto_Grafico em Item_Novo cujo Plano_Fixo tem `gramaturaPadrao`, THE Editor SHALL preencher o campo de gramatura com esse valor, em g/m², como Sugestao, somente se o campo estiver vazio (sem valor, nulo ou 0).
3. WHEN o usuário escolhe um Tipo_Plano no modal de plano, THE Editor SHALL preencher, a partir do `suportePadraoId` e da `gramaturaPadrao` desse Tipo_Plano, apenas os campos de suporte e de gramatura do plano que estiverem vazios, e SHALL manter os campos já preenchidos.
4. WHEN o suporte e a gramatura de um item ou plano (sugeridos ou informados) correspondem a exatamente 1 papel do cadastro de preços (`PrecoMateriaPrima`) com preço por kg maior que 0, THE Editor SHALL preencher o `precoKg` com o preço desse papel, somente se o campo `precoKg` estiver vazio.
5. IF o suporte e a gramatura correspondem a 0 papéis ou a 2 ou mais papéis do cadastro de preços, THEN THE Editor SHALL manter o `precoKg` vazio e SHALL exibir um aviso discreto ("preço não encontrado" para 0 papéis, "mais de um papel encontrado" para 2 ou mais).
6. THE Editor SHALL aplicar as Sugestoes dos critérios 1 a 4 sem sobrescrever Campo_Preenchido, e aplicá-las duas vezes seguidas SHALL produzir o mesmo resultado que aplicá-las uma vez.
7. WHERE o item é Item_Puxado, ou WHEN um item salvo é reaberto, THE Editor SHALL NOT sugerir suporte, gramatura nem `precoKg`, e SHALL manter os valores gravados.
8. WHEN o usuário aciona "Salvar" e o Tipo_Embalagem, a gramatura (maior que 0) ou o `precoKg` (maior que 0) continuam vazios, THE Editor SHALL NOT enviar a requisição ao Sistema_Back, SHALL listar pelo nome cada campo que falta e SHALL manter o formulário preenchido.
9. IF o Sistema_Back responder 400 por `tipoEmbalagemId`, `gramatura` ou `precoKg`, THEN THE Editor SHALL exibir a `message` devolvida pela API, SHALL manter o formulário com os valores digitados e SHALL permanecer aberto.
10. IF o carregamento do Catalogo ou do cadastro de preços de papel falhar ao aplicar uma Sugestao, THEN THE Editor SHALL exibir um aviso legível, SHALL manter vazios os campos que dependiam da Sugestao e SHALL manter inalterados os Campo_Preenchido.

### Requirement 5: Campos livres do item como sugestão de rótulos e opções

**User Story:** Como orçamentista, quero que os campos livres configurados (ARTE, PADRÃO) apareçam como sugestão no item, para padronizar rótulos e escolher entre as opções cadastradas.

#### Acceptance Criteria

1. WHEN o Editor é aberto, THE Editor SHALL carregar uma única vez por sessão do Editor os Campo_Livre da empresa com status ativo e proprietário SOLICITACAO ou PEDIDO, com ou sem Produto_Grafico no item.
2. WHEN o usuário foca o campo Rótulo de um par do bloco atual de campos livres do item, THE Editor SHALL listar como sugestão o rótulo de cada Campo_Livre carregado, em ordem alfabética, sem repetir rótulo.
3. WHERE o Campo_Livre é do tipo LISTA, THE Editor SHALL oferecer suas opções cadastradas como escolha para o campo Conteúdo do par com esse rótulo, na ordem do cadastro, e SHALL marcar a opção padrão com o indicador textual "padrão" sem selecioná-la.
4. WHEN o usuário escolhe um rótulo ou uma opção, THE Editor SHALL gravar o par `{ rotulo, conteudo }` no Json `camposLivres` do item ao salvar, sem criar outra tabela de valores.
5. THE Editor SHALL aceitar rótulo e conteúdo digitados livremente, inclusive valores que não constam no cadastro, como hoje.
6. WHERE o Campo_Livre é obrigatório, THE Editor SHALL exibir ao lado do rótulo sugerido um ícone com tooltip "obrigatório" em texto pequeno, e SHALL NOT bloquear o salvamento do item quando ele não for preenchido.
7. WHEN um item salvo é reaberto, THE Editor SHALL exibir todos os pares gravados em `camposLivres`, inclusive os cujo rótulo não existe mais no cadastro ou está inativo, sem alterá-los.
8. THE Editor SHALL NOT adicionar par a `camposLivres` nem selecionar opção padrão sem ação do usuário.
9. THE Editor SHALL NOT listar Campo_Livre de proprietário RECUSA ou INSUMO, e o `design.md` SHALL registrar a confirmação da lista de proprietários SOLICITACAO e PEDIDO antes da implementação.
10. IF o carregamento dos Campo_Livre falhar, THEN THE Editor SHALL manter o bloco atual de campos livres funcional com digitação livre, exibir um aviso legível com a mensagem devolvida pela API, e SHALL NOT bloquear o salvamento do item.
11. THE gravação em `camposLivres` SHALL respeitar o limite do schema: no máximo 20 pares, rótulo com no máximo 50 caracteres e conteúdo com no máximo 500 caracteres.
12. THE `camposLivres` SHALL NOT influenciar o cálculo, o `ancorarCustoCalcgraf`, o `resultadoCalculo` nem o preço do item, e o valor do consolidado após salvar SHALL ser igual ao anterior para o mesmo item sem outra alteração.
13. IF o item já tem 20 pares em `camposLivres` e o usuário tenta adicionar outro, THEN THE Editor SHALL impedir a adição e exibir mensagem legível informando o limite de 20 pares, mantendo os pares existentes.
14. WHERE o Campo_Livre não é do tipo LISTA, ou não há nenhum Campo_Livre ativo com proprietário SOLICITACAO ou PEDIDO, THE Editor SHALL sugerir apenas o rótulo (ou nenhuma sugestão, quando a lista está vazia) e SHALL manter o campo Conteúdo como digitação livre, sem exibir aviso de erro.

### Requirement 6: Acondicionamento no grupo correto

**User Story:** Como orçamentista, quero que "Caixa Padrão" e "Embalar" apareçam no grupo Acondicionamento do
produto Cartucho Composto, para encontrá-los onde o roteiro os coloca.

#### Acceptance Criteria

1. THE `design.md` SHALL registrar, com consulta somente de leitura em produção na empresa Carton Wega, qual destes três casos ocorre para a relação de acondicionamento do Produto_Grafico Cartucho Composto: (a) a relação não foi importada, (b) a relação existe com `tipoRelacao` diferente do de acondicionamento, ou (c) a relação existe com o tipo correto e o defeito está na classificação por grupo do Catalogo ou do Editor.
2. IF o caso for (a), THEN THE Importador_Cadastros SHALL criar a relação de acondicionamento do produto incluindo as atividades "Caixa Padrão" e "Embalar", sem remover nem alterar relações existentes.
3. IF o caso for (b), THEN THE Importador_Cadastros SHALL gravar a relação de acondicionamento para as atividades "Caixa Padrão" e "Embalar" e SHALL manter a relação de tipo diferente já existente sem alteração.
4. IF o caso for (c), THEN a correção SHALL ficar na função de classificação por grupo e SHALL NOT alterar nenhuma relação gravada.
5. WHEN o Importador_Cadastros roda a correção duas vezes seguidas, THEN a segunda execução SHALL criar 0 relações e alterar 0 registros em `relacao_cadastro_grafico`.
6. WHEN a correção do Importador_Cadastros for executada em produção, THEN a execução SHALL ocorrer somente após dry-run revisado e autorização explícita do usuário. O dry-run SHALL listar as relações a criar sem gravar nada.
7. WHEN o produto Cartucho Composto é aberto no Editor, THEN "Caixa Padrão" e "Embalar" SHALL aparecer no grupo "Acondicionamento", em ambas as respostas do Catalogo (`GET /catalogo/produto/:id` e `GET /catalogo/plano/:id?produtoId=`), e SHALL NOT aparecer no grupo "Atividades".
8. THE correção SHALL NOT alterar o grupo de nenhuma atividade de qualquer outro Produto_Grafico cujo agrupamento já esteja correto. O teste SHALL comparar o agrupamento de todos os produtos da Carton Wega antes e depois da correção, com diferença apenas nos produtos corrigidos.
9. WHEN um item salvo tem "Caixa Padrão" ou "Embalar" marcada, THEN, depois da correção, a atividade SHALL continuar marcada com o mesmo `acabamentoId`, e somente o grupo em que é exibida SHALL mudar. O custo, o `resultadoCalculo` e o consolidado do item SHALL permanecer idênticos.
10. THE `design.md` SHALL listar cada outro Produto_Grafico da Carton Wega que tenha atividade de acondicionamento no grupo "Atividades" (mesmo defeito) e SHALL propor, para aprovação do usuário, se a correção os inclui. A correção SHALL NOT incluí-los sem essa aprovação.

### Requirement 7: Copiar produto e tipo de plano ao reaproveitar e puxar cálculo

**User Story:** Como orçamentista, quero que um orçamento reaproveitado mantenha o Produto Gráfico e o tipo
de plano do original, para o editor abrir com o catálogo certo.

#### Acceptance Criteria

1. WHEN `POST /orcamento-grafico/:id/reaproveitar` cria o orçamento novo, THE Sistema_Back SHALL gravar em cada item novo o mesmo `produtoGraficoId` do item de origem correspondente, dentro da mesma transação que cria o orçamento.
2. WHEN `POST /orcamento-grafico/:id/reaproveitar` copia planos, THE Sistema_Back SHALL gravar em cada plano novo o mesmo `tipoPlanoId` do plano de origem correspondente.
3. WHEN `POST /orcamento-grafico/de-calculo` cria o item a partir de um cálculo, THE Sistema_Back SHALL gravar no item novo o `produtoGraficoId` e o `tipoPlanoId` do `CalculoGrafico` de origem, para cada um desses campos que o cálculo possuir.
4. IF o item, plano ou `CalculoGrafico` de origem tiver `produtoGraficoId` ou `tipoPlanoId` nulo, THEN THE Sistema_Back SHALL criar o item ou plano novo com esse campo nulo e responder com o mesmo código de status de sucesso de hoje (sem erro).
5. THE `design.md` SHALL registrar, a partir de leitura do schema, se `CalculoGrafico` e os planos do acervo têm colunas `produtoGraficoId` e `tipoPlanoId`. Se não tiverem, SHALL apresentar as alternativas (coluna aditiva no cálculo, ou nenhuma cópia em `de-calculo`) e aguardar aprovação do usuário antes de qualquer mudança em `schema.prisma`.
6. IF o `produtoGraficoId` ou o `tipoPlanoId` de origem não existir como registro `{ id, empresaId }` da empresa do usuário, THEN THE Sistema_Back SHALL criar o item ou plano novo com esse campo nulo, concluir a criação do orçamento normalmente e NOT responder com erro por causa desse campo.
7. THE Sistema_Back SHALL validar cada id copiado com consulta por `{ id, empresaId }` explícito da empresa do usuário e SHALL NOT gravar id pertencente a outra empresa. Nesse caso aplica-se o critério 6.
8. WHEN o orçamento novo é criado por `reaproveitar` ou `de-calculo`, THE Sistema_Back SHALL manter `custoProducao`, `precoVenda`, `resultadoCalculo` e `valorTotalConsolidado` do item e do orçamento idênticos aos que a rota produz hoje, e SHALL NOT alterar `ancorarCustoCalcgraf`.
9. WHEN o item copiado recebe `produtoGraficoId`, THE Sistema_Back SHALL alterar apenas `produtoGraficoId` e `tipoPlanoId` em relação ao comportamento atual, SHALL NOT aplicar defaults do produto e SHALL NOT criar linhas de `SelecaoMaterialAcabamento` nem pré-marcar atividades.
10. IF qualquer etapa de `reaproveitar` ou `de-calculo` falhar, THEN THE Sistema_Back SHALL reverter a transação inteira (nenhum orçamento ou item órfão) e SHALL manter os códigos de status atuais da rota (201 em sucesso; 403, 404 e 409 nos casos atuais).
11. WHEN `reaproveitar` ou `de-calculo` é chamada duas vezes com os mesmos dados, THE Sistema_Back SHALL criar dois orçamentos independentes, cada um com número próprio, como hoje.

### Requirement 8: Seletor de material por atividade em produtos com vários tipos de plano

**User Story:** Como orçamentista, quero escolher o material de cada atividade também nos planos de produtos
sem plano fixo, para não ficar sem a escolha só porque o produto tem vários tipos de plano.

#### Acceptance Criteria

1. WHERE o item tem Produto_Grafico sem Plano_Fixo, WHEN o usuário abre o modal de plano com um Tipo_Plano escolhido, THE Editor SHALL exibir o seletor de material em cada atividade marcada do plano que tenha ao menos um material no Catalogo.
2. WHERE uma atividade marcada do plano não tem material no Catalogo, THE Editor SHALL NOT exibir o seletor de material nessa atividade e SHALL NOT exibir erro.
3. WHEN o usuário escolhe um material para uma atividade de plano que já tem `id`, THE Editor SHALL gravar uma Selecao_Material com `planoId`, atividade, material, restrição opcional e os parâmetros por `tipoParam`, e SHALL exibir a atividade como gravada.
4. WHEN o usuário escolhe um material para uma atividade de plano que ainda não tem `id`, THE Editor SHALL manter a seleção como pendente e SHALL gravá-la automaticamente logo após a resposta de sucesso do salvamento do plano.
5. IF a gravação de uma seleção pendente falhar após o plano ser salvo, THEN THE Editor SHALL manter o modal de plano aberto, exibir a mensagem legível da API com a atividade afetada, marcar a escolha como não gravada e manter o plano salvo (sem criar plano duplicado ao tentar de novo).
6. WHEN o usuário desmarca a atividade no modal de plano, ou remove o material escolhido, THE Editor SHALL remover a Selecao_Material correspondente do plano, e a atividade SHALL ficar sem seleção de material após a remoção.
7. THE Editor SHALL reutilizar, para o plano, a mesma consulta de Catalogo (`GET /catalogo/plano/:id?produtoId=`), o mesmo cache por sessão do editor e as mesmas regras de `tipoParam`, A_VERIFICAR e custo da seleção do Plano_Fixo, de modo que a mesma atividade e o mesmo material produzam o mesmo resultado nos dois casos.
8. IF a consulta de Catalogo do plano falhar, THEN THE Editor SHALL exibir aviso legível no modal, SHALL NOT exibir seletores de material e SHALL manter o restante do modal de plano funcional e os valores já preenchidos.
9. WHERE o item é Item_Puxado, THE Editor SHALL gravar a seleção com `aplicaNoPreco = false`, SHALL exibir o selo "informativo, não altera o preço" e SHALL manter o custo ancorado, o `resultadoCalculo` e o consolidado do item inalterados.
10. IF o Sistema_Back responder 422 por material não permitido, THEN THE Editor SHALL exibir a lista de materiais permitidos devolvida pela API e SHALL manter a seleção anterior da atividade sem alteração.
11. WHEN o usuário salva o item, THE payload SHALL preservar `origem` e `selecaoId` de todas as linhas `SELECAO` de todos os planos, de modo que reabrir e salvar o item sem alteração mantenha o mesmo conjunto de seleções por plano e atividade (mesma regra do Requirement 8 da Fase 2).
12. WHERE o item tem Produto_Grafico com Plano_Fixo, THE seletor de material do Plano_Fixo SHALL permanecer inalterado.
13. WHERE o item não tem Produto_Grafico, THE modal de plano SHALL permanecer idêntico ao atual, sem seletor de material e sem chamada ao Catalogo.
14. THE Sistema_Back SHALL usar `empresaId` explícito em toda consulta e gravação da Selecao_Material de plano, e SHALL responder sem gravar quando o `planoId` não pertencer à empresa do usuário.

### Requirement 9: Campos técnicos do item preservados ao reabrir e salvar

**User Story:** Como orçamentista, quero que reabrir e salvar um item não apague campos técnicos que eu já
preenchi, para não perder dado sem perceber.

#### Acceptance Criteria

1. THE `design.md` SHALL conter uma tabela com uma linha para cada um dos Campos_Tecnicos (`modeloFacaId`, `tintaModo`, `tintaConsumoKg`, `siglaAcabado`, `tributacao`, `processoImpressao`, `coberturaTintaTexto`, `fabricante`, `microondulado`, `fornecido`, `arte`, `observacao`, medidas técnicas, `montagemLinhas`, `montagemColunas`, formatos de suporte e de corte, `suporteProducaoId` e `aproveitamentoManual`) e com três colunas respondidas com "sim" ou "não": repassado ao Editor por `abrirEditorPagina`, devolvido pelo `GET /:id`, e regravado como vazio pelo `PUT /:id/itens/:itemId` quando o payload não o envia.
2. IF a tabela do critério 1 indicar que um Campo_Tecnico não é repassado ao Editor E é regravado como vazio pelo `PUT /:id/itens/:itemId`, THEN o Sistema_Front SHALL repassá-lo ao Editor ao reabrir o item e incluí-lo no payload do salvamento com o valor gravado.
3. IF a tabela do critério 1 indicar que o `GET /:id` não devolve um Campo_Tecnico necessário ao critério 2, THEN o Sistema_Back SHALL incluí-lo no `select` do item, sem remover nem renomear campos já devolvidos.
4. WHEN um item é aberto no Editor e salvo sem nenhuma alteração, THE Sistema_Back SHALL manter cada Campo_Tecnico persistido com valor estritamente igual ao de antes da abertura, e um valor `null` SHALL permanecer `null` (sem virar texto vazio ou zero).
5. WHEN um Item_Puxado é aberto e salvo sem alteração, THE Sistema_Back SHALL manter `custoProducao`, o consolidado do orçamento e o `resultadoCalculo` com os mesmos valores de antes da abertura, sem alterar o `ancorarCustoCalcgraf`.
6. THE função que monta o formulário a partir do item salvo SHALL ser pura (sem React, rede ou banco) e SHALL ter teste de ida e volta (item → formulário → payload) com fast-check, com no mínimo 100 execuções, verificando que cada Campo_Tecnico do payload é igual ao do item.
7. WHERE o item foi criado pelo wizard `/novo`, THE Sistema_Front SHALL manter o fluxo, os campos e o payload do wizard idênticos aos atuais.

### Requirement 10: Falha de seleção de material no primeiro salvamento

**User Story:** Como orçamentista, quero que uma falha ao gravar a escolha de material não feche o editor, para
corrigir a escolha sem reabrir o item.

#### Acceptance Criteria

1. IF a gravação de uma ou mais Selecao_Material falhar (a API responder erro ou não responder em até 30 segundos) no passe de seleções executado logo após o Editor criar o item no primeiro salvamento, ou em uma retentativa, THEN THE Editor SHALL permanecer aberto, manter o formulário com os valores preenchidos e NOT executar o passe de recálculo.
2. WHEN uma Selecao_Material não é gravada, THE Editor SHALL exibir, para cada uma, o nome da atividade afetada e a `message` devolvida pela API (ou aviso legível de tempo esgotado), e SHALL marcar a escolha com o indicador "não gravada" até que ela seja gravada ou removida.
3. WHEN a criação do item devolveu um `id`, THE Editor SHALL passar a operar em modo de edição desse `id`, e qualquer novo "Salvar" ou "Tentar novamente" SHALL atualizar esse item e NOT criar outro, mantendo o orçamento com o mesmo número de itens após qualquer quantidade de retentativas.
4. WHILE existir ao menos uma Selecao_Material marcada como "não gravada", THE Editor SHALL exibir o botão "Tentar novamente" e SHALL permitir alterar ou remover a escolha antes de repetir.
5. WHEN o usuário aciona "Tentar novamente", THE Editor SHALL regravar somente as Selecao_Material marcadas como "não gravada" e NOT reenviar as já gravadas.
6. WHEN todas as Selecao_Material do item estão gravadas, na primeira tentativa ou em retentativa, THE Editor SHALL executar o passe de recálculo e fechar normalmente, como hoje.
7. IF o usuário tentar fechar o Editor com ao menos uma Selecao_Material "não gravada", THEN THE Editor SHALL exibir confirmação informando que o item foi salvo e quantas escolhas não foram gravadas. Cancelar SHALL manter o Editor aberto. Confirmar SHALL fechá-lo sem excluir o item salvo.
8. WHERE o item não tem Selecao_Material, THE Editor SHALL manter fluxo, payloads e fechamento idênticos aos atuais.

### Requirement 11: Limite de 100 acabamentos carregados

**User Story:** Como orçamentista, quero que toda atividade do catálogo apareça, mesmo que a empresa tenha
mais de 100 acabamentos, para não perder opção sem perceber.

#### Acceptance Criteria

1. WHEN o Editor carrega os acabamentos, THE Sistema_Front SHALL solicitar páginas de 100 registros, em sequência, até receber uma página com menos de 100 registros ou o total informado pela API ser atingido, de modo que a lista do Editor contenha 100% dos acabamentos ativos da empresa.
2. THE `design.md` SHALL registrar, a partir de consulta somente leitura, o número de acabamentos ativos da Carton Wega e a lista (código e nome) das atividades do Catalogo que ficam fora das primeiras 100 posições, ou a afirmação explícita de que nenhuma fica.
3. WHERE o item tem Produto_Grafico, THE Editor SHALL garantir que cada atividade devolvida pelo Catalogo exista na lista de acabamentos, buscando por id (uma requisição por atividade ausente) as que não vieram nas páginas carregadas.
4. IF o carregamento de qualquer página, ou a busca por id de uma atividade do Catalogo, falhar, THEN THE Editor SHALL exibir um aviso com a mensagem da API, informar que a lista de acabamentos pode estar incompleta, manter todos os Campo_Preenchido do item e os acabamentos já carregados, e oferecer a ação "Tentar novamente".
5. WHERE a empresa tem até 100 acabamentos ativos, THE carga SHALL fazer exatamente 1 requisição de listagem e nenhuma busca adicional por id, sem diferença de comportamento visível em relação ao atual.
6. THE Editor SHALL NOT exibir o mesmo acabamento duas vezes quando ele vier tanto da listagem paginada quanto da busca por id.
7. THE alteração SHALL NOT mudar o comportamento do wizard `/novo` nem do `ItemWizardModal`.

### Requirement 12: Não regressão e restrições do projeto

**User Story:** Como responsável técnico, quero provas de que nada do que funciona hoje mudou, para entregar sem risco.

#### Acceptance Criteria

1. THE Sistema_Back SHALL manter `ancorarCustoCalcgraf` e os arquivos do motor de cálculo sem nenhuma linha alterada (diff vazio nesses arquivos no conjunto de commits da fase), e a suíte `decomposicao-stc.service.test.ts` SHALL terminar com 0 testes falhando e o mesmo número de testes de antes da fase (14).
2. THE Item_Puxado SHALL manter, após qualquer sugestão, cópia ou Selecao_Material desta fase, os valores de `custoProducao`, `resultadoCalculo` e do consolidado do orçamento idênticos aos gravados antes da operação (comparação exata, sem tolerância de arredondamento).
3. THE Sistema_Back SHALL incluir `empresaId` explícito no `where` ou no `data` de 100% das consultas e gravações novas desta fase, e um teste de rota SHALL provar que um usuário de outra empresa recebe 404 ou resultado vazio, sem depender de `prismaScoped`.
4. IF uma alteração tocar `schema.prisma`, THEN o mesmo commit SHALL incluir a alteração equivalente em `prisma/migrate-prod.ts` com `IF NOT EXISTS`, e duas execuções seguidas de `migrate-prod.ts` SHALL terminar com código de saída 0 e sem criar objeto duplicado.
5. THE Sistema_Front SHALL NOT exibir as palavras "Calcgraf", "G-Print" ou "GPrint" em nenhum texto visível ao usuário (rótulos, tooltips, mensagens, avisos e placeholders), e uma busca textual por esses termos nos arquivos de tela alterados nesta fase SHALL retornar 0 ocorrências em strings exibidas.
6. THE Sistema_Front SHALL NOT exibir, em nenhuma tela desta fase, texto que indique que Ajustes de Produtividade, Quebras ou Limites de Montagem alteram preço, cálculo ou PCP, e o Sistema_Back SHALL NOT ler esses cadastros no motor nem em rota do PCP.
7. THE wizard `/novo` e o `ItemWizardModal` SHALL permanecer sem nenhuma linha alterada no diff da fase e SHALL NOT receber a prop `catalogo`.
8. WHERE o item não tem `produtoGraficoId`, THE Editor SHALL gerar payload de salvar e payload de cálculo com os mesmos campos e valores gerados antes da fase para o mesmo formulário (teste de comparação com payload de referência), com a única exceção do bloco de sugestão de rótulos de campos livres (Requirement 5).
9. WHEN um orçamento existente ou um Item_Puxado do acervo é aberto, calculado e salvo sem alteração pelo usuário, THE Sistema_Back SHALL devolver `custoProducao` e `valorTotalConsolidado` iguais, na segunda casa decimal, aos valores obtidos antes da fase para o mesmo orçamento (referência: cálculo 12992, `custoProducao` 5.192,05).
10. WHEN a regressão é executada, THE suíte do módulo `orcamento-grafico` (back) e os testes de `editor/` (front, com `--pool=threads`) SHALL terminar com 0 testes falhando e sem reduzir o número de testes existentes antes da fase.
11. WHEN uma execução em produção é necessária (Importador_Cadastros ou migração de dados), THE responsável SHALL apresentar o resultado de um `--dry-run` ao usuário e obter autorização explícita antes de executar, e toda consulta de investigação em produção SHALL ser somente leitura (apenas `SELECT`).

### Requirement 13: Interface, acessibilidade e mensagens

**User Story:** Como usuário, quero telas consistentes com as anteriores, para usar as novidades sem estranhar.

#### Acceptance Criteria

1. THE componentes novos do Sistema_Front SHALL usar somente tokens adaptativos do Mantine (`*-light`, `default`, `body`, `dimmed`) para fundo, borda e texto, e SHALL permanecer legíveis nos temas claro e escuro, sem cor fixa de fundo, ou seja, sem valor hexadecimal, `white`, `black` nem nível `-0` de paleta.
2. WHILE uma lista ou seletor novo (Tipo de Embalagem, suporte, material por atividade, rótulos de Campo_Livre) aguarda resposta da API, THE Sistema_Front SHALL exibir indicador de carregamento no próprio componente e SHALL manter o restante do Editor utilizável.
3. IF uma lista ou seletor novo receber resposta vazia, THEN THE Sistema_Front SHALL exibir texto de estado vazio que indique o que está faltando cadastrar.
4. IF a API falhar ao carregar uma lista ou seletor novo, THEN THE Sistema_Front SHALL exibir aviso de erro legível no próprio componente, SHALL manter os Campo_Preenchido do formulário e SHALL permitir nova tentativa sem recarregar a página.
5. WHEN o Editor exibe os avisos "sugerido pelo produto", "a verificar" e "tipo inativo", THE Sistema_Front SHALL apresentá-los como texto de tamanho `xs` ou `sm`, com ícone e tooltip explicativo, e SHALL NOT usar modal, notificação que exija clique para fechar nem bloqueio do botão Salvar.
6. IF o Sistema_Back responder com erro e `message`, THEN THE Sistema_Front SHALL exibir o texto de `message` como foi devolvido e SHALL NOT exibir nome de campo interno, objeto de validação nem stack trace.
7. IF o Sistema_Back responder com erro sem `message`, THEN THE Sistema_Front SHALL exibir uma mensagem genérica em português que informe que a operação falhou e peça para tentar novamente.
8. THE Sistema_Front SHALL NOT enviar `empresaId` no corpo, na query string nem em cabeçalho nas chamadas novas desta fase; o Sistema_Back SHALL obter a empresa da sessão autenticada.
9. THE seletores novos do Sistema_Front SHALL ter rótulo visível associado ao controle (propriedade `label` do componente Mantine) e SHALL ser operáveis só pelo teclado (Tab para focar; Enter ou setas para abrir e escolher; Esc para fechar), como os componentes Mantine usados nas Fases 1 e 2.
10. THE textos visíveis novos desta fase (rótulos, tooltips, mensagens, avisos e placeholders) SHALL estar em português do Brasil.

### Requirement 14: Verificação

**User Story:** Como responsável técnico, quero evidências automatizadas e uma conferência manual, para aprovar a entrega.

#### Acceptance Criteria

1. THE Sistema_Front SHALL ter ao menos um teste de unidade com Vitest para cada função pura nova: sugerir Tipo_Embalagem, sugerir suporte, gramatura e preço, mesclar rótulos e opções de Campo_Livre, montar formulário a partir do item. THE Sistema_Back SHALL ter o mesmo para a função pura que classifica o grupo de acondicionamento. Cada teste SHALL cobrir ao menos um caso de entrada vazia e um de entrada já preenchida.
2. FOR ALL item salvo e reaberto sem alteração, o payload devolvido pelo formulário SHALL ser igual ao do item salvo em cada Campo_Tecnico listado no Requirement 9.1. Um teste de propriedade com fast-check SHALL verificar isso com no mínimo 100 execuções geradas.
3. FOR ALL entrada com Campo_Preenchido, aplicar a Sugestao SHALL manter o valor preenchido. Aplicar a Sugestao duas vezes SHALL produzir o mesmo resultado que aplicá-la uma vez. Testes de propriedade com fast-check, no mínimo 100 execuções cada, SHALL verificar a invariante e a idempotência.
4. THE Sistema_Back SHALL ter testes de rota com Prisma mockado que cubram: (a) gravar o Vinculo_Embalagem, com resposta de sucesso e valor devolvido na leitura do produto; (b) limpar o Vinculo_Embalagem; (c) Tipo_Embalagem inexistente na empresa, com resposta 422 e nenhuma gravação; (d) cópia de `produtoGraficoId` e `tipoPlanoId` em `reaproveitar` e em `de-calculo`; (e) id de origem de outra empresa, com o item criado sem o campo e sem falha na criação do orçamento; (f) id de origem inexistente, com o mesmo resultado do item (e); (g) isolamento por `empresaId`, com asserção de que toda consulta e gravação recebe `empresaId` explícito.
5. WHEN a verificação de regressão é executada, THEN a suíte do módulo `orcamento-grafico` (back) e os testes de `editor/` (front, com `--pool=threads`) SHALL terminar com 0 testes falhando, e `decomposicao-stc.service.test.ts` SHALL continuar com 14 de 14 testes passando.
6. THE verificação SHALL rodar `get_diagnostics` em cada arquivo tocado e SHALL terminar com 0 erros nesses arquivos. THE verificação SHALL NOT executar `tsc` inteiro nem `next build`.
7. WHERE a alteração toca `schema.prisma`, THE verificação SHALL executar `npx tsx prisma/migrate-prod.ts` duas vezes seguidas contra o banco local, sem erro e sem alteração de dados na segunda execução.
8. THE conferência manual SHALL ser registrada como lista de verificação com resultado aprovado ou reprovado por item, e SHALL cobrir os oito cenários seguintes: (a) item sem Produto_Grafico: editor, payload e valores iguais aos de antes desta fase; (b) produto com Vinculo_Embalagem e campo Tipo de Embalagem vazio: o tipo é sugerido, com o indicativo "sugerido pelo produto", e com o campo preenchido o valor do usuário é mantido; (c) produto sem Vinculo_Embalagem: o campo Tipo de Embalagem se comporta como hoje; (d) Item_Puxado: nenhuma sugestão é aplicada e o custo de produção permanece igual ao do acervo (ex.: cálculo 12992 = R$ 5.192,05 ao abrir, editar e salvar); (e) Cartucho Composto: "Caixa Padrão" e "Embalar" aparecem no grupo "Acondicionamento" e não em "Atividades"; (f) produto sem Plano_Fixo e com vários Tipo_Plano: o material por atividade é escolhido no modal de plano e a Selecao_Material é gravada; (g) Campo_Livre do tipo LISTA: as opções são oferecidas e o par `{ rotulo, conteudo }` é gravado em `camposLivres`; (h) falha forçada de Selecao_Material no primeiro salvamento: o editor permanece aberto e exibe a mensagem da API, e "Tentar novamente" não cria um segundo item.
9. THE entrega SHALL ser considerada aprovada somente quando os critérios 1 a 6 estiverem atendidos, o critério 7 estiver atendido quando aplicável, e os oito cenários do critério 8 estiverem registrados como aprovados.

## Pontos a verificar o funcionamento exato (não bloqueiam os requisitos)

- Opção A ou B para o Vinculo_Embalagem (decisão do design, depende de aprovação).
- Existência de dado de tipo de embalagem por produto no export do legado (`CadastrosOrcamento.json`) para preencher o vínculo na importação.
- Casamento de suporte e gramatura padrão do plano com o cadastro de preços de papel (`PrecoMateriaPrima`): pode haver duplicatas de papel com e sem gramatura (já registradas no steering), o que gera ambiguidade e deixa o preço em branco.
- Se o `CalculoGrafico` e os planos do acervo têm `produtoGraficoId` e `tipoPlanoId` (o schema atual mostra esses campos só no item e no plano do orçamento).
- Quais proprietários de Campo_Livre entram na sugestão do item (SOLICITACAO e PEDIDO, a confirmar).
- Causa real do acondicionamento: relação não importada, tipo de relação diferente, ou classificação do catálogo.
- Se os ids de restrição do catálogo e do cadastro coincidem (pendência herdada da Fase 2, seção 19 do handoff).
- Fórmulas dos TipoParam 2 e 3 e o mapa provisório por `tipoMaterial`: seguem informativos.
- Os números de referência do Requirement 12 e 14 (14 testes de decomposição, cálculo 12992 com `custoProducao` 5.192,05) vêm do steering do projeto e devem ser reconfirmados antes da aprovação.
- A função pura que classifica o grupo de acondicionamento pode ficar no back (Catalogo) ou no front; o local é definido no design.

## Dependências

- Fase 2 no ar (back com `produtoGraficoId`, `tipoPlanoId`, `materiaisAcabamento` no `GET /:id` e `DELETE /selecao-material`; front com o Editor do catálogo). A conferência manual da Fase 2 (tarefa 5.2) deveria ocorrer antes do deploy desta fase.
- Aprovação do usuário para a decisão do Vinculo_Embalagem e para qualquer coluna nova.
- Autorização explícita e dry-run revisado para toda execução em produção.
- Deploy do back (Render) antes do front usar campos novos.
