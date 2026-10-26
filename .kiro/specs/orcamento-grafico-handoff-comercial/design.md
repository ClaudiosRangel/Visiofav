# Design — Hand-off Comercial do Orçamento Gráfico

> Base: `requirements.md` desta spec + `docs/fluxo-comercial-orcamento-pcp-
> faturamento.md`. Backend Fastify + Prisma (multi-tenant por `empresaId`
> explícito), frontend Next/Mantine. Schema + `migrate-prod.ts` no mesmo commit.

## Overview

Fecha o elo Orçamento Gráfico → Comercial → PCP → Faturamento, reusando ao máximo
o que já existe (`OrcamentoGrafico`, `ItemOrcamentoGrafico`, `PedidoVenda`,
`ItemPedidoVenda`, `OrdemProducao`, `RegraAprovacao`/`SolicitacaoAprovacao`,
`NotificacaoRep`, pipeline do portal). Peças novas: status `CONVERTIDO`,
conversão completa (itens + SKU sob demanda), `AprovacaoAmostra`,
`NotificacaoComercial`, `ConversaoOrcamentoLog`, config de amostra e gatilho de
faturamento. Nenhuma reescrita do motor de cálculo nem do fluxo do representante.

Não-objetivos: reescrever o motor de orçamento; alterar a máquina de estados da
OP; comissão detalhada por agente (fora do escopo); EDI/e-commerce.

## Architecture

```
Portal Rep ─┐
            ├─► OrcamentoGrafico (ENVIADO→APROVADO)
Comercial ──┘        │  (aprovado → notifica comercial)
                     ▼
         ┌─ Caixa "Orçamentos a converter" (Vendas)
         │       │ gate de margem (RegraAprovacao) · exige amostra?
         │       ▼
         │  AprovacaoAmostra (quando exigida) ──► APROVADA
         │       │
         ▼       ▼
   Conversão (transação):
     1. resolve/cria Produto SKU por item (anti-colisão)   [D1]
     2. cria PedidoVenda + ItemPedidoVenda (completo)
     3. orçamento → CONVERTIDO ; grava ConversaoOrcamentoLog
                     │
                     ▼
   PedidoVenda: RASCUNHO→CONFIRMADO ──► gera OP (com engenharia do orçamento)
                     │                         │
                     │                    OP CONCLUIDA → pedido EFETIVADO
                     ▼                         ▼
             Painel unificado           Faturamento → NF-e → FATURADO
             (= pipeline do rep)        → notifica rep/comercial
```

## Components and Interfaces

### C1 — Status CONVERTIDO (R1)
- `OrcamentoGrafico.status` ganha o valor `CONVERTIDO` (VARCHAR, sem enum SQL).
- Transição `APROVADO → CONVERTIDO` só pela rota de conversão (C3). Idempotência:
  se já `CONVERTIDO`, retorna 409.

### C2 — Config e sugestão de amostra (R5, D2)
- `Parametro` `comercial.exigir-amostra` = `SEMPRE | NUNCA | QUANDO_MARCADO`
  (default `QUANDO_MARCADO`), por empresa.
- `OrcamentoGrafico.exigeAmostra` (Boolean nullable) e `PedidoVenda.exigeAmostra`
  (Boolean) — override por documento.
- Resolução efetiva (função pura `amostraExigida(config, override, tipoOp)`):
  - `SEMPRE` → true; `NUNCA` → false;
  - `QUANDO_MARCADO` → usa o override; se override null, sugere true quando
    `tipoOp ∈ {NOVO, ALTERAÇÃO}`, false se `REPETIÇÃO`.

### C3 — Conversão completa (R2, R3) — `converterOrcamentoEmPedido`
Serviço transacional. Passos:
1. Validações: orçamento `APROVADO`, tem `clienteId`, empresa tem `TabelaPreco`
   ativa; se faltar → 400 com campo. Se `exigeAmostra` e amostra não `APROVADA`
   → 409 `AMOSTRA_PENDENTE`.
