-- ============================================================================
-- LIMPEZA COMPLETA: Compras, Vendas, WMS (todos os dados operacionais)
-- ============================================================================

-- WMS: Carregamento
DELETE FROM carregamento_volume;
DELETE FROM carregamento;

-- WMS: Embalagem (Volumes)
DELETE FROM item_volume;
DELETE FROM volume;

-- WMS: Conferência Saída
DELETE FROM item_conferencia_saida;
DELETE FROM conferencia_saida;

-- WMS: Separação (Picking)
DELETE FROM item_separacao;
DELETE FROM ordem_separacao;
DELETE FROM onda_pedido;
DELETE FROM onda_separacao;

-- WMS: Fichas Operacionais
DELETE FROM ficha_operacional;

-- WMS: Ordens de Serviço
DELETE FROM os_funcionario_wms;
DELETE FROM ordem_servico_wms;

-- WMS: Conferência de Entrada
DELETE FROM item_nota_entrada;
DELETE FROM nota_entrada;

-- WMS: Agenda
DELETE FROM agenda_wms;

-- WMS: Estoque e Saldos
DELETE FROM log_movimentacao;
DELETE FROM saldo_endereco;
DELETE FROM estoque;

-- WMS: Inventário
DELETE FROM item_inventario;
DELETE FROM inventario;

-- WMS: Auditoria
DELETE FROM audit_log;

-- FISCAL: NF-e e CT-e
DELETE FROM item_nfe;
DELETE FROM nfe;
DELETE FROM nfe_cte_referencia;
DELETE FROM cte;

-- FINANCEIRO
DELETE FROM conta_pagar;
DELETE FROM conta_receber;

-- VENDAS
DELETE FROM venda_efetivada;
DELETE FROM item_pedido_venda;
DELETE FROM pedido_venda;

-- COMPRAS
DELETE FROM item_devolucao_compra;
DELETE FROM devolucao_compra;
DELETE FROM compra_efetivada;
DELETE FROM item_pedido_compra;
DELETE FROM pedido_compra;

-- TRANSFERÊNCIAS
DELETE FROM item_transferencia;
DELETE FROM transferencia_estoque;

-- WEBHOOKS (entregas)
DELETE FROM webhook_entrega;
DELETE FROM log_integracao;
