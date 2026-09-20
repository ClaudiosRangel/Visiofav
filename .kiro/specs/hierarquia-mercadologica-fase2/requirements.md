# Requirements Document

## Introduction

Esta é a **Fase 2** da Hierarquia Mercadológica do Vizor. A Fase 1
(`.kiro/specs/hierarquia-mercadologica`, em produção) entregou o cadastro e o
vínculo: o model `NivelMercadologico` (tabela `nivel_mercadologico`,
auto-referenciada), os 4 níveis fixos encadeados
(Departamento → Seção → Categoria → Subcategoria/Família, sendo a folha a
Subcategoria/Família com código de 3 dígitos), o CRUD em
`/api/hierarquia-mercadologica`, o campo `Produto.familiaId` (FK opcional para a
folha), a tela compartilhada com rotas `/configurador/hierarquia` (WMS) e
`/compras/hierarquia` (Compras) e a cascata guiada no cadastro de produto. Os
campos legados `Produto.familia` e `Produto.subFamilia` (texto livre) foram
**preservados** sem migração.

A Fase 2 entrega duas frentes que ficaram fora do escopo inicial:

1. **Relatórios e filtros analíticos por nível** — um filtro em cascata que
   permite filtrar produtos por **qualquer** nível da árvore (não só a folha),
   incluindo produtos cujas folhas descendem do nível escolhido; e um
   relatório/painel de distribuição que conta produtos por nível, com totais e
   exportação (CSV/Excel). Disponível tanto no WMS quanto no Compras, seguindo o
   padrão de tela compartilhada + guard de módulos da Fase 1.

2. **Migração assistida dos campos legados `familia`/`subFamilia`** — um fluxo
   de-para **não destrutivo, revisável e reversível**: o sistema analisa os
   valores distintos de `familia`/`subFamilia` dos produtos existentes (por
   empresa), sugere um vínculo com um nível da árvore (casando por texto
   normalizado), o administrador revisa/ajusta/cria níveis/ignora, confirma, e só
   então o `familiaId` dos produtos é preenchido. Os campos legados permanecem
   intactos após a migração.

Restrições de projeto aplicáveis (steering): isolamento multi-tenant obrigatório
por `empresaId` com filtro explícito (não confiar apenas no `prismaScoped`, que
faz bypass para SUPER_ADMIN); qualquer alteração em `schema.prisma` exige a
alteração idempotente equivalente em `prisma/migrate-prod.ts` no mesmo commit,
testada localmente 2x; lógica pura coberta por property-based testing
(fast-check). Documentos em português.

## Glossary

- **Hierarquia Mercadológica**: classificação comercial do produto em 4 níveis fixos encadeados (Fase 1).
- **Nível**: cada camada da hierarquia — Departamento (1), Seção (2), Categoria (3), Subcategoria/Família (4, folha).
- **Nível folha**: o nível mais baixo (Subcategoria/Família), ao qual o produto se vincula via `Produto.familiaId`.
- **Ancestral / descendente**: relação de subordinação na árvore; uma folha é descendente de sua Categoria, Seção e Departamento; um Departamento é ancestral de todas as folhas abaixo dele.
- **Código hierárquico**: identificador composto do nível (ex.: `01.02.04.001`), único por empresa.
- **Filtro em cascata**: conjunto encadeado de seletores (Departamento → Seção → Categoria → Subcategoria/Família) em que a seleção de um nível restringe as opções do nível seguinte.
- **Filtro por nível qualquer**: filtragem de produtos por um nível selecionado em qualquer camada; retorna todos os produtos cujas folhas (`familiaId`) são descendentes do nível selecionado.
- **Relatório de distribuição**: agregação que conta produtos por nível (por Departamento, por Seção, por Categoria, por Subcategoria/Família), com totais.
- **Campos legados**: `Produto.familia` e `Produto.subFamilia` (texto livre, VarChar), preexistentes ao model estruturado.
- **Migração assistida**: fluxo de-para que analisa valores legados, sugere vínculo com nível, permite revisão humana e preenche `familiaId` sem alterar os campos legados.
- **Texto normalizado**: forma canônica de um texto para comparação — minúsculas, sem acentos, sem espaços duplicados e sem espaços nas bordas.
- **Sugestão de vínculo**: proposta gerada pelo sistema associando um valor legado a um nível existente (casamento por texto normalizado) ou a nenhum nível (quando não há correspondência).
- **Decisão de mapeamento**: escolha do administrador para cada valor legado — vincular a um nível existente, criar um novo nível e vincular, ou ignorar.
- **Escopo de análise**: os produtos considerados na migração, sempre restritos à empresa corrente (`empresaId`).
- **Produto sem hierarquia**: produto com `familiaId` nulo.
- **Perfil administrativo**: usuário com perfil ADMIN ou SUPER_ADMIN.
- **Sistema**: o Vizor ERP (backend Fastify/Prisma/Zod + frontend Next.js/Mantine), no escopo desta feature.

