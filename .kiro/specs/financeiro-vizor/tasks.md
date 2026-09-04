# Implementation Plan: Financeiro Vizor (Billing do SaaS)

## Overview

Plano de implementação incremental do módulo **Financeiro Vizor** — o controle
de cobrança recorrente das empresas clientes do Vizor, exclusivo do
`SUPER_ADMIN`. A ordem segue de baixo para cima: primeiro o schema + migração
idempotente, depois o núcleo puro de cálculo (testável por property-based
testing sem I/O), em seguida os services de I/O, o guard central de
enforcement, as rotas, o job diário e, por fim, a fiação (registro no
`server.ts`) e os testes de integração/idempotência.

Regras do projeto refletidas nas tarefas:

- **Migração obrigatória no mesmo passo**: toda alteração em
  `prisma/schema.prisma` inclui a alteração idempotente equivalente em
  `prisma/migrate-prod.ts`, testada rodando `npx tsx prisma/migrate-prod.ts`
  duas vezes local (Tarefa 1).
- **Isolamento invertido (controle global do SUPER_ADMIN)**: as queries do
  módulo usam o Prisma global e **não** são escopadas pelo `empresaId` do
  usuário — pelo contrário, varrem TODAS as empresas. O isolamento por empresa
  é feito **explicitamente** com `where: { empresaId }` por registro, e o acesso
  é protegido pelo `requireSuperAdmin`. Isso é o oposto do padrão multi-tenant
  normal e está sinalizado explicitamente nas tarefas 4, 5 e 8.
- **`statusFinanceiro` é campo novo**, sem tocar no `status` boolean existente
  da `Empresa` (Tarefa 1).
- **Guard central somente-leitura** como choke point único no `server.ts`
  (Tarefas 6 e 10).

Linguagem: **TypeScript** (o design já está em TypeScript; sem pseudocódigo).

## Tasks

- [x] 1. Schema, tipos e migração idempotente
  - [x] 1.1 Alterar `prisma/schema.prisma` + `prisma/migrate-prod.ts` (mesmo passo)
    - Adicionar à `Empresa`: `statusFinanceiro String @default("ATIVO") @map("status_financeiro") @db.VarChar(20)`, `inativadoPor/inativadoEm`, `reativadoPor/reativadoEm`, relação `contratoCobranca` e `faturas`, e `@@index([statusFinanceiro])` — **sem alterar/remover o campo `status` boolean existente**
    - Criar models `ContratoCobranca`, `PrecoModulo`, `Fatura`, `ControleAlertaCobranca`, `LogExecucaoJobFinanceiro` conforme a seção "Data Models" do design (índices/uniques inclusos)
    - Atualizar `prisma/migrate-prod.ts` de forma **idempotente** no mesmo commit: `ALTER TABLE empresa ADD COLUMN IF NOT EXISTS status_financeiro ...` (+ colunas de auditoria), `CREATE INDEX IF NOT EXISTS` em `empresa(status_financeiro)`, `CREATE TABLE IF NOT EXISTS` para as 5 novas tabelas com seus índices/uniques, e FKs em blocos `try/catch` individuais (Postgres não tem `ADD CONSTRAINT IF NOT EXISTS`)
    - Rodar `npx prisma generate`, `npx prisma migrate dev` (gera SQL de referência) e testar `npx tsx prisma/migrate-prod.ts` **duas vezes** contra o banco local, confirmando idempotência (2ª execução sem erro/duplicação)
    - _Requirements: 2.6, 3.x, 4.x, 5.x, 6.x, 8.x, 9.5, 9.6, 10.5_

  - [x] 1.2 Criar constantes e tipos do módulo em `src/modules/financeiro-vizor/financeiro.types.ts`
    - `MODULOS`, `Modulo`, `StatusFinanceiro`, `StatusFatura`, e limites (`PRECO_MAX`, `DIA_VENCIMENTO_MIN/MAX`, `MESES_MIN/MAX`, `DIAS_ALERTA`, `DIAS_BLOQUEIO`) conforme a seção "Enums e constantes" do design
    - Definir as interfaces de view (`DetalheCobranca`, `FaturaView`, `EmpresaStatusView`, `SalvarContratoInput`)
    - _Requirements: 2.3, 3.1, 3.2, 5.10_

