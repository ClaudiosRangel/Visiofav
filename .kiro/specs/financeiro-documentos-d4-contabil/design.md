# Design Document

Central de Documentos Financeiros — Fase D4 (Contabilidade / Partidas Dobradas)

## Overview

A D4 adiciona quatro entidades (`ContaContabil`, `MapeamentoContabil`,
`LancamentoContabil`, `PartidaContabil`) e um núcleo puro de contabilidade
(validação de partidas dobradas + montagem de lançamento a partir de um de/para).
A geração automática é acoplada de forma **best-effort e não-bloqueante** ao
motor de baixa e à inclusão de título já existentes. Um serviço de consulta
entrega razão e balancete.

Princípios:
- **Estender, não reescrever**: reusa `CategoriaFinanceira`, contas a pagar/
  receber e o motor de baixa; a contabilização é um efeito colateral opcional.
- **Invariante central**: todo lançamento tem Σ débitos = Σ créditos (tolerância
  R$ 0,01). Validada em núcleo puro e no serviço.
- **Não-bloqueante**: se o de/para não existe ou a geração falha, o financeiro
  não é afetado; o lançamento fica PENDENTE/ausente e é auditável.
- **Isolamento multi-tenant** e migração idempotente no mesmo commit.

## Architecture

```
Tela Contabilidade / eventos financeiros
      │
      ├── contabil.routes.ts (/api/financeiro/contabil)
      │     ├── plano de contas (CRUD ContaContabil)
      │     ├── de/para (MapeamentoContabil)
      │     ├── lançamento manual (LancamentoContabil + PartidaContabil)
      │     └── consultas (razão, balancete)
      │
      ├── contabil-core.ts (núcleo puro)
      │     ├── validarPartidasDobradas(partidas) → { balanceado, totalDebito, totalCredito }
      │     └── montarPartidasDoDePara(dePara, valor, evento) → PartidaInput[]
      │
      ├── contabil.service.ts (CRUD + consultas, isolado por empresa)
      │
      └── contabilizacao.service.ts
            ├── contabilizarProvisao(prisma, empresaId, { categoriaId, valor, ref, data })
            └── contabilizarLiquidacao(prisma, empresaId, { categoriaId, valor, ref, data })
                  (chamados best-effort por inclusao-titulo / baixa; try/catch isola falhas)
```

Registro: sub-rotas de `/api/financeiro` (padrão da D1/D3), prefixo lógico
`/contabil`.

## Components and Interfaces

### 1. Modelo de dados (Prisma)

```prisma
model ContaContabil {
  id         String  @id @default(uuid())
  empresaId  String  @map("empresa_id")
  codigo     String  @db.VarChar(30)          // ex.: "1.1.01.001"
  nome       String  @db.VarChar(150)
  natureza   String  @db.VarChar(10)          // DEVEDORA | CREDORA
  grupo      String  @db.VarChar(15)          // ATIVO|PASSIVO|PATRIMONIO|RECEITA|DESPESA
  paiId      String? @map("pai_id")
  analitica  Boolean @default(true)           // só analítica lança
  status     Boolean @default(true)
  criadoEm   DateTime @default(now()) @map("criado_em")
  partidas   PartidaContabil[]
  @@unique([empresaId, codigo])
  @@map("conta_contabil")
}

model MapeamentoContabil {
  id                  String  @id @default(uuid())
  empresaId           String  @map("empresa_id")
  categoriaId         String  @map("categoria_id")          // CategoriaFinanceira
  // Provisão (competência): ex. despesa D=Despesa / C=Fornecedores
  provisaoDebitoId    String? @map("provisao_debito_id")
  provisaoCreditoId   String? @map("provisao_credito_id")
  // Liquidação (caixa): ex. pagamento D=Fornecedores / C=Banco
  liquidacaoDebitoId  String? @map("liquidacao_debito_id")
  liquidacaoCreditoId String? @map("liquidacao_credito_id")
  criadoEm            DateTime @default(now()) @map("criado_em")
  @@unique([empresaId, categoriaId])
  @@map("mapeamento_contabil")
}

model LancamentoContabil {
  id           String   @id @default(uuid())
  empresaId    String   @map("empresa_id")
  data         DateTime
  historico    String   @db.VarChar(300)
  origem       String   @default("MANUAL") @db.VarChar(20)  // MANUAL|PROVISAO|LIQUIDACAO
  refTipo      String?  @map("ref_tipo") @db.VarChar(20)    // CONTA_PAGAR|CONTA_RECEBER|FOLHA
  refId        String?  @map("ref_id")
  status       String   @default("LANCADO") @db.VarChar(20) // LANCADO|PENDENTE
  valorPendente Decimal? @map("valor_pendente") @db.Decimal(14,2) // preenchido só quando PENDENTE
  criadoEm     DateTime @default(now()) @map("criado_em")
  partidas     PartidaContabil[]
  @@index([empresaId, data])
  @@map("lancamento_contabil")
}

model PartidaContabil {
  id            String  @id @default(uuid())
  lancamentoId  String  @map("lancamento_id")
  lancamento    LancamentoContabil @relation(fields: [lancamentoId], references: [id], onDelete: Cascade)
  contaId       String  @map("conta_id")
  conta         ContaContabil @relation(fields: [contaId], references: [id])
  tipo          String  @db.VarChar(7)     // DEBITO | CREDITO
  valor         Decimal @db.Decimal(14,2)
  @@index([lancamentoId])
  @@index([contaId])
  @@map("partida_contabil")
}
```

