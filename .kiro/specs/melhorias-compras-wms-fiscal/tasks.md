# Implementation Plan: Melhorias Compras, WMS e Fiscal

## Overview

Este plano implementa cinco melhorias independentes (Transporte via XML, Código sequencial de Produto + SKU via GTIN, Seed Fiscal, Kardex de estoque e Liberação de conferência por senha de Supervisor) sobre o backend Fastify + Prisma existente. A abordagem é incremental: primeiro a migração de banco de dados (todos os campos/models novos em um único commit, conforme `.kiro/steering/database-migrations.md`), depois cada melhoria é implementada como um bloco próprio (lógica pura testável → serviço com I/O → testes de propriedade → wiring nos pontos de integração existentes), com checkpoints entre blocos. As cinco melhorias tocam módulos distintos e podem ser trabalhadas em paralelo depois que a migração estiver pronta.

Linguagem de implementação: TypeScript (Fastify + Prisma + Zod), conforme já usado no projeto. Biblioteca de PBT: **fast-check**, mínimo de 100 iterações por teste de propriedade.

## Tasks

- [x] 1. Configurar modelos Prisma e migração de banco de dados
  - [x] 1.1 Adicionar novos campos e models ao schema.prisma
    - `NotaEntrada`: adicionar `transportadoraUf` (VarChar 2) e `transportadoraRntc` (VarChar 20)
    - `AgendaWms`: adicionar `divergenciaTransporte` (VarChar 500) e `supervisorLiberacaoId` (String?, sem FK obrigatória)
    - `Produto`: adicionar `motivoFalhaEnriquecimentoSku` (Text?)
    - Criar model `SequenciaProduto` (id, empresaId único, proximoValor Int default 1, atualizadoEm) com relação para `Empresa`
    - Criar model `MovimentacaoEstoque` (id, empresaId, produtoId, tipo VarChar 30, quantidade Decimal(12,4), saldoAnterior, saldoPosterior, origemId?, criadoEm) com índice composto `@@index([empresaId, produtoId, criadoEm])` e relações para `Empresa`/`Produto`
    - _Requirements: 1.1, 1.6, 2.1, 2.10, 4.1, 5.3_

  - [x] 1.2 Atualizar prisma/migrate-prod.ts com as alterações equivalentes
    - Adicionar `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` para os novos campos de `NotaEntrada`, `AgendaWms` e `Produto`
    - Adicionar `CREATE TABLE IF NOT EXISTS` para `sequencia_produto` e `movimentacao_estoque`, com `CREATE INDEX IF NOT EXISTS` correspondente
    - Adicionar as FKs (`ADD CONSTRAINT`) de `sequencia_produto.empresa_id`, `movimentacao_estoque.empresa_id` e `movimentacao_estoque.produto_id`, cada uma em bloco `try/catch` individual, seguindo o padrão idempotente já existente no arquivo
    - _Requirements: 1.1, 1.6, 2.1, 2.10, 4.1, 5.3_

  - [x] 1.3 Validar migração localmente
    - Executar `npx prisma migrate dev` e revisar o SQL gerado
    - Executar `npx tsx prisma/migrate-prod.ts` duas vezes seguidas contra o banco local, confirmando que roda sem erro nas duas execuções (idempotência)
    - _Requirements: 1.1, 1.6, 2.1, 2.10, 4.1, 5.3_

