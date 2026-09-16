# Tarefas — Solicitação do Representante integrada ao Orçamento Gráfico (Opção A)

> Revisão da spec: migra da Opção B (placeholder) para a Opção A (passa por
> Orçamento Gráfico real, aprovação pelo representante no Portal).

## Já concluído em sessão anterior (Opção B — base reaproveitada)

- [x] Schema: campos de auditoria de transição + `pedidoVendaId` + `motivoRecusa`
      em `SolicitacaoOrcamentoRep` (migração idempotente).
- [x] Máquina de estados (`solicitacao-status.ts`) + testes unitários.
- [x] Correção do cliente na criação (`criarSolicitacao`) e na listagem
      (`listarSolicitacoesAdmin` → `clienteNomeExibicao`).
- [x] Frontend interno: exibição do cliente.

## A fazer (Opção A)

- [x] 1. Ajustar máquina de estados
  - Em `solicitacao-status.ts`, remover `LIBERADA_PEDIDO`; PRECIFICADA passa a
    transicionar para CONVERTIDA | RECUSADA | CANCELADA. Atualizar testes.
  - _Requirements: 4.3_

- [x] 2. Schema + migração (campos de aprovação do cliente)
  - Adicionar `aprovadaClientePor`, `aprovadaClienteEm` em
    `SolicitacaoOrcamentoRep`; `ADD COLUMN IF NOT EXISTS` em `migrate-prod.ts`
    + mapear `LIBERADA_PEDIDO → PRECIFICADA`. Testar 2x local.
  - _Requirements: 4.2, 7.1, 7.2, 7.3_

- [x] 3. Serviço: criar Orçamento Gráfico a partir da solicitação
  - `criarOrcamentoGraficoDeSolicitacao(...)`: resolve `tipoEmbalagemId`
    (match por codigo/descricao normalizado, ou override), monta `medidas`
    JSON, cria `OrcamentoGrafico` RASCUNHO, grava `orcamentoGraficoId`,
    transiciona solicitação para EM_ORCAMENTO. Idempotente.
  - Unit: resolução do tipo + montagem de medidas.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 4. Rota interna: enviar-orcamento (reescrever)
  - `POST /solicitacoes-orcamento/:id/enviar-orcamento` chama o serviço do
    item 3 (aceita `tipoEmbalagemId` opcional). Descontinuar `calcular`
    (placeholder) e `liberar-pedido`.
  - _Requirements: 2.1, 2.4, 6.1_

- [x] 5. Sincronização OrcamentoGrafico → Solicitação
  - No `POST /orcamento-grafico/:id/enviar`: se houver solicitação vinculada,
    marcar PRECIFICADA + copiar preço.
  - No `POST /orcamento-grafico/:id/aprovar` e `/recusar`: refletir CONVERTIDA
    (+ pedidoVendaId) / RECUSADA na solicitação.
  - _Requirements: 3.2, 4.3, 5.1_

- [x] 6. Rota do Portal: aprovar/recusar (representante)
  - `POST /api/portal-rep/solicitacoes-orcamento/:id/aprovar` (`portalRepAuth`),
    body `{ aprovadoPor }`: valida PRECIFICADA + isolamento; aprova o OG
    vinculado (gera PedidoVenda CONFIRMADO com `orcamentoOrigemId`); grava
    `aprovadaClientePor/Em`; solicitação → CONVERTIDA.
  - `POST /.../:id/recusar` (opcional).
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 6.2_

- [x] 7. Frontend interno
  - "Enviar para orçamento" com seletor de Tipo de Embalagem no fallback;
    atalho para abrir o Orçamento Gráfico gerado. Remover Precificar/Liberar.
  - _Requirements: 2.4_

- [x] 8. Frontend Portal externo
  - Tela de orçamentos do rep: quando PRECIFICADA, mostrar preço + Aprovar
    (campo "Aprovado por") / Recusar. Ajustar tipos/hooks (remover
    LIBERADA_PEDIDO, add hook aprovar).
  - _Requirements: 4.1, 4.2_

- [ ] 9. Testes E2E (após deploy) — PENDENTE (roda contra produção)
  - Ciclo completo: enviar p/ orçamento (OG criado) → precificar/enviar OG →
    rep aprova no Portal → CONVERTIDA + PedidoVenda + OP.
  - _Requirements: 2.1, 3.2, 4.3, 5.2_

- [x] 10. Verificação final
  - Backend `tsc`: sem erros novos nos arquivos tocados; unit tests 5/5;
    migração idempotente 2x local; frontend sem diagnostics.
  - _Requirements: 7.1_
