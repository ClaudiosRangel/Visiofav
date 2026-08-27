# Plano de Implementação — Requisições de Compra e Reserva

## Backend (VisioFab.Wms.Back)

- [x] 1. Rota de conversão SugestaoCompra → PedidoCompra
  - Criar `POST /pcp/analise-producao/sugestoes-compra/converter` em
    `analise-producao.routes.ts` (ou novo `sugestao-compra-conversao.service.ts`)
  - Body: `{ sugestaoIds: string[], fornecedorId: string }`
  - Em transação: validar isolamento por `empresaId`; criar 1 `PedidoCompra`
    (RASCUNHO) + `ItemPedidoCompra` por sugestão; marcar sugestões CONVERTIDA
    e preencher `pedidoCompraId`; ignorar já convertidas (idempotente)
  - Retornar `{ pedidoCompraId, numero, itensCriados, ignoradas }`
  - _Requisitos: 2.1, 2.3, 2.4, 2.5, 5.1_

- [x] 2. Estender listagem de requisições
  - Ajustar `GET /pcp/analise-producao/sugestoes-compra` para aceitar filtro
    por `fornecedorId` e busca por produto, e retornar código/nome do produto
  - _Requisitos: 1.1, 1.2, 1.3, 5.1_

- [x] 3. Rotas de manutenção de requisição
  - `PATCH /pcp/analise-producao/sugestoes-compra/:id` (editar qtd/fornecedor,
    só PENDENTE, filtrar por empresa)
  - `DELETE /pcp/analise-producao/sugestoes-compra/:id` (cancelar → CANCELADA)
  - _Requisitos: 3.1, 3.2, 5.1_

- [x] 4. Rota de saldos consolidada por produto (Origem + Reservado + Disponível)
  - Criar `GET /api/saldos/consolidado` em `saldo.routes.ts`
  - Reaproveitar/extrair a lógica `calcularSaldo()` de
    `verificacao-estoque.service.ts` (origem WMS/ERP, físico, reservado)
  - Retornar por produto: origem, físico, reservadoVenda, reservadoProducao,
    reservado, disponível e, quando WMS, lista de endereços/lotes
  - Filtrar por `empresaId`; incluir busca por produto
  - _Requisitos: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2_

- [x] 5. Validação backend
  - O projeto não usa unit test com Prisma para services de PCP/estoque — a
    validação de banco é feita pela suite E2E (tarefa 9) e pelo build `tsc`.
    Validação: `get_diagnostics` limpo nos 3 arquivos novos + build sem novos erros.
  - _Requisitos: 2.*, 4.*, 5.*_

## Frontend (VisioFab.Wms.Front)

- [x] 6. Tela "Requisições de Compra" no módulo Compras
  - Criar página `/compras/requisicoes` (`src/app/(interna)/compras/requisicoes/page.tsx`)
  - Adicionar item no `ModuleSidebar` (módulo `compras`) e no `detectModule`
  - Tabela com seleção (checkbox), filtros (status/fornecedor/busca), estado vazio
  - Ações por linha: editar qtd, cancelar
  - _Requisitos: 1.1, 1.2, 1.3, 1.4, 3.1, 3.2_

- [x] 7. Conversão em Pedido de Compra (UI)
  - Botão "Gerar Pedido de Compra" (ação em lote sobre selecionadas)
  - Modal confirmando fornecedor (pré-preenchido com sugerido); bloquear se
    faltar fornecedor
  - Chamar `POST .../converter`; notificar quantas convertidas; link para o
    pedido criado (`/compras/pedidos/:id`)
  - _Requisitos: 2.1, 2.2, 2.5, 2.6_

- [x] 8. Visão "Por Produto" na Consulta de Saldos
  - Em `/estoque` (`estoque/page.tsx`) adicionar toggle/aba "Por Produto"
    (mantendo a "Por Endereço" atual intacta)
  - Consumir `GET /api/saldos/consolidado`
  - Colunas: Produto, Origem (badge WMS/ERP), Físico, Reservado (tooltip
    venda+produção), Disponível (verde)
  - Origem WMS → linha expansível com endereços/lotes; origem ERP → sem endereço
  - _Requisitos: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

- [x] 9. Teste E2E (suite tests/e2e-qa)
  - `test_10_requisicoes_reserva.py`: abre Requisições de Compra (lista/filtros),
    abre visão Por Produto na Consulta de Saldos (colunas Origem/Reservado/
    Disponível). Segue padrão da suite (pytest.skip se sem dados).
  - _Requisitos: 1.*, 4.*_

## Verificação Final

- [x] 10. Build e validação
  - `tsc`/build backend e `next build` frontend sem novos erros
  - Rodar testes backend e a suite e2e-qa do fluxo tocado
  - Atualizar steering `pcp-modulo.md` (nova rota de conversão) se aplicável
  - _Requisitos: 5.3_
