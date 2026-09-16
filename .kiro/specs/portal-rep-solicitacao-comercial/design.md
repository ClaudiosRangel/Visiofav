# Design — Solicitação do Representante integrada ao Orçamento Gráfico (Opção A)

## Visão geral

O representante cria uma **Solicitação de Orçamento** no Portal
(`solicitacao_orcamento_rep`). O fluxo correto de negócio (Opção A) é:

```
Rep cria Solicitação (PENDENTE)
  → Comercial "Enviar para orçamento"  → cria um OrcamentoGrafico (RASCUNHO)
                                          pré-preenchido; solicitação = EM_ORCAMENTO
  → Orçamentista precifica no Orçamento Gráfico (motor real: papel, gramatura,
    acabamentos, margem) e envia (OrcamentoGrafico: RASCUNHO → ENVIADO);
    solicitação = PRECIFICADA
  → Rep vê o preço no Portal e APROVA em nome do cliente (registra quem aprovou)
    → OrcamentoGrafico ENVIADO → APROVADO → gera PedidoVenda; solicitação = CONVERTIDA
  → PedidoVenda segue para OP pela Análise de Produção do PCP (inalterado)
```

Esta é uma **revisão da spec** que antes seguia a Opção B (precificação
placeholder dentro da própria solicitação). Agora a solicitação **passa por
Orçamento Gráfico de verdade** e a aprovação é feita pelo próprio
representante no Portal externo.

### Escopo

- Ligar a Solicitação do Representante ao `OrcamentoGrafico` real.
- Criação automática do `OrcamentoGrafico` (RASCUNHO) a partir da solicitação.
- Aprovação pelo representante no Portal externo, com registro de quem aprovou.
- Correção da exibição do cliente (já implementada — mantida).
- Reaproveitar a máquina de estados da solicitação (já implementada), ajustando
  o significado das transições para refletir o ciclo do orçamento gráfico.

### Fora do escopo

- Reescrever o motor `calcularOrcamentoGrafico` (já existe e será usado como está).
- Alterar o fluxo PedidoVenda → OP (Análise de Produção permanece igual).

## Descompasso de dados (ponto crítico)

A solicitação e o orçamento gráfico têm formatos diferentes:

| Campo | SolicitacaoOrcamentoRep | OrcamentoGrafico (exigido) |
|---|---|---|
| Tipo de embalagem | `tipoEmbalagem` **string livre** ("Trem Embalagens") | `tipoEmbalagemId` **FK** para `TipoEmbalagem` |
| Medidas | `medidaLargura/Altura/Comprimento` (colunas) | `medidas` **JSON** (`{L,A,P,...}`) |
| Cores | — | `cores` JSON (opcional na criação) |
| Acabamentos | `acabamentos` **string livre** | `acabamentos` JSON (opcional na criação) |
| Cliente | `clienteId?` + `clienteNome` | `clienteId?` + `clienteNome` |
| Quantidade | `quantidade` | `quantidade` |

Consequência: a criação automática do `OrcamentoGrafico` **não consegue
resolver o `tipoEmbalagemId` sozinha** quando a solicitação traz texto livre.

**Estratégia de resolução do tipo de embalagem** (na criação automática):
1. Tentar casar `solicitacao.tipoEmbalagem` (normalizado, sem acento, case-insensitive)
   com `TipoEmbalagem.codigo` ou `TipoEmbalagem.descricao` da empresa.
2. Se houver match único → usar esse `tipoEmbalagemId`.
3. Se não houver match → o Comercial deve escolher o Tipo de Embalagem no ato
   de "Enviar para orçamento" (o endpoint aceita um `tipoEmbalagemId` opcional
   que, quando presente, tem prioridade sobre o match automático). A tela
   interna abre um seletor de Tipo de Embalagem quando o match automático falha.

As medidas viram JSON: `{ L: medidaLargura, A: medidaAltura, P: medidaComprimento }`
(chaves omitidas quando nulas). `cores`/`acabamentos` ficam vazios no RASCUNHO —
o orçamentista completa no Orçamento Gráfico antes de calcular.

