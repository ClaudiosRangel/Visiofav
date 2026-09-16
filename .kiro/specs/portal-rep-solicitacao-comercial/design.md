# Design — Solicitação de Orçamento do Representante coordenada pelo Comercial

## Visão geral

Hoje o representante cria uma **Solicitação de Orçamento** no Portal
(`solicitacao_orcamento_rep`). Do lado interno, em **Portal Representante →
Solicitações de Orçamento**, um admin faz duas ações: **Calcular** (preço
placeholder) e **Converter em Pedido**. Dois problemas motivam esta spec:

1. **Cliente aparece como "—"** na listagem interna, mesmo quando o
   representante selecionou um cliente da carteira (`clienteId` preenchido).
2. **Não há coordenação do Comercial** sobre *quando* enviar a solicitação
   para orçamento e *quando* ela vira pedido — hoje qualquer ADMIN dispara
   ambas as ações sem etapa intermediária de responsabilidade comercial.

Esta spec segue a **Opção B**: a Solicitação do Representante **não** se
transforma em `OrcamentoGrafico`. Ela permanece na sua própria tabela e
converge no `PedidoVenda` (que depois vira OP pela Análise de Produção do
PCP, fluxo já existente e inalterado). O que muda é o **controle das
transições pelo setor Comercial** e a **correção da exibição do cliente**.

### Escopo

- **Dentro do escopo**: correção do nome do cliente na listagem interna e na
  gravação; introdução de um fluxo de status coordenado pelo Comercial com
  etapas explícitas (enviar para orçamento → precificar → liberar para
  pedido → converter); registro de quem/quando executou cada transição;
  ajuste da tela interna para refletir as novas ações.
- **Fora do escopo**: integração com o motor `calcularOrcamentoGrafico`
  (continua placeholder por ora — a precificação real é uma decisão separada);
  transformar a solicitação em `OrcamentoGrafico`; alterar o fluxo
  PedidoVenda → OP (Análise de Produção permanece igual).

## Modelo de dados

### `SolicitacaoOrcamentoRep` (tabela `solicitacao_orcamento_rep`)

Model já existente. Alterações:

- **Novos campos de auditoria de transição** (todos opcionais, sem quebra):
  - `enviadaOrcamentoEm DateTime?` (`enviada_orcamento_em`) — quando o
    Comercial enviou para orçamento.
  - `enviadaOrcamentoPorId String?` (`enviada_orcamento_por_id`) — usuário
    interno que enviou.
  - `precificadaEm DateTime?` (`precificada_em`) — quando o preço foi gravado.
  - `precificadaPorId String?` (`precificada_por_id`).
  - `liberadaPedidoEm DateTime?` (`liberada_pedido_em`) — quando o Comercial
    liberou para virar pedido.
  - `liberadaPedidoPorId String?` (`liberada_pedido_por_id`).
  - `convertidaPedidoEm DateTime?` (`convertida_pedido_em`).
  - `pedidoVendaId String?` (`pedido_venda_id`) — id do PedidoVenda gerado
    (rastreabilidade; hoje não é persistido na solicitação).
  - `motivoRecusa String? @db.Text` (`motivo_recusa`).
- **Campo `clienteNome`**: passa a ser **sempre preenchido na criação**
  quando houver `clienteId` (congela a razão social/nome fantasia no momento
  da solicitação). Continua preenchido diretamente no caso prospect.

> Regra de migração (obrigatória neste projeto): toda alteração de
> `schema.prisma` entra no mesmo commit em `prisma/migrate-prod.ts`, de forma
> idempotente (`ADD COLUMN IF NOT EXISTS`), testada 2x local. Ver steering
> `database-migrations.md`.

### Máquina de estados (nova, explícita)

O `status` continua `String @db.VarChar(20)` (não vira enum Prisma, mantendo
o padrão atual do model). A máquina de estados passa a ser validada em um
único ponto no serviço:

```
PENDENTE            → EM_ORCAMENTO | CANCELADA
EM_ORCAMENTO        → PRECIFICADA | RECUSADA | CANCELADA
PRECIFICADA         → LIBERADA_PEDIDO | RECUSADA | CANCELADA
LIBERADA_PEDIDO     → CONVERTIDA | RECUSADA
CONVERTIDA          → (terminal)
RECUSADA            → (terminal)
CANCELADA           → (terminal)
```

Mapeamento de responsabilidade (quem dispara cada transição):

| De → Para | Ação | Quem |
|---|---|---|
| PENDENTE → EM_ORCAMENTO | "Enviar para orçamento" | **Comercial** |
| EM_ORCAMENTO → PRECIFICADA | "Precificar" (calcular) | Orçamentista/Comercial |
| PRECIFICADA → LIBERADA_PEDIDO | "Liberar para pedido" | **Comercial** |
| LIBERADA_PEDIDO → CONVERTIDA | "Converter em pedido" | **Comercial** |
| qualquer não-terminal → RECUSADA | "Recusar" (com motivo) | Comercial |
| PENDENTE/EM_ORCAMENTO → CANCELADA | "Cancelar" | Rep (só PENDENTE) / Comercial |

> **Compatibilidade de status legados**: registros existentes com status
> `CALCULADO` e `ENVIADO` (usados hoje) são mapeados na migração:
> `CALCULADO → PRECIFICADA`, `ENVIADO → CONVERTIDA` (o `ENVIADO` de hoje já
> significa "virou pedido"). `ACEITO`/`RECUSADO` do enum do frontend: `ACEITO`
> não é gerado por nenhuma rota atual; `RECUSADO → RECUSADA`.

A escolha de separar **PRECIFICADA** de **LIBERADA_PEDIDO** é o que atende ao
seu requisito: precificar não libera automaticamente para pedido — o
Comercial precisa dar o aval explícito ("liberar") antes de converter.

## Autorização

Hoje as rotas admin exigem `verificarPerfilAdmin(user.id)` (ADMIN/SUPER_ADMIN).
Para "coordenado pelo Comercial", introduzir uma verificação de papel
comercial:

- Reaproveitar o mecanismo de perfis existente. Se já houver um perfil/registro
  de vendedor/comercial, exigir que as transições **PENDENTE→EM_ORCAMENTO**,
  **PRECIFICADA→LIBERADA_PEDIDO** e **LIBERADA_PEDIDO→CONVERTIDA** sejam feitas
  por ADMIN/SUPER_ADMIN **ou** por usuário com papel comercial.
- Decisão a validar na fase de tarefas: se não existe hoje um papel
  "COMERCIAL" distinto, o guard inicial mantém ADMIN/SUPER_ADMIN e deixamos um
  ponto de extensão (`verificarPerfilComercial`) para plugar o papel quando
  existir — sem inventar tabela nova nesta spec.

## Componentes e mudanças

### Backend — `src/modules/portal-rep/`

1. **`solicitacao/portal-rep-solicitacao.service.ts` — `criarSolicitacao`**
   - Quando `clienteId` presente: gravar `clienteNome` a partir do
     `cliente.nomeFantasia || cliente.razaoSocial` (o registro já é buscado na
     validação de carteira — só reaproveitar).
   - Isolamento: a busca do cliente já filtra por `empresaId + vendedorId`.

2. **`admin/portal-rep-admin.service.ts`**
   - **`listarSolicitacoesAdmin`**: incluir no `select` a relação
     `cliente: { select: { razaoSocial: true, nomeFantasia: true } }` e montar
     um campo derivado `clienteNomeExibicao = clienteNome || cliente?.nomeFantasia
     || cliente?.razaoSocial || null`. Retornar esse campo (o frontend passa a
     lê-lo, com fallback para `clienteNome`).
   - **Nova função `transicionarSolicitacao(id, novoStatus, { usuarioId, empresaId, motivo? })`**:
     valida a transição contra a máquina de estados, grava os carimbos de
     auditoria correspondentes e o status. Ponto único de validação.
   - **`calcularOrcamento`**: passa a exigir status `EM_ORCAMENTO` (não mais
     `PENDENTE`) e a gravar status `PRECIFICADA` + `precificadaEm/PorId`.
     Precificação continua placeholder (fora de escopo trocar o motor).
   - **`converterEmPedido`** (hoje em `converter-pedido` na rota): passa a
     exigir status `LIBERADA_PEDIDO`; grava `pedidoVendaId`,
     `convertidaPedidoEm` e status `CONVERTIDA`. Mantém
     `PedidoVenda.origemPedido = 'ORCAMENTO'` e **sem** `orcamentoOrigemId`
     (Opção B — não reaproveita etapas de orçamento gráfico).