## Requirements

### Requirement 1: Filtro em cascata por qualquer nível na listagem e no relatório de produtos

**User Story:** Como analista de produtos, quero filtrar a listagem e o relatório
de produtos por qualquer nível da hierarquia (Departamento, Seção, Categoria ou
Subcategoria/Família), para analisar o portfólio comercial em diferentes granularidades.

#### Acceptance Criteria

1. WHERE a listagem de produtos ou o relatório de produtos está aberto, THE Sistema SHALL disponibilizar um filtro em cascata com os quatro níveis (Departamento → Seção → Categoria → Subcategoria/Família), listando em cada camada apenas os níveis da empresa corrente, ordenados de forma crescente por código hierárquico.
2. WHEN o usuário seleciona um nível em uma camada do filtro em cascata, THE Sistema SHALL restringir as opções da camada imediatamente inferior aos filhos diretos do nível selecionado.
3. WHEN o usuário altera ou limpa a seleção de uma camada, THE Sistema SHALL limpar as seleções de todas as camadas inferiores a ela e recompor as opções dessas camadas conforme a nova seleção.
4. WHEN o usuário aplica o filtro escolhendo um nível de qualquer camada, THE Sistema SHALL retornar todos os produtos cujo `familiaId` é descendente do nível selecionado, incluindo os descendentes de todos os níveis intermediários.
5. WHEN o usuário aplica o filtro escolhendo diretamente uma Subcategoria/Família (folha), THE Sistema SHALL retornar os produtos vinculados exatamente àquela folha.
6. WHEN nenhum nível está selecionado no filtro em cascata e a opção "sem hierarquia" não está marcada, THE Sistema SHALL retornar o mesmo conjunto de produtos que retornaria sem o filtro de hierarquia aplicado.
7. IF o usuário seleciona a opção "sem hierarquia" no filtro, THEN THE Sistema SHALL retornar apenas os produtos com `familiaId` nulo e desconsiderar qualquer nível selecionado nas camadas do filtro em cascata.
8. IF o usuário aplica o filtro com um nível que não existe na empresa corrente ou pertence a outra empresa, THEN THE Sistema SHALL rejeitar a requisição sem retornar produtos, apresentando indicação de nível inválido e preservando o estado anterior da listagem.
9. THE Sistema SHALL restringir todo resultado do filtro à empresa corrente (`empresaId`) como invariante permanente, aplicando filtro explícito por `empresaId` e não dependendo apenas do isolamento automático.

### Requirement 2: Relatório de distribuição de produtos por nível

**User Story:** Como gestor comercial, quero um relatório que mostre a contagem de
produtos por nível da hierarquia, para entender como o portfólio está distribuído.

#### Acceptance Criteria

