# Requirements Document

## Introduction

Este documento especifica os requisitos para evolução do módulo de conferência de entrada do WMS, adição de controle de lote por produto, recebimento parcial, emissão automática de Carta de Correção Eletrônica (CC-e) em divergências, e renomeação da marca de "VisioFab" para "Vizor" em toda a interface do usuário.

O escopo abrange cinco itens inter-relacionados:
1. Configurações avançadas de conferência de entrada (quantidade cega, lote cego, validade)
2. Emissão automática de CC-e quando divergência é aceita
3. Controle de lote obrigatório/opcional por produto
4. Recebimento parcial de itens da nota fiscal
5. Renomeação da marca para Vizor no frontend

## Glossary

- **Sistema_Conferencia**: Módulo de conferência de entrada do WMS responsável por validar mercadorias recebidas contra a nota fiscal
- **Sistema_CCe**: Módulo responsável pela emissão de Cartas de Correção Eletrônica junto à SEFAZ
- **Sistema_Frontend**: Interface web do WMS construída em Next.js 15 + Mantine v7
- **Conferente**: Operador responsável por realizar a conferência física de mercadorias recebidas
- **NF**: Nota Fiscal eletrônica (NF-e) de entrada vinculada ao recebimento
- **CC-e**: Carta de Correção Eletrônica — documento fiscal que corrige informações de uma NF-e já autorizada
- **SEFAZ**: Secretaria da Fazenda estadual, responsável por autorizar documentos fiscais eletrônicos
- **Empresa**: Entidade tenant do sistema multi-empresa, com configurações próprias
- **Produto**: Item cadastrado no sistema com atributos logísticos e fiscais
- **Lote**: Identificador de rastreabilidade de um grupo de produtos fabricados nas mesmas condições
- **Quantidade_Cega**: Configuração onde o conferente não visualiza a quantidade da NF e informa manualmente o valor contado
- **Lote_Cego**: Configuração onde o conferente não visualiza o lote da NF e informa manualmente o lote lido no produto
- **Recebimento_Parcial**: Configuração que permite aceitar quantidades menores que as da NF, mantendo saldo pendente para recebimento futuro

## Requirements

### Requirement 1: Configuração de Quantidade Cega por Empresa

**User Story:** As a administrador de empresa, I want to ativar ou desativar a conferência de quantidade cega, so that o conferente informe a quantidade real contada sem influência da NF.

#### Acceptance Criteria

1. THE Empresa SHALL possuir um campo configurável `conferenciaQuantidadeCega` (booleano, padrão falso)
2. WHEN a configuração `conferenciaQuantidadeCega` estiver ativa, THE Sistema_Conferencia SHALL ocultar a quantidade esperada da NF na interface de conferência do item
3. WHEN a configuração `conferenciaQuantidadeCega` estiver ativa, THE Sistema_Conferencia SHALL exigir que o Conferente digite a quantidade contada fisicamente
4. WHEN a configuração `conferenciaQuantidadeCega` estiver inativa, THE Sistema_Conferencia SHALL exibir a quantidade esperada da NF ao Conferente durante a conferência

### Requirement 2: Configuração de Conferência Cega de Lote por Empresa

**User Story:** As a administrador de empresa, I want to ativar ou desativar a conferência cega de lote, so that o conferente informe o lote real lido no produto sem ver o lote da NF.

#### Acceptance Criteria

1. THE Empresa SHALL possuir um campo configurável `conferenciaLoteCega` (booleano, padrão falso)
2. WHEN a configuração `conferenciaLoteCega` estiver ativa, THE Sistema_Conferencia SHALL ocultar o número do lote da NF na interface de conferência
3. WHEN a configuração `conferenciaLoteCega` estiver ativa, THE Sistema_Conferencia SHALL exigir que o Conferente digite ou leia (via leitor) o lote real do produto
4. WHEN a configuração `conferenciaLoteCega` estiver inativa, THE Sistema_Conferencia SHALL exibir o lote da NF como valor pré-preenchido ao Conferente

### Requirement 3: Validade Digitada na Conferência Cega

**User Story:** As a conferente, I want to digitar a data de validade do produto durante conferência cega, so that o sistema valide a informação contra os dados da NF.

#### Acceptance Criteria

1. WHEN a configuração `conferenciaLoteCega` estiver ativa E o item possuir data de validade na NF, THE Sistema_Conferencia SHALL exigir que o Conferente digite a data de validade do produto
2. WHEN o Conferente informar a data de validade, THE Sistema_Conferencia SHALL comparar a validade digitada com a validade registrada na NF
3. WHEN a validade digitada divergir da validade na NF, THE Sistema_Conferencia SHALL registrar a divergência com tipo "VALIDADE_DIVERGENTE" e exibir alerta ao Conferente
4. WHEN a validade digitada for anterior à data atual, THE Sistema_Conferencia SHALL emitir alerta de "PRODUTO VENCIDO" e bloquear o recebimento do item até aprovação de um supervisor

