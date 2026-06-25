# Requirements Document

## Introduction

Este documento define os requisitos para a funcionalidade de classificação de **Tipo de Máquina** nos Centros de Produção do módulo PCP. Atualmente, o campo `tipo` do CentroProducao armazena a classificação do tipo de centro (MAQUINA, SETOR, LINHA). A Programação utiliza heurísticas baseadas em palavras-chave na descrição para categorizar centros nas abas (Cortadeira, Impressão, Acabamento). Esta funcionalidade adiciona um campo explícito `tipoMaquina` para classificação determinística, eliminando a dependência de keywords na descrição.

## Glossary

- **CentroProducao**: Entidade que representa um centro de produção (máquina, setor ou linha) no sistema PCP. Armazenado na tabela `centro_producao`.
- **TipoMaquina**: Novo campo enum que classifica o tipo funcional de uma máquina: IMPRESSAO, ACABAMENTO, CORTADEIRA, COLAGEM, VERNIZ.
- **Programacao**: Painel operacional (tela de Programação por Centro) que exibe etapas de OPs agrupadas por centro de produção, com abas por categoria de máquina.
- **ImportarOP**: Fluxo wizard de importação de OP via PDF que cria centros de produção automaticamente.
- **EtapaOrdemProducao**: Registro de etapa de uma Ordem de Produção vinculado a um CentroProducao.
- **AguardandoCartao**: Status de OP que indica que o material (cartão/bobina) ainda não chegou, e a OS está aguardando liberação.
- **Sistema_Backend**: API backend (Fastify + Prisma) do VisioFab.Wms.Back.
- **Sistema_Frontend**: Aplicação frontend (Next.js + Mantine) do VisioFab.Wms.Front.

## Requirements

### Requirement 1: Adicionar campo tipoMaquina ao modelo CentroProducao

**User Story:** As a administrador do PCP, I want to classificar centros de produção por tipo de máquina (Impressão, Acabamento, Cortadeira, Colagem, Verniz), so that o sistema agrupe corretamente as máquinas nas abas da Programação sem depender de palavras-chave na descrição.

#### Acceptance Criteria

1. THE Sistema_Backend SHALL include a nullable field `tipoMaquina` of type VarChar(20) on the CentroProducao model, accepting values: IMPRESSAO, ACABAMENTO, CORTADEIRA, COLAGEM, VERNIZ.
2. WHEN a CentroProducao has `tipo` equal to "MAQUINA", THE Sistema_Backend SHALL accept the `tipoMaquina` field in create and update requests.
3. WHEN a CentroProducao has `tipo` different from "MAQUINA", THE Sistema_Backend SHALL ignore the `tipoMaquina` field and store it as null.
4. THE Sistema_Backend SHALL include `tipoMaquina` in list and detail responses for CentroProducao.
5. THE Sistema_Backend SHALL support filtering CentroProducao list by `tipoMaquina` query parameter.

### Requirement 2: Migrar centros existentes com base em heurística de descrição

**User Story:** As a administrador do PCP, I want que centros de produção já cadastrados sejam automaticamente classificados com o tipoMaquina correto, so that o sistema funcione imediatamente após o deploy sem necessidade de reclassificação manual.

#### Acceptance Criteria

1. WHEN the database migration runs, THE Sistema_Backend SHALL populate `tipoMaquina` for existing CentroProducao records where `tipo` equals "MAQUINA", using keyword matching on the `descricao` field.
2. THE Sistema_Backend SHALL classify CentroProducao as IMPRESSAO when the `descricao` contains any of: "impress", "heidelberg", "offset".
3. THE Sistema_Backend SHALL classify CentroProducao as CORTADEIRA when the `descricao` contains any of: "corta", "cortadeira", "makpel", "guilhotina".
4. THE Sistema_Backend SHALL classify CentroProducao as ACABAMENTO when the `descricao` contains any of: "bobst", "aft", "colagem", "verniz", "acabamento", "dobra", "cola".
5. WHEN no keyword matches are found for a CentroProducao, THE Sistema_Backend SHALL leave `tipoMaquina` as null for that record.

### Requirement 3: Seleção de tipoMaquina na importação de OP (wizard step 4)

**User Story:** As a operador de PCP, I want to selecionar o tipo de máquina (Cortadeira, Impressão, Acabamento, Colagem, Verniz) para cada centro durante a importação de OP via PDF, so that novos centros criados automaticamente já fiquem classificados corretamente.

#### Acceptance Criteria

1. WHEN the wizard displays Step 4 (Centros/Máquinas), THE Sistema_Frontend SHALL show a select field "Tipo Máquina" for each centro with options: IMPRESSAO, ACABAMENTO, CORTADEIRA, COLAGEM, VERNIZ.
2. WHEN a centro is marked to be created (`criar` = true), THE Sistema_Frontend SHALL require the selection of a `tipoMaquina` value.
3. WHEN the import confirmation request is sent, THE Sistema_Frontend SHALL include the `tipoMaquina` field for each centro in the payload.
4. WHEN the backend processes the import confirmation, THE Sistema_Backend SHALL persist the `tipoMaquina` value on newly created CentroProducao records.
5. WHEN a centro is already linked to an existing record (`centroIdVinculado` is not null), THE Sistema_Frontend SHALL pre-fill the `tipoMaquina` select with the existing centro's `tipoMaquina` value.