- [x] 2. Requirement 1 — Transporte via XML → AgendaWms
  - [x] 2.1 Implementar transporte-xml-parser.ts
    - Criar `src/modules/nota-entrada/transporte-xml-parser.ts` com `extrairBlocoTransporte(xml): DadosTransporteXml`
    - Extrair placa (até 8 chars), UF do veículo (2 chars), RNTC (até 20 chars) de `<veicTransp>` e nome do motorista (até 100 chars) de `<transporta><xNome>`
    - Retornar `null` para qualquer campo ausente, sem lançar exceção
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ]* 2.2 Write property test for transporte-xml-parser
    - **Property 1: Extração do bloco de transporte é determinística e tolerante a tags ausentes**
    - **Validates: Requirements 1.1, 1.2, 1.3**

  - [x] 2.3 Integrar extrairBlocoTransporte em nfe-xml-parser.ts e persistir na NotaEntrada
    - `parseNfeXml` em `src/modules/nota-entrada/nfe-xml-parser.ts` JÁ inclui `transporte: DadosTransporteXml` no resultado, usando o parser compartilhado (feito)
    - CORREÇÃO DE ESCOPO (achado em execução anterior): `compra.routes.ts` NÃO cria `NotaEntrada` — a criação a partir do XML ocorre em `src/modules/agenda-wms/agenda-wms.routes.ts` (2 pontos: transições NA_DOCA e CONFERINDO) e `src/modules/agenda/agenda.service.ts` (`criarNotaEntradaDoXml`, transição NA_DOCA). Ambos usam regex local duplicada em vez de `parseNfeXml`/`extrairBlocoTransporte` (violação do Requirement 1.7) e não persistem `transportadoraUf`/`transportadoraRntc`
    - PENDENTE: nos dois pontos de `agenda-wms.routes.ts` e no `criarNotaEntradaDoXml` de `agenda.service.ts`, substituir a extração via regex local por `parseNfeXml` (que já inclui `transporte`), e persistir `transportadoraUf: parsed.transporte.ufVeiculo` / `transportadoraRntc: parsed.transporte.rntc` na criação da `NotaEntrada`, independentemente de `Empresa.usaWms`
    - `portaria.routes.ts` (`criarNotaEntradaSeNecessario`) já faz isso corretamente — usar como referência de padrão
    - _Requirements: 1.1, 1.3, 1.5, 1.7_

  - [x] 2.4 Implementar funções puras de sincronização de transporte
    - Criar `src/modules/agenda-wms/transporte-sync.service.ts` com `normalizarPlaca(placa)` e `calcularAtualizacaoTransporte(atual, extraido): ResultadoSincronizacao`
    - Preencher `motorista`/`placa` apenas quando o campo atual é `null`; registrar `divergenciaTransporte` (≤500 chars, com nome do campo, valor extraído e data/hora) quando as placas normalizadas diferem, preservando o valor manual
    - _Requirements: 1.4, 1.6_

  - [ ]* 2.5 Write property test for preenchimento automático de transporte
    - **Property 2: Preenchimento automático de transporte respeita campos já preenchidos**
    - **Validates: Requirements 1.4**

  - [ ]* 2.6 Write property test for divergência de placa
    - **Property 3: Divergência de placa é registrada apenas quando as placas diferem após normalização**
    - **Validates: Requirements 1.6**

  - [x] 2.7 Implementar sincronizarDadosTransporte (I/O) e integrar nos pontos de importação/agenda
    - Adicionar `sincronizarDadosTransporte(tx, empresaId, { pedidoCompraId?, fornecedorId? })` em `transporte-sync.service.ts`, localizando a `AgendaWms` e `NotaEntrada` mais recentes e aplicando `calcularAtualizacaoTransporte`, apenas quando `Empresa.usaWms = true`
    - Chamar essa função em `compra.routes.ts` (`POST /efetivar` e `POST /importar-xml`) após persistir a `NotaEntrada`
    - Chamar a mesma função nos pontos de criação/vinculação de `AgendaWms` a `pedidoCompraId`/`fornecedorId` (rotas de agenda/portaria), garantindo sincronização bidirecional
    - _Requirements: 1.4, 1.5, 1.6_

  - [x] 2.8 Adicionar extração de transporte em ai-executor.ts (não é duplicação a substituir — é ausência a corrigir)
    - CORREÇÃO DE ESCOPO (achado em execução anterior): `ai-executor.ts` não contém extração de transporte via regex duplicada. A função `executarImportarXmlComprasReal` (ponto de importação de XML de compra via IA) usa apenas regex local para extrair itens (`cProd`/`xProd`/etc.), sem nunca extrair placa/UF/RNTC/motorista — violando o Requirement 1.7 (implementação única usada por TODOS os pontos de importação)
    - PENDENTE: usar `extrairBlocoTransporte`/`parseNfeXml` (de `src/modules/nota-entrada/`) dentro de `executarImportarXmlComprasReal` para extrair os dados de transporte do XML, e persistir de forma consistente com os demais pontos de importação (ex.: se a função criar/atualizar uma `NotaEntrada`, persistir `transportadoraUf`/`transportadoraRntc`; caso não crie `NotaEntrada` diretamente, ao menos garantir que a extração seja feita via parser compartilhado para eventual uso futuro)
    - _Requirements: 1.7_

  - [ ]* 2.9 Write unit tests for parsing XML com casos concretos
    - Testar XML com todos os campos de transporte presentes, XML sem bloco `<transp>`, e XML com apenas parte dos campos
    - _Requirements: 1.1, 1.2, 1.3_

