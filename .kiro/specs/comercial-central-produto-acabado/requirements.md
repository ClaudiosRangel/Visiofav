# Requirements Document

## Introduction

A **Central de Consulta do Produto/Acabado** é uma tela de busca única que
consolida, num só lugar, todas as informações de um produto/embalagem da Carton
Wega a partir de duas chaves de entrada: o **Código de Acabado** (o número
"Cód. Acabado" do cabeçalho da OP do GPrint/Calcgraf) **ou** o **nome/descrição**
do produto. A partir de um resultado, o usuário vê a identificação, a arte
(imagem), a ficha técnica (medidas e atributos gráficos), o histórico de Ordens
de Produção já abertas no produto e os cálculos/orçamentos gráficos já feitos — e
pode **alterar** os campos cadastrais do produto (nome, vínculos de código de
acabado, imagem/arte e ficha técnica) diretamente na tela.

A feature nasce do pedido do cliente Caio (Carton Wega), Ponto 3 do documento-mestre
`docs/PROJETO-MODULO-COMERCIAL.md` (seção 19.3). O escopo reutiliza dados que **já
existem** no Vizor (não mexe na base restaurada do Calcgraf): o vínculo
código acabado ↔ produto é o `DeParaImportacao` (tipo `PRODUTO`, origem `GPRINT`),
a engenharia/arte/medidas de cálculo vêm do `CalculoGrafico` (campo `siglaAcabado`
e demais campos migrados do Calcgraf), e o histórico produtivo vem de
`OrdemProducao` (inclusive OPs cujo `produtoId` é nulo, casando pela tag
`[Produto]` em `observacoes`).

A tela é majoritariamente de **leitura** mais **edição de cadastro já existente**.
Histórico de OPs e cálculos são **somente leitura** (fatos passados). A mesma tela
é acessível a partir de **dois módulos** (Comercial e PCP). Backend
(`VisioFab.Wms.Back`) e frontend (`VisioFab.Wms.Front`) são repositórios separados;
os requisitos valem para os dois.

## Glossary

- **Central_Produto_Acabado**: A funcionalidade (backend + frontend) descrita neste
  documento — a tela de busca única e consolidação/edição de informações de
  produto/acabado.
- **Cód_Acabado** (Código de Acabado): O identificador numérico "Cód. Acabado" que
  aparece no cabeçalho da OP do GPrint/Calcgraf (ex.: OP 3.070 da NATIVITA com os
  acabados 4294, 4297, 4298). Um produto/embalagem pode ter **vários** códigos de
  acabado. É persistido no Vizor em dois lugares complementares:
  (a) `DeParaImportacao` (`tipoEntidade='PRODUTO'`, `sistemaOrigem='GPRINT'`,
  `codigoExterno` = o código de acabado), que liga o código ao `Produto` cadastrado;
  e (b) `CalculoGrafico.siglaAcabado` (acervo Calcgraf migrado), que carrega a
  engenharia do cálculo.
- **Produto**: A entidade `Produto` do schema (`prisma/schema.prisma`). Campos
  relevantes: `id`, `empresaId`, `codigo`, `descricao`, `imagemUrl` (arte, base64
  data URL ou URL), `clienteId`, `status`.
- **CalculoGrafico**: A entidade `CalculoGrafico` (biblioteca de cálculos/acervo
  migrado do Calcgraf). Carrega engenharia (papel, cores, medidas, aproveitamento,
  formato) e o campo `siglaAcabado` (origem = `CalculoAcabados.CodAcabado`).
- **DeParaImportacao**: A entidade de mapeamento "de/para" entre códigos de sistemas
  externos e entidades internas. Para esta feature, o registro com
  `tipoEntidade='PRODUTO'` e `sistemaOrigem='GPRINT'` liga um Cód_Acabado
  (`codigoExterno`) a um `Produto` (`entidadeId`).
- **OrdemProducao**: A entidade `OrdemProducao` (módulo PCP). O histórico de OPs já
  abertas no produto. Pode ter `produtoId` nulo em OPs importadas, caso em que o
  nome do produto fica na tag `[Produto]` do campo `observacoes`.