## Modelo de dados

### `SolicitacaoOrcamentoRep`

Já possui (desta e da sessão anterior): `orcamentoGraficoId` (vínculo com o
orçamento gerado), campos de auditoria de transição, `pedidoVendaId`,
`motivoRecusa`. Adicionar:

- `aprovadaClientePor String?` (`aprovada_cliente_por`) — nome de quem aprovou
  em nome do cliente (informado pelo rep no Portal).
- `aprovadaClienteEm DateTime?` (`aprovada_cliente_em`).

> Migração idempotente em `prisma/migrate-prod.ts` (regra obrigatória do projeto).

### Máquina de estados (ajuste de significado)

Mantém os status já criados, com o significado alinhado ao orçamento gráfico:

```
PENDENTE        → EM_ORCAMENTO | CANCELADA
EM_ORCAMENTO    → PRECIFICADA | RECUSADA | CANCELADA     (orçamentista trabalha no OG)
PRECIFICADA     → CONVERTIDA | RECUSADA | CANCELADA      (rep aprova no Portal)
CONVERTIDA      → (terminal)
RECUSADA        → (terminal)
CANCELADA       → (terminal)
```

A etapa intermediária `LIBERADA_PEDIDO` da Opção B **deixa de existir** — na
Opção A a "liberação" é a aprovação do cliente, feita pelo rep. O status
`PRECIFICADA` passa a significar "orçamento gráfico enviado, aguardando
aprovação do cliente".

| De → Para | Gatilho | Quem | Efeito no OrcamentoGrafico |
|---|---|---|---|
| PENDENTE → EM_ORCAMENTO | "Enviar para orçamento" | Comercial | **cria** OrcamentoGrafico RASCUNHO |
| EM_ORCAMENTO → PRECIFICADA | orçamentista calcula e envia | Orçamentista | OG RASCUNHO → ENVIADO |
| PRECIFICADA → CONVERTIDA | rep aprova (em nome do cliente) | **Representante (Portal)** | OG ENVIADO → APROVADO → gera PedidoVenda |
| * → RECUSADA | recusar (com motivo) | Comercial ou Rep | OG → RECUSADO (se existir) |

## Componentes e mudanças

### Backend

1. **Serviço de integração — nova função `criarOrcamentoGraficoDeSolicitacao(solicitacaoId, empresaId, usuarioId, tipoEmbalagemIdOverride?)`**
   (em `orcamento-grafico` ou no admin do portal-rep):
   - Resolve `tipoEmbalagemId` (match automático ou override).
   - Monta `medidas` JSON a partir das colunas da solicitação.
   - Cria `OrcamentoGrafico` (status RASCUNHO), com `clienteId/clienteNome`,
     `quantidade`, `observacoes` (inclui referência à solicitação).
   - Grava `orcamentoGraficoId` na solicitação e transiciona para EM_ORCAMENTO.
   - Idempotente: se a solicitação já tem `orcamentoGraficoId`, não recria.

2. **`admin/portal-rep-admin.routes.ts`**:
   - `POST /solicitacoes-orcamento/:id/enviar-orcamento` passa a **criar o
     OrcamentoGrafico** (aceita `tipoEmbalagemId` opcional no body).
   - **Remover** o caminho placeholder de `calcular` e a etapa
     `liberar-pedido` (não fazem mais parte do fluxo). A precificação real
     acontece na tela de Orçamento Gráfico já existente.
   - `converter-pedido` deixa de ser o gerador do pedido — quem gera é a
     aprovação do orçamento gráfico (item 4).

3. **Sincronização de status** — quando o OrcamentoGrafico muda de status
   (ENVIADO/APROVADO/RECUSADO), refletir na solicitação vinculada:
   - Ao **enviar** o OG (rota existente `POST /orcamento-grafico/:id/enviar`):
     se houver solicitação com esse `orcamentoGraficoId`, marcar PRECIFICADA e
     copiar `precoVenda/precoUnitario` para a solicitação (para o rep ver no
     Portal sem expor custo/margem).
   - Ao **aprovar** o OG: marcar a solicitação CONVERTIDA + `pedidoVendaId`.
   - Ao **recusar** o OG: marcar a solicitação RECUSADA.