- [x] 3. Checkpoint — Validar Requirement 1
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Requirement 2 — Código sequencial de Produto + enriquecimento SKU via GTIN
  - [x] 4.1 Implementar codigo-sequencial.service.ts
    - Criar `src/modules/produto/codigo-sequencial.service.ts` com `gerarProximoCodigo(tx, empresaId): Promise<string>` via `UPDATE ... SET proximo_valor = proximo_valor + 1 WHERE empresa_id = $1 RETURNING proximo_valor - 1`
    - Formatar o resultado como string de 6 dígitos com zeros à esquerda; lançar `CodigoSequencialEsgotadoError` quando o valor exceder 999999, sem alterar `proximoValor`
    - _Requirements: 2.1, 2.2, 2.10_

  - [ ]* 4.2 Write property test for geração incremental de código sequencial
    - **Property 4: Geração de código sequencial de Produto é incremental, com 6 dígitos e zero-padding**
    - **Validates: Requirements 2.1**

  - [ ]* 4.3 Write property test for geração concorrente sem duplicados
    - **Property 5: Geração concorrente de código sequencial nunca produz duplicados**
    - **Validates: Requirements 2.2**

  - [ ]* 4.4 Write property test for esgotamento da faixa de códigos
    - **Property 9: Esgotamento da faixa de códigos sequenciais é sinalizado sem interromper os demais itens**
    - **Validates: Requirements 2.10**

  - [x] 4.5 Implementar validação de GTIN
    - Criar `gtinValido(valor): valor is string` em `src/modules/produto/produto-import.service.ts`, aceitando apenas 8/12/13/14 dígitos numéricos, rejeitando vazio e "SEM GTIN"
    - _Requirements: 2.4_

  - [x] 4.6 Implementar catalogo-externo.service.ts
    - Criar `src/modules/produto/catalogo-externo.service.ts` com `buscarCatalogoPorGtin(gtin, timeoutMs = 5000): Promise<DadosCatalogo | null>`, cliente HTTP para Cosmos Bluesoft usando `AbortController` para o timeout
    - Retornar `null` (sem lançar) em caso de indisponibilidade, erro de rede, timeout ou ausência de resultado
    - _Requirements: 2.4, 2.6_

  - [x] 4.7 Implementar resolverOuCriarProduto (orquestração)
    - Em `src/modules/produto/produto-import.service.ts` (arquivo já existe com `gtinValido`, task 4.5 — NÃO criar arquivo homônimo em `nota-entrada/`), implementar `resolverOuCriarProduto(tx, { item, fornecedorId, empresaId, usaWms })`
    - Passo 1: tentar resolução via `resolution.service.ts` (De-Para ativo por fornecedor+cProd, depois GTIN/EAN em Produto/SKU existente); se resolvido, retornar sem gerar código nem consultar catálogo
    - Passo 2: se não resolvido, chamar `gerarProximoCodigo` e criar o `Produto`
    - Passo 3: decidir SKU — se `usaWms=false`, criar SKU vazio (sequencia=1, unidade copiada do Produto) sem consultar catálogo; se `usaWms=true` e GTIN válido, consultar `buscarCatalogoPorGtin` e construir o SKU a partir do resultado (sucesso → campos copiados; falha/timeout → SKU vazio + `motivoFalhaEnriquecimentoSku`); se `usaWms=true` e GTIN inválido, criar SKU vazio sem consultar
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9_

  - [ ]* 4.8 Write property test for decisão de consulta ao catálogo externo
    - **Property 6: Consulta ao catálogo externo ocorre se e somente se usaWms=true, produto novo e GTIN válido**
    - **Validates: Requirements 2.4, 2.7, 2.9**

  - [ ]* 4.9 Write property test for construção do SKU
    - **Property 7: SKU resultante é sempre válido, com ou sem enriquecimento externo**
    - **Validates: Requirements 2.5, 2.6**

  - [ ]* 4.10 Write property test for itens resolvidos por De-Para/EAN
    - **Property 8: Itens resolvidos por De-Para ou EAN nunca geram novo código nem consultam o catálogo externo**
    - **Validates: Requirements 2.8**

  - [x] 4.11 Integrar produto-import.service.ts em compra.routes.ts
    - Modificar `POST /importar-xml` em `src/modules/compra/compra.routes.ts` para chamar `resolverOuCriarProduto` em vez de criar `Produto` com `codigo: item.cProd` diretamente
    - Ao capturar `CodigoSequencialEsgotadoError`, marcar apenas o item correspondente como pendente de resolução manual, sem interromper o processamento dos demais itens do XML
    - _Requirements: 2.1, 2.10_

  - [x] 4.12 Substituir duplicação equivalente em ai-executor.ts
    - Modificar `src/modules/ai/ai-executor.ts` para usar `produto-import.service.ts` em vez da lógica local de `codigo: item.cProd || ...`
    - _Requirements: 2.1, 2.3_

