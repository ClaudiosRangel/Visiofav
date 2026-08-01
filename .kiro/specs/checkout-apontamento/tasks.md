# Implementation Plan: Checkout de Apontamento

## Overview

A implementação segue a decisão de design central: extrair a lógica hoje
inline em `etapa-operacional.routes.ts` para um service compartilhado
(`etapa-operacional.service.ts`), e só então construir a nova camada de
autenticação (Terminal + PIN) e as regras de negócio exclusivas do Checkout
(`checkout.service.ts`) por cima dela — nunca duplicando `iniciar`/`pausar`/
`apontar`/`concluir`. As migrações de banco (novos campos e novas tabelas)
vêm primeiro, pois todo o restante depende do schema já existir.

Depois que as rotas do Checkout estiverem implementadas e registradas no
backend, o plano segue para o **novo app web `VisioFab.Checkout`**
(Next.js, separado do `VisioFab.Wms.Front` existente), construindo as
telas descritas na seção "Frontend — novo app web (esboço de estrutura)"
do `design.md`: autenticação de Terminal/Operador, painel de etapas, tela
de ação principal, apontamento (produção/perda/retrabalho), pausa,
pendência de material, telas de Supervisor (alertas e autorização
retroativa) e histórico — sempre consumindo as rotas do Checkout já
implementadas no bloco de backend.

Linguagem: TypeScript em ambas as camadas.
- **Backend**: mesma stack do restante do `VisioFab.Wms.Back` — Fastify +
  Prisma + Zod + Vitest + fast-check.
- **Frontend**: Next.js 15 (App Router), consistente com a stack já usada
  em `VisioFab.Wms.Front` (Vitest + Testing Library para testes unitários,
  Playwright para testes e2e). O Checkout não reaproveita o design system
  Mantine do `VisioFab.Wms.Front` — é um app novo, com layout próprio
  otimizado para toque (Requirement 14).

## Task Dependency Graph

Visão de alto nível (fluxo entre blocos de tarefas):

```mermaid
graph TD
    T1[1. Migrações de banco] --> T2[2. Extrair etapa-operacional.service.ts]
    T2 --> CP1[Checkpoint 3]
    CP1 --> T4[4. pin-operador.service.ts]
    CP1 --> T5[5. sessao-terminal.service.ts]
    T4 --> T6[6. checkout-auth.middleware.ts]
    T5 --> T6
    T6 --> T7[7. Rejeição cruzada no authenticate existente]
    T6 --> T8[8. checkout-auth.routes.ts]
    T5 --> T8
    T4 --> T8
    T7 --> CP2[Checkpoint 9]
    T8 --> CP2
    CP2 --> T10[10. checkout.service.ts - regras de negócio]
    T2 --> T10
    T10 --> CP3[Checkpoint 11]
    CP3 --> T12[12. checkout.routes.ts]
    T6 --> T12
    T12 --> T13[13. Wiring final no server.ts]
    T13 --> CP4[Checkpoint 14 — backend completo]

    %% Frontend — VisioFab.Checkout (novo app), consome as rotas de backend acima
    CP4 --> T15[15. Setup do projeto Next.js VisioFab.Checkout]
    T15 --> T16[16. lib/checkout-api-client.ts + contexts/sessao-terminal-context.tsx]
    T16 --> CP5[Checkpoint 17]
    CP5 --> T18[18. Tela login-terminal]
    CP5 --> T19[19. pin-keypad.tsx + tela identificar-operador]
    T8 -.rotas de auth prontas.-> T18
    T8 -.rotas de auth prontas.-> T19
    T18 --> T20[20. Tela painel]
    T19 --> T20
    T12 -.GET painel pronto.-> T20
    T20 --> T21[21. Tela etapa/[id] + operadores ativos]
    T12 -.rotas de iniciar/operadores prontas.-> T21
    T21 --> CP6[Checkpoint 22]
    CP6 --> T23[23. Tela apontar]
    CP6 --> T24[24. Tela pausar]
    CP6 --> T25[25. Tela pendencia-material]
    CP6 --> T26[26. Telas Supervisor - alertas e autorizar-retroativo]
    CP6 --> T27[27. Histórico de apontamentos]
    T12 -.rotas apontar/pausar/pendencia/retroativo/alertas prontas.-> T23
    T12 -.-> T24
    T12 -.-> T25
    T12 -.-> T26
    T12 -.-> T27
    T23 --> T28[28. Responsividade mobile-first e usabilidade de toque]
    T24 --> T28
    T25 --> T28
    T26 --> T28
    T27 --> T28
    T28 --> T29[29. Wiring final do frontend]
    T29 --> CP7[Checkpoint 30 — final]
```

