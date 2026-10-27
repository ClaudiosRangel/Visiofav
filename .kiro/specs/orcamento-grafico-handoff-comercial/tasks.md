# Implementation Plan — Hand-off Comercial do Orçamento Gráfico

## Overview

Ordem por ondas (design §Sequência). Funções puras com property-based (fast-check)
primeiro; schema+`migrate-prod.ts` no MESMO commit; `empresaId` explícito em toda
query; não-regressão de enviar/aprovar/recusar, gerar-de-pedido, NF-e e portal.
Verificar com `get_diagnostics`; testes via `vitest --reporter=dot`.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2", "3", "4"] },
    { "wave": 2, "tasks": ["5"] },
    { "wave": 3, "tasks": ["6"] },
    { "wave": 4, "tasks": ["7", "8", "9"] },
    { "wave": 5, "tasks": ["10"] }
  ]
}
```

## Tasks

### Onda 1 — Conversão completa + SKU sob demanda + hand-off

- [x] 1. Schema + migração (base das 3 ondas)
  - [x] 1.1 `schema.prisma` + `migrate-prod.ts` idempotente: `exigeAmostra`
    (orçamento/pedido) + models `AprovacaoAmostra`, `NotificacaoComercial`,
    `ConversaoOrcamentoLog`. Config `comercial.exigir-amostra` lida no serviço.
    - _Requirements: 1, 5, 10.4_

- [x] 2. SKU sob demanda (D1) — puro + serviço
  - [x] 2.1 `sku-sob-demanda.puro.ts` (`gerarCodigoSku` + `montarProdutoDoCalculo`);
    service reexporta.
    - _Requirements: 3.1, 3.4_
  - [x]* 2.2 Teste P3 — 8/8 (código único + ignora padrão inválido); anti-colisão
    em `produtoLivreDeVinculos`.
    - _Requirements: 3.3, 3.4_
  - [x] 2.3 `resolverProdutoDoItemGrafico`: reusa produtoId; senão cria SKU novo.
    - _Requirements: 3.1, 3.2, 3.3, 3.5_

- [x] 3. Conversão completa (R2) — `converterOrcamentoEmPedido`
  - [x] 3.1 `converter-orcamento.service.ts` transacional (single+multi-item).
    - _Requirements: 1.1, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5_
  - [ ]* 3.2 Teste P1/P2 vira teste de ROTA (depende de banco) na Onda 5.
    - _Requirements: 1.2, 2.3, 2.5_
  - [x] 3.3 Rota `POST /orcamento-grafico/:id/converter`.
    - _Requirements: 1.1, 2.4_

- [x] 4. Caixa de entrada + NotificacaoComercial + enum origemPedido (R4)
  - [x] 4.1 Gatilho em `POST /:id/aprovar` E no portal `aprovarSolicitacaoRep`.
    - _Requirements: 4.1_
  - [x] 4.2 Rotas `GET /a-converter` + `/comercial/notificacoes` (listar/count/ler/ler-todas).
    - _Requirements: 4.2, 4.3, 4.4_
  - [x] 4.3 Front: enum + opção no filtro de Pedidos. (Aba/sino = leva de frontend.)
    - _Requirements: 4.5_

### Onda 2 — Aprovação de Amostra/Modelo (configurável)

- [x] 5. AprovacaoAmostra (R5, D2)
  - [x] 5.1 Puro `amostraExigida` + `proximaRodada` (`amostra.puro.ts`).
    - _Requirements: 5.1, 5.2, 5.3_
  - [x]* 5.2 Teste P4 + P6 (`amostra.puro.test.ts`).
    - _Requirements: 5.1, 5.2, 5.3, 5.5_
  - [x] 5.3 `amostra.service.ts`: solicitar (rodada), avançar status, anexo,
    aprovar/reprovar; `liberacaoPermitidaPorAmostra` (P5). Rotas `/amostras*` +
    `PATCH /:id/exige-amostra`.
    - _Requirements: 5.4, 5.5, 5.6_
  - [x] 5.4 Portal do representante: `/:id/amostras`, `/amostras/:id/aprovar|reprovar`.
    - _Requirements: 5.7_
  - [x] 5.5 Front comercial: tela de rodadas da amostra (`AmostrasModal` no
    detalhe do orçamento) + config da empresa (`comercial.exigir-amostra`:
    SEMPRE/NUNCA/QUANDO_MARCADO) via Popover na tela "Orçamentos a Converter"
    (rotas novas `GET/PUT /comercial/config-amostra`). Portal rep:
    `AmostrasRepSection` (aprovar/reprovar em nome do cliente).
    - _Requirements: 5.2, 5.4, 5.7_

### Onda 3 — Gate de margem

- [x] 6. Gate de margem na conversão (R6)
  - [x] 6.1 `gate-margem.puro.ts` + integração na conversão (abre
    `SolicitacaoAprovacao` + 409 `MARGEM_PENDENTE`); rota aceita `descontoPercent`/
    `gateAprovado`. Grava `margemAplicada` no `ConversaoOrcamentoLog`.
    - _Requirements: 6.1, 6.2, 6.3_
  - [x]* 6.2 Teste P7 (`gate-margem.puro.test.ts`).
    - _Requirements: 6.1, 6.2_

### Onda 4 — PCP + Faturamento + Painel + Encaixe

- [x] 7. Elo PCP com engenharia do orçamento (R7)
  - [x] 7.1 `liberar-pedido-pcp.service.ts`: confirma pedido + emite OPs via
    `emitirOpEmLote` (OP já nasce completa — mecanismo nativo). Trava de amostra
    (P5). Rota `POST /pedidos/:pedidoId/liberar-pcp`.
    - _Requirements: 7.2, 7.3, 7.5_
  - [x] 7.2 OP `CONCLUIDA` → pedido `EFETIVADO` + `NotificacaoComercial`
    (gatilho em `concluirEtapa`, best-effort).
    - _Requirements: 7.4_

- [x] 8. Gatilho de faturamento + pipeline (R8, R9)
  - [x] 8.1 Pedido `EFETIVADO` notifica comercial (pronto p/ faturar). FATURADO
    pela emissão de NF-e existente (fluxo fiscal já grava FATURADO).
    - _Requirements: 8.1, 8.2, 8.3_
  - [x] 8.2 Painel unificado (régua de estágios): endpoint
    `GET /pedidos/:pedidoId/jornada` (`jornada-pedido.service.ts`, agregação
    orçamento→amostra→pedido→OPs→faturamento, empresaId explícito) +
    componente `JornadaPedido` embutido no detalhe do pedido (origem
    ORCAMENTO_GRAFICO).
    - _Requirements: 9.1, 9.2, 9.3_

- [x] 9. Download da imagem do encaixe (R11)
  - [x] 9.1 Puro `encaixeParaSvg(layout, legenda)` (`encaixe-svg.puro.ts`).
    - _Requirements: 11.1, 11.3_
  - [x]* 9.2 Teste P9 (`encaixe-svg.puro.test.ts`).
    - _Requirements: 11.1, 11.4_
  - [x] 9.3 Rotas `GET /:id[/itens/:itemId]/encaixe.svg|.pdf` (token via query;
    PDF via pdfkit; PNG adiado — `sharp` não está no back). 404 `ENCAIXE_NAO_GERADO`;
    isolamento empresaId.
    - _Requirements: 11.1, 11.2, 11.4, 11.6_
  - [ ] 9.4 Anexar o encaixe ao PDF da proposta/OP (incremento futuro — rotas prontas).
    - _Requirements: 11.5_
  - [x] 9.5 Front: botão "Baixar encaixe". No detalhe do orçamento (SVG/PDF por
    item, via rota com token); no wizard `StepRevisao`, download CLIENT-SIDE
    (SVG gerado em memória do `encaixe.layout`, sem item persistido).
    - _Requirements: 11.1, 11.4_

### Onda 5 — Validação e não-regressão

- [x] 10. Isolamento, auditoria e não-regressão (R10)
  - [x] 10.1 Rotas novas filtram `empresaId` explícito; auditoria de conversão
    (`ConversaoOrcamentoLog`) + logs OP. get_diagnostics limpo.
    - _Requirements: 10.1, 10.2_
  - [x] 10.2 Testes novos 28/28 (handoff-comercial). Suíte orcamento-grafico:
    269 passed; 1 falha PRÉ-EXISTENTE e flaky em `enriquecimento-engenharia.
    service.test.ts` (commit 8012e9111, outra spec — não tocado aqui).
    - _Requirements: 10.3_

## Notes

- Tarefas `*` são property-based (fast-check), recomendadas nas puras.
- D1: SKU sob demanda com salvaguarda anti-colisão (nunca mexer em Produto com
  OP/estrutura/saldo/pedido).
- D2: amostra configurável (`comercial.exigir-amostra` + override + sugestão por
  TipoOp); bloqueia liberação p/ PCP quando exigida e não aprovada.
- R11: o encaixe JÁ é gerado pelo motor (`encaixe.layout`); a feature é só
  renderizar/baixar (SVG/PNG/PDF) e anexar como documentação.
- Schema novo: `schema.prisma` + `migrate-prod.ts` juntos, idempotente, testado 2×.
