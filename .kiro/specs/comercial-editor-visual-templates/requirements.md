# Requirements Document

## Introduction

Esta feature evolui o atual "Configurador de Templates de Proposta" (bloco B1 do
módulo Comercial — hoje liga/desliga blocos, escolhe estilo `PADRAO`/`WEGA` e
edita textos fixos) para um **Editor Visual de Documentos** do tipo WYSIWYG, com
canvas de posicionamento livre (arrastar / redimensionar / posicionar elementos
por coordenadas), preview em tempo real fiel ao PDF, paleta de elementos
(logo, texto livre, campo dinâmico, tabela de itens/tiragens, linha/divisória,
bloco de condições, assinatura) e **binding de dados dinâmicos** (ex.:
`{{cliente.nome}}`, `{{itens}}`).

A definição do documento é persistida como **JSON de layout** (lista de elementos
com `x`, `y`, `largura`, `altura`, fonte, tamanho, alinhamento e binding). A
MESMA definição é renderizada no **preview do front** (Next.js/Mantine) e no
**PDF do backend** (pdfkit, posicionamento por coordenadas — `doc.image(x,y,w)` /
`doc.text(str,x,y)`), garantindo fidelidade visual entre o que o usuário monta e
o que o cliente recebe.

A feature introduz **dois tipos de template**: `ORCAMENTO` (uso interno/cálculo)
e `PROPOSTA` (documento ao cliente). Os modelos atuais da Carton Wega (estilos
`WEGA` e `PADRAO`, já implementados em `orcamento-grafico-proposta-pdf.service.ts`)
devem ser **semeados como templates default** (layout inicial reproduzido no novo
editor), por empresa e por tipo.

O escopo é **aditivo e não-regressivo**: o fluxo atual de gerar/baixar/enviar
proposta (estilos `WEGA`/`PADRAO`, rotas `proposta-pdf` e `enviar-email`) continua
funcionando sem alteração; o editor visual é um novo caminho opcional. Esta
feature **NÃO toca o motor de cálculo** (`orcamento-grafico-calculo.service.ts`) —
é exclusivamente camada de apresentação.

## Glossary

- **Editor_Visual**: subsistema de frontend (Next.js/Mantine) que apresenta o
  canvas WYSIWYG, a paleta de elementos e o preview em tempo real, permitindo
  arrastar, redimensionar e posicionar elementos do documento.
- **Canvas**: área de edição que representa a página do documento (tamanho A4),
  onde os elementos são posicionados por coordenadas.
- **Elemento**: unidade posicionável do documento. Tipos: `LOGO`, `TEXTO`,
  `CAMPO_DINAMICO`, `TABELA`, `LINHA`, `BLOCO_CONDICOES`, `ASSINATURA`.
- **Layout_JSON**: representação serializada do documento — metadados da página
  (tamanho, margens) e a lista ordenada de Elementos, cada um com posição
  (`x`, `y`), dimensão (`largura`, `altura`) e propriedades de estilo/binding.
- **Binding**: referência textual a um dado dinâmico do contexto de geração
  (ex.: `{{cliente.nome}}`, `{{orcamento.numero}}`, `{{itens}}`), resolvida na
  renderização.
- **Contexto_de_Geracao**: conjunto de dados reais (orçamento, cliente, empresa,
  itens, variações de tiragem) disponíveis no momento de produzir o PDF.
- **Renderizador_Layout**: componente que transforma um Layout_JSON + um
  Contexto_de_Geracao em saída visual. Existem duas implementações da MESMA
  especificação: o Renderizador_Preview (frontend) e o Renderizador_PDF (backend,
  pdfkit).
- **Renderizador_PDF**: implementação do Renderizador_Layout no backend, que
  produz o arquivo PDF via pdfkit por coordenadas.
- **Renderizador_Preview**: implementação do Renderizador_Layout no frontend, que
  produz a pré-visualização em tempo real no Canvas.
- **Template_Visual**: um documento salvo, pertencente a uma empresa, com `tipo`
  (`ORCAMENTO` ou `PROPOSTA`), nome, flag de default e um Layout_JSON.
- **Tipo_Template**: classificação do Template_Visual — `ORCAMENTO` (uso interno)
  ou `PROPOSTA` (ao cliente).
- **Template_Default**: o Template_Visual marcado como padrão da empresa para um
  Tipo_Template específico (um default por empresa por tipo).
- **Servico_Template**: service de backend responsável por CRUD, resolução de
  default e validação/normalização do Layout_JSON, isolando por `empresaId`.
