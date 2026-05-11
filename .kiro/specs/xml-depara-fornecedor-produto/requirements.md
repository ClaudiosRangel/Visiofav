# Requirements Document

## Introduction

Este documento especifica os requisitos para a funcionalidade de De-Para (Amarração) Fornecedor x Produto no sistema VisioFab WMS. A funcionalidade permite mapear códigos de produtos de fornecedores para produtos internos do sistema durante a importação de XML de NF-e, incluindo conversão de unidades de medida. O objetivo é eliminar o cadastro automático não confiável e garantir que cada item importado seja corretamente vinculado a um produto interno, com persistência do mapeamento para importações futuras.

## Glossary

- **Sistema**: A aplicação WMS VisioFab (backend Fastify + frontend Next.js)
- **Empresa**: Entidade tenant no sistema multi-tenant
- **Fornecedor**: Entidade representando um fornecedor com CNPJ, vinculado a uma Empresa
- **Produto**: Entidade representando um produto interno do estoque, com código, nome e cEAN
- **SKU**: Variação de embalagem de um Produto, contendo codigoBarra e unidade
- **De_Para**: Registro de mapeamento entre código de produto do fornecedor e produto interno do sistema
- **XML_NF_e**: Arquivo XML no formato da Nota Fiscal Eletrônica brasileira
- **cEAN**: Código EAN Comercial presente no XML (código de barras da unidade faturada, ex: DUN-14 de uma caixa)
- **cEANTrib**: Código EAN Tributável presente no XML (código de barras da menor unidade tributável, ex: EAN-13 de uma lata)
- **cProd**: Código do produto utilizado pelo fornecedor no XML da NF-e
- **Fator_Conversao**: Multiplicador que converte a quantidade da unidade do fornecedor para a unidade interna do estoque
- **Usuário**: Usuário autenticado do sistema

## Requirements

### Requirement 1: Modelo de Dados De-Para Fornecedor x Produto

**User Story:** Como administrador do WMS, eu quero que o sistema persista o mapeamento entre códigos de produtos de fornecedores e produtos internos, para que importações futuras do mesmo fornecedor sejam resolvidas automaticamente.

#### Acceptance Criteria

1. THE Sistema SHALL store a De_Para record with fields: id, empresaId, fornecedorId, codigoProdutoFornecedor (cProd), descricaoFornecedor, produtoId, skuId (optional), unidadeFornecedor, fatorConversao, cEAN (optional), cEANTrib (optional), status, criadoEm, atualizadoEm
2. THE Sistema SHALL enforce uniqueness of the combination (empresaId, fornecedorId, codigoProdutoFornecedor) in the De_Para table
3. THE Sistema SHALL store the fatorConversao as a decimal value with precision of 4 decimal places
4. THE Sistema SHALL set the default value of fatorConversao to 1 when not explicitly provided
5. THE Sistema SHALL set the default value of status to true (active) when creating a De_Para record

---

### Requirement 2: Extração de EAN Comercial e EAN Tributável do XML

**User Story:** Como operador de recebimento, eu quero que o sistema extraia ambos os códigos EAN (comercial e tributável) do XML da NF-e, para que a busca por produto interno utilize todas as informações disponíveis.

#### Acceptance Criteria

1. WHEN an XML NF-e is parsed, THE Sistema SHALL extract the cEAN field (EAN Comercial) from each item element
2. WHEN an XML NF-e is parsed, THE Sistema SHALL extract the cEANTrib field (EAN Tributável) from each item element
3. WHEN the cEAN value is "SEM GTIN" or empty, THE Sistema SHALL treat it as null
4. WHEN the cEANTrib value is "SEM GTIN" or empty, THE Sistema SHALL treat it as null
5. THE Sistema SHALL return both cEAN and cEANTrib in the parsed item response alongside the existing fields (codigoProduto, descricao, unidade, quantidade, valorUnitario)
6. WHEN an XML NF-e is parsed, THE Sistema SHALL also extract the unidade tributável (uTrib) and quantidade tributável (qTrib) from each item element

