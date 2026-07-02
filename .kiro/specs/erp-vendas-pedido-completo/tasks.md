# Implementation Plan: ERP Vendas Pedido Completo

## Overview

Evolução do módulo de Pedido de Venda do VisioFab ERP para incluir campos complementares de cabeçalho/itens, endereço de entrega alternativo, desconto/acréscimo gerais com rateio proporcional, cálculo preciso de preço final, faturamento parcial (backorder), integração de frete/transportadora com NF-e, rastreabilidade via PO do cliente, gestão de prioridade, validações de integridade por status, e campos de auditoria/origem. A implementação é incremental com campos nullable/default, funções puras para cálculos e transações atômicas para faturamento.

## Tasks

- [x] 1. Schema Prisma e migração
  - [x] 1.1 Adicionar novos campos ao modelo PedidoVenda no schema Prisma
    - Adicionar campos: dataEntrega, observacao, observacaoNota, transportadoraId (com relation Transportadora), modalidadeFrete, origemPedido (@default("MANUAL")), prioridade (@default("NORMAL")), dataValidade, numeroPedidoCliente, tipoDesconto, descontoGeral (@default(0)), acrescimoGeral (@default(0)), tipoAcrescimo, enderecoEntrega (Json?), orcamentoOrigemId, dataLimiteAtendimento
    - Todos nullable ou com default para preservar registros existentes
    - _Requirements: 12.1_

  - [x] 1.2 Adicionar novos campos ao modelo ItemPedidoVenda no schema Prisma
    - Adicionar campos: descontoValor (@default(0)), frete (@default(0)), seguro (@default(0)), outrasDespesas (@default(0)), observacaoItem (Text?), dataEntregaItem (DateTime?), comissaoPercItem (@default(0)), quantidadeFaturada (@default(0))
    - Todos com default 0 ou nullable
    - _Requirements: 12.2_

  - [x] 1.3 Alterar relação PedidoVenda → VendaEfetivada para 1:N
    - Remover @unique de pedidoVendaId no modelo VendaEfetivada para permitir múltiplas VendaEfetivada por pedido
    - Atualizar relação no modelo PedidoVenda para `vendasEfetivadas VendaEfetivada[]`
    - _Requirements: 6.7, 12.3_

  - [x] 1.4 Gerar e aplicar migration
    - Executar `npx prisma migrate dev --name add-pedido-venda-completo`
    - Verificar que registros existentes permanecem intactos com defaults aplicados
    - _Requirements: 12.4, 12.5_

- [x] 2. Schemas Zod e constantes
  - [x] 2.1 Criar arquivo de constantes e enums do pedido
    - Criar `src/modules/vendas/pedido-venda/pedido-venda.constants.ts`
    - Exportar: MODALIDADES_FRETE, ORIGENS_PEDIDO, PRIORIDADES, TIPOS_DESCONTO, TIPOS_ACRESCIMO, UFS_VALIDAS
    - _Requirements: 1.1, 1.2, 2.4, 3.1_

  - [x] 2.2 Criar schema Zod do enderecoEntrega
    - Criar validação em `src/modules/vendas/pedido-venda/pedido-venda.schemas.ts`
    - Implementar enderecoEntregaSchema com validações: logradouro (1-200), numero (1-20), complemento (max 100, opcional), bairro (1-100), cidade (1-100), uf (2 chars maiúsculas, regex UF válida), cep (8 dígitos), codigoIbge (7 dígitos, opcional)
    - _Requirements: 2.1, 2.2, 2.4, 2.5_

  - [x] 2.3 Atualizar schemas Zod de criação e edição do pedido
    - Adicionar ao schema de criação: dataEntrega, observacao (max 1000), observacaoNota (max 2000), transportadoraId, modalidadeFrete (enum), origemPedido (enum), prioridade (enum), dataValidade, numeroPedidoCliente (max 60), tipoDesconto, descontoGeral, acrescimoGeral (object com tipoAcrescimo + valor), enderecoEntrega (optional), orcamentoOrigemId
    - Adicionar ao schema de item: descontoValor, frete, seguro, outrasDespesas, observacaoItem (max 1000), dataEntregaItem, comissaoPercItem (0-100)
    - _Requirements: 1.1, 3.1, 4.1_