- **Seed_Default_Wega**: rotina idempotente que cria os Template_Visual default
  da Carton Wega (um de `PROPOSTA` reproduzindo o estilo `WEGA`/`PADRAO`, e um de
  `ORCAMENTO`) por empresa.
- **Fluxo_Legado**: o caminho de geração de proposta já existente (config
  liga/desliga de blocos + estilos `WEGA`/`PADRAO`, rotas `proposta-pdf` e
  `enviar-email`), que deve permanecer funcional.

## Requirements

### Requirement 1: Edição por arrastar e redimensionar no canvas

**User Story:** Como usuário do módulo Comercial, quero arrastar, posicionar e
redimensionar livremente os elementos no canvas, para montar o documento no
layout exato que eu desejo.

#### Acceptance Criteria

1. WHEN o usuário arrasta um Elemento no Canvas, THE Editor_Visual SHALL atualizar
   as coordenadas `x` e `y` desse Elemento no Layout_JSON para a posição onde o
   Elemento foi solto.
2. WHEN o usuário redimensiona um Elemento pelas alças de redimensionamento, THE
   Editor_Visual SHALL atualizar os valores `largura` e `altura` desse Elemento
   no Layout_JSON.
3. THE Editor_Visual SHALL restringir os valores `x`, `y`, `largura` e `altura`
   de cada Elemento aos limites da área útil da página (dentro das margens
   definidas no Layout_JSON).
4. WHEN o usuário seleciona um Elemento no Canvas, THE Editor_Visual SHALL exibir
   um painel de propriedades com os valores editáveis de posição, dimensão, fonte,
   tamanho de fonte e alinhamento desse Elemento.
5. WHEN o usuário edita um valor numérico de posição ou dimensão no painel de
   propriedades, THE Editor_Visual SHALL aplicar o novo valor ao Elemento
   correspondente no Layout_JSON.
6. THE Editor_Visual SHALL manter a ordem dos Elementos no Layout_JSON, de modo
   que a ordem de desenho no PDF corresponda à ordem registrada.

### Requirement 2: Paleta de elementos

**User Story:** Como usuário, quero inserir diferentes tipos de elementos a partir
de uma paleta, para compor o documento com logo, textos, campos dinâmicos,
tabelas, divisórias, bloco de condições e assinatura.

#### Acceptance Criteria

1. THE Editor_Visual SHALL oferecer na paleta os tipos de Elemento `LOGO`,
   `TEXTO`, `CAMPO_DINAMICO`, `TABELA`, `LINHA`, `BLOCO_CONDICOES` e `ASSINATURA`.
2. WHEN o usuário adiciona um Elemento da paleta ao Canvas, THE Editor_Visual
   SHALL inserir no Layout_JSON um novo Elemento com o tipo selecionado e com
   valores iniciais de posição, dimensão e estilo.
3. WHERE o Elemento é do tipo `LOGO`, THE Renderizador_Layout SHALL exibir a
   imagem do logo da empresa, respeitando `x`, `y`, `largura` e `altura` do
   Elemento.
4. WHERE o Elemento é do tipo `TEXTO`, THE Renderizador_Layout SHALL exibir o
   texto estático configurado no Elemento, respeitando fonte, tamanho e
   alinhamento.
5. WHERE o Elemento é do tipo `CAMPO_DINAMICO`, THE Renderizador_Layout SHALL
   exibir o valor resolvido do Binding configurado no Elemento a partir do
   Contexto_de_Geracao.
6. WHERE o Elemento é do tipo `TABELA`, THE Renderizador_Layout SHALL exibir as
   linhas de itens ou de variações de tiragem do Contexto_de_Geracao em formato
   tabular, com as colunas configuradas no Elemento.
7. WHERE o Elemento é do tipo `LINHA`, THE Renderizador_Layout SHALL desenhar uma
   linha ou divisória entre as coordenadas definidas pelo Elemento.
8. WHERE o Elemento é do tipo `BLOCO_CONDICOES`, THE Renderizador_Layout SHALL
   exibir o texto de condições comerciais configurado no Elemento.
9. WHERE o Elemento é do tipo `ASSINATURA`, THE Renderizador_Layout SHALL desenhar
   a área de assinatura (linha e rótulo) nas coordenadas definidas pelo Elemento.

### Requirement 3: Binding de dados dinâmicos

**User Story:** Como usuário, quero vincular elementos a dados reais do orçamento
e do cliente, para que o documento seja preenchido automaticamente ao gerar o PDF.

#### Acceptance Criteria

