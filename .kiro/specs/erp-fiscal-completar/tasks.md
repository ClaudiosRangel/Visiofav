# Implementation Plan: ERP Fiscal Completar

## Overview

Implementação completa do módulo fiscal do VisioFab ERP incluindo: geração de DANFE em PDF, integração Vendas→Fiscal e Compras→Fiscal, deprecação do modelo legado Nfe, e XML builders para NFC-e (modelo 65), CT-e (modelo 57) e MDF-e (modelo 58). Utiliza a infraestrutura existente (certificado, SEFAZ client, assinatura XML, motor tributário) e segue o padrão de XML builders como funções puras.

## Tasks

- [x] 1. Schema Prisma e migração inicial
  - [x] 1.1 Adicionar campo compraEfetivadaId ao modelo DocumentoFiscal
    - Adicionar campo `compraEfetivadaId String? @map("compra_efetivada_id")` ao modelo DocumentoFiscal em `prisma/schema.prisma`
    - Adicionar relation `compraEfetivada CompraEfetivada? @relation(fields: [compraEfetivadaId], references: [id])`
    - Adicionar `documentosFiscais DocumentoFiscal[]` ao modelo CompraEfetivada
    - Gerar migration com `npx prisma migrate dev --name add-compra-efetivada-to-doc-fiscal`
    - _Requirements: 3.4, 4.1_

- [x] 2. DANFE PDF Service
  - [x] 2.1 Implementar danfe-pdf.service.ts
    - Criar `src/modules/fiscal/emissor-dfe/nfe/danfe-pdf.service.ts`
    - Implementar `gerarDanfe(documentoFiscalId, empresaId)` que: busca DocumentoFiscal + itens, valida status AUTORIZADO, renderiza PDF com pdfkit
    - Incluir: cabeçalho, emitente (razão social, CNPJ, IE, endereço, telefone), destinatário, tabela de itens (nItem, cProd, descrição, NCM, CST, CFOP, unidade, qtd, vUnit, vTotal, baseICMS, vICMS, vIPI), totais, código de barras Code128, protocolo de autorização
    - Retornar Buffer do PDF
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.9_

  - [x] 2.2 Criar rota GET /nfe/:id/danfe
    - Registrar rota em `src/modules/fiscal/emissor-dfe/nfe/nfe.routes.ts` (ou arquivo de rotas fiscal existente)
    - Chamar `danfePdfService.gerarDanfe()` e retornar com Content-Type `application/pdf`
    - Tratar erro 404 (doc não encontrado), 422 (status != AUTORIZADO), 500 (falha pdfkit)
    - _Requirements: 1.1, 1.8, 1.10_

  - [ ]* 2.3 Write property tests for DANFE PDF Service
    - **Property 1: DANFE renders all required document data**
    - **Property 2: DANFE rejects non-AUTORIZADO documents**
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.7, 1.8**

  - [ ]* 2.4 Write unit tests for DANFE
    - Testar PDF magic bytes no buffer retornado
    - Testar erro 422 para status PENDENTE, REJEITADO, CANCELADO
    - Testar erro 404 para ID inexistente
    - _Requirements: 1.1, 1.8, 1.10_

