# Requirements Document

## Introduction

Esta feature adiciona ao Vizor a **Hierarquia Mercadológica** de produtos — uma
classificação comercial em quatro níveis fixos e encadeados (Departamento → Seção →
Categoria → Subcategoria/Família), com código hierárquico gerado automaticamente
(ex.: `01`, `01.02`, `01.02.04`, `01.02.04.001`). Cada produto é vinculado ao nível
folha (Subcategoria/Família), e os níveis pais são derivados subindo a árvore.

> **Nota de atualização (pós-entrega):** o modelo foi reduzido de 5 para **4
> níveis de agrupamento**, seguindo o padrão de mercado (SAP Retail + GS1 GPC):
> a árvore tem Departamento → Seção → Categoria → Subcategoria (folha). O
> "nível 5" original (código do produto/SKU) **não é um nó da árvore** — é o
> próprio código do produto. A folha (Subcategoria, também chamada
> "Subcategoria/Família") usa 3 dígitos e é o nível ao qual o produto se
> vincula via `Produto.familiaId`. Os textos abaixo foram ajustados para 4
> níveis.

Hoje o cadastro de produto tem apenas os campos soltos `familia` e `subFamilia`
(texto livre), sem estrutura, sem códigos e sem cadastros próprios. O relatório de
validação cadastral do cliente pede exatamente essa árvore para organizar "o que o
produto é comercialmente".

O escopo desta entrega é o **cadastro e o vínculo** da hierarquia. Relatórios,
filtros analíticos por nível e migração automática dos campos `familia`/`subFamilia`
legados ficam fora do escopo inicial (podem virar fase seguinte).

Decisão de modelagem confirmada: **níveis fixos encadeados (4 níveis)**. Decisão
de vínculo: **o produto aponta para o nível folha (Subcategoria/Família)**; os
níveis superiores são derivados pela árvore, evitando redundância.

## Glossary

- **Hierarquia Mercadológica**: classificação comercial do produto em 4 níveis fixos.
- **Nível**: cada camada da hierarquia — Departamento (1), Seção (2), Categoria (3), Subcategoria/Família (4, folha).
- **Nível pai / filho**: relação de encadeamento; cada nível (exceto Departamento) referencia exatamente um pai do nível imediatamente acima.
- **Nível folha**: o nível mais baixo ao qual um produto pode ser vinculado (Subcategoria/Família).
- **Código hierárquico**: identificador composto pelos códigos dos ancestrais + o próprio (ex.: `01.02.04.001`).
- **Código do segmento**: o código local do nível dentro do seu pai (ex.: `04` dentro de `01.02`).

## Requirements

### Requirement 1: Cadastro de níveis encadeados

**User Story:** Como administrador de cadastros, quero cadastrar os níveis da
hierarquia mercadológica de forma encadeada, para organizar comercialmente os
produtos da empresa.

#### Acceptance Criteria

1. WHERE o usuário está no cadastro de hierarquia THEN o sistema SHALL permitir criar, editar, ativar/inativar e listar níveis dos tipos Departamento, Seção, Categoria e Subcategoria/Família.
2. WHEN um nível diferente de Departamento é criado THEN o sistema SHALL exigir a referência a exatamente um nível pai do tipo imediatamente superior (Seção→Departamento, Categoria→Seção, Subcategoria→Categoria).
3. WHEN um Departamento é criado THEN o sistema SHALL NOT exigir nível pai.
4. WHEN um nível é criado ou editado THEN o sistema SHALL exigir um código de segmento e uma descrição.
5. WHERE dois níveis compartilham o mesmo pai THEN o sistema SHALL impedir códigos de segmento duplicados entre eles na mesma empresa.
6. THE sistema SHALL manter todos os níveis da hierarquia escopados por empresa como invariante permanente (isolamento multi-tenant), independentemente de qualquer ação de consulta.

### Requirement 2: Geração do código hierárquico

**User Story:** Como usuário de cadastros, quero que o código hierárquico completo
seja montado automaticamente, para padronizar a identificação sem digitação manual
propensa a erro.

#### Acceptance Criteria

1. WHEN um nível é criado THEN o sistema SHALL compor o código hierárquico concatenando o código hierárquico do pai com o código de segmento do próprio nível, separados por ponto (ex.: pai `01.02` + segmento `04` → `01.02.04`).
2. WHERE o nível é um Departamento THEN o sistema SHALL usar o próprio código de segmento como código hierárquico (ex.: `01`).
3. WHEN o código de segmento é informado THEN o sistema SHALL aplicar sempre uma regra de largura de dígitos aplicável ao nível (2 dígitos para Departamento/Seção/Categoria e 3 dígitos para Subcategoria/Família, o nível folha), preservando zeros à esquerda; nenhum código de segmento é aceito sem uma regra de largura ativa para o seu nível.
4. IF o código hierárquico resultante colidir com outro nível existente na mesma empresa THEN o sistema SHALL rejeitar a operação com mensagem clara.