### Requirement 4: Programação filtra por tipoMaquina ao invés de keywords na descrição

**User Story:** As a operador de PCP, I want que o painel de Programação agrupe os centros nas abas (Cortadeira, Impressão, Acabamento) usando o campo tipoMaquina, so that a classificação seja determinística e não dependa de convenções de nomenclatura.

#### Acceptance Criteria

1. WHEN the Programação page loads data, THE Sistema_Backend SHALL include the `tipoMaquina` field in the painel response for each centro.
2. WHEN the user selects the "Cortadeira" tab, THE Sistema_Frontend SHALL display only centros where `tipoMaquina` equals "CORTADEIRA".
3. WHEN the user selects the "Impressão" tab, THE Sistema_Frontend SHALL display only centros where `tipoMaquina` equals "IMPRESSAO".
4. WHEN the user selects the "Acabamento" tab, THE Sistema_Frontend SHALL display only centros where `tipoMaquina` is one of: "ACABAMENTO", "COLAGEM", "VERNIZ".
5. WHEN the user selects the "Todos" tab, THE Sistema_Frontend SHALL display all centros regardless of `tipoMaquina`.
6. WHEN a CentroProducao has `tipoMaquina` as null, THE Sistema_Frontend SHALL display it only in the "Todos" tab.

### Requirement 5: Seção "Aguardando Cartão" exibida na aba correta

**User Story:** As a operador de PCP, I want que a seção "Aguardando Cartão" seja exibida na aba correspondente ao tipoMaquina da primeira etapa da OP, so that eu encontre as OPs aguardando material no contexto correto.

#### Acceptance Criteria

1. WHEN the painel data is loaded, THE Sistema_Backend SHALL include the `tipoMaquina` of the first pending etapa's CentroProducao for each item in `aguardandoCartao`.
2. WHEN an OP "Aguardando Cartão" has its first etapa linked to a CentroProducao with `tipoMaquina` equals "CORTADEIRA", THE Sistema_Frontend SHALL display the OP in the "Cortadeira" tab's aguardando section.
3. WHEN an OP "Aguardando Cartão" has its first etapa linked to a CentroProducao with `tipoMaquina` equals "IMPRESSAO", THE Sistema_Frontend SHALL display the OP in the "Impressão" tab's aguardando section.
4. WHEN an OP "Aguardando Cartão" has its first etapa linked to a CentroProducao with `tipoMaquina` in (ACABAMENTO, COLAGEM, VERNIZ), THE Sistema_Frontend SHALL display the OP in the "Acabamento" tab's aguardando section.
5. WHEN the "Todos" tab is active, THE Sistema_Frontend SHALL display all OPs "Aguardando Cartão" regardless of `tipoMaquina`.

### Requirement 6: Cadastro de centros permite seleção de tipoMaquina

**User Story:** As a administrador do PCP, I want to definir o tipoMaquina ao cadastrar ou editar um centro de produção, so that eu possa classificar manualmente centros novos ou corrigir classificações incorretas.

#### Acceptance Criteria

1. WHEN the user opens the CentroProducao form with `tipo` set to "MAQUINA", THE Sistema_Frontend SHALL display a select field "Tipo de Máquina" with options: IMPRESSAO, ACABAMENTO, CORTADEIRA, COLAGEM, VERNIZ.
2. WHEN the user sets `tipo` to "SETOR" or "LINHA", THE Sistema_Frontend SHALL hide the "Tipo de Máquina" select field.
3. WHEN the user submits the CentroProducao form with `tipo` equal to "MAQUINA", THE Sistema_Frontend SHALL include the `tipoMaquina` field in the API request.
4. THE Sistema_Backend SHALL validate that `tipoMaquina` is one of the allowed enum values when provided.
5. IF an invalid `tipoMaquina` value is submitted, THEN THE Sistema_Backend SHALL return a 400 error with a descriptive message.

### Requirement 7: Criação de novo grupo na Programação inclui tipoMaquina

**User Story:** As a operador de PCP, I want que ao criar um novo grupo (centro) diretamente pela Programação, o sistema atribua o tipoMaquina correto com base na aba ativa, so that o novo grupo apareça imediatamente na aba correta.

#### Acceptance Criteria

1. WHEN the user clicks "Novo Grupo" while on the "Cortadeira" tab, THE Sistema_Frontend SHALL pre-select `tipoMaquina` as "CORTADEIRA" in the creation form.
2. WHEN the user clicks "Novo Grupo" while on the "Impressão" tab, THE Sistema_Frontend SHALL pre-select `tipoMaquina` as "IMPRESSAO" in the creation form.
3. WHEN the user clicks "Novo Grupo" while on the "Acabamento" tab, THE Sistema_Frontend SHALL pre-select `tipoMaquina` as "ACABAMENTO" in the creation form.
4. WHEN the user clicks "Novo Grupo" while on the "Todos" tab, THE Sistema_Frontend SHALL require manual selection of `tipoMaquina` in the creation form.
5. WHEN creating a new grupo, THE Sistema_Frontend SHALL send the `tipoMaquina` field to the backend along with the other centro fields.
