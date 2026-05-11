# Implementation Plan: De-Para / Amarração Fornecedor x Produto

## Overview

Plano de implementação para a funcionalidade de De-Para (Amarração) entre códigos de produtos de fornecedores e produtos internos do sistema VisioFab WMS. A implementação segue ordem incremental: modelo de dados e migração → serviço de resolução (lógica pura) → rotas backend CRUD → rotas do fluxo de importação → hooks frontend → páginas e componentes frontend.

## Tasks

- [x] 1. Criar modelo Prisma e migração de banco de dados
  - [x] 1.1 Adicionar modelo DeparaProdutoFornecedor ao schema Prisma
    - Criar model `DeparaProdutoFornecedor` com campos: id, empresaId, fornecedorId, codigoProdutoFornecedor, descricaoFornecedor, produtoId, skuId, unidadeFornecedor, fatorConversao (Decimal 12,4 default 1), cEAN, cEANTrib, status (default true), criadoEm, atualizadoEm
    - Adicionar constraint `@@unique([empresaId, fornecedorId, codigoProdutoFornecedor])` e `@@map("depara_produto_fornecedor")`
    - Adicionar índices: `@@index([empresaId, fornecedorId])`, `@@index([produtoId])`
    - Adicionar relações com Empresa, Fornecedor e Produto
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 1.2 Adicionar relações inversas nos modelos existentes
    - Adicionar campo `deparasProdutoFornecedor DeparaProdutoFornecedor[]` no model Empresa
    - Adicionar campo `deparasProduto DeparaProdutoFornecedor[]` no model Fornecedor
    - Adicionar campo `deparasFornecedor DeparaProdutoFornecedor[]` no model Produto
    - _Requirements: 1.1_

  - [x] 1.3 Criar migração SQL para produção
    - Criar arquivo em `prisma/migrations/` com SQL usando padrão `ALTER TABLE IF NOT EXISTS`
    - Criar tabela `depara_produto_fornecedor` com todas as colunas, constraints e índices
    - Executar `npx prisma generate` para atualizar o client
    - _Requirements: 1.1, 1.2_

- [x] 2. Implementar parser XML aprimorado
  - [x] 2.1 Estender função parseNfeXml para extrair campos EAN
    - Modificar `src/modules/nota-entrada/importar-xml.routes.ts` (ou extrair para arquivo separado)
    - Extrair campos adicionais de cada item: cEAN, cEANTrib, uTrib, qTrib
    - Normalizar valores "SEM GTIN" e strings vazias para null
    - Manter compatibilidade com o formato de retorno atual
    - Exportar a função parseNfeXml para uso em outros módulos
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ]* 2.2 Escrever teste de propriedade para extração e normalização do XML
    - **Property 1: Extração e Normalização do XML**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**

- [x] 3. Implementar serviço de resolução (lógica pura)
  - [x] 3.1 Criar resolution.service.ts com função resolveItems
    - Criar `src/modules/depara-fornecedor/resolution.service.ts`
    - Implementar interfaces: XmlItem, ResolvedItem, PendingItem, ResolutionResult
    - Implementar função pura `resolveItems(items, deparas, produtos, skus)` com cadeia de prioridade: De-Para → cEANTrib → cEAN → pendente
    - Implementar cálculo de quantidade convertida: `quantidadeOriginal * fatorConversao`
    - Para match via EAN, retornar fatorConversao = 1
    - Para múltiplos SKUs com mesmo EAN, selecionar o de menor `sequencia`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 5.1, 5.2, 5.3, 5.4_

  - [ ]* 3.2 Escrever teste de propriedade para cadeia de prioridade na resolução
    - **Property 2: Cadeia de Prioridade na Resolução**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

  - [ ]* 3.3 Escrever teste de propriedade para correção da conversão de quantidade
    - **Property 3: Correção da Conversão de Quantidade**
    - **Validates: Requirements 5.1, 5.2, 5.3**

  - [ ]* 3.4 Escrever teste de propriedade para isolamento multi-tenant na resolução
    - **Property 5: Isolamento Multi-Tenant na Resolução**
    - **Validates: Requirements 6.5, 6.6**

  - [ ]* 3.5 Escrever teste de propriedade para determinismo na seleção de SKU
    - **Property 8: Determinismo na Seleção de SKU**
    - **Validates: Requirements 9.5**