### Requirement 3: Vínculo do produto à hierarquia

**User Story:** Como cadastrador de produtos, quero associar um produto à sua
Subcategoria/Família na hierarquia, navegando a árvore em cascata, para que o
produto herde toda a classificação comercial.

#### Acceptance Criteria

1. WHERE o cadastro de produto está aberto THEN o sistema SHALL permitir selecionar o nível folha (Subcategoria/Família) ao qual o produto pertence, de forma opcional, por meio de uma cascata guiada (Departamento → Seção → Categoria → Subcategoria/Família).
2. WHEN um produto é vinculado a uma Subcategoria/Família THEN o sistema SHALL derivar e disponibilizar os níveis superiores (Categoria, Seção, Departamento) a partir da árvore, sem exigir seleção manual de cada um ao reabrir o produto.
3. IF a Subcategoria/Família selecionada não existir, não for do tipo folha (SUBCATEGORIA) ou pertencer a outra empresa THEN o sistema SHALL rejeitar o vínculo — tanto na criação (POST) quanto na edição (PUT) do produto.
4. WHEN um produto sem hierarquia é salvo THEN o sistema SHALL permitir a gravação (vínculo é opcional), preservando a compatibilidade com produtos já existentes.
5. WHEN a hierarquia de um produto COM Subcategoria/Família vinculada é exibida THEN o sistema SHALL apresentar a cascata preenchida e o código hierárquico da folha.
6. WHEN a hierarquia de um produto SEM Subcategoria/Família vinculada é exibida THEN o sistema SHALL exibir uma mensagem explícita indicando a ausência de hierarquia, sem caminho ou código parcial.

### Requirement 4: Integridade e proteção de exclusão

**User Story:** Como administrador, quero que a exclusão de um nível não deixe
produtos ou níveis filhos órfãos, para manter a integridade da classificação.

#### Acceptance Criteria

1. IF um nível possui níveis filhos THEN o sistema SHALL impedir sua exclusão, orientando inativar em vez de excluir.
2. IF um nível folha (Subcategoria/Família) está vinculado a um ou mais produtos THEN o sistema SHALL impedir sua exclusão.
3. WHEN um nível é inativado THEN o sistema SHALL mantê-lo no histórico e nos vínculos existentes, ocultando-o apenas para novas seleções.
4. WHEN qualquer operação de escrita na hierarquia é feita THEN o sistema SHALL restringir a criação/edição/exclusão a perfis administrativos (ADMIN/SUPER_ADMIN), enquanto a leitura fica disponível aos demais usuários.

### Requirement 5: Persistência e migração

**User Story:** Como responsável técnico, quero que a estrutura seja persistida de
forma consistente entre desenvolvimento e produção, para evitar dessincronia de banco.

#### Acceptance Criteria

1. WHEN a estrutura de dados da hierarquia é introduzida THEN o sistema SHALL criar as tabelas/campos necessários via migração idempotente aplicada tanto em desenvolvimento quanto em produção, conforme o processo obrigatório de migrations do projeto.
2. WHERE existem os campos legados `familia`/`subFamilia` (texto livre) no produto THEN o sistema SHALL preservá-los inalterados nesta entrega, sem migração automática de dados (tratada em fase posterior).
3. WHEN a migração é executada mais de uma vez THEN o sistema SHALL ser idempotente, sem falhar nem duplicar estruturas.

### Requirement 6: Disponibilidade da tela nos módulos (WMS e Compras)

**User Story:** Como usuário de Compras, quero acessar a Hierarquia
Mercadológica sem sair do meu módulo, para não ser levado ao WMS e perder o
contexto/menu de Compras.

#### Acceptance Criteria

1. THE sistema SHALL disponibilizar a tela de gerenciamento da hierarquia tanto no módulo WMS quanto no módulo Compras, com a mesma funcionalidade (a UI é um componente compartilhado, sem duplicação de lógica).
2. WHEN o usuário acessa a hierarquia pelo menu do módulo Compras THEN o sistema SHALL manter o contexto e a barra lateral do Compras (rota própria `/compras/hierarquia`), sem trocar para o contexto do WMS.
3. WHEN o usuário acessa a hierarquia pelo menu do módulo WMS THEN o sistema SHALL manter o contexto do WMS (rota `/configurador/hierarquia`).
4. THE sistema SHALL liberar o acesso à tela se a empresa possuir QUALQUER um dos módulos WMS ou Compras (guard por lista de módulos permitidos).