### 2. Núcleo puro — `contabil-core.ts`

```typescript
export type TipoPartida = 'DEBITO' | 'CREDITO'
export interface PartidaInput { contaId: string; tipo: TipoPartida; valor: number }

// Σ débitos vs Σ créditos, com tolerância R$ 0,01.
export function validarPartidasDobradas(partidas: PartidaInput[]): {
  balanceado: boolean; totalDebito: number; totalCredito: number
}

// A partir das contas de de/para (débito/crédito) e um valor, monta as 2 partidas.
export function montarPartidas(debitoId: string, creditoId: string, valor: number): PartidaInput[]

// Saldo de uma conta dado o total de débitos/créditos e a natureza.
export function saldoPorNatureza(natureza: 'DEVEDORA' | 'CREDORA', totalDebito: number, totalCredito: number): number
```

Sem I/O, sem Prisma. Testável (unit + property-based: balanceamento e saldo).

### 3. `contabil.service.ts` (CRUD + consultas, isolado por empresa)

- Plano de contas: `criarConta`, `listarContas`, `atualizarConta` (valida código
  único por empresa; marca `analitica`).
- De/para: `salvarMapeamento` (valida que as contas informadas são analíticas e
  da empresa), `obterMapeamento(categoriaId)`.
- Lançamento manual: `criarLancamentoManual(prisma, empresaId, { data, historico,
  partidas })` — valida via `validarPartidasDobradas`, valida contas analíticas da
  empresa, cria `LancamentoContabil` + `PartidaContabil` em transação.
- Consultas: `razao(contaId, ini, fim)` e `balancete(ini, fim)` — agregam
  partidas por conta e calculam saldo via `saldoPorNatureza`; balancete garante
  Σdébitos = Σcréditos no total.

### 4. `contabilizacao.service.ts` (geração automática best-effort)

```typescript
export async function contabilizarProvisao(prisma, empresaId, {
  categoriaId?, valor, data, historico, refTipo, refId,
}): Promise<void>

export async function contabilizarLiquidacao(prisma, empresaId, {
  categoriaId?, valor, data, historico, refTipo, refId,
}): Promise<void>
```

Regras:
- Busca `MapeamentoContabil` da categoria. Se existe e tem as contas do evento
  (provisão ou liquidação), monta as partidas com `montarPartidas` e cria o
  `LancamentoContabil` (origem PROVISAO/LIQUIDACAO, ref ao título).
- Se não há de/para (ou não tem as contas do evento), cria um lançamento
  `status: 'PENDENTE'` com `valorPendente` e a referência, **sem partidas
  balanceadas** — para classificação posterior. Não lança erro.
- Chamadores (`inclusao-titulo`, motor de baixa) invocam dentro de `try/catch`
  que engole erros e loga — **nunca** interrompe o fluxo financeiro (Requirement
  4.5). O acoplamento é feito por chamada explícita após o commit financeiro,
  não dentro da mesma transação, para não arriscar rollback do financeiro por
  falha contábil.

