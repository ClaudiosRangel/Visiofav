# Implementation Plan

## Overview

Plano do Relatório Mensal de Produção + menu Gerencial + pré-requisitos (popular
custo/velocidade, meta por processo, códigos de parada). Backend
(`VisioFab.Wms.Back`) e frontend (`VisioFab.Wms.Front`) são repos separados;
schema + migrate-prod.ts no mesmo commit; valorização somente por custo. Cada
tarefa referencia os requisitos. Testes `--reporter=dot`.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2", "3"] },
    { "wave": 3, "tasks": ["4", "5"] },
    { "wave": 4, "tasks": ["6"] },
    { "wave": 5, "tasks": ["7"] },
    { "wave": 6, "tasks": ["8"] },
    { "wave": 7, "tasks": ["9", "10"] },
    { "wave": 8, "tasks": ["11"] }
  ],
  "dependencies": {
    "2": ["1"],
    "3": ["1"],
    "4": ["2", "3"],
    "5": ["1"],
    "6": ["4", "5"],
    "7": ["6"],
    "8": ["7"],
    "9": ["8"],
    "10": ["8"],
    "11": ["9", "10"]
  }
}
```

## Tasks

- [ ] 1. Schema + migração (MetaProducaoProcesso, CodigoParada, ApontamentoEtapa.codigoParadaId)
  - Adicionar os 2 models + a coluna nullable ao `schema.prisma`.
  - `migrate-prod.ts` idempotente (CREATE TABLE/COLUMN/INDEX IF NOT EXISTS); FK em try/catch.
  - `npx prisma generate`.
  - _Requirements: 3.1, 4.1, 4.2_

- [ ] 2. Script popular custo-hora/velocidade (dry-run + apply)
  - `scripts/popular-custo-velocidade-centros.ts`: lê exports, de-para por nome
    normalizado, dry-run imprime proposta, apply grava só onde nulo/0, ambíguo fica fora.
  - Teste puro da normalização/match.
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [ ] 3. Motor puro de valorização por velocidade
  - `horasPorVelocidade(producao, velocidade)` + reuso de `valorizar` (custo).
  - Testes vitest + fast-check (Property 3).
  - _Requirements: 6.1, 6.2, 6.3_

- [ ] 4. CRUDs backend: metas por processo + códigos de parada
  - Rotas CRUD `/gerencial/metas-processo` e `/gerencial/codigos-parada`, Zod + isolamento empresaId.
  - _Requirements: 3.1, 4.1, 4.4, 8.1, 8.2_

- [ ] 5. Service de agregação gerencial
  - [ ] 5.1 resumoPorProcesso + metaProcessoSerieDiaria (base de contagem por processo, valor custo, meta/%).
    - _Requirements: 5.1, 5.4, 3.2, 6.1, 7.2_
  - [ ] 5.2 serieDiariaConsolidada (pico/2º/3º/média/menor) + dadosDiariosPorCentro.
    - _Requirements: 5.2, 5.5_
  - [ ] 5.3 produtividadePorCentroEOperador (% variação) + opsEmitidasPorMes + paretoParadas + trabalhosEmMaquina.
    - _Requirements: 5.3, 5.6, 5.7, 5.8, 4.3_

- [ ] 6. Testes do service (mocks Prisma)
  - Properties 4, 5, 6, 7 + isolamento.
  - _Requirements: 3.2, 4.3, 5.1, 5.2, 8.1_

- [ ] 7. Rotas backend do relatório + registro no server
  - `relatorio-producao.routes.ts` (GET producao-mensal, ops-emitidas, pareto-paradas), registrado em server.ts (/api/pcp, authenticate + PCP).
  - _Requirements: 5.*, 8.2_

- [ ] 8. PDF do relatório mensal (pdfkit)
  - `relatorio-producao-pdf.service.ts` + rota `.pdf`; mesma agregação da tela.
  - _Requirements: 7.1, 7.2_

- [ ] 9. Commit + push backend
  - Stage explícito; migração idempotente testada; push main.
  - _Requirements: 1.2_

- [ ] 10. Frontend: menu Gerencial + telas
  - [ ] 10.1 ModuleSidebar: grupo "Gerencial" (Mapa Custos RKW, Análise Gerencial RKW, Relatório Mensal).
    - _Requirements: 2.1, 2.2_
  - [ ] 10.2 Tela Relatório Mensal (abas: Resumo/Diário/Máquina-Operador/Metas/Dados por Centro/OPs/Pareto) + PDF.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 7.1_
  - [ ] 10.3 Cadastro de Códigos de Parada + Metas por Processo.
    - _Requirements: 4.1, 3.1_

- [ ] 11. Build front + commit/push + rodar população (apply) + steering
  - `npm run build`; push main; rodar o script apply em produção (após dry-run aprovado); atualizar steering pcp-modulo.
  - _Requirements: 1.2, 2.1_

## Notes

- Rodar o script de população em `--dry-run` e apresentar o de-para ANTES do apply.
- Postgres local pode estar off; idempotência por IF NOT EXISTS.
- Repos separados; confirmar push por `xxx..yyy main -> main` (exit 1 esperado no PowerShell).
- Valorização somente por CUSTO (sem preço de venda).
- Guilhotina das planilhas = centro dentro de Acabamento/Cortadeira (não é tipo de processo próprio).