- [x] 2. Núcleo puro de cálculo (`financeiro-calculo.ts`, sem I/O)
  - [x] 2.1 Implementar as funções puras de cálculo em `src/modules/financeiro-vizor/financeiro-calculo.ts`
    - `calcularTotalMensal`, `calcularDiasEmAtraso`, `calcularTotalVencidoEmAberto`, `determinarEstagio`, `calcularDatasVencimento`, `competenciaMesSeguinte` e `decidirBloqueio`
    - Todas determinísticas, recebendo `agora: Date` e dados por parâmetro (sem acesso a banco nem relógio global), conforme as assinaturas e implementações de referência do design
    - Tratar casos-limite: dia 31 em mês curto (→ último dia do mês), competência virando o ano, lista de faturas vazia, todos os módulos com preço 0
    - _Requirements: 2.5, 3.3, 4.4, 5.2, 5.3, 5.6, 6.3, 6.5, 6.7, 6.11, 6.12, 7.1, 7.2, 7.4, 8.5, 8.6, 9.2_

  - [ ]* 2.2 Escrever property test para total mensal (fast-check)
    - **Property 1: Total mensal ≥ 0 e ignora zeros**
    - **Property 2: Total mensal monotônico**
    - **Validates: Requirements 3.3**

  - [ ]* 2.3 Escrever property test para dias em atraso e total vencido (fast-check)
    - **Property 3: Dias em atraso ≥ 0 e usa a fatura mais antiga**
    - **Property 4: Total vencido não negativo e só conta vencidas em aberto**
    - **Validates: Requirements 6.3, 4.4, 2.5**

  - [ ]* 2.4 Escrever property test para transição de estágio (fast-check)
    - **Property 5: Estágio — INATIVADO é absorvente sob o job**
    - **Property 6: Estágio — job nunca reativa**
    - **Property 7: Estágio — limiar de bloqueio (dias >= 30 sse SOMENTE_LEITURA)**
    - **Validates: Requirements 6.12, 8.6, 6.5, 6.7, 6.11**

  - [ ]* 2.5 Escrever property test para decisão do guard (fast-check)
    - **Property 8: Guard — INATIVADO bloqueia todo método**
    - **Property 9: Guard — SOMENTE_LEITURA libera exatamente os GET**
    - **Property 10: Guard — ATIVO nunca bloqueia**
    - **Validates: Requirements 9.2, 7.1, 7.2, 7.4**

  - [ ]* 2.6 Escrever property test para geração de datas de vencimento (fast-check)
    - **Property 11: Vencimentos — quantidade e dia corretos (n itens consecutivos, dia = min(dia, últimoDiaDoMês))**
    - **Validates: Requirements 5.1, 5.2, 5.3**

  - [ ]* 2.7 Escrever testes unitários de casos-limite do núcleo puro
    - Dia 31 em fevereiro (28/29), dezembro→janeiro, `diasEmAtraso` exatamente 9/10/29/30, faturas vazias, módulos todos com preço 0
    - _Requirements: 5.3, 6.3, 6.5, 6.7_

- [x] 3. Checkpoint — Garantir que os testes do núcleo puro passam
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Service de contrato e preços por módulo (`contrato-cobranca.service.ts`)
  - [x] 4.1 Implementar `obterDetalheEmpresa` e `salvarContrato`
    - `obterDetalheEmpresa(empresaId)`: retorna sempre os **seis** módulos (preço 0 para os não precificados), `totalMensal`, `diaVencimento`, `dataContrato`, `totalVencidoEmAberto` e `diasEmAtraso` (ou `null`)
    - `salvarContrato(empresaId, input)`: upsert de contrato + preços. **Validação antes de qualquer escrita** (nada persistido em caso de erro); rejeição preserva o estado anterior
    - **Isolamento explícito**: Prisma global com `where: { empresaId }` por registro (controle do SUPER_ADMIN sobre a empresa alvo — não escopar por empresa do usuário)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.7, 4.1, 10.6_

  - [ ]* 4.2 Escrever testes unitários do service de contrato
    - Preços parciais retornando os 6 módulos com 0; rejeição preservando estado anterior
    - _Requirements: 3.1, 3.3_

