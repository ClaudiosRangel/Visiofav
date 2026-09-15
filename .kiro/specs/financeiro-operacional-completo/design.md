# Design Document

Financeiro Operacional Completo — Onda 1 — Vizor ERP

## Overview

A Onda 1 transforma o backend financeiro existente em produto operável.
Estende `src/modules/financeiro/` (novos services de baixa em lote, títulos,
extrato, relatórios, dashboard) e as rotas de `conta-pagar`/`conta-receber`
(edição, cancelamento, estorno, baixa em lote, baixa enriquecida). No frontend,
completa as telas faltantes e enriquece as existentes. Adiciona QA E2E.

Princípios: **estender, não reescrever**; núcleo de cálculo puro reutilizado;
isolamento multi-tenant explícito; migração idempotente no mesmo commit;
Mantine 7 com tokens de tema; QA no padrão Python+Playwright existente.

## Architecture

```
Frontend (Next 15 + Mantine 7)
  /financeiro/dashboard        → GET /financeiro/dashboard
  /financeiro/contas-receber   → baixa lote / editar / cancelar / estornar
  /financeiro/contas-pagar     → idem
  /financeiro/categorias       → CRUD categorias
  /financeiro/centros-custo    → CRUD centros
  /financeiro/lancamentos      → lançamentos de caixa + rateio
  /financeiro/fechamento       → fechar/reabrir período
  /financeiro/dre              → DRE gerencial
  /financeiro/extrato          → extrato por conta
  /financeiro/relatorios       → inadimplência / a pagar-receber (export CSV)
        │
Backend (Fastify + Prisma) — src/modules/financeiro/
  dashboard.service.ts         (novo)  — agrega saldos/títulos/DRE/top devedores
  titulo.service.ts            (novo)  — editar/cancelar/estornar/baixa lote (receber+pagar)
  extrato.service.ts           (novo)  — movimentação consolidada por conta
  relatorios.service.ts        (novo)  — inadimplência / a pagar-receber
  (existentes) conta-financeira, cadastros, lancamento-caixa, conciliacao,
               fechamento, gerar-titulo-de-documento, financeiro-calculo
  financeiro.routes.ts         (estende) — novas rotas
  conta-pagar.routes.ts / conta-receber.routes.ts (estende) — editar/cancelar/estornar/baixa-lote
        │
QA — tests/e2e-qa/test_43_financeiro.py + helpers em wms_api.py
     backend: src/modules/qa-seed/ (estende com seed financeiro opcional)
```

## Components and Interfaces

### 1. `titulo.service.ts` (novo) — regras de título unificadas

Trabalha tanto para `ContaReceber` quanto `ContaPagar` via parâmetro `tipo`.

```ts
type TipoTitulo = 'RECEBER' | 'PAGAR'

editarTitulo(prisma, empresaId, tipo, id, dados): Promise<Titulo>   // só ABERTA (409 se baixado)
cancelarTitulo(prisma, empresaId, tipo, id): Promise<Titulo>        // ABERTA → CANCELADA
estornarBaixa(prisma, empresaId, tipo, id): Promise<Titulo>         // PAGA/RECEBIDA → ABERTA, reverte saldo, respeita período fechado
baixarTitulo(prisma, empresaId, tipo, id, baixa): Promise<Titulo>   // baixa individual enriquecida (conta/categoria/centro)
baixarEmLote(prisma, empresaId, tipo, ids[], baixa): Promise<{ sucesso: string[]; ignorados: {id,motivo}[] }>
```

Regras:
- `baixarEmLote` itera; cada título em `$transaction` própria; título já baixado/cancelado/de outra empresa vai para `ignorados`, não derruba o lote.
- Estorno/baixa consultam `assertPeriodoAberto` (reuso de `fechamento.service`).
- Saldo é derivado (não há coluna de saldo materializado) — a baixa apenas grava `contaFinanceiraId` no título; `listarContasComSaldo` já soma títulos baixados por conta (ajustar para considerar `contaFinanceiraId`).

### 2. `dashboard.service.ts` (novo)

```ts
obterDashboard(prisma, empresaId, agora): Promise<DashboardFinanceiro>
```
Agrega (tudo isolado por empresa):
- `saldoTotal` = Σ `listarContasComSaldo`
- `receber`/`pagar`: { hoje, vencido, aVencer } (contagem + valor)
- `resultadoMes`: receitas − despesas realizadas no mês corrente
- `fluxoResumo`: `projetarFluxoCaixa` dos próximos 3 meses (reuso núcleo puro)
- `topDevedores`: top 5 clientes por valor vencido em aberto
- `despesasPorCategoria`: agrupamento do mês (reuso `montarDreGerencial` filtrado em DESPESA)

### 3. `extrato.service.ts` (novo)

