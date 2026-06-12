# Implementation Plan: WMS Conferência Avançada + Rename

## Overview

Implementação incremental em 7 fases: Schema/Migração → Serviço de Conferência Avançada → Módulo CC-e → Recebimento Parcial → Integração de Rotas → Frontend Rename → Validação Final. Cada tarefa é independentemente testável e referencia requisitos específicos do design.

## Tasks

- [x] 1. Migração de banco e atualização do Prisma schema
  - [x] 1.1 Adicionar campos de configuração de conferência ao model Empresa no schema.prisma
    - Adicionar `conferenciaQuantidadeCega Boolean @default(false) @map("conferencia_quantidade_cega")`
    - Adicionar `conferenciaLoteCega Boolean @default(false) @map("conferencia_lote_cega")`
    - Adicionar `permiteRecebimentoParcial Boolean @default(false) @map("permite_recebimento_parcial")`
    - Executar `prisma generate` para atualizar o client
    - _Requirements: 1.1, 2.1, 6.1_

  - [x] 1.2 Adicionar campo exigeLote ao model Produto no schema.prisma
    - Adicionar `exigeLote Boolean @default(false) @map("exige_lote")`
    - _Requirements: 5.1_

  - [x] 1.3 Adicionar campo statusRecebimento ao model NotaEntrada no schema.prisma
    - Adicionar `statusRecebimento String @default("PENDENTE") @map("status_recebimento") @db.VarChar(30)`
    - Adicionar relations para divergencias, saldosPendentes, cartasCorrecao
    - _Requirements: 6.4, 6.6_

  - [x] 1.4 Criar models DivergenciaConferencia, CartaCorrecao e SaldoPendenteItem no schema.prisma
    - Criar model DivergenciaConferencia com campos: id, empresaId, notaEntradaId, itemNotaEntradaId, tipo (VarChar(30)), quantidadeEsperada, quantidadeConferida, loteEsperado, loteConferido, validadeEsperada, validadeConferida, status (default "PENDENTE"), observacao, criadoEm
    - Criar model CartaCorrecao com campos: id, empresaId, notaEntradaId, divergenciaId (unique), chaveNfe, sequenciaEvento, textoCorrecao, xmlEnviado, xmlRetorno, protocolo, status (default "PENDENTE"), motivoRejeicao, criadoEm
    - Criar model SaldoPendenteItem com campos: id, empresaId, notaEntradaId, itemNotaEntradaId, quantidadeNf, quantidadeRecebida, saldoPendente, status (default "PENDENTE"), criadoEm, atualizadoEm
    - Adicionar relation CartaCorrecao → DivergenciaConferencia
    - _Requirements: 3.3, 4.1, 4.4, 6.3_

  - [x] 1.5 Criar migração SQL em prisma/migrate-prod.ts
    - ALTER TABLE "empresa" ADD COLUMN IF NOT EXISTS "conferencia_quantidade_cega" BOOLEAN DEFAULT false
    - ALTER TABLE "empresa" ADD COLUMN IF NOT EXISTS "conferencia_lote_cega" BOOLEAN DEFAULT false
    - ALTER TABLE "empresa" ADD COLUMN IF NOT EXISTS "permite_recebimento_parcial" BOOLEAN DEFAULT false
    - ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "exige_lote" BOOLEAN DEFAULT false
    - ALTER TABLE "nota_entrada" ADD COLUMN IF NOT EXISTS "status_recebimento" VARCHAR(30) DEFAULT 'PENDENTE'
    - CREATE TABLE IF NOT EXISTS "divergencia_conferencia" com todos os campos e constraints
    - CREATE TABLE IF NOT EXISTS "carta_correcao" com todos os campos, unique em divergencia_id
    - CREATE TABLE IF NOT EXISTS "saldo_pendente_item" com todos os campos
    - Adicionar índices em empresa_id para as três novas tabelas
    - Seguir padrão existente com IF NOT EXISTS para idempotência
    - _Requirements: 1.1, 2.1, 5.1, 6.1, 6.3_

