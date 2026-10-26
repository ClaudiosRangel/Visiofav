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

- [ ] 5. AprovacaoAmostra (R5, D2)
  - [ ] 5.1 Puro `amostraExigida(config, override, tipoOp)`.
    - _Requirements: 5.1, 5.2, 5.3_
  - [ ]* 5.2 Teste P4 (regra de exigência) + P6 (rodada monotônica).
    - _Requirements: 5.1, 5.2, 5.3, 5.5_
  - [ ] 5.3 Serviço + rotas: criar amostra (SOLICITADA), avançar status, anexo,
    aprovar/reprovar (nova rodada no reprovar). Bloqueio da liberação p/ PCP quando
    `exigeAmostra` e sem amostra `APROVADA` (P5).
    - _Requirements: 5.4, 5.5, 5.6_
  - [ ] 5.4 Portal do representante: cliente aprova/reprova a amostra (reusa
    `NotificacaoRep`).
    - _Requirements: 5.7_
  - [ ] 5.5 Front comercial: marcar `exigeAmostra` por orçamento/pedido +
    tela de rodadas da amostra (anexo/aprovação).
    - _Requirements: 5.2, 5.4_

### Onda 3 — Gate de margem

- [ ] 6. Gate de margem na conversão (R6)
  - [ ] 6.1 Reusar `RegraAprovacao`/`SolicitacaoAprovacao`: na conversão, margem
    fora da alçada → abre solicitação + bloqueia (409 `MARGEM_PENDENTE`); dentro →
    prossegue. Grava `aprovadaPor`/`margemAplicada` no `ConversaoOrcamentoLog`.
    - _Requirements: 6.1, 6.2, 6.3_
  - [ ]* 6.2 Teste P7 (resolução do gate).
    - _Requirements: 6.1, 6.2_

### Onda 4 — PCP + Faturamento + Painel + Encaixe

- [ ] 7. Elo PCP com engenharia do orçamento (R7)
  - [ ] 7.1 `gerar-de-pedido` (OP) passa a carregar a engenharia do
    `ItemOrcamentoGrafico` (planos/materiais/cores/acabamentos) → OP nasce completa.
    Liberação só com amostra satisfeita (T5).
    - _Requirements: 7.2, 7.3, 7.5_
  - [ ] 7.2 OP `CONCLUIDA` (todas etapas) → pedido `EFETIVADO` + `NotificacaoComercial`.
    - _Requirements: 7.4_

- [ ] 8. Gatilho de faturamento + pipeline (R8, R9)
  - [ ] 8.1 Pedido `EFETIVADO` sinaliza faturamento; NF-e autorizada → `FATURADO`
    + atualiza pipeline do rep + `NotificacaoComercial`.
    - _Requirements: 8.1, 8.2, 8.3_
  - [ ] 8.2 Painel unificado (régua de estágios) reusando a fonte do pipeline do
    portal + camada de amostra; % de produção.
    - _Requirements: 9.1, 9.2, 9.3_

- [ ] 9. Download da imagem do encaixe (R11)
  - [ ] 9.1 Puro `encaixeParaSvg(layout, legenda)` a partir de
    `resultadoCalculo.encaixe.layout` (folha + grade colunas×linhas + legenda).
    - _Requirements: 11.1, 11.3_
  - [ ]* 9.2 Teste P9 (desenha colunas×linhas peças; determinístico; sem layout → ausência).
    - _Requirements: 11.1, 11.4_
  - [ ] 9.3 Rotas `GET /orcamento-grafico/:id/itens/:itemId/encaixe.svg|.png|.pdf`
    (token via query; PNG via `sharp`; PDF via pdfkit). 404 `ENCAIXE_NAO_GERADO`
    quando sem layout; isolamento por empresaId.
    - _Requirements: 11.1, 11.2, 11.4, 11.6_
  - [ ] 9.4 Anexar o encaixe ao PDF da proposta e à OP gerada (documentação).
    - _Requirements: 11.5_
  - [ ] 9.5 Front: botão "Baixar encaixe" (SVG/PNG/PDF) por item no StepRevisão e
    na tela de detalhe do orçamento; desabilitado quando sem encaixe.
    - _Requirements: 11.1, 11.4_

### Onda 5 — Validação e não-regressão

- [ ] 10. Isolamento, auditoria e não-regressão (R10)
  - [ ] 10.1 Revisar todas as rotas novas (empresaId explícito — P8); auditoria de
    conversão/amostra/margem.
    - _Requirements: 10.1, 10.2_
  - [ ] 10.2 Suíte vitest dos módulos tocados sem regressão (orcamento-grafico,
    vendas, pcp) + novos testes passando; validar 409/400 dos bloqueios.
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
