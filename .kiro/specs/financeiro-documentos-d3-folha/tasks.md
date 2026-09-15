# Implementation Plan

Central de Documentos Financeiros — Fase D3 (Folha de Pagamento)

## Overview

Folha = lançamento do resultado (líquido por funcionário + encargos) em contas a
pagar. Núcleo puro de parsing/cálculo testável; efetivação atômica e idempotente
reusando `incluirTitulo` (D1). Funcionário enriquecido sem quebrar WMS. Migração
idempotente no mesmo commit. Confirmação humana na efetivação (tela e IA).

## Tasks

- [x] 1. Núcleo puro `folha-parser.ts`
  - [x] 1.1 `calcularLiquido`, `calcularTotaisFolha`, `parsearCsvFolha` (cabeçalho flexível cpf/matricula/proventos/descontos/liquido, detecção de divergência)
    - _Requirements: 2.2, 2.5, 3.1, 3.3_
  - [x]* 1.2 Testes (unit + property): Property 1 (líquido ≥ 0), Property 2 (totais), Property 6 (divergência), CSV malformado — 12 testes
    - **Validates: Requirements 2.2, 2.5, 3.3**

- [x] 2. Checkpoint — núcleo puro passa (12 testes)

- [x] 3. Schema + migração idempotente
  - [x] 3.1 Models `FolhaPagamento`, `ItemFolha`, `EncargoFolha` + enriquecimento de `Funcionario` (cpf, cargo, dataAdmissao, salarioBase, dados bancários) no `schema.prisma`
    - _Requirements: 1.1, 2.1, 2.3_
  - [x] 3.2 `migrate-prod.ts`: CREATE TABLE IF NOT EXISTS (3 tabelas) + ADD COLUMN IF NOT EXISTS (funcionário) + índice único parcial CPF por empresa (WHERE cpf IS NOT NULL); testado 2x local
    - _Requirements: 1.3, 5.3_

- [x] 4. `folha.service.ts` (CRUD + totais + importar CSV)
  - [x] 4.1 criar/listar/obter folha (isolado por empresa, competência única ABERTA); add/editar/remover item e encargo (só ABERTA); recalcular totais
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 5.1_
  - [x] 4.2 `importarCsv`: resolve funcionário por CPF/matrícula, cria itens resolvidos, retorna pendentes sem abortar
    - _Requirements: 3.1, 3.2, 3.4_

- [x] 5. `folha-efetivacao.service.ts`
  - [x] 5.1 `efetivarFolha` atômico: 1 título por item (tipoDocumento FOLHA) + 1 por encargo (IMPOSTO) via `incluirTitulo`; marca EFETIVADA; idempotente; empresaId da folha
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.2_

- [x] 6. Rotas `folha.routes.ts` + enriquecimento de funcionário
  - [x] 6.1 Registrar sub-rotas em `/api/financeiro/folha` (POST/GET/detalhe, itens, encargos, importar-csv, efetivar)
    - _Requirements: 2.1, 2.4, 3.1, 4.1_
  - [x] 6.2 Rota de funcionário aceita novos campos opcionais + valida CPF (validarDocumento D1) + unicidade por empresa
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 7. Vizor AI — tool `efetivar_folha`
  - [x] 7.1 Tool em `ai-tools.ts` + executor (resolve folha ABERTA por competência, chama efetivarFolha); system prompt: resumir totais + confirmar antes (SEM crases internas — lição D2)
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 8. Checkpoint backend — build + testes (12 testes verdes, bundle esbuild OK, diagnostics limpos)

- [x] 9. QA E2E `test_47_folha.py`
  - [x] 9.1 criar folha + itens + encargos → efetivar gera N contas a pagar; 2ª efetivação recusada sem duplicar (Property 3); isolamento (Property 5); CPF inválido barrado no funcionário; helpers no `wms_api.py`
    - _Requirements: 4.2, 4.3, 5.1, 1.2_
  - [x] 9.2 Rodado contra produção: 4/4 verde (back f0856ff94, front 1447cc0)

- [x] 10. Documentação + deploy (documento-mestre + steering QA atualizados; back+front pushados; migração aplicada no start do Render; QA 4/4 em produção)

- [ ] 10. Documentação + deploy
  - Atualizar `docs/PROGRAMA-DOCUMENTOS-FINANCEIROS.md` (D3 concluída) + steering QA (front); commit + push back e front (schema + migrate-prod juntos); QA contra produção.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2"] },
    { "id": 3, "tasks": ["3.1"] },
    { "id": 4, "tasks": ["3.2"] },
    { "id": 5, "tasks": ["4.1", "4.2"] },
    { "id": 6, "tasks": ["5.1"] },
    { "id": 7, "tasks": ["6.1", "6.2"] },
    { "id": 8, "tasks": ["7.1"] },
    { "id": 9, "tasks": ["8"] },
    { "id": 10, "tasks": ["9.1"] },
    { "id": 11, "tasks": ["9.2"] },
    { "id": 12, "tasks": ["10"] }
  ]
}
```

## Notes

- Documento-mestre: `docs/PROGRAMA-DOCUMENTOS-FINANCEIROS.md` (atualizar ao fim).
- Vizor NÃO calcula folha — lança o resultado (padrão de mercado Totvs/Sankhya/Omie).
- Reusar D1 (`incluirTitulo`, `validarDocumento`) e infra de IA. Estender, não reescrever.
- Migração idempotente no MESMO commit que altera schema; testar 2x local.
- Lição D2: nunca usar crases dentro do `ai-system-prompt.ts`; validar bundle esbuild antes do push.
- Confirmação humana obrigatória na efetivação.
```
