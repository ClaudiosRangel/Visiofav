# Documento de Requisitos — Fase 1: Cadastros Base do PCP

## Introdução

Este documento especifica os requisitos para a criação do módulo PCP (Planejamento e Controle da Produção) no backend unificado VisioFab.Wms.Back. A Fase 1 estabelece os cadastros fundamentais: Centros Produtivos, Recursos, Turnos, Estrutura de Produto (BOM — Bill of Materials), Roteiros de Produção e Atributos Gráficos específicos da indústria gráfica. Estes cadastros são pré-requisitos para as fases seguintes (Ordem de Produção, Integração WMS, etc.).

O módulo PCP segue os mesmos padrões arquiteturais do sistema existente: Fastify + Prisma + PostgreSQL, multi-tenant por empresa, controle de acesso por módulo (`PCP` no campo `UsuarioEmpresa.modulos`), e validação com Zod.

## Glossário

- **Sistema**: O backend VisioFab.Wms.Back (Fastify + Prisma + PostgreSQL)
- **Empresa**: Entidade multi-tenant, já existente no modelo Prisma
- **Modulo_PCP**: Novo módulo de acesso controlado pelo campo `UsuarioEmpresa.modulos`
- **CentroProducao**: Máquina ou setor produtivo onde operações de fabricação são realizadas (equivalente a "Centro Produtivo" no PCP legado Delphi)
- **RecursoProducao**: Recurso necessário para uma operação (operador, ferramenta, molde, faca de corte)
- **TurnoProducao**: Período de trabalho com horários de início e fim
- **EstruturaProduto**: Árvore de materiais (BOM) que define a composição de um produto acabado ou intermediário
- **ItemEstrutura**: Cada componente/matéria-prima dentro de uma EstruturaProduto, com quantidade e unidade
- **RoteiroProducao**: Sequência ordenada de operações necessárias para fabricar um produto
- **EtapaRoteiro**: Uma operação individual dentro do roteiro, vinculada a um CentroProducao
- **AtributoGrafico**: Características específicas da indústria gráfica vinculadas a um produto (tipo cartão, cor, formato, gramatura, policromia, verniz)
- **Produto**: Entidade já existente no sistema, representando matéria-prima, intermediário ou produto acabado
- **UnidadeMedida**: Unidade de medida do produto (kg, m², folha, resma, litro, unidade)

## Requisitos

### Requisito 1: Controle de Acesso — Módulo PCP

**User Story:** Como administrador, quero que o módulo PCP seja acessível apenas a usuários autorizados, para manter a segregação de responsabilidades.

#### Critérios de Aceitação

1. THE Sistema SHALL reconhecer o valor `PCP` como módulo válido no campo `UsuarioEmpresa.modulos`
2. THE Sistema SHALL aplicar um middleware de autorização (`moduloGuard('PCP')`) em todos os endpoints do módulo PCP
3. IF um usuário sem o módulo `PCP` no seu `UsuarioEmpresa.modulos` tentar acessar qualquer endpoint PCP, THEN THE Sistema SHALL retornar HTTP 403 com mensagem "Acesso negado ao módulo PCP"
4. WHEN o campo `modulos` contém `"*"`, THE Sistema SHALL conceder acesso ao módulo PCP
5. THE Sistema SHALL incluir `PCP` na lista de módulos exibidos na Tela_Modulos do frontend

---

### Requisito 2: CRUD de Centros de Produção

**User Story:** Como gestor de produção, quero cadastrar os centros produtivos (máquinas e setores), para que eu possa vincular operações de fabricação a locais físicos específicos.

#### Critérios de Aceitação

1. THE Sistema SHALL permitir criar um CentroProducao com os campos: código (obrigatório, único por empresa, máximo 20 caracteres), descrição (obrigatório, máximo 200 caracteres), tipo (obrigatório, enum: `MAQUINA`, `SETOR`, `LINHA`), capacidadeHora (decimal, opcional — unidades/hora), custoHora (decimal, opcional — R$/hora), e status (boolean, default true)
2. THE Sistema SHALL permitir listar CentroProducao da empresa com paginação (page, limit), filtro por tipo e filtro por status
3. THE Sistema SHALL permitir buscar um CentroProducao por ID
4. THE Sistema SHALL permitir atualizar descrição, tipo, capacidadeHora, custoHora e status de um CentroProducao
5. IF um código duplicado for informado para a mesma empresa, THEN THE Sistema SHALL retornar erro 409 com mensagem descritiva
6. THE Sistema SHALL impedir exclusão física de CentroProducao; a desativação é feita via campo status = false
7. THE Sistema SHALL filtrar todos os resultados pelo empresaId do usuário autenticado (multi-tenant)

