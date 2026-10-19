# Design Document

## Overview

Relatório Mensal de Produção dentro de um novo menu "Gerencial" do PCP, mais os
pré-requisitos de dados (custo-hora/velocidade dos centros, meta por processo,
códigos de parada). Reaproveita a agregação já criada em
`src/modules/pcp/apontamentos-bi/` como base, estendendo com visões gerenciais
(por processo, série diária, Pareto, OPs emitidas, trabalhos em máquina).
Backend Fastify+Prisma; frontend Next.js/Mantine. Valorização somente por custo.

Princípios: aditivo (não remove o módulo Apontamentos BI nem o enum
`motivoParada`); fonte única de agregação; motor de valorização puro; isolamento
`empresaId` explícito; migrate-prod.ts junto do schema.

## Architecture

```
Frontend (Next.js/Mantine)
  Menu "Gerencial" (ModuleSidebar) agrupa:
    - Mapa de Custos (RKW)        [existente, reposicionado]
    - Análise Gerencial (RKW)     [existente, reposicionado]
    - Relatório Mensal de Produção  pcp/gerencial/producao-mensal/page.tsx [novo]
  Cadastros:
    - Metas por Processo (dentro do relatório ou aba de Metas existente)
    - Códigos de Parada  pcp/cadastros/codigos-parada/page.tsx [novo]
        │ axios @/lib/api
        ▼
Backend (Fastify)  src/modules/pcp/gerencial/
  relatorio-producao.routes.ts   (prefixo /api/pcp, authenticate + PCP)
    ├─ GET /gerencial/producao-mensal           (visões consolidadas do mês)
    ├─ GET /gerencial/producao-mensal.pdf       (PDF do relatório)
    ├─ GET /gerencial/ops-emitidas              (comparativo anual)
    ├─ GET /gerencial/pareto-paradas            (Req 4/5.7)
    ├─ CRUD /gerencial/metas-processo           (Req 3)
    └─ CRUD /gerencial/codigos-parada           (Req 4)
    │
    ├─ relatorio-producao.service.ts   (agregação por processo/dia/centro)
    └─ relatorio-producao-pdf.service.ts (pdfkit)

Reutiliza:
  apontamentos-bi.service.ts (agregarDashboard/produtividade)
  apontamentos-valorizacao.service.ts (valorizar por custo)

Prisma (novos): MetaProducaoProcesso, CodigoParada,
  ApontamentoEtapa.codigoParadaId (nullable, aditivo)
  + migrate-prod.ts idempotente

Script: scripts/importar-calcgraf.ts --fase centros-custo-velocidade
  (dry-run/apply; lê cartoon/export; de-para por nome normalizado)
```

## Components and Interfaces

### Script de população (Req 1)

`scripts/popular-custo-velocidade-centros.ts` (ou fase no importador):
- Lê `CentroCustoHora.json`, `CentrosProducao.json`,
  `CentrosProducaoxTiragensProdHora.json`.
- Normaliza nome (sem acento, lowercase, remove pontuação) para de-para
  Vizor↔Calcgraf.
- `--dry-run` (default): imprime tabela do de-para proposto.
- `--apply`: grava custoHora/velocidade só onde Vizor está nulo/0; centros
  ambíguos ou sem match ficam de fora e são listados.

### Backend — service de agregação (`relatorio-producao.service.ts`)

- `resumoPorProcesso(empresaId, mes)` — soma produção por `TipoProcesso`
  (base de contagem por processo), valor R$ por custo, meta do processo e %.
- `serieDiariaConsolidada(empresaId, mes)` — produção por dia do mês + pico,
  2º/3º maiores, média, menor dia.
- `produtividadePorCentroEOperador(empresaId, meses)` — reaproveita
  `agregarProdutividade`, com % de variação mês a mês.
- `metaProcessoSerieDiaria(empresaId, mes, tipoProcessoId)` — série diária do
  processo + linha de meta + média diária.
- `dadosDiariosPorCentro(empresaId, mes, tipoProcessoId)` — matriz data×centro.
- `opsEmitidasPorMes(empresaId, anos)` — contagem de `OrdemProducao` por mês/ano.
- `paretoParadas(empresaId, mes)` — agrupa `ApontamentoEtapa` tipo PARADA por
  `codigoParadaId` (fallback `motivoParada`).
- `trabalhosEmMaquina(empresaId, dia, centroId)` — OPs/clientes apontados no dia.

### Backend — motor puro

Reutiliza `apontamentos-valorizacao.service.ts`. Adiciona
`horasPorVelocidade(producao, velocidade)` puro (produção ÷ velocidade).

### Frontend