- [x] 2. Implementar lógica de conferência avançada (serviços puros)
  - [x] 2.1 Criar src/modules/conferencia-entrada/conferencia-cega.service.ts
    - Implementar interface ConfigConferenciaCega { conferenciaQuantidadeCega: boolean, conferenciaLoteCega: boolean }
    - Implementar função filtrarDadosConforme(item, config): retorna DTO sem quantidadeEsperada se quantidade cega ativa; retorna DTO sem lote pré-preenchido se lote cego ativo
    - Implementar função validarCamposObrigatorios(payload, config, produto): rejeita se quantidade cega e quantidadeConferida não informada; rejeita se lote cego e lote não informado; rejeita se produto.exigeLote e lote não informado
    - _Requirements: 1.2, 1.3, 1.4, 2.2, 2.3, 2.4, 5.2, 5.3, 5.4_

  - [ ]* 2.2 Escrever property test para visibilidade de dados na conferência cega (Properties 1 e 2)
    - **Property 1: Visibilidade de quantidade conforme configuração cega**
    - **Property 2: Visibilidade de lote conforme configuração cega**
    - **Validates: Requirements 1.2, 1.4, 2.2, 2.4**
    - Usar fast-check para gerar combinações de (config, item com/sem lote)
    - Verificar: quantidadeEsperada presente ↔ conferenciaQuantidadeCega=false; lote presente ↔ conferenciaLoteCega=false

  - [ ]* 2.3 Escrever property test para campos obrigatórios na conferência cega (Properties 3 e 4)
    - **Property 3: Obrigatoriedade de quantidade manual na conferência cega**
    - **Property 4: Obrigatoriedade de lote manual na conferência cega**
    - **Validates: Requirements 1.3, 2.3**
    - Gerar payloads com/sem quantidadeConferida e lote sob diferentes configs
    - Verificar: rejeição quando campo ausente e config ativa; aceitação quando campo presente

  - [x] 2.4 Criar src/modules/conferencia-entrada/validade.service.ts
    - Implementar função compararValidade(validadeDigitada, validadeNf): retorna divergência com tipo "VALIDADE_DIVERGENTE" se datas diferentes; retorna null se iguais ou ambas ausentes
    - Implementar função verificarProdutoVencido(validadeDigitada, dataAtual): retorna bloqueio com alerta "PRODUTO VENCIDO" se validade < dataAtual
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ]* 2.5 Escrever property test para comparação de validade (Property 5)
    - **Property 5: Comparação de validade e registro de divergência**
    - **Validates: Requirements 3.2, 3.3**
    - Gerar pares de datas (validadeDigitada, validadeNf) e verificar: divergência registrada ↔ datas diferentes e ambas definidas

  - [ ]* 2.6 Escrever property test para bloqueio de produto vencido (Property 6)
    - **Property 6: Bloqueio de produto vencido**
    - **Validates: Requirements 3.4**
    - Gerar datas (validadeDigitada, dataAtual) e verificar: bloqueio ↔ validadeDigitada < dataAtual

  - [ ]* 2.7 Escrever property test para exigência de lote por produto (Property 7)
    - **Property 7: Exigência de lote baseada no produto**
    - **Validates: Requirements 5.2, 5.3, 5.4**
    - Gerar combinações (exigeLote, loteInformado) e verificar: rejeição quando exigeLote=true e lote vazio; aceitação quando exigeLote=false e lote vazio