---

### Requisito 3: CRUD de Recursos de Produção

**User Story:** Como gestor de produção, quero cadastrar recursos (operadores especializados, ferramentas, moldes, facas de corte), para que eu possa alocar recursos nas etapas de produção.

#### Critérios de Aceitação

1. THE Sistema SHALL permitir criar um RecursoProducao com os campos: código (obrigatório, único por empresa, máximo 20 caracteres), descrição (obrigatório, máximo 200 caracteres), tipo (obrigatório, enum: `OPERADOR`, `FERRAMENTA`, `MOLDE`, `FACA`, `OUTRO`), centroProducaoId (opcional — vínculo a um centro), custoHora (decimal, opcional), e status (boolean, default true)
2. THE Sistema SHALL permitir listar RecursoProducao da empresa com paginação, filtro por tipo, filtro por centroProducaoId e filtro por status
3. THE Sistema SHALL permitir buscar um RecursoProducao por ID
4. THE Sistema SHALL permitir atualizar descrição, tipo, centroProducaoId, custoHora e status
5. IF o centroProducaoId informado não pertencer à mesma empresa, THEN THE Sistema SHALL retornar erro 400
6. THE Sistema SHALL filtrar todos os resultados pelo empresaId do usuário autenticado

---

### Requisito 4: CRUD de Turnos de Produção

**User Story:** Como gestor de produção, quero cadastrar turnos de trabalho com horários, para que a programação de produção respeite a disponibilidade de cada centro.

#### Critérios de Aceitação

1. THE Sistema SHALL permitir criar um TurnoProducao com os campos: código (obrigatório, único por empresa, máximo 10 caracteres), descrição (obrigatório, máximo 100 caracteres), horaInicio (obrigatório, formato HH:mm), horaFim (obrigatório, formato HH:mm), diasSemana (array de inteiros 0-6, onde 0=domingo), e status (boolean, default true)
2. THE Sistema SHALL permitir listar TurnoProducao da empresa com paginação e filtro por status
3. THE Sistema SHALL permitir buscar um TurnoProducao por ID
4. THE Sistema SHALL permitir atualizar descrição, horaInicio, horaFim, diasSemana e status
5. THE Sistema SHALL calcular e armazenar o campo `duracaoMinutos` automaticamente com base em horaInicio e horaFim
6. IF horaFim for menor que horaInicio (turno noturno que cruza meia-noite), THEN THE Sistema SHALL calcular a duração corretamente considerando a virada de dia
7. THE Sistema SHALL filtrar todos os resultados pelo empresaId do usuário autenticado

---

### Requisito 5: Estrutura de Produto (BOM — Bill of Materials)

**User Story:** Como engenheiro de produto, quero cadastrar a estrutura (árvore de materiais) de cada produto acabado, para que o sistema saiba quais matérias-primas e quantidades são necessárias para fabricá-lo.

#### Critérios de Aceitação

1. THE Sistema SHALL permitir criar uma EstruturaProduto com os campos: produtoId (obrigatório, referência ao Produto existente), versao (obrigatório, inteiro, default 1), descricao (opcional, máximo 200 caracteres), rendimento (decimal, default 1.0 — quantidade base que a estrutura produz), e status (enum: `ATIVA`, `INATIVA`, `RASCUNHO`)
2. THE Sistema SHALL permitir apenas uma EstruturaProduto com status `ATIVA` por produtoId por empresa
3. THE Sistema SHALL permitir adicionar ItemEstrutura à estrutura com os campos: produtoComponenteId (obrigatório, referência a Produto), quantidade (decimal > 0, obrigatório), unidadeMedida (obrigatório), percentualPerda (decimal >= 0, default 0 — perda prevista no processo), sequencia (inteiro, para ordenação), e observacao (opcional)
4. THE Sistema SHALL calcular o campo `quantidadeLiquida` de cada ItemEstrutura como: `quantidade × (1 + percentualPerda / 100)`
5. THE Sistema SHALL permitir estruturas multinível (um ItemEstrutura pode referenciar um Produto que também possui EstruturaProduto), formando uma árvore
6. IF um ItemEstrutura referenciar o próprio produtoId da EstruturaProduto (referência circular direta), THEN THE Sistema SHALL rejeitar com erro de validação
7. THE Sistema SHALL fornecer um endpoint para "explodir" a estrutura completa (árvore multinível) retornando todos os componentes de todos os níveis com quantidades acumuladas
8. THE Sistema SHALL permitir listar EstruturaProduto por produtoId e por status
9. THE Sistema SHALL permitir duplicar uma EstruturaProduto existente para criar nova versão
10. THE Sistema SHALL filtrar todos os resultados pelo empresaId do usuário autenticado

