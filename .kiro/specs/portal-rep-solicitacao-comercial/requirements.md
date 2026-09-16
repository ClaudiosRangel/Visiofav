# Requirements — Solicitação do Representante integrada ao Orçamento Gráfico (Opção A)

## Introdução

A Solicitação de Orçamento criada pelo representante deve percorrer o
Orçamento Gráfico real antes de virar pedido. O Comercial envia a solicitação
para orçamento (gerando um Orçamento Gráfico pré-preenchido), o orçamentista
precifica/envia, e o **representante aprova pelo Portal em nome do cliente**,
o que gera o Pedido de Venda que segue para OP (Análise de Produção, inalterada).

## Requirements

### Requisito 1 — Exibição correta do cliente (mantido)

**User Story:** Como usuário interno, quero ver o nome do cliente na listagem
de solicitações.

#### Acceptance Criteria
1. QUANDO o rep cria com `clienteId`, ENTÃO o sistema DEVE gravar `clienteNome`.
2. QUANDO `clienteNome` está nulo mas há `clienteId`, ENTÃO a listagem DEVE
   resolver o nome via `Cliente`, isolado por `empresaId`.
3. QUANDO não há nome, ENTÃO a tela exibe "—".

### Requisito 2 — Enviar para orçamento cria Orçamento Gráfico

**User Story:** Como Comercial, quero enviar a solicitação para orçamento,
gerando um Orçamento Gráfico pré-preenchido.

#### Acceptance Criteria
1. QUANDO o Comercial envia (PENDENTE → EM_ORCAMENTO), ENTÃO o sistema DEVE
   criar um `OrcamentoGrafico` em status RASCUNHO vinculado à solicitação
   (`orcamentoGraficoId`).
2. O sistema DEVE pré-preencher o Orçamento Gráfico com cliente, quantidade,
   medidas (JSON a partir das colunas da solicitação) e observações.
3. QUANDO `tipoEmbalagem` (texto) casar unicamente com um `TipoEmbalagem` da
   empresa, ENTÃO o sistema DEVE usar esse `tipoEmbalagemId`.
4. QUANDO não houver match, ENTÃO o sistema DEVE exigir `tipoEmbalagemId`
   informado pelo Comercial (HTTP 400 `TIPO_EMBALAGEM_NAO_RESOLVIDO` se ausente).
5. A criação DEVE ser idempotente: se a solicitação já tem `orcamentoGraficoId`,
   não recriar.

### Requisito 3 — Precificação e envio no Orçamento Gráfico

**User Story:** Como orçamentista, quero precificar no Orçamento Gráfico e
enviá-lo, refletindo o status na solicitação.

#### Acceptance Criteria
1. A precificação DEVE usar o motor real do Orçamento Gráfico (não placeholder).
2. QUANDO o Orçamento Gráfico é enviado (RASCUNHO → ENVIADO), ENTÃO a
   solicitação vinculada DEVE ir para PRECIFICADA e copiar `precoVenda`/
   `precoUnitario` (para o rep ver o preço).
3. O rep NUNCA DEVE receber custo/margem.

### Requisito 4 — Aprovação pelo Representante no Portal

**User Story:** Como representante, quero aprovar o orçamento em nome do
cliente pelo Portal, registrando quem aprovou.

#### Acceptance Criteria
1. QUANDO a solicitação está PRECIFICADA, ENTÃO o Portal DEVE exibir o preço e
   permitir Aprovar/Recusar.
2. QUANDO o rep aprova, ENTÃO o sistema DEVE exigir `aprovadoPor` (nome)
   (HTTP 400 `APROVADOR_OBRIGATORIO` se ausente) e gravar
   `aprovadaClientePor/Em`.
3. A aprovação DEVE aprovar o Orçamento Gráfico vinculado (ENVIADO → APROVADO),
   gerando o `PedidoVenda`, e marcar a solicitação CONVERTIDA + `pedidoVendaId`.
4. A aprovação DEVE respeitar isolamento por `empresaId + vendedorId` do token
   (rep de outro vendedor recebe 404).
5. QUANDO o rep recusa, ENTÃO a solicitação e o Orçamento Gráfico vão para
   RECUSADA/RECUSADO.

### Requisito 5 — Pedido de Venda e OP

**User Story:** Como PCP, quero que o pedido gerado siga para OP com as etapas
do orçamento gráfico.

#### Acceptance Criteria
1. O `PedidoVenda` gerado na aprovação DEVE ter `origemPedido='ORCAMENTO_GRAFICO'`,
   `orcamentoOrigemId` preenchido e status elegível (CONFIRMADO).
2. O fluxo PedidoVenda → OP (Análise de Produção) NÃO DEVE ser alterado; a OP
   nasce com etapas do `resultadoCalculo` do orçamento (via `gerarOpFromOrcamento`).

### Requisito 6 — Autorização

#### Acceptance Criteria
1. As ações internas (enviar para orçamento, recusar) DEVEM exigir
   ADMIN/SUPER_ADMIN.
2. As ações do Portal (aprovar/recusar) DEVEM exigir `portalRepAuth`.

### Requisito 7 — Compatibilidade e migração

#### Acceptance Criteria
1. Novos campos (`aprovada_cliente_por`, `aprovada_cliente_em`) DEVEM ser
   adicionados idempotentemente em `migrate-prod.ts`.
2. Registros em `LIBERADA_PEDIDO` (status intermediário da Opção B, se
   existirem) DEVEM ser mapeados para PRECIFICADA.
3. Nenhum dado existente DEVE ser perdido.
