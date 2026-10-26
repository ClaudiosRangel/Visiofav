# Requirements — Hand-off Comercial do Orçamento Gráfico

## Introdução

Hoje, quando um Orçamento Gráfico é aprovado, o Vizor gera um `PedidoVenda`
apenas com o cabeçalho (cliente, vendedor, valor total) — **sem itens, sem a
engenharia do cálculo e sem um hand-off formal para o setor comercial**. O
comercial precisa redigitar os itens para efetivar/faturar, não há caixa de
entrada nem notificação de "orçamentos a converter", não há controle de
aprovação de amostras/modelos, e não há gate de margem.

Esta feature fecha o elo **Orçamento Gráfico → Comercial → PCP → Faturamento**,
unificando as duas portas de entrada (Representante e Pedido direto) num funil
único com status claros. Desenho completo em
`docs/fluxo-comercial-orcamento-pcp-faturamento.md`.

**Decisões firmadas (usuário, 26/10/2026):**
- **D1:** na conversão, criar **Produto/SKU de verdade sob demanda** a partir do
  cálculo (opção B), com salvaguardas anti-colisão.
- **D2:** aprovação de amostra é **obrigatória quando houver amostra, mas
  configurável pelo comercial** (padrão da empresa + override por documento +
  sugestão automática por TipoOp).

Stack: backend Fastify + Prisma (multi-tenant por `empresaId` explícito),
frontend Next/Mantine. Schema + `migrate-prod.ts` sempre no mesmo commit.

## Glossário

- **Hand-off:** passagem formal do orçamento aprovado para o comercial converter.
- **Conversão:** transformar o orçamento aprovado em `PedidoVenda` completo.
- **Amostra/Modelo:** prova (digital, física ou faca/GCad) enviada ao cliente
  para aprovação antes de produzir a tiragem cheia.
- **Gate de margem:** checagem de alçada de desconto/margem antes da conversão.
- **SKU sob demanda:** `Produto` criado a partir do cálculo gráfico na conversão.

---

## Requirements

### Requisito 1 — Status CONVERTIDO no Orçamento Gráfico

**User Story:** Como comercial, quero distinguir "o cliente aceitou a proposta"
de "o orçamento já virou pedido real", para saber o que ainda falta converter.

#### Acceptance Criteria
1. QUANDO um orçamento está `APROVADO` e o comercial o converte em pedido, ENTÃO
   o sistema DEVE mudar o status do orçamento para `CONVERTIDO`.
2. QUANDO um orçamento está `CONVERTIDO`, ENTÃO o sistema NÃO DEVE permitir
   convertê-lo novamente (evita pedido duplicado).
3. O sistema DEVE preservar os status atuais (`RASCUNHO`, `ENVIADO`, `APROVADO`,
   `RECUSADO`, `VENCIDO`) sem regressão.
4. QUANDO um orçamento é convertido, ENTÃO o sistema DEVE gravar o vínculo
   `pedidoVendaId` no orçamento e `orcamentoOrigemId` no pedido.

### Requisito 2 — Conversão cria PedidoVenda COMPLETO (com itens)

**User Story:** Como comercial, quero que a conversão traga os itens, preços e
condições do orçamento, para não redigitar nada.

#### Acceptance Criteria
1. QUANDO o comercial converte um orçamento aprovado, ENTÃO o sistema DEVE criar
   um `ItemPedidoVenda` para cada item do orçamento (quantidade, preço unitário,
   valor total).
2. O sistema DEVE copiar para o pedido: condição de pagamento, frete, data de
   entrega e observações disponíveis no orçamento.
3. O `valorTotal` do pedido DEVE ser igual ao consolidado do orçamento (soma dos
   itens), sem divergência.
4. SE o orçamento não tiver `clienteId` OU a empresa não tiver `TabelaPreco`
   ativa, ENTÃO o sistema DEVE bloquear a conversão com mensagem clara (campo
   faltante), em vez de criar um pedido inválido.
5. A operação DEVE ser atômica (transação): ou cria pedido + todos os itens, ou
   nenhum (sem pedido órfão sem itens).

### Requisito 3 — SKU sob demanda a partir do cálculo (D1)

**User Story:** Como comercial, quero que o item gráfico vire um Produto real no
pedido, para que seja possível faturar (NF-e) e produzir (OP).

#### Acceptance Criteria
1. QUANDO um item do orçamento não tiver um `Produto` vinculado, ENTÃO o sistema
   DEVE criar um `Produto` (SKU) a partir do cálculo (descrição, unidade, NCM/
   dados fiscais do `TipoEmbalagem`/`AtributoGrafico` quando disponíveis).