- **ItemOrcamentoGrafico**: Item de orçamento gráfico vinculado a um cálculo —
  usado, junto com `CalculoGrafico`, para listar cálculos/orçamentos já feitos.
- **Ficha_Tecnica**: O conjunto de atributos gráficos e de embalagem do produto —
  tipo de embalagem, cartão/suporte, gramatura, cores, formato — obtidos do
  `AtributoGrafico`/`TipoEmbalagem` do `Produto` e/ou da engenharia do
  `CalculoGrafico`.
- **Arte**: A imagem do produto. Fonte primária: `Produto.imagemUrl` (base64 data
  URL ou URL). Fonte complementar: imagem associada ao `CalculoGrafico`, quando
  existir.
- **Usuario**: O usuário autenticado que opera a Central_Produto_Acabado.
- **Permissao_Edicao**: A autorização que habilita a alteração de campos cadastrais,
  avaliada pela permissão do Comercial (flag `podeEditarCadastros` no `Parametro`
  `comercial.permissoes.<usuarioId>`) e/ou do PCP, com bypass para perfil ADMIN.
- **EmpresaId**: O identificador da empresa (tenant) a que uma entidade pertence.
  Base do isolamento multi-tenant.

## Requirements

### Requirement 1: Busca por Código de Acabado

**User Story:** Como usuário do Comercial ou do PCP, quero pesquisar pelo código de
acabado de um produto, para encontrar rapidamente todas as informações consolidadas
daquele produto/embalagem.

#### Acceptance Criteria

1. WHEN o Usuario submete um termo de busca com no mínimo 2 caracteres (após remoção
   de espaços no início e no fim) que corresponde total ou parcialmente a um
   Cód_Acabado, THE Central_Produto_Acabado SHALL retornar, em no máximo 3 segundos,
   o(s) Produto(s) vinculado(s) a esse Cód_Acabado por meio de DeParaImportacao
   (`tipoEntidade='PRODUTO'`, `sistemaOrigem='GPRINT'`), limitado a no máximo 100
   resultados por consulta.
2. THE Central_Produto_Acabado SHALL tratar o termo de busca por Cód_Acabado de forma
   case-insensitive e permitir correspondência parcial de substring em qualquer
   posição do Cód_Acabado.
3. WHEN o termo de busca corresponde a um Cód_Acabado presente em CalculoGrafico
   (`siglaAcabado`) sem registro correspondente em DeParaImportacao
   (`tipoEntidade='PRODUTO'`, `sistemaOrigem='GPRINT'`),
   THE Central_Produto_Acabado SHALL retornar o resultado a partir do CalculoGrafico,
   incluindo no resultado um indicador explícito de que não há Produto cadastrado
   vinculado.
4. IF nenhum Produto nem CalculoGrafico corresponde ao Cód_Acabado pesquisado,
   THEN THE Central_Produto_Acabado SHALL retornar uma coleção de resultados vazia
   acompanhada de um indicador explícito de "nenhum resultado encontrado".
5. IF o termo de busca, após remoção de espaços no início e no fim, possui menos de
   2 caracteres ou está vazio, THEN THE Central_Produto_Acabado SHALL rejeitar a
   consulta sem executar a busca e retornar um indicador de validação informando o
   comprimento mínimo exigido.

### Requirement 2: Busca por Nome do Produto

**User Story:** Como usuário do Comercial ou do PCP, quero pesquisar pelo nome do
produto, para encontrar o produto mesmo quando não sei o código de acabado.

#### Acceptance Criteria

1. WHEN o Usuario submete um termo de busca que corresponde total ou parcialmente ao
   `codigo` ou à `descricao` de um Produto, THE Central_Produto_Acabado SHALL retornar
   o(s) Produto(s) correspondente(s).
2. THE Central_Produto_Acabado SHALL tratar o termo de busca por nome de forma
   case-insensitive e permitir correspondência parcial.
3. WHEN o termo de busca corresponde ao nome de produto registrado na tag `[Produto]`
   de `OrdemProducao.observacoes` de OPs cujo `produtoId` é nulo,
   THE Central_Produto_Acabado SHALL incluir esse produto nos resultados, agrupando as
   OPs correspondentes.