2. Gate de margem (C6): se fora da alçada e sem aprovação → 409 `MARGEM_PENDENTE`.
3. Para cada `ItemOrcamentoGrafico` (ou o cabeçalho, se orçamento single-item):
   resolve o `Produto` via C4 (SKU sob demanda).
4. Cria `PedidoVenda` (origem `ORCAMENTO_GRAFICO`, `orcamentoOrigemId`) +
   `ItemPedidoVenda` por item (produtoId, quantidade, precoFinal, valorTotal),
   copiando condição de pagamento/frete/entrega/observações.
5. `valorTotal` do pedido = soma dos itens (= consolidado do orçamento).
6. Orçamento → `CONVERTIDO`, grava `pedidoVendaId` + `ConversaoOrcamentoLog`.
   Tudo numa `$transaction` (sem pedido órfão).

### C4 — SKU sob demanda (R3, D1) — `resolverProdutoDoItemGrafico`
- Se o item/orçamento já tem `produtoId` (repetição por produto) → reutiliza.
- Senão, procura um `Produto` já criado por conversão anterior do mesmo cálculo
  (vínculo `calculoGraficoOrigemId`/tag) → reutiliza.
- Senão, cria um `Produto` novo: `codigo` único por empresa (prefixo `GRAF-` +
  sequencial), `nome`/`descricao` do cálculo, `unidade`, NCM/CFOP/CST do
  `TipoEmbalagem`/`AtributoGrafico` quando houver; `classificacaoPcp =
  PRODUTO_ACABADO`.
- **Salvaguarda anti-colisão:** nunca atualizar um `Produto` que já tenha
  `OrdemProducao`/`EstruturaProduto`/saldo/pedido — só cria SKU novo
  (padrão de `docs/calcgraf-fase-produtos-plano.md`). Pura onde possível
  (geração de código/validação) para teste.

### C5 — Caixa de entrada + NotificacaoComercial (R4)
- `NotificacaoComercial` (espelha `NotificacaoRep`): `empresaId`, `tipo`,
  `titulo`, `mensagem`, `referenciaTipo`/`referenciaId`, `lida`, `criadoEm`.
- Gatilho: ao orçamento virar `APROVADO` (portal ou interno), cria notificação
  tipo `ORCAMENTO_APROVADO`.
- Rotas: `GET /orcamento-grafico/a-converter` (lista filtrável, marca
  `amostraPendente`), `GET/PUT /comercial/notificacoes[...]`.
- Correção do enum `origemPedido`: front passa a conhecer `ORCAMENTO_GRAFICO`
  (alinhar `OrigemPedido` em `types.ts`). Sem migração (valor já gravado).

### C6 — Gate de margem (R6)
- Reusa `RegraAprovacao`/`SolicitacaoAprovacao` do módulo Vendas. Na conversão,
  calcula a margem/desconto efetivo; se fora da alçada do usuário, abre
  `SolicitacaoAprovacao` e bloqueia (409). Aprovada → conversão prossegue.

### C7 — AprovacaoAmostra (R5)
- Model novo com rodadas. Rotas: criar (SOLICITADA), avançar status, registrar
  anexo, aprovar/reprovar. Aprovação pelo cliente via portal reusa
  `NotificacaoRep`. Bloqueia liberação do pedido para PCP enquanto não `APROVADA`.

### C8 — Elo PCP + faturamento (R7, R8)
- `CONFIRMADO` libera `gerar-de-pedido` (rota de OP já existente). O gerador
  passa a carregar a **engenharia do orçamento** (planos/materiais/cores/
  acabamentos do `ItemOrcamentoGrafico`) para a OP nascer completa.
- OP `CONCLUIDA` (todas etapas) → pedido `EFETIVADO` + `NotificacaoComercial`.
- `EFETIVADO` sinaliza faturamento; NF-e autorizada → `FATURADO` + atualiza
  pipeline do rep.

### C9 — Painel unificado (R9)
- Reusa a fonte do pipeline do portal (PV + OP) e acrescenta a camada de
  amostra. Régua de estágios por orçamento/pedido.

