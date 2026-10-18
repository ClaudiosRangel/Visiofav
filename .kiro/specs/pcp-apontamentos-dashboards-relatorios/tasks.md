# Implementation Plan

## Overview

Plano de implementação da reformulação do menu Apontamentos (PCP) em módulo de BI
com metas, valorização em R$, dashboards, produtividade, histórico e PDFs.
Backend (`VisioFab.Wms.Back`) e frontend (`VisioFab.Wms.Front`) são repos
separados. Schema + migrate-prod.ts sempre no mesmo commit. Cada tarefa referencia
os requisitos que satisfaz. A parte 1 da demanda (filtro de centros ativos+
disponíveis no quadro/indicadores) já foi entregue fora desta spec.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2", "4"] },
    { "wave": 3, "tasks": ["3", "5", "6"] },
    { "wave": 4, "tasks": ["7"] },
    { "wave": 5, "tasks": ["8"] },
    { "wave": 6, "tasks": ["9"] },
    { "wave": 7, "tasks": ["10"] },
    { "wave": 8, "tasks": ["11"] }
  ],
  "dependencies": {
    "2": ["1"],
    "3": ["2"],
    "4": ["1"],
    "5": ["4"],
    "6": ["4"],
    "7": ["4", "6"],
    "8": ["7"],
    "9": ["8"],
    "10": ["9"],
    "11": ["10"]
  }
}
```

## Tasks

- [ ] 1. Schema + migração do model `MetaProducaoCentro`
  - Adicionar `model MetaProducaoCentro` ao `prisma/schema.prisma`.
  - Adicionar `CREATE TABLE IF NOT EXISTS meta_producao_centro` + índice ao
    `prisma/migrate-prod.ts` (idempotente); rodar 2× local se Postgres disponível.
  - `npx prisma generate`.
  - _Requirements: 1.2_

- [ ] 2. Motor puro de valorização e metas (`apontamentos-valorizacao.service.ts`)
  - Função pura `valorizar({ tempoProdutivoHoras, custoHora, valorUnitario?,
    quantidade })` → valorRs determinístico, não-negativo, null-safe.
  - Função pura `percentualAtingido(realizado, meta)` → null se meta ausente/0.
  - Função pura `mesCivilBrasilia(date)` → chave de mês no fuso -3h.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 1.5, 3.2, 4.4_

- [ ] 3. Testes do motor puro (golden + property-based)
  - `apontamentos-valorizacao.service.test.ts` (vitest + fast-check), cobrindo
    Properties 1, 2, 4, 6. Reporter `--reporter=dot`.
  - _Requirements: 2.1, 2.2, 2.3, 1.5, 3.2, 4.4_

- [ ] 4. Service de agregação (`apontamentos-bi.service.ts`)
  - [ ] 4.1 `agregarDashboard(empresaId, filtro)` — findMany com filtro de empresa
    da OP real + centro ativo/disponível; agrupa por centro e por dia; aplica
    valorização e cruza metas vigentes.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 9.1, 9.2_
  - [ ] 4.2 `agregarProdutividade(empresaId, filtro, por)` — mês civil × operador|
    máquina; "Sem operador" quando `funcionarioId` nulo.
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [ ] 4.3 `listarHistorico(empresaId, filtro, page)` — paginado, filtros
    combinados, ordenado por dataHora desc.
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [ ] 5. Testes do service de agregação (mocks Prisma)
  - `apontamentos-bi.service.test.ts` cobrindo Properties 3, 5, 7 (isolamento,
    exclusão de centros fora de programação, coincidência de totais).
  - _Requirements: 9.1, 9.2, 3.1, 4.1, 5.4, 6.4, 6.5, 8.4_

- [ ] 6. Service de PDF (`apontamentos-bi-pdf.service.ts`, pdfkit)
  - [ ] 6.1 Relatório de Produção Diária por período (seção por dia; máquina/
    operador/produção/observação; exibe motivo quando parada).
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [ ] 6.2 PDF de dashboard/produtividade (reflete filtros aplicados).
    - _Requirements: 7.1, 7.2_

- [ ] 7. Rotas backend (`apontamentos-bi.routes.ts`) + registro no server
  - [ ] 7.1 CRUD de metas (GET/POST/PUT/DELETE) com validação Zod e isolamento.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 9.1, 9.3_
  - [ ] 7.2 GET dashboard, produtividade, historico (schema Zod das queries).
    - _Requirements: 3.*, 4.*, 5.*, 9.3_
  - [ ] 7.3 GET relatorio-diario.pdf e dashboard.pdf (token via query param).
    - _Requirements: 6.1, 7.1_
  - [ ] 7.4 Registrar o módulo em `server.ts` com prefixo `/api/pcp`,
    `authenticate` + `moduloGuard('PCP')`.
    - _Requirements: 9.3_

- [ ] 8. Commit + push backend (schema + migrate + módulo juntos)
  - Stage explícito dos arquivos da tarefa; validar `get_diagnostics`; push `main`.
  - _Requirements: 1.2_

- [ ] 9. Frontend — reformular `pcp/apontamentos/page.tsx`
  - [ ] 9.1 Estrutura de abas (Dashboard | Produtividade | Histórico | Relatórios
    | Metas) + seletor de período e filtros; seletor de centros ativos+disponíveis.
    - _Requirements: 8.1, 8.3, 8.4_
  - [ ] 9.2 Aba Dashboard: cards + gráficos de barra por dia (produzido/perda/
    valor R$ + linha de meta).
    - _Requirements: 3.1, 3.2, 3.5_
  - [ ] 9.3 Aba Produtividade: tabelas + gráficos mês × operador/máquina.
    - _Requirements: 4.1, 4.2_
  - [ ] 9.4 Aba Histórico: tabela paginada com filtros combinados.
    - _Requirements: 5.1, 5.2, 5.3_
  - [ ] 9.5 Aba Relatórios: botões de impressão em PDF por período.
    - _Requirements: 6.1, 7.1_
  - [ ] 9.6 Aba Metas: CRUD de meta por centro.
    - _Requirements: 1.1_
  - [ ] 9.7 Garantir que a tela não usa mais `GET /apontamentos-producao`.
    - _Requirements: 8.2_

- [ ] 10. Build do frontend + commit + push
  - `npm run build` (Next) passa; stage explícito; push `main`.
  - _Requirements: 8.1_

- [ ] 11. Atualizar steering `pcp-modulo.md` (seção 13 → concluída)
  - Registrar módulo entregue, rotas e model novo; marcar a pendência como feita.
  - _Requirements: (documentação)_

## Notes

- Validar na base restaurada local antes de gerar qualquer coisa para o servidor
  (instrução do usuário). Esta spec NÃO toca o agente Calcgraf.
- Postgres local pode estar indisponível; nesse caso a idempotência da migração é
  garantida por `IF NOT EXISTS` e validada por revisão.
- Repos separados: commitar back e front em commits/pushes independentes na `main`.
- Confirmar `git push` pela linha `xxx..yyy main -> main` (exit 1 no PowerShell é
  esperado por causa do stderr).
- Testes vitest com `--reporter=dot`.