1. WHEN o relatório de distribuição é aberto ou atualizado, THE Sistema SHALL exibir, em até 5 segundos, a contagem de produtos agregada por nível para os quatro níveis (por Departamento, por Seção, por Categoria e por Subcategoria/Família) da empresa corrente.
2. WHEN o Sistema conta os produtos de um nível não folha, THE Sistema SHALL somar as contagens de todas as folhas descendentes desse nível.
3. WHEN o Sistema conta os produtos de uma Subcategoria/Família (folha), THE Sistema SHALL contar os produtos vinculados exatamente àquela folha via `familiaId`.
4. WHEN um nível não possui produtos vinculados (diretamente ou por descendência), THE Sistema SHALL exibir esse nível com contagem igual a zero, sem removê-lo do relatório.
5. WHEN o relatório de distribuição é aberto ou atualizado, THE Sistema SHALL exibir o total de produtos com hierarquia (`familiaId` não nulo) e o total de produtos sem hierarquia (`familiaId` nulo) da empresa corrente.
6. THE Sistema SHALL garantir que a soma das contagens de todas as folhas somada à contagem de produtos sem hierarquia seja igual ao total de produtos da empresa corrente.
7. WHEN a empresa corrente não possui produtos cadastrados, THE Sistema SHALL exibir todas as contagens e todos os totais iguais a zero, sem gerar erro.
8. IF a hierarquia ou as contagens não puderem ser carregadas por falha de processamento, THEN THE Sistema SHALL exibir uma indicação de erro informando que o relatório não pôde ser gerado, sem apresentar contagens parciais.
9. THE Sistema SHALL restringir todas as contagens e totais à empresa corrente (`empresaId`) como invariante permanente, aplicando filtro explícito por `empresaId` e não dependendo apenas do isolamento automático.

### Requirement 3: Exportação do relatório de distribuição

**User Story:** Como gestor comercial, quero exportar o relatório de distribuição em
CSV/Excel, para compartilhar e analisar fora do sistema.

#### Acceptance Criteria

1. WHERE o relatório de distribuição está aberto, THE Sistema SHALL permitir exportar o conteúdo apresentado nos formatos CSV e Excel.
2. WHEN o usuário solicita a exportação, THE Sistema SHALL gerar um arquivo cujas linhas correspondem às contagens mais recentes disponíveis no momento da solicitação, incluindo os totais.
3. IF os dados foram alterados por atualização concorrente entre a exibição e a exportação, THEN THE Sistema SHALL exportar usando os dados mais recentes disponíveis, sem bloquear a operação.
4. THE Sistema SHALL restringir os dados exportados à empresa corrente (`empresaId`).
5. WHERE filtros estão aplicados ao relatório no momento da exportação, THE Sistema SHALL refletir os mesmos filtros no arquivo exportado.

### Requirement 4: Disponibilidade das telas nos módulos WMS e Compras

**User Story:** Como usuário de Compras, quero acessar os filtros e o relatório de
distribuição sem sair do meu módulo, para manter o contexto de trabalho.

#### Acceptance Criteria

1. THE Sistema SHALL disponibilizar as telas de filtro analítico e de relatório de distribuição tanto no módulo WMS quanto no módulo Compras, usando componente compartilhado sem duplicação de lógica.
2. WHEN o usuário acessa uma dessas telas pelo menu do módulo Compras, THE Sistema SHALL manter o contexto e a barra lateral do Compras.
3. WHEN o usuário acessa uma dessas telas pelo menu do módulo WMS, THE Sistema SHALL manter o contexto do WMS.
4. THE Sistema SHALL liberar o acesso às telas quando a empresa possuir qualquer um dos módulos WMS ou Compras, por meio de guard por lista de módulos permitidos (`['WMS','COMPRAS']`).

### Requirement 5: Análise dos valores legados para migração assistida

**User Story:** Como administrador de cadastros, quero que o sistema analise os
valores distintos de `familia`/`subFamilia` dos produtos existentes e proponha
vínculos com a árvore, para eu revisar antes de qualquer alteração.

#### Acceptance Criteria

