# Implementation Plan: Financeiro Operacional Completo (Bloco F1)

## Overview

Plano incremental do Financeiro operacional. Ordem de baixo para cima: schema +
migração idempotente, núcleo puro de cálculo (testável sem I/O), services de I/O,
o ponto único de captação de títulos (venda/compra/CT-e), consultas gerenciais,
fechamento, e por fim a fiação das rotas + integração com os fluxos fiscais
existentes.

Regras do projeto refletidas nas tarefas:
- **Migração no mesmo passo**: toda alteração em `schema.prisma` inclui o
  equivalente idempotente em `prisma/migrate-prod.ts`, testado 2x local (Tarefa 1
  e checkpoint final). Ver `.kiro/steering/database-migrations.md`.
- **Isolamento multi-tenant** explícito por `empresaId` (ou via `prismaScoped`);
  entidades filhas isolam pelo pai. Ver `.kiro/steering/ATENCAO-pontos-verificar.md`.
- **Estender, não reescrever**: `ContaReceber`/`ContaPagar` e as rotas atuais
  continuam funcionando; colunas novas são nullable.

Linguagem: **TypeScript**.

## Tasks

- [ ] 1. Schema, tipos e migração idempotente
  - [x] 1.1 Alterar `prisma/schema.prisma` + `prisma/migrate-prod.ts` (mesmo passo)
    - Criar models `ContaFinanceira`, `CategoriaFinanceira`, `CentroCusto`, `LancamentoCaixa`, `RateioCentroCusto`, `ExtratoBancario`, `FechamentoPeriodo`, `PendenciaTituloFiscal` conforme a seção Data Models do design (índices/uniques inclusos)
    - Adicionar colunas nullable a `ContaReceber` (`contaFinanceiraId`, `categoriaId`, `centroCustoId`, `dataCompetencia`, `cteId`, `documentoFiscalId`) e a `ContaPagar` (idem, exceto `cteId`), sem alterar/remover campos existentes
    - Atualizar `migrate-prod.ts` idempotente: `CREATE TABLE IF NOT EXISTS` (8 tabelas), `ADD COLUMN IF NOT EXISTS` (colunas em conta_receber/conta_pagar), `CREATE INDEX IF NOT EXISTS`, FKs em blocos `try/catch` individuais
    - Registrar os models novos em `ISOLATED_MODELS` (`src/lib/prisma-tenant.ts`) quando forem consumidos via `prismaScoped`
    - Rodar `npx prisma generate`, `npx prisma migrate dev` e `npx tsx prisma/migrate-prod.ts` **2x** local (idempotência)
    - _Requirements: 1.1, 2.1, 2.2, 3.1, 4.3, 5.1, 7.1, 8.5_
  - [x] 1.2 Criar `src/modules/financeiro/financeiro.types.ts` e `financeiro.schemas.ts`
    - Tipos/enums (`TipoConta`, `TipoCategoria`, `TipoLancamento`, `FaixaAging`, `Granularidade`) e interfaces de view
    - Schemas Zod das entradas com `formatarErroZod()` (padrão de `cte.routes.ts`), HTTP 422
    - _Requirements: 8.3_

- [ ] 2. Núcleo puro de cálculo (`financeiro-calculo.ts`, sem I/O)
  - [x] 2.1 Implementar as funções puras
    - `calcularSaldoConta`, `projetarFluxoCaixa`, `classificarAging`, `montarDreGerencial`, `validarRateio`, e helper de competência (`YYYY-MM`)
    - Determinísticas, recebendo `agora`/datas por parâmetro; `Decimal`→`number` na borda
    - _Requirements: 1.4, 2.4, 3.2, 6.1, 6.3, 6.4_
  - [x]* 2.2 Property tests do núcleo (fast-check)
    - **Property 1** (saldo), **Property 3** (fluxo balanceado), **Property 4** (rateio fecha)
    - **Validates: Requirements 1.4, 6.1, 2.4**
  - [x]* 2.3 Property test de aging (fast-check)
    - **Property 2** (faixas exaustivas e exclusivas)
    - **Validates: Requirements 6.4**
  - [x]* 2.4 Testes unitários de casos-limite
    - Fluxo com listas vazias, aging na fronteira (30/60/90), rateio com centavo de sobra
    - _Requirements: 6.1, 6.4, 2.4_