### C10 — Download da imagem do encaixe/imposição (R11)
- O motor já gera `resultadoCalculo.encaixe.layout` (`{ folhaLarguraMm,
  folhaAlturaMm, colunas, linhas, pecaLarguraMm, pecaAlturaMm, orientacao }`).
  Nada de recalcular — o download é só renderização desse layout.
- **Serviço puro `encaixeParaSvg(layout, legenda)`** (sem Prisma): redesenha a
  folha + a grade de peças (colunas × linhas) em SVG escalado, com legenda
  (nº orçamento/item, formato da folha, medida da peça, aproveitamento, folhas).
  Determinístico → testável.
- Rotas (reusam token via query param p/ abrir em nova aba, como os outros PDFs):
  - `GET /orcamento-grafico/:id/itens/:itemId/encaixe.svg`
  - `GET /orcamento-grafico/:id/itens/:itemId/encaixe.png` (rasteriza o SVG via
    `sharp`, já usado no projeto)
  - (desejável) `.../encaixe.pdf` (pdfkit, mesmo padrão dos outros PDFs).
- Quando o item não tem `encaixe.layout` → 404 `ENCAIXE_NAO_GERADO` (o front
  desabilita o botão e informa, sem erro).
- O SVG/PNG do encaixe é **anexável ao PDF da proposta** e à OP gerada (C8),
  como documentação de produção.
- Isolamento: resolve o item por `{ id, orcamento: { empresaId } }` → item de
  outra empresa 403/404. Front: botão "Baixar encaixe" (SVG/PNG/PDF) no
  StepRevisão e na tela de detalhe do orçamento, por item.

## Data Models (novo/alterado)

```prisma
// OrcamentoGrafico: + status CONVERTIDO (valor), + exigeAmostra
model OrcamentoGrafico { /* ... */ exigeAmostra Boolean? @map("exige_amostra") }

// PedidoVenda: + exigeAmostra
model PedidoVenda { /* ... */ exigeAmostra Boolean @default(false) @map("exige_amostra") }

model AprovacaoAmostra {
  id            String   @id @default(uuid())
  empresaId     String   @map("empresa_id")
  orcamentoId   String?  @map("orcamento_id")
  pedidoVendaId String?  @map("pedido_venda_id")
  tipo          String   @db.VarChar(12)  // DIGITAL | FISICA | FACA
  status        String   @db.VarChar(24)  // SOLICITADA|EM_PRODUCAO_AMOSTRA|ENVIADA_CLIENTE|APROVADA|REPROVADA
  rodada        Int      @default(1)
  anexoUrl      String?  @db.Text
  aprovadoPor   String?  @map("aprovado_por")
  aprovadoEm    DateTime? @map("aprovado_em")
  motivoReprova String?  @map("motivo_reprova") @db.Text
  criadoEm      DateTime @default(now()) @map("criado_em")
  @@index([empresaId, orcamentoId])
  @@index([empresaId, pedidoVendaId])
  @@map("aprovacao_amostra")
}

model NotificacaoComercial {
  id             String   @id @default(uuid())
  empresaId      String   @map("empresa_id")
  tipo           String   @db.VarChar(40)
  titulo         String   @db.VarChar(200)
  mensagem       String   @db.Text
  referenciaTipo String?  @map("referencia_tipo") @db.VarChar(30)
  referenciaId   String?  @map("referencia_id")
  lida           Boolean  @default(false)
  criadoEm       DateTime @default(now()) @map("criado_em")
  @@index([empresaId, lida, criadoEm])
  @@map("notificacao_comercial")
}

model ConversaoOrcamentoLog {
  id             String   @id @default(uuid())
  empresaId      String   @map("empresa_id")
  orcamentoId    String   @map("orcamento_id")
  pedidoVendaId  String   @map("pedido_venda_id")
  usuarioId      String   @map("usuario_id")
  margemAplicada Decimal? @map("margem_aplicada") @db.Decimal(5, 2)
  aprovadaPor    String?  @map("aprovada_por")
  criadoEm       DateTime @default(now()) @map("criado_em")
  @@index([empresaId, orcamentoId])
  @@map("conversao_orcamento_log")
}
```
`Parametro`: `comercial.exigir-amostra` (default `QUANDO_MARCADO`). Todo schema
novo com `CREATE TABLE/ADD COLUMN IF NOT EXISTS` no `migrate-prod.ts`, testado 2×.