---

### Requisito 6: Roteiro de Produção

**User Story:** Como engenheiro de processos, quero cadastrar o roteiro de produção (sequência de operações) de cada produto, para que o PCP saiba quais etapas e máquinas são necessárias para fabricá-lo.

#### Critérios de Aceitação

1. THE Sistema SHALL permitir criar um RoteiroProducao com os campos: produtoId (obrigatório, referência ao Produto), versao (inteiro, default 1), descricao (opcional, máximo 200 caracteres), e status (enum: `ATIVO`, `INATIVO`, `RASCUNHO`)
2. THE Sistema SHALL permitir apenas um RoteiroProducao com status `ATIVO` por produtoId por empresa
3. THE Sistema SHALL permitir adicionar EtapaRoteiro ao roteiro com os campos: sequencia (inteiro > 0, obrigatório), descricao (obrigatório, máximo 200 caracteres), centroProducaoId (obrigatório, referência a CentroProducao), tempoSetupMinutos (decimal >= 0, tempo de preparação), tempoOperacaoMinutos (decimal >= 0, tempo por unidade produzida), tempoEsperaMinutos (decimal >= 0, tempo de espera/secagem), recursoId (opcional, referência a RecursoProducao), e observacao (opcional)
4. THE Sistema SHALL calcular o campo `tempoTotalMinutos` de cada EtapaRoteiro como: `tempoSetupMinutos + tempoOperacaoMinutos + tempoEsperaMinutos`
5. THE Sistema SHALL ordenar as EtapaRoteiro por sequência ao retornar o roteiro
6. THE Sistema SHALL validar que o centroProducaoId pertence à mesma empresa
7. THE Sistema SHALL permitir listar RoteiroProducao por produtoId e por status
8. THE Sistema SHALL permitir duplicar um RoteiroProducao existente para criar nova versão
9. THE Sistema SHALL fornecer um endpoint para calcular o tempo total de produção de uma quantidade N: `Σ(tempoSetup + tempoOperacao × N + tempoEspera)` para todas as etapas
10. THE Sistema SHALL filtrar todos os resultados pelo empresaId do usuário autenticado

---

### Requisito 7: Atributos Gráficos — Cadastros de Tipos

**User Story:** Como gestor de produção gráfica, quero cadastrar os tipos específicos do setor (cartão, cor, formato, gramatura, policromia, verniz), para que os produtos tenham suas características gráficas registradas.

#### Critérios de Aceitação

1. THE Sistema SHALL permitir CRUD de TipoCartao com campos: codigo (único por empresa), descricao, e status
2. THE Sistema SHALL permitir CRUD de TipoCor com campos: codigo (único por empresa), descricao, codigoPantone (opcional), hexadecimal (opcional), e status
3. THE Sistema SHALL permitir CRUD de TipoFormato com campos: codigo (único por empresa), descricao, larguraMm (inteiro), alturaMm (inteiro), e status
4. THE Sistema SHALL permitir CRUD de TipoGramatura com campos: codigo (único por empresa), descricao, valorGm2 (decimal — gramas por metro quadrado), e status
5. THE Sistema SHALL permitir CRUD de TipoPolicromia com campos: codigo (único por empresa), descricao, numeroCores (inteiro — ex: 4 para CMYK), e status
6. THE Sistema SHALL permitir CRUD de TipoVerniz com campos: codigo (único por empresa), descricao, tipo (enum: `UV`, `AQUOSO`, `OLEOSO`, `NENHUM`), e status
7. THE Sistema SHALL fornecer endpoints de listagem com paginação e filtro por status para cada tipo
8. THE Sistema SHALL filtrar todos os resultados pelo empresaId do usuário autenticado
9. THE Sistema SHALL aplicar o middleware `moduloGuard('PCP')` em todos os endpoints de atributos gráficos

---