- [x] 3. Serviços de cálculo (funções puras)
  - [x] 3.1 Implementar pedido-calculo.service.ts
    - Criar `src/modules/vendas/pedido-venda/pedido-calculo.service.ts`
    - Implementar `calcularPrecoFinal({ precoBase, descontoPercent, descontoValor })`: fórmula `(precoBase × (1 - desconto/100)) - descontoValor`, arredondado 4 casas
    - Implementar `calcularValorTotalItem({ precoFinal, quantidade, frete, seguro, outrasDespesas })`: fórmula `(precoFinal × quantidade) + frete + seguro + outrasDespesas`, arredondado 2 casas
    - Implementar `calcularValorTotalPedido({ itens, descontoGeralAbsoluto, acrescimoGeral })`: `sum(itens.valorTotal) - descontoGeralAbsoluto + acrescimoGeral`
    - Implementar `calcularDescontoAbsoluto({ subtotal, tipoDesconto, descontoGeral })`: converte % para valor absoluto
    - Usar arredondamento half-up em todas as operações
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 5.6_

  - [ ]* 3.2 Write property tests for pedido-calculo.service
    - **Property 1: Price calculation formula (precoFinal)**
    - **Validates: Requirements 4.2, 5.1**

  - [ ]* 3.3 Write property tests for valorTotal do item
    - **Property 2: Item valorTotal formula**
    - **Validates: Requirements 4.4, 5.2**

  - [ ]* 3.4 Write property test for valorTotal do pedido
    - **Property 5: Pedido valorTotal consistency**
    - **Validates: Requirements 4.4, 5.3**

  - [x] 3.5 Implementar pedido-rateio.service.ts
    - Criar `src/modules/vendas/pedido-venda/pedido-rateio.service.ts`
    - Implementar `ratearValor({ itens, valorTotal })`: distribui proporcional por `item.valorTotal / subtotal`, arredonda cada parcela para 2 casas decimais, ajusta diferença no item de maior valorTotal
    - Garantir que `sum(valorRateado) === valorTotal` (invariante)
    - _Requirements: 3.3, 3.4, 3.5_

  - [ ]* 3.6 Write property tests for pedido-rateio.service
    - **Property 3: Rateio sum invariant**
    - **Property 4: Rateio proportionality**
    - **Validates: Requirements 3.3, 3.4, 3.5**

- [x] 4. Checkpoint — Validar funções puras de cálculo e rateio
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Validações de negócio
  - [x] 5.1 Implementar validações de campo e cross-field
    - Criar `src/modules/vendas/pedido-venda/pedido-validacao.service.ts`
    - Implementar validações: datas no passado (dataEntrega, dataValidade, dataEntregaItem), UF/CEP do endereço, tipoDesconto ↔ descontoGeral obrigatórios em conjunto, acrescimoGeral requer tipoAcrescimo + valor, orcamentoOrigemId requer origemPedido ORCAMENTO, desconto não excede subtotal, precoFinal >= 0
    - _Requirements: 1.6, 1.8, 2.4, 2.5, 3.7, 3.8, 3.9, 4.5, 4.6, 11.5_

  - [ ]* 5.2 Write property tests for validações de campo
    - **Property 6: Date validation (past dates rejected)**
    - **Property 7: Address format validation**
    - **Property 8: Discount pair validation**
    - **Property 20: orcamentoOrigemId requires origemPedido ORCAMENTO**
    - **Validates: Requirements 1.6, 1.8, 2.4, 2.5, 3.8, 3.9, 11.5**

  - [x] 5.3 Implementar validação de permissões de edição por status
    - Criar `obterCamposEditaveis({ status, temFaturamentosParciais })` e `validarPermissaoEdicao({ status, temFaturamentosParciais, camposAlterados, itensAlterados })`
    - Regras: RASCUNHO = tudo editável, CONFIRMADO sem faturamento = subset limitado, CONFIRMADO com faturamento = subset + itens sem faturamento, EFETIVADO/CANCELADO = nenhuma edição
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [ ]* 5.4 Write property tests for permissões de edição
    - **Property 12: Edit permissions respect status rules**
    - **Property 13: Partially billed items are immutable**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6**