---

### Requirement 3: Resolução Automática de Produto por Prioridade

**User Story:** Como operador de recebimento, eu quero que o sistema tente resolver automaticamente cada item do XML para um produto interno seguindo uma ordem de prioridade, para que itens já mapeados não exijam intervenção manual.

#### Acceptance Criteria

1. WHEN an XML item is being resolved, THE Sistema SHALL first search for an active De_Para record matching the fornecedorId and codigoProdutoFornecedor (cProd) within the same Empresa
2. WHEN no De_Para record is found and cEANTrib is available, THE Sistema SHALL search for a Produto with matching cEAN or a SKU with matching codigoBarra within the same Empresa
3. WHEN no match is found by cEANTrib and cEAN is available, THE Sistema SHALL search for a Produto with matching cEAN or a SKU with matching codigoBarra within the same Empresa
4. WHEN a match is found via De_Para, THE Sistema SHALL return the mapped produtoId, skuId, and fatorConversao
5. WHEN a match is found via EAN search, THE Sistema SHALL return the matched produtoId and skuId with fatorConversao equal to 1
6. WHEN no match is found by any method, THE Sistema SHALL flag the item as "pendente de amarração" (pending mapping)
7. THE Sistema SHALL process all items in the XML and return a consolidated result indicating which items were resolved and which are pending

---

### Requirement 4: Interface de Amarração Manual

**User Story:** Como operador de recebimento, eu quero uma tela para vincular itens não resolvidos a produtos internos e definir a conversão de unidades, para que eu possa completar a importação de forma controlada.

#### Acceptance Criteria

1. WHEN items are flagged as pending mapping, THE Sistema SHALL provide an API endpoint that returns the list of pending items with: codigoProdutoFornecedor, descricaoFornecedor, unidadeFornecedor, quantidade, cEAN, cEANTrib
2. THE Sistema SHALL provide an API endpoint to create a De_Para record linking a pending item to an internal Produto
3. WHEN creating a De_Para, THE Sistema SHALL accept: fornecedorId, codigoProdutoFornecedor, descricaoFornecedor, produtoId, skuId (optional), unidadeFornecedor, fatorConversao, cEAN (optional), cEANTrib (optional)
4. THE Sistema SHALL validate that the provided produtoId exists and belongs to the same Empresa
5. IF a skuId is provided, THEN THE Sistema SHALL validate that the SKU belongs to the specified Produto
6. THE Sistema SHALL provide an API endpoint to search Produtos by name, código, or cEAN for the mapping selection interface
7. WHEN a De_Para is created, THE Sistema SHALL immediately re-resolve the pending item using the new mapping and return the resolved result

---

### Requirement 5: Conversão de Unidades no Mapeamento

**User Story:** Como operador de recebimento, eu quero definir o fator de conversão entre a unidade do fornecedor e a unidade interna, para que as quantidades sejam corretamente convertidas ao dar entrada no estoque.

#### Acceptance Criteria

1. WHEN a De_Para record is used to resolve an item, THE Sistema SHALL calculate the converted quantity as: quantidadeOriginal multiplied by fatorConversao
2. THE Sistema SHALL return both the original quantity (from XML) and the converted quantity in the resolution result
3. THE Sistema SHALL return the internal unit of measure (from Produto or SKU) alongside the converted quantity
4. WHEN the fatorConversao is 1, THE Sistema SHALL treat the quantities as equivalent without conversion
5. IF the calculated converted quantity results in a non-integer value for a unit that requires integers, THEN THE Sistema SHALL flag a warning but not block the operation

---

### Requirement 6: CRUD de Mapeamentos De-Para

**User Story:** Como administrador do WMS, eu quero gerenciar os mapeamentos De-Para existentes, para que eu possa corrigir, desativar ou consultar amarrações previamente cadastradas.

#### Acceptance Criteria

