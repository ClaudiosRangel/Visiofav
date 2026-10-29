# Requirements — Pipeline Comercial + Proposta no Detalhe (Bloco B3)

## Introdução

O comercial precisa de uma visão ponta a ponta do funil (Orçamento → Amostra →
Pedido → Produção → Faturamento) numa tela só, e de poder gerar/enviar a proposta
PDF direto do detalhe do orçamento (fecha a task 8 do B1). O backend já tem a
jornada por pedido (`montarJornadaPedido`) e a régua de estágios pura
(`montarEstagios`); falta a LISTAGEM (painel) e a tela.

Fonte de verdade: `docs/PROJETO-MODULO-COMERCIAL.md` (bloco B3).

## Requisitos

### Requisito 1: Listagem do painel unificado

1. QUANDO o comercial abrir o Pipeline ENTÃO o sistema DEVE listar os pedidos de
   origem comercial (`origemPedido = ORCAMENTO_GRAFICO`) com a régua de estágios
   de cada um e o estágio atual destacado.
2. A listagem DEVE agregar sem N+1 (poucas queries) e filtrar `empresaId`
   explícito.
3. A listagem DEVE aceitar filtro por status do pedido e busca por número/cliente.
4. Para cada item DEVE mostrar: nº pedido, nº orçamento, cliente, valor, estágios
   (com estado), progresso de OPs (concluídas/total), status de amostra.

### Requisito 2: Proposta PDF no detalhe do orçamento (task 8 do B1)

1. No detalhe do orçamento DEVE haver ação "Proposta" com: baixar PDF e enviar
   por e-mail, ambos usando um template selecionável (default pré-selecionado).
2. QUANDO não houver template ENTÃO usa o layout padrão (não-regressão do B1).
3. O envio por e-mail DEVE reaproveitar a rota existente (`/:id/enviar-email`).

### Requisito 3: Isolamento e não-regressão

1. Toda query filtra `empresaId`.
2. Nenhuma alteração no motor de cálculo.