- [x] 4. Checkpoint — Verificar lógica pura de resolução
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implementar rotas CRUD do De-Para
  - [x] 5.1 Criar depara-fornecedor.routes.ts com endpoints CRUD
    - Criar `src/modules/depara-fornecedor/depara-fornecedor.routes.ts`
    - Implementar `GET /api/depara-fornecedor` — listagem paginada com filtros (fornecedorId, produtoId, codigoProdutoFornecedor, status)
    - Implementar `GET /api/depara-fornecedor/:id` — detalhe de um registro
    - Implementar `POST /api/depara-fornecedor` — criar mapeamento com validações (produtoId existe na empresa, skuId pertence ao produto, fatorConversao > 0, unicidade)
    - Implementar `PUT /api/depara-fornecedor/:id` — atualizar mapeamento (produtoId, skuId, fatorConversao, status)
    - Implementar `DELETE /api/depara-fornecedor/:id` — excluir mapeamento
    - Todas as operações escopadas por empresaId do usuário autenticado
    - Capturar erros Prisma P2002 (unicidade) → 409, P2003 (FK) → 404
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 9.1, 9.3, 9.4_

  - [x] 5.2 Registrar rotas do módulo depara-fornecedor em src/server.ts
    - Importar `deparaFornecedorRoutes` de `./modules/depara-fornecedor/depara-fornecedor.routes`
    - Registrar com `app.register(deparaFornecedorRoutes, { prefix: '/api/depara-fornecedor' })`
    - _Requirements: 6.1_

  - [ ]* 5.3 Escrever teste de propriedade para unicidade do mapeamento
    - **Property 4: Unicidade do Mapeamento**
    - **Validates: Requirements 1.2, 9.1**

  - [ ]* 5.4 Escrever teste de propriedade para validação do fator de conversão
    - **Property 7: Validação do Fator de Conversão**
    - **Validates: Requirements 1.3, 9.3**

  - [ ]* 5.5 Escrever teste de propriedade para correção dos filtros de listagem
    - **Property 6: Correção dos Filtros de Listagem**
    - **Validates: Requirements 6.2**

- [x] 6. Implementar rotas do fluxo de importação com De-Para
  - [x] 6.1 Criar importar-xml-depara.routes.ts
    - Criar `src/modules/nota-entrada/importar-xml-depara.routes.ts`
    - Implementar `POST /api/notas-entrada/importar-xml-depara`:
      - Receber upload de XML via multipart
      - Parsear XML com parseNfeXml aprimorado
      - Identificar fornecedor pelo CNPJ do emitente; auto-criar se não existir na empresa
      - Buscar De-Paras ativos, Produtos e SKUs da empresa
      - Chamar resolveItems() para resolver itens
      - Retornar: header da NF, lista de resolvidos, lista de pendentes
    - _Requirements: 7.1, 7.2, 7.5, 7.6_

  - [x] 6.2 Implementar endpoint criar-produto-depara
    - Implementar `POST /api/notas-entrada/criar-produto-depara`:
      - Receber dados do novo produto + dados do De-Para
      - Em transação Prisma: criar Produto, criar SKU default (sequencia 1), criar De-Para
      - Pré-preencher campos do Produto a partir do XML (nome, cEAN, ncm, unidade)
      - Retornar produto criado + De-Para criado
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 6.3 Registrar rotas de importação com De-Para em src/server.ts
    - Importar `importarXmlDeparaRoutes` de `./modules/nota-entrada/importar-xml-depara.routes`
    - Registrar com `app.register(importarXmlDeparaRoutes, { prefix: '/api/notas-entrada' })`
    - _Requirements: 7.1_

  - [ ]* 6.4 Escrever teste de propriedade para rejeição de submissão com itens pendentes
    - **Property 9: Rejeição de Submissão com Itens Pendentes**
    - **Validates: Requirements 7.4**

  - [ ]* 6.5 Escrever teste de propriedade para vinculação preserva produto existente
    - **Property 10: Vinculação Preserva Produto Existente**
    - **Validates: Requirements 8.5**

