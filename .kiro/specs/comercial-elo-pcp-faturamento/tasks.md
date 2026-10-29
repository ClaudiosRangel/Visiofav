# Implementation Plan — Elo PCP + Gatilho de Faturamento (B8)

- [x] 1. Gatilho de faturamento (JÁ EXISTIA)
  - `concluirEtapa` (etapa-operacional.service.ts): ao concluir todas as etapas,
    se a OP veio de orçamento gráfico (orcamentoItemId → item → orçamento →
    pedido), marca o pedido EFETIVADO + cria NotificacaoComercial "pronto para
    faturar". Best-effort, empresaId da OP. Sem alteração.
  - _Requirements: 1_

- [x] 2. Visibilidade — sino no Pipeline
  - `NotificacoesComercialBell` (já existia na tela a-converter) adicionado ao
    cabeçalho do Pipeline. O Pipeline já reflete o estágio Faturamento (lê status
    do pedido). get_diagnostics limpo.
  - _Requirements: 2_

- [x] 3. Verificação
  - get_diagnostics limpo. Backend intocado (não-regressão).
  - _Requirements: 3_
