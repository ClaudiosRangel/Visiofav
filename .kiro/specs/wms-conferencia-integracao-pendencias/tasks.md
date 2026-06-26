# Implementation Plan: Conferência, Integração e Pendências

## Overview

Implementação do fluxo evoluído de conferência cega com segunda conferência obrigatória, geração de pendências CC-e, envio de e-mail fiscal automático, e reformulação do bloqueio de conferência por produto. O plano segue uma abordagem incremental: primeiro os modelos e migrações, depois os módulos de configuração, em seguida a lógica central de segunda conferência e pendências, e por fim a integração externa e wiring final.

## Tasks

- [x] 1. Configurar modelos Prisma e migração do banco de dados
  - [x] 1.1 Adicionar novos models ao schema.prisma
    - Criar model `ConfigIntegracao` com campos: id, empresaId (unique), integracaoAtiva, sistemaExterno, criadoEm, atualizadoEm
    - Criar model `ConfigEmailFiscal` com campos: id, empresaId (unique), email, criadoEm, atualizadoEm
    - Criar model `PendenciaCce` com campos: id, empresaId, notaEntradaId, codigoProduto, descricaoProduto, fornecedor, tipo, motivo, status, resolvidoEm, resolvidoPorId, criadoEm
    - Adicionar índice composto `@@index([empresaId, status])` em PendenciaCce
    - Adicionar relações em Empresa e NotaEntrada para os novos models
    - _Requirements: 1.1, 2.1, 4.2_

  - [x] 1.2 Modificar model ConfigConferenciaProduto
    - Substituir campos `modoResolucaoLote` / `modoResolucaoValidade` por booleanos `aceitarSenha` e `aceitarCcePendente`
    - Manter constraint `@@unique([empresaId, produtoId])`
    - _Requirements: 3.4_

  - [x] 1.3 Adicionar campo statusConferencia ao ItemNotaEntrada
    - Adicionar campo `statusConferencia String @default("PENDENTE") @db.VarChar(30)`
    - Valores possíveis: PENDENTE, CONFERIDO, PENDENTE_SEGUNDA_CONFERENCIA, DIVERGENCIA_CONFIRMADA
    - _Requirements: 8.1_

  - [x] 1.4 Gerar e aplicar migração Prisma
    - Executar `npx prisma migrate dev --name add-conferencia-integracao-pendencias`
    - Verificar que a migração foi aplicada sem erros
    - _Requirements: 1.1, 2.1, 3.4, 4.2, 8.1_

- [x] 2. Implementar módulo config-integracao
  - [x] 2.1 Criar CRUD de configuração de integração
    - Criar `src/modules/config-integracao/config-integracao.routes.ts`
    - Implementar `GET /api/config-integracao`: retorna configuração da empresa logada (via JWT empresaId)
    - Implementar `POST /api/config-integracao`: cria ou atualiza config com validação Zod
    - Validar que se `integracaoAtiva=true`, `sistemaExterno` deve ser string não-vazia e ≤100 chars
    - Se `integracaoAtiva=false`, aceitar `sistemaExterno` nulo
    - Retornar 422 com código `SISTEMA_EXTERNO_OBRIGATORIO` se violada a regra
    - Usar upsert para garantir unicidade por empresa
    - Registrar rota em `src/server.ts`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7_

  - [ ]* 2.2 Write property test: Config Integração persistence round-trip
    - **Property 1: Config Integração persistence round-trip**
    - **Validates: Requirements 1.1**

  - [ ]* 2.3 Write property test: Config Integração conditional validation
    - **Property 2: Config Integração conditional validation**
    - **Validates: Requirements 1.4, 1.5**