- [x] 5. Service de faturas (`fatura.service.ts`)
  - [x] 5.1 Implementar `listarFaturas` e `gerarVencimentos`
    - `listarFaturas(empresaId)`: faturas da empresa ordenadas por competência desc
    - `gerarVencimentos(empresaId, meses, competenciaInicial?)`: usa `calcularTotalMensal` (rejeita se `<= 0`), `calcularDatasVencimento`, filtra competências já existentes **não canceladas**, cria em `createMany` com status `PENDENTE`, retorna `{ criadas, ignoradas[] }`. Envolver em `prisma.$transaction`
    - **Isolamento explícito** por `empresaId` em todas as queries (Prisma global)
    - _Requirements: 4.2, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 10.6_

  - [ ]* 5.2 Escrever property test de idempotência de geração (fast-check)
    - **Property 12: Geração idempotente (2ª execução retorna criadas: 0 e todas em ignoradas)**
    - **Validates: Requirements 5.8**

  - [x] 5.3 Implementar `darBaixa` e `cancelarFatura`
    - `darBaixa(empresaId, faturaId)`: `PENDENTE|VENCIDA → PAGA`, seta `dataPagamento`, recalcula `diasEmAtraso`; **mantém `SOMENTE_LEITURA`** até reativação manual. Rejeita fatura já `PAGA`/`CANCELADA` (409) e inexistente/de outra empresa (404). `prisma.$transaction`
    - `cancelarFatura(empresaId, faturaId)`: `PENDENTE|VENCIDA → CANCELADA`; rejeita `PAGA`/`CANCELADA` (409)
    - **Isolamento explícito**: `where: { id: faturaId, empresaId }` (404 se não pertencer à empresa)
    - _Requirements: 8.1, 8.3, 8.4, 8.5, 8.6, 8.9, 8.10, 10.6_

  - [ ]* 5.4 Escrever property test de isolamento por empresa (fast-check)
    - **Property 13: Isolamento por empresa (todo FaturaView/DetalheCobranca só contém registros do empresaId pedido)**
    - **Validates: Requirements 4.6, 10.4, 10.6**

  - [ ]* 5.5 Escrever testes unitários dos casos de baixa/cancelamento inválidos
    - Baixa/cancelamento em fatura `PAGA`/`CANCELADA`; fatura de outra empresa → 404
    - _Requirements: 8.3, 8.4, 8.10_

- [x] 6. Service de status financeiro (`status-financeiro.service.ts`)
  - [x] 6.1 Implementar listagem e transições de status
    - `listarEmpresasComStatus()`: **todas** as empresas (nome asc) com `statusFinanceiro`, `totalMensal`, `totalVencidoEmAberto` — varredura global (não escopar por empresa do usuário); lista vazia sem erro; empresas sem contrato aparecem com `ATIVO` e total 0
    - `aplicarStatus(empresaId, novo)`: materializa o novo status na `Empresa` (usado pelo job e ações manuais)
    - `reativarEmpresa(empresaId, superAdminId)`: `SOMENTE_LEITURA|INATIVADO → ATIVO`, registra `reativadoPor/reativadoEm`
    - `inativarEmpresa(empresaId, superAdminId)`: `ATIVO|SOMENTE_LEITURA → INATIVADO`, registra `inativadoPor/inativadoEm`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.7, 2.8, 8.7, 9.1, 9.4, 9.5, 9.6_

  - [ ]* 6.2 Escrever testes unitários das transições de status
    - Reativação/inativação e auditoria; listagem vazia; empresa sem contrato como ATIVO/total 0
    - _Requirements: 2.2, 2.7, 8.7, 9.1_