- [x] 3. Checkpoint — Verificar serviços puros de conferência
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implementar módulo CC-e
  - [x] 4.1 Criar src/modules/cce/cce-xml-builder.ts
    - Implementar função gerarXmlCCe(params): gerar XML do evento 110110 conforme layout SEFAZ
    - Incluir campos: chNFe, dhEvento, nSeqEvento, xCorrecao
    - Gerar texto de correção com item, quantidade original e quantidade corrigida
    - _Requirements: 4.1, 4.7_

  - [x] 4.2 Criar src/modules/cce/cce-sefaz.ts
    - Implementar função assinarXml(xml, certificado): assinar XML com certificado A1
    - Implementar função transmitirCCe(xmlAssinado, uf): transmitir evento à SEFAZ via webservice
    - Interpretar respostas: cStat 135 (autorizado), rejeições
    - _Requirements: 4.2, 4.3_

  - [x] 4.3 Criar src/modules/cce/cce.service.ts
    - Implementar classe CceService com método emitirCCe(params)
    - Orquestrar: verificar limite de 20 CC-e por NF → gerar XML → assinar → transmitir → registrar resultado
    - Retornar ResultadoCCe { sucesso, protocolo?, sequencia, motivoRejeicao? }
    - Em caso de autorização (cStat 135): registrar protocolo, vincular à NF, atualizar status divergência
    - Em caso de rejeição: registrar motivo, manter status PENDENTE_CCE, notificar
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 4.4 Escrever property test para limite de CC-e por NF (Property 11)
    - **Property 11: Limite de CC-e por NF-e**
    - **Validates: Requirements 4.6**
    - Gerar quantidade de CC-e existentes (0-25) e verificar: rejeição quando count >= 20; aceitação quando count < 20

  - [ ]* 4.5 Escrever property test para conteúdo do texto de correção (Property 12)
    - **Property 12: Conteúdo do texto de correção da CC-e**
    - **Validates: Requirements 4.7, 4.1**
    - Gerar dados arbitrários (item, quantidadeOriginal, quantidadeCorrigida) e verificar que texto contém os três elementos

  - [x] 4.6 Criar src/modules/cce/cce.routes.ts
    - GET /api/cce?notaEntradaId=xxx: listar CC-e de uma nota (escopado por empresaId)
    - GET /api/cce/:id: detalhe de uma CC-e específica
    - Registrar rotas em src/server.ts com prefix '/api/cce'
    - _Requirements: 4.4_

- [x] 5. Implementar recebimento parcial
  - [x] 5.1 Criar src/modules/conferencia-entrada/recebimento-parcial.service.ts
    - Implementar função avaliarRecebimentoParcial(quantidadeConferida, quantidadeNf, permiteRecebimentoParcial): se config ativa e qtd < nf → aceitar parcial e calcular saldo; se config inativa e qtd ≠ nf → tratar como divergência padrão
    - Implementar função registrarSaldoPendente(params): criar SaldoPendenteItem com saldo = quantidadeNf - quantidadeRecebida
    - Implementar função receberSaldo(saldoPendenteId, quantidadeRecebida): atualizar saldo, verificar se completou
    - Implementar função verificarNotaCompleta(notaEntradaId): se todos os saldos recebidos, atualizar status para "CONFERIDA"
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ]* 5.2 Escrever property test para aceitação de recebimento parcial (Property 8)
    - **Property 8: Aceitação de recebimento parcial conforme configuração**
    - **Validates: Requirements 6.2, 6.5**
    - Gerar combinações (quantidadeConferida < quantidadeNf, config ativa/inativa) e verificar: parcial aceito ↔ config ativa; divergência padrão ↔ config inativa

  - [ ]* 5.3 Escrever property test para invariante do saldo pendente (Property 9)
    - **Property 9: Invariante do saldo pendente**
    - **Validates: Requirements 6.3**
    - Gerar (quantidadeNf, quantidadeRecebida) com recebida < nf e verificar: saldo = nf - recebida; saldo > 0; saldo ≤ quantidadeNf

  - [ ]* 5.4 Escrever property test para transição de status (Property 10)
    - **Property 10: Transição de status ao completar recebimento**
    - **Validates: Requirements 6.6**
    - Gerar lista de itens com saldos e simular recebimentos completando todos; verificar transição para "CONFERIDA"