- [x] 6. Serviço principal do pedido de venda
  - [x] 6.1 Implementar criação do pedido com campos completos
    - Atualizar `src/modules/vendas/pedido-venda/pedido-venda.service.ts` (método `criar`)
    - Integrar: validações de campo, cálculo de precoFinal/valorTotal por item, rateio de desconto/acréscimo, cálculo de valorTotal do pedido
    - Validar transportadoraId (existe e pertence à empresa), origemPedido default MANUAL, prioridade default NORMAL
    - Para prioridade URGENTE: calcular dataLimiteAtendimento = criadoEm + 24h
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.4, 9.3_

  - [x] 6.2 Implementar edição do pedido com validações de status
    - Atualizar método `editar` com: verificação de permissões de edição (obterCamposEditaveis, validarPermissaoEdicao), recalcular precoFinal/valorTotal ao alterar campos de valor, recalcular rateio ao alterar desconto/acréscimo gerais
    - Retornar itensBloqueados na resposta quando edição rejeitada por faturamento parcial
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 5.4_

  - [x] 6.3 Implementar listagem com novos filtros e ordenação
    - Adicionar filtros: prioridade (enum), origemPedido (enum), numeroPedidoCliente (busca parcial case-insensitive)
    - Adicionar ordenação por prioridade (URGENTE > NORMAL > BAIXA, depois por criadoEm ASC)
    - Incluir origemPedido na resposta de cada pedido
    - Validar valores dos filtros enum e retornar 400 se inválidos
    - _Requirements: 8.3, 8.4, 9.1, 9.2, 9.4, 11.1, 11.3, 11.4_

  - [ ]* 6.4 Write property tests for listagem e filtros
    - **Property 14: Priority ordering invariant**
    - **Property 15: Priority filter correctness**
    - **Property 16: numeroPedidoCliente search (partial, case-insensitive)**
    - **Property 19: Origin filter correctness**
    - **Validates: Requirements 8.3, 9.1, 9.2, 11.1**

- [x] 7. Checkpoint — Validar CRUD completo do pedido
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Faturamento parcial
  - [x] 8.1 Implementar faturamento-parcial.service.ts
    - Criar `src/modules/vendas/pedido-venda/faturamento-parcial.service.ts`
    - Implementar `processar(empresaId, pedidoId, itensFaturamento)` com transação atômica:
      1. Validar pedido status CONFIRMADO
      2. Validar saldo disponível (quantidade - quantidadeFaturada) para cada item
      3. Rejeitar operação inteira se qualquer item excede saldo
      4. Criar VendaEfetivada com itens/valores proporcionais
      5. Chamar vendaFiscalService para emitir NF-e (com frete/transportadora)
      6. Gerar contas a receber proporcionais
      7. Atualizar quantidadeFaturada dos itens
      8. Atualizar status pedido para EFETIVADO se todos itens totalmente faturados
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [ ]* 8.2 Write property tests for faturamento parcial
    - **Property 9: Faturamento parcial — accumulated quantity invariant**
    - **Property 10: Pedido status reflects billing completeness**
    - **Property 11: Faturamento parcial — rejection atomicity**
    - **Validates: Requirements 6.1, 6.2, 6.4, 6.5, 6.6**

  - [x] 8.3 Criar rota POST /pedido-venda/:id/faturar
    - Registrar endpoint em `src/modules/vendas/pedido-venda/pedido-venda.routes.ts`
    - Schema Zod para input: array de { itemId, quantidade }
    - Chamar faturamentoParcialService.processar() e retornar resultado
    - _Requirements: 6.1, 6.3_