- [x] 5. Checkpoint — Validar Requirement 2
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Requirement 3 — Seed Fiscal (NCM/CFOP/CEST)
  - [x] 6.1 Implementar fonte-externa.service.ts
    - Criar `src/modules/fiscal/seed-fiscal/fonte-externa.service.ts` com `buscarDadosExternos(tabela): Promise<RegistroExterno[]>`, encapsulando a chamada HTTP à fonte oficial (mockável em testes)
    - _Requirements: 3.3_

  - [x] 6.2 Implementar seed-fiscal.service.ts
    - Criar `src/modules/fiscal/seed-fiscal/seed-fiscal.service.ts` com `seedTabela(tabela, registros): Promise<{ inseridos, ignorados }>`
    - Inserir apenas registros cujo `codigo` ainda não existe na tabela global (Ncm/Cfop/Cest); nunca alterar campos de registros existentes
    - Interromper o processamento da tabela na posição em que um registro tiver `codigo` ausente/formato inválido ou a fonte externa falhar, preservando os registros válidos já inseridos e retornando o motivo da falha
    - _Requirements: 3.3, 3.4, 3.5_

  - [ ]* 6.3 Write property test for idempotência do seed fiscal
    - **Property 10: Seed fiscal é idempotente e preserva registros existentes**
    - **Validates: Requirements 3.3, 3.4, 3.7**

  - [ ]* 6.4 Write property test for falha parcial do seed fiscal
    - **Property 11: Falha ou estrutura inválida da fonte externa interrompe apenas a tabela afetada, preservando o que já foi inserido**
    - **Validates: Requirements 3.5**

  - [x] 6.5 Implementar seed-fiscal.routes.ts
    - Criar `src/modules/fiscal/seed-fiscal/seed-fiscal.routes.ts` com `GET /contagem` (retorna contagem de registros ativos em Ncm/Cfop/Cest) e `POST /` (body `{ tabelas: ('NCM'|'CFOP'|'CEST')[] }`), ambas protegidas por `perfilGuard('ADMIN')`
    - Processar cada tabela selecionada com `Promise.race([seedTabela(...), timeout(60_000)])`, isoladamente, de forma que a falha/timeout de uma tabela não impeça o processamento das demais
    - Retornar, por tabela, `{ inseridos, ignorados }` em caso de sucesso ou `{ erro: { code, message } }` em caso de falha/timeout
    - _Requirements: 3.1, 3.6, 3.7, 3.8, 3.9, 3.10_

  - [x] 6.6 Registrar seedFiscalRoutes em fiscal.routes.ts
    - Registrar as rotas com prefixo `/cadastros/seed` em `src/modules/fiscal/fiscal.routes.ts`
    - _Requirements: 3.1_

  - [ ]* 6.7 Write integration tests for seed fiscal routes
    - Testar rejeição 403 para usuário não-ADMIN em `GET /contagem` e `POST /` (Requirement 3.10)
    - Testar timeout de 60s por tabela com latência controlada (Requirement 3.8, 3.9)
    - _Requirements: 3.8, 3.9, 3.10_