```ts
extratoConta(prisma, empresaId, contaId, de, ate): Promise<{ saldoInicial, linhas[], saldoFinal }>
```
Une lançamentos de caixa (não estornados) + baixas de títulos com `contaFinanceiraId` = conta, ordena por data, acumula saldo corrente. `saldoInicial` = saldo da conta antes de `de`.

### 4. `relatorios.service.ts` (novo)

```ts
inadimplencia(prisma, empresaId, agora): Promise<{ cliente, titulos[], totalVencido, diasAtrasoMax }[]>
contasPorPeriodo(prisma, empresaId, tipo, filtros): Promise<TituloRelatorio[]>
```
Export CSV é feito no frontend a partir do JSON (sem lib nova no backend).

### 5. Extensão de `conta-pagar.routes.ts` / `conta-receber.routes.ts`

Novas rotas (mantêm as existentes):
- `PUT /:id` — editar (via `titulo.service.editarTitulo`)
- `PATCH /:id/cancelar` — cancelar
- `PATCH /:id/estornar` — estornar baixa
- `POST /baixar-lote` — `{ ids: string[], contaFinanceiraId?, formaPagamento, data?, categoriaId?, centroCustoId? }`
- `PATCH /:id/pagar` e `/:id/receber` — enriquecer body com conta/categoria/centro (retrocompatível)

### 6. Extensão de `financeiro.routes.ts`

- `GET /dashboard`
- `GET /extrato?contaFinanceiraId&de&ate`
- `GET /relatorios/inadimplencia`
- `GET /relatorios/contas?tipo=RECEBER|PAGAR&...filtros`

### 7. Frontend — telas

Reusa `useFinanceiroApi.ts` (estende com novos métodos) e `format.ts`. Novas
páginas em `src/app/(interna)/financeiro/*`. Menu ganha as entradas novas
(Dashboard no topo). Telas de contas a pagar/receber ganham `Checkbox` de
seleção + botão "Baixar selecionados" (modal com conta/forma/data) + menu de
ações (editar/cancelar/estornar) por linha.

### 8. QA — `test_43_financeiro.py`

Helpers novos em `wms_api.py`: `criar_conta_pagar/receber`, `baixar_conta`,
`baixar_lote`, `editar_titulo`, `cancelar_titulo`, `estornar_titulo`,
`criar_conta_financeira`, `criar_lancamento`, `importar_ofx`,
`dashboard_financeiro`, `extrato_conta`, `relatorio_inadimplencia`. Testes de
estrutura (200 + schema), valor/seed (cria → aparece → baixa) e isolamento
(`token_de_outra_empresa`).

## Data Models

Colunas aditivas (nullable) — no mesmo commit em `schema.prisma` +
`migrate-prod.ts`:

```prisma
// ContaReceber (+) e ContaPagar (+)
canceladoEm      DateTime? @map("cancelado_em")
observacao       String?   @db.VarChar(500)
```

`status` de título passa a admitir `CANCELADA` (string, sem enum — já é VarChar).
Nenhuma tabela nova nesta onda (a base do F1 cobre). Migração idempotente:
`ADD COLUMN IF NOT EXISTS` para as 2 colunas em cada tabela.

## Error Handling

| Situação | Resposta |
|----------|----------|
| Zod inválido | 422 "campo: motivo" |
| Título/conta de outra empresa | 404 |
| Editar/estornar título em estado inválido | 409 |
| Baixa/estorno em período fechado | 409 |
| Baixa em lote com itens inválidos | 200 com `{ sucesso[], ignorados[] }` (não falha o lote) |

## Testing Strategy

- **Unit (Vitest):** `titulo.service` (edição bloqueada em baixado, estorno reverte, lote separa sucesso/ignorado), `extrato.service` (saldo corrente acumula), `dashboard.service` (agregação isolada). Reuso do núcleo puro já testado.
- **E2E (pytest+Playwright):** `test_43_financeiro.py` — fluxo completo por API + isolamento.
- **Migração:** `migrate-prod.ts` idempotente 2x local.

## Correctness Properties

### Property 1: Baixa em lote particiona
Todo id de entrada aparece exatamente uma vez em `sucesso` OU em `ignorados`.
**Validates: Requirements 2.1, 2.3**

### Property 2: Estorno reverte saldo
Baixar e depois estornar um título deixa o saldo da conta igual ao inicial.
**Validates: Requirements 3.4, 9.4**

### Property 3: Extrato acumula
No extrato, cada linha tem `saldoCorrente` == linha anterior + entrada − saída; a última == saldoFinal.
**Validates: Requirements 5.1, 5.2**

### Property 4: Isolamento
Dashboard, extrato e relatórios só agregam registros do `empresaId` pedido.
**Validates: Requirements 1.5, 5.3, 6.4, 9.1**

### Property 5: Edição só em aberto
Editar título não-ABERTA é sempre rejeitado (409); título ABERTA sempre aceita campos válidos.
**Validates: Requirements 3.1, 3.2**