4. **Aprovação pelo Representante (Portal externo)** — nova rota:
   - `POST /api/portal-rep/solicitacoes-orcamento/:id/aprovar`
     (`portalRepAuth`), body `{ aprovadoPor: string }` (nome de quem aprovou).
     Valida que a solicitação é do vendedor do token e está PRECIFICADA.
     Chama a aprovação do OrcamentoGrafico vinculado (reaproveita a lógica de
     `POST /orcamento-grafico/:id/aprovar` que gera o PedidoVenda), grava
     `aprovadaClientePor/Em`, e sincroniza a solicitação para CONVERTIDA.
   - `POST /api/portal-rep/solicitacoes-orcamento/:id/recusar` (opcional, rep
     recusa em nome do cliente).
   - **Isolamento**: filtrar por `empresaId + vendedorId` do token; nunca
     retornar custo/margem ao rep (Property já existente do portal).

5. **PedidoVenda gerado** — a aprovação do OG cria o pedido (hoje em RASCUNHO
   com `origemPedido='ORCAMENTO_GRAFICO'` e `orcamentoOrigemId`). Para ele
   entrar na Análise de Produção, precisa chegar a status elegível
   (CONFIRMADO/APROVADO). **Decisão**: a rota de aprovação criará o pedido já
   como CONFIRMADO (mesma escolha da conversão atual), preservando
   `orcamentoOrigemId` — assim a OP nasce com etapas do cálculo do orçamento
   gráfico (`gerarOpFromOrcamento`).

### Frontend

- **Interno** (`portal-representante/solicitacoes-orcamento/page.tsx`):
  - Ação "Enviar para orçamento" abre seletor de Tipo de Embalagem quando o
    match automático não resolve; ao confirmar, cria o OG e leva a solicitação
    para EM_ORCAMENTO. Adicionar link/atalho para abrir o Orçamento Gráfico
    gerado (`orcamentoGraficoId`).
  - Remover botões "Precificar" e "Liberar para pedido" (a precificação é na
    tela de Orçamento Gráfico). Manter "Recusar".
- **Portal externo** (`(portal-rep)/portal-rep/orcamentos`):
  - Quando a solicitação está PRECIFICADA, exibir o **preço** e botões
    **Aprovar** / **Recusar**. "Aprovar" abre um campo obrigatório "Aprovado
    por (nome)" e chama a nova rota de aprovação.
- **Tipos/hooks** (`data/hooks/portal-representante`): ajustar status
  (remover LIBERADA_PEDIDO), adicionar hook de aprovar no portal.

## Tratamento de erros

- "Enviar para orçamento" sem tipo resolvido e sem override: HTTP 400
  `code: TIPO_EMBALAGEM_NAO_RESOLVIDO` (frontend abre o seletor).
- Aprovar solicitação fora de PRECIFICADA: HTTP 400 `TRANSICAO_INVALIDA`.
- Aprovar sem `aprovadoPor`: HTTP 400 `APROVADOR_OBRIGATORIO`.
- Rep tentando aprovar solicitação de outro vendedor: HTTP 404 (isolamento).

## Estratégia de testes

- Unit: resolução do tipo de embalagem (match/normalização), montagem do JSON
  de medidas, máquina de estados ajustada.
- Serviço: criação idempotente do OG; sincronização de status OG→solicitação.
- E2E: ciclo completo PENDENTE → EM_ORCAMENTO (OG criado) → precificar/enviar OG
  → rep aprova no Portal → CONVERTIDA + PedidoVenda + OP.

## Migração da Opção B já implementada

O que já subiu (Opção B) e precisa ser ajustado:
- `calcular` (placeholder) e `liberar-pedido`: descontinuar.
- `enviar-orcamento`: reescrever para criar o OG.
- `converter-pedido`: a geração do pedido migra para a aprovação (OG/portal).
- Frontend: remover LIBERADA_PEDIDO e os botões correspondentes.
Os campos de auditoria já adicionados permanecem úteis.