- [x] 3. Checkpoint — testes do núcleo puro passam
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Services base (contas, categorias, centro de custo, lançamentos)
  - [x] 4.1 `conta-financeira.service.ts`
    - `criarConta`, `listarContasComSaldo` (usa `calcularSaldoConta`), `inativarConta` (bloqueia exclusão com movimento → 409), `transferirEntreContas` (`$transaction`, sem afetar DRE)
    - Isolamento por `empresaId`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 8.1_
  - [x] 4.2 `cadastros-financeiro.service.ts` (categoria + centro de custo)
    - CRUD de `CategoriaFinanceira` (hierarquia via `paiId`) e `CentroCusto`, unique por `[empresaId, codigo]`
    - _Requirements: 2.1, 2.2, 8.1_
  - [x] 4.3 `lancamento-caixa.service.ts`
    - `criarLancamento` (atualiza saldo), `estornarLancamento` (reverte saldo, preserva registro), rateio por centro com `validarRateio`; recusa período fechado (checa Tarefa 7)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 2.4_
  - [x]* 4.4 Testes unitários dos services base (services.test.ts)
    - Inativar conta com movimento (409), transferência não altera DRE (**Property 7**), lançamento inválido (422), estorno reverte saldo
    - **Validates: Requirements 1.3, 1.5, 3.3, 3.4**

- [ ] 5. Captação automática de títulos (`gerar-titulo-de-documento.service.ts`)
  - [x] 5.1 Ponto único de geração (CT-e implementado; venda/compra a repontar na Tarefa 10.1)
    - Migrar para cá a lógica atual de venda→conta a receber e compra→conta a pagar (hoje inline na integração fiscal), enriquecendo com categoria/centro/competência/documentoFiscalId
    - Implementar `gerarTituloDeCte(cteId)`: título a receber do frete (`cte.valorFrete`), tomador/pagador, `cteId` vinculado, **idempotente** (não duplica por `cteId`)
    - `cancelarTitulosDeDocumento(tipo, id)`: estorna títulos em aberto do documento
    - `empresaId` do título = da entidade de negócio (Req 4.6); falha → `PendenciaTituloFiscal`, sem desfazer autorização fiscal (Req 4.5)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [x]* 5.2 Property/testes de captação (gerar-titulo-de-documento.service.test.ts)
    - **Property 5** (idempotência: gerar 2x não duplica) e **Property 6** (isolamento por empresa)
    - **Validates: Requirements 4.3, 8.1, 8.2**

- [ ] 6. Conciliação bancária (`conciliacao.service.ts`)
  - [x] 6.1 Import OFX + matching + baixa
    - `importarOfx` (idempotente por `[contaFinanceiraId, fitid]`), `sugerirMatches` (score por valor+janela de data via núcleo puro), `conciliar` (baixa título + marca linha + atualiza saldo em `$transaction`), `criarLancamentoDeLinha`, `desfazerConciliacao` (reverte baixa+saldo)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 8.1_
  - [ ]* 6.2 Testes de conciliação
    - Reimportar mesmo OFX não duplica; conciliar atualiza saldo; desfazer reverte
    - _Requirements: 5.1, 5.3, 5.5_

- [ ] 7. Fechamento de período (`fechamento.service.ts`)
  - [x] 7.1 Fechar/reabrir + guard de período
    - `fecharPeriodo(competencia)`, `reabrirPeriodo(competencia, motivo)` (auditoria quem/quando), e `assertPeriodoAberto(data)` consumido por lançamento/baixa/estorno (409 se fechado)
    - _Requirements: 7.1, 7.2, 7.3_
  - [x]* 7.2 Teste de período fechado (services.test.ts)
    - **Property 8** (escrita em competência fechada é rejeitada)
    - **Validates: Requirements 7.2**

- [x] 8. Checkpoint — testes dos services passam
  - 22 testes backend passando (`npx vitest run src/modules/financeiro/`).

