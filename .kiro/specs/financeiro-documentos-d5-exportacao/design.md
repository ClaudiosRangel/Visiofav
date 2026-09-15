# Design Document

Central de Documentos Financeiros — Fase D5 (Exportação Contábil)

## Overview

A D5 tem duas frentes:

1. **Religar o gerador ECD à contabilidade real (D4)**: hoje
   `sped-ecd.generator.ts` deriva lançamentos de documentos fiscais e usa um plano
   de contas hardcoded. Passa a **preferir** o plano de contas (`ContaContabil`) e
   os lançamentos (`LancamentoContabil` + `PartidaContabil`) reais quando existem;
   mantém o fallback fiscal quando não existem. Toda a estrutura de blocos (0, I,
   J, 9) e o `SPEDWriter` são reusados sem mudança.

2. **Exportação CSV** (diário, balancete) para software contábil de mercado, via
   um serviço puro de formatação + rota de download.

Sem alteração de schema (só leitura da D4). Isolamento multi-tenant preservado.

## Architecture

```
Tela Fiscal/SPED + Financeiro/Contábil
      │
      ├── POST /api/fiscal/sped/ecd  (rota existente — inalterada)
      │        └── SpedECDGenerator.gerar(params)
      │               └── carregarDadosContabeis()  ← RELIGADO
      │                     ├── se D4 tem contas+lançamentos no período → usa reais
      │                     └── senão → fallback fiscal atual (preservado)
      │
      └── GET /api/financeiro/contabil/exportar/{diario|balancete}.csv
               └── contabil-export.ts (núcleo puro de formatação CSV)
                     └── consome contabil.service (razão/balancete/lançamentos)
```

## Components and Interfaces

### 1. Religação do ECD à D4 (`sped-ecd.generator.ts`)

Refatorar `carregarDadosContabeis()` para:

```typescript
private async carregarDadosContabeis(): Promise<void> {
  // 1) Tenta contabilidade real (D4)
  const contasReais = await prisma.contaContabil.findMany({
    where: { empresaId: this.params.empresaId },
    orderBy: { codigo: 'asc' },
  })
  const lancamentosReais = await prisma.lancamentoContabil.findMany({
    where: { empresaId: this.params.empresaId, status: 'LANCADO',
             data: { gte: this.dataInicio, lte: this.dataFim } },
    include: { partidas: { include: { conta: true } } },
    orderBy: { data: 'asc' },
  })

  if (contasReais.length > 0 && lancamentosReais.length > 0) {
    this.usarContabilidadeReal(contasReais, lancamentosReais)  // NOVO caminho
    return
  }
  // 2) Fallback fiscal (comportamento atual, intacto)
  await this.carregarDoFiscal()   // extrai o corpo atual para este método
}
```

`usarContabilidadeReal`:
- Mapeia `ContaContabil` → `this.planoContas` (código, descrição=nome, natureza
  D/C a partir de `natureza`, tipo S/A a partir de `analitica`, nível derivado da
  contagem de pontos do código, codigoPai por prefixo).
- Mapeia cada `LancamentoContabil`+`PartidaContabil` → `this.lancamentos`. Como o
  modelo interno do gerador usa `conta` + `contaContrapartida` (par), enquanto a
  D4 tem N partidas, adapta-se: para um lançamento de 2 partidas (débito+crédito,
  o caso da geração automática), preenche `conta`=débito, `contaContrapartida`=
  crédito. Para lançamentos com >2 partidas (manuais complexos), emite uma linha
  interna por partida, com contrapartida vazia (o I250 registra cada partida
  isoladamente com seu IND_DC — que é o formato correto do SPED de todo modo).
- Recalcula saldos a partir das partidas reais (`calcularSaldos` adaptado).

O bloco I250 já grava por partida (conta + valor + IND_DC), então a estrutura do
writer não muda; só a origem dos dados muda.

### 2. Núcleo puro de exportação CSV (`contabil-export.ts`)

```typescript
export interface LinhaDiario {
  data: string; historico: string; conta: string; tipo: 'DEBITO'|'CREDITO'; valor: number
}
export interface LinhaBalancete {
  codigo: string; nome: string; debito: number; credito: number; saldo: number
}

// Monta CSV (separador ';', cabeçalho em pt-BR, decimais com vírgula).
export function diarioParaCsv(linhas: LinhaDiario[]): string
export function balanceteParaCsv(linhas: LinhaBalancete[]): string
```

Puro, testável. Formatação BR (vírgula decimal), separador `;` (compatível com
Excel pt-BR e importadores contábeis).

### 3. Rotas de exportação CSV (sub-rota de `/api/financeiro/contabil`)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/contabil/exportar/diario` | CSV do diário (partidas) do período. |
| GET | `/contabil/exportar/balancete` | CSV do balancete do período. |

Reusa `contabil.service.listarLancamentos` e `contabil.service.balancete`.
Retorna `text/csv` com `Content-Disposition: attachment`. Isolado por empresa.

## Data Models

Nenhuma alteração de schema. A D5 só lê `ContaContabil`, `LancamentoContabil`,
`PartidaContabil` (D4), `DocumentoFiscal` (fallback) e `Empresa`.

## Error Handling

- Empresa sem dados no período → ECD gera com blocos vazios sinalizados (I001/J001
  com indicador "sem dados"); CSV só com cabeçalho. Sem erro.
- Período inválido → 400 (validação existente da rota SPED).
- Falha de leitura → 500 tratado pela rota (padrão existente).

## Testing Strategy

- **Unit** (`contabil-export.test.ts`): diário e balancete → CSV correto
  (cabeçalho, separador, decimais BR, linhas); balancete vazio só cabeçalho.
- **Regressão** (`sped-ecd.generator.test.ts` existente): continua verde com a
  refatoração (fallback fiscal preservado — mocks atuais retornam contas/lançamentos
  vazios, então cai no fallback).
- **Novo teste** de contabilidade real no gerador ECD: mock com contas+lançamentos
  D4 → I050 usa códigos reais, I250 registra partidas reais.
- **QA E2E** (`test_50_exportacao.py`): gerar ECD (200 + nomeArquivo) e exportar
  CSV de balancete (200, começa com cabeçalho), isolamento.
- Checkpoint: `vitest run` dos testes tocados + diagnostics + bundle esbuild do
  server (lição D2).

## Correctness Properties

### Property 1: Preferência pela contabilidade real
Quando existem contas e lançamentos D4 no período, o gerador usa os códigos de
conta reais no I050 (não o plano hardcoded).
**Validates: Requirements 1.1, 1.2**

### Property 2: Fallback preservado
Quando não há contabilidade real no período, a saída do gerador é equivalente ao
comportamento anterior (fallback fiscal), mantendo os testes existentes verdes.
**Validates: Requirements 1.4, 2.2**

### Property 3: Lotes diários equilibrados com dados reais
Ao usar lançamentos reais da D4 (que são partidas dobradas), a soma dos débitos de
cada lote diário I200 iguala a soma dos créditos.
**Validates: Requirements 1.3, 2.3**

### Property 4: Balancete CSV fecha
O CSV de balancete tem total de débitos igual ao total de créditos (tolerância
R$ 0,01), pois deriva de lançamentos balanceados.
**Validates: Requirements 3.2**