4. THE Central_Produto_Acabado SHALL executar uma busca única que aceita o mesmo termo
   como Cód_Acabado ou como nome, retornando a união dos resultados sem exigir que o
   Usuario escolha previamente o tipo de chave.

### Requirement 3: Agrupamento e resolução de múltiplos resultados

**User Story:** Como usuário, quero que os resultados sejam agrupados de forma
coerente, para entender quando um produto tem vários códigos de acabado e quando um
código pertence a um produto específico.

#### Acceptance Criteria

1. WHEN um Produto possui mais de um Cód_Acabado vinculado,
   THE Central_Produto_Acabado SHALL exibir todos os Cód_Acabado associados ao mesmo
   Produto num único agrupamento de resultado, sem repetir o Produto em agrupamentos
   distintos.
2. WHEN um Cód_Acabado pertence a um Produto cadastrado,
   THE Central_Produto_Acabado SHALL associar o resultado do Cód_Acabado ao
   agrupamento do Produto correspondente.
3. WHEN a busca retorna mais de um Produto distinto,
   THE Central_Produto_Acabado SHALL apresentar a lista de resultados em ordem
   determinística (mesma entrada produz a mesma ordem), permitindo que o Usuario
   selecione um Produto para ver o detalhe consolidado.
4. WHEN a busca retorna exatamente um Produto,
   THE Central_Produto_Acabado SHALL apresentar diretamente o detalhe consolidado desse
   Produto, sem exigir seleção adicional do Usuario.
5. IF a busca não retorna nenhum Produto nem Cód_Acabado,
   THEN THE Central_Produto_Acabado SHALL apresentar uma mensagem de "nenhum resultado
   encontrado", preservar o termo de busca informado e não apresentar agrupamentos.

### Requirement 4: Bloco de Identificação

**User Story:** Como usuário, quero ver a identificação do produto, para confirmar que
estou olhando o item certo.

#### Acceptance Criteria

1. WHEN o detalhe consolidado de um Produto é apresentado,
   THE Central_Produto_Acabado SHALL exibir o(s) Cód_Acabado associado(s), o `codigo` e
   a `descricao` do Produto.
2. WHERE o Produto possui `clienteId` preenchido,
   THE Central_Produto_Acabado SHALL exibir o nome do cliente associado.
3. WHERE o detalhe vem de um CalculoGrafico sem Produto cadastrado,
   THE Central_Produto_Acabado SHALL exibir a identificação disponível no
   CalculoGrafico (`siglaAcabado`, descrição e cliente, quando houver).

### Requirement 5: Bloco de Arte

**User Story:** Como usuário, quero ver a arte do produto, para validar visualmente a
embalagem.

#### Acceptance Criteria

1. WHERE o Produto possui `imagemUrl` preenchido,
   THE Central_Produto_Acabado SHALL exibir a Arte a partir de `Produto.imagemUrl`.
2. WHERE o Produto não possui `imagemUrl` e existe imagem associada ao CalculoGrafico,
   THE Central_Produto_Acabado SHALL exibir a imagem do CalculoGrafico como Arte.
3. IF não há Arte disponível no Produto nem no CalculoGrafico,
   THEN THE Central_Produto_Acabado SHALL exibir um indicador de "sem arte cadastrada".

### Requirement 6: Bloco de Ficha Técnica

**User Story:** Como usuário, quero ver a ficha técnica do produto, para conhecer as
especificações da embalagem.

#### Acceptance Criteria

1. WHERE o Produto possui AtributoGrafico ou TipoEmbalagem associado,
   THE Central_Produto_Acabado SHALL exibir a Ficha_Tecnica com tipo de embalagem,
   cartão/suporte, gramatura, cores e formato disponíveis.
2. WHERE há um CalculoGrafico correspondente ao produto/Cód_Acabado,
   THE Central_Produto_Acabado SHALL exibir as medidas e demais dados de engenharia do
   CalculoGrafico como parte da Ficha_Tecnica.
3. IF não há AtributoGrafico, TipoEmbalagem nem CalculoGrafico com dados de ficha,
   THEN THE Central_Produto_Acabado SHALL exibir um indicador de "ficha técnica não
   cadastrada".

