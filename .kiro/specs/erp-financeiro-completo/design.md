# Design Document

Financeiro Operacional Completo (Bloco F1) — Vizor ERP

## Overview

O F1 estende o Financeiro básico (modelos `ContaReceber`/`ContaPagar` já
existentes) para um financeiro operacional completo, adicionando: contas
bancárias/caixa com saldo, plano de contas gerencial + centro de custo,
lançamentos manuais, conciliação bancária (OFX), fluxo de caixa/DRE/aging,
fechamento de período, e a **captação automática de títulos a partir de Vendas,
Compras e CT-e** (este último já emitindo em produção).

Princípios que guiam o design:

- **Estender, não reescrever.** `ContaReceber`/`ContaPagar` ganham colunas
  novas *nullable* (categoria, centro de custo, conta financeira, vínculo a
  documento fiscal/CT-e, competência). Nada existente é removido/renomeado. As
  rotas atuais (`conta-receber.routes.ts`) continuam funcionando.
- **Núcleo de cálculo puro e testável.** Saldo de conta, projeção de fluxo de
  caixa, aging, agrupamento de DRE e rateio são funções puras (sem I/O),
  cobertas por testes (fast-check + unitários).
- **Integração via service reutilizável.** "Documento fiscal autorizado →
  título" vira um único ponto (`gerar-titulo-de-documento.service.ts`) usado por
  venda, compra e CT-e, evitando a duplicação inline que já causou divergência
  no PCP→WMS.
- **Isolamento multi-tenant explícito.** Modelos novos entram em
  `ISOLATED_MODELS` quando possível; entidades filhas (rateio, linha de extrato)
  isolam pelo pai. Ver `.kiro/steering/ATENCAO-pontos-verificar.md`.
- **Migração idempotente no mesmo commit** (`.kiro/steering/database-migrations.md`).

## Architecture

```
                    ┌─────────────────────────────────────┐
   Venda efetivada  │  gerar-titulo-de-documento.service   │
   Compra efetivada │  (ponto único: doc autorizado→título)│
   CT-e autorizado ─┤                                      │
                    └───────────────┬─────────────────────┘
                                    │ cria/estorna
                     ┌──────────────▼──────────────┐
                     │  ContaReceber / ContaPagar   │  (estendidos)
                     └──────────────┬──────────────┘
                                    │ baixa/estorno
        ┌───────────────┬──────────┴───────┬──────────────────┐
        ▼               ▼                  ▼                   ▼
  ContaFinanceira   LancamentoCaixa   ExtratoBancario     FechamentoPeriodo
  (saldo)           (manual)          (OFX + conciliação)  (trava período)
        │
        └── movimento consolidado → núcleo puro → Fluxo de Caixa / DRE / Aging
```

Camadas por módulo (`src/modules/financeiro/`):
- `financeiro-calculo.ts` — funções puras (saldo, fluxo, aging, DRE, rateio).
- `*.service.ts` — I/O (conta financeira, lançamento, conciliação, fechamento).
- `gerar-titulo-de-documento.service.ts` — captação automática (venda/compra/CT-e).
- `*.routes.ts` — rotas Fastify `/api/financeiro/*`, Zod, `moduloGuard('FINANCEIRO')`.
- `financeiro.schemas.ts` / `financeiro.types.ts` — Zod + tipos/constantes.

## Components and Interfaces

### 1. Núcleo puro (`financeiro-calculo.ts`)