- [x] 3. Implementar módulo config-email-fiscal
  - [x] 3.1 Criar CRUD de configuração de e-mail fiscal
    - Criar `src/modules/config-email-fiscal/config-email-fiscal.routes.ts`
    - Implementar `GET /api/config-email-fiscal`: retorna config da empresa logada
    - Implementar `POST /api/config-email-fiscal`: cria ou atualiza e-mail fiscal
    - Validar formato de e-mail: não-vazio, ≤254 chars, exatamente um "@", local part 1-64 chars, domínio com pelo menos um ponto separando partes não-vazias
    - Retornar 422 com código `EMAIL_INVALIDO` ou `EMAIL_OBRIGATORIO` conforme caso
    - Usar upsert para semântica last-write-wins
    - Registrar rota em `src/server.ts`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 3.2 Write property test: Email format validation
    - **Property 3: Email format validation**
    - **Validates: Requirements 2.2, 2.5**

  - [ ]* 3.3 Write property test: Config Email upsert (last write wins)
    - **Property 4: Config Email upsert (last write wins)**
    - **Validates: Requirements 2.4**

- [x] 4. Implementar reformulação do ConfigConferenciaProduto
  - [x] 4.1 Adaptar service e rotas do bloqueio de conferência
    - Modificar `src/modules/conferencia-entrada/config-conferencia-produto.service.ts`
    - Remover referências a `modoResolucaoLote` / `modoResolucaoValidade` e enum `ACEITAR_LIVRE`
    - Implementar lógica com booleanos: `aceitarSenha` e `aceitarCcePendente`
    - Quando ambos false → bloqueio total (reconferência obrigatória)
    - Atualizar schemas Zod para os novos campos booleanos
    - _Requirements: 3.4, 3.5, 3.6_

  - [ ]* 4.2 Write property test: Bloqueio Conferência persistence round-trip
    - **Property 5: Bloqueio Conferência persistence round-trip**
    - **Validates: Requirements 3.4**

  - [ ]* 4.3 Write property test: Default bloqueio mode
    - **Property 6: Default bloqueio mode**
    - **Validates: Requirements 3.5**

- [x] 5. Checkpoint — Validar modelos e módulos de configuração
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implementar serviço de e-mail fiscal
  - [x] 6.1 Criar email-fiscal.service.ts
    - Criar `src/modules/email-fiscal/email-fiscal.service.ts`
    - Configurar Nodemailer com SMTP via variáveis de ambiente (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM)
    - Implementar `enviarEmailDivergencia(dados)`: monta HTML com fornecedor, nº NF, data emissão, descrição produto, valor divergente, valores esperado vs conferido
    - Assunto do e-mail deve identificar nota fiscal e tipo de divergência
    - Implementar retry com 3 tentativas, intervalo fixo de 10s entre cada
    - Em caso de falha após 3 tentativas: registrar log de erro, marcar divergência como "pendente de notificação fiscal", não lançar exceção ao caller
    - Em caso de sucesso: registrar timestamp de envio vinculado à divergência
    - Se e-mail fiscal não configurado: registrar log de erro, retornar indicação de falha sem bloquear
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 6.2 Write property test: Email content contains all required fields
    - **Property 9: Email content contains all required fields**
    - **Validates: Requirements 5.2**

  - [ ]* 6.3 Write property test: Email retry exhaustion produces failure state
    - **Property 10: Email retry exhaustion produces failure state**
    - **Validates: Requirements 5.5**

- [x] 7. Implementar serviço de pendências CC-e
  - [x] 7.1 Criar pendencia-cce.service.ts
    - Criar `src/modules/pendencia-cce/pendencia-cce.service.ts`
    - Implementar `criarPendencia(dados)`: cria registro com status AGUARDANDO_CCE, campos obrigatórios preenchidos, tipo "LOTE" ou "VALIDADE", motivo correspondente
    - Implementar `listarPendencias(empresaId, filtros)`: lista com filtros opcionais (fornecedor partial match, intervalo de datas, status), ordenação por criadoEm desc
    - Implementar `resolverPendencia(id, novoStatus, resolvidoPorId)`: atualiza status para RESOLVIDA ou CANCELADA, registra resolvidoEm e resolvidoPorId
    - Validar que pendência existe (404) e está em AGUARDANDO_CCE (409 se já processada)
    - Implementar `verificarPendenciasAbertas(notaEntradaId)`: retorna true se existem pendências AGUARDANDO_CCE para a nota
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 7.1, 7.2, 7.5, 7.7_

  - [ ]* 7.2 Write property test: Pendência creation integrity
    - **Property 7: Pendência creation integrity**
    - **Validates: Requirements 4.1, 4.2, 4.3**

  - [ ]* 7.3 Write property test: Pendência listing returns ordered and filtered results
    - **Property 8: Pendência listing returns ordered and filtered results**
    - **Validates: Requirements 6.2, 6.5, 4.5**

  - [ ]* 7.4 Write property test: Pendência resolution records audit data
    - **Property 11: Pendência resolution records audit data**
    - **Validates: Requirements 7.1, 7.2**

  - [ ]* 7.5 Write property test: Recebimento blocking invariant
    - **Property 12: Recebimento blocking invariant**
    - **Validates: Requirements 7.5, 7.6**

