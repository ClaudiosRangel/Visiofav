# Requisitos — Requisições de Compra e Visibilidade de Reserva de Produção

## Introdução

A Análise de Produção do PCP já cria `SugestaoCompra` (requisição de compra) e
`ReservaProducao` (empenho de material) no banco, mas não há telas no frontend
para visualizá-las ou geri-las. Esta feature fecha esses dois gaps seguindo o
padrão dos ERPs de referência (SAP, TOTVS, Odoo): tela de Requisições de Compra
no módulo Compras (com conversão para Pedido de Compra) e visibilidade de
Reservado/Disponível na Consulta de Saldos do WMS, respeitando as duas formas
de armazenar estoque do sistema (WMS por endereço x ERP global).

## Requisitos

### Requisito 1 — Listar Requisições de Compra

**User Story:** Como comprador, quero ver as requisições de compra geradas pela
Análise de Produção, para saber o que precisa ser comprado.

#### Critérios de Aceitação
1. QUANDO o comprador acessa Compras → Requisições de Compra ENTÃO o sistema
   DEVE listar as `SugestaoCompra` da empresa dele (isolamento por `empresaId`).
2. A lista DEVE mostrar produto, quantidade, unidade, fornecedor sugerido,
   OP de origem, data de necessidade e status (PENDENTE/CONVERTIDA/CANCELADA).
3. O sistema DEVE permitir filtrar por status, fornecedor e busca por produto.
4. QUANDO não há requisições ENTÃO o sistema DEVE exibir estado vazio claro.

### Requisito 2 — Converter Requisições em Pedido de Compra

**User Story:** Como comprador, quero agrupar requisições do mesmo fornecedor e
gerar um pedido de compra, para efetivar a compra.

#### Critérios de Aceitação
1. QUANDO o comprador seleciona uma ou mais requisições PENDENTES e aciona
   "Gerar Pedido de Compra" ENTÃO o sistema DEVE criar um `PedidoCompra`
   (RASCUNHO) com um item por requisição.
2. O sistema DEVE preencher o fornecedor escolhido (pré-preenchido com o
   sugerido) no pedido.
3. QUANDO o pedido é criado ENTÃO cada `SugestaoCompra` DEVE virar CONVERTIDA
   e ter `pedidoCompraId` preenchido.
4. SE uma requisição selecionada já estiver CONVERTIDA ENTÃO o sistema DEVE
   ignorá-la (idempotente) e informar quantas foram convertidas.
5. SE nenhuma requisição tiver fornecedor definido ENTÃO o sistema DEVE exigir
   a escolha de um fornecedor antes de converter.
6. O sistema DEVE oferecer link para o pedido de compra criado.

### Requisito 3 — Manutenção de Requisições

**User Story:** Como comprador, quero editar a quantidade/fornecedor ou cancelar
uma requisição, para ajustar antes de comprar.

#### Critérios de Aceitação
1. QUANDO o comprador edita a quantidade ou fornecedor de uma requisição
   PENDENTE ENTÃO o sistema DEVE salvar a alteração.
2. QUANDO o comprador cancela uma requisição PENDENTE ENTÃO o status DEVE
   virar CANCELADA e ela sai da lista de pendentes.

### Requisito 4 — Visibilidade de Reservado/Disponível na Consulta de Saldos

**User Story:** Como usuário do WMS/PCP, quero ver quanto de cada produto está
reservado e o disponível real, considerando as reservas de produção, para não
prometer o mesmo saldo duas vezes.

#### Critérios de Aceitação
1. QUANDO o usuário acessa a Consulta de Saldos na visão "Por Produto" ENTÃO o
   sistema DEVE mostrar Físico, Reservado e Disponível por produto.
2. O Reservado DEVE somar reservas de venda (`Estoque.reservado`) + reservas de
   produção ativas (`ReservaProducao` ATIVA).
3. O Disponível DEVE ser `Físico − Reservado` (nunca negativo na exibição).
4. O sistema DEVE indicar a **origem** do saldo (WMS ou ERP) via badge.
5. QUANDO a origem é WMS ENTÃO o sistema DEVE permitir ver os **endereços/lotes**
   onde o produto está (linha expansível ou detalhe).
6. QUANDO a origem é ERP ENTÃO o saldo é global (sem endereço) e o badge deixa
   isso explícito.
7. A visão "Por Endereço" atual DEVE permanecer funcionando sem alteração.

### Requisito 5 — Isolamento e Consistência

**User Story:** Como operador multi-empresa, quero que os dados sejam isolados
por empresa e consistentes com o que o PCP enxerga.

#### Critérios de Aceitação
1. TODA query de requisição, reserva e saldo DEVE filtrar por `empresaId` do
   usuário (regra crítica multi-tenant do projeto).
2. O cálculo de Reservado/Disponível DEVE reaproveitar a regra `calcularSaldo()`
   já usada pela Análise de Produção, para não divergir entre a tela e o PCP.
3. Nenhuma alteração de schema DEVE ser necessária (os modelos já existem);
   SE alguma for, o `migrate-prod.ts` DEVE ser atualizado no mesmo commit.