```ts
// Saldo de uma conta a partir do saldo inicial e movimentos realizados
calcularSaldoConta(saldoInicial: Decimalish, movimentos: MovimentoConta[]): number

// Projeção por bucket (dia/semana/mês) com previsto (aberto) e realizado (baixado)
projetarFluxoCaixa(input: {
  saldoInicial: number
  titulos: TituloFluxo[]        // {tipo: RECEBER|PAGAR, valor, vencimento, status}
  lancamentos: LancamentoFluxo[]
  de: Date; ate: Date; granularidade: 'DIA'|'SEMANA'|'MES'
}): BucketFluxo[]

// Faixas: A_VENCER, D1_30, D31_60, D61_90, D90_MAIS
classificarAging(titulos: TituloAging[], agora: Date): ResumoAging

// Agrupa receitas/despesas por categoria no período (por competência)
montarDreGerencial(titulos: TituloDre[], de: Date, ate: Date): LinhaDre[]

// Divide um valor entre centros de custo; soma das partes == total (tol. 0,01)
validarRateio(valorTotal: number, partes: ParteRateio[]): boolean
```

Todas determinísticas, recebendo `agora`/datas por parâmetro. `Decimal` do
Prisma convertido para `number` na borda (entrada do núcleo puro).

### 2. Contas financeiras (`conta-financeira.service.ts`)

- `criarConta`, `listarContasComSaldo`, `inativarConta` (bloqueia exclusão se há movimento), `transferirEntreContas` (débito+crédito em `$transaction`, sem tocar no resultado/DRE).

### 3. Lançamentos manuais (`lancamento-caixa.service.ts`)

- `criarLancamento` (ENTRADA/SAIDA, atualiza saldo), `estornarLancamento` (reverte saldo, preserva registro), respeitando período fechado (Req 7.2).

### 4. Captação automática (`gerar-titulo-de-documento.service.ts`)

Ponto único chamado por venda, compra e CT-e:

```ts
gerarTitulosDeVenda(vendaEfetivadaId): Promise<ContaReceber[]>   // já existe → migrar p/ aqui
gerarTitulosDeCompra(compraEfetivadaId): Promise<ContaPagar[]>   // já existe → migrar p/ aqui
gerarTituloDeCte(cteId): Promise<ContaReceber>                   // NOVO
cancelarTitulosDeDocumento(tipo, documentoId): Promise<void>     // estorno em aberto
```

Regras (Req 4):
- **CT-e**: dispara quando o CT-e passa a **autorizado** (protocolo/status). Gera
  `ContaReceber` com `valor = cte.valorFrete`, `clienteId` = tomador/pagador do
  frete (remetente ou destinatário conforme responsável), `cteId` vinculado,
  `descricao` = "Frete CT-e nº {numero}", vencimento default = configuração da
  empresa (ex.: dias após emissão). Idempotente: não duplica se já existe título
  para o `cteId`.
- `empresaId` do título = o do **documento** (venda/compra/CT-e), não do usuário
  (Req 4.6).
- Falha na geração **não desfaz** a autorização fiscal; registra pendência para
  reprocessamento (Req 4.5) — tabela `PendenciaTituloFiscal` (documento, tipo,
  erro, resolvido).

### 5. Conciliação bancária (`conciliacao.service.ts`)

- `importarOfx(contaId, arquivo)`: parseia OFX, cria `LinhaExtrato` (idempotente por `fitid`/hash), ignora já importadas.
- `sugerirMatches(contaId)`: casa linha × título por valor + janela de data (núcleo puro para o score).
- `conciliar(linhaId, tituloId)`: baixa título + marca linha conciliada + atualiza saldo (`$transaction`).
- `criarLancamentoDeLinha(linhaId, categoria, centro)`: para linhas sem título.
- `desfazerConciliacao(linhaId)`: reverte baixa + saldo.

### 6. Consultas gerenciais (`relatorios-financeiro.routes.ts`)

- `GET /financeiro/fluxo-caixa`, `GET /financeiro/dre`, `GET /financeiro/aging` — usam o núcleo puro sobre os dados isolados por empresa.

### 7. Fechamento (`fechamento.service.ts`)

- `fecharPeriodo(competencia)`, `reabrirPeriodo(competencia, motivo)`, e um guard consultado por lançamento/baixa/estorno que rejeita datas em competência fechada (Req 7.2).

## Data Models

Modelos **novos** (todos com `empresaId`, entram em `ISOLATED_MODELS` quando a
rota usar `prismaScoped`):

