# Design — Atributos Logísticos e Shelf Life (fecha o Relatório de Validação Cadastral)

## Overview

Esta feature adiciona ao cadastro mestre de produto os atributos que faltavam
para atender 100% o Relatório de Validação Cadastral, **estendendo** o que já
existe sem reescrever:

1. **Periculosidade** (`Produto.periculosidade`) — usada como restrição no motor
   de put-away (ao lado de `ambienteExigido`/`classificacaoArmazenagemId`).
2. **Shelf Life Total** (`Produto.shelfLifeTotalDias`) — permite calcular o
   vencimento a partir da data de fabricação na conferência de entrada.
3. **RLM percentual** (`Produto.percentualVidaUtilMinimoRecebimento`) —
   complementa o `shelfLifeMinimo` (dias) já existente com um critério de % de
   vida útil restante, aplicado na conferência de entrada.
4. **Shelf Life de Expedição por cliente** (`Cliente.shelfLifeMinimoExpedicaoDias`)
   — aplicado no picking/FEFO para pular lotes que o cliente não aceitaria.
5. **Quarentena automática por dias a vencer** (`Produto.diasQuarentenaVencimento`
   com fallback por empresa via `Parametro`) — bloqueia o lote reusando o
   mecanismo de bloqueio/quarentena já existente do WMS.

Toda a matemática de datas/percentuais fica concentrada numa **lógica pura**
testável por property-based (fast-check), no novo
`shelf-life-avancado.service.ts`. Os campos novos são **opcionais/nullable**
(compatibilidade retroativa). Isolamento multi-tenant com **filtro explícito por
`empresaId`**. Migração idempotente em `migrate-prod.ts` no mesmo commit do
`schema.prisma`.

> Rastreamento: ao concluir tarefas, atualizar
> `.kiro/steering/relatorio-validacao-cadastral.md`.

## Architecture

```
Backend (VisioFab.Wms.Back)
  prisma/schema.prisma
    - Produto.periculosidade (String? VarChar(20))
    - Produto.shelfLifeTotalDias (Int?)
    - Produto.percentualVidaUtilMinimoRecebimento (Decimal? 5,2)
    - Produto.diasQuarentenaVencimento (Int?)
    - Cliente.shelfLifeMinimoExpedicaoDias (Int?)
  prisma/migrate-prod.ts              — ADD COLUMN IF NOT EXISTS (idempotente)

  src/modules/conferencia-entrada/
    shelf-life-avancado.service.ts        — NOVO: lógica pura (datas/percentuais)
    shelf-life-avancado.service.test.ts   — NOVO: property-based (fast-check)
    validar-validade-produto.service.ts   — ESTENDER: RLM % + vencimento por fabricação
    conferencia-entrada.routes.ts         — passar novos campos do produto ao helper

  src/modules/produto/produto.routes.ts   — POST/PUT aceitam os novos campos
  src/modules/cliente/cliente.routes.ts   — POST/PUT aceitam shelfLifeMinimoExpedicaoDias

  src/modules/enderecamento/…             — put-away considera periculosidade (área compatível)
  src/modules/picking|separacao/…         — FEFO pula lotes fora do mínimo do cliente
  src/modules/… (quarentena/bloqueio)     — job/hook aplica quarentena automática por dias a vencer

Frontend (VisioFab.Wms.Front)
  ProdutoModal.tsx                        — aba "Logística/Validade": periculosidade,
                                            shelfLifeTotalDias, RLM %, dias quarentena
  cadastro de Cliente                     — campo shelfLifeMinimoExpedicaoDias
```

## Components and Interfaces

### 1. Lógica pura — shelf-life-avancado.service.ts (NOVO)

Concentra toda a matemática de datas/percentuais. Sem I/O. Cobre Requirement 6.