- [x] 3. Integração Vendas → Fiscal
  - [x] 3.1 Implementar venda-fiscal.service.ts
    - Criar `src/modules/fiscal/integracao/venda-fiscal.service.ts`
    - Implementar `montarDadosNFe({ pedidoVenda, empresa, cliente })` que: mapeia cliente→destinatário (CPF/CNPJ, IE, endereço), itens→DadosNFe items (NCM, CFOP do produto, quantidade, preço), define tipoOperacao=1
    - Implementar `emitirParaVenda({ empresaId, pedidoVenda })` que: busca empresa e cliente, chama montarDadosNFe, chama nfeEmissaoService.emitir()
    - _Requirements: 2.1, 2.2_

  - [x] 3.2 Refatorar POST /vendas/efetivar para usar venda-fiscal.service
    - Modificar `src/modules/vendas/venda.routes.ts` (ou equivalente)
    - Substituir criação direta na tabela `nfe` por chamada a `vendaFiscalService.emitirParaVenda()`
    - Na transação Prisma: se autorizado → criar VendaEfetivada + ContaReceber; se rejeitado → rollback + retornar 422 {cStat, xMotivo}; se contingência → criar VendaEfetivada com flag contingência
    - Verificar certificado antes de iniciar (retornar 422 se ausente)
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [ ]* 3.3 Write property test for Vendas→NF-e data mapping
    - **Property 3: Vendas→NF-e data mapping preserves all fields**
    - **Validates: Requirements 2.2**

  - [ ]* 3.4 Write unit tests for venda-fiscal.service
    - Testar montarDadosNFe com mock de pedido → validar campos do DadosNFe resultante
    - Testar emitirParaVenda com mock nfeEmissaoService autorizado → DocumentoFiscal criado
    - Testar emitirParaVenda com mock SEFAZ rejeitado → rollback
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 4. Integração Compras → Fiscal
  - [x] 4.1 Implementar compra-fiscal.service.ts
    - Criar `src/modules/fiscal/integracao/compra-fiscal.service.ts`
    - Implementar `criarDocFiscalEntrada({ empresaId, xmlNfe, compraEfetivadaId })` que: parseia XML (usando parseNFeXml existente ou novo), extrai chave de acesso, número, série, emitente, itens com tributos, valor total, protocolo
    - Criar DocumentoFiscal com tipo=NFE, tipoOperacao=0, status=AUTORIZADO, xmlAutorizado=xml completo
    - Criar ItemDocumentoFiscal para cada item do XML (preservando ICMS, IPI, PIS, COFINS)
    - Vincular à CompraEfetivada via compraEfetivadaId
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6_

  - [x] 4.2 Integrar compra-fiscal.service na rota de compras
    - Modificar `src/modules/compras/compra.routes.ts` (ou equivalente)
    - Quando xmlNfe preenchido: chamar `compraFiscalService.criarDocFiscalEntrada()` dentro da transação
    - Quando xmlNfe vazio/null: criar CompraEfetivada sem DocumentoFiscal
    - Validar XML: retornar 422 se inválido; verificar duplicidade (CNPJ + nNF + série) antes de importar
    - _Requirements: 3.1, 3.4, 3.5, 3.7_

  - [ ]* 4.3 Write property tests for Compras XML extraction
    - **Property 4: Compras XML extraction round-trip**
    - **Property 5: Invalid XML rejection**
    - **Validates: Requirements 3.2, 3.5, 3.6**

  - [ ]* 4.4 Write unit tests for compra-fiscal.service
    - Testar criarDocFiscalEntrada com XML válido → DocumentoFiscal + itens criados
    - Testar XML inválido → erro 422
    - Testar duplicidade → erro 422
    - Testar compra sem XML → sem DocumentoFiscal
    - _Requirements: 3.1, 3.5, 3.7_

- [x] 5. Checkpoint — Validar integrações core
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. NFC-e XML Builder (Modelo 65)
  - [x] 6.1 Implementar nfce-xml-builder.ts
    - Criar `src/modules/fiscal/emissor-dfe/nfce/nfce-xml-builder.ts`
    - Implementar `buildNFCeXml(dados: DadosNFCe): string` — layout 4.00, modelo 65
    - Incluir grupos obrigatórios: ide (idDest=1, indFinal=1, indPres=1), emit, det[], total, pag, infAdic
    - Omitir grupo transp
    - Implementar `gerarQrCode(params)` com hash HMAC-SHA1 do CSC
    - Implementar `gerarUrlChave(uf, ambiente)` com URL por UF
    - Validar: valor >= 200 exige CPF/CNPJ do destinatário; CSC obrigatório
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.9, 5.10_

  - [x] 6.2 Implementar nfce-emissao.service.ts
    - Completar stub em `src/modules/fiscal/emissor-dfe/nfce/nfce-emissao.service.ts`
    - Implementar `emitir(params)`: calcular tributos via motorTributario, chamar buildNFCeXml, assinar, transmitir SEFAZ, retornar resultado
    - Suportar contingência offline (tpEmis=9) com timeout de 5s
    - _Requirements: 5.8, 5.10_

  - [x] 6.3 Criar rota POST /nfce/emitir
    - Registrar endpoint com validação Zod dos dados de entrada
    - Chamar nfceEmissaoService.emitir() e retornar resultado
    - _Requirements: 5.8_

  - [ ]* 6.4 Write property tests for NFC-e XML Builder
    - **Property 7: NFC-e XML build/parse round-trip**
    - **Property 8: NFC-e destinatário validation by value threshold**
    - **Property 9: NFC-e QRCode and urlChave correctness**
    - **Property 10: NFC-e model 65 structural invariants**
    - **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.11**

  - [ ]* 6.5 Write unit tests for NFC-e
    - Testar tpEmis normal vs contingência
    - Testar grupo pag obrigatório presente
    - Testar erro quando CSC não cadastrado
    - _Requirements: 5.8, 5.10_