```prisma
model ContaFinanceira {
  id            String   @id @default(uuid())
  empresaId     String   @map("empresa_id")
  tipo          String   @db.VarChar(20)   // CAIXA | BANCO | APLICACAO
  nome          String   @db.VarChar(120)
  banco         String?  @db.VarChar(60)
  agencia       String?  @db.VarChar(20)
  conta         String?  @db.VarChar(30)
  saldoInicial  Decimal  @default(0) @map("saldo_inicial") @db.Decimal(14,2)
  status        Boolean  @default(true)
  criadoEm      DateTime @default(now()) @map("criado_em")
  @@index([empresaId])
  @@map("conta_financeira")
}

model CategoriaFinanceira {
  id         String  @id @default(uuid())
  empresaId  String  @map("empresa_id")
  tipo       String  @db.VarChar(10)   // RECEITA | DESPESA
  codigo     String  @db.VarChar(20)
  nome       String  @db.VarChar(120)
  paiId      String? @map("pai_id")
  status     Boolean @default(true)
  @@unique([empresaId, codigo])
  @@map("categoria_financeira")
}

model CentroCusto {
  id         String  @id @default(uuid())
  empresaId  String  @map("empresa_id")
  codigo     String  @db.VarChar(20)
  nome       String  @db.VarChar(120)
  status     Boolean @default(true)
  @@unique([empresaId, codigo])
  @@map("centro_custo")
}

model LancamentoCaixa {
  id                String   @id @default(uuid())
  empresaId         String   @map("empresa_id")
  contaFinanceiraId String   @map("conta_financeira_id")
  tipo              String   @db.VarChar(10)  // ENTRADA | SAIDA
  valor             Decimal  @db.Decimal(14,2)
  data              DateTime
  dataCompetencia   DateTime @map("data_competencia")
  descricao         String   @db.VarChar(300)
  categoriaId       String?  @map("categoria_id")
  estornado         Boolean  @default(false)
  criadoEm          DateTime @default(now()) @map("criado_em")
  @@index([empresaId, data])
  @@map("lancamento_caixa")
}

model RateioCentroCusto {   // rateio de um lançamento/título entre centros
  id            String  @id @default(uuid())
  lancamentoId  String? @map("lancamento_id")
  centroCustoId String  @map("centro_custo_id")
  valor         Decimal @db.Decimal(14,2)
  @@map("rateio_centro_custo")
}

model ExtratoBancario {
  id                String   @id @default(uuid())
  empresaId         String   @map("empresa_id")
  contaFinanceiraId String   @map("conta_financeira_id")
  fitid             String   @db.VarChar(100)  // id único da transação no OFX
  data              DateTime
  valor             Decimal  @db.Decimal(14,2)
  descricao         String   @db.VarChar(300)
  conciliado        Boolean  @default(false)
  contaReceberId    String?  @map("conta_receber_id")
  contaPagarId      String?  @map("conta_pagar_id")
  @@unique([contaFinanceiraId, fitid])
  @@map("extrato_bancario")
}

model FechamentoPeriodo {
  id            String   @id @default(uuid())
  empresaId     String   @map("empresa_id")
  competencia   String   @db.VarChar(7)   // "YYYY-MM"
  fechadoPor    String   @map("fechado_por")
  fechadoEm     DateTime @default(now()) @map("fechado_em")
  reabertoPor   String?  @map("reaberto_por")
  reabertoEm    DateTime? @map("reaberto_em")
  motivoReabertura String? @map("motivo_reabertura") @db.VarChar(300)
  aberto        Boolean  @default(false)
  @@unique([empresaId, competencia])
  @@map("fechamento_periodo")
}

model PendenciaTituloFiscal {  // Req 4.5 — falha na geração de título
  id            String   @id @default(uuid())
  empresaId     String   @map("empresa_id")
  tipoDocumento String   @db.VarChar(20)  // VENDA | COMPRA | CTE
  documentoId   String   @map("documento_id")
  erro          String   @db.Text
  resolvido     Boolean  @default(false)
  criadoEm      DateTime @default(now()) @map("criado_em")
  @@map("pendencia_titulo_fiscal")
}
```