```ts
/** Vencimento = fabricação + shelfLifeTotalDias. null se faltar entrada. */
export function calcularVencimentoPorFabricacao(
  dataFabricacao: Date | null,
  shelfLifeTotalDias: number | null,
): Date | null

/** Dias inteiros entre `de` e `ate` (ate - de). null se faltar entrada. */
export function diasEntre(de: Date | null, ate: Date | null): number | null

/**
 * % de vida útil restante = diasRestantes / shelfLifeTotalDias * 100.
 * 100% quando resta o shelf life inteiro; 0% (não negativo) para vencidos;
 * null quando faltar entrada.
 */
export function percentualVidaUtilRestante(
  vencimento: Date | null,
  shelfLifeTotalDias: number | null,
  dataReferencia: Date,
): number | null

/** Recusa sse percentual < mínimo. Sem mínimo/entrada → não recusa. */
export function recusaPorPercentualRecebimento(
  percentualRestante: number | null,
  percentualMinimo: number | null,
): boolean

/** Elegível p/ cliente sse diasRestantes >= diasMinimosCliente. Sem regra → elegível. */
export function elegivelParaCliente(
  diasRestantes: number | null,
  diasMinimosCliente: number | null,
): boolean

/** Quarentena sse diasRestantes <= limiar. Sem limiar/entrada → não bloqueia. */
export function deveEntrarEmQuarentena(
  diasRestantes: number | null,
  limiarDias: number | null,
): boolean
```

Regras de neutralidade (Req 6.6): qualquer entrada nula ou parâmetro ausente
retorna resultado neutro (`null`/`false`), nunca lança.

### 2. Conferência de entrada — extensão (Req 2, 3)

`validar-validade-produto.service.ts` ganha entradas novas, preservando a ordem
atual (vencido → shelf life dias) e acrescentando o critério percentual:

```ts
export interface ValidacaoValidadeInput {
  validadeDigitada: Date | null
  dataFabricacao?: Date | null          // NOVO
  shelfLifeMinimo: number | null        // dias (já existente)
  shelfLifeTotalDias?: number | null    // NOVO
  percentualVidaUtilMinimo?: number | null // NOVO (RLM %)
  dataAtual: Date
  produtoNome: string
}
```

Fluxo estendido:
1. Se `validadeDigitada` ausente e há `dataFabricacao` + `shelfLifeTotalDias` →
   calcular vencimento via `calcularVencimentoPorFabricacao` e usar como validade
   efetiva (Req 2.2).
2. Se ambos (validade informada e vencimento calculado) existem → sinalizar
   divergência sem impedir (Req 2.3).
3. Rejeitar `dataFabricacao` futura (Req 2.5).
4. Bloqueio "produto vencido" (já existe).
5. Bloqueio `SHELF_LIFE` por dias (já existe).
6. **NOVO** bloqueio `RLM_PERCENTUAL`: se `percentualVidaUtilMinimo` e
   `shelfLifeTotalDias` definidos e `percentualVidaUtilRestante < mínimo` →
   recusar com mensagem (percentual encontrado × exigido) (Req 3.2/3.3).
7. Ambos critérios (dias e %) aplicados juntos quando configurados (Req 3.5).

A rota `conferencia-entrada.routes.ts` passa os novos campos do produto
(`shelfLifeTotalDias`, `percentualVidaUtilMinimoRecebimento`) e a data de
fabricação digitada ao helper. A uniformidade nos três canais é preservada
porque todos passam pelo mesmo helper (padrão já estabelecido).

### 3. Produto e Cliente — campos novos (Req 1, 3, 4, 5)

`produto.routes.ts` (POST e PUT) adicionam ao schema Zod:
`periculosidade` (enum), `shelfLifeTotalDias` (int+, nullable),
`percentualVidaUtilMinimoRecebimento` (0–100, nullable),
`diasQuarentenaVencimento` (int≥0, nullable).

`cliente.routes.ts` (POST e PUT) adiciona `shelfLifeMinimoExpedicaoDias`
(int≥0, nullable).

Todos com filtro explícito por `empresaId` (o produto/cliente já é isolado).

### 4. Put-away por periculosidade (Req 1)

O motor de endereçamento (RF008, já existente) passa a considerar
`produto.periculosidade`: quando PERIGOSO/INFLAMAVEL, filtra os endereços
candidatos para os compatíveis (área segregada / tipo de área compatível),
excluindo endereços comuns. ISENTO/CARGA_GERAL ou nulo → comportamento atual
(Req 1.3/1.4). A compatibilidade reaproveita a infraestrutura de tipo de
área/zona já usada por `ambienteExigido`/`classificacaoArmazenagem`.

### 5. Picking/FEFO por dias mínimos do cliente (Req 4)

