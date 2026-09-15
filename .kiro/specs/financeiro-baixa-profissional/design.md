# Design Document

Baixa Profissional de Títulos (Liquidação) — Contas a Pagar e a Receber

## Overview

Estende o motor de baixa existente (`titulo.service.ts`) e as telas de Contas a
Pagar/Receber para uma liquidação de nível de mercado: ajustes de valor
(juros/multa/desconto/tarifa), conta origem/destino, data, comprovante e resumo
de cálculo. O cálculo do líquido vive em um **núcleo puro** testável; o backend
persiste os componentes; o frontend oferece um modal rico com resumo em tempo
real (individual e lote).

Princípios:
- **Estender, não reescrever**: `BaixaInput` ganha campos opcionais; chamadores
  atuais seguem funcionando (retrocompatível, Requirement 5.1).
- **Cálculo determinístico** em núcleo puro (`baixa-calculo.ts`), reusado no
  backend e espelhado no frontend.
- **Não quebrar D4**: a contabilização automática da liquidação continua
  best-effort.
- **Migração idempotente** no mesmo commit; **isolamento multi-tenant**.

## Architecture

```
Tela Contas a Pagar/Receber (modal de baixa rico)
      │  valor + juros + multa + desconto + tarifa + conta + data + comprovante
      ▼
conta-pagar.routes / conta-receber.routes  (PATCH /:id/pagar | /:id/receber, POST baixar-lote)
      │
      ├── baixa-calculo.ts (núcleo puro)
      │     calcularLiquido(tipo, { valor, juros, multa, desconto, tarifa }) → { liquido, acrescimos, ... }
      │
      └── titulo.service.baixarTitulo / baixarEmLote  (BaixaInput estendido)
            → persiste componentes + líquido + conta + comprovante
            → dispara contabilizarLiquidacao (D4, best-effort)
```

## Components and Interfaces

### 1. Núcleo puro — `baixa-calculo.ts`

```typescript
export type TipoTitulo = 'RECEBER' | 'PAGAR'

export interface ComponentesBaixa {
  valor: number
  juros?: number
  multa?: number
  desconto?: number
  tarifa?: number
}

export interface ResultadoBaixa {
  acrescimos: number   // juros + multa
  desconto: number
  tarifa: number
  liquido: number      // valor efetivamente movimentado
  valido: boolean      // false se líquido < 0
}

// PAGAR:   liquido = valor + juros + multa - desconto + tarifa (tarifa é custo)
// RECEBER: liquido = valor + juros + multa - desconto - tarifa (tarifa reduz recebido)
export function calcularLiquido(tipo: TipoTitulo, c: ComponentesBaixa): ResultadoBaixa
```

Nota de semântica de tarifa: no **pagar**, a tarifa aumenta o desembolso total (é
um custo do pagamento); no **receber**, a tarifa é descontada do que efetivamente
entra. O `valorPago`/`valorRecebido` persistido é o `liquido`. Sem I/O.

### 2. Schema (colunas aditivas, nullable) — `conta_pagar` e `conta_receber`

```prisma
  jurosBaixa       Decimal? @map("juros_baixa") @db.Decimal(12, 2)
  multaBaixa       Decimal? @map("multa_baixa") @db.Decimal(12, 2)
  descontoBaixa    Decimal? @map("desconto_baixa") @db.Decimal(12, 2)
  tarifaBaixa      Decimal? @map("tarifa_baixa") @db.Decimal(12, 2)
  comprovanteNome     String? @map("comprovante_nome") @db.VarChar(200)
  comprovanteConteudo String? @map("comprovante_conteudo") @db.Text
```

Reusa `valorPago`/`valorRecebido` (já existem) para o líquido, `dataPagamento`/
`dataRecebimento` para a data, `contaFinanceiraId` para a conta, `formaPagamento`
para a forma. Só os 6 campos acima são novos.

### 3. `BaixaInput` estendido (`titulo.service.ts`)

```typescript
export interface BaixaInput {
  valor: number
  data?: Date
  formaPagamento: string
  contaFinanceiraId?: string
  categoriaId?: string
  centroCustoId?: string
  // novos (opcionais — retrocompatível)
  juros?: number
  multa?: number
  desconto?: number
  tarifa?: number
  comprovanteNome?: string
  comprovanteConteudo?: string
}
```