2. QUANDO já existir um `Produto` adequado vinculado ao cálculo (ex.: repetição),
   ENTÃO o sistema DEVE reutilizá-lo em vez de criar outro.
3. O sistema NÃO DEVE criar nem alterar um `Produto` que já tenha `OrdemProducao`,
   `EstruturaProduto`, saldo de estoque ou pedido vinculado (salvaguarda
   anti-colisão).
4. O `Produto` criado DEVE ter `empresaId` da empresa real e `codigo` único na
   empresa (gerado sem colidir com códigos existentes).
5. O vínculo cálculo → produto DEVE ficar rastreável para reaproveitamento em
   conversões futuras (repetição não recria SKU).

### Requisito 4 — Caixa de entrada do Comercial + notificação (hand-off)

**User Story:** Como comercial, quero ver uma lista de "orçamentos a converter" e
ser notificado quando um orçamento é aprovado, para não perder o hand-off.

#### Acceptance Criteria
1. QUANDO um orçamento passa a `APROVADO` (pelo representante no portal OU pelo
   comercial), ENTÃO o sistema DEVE criar uma `NotificacaoComercial` para o setor
   comercial.
2. O sistema DEVE expor uma listagem "Orçamentos a converter" filtrável
   (cliente, vendedor, período, origem), isolada por `empresaId`.
3. A listagem DEVE distinguir orçamentos que **exigem amostra pendente** dos que
   estão prontos para converter.
4. As notificações DEVEM ter indicador lida/não-lida e contador para badge.
5. O enum `origemPedido` DEVE ser alinhado entre backend e frontend (hoje o back
   grava `ORCAMENTO_GRAFICO` e o front só conhece `ORCAMENTO`), de modo que o
   comercial consiga filtrar pedidos originados de orçamento gráfico.

### Requisito 5 — Aprovação de Amostra/Modelo configurável (D2)

**User Story:** Como comercial, quero controlar quando um pedido exige aprovação
de amostra antes de produzir, para não liberar produção de arte não aprovada.

#### Acceptance Criteria
1. O sistema DEVE suportar uma configuração da empresa `comercial.exigir-amostra`
   com valores `SEMPRE` | `NUNCA` | `QUANDO_MARCADO` (default `QUANDO_MARCADO`).
2. O comercial DEVE poder marcar/desmarcar `exigeAmostra` por orçamento/pedido,
   sobrepondo o padrão da empresa.
3. QUANDO o `TipoOp` do cálculo for `NOVO` ou `ALTERAÇÃO` (não `REPETIÇÃO`),
   ENTÃO o sistema DEVE sugerir `exigeAmostra = true` por padrão (comercial
   confirma); `REPETIÇÃO` não sugere.
4. O sistema DEVE registrar `AprovacaoAmostra` com: `tipo` (`DIGITAL` | `FISICA`
   | `FACA`), `status` (`SOLICITADA` → `EM_PRODUCAO_AMOSTRA` → `ENVIADA_CLIENTE`
   → `APROVADA` | `REPROVADA`), `rodada`, `anexoUrl`, `aprovadoPor`, `aprovadoEm`,
   `motivoReprova`.
5. QUANDO uma amostra é `REPROVADA`, ENTÃO o sistema DEVE permitir abrir nova
   rodada (`rodada + 1`) mantendo o histórico das anteriores.
6. QUANDO `exigeAmostra = true` e não existe `AprovacaoAmostra` em `APROVADA`,
   ENTÃO o sistema DEVE **bloquear** a liberação do pedido para o PCP.
7. O representante DEVE poder registrar a aprovação/reprovação da amostra pelo
   cliente via portal (reusando o mecanismo de notificação existente).

### Requisito 6 — Gate de margem/desconto na conversão

**User Story:** Como gestor comercial, quero que descontos/margens fora da alçada
exijam aprovação antes de virar pedido, para proteger a rentabilidade.

#### Acceptance Criteria
1. QUANDO a conversão aplicar desconto/margem fora da alçada do comercial, ENTÃO
   o sistema DEVE abrir uma `SolicitacaoAprovacao` (modelo já existente no módulo
   Vendas) e impedir a conversão até a liberação.
2. QUANDO a margem/desconto estiver dentro da alçada, ENTÃO a conversão DEVE
   proceder sem aprovação extra.
3. O sistema DEVE registrar quem aprovou a margem e o valor aplicado
   (auditoria `ConversaoOrcamentoLog`).