1. THE Sistema SHALL provide an API endpoint to list all De_Para records for the authenticated Empresa with pagination (page, limit)
2. THE Sistema SHALL support filtering De_Para records by: fornecedorId, produtoId, codigoProdutoFornecedor, and status
3. THE Sistema SHALL provide an API endpoint to retrieve a single De_Para record by its identifier
4. THE Sistema SHALL provide an API endpoint to update a De_Para record's produtoId, skuId, fatorConversao, and status fields
5. WHEN a De_Para record is deactivated (status set to false), THE Sistema SHALL exclude it from automatic resolution searches
6. THE Sistema SHALL scope all De_Para operations to the authenticated user's Empresa (multi-tenant isolation)
7. IF an update to a De_Para changes the produtoId, THEN THE Sistema SHALL validate that the new Produto belongs to the same Empresa

---

### Requirement 7: Fluxo Completo de Importação com De-Para

**User Story:** Como operador de recebimento, eu quero que o fluxo de importação de XML integre a resolução automática e a amarração manual em um processo contínuo, para que eu possa importar notas de forma eficiente.

#### Acceptance Criteria

1. WHEN an XML NF-e is uploaded, THE Sistema SHALL parse the XML, extract all items with cEAN and cEANTrib, and attempt automatic resolution for each item
2. THE Sistema SHALL return a response containing: parsed NF header data, list of resolved items (with produtoId, skuId, fatorConversao, converted quantity), and list of pending items (requiring manual mapping)
3. WHEN all items are resolved (either automatically or after manual mapping), THE Sistema SHALL allow the user to proceed with the nota de entrada creation
4. IF the user submits a nota de entrada with pending items, THEN THE Sistema SHALL reject the submission with a message listing the unresolved items
5. WHEN a De_Para is created during the import flow, THE Sistema SHALL persist it for future imports from the same Fornecedor
6. THE Sistema SHALL identify the Fornecedor from the XML emitente CNPJ and auto-create the Fornecedor record if it does not exist in the Empresa

---

### Requirement 8: Vinculação a Produto Existente vs Criação de Novo Produto

**User Story:** Como operador de recebimento, eu quero poder escolher entre vincular a um produto existente ou criar um novo produto durante a amarração, para que eu tenha flexibilidade no cadastro.

#### Acceptance Criteria

1. THE Sistema SHALL provide an API endpoint to create a new Produto and immediately create a De_Para linking the pending item to the new Produto in a single transaction
2. WHEN creating a new Produto via the mapping flow, THE Sistema SHALL pre-fill the Produto fields with data from the XML item: nome (from xProd), cEAN (from cEANTrib or cEAN), ncm (from NCM), unidade (from uTrib or uCom)
3. THE Sistema SHALL allow the user to modify the pre-filled values before confirming the Produto creation
4. WHEN a new Produto is created via the mapping flow, THE Sistema SHALL also create a default SKU (sequencia 1) with the unit and barcode from the XML
5. IF the user chooses to link to an existing Produto, THEN THE Sistema SHALL only create the De_Para record without modifying the existing Produto

---

### Requirement 9: Tratamento de Erros e Validações

**User Story:** Como operador de recebimento, eu quero que o sistema valide os dados e apresente mensagens claras de erro, para que eu possa corrigir problemas durante a importação.

#### Acceptance Criteria

1. IF a De_Para creation request contains a duplicate combination of (empresaId, fornecedorId, codigoProdutoFornecedor), THEN THE Sistema SHALL return a conflict error with a message indicating the mapping already exists for that supplier and product code
2. IF the XML file is malformed or does not contain valid NF-e structure, THEN THE Sistema SHALL return a descriptive error message indicating the parsing failure
3. IF the fatorConversao is zero or negative, THEN THE Sistema SHALL reject the De_Para creation with a validation error
4. IF the fornecedorId does not exist or does not belong to the same Empresa, THEN THE Sistema SHALL return a not-found error
5. WHEN multiple SKUs of a Produto match the same EAN code, THE Sistema SHALL return the first match ordered by sequencia and flag a warning about multiple matches