1. WHEN o administrador inicia a análise de migração, THE Sistema SHALL levantar os valores distintos de `familia` e `subFamilia` dos produtos da empresa corrente, apresentando, para cada valor distinto, o texto original e a quantidade de produtos associada a esse valor.
2. WHEN o Sistema levanta os valores distintos, THE Sistema SHALL considerar equivalentes os valores cujo texto normalizado (conforme Requirement 8) é idêntico, agrupando-os em um único item de análise cuja quantidade é a soma das quantidades dos valores equivalentes.
3. IF o valor de `familia` ou `subFamilia` de um produto é nulo, vazio ou composto apenas por espaços, THEN THE Sistema SHALL agrupar esses produtos em um único item de análise identificado como "sem classificação", sem gerar sugestão de vínculo para esse item.
4. WHEN o Sistema gera uma sugestão de vínculo para um item de análise, THE Sistema SHALL propor exclusivamente um nível folha (Subcategoria/Família) da empresa corrente cujo texto normalizado da descrição seja idêntico ao texto normalizado do valor legado.
5. IF mais de um nível folha da empresa corrente possui texto normalizado idêntico ao do valor legado, THEN THE Sistema SHALL propor de forma determinística o nível folha de menor código hierárquico entre os candidatos, apresentando os demais candidatos como alternativas selecionáveis.
6. IF nenhum nível folha da empresa corrente corresponde ao texto normalizado de um valor legado, THEN THE Sistema SHALL apresentar o item sem sugestão de vínculo, disponibilizando as ações de criar nível ou ignorar.
7. IF nenhum produto da empresa corrente possui valores em `familia` ou `subFamilia`, THEN THE Sistema SHALL retornar uma análise vazia, sem gerar erro.
8. THE Sistema SHALL restringir a análise aos produtos da empresa corrente (`empresaId`) como invariante permanente, aplicando filtro explícito por `empresaId` e não dependendo apenas do isolamento automático.
9. WHEN o Sistema exibe a análise, THE Sistema SHALL apresentar os produtos com `familiaId` já preenchido exibindo o vínculo atual, sem gerar sugestão automática de substituição, e SHALL alterar o vínculo desses produtos somente mediante decisão de substituição registrada explicitamente pelo administrador.

### Requirement 6: Revisão e confirmação das decisões de mapeamento

**User Story:** Como administrador de cadastros, quero revisar cada sugestão e
decidir vincular, criar nível ou ignorar antes de confirmar, para ter controle
total sobre o resultado.

#### Acceptance Criteria

1. WHERE a tela de revisão está aberta, THE Sistema SHALL permitir, para cada valor legado, escolher entre vincular a um nível existente, criar um novo nível e vincular, ou ignorar o valor.
2. WHEN o administrador escolhe criar um novo nível durante a revisão, THE Sistema SHALL criar o nível conforme as regras da Fase 1 (tipo, pai, código de segmento, código hierárquico) antes de usá-lo como destino do vínculo.
3. IF um valor legado está marcado como ignorar, THEN THE Sistema SHALL manter os produtos correspondentes sem alterar o `familiaId`.
4. WHEN o administrador confirma a migração, THE Sistema SHALL preencher o `familiaId` apenas dos produtos cujos valores legados foram mapeados para um nível, respeitando a decisão registrada para cada valor.
5. THE Sistema SHALL restringir a execução da migração a perfis administrativos (ADMIN/SUPER_ADMIN).
6. THE Sistema SHALL gravar o `familiaId` de cada produto usando o `empresaId` do próprio produto, garantindo que nenhum produto de outra empresa seja alterado.
7. WHEN a confirmação envolve nível folha inválido (inexistente, não folha, ou de outra empresa) em um dos mapeamentos, THE Sistema SHALL rejeitar somente o mapeamento inválido com mensagem clara e confirmar normalmente os demais mapeamentos válidos, sem aplicar alterações parciais do mapeamento rejeitado.

### Requirement 7: Não-destrutividade e reversibilidade da migração

**User Story:** Como responsável técnico, quero que a migração assistida seja não
destrutiva e reversível, para poder auditar e desfazer sem perder dados.

#### Acceptance Criteria