- [~] 7. Checkpoint — Garantir que os testes dos services passam
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Autorização e schemas de entrada (Zod)
  - [x] 8.1 Implementar `requireSuperAdmin` (preHandler) em `src/modules/financeiro-vizor/require-super-admin.ts`
    - Nega acesso a quem não é `SUPER_ADMIN`: 401 sem sessão válida, 403 autenticado sem perfil; **não vaza dados no corpo**; nada persistido
    - _Requirements: 1.3, 1.5, 8.2, 8.8, 9.8, 10.1, 10.2, 10.3_

  - [x] 8.2 Implementar schemas Zod e helper de erro em `src/modules/financeiro-vizor/financeiro.schemas.ts`
    - `salvarContratoSchema` (dataContrato não futura → Req 3.8; diaVencimento inteiro 1..31 → Req 3.5; precos 0..999.999.999,99 → Req 3.6) e `gerarVencimentosSchema` (meses inteiro 1..60 → Req 5.10; competenciaInicial `YYYY-MM` opcional → Req 5.6/5.7)
    - Reusar/replicar o padrão `formatarErroZod()` de `cte.routes.ts` (mensagem "campo: motivo", HTTP 422, estado anterior preservado)
    - _Requirements: 3.5, 3.6, 3.8, 5.6, 5.7, 5.10_

  - [x]* 8.3 Escrever testes unitários dos schemas Zod
    - Dia de vencimento não inteiro/fora de faixa, preço negativo/acima do teto, data futura, meses fora de 1..60, competência em formato inválido
    - _Requirements: 3.5, 3.6, 3.8, 5.10_

- [x] 9. Rotas do módulo (`financeiro-vizor.routes.ts`)
  - [x] 9.1 Implementar as rotas HTTP do módulo (prefixo `/api/financeiro-vizor`)
    - `GET /empresas`, `GET /empresas/:id`, `PUT /empresas/:id/contrato`, `POST /empresas/:id/gerar-vencimentos`, `POST /empresas/:id/faturas/:faturaId/baixa`, `POST /empresas/:id/faturas/:faturaId/cancelar`, `POST /empresas/:id/reativar`, `POST /empresas/:id/inativar`
    - Todas com `requireSuperAdmin` como `preHandler`, validação Zod na entrada e mapeamento de erros (422/404/409/403) conforme a tabela de Error Handling do design
    - Wire com os services das tarefas 4, 5 e 6
    - _Requirements: 1.3, 2.x, 3.x, 4.x, 5.x, 8.x, 9.x, 10.1, 10.2, 10.3_

  - [x]* 9.2 Escrever testes de integração de autorização das rotas
    - Cada endpoint: 401 sem sessão, 403 para perfil ≠ SUPER_ADMIN (sem vazar dados), 200 para SUPER_ADMIN
    - _Requirements: 1.3, 1.5, 8.2, 9.8, 10.1, 10.2, 10.3_

- [x] 10. Guard central de somente-leitura (`registerReadOnlyGuard`)
  - [x] 10.1 Implementar o hook `onRequest` global em `src/modules/financeiro-vizor/read-only-guard.ts`
    - Allowlist por prefixo de rota (auth/login/refresh/logout, seleção de empresa, `/api/financeiro-vizor`, perfil próprio, trocar-senha, marcar notificação como lida) — sempre liberado independentemente do status/método (Req 7.3, 9.3)
    - Para rotas operacionais: lê `empresa.statusFinanceiro` da sessão e aplica `decidirBloqueio()` (núcleo puro); SUPER_ADMIN sem empresa de contexto é liberado
    - Respostas: 403 "modo somente-visualização" (SOMENTE_LEITURA + escrita) e 403 "empresa inativada, acesso impedido" (INATIVADO), sem retornar dados de negócio; comparar `request.routerPath` (padrão da rota), não substring do path concreto
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 9.2, 9.3, 9.7_

  - [x] 10.2 Registrar o guard no `server.ts` após o `authenticate` global
    - Registro único (choke point) para garantir enforcement transversal em todos os módulos operacionais
    - _Requirements: 7.1, 7.6, 9.2_

  - [ ]* 10.3 Escrever testes de integração do guard
    - Empresa em cada status × rota operacional de escrita/leitura × rota do allowlist → 403/200 conforme Req 7/9; mudança de status reflete "a partir da requisição seguinte" (Req 7.6)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 9.2, 9.3, 9.7_