## Correctness Properties

### Property 1 — Conversão preserva valor
A soma de `valorTotal` dos `ItemPedidoVenda` criados = `valorTotalConsolidado` do
orçamento (tolerância 0,01). **Valida: R2.1, R2.3**

### Property 2 — Conversão atômica e única
Dado um orçamento `APROVADO`, converter cria pedido COM itens OU nada; converter
de novo nunca cria segundo pedido (idempotência por `CONVERTIDO`). **Valida: R1.2, R2.5**

### Property 3 — SKU anti-colisão
`resolverProdutoDoItemGrafico` nunca retorna/edita um `Produto` com OP/estrutura/
saldo/pedido; código gerado é único por empresa. **Valida: R3.3, R3.4**

### Property 4 — Amostra efetiva
`amostraExigida(config, override, tipoOp)`: `SEMPRE`→true; `NUNCA`→false;
`QUANDO_MARCADO`→override, e override null sugere true sse `tipoOp∈{NOVO,ALTERAÇÃO}`.
**Valida: R5.1, R5.2, R5.3**

### Property 5 — Bloqueio por amostra
Com `exigeAmostra=true` e sem `AprovacaoAmostra` APROVADA, a liberação do pedido
para PCP é negada. **Valida: R5.6**

### Property 6 — Rodada de amostra monotônica
Reprovar cria rodada `n+1` preservando as anteriores; `rodada` nunca decresce.
**Valida: R5.5**

### Property 7 — Gate de margem
Margem fora da alçada → conversão bloqueada até aprovação; dentro da alçada →
prossegue. **Valida: R6.1, R6.2**

### Property 8 — Isolamento multi-tenant
Toda query filtra `empresaId` da entidade real; documento de outra empresa →
403/404. **Valida: R10.1**

### Property 9 — Encaixe SVG fiel ao layout
`encaixeParaSvg(layout)` desenha exatamente `colunas × linhas` peças, dentro dos
limites da folha, e é determinístico (mesmo layout → mesmo SVG). Sem layout →
não gera (sinaliza ausência). **Valida: R11.1, R11.4**

## Error Handling
- Conversão sem cliente/tabela → 400 campo faltante. Reconversão → 409
  `JA_CONVERTIDO`. Amostra pendente → 409 `AMOSTRA_PENDENTE`. Margem → 409
  `MARGEM_PENDENTE`. Cross-tenant → 403/404. Transação garante tudo-ou-nada.

## Testing Strategy
- **Vitest + fast-check** (puros): `amostraExigida` (P4), geração/validação de
  código SKU + anti-colisão (P3), consolidação de valor (P1), rodada de amostra
  (P6), resolução de gate de margem (P7), `encaixeParaSvg` fiel/determinístico (P9).
- **Rotas**: conversão atômica/idempotente (P2), bloqueio por amostra (P5),
  isolamento (P8); não-regressão de enviar/aprovar/recusar, gerar-de-pedido,
  NF-e, portal.
- Rodar via `control_pwsh_process` + `--reporter=dot`; validar `get_diagnostics`.

## Sequência (ondas)
1. **Onda 1** — status CONVERTIDO + conversão com itens + SKU sob demanda +
   caixa/NotificacaoComercial + enum origemPedido (R1, R2, R3, R4).
2. **Onda 2** — AprovacaoAmostra configurável + bloqueio + portal (R5).
3. **Onda 3** — gate de margem (R6).
4. **Onda 4** — elo PCP com engenharia + gatilho de faturamento + painel
   unificado (R7, R8, R9) + download do encaixe (R11). Isolamento/auditoria/
   não-regressão (R10) transversal.