1. WHEN a migração é executada, THE Sistema SHALL preservar sem qualquer alteração os campos legados `familia` e `subFamilia` de todos os produtos afetados, alterando exclusivamente o campo `familiaId`.
2. WHEN a migração processa um produto que já possui `familiaId` preenchido E a decisão de mapeamento registrada para o valor legado desse produto NÃO está marcada como "substituir vínculo existente", THE Sistema SHALL manter o `familiaId` atual do produto inalterado.
3. WHEN a migração processa um produto que já possui `familiaId` preenchido E a decisão de mapeamento registrada para o valor legado desse produto está marcada como "substituir vínculo existente", THE Sistema SHALL gravar o novo `familiaId` no produto e registrar o valor anterior no histórico da execução.
4. WHERE um perfil administrativo (ADMIN/SUPER_ADMIN) solicita reverter uma execução de migração identificada pelo seu identificador único, THE Sistema SHALL restaurar o `familiaId` de cada produto afetado por aquela execução ao valor anterior registrado, sem alterar os campos legados `familia` e `subFamilia`.
5. IF a execução de migração informada para reversão não existe na empresa corrente, já foi revertida anteriormente, ou o `familiaId` atual de um produto afetado diverge do novo valor gravado por aquela execução, THEN THE Sistema SHALL rejeitar a reversão desse produto com mensagem indicando o motivo, preservar o `familiaId` atual desse produto e concluir a reversão dos demais produtos cujo estado permanece consistente, sem aplicar reversão parcial ao produto rejeitado.
6. WHEN a migração afeta um produto, THE Sistema SHALL registrar, associado ao identificador único da execução e à data/hora da execução, o `familiaId` anterior (podendo ser nulo) e o novo `familiaId` do produto, mantendo esse registro disponível para reversão e auditoria enquanto a execução não for revertida.
7. IF a estrutura de dados necessária para persistir o histórico de migração é introduzida no `schema.prisma`, THEN THE Sistema SHALL criá-la por migração idempotente equivalente em `prisma/migrate-prod.ts` no mesmo commit, executável mais de uma vez sem falhar e sem duplicar tabelas, colunas, índices ou constraints.
8. THE Sistema SHALL restringir tanto o registro do histórico quanto a reversão aos produtos da empresa corrente (`empresaId`) como invariante permanente, aplicando filtro explícito por `empresaId` e não dependendo apenas do isolamento automático.

### Requirement 8: Normalização de texto do de-para (lógica pura)

**User Story:** Como responsável técnico, quero uma função de normalização de texto
determinística e testável, para o casamento entre valores legados e níveis ser
consistente.

#### Acceptance Criteria

1. WHEN o Sistema normaliza um texto, THE Sistema SHALL converter para minúsculas, remover acentos, colapsar espaços internos consecutivos em um único espaço e remover espaços das bordas.
2. WHEN o Sistema normaliza um texto já normalizado, THE Sistema SHALL produzir o mesmo texto (idempotência).
3. WHEN o Sistema compara dois textos que diferem apenas em capitalização, acentuação ou espaços redundantes, THE Sistema SHALL considerá-los equivalentes.
4. IF o valor a normalizar é nulo ou vazio, THEN THE Sistema SHALL tratá-lo como texto vazio, sem gerar erro.

### Requirement 9: Agregação de contagens subindo a árvore (lógica pura)

**User Story:** Como responsável técnico, quero uma função pura de agregação que
some as contagens das folhas para os níveis ancestrais, para o relatório de
distribuição ser correto e testável.

#### Acceptance Criteria

1. WHEN o Sistema agrega as contagens por nível a partir das contagens das folhas, THE Sistema SHALL atribuir a cada nível não folha a soma das contagens de todas as suas folhas descendentes.
2. THE Sistema SHALL garantir que a soma das contagens dos níveis de uma mesma camada seja igual à soma das contagens de todas as folhas.
3. WHEN uma folha não possui produtos vinculados, THE Sistema SHALL atribuir contagem zero a essa folha sem removê-la da árvore de agregação.
4. WHEN a ordem de processamento das folhas varia, THE Sistema SHALL produzir o mesmo resultado de agregação (independência de ordem).
5. IF a árvore de entrada não contém folhas, THEN THE Sistema SHALL produzir contagens zero para todos os níveis, sem gerar erro.