- [x] 7. CT-e XML Builder (Modelo 57)
  - [x] 7.1 Implementar cte-xml-builder.ts (atualizar existente)
    - Atualizar `src/modules/fiscal/emissor-dfe/cte/cte-xml-builder.ts`
    - Implementar `buildCTeXml(dados: DadosCTe): string` — layout 4.00, modelo 57
    - Incluir grupos: ide, compl, emit, rem, dest, vPrest (componentes valor), imp (ICMS por CST), infCTeNorm (infCarga, infDoc com chaves NF-e), infModal (rodoviário: RNTRC, veículos)
    - Tomador conforme tpTom (0=remetente, 1=expedidor, 2=recebedor, 3=destinatário, 4=outros)
    - ICMS: mapear CST → tag correta (ICMS00, ICMS20, ICMS45, ICMS60, ICMS90, ICMSOutraUF, ICMSSN)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.9_

  - [x] 7.2 Implementar cte-emissao.service.ts
    - Completar stub em `src/modules/fiscal/emissor-dfe/cte/cte-emissao.service.ts`
    - Implementar `emitir(params)`: construir XML, assinar, transmitir via CTeAutorizacao, consultar CTeRetAutorizacao
    - _Requirements: 6.8, 6.10_

  - [x] 7.3 Criar rota POST /cte/emitir
    - Registrar endpoint com validação Zod
    - Chamar cteEmissaoService.emitir() e retornar resultado
    - _Requirements: 6.8_

  - [ ]* 7.4 Write property tests for CT-e XML Builder
    - **Property 12: CT-e XML build/parse round-trip**
    - **Property 13: CT-e ICMS tag selection by CST**
    - **Validates: Requirements 6.7, 6.11**

  - [ ]* 7.5 Write unit tests for CT-e
    - Testar tomador por tpTom (todas as variações)
    - Testar infModal rodoviário com RNTRC e veículos
    - Testar CST inválido → erro
    - _Requirements: 6.2, 6.6, 6.7_

- [x] 8. MDF-e XML Builder (Modelo 58)
  - [x] 8.1 Implementar mdfe-xml-builder.ts (atualizar existente)
    - Atualizar `src/modules/fiscal/emissor-dfe/mdfe/mdfe-xml-builder.ts`
    - Implementar `buildMDFeXml(dados: DadosMDFe): string` — layout 3.00, modelo 58
    - Incluir grupos: ide (UFs carregamento/descarregamento, municípios), emit, infDoc (chaves NF-e/CT-e agrupadas por UF de descarga), seg (seguros), prodPred, tot (qtCTe, qtNFe, peso, valor), infModal (rodoviário: veículo tração, reboques, condutores, CIOT, vale-pedágio)
    - Validar: ao menos um documento vinculado em infDoc
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.8, 7.10, 7.11_

  - [x] 8.2 Implementar mdfe-emissao.service.ts
    - Completar stub em `src/modules/fiscal/emissor-dfe/mdfe/mdfe-emissao.service.ts`
    - Implementar `emitir(params)`: construir XML, assinar, transmitir via MDFeRecepcao, consultar MDFeRetRecepcao
    - Implementar `encerrar(params)`: enviar evento de encerramento do MDF-e
    - _Requirements: 7.7, 7.9_

  - [x] 8.3 Criar rotas POST /mdfe/emitir e POST /mdfe/:id/encerrar
    - Registrar endpoints com validação Zod
    - Chamar mdfeEmissaoService.emitir() / encerrar() e retornar resultado
    - _Requirements: 7.7_

  - [ ]* 8.4 Write property tests for MDF-e XML Builder
    - **Property 14: MDF-e XML build/parse round-trip**
    - **Property 15: MDF-e requires at least one linked document**
    - **Validates: Requirements 7.10, 7.11, 7.12**

  - [ ]* 8.5 Write unit tests for MDF-e
    - Testar múltiplas UFs de descarregamento
    - Testar lacres e CIOT
    - Testar encerramento de MDF-e
    - Testar erro quando nenhum documento vinculado
    - _Requirements: 7.2, 7.3, 7.4, 7.10, 7.11_