- [x] 6. Checkpoint — Verificar módulo CC-e e recebimento parcial
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Integrar rotas de conferência avançada
  - [x] 7.1 Expandir rota GET /conferencia-entrada/:id para filtrar dados conforme configuração cega
    - Buscar configs da Empresa (conferenciaQuantidadeCega, conferenciaLoteCega)
    - Buscar exigeLote de cada Produto
    - Aplicar filtrarDadosConforme para cada item do DTO de resposta
    - _Requirements: 1.2, 1.4, 2.2, 2.4_

  - [x] 7.2 Expandir rota POST /conferencia-entrada/:id/conferir-item para validação avançada
    - Chamar validarCamposObrigatorios com configs e produto
    - Chamar compararValidade se item possui validade na NF
    - Chamar verificarProdutoVencido
    - Se divergência detectada: registrar DivergenciaConferencia com tipo adequado
    - Retornar divergência ao conferente
    - _Requirements: 1.3, 2.3, 3.1, 3.2, 3.3, 3.4, 5.2, 5.4_

  - [x] 7.3 Criar rota POST /conferencia-entrada/:id/aceitar-divergencia
    - Validar body com Zod (itemNotaEntradaId, quantidadeAceita, observacao?)
    - Atualizar status da divergência para ACEITA
    - Se divergência de quantidade: chamar CceService.emitirCCe automaticamente
    - Se config permiteRecebimentoParcial ativa e qtd aceita < nf: registrar saldo pendente
    - Retornar confirmação com resultado da CC-e
    - _Requirements: 4.1, 6.2, 6.3_

  - [x] 7.4 Criar rota GET /conferencia-entrada/notas-parciais para listar notas com saldo pendente
    - Buscar notas com statusRecebimento = "PARCIALMENTE_RECEBIDO" escopadas por empresaId
    - Incluir itens com saldo pendente
    - _Requirements: 6.4_

  - [x] 7.5 Criar rota POST /conferencia-entrada/:id/receber-saldo para receber saldo pendente
    - Validar body com Zod (itemNotaEntradaId, quantidadeRecebida, lote?, validade?)
    - Buscar SaldoPendenteItem e validar que quantidade ≤ saldo
    - Atualizar saldo, verificar se nota completa
    - _Requirements: 6.5, 6.6_

- [x] 8. Expor novos campos via APIs existentes
  - [x] 8.1 Atualizar endpoint PUT/PATCH de Empresa para aceitar campos de configuração de conferência
    - Adicionar conferenciaQuantidadeCega, conferenciaLoteCega, permiteRecebimentoParcial ao schema Zod
    - Persistir campos na atualização
    - _Requirements: 1.1, 2.1, 6.1_

  - [x] 8.2 Atualizar endpoint PUT de Produto para aceitar campo exigeLote
    - Adicionar exigeLote ao schema Zod do produto
    - Persistir campo na atualização
    - _Requirements: 5.1_

- [x] 9. Checkpoint — Verificar integração de rotas backend
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Frontend — Renomeação de marca VisioFab → Vizor
  - [x] 10.1 Renomear marca no componente Header/Layout
    - Localizar src/components/layout/Header.tsx (ou equivalente)
    - Substituir todas as ocorrências de "VisioFab" por "Vizor" em textos visíveis
    - _Requirements: 7.1_

  - [x] 10.2 Atualizar metadata title prefix em src/app/layout.tsx
    - Alterar prefixo do document.title de "VisioFab - " para "Vizor - "
    - _Requirements: 7.2_

  - [x] 10.3 Atualizar tela de login
    - Localizar src/app/login/page.tsx
    - Substituir "VisioFab" por "Vizor" em logo, título e textos de boas-vindas
    - _Requirements: 7.3_

  - [x] 10.4 Busca global e substituição em textos visíveis ao usuário
    - Executar busca por "VisioFab" em todos os componentes do frontend
    - Substituir em breadcrumbs, rodapés, about e quaisquer textos voltados ao usuário
    - NÃO alterar: package.json name, pastas de repositório, variáveis de ambiente, URLs de API
    - _Requirements: 7.4, 7.5, 7.6_

- [x] 11. Checkpoint final — Verificar implementação completa
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marcadas com `*` são opcionais e podem ser puladas para MVP mais rápido
- Cada task referencia requisitos específicos para rastreabilidade
- Checkpoints garantem validação incremental
- Property tests validam propriedades universais de corretude (fast-check com numRuns: 100)
- Unit tests validam exemplos específicos e edge cases
- Todas as operações devem respeitar isolamento multi-tenant (empresaId)
- O módulo CC-e deve ser tratado como integração externa (SEFAZ) e ter mocks robustos para testes
- A renomeação no frontend NÃO deve afetar nomes técnicos (URLs, pacotes, variáveis)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["1.5"] },
    { "id": 2, "tasks": ["2.1", "2.4", "5.1", "4.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.5", "2.6", "2.7", "4.2", "4.3", "5.2", "5.3", "5.4"] },
    { "id": 4, "tasks": ["4.4", "4.5", "4.6"] },
    { "id": 5, "tasks": ["7.1", "7.2", "8.1", "8.2"] },
    { "id": 6, "tasks": ["7.3", "7.4", "7.5"] },
    { "id": 7, "tasks": ["10.1", "10.2", "10.3", "10.4"] }
  ]
}
```