- [x] 7. Checkpoint — Verificar backend completo
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implementar hooks e API client no frontend
  - [x] 8.1 Criar hooks de De-Para no frontend
    - Criar `src/data/hooks/useDepara.ts` no projeto VisioFab.Web
    - Implementar `useDepara(filtros)` — query paginada com filtros (fornecedorId, produtoId, status)
    - Implementar `useDeparaCreate()` — mutation POST /api/depara-fornecedor
    - Implementar `useDeparaUpdate()` — mutation PUT /api/depara-fornecedor/:id
    - Implementar `useDeparaDelete()` — mutation DELETE /api/depara-fornecedor/:id
    - Implementar `useImportarXmlDepara()` — mutation POST /api/notas-entrada/importar-xml-depara (multipart)
    - Implementar `useCriarProdutoDepara()` — mutation POST /api/notas-entrada/criar-produto-depara
    - _Requirements: 4.1, 4.2, 4.3, 6.1, 7.1, 8.1_

- [x] 9. Implementar página de gerenciamento de De-Para
  - [x] 9.1 Criar página de listagem de mapeamentos De-Para
    - Criar `src/app/(interna)/cadastros/depara-fornecedor/page.tsx` no projeto VisioFab.Web
    - Tabela com colunas: fornecedor, código produto fornecedor, descrição fornecedor, produto interno, unidade, fator conversão, status
    - Paginação e filtros: fornecedor (select), produto (autocomplete), código, status
    - Ações: editar, desativar/ativar, excluir
    - Botão "Novo De-Para" abrindo modal de criação
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 9.2 Criar modal de criação/edição de De-Para
    - Campos: fornecedor (select), código produto fornecedor, descrição fornecedor, produto interno (autocomplete com busca), SKU (select dependente do produto), unidade fornecedor, fator de conversão, cEAN, cEANTrib, status
    - Validação com react-hook-form + Zod
    - Feedback de erro para duplicata (409)
    - _Requirements: 4.3, 4.4, 4.5, 6.4, 6.7, 9.1, 9.3_

- [x] 10. Implementar modal de amarração manual no fluxo de importação
  - [x] 10.1 Criar componente PendingMappingModal
    - Criar `src/components/depara/PendingMappingModal.tsx` no projeto VisioFab.Web
    - Receber lista de itens pendentes como prop
    - Para cada item pendente exibir: código fornecedor, descrição, unidade, quantidade, cEAN, cEANTrib
    - Para cada item: autocomplete de produto interno com busca por nome/código/EAN
    - Campo de fator de conversão (default 1)
    - Opção "Criar novo produto" que abre sub-formulário com campos pré-preenchidos do XML
    - Botão "Vincular" que cria o De-Para e re-resolve o item
    - Indicador visual de progresso (X de Y itens resolvidos)
    - _Requirements: 4.1, 4.2, 4.3, 4.6, 4.7, 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 10.2 Integrar PendingMappingModal no fluxo de importação existente
    - Modificar a tela de importação de XML para usar o novo endpoint `/importar-xml-depara`
    - Após upload, se houver itens pendentes, abrir PendingMappingModal
    - Quando todos itens resolvidos, permitir prosseguir com criação da nota de entrada
    - Bloquear submissão enquanto houver itens pendentes
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 11. Final checkpoint — Verificar integração completa
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marcadas com `*` são opcionais e podem ser puladas para um MVP mais rápido
- Cada task referencia requirements específicos para rastreabilidade
- Checkpoints garantem validação incremental
- Testes de propriedade validam propriedades universais de corretude definidas no design (usar `fast-check`)
- A função `resolveItems` é pura (sem I/O), facilitando testes unitários e property-based testing
- Todas as operações que modificam múltiplas tabelas devem usar `prisma.$transaction()`
- O projeto usa TypeScript em todo o stack (backend Fastify + frontend Next.js)
- Migração de produção usa padrão `ALTER TABLE IF NOT EXISTS` em `prisma/migrate-prod.ts`