### Requirement 7: Bloco de Histórico de Ordens de Produção (somente leitura)

**User Story:** Como usuário, quero ver as OPs já abertas no produto, para conhecer o
histórico de produção.

#### Acceptance Criteria

1. WHEN o detalhe consolidado de um Produto é apresentado,
   THE Central_Produto_Acabado SHALL listar as OrdemProducao vinculadas por `produtoId`.
2. THE Central_Produto_Acabado SHALL incluir, no histórico de OPs, as OrdemProducao
   cujo `produtoId` é nulo quando o nome na tag `[Produto]` de `observacoes` corresponde
   ao Produto apresentado.
3. THE Central_Produto_Acabado SHALL apresentar o histórico de OrdemProducao em modo
   somente leitura, sem permitir alteração a partir desta tela.
4. WHERE um Cód_Acabado é usado como chave de busca,
   THE Central_Produto_Acabado SHALL permitir que o histórico de OPs seja associado ao
   Cód_Acabado correspondente ao Produto.

### Requirement 8: Bloco de Cálculos e Orçamentos (somente leitura)

**User Story:** Como usuário, quero ver os cálculos e orçamentos já feitos no produto,
para consultar o histórico comercial/engenharia.

#### Acceptance Criteria

1. WHEN o detalhe consolidado de um Produto é apresentado,
   THE Central_Produto_Acabado SHALL listar os CalculoGrafico correspondentes ao
   Produto ou ao(s) Cód_Acabado apresentado(s).
2. WHERE existem ItemOrcamentoGrafico vinculados aos CalculoGrafico correspondentes,
   THE Central_Produto_Acabado SHALL listar esses itens de orçamento.
3. THE Central_Produto_Acabado SHALL apresentar os cálculos e orçamentos em modo
   somente leitura, sem permitir alteração a partir desta tela.
4. IF não há CalculoGrafico nem ItemOrcamentoGrafico correspondente,
   THEN THE Central_Produto_Acabado SHALL exibir um indicador de "sem cálculos
   registrados".

### Requirement 9: Edição e persistência dos campos cadastrais

**User Story:** Como usuário autorizado, quero alterar os campos cadastrais do produto
na própria tela, para manter as informações atualizadas sem navegar para outro
cadastro.

#### Acceptance Criteria

1. WHILE o Usuario possui Permissao_Edicao,
   THE Central_Produto_Acabado SHALL permitir alterar o nome/`descricao` do Produto
   (texto de 1 a 200 caracteres), a Arte (`imagemUrl`, de 1 a 500 caracteres) e a
   Ficha_Tecnica (atributos gráficos) do Produto.
2. WHILE o Usuario possui Permissao_Edicao,
   THE Central_Produto_Acabado SHALL permitir adicionar e remover vínculos de
   Cód_Acabado do Produto, alterando os registros DeParaImportacao
   (`tipoEntidade='PRODUTO'`, `sistemaOrigem='GPRINT'`).
3. WHEN o Usuario confirma uma alteração de campo cadastral,
   THE Central_Produto_Acabado SHALL persistir a alteração na entidade correspondente
   (`Produto`, `AtributoGrafico` ou `DeParaImportacao`) dentro de uma única transação
   e confirmar o sucesso ao Usuario em no máximo 5 segundos.
4. THE Central_Produto_Acabado SHALL restringir a edição aos campos cadastrais do
   Produto, do AtributoGrafico e do vínculo DeParaImportacao, sem alterar OrdemProducao,
   CalculoGrafico nem ItemOrcamentoGrafico.
5. IF a persistência de uma alteração falha,
   THEN THE Central_Produto_Acabado SHALL reverter a transação preservando
   integralmente o valor anterior e informar ao Usuario uma mensagem de erro indicando
   a falha da operação.
6. IF o Usuario não possui Permissao_Edicao,
   THEN THE Central_Produto_Acabado SHALL rejeitar a alteração, preservar o valor
   anterior e informar ao Usuario uma mensagem de erro indicando ausência de permissão.
