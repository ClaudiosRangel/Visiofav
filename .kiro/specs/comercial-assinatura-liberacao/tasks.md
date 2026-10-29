# Implementation Plan — Assinatura do Setor na Liberação ao PCP (B6)

- [x] 1. Validação de assinatura no service de liberação
  - `liberar-pedido-pcp.service.ts`: `exigeAssinaturaLiberacao(empresaId)`
    (Parametro `comercial.exigir-assinatura-liberacao`, default true) +
    `validarAssinaturaSetor` (senha do usuário via bcrypt + perfil
    ADMIN/SUPER_ADMIN/SUPERVISOR; 401 senha, 403 perfil, ASSINATURA_REQUERIDA
    quando falta). `liberarPedidoParaPcp` recebe `{ senha }` e valida; registra
    quem assinou na notificação comercial.
  - _Requirements: 1, 2_

- [x] 2. Rota de liberação + config
  - `POST /pedidos/:pedidoId/liberar-pcp` aceita `{ senha }`. Novas rotas
    `GET/PUT /comercial/config-assinatura` (liga/desliga a exigência).
  - _Requirements: 1, 2_

- [x] 3. Frontend — modal de assinatura
  - `vendas/pedidos/[id]`: ao liberar, se o backend pedir assinatura
    (ASSINATURA_REQUERIDA), abre modal com `PasswordInput`; "Assinar e liberar"
    reenvia com a senha. Mensagens claras p/ senha incorreta / sem permissão.
  - _Requirements: 1_

- [x] 4. Verificação
  - get_diagnostics limpo (back+front) + suíte orcamento-grafico sem regressão.
  - _Requirements: 3_