Waves de execução (ordem exata de subtarefas, para paralelização):

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6"] },
    { "id": 1, "tasks": ["1.7", "2.1"] },
    { "id": 2, "tasks": ["2.2"] },
    { "id": 3, "tasks": ["2.3", "2.4", "4.1", "5.1"] },
    { "id": 4, "tasks": ["4.2", "5.2"] },
    { "id": 5, "tasks": ["4.3", "4.4", "4.5", "5.3", "6.1"] },
    { "id": 6, "tasks": ["6.2", "7.1"] },
    { "id": 7, "tasks": ["7.2", "8.1"] },
    { "id": 8, "tasks": ["8.2", "8.3", "8.4"] },
    { "id": 9, "tasks": ["8.5", "8.6"] },
    { "id": 10, "tasks": ["10.1"] },
    { "id": 11, "tasks": ["10.2", "10.3"] },
    { "id": 12, "tasks": ["10.4", "10.5", "10.8"] },
    { "id": 13, "tasks": ["10.6", "10.7", "10.9"] },
    { "id": 14, "tasks": ["10.10", "10.11", "10.12"] },
    { "id": 15, "tasks": ["10.13", "10.14", "10.15"] },
    { "id": 16, "tasks": ["10.16", "10.17", "10.18"] },
    { "id": 17, "tasks": ["10.19"] },
    { "id": 18, "tasks": ["10.20", "10.21", "10.22"] },
    { "id": 19, "tasks": ["10.23", "10.24"] },
    { "id": 20, "tasks": ["12.1", "12.2", "12.3", "12.4", "12.5", "12.6", "12.7"] },
    { "id": 21, "tasks": ["12.8"] },
    { "id": 22, "tasks": ["12.9", "12.10", "12.11"] },
    { "id": 23, "tasks": ["13.1"] },
    { "id": 24, "tasks": ["13.2"] },
    { "id": 25, "tasks": ["15.1", "15.2", "15.3"] },
    { "id": 26, "tasks": ["15.4"] },
    { "id": 27, "tasks": ["16.1", "16.2"] },
    { "id": 28, "tasks": ["16.3", "16.4"] },
    { "id": 29, "tasks": ["18.1", "19.1"] },
    { "id": 30, "tasks": ["18.2", "19.2", "19.3"] },
    { "id": 31, "tasks": ["18.3", "19.4"] },
    { "id": 32, "tasks": ["20.1"] },
    { "id": 33, "tasks": ["20.2", "20.3"] },
    { "id": 34, "tasks": ["21.1", "21.2"] },
    { "id": 35, "tasks": ["21.3", "21.4"] },
    { "id": 36, "tasks": ["23.1", "24.1", "25.1", "26.1", "26.3", "27.1"] },
    { "id": 37, "tasks": ["23.2", "23.3", "24.2", "25.2", "26.2", "26.4", "27.2"] },
    { "id": 38, "tasks": ["28.1", "28.2"] },
    { "id": 39, "tasks": ["28.3", "28.4"] },
    { "id": 40, "tasks": ["29.1"] },
    { "id": 41, "tasks": ["29.2"] }
  ]
}
```

## Tasks

- [x] 1. Migrações de banco de dados
  - Seguir o padrão idempotente documentado em `database-migrations.md`:
    toda alteração em `schema.prisma` deve ter o `ALTER TABLE`/`CREATE
    TABLE` equivalente em `prisma/migrate-prod.ts`
  - _Requirements: 2.1, 6.1, 6.3, 7.3, 8.2, 9.4, 10.2, 10.3, 11.2, 12.1, 15.1, 15.4_

  - [x] 1.1 Estender `Funcionario` com campos de PIN
    - Adicionar `pinHash String?` e `pinAtivo Boolean @default(false)` ao
      model `Funcionario` em `schema.prisma`
    - Adicionar `ALTER TABLE "funcionario" ADD COLUMN IF NOT EXISTS
      "pin_hash" VARCHAR(200)` e `"pin_ativo" BOOLEAN DEFAULT false` em
      `migrate-prod.ts`
    - _Requirements: 2.1_

  - [x] 1.2 Estender `ApontamentoEtapa` com campos do Checkout
    - Adicionar `quantidadeRetrabalho`, `fonteApontamento`,
      `paradaPlanejada`, `setupInicio`, `setupFim`, `setupDuracaoMinutos`,
      `apontamentoOrigemId` (auto-referência), `motivoRetroativo`,
      `autorizadoPorUsuarioId` ao model `ApontamentoEtapa`, com índices em
      `fonteApontamento` e `apontamentoOrigemId`
    - Adicionar os `ALTER TABLE`/`CREATE INDEX IF NOT EXISTS` equivalentes
      em `migrate-prod.ts`, incluindo a `FOREIGN KEY` de auto-referência
      dentro de `try/catch` individual
    - _Requirements: 6.1, 6.3, 7.3, 8.2, 11.2, 15.1, 15.4_

  - [x] 1.3 Criar model `SessaoTerminal`
    - Campos conforme design: `empresaId`, `centroProducaoId`,
      `autenticadaPorUsuarioId`, `status`, `criadaEm`, `expiraEm`,
      `encerradaEm`, com índices `[empresaId, status]` e
      `[centroProducaoId, status]`
    - `CREATE TABLE IF NOT EXISTS "sessao_terminal"` equivalente em
      `migrate-prod.ts`
    - _Requirements: 1.1, 1.5_

  - [x] 1.4 Criar model `PendenciaMaterial`
    - Campos conforme design: `empresaId`, `etapaOrdemProducaoId`,
      `apontamentoParadaId`, `descricao`, `status`, `criadaEm`,
      `resolvidaEm`, `resolvidaPorUsuarioId`
    - `CREATE TABLE IF NOT EXISTS "pendencia_material"` equivalente em
      `migrate-prod.ts`
    - _Requirements: 12.1_

  - [x] 1.5 Criar model `OperadorAtivoEtapa`
    - Campos conforme design: `empresaId`, `etapaOrdemProducaoId`,
      `funcionarioId`, `entradaEm`, `saidaEm`, com índice
      `[etapaOrdemProducaoId, saidaEm]`
    - `CREATE TABLE IF NOT EXISTS "operador_ativo_etapa"` equivalente em
      `migrate-prod.ts`
    - _Requirements: 10.2, 10.3_

  - [x] 1.6 Criar model `EtapaAutorizacaoSequencia`
    - Campos conforme design: `empresaId`, `etapaOrdemProducaoId`,
      `etapaBloqueadoraId`, `autorizadoPorUsuarioId`, `criadaEm`
    - `CREATE TABLE IF NOT EXISTS "etapa_autorizacao_sequencia"`
      equivalente em `migrate-prod.ts`
    - _Requirements: 9.4_

  - [x] 1.7 Validar migrações localmente
    - Rodar `npx prisma migrate dev` para gerar a migration local e o SQL
      de referência
    - Rodar `npx tsx prisma/migrate-prod.ts` duas vezes seguidas contra o
      banco local, confirmando que é idempotente (sem erro na segunda
      execução)
    - _Requirements: 1.1, 2.1, 6.1, 9.4, 10.2, 11.2, 12.1_

- [x] 2. Extrair `etapa-operacional.service.ts` (refatoração pré-requisito)
  - Esta refatoração é o pré-requisito para todo o restante: sem ela,
    qualquer regra nova do Checkout teria que ser duplicada ou chamar a
    própria rota interna via HTTP
  - _Requirements: 5.1, 7.1, 8.4, 9.5, 9.6_

  - [x] 2.1 Criar funções puras de negócio em `etapa-operacional.service.ts`
    - Extrair `iniciarEtapa(etapaId, empresaId, funcionarioId)`,
      `pausarEtapa(etapaId, empresaId, dados)`,
      `apontarProducao(etapaId, empresaId, dados)`,
      `concluirEtapa(etapaId, empresaId)` a partir da lógica hoje inline em
      `etapa-operacional.routes.ts`, recebendo `empresaId` explícito e
      retornando o resultado (sem depender de `FastifyRequest`/`FastifyReply`)
    - Preservar exatamente o comportamento já existente (filtro por
      empresa via `ordemProducao.empresaId`, criação de `ApontamentoEtapa`
      tipo `RETOMADA` ao retomar de `PAUSADA`, integração com WMS ao
      concluir a última etapa)
    - _Requirements: 5.1, 7.1, 8.4, 9.5, 9.6_

  - [x] 2.2 Atualizar `etapa-operacional.routes.ts` para usar o service
    - Substituir a lógica inline dos handlers `PATCH /etapas/:id/iniciar`,
      `PATCH /etapas/:id/pausar`, `POST /etapas/:id/apontar`,
      `PATCH /etapas/:id/concluir` por chamadas às funções extraídas em 2.1
    - Garantir que a assinatura pública das rotas (request/response) não
      muda
    - _Requirements: 5.1, 7.1, 9.5_

  - [ ]* 2.3 Escrever testes de regressão do service extraído
    - Testes unitários com mocks do Prisma cobrindo os 4 fluxos
      (iniciar/pausar/apontar/concluir), incluindo o caso de retomada
      gerando `ApontamentoEtapa` tipo `RETOMADA` e o caso de conclusão da
      última etapa disparando a integração com o WMS
    - _Requirements: 5.1, 5.3, 9.5_

  - [ ]* 2.4 Rodar suíte de testes já existente de `etapa-operacional.routes.ts`
    - Confirmar que a suíte existente do módulo PCP continua passando após
      a extração, sem alteração de comportamento observável
    - _Requirements: 5.1, 7.1, 9.5_

- [x] 3. Checkpoint — Garantir que todos os testes passam
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implementar `pin-operador.service.ts`
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 4.1, 4.2, 4.3, 4.4, 17.1_

  - [x] 4.1 Implementar hash e verificação de PIN
    - `criarHashPin(pin: string): Promise<string>` usando `bcryptjs`
      (mesmo padrão já usado no projeto para senha)
    - `identificarOperadorPorPin(empresaId: string, pin: string)` — busca
      `Funcionario` ativo filtrado por `empresaId`, compara hash, retorna
      `{ funcionarioId, nome }` ou erro genérico sem revelar se o PIN
      existe para outro `Funcionario`
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 17.1_

  - [x] 4.2 Implementar rate limiting por Terminal
    - Contador de tentativas falhas por `sessaoTerminalId` (via
      `SecurityAuditLog` agregado nos últimos 15 minutos, ou tabela leve
      dedicada — conforme decisão registrada no design)
    - Bloquear novas tentativas após 5 falhas consecutivas por 15 minutos,
      retornando o tempo restante
    - Registrar toda tentativa falha no `SecurityAuditLog` com Terminal e
      horário
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ]* 4.3 Escrever property test — Rate limiting bloqueia e libera corretamente
    - **Property 10: Rate limiting de PIN bloqueia e depois libera
      corretamente**
    - **Validates: Requirements 4.1, 4.3, 4.4**

  - [ ]* 4.4 Escrever property test — PIN nunca aceito fora da empresa do terminal
    - **Property 8: PIN nunca é aceito fora da empresa do terminal**
    - **Validates: Requirements 2.2, 2.3, 17.1**

  - [ ]* 4.5 Escrever unit tests de identificação de operador
    - Casos de exemplo: PIN válido, PIN inexistente, PIN de funcionário
      inativo, tentativa durante bloqueio ativo
    - _Requirements: 2.3, 4.3_

- [x] 5. Implementar `sessao-terminal.service.ts`
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 17.3_

  - [x] 5.1 Implementar criação de Sessão_Terminal
    - `criarSessaoTerminal(credenciais, centroProducaoId)` — valida
      `Usuario` (perfil `ADMIN`/`SUPERVISOR`), cria `SessaoTerminal` com
      `expiraEm = criadaEm + 12h`, grava tentativa inválida/perfil não
      autorizado no `SecurityAuditLog`
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 5.2 Implementar expiração e troca de centro
    - `sessaoEstaAtiva(sessaoTerminalId)` — verifica `status` e `expiraEm`
    - `trocarCentroSessao(sessaoTerminalId, novoCentroProducaoId,
      credenciaisSupervisor)` — exige nova autenticação de Supervisor
    - _Requirements: 1.5, 1.6_

  - [ ]* 5.3 Escrever unit tests de sessão de terminal
    - Casos de exemplo: login válido, credenciais inválidas, perfil não
      autorizado, sessão expirada após 12h, troca de centro
    - _Requirements: 1.2, 1.3, 1.5, 1.6_

- [x] 6. Implementar `checkout-auth.middleware.ts`
  - _Requirements: 3.1, 3.3, 3.4_

  - [x] 6.1 Implementar middleware de validação de escopo
    - Verificar JWT, validar `payload.scope === 'CHECKOUT_OPERADOR'`,
      validar que a `SessaoTerminal` referenciada ainda está `ATIVA`
    - Popular `request.checkoutUser` com `empresaId`, `centroProducaoId`,
      `sessaoTerminalId`
    - Rejeitar com 401 se token expirado/inválido, com 403 se escopo
      diferente de `CHECKOUT_OPERADOR`
    - _Requirements: 3.1, 3.3, 3.4_

  - [ ]* 6.2 Escrever unit tests do middleware
    - Casos de exemplo: token válido, token expirado, token de escopo
      diferente, sessão encerrada
    - _Requirements: 3.3, 3.4_

- [x] 7. Reforçar rejeição cruzada no middleware `authenticate` existente
  - _Requirements: 3.2_

  - [x] 7.1 Rejeitar tokens `CHECKOUT_OPERADOR` nas rotas do ERP
    - Adicionar verificação em `src/middleware/authenticate.ts`: se
      `payload.scope === 'CHECKOUT_OPERADOR'`, rejeitar com 403 (mesmo
      padrão já usado para `portalAuth`, mas no sentido inverso)
    - _Requirements: 3.2_

  - [ ]* 7.2 Escrever property test — Escopo do token respeitado nos dois sentidos
    - **Property 7: Escopo do token é respeitado nos dois sentidos**
    - **Validates: Requirements 3.2, 3.3**

- [x] 8. Implementar `checkout-auth.routes.ts`
  - _Requirements: 1.1, 1.2, 1.3, 1.6, 1.7, 2.2, 2.3, 2.4, 2.6, 16.2_

  - [x] 8.1 Implementar `POST /checkout/auth/sessao`
    - Autentica Supervisor, informa `centroProducaoId`, chama
      `criarSessaoTerminal`, emite `Token_Checkout` (escopo
      `CHECKOUT_OPERADOR`, expiração 12h)
    - _Requirements: 1.1, 1.2, 1.3, 1.7_

  - [x] 8.2 Implementar `PATCH /checkout/auth/sessao/trocar-centro`
    - Requer nova autenticação de Supervisor, chama `trocarCentroSessao`
    - _Requirements: 1.6_

  - [x] 8.3 Implementar `DELETE /checkout/auth/sessao`
    - Encerra a sessão manualmente (`status = 'ENCERRADA'`)
    - _Requirements: 1.4_

  - [x] 8.4 Implementar `POST /checkout/operador/identificar`
    - Protegida por `checkoutAuth`, chama `identificarOperadorPorPin` e o
      rate limiting de 4.2, retorna `{ funcionarioId, nome }`
    - _Requirements: 2.2, 2.3, 2.4, 2.6, 16.2_

  - [ ]* 8.5 Escrever unit tests de erro das rotas de autenticação
    - Cobrir a tabela de Error Handling do design: credenciais inválidas,
      perfil não autorizado, token expirado, PIN inválido, 5ª tentativa
      falha, tentativa durante bloqueio
    - _Requirements: 1.2, 1.3, 2.3, 4.1, 4.3_

  - [ ]* 8.6 Escrever integration test do fluxo de autenticação completo
    - `POST /checkout/auth/sessao` → `POST /checkout/operador/identificar`
      contra um banco de teste, verificando `Token_Checkout` válido e
      `funcionarioId` retornado
    - _Requirements: 1.1, 2.2_

- [x] 9. Checkpoint — Garantir que todos os testes passam
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implementar `checkout.service.ts` — regras de negócio exclusivas do Checkout
  - _Requirements: 5.2, 6.1, 6.2, 6.3, 6.4, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 9.1, 9.2, 9.3, 9.4, 10.1, 10.2, 10.3, 10.4, 10.5, 11.1, 11.2, 11.3, 11.4, 11.5, 12.1, 12.2, 12.3, 12.4, 13.1, 13.2, 13.3, 15.2, 15.3, 15.4, 17.1, 17.2, 17.3_

  - [x] 10.1 Implementar filtro de etapa por centro e empresa
    - Função utilitária `buscarEtapaDoTerminal(etapaId, checkoutUser)` que
      filtra por `centroProducaoId` da sessão **e** por
      `ordemProducao.empresaId`, retornando `null` (→ 404 idêntico) em
      ambos os casos de falha
    - Usada por todas as demais funções deste service
    - _Requirements: 5.2, 17.1, 17.2_

  - [ ]* 10.2 Escrever property test — Isolamento multi-tenant em toda consulta do Checkout
    - **Property 5: Isolamento multi-tenant em toda consulta do Checkout**
    - **Validates: Requirements 17.1, 17.2**

  - [x] 10.3 Implementar setup como evento próprio
    - `iniciarSetup(etapaId, checkoutUser)` — cria `ApontamentoEtapa` tipo
      `SETUP` com `setupInicio`, rejeita se já houver setup em aberto
    - `finalizarSetup(etapaId, checkoutUser)` — grava `setupFim`, calcula
      `setupDuracaoMinutos`
    - Bloquear apontamento de `PRODUCAO` enquanto houver `SETUP` em aberto
      para a etapa
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 10.4 Escrever property test — Setup em aberto bloqueia novo setup e produção
    - **Property 9: Setup em aberto bloqueia novo setup e bloqueia
      apontamento de produção**
    - **Validates: Requirements 6.2, 6.4**

  - [x] 10.5 Implementar apontamento de produção, perda e retrabalho
    - `registrarApontamentoProducao(etapaId, checkoutUser, dados)` —
      delega para `etapaOperacionalService.apontarProducao()` quando tipo
      `PRODUCAO`; grava `ApontamentoEtapa` tipo `PERDA` (com
      `motivoPerda`) ou `RETRABALHO` (incrementando
      `quantidadeRetrabalho`, nunca `quantidadePerda`) para os demais
      tipos
    - Validar quantidade não-negativa (Zod) antes de qualquer persistência
    - Suportar anexo de foto opcional reaproveitando o upload já existente
    - _Requirements: 7.2, 7.3, 7.4, 7.5_

  - [ ]* 10.6 Escrever property test — Retrabalho nunca é contado como perda
    - **Property 11: Retrabalho nunca é contado como perda**
    - **Validates: Requirements 7.3**

  - [ ]* 10.7 Escrever property test — Rejeição de quantidades negativas
    - **Property 12: Rejeição de quantidades negativas**
    - **Validates: Requirements 7.5**

  - [x] 10.8 Implementar parada com planejada/não planejada
    - Estender chamada a `etapaOperacionalService.pausarEtapa()` exigindo
      motivo de parada e indicador planejada/não planejada
    - Sinalizar parada não planejada com motivo `MANUTENCAO` como
      candidata a ordem de manutenção
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 10.9 Implementar bloqueio de sequência entre etapas dependentes
    - `verificarSequenciaConcluivel(etapaId, checkoutUser)` — verifica se
      todas as etapas de sequência anterior da mesma `OrdemProducao` estão
      `CONCLUIDA`, ignorando etapas resultantes do mesmo desmembramento
      (`quantidadePrevista > 0` com mesma sequência original)
    - `concluirEtapaComBloqueio(etapaId, checkoutUser,
      autorizacaoSupervisor?)` — bloqueia a conclusão se houver etapa
      anterior pendente sem `EtapaAutorizacaoSequencia`; se autorizada,
      registra a autorização e delega para
      `etapaOperacionalService.concluirEtapa()`
    - Se a `OrdemProducao` estiver `CANCELADA` ou alguma validação falhar,
      não chamar a rota interna de conclusão, mantendo a etapa no status
      atual
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.6_

  - [ ]* 10.10 Escrever property test — Bloqueio de sequência entre etapas dependentes
    - **Property 3: Bloqueio de sequência entre etapas dependentes**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**

  - [ ]* 10.11 Escrever property test — Etapas desmembradas nunca bloqueadas entre si
    - **Property 4: Etapas desmembradas nunca são bloqueadas entre si por
      sequência**
    - **Validates: Requirements 9.3**

  - [x] 10.12 Implementar múltiplos operadores simultâneos na etapa
    - `registrarEntradaOperador(etapaId, checkoutUser, funcionarioId)` —
      cria `OperadorAtivoEtapa` com `entradaEm`
    - `registrarSaidaOperador(etapaId, checkoutUser, funcionarioId)` —
      grava `saidaEm` apenas para esse operador, preservando os demais
      ativos
    - `listarOperadoresAtivos(etapaId, checkoutUser)` — retorna operadores
      sem `saidaEm`
    - Ao registrar apontamento, vincular ao `funcionarioId` informado sem
      alterar o registro dos demais operadores ativos
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [ ]* 10.13 Escrever property test — Apontamento vinculado ao autor, demais operadores preservados
    - **Property 13: Múltiplos operadores — apontamento vinculado ao
      autor, demais preservados**
    - **Validates: Requirements 10.5**

  - [ ]* 10.14 Escrever property test — Saída de operador preserva os demais ativos
    - **Property 14: Saída de operador preserva os demais ativos**
    - **Validates: Requirements 10.3**

  - [x] 10.15 Implementar apontamento retroativo e correção auditável
    - `registrarApontamentoRetroativo(apontamentoOrigemId, checkoutUser,
      motivo, autorizacaoSupervisor)` — bloqueia sem autorização de
      Supervisor; cria novo `ApontamentoEtapa` referenciando
      `apontamentoOrigemId`, nunca apaga ou sobrescreve o original
    - Recalcular totais da etapa considerando apontamentos originais e
      retroativos
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [ ]* 10.16 Escrever property test — Apontamentos nunca são apagados ou sobrescritos
    - **Property 1: Apontamentos nunca são apagados ou sobrescritos**
    - **Validates: Requirements 11.1**

  - [ ]* 10.17 Escrever property test — Totais da etapa reconciliáveis com a soma dos apontamentos
    - **Property 2: Totais da etapa são sempre reconciliáveis com a soma
      dos apontamentos (originais + retroativos)**
    - **Validates: Requirements 7.1, 7.2, 11.4**

  - [x] 10.18 Implementar pendência de falta de material durante a produção
    - `registrarPendenciaMaterial(etapaId, checkoutUser, descricao?)` —
      cria `PendenciaMaterial` vinculada à etapa e um `ApontamentoEtapa`
      tipo `PARADA` com motivo `FALTA_MATERIAL`, vinculando os dois
      registros
    - `resolverPendenciaMaterial(pendenciaId, checkoutUser)` — marca
      `resolvidaEm`/`resolvidaPorUsuarioId`, permitindo retomada normal da
      etapa
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [x] 10.19 Garantir `empresaId` sempre da entidade de negócio real
    - Revisar todas as criações de `ApontamentoEtapa`, `PendenciaMaterial`,
      `SessaoTerminal`, `OperadorAtivoEtapa` implementadas nas subtarefas
      anteriores para gravar o `empresaId` resolvido via
      `ordemProducao.empresaId`/`centroProducao`, nunca o `empresaId` do
      `Usuario` que autenticou a ação
    - _Requirements: 17.3_

  - [ ]* 10.20 Escrever property test — Empresa gravada é sempre a da entidade de negócio real
    - **Property 6: Empresa gravada é sempre a da entidade de negócio
      real**
    - **Validates: Requirements 17.3**

  - [x] 10.21 Implementar fonte de apontamento (origem manual vs integração futura)
    - Garantir que todo `ApontamentoEtapa` criado pelas rotas do Checkout
      grava `fonteApontamento = 'MANUAL_OPERADOR'`
    - Garantir que o modelo de dados permite `funcionarioId` ausente
      quando `fonteApontamento = 'INTEGRACAO_MAQUINA'` (sem exigir
      operador identificado nesse caso)
    - _Requirements: 15.2, 15.3, 15.4_

  - [x] 10.22 Implementar alerta de etapa pausada há muito tempo
    - `listarEtapasEmAlertaParadaProlongada(checkoutUser)` — identifica
      `EtapaOrdemProducao` com status `PAUSADA` há mais de 60 minutos
      (baseado no horário do último `ApontamentoEtapa` tipo `PARADA`)
    - Alerta deixa de ser retornado quando a etapa é retomada ou concluída
    - _Requirements: 13.1, 13.2, 13.3_

  - [ ]* 10.23 Escrever unit tests do alerta de parada prolongada com fake timers
    - Casos de exemplo: etapa pausada há 61 minutos aparece no alerta;
      etapa retomada some do alerta; etapa concluída some do alerta
    - _Requirements: 13.1, 13.3_

  - [x] 10.24 Implementar histórico de apontamentos por etapa
    - `listarHistoricoApontamentos(etapaId, checkoutUser)` — retorna
      apontamentos em ordem cronológica com Operador, tipo, quantidade,
      motivo, horário, e vínculo original/retroativo distinguível
    - _Requirements: 16.1, 16.3, 16.4_

- [x] 11. Checkpoint — Garantir que todos os testes passam
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Implementar `checkout.routes.ts` — rotas operacionais expostas
  - _Requirements: 5.1, 5.2, 5.4, 6.1, 6.3, 7.1, 7.2, 7.3, 8.1, 8.4, 9.5, 10.1, 10.4, 11.2, 12.1, 12.4, 13.2, 14.1, 14.2, 14.3, 16.1_

  - [x] 12.1 Implementar `GET /checkout/painel` e `PATCH /checkout/etapas/:id/iniciar`
    - Painel lista apenas etapas do `Centro_Producao` da sessão; iniciar
      delega para `etapaOperacionalService.iniciarEtapa()` via 10.1
    - _Requirements: 5.1, 5.2, 5.4_

  - [x] 12.2 Implementar rotas de setup
    - `POST /checkout/etapas/:id/setup/iniciar` e
      `PATCH /checkout/etapas/:id/setup/finalizar`, delegando para 10.3
    - _Requirements: 6.1, 6.3_

  - [x] 12.3 Implementar `POST /checkout/etapas/:id/apontar` e `PATCH /checkout/etapas/:id/pausar`
    - Delegando para 10.5 e 10.8, respectivamente
    - _Requirements: 7.1, 7.2, 7.3, 8.1_

  - [x] 12.4 Implementar `PATCH /checkout/etapas/:id/concluir`
    - Delegando para 10.9 (bloqueio de sequência + integração WMS)
    - _Requirements: 9.5_

  - [x] 12.5 Implementar rotas de operadores ativos
    - `POST /checkout/etapas/:id/operadores/entrar`,
      `PATCH /checkout/etapas/:id/operadores/saida`,
      `GET /checkout/etapas/:id/operadores`, delegando para 10.12
    - _Requirements: 10.1, 10.4_

  - [x] 12.6 Implementar rotas de retroativo e pendência de material
    - `POST /checkout/apontamentos/:id/retroativo`,
      `POST /checkout/etapas/:id/pendencia-material`,
      `PATCH /checkout/pendencias-material/:id/resolver`, delegando para
      10.15 e 10.18
    - _Requirements: 11.2, 12.1, 12.4_

  - [x] 12.7 Implementar rotas de histórico e alertas
    - `GET /checkout/etapas/:id/apontamentos` (10.24),
      `GET /checkout/supervisor/alertas` (10.22)
    - _Requirements: 13.2, 16.1_

  - [x] 12.8 Registrar `checkoutAuth` como preHandler em todas as rotas de 12.1–12.7
    - Garantir que nenhuma rota do módulo, fora de `checkout-auth.routes.ts`,
      fica acessível sem o `Token_Checkout`
    - _Requirements: 14.1, 14.2, 14.3_

  - [ ]* 12.9 Escrever integration test do fluxo completo de apontamento
    - `POST /checkout/auth/sessao` → `POST /checkout/operador/identificar`
      → `POST /checkout/etapas/:id/apontar` contra banco de teste,
      verificando `fonteApontamento='MANUAL_OPERADOR'` e `empresaId`
      correto
    - _Requirements: 15.2, 17.3_

  - [ ]* 12.10 Escrever integration test de conclusão com disparo de integração WMS
    - Confirmar que `PATCH /checkout/etapas/:id/concluir`, ao ser a última
      etapa da OP, aciona a mesma chamada ao service compartilhado já
      testada pela suíte de `etapa-operacional.routes.ts`
    - _Requirements: 9.5_

  - [ ]* 12.11 Escrever integration test de rejeição cruzada de escopo (ponta a ponta)
    - Requisição com `Token_Checkout` contra uma rota real do ERP e
      requisição com token de login normal contra uma rota real do
      Checkout, ambas devem ser rejeitadas
    - _Requirements: 3.2, 3.3_

- [x] 13. Registrar módulo Checkout na aplicação
  - _Requirements: 3.1, 3.2, 3.3_

  - [x] 13.1 Registrar rotas no `server.ts`
    - Importar e registrar `checkoutAuthRoutes` e `checkoutRoutes` com
      prefixo `/api/checkout`, seguindo o mesmo padrão de registro já
      usado para `portalRoutes`
    - _Requirements: 3.1_

  - [ ]* 13.2 Escrever smoke test de inicialização do servidor
    - Verificar que o servidor inicia com as novas rotas registradas e
      responde 401 (não 500) em uma chamada sem token às rotas protegidas
    - _Requirements: 3.3_

- [x] 14. Checkpoint — Backend completo, garantir que todos os testes passam
  - Ensure all tests pass, ask the user if questions arise.
  - A partir daqui, o restante do plano é o frontend (`VisioFab.Checkout`),
    que consome as rotas de backend já implementadas e testadas acima.

- [x] 15. Setup do projeto Next.js `VisioFab.Checkout`
  - Novo app, separado do `VisioFab.Wms.Front` existente — novo
    repositório/diretório, novo domínio/deploy
  - _Requirements: 14.1, 14.4_

  - [x] 15.1 Inicializar o projeto Next.js (App Router) com TypeScript
    - `create-next-app` com TypeScript, App Router, sem Mantine (layout
      próprio mobile-first, conforme design)
    - Configurar ESLint/Prettier seguindo o mesmo padrão já usado em
      `VisioFab.Wms.Front`
    - Configurar Vitest + Testing Library (testes unitários de
      componentes) e Playwright (testes e2e), replicando a configuração
      já usada em `VisioFab.Wms.Front`
    - _Requirements: 14.1, 14.4_

  - [x] 15.2 Criar estrutura de diretórios base
    - Criar `src/app/`, `src/lib/`, `src/contexts/` conforme esboço do
      `design.md` (seção "Frontend — novo app web")
    - _Requirements: 14.4_

  - [x] 15.3 Configurar variáveis de ambiente e build
    - `NEXT_PUBLIC_CHECKOUT_API_URL` apontando para a API do
      `VisioFab.Wms.Back` (prefixo `/api/checkout`), seguindo o mesmo
      padrão de env var já usado em `VisioFab.Wms.Front`
    - _Requirements: 14.4_

  - [ ]* 15.4 Escrever smoke test de build do projeto
    - Verificar que `next build` completa sem erro e que a página raiz
      redireciona para `login-terminal`
    - _Requirements: 14.4_

- [x] 16. Implementar cliente de API e contexto de sessão do Terminal
  - _Requirements: 1.4, 1.7, 3.4_

  - [x] 16.1 Implementar `lib/checkout-api-client.ts`
    - Instância axios com `baseURL` da API do Checkout, interceptor que
      anexa `Token_Checkout` (Bearer) armazenado localmente
      (`localStorage`/cookie), e interceptor de resposta que trata 401
      (token expirado/inválido) redirecionando para `login-terminal`
    - _Requirements: 1.7, 3.4_

  - [x] 16.2 Implementar `contexts/sessao-terminal-context.tsx`
    - Contexto React expondo `centroProducaoId` vinculado, tempo restante
      da sessão (contagem decrescente até `expiraEm`), e função de logout/
      encerramento manual da sessão
    - _Requirements: 1.4_

  - [ ]* 16.3 Escrever unit tests do cliente de API
    - Casos de exemplo: token anexado corretamente ao header, resposta 401
      dispara redirecionamento/limpeza de sessão
    - _Requirements: 1.7, 3.4_

  - [ ]* 16.4 Escrever unit tests do contexto de sessão
    - Casos de exemplo: tempo restante decresce corretamente, sessão
      expirada limpa o contexto
    - _Requirements: 1.4_

- [x] 17. Checkpoint — Garantir que todos os testes passam
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. Implementar tela `login-terminal`
  - _Requirements: 1.1, 1.2, 1.3, 1.6_

  - [x] 18.1 Implementar `app/login-terminal/page.tsx`
    - Formulário de credenciais de Supervisor + seleção de
      `Centro_Producao`, chama `POST /checkout/auth/sessao`, persiste o
      `Token_Checkout` retornado e redireciona para `painel`
    - Exibir erro genérico em credenciais inválidas/perfil não autorizado
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 18.2 Implementar troca de centro vinculado
    - Ação na mesma tela (ou acessível a partir do `painel`) para
      Supervisor trocar o `Centro_Producao` da sessão ativa, chamando
      `PATCH /checkout/auth/sessao/trocar-centro`
    - _Requirements: 1.6_

  - [ ]* 18.3 Escrever unit tests da tela de login
    - Casos de exemplo: submissão com credenciais válidas redireciona,
      submissão inválida exibe erro, troca de centro atualiza o contexto
    - _Requirements: 1.2, 1.3, 1.6_

- [x] 19. Implementar teclado de PIN e tela `identificar-operador`
  - _Requirements: 2.2, 2.3, 2.4, 2.5, 4.3, 14.2_

  - [x] 19.1 Implementar `lib/pin-keypad.tsx`
    - Componente de teclado numérico com botões grandes (mínimo 48x48px),
      sem exibir nomes/matrículas de Funcionários (Requirement 2.5)
    - _Requirements: 2.5, 14.2_

  - [x] 19.2 Implementar `app/identificar-operador/page.tsx`
    - Usa `pin-keypad.tsx`, chama `POST /checkout/operador/identificar`,
      guarda `funcionarioId` retornado para uso na ação seguinte
    - Exibe erro genérico em PIN inválido, sem revelar se o PIN existe
      para outro Funcionario
    - _Requirements: 2.2, 2.3, 2.4_

  - [x] 19.3 Implementar exibição de bloqueio por rate limiting
    - Ao receber 429 do backend, exibir o tempo restante de bloqueio
      informado pela API e desabilitar o teclado até o bloqueio expirar
    - _Requirements: 4.3_

  - [ ]* 19.4 Escrever unit tests da identificação de operador
    - Casos de exemplo: PIN válido navega para a ação pendente, PIN
      inválido exibe erro genérico, resposta 429 desabilita o teclado com
      contagem do tempo restante
    - _Requirements: 2.3, 2.4, 4.3_

- [x] 20. Implementar tela `painel`
  - _Requirements: 5.1, 5.2, 5.4, 13.2_

  - [x] 20.1 Implementar `app/painel/page.tsx`
    - Lista a fila de Etapas do `Centro_Producao` vinculado à sessão,
      consumindo `GET /checkout/painel`; navegação para
      `etapa/[id]` ao selecionar uma Etapa `PENDENTE`/`PAUSADA`
    - _Requirements: 5.1, 5.2, 5.4_

  - [x] 20.2 Exibir alertas de parada prolongada no painel
    - Destacar visualmente as Etapas retornadas por
      `GET /checkout/supervisor/alertas`, quando o usuário logado for
      Supervisor
    - _Requirements: 13.2_

  - [ ]* 20.3 Escrever unit tests da tela de painel
    - Casos de exemplo: lista renderiza apenas etapas do centro vinculado,
      etapa em alerta aparece destacada
    - _Requirements: 5.4, 13.2_

- [x] 21. Implementar tela `etapa/[id]` (ação principal) e operadores ativos
  - _Requirements: 5.3, 10.1, 10.2, 10.3, 10.4, 14.2_

  - [x] 21.1 Implementar `app/etapa/[id]/page.tsx`
    - Tela com uma única ação principal em destaque (iniciar/retomar via
      `PATCH /checkout/etapas/:id/iniciar`, ou navegação para
      apontar/pausar/pendencia-material quando já `EM_ANDAMENTO`), com
      botão de toque em destaque conforme Requirement 14.2
    - _Requirements: 5.3, 14.2_

  - [x] 21.2 Exibir e gerenciar operadores ativos na etapa
    - Consumir `GET /checkout/etapas/:id/operadores` para listar
      operadores ativos; chamar
      `POST /checkout/etapas/:id/operadores/entrar` ao operador
      identificado entrar na etapa, e
      `PATCH /checkout/etapas/:id/operadores/saida` ao finalizar sua
      participação sem concluir a etapa
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [ ]* 21.3 Escrever unit tests da tela de ação principal
    - Casos de exemplo: etapa `PENDENTE` mostra botão de iniciar, etapa
      `EM_ANDAMENTO` mostra ações de apontar/pausar/pendência
    - _Requirements: 5.3, 14.2_

  - [ ]* 21.4 Escrever unit tests de operadores ativos
    - Casos de exemplo: lista exibe todos os operadores ativos, saída de
      um operador não remove os demais da lista exibida
    - _Requirements: 10.3, 10.4_

- [x] 22. Checkpoint — Garantir que todos os testes passam
  - Ensure all tests pass, ask the user if questions arise.

- [x] 23. Implementar tela `etapa/[id]/apontar`
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 14.3_

  - [x] 23.1 Implementar `app/etapa/[id]/apontar/page.tsx`
    - Formulário com campos mínimos necessários (produção/perda/
      retrabalho + motivo de perda quando aplicável) e anexo de foto
      opcional, chamando `POST /checkout/etapas/:id/apontar`
    - Validar quantidade não-negativa no cliente antes de enviar (a
      validação definitiva permanece no backend)
    - Limitar a tela ao mínimo de campos necessários (Requirement 14.3)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 14.3_

  - [ ]* 23.2 Escrever unit tests da tela de apontamento
    - Casos de exemplo: envio de produção válida, envio de perda com
      motivo, tentativa de quantidade negativa é bloqueada no cliente
    - _Requirements: 7.2, 7.5_

  - [ ]* 23.3 Escrever teste e2e do fluxo de apontamento de produção
    - Login de terminal → identificação de operador → apontar produção,
      contra a API real de um ambiente de teste
    - _Requirements: 7.1_

- [x] 24. Implementar tela `etapa/[id]/pausar`
  - _Requirements: 8.1, 8.2, 8.3, 14.3_

  - [x] 24.1 Implementar `app/etapa/[id]/pausar/page.tsx`
    - Formulário com motivo de parada e indicador planejada/não
      planejada, chamando `PATCH /checkout/etapas/:id/pausar`
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ]* 24.2 Escrever unit tests da tela de pausa
    - Casos de exemplo: pausa planejada, pausa não planejada com motivo
      `MANUTENCAO` (candidata a ordem de manutenção)
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 25. Implementar tela `etapa/[id]/pendencia-material`
  - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [x] 25.1 Implementar `app/etapa/[id]/pendencia-material/page.tsx`
    - Formulário simples (descrição opcional) para registrar falta de
      material sem sair da tela de apontamento, chamando
      `POST /checkout/etapas/:id/pendencia-material`; ação de resolver
      pendência chamando `PATCH /checkout/pendencias-material/:id/resolver`
    - _Requirements: 12.1, 12.3, 12.4_

  - [ ]* 25.2 Escrever unit tests da tela de pendência de material
    - Casos de exemplo: criação de pendência sem navegação para outra
      tela, resolução de pendência permite retomar a etapa
    - _Requirements: 12.1, 12.4_

- [x] 26. Implementar telas de Supervisor (`alertas` e `autorizar-retroativo`)
  - _Requirements: 11.2, 11.3, 13.1, 13.2, 13.3_

  - [x] 26.1 Implementar `app/supervisor/alertas/page.tsx`
    - Lista as Etapas em alerta de parada prolongada consumindo
      `GET /checkout/supervisor/alertas`, com destaque visual
    - _Requirements: 13.1, 13.2, 13.3_

  - [x] 26.2 Implementar `app/supervisor/autorizar-retroativo/page.tsx`
    - Formulário de autorização de `Apontamento_Retroativo` vinculado a um
      Apontamento original, chamando
      `POST /checkout/apontamentos/:id/retroativo`
    - _Requirements: 11.2, 11.3_

  - [ ]* 26.3 Escrever unit tests da tela de alertas
    - Casos de exemplo: etapa em alerta aparece na lista, etapa some após
      retomada/concluída (mock da API refletindo a mudança)
    - _Requirements: 13.2, 13.3_

  - [ ]* 26.4 Escrever unit tests da tela de autorização retroativa
    - Casos de exemplo: autorização válida cria o apontamento retroativo,
      tentativa sem motivo é bloqueada no cliente
    - _Requirements: 11.2, 11.3_

- [x] 27. Implementar histórico de apontamentos por etapa
  - _Requirements: 16.1, 16.3, 16.4_

  - [x] 27.1 Exibir histórico cronológico na tela da etapa
    - Consumir `GET /checkout/etapas/:id/apontamentos` e exibir Operador,
      tipo, quantidade, motivo e horário de cada apontamento, distinguindo
      visualmente apontamentos retroativos do original vinculado
    - _Requirements: 16.1, 16.3_

  - [ ]* 27.2 Escrever unit tests do histórico de apontamentos
    - Casos de exemplo: apontamentos exibidos em ordem cronológica,
      apontamento retroativo exibido com vínculo ao original
    - _Requirements: 16.1, 16.3_

- [x] 28. Garantir responsividade mobile-first e usabilidade de toque
  - _Requirements: 14.1, 14.2, 14.3_

  - [x] 28.1 Aplicar layout responsivo em todas as telas
    - Revisar `login-terminal`, `identificar-operador`, `painel`,
      `etapa/[id]` e subtelas para adaptação sem perda de funcionalidade
      em computador, tablet e celular
    - _Requirements: 14.1_

  - [x] 28.2 Garantir tamanho mínimo de controles de toque
    - Auditar botões/controles de ação principal em todas as telas para
      garantir toque mínimo de 48x48px
    - _Requirements: 14.2_

  - [ ]* 28.3 Escrever testes e2e de responsividade
    - Executar o fluxo principal (login → identificar → apontar) em
      viewports de celular e tablet via Playwright
    - _Requirements: 14.1_

  - [ ]* 28.4 Escrever testes de acessibilidade de toque
    - Verificar via testes automatizados (ex: consulta de
      `getBoundingClientRect` nos testes de componente) que os botões de
      ação principal atendem ao tamanho mínimo de toque
    - _Requirements: 14.2_

- [x] 29. Wiring final do frontend
  - _Requirements: 1.7, 3.4, 5.4_

  - [x] 29.1 Conectar navegação entre todas as telas
    - Garantir que os fluxos completos (login → identificar → painel →
      etapa → apontar/pausar/pendência → volta ao painel) navegam
      corretamente sem tela órfã, incluindo tratamento de sessão expirada
      redirecionando para `login-terminal` em qualquer ponto do fluxo
    - _Requirements: 1.7, 3.4, 5.4_

  - [ ]* 29.2 Escrever teste e2e do fluxo completo ponta a ponta
    - Login de terminal → identificação de operador → iniciar etapa →
      apontar produção → pausar → retomar → concluir, contra a API real
      de um ambiente de teste
    - _Requirements: 5.1, 5.3, 7.1, 8.1, 9.5_

- [x] 30. Checkpoint final — Garantir que todos os testes passam
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tarefas marcadas com `*` são opcionais (testes) e podem ser puladas para
  um MVP mais rápido, mas recomenda-se implementá-las dado o volume de
  regras de negócio novas e sensíveis a regressão (bloqueio de sequência,
  isolamento multi-tenant, retroatividade).
- Cada property test referencia diretamente uma das 14 Correctness
  Properties do `design.md`, configurada com no mínimo 100 iterações
  (fast-check) e tag `Feature: checkout-apontamento, Property N: ...`.
  As properties do design são todas de regras de negócio de backend — o
  bloco de frontend (Tarefas 15-30) não introduz novas properties, usa
  testes unitários e e2e (Testing Strategy do design não prevê PBT para a
  camada de UI).
- Nenhuma tarefa desta lista deve romper a compatibilidade das rotas
  `/pcp/etapas/...` já existentes — a Tarefa 2 é uma refatoração de
  extração, não uma reescrita de comportamento.
- Os Checkpoints (3, 9, 11, 14, 17, 22, 30) são pontos de validação — rodar
  toda a suíte de testes antes de prosseguir para o próximo bloco de
  tarefas. O Checkpoint 14 marca o fim do backend; a partir da Tarefa 15
  o plano passa a tratar do novo app `VisioFab.Checkout` (frontend).
- O frontend (`VisioFab.Checkout`) é um app Next.js novo e separado do
  `VisioFab.Wms.Front` existente — não reaproveita seu design system
  (Mantine), pois o Checkout precisa de um layout próprio, simplificado e
  otimizado para toque (Requirement 14). Cada tela do frontend depende
  apenas das rotas de backend correspondentes já implementadas nos blocos
  8 e 12 — por isso as tarefas de frontend só começam após o Checkpoint 14.