1. THE Editor_Visual SHALL disponibilizar uma lista dos Bindings suportados do
   Contexto_de_Geracao, incluindo dados de cliente, empresa, orçamento, itens e
   variações de tiragem.
2. WHEN o usuário associa um Binding a um Elemento `CAMPO_DINAMICO` ou `TABELA`,
   THE Editor_Visual SHALL registrar a referência do Binding no Elemento do
   Layout_JSON.
3. WHEN o Renderizador_Layout encontra um Binding referenciando um dado presente
   no Contexto_de_Geracao, THE Renderizador_Layout SHALL substituir o Binding pelo
   valor correspondente.
4. IF o Renderizador_Layout encontra um Binding que não corresponde a nenhum dado
   do Contexto_de_Geracao, THEN THE Renderizador_Layout SHALL renderizar o
   Elemento como vazio e registrar um aviso, sem interromper a geração do
   documento.
5. THE Renderizador_Layout SHALL formatar valores monetários do Contexto_de_Geracao
   no padrão de moeda brasileiro (R$) e valores de data no formato `dd/mm/aaaa`.

### Requirement 4: Preview em tempo real fiel ao PDF

**User Story:** Como usuário, quero ver em tempo real como o documento ficará,
com alta fidelidade ao PDF final, para confiar que o que monto é o que o cliente
recebe.

#### Acceptance Criteria

1. WHEN o usuário finaliza uma alteração de posição, dimensão, estilo ou Binding
   de um Elemento (por exemplo, ao soltar o Elemento ou confirmar o valor no
   painel de propriedades), THE Editor_Visual SHALL atualizar o
   Renderizador_Preview refletindo a alteração.
2. THE Renderizador_Preview e o Renderizador_PDF SHALL interpretar o mesmo
   Layout_JSON segundo a mesma especificação de posicionamento e estilo.
3. WHEN o Renderizador_Preview e o Renderizador_PDF processam o mesmo Layout_JSON
   com o mesmo Contexto_de_Geracao, THE Editor_Visual SHALL exibir no preview as
   mesmas posições relativas, textos e tabelas que o Renderizador_PDF produz no
   PDF.
4. THE Renderizador_Preview SHALL exibir o Canvas no tamanho de página A4 com as
   mesmas margens usadas pelo Renderizador_PDF.

### Requirement 5: Dois tipos de template (Orçamento e Proposta)

**User Story:** Como usuário, quero criar templates de dois tipos — orçamento
(uso interno) e proposta (ao cliente) — para separar o documento de cálculo
interno do documento enviado ao cliente.

#### Acceptance Criteria

1. THE Servico_Template SHALL associar a cada Template_Visual um Tipo_Template com
   valor `ORCAMENTO` ou `PROPOSTA`.
2. WHEN o usuário lista templates filtrando por um Tipo_Template, THE
   Servico_Template SHALL retornar apenas os Template_Visual da empresa com o
   Tipo_Template informado.
3. WHEN o usuário cria um Template_Visual, THE Servico_Template SHALL exigir que o
   Tipo_Template seja `ORCAMENTO` ou `PROPOSTA`.
4. IF o usuário cria um Template_Visual com um Tipo_Template diferente de
   `ORCAMENTO` ou `PROPOSTA`, THEN THE Servico_Template SHALL rejeitar a criação
   com um erro de validação.

### Requirement 6: Seed dos templates default da Carton Wega

**User Story:** Como usuário da Carton Wega, quero que os modelos atuais (estilos
WEGA e PADRAO) sejam reproduzidos como templates default no novo editor, para
começar do layout que já uso em vez de montar do zero.

#### Acceptance Criteria

1. WHEN o Seed_Default_Wega é executado para uma empresa, THE Seed_Default_Wega
   SHALL criar um Template_Visual de Tipo_Template `PROPOSTA` cujo Layout_JSON
   reproduz o layout do estilo `WEGA` já implementado no renderizador de proposta
   atual.
2. WHEN o Seed_Default_Wega é executado para uma empresa, THE Seed_Default_Wega
   SHALL criar um Template_Visual de Tipo_Template `ORCAMENTO` com um Layout_JSON
   inicial para uso interno.
3. THE Seed_Default_Wega SHALL marcar cada Template_Visual criado como
   Template_Default da empresa para o seu Tipo_Template quando a empresa ainda não
   possui um default daquele tipo.
4. WHEN o Seed_Default_Wega é executado mais de uma vez para a mesma empresa, THE
   Seed_Default_Wega SHALL preservar os Template_Visual já existentes sem criar
   duplicatas (comportamento idempotente).
5. THE Seed_Default_Wega SHALL registrar o `empresaId` explícito em cada
   Template_Visual criado.