`baixarTitulo`:
- Calcula o líquido via `calcularLiquido(tipo, { valor, juros, multa, desconto,
  tarifa })`. Se `!valido` → `ErroFinanceiro(422, 'desconto maior que o valor + acréscimos')`.
- Persiste `valorPago/valorRecebido = liquido`, mais os componentes e o
  comprovante. O `valor` de entrada continua sendo o valor-base do título.
- Mantém a checagem de período fechado.

`estornarBaixa`: limpa também os novos campos (juros/multa/desconto/tarifa/
comprovante) — Requirement 5.3.

`baixarEmLote`: aceita `juros/multa/desconto/tarifa` comuns? Não — em lote o valor
é o total de cada título e ajustes por título não fazem sentido genérico; o lote
usa só data/conta/forma comuns (comportamento atual preservado). Os campos de
ajuste ficam para a baixa individual (Requirement 4.1).

### 4. Rotas (estendem o schema Zod do body, sem novas rotas)

- `PATCH /contas-pagar/:id/pagar` e `PATCH /contas-receber/:id/receber`: o body
  passa a aceitar `juros`, `multa`, `desconto`, `tarifa`, `comprovanteNome`,
  `comprovanteConteudo` (todos opcionais). O acoplamento de contabilização (D4)
  usa o líquido calculado.
- `POST /contas-pagar/baixar-lote` e `/contas-receber/baixar-lote`: inalterados na
  forma (data/conta/forma comuns).

### 5. Frontend — modal de baixa rico

Componente reutilizável `BaixaTituloModal` (usado por pagar e receber):
- Campos: Data de pagamento, Conta origem/destino (Select de ContaFinanceira),
  Forma de pagamento, e ajustes Juros, Multa, Desconto, Tarifa.
- **Resumo de cálculo** (Card lateral) recalculado em tempo real com a função pura
  espelhada no front (`lib/financeiro/baixa.ts`): Título, Acréscimos, Descontos,
  Tarifa, **Valor Líquido**. Bloqueia confirmação se líquido < 0.
- Upload de comprovante (FileButton → base64), opcional.
- Modal de **lote**: lista os títulos selecionados com total consolidado, campos
  comuns (data/conta/forma), confirma.

O layout segue o espírito da referência do usuário (dados financeiros + ajustes +
resumo + comprovante + confirmação), adaptado ao Mantine e sem overengineering de
wizard multi-página — um modal único com seções é suficiente e mais rápido de usar.

## Data Models

6 colunas novas por tabela (nullable). Reuso dos campos de liquidação existentes
para líquido/data/conta/forma. `Decimal(12,2)` no padrão das tabelas.

## Error Handling

- Desconto > valor + acréscimos → 422 (líquido negativo).
- Período fechado → erro existente preservado.
- Título já baixado/cancelado → 409 (existente).
- Conta/título de outra empresa → 404.

## Testing Strategy

- **Unit/PBT** (`baixa-calculo.test.ts`): fórmula do líquido por tipo, tarifa
  (pagar soma, receber subtrai), líquido nunca negativo quando válido, rejeição
  quando desconto excede.
- **QA E2E** (`test_49_baixa.py`): baixa com juros/multa/desconto (líquido
  correto), baixa com desconto excessivo barrada (422), estorno limpa componentes,
  isolamento.
- Checkpoint: `vitest run baixa-calculo.test.ts` + diagnostics + bundle esbuild do
  server (lição D2). Front: `tsc --noEmit` nos arquivos novos.

## Correctness Properties

### Property 1: Líquido do pagar
Para PAGAR, `calcularLiquido` retorna `liquido = valor + juros + multa − desconto
+ tarifa`, para quaisquer componentes ≥ 0, quando o resultado é ≥ 0.
**Validates: Requirements 1.2**

### Property 2: Líquido do receber
Para RECEBER, `calcularLiquido` retorna `liquido = valor + juros + multa −
desconto − tarifa`, para quaisquer componentes ≥ 0, quando o resultado é ≥ 0.
**Validates: Requirements 1.2**

### Property 3: Líquido nunca negativo / rejeição
Se `desconto (+ tarifa no receber)` excede `valor + juros + multa`, `valido` é
false; caso contrário `liquido ≥ 0`.
**Validates: Requirements 1.3, 3.3**

### Property 4: Retrocompatibilidade
Sem juros/multa/desconto/tarifa, `calcularLiquido` retorna `liquido = valor`
(idêntico ao comportamento anterior da baixa).
**Validates: Requirements 5.1**
