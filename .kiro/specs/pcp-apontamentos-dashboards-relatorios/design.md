# Design Document

## Overview

Reformulação do menu **Apontamentos** do PCP num módulo de BI operacional sobre
`ApontamentoEtapa` (fonte real), com metas por centro, valorização em R$,
dashboards por período, produtividade por operador/máquina, histórico detalhado
e relatórios imprimíveis em PDF. Backend em Fastify + Prisma (repo
`VisioFab.Wms.Back`), frontend em Next.js/Mantine (repo `VisioFab.Wms.Front`).

Princípios de design:
- **Fonte única de agregação**: um service de agregação alimenta dashboard,
  produtividade, histórico e PDFs — tela e impressão nunca divergem.
- **Motor de cálculo puro**: metas, percentual atingido e valorização em R$ são
  funções puras (sem Prisma), testadas com golden + property-based.
- **Aditivo e não-regressivo**: a tabela antiga `ApontamentoProducao` e a rota
  `GET /apontamentos-producao` permanecem; a nova tela deixa de usá-las, mas nada
  é removido do backend existente.
- **Isolamento explícito por `empresaId`** da OP real (nunca só `prismaScoped`).

## Architecture

```
Frontend (Next.js/Mantine)  pcp/apontamentos/page.tsx
  Abas: Dashboard | Produtividade | Histórico | Relatórios | Metas
        │  (axios @/lib/api, período + filtros)
        ▼
Backend (Fastify)  src/modules/pcp/apontamentos-bi/
  apontamentos-bi.routes.ts        (prefixo /api/pcp, authenticate + moduloGuard PCP)
    ├─ GET  /apontamentos-bi/dashboard        (Req 3)
    ├─ GET  /apontamentos-bi/produtividade    (Req 4)
    ├─ GET  /apontamentos-bi/historico        (Req 5, paginado)
    ├─ GET  /apontamentos-bi/relatorio-diario.pdf   (Req 6)
    ├─ GET  /apontamentos-bi/dashboard.pdf          (Req 7)
    ├─ CRUD /apontamentos-bi/metas            (Req 1)
    │
    ├─ apontamentos-bi.service.ts   (agregação Prisma — fonte única)
    ├─ apontamentos-valorizacao.service.ts  (PURO — Req 2, testável)
    └─ apontamentos-bi-pdf.service.ts        (pdfkit — Req 6/7)

Prisma:  model MetaProducaoCentro (novo)   + migrate-prod.ts (idempotente)
Fonte de dados: ApontamentoEtapa → etapaOrdemProducao → ordemProducao, centroProducao
```

## Components and Interfaces

### Backend — rotas (`apontamentos-bi.routes.ts`, prefixo `/api/pcp`)

- `GET /apontamentos-bi/dashboard?dataInicio&dataFim&centroId?&operadorId?&tipoProcessoId?`
  → totais por centro (produzido, perda, retrabalho, paradaMin, valorRs, meta,
  percentualAtingido) + série diária por centro.
- `GET /apontamentos-bi/produtividade?dataInicio&dataFim&por=operador|maquina`
  → matriz mês × (operador|máquina) com quantidade e média.
- `GET /apontamentos-bi/historico?dataInicio&dataFim&centroId?&operadorId?&tipo?&opId?&page&pageSize`
  → lista paginada de apontamentos detalhados.
- `GET /apontamentos-bi/relatorio-diario.pdf?dataInicio&dataFim` → PDF (pdfkit).
- `GET /apontamentos-bi/dashboard.pdf?...` → PDF da visão de dashboard/produtividade.
- `GET /apontamentos-bi/metas` · `POST /apontamentos-bi/metas` ·
  `PUT /apontamentos-bi/metas/:id` · `DELETE /apontamentos-bi/metas/:id`.

Todas: `authenticate` + `moduloGuard('PCP')`, filtro `empresaId` explícito.

### Backend — service de agregação (`apontamentos-bi.service.ts`)

- `agregarDashboard(empresaId, filtro)` — busca `apontamentoEtapa.findMany` do
  período com `etapaOrdemProducao: { ordemProducao: { empresaId }, centroProducao:
  { status: true, disponivelProgramacao: true } }`, inclui centro (tipoProcesso,
  custoHora) e OP; agrupa por centro e por dia; aplica valorização (service puro)
  e cruza com metas vigentes.
- `agregarProdutividade(empresaId, filtro, por)` — agrupa por mês civil
  (America/Sao_Paulo) e por operador|centro.
- `listarHistorico(empresaId, filtro, page)` — paginação + filtros combinados.

### Backend — motor puro (`apontamentos-valorizacao.service.ts`)

Sem Prisma. Entradas já materializadas (números), saídas determinísticas.

### Frontend (`pcp/apontamentos/page.tsx`)

Tabs Mantine: Dashboard (cards + gráficos de barra por dia), Produtividade
(tabelas + gráficos mês×operador/máquina), Histórico (tabela paginada com
filtros), Relatórios (botões de PDF por período), Metas (CRUD por centro).
Seletor de centros consome centros ativos+disponíveis. Botões de impressão
abrem os endpoints `.pdf` em nova aba (token via query, padrão já usado no PCP).