### Requisito 7 — Estágios do Pedido e comunicação com PCP

**User Story:** Como comercial, quero liberar o pedido para o PCP e acompanhar a
produção, para saber quando estará pronto.

#### Acceptance Criteria
1. O pedido DEVE seguir os estágios existentes: `RASCUNHO` → `CONFIRMADO` →
   `EM_SEPARACAO` → `EFETIVADO` → `FATURADO` (+ `CANCELADO`), sem regressão.
2. QUANDO o comercial confirma o pedido (`RASCUNHO` → `CONFIRMADO`) e
   `exigeAmostra` estiver satisfeito, ENTÃO o sistema DEVE liberar a geração de
   OP a partir do pedido.
3. QUANDO a OP é gerada do pedido, ENTÃO o sistema DEVE **carregar a engenharia
   do orçamento gráfico** (planos, materiais, cores, acabamentos) para a OP, de
   modo que ela nasça completa (não só o cabeçalho).
4. QUANDO todas as etapas da OP concluírem, ENTÃO o sistema DEVE marcar o pedido
   como `EFETIVADO` (pronto para faturar) e notificar o comercial.
5. O vínculo pedido ↔ OP DEVE ser rastreável nos dois sentidos.

### Requisito 8 — Comunicação com o Faturamento

**User Story:** Como faturista, quero saber quais pedidos estão prontos para
faturar, para emitir a NF-e no momento certo.

#### Acceptance Criteria
1. QUANDO o pedido chega a `EFETIVADO`, ENTÃO o sistema DEVE sinalizar ao
   Faturamento que o pedido está pronto para NF-e.
2. QUANDO a NF-e é autorizada, ENTÃO o sistema DEVE mudar o pedido para
   `FATURADO` e atualizar o pipeline do representante e o painel do comercial.
3. O sistema DEVE manter o isolamento multi-tenant em todas as integrações
   (empresaId da entidade real, nunca só do usuário logado).

### Requisito 9 — Painel de status unificado

**User Story:** Como comercial, quero ver o estágio de ponta a ponta de cada
orçamento/pedido num só lugar, para dar retorno ao cliente/representante.

#### Acceptance Criteria
1. O sistema DEVE exibir, por orçamento/pedido, a régua de estágios:
   Solicitação → Orçamento → Amostra → Pedido → OP/Produção → Faturamento →
   Entrega, com o status corrente de cada camada.
2. O percentual de produção DEVE ser exibido quando houver OP em andamento
   (`etapasConcluidas / totalEtapas`).
3. A visão DEVE ser consistente com o pipeline já exibido ao representante no
   portal (mesma fonte de verdade).

### Requisito 11 — Download da imagem do encaixe/imposição (documentação de consulta)

**User Story:** Como comercial/representante, quero baixar a imagem do encaixe
(imposição) que o sistema monta para o item do orçamento, para usar como
documentação de consulta (anexar à OP, enviar ao cliente, arquivar).

#### Acceptance Criteria
1. QUANDO um item do orçamento tiver um encaixe calculado (`resultadoCalculo.
   encaixe.layout`, o SVG já gerado pelo motor), ENTÃO o sistema DEVE permitir
   **baixar a imagem do encaixe** daquele item.
2. O sistema DEVE oferecer o download em **SVG** (vetorial) e em **PNG**
   (rasterizado para quem precisa colar em documento); PDF é desejável.
3. A imagem DEVE conter uma legenda mínima: nº do orçamento/item, formato da
   folha, medida da peça, aproveitamento (peças/folha) e nº de folhas.
4. QUANDO o item NÃO tiver encaixe calculado, ENTÃO o sistema DEVE desabilitar o
   download e informar que o encaixe ainda não foi gerado (sem erro).
5. O encaixe DEVE poder ser **anexado ao PDF da proposta** e à OP gerada, como
   documentação de produção.
6. O download DEVE respeitar o isolamento multi-tenant (item de outra empresa →
   403/404).

### Requisito 10 — Isolamento, auditoria e não-regressão

#### Acceptance Criteria
1. Toda query nova DEVE filtrar `empresaId` explícito (não confiar só no
   `prismaScoped`).
2. As ações de conversão, aprovação de amostra e aprovação de margem DEVEM
   registrar auditoria (quem/quando/o quê).
3. Os fluxos existentes (orçamento enviar/aprovar/recusar, pedido confirmar/
   cancelar, geração de OP, emissão de NF-e, portal do representante) NÃO DEVEM
   regredir.
4. Schema novo DEVE vir com `migrate-prod.ts` idempotente no mesmo commit.
