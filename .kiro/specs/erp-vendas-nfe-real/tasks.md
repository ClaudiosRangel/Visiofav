# Implementation Plan

Bloco F2 — Vendas com Emissão Real de NF-e (fluxo 100% ponta a ponta)

## Overview

Fechar o fluxo NF-e ponta a ponta reusando o motor existente e nivelando ao
CT-e: ponto único pós-autorização (título + estoque, idempotente e protegido),
cobertura de PDV/encomenda/consignada, mapeamento de rejeição + reprocessamento,
ambiente derivado do documento, e detalhe/XML/consulta. Migração idempotente no
mesmo commit; validar bundle antes do push.

## Tasks

- [x] 1. Núcleo puro `nfe-rejeicao.ts` (mapeamento de rejeições)
  - [x] 1.1 `mapearRejeicao(cStat, xMotivo)` com tabela dos cStat 2xx comuns + fallback genérico
    - _Requirements: 3.1_
  - [x]* 1.2 Testes (unit + property): Property 5 (total e determinístico), cStat conhecidos/desconhecidos
    - **Validates: Requirements 3.1**

- [x] 2. Checkpoint — núcleo puro passa

- [x] 3. Ponto único pós-autorização (`gerar-titulo-de-documento.service.ts`)
  - [x] 3.1 `gerarTituloDeNfe` + `gerarTituloDeNfeProtegido` (idempotente por documentoFiscalId, empresaId do doc, no-op p/ NFC-e à vista)
    - _Requirements: 2.1, 2.2, 7.1_
  - [x] 3.2 `baixarEstoqueDeNfeProtegido` (idempotente por origemId=documento, só sem WMS) + `amarrarPosAutorizacaoNfe` + `reverterPosAutorizacaoNfe`
    - _Requirements: 2.3, 2.4, 2.5_
  - [x]* 3.3 Testes: Property 1 (idempotência), Property 2 (não desfaz autorização), Property 3 (empresaId do doc), Property 4 (rejeição não efetiva)
    - **Validates: Requirements 2.1, 2.2, 3.2**

- [x] 4. Schema + migração (se necessário)
  - [x] 4.1 Idempotência por origemId (estoque) e documentoFiscalId (título) — SEM flag/schema para o ponto único. Schema alterado só para `infRespTec` (resp_tec_* em Empresa), migração idempotente testada 2x local
    - _Requirements: 2.3, 7.2_

- [x] 5. Ligar autorização ao ponto único + remover duplicação inline
  - [x] 5.1 `nfeEmissaoService.processarRespostaSefaz` (cStat 100) chama `amarrarPosAutorizacaoNfe`; cancelamento chama `reverterPosAutorizacaoNfe`
    - _Requirements: 2.1, 2.5_
  - [x] 5.2 `venda.routes /efetivar` e `faturamento-parcial.service` deixam de gerar ContaReceber inline (confiam no ponto único); baixa de estoque unificada
    - _Requirements: 2.1, 2.3_

- [x] 6. Ambiente derivado do documento (corrige cStat 252)
  - [x] 6.1 `nfeEmissaoService.obterAmbiente` deriva ambiente do documento; env vira fallback; `protNFe` extrai `tpAmb` do XML
    - _Requirements: 5.1, 5.2_

- [x] 6b. Cobertura de tags obrigatórias (achados do mapa de cobertura — evitar rejeição)
  - [x] 6b.1 `cMunFG`/`emit.cMun`/`dest.cMun` lidos de Empresa/Cliente.codigoMunicipio + fallback IBGE por nome+UF
  - [x] 6b.2 Grupo `pag/detPag` real (de/para forma livre → tPag; parcelas)
  - [x] 6b.3 CSOSN (Simples) no builder (ICMSSN101/102/201/202/500/900)
  - [x] 6b.4 `infRespTec` (campos resp_tec_* em Empresa + migração idempotente)
  - [x] 6b.5 `fmtDataHora` com ajuste de fuso -3h (bug 228)
  - [x] 6b.6 Rota manual `POST /nfe/emitir` corrigida (inscEstadual/cidade)