- `pcp/gerencial/producao-mensal/page.tsx` — seletor mês/ano + abas das visões
  (Resumo, Diário, Máquina/Operador, Metas, Dados por Centro, OPs, Pareto) +
  botão PDF. Gráficos com a lib de charts já usada no projeto (recharts/mantine).
- `pcp/cadastros/codigos-parada/page.tsx` — CRUD de códigos de parada.
- Cadastro de meta por processo: aba no relatório ou em Apontamentos > Metas.
- `ModuleSidebar.tsx` — novo grupo "Gerencial".

## Data Models

### `MetaProducaoProcesso` (novo)

```prisma
model MetaProducaoProcesso {
  id                String    @id @default(uuid())
  empresaId         String    @map("empresa_id")
  tipoProcessoId    String    @map("tipo_processo_id")
  metaQuantidadeDia Decimal   @map("meta_quantidade_dia") @db.Decimal(14, 2)
  metaValorDia      Decimal?  @map("meta_valor_dia") @db.Decimal(14, 2)
  vigenciaInicio    DateTime  @map("vigencia_inicio")
  vigenciaFim       DateTime? @map("vigencia_fim")
  criadoEm          DateTime  @default(now()) @map("criado_em")
  atualizadoEm      DateTime  @updatedAt @map("atualizado_em")
  @@index([empresaId, tipoProcessoId])
  @@map("meta_producao_processo")
}
```

### `CodigoParada` (novo)

```prisma
model CodigoParada {
  id          String   @id @default(uuid())
  empresaId   String   @map("empresa_id")
  codigo      String   @db.VarChar(20)
  descricao   String   @db.VarChar(200)
  status      Boolean  @default(true)
  criadoEm    DateTime @default(now()) @map("criado_em")
  @@unique([empresaId, codigo])
  @@map("codigo_parada")
}
```

### `ApontamentoEtapa` (aditivo)

`codigoParadaId String? @map("codigo_parada_id")` — nullable; enum `motivoParada`
mantido por compatibilidade.

Todos refletidos em `migrate-prod.ts` (CREATE TABLE/COLUMN IF NOT EXISTS).

## Correctness Properties

### Property 1: População não sobrescreve valor manual

Para qualquer centro com `custoHora > 0` ou `velocidade > 0` já definido, o
apply NÃO altera o valor existente.

**Validates: Requirements 1.2**

### Property 2: De-para ambíguo não adivinha

Se dois centros Calcgraf normalizam para o mesmo nome de um centro Vizor (ou
nenhum casa), o centro fica de fora do apply e é listado.

**Validates: Requirements 1.3**

### Property 3: Valorização por custo determinística e não-negativa

`custoHora × (produção ÷ velocidade)` ≥ 0, idempotente; velocidade 0/nula →
fallback tempo apontado; sem base → 0.

**Validates: Requirements 6.1, 6.2, 6.3**

### Property 4: Meta de processo = soma dos centros do processo

O realizado comparado à meta de um processo é exatamente a soma da produção dos
centros ATIVOS daquele `TipoProcesso` no período.

**Validates: Requirements 3.2, 5.1**

### Property 5: Pareto ordenado e isolado

O Pareto agrupa paradas por código, ordena por ocorrência decrescente, e só
inclui apontamentos da empresa.

**Validates: Requirements 4.3, 8.1**

### Property 6: Série diária estável no fuso -3h

A atribuição de cada apontamento ao dia civil usa America/Sao_Paulo, estável e
idempotente; pico/média derivam da mesma série.

**Validates: Requirements 5.2**

### Property 7: Base de contagem por processo

COLAGEM agrega em UNIDADE; demais em TIRAGEM — a soma por processo nunca mistura
bases diferentes.

**Validates: Requirements 5.1**

## Error Handling

- Mês/ano inválido → 400.
- Meta com quantidade <= 0 → 400.
- Código de parada duplicado (empresa+codigo) → 409.
- Centro sem custo/velocidade → valor 0 (sem erro).
- Falha de PDF → 500 logado, sem corromper estado (read-only).
- Script apply em centro ambíguo → pula e reporta (nunca grava errado).

## Testing Strategy

- Motor puro (valorização + horasPorVelocidade): vitest + fast-check
  (Properties 1-indiretas, 3, 6).
- Service de agregação: mocks Prisma (Properties 4, 5, 7, isolamento).
- Script de de-para: teste da função pura de normalização/match (Properties 1, 2).
- Migração: `npx tsx prisma/migrate-prod.ts` 2× local quando Postgres disponível;
  senão idempotência por IF NOT EXISTS.
- Reporter vitest `--reporter=dot`.
