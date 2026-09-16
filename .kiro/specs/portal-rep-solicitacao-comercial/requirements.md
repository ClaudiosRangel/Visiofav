# Requirements — Solicitação de Orçamento do Representante coordenada pelo Comercial

## Introdução

A Solicitação de Orçamento criada pelo representante no Portal
(`solicitacao_orcamento_rep`) precisa de duas melhorias: exibir corretamente
o cliente na tela interna e passar a ter um fluxo de status coordenado pelo
setor **Comercial**, com etapas explícitas até virar Pedido de Venda.
Mantém-se a **Opção B**: a solicitação não se transforma em Orçamento Gráfico;
converge no `PedidoVenda` e segue para OP pela Análise de Produção (inalterada).

## Requirements

### Requisito 1 — Exibição correta do cliente

**User Story:** Como usuário interno, quero ver o nome do cliente na listagem
de solicitações, para identificar a solicitação sem abrir o detalhe.

#### Acceptance Criteria
1. QUANDO o representante cria uma solicitação com `clienteId` de sua carteira,
   ENTÃO o sistema DEVE gravar `clienteNome` com o nome do cliente
   (nomeFantasia ou razaoSocial) no momento da criação.
2. QUANDO a listagem interna é exibida E `clienteNome` está nulo mas há
   `clienteId`, ENTÃO o sistema DEVE resolver o nome via relação com `Cliente`.
3. QUANDO nenhuma das fontes tem nome, ENTÃO a tela DEVE exibir "—".
4. O join com `Cliente` NÃO DEVE expor clientes de outra empresa (isolamento
   por `empresaId` preservado).

### Requisito 2 — Fluxo de status coordenado pelo Comercial

**User Story:** Como Comercial, quero controlar quando a solicitação vai para
orçamento e quando ela vira pedido, para coordenar o processo.

#### Acceptance Criteria
1. O sistema DEVE suportar os status: PENDENTE, EM_ORCAMENTO, PRECIFICADA,
   LIBERADA_PEDIDO, CONVERTIDA, RECUSADA, CANCELADA.
2. QUANDO uma transição é solicitada, ENTÃO o sistema DEVE validá-la contra a
   máquina de estados e rejeitar transições inválidas com HTTP 400
   (`code: TRANSICAO_INVALIDA`).
3. QUANDO o Comercial envia para orçamento (PENDENTE → EM_ORCAMENTO), ENTÃO o
   sistema DEVE gravar `enviadaOrcamentoEm/PorId`.
4. QUANDO ocorre a precificação (EM_ORCAMENTO → PRECIFICADA), ENTÃO o sistema
   DEVE gravar preço e `precificadaEm/PorId`.
5. QUANDO o Comercial libera para pedido (PRECIFICADA → LIBERADA_PEDIDO),
   ENTÃO o sistema DEVE gravar `liberadaPedidoEm/PorId`.
6. A conversão em pedido SÓ DEVE ser permitida a partir de LIBERADA_PEDIDO.
7. QUANDO uma solicitação é recusada, ENTÃO o sistema DEVE exigir `motivoRecusa`
   (HTTP 400 `code: MOTIVO_OBRIGATORIO` se ausente) e gravar status RECUSADA.

### Requisito 3 — Conversão em Pedido de Venda (Opção B)

**User Story:** Como Comercial, quero converter a solicitação liberada em
Pedido de Venda, para dar continuidade à produção.

#### Acceptance Criteria
1. QUANDO a solicitação está LIBERADA_PEDIDO E o Comercial converte, ENTÃO o
   sistema DEVE criar um `PedidoVenda` com status CONFIRMADO,
   `origemPedido='ORCAMENTO'` e SEM `orcamentoOrigemId`.
2. O sistema DEVE gravar `pedidoVendaId`, `convertidaPedidoEm` e status
   CONVERTIDA na solicitação.
3. O fluxo PedidoVenda → OP (Análise de Produção do PCP) NÃO DEVE ser alterado.

### Requisito 4 — Autorização

**User Story:** Como gestor, quero que apenas usuários autorizados executem as
transições, para manter o controle do processo.

#### Acceptance Criteria
1. As transições coordenadas pelo Comercial DEVEM exigir perfil ADMIN/SUPER_ADMIN
   (com ponto de extensão para um futuro papel COMERCIAL).
2. QUANDO um usuário sem permissão tenta executar, ENTÃO o sistema DEVE
   retornar HTTP 403.

### Requisito 5 — Compatibilidade de dados existentes

**User Story:** Como responsável pelo deploy, quero que os registros atuais
continuem consistentes após a mudança.

#### Acceptance Criteria
1. A migração DEVE mapear status legados: CALCULADO → PRECIFICADA,
   ENVIADO → CONVERTIDA, RECUSADO → RECUSADA.
2. Os novos campos DEVEM ser adicionados de forma idempotente
   (`ADD COLUMN IF NOT EXISTS`) em `prisma/migrate-prod.ts`, testados 2x local.
3. Nenhum dado existente DEVE ser perdido.