- [x] 11. Serviço de alerta de cobrança (`alerta-cobranca.service.ts`)
  - [x] 11.1 Implementar `enviarAlertaSeNecessario`
    - Cria `Notificacao` (tipo `ALERTA`, `empresaId` da empresa devedora) + `NotificacaoDestinatario` para os ADMINs da empresa, reusando o módulo de notificação existente
    - Idempotência **no máximo 1x/dia por tipo/empresa** via `ControleAlertaCobranca` (upsert por `[empresaId, tipoAlerta, dataEnvio]`)
    - **Isolamento**: o alerta inclui APENAS dados da própria empresa (`empresaId` = destinatário), nunca de terceiros
    - _Requirements: 6.6, 6.8, 6.9, 6.10, 10.4_

  - [ ]* 11.2 Escrever testes unitários de idempotência do alerta
    - Duas chamadas no mesmo dia para a mesma empresa/tipo geram no máximo 1 notificação
    - _Requirements: 6.10_

- [x] 12. Job diário de recálculo (`recalculo-financeiro.job.ts`)
  - [x] 12.1 Implementar `executarRecalculoFinanceiro(agora?)`
    - Por empresa (dentro de try/catch individual): marca `PENDENTE` vencida → `VENCIDA` (6.4) → `calcularDiasEmAtraso` → `determinarEstagio` → se mudou, `aplicarStatus` → se `dias >= 10` e status ≠ `INATIVADO`, `enviarAlertaSeNecessario`
    - Falha isolada por empresa **não** altera as demais; status vigente preservado em erro; registra `LogExecucaoJobFinanceiro` (sucesso/falha, empresas processadas, erro)
    - `INATIVADO` permanece `INATIVADO` (não muda por dias em atraso)
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.11, 6.12_

  - [x] 12.2 Agendar a execução diária (janela 00:00–00:59)
    - Registrar o scheduler no start do backend (`node-cron` interno ao processo ou Cron Job do Render); `executarRecalculoFinanceiro` é agnóstica ao gatilho e idempotente
    - _Requirements: 6.1_

  - [ ]* 12.3 Escrever teste de integração do ciclo de inadimplência
    - Contrato → gerar vencimentos → avançar `agora` → VENCIDA → alerta aos 10 → SOMENTE_LEITURA aos 30 → baixa mantém SOMENTE_LEITURA → reativação manual → ATIVO; job 2x no mesmo dia = no máx 1 notificação
    - _Requirements: 6.4, 6.5, 6.7, 6.10, 8.5, 8.6, 8.7_

- [x] 13. Checkpoint final — Garantir que todos os testes passam
  - Ensure all tests pass, ask the user if questions arise.
  - Reconfirmar `npx tsx prisma/migrate-prod.ts` idempotente (2x) antes de qualquer push que toque o schema.

## Notes

- Tarefas marcadas com `*` são opcionais (testes) e podem ser puladas para um MVP mais rápido; as demais são implementação obrigatória.
- Cada tarefa referencia requisitos específicos para rastreabilidade.
- Os checkpoints garantem validação incremental.
- Property tests (fast-check) validam as 13 propriedades universais do núcleo puro; testes unitários cobrem exemplos e casos-limite; testes de integração cobrem autorização, guard e o ciclo completo.
- **Migração**: nunca fazer push que altere `schema.prisma` sem o `migrate-prod.ts` idempotente equivalente testado 2x local (Tarefa 1 e checkpoint final).
- **Isolamento invertido**: o módulo varre TODAS as empresas (controle global do SUPER_ADMIN); o isolamento por empresa é explícito por `empresaId` em cada registro, protegido por `requireSuperAdmin` — o oposto do padrão `prismaScoped` normal.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "8.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "8.2"] },
    { "id": 4, "tasks": ["4.1", "5.1", "6.1", "11.1", "8.3"] },
    { "id": 5, "tasks": ["4.2", "5.2", "5.3", "6.2", "11.2", "10.1"] },
    { "id": 6, "tasks": ["5.4", "5.5", "9.1", "10.2", "12.1"] },
    { "id": 7, "tasks": ["9.2", "10.3", "12.2"] },
    { "id": 8, "tasks": ["12.3"] }
  ]
}
```