### Requisito 8: Vinculação de Atributos Gráficos ao Produto

**User Story:** Como engenheiro de produto, quero vincular atributos gráficos (tipo cartão, cor, formato, gramatura, policromia, verniz) a um produto, para que as especificações de produção estejam completas.

#### Critérios de Aceitação

1. THE Sistema SHALL permitir criar um registro AtributoGrafico vinculado a um Produto com os campos: produtoId (obrigatório), tipoCartaoId (opcional), tipoCoresIds (array, opcional — múltiplas cores), tipoFormatoId (opcional), tipoGramaturaId (opcional), tipoPolicromiaId (opcional), tipoVernizId (opcional), observacoes (opcional, texto livre)
2. THE Sistema SHALL permitir apenas um registro AtributoGrafico por produtoId por empresa
3. THE Sistema SHALL retornar os atributos gráficos como parte do endpoint de detalhe do Produto (include/expand)
4. THE Sistema SHALL permitir atualizar parcialmente os atributos gráficos (PATCH)
5. IF algum ID de tipo referenciado não pertencer à mesma empresa, THEN THE Sistema SHALL retornar erro 400
6. THE Sistema SHALL filtrar todos os resultados pelo empresaId do usuário autenticado

---

### Requisito 9: Classificação de Produto para PCP

**User Story:** Como gestor de produção, quero classificar produtos como matéria-prima, intermediário ou produto acabado, para que o PCP saiba quais produtos são fabricados e quais são comprados.

#### Critérios de Aceitação

1. THE Sistema SHALL adicionar o campo `classificacaoPcp` ao modelo Produto com valores possíveis: `MATERIA_PRIMA`, `INTERMEDIARIO`, `PRODUTO_ACABADO`, `EMBALAGEM`, `INSUMO` (nullable para produtos sem classificação PCP)
2. THE Sistema SHALL permitir filtrar a listagem de Produtos por `classificacaoPcp`
3. THE Sistema SHALL permitir atualizar o campo `classificacaoPcp` via endpoint existente de atualização de Produto
4. WHEN uma EstruturaProduto é criada para um Produto sem classificacaoPcp, THE Sistema SHALL sugerir (mas não forçar) a classificação como `PRODUTO_ACABADO` ou `INTERMEDIARIO`
5. THE Sistema SHALL permitir que o endpoint de explosão de BOM filtre apenas componentes do tipo `MATERIA_PRIMA` (folha da árvore)

---

### Requisito 10: Serviço de Conversão de Unidades

**User Story:** Como operador de produção gráfica, quero que o sistema converta automaticamente entre unidades (kg, m², folhas, resmas, metros lineares), para que eu não precise fazer cálculos manuais ao planejar a produção.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer um endpoint `POST /api/pcp/conversao-unidades` que aceita: valorOrigem (decimal > 0), unidadeOrigem (string), unidadeDestino (string), e parâmetros opcionais: larguraMm, comprimentoMm, gramaturaGm2, folhasPorResma
2. THE Sistema SHALL suportar as seguintes conversões:
   - kg → m² (usando gramatura): `m² = kg × 1000 / gramaturaGm2`
   - m² → kg (usando gramatura): `kg = m² × gramaturaGm2 / 1000`
   - kg → metros_lineares (usando largura e gramatura): `metros = kg × 1000 / (larguraMm / 1000 × gramaturaGm2)`
   - metros_lineares → kg (usando largura e gramatura): `kg = metros × (larguraMm / 1000) × gramaturaGm2 / 1000`
   - resmas → folhas: `folhas = resmas × folhasPorResma`
   - folhas → resmas: `resmas = folhas / folhasPorResma`
   - folhas → m² (usando largura e comprimento): `m² = folhas × (larguraMm / 1000) × (comprimentoMm / 1000)`
   - m² → folhas (usando largura e comprimento): `folhas = m² / ((larguraMm / 1000) × (comprimentoMm / 1000))`
3. IF os parâmetros necessários para a conversão solicitada não forem fornecidos, THEN THE Sistema SHALL retornar erro 400 listando os parâmetros faltantes
4. IF a conversão solicitada não for suportada, THEN THE Sistema SHALL retornar erro 400 com mensagem indicando as conversões disponíveis
5. THE Sistema SHALL retornar o resultado com precisão de 4 casas decimais
6. THE Sistema SHALL disponibilizar o serviço de conversão também como função interna reutilizável por outros módulos (ex: cálculo de BOM)
