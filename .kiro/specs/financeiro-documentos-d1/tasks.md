# Implementation Plan: Central de Documentos Financeiros — Fase D1

## Overview

Documento tipado + fornecedor PF/PJ + formulário rico + contratos parcelados.
Estende `ContaPagar`/`ContaReceber`, `Fornecedor`, `inclusao-titulo.service`.
Núcleo de validação CPF/CNPJ puro. Migração idempotente no mesmo commit.
Cada bloco: backend testado → frontend testado → QA → deploy.

## Tasks

- [x] 1. Schema + migração idempotente
  - Colunas aditivas + `Fornecedor.tipoPessoa` + `ContratoParcelamento`; migração idempotente 2x OK; ISOLATED_MODELS atualizado.
  - _Requirements: 1.1, 4.1, 5.1, 8.3_

- [ ] 2. Núcleo puro `documento-validacao.ts`
  - [x] 2.1 normalizarDoc, detectarTipoPessoa, validarCpf, validarCnpj, validarDocumento
    - _Requirements: 2.1, 2.2, 2.4_
  - [x]* 2.2 Property tests (fast-check): 7 testes passando (Property 1 DV, Property 2 tipo, vetores conhecidos)
    - **Validates: Requirements 2.1, 2.2, 2.4**

- [x] 3. Checkpoint — núcleo puro passa (7 testes)

- [x] 4. Services
  - [x] 4.1 `inclusao-titulo.service.ts` estendido: tipoDocumento/subtipo, parceiro livre (nome+doc validado), campos de guia
    - _Requirements: 1.1, 1.2, 1.4, 3.1, 3.2, 4.1, 4.3, 4.4_
  - [x] 4.2 `contrato-parcelamento.service.ts`: criarContrato, obterContrato (saldo devedor), listarContratos
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [x]* 4.3 Testes: 13 passando (Property 3 parcelamento fecha, Property 4 saldo devedor, parceiro livre inválido→422)
    - **Validates: Requirements 4.3, 5.2, 5.3, 5.4, 8.1**

- [x] 5. Rotas
  - [x] 5.1 POST rico via `incluirTitulo` em pagar/receber + `POST /interpretar-boleto`
    - _Requirements: 1.x, 3.x, 4.1, 4.2_
  - [x] 5.2 `POST/GET /contratos`, `GET /contratos/:id`
    - _Requirements: 5.x_

- [x] 6. Checkpoint backend — 13 testes passam, diagnostics limpos

- [x] 7. Frontend
  - [x] 7.1 `lib/financeiro/documento.ts` (puro) + teste: 7 testes passando (máscara/validação/rótulo dinâmicos)
    - _Requirements: 2.1, 6.1_
  - [x] 7.2 `ParceiroAutocomplete.tsx` (busca fornecedor/cliente OU livre + CPF/CNPJ dinâmico com badge PF/PJ)
    - _Requirements: 3.1, 3.2, 6.1_
  - [x] 7.3 `DocumentoFinanceiroForm.tsx` (modal 4 blocos) integrado em contas-pagar/receber
    - _Requirements: 4.1, 4.2, 4.3, 6.1_
  - [x] 7.4 Tela `/financeiro/contratos` (criar + saldo devedor + progresso) + menu
    - _Requirements: 5.3, 6.2_

- [x] 8. Checkpoint frontend — build passa

- [ ] 9. QA E2E
  - [x] 9.1 Helpers no `wms_api.py`
  - [x] 9.2 `test_45_documentos_financeiros.py` criado (tipagem, PF/PJ, parcelas, contrato saldo, isolamento)
  - [ ] 9.3 Rodar contra produção pós-deploy (ambiente local de teste instável nesta sessão)
    - _Requirements: 7.1, 7.2_

- [ ] 10. Documentação + deploy

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2"] },
    { "id": 3, "tasks": ["4.1", "4.2"] },
    { "id": 4, "tasks": ["4.3", "5.1", "5.2"] },
    { "id": 5, "tasks": ["6"] },
    { "id": 6, "tasks": ["7.1", "7.2"] },
    { "id": 7, "tasks": ["7.3", "7.4"] },
    { "id": 8, "tasks": ["8"] },
    { "id": 9, "tasks": ["9.1", "9.2", "9.3"] },
    { "id": 10, "tasks": ["10"] }
  ]
}
```

## Notes

- Documento-mestre: `docs/PROGRAMA-DOCUMENTOS-FINANCEIROS.md` (atualizar ao fim).
- Estender, não reescrever. Migração idempotente no mesmo commit.
- `inclusao-titulo.service.ts` já existe (parcelas + parse boleto) — estender, não recriar.