- [ ] 9. Chave de Acesso — Teste unificado
  - [ ]* 9.1 Write property test for chave de acesso generation
    - **Property 11: Chave de acesso generation correctness for all models**
    - Testar com modelos 55, 65, 57, 58 — validar 44 dígitos e DV módulo 11
    - **Validates: Requirements 5.9, 6.9, 7.8**

- [-] 10. Checkpoint — Validar XML builders e emissão
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Migração do Modelo Legado Nfe
  - [x] 11.1 Implementar script de migração migrar-nfe-legado.ts
    - Criar `src/modules/fiscal/integracao/migrar-nfe-legado.ts`
    - Implementar `migrarNfeLegado(empresaId?)` que: lê todos registros Nfe (com NfeItem), mapeia para DocumentoFiscal (tipo=NFE, modelo=55, status mapeado, tipoOperacao derivado), cria ItemDocumentoFiscal preservando todos campos tributários
    - Implementar `mapearNfeParaDocFiscal(nfe)` conforme tabela de mapeamento do design
    - Verificar duplicidade por chaveAcesso antes de inserir (idempotência)
    - Tratar registros inconsistentes: log warn + defaults documentados
    - Preservar vínculo vendaEfetivadaId
    - _Requirements: 4.1, 4.2, 4.3, 4.6, 4.7_

  - [-] 11.2 Refatorar rotas e serviços para remover uso do modelo Nfe
    - Atualizar `src/modules/vendas/venda.routes.ts` — remover import/uso de Nfe (já refatorado na task 3.2, validar que não há referências remanescentes)
    - Buscar e atualizar quaisquer queries ou serviços que referenciem `prisma.nfe` ou `prisma.nfeItem`
    - _Requirements: 4.5, 4.6_

  - [~] 11.3 Remover modelo Nfe e NfeItem do schema Prisma
    - Deletar `model Nfe` e `model NfeItem` de `prisma/schema.prisma`
    - Gerar migration com `npx prisma migrate dev --name remove-nfe-legado`
    - A migration deve fazer DROP TABLE das tabelas nfe e nfe_item
    - _Requirements: 4.4_

  - [ ]* 11.4 Write property test for migration mapping
    - **Property 6: Nfe→DocumentoFiscal migration mapping preserves data**
    - **Validates: Requirements 4.2, 4.3**

  - [ ]* 11.5 Write unit tests for migração
    - Testar registros inconsistentes → defaults aplicados
    - Testar idempotência (rodar migração 2x sem duplicar)
    - Testar mapeamento de status (PENDENTE, AUTORIZADA→AUTORIZADO, REJEITADA→REJEITADO)
    - _Requirements: 4.1, 4.2, 4.7_

- [~] 12. Final checkpoint — Validação completa
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (fast-check)
- Unit tests validate specific examples and edge cases (Vitest)
- A infraestrutura existente (certificado, SEFAZ client, xml-signer, motor tributário) é reutilizada sem modificação
- Os XML builders seguem o padrão de funções puras já estabelecido em nfe-xml-builder.ts

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4.1", "6.1", "7.1", "8.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "3.2", "3.3", "3.4", "4.2", "4.3", "4.4", "6.2", "6.4", "6.5", "7.2", "7.4", "7.5", "8.2", "8.4", "8.5", "9.1"] },
    { "id": 3, "tasks": ["6.3", "7.3", "8.3", "11.1"] },
    { "id": 4, "tasks": ["11.2", "11.4", "11.5"] },
    { "id": 5, "tasks": ["11.3"] }
  ]
}
```