- [x] 7. Checkpoint — Validar Requirement 3
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Requirement 4 — Kardex de estoque para empresas sem WMS
  - [x] 8.1 Implementar funções puras de validação e cálculo
    - Criar `src/modules/estoque/movimentacao-estoque.service.ts` com `validarMovimentacao(input): string | null` (rejeita quantidade ≤ 0; exige `origemId` para todos os tipos exceto `AJUSTE_MANUAL`) e `calcularSaldoPosterior(saldoAnterior, quantidade, tipo): number`
    - _Requirements: 4.2, 4.3, 4.11_

  - [ ]* 8.2 Write property test for exigência de origem
    - **Property 12: Movimentação de estoque exige origem para todos os tipos exceto AJUSTE_MANUAL**
    - **Validates: Requirements 4.2**

  - [ ]* 8.3 Write property test for rejeição de quantidade não positiva
    - **Property 13: Movimentação com quantidade não positiva é sempre rejeitada sem efeito**
    - **Validates: Requirements 4.3**

  - [ ]* 8.4 Write property test for cálculo de saldo por tipo
    - **Property 14: Movimentação altera o saldo exatamente conforme o sentido do tipo, e apenas quando usaWms=false**
    - **Validates: Requirements 4.4, 4.5, 4.6, 4.8, 4.9**

  - [x] 8.6 Implementar registrarMovimentacao (transacional)
    - Implementar `registrarMovimentacao(tx, input): Promise<MovimentacaoEstoque>` em `movimentacao-estoque.service.ts`: valida via `validarMovimentacao`, faz upsert de `Estoque` e cria `MovimentacaoEstoque` na mesma transação Prisma
    - Permitir saldo posterior negativo em `SAIDA_VENDA` sem bloquear, sinalizando o saldo negativo no retorno
    - Propagar falha de qualquer etapa para reverter a transação por completo (nenhuma escrita parcial)
    - _Requirements: 4.1, 4.4, 4.5, 4.7, 4.8, 4.9, 4.10_

  - [ ]* 8.5 Write property test for venda com estoque insuficiente
    - **Property 15: Venda com estoque insuficiente é registrada mesmo assim, permitindo saldo negativo**
    - **Validates: Requirements 4.7**

  - [ ]* 8.7 Write property test for reversão de transação
    - **Property 16: Falha em qualquer etapa da transação reverte integralmente compra, venda ou devolução**
    - **Validates: Requirements 4.10**

  - [ ]* 8.8 Write property test for encadeamento de saldo do Kardex
    - **Property 17: Encadeamento de saldo do Kardex é consistente**
    - **Validates: Requirements 4.11**

  - [x] 8.9 Implementar kardex.routes.ts
    - Criar `src/modules/estoque/kardex.routes.ts` com `GET /kardex/:produtoId` (filtros opcionais `dataInicio`/`dataFim`, ordenação cronológica decrescente) e `GET /saldo/:produtoId`, escopados à Empresa autenticada
    - _Requirements: 4.12, 4.13_

  - [ ]* 8.10 Write property test for filtro e ordenação do Kardex
    - **Property 18: Consulta do Kardex filtra por data e ordena de forma decrescente**
    - **Validates: Requirements 4.12**

  - [x] 8.11 Integrar registrarMovimentacao em compra.routes.ts
    - Em `POST /efetivar`, quando `!empresa.usaWms`, chamar `registrarMovimentacao(tx, { tipo: 'ENTRADA_COMPRA', ... })` para cada item do pedido, dentro da mesma transação
    - Em `POST /:id/devolver`, quando `!empresa.usaWms`, chamar `registrarMovimentacao(tx, { tipo: 'SAIDA_ESTORNO_COMPRA', ... })`
    - _Requirements: 4.4, 4.6, 4.8_

  - [x] 8.12 Integrar registrarMovimentacao em venda.routes.ts
    - Em `POST /efetivar`, quando `!empresa.usaWms`, chamar `registrarMovimentacao(tx, { tipo: 'SAIDA_VENDA', ... })` para cada item, dentro da mesma transação
    - _Requirements: 4.5, 4.6, 4.7_

  - [x] 8.13 Integrar registrarMovimentacao em devolucao-venda.service.ts
    - Em `criar()`, quando `!empresa.usaWms`, chamar `registrarMovimentacao(tx, { tipo: 'ENTRADA_ESTORNO_VENDA', ... })` em vez de incrementar `Estoque` diretamente
    - _Requirements: 4.6, 4.9_

  - [ ]* 8.14 Write integration tests for endpoints de Kardex e saldo
    - Testar `GET /saldo/:produtoId` e `GET /kardex/:produtoId` com e sem filtros de data
    - _Requirements: 4.12, 4.13_