Na seleção de lotes por FEFO da separação, ao montar os lotes elegíveis para um
item, o sistema usa `elegivelParaCliente(diasRestantes, cliente.shelfLifeMinimoExpedicaoDias)`
para descartar lotes cujo vencimento está aquém do mínimo do cliente do pedido,
mantendo a ordem FEFO nos elegíveis (Req 4.2). Se nenhum lote é elegível →
bloquear/sinalizar o item, sem escolher lote inválido (Req 4.3). Cliente sem
regra → FEFO atual (Req 4.4). O cliente é o do próprio pedido (Req 4.5).

### 6. Quarentena automática por dias a vencer (Req 5)

Um avaliador aplica `deveEntrarEmQuarentena(diasRestantes, limiar)` sobre os
saldos/lotes com vencimento, onde `limiar = produto.diasQuarentenaVencimento`
com fallback para o parâmetro de empresa (`Parametro` chave
`wms.diasQuarentenaVencimento`). Quando verdadeiro, bloqueia o saldo para
expedição **reutilizando o mecanismo de bloqueio/quarentena existente**,
marcando o motivo "proximidade de vencimento" de forma distinguível do bloqueio
manual (Req 5.3). Lotes em quarentena automática não são selecionáveis na
separação, igual aos bloqueios manuais (Req 5.5). A avaliação roda no ponto de
seleção da expedição e/ou por rotina, sempre filtrando por `empresaId` (Req 5.6).

> Decisão de implementação (a confirmar na fase de tasks): aplicar a avaliação
> **no momento da seleção de lotes do picking** (síncrono, sem job novo) é o
> caminho de menor risco e já cobre Req 5.2/5.5. Um job/rotina de marcação em
> massa pode ser adicionado depois, se desejado.

## Data Models

### Produto (colunas novas, todas nullable)

| Campo | Tipo | Observação |
|---|---|---|
| `periculosidade` | VARCHAR(20) NULL | ISENTO \| CARGA_GERAL \| PERIGOSO \| INFLAMAVEL (texto livre controlado) |
| `shelf_life_total_dias` | INTEGER NULL | prazo do fabricante |
| `percentual_vida_util_minimo_recebimento` | DECIMAL(5,2) NULL | RLM % (0–100) |
| `dias_quarentena_vencimento` | INTEGER NULL | limiar de quarentena automática (por produto) |

### Cliente (coluna nova, nullable)

| Campo | Tipo | Observação |
|---|---|---|
| `shelf_life_minimo_expedicao_dias` | INTEGER NULL | dias mínimos de validade a vencer exigidos pelo cliente |

### Parâmetro de empresa (fallback de quarentena)

`Parametro` (tabela existente) chave `wms.diasQuarentenaVencimento` — fallback
quando o produto não define `dias_quarentena_vencimento`.

### Migration idempotente (migrate-prod.ts)

```ts
await prisma.$executeRawUnsafe(`ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "periculosidade" VARCHAR(20)`)
await prisma.$executeRawUnsafe(`ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "shelf_life_total_dias" INTEGER`)
await prisma.$executeRawUnsafe(`ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "percentual_vida_util_minimo_recebimento" DECIMAL(5,2)`)
await prisma.$executeRawUnsafe(`ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "dias_quarentena_vencimento" INTEGER`)
await prisma.$executeRawUnsafe(`ALTER TABLE "cliente" ADD COLUMN IF NOT EXISTS "shelf_life_minimo_expedicao_dias" INTEGER`)
```

Só ADD COLUMN (aditivo) — sem remoção, sem NOT NULL, sem perda de dado.
`schema.prisma` + `migrate-prod.ts` no mesmo commit; testar `npx tsx
prisma/migrate-prod.ts` 2x local (idempotente).

## Correctness Properties

*Uma propriedade é uma afirmação formal que deve valer para todas as execuções
válidas — ponte entre a especificação legível e a verificação por máquina.*
As propriedades cobrem a **lógica pura** de `shelf-life-avancado.service.ts`.

### Property 1: Vencimento por fabricação é determinístico e aditivo

Para qualquer `dataFabricacao` e `shelfLifeTotalDias >= 0`,
`calcularVencimentoPorFabricacao` retorna sempre a mesma data, igual a
`dataFabricacao + shelfLifeTotalDias` dias; com qualquer entrada nula retorna
`null`.

