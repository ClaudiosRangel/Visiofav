# Design — prazos, cliente, margem e buscas

Visão do front: respeita a hierarquia Orçamento → Item → Plano (steering
`orcamento-grafico-visao-front-calcgraf`). Tudo aqui é do nível ORÇAMENTO (cabeçalho, Fechamento) ou da
tiragem do ITEM; nada entra no plano. Sem cores fixas (tokens do tema). Multi-tenant: `empresaId`
explícito em toda query.

## Schema (schema.prisma + migrate-prod.ts no mesmo commit, aditivo e idempotente)
- `orcamento_grafico`: `prazo_pagamento_id TEXT`, `prazo_pagamento VARCHAR(120)`,
  `precisa_recalcular BOOLEAN NOT NULL DEFAULT false`.
- Tabela nova `log_valor_orcamento_grafico`: id, empresa_id, orcamento_id, item_id, quantidade,
  valor_anterior, valor_novo (14,2), margem_anterior, margem_nova (7,2), abaixo_margem bool,
  usuario_id, usuario_nome, criado_em. Índice (empresa_id, orcamento_id, criado_em).
- Parâmetros (tabela `Parametro`, sem schema): `orc.margemMinimaPerc` (padrão 0 = sem alerta) e
  `comercial.valorMinimoParcelamento` (padrão 0 = sem limite).
- Permissão nova no JSON `comercial.permissoes.<usuarioId>`: `podeAlterarValorUnitario` (padrão false).

## R1 — prazo
- `encaminhar-orcamento.service` e `solicitacao-para-orcamento.service`: copiam `prazoPagamentoId`/texto.
- Função pura `orcamentoTemCalculo(orc, itens)`; helper `prazoTravado(empresaId, pedidoPropostaId |
  solicitacaoId)` usado em `PUT /pedidos-proposta/:id` e no Portal: se o prazo mudou e o orçamento
  vinculado tem cálculo → 409 `PRAZO_TRAVADO`.
- `PUT /orcamento-grafico/:id/prazo` (RASCUNHO): grava; se tem cálculo → `precisaRecalcular=true` e
  etapa VALIDAR/VALIDADO volta para EM_CALCULO; espelha no pedido/proposta e solicitação; valida R6.
- Recalcular/salvar qualquer item zera `precisaRecalcular`. `enviar` e validar recusam com
  `PRECISA_RECALCULAR` enquanto ligado.
- Aprovar: procura na tabela de preço usada uma `CondicaoPagamento` com as mesmas parcelas (e dias,
  quando houver) e grava `condicaoPagId`; sem correspondência, segue sem (hoje é assim).
- Juros pelo prazo: NÃO entra nesta fase (o motor não usa prazo hoje; ver pergunta P1).

## R2 — último cálculo
- `GET /orcamento-grafico/clientes/:clienteId/ultimo-calculo`: une (a) `calculo_grafico` da empresa
  com `cliente_id` = cliente, ou `cliente_doc` = CNPJ (só dígitos), ou `cliente_codigo` = código
  legado; (b) cálculos de origem dos itens de orçamentos do cliente. Devolve o mais recente
  `{calculoId, numero, data, descricao, tiragem, valorTotal}` ou `null`.
- Front: componente `UltimoCalculoCliente` ao lado de "Localizar Cálculo" (novo orçamento e detalhe).

## R3 — cadastro rápido
- `ClienteRapidoModal` (reaproveita a consulta `GET /orcamento-grafico/consulta-cnpj/:cnpj`).
- Back: rota nova `POST /orcamento-grafico/clientes/rapido` (não altera a `POST /clientes`
  compartilhada): normaliza CNPJ/CPF, valida dígitos (11/14), 409 com o existente se já cadastrado.

## R4 — histórico de prazos
- Serviço `historicoPrazosCliente(empresaId, clienteId)`: agrega por prazo os orçamentos, pedidos/
  propostas e solicitações (prazo do Comercial) e, à parte, os pedidos de venda (condição de Vendas).
  `GET /orcamento-grafico/clientes/:clienteId/prazos` → `{ comercial: [...], vendas: [...], padrao }`.
- Padrão = maior contagem, empate pela data mais recente. Usado ao abrir os quatro formulários.
- Ficha do cliente (configurador/clientes) ganha a aba "Prazos praticados".

## R5 — valor unitário
- `PUT .../tiragens/:quantidade` passa a exigir `podeAlterarValorUnitario` quando há `valorTotal` ou
  `valorUnitario` (margem/faixa continuam livres) e aceita `valorUnitario` (total = unitário × qtd).
  Grava `log_valor_orcamento_grafico` na mesma transação.
- `GET /orcamento-grafico/:id/log-valores`.
- Sinalização: `margemPerc` da tiragem vs `orc.margemMinimaPerc`, calculada no back e devolvida
  (`situacaoMargem: DENTRO | ABAIXO | SEM_REFERENCIA`).

## R6 — parcelamento
- Função pura `validarParcelamento(valorTotal, parcelas, minimo)`. Aplicada em `PUT /:id/prazo`,
  `enviar`, `aprovar` e criação/edição do pedido de venda. Erro `PARCELAMENTO_ABAIXO_MINIMO`.

## R7 — buscas
- Hook `useBuscaDigitando(valor, 300)`; remove os botões e o `onSubmit`.
- Back: `cliente-busca` código por contém; lista de orçamentos: nº por contém (texto).

## Telas (aprovar antes de codar)

Novo orçamento / cabeçalho do orçamento:
```
Série [  ]  Nº auto  Data [..]   Prazo de pagamento [ 28/35/42 ▾ ]  (mais usado pelo cliente)
Cliente Principal [ código ] [ nome digitando... ▾ ]  [+ Cliente novo]
┌ Itens do Orçamento ──────────────────────────── [Localizar Cálculo] ┐
│ Último cálculo do cliente: nº 15652 · 17/11/2026 · CX. CARTONAGEM…  │
│ 6.000 un · R$ 17.140,96                                      [Usar] │
└─────────────────────────────────────────────────────────────────────┘
```
Prazo com o orçamento já calculado: ao trocar, aviso "O orçamento precisa ser recalculado"; selo
"Precisa recalcular" no cabeçalho até recalcular.

Pedido/Proposta e Portal com orçamento calculado:
```
Prazo de pagamento [ 28/35/42 ]  🔒 Definido no orçamento nº 5630. Para alterar, recalcule o orçamento.
```

Tiragens do item / Fechamento:
```
Tiragem | Custo | Margem % | C.Marg. | Valor Unitário [editável c/ permissão] | Valor Total | Situação
6.000   | ...   | 18,0%    | ...     | 2,8568                                  | 17.140,96   | ● Abaixo da margem (mín. 25%)
[Histórico de alterações de valor]
```
