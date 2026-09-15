# Implementation Plan

Central de Documentos Financeiros — Fase D5 (Exportação Contábil)

## Overview

Religar o gerador ECD existente à contabilidade real da D4 (preferir plano de
contas + lançamentos reais; preservar fallback fiscal) e adicionar exportação CSV
(diário, balancete) para software contábil de mercado. Sem alteração de schema.
Reuso do SPEDWriter e da estrutura de blocos existente.

## Tasks

- [x] 1. Núcleo puro `contabil-export.ts` (CSV)
  - [x] 1.1 `diarioParaCsv`, `balanceteParaCsv` (separador ';', decimais BR, cabeçalho)
    - _Requirements: 3.1, 3.2, 3.3_
  - [x]* 1.2 Testes (unit + property): 6 testes
    - **Validates: Requirements 3.2**

- [x] 2. Checkpoint — núcleo puro passa (6 testes)

- [x] 3. Religar ECD à contabilidade real (D4)
  - [x] 3.1 Refatorado `carregarDadosContabeis` (fallback → `carregarDoFiscal`; `usarContabilidadeReal`/`calcularSaldosReais`)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3_
  - [x]* 3.2 +2 testes (contabilidade real: I050/I250) — 33 no total, fallback preservado
    - **Validates: Requirements 1.1, 1.2, 2.2**

- [x] 4. Rotas de exportação CSV
  - [x] 4.1 `GET /api/financeiro/contabil/exportar/diario` e `/exportar/balancete`
    - _Requirements: 3.1, 3.2, 4.1, 4.2, 4.3_

- [x] 5. Checkpoint backend — build + testes (39 verdes, bundle esbuild OK, diagnostics limpos)

- [x] 6. QA E2E `test_50_exportacao.py`
  - [x] 6.1 gerar ECD; exportar CSV balancete/diário (cabeçalho); isolamento; helpers no `wms_api.py`
    - _Requirements: 1.1, 3.2, 4.1_
  - [x] 6.2 Rodado contra produção: 4/4 verde (back c19cc120c, front feb2d5c)

- [x] 7. Documentação + deploy (documento-mestre PROGRAMA COMPLETO + steering QA; back+front pushados; QA 4/4 em produção)

- [ ] 7. Documentação + deploy
  - Atualizar `docs/PROGRAMA-DOCUMENTOS-FINANCEIROS.md` (D5 concluída — PROGRAMA COMPLETO) + steering QA (front); commit + push back e front; QA contra produção.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2"] },
    { "id": 3, "tasks": ["3.1"] },
    { "id": 4, "tasks": ["3.2"] },
    { "id": 5, "tasks": ["4.1"] },
    { "id": 6, "tasks": ["5"] },
    { "id": 7, "tasks": ["6.1"] },
    { "id": 8, "tasks": ["6.2"] },
    { "id": 9, "tasks": ["7"] }
  ]
}
```

## Notes

- Documento-mestre: `docs/PROGRAMA-DOCUMENTOS-FINANCEIROS.md` — D5 fecha o programa.
- Reusar o `sped-ecd.generator` e o `SPEDWriter` existentes; só a ORIGEM dos dados muda.
- Fallback fiscal DEVE ser preservado (não quebrar o teste existente nem empresas sem D4).
- Sem alteração de schema (só leitura da D4). Isolamento multi-tenant.
- Lição D2: validar bundle esbuild antes do push.
```