### 5. Rotas — `contabil.routes.ts` (sub-rota de `/api/financeiro`, prefixo `/contabil`)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/contabil/contas` | Lista o plano de contas. |
| POST | `/contabil/contas` | Cria conta contábil. |
| PUT | `/contabil/contas/:id` | Atualiza conta. |
| GET | `/contabil/mapeamentos` | Lista de/para. |
| PUT | `/contabil/mapeamentos/:categoriaId` | Salva de/para de uma categoria. |
| GET | `/contabil/lancamentos` | Lista lançamentos (filtro por período). |
| POST | `/contabil/lancamentos` | Cria lançamento manual (partidas dobradas). |
| GET | `/contabil/razao/:contaId` | Razão de uma conta no período. |
| GET | `/contabil/balancete` | Balancete do período. |

### 6. Acoplamento aos eventos (mínimo e isolado)

- **Provisão**: após `incluirTitulo` criar o(s) título(s), chamar
  `contabilizarProvisao` (best-effort) com a categoria e o valor. Como
  `incluirTitulo` usa `createMany` sem retornar ids, a contabilização usa a
  referência lógica (categoria + descrição/competência) — o vínculo fino por id
  não é necessário para o registro contábil.
- **Liquidação**: no motor de baixa (contas a pagar/receber), após marcar o título
  PAGO, chamar `contabilizarLiquidacao` com a categoria e o valor pago.
- Ambos os pontos são acréscimos pequenos, envoltos em `try/catch`, sem alterar a
  assinatura pública dos serviços existentes.

## Data Models

Ver seção 1. `Decimal(14,2)` para valores; enums textuais (VarChar) no padrão do
schema. Natureza e grupo como strings validadas na aplicação.

## Error Handling

- Código de conta duplicado → 409.
- Conta sintética usada em partida/de-para → 422.
- Lançamento manual desbalanceado → 422 com os totais.
- Conta/lançamento de outra empresa → 404.
- Falha na contabilização automática → logada, nunca propagada ao financeiro.

## Testing Strategy

- **Unit/PBT** (`contabil-core.test.ts`): balanceamento (Σd=Σc), saldo por
  natureza, montagem de partidas. Sem I/O.
- **QA E2E** (`test_48_contabil.py`): criar plano de contas, criar de/para,
  lançamento manual balanceado (ok) e desbalanceado (422), conta sintética em
  partida barrada, balancete fecha, isolamento multi-tenant.
- Checkpoint: `vitest run contabil-core.test.ts` + diagnostics + bundle esbuild do
  server (lição D2).

## Correctness Properties

### Property 1: Partidas dobradas sempre balanceiam ou são rejeitadas
Para qualquer conjunto de partidas, `validarPartidasDobradas` retorna
`balanceado = true` se e somente se `|Σdébitos − Σcréditos| ≤ 0,01`; e um
lançamento manual só é persistido quando balanceado.
**Validates: Requirements 3.2, 4.3**

### Property 2: Montagem de partidas do de/para é sempre balanceada
Para qualquer valor > 0, `montarPartidas(d, c, valor)` produz exatamente um débito
e um crédito de mesmo valor — portanto sempre balanceado.
**Validates: Requirements 4.1, 4.3**

### Property 3: Saldo respeita a natureza da conta
Para conta DEVEDORA, saldo = débitos − créditos; para CREDORA, saldo = créditos −
débitos. `saldoPorNatureza` obedece isso para quaisquer totais ≥ 0.
**Validates: Requirements 6.1**

### Property 4: Balancete fecha
Em qualquer período, a soma dos débitos de todas as partidas iguala a soma dos
créditos (tolerância R$ 0,01), pois todo lançamento LANCADO é balanceado.
**Validates: Requirements 6.2**

### Property 5: Contabilização não-bloqueante
Se o de/para de uma categoria não existe, a operação financeira ocorre normalmente
e o lançamento fica PENDENTE (sem partidas balanceadas); nenhuma exceção contábil
propaga para o fluxo financeiro.
**Validates: Requirements 4.4, 4.5**

### Property 6: Isolamento multi-tenant
Contas, de/para e lançamentos criados pela empresa A nunca aparecem nas consultas
da empresa B, e ids conhecidos de outra empresa retornam como inexistentes.
**Validates: Requirements 5.1**
