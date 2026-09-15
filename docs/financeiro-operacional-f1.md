# Financeiro Operacional (Bloco F1) — Vizor ERP

**Concluído:** 14/09/2026
**Spec:** `.kiro/specs/erp-financeiro-completo/`

Módulo financeiro operacional que capta automaticamente títulos de documentos
fiscais, permite lançamentos manuais de caixa, faz conciliação bancária e
fechamentos, com relatórios gerenciais. Estende o financeiro básico
(contas a pagar/receber) sem reescrevê-lo.

## Backend (`src/modules/financeiro/`)

| Arquivo | Responsabilidade |
|---------|------------------|
| `financeiro-calculo.ts` | Núcleo puro (sem I/O): saldo, fluxo de caixa, aging, DRE, rateio |
| `conta-financeira.service.ts` | Contas (caixa/banco), saldo derivado, transferência neutra no DRE |
| `cadastros-financeiro.service.ts` | Categorias (plano de contas) + centros de custo |
| `lancamento-caixa.service.ts` | Lançamentos manuais + estorno + rateio |
| `conciliacao.service.ts` | Import OFX + matching + baixa + desfazer |
| `fechamento.service.ts` | Fechar/reabrir período + guard de escrita |
| `gerar-titulo-de-documento.service.ts` | Ponto único: documento fiscal → título (CT-e implementado) |
| `financeiro.routes.ts` | Rotas HTTP `/api/financeiro/*` (Zod + `moduloGuard('FINANCEIRO')`) |
| `financeiro.types.ts` / `financeiro.schemas.ts` | Tipos/constantes + validação Zod |

### Rotas (`/api/financeiro`)

- **Contas:** `GET /contas`, `POST /contas`, `PATCH /contas/:id/inativar`, `DELETE /contas/:id`, `POST /contas/transferir`
- **Categorias:** `GET/POST /categorias`, `PATCH /categorias/:id/inativar`
- **Centros de custo:** `GET/POST /centros-custo`, `PATCH /centros-custo/:id/inativar`
- **Lançamentos:** `GET/POST /lancamentos`, `PATCH /lancamentos/:id/estornar`
- **Conciliação:** `POST /conciliacao/importar-ofx`, `GET /conciliacao/sugestoes`, `POST /conciliacao/conciliar`, `POST /conciliacao/:id/desfazer`
- **Fechamento:** `GET /fechamentos`, `POST /fechamentos/fechar`, `POST /fechamentos/reabrir`
- **Relatórios:** `GET /fluxo-caixa`, `GET /aging`, `GET /dre`

### Integração CT-e → Financeiro (o diferencial deste bloco)

O CT-e (já em produção) gera **conta a receber do frete** automaticamente ao ser
autorizado. O gatilho `gerarTituloDeCteProtegido` é chamado em
`cte-emissao.service.ts` (`processarRespostaSefaz`, ponto único de autorização —
cobre síncrono e assíncrono). É idempotente (não duplica por `documentoFiscalId`),
usa o `empresaId` do documento, e em falha registra `PendenciaTituloFiscal` sem
desfazer a autorização fiscal. O cancelamento do CT-e marca os títulos de frete
em aberto como `CANCELADA`.

> Nota técnica: o fluxo real de CT-e autoriza em `DocumentoFiscal` (tipo CTE,
> `valorTotal` = frete), não no model legado `Cte`. A captação parte de
> `DocumentoFiscal`.

## Frontend (`VisioFab.Wms.Front`)

- `src/hooks/financeiro/useFinanceiroApi.ts` — camada de acesso
- `src/lib/financeiro/format.ts` — formatação pura (testada)
- Telas em `src/app/(interna)/financeiro/`: **Contas Bancárias** (`/contas`),
  **Fluxo de Caixa** (`/fluxo-caixa`, com aging), **Conciliação** (`/conciliacao`)
- Menu: 3 entradas novas na seção Financeiro (`ModuleSidebar.tsx`)

## Modelo de dados

8 tabelas novas: `conta_financeira`, `categoria_financeira`, `centro_custo`,
`lancamento_caixa`, `rateio_centro_custo`, `extrato_bancario`,
`fechamento_periodo`, `pendencia_titulo_fiscal`. Colunas aditivas (nullable) em
`conta_receber`/`conta_pagar`: `conta_financeira_id`, `categoria_id`,
`centro_custo_id`, `data_competencia`, `documento_fiscal_id`, e `cte_id` (só
receber). Migração idempotente em `prisma/migrate-prod.ts`, testada 2x local.

## Testes

- Backend: `financeiro-calculo.test.ts` (núcleo, property-based), `services.test.ts`,
  `gerar-titulo-de-documento.service.test.ts` — 22 testes.
- Frontend: `src/lib/financeiro/format.test.ts` — 7 testes.
- Comando back: `npx vitest run src/modules/financeiro/`
- Comando front: `npx vitest run src/lib/financeiro/format.test.ts --pool=threads`

## Pendências / consolidação futura

- Repontar a geração de título de **venda** e **compra** para o service único
  (hoje o CT-e já nasce nele; venda/compra mantêm a lógica inline de efetivação,
  que já funciona em produção — evitar refatorar faturamento sem necessidade).
- Telas de cadastro de categorias/centros de custo e de lançamentos manuais
  (backend pronto; UI dedicada pode ser adicionada — hoje há contas, fluxo e
  conciliação).

---

## Onda 1 — Operação diária completa (adicionado)

**Spec:** `.kiro/specs/financeiro-operacional-completo/`

Transformou o backend financeiro em produto operável. Novidades:

### Backend (`src/modules/financeiro/`)
- `titulo.service.ts` — regras unificadas de título (receber/pagar): editar (só ABERTA), cancelar, estornar baixa, baixa individual enriquecida (conta/categoria/centro) e **baixa em lote** (particiona sucesso/ignorados).
- `dashboard.service.ts` — saldo total, a receber/pagar (hoje/vencido/a vencer), resultado do mês, fluxo de 3 meses, top devedores.
- `extrato.service.ts` — extrato por conta com saldo corrente acumulado.
- `relatorios.service.ts` — inadimplência por cliente e contas por período.
- Rotas novas: `GET /financeiro/dashboard`, `/extrato`, `/relatorios/inadimplencia`, `/relatorios/contas`.
- `conta-pagar`/`conta-receber` ganharam: `PUT /:id` (editar), `PATCH /:id/cancelar`, `PATCH /:id/estornar`, `POST /baixar-lote`, e baixa individual enriquecida.
- Schema: colunas `cancelado_em` e `observacao` (nullable) em `conta_receber`/`conta_pagar` (migração idempotente).

### Frontend (`src/app/(interna)/financeiro/`)
Telas novas: **Dashboard**, **Lançamentos de Caixa**, **Extrato de Conta**, **DRE Gerencial**, **Categorias**, **Centros de Custo**, **Fechamento**, **Relatórios** (com export CSV). Contas a Pagar/Receber ganharam seleção múltipla + baixa em lote, cancelar e estornar. Menu Financeiro com 13 entradas.

### QA
`tests/e2e-qa/test_43_financeiro.py` (Python+Playwright) cobrindo estrutura, ciclo de títulos, baixa em lote, contas bancárias, lançamentos, extrato, conciliação OFX e isolamento multi-tenant. Helpers em `wms_api.py`.

### Testes
Backend: 31 testes Vitest (`npx vitest run src/modules/financeiro/`). Front: `format.test.ts`.