### Requirement 4: Emissão Automática de CC-e em Divergência Aceita

**User Story:** As a operador de recebimento, I want que o sistema emita automaticamente uma CC-e quando aceito a quantidade real divergente da NF, so that a nota fiscal seja corrigida junto à SEFAZ sem intervenção manual.

#### Acceptance Criteria

1. WHEN uma divergência de quantidade for detectada na conferência E o operador aceitar o valor conferido como correto, THE Sistema_CCe SHALL gerar automaticamente o XML da Carta de Correção Eletrônica
2. WHEN o XML da CC-e for gerado, THE Sistema_CCe SHALL assinar digitalmente o documento com o certificado A1 da Empresa
3. WHEN a CC-e estiver assinada, THE Sistema_CCe SHALL transmitir o evento à SEFAZ via webservice (evento tipo 110110)
4. WHEN a SEFAZ retornar autorização (cStat 135), THE Sistema_CCe SHALL registrar o protocolo de autorização e vincular a CC-e à NF de origem
5. IF a SEFAZ rejeitar a CC-e, THEN THE Sistema_CCe SHALL registrar o motivo da rejeição, notificar o operador e manter a divergência em status "PENDENTE_CCE"
6. THE Sistema_CCe SHALL respeitar o limite máximo de 20 CC-e por NF-e conforme legislação vigente
7. WHEN uma CC-e for emitida, THE Sistema_CCe SHALL gerar o texto de correção contendo o item, quantidade original e quantidade corrigida

### Requirement 5: Controle de Lote por Produto

**User Story:** As a gestor de cadastro, I want to configurar quais produtos exigem rastreabilidade por lote, so that apenas produtos que necessitam de controle de lote tenham essa obrigatoriedade na conferência.

#### Acceptance Criteria

1. THE Produto SHALL possuir um campo configurável `exigeLote` (booleano, padrão falso) no cadastro
2. WHEN o produto possuir `exigeLote` ativo E o item estiver em conferência de entrada, THE Sistema_Conferencia SHALL exigir o preenchimento obrigatório do campo lote
3. WHEN o produto possuir `exigeLote` inativo, THE Sistema_Conferencia SHALL ocultar ou tornar opcional o campo lote na conferência de entrada
4. IF o Conferente tentar concluir a conferência de um item com `exigeLote` ativo sem informar o lote, THEN THE Sistema_Conferencia SHALL bloquear a conclusão e exibir mensagem de campo obrigatório

### Requirement 6: Recebimento Parcial por Item da Nota

**User Story:** As a operador de recebimento, I want to receber parcialmente um item da nota fiscal, so that o saldo pendente fique registrado para recebimento futuro sem bloquear a operação.

#### Acceptance Criteria

1. THE Empresa SHALL possuir um campo configurável `permiteRecebimentoParcial` (booleano, padrão falso)
2. WHEN a configuração `permiteRecebimentoParcial` estiver ativa E a quantidade conferida for menor que a quantidade da NF, THE Sistema_Conferencia SHALL aceitar o recebimento parcial do item
3. WHEN um recebimento parcial for aceito, THE Sistema_Conferencia SHALL registrar o saldo pendente (quantidade NF menos quantidade recebida) vinculado à NF e ao item
4. WHEN existir saldo pendente de um item, THE Sistema_Conferencia SHALL exibir o item como "PARCIALMENTE_RECEBIDO" nas consultas de notas pendentes
5. WHEN a configuração `permiteRecebimentoParcial` estiver inativa E a quantidade conferida diferir da quantidade da NF, THE Sistema_Conferencia SHALL tratar a situação como divergência padrão (aceitar ou rejeitar a nota inteira)
6. WHEN todo o saldo pendente de uma NF for recebido em conferências posteriores, THE Sistema_Conferencia SHALL atualizar o status da NF para "CONFERIDA"

### Requirement 7: Renomeação da Marca para Vizor no Frontend

**User Story:** As a usuário do sistema, I want to ver a marca "Vizor" em todas as interfaces, so that a identidade visual reflita o novo nome do produto.

#### Acceptance Criteria

1. THE Sistema_Frontend SHALL exibir "Vizor" no componente de header/layout em substituição a "VisioFab"
2. THE Sistema_Frontend SHALL definir o `document.title` de todas as páginas com o prefixo "Vizor - " em substituição a "VisioFab - "
3. THE Sistema_Frontend SHALL exibir "Vizor" na tela de login (logo, título e textos de boas-vindas)
4. THE Sistema_Frontend SHALL exibir "Vizor" em breadcrumbs, rodapés e quaisquer textos que referenciem o nome do produto
5. THE Sistema_Frontend SHALL manter inalterados os nomes técnicos de repositórios, pacotes npm, pastas de código e variáveis internas que referenciam "VisioFab"
6. THE Sistema_Frontend SHALL manter inalteradas as URLs de API e domínios de deploy que referenciam "VisioFab" ou "visiofab"