Colunas **adicionadas** a modelos existentes (todas *nullable*, sem quebra):

```prisma
// ContaReceber (+)
contaFinanceiraId String?  @map("conta_financeira_id")
categoriaId       String?  @map("categoria_id")
centroCustoId     String?  @map("centro_custo_id")
dataCompetencia   DateTime? @map("data_competencia")
cteId             String?  @map("cte_id")            // origem CT-e (frete)
documentoFiscalId String?  @map("documento_fiscal_id")

// ContaPagar (+)
contaFinanceiraId String?  @map("conta_financeira_id")
categoriaId       String?  @map("categoria_id")
centroCustoId     String?  @map("centro_custo_id")
dataCompetencia   DateTime? @map("data_competencia")
documentoFiscalId String?  @map("documento_fiscal_id")
```

### Migração (obrigatória no mesmo commit)

`prisma/migrate-prod.ts` idempotente: `CREATE TABLE IF NOT EXISTS` para as 7
tabelas novas + índices/uniques; `ADD COLUMN IF NOT EXISTS` para as colunas em
`conta_receber`/`conta_pagar`; FKs em `try/catch` individuais. Testar
`npx tsx prisma/migrate-prod.ts` **2x** local antes de qualquer push.

## Error Handling

| Situação | Resposta |
|----------|----------|
| Entrada inválida (Zod) | 422 "campo: motivo", nada persistido |
| Conta/título/linha de outra empresa | 404 |
| Baixa/estorno em título já baixado/estornado | 409 |
| Lançamento em período fechado | 409 "período fechado" |
| Rateio cuja soma ≠ total | 422 |
| Falha ao gerar título de doc fiscal | doc fiscal permanece; cria `PendenciaTituloFiscal`, loga; não 5xx para o fluxo fiscal |
| Excluir conta com movimento | 409 "conta possui movimento; inative" |

## Testing Strategy

- **Núcleo puro (fast-check + unit):** saldo (soma consistente), fluxo de caixa
  (buckets somam realizado+previsto), aging (faixas mutuamente exclusivas e
  exaustivas), DRE (soma por categoria = total do tipo), rateio (soma == total).
- **Services (unit + integração):** captação idempotente de CT-e (não duplica),
  isolamento por empresa (título/linha só da empresa pedida), transferência não
  afeta DRE, conciliação atualiza saldo e reverte no desfazer, período fechado
  bloqueia escrita.
- **Migração:** `migrate-prod.ts` idempotente 2x local.
- Property tests marcados opcionais no tasks (`*`), como no padrão do projeto.

## Correctness Properties

### Property 1: Saldo consistente
Saldo da conta == saldoInicial + Σ entradas − Σ saídas realizadas.
**Validates: Requirements 1.4, 3.2**

### Property 2: Aging exaustivo e exclusivo
Todo título em aberto cai em exatamente uma faixa.
**Validates: Requirements 6.4**

### Property 3: Fluxo de caixa balanceado
Saldo final do bucket == saldo inicial + entradas − saídas do bucket.
**Validates: Requirements 6.1**

### Property 4: Rateio fecha
Σ partes == valor total (tolerância 0,01).
**Validates: Requirements 2.4**

### Property 5: Captação idempotente
Gerar título do mesmo documento 2x não duplica.
**Validates: Requirements 4.3**

### Property 6: Isolamento
Toda consulta só retorna registros do `empresaId` pedido.
**Validates: Requirements 8.1, 8.2**

### Property 7: Transferência neutra no resultado
Transferir entre contas não altera o DRE.
**Validates: Requirements 1.5**

### Property 8: Período fechado imutável
Nenhuma escrita com data em competência fechada é aceita.
**Validates: Requirements 7.2**