### Requirement 7: Gerenciamento de templates por tipo

**User Story:** Como usuário, quero criar, duplicar, definir default e excluir
templates por tipo, para gerenciar meus modelos de documento.

#### Acceptance Criteria

1. WHEN o usuário cria um Template_Visual informando nome, Tipo_Template e
   Layout_JSON, THE Servico_Template SHALL persistir o Template_Visual vinculado
   ao `empresaId` da empresa do usuário.
2. WHEN o usuário duplica um Template_Visual, THE Servico_Template SHALL criar um
   novo Template_Visual com o mesmo Tipo_Template e uma cópia do Layout_JSON do
   original, sem marcar a cópia como Template_Default.
3. WHEN o usuário define um Template_Visual como Template_Default, THE
   Servico_Template SHALL marcar esse Template_Visual como default e remover a
   marcação de default dos demais Template_Visual da mesma empresa e mesmo
   Tipo_Template, de forma que exista no máximo um Template_Default por empresa por
   Tipo_Template.
4. WHEN o usuário exclui um Template_Visual que não é Template_Default, THE
   Servico_Template SHALL remover o Template_Visual.
5. IF o usuário tenta excluir um Template_Visual que é Template_Default, THEN THE
   Servico_Template SHALL rejeitar a exclusão com um erro orientando a definir
   outro template como default antes.
6. WHEN o usuário atualiza o Layout_JSON de um Template_Visual existente, THE
   Servico_Template SHALL validar e persistir o Layout_JSON atualizado.

### Requirement 8: Seleção do template na geração do PDF

**User Story:** Como usuário, quero escolher qual template usar ao gerar o
documento, para emitir orçamentos e propostas com o layout desejado.

#### Acceptance Criteria

1. WHEN o usuário gera um PDF informando o identificador de um Template_Visual,
   THE Renderizador_PDF SHALL produzir o PDF a partir do Layout_JSON desse
   Template_Visual.
2. IF o usuário gera um PDF sem informar um Template_Visual, THEN THE
   Renderizador_PDF SHALL usar o Template_Default da empresa para o Tipo_Template
   solicitado.
3. IF o usuário gera um PDF sem informar um Template_Visual e a empresa não possui
   Template_Default para o Tipo_Template solicitado, THEN THE Renderizador_PDF
   SHALL produzir o PDF pelo Fluxo_Legado, preservando a não-regressão.
4. IF o usuário gera um PDF informando um identificador de Template_Visual que não
   pertence à empresa do usuário, THEN THE Servico_Template SHALL rejeitar a
   geração com um erro de template não encontrado.

### Requirement 9: Isolamento multi-tenant

**User Story:** Como operador do ERP multiempresa, quero que cada empresa só
acesse seus próprios templates, para garantir o isolamento de dados entre
empresas.

#### Acceptance Criteria

1. THE Servico_Template SHALL filtrar por `empresaId` explícito em toda consulta,
   criação, atualização e exclusão de Template_Visual.
2. WHEN o usuário lista, obtém, atualiza ou exclui um Template_Visual, THE
   Servico_Template SHALL restringir a operação aos Template_Visual cujo
   `empresaId` corresponde à empresa do usuário.
3. IF uma operação referencia um Template_Visual de outra empresa, THEN THE
   Servico_Template SHALL responder como se o Template_Visual não existisse
   (template não encontrado).

### Requirement 10: Não-regressão do fluxo atual de proposta

**User Story:** Como usuário, quero que o fluxo atual de baixar e enviar proposta
continue funcionando, para que a introdução do editor visual não quebre o que já
uso em produção.

#### Acceptance Criteria

1. THE sistema SHALL manter operacionais as rotas atuais de geração de proposta
   (`proposta-pdf`) e de envio por e-mail (`enviar-email`) sem alteração de
   contrato.
2. WHEN uma proposta é gerada por um orçamento cuja empresa não possui
   Template_Visual, THE sistema SHALL produzir o PDF pelo Fluxo_Legado (estilos
   `WEGA`/`PADRAO` e configuração de blocos atual).
3. THE feature SHALL preservar o comportamento do motor de cálculo
   (`orcamento-grafico-calculo.service.ts`) sem modificação, limitando-se à camada
   de apresentação.
4. WHEN o schema Prisma é alterado para persistir o Template_Visual, THE sistema
   SHALL incluir no mesmo commit a atualização idempotente de
   `prisma/migrate-prod.ts` (`CREATE TABLE`/`ADD COLUMN IF NOT EXISTS`), conforme
   o processo de migração do projeto.
