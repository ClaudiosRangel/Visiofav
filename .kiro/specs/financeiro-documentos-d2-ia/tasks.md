# Implementation Plan: Central de Documentos Financeiros — Fase D2 (Vizor AI)

## Overview

Lançamento assistido por IA: upload de boleto/fatura/guia (PDF/imagem) ou texto
→ extração → resumo → confirmação → `incluirTitulo` (D1). Núcleo de extração
puro e testável; visão multimodal como complemento. Sem migração de schema.
Confirmação humana obrigatória antes de gravar.

## Tasks

- [x] 1. Núcleo puro `extrair-campos-documento.ts`
  - [x] 1.1 `extrairCamposDocumento(texto)`: linha digitável, valor BRL, data, CNPJ/CPF válido, tipo sugerido, confiança
    - _Requirements: 1.2, 2.2, 6.1_
  - [x]* 1.2 Property tests: 8 passando (Property 1 prioriza linha digitável, Property 2 determinístico, DARF/NF/CNPJ)
    - **Validates: Requirements 2.2, 6.1**

- [x] 2. Checkpoint — núcleo puro passa (8 testes)

- [x] 3. Cache de pendente + extrator I/O
  - [x] 3.1 `documento-financeiro-pendente.ts` (cache por empresa, TTL 30min, espelha ai-xml-pendente)
    - _Requirements: 1.5, 3.5_
  - [x] 3.2 `extrator-documento.service.ts`: `extrairTextoPdf` (pdfjs-dist) + `extrairPorVisao` (Claude multimodal; no-op sem API key)
    - _Requirements: 1.2, 1.3, 6.4_

- [x] 4. Tool de lançamento (IA)
  - [x] 4.1 Tool `lancar_documento_financeiro` em `ai-tools.ts` + `executarLancarDocumentoFinanceiro` em `ai-executor.ts` (resolve parceiro cadastro/livre, categoria, chama incluirTitulo, isola por empresa, valida documento D1)
    - _Requirements: 3.2, 3.3, 4.1, 4.2, 5.1, 5.3_
  - [ ]* 4.2 Testes unitários: resolve parceiro, documento inválido barra (Property 3), isolamento (Property 4) — coberto via QA E2E (test_46)
    - **Validates: Requirements 5.3, 6.2**

- [x] 5. Upload estendido + system prompt
  - [x] 5.1 `POST /ai/upload`: rotear PDF/imagem para extrator → `processarDocumentoFinanceiro` → resumo + pendente + pergunta de confirmação (Property 5: sem confirmação não grava)
    - _Requirements: 1.1, 1.3, 1.4, 2.1, 3.1_
  - [x] 5.2 Ajustar `ai-system-prompt.ts`: instrução de resumir+confirmar boleto/fatura, sugerir categoria por histórico, nunca lançar sem "sim"
    - _Requirements: 2.1, 2.3, 3.1_

- [x] 6. Checkpoint backend — build + testes passam (8 testes ok, diagnostics limpos)

- [ ] 7. QA E2E
  - [ ] 7.1 `test_46_ia_documentos.py`: lançar documento via tool (dados/linha digitável, sem imagem real) + documento inválido barra + isolamento; reusa helpers D1
    - _Requirements: 6.3_
  - [ ] 7.2 Rodar contra produção e reportar

- [ ] 8. Documentação + deploy
  - Atualizar `docs/PROGRAMA-DOCUMENTOS-FINANCEIROS.md` (D2 concluída) + steering QA; commit + push back; QA contra produção.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2"] },
    { "id": 3, "tasks": ["3.1", "3.2"] },
    { "id": 4, "tasks": ["4.1"] },
    { "id": 5, "tasks": ["4.2", "5.1", "5.2"] },
    { "id": 6, "tasks": ["6"] },
    { "id": 7, "tasks": ["7.1", "7.2"] },
    { "id": 8, "tasks": ["8"] }
  ]
}
```

## Notes

- Documento-mestre: `docs/PROGRAMA-DOCUMENTOS-FINANCEIROS.md` (atualizar ao fim).
- Reusar D1 (`incluirTitulo`, `interpretarLinhaDigitavel`, `validarDocumento`) e infra de IA (tools/executor/cache/upload). Não reinventar.
- Confirmação humana obrigatória (padrão do XML). Caminho determinístico funciona sem LLM.
