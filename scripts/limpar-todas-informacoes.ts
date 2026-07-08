/**
 * LimparTodasInformacoes — apaga TODOS os dados cadastrais/operacionais de UMA
 * empresa específica, MANTENDO apenas o próprio registro `Empresa` (razão social,
 * CNPJ, configurações fiscais da empresa em si, etc.).
 *
 * ⚠️  AÇÃO IRREVERSÍVEL. Isso é MUITO mais amplo que `limpar-dados.ts` (que só
 * cobre Compras + WMS operacional) — este script apaga TUDO: Compras, Vendas,
 * Vendas Avançado, Financeiro, Fiscal (17 tabelas), WMS completo (cadastros,
 * operacional, PCP, Multi-CD, PDV), preservando apenas a linha `empresa`.
 *
 * Uso:
 *   npx tsx scripts/limpar-todas-informacoes.ts --cnpj=<cnpj> --confirmar
 *   npx tsx scripts/limpar-todas-informacoes.ts --empresaId=<uuid> --confirmar
 *
 * O filtro por empresa é OBRIGATÓRIO. Por padrão o script roda em modo dry-run
 * (mostra o que SERIA apagado, sem tocar no banco) — é necessário passar
 * --confirmar explicitamente para executar a exclusão de fato.
 *
 * COMO A LISTA DE TABELAS/FILTROS FOI GERADA:
 * Em vez de transcrever manualmente o schema.prisma (145+ modelos, alto risco de
 * esquecer uma tabela em uma operação irreversível), a lista abaixo foi gerada
 * programaticamente introspectando o catálogo real do Postgres (information_schema
 * + pg_constraint) do banco local: todas as 205 tabelas, todos os 207 FKs, todas
 * as 144 tabelas com coluna empresa_id direta. A partir disso foi montado um grafo
 * de dependências e calculada uma ordem topológica de exclusão (filhos antes de
 * pais), com filtro de empresa resolvido recursivamente via EXISTS para tabelas
 * sem empresa_id direto (ex.: item_pedido_compra → pedido_compra.empresa_id).
 * Tabelas globais (ncm, cfop, cest, cest_ncm) e ligadas a Usuario (que é uma
 * entidade cross-empresa) foram excluídas da lista e tratadas separadamente.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function parseArgs() {
  const cnpjArg = process.argv.find((a) => a.startsWith('--cnpj='))
  const idArg = process.argv.find((a) => a.startsWith('--empresaId='))
  const confirmar = process.argv.includes('--confirmar')
  return {
    cnpj: cnpjArg ? cnpjArg.split('=')[1] : undefined,
    empresaId: idArg ? idArg.split('=')[1] : undefined,
    confirmar,
  }
}

// Ordem topológica de exclusão (filhos antes de pais), com filtro de empresa
// resolvido recursivamente. Gerado por introspecção do banco — ver comentário acima.
const STATEMENTS: Array<{ table: string; sql: string }> = [
  { table: "parametro", sql: "DELETE FROM \"parametro\" WHERE \"parametro\".\"empresa_id\" = $1" },
  { table: "item_pedido_compra", sql: "DELETE FROM \"item_pedido_compra\" WHERE EXISTS (SELECT 1 FROM \"pedido_compra\" \"p_pedido_compra_pedido_compra_id\" WHERE \"p_pedido_compra_pedido_compra_id\".\"id\" = \"item_pedido_compra\".\"pedido_compra_id\" AND \"p_pedido_compra_pedido_compra_id\".\"empresa_id\" = $1) OR EXISTS (SELECT 1 FROM \"produto\" \"p_produto_produto_id\" WHERE \"p_produto_produto_id\".\"id\" = \"item_pedido_compra\".\"produto_id\" AND \"p_produto_produto_id\".\"empresa_id\" = $1)" },
  { table: "item_transferencia", sql: "DELETE FROM \"item_transferencia\" WHERE EXISTS (SELECT 1 FROM \"transferencia_estoque\" \"p_transferencia_estoque_transferencia_id\" WHERE \"p_transferencia_estoque_transferencia_id\".\"id\" = \"item_transferencia\".\"transferencia_id\" AND (\"p_transferencia_estoque_transferencia_id\".\"empresa_origem_id\" = $1 OR \"p_transferencia_estoque_transferencia_id\".\"empresa_destino_id\" = $1)) OR EXISTS (SELECT 1 FROM \"produto\" \"p_produto_produto_id\" WHERE \"p_produto_produto_id\".\"id\" = \"item_transferencia\".\"produto_id\" AND \"p_produto_produto_id\".\"empresa_id\" = $1)" },
  { table: "condicao_pagamento", sql: "DELETE FROM \"condicao_pagamento\" WHERE EXISTS (SELECT 1 FROM \"tabela_preco\" \"p_tabela_preco_tabela_preco_id\" WHERE \"p_tabela_preco_tabela_preco_id\".\"id\" = \"condicao_pagamento\".\"tabela_preco_id\" AND \"p_tabela_preco_tabela_preco_id\".\"empresa_id\" = $1)" },
  { table: "conta_pagar", sql: "DELETE FROM \"conta_pagar\" WHERE \"conta_pagar\".\"empresa_id\" = $1" },
  { table: "nfe_cte_referencia", sql: "DELETE FROM \"nfe_cte_referencia\" WHERE EXISTS (SELECT 1 FROM \"cte\" \"p_cte_cte_id\" WHERE \"p_cte_cte_id\".\"id\" = \"nfe_cte_referencia\".\"cte_id\" AND \"p_cte_cte_id\".\"empresa_id\" = $1)" },
  { table: "config_integracao", sql: "DELETE FROM \"config_integracao\" WHERE \"config_integracao\".\"empresa_id\" = $1" },
  { table: "carta_correcao", sql: "DELETE FROM \"carta_correcao\" WHERE \"carta_correcao\".\"empresa_id\" = $1" },
  { table: "webhook_entrega", sql: "DELETE FROM \"webhook_entrega\" WHERE EXISTS (SELECT 1 FROM \"webhook_config\" \"p_webhook_config_webhook_config_id\" WHERE \"p_webhook_config_webhook_config_id\".\"id\" = \"webhook_entrega\".\"webhook_config_id\" AND \"p_webhook_config_webhook_config_id\".\"empresa_id\" = $1)" },
  { table: "log_integracao", sql: "DELETE FROM \"log_integracao\" WHERE \"log_integracao\".\"empresa_id\" = $1" },
  { table: "estoque", sql: "DELETE FROM \"estoque\" WHERE \"estoque\".\"empresa_id\" = $1" },
  { table: "config_email_fiscal", sql: "DELETE FROM \"config_email_fiscal\" WHERE \"config_email_fiscal\".\"empresa_id\" = $1" },
  { table: "pendencia_cce", sql: "DELETE FROM \"pendencia_cce\" WHERE \"pendencia_cce\".\"empresa_id\" = $1" },
  { table: "programacao_entrega", sql: "DELETE FROM \"programacao_entrega\" WHERE EXISTS (SELECT 1 FROM \"ordem_producao\" \"p_ordem_producao_ordem_producao_id\" WHERE \"p_ordem_producao_ordem_producao_id\".\"id\" = \"programacao_entrega\".\"ordem_producao_id\" AND \"p_ordem_producao_ordem_producao_id\".\"empresa_id\" = $1)" },
  { table: "snapshot_kpi", sql: "DELETE FROM \"snapshot_kpi\" WHERE \"snapshot_kpi\".\"empresa_id\" = $1" },
  { table: "alerta_kpi", sql: "DELETE FROM \"alerta_kpi\" WHERE \"alerta_kpi\".\"empresa_id\" = $1" },
  { table: "historico_regra_kpi", sql: "DELETE FROM \"historico_regra_kpi\" WHERE EXISTS (SELECT 1 FROM \"regra_kpi\" \"p_regra_kpi_regra_kpi_id\" WHERE \"p_regra_kpi_regra_kpi_id\".\"id\" = \"historico_regra_kpi\".\"regra_kpi_id\" AND \"p_regra_kpi_regra_kpi_id\".\"empresa_id\" = $1)" },
  { table: "saldo_pendente_item", sql: "DELETE FROM \"saldo_pendente_item\" WHERE \"saldo_pendente_item\".\"empresa_id\" = $1" },
  { table: "onda_pedido", sql: "DELETE FROM \"onda_pedido\" WHERE EXISTS (SELECT 1 FROM \"onda_separacao\" \"p_onda_separacao_onda_separacao_id\" WHERE \"p_onda_separacao_onda_separacao_id\".\"id\" = \"onda_pedido\".\"onda_separacao_id\" AND \"p_onda_separacao_onda_separacao_id\".\"empresa_id\" = $1)" },
  { table: "equipamento_movimentacao", sql: "DELETE FROM \"equipamento_movimentacao\" WHERE \"equipamento_movimentacao\".\"empresa_id\" = $1" },
  { table: "tipo_carga", sql: "DELETE FROM \"tipo_carga\" WHERE \"tipo_carga\".\"empresa_id\" = $1" },
  { table: "funcao", sql: "DELETE FROM \"funcao\" WHERE \"funcao\".\"empresa_id\" = $1" },
  { table: "funcionario", sql: "DELETE FROM \"funcionario\" WHERE \"funcionario\".\"empresa_id\" = $1" },
  { table: "saldo_endereco", sql: "DELETE FROM \"saldo_endereco\" WHERE \"saldo_endereco\".\"empresa_id\" = $1" },
  { table: "veiculo_wms", sql: "DELETE FROM \"veiculo_wms\" WHERE \"veiculo_wms\".\"empresa_id\" = $1" },
  { table: "usuario_empresa", sql: "DELETE FROM \"usuario_empresa\" WHERE \"usuario_empresa\".\"empresa_id\" = $1" },
  { table: "tipo_carroceria", sql: "DELETE FROM \"tipo_carroceria\" WHERE \"tipo_carroceria\".\"empresa_id\" = $1" },
  { table: "sku", sql: "DELETE FROM \"sku\" WHERE \"sku\".\"empresa_id\" = $1" },
  { table: "audit_log", sql: "DELETE FROM \"audit_log\" WHERE \"audit_log\".\"empresa_id\" = $1" },
  { table: "log_movimentacao", sql: "DELETE FROM \"log_movimentacao\" WHERE \"log_movimentacao\".\"empresa_id\" = $1" },
  { table: "os_funcionario_wms", sql: "DELETE FROM \"os_funcionario_wms\" WHERE EXISTS (SELECT 1 FROM \"ordem_servico_wms\" \"p_ordem_servico_wms_ordem_servico_id\" WHERE \"p_ordem_servico_wms_ordem_servico_id\".\"id\" = \"os_funcionario_wms\".\"ordem_servico_id\" AND \"p_ordem_servico_wms_ordem_servico_id\".\"empresa_id\" = $1)" },
  { table: "dados_logisticos_armazenagem", sql: "DELETE FROM \"dados_logisticos_armazenagem\" WHERE EXISTS (SELECT 1 FROM \"produto\" \"p_dados_logisticos_armazenagem\" WHERE \"p_dados_logisticos_armazenagem\".\"id\" = \"dados_logisticos_armazenagem\".\"produto_id\" AND \"p_dados_logisticos_armazenagem\".\"empresa_id\" = $1)" },
  { table: "dados_logisticos_picking", sql: "DELETE FROM \"dados_logisticos_picking\" WHERE EXISTS (SELECT 1 FROM \"produto\" \"p_dados_logisticos_picking\" WHERE \"p_dados_logisticos_picking\".\"id\" = \"dados_logisticos_picking\".\"produto_id\" AND \"p_dados_logisticos_picking\".\"empresa_id\" = $1)" },
  { table: "dados_logisticos_expedicao", sql: "DELETE FROM \"dados_logisticos_expedicao\" WHERE EXISTS (SELECT 1 FROM \"produto\" \"p_dados_logisticos_expedicao\" WHERE \"p_dados_logisticos_expedicao\".\"id\" = \"dados_logisticos_expedicao\".\"produto_id\" AND \"p_dados_logisticos_expedicao\".\"empresa_id\" = $1)" },
  { table: "item_inventario", sql: "DELETE FROM \"item_inventario\" WHERE EXISTS (SELECT 1 FROM \"inventario\" \"p_inventario_inventario_id\" WHERE \"p_inventario_inventario_id\".\"id\" = \"item_inventario\".\"inventario_id\" AND \"p_inventario_inventario_id\".\"empresa_id\" = $1)" },
  { table: "ficha_operacional", sql: "DELETE FROM \"ficha_operacional\" WHERE \"ficha_operacional\".\"empresa_id\" = $1" },
  { table: "pendencia_logistica", sql: "DELETE FROM \"pendencia_logistica\" WHERE \"pendencia_logistica\".\"empresa_id\" = $1" },
  { table: "turno_producao", sql: "DELETE FROM \"turno_producao\" WHERE \"turno_producao\".\"empresa_id\" = $1" },
  { table: "rota", sql: "DELETE FROM \"rota\" WHERE \"rota\".\"empresa_id\" = $1" },
  { table: "depara_produto_fornecedor", sql: "DELETE FROM \"depara_produto_fornecedor\" WHERE \"depara_produto_fornecedor\".\"empresa_id\" = $1" },
  { table: "capacidade_nivel", sql: "DELETE FROM \"capacidade_nivel\" WHERE \"capacidade_nivel\".\"empresa_id\" = $1" },
  { table: "chamada_doca", sql: "DELETE FROM \"chamada_doca\" WHERE \"chamada_doca\".\"empresa_id\" = $1" },
  { table: "gnre", sql: "DELETE FROM \"gnre\" WHERE \"gnre\".\"empresa_id\" = $1" },
  { table: "xml_importado", sql: "DELETE FROM \"xml_importado\" WHERE \"xml_importado\".\"empresa_id\" = $1" },
  { table: "tipo_cartao", sql: "DELETE FROM \"tipo_cartao\" WHERE \"tipo_cartao\".\"empresa_id\" = $1" },
  { table: "auditoria_fiscal", sql: "DELETE FROM \"auditoria_fiscal\" WHERE \"auditoria_fiscal\".\"empresa_id\" = $1" },
  { table: "natureza_operacao", sql: "DELETE FROM \"natureza_operacao\" WHERE \"natureza_operacao\".\"empresa_id\" = $1" },
  { table: "tipo_cor", sql: "DELETE FROM \"tipo_cor\" WHERE \"tipo_cor\".\"empresa_id\" = $1" },
  { table: "tipo_formato", sql: "DELETE FROM \"tipo_formato\" WHERE \"tipo_formato\".\"empresa_id\" = $1" },
  { table: "tipo_gramatura", sql: "DELETE FROM \"tipo_gramatura\" WHERE \"tipo_gramatura\".\"empresa_id\" = $1" },
  { table: "tipo_policromia", sql: "DELETE FROM \"tipo_policromia\" WHERE \"tipo_policromia\".\"empresa_id\" = $1" },
  { table: "tipo_verniz", sql: "DELETE FROM \"tipo_verniz\" WHERE \"tipo_verniz\".\"empresa_id\" = $1" },
  { table: "atributo_grafico", sql: "DELETE FROM \"atributo_grafico\" WHERE \"atributo_grafico\".\"empresa_id\" = $1" },
  { table: "item_estrutura", sql: "DELETE FROM \"item_estrutura\" WHERE EXISTS (SELECT 1 FROM \"estrutura_produto\" \"p_estrutura_produto_estrutura_produto_id\" WHERE \"p_estrutura_produto_estrutura_produto_id\".\"id\" = \"item_estrutura\".\"estrutura_produto_id\" AND \"p_estrutura_produto_estrutura_produto_id\".\"empresa_id\" = $1)" },
  { table: "variacao_ordem_producao", sql: "DELETE FROM \"variacao_ordem_producao\" WHERE EXISTS (SELECT 1 FROM \"ordem_producao\" \"p_ordem_producao_ordem_producao_id\" WHERE \"p_ordem_producao_ordem_producao_id\".\"id\" = \"variacao_ordem_producao\".\"ordem_producao_id\" AND \"p_ordem_producao_ordem_producao_id\".\"empresa_id\" = $1)" },
  { table: "etapa_roteiro", sql: "DELETE FROM \"etapa_roteiro\" WHERE EXISTS (SELECT 1 FROM \"roteiro_producao\" \"p_roteiro_producao_roteiro_producao_id\" WHERE \"p_roteiro_producao_roteiro_producao_id\".\"id\" = \"etapa_roteiro\".\"roteiro_producao_id\" AND \"p_roteiro_producao_roteiro_producao_id\".\"empresa_id\" = $1) OR EXISTS (SELECT 1 FROM \"centro_producao\" \"p_centro_producao_centro_producao_id\" WHERE \"p_centro_producao_centro_producao_id\".\"id\" = \"etapa_roteiro\".\"centro_producao_id\" AND \"p_centro_producao_centro_producao_id\".\"empresa_id\" = $1) OR EXISTS (SELECT 1 FROM \"recurso_producao\" \"p_recurso_producao_recurso_id\" WHERE \"p_recurso_producao_recurso_id\".\"id\" = \"etapa_roteiro\".\"recurso_id\" AND \"p_recurso_producao_recurso_id\".\"empresa_id\" = $1)" },
  { table: "mapa_carregamento_nf", sql: "DELETE FROM \"mapa_carregamento_nf\" WHERE EXISTS (SELECT 1 FROM \"mapa_carregamento\" \"p_mapa_carregamento_mapa_carregamento_id\" WHERE \"p_mapa_carregamento_mapa_carregamento_id\".\"id\" = \"mapa_carregamento_nf\".\"mapa_carregamento_id\" AND \"p_mapa_carregamento_mapa_carregamento_id\".\"empresa_id\" = $1) OR EXISTS (SELECT 1 FROM \"documento_fiscal\" \"p_documento_fiscal_nfe_id\" WHERE \"p_documento_fiscal_nfe_id\".\"id\" = \"mapa_carregamento_nf\".\"nfe_id\" AND \"p_documento_fiscal_nfe_id\".\"empresa_id\" = $1)" },
  { table: "fila_espera_patio", sql: "DELETE FROM \"fila_espera_patio\" WHERE \"fila_espera_patio\".\"empresa_id\" = $1" },
  { table: "item_conferencia_saida", sql: "DELETE FROM \"item_conferencia_saida\" WHERE EXISTS (SELECT 1 FROM \"conferencia_saida\" \"p_conferencia_saida_conferencia_saida_id\" WHERE \"p_conferencia_saida_conferencia_saida_id\".\"id\" = \"item_conferencia_saida\".\"conferencia_saida_id\" AND EXISTS (SELECT 1 FROM \"onda_separacao\" \"p_onda_separacao_onda_separacao_id\" WHERE \"p_onda_separacao_onda_separacao_id\".\"id\" = \"p_conferencia_saida_conferencia_saida_id\".\"onda_separacao_id\" AND \"p_onda_separacao_onda_separacao_id\".\"empresa_id\" = $1)) OR EXISTS (SELECT 1 FROM \"item_separacao\" \"p_item_separacao_item_separacao_id\" WHERE \"p_item_separacao_item_separacao_id\".\"id\" = \"item_conferencia_saida\".\"item_separacao_id\" AND EXISTS (SELECT 1 FROM \"ordem_separacao\" \"p_ordem_separacao_ordem_separacao_id\" WHERE \"p_ordem_separacao_ordem_separacao_id\".\"id\" = \"p_item_separacao_item_separacao_id\".\"ordem_separacao_id\" AND EXISTS (SELECT 1 FROM \"onda_separacao\" \"p_onda_separacao_onda_separacao_id\" WHERE \"p_onda_separacao_onda_separacao_id\".\"id\" = \"p_ordem_separacao_ordem_separacao_id\".\"onda_separacao_id\" AND \"p_onda_separacao_onda_separacao_id\".\"empresa_id\" = $1)))" },
  { table: "item_volume", sql: "DELETE FROM \"item_volume\" WHERE EXISTS (SELECT 1 FROM \"volume\" \"p_volume_volume_id\" WHERE \"p_volume_volume_id\".\"id\" = \"item_volume\".\"volume_id\" AND EXISTS (SELECT 1 FROM \"onda_separacao\" \"p_onda_separacao_onda_separacao_id\" WHERE \"p_onda_separacao_onda_separacao_id\".\"id\" = \"p_volume_volume_id\".\"onda_separacao_id\" AND \"p_onda_separacao_onda_separacao_id\".\"empresa_id\" = $1)) OR EXISTS (SELECT 1 FROM \"item_separacao\" \"p_item_separacao_item_separacao_id\" WHERE \"p_item_separacao_item_separacao_id\".\"id\" = \"item_volume\".\"item_separacao_id\" AND EXISTS (SELECT 1 FROM \"ordem_separacao\" \"p_ordem_separacao_ordem_separacao_id\" WHERE \"p_ordem_separacao_ordem_separacao_id\".\"id\" = \"p_item_separacao_item_separacao_id\".\"ordem_separacao_id\" AND EXISTS (SELECT 1 FROM \"onda_separacao\" \"p_onda_separacao_onda_separacao_id\" WHERE \"p_onda_separacao_onda_separacao_id\".\"id\" = \"p_ordem_separacao_ordem_separacao_id\".\"onda_separacao_id\" AND \"p_onda_separacao_onda_separacao_id\".\"empresa_id\" = $1)))" },
  { table: "carregamento_volume", sql: "DELETE FROM \"carregamento_volume\" WHERE EXISTS (SELECT 1 FROM \"carregamento\" \"p_carregamento_carregamento_id\" WHERE \"p_carregamento_carregamento_id\".\"id\" = \"carregamento_volume\".\"carregamento_id\" AND \"p_carregamento_carregamento_id\".\"empresa_id\" = $1) OR EXISTS (SELECT 1 FROM \"volume\" \"p_volume_volume_id\" WHERE \"p_volume_volume_id\".\"id\" = \"carregamento_volume\".\"volume_id\" AND EXISTS (SELECT 1 FROM \"onda_separacao\" \"p_onda_separacao_onda_separacao_id\" WHERE \"p_onda_separacao_onda_separacao_id\".\"id\" = \"p_volume_volume_id\".\"onda_separacao_id\" AND \"p_onda_separacao_onda_separacao_id\".\"empresa_id\" = $1))" },
  { table: "cross_dock_item", sql: "DELETE FROM \"cross_dock_item\" WHERE \"cross_dock_item\".\"empresa_id\" = $1" },
  { table: "staging_area", sql: "DELETE FROM \"staging_area\" WHERE \"staging_area\".\"empresa_id\" = $1" },
  { table: "item_nota_entrada", sql: "DELETE FROM \"item_nota_entrada\" WHERE EXISTS (SELECT 1 FROM \"nota_entrada\" \"p_nota_entrada_nota_entrada_id\" WHERE \"p_nota_entrada_nota_entrada_id\".\"id\" = \"item_nota_entrada\".\"nota_entrada_id\" AND \"p_nota_entrada_nota_entrada_id\".\"empresa_id\" = $1)" },
  { table: "item_pedido_venda", sql: "DELETE FROM \"item_pedido_venda\" WHERE EXISTS (SELECT 1 FROM \"pedido_venda\" \"p_pedido_venda_pedido_venda_id\" WHERE \"p_pedido_venda_pedido_venda_id\".\"id\" = \"item_pedido_venda\".\"pedido_venda_id\" AND \"p_pedido_venda_pedido_venda_id\".\"empresa_id\" = $1) OR EXISTS (SELECT 1 FROM \"produto\" \"p_produto_produto_id\" WHERE \"p_produto_produto_id\".\"id\" = \"item_pedido_venda\".\"produto_id\" AND \"p_produto_produto_id\".\"empresa_id\" = $1)" },
  { table: "conta_receber", sql: "DELETE FROM \"conta_receber\" WHERE \"conta_receber\".\"empresa_id\" = $1" },
  { table: "item_devolucao_compra", sql: "DELETE FROM \"item_devolucao_compra\" WHERE EXISTS (SELECT 1 FROM \"devolucao_compra\" \"p_devolucao_compra_devolucao_compra_id\" WHERE \"p_devolucao_compra_devolucao_compra_id\".\"id\" = \"item_devolucao_compra\".\"devolucao_compra_id\" AND \"p_devolucao_compra_devolucao_compra_id\".\"empresa_id\" = $1) OR EXISTS (SELECT 1 FROM \"produto\" \"p_produto_produto_id\" WHERE \"p_produto_produto_id\".\"id\" = \"item_devolucao_compra\".\"produto_id\" AND \"p_produto_produto_id\".\"empresa_id\" = $1)" },
  { table: "item_autorizacao_retorno", sql: "DELETE FROM \"item_autorizacao_retorno\" WHERE EXISTS (SELECT 1 FROM \"autorizacao_retorno\" \"p_autorizacao_retorno_autorizacao_retorno_id\" WHERE \"p_autorizacao_retorno_autorizacao_retorno_id\".\"id\" = \"item_autorizacao_retorno\".\"autorizacao_retorno_id\" AND \"p_autorizacao_retorno_autorizacao_retorno_id\".\"empresa_id\" = $1)" },
  { table: "item_liberacao", sql: "DELETE FROM \"item_liberacao\" WHERE EXISTS (SELECT 1 FROM \"liberacao_material\" \"p_liberacao_material_liberacao_material_id\" WHERE \"p_liberacao_material_liberacao_material_id\".\"id\" = \"item_liberacao\".\"liberacao_material_id\" AND \"p_liberacao_material_liberacao_material_id\".\"empresa_id\" = $1) OR EXISTS (SELECT 1 FROM \"item_ordem_producao\" \"p_item_ordem_producao_item_ordem_producao_id\" WHERE \"p_item_ordem_producao_item_ordem_producao_id\".\"id\" = \"item_liberacao\".\"item_ordem_producao_id\" AND \"p_item_ordem_producao_item_ordem_producao_id\".\"empresa_id\" = $1)" },
  { table: "bloqueio_slot_doca", sql: "DELETE FROM \"bloqueio_slot_doca\" WHERE \"bloqueio_slot_doca\".\"empresa_id\" = $1" },
  { table: "config_doca", sql: "DELETE FROM \"config_doca\" WHERE \"config_doca\".\"empresa_id\" = $1" },
  { table: "impressora_rede", sql: "DELETE FROM \"impressora_rede\" WHERE \"impressora_rede\".\"empresa_id\" = $1" },
  { table: "fila_impressao", sql: "DELETE FROM \"fila_impressao\" WHERE \"fila_impressao\".\"empresa_id\" = $1" },
  { table: "versao_template_etiqueta", sql: "DELETE FROM \"versao_template_etiqueta\" WHERE EXISTS (SELECT 1 FROM \"template_etiqueta\" \"p_template_etiqueta_template_etiqueta_id\" WHERE \"p_template_etiqueta_template_etiqueta_id\".\"id\" = \"versao_template_etiqueta\".\"template_etiqueta_id\" AND \"p_template_etiqueta_template_etiqueta_id\".\"empresa_id\" = $1)" },
  { table: "tarifa_contrato", sql: "DELETE FROM \"tarifa_contrato\" WHERE EXISTS (SELECT 1 FROM \"contrato_armazenagem\" \"p_contrato_armazenagem_contrato_id\" WHERE \"p_contrato_armazenagem_contrato_id\".\"id\" = \"tarifa_contrato\".\"contrato_id\" AND \"p_contrato_armazenagem_contrato_id\".\"empresa_id\" = $1)" },
  { table: "medicao_ocupacao", sql: "DELETE FROM \"medicao_ocupacao\" WHERE \"medicao_ocupacao\".\"empresa_id\" = $1" },
  { table: "item_fatura", sql: "DELETE FROM \"item_fatura\" WHERE EXISTS (SELECT 1 FROM \"fatura_armazenagem\" \"p_fatura_armazenagem_fatura_id\" WHERE \"p_fatura_armazenagem_fatura_id\".\"id\" = \"item_fatura\".\"fatura_id\" AND \"p_fatura_armazenagem_fatura_id\".\"empresa_id\" = $1)" },
  { table: "previsao_demanda", sql: "DELETE FROM \"previsao_demanda\" WHERE \"previsao_demanda\".\"empresa_id\" = $1" },
  { table: "classificacao_abc", sql: "DELETE FROM \"classificacao_abc\" WHERE \"classificacao_abc\".\"empresa_id\" = $1" },
  { table: "sugestao_slotting", sql: "DELETE FROM \"sugestao_slotting\" WHERE \"sugestao_slotting\".\"empresa_id\" = $1" },
  { table: "config_previsao", sql: "DELETE FROM \"config_previsao\" WHERE \"config_previsao\".\"empresa_id\" = $1" },
  { table: "movimentacao_faturavel", sql: "DELETE FROM \"movimentacao_faturavel\" WHERE \"movimentacao_faturavel\".\"empresa_id\" = $1" },
  { table: "item_orcamento", sql: "DELETE FROM \"item_orcamento\" WHERE EXISTS (SELECT 1 FROM \"produto\" \"p_produto_produto_id\" WHERE \"p_produto_produto_id\".\"id\" = \"item_orcamento\".\"produto_id\" AND \"p_produto_produto_id\".\"empresa_id\" = $1) OR EXISTS (SELECT 1 FROM \"orcamento\" \"p_orcamento_orcamento_id\" WHERE \"p_orcamento_orcamento_id\".\"id\" = \"item_orcamento\".\"orcamento_id\" AND \"p_orcamento_orcamento_id\".\"empresa_id\" = $1)" },
  { table: "snapshot_bi", sql: "DELETE FROM \"snapshot_bi\" WHERE \"snapshot_bi\".\"empresa_id\" = $1" },
  { table: "item_solicitacao_expedicao_portal", sql: "DELETE FROM \"item_solicitacao_expedicao_portal\" WHERE EXISTS (SELECT 1 FROM \"solicitacao_expedicao_portal\" \"p_solicitacao_expedicao_portal_solicitacao_id\" WHERE \"p_solicitacao_expedicao_portal_solicitacao_id\".\"id\" = \"item_solicitacao_expedicao_portal\".\"solicitacao_id\" AND \"p_solicitacao_expedicao_portal_solicitacao_id\".\"empresa_id\" = $1)" },
  { table: "notificacao_portal", sql: "DELETE FROM \"notificacao_portal\" WHERE \"notificacao_portal\".\"empresa_id\" = $1" },
  { table: "custo_operacao", sql: "DELETE FROM \"custo_operacao\" WHERE \"custo_operacao\".\"empresa_id\" = $1" },
  { table: "config_custo", sql: "DELETE FROM \"config_custo\" WHERE \"config_custo\".\"empresa_id\" = $1" },
  { table: "alerta_correlacao", sql: "DELETE FROM \"alerta_correlacao\" WHERE \"alerta_correlacao\".\"empresa_id\" = $1" },
  { table: "regra_onda", sql: "DELETE FROM \"regra_onda\" WHERE \"regra_onda\".\"empresa_id\" = $1" },
  { table: "simulacao_onda", sql: "DELETE FROM \"simulacao_onda\" WHERE EXISTS (SELECT 1 FROM \"planejamento_onda\" \"p_planejamento_onda_planejamento_onda_id\" WHERE \"p_planejamento_onda_planejamento_onda_id\".\"id\" = \"simulacao_onda\".\"planejamento_onda_id\" AND \"p_planejamento_onda_planejamento_onda_id\".\"empresa_id\" = $1)" },
  { table: "endereco_zona_picking", sql: "DELETE FROM \"endereco_zona_picking\" WHERE EXISTS (SELECT 1 FROM \"zona_picking\" \"p_zona_picking_zona_picking_id\" WHERE \"p_zona_picking_zona_picking_id\".\"id\" = \"endereco_zona_picking\".\"zona_picking_id\" AND \"p_zona_picking_zona_picking_id\".\"empresa_id\" = $1)" },
  { table: "separador_zona", sql: "DELETE FROM \"separador_zona\" WHERE EXISTS (SELECT 1 FROM \"zona_picking\" \"p_zona_picking_zona_picking_id\" WHERE \"p_zona_picking_zona_picking_id\".\"id\" = \"separador_zona\".\"zona_picking_id\" AND \"p_zona_picking_zona_picking_id\".\"empresa_id\" = $1)" },
  { table: "ponto_consolidacao", sql: "DELETE FROM \"ponto_consolidacao\" WHERE \"ponto_consolidacao\".\"empresa_id\" = $1" },
  { table: "item_sub_onda", sql: "DELETE FROM \"item_sub_onda\" WHERE EXISTS (SELECT 1 FROM \"sub_onda\" \"p_sub_onda_sub_onda_id\" WHERE \"p_sub_onda_sub_onda_id\".\"id\" = \"item_sub_onda\".\"sub_onda_id\" AND \"p_sub_onda_sub_onda_id\".\"empresa_id\" = $1) OR EXISTS (SELECT 1 FROM \"produto\" \"p_produto_produto_id\" WHERE \"p_produto_produto_id\".\"id\" = \"item_sub_onda\".\"produto_id\" AND \"p_produto_produto_id\".\"empresa_id\" = $1)" },
  { table: "registro_produtividade", sql: "DELETE FROM \"registro_produtividade\" WHERE \"registro_produtividade\".\"empresa_id\" = $1" },
  { table: "config_conferencia_produto", sql: "DELETE FROM \"config_conferencia_produto\" WHERE \"config_conferencia_produto\".\"empresa_id\" = $1" },
  { table: "config_incentivo", sql: "DELETE FROM \"config_incentivo\" WHERE \"config_incentivo\".\"empresa_id\" = $1" },
  { table: "pausa_operador", sql: "DELETE FROM \"pausa_operador\" WHERE \"pausa_operador\".\"empresa_id\" = $1" },
  { table: "de_para_importacao", sql: "DELETE FROM \"de_para_importacao\" WHERE \"de_para_importacao\".\"empresa_id\" = $1" },
  { table: "historico_meta_operacao", sql: "DELETE FROM \"historico_meta_operacao\" WHERE EXISTS (SELECT 1 FROM \"meta_operacao\" \"p_meta_operacao_meta_operacao_id\" WHERE \"p_meta_operacao_meta_operacao_id\".\"id\" = \"historico_meta_operacao\".\"meta_operacao_id\" AND \"p_meta_operacao_meta_operacao_id\".\"empresa_id\" = $1)" },
  { table: "config_patio", sql: "DELETE FROM \"config_patio\" WHERE \"config_patio\".\"empresa_id\" = $1" },
  { table: "apontamento_producao", sql: "DELETE FROM \"apontamento_producao\" WHERE \"apontamento_producao\".\"empresa_id\" = $1" },
  { table: "regra_comissao", sql: "DELETE FROM \"regra_comissao\" WHERE \"regra_comissao\".\"empresa_id\" = $1" },
  { table: "regra_aprovacao", sql: "DELETE FROM \"regra_aprovacao\" WHERE \"regra_aprovacao\".\"empresa_id\" = $1" },
  { table: "solicitacao_aprovacao", sql: "DELETE FROM \"solicitacao_aprovacao\" WHERE \"solicitacao_aprovacao\".\"empresa_id\" = $1" },
  { table: "meta_vendedor", sql: "DELETE FROM \"meta_vendedor\" WHERE \"meta_vendedor\".\"empresa_id\" = $1" },
  { table: "regra_bonificacao", sql: "DELETE FROM \"regra_bonificacao\" WHERE \"regra_bonificacao\".\"empresa_id\" = $1" },
  { table: "item_devolucao_venda", sql: "DELETE FROM \"item_devolucao_venda\" WHERE EXISTS (SELECT 1 FROM \"produto\" \"p_produto_produto_id\" WHERE \"p_produto_produto_id\".\"id\" = \"item_devolucao_venda\".\"produto_id\" AND \"p_produto_produto_id\".\"empresa_id\" = $1) OR EXISTS (SELECT 1 FROM \"devolucao_venda\" \"p_devolucao_venda_devolucao_venda_id\" WHERE \"p_devolucao_venda_devolucao_venda_id\".\"id\" = \"item_devolucao_venda\".\"devolucao_venda_id\" AND \"p_devolucao_venda_devolucao_venda_id\".\"empresa_id\" = $1)" },
  { table: "campanha_desconto", sql: "DELETE FROM \"campanha_desconto\" WHERE \"campanha_desconto\".\"empresa_id\" = $1" },
  { table: "log_ordem_producao", sql: "DELETE FROM \"log_ordem_producao\" WHERE EXISTS (SELECT 1 FROM \"ordem_producao\" \"p_ordem_producao_ordem_producao_id\" WHERE \"p_ordem_producao_ordem_producao_id\".\"id\" = \"log_ordem_producao\".\"ordem_producao_id\" AND \"p_ordem_producao_ordem_producao_id\".\"empresa_id\" = $1)" },
  { table: "item_consignacao", sql: "DELETE FROM \"item_consignacao\" WHERE EXISTS (SELECT 1 FROM \"remessa_consignacao\" \"p_remessa_consignacao_remessa_id\" WHERE \"p_remessa_consignacao_remessa_id\".\"id\" = \"item_consignacao\".\"remessa_id\" AND \"p_remessa_consignacao_remessa_id\".\"empresa_id\" = $1)" },
  { table: "integracao_ecommerce", sql: "DELETE FROM \"integracao_ecommerce\" WHERE \"integracao_ecommerce\".\"empresa_id\" = $1" },
  { table: "pedido_ecommerce", sql: "DELETE FROM \"pedido_ecommerce\" WHERE \"pedido_ecommerce\".\"empresa_id\" = $1" },
  { table: "item_documento_fiscal", sql: "DELETE FROM \"item_documento_fiscal\" WHERE EXISTS (SELECT 1 FROM \"documento_fiscal\" \"p_documento_fiscal_documento_fiscal_id\" WHERE \"p_documento_fiscal_documento_fiscal_id\".\"id\" = \"item_documento_fiscal\".\"documento_fiscal_id\" AND \"p_documento_fiscal_documento_fiscal_id\".\"empresa_id\" = $1) OR EXISTS (SELECT 1 FROM \"produto\" \"p_produto_produto_id\" WHERE \"p_produto_produto_id\".\"id\" = \"item_documento_fiscal\".\"produto_id\" AND \"p_produto_produto_id\".\"empresa_id\" = $1) OR EXISTS (SELECT 1 FROM \"regra_tributaria\" \"p_regra_tributaria_regra_tributaria_id\" WHERE \"p_regra_tributaria_regra_tributaria_id\".\"id\" = \"item_documento_fiscal\".\"regra_tributaria_id\" AND \"p_regra_tributaria_regra_tributaria_id\".\"empresa_id\" = $1)" },
  { table: "venda_encomenda", sql: "DELETE FROM \"venda_encomenda\" WHERE \"venda_encomenda\".\"empresa_id\" = $1" },
  { table: "apontamento_etapa", sql: "DELETE FROM \"apontamento_etapa\" WHERE \"apontamento_etapa\".\"empresa_id\" = $1" },
  { table: "certificado_digital", sql: "DELETE FROM \"certificado_digital\" WHERE \"certificado_digital\".\"empresa_id\" = $1" },
  { table: "fila_contingencia", sql: "DELETE FROM \"fila_contingencia\" WHERE \"fila_contingencia\".\"empresa_id\" = $1" },
  { table: "log_contingencia", sql: "DELETE FROM \"log_contingencia\" WHERE \"log_contingencia\".\"empresa_id\" = $1" },
  { table: "detalhe_apuracao", sql: "DELETE FROM \"detalhe_apuracao\" WHERE EXISTS (SELECT 1 FROM \"apuracao_fiscal\" \"p_apuracao_fiscal_apuracao_id\" WHERE \"p_apuracao_fiscal_apuracao_id\".\"id\" = \"detalhe_apuracao\".\"apuracao_id\" AND \"p_apuracao_fiscal_apuracao_id\".\"empresa_id\" = $1)" },
  { table: "evento_documento_fiscal", sql: "DELETE FROM \"evento_documento_fiscal\" WHERE EXISTS (SELECT 1 FROM \"documento_fiscal\" \"p_documento_fiscal_documento_fiscal_id\" WHERE \"p_documento_fiscal_documento_fiscal_id\".\"id\" = \"evento_documento_fiscal\".\"documento_fiscal_id\" AND \"p_documento_fiscal_documento_fiscal_id\".\"empresa_id\" = $1)" },
  { table: "item_venda_pdv", sql: "DELETE FROM \"item_venda_pdv\" WHERE EXISTS (SELECT 1 FROM \"venda_pdv\" \"p_venda_pdv_venda_pdv_id\" WHERE \"p_venda_pdv_venda_pdv_id\".\"id\" = \"item_venda_pdv\".\"venda_pdv_id\" AND \"p_venda_pdv_venda_pdv_id\".\"empresa_id\" = $1) OR EXISTS (SELECT 1 FROM \"produto\" \"p_produto_produto_id\" WHERE \"p_produto_produto_id\".\"id\" = \"item_venda_pdv\".\"produto_id\" AND \"p_produto_produto_id\".\"empresa_id\" = $1)" },
  { table: "pagamento_pdv", sql: "DELETE FROM \"pagamento_pdv\" WHERE EXISTS (SELECT 1 FROM \"venda_pdv\" \"p_venda_pdv_venda_pdv_id\" WHERE \"p_venda_pdv_venda_pdv_id\".\"id\" = \"pagamento_pdv\".\"venda_pdv_id\" AND \"p_venda_pdv_venda_pdv_id\".\"empresa_id\" = $1)" },
  { table: "conversa_ai", sql: "DELETE FROM \"conversa_ai\" WHERE \"conversa_ai\".\"empresa_id\" = $1" },
  { table: "mercadoria_transito", sql: "DELETE FROM \"mercadoria_transito\" WHERE \"mercadoria_transito\".\"empresa_id\" = $1" },
  { table: "movimentacao_caixa", sql: "DELETE FROM \"movimentacao_caixa\" WHERE EXISTS (SELECT 1 FROM \"caixa_pdv\" \"p_caixa_pdv_caixa_id\" WHERE \"p_caixa_pdv_caixa_id\".\"id\" = \"movimentacao_caixa\".\"caixa_id\" AND \"p_caixa_pdv_caixa_id\".\"empresa_id\" = $1)" },
  { table: "item_solicitacao_transferencia", sql: "DELETE FROM \"item_solicitacao_transferencia\" WHERE EXISTS (SELECT 1 FROM \"solicitacao_transferencia\" \"p_solicitacao_transferencia_solicitacao_id\" WHERE \"p_solicitacao_transferencia_solicitacao_id\".\"id\" = \"item_solicitacao_transferencia\".\"solicitacao_id\" AND \"p_solicitacao_transferencia_solicitacao_id\".\"empresa_id\" = $1) OR EXISTS (SELECT 1 FROM \"produto\" \"p_produto_produto_id\" WHERE \"p_produto_produto_id\".\"id\" = \"item_solicitacao_transferencia\".\"produto_id\" AND \"p_produto_produto_id\".\"empresa_id\" = $1)" },
  { table: "transferencia_estoque", sql: "DELETE FROM \"transferencia_estoque\" WHERE (\"transferencia_estoque\".\"empresa_origem_id\" = $1 OR \"transferencia_estoque\".\"empresa_destino_id\" = $1)" },
  { table: "cte", sql: "DELETE FROM \"cte\" WHERE \"cte\".\"empresa_id\" = $1" },
  { table: "divergencia_conferencia", sql: "DELETE FROM \"divergencia_conferencia\" WHERE \"divergencia_conferencia\".\"empresa_id\" = $1" },
  { table: "webhook_config", sql: "DELETE FROM \"webhook_config\" WHERE \"webhook_config\".\"empresa_id\" = $1" },
  { table: "api_key", sql: "DELETE FROM \"api_key\" WHERE \"api_key\".\"empresa_id\" = $1" },
  { table: "regra_kpi", sql: "DELETE FROM \"regra_kpi\" WHERE \"regra_kpi\".\"empresa_id\" = $1" },
  { table: "endereco", sql: "DELETE FROM \"endereco\" WHERE \"endereco\".\"empresa_id\" = $1" },
  { table: "inventario", sql: "DELETE FROM \"inventario\" WHERE \"inventario\".\"empresa_id\" = $1" },
  { table: "roteiro_producao", sql: "DELETE FROM \"roteiro_producao\" WHERE \"roteiro_producao\".\"empresa_id\" = $1" },
  { table: "mapa_carregamento", sql: "DELETE FROM \"mapa_carregamento\" WHERE \"mapa_carregamento\".\"empresa_id\" = $1" },
  { table: "veiculo_patio", sql: "DELETE FROM \"veiculo_patio\" WHERE \"veiculo_patio\".\"empresa_id\" = $1" },
  { table: "conferencia_saida", sql: "DELETE FROM \"conferencia_saida\" WHERE EXISTS (SELECT 1 FROM \"onda_separacao\" \"p_onda_separacao_onda_separacao_id\" WHERE \"p_onda_separacao_onda_separacao_id\".\"id\" = \"conferencia_saida\".\"onda_separacao_id\" AND \"p_onda_separacao_onda_separacao_id\".\"empresa_id\" = $1)" },
  { table: "item_separacao", sql: "DELETE FROM \"item_separacao\" WHERE EXISTS (SELECT 1 FROM \"ordem_separacao\" \"p_ordem_separacao_ordem_separacao_id\" WHERE \"p_ordem_separacao_ordem_separacao_id\".\"id\" = \"item_separacao\".\"ordem_separacao_id\" AND EXISTS (SELECT 1 FROM \"onda_separacao\" \"p_onda_separacao_onda_separacao_id\" WHERE \"p_onda_separacao_onda_separacao_id\".\"id\" = \"p_ordem_separacao_ordem_separacao_id\".\"onda_separacao_id\" AND \"p_onda_separacao_onda_separacao_id\".\"empresa_id\" = $1))" },
  { table: "volume", sql: "DELETE FROM \"volume\" WHERE EXISTS (SELECT 1 FROM \"onda_separacao\" \"p_onda_separacao_onda_separacao_id\" WHERE \"p_onda_separacao_onda_separacao_id\".\"id\" = \"volume\".\"onda_separacao_id\" AND \"p_onda_separacao_onda_separacao_id\".\"empresa_id\" = $1)" },
  { table: "devolucao_compra", sql: "DELETE FROM \"devolucao_compra\" WHERE \"devolucao_compra\".\"empresa_id\" = $1" },
  { table: "autorizacao_retorno", sql: "DELETE FROM \"autorizacao_retorno\" WHERE \"autorizacao_retorno\".\"empresa_id\" = $1" },
  { table: "liberacao_material", sql: "DELETE FROM \"liberacao_material\" WHERE \"liberacao_material\".\"empresa_id\" = $1" },
  { table: "item_ordem_producao", sql: "DELETE FROM \"item_ordem_producao\" WHERE \"item_ordem_producao\".\"empresa_id\" = $1" },
  { table: "template_etiqueta", sql: "DELETE FROM \"template_etiqueta\" WHERE \"template_etiqueta\".\"empresa_id\" = $1" },
  { table: "fatura_armazenagem", sql: "DELETE FROM \"fatura_armazenagem\" WHERE \"fatura_armazenagem\".\"empresa_id\" = $1" },
  { table: "orcamento", sql: "DELETE FROM \"orcamento\" WHERE \"orcamento\".\"empresa_id\" = $1" },
  { table: "solicitacao_expedicao_portal", sql: "DELETE FROM \"solicitacao_expedicao_portal\" WHERE \"solicitacao_expedicao_portal\".\"empresa_id\" = $1" },
  { table: "planejamento_onda", sql: "DELETE FROM \"planejamento_onda\" WHERE \"planejamento_onda\".\"empresa_id\" = $1" },
  { table: "sub_onda", sql: "DELETE FROM \"sub_onda\" WHERE \"sub_onda\".\"empresa_id\" = $1" },
  { table: "ordem_servico_wms", sql: "DELETE FROM \"ordem_servico_wms\" WHERE \"ordem_servico_wms\".\"empresa_id\" = $1" },
  { table: "meta_operacao", sql: "DELETE FROM \"meta_operacao\" WHERE \"meta_operacao\".\"empresa_id\" = $1" },
  { table: "devolucao_venda", sql: "DELETE FROM \"devolucao_venda\" WHERE \"devolucao_venda\".\"empresa_id\" = $1" },
  { table: "remessa_consignacao", sql: "DELETE FROM \"remessa_consignacao\" WHERE \"remessa_consignacao\".\"empresa_id\" = $1" },
  { table: "regra_tributaria", sql: "DELETE FROM \"regra_tributaria\" WHERE \"regra_tributaria\".\"empresa_id\" = $1" },
  { table: "etapa_ordem_producao", sql: "DELETE FROM \"etapa_ordem_producao\" WHERE EXISTS (SELECT 1 FROM \"ordem_producao\" \"p_ordem_producao_ordem_producao_id\" WHERE \"p_ordem_producao_ordem_producao_id\".\"id\" = \"etapa_ordem_producao\".\"ordem_producao_id\" AND \"p_ordem_producao_ordem_producao_id\".\"empresa_id\" = $1) OR EXISTS (SELECT 1 FROM \"recurso_producao\" \"p_recurso_producao_recurso_id\" WHERE \"p_recurso_producao_recurso_id\".\"id\" = \"etapa_ordem_producao\".\"recurso_id\" AND \"p_recurso_producao_recurso_id\".\"empresa_id\" = $1) OR EXISTS (SELECT 1 FROM \"centro_producao\" \"p_centro_producao_centro_producao_id\" WHERE \"p_centro_producao_centro_producao_id\".\"id\" = \"etapa_ordem_producao\".\"centro_producao_id\" AND \"p_centro_producao_centro_producao_id\".\"empresa_id\" = $1)" },
  { table: "apuracao_fiscal", sql: "DELETE FROM \"apuracao_fiscal\" WHERE \"apuracao_fiscal\".\"empresa_id\" = $1" },
  { table: "documento_fiscal", sql: "DELETE FROM \"documento_fiscal\" WHERE \"documento_fiscal\".\"empresa_id\" = $1" },
  { table: "venda_pdv", sql: "DELETE FROM \"venda_pdv\" WHERE \"venda_pdv\".\"empresa_id\" = $1" },
  { table: "documento_saida_transferencia", sql: "DELETE FROM \"documento_saida_transferencia\" WHERE \"documento_saida_transferencia\".\"empresa_id\" = $1" },
  { table: "produto", sql: "DELETE FROM \"produto\" WHERE \"produto\".\"empresa_id\" = $1" },
  { table: "nota_entrada", sql: "DELETE FROM \"nota_entrada\" WHERE \"nota_entrada\".\"empresa_id\" = $1" },
  { table: "zona", sql: "DELETE FROM \"zona\" WHERE \"zona\".\"empresa_id\" = $1" },
  { table: "estrutura", sql: "DELETE FROM \"estrutura\" WHERE \"estrutura\".\"empresa_id\" = $1" },
  { table: "forma_armazenagem", sql: "DELETE FROM \"forma_armazenagem\" WHERE \"forma_armazenagem\".\"empresa_id\" = $1" },
  { table: "ambiente_armazenagem", sql: "DELETE FROM \"ambiente_armazenagem\" WHERE \"ambiente_armazenagem\".\"empresa_id\" = $1" },
  { table: "classificacao_produto", sql: "DELETE FROM \"classificacao_produto\" WHERE \"classificacao_produto\".\"empresa_id\" = $1" },
  { table: "agenda_wms", sql: "DELETE FROM \"agenda_wms\" WHERE \"agenda_wms\".\"empresa_id\" = $1" },
  { table: "doca", sql: "DELETE FROM \"doca\" WHERE \"doca\".\"empresa_id\" = $1" },
  { table: "ordem_separacao", sql: "DELETE FROM \"ordem_separacao\" WHERE EXISTS (SELECT 1 FROM \"onda_separacao\" \"p_onda_separacao_onda_separacao_id\" WHERE \"p_onda_separacao_onda_separacao_id\".\"id\" = \"ordem_separacao\".\"onda_separacao_id\" AND \"p_onda_separacao_onda_separacao_id\".\"empresa_id\" = $1)" },
  { table: "contrato_armazenagem", sql: "DELETE FROM \"contrato_armazenagem\" WHERE \"contrato_armazenagem\".\"empresa_id\" = $1" },
  { table: "portal_usuario", sql: "DELETE FROM \"portal_usuario\" WHERE \"portal_usuario\".\"empresa_id\" = $1" },
  { table: "zona_picking", sql: "DELETE FROM \"zona_picking\" WHERE \"zona_picking\".\"empresa_id\" = $1" },
  { table: "carregamento", sql: "DELETE FROM \"carregamento\" WHERE \"carregamento\".\"empresa_id\" = $1" },
  { table: "ordem_producao", sql: "DELETE FROM \"ordem_producao\" WHERE \"ordem_producao\".\"empresa_id\" = $1" },
  { table: "recurso_producao", sql: "DELETE FROM \"recurso_producao\" WHERE \"recurso_producao\".\"empresa_id\" = $1" },
  { table: "venda_efetivada", sql: "DELETE FROM \"venda_efetivada\" WHERE \"venda_efetivada\".\"empresa_id\" = $1" },
  { table: "compra_efetivada", sql: "DELETE FROM \"compra_efetivada\" WHERE \"compra_efetivada\".\"empresa_id\" = $1" },
  { table: "caixa_pdv", sql: "DELETE FROM \"caixa_pdv\" WHERE \"caixa_pdv\".\"empresa_id\" = $1" },
  { table: "solicitacao_transferencia", sql: "DELETE FROM \"solicitacao_transferencia\" WHERE \"solicitacao_transferencia\".\"empresa_id\" = $1" },
  { table: "deposito", sql: "DELETE FROM \"deposito\" WHERE \"deposito\".\"empresa_id\" = $1" },
  { table: "onda_separacao", sql: "DELETE FROM \"onda_separacao\" WHERE \"onda_separacao\".\"empresa_id\" = $1" },
  { table: "centro_distribuicao", sql: "DELETE FROM \"centro_distribuicao\" WHERE \"centro_distribuicao\".\"empresa_id\" = $1" },
  { table: "estrutura_produto", sql: "DELETE FROM \"estrutura_produto\" WHERE \"estrutura_produto\".\"empresa_id\" = $1" },
  { table: "centro_producao", sql: "DELETE FROM \"centro_producao\" WHERE \"centro_producao\".\"empresa_id\" = $1" },
  { table: "pedido_venda", sql: "DELETE FROM \"pedido_venda\" WHERE \"pedido_venda\".\"empresa_id\" = $1" },
  { table: "pedido_compra", sql: "DELETE FROM \"pedido_compra\" WHERE \"pedido_compra\".\"empresa_id\" = $1" },
  { table: "formato_endereco", sql: "DELETE FROM \"formato_endereco\" WHERE \"formato_endereco\".\"empresa_id\" = $1" },
  { table: "cliente", sql: "DELETE FROM \"cliente\" WHERE \"cliente\".\"empresa_id\" = $1" },
  { table: "tabela_preco", sql: "DELETE FROM \"tabela_preco\" WHERE \"tabela_preco\".\"empresa_id\" = $1" },
  { table: "transportadora", sql: "DELETE FROM \"transportadora\" WHERE \"transportadora\".\"empresa_id\" = $1" },
  { table: "fornecedor", sql: "DELETE FROM \"fornecedor\" WHERE \"fornecedor\".\"empresa_id\" = $1" },
  { table: "vendedor", sql: "DELETE FROM \"vendedor\" WHERE \"vendedor\".\"empresa_id\" = $1" },
]

async function main() {
  const { cnpj, empresaId: empresaIdArg, confirmar } = parseArgs()

  if (!cnpj && !empresaIdArg) {
    console.error('❌ Informe --cnpj=<cnpj> ou --empresaId=<uuid> da empresa a limpar.')
    console.error('   Exemplo: npx tsx scripts/limpar-todas-informacoes.ts --cnpj=00000000000100 --confirmar')
    process.exit(1)
  }

  const empresa = await prisma.empresa.findFirst({
    where: cnpj ? { cnpj } : { id: empresaIdArg },
    select: { id: true, razaoSocial: true, cnpj: true },
  })

  if (!empresa) {
    console.error(`❌ Empresa não encontrada para ${cnpj ? `cnpj=${cnpj}` : `empresaId=${empresaIdArg}`}`)
    process.exit(1)
  }

  const empresaId = empresa.id

  if (!confirmar) {
    console.log('🔍 MODO DRY-RUN (nenhum dado será apagado). Adicione --confirmar para executar de fato.\n')
  }

  console.log(`🧹 ${confirmar ? 'Iniciando' : 'Simulando'} limpeza TOTAL da empresa: ${empresa.razaoSocial} (CNPJ ${empresa.cnpj})`)
  console.log(`   Empresa ID: ${empresaId}`)
  console.log(`   Tabelas a processar: ${STATEMENTS.length}`)
  console.log(`   ⚠️  O registro da própria empresa NÃO será apagado.\n`)

  // Capturar usuários vinculados a esta empresa ANTES de apagar usuario_empresa
  // (necessário para decidir depois se o Usuario em si pode ser removido).
  const usuariosDaEmpresa = await prisma.usuarioEmpresa.findMany({
    where: { empresaId },
    select: { usuarioId: true, usuario: { select: { nome: true } } },
  })

  let totalApagado = 0
  const resumo: Array<{ table: string; count: number }> = []

  for (const { table, sql } of STATEMENTS) {
    try {
      if (confirmar) {
        const count = await prisma.$executeRawUnsafe(sql, empresaId)
        if (count > 0) {
          console.log(`  ${table}: ${count} removidos`)
          resumo.push({ table, count })
          totalApagado += count
        }
      } else {
        // Dry-run: transforma o DELETE em SELECT COUNT(*) para não tocar no banco
        const countSql = sql.replace(/^DELETE FROM/, 'SELECT COUNT(*)::int AS count FROM')
        const result = await prisma.$queryRawUnsafe<Array<{ count: number }>>(countSql, empresaId)
        const count = result[0]?.count ?? 0
        if (count > 0) {
          console.log(`  ${table}: ${count} SERIAM removidos`)
          resumo.push({ table, count })
          totalApagado += count
        }
      }
    } catch (e: any) {
      console.error(`  ⚠️  ${table}: erro — ${e.message}`)
    }
  }

  // Vínculo usuario_empresa já removido no loop acima (tabela usuario_empresa
  // faz parte de STATEMENTS). Usuario em si: só remover se, ANTES da limpeza,
  // não estivesse vinculado a NENHUMA outra empresa (usamos o snapshot capturado
  // antes do loop, já que o vínculo desta empresa já não existe mais no banco).
  console.log('\n--- USUÁRIOS (tratamento especial) ---')
  if (usuariosDaEmpresa.length === 0) {
    console.log('  Nenhum usuário vinculado a esta empresa.')
  }
  for (const { usuarioId, usuario } of usuariosDaEmpresa) {
    const outrosVinculos = await prisma.usuarioEmpresa.count({
      where: { usuarioId, empresaId: { not: empresaId } },
    })
    if (outrosVinculos > 0) {
      console.log(`  usuario "${usuario.nome}" (${usuarioId}): mantido (vinculado a outra(s) empresa(s))`)
      continue
    }
    if (confirmar) {
      // refresh_token tem onDelete: Cascade a partir de Usuario, então é removido junto.
      await prisma.usuario.delete({ where: { id: usuarioId } }).catch((e) =>
        console.error(`  ⚠️  erro ao remover usuario "${usuario.nome}": ${e.message}`)
      )
      console.log(`  usuario "${usuario.nome}" (${usuarioId}): removido (sem vínculo com outra empresa)`)
    } else {
      console.log(`  usuario "${usuario.nome}" (${usuarioId}): SERIA removido (sem vínculo com outra empresa)`)
    }
  }

  console.log(`\n${confirmar ? '🎉 Limpeza concluída' : '🔍 Simulação concluída'} para ${empresa.razaoSocial}. Total de registros ${confirmar ? 'removidos' : 'que seriam removidos'}: ${totalApagado}`)

  if (!confirmar) {
    console.log('\n👉 Para executar de fato, rode novamente com a flag --confirmar')
  }
}

main()
  .catch((e) => { console.error('❌ Erro:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