- [x] 9. Checkpoint — Validar Requirement 4
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Requirement 5 — Liberação de conferência por senha de Supervisor
  - [x] 10.1 Implementar agendaSemNotaFiscal
    - Criar `src/modules/portaria/liberacao-conferencia.service.ts` com `agendaSemNotaFiscal(tx, agendaWms, empresaId): Promise<boolean>`
    - Verificar as três condições: (a) `pedidoCompraId` ou `fornecedorId` preenchido; (b) ausência de `NotaEntrada` PENDENTE/EM_CONFERENCIA do fornecedor no dia; (c) ausência de `CompraEfetivada` com `xmlNfe` vinculável ao pedido ou fornecedor
    - _Requirements: 5.1_

  - [ ]* 10.2 Write property test for condição "agendado sem nota fiscal"
    - **Property 19: Condição "agendado sem nota fiscal" é a conjunção exata das três condições**
    - **Validates: Requirements 5.1**

  - [x] 10.3 Implementar decisão de liberação e schema de credenciais
    - Adicionar `autorizarEntradaBodySchema` (Zod, `usuario`/`senha` opcionais) e a função de decisão que combina `agendaSemNotaFiscal` com `validarCredenciaisSupervisor` (reaproveitado de `src/modules/conferencia-entrada/validar-supervisor.service.ts`, sem alteração)
    - Quando a condição é falsa: efetivar liberação sem exigir credenciais, `supervisorLiberacaoId = null`
    - Quando a condição é verdadeira: exigir credenciais válidas; se válidas, efetivar liberação com `supervisorLiberacaoId` = `supervisorId` retornado; se inválidas ou ausentes, rejeitar sem alterar status, sem criar OS e sem preencher `supervisorLiberacaoId`
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.7_

  - [ ]* 10.4 Write property test for decisão de liberação
    - **Property 20: Exigência e efetivação da liberação dependem exclusivamente do resultado da condição e da validação de credenciais**
    - **Validates: Requirements 5.2, 5.3, 5.4, 5.5**

  - [x] 10.5 Modificar portaria.routes.ts
    - Em `POST /autorizar-entrada/:id`, aceitar `{ usuario?, senha? }` no body, invocar `agendaSemNotaFiscal` e a função de decisão do passo 10.3
    - Persistir `supervisorLiberacaoId` no `AgendaWms` quando a liberação for efetivada mediante validação de Supervisor; garantir reavaliação da condição a cada nova tentativa (Requirement 5.6)
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ]* 10.6 Write integration tests for fluxo HTTP de autorizar-entrada
    - Testar liberação sem exigência de senha quando nota é localizável, exigência de senha (422) sem credenciais, rejeição (401) com credenciais inválidas, sucesso com credenciais válidas, e nova tentativa sem senha após nota se tornar localizável
    - _Requirements: 5.2, 5.4, 5.5, 5.6_