**Validates: Requirements 2.2, 6.1**

### Property 2: Percentual de vida útil é limitado e monotônico

Para qualquer lote, `percentualVidaUtilRestante` nunca é negativo; vale ~100%
quando resta o shelf life inteiro, 0% quando vence na data de referência, e é
não crescente conforme a data de referência avança.

**Validates: Requirements 6.2**

### Property 3: Recusa de recebimento por percentual é um limiar exato

`recusaPorPercentualRecebimento(p, min)` é `true` se, e somente se, `p` e `min`
são definidos e `p < min`; caso contrário `false` (nunca lança).

**Validates: Requirements 3.2, 3.3, 6.3**

### Property 4: Elegibilidade por cliente é um limiar exato

`elegivelParaCliente(dias, min)` é `true` se, e somente se, `min` não é definido
OU `dias >= min`; entrada nula de `dias` com `min` definido → não elegível.

**Validates: Requirements 4.2, 4.3, 6.4**

### Property 5: Quarentena automática é um limiar exato

`deveEntrarEmQuarentena(dias, limiar)` é `true` se, e somente se, ambos são
definidos e `dias <= limiar`; caso contrário `false`.

**Validates: Requirements 5.2, 6.5**

### Property 6: Neutralidade sob entradas ausentes

Para qualquer combinação em que uma data necessária é nula ou o parâmetro de
configuração está ausente, todas as funções puras retornam resultado neutro
(não recusa, não bloqueia, não elegível-por-omissão conforme definido) sem
lançar exceção.

**Validates: Requirements 6.6**

### Property 7: Combinação de critérios no recebimento

Um lote é recusado no recebimento se, e somente se, está vencido OU falha o
shelf life em dias OU falha o RLM percentual (quando cada critério está
configurado) — nenhum critério configurado sozinho aprova um lote que outro
critério configurado recusaria.

**Validates: Requirements 3.5**

## Error Handling

- **Data de fabricação futura** (Req 2.5): 400/validação com mensagem clara, sem calcular vencimento.
- **Divergência validade × vencimento calculado** (Req 2.3): aviso não bloqueante.
- **Recusa RLM percentual** (Req 3.3): bloqueio de conferência com percentual encontrado × exigido, uniforme nos 3 canais.
- **Nenhum lote elegível para o cliente** (Req 4.3): bloqueio/sinalização do item no picking, sem selecionar lote inválido.
- **Campos novos ausentes**: comportamento anterior preservado (Req 1.2, 2.4, 3.4, 4.4, 5.4).
- **Isolamento**: filtro explícito por `empresaId` em todas as consultas (Req 7.4).

## Testing Strategy

**Dual:** property-based (fast-check, ≥100 iterações) para a lógica pura;
exemplo/integração para conferência, put-away, picking e quarentena.

### Property-based — `shelf-life-avancado.service.test.ts`

- Uma propriedade por Property 1–7; comentário `// Feature:
  atributos-logisticos-shelf-life, Property {n}`.
- Geradores: datas (fabricação/validade/referência, incluindo nulas e futuras),
  shelf life total (0..N), percentuais (0..100, e nulos), dias mínimos/limiar
  (0..N, e nulos). Oráculos aritméticos independentes.

### Integração/exemplo

- **Conferência**: vencimento calculado por fabricação; recusa por RLM %; dois
  critérios juntos; uniformidade nos 3 canais; data de fabricação futura → erro.
- **Put-away**: produto perigoso/inflamável não recebe endereço comum; isento/
  nulo mantém comportamento; isolamento por empresa.
- **Picking/FEFO**: lote fora do mínimo do cliente é pulado; nenhum elegível →
  bloqueio; cliente sem regra → FEFO atual.
- **Quarentena**: lote a ≤ limiar de dias é bloqueado e não é selecionável;
  motivo distinguível de bloqueio manual; sem limiar → sem bloqueio.
- **Migração**: `npx tsx prisma/migrate-prod.ts` 2x local sem erro; colunas
  aditivas; `schema.prisma` + `migrate-prod.ts` no mesmo commit.
- **Build**: `tsc --noEmit` sem novos erros além da baseline (~65–85 back).
