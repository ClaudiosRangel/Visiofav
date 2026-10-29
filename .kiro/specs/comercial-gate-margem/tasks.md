# Implementation Plan — Gate de Margem na Conversão (B7)

- [x] 1. Backend do gate (JÁ EXISTIA)
  - `gate-margem.puro.ts` (`avaliarGateMargem`) + `converter-orcamento.service`
    busca `RegraAprovacao` ativas tipo DESCONTO, avalia, abre
    `SolicitacaoAprovacao` e retorna `MARGEM_PENDENTE` (409). Sem alteração.
  - _Requirements: 1, 3_

- [x] 2. Frontend — desconto na conversão + tratamento do gate
  - `a-converter/page.tsx`: botão "Converter" abre modal com `NumberInput` de
    desconto (%); envia `descontoPercent`; `MARGEM_PENDENTE` → aviso "aprovação
    aberta" (laranja) e não converte; dentro da alçada → converte normal.
  - _Requirements: 1, 2_

- [x] 3. Verificação
  - get_diagnostics limpo. Backend sem mudança (não-regressão garantida).
  - _Requirements: 3_