3. **`admin/portal-rep-admin.routes.ts`**
   - Nova rota `POST /solicitacoes-orcamento/:id/enviar-orcamento`
     (PENDENTE → EM_ORCAMENTO).
   - Nova rota `POST /solicitacoes-orcamento/:id/liberar-pedido`
     (PRECIFICADA → LIBERADA_PEDIDO).
   - Nova rota `POST /solicitacoes-orcamento/:id/recusar` (com `motivoRecusa`).
   - Rotas existentes `/calcular` e `/converter-pedido` mantêm o path, com as
     novas pré-condições de status. Todas com o guard de papel comercial.

### Frontend — `src/app/(interna)/portal-representante/solicitacoes-orcamento/page.tsx`

- Coluna **Cliente**: ler `item.clienteNomeExibicao || item.clienteNome || '—'`.
- Coluna **Ações**: renderizar o botão conforme o status atual:
  - `PENDENTE` → botão "Enviar para orçamento".
  - `EM_ORCAMENTO` → botão "Precificar" (o atual "Calcular").
  - `PRECIFICADA` → botão "Liberar para pedido".
  - `LIBERADA_PEDIDO` → botão "Converter em pedido" (o atual).
  - Ação secundária "Recusar" disponível nos estados não-terminais.
- Atualizar `StatusSolicitacao` e `statusSolicitacaoColors` em
  `data/hooks/portal-representante/types.ts` com os novos status
  (`EM_ORCAMENTO`, `PRECIFICADA`, `LIBERADA_PEDIDO`, `CONVERTIDA`, `RECUSADA`,
  `CANCELADA`) e adicionar hooks React Query para as novas rotas.

## Fluxo completo resultante

```
Rep cria (Portal)              → PENDENTE            [clienteNome congelado]
Comercial "Enviar p/ orçamento"→ EM_ORCAMENTO
Orçamentista "Precificar"      → PRECIFICADA         [preço placeholder por ora]
Comercial "Liberar p/ pedido"  → LIBERADA_PEDIDO
Comercial "Converter"          → CONVERTIDA          → cria PedidoVenda CONFIRMADO
                                                       (origemPedido='ORCAMENTO')
PedidoVenda → OP               → PCP → Análise de Produção → Gerar OP  (inalterado)
```

## Tratamento de erros

- Transição inválida: HTTP 400 com mensagem "Transição não permitida a partir
  do status X" e `code: 'TRANSICAO_INVALIDA'`.
- Recusa sem motivo: HTTP 400 `code: 'MOTIVO_OBRIGATORIO'`.
- Conversão sem `LIBERADA_PEDIDO`: HTTP 400 explicando que precisa liberar antes.
- Falta de papel comercial: HTTP 403.

## Estratégia de testes

- **Unit (Vitest)**: função de validação da máquina de estados — todas as
  transições válidas e uma amostra representativa de inválidas.
- **Serviço**: `criarSolicitacao` grava `clienteNome` quando há `clienteId`;
  `listarSolicitacoesAdmin` resolve o nome do cliente pelo join quando
  `clienteNome` está nulo.
- **E2E (suíte Python/Playwright, `test_02_portal_representante`)**: estender
  para cobrir o ciclo PENDENTE → EM_ORCAMENTO → PRECIFICADA → LIBERADA_PEDIDO →
  CONVERTIDA e a exibição correta do cliente.
- **Isolamento multi-tenant**: garantir que o join com `Cliente` na listagem
  não vaza clientes de outra empresa (o `where` já filtra `empresaId`).