- [x] 9. Integração NF-e (frete, transportadora, observação, xPed)
  - [x] 9.1 Atualizar venda-fiscal.service para incluir dados de frete/transportadora
    - Modificar `montarDadosNFe` para: incluir modalidadeFrete no tag modFrete (default 9 se não informado), incluir dados da transportadora no grupo transp (CNPJ, razão social, IE, endereço), incluir observacaoNota no campo infCpl (truncar 5000 chars), incluir numeroPedidoCliente no tag xPed (truncar 15 chars)
    - Validar transportadora com CNPJ e razão social antes da efetivação
    - Validar que cliente possui endereço cadastral quando enderecoEntrega não informado
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 2.3, 2.7_

  - [ ]* 9.2 Write property tests for NF-e integration
    - **Property 17: numeroPedidoCliente truncation in NF-e (xPed)**
    - **Property 18: observacaoNota truncation in NF-e (infCpl)**
    - **Validates: Requirements 7.4, 8.2**

- [x] 10. Rotas e wiring final
  - [x] 10.1 Atualizar rotas de criação e edição do pedido
    - Atualizar `src/modules/vendas/pedido-venda/pedido-venda.routes.ts`
    - POST /pedido-venda: aceitar todos os novos campos de cabeçalho e item
    - PUT /pedido-venda/:id: aceitar edição com validação de status
    - GET /pedido-venda: aceitar filtros prioridade, origemPedido, numeroPedidoCliente e ordenação por prioridade
    - Respostas de erro formatadas conforme tabela do design (400, 404, 422)
    - _Requirements: 1.1, 1.7, 8.3, 8.4, 9.1, 9.4, 10.3, 10.6, 10.7, 11.1, 11.4_

  - [ ]* 10.2 Write unit tests para cenários específicos
    - Testar default origemPedido = MANUAL, prioridade = NORMAL
    - Testar modalidadeFrete padrão 9 quando não informado na NF-e
    - Testar dataLimiteAtendimento = criadoEm + 24h para URGENTE
    - Testar rejeição de orcamentoOrigemId inexistente
    - Testar resposta com itensBloqueados ao editar item faturado
    - Testar cliente sem endereço bloqueia efetivação
    - Testar transportadora sem CNPJ bloqueia efetivação
    - Testar numeroPedidoCliente apenas espaços rejeitado
    - _Requirements: 1.4, 1.5, 2.7, 7.3, 7.5, 8.1, 9.3, 10.7, 11.2_

- [x] 11. Final checkpoint — Validação completa
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (fast-check)
- Unit tests validate specific examples and edge cases (Vitest)
- Funções puras (pedido-calculo, pedido-rateio) são implementadas primeiro para permitir testes isolados sem mocks
- A migração Prisma usa campos nullable/default para compatibilidade com dados existentes
- Faturamento parcial usa `prisma.$transaction` para garantir atomicidade
- Relação PedidoVenda → VendaEfetivada muda de 1:1 para 1:N

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["1.4"] },
    { "id": 2, "tasks": ["2.1", "2.2", "2.3", "3.1", "3.5"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4", "3.6", "5.1", "5.3"] },
    { "id": 4, "tasks": ["5.2", "5.4", "6.1"] },
    { "id": 5, "tasks": ["6.2", "6.3"] },
    { "id": 6, "tasks": ["6.4", "8.1"] },
    { "id": 7, "tasks": ["8.2", "8.3", "9.1"] },
    { "id": 8, "tasks": ["9.2", "10.1"] },
    { "id": 9, "tasks": ["10.2"] }
  ]
}
```
