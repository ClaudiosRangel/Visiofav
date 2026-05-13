---
inclusion: auto
---

# MISSÃO: Fluxo Completo de Recebimento WMS — Correção Definitiva

## Status: EM ANDAMENTO

## Contexto
O fluxo de recebimento (Compras → Portaria → Conferência → Endereçamento) tem bugs recorrentes que impedem o uso em produção. Esta missão documenta TODOS os pontos e o estado atual para evitar retrabalho entre sessões.

## Fluxo Esperado (ponta a ponta)

1. **Importar XML em Compras** → cria PedidoCompra + CompraEfetivada (com xmlNfe guardando o XML completo)
2. **Agendar na Portaria** → cria AgendaWms vinculada ao pedidoCompraId e fornecedorId
3. **Conferir na Portaria** (caminhão chegou) → cria NotaEntrada com itens incluindo lote/validade extraídos do XML
   - Deve calcular automaticamente qtdPaletes baseado no SKU (lastro × camada)
4. **Conferência de Entrada** → conferente vê itens com lote/validade pré-preenchidos
   - ShelfLife deve bloquear se validade < mínimo
   - Botão "Verificar Resultado" desabilitado se shelf life inválido
5. **Endereçamento** → motor sugere endereços livres automaticamente
   - Respeitar dados logísticos (capacidade picking, endereço fixo, consolidação)
   - Ao confirmar, gravar saldo no endereço

## Problemas Identificados e Status

### P1: Lote/Validade não chega na Conferência de Entrada
- **Causa raiz**: A portaria cria a NotaEntrada buscando XML da CompraEfetivada, mas:
  - Se `ag.pedidoCompraId` é null (agendamento manual sem vínculo), não encontra
  - Fallback por fornecedorId adicionado mas pode não funcionar se CompraEfetivada não existe
  - O parser XML (`nfe-xml-parser.ts`) foi corrigido para extrair `<rastro>` dentro de `<prod>`
- **Fix aplicado**: Fallback por fornecedorId (commit c02cd79)
- **Status**: PRECISA VALIDAR — pode haver erro no parser ou na busca

### P2: Cálculo de Paletes na Portaria quebrou
- **Causa raiz**: O código adicionado para buscar SKU dos itens do pedido pode ter introduzido erro
- **Erro**: "Erro / Falha" ao conferir na portaria (screenshot mostra toast de erro)
- **Status**: PRECISA INVESTIGAR — provavelmente erro no código que busca SKU + XML

### P3: Endereçamento não sugere endereços
- **Causa raiz**: Query filtrava `empresaId: user.empresaId` mas endereços têm `empresaId: null`
- **Fix aplicado**: OR [empresaId = user.empresaId, empresaId = null] (commit 077da91)
- **Status**: PRECISA VALIDAR

### P4: Aba "Estoque/Lotes" no Produto
- **Requisito**: Mostrar lote, validade, unidade, qtd adquirida, saldo atual
- **Estado atual**: Mostra apenas saldos (após endereçamento). Falta mostrar dados da nota (qtd adquirida) mesmo antes de endereçar
- **Status**: PRECISA IMPLEMENTAR — buscar também ItemNotaEntrada do produto

## Arquivos Críticos

### Backend
- `src/modules/portaria/portaria.routes.ts` — POST /conferir/:id (cria NotaEntrada)
- `src/modules/nota-entrada/nfe-xml-parser.ts` — parseNfeXml (extrai lote/validade do rastro)
- `src/modules/conferencia/conferencia-entrada.routes.ts` — iniciar, conferir-todos, confirmar
- `src/modules/enderecamento/enderecamento-wms.routes.ts` — sugerir-lote (busca endereços livres)
- `src/modules/enderecamento-inteligente/enderecamento-inteligente.routes.ts` — distribuir
- `src/modules/enderecamento-inteligente/conversor-unidade.service.ts` — selecionarSkuMaster
- `src/modules/enderecamento-inteligente/motor-distribuicao.service.ts` — calcularCapacidadePalete

### Frontend
- `src/app/(interna)/wms/portaria/page.tsx` — modal conferência (calcula paletes)
- `src/app/(interna)/wms/conferencia-entrada/page.tsx` — conferência cega + endereçamento
- `src/app/(interna)/recebimento/NotaEntradaModal.tsx` — importação XML com lote/validade
- `src/app/(interna)/configurador/produtos/ProdutoModal.tsx` — aba Estoque/Lotes
- `src/components/wms/AgendamentoDocaModal.tsx` — seleção de slots

### Modelos Prisma relevantes
- AgendaWms: pedidoCompraId, fornecedorId, qtdCaixas, qtdPaletes
- CompraEfetivada: pedidoCompraId, xmlNfe
- NotaEntrada: itens → ItemNotaEntrada (lote, validade)
- Sku: produtoId, lastro, camada, qtdEmbalagem
- SaldoEndereco: enderecoId, produtoId, quantidade, lote, validade
- Endereco: empresaId (PODE SER NULL — endereços gerados sem empresaId)

## Regras de Negócio

- Shelf Life: se produto.shelfLifeMinimo = 30 e validade tem < 30 dias → BLOQUEAR
- Capacidade palete: lastro × camada (ex: 9 × 5 = 45 caixas/palete)
- Qtd paletes: Math.ceil(qtdCaixas / caixasPorPalete)
- Endereçamento prioridade: Fixo → Consolidação → Livre
- Endereços podem ter empresaId NULL (gerados sem tenant)

## Próximos Passos

1. Investigar e corrigir o ERRO na portaria (P2) — provavelmente o código de SKU/XML quebrou
2. Validar que lote/validade chega na conferência (P1)
3. Validar endereçamento sugere endereços (P3)
4. Melhorar aba Estoque/Lotes com dados da nota (P4)