- [x] 8. Implementar rotas de pendências (UI interna)
  - [x] 8.1 Criar pendencia-cce.routes.ts
    - Criar `src/modules/pendencia-cce/pendencia-cce.routes.ts`
    - Implementar `GET /api/pendencias-cce`: lista pendências com filtros (query params: fornecedor, dataInicio, dataFim, status)
    - Implementar `PATCH /api/pendencias-cce/:id/resolver`: resolução manual com body `{ status: "RESOLVIDA" | "CANCELADA" }`
    - Autenticação via JWT (hook preHandler padrão)
    - Registrar rota em `src/server.ts`
    - _Requirements: 6.2, 6.5, 7.1, 7.2, 7.7_

- [x] 9. Implementar rotas de pendências (API externa)
  - [x] 9.1 Criar pendencia-cce-externa.routes.ts
    - Criar `src/modules/pendencia-cce/pendencia-cce-externa.routes.ts`
    - Implementar `GET /api/v1/integracao/pendencias-cce`: lista pendências por status, autenticação via header X-Api-Key
    - Implementar `PATCH /api/v1/integracao/pendencias-cce/:id`: atualiza status para RESOLVIDA
    - Implementar middleware de validação de X-Api-Key: verificar presença (401 API_KEY_MISSING), validade (401 API_KEY_INVALID), e correspondência com ConfigIntegracao da empresa (403 INTEGRACAO_NAO_AUTORIZADA)
    - Registrar rota em `src/server.ts`
    - _Requirements: 4.5, 7.3, 7.4_

- [x] 10. Checkpoint — Validar serviços de e-mail e pendências
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implementar lógica de segunda conferência
  - [x] 11.1 Criar segunda-conferencia.service.ts
    - Criar `src/modules/conferencia-entrada/segunda-conferencia.service.ts`
    - Implementar `executarSegundaConferencia(notaId, itens, empresaId, userId)`:
      - Para cada item com statusConferencia=PENDENTE_SEGUNDA_CONFERENCIA:
        - Se valores 2ª conf == NF-e → status → CONFERIDO, divergência resolvida
        - Se valores 2ª conf ≠ NF-e → divergência confirmada
      - Para divergência confirmada:
        - Verificar ConfigConferenciaProduto do produto
        - Se `aceitarSenha=true` → sinalizar necessidade de senha supervisor (antes de pendência/email)
        - Se `aceitarCcePendente=true` (e senha não aplicável) → prosseguir para pendência/email
        - Se ambos false → bloqueio total (reconferência obrigatória)
      - Verificar ConfigIntegracao.integracaoAtiva:
        - Se ativa → chamar `PendenciaCceService.criarPendencia(...)`
        - Se inativa → chamar `EmailFiscalService.enviarEmailDivergencia(...)`
    - _Requirements: 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 11.2 Criar endpoint de segunda conferência
    - Adicionar `POST /api/conferencia-entrada/segunda-conferencia/:notaId` em `conferencia-entrada.routes.ts`
    - Validar body com `segundaConferenciaSchema` (Zod)
    - Chamar `SegundaConferenciaService.executarSegundaConferencia(...)`
    - Retornar resultado indicando ações tomadas (divergenciaResolvida, pendenciaCriada, emailEnviado, requerSenha)
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [ ]* 11.3 Write property test: Second conference auto-resolution
    - **Property 13: Second conference auto-resolution**
    - **Validates: Requirements 8.4**

  - [ ]* 11.4 Write property test: Second conference confirmed divergence triggers correct flow
    - **Property 14: Second conference confirmed divergence triggers correct flow**
    - **Validates: Requirements 8.3, 8.5**

  - [ ]* 11.5 Write property test: Resolution mode decision
    - **Property 15: Resolution mode decision**
    - **Validates: Requirements 8.6, 8.7, 3.5**