- [x] 11. Wiring final e checkpoint geral
  - [x] 11.1 Verificar registro de todas as rotas novas/modificadas em server.ts
    - Confirmar que `seed-fiscal.routes.ts` e `kardex.routes.ts` estão registradas com os prefixos corretos e hooks de autenticação
    - Confirmar que `compra.routes.ts`, `venda.routes.ts` e `portaria.routes.ts` refletem as modificações dos Requirements 1, 2, 4 e 5
    - _Requirements: 1.7, 3.1, 4.12, 4.13, 5.2_

  - [ ]* 11.2 Executar suíte completa de testes
    - Rodar todos os testes unitários, de propriedade e de integração das cinco melhorias e confirmar que passam
    - _Requirements: 1.1-1.7, 2.1-2.10, 3.1-3.10, 4.1-4.13, 5.1-5.7_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (fast-check, mínimo 100 iterações, mocks para I/O de rede/banco)
- Unit tests validate specific examples and edge cases
- O design usa TypeScript como linguagem de implementação (Fastify + Prisma + Zod); fast-check já está disponível no projeto
- Requirement 3.2 (exibição das três opções marcáveis no Menu_Configurações) é responsabilidade do frontend (`VisioFab.Wms.Front`) e está fora do escopo deste plano de backend — o endpoint `GET /contagem` (task 6.5) fornece os dados necessários para essa tela
- Toda alteração em `schema.prisma` (task 1.1) deve ser acompanhada da alteração equivalente e idempotente em `prisma/migrate-prod.ts` (task 1.2) no mesmo commit, conforme `.kiro/steering/database-migrations.md`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3"] },
    { "id": 3, "tasks": ["2.1", "4.1", "4.5", "6.1", "8.1", "10.1"] },
    { "id": 4, "tasks": ["2.2", "2.3", "4.2", "4.3", "4.4", "4.6", "6.2", "8.2", "8.3", "8.4", "10.2", "10.3"] },
    { "id": 5, "tasks": ["2.4", "4.7", "6.3", "6.4", "8.6", "10.4", "10.5"] },
    { "id": 6, "tasks": ["2.5", "2.6", "4.8", "4.9", "4.10", "6.5", "8.5", "8.7", "8.8", "10.6"] },
    { "id": 7, "tasks": ["2.7", "4.11", "6.6", "8.9"] },
    { "id": 8, "tasks": ["2.8", "4.12", "6.7", "8.10"] },
    { "id": 9, "tasks": ["2.9", "8.11", "8.12", "8.13"] },
    { "id": 10, "tasks": ["3", "5", "7", "8.14"] },
    { "id": 11, "tasks": ["9"] },
    { "id": 12, "tasks": ["11.1"] },
    { "id": 13, "tasks": ["11.2"] }
  ]
}
```
