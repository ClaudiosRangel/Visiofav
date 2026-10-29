# Implementation Plan — Pipeline Comercial + Proposta no Detalhe (B3)

- [x] 1. Service de listagem do painel unificado
  - `jornada-lista.service.ts` (`listarPainelJornadas`): agrega pedidos comerciais
    + orçamentos + amostras + OPs em poucas queries (sem N+1), reusa
    `montarEstagios`, filtra `empresaId`, aceita statusPedido/busca. Deriva estágio
    atual + progresso de OPs. get_diagnostics limpo.
  - _Requirements: 1_

- [x] 2. Rota do painel
  - `GET /orcamento-grafico/pedidos/jornadas` (antes de `/:pedidoId/jornada`),
    authenticate + empresaId explícito.
  - _Requirements: 1_

- [x] 3. Tela Pipeline Comercial (frontend)
  - `/orcamento-grafico/pipeline` — lista com régua de estágios (badges
    coloridos por estado, progresso de OPs), filtros status + busca, abrir
    orçamento. Item "Pipeline (Status)" no menu Comercial.
  - _Requirements: 1_

- [x] 4. Proposta PDF no detalhe (task 8 do B1)
  - Detalhe do orçamento: botão/Menu "Proposta" (Baixar PDF / Enviar por e-mail)
    + `Select` de template (default pré-selecionado) + modal de e-mail. Usa
    `/:id/proposta-pdf?templateId` e `/:id/enviar-email` com templateId.
  - _Requirements: 2_

- [x] 5. Verificação
  - get_diagnostics limpo (back+front) + suíte orcamento-grafico sem regressão.
  - _Requirements: 3_