- [x] 12. Modificar fluxo existente de conferência para marcar PENDENTE_SEGUNDA_CONFERENCIA
  - [x] 12.1 Adaptar divergencia-lote-validade.service.ts
    - Modificar `src/modules/conferencia-entrada/divergencia-lote-validade.service.ts`
    - Remover lógica de `ACEITAR_LIVRE`
    - Quando detectar divergência de lote ou validade na 1ª conferência: marcar item com statusConferencia=PENDENTE_SEGUNDA_CONFERENCIA
    - Impedir finalização de recebimento de item em PENDENTE_SEGUNDA_CONFERENCIA
    - Adaptar lógica de resolução para usar novos booleanos `aceitarSenha` / `aceitarCcePendente`
    - _Requirements: 8.1, 3.5_

  - [x] 12.2 Adicionar bloqueio de finalização de recebimento com pendências abertas
    - Modificar lógica de finalização de recebimento (endpoint existente)
    - Antes de finalizar, chamar `PendenciaCceService.verificarPendenciasAbertas(notaEntradaId)`
    - Se houver pendências AGUARDANDO_CCE → retornar 422 com código `PENDENCIAS_NAO_RESOLVIDAS`
    - Quando todas resolvidas/canceladas → liberar para endereçamento
    - _Requirements: 7.5, 7.6_

- [x] 13. Checkpoint — Validar fluxo completo de segunda conferência
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Wiring final e validação de integração
  - [x] 14.1 Verificar registro de todas as rotas em server.ts
    - Confirmar que config-integracao, config-email-fiscal, pendencia-cce, pendencia-cce-externa estão registradas
    - Confirmar prefixos corretos e hooks de autenticação
    - _Requirements: 1.7, 2.6, 4.5, 7.1_

  - [ ]* 14.2 Write integration tests para endpoints de configuração
    - Testar CRUD config-integracao (criação, duplicata, validação sistemaExterno)
    - Testar CRUD config-email-fiscal (criação, validação, upsert)
    - _Requirements: 1.1, 1.3, 1.4, 2.2, 2.4_

  - [ ]* 14.3 Write integration tests para endpoints de pendências
    - Testar listagem com filtros, resolução manual, API externa com X-Api-Key
    - Testar bloqueio de finalização de recebimento
    - _Requirements: 4.5, 6.2, 7.1, 7.5_

  - [ ]* 14.4 Write integration tests para segunda conferência
    - Testar auto-resolução quando valores coincidem com NF-e
    - Testar criação de pendência quando integração ativa
    - Testar envio de e-mail quando integração inativa
    - _Requirements: 8.3, 8.4, 8.5_

- [x] 15. Final checkpoint — Validar todos os testes e integração
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- O design usa TypeScript como linguagem de implementação (Fastify + Prisma + Zod)
- fast-check já está disponível no projeto para property-based testing
- Nodemailer deve ser instalado como dependência para o serviço de e-mail (`npm install nodemailer @types/nodemailer`)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["1.4"] },
    { "id": 2, "tasks": ["2.1", "3.1", "4.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "3.2", "3.3", "4.2", "4.3"] },
    { "id": 4, "tasks": ["6.1", "7.1"] },
    { "id": 5, "tasks": ["6.2", "6.3", "7.2", "7.3", "7.4", "7.5", "8.1", "9.1"] },
    { "id": 6, "tasks": ["11.1"] },
    { "id": 7, "tasks": ["11.2", "12.1"] },
    { "id": 8, "tasks": ["11.3", "11.4", "11.5", "12.2"] },
    { "id": 9, "tasks": ["14.1"] },
    { "id": 10, "tasks": ["14.2", "14.3", "14.4"] }
  ]
}
```