## Data Models

### Novo model `MetaProducaoCentro` (Prisma + migrate-prod.ts no mesmo commit)

```prisma
model MetaProducaoCentro {
  id               String    @id @default(uuid())
  empresaId        String    @map("empresa_id")
  centroProducaoId String    @map("centro_producao_id")
  metaQuantidadeDia Decimal  @map("meta_quantidade_dia") @db.Decimal(14, 2)
  metaValorDia     Decimal?  @map("meta_valor_dia") @db.Decimal(14, 2)
  vigenciaInicio   DateTime  @map("vigencia_inicio")
  vigenciaFim      DateTime? @map("vigencia_fim")
  criadoEm         DateTime  @default(now()) @map("criado_em")
  atualizadoEm     DateTime  @updatedAt @map("atualizado_em")

  @@index([empresaId, centroProducaoId])
  @@map("meta_producao_centro")
}
```

`migrate-prod.ts`: `CREATE TABLE IF NOT EXISTS meta_producao_centro (...)` +
`CREATE INDEX IF NOT EXISTS`. Idempotente, testar 2× local.

### DTOs de resposta (agregação)

- `DashboardCentroDTO`: `{ centroId, centroDescricao, tipoProcessoCodigo, base,
  produzido, perda, retrabalho, paradaMinutos, valorRs, metaQuantidade?,
  metaValorRs?, percentualAtingido?, serieDiaria: { data, produzido, valorRs }[] }`.
- `ProdutividadeDTO`: `{ chave (operador|máquina), nome, meses: { mes, quantidade,
  media }[] }`.
- `HistoricoItemDTO`: `{ id, dataHora, centroDescricao, operadorNome, opNumero,
  tipo, quantidade, motivo?, observacao? }`.

## Correctness Properties

### Property 1: Valorização determinística e não-negativa

Para qualquer tempo produtivo ≥ 0 e custoHora ≥ 0, `valorRs = tempoHoras ×
custoHora` é ≥ 0 e idêntico em chamadas repetidas (função pura).

**Validates: Requirements 2.1, 2.3**

### Property 2: Valorização ausente nunca quebra

Se `custoHora` e valor unitário são ambos ausentes/null, `valorRs = 0` (ou null)
e a agregação continua retornando a quantidade.

**Validates: Requirements 2.2**

### Property 3: Fonte única — dashboard e PDF coincidem

Para o mesmo período e filtros, os totais por centro usados no PDF são
exatamente os retornados por `agregarDashboard` (mesma função).

**Validates: Requirements 6.5, 7.2**

### Property 4: Percentual atingido coerente com meta

Se há meta > 0, `percentualAtingido = realizado / meta × 100`; se meta ausente
ou 0, `percentualAtingido` é null (nunca divisão por zero).

**Validates: Requirements 1.5, 3.2**

### Property 5: Isolamento multi-tenant

Nenhum apontamento ou meta de outra empresa aparece no resultado, mesmo para
SUPER_ADMIN, pois o filtro `empresaId` da OP real é sempre aplicado.

**Validates: Requirements 9.1, 9.2**

### Property 6: Agrupamento mensal estável no fuso -3h

Um apontamento com `dataHora` próximo da meia-noite UTC é atribuído ao mês civil
de America/Sao_Paulo, de forma estável e idempotente.

**Validates: Requirements 4.4**

### Property 7: Centros fora de programação nunca aparecem

Para qualquer conjunto de apontamentos, centros com `status = false` OU
`disponivelProgramacao = false` são excluídos de toda agregação/listagem/PDF.

**Validates: Requirements 3.1, 4.1, 5.4, 6.4, 8.4**

## Error Handling

- Período inválido (dataFim < dataInicio) → 400 com mensagem clara.
- Meta com `metaQuantidadeDia <= 0` → 400.
- `empresaId` ausente no contexto → 400 (guard), nunca consulta sem escopo.
- Falha ao gerar PDF → 500 com log; não corrompe estado (geração é read-only).
- Centro sem `custoHora` → valor R$ = 0, sem erro (Req 2.2).

## Testing Strategy

- **Motor puro** (`apontamentos-valorizacao.service.test.ts`): vitest + fast-check
  cobrindo Properties 1, 2, 4, 6 (golden + property-based).
- **Agregação** (`apontamentos-bi.service.test.ts`): mocks de Prisma validando
  Properties 3, 5, 7 (isolamento, exclusão de centros, coincidência de totais).
- **Rotas**: smoke de contrato (schema Zod das queries, status/guards).
- **Migração**: `npx tsx prisma/migrate-prod.ts` 2× local (idempotência) quando
  o Postgres local estiver disponível; senão, validação por `IF NOT EXISTS`.
- Reporter: `--reporter=dot` (o `basic` foi removido nesta versão do vitest).