- [ ] 7. Cobertura dos fluxos de venda
  - [x] 7.1 PDV: `finalizarVenda` emite NFC-e (motor existente, `pdv-nfce.service.ts`), grava `nfceChave`/`nfceNumero`, baixa estoque via `registrarMovimentacao`; infRespTec adicionado ao builder NFC-e
    - _Requirements: 1.1_
  - [ ] 7.2 Encomenda: faturamento emite NF-e via `emitirParaVenda` + ponto único
    - _Requirements: 1.2_
  - [ ] 7.3 Consignada: NF-e de remessa (5917/6917), venda no acerto e retorno (1918/2918) via `montarDadosNFe` parametrizado
    - _Requirements: 1.5_

- [x] 8. Rejeição + reprocessamento + rotas de consulta
  - [x] 8.1 Emissão/efetivação retorna rejeição amigável (usa `mapearRejeicao`); não efetiva em rejeição
    - _Requirements: 3.1, 3.2, 3.3_
  - [x] 8.2 `POST /nfe/:id/retransmitir` (só REJEITADO; reautoriza e amarra); `GET /nfe/:id`, `GET /nfe/:id/xml`
    - _Requirements: 4.1, 4.2, 4.3, 6.1, 6.2, 6.3_

- [x] 9. Frontend NF-e
  - [x] 9.1 Listagem: botões DANFE + XML (blob via axios), ação Reprocessar (REJEITADO, usa /retransmitir com orientação amigável no erro), filtros/ações alinhados aos valores MASCULINOS do back (AUTORIZADO/REJEITADO/CANCELADO)
    - _Requirements: 6.4_

- [ ] 10. Checkpoint backend — build + testes
  - `vitest run nfe-rejeicao.test.ts gerar-titulo-de-documento.service.test.ts` + diagnostics + bundle esbuild do `server.ts`

- [ ] 11. QA E2E `test_51_nfe.py`
  - [ ] 11.1 amarração ponta a ponta via seed/QA (sem SEFAZ real): título idempotente, rejeição barra efetivação, reprocessar, isolamento; helpers no `wms_api.py`
    - _Requirements: 2.1, 3.2, 4.1, 7.1_
  - [ ] 11.2 Rodar contra produção (aguardar deploy) e reportar

- [ ] 12. Documentação + deploy
  - Atualizar `.kiro/steering/erp-roadmap.md` (F2 concluído) + steering QA (front); commit + push back e front; QA contra produção.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2"] },
    { "id": 3, "tasks": ["3.1", "3.2"] },
    { "id": 4, "tasks": ["3.3", "4.1"] },
    { "id": 5, "tasks": ["5.1", "5.2"] },
    { "id": 6, "tasks": ["6.1"] },
    { "id": 7, "tasks": ["7.1", "7.2", "7.3"] },
    { "id": 8, "tasks": ["8.1", "8.2"] },
    { "id": 9, "tasks": ["9.1"] },
    { "id": 10, "tasks": ["10"] },
    { "id": 11, "tasks": ["11.1"] },
    { "id": 12, "tasks": ["11.2"] },
    { "id": 13, "tasks": ["12"] }
  ]
}
```

## Notes

- Roadmap-mestre: `.kiro/steering/erp-roadmap.md` (atualizar F2 ao fim).
- CT-e é modelo estrutural (não copiar): reusar infra SEFAZ/xml-signer/certificado; espelhar padrão de ponto único de título e ambiente do documento.
- Motor de emissão já funciona — F2 é fechamento de fluxo, não reescrita.
- Migração idempotente no MESMO commit; testar 2x local. Validar bundle esbuild antes do push.
- Idempotência é o coração da amarração (título por documentoFiscalId; estoque por origemId).
```