7. IF uma alteração de campo cadastral viola as regras de validação (campo obrigatório
   vazio, tamanho fora do limite ou vínculo Cód_Acabado duplicado),
   THEN THE Central_Produto_Acabado SHALL rejeitar a alteração, preservar o valor
   anterior e informar ao Usuario uma mensagem de erro indicando o campo e o motivo da
   rejeição.

### Requirement 10: Controle de permissão de edição

**User Story:** Como administrador, quero que apenas usuários autorizados possam
alterar os cadastros, para proteger a integridade dos dados.

#### Acceptance Criteria

1. WHILE o Usuario não possui Permissao_Edicao,
   THE Central_Produto_Acabado SHALL permitir a consulta consolidada e SHALL apresentar
   os campos cadastrais em modo somente leitura.
2. IF o Usuario sem Permissao_Edicao tenta persistir uma alteração de campo cadastral,
   THEN THE Central_Produto_Acabado SHALL rejeitar a operação e retornar um erro de
   autorização.
3. WHERE o Usuario possui perfil ADMIN,
   THE Central_Produto_Acabado SHALL conceder Permissao_Edicao independentemente da flag
   `podeEditarCadastros`.
4. THE Central_Produto_Acabado SHALL avaliar a Permissao_Edicao a partir da flag
   `podeEditarCadastros` no `Parametro` `comercial.permissoes.<usuarioId>` e/ou do
   controle de permissões do PCP.

### Requirement 11: Isolamento multi-tenant

**User Story:** Como operador de uma empresa, quero ver e alterar apenas dados da minha
empresa, para que informações não vazem entre empresas.

#### Acceptance Criteria

1. THE Central_Produto_Acabado SHALL filtrar toda consulta de Produto, DeParaImportacao,
   CalculoGrafico, OrdemProducao, AtributoGrafico e ItemOrcamentoGrafico pelo EmpresaId
   explícito da entidade real, sem depender apenas do mecanismo `prismaScoped`.
2. IF o Usuario possui perfil SUPER_ADMIN,
   THEN THE Central_Produto_Acabado SHALL ainda aplicar o filtro explícito por EmpresaId
   da empresa selecionada na sessão, sem retornar dados de outras empresas.
3. WHEN um Cód_Acabado ou nome de produto idêntico existe em mais de uma empresa,
   THE Central_Produto_Acabado SHALL retornar somente os resultados da empresa do
   Usuario.
4. WHEN o Usuario confirma uma alteração de campo cadastral,
   THE Central_Produto_Acabado SHALL gravar e validar o EmpresaId da entidade real
   (Produto, AtributoGrafico ou DeParaImportacao), rejeitando a operação quando a
   entidade pertence a outra empresa.

### Requirement 12: Acesso a partir de dois módulos (Comercial e PCP)

**User Story:** Como usuário, quero acessar a mesma Central a partir do menu do
Comercial e do menu do PCP, para não depender de um único módulo.

#### Acceptance Criteria

1. THE Central_Produto_Acabado SHALL ser acessível a partir do menu do módulo Comercial.
2. THE Central_Produto_Acabado SHALL ser acessível a partir do menu do módulo PCP.
3. THE Central_Produto_Acabado SHALL reutilizar a mesma tela/rota em ambos os módulos,
   apresentando o mesmo conjunto de informações consolidadas.

### Requirement 13: Não-regressão sobre fluxos existentes

**User Story:** Como mantenedor do sistema, quero que a Central não altere o motor de
cálculo nem a importação de OP, para não introduzir regressões.

#### Acceptance Criteria

1. THE Central_Produto_Acabado SHALL operar sem alterar o motor de cálculo do orçamento
   gráfico.
2. THE Central_Produto_Acabado SHALL operar sem alterar o fluxo de importação de OP
   (PDF e agente Calcgraf).
3. WHERE a Central requer uma alteração de schema,
   THE Central_Produto_Acabado SHALL preferir reutilizar as entidades existentes
   (`DeParaImportacao`, `CalculoGrafico.siglaAcabado`) antes de introduzir nova
   estrutura.
4. IF uma alteração de schema for necessária,
   THEN THE Central_Produto_Acabado SHALL incluir a atualização correspondente em
   `prisma/schema.prisma` e `prisma/migrate-prod.ts` de forma idempotente, no mesmo
   commit.