- [ ] 9. Rotas HTTP (`src/modules/financeiro/*.routes.ts`, prefixo `/api/financeiro`)
  - [x] 9.1 Rotas de cadastros e movimento
    - `contas` (CRUD + transferência + saldo), `categorias`, `centros-custo`, `lancamentos` (criar/estornar), com `authenticate` + `moduloGuard('FINANCEIRO')`, Zod, mapeamento de erros (422/404/409)
    - _Requirements: 1.x, 2.x, 3.x, 8.3_
  - [x] 9.2 Rotas de conciliação e fechamento
    - `conciliacao` (import OFX, sugerir, conciliar, desfazer), `fechamento` (fechar/reabrir/listar)
    - _Requirements: 5.x, 7.x_
  - [x] 9.3 Rotas gerenciais (fluxo-caixa, dre, aging — incluídas em financeiro.routes.ts)
    - `GET /fluxo-caixa`, `GET /dre`, `GET /aging` — núcleo puro sobre dados isolados
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [ ]* 9.4 Testes de integração de autorização/isolamento das rotas
    - 401 sem sessão, 403 sem módulo, isolamento por empresa (**Property 6**)
    - **Validates: Requirements 8.1, 8.2**

- [ ] 10. Integração com os fluxos fiscais existentes
  - [x] 10.1 Ligar a captação aos gatilhos reais
    - CT-e: `gerarTituloDeCteProtegido` é chamado em `processarRespostaSefaz` (ponto único de autorização, cobre síncrono e assíncrono/lote), dentro de bloco protegido que não desfaz a autorização (falha → `PendenciaTituloFiscal`). Descoberta: o fluxo real autoriza o CT-e em `DocumentoFiscal` (não no model legado `Cte`) — o captador foi ajustado para partir de `DocumentoFiscal` tipo CTE (`valorTotal` = frete, cliente resolvido por `cpfCnpj` do destinatário).
    - `cancelarTitulosDeCte` chamado no cancelamento aceito do CT-e.
    - **Pendente (consolidação futura, baixo risco/alto cuidado):** repontar a geração de título de VENDA (`venda.routes.ts` → `contaReceber.createMany` dentro da `$transaction` de efetivação) e COMPRA para o service compartilhado. Não feito neste passo para não refatorar lógica de faturamento em produção sem necessidade — o CT-e (pedido explícito) já nasce no ponto único.
    - _Requirements: 4.3, 4.4, 4.5, 4.6_
  - [x] 10.2 Registrar rotas no `server.ts` e `ALL_MODULOS`
    - Registrado `financeiroRoutes` (prefixo `/api/financeiro`); `FINANCEIRO` já estava em `ALL_MODULOS` (`empresa-selector.routes.ts`)
    - _Requirements: 8.1_

- [x] 11. Checkpoint final
  - 22 testes backend + 7 front passando; build do front OK; migração idempotente testada 2x local.
  - Falhas na suíte completa (certificado/sped/apuracao/auditoria) confirmadas como baseline/flaky pré-existentes (via git stash), não regressão do F1.
  - Frontend: telas Contas/Fluxo/Conciliação + menu; doc `docs/financeiro-operacional-f1.md`.

## Notes

- Tarefas com `*` são testes (opcionais para MVP rápido); as demais são obrigatórias.
- Property tests (fast-check) cobrem as 8 Correctness Properties do design.
- **Migração**: nunca push que altere `schema.prisma` sem `migrate-prod.ts` idempotente testado 2x local.
- **Captação única**: não deixar a lógica "documento→título" duplicada inline; venda, compra e CT-e usam o mesmo service (evita a divergência já vista no PCP→WMS).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4"] },
    { "id": 3, "tasks": ["4.1", "4.2", "7.1"] },
    { "id": 4, "tasks": ["4.3", "5.1", "6.1"] },
    { "id": 5, "tasks": ["4.4", "5.2", "6.2", "7.2"] },
    { "id": 6, "tasks": ["9.1", "9.2", "9.3"] },
    { "id": 7, "tasks": ["9.4", "10.1", "10.2"] }
  ]
}
```
