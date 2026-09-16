# Tarefas — Orçamento Gráfico: materiais na OP + modo Repetição (padrão Calcgraf)

- [x] 1. Schema + migração (vínculo de produto opcional)
  - Adicionar `produtoId String?` em `OrcamentoGrafico` e em
    `SolicitacaoOrcamentoRep`. `ADD COLUMN IF NOT EXISTS` em `migrate-prod.ts`,
    testado 2x local (idempotente).
  - _Requirements: 2.1, 3.2, 5.1, 5.2_

- [x] 2. Geração de materiais do cálculo (Cenário A) — service
  - Em `orcamento-grafico-integracao.service.ts`, nova função
    `gerarMateriaisFromCalculo(opId, resultadoCalculo, ...)`: cria
    `ItemOrdemProducao` de papel (pesoKg), tintas (por cor, consumoKg) e
    acabamentos com material. Chamada dentro de `gerarOpFromOrcamento`.
  - Unit: mapeamento resultadoCalculo → itens.
  - _Requirements: 1.1, 1.2, 1.3, 4.1, 4.2_

- [x] 3. Modo Repetição (Cenário B) — service
  - Em `gerarOpFromOrcamento`: se o orçamento tem `produtoId`, criar a OP com
    `produtoId`/`estruturaProdutoId` e explodir a BOM (`explodirBomParaOp`);
    etapas via roteiro ATIVO (`gerarEtapasOp`) com fallback para o cálculo.
    Fallback para Cenário A quando não há BOM ATIVA (+ aviso).
  - Unit: explosão da BOM; fallback sem BOM.
  - _Requirements: 2.2, 2.3, 2.4_

- [x] 4. Propagação do produto na origem — backend
  - `criarOrcamentoGraficoDeSolicitacao` e criação/edição de OrcamentoGrafico
    passam a aceitar/gravar `produtoId`. Propaga para o pedido (item com
    produto no Cenário B) e para a OP.
  - _Requirements: 3.2, 2.1_

- [x] 5. Frontend — seleção opcional de produto (repetição)
  - Wizard interno de orçamento: campo opcional "Repetição de produto
    existente" (autocomplete de produtos) no StepCliente. Envia `produtoId`.
  - Decisão (aderente ao Calcgraf): o modo repetição por produto cadastrado
    fica no fluxo INTERNO (orçamentista/comercial conhecem o cadastro). O
    Portal do rep segue por especificação (o rep descreve; o orçamentista
    supervisiona/vincula). O backend já aceita `produtoId` na solicitação do
    rep caso o portal passe a oferecer o campo no futuro.
  - _Requirements: 3.1, 3.3_

- [x] 6. Análise de Produção — verificação de exibição
  (a tela já lista ItemOrdemProducao; a OP agora nasce com materiais nos dois cenários)
  - Confirmar que a OP passa a listar materiais em ambos cenários (a tela já
    lista `ItemOrdemProducao`; validar sem regressão).
  - _Requirements: 1.1, 2.2_

- [ ] 7. Testes E2E (após deploy)
  - Solicitação sem produto → OP com materiais do cálculo.
  - Solicitação com produto (repetição) → OP com materiais da BOM.
  - _Requirements: 1.1, 2.2, 3.2_

- [x] 8. Verificação final
  - `tsc` sem erros novos nos arquivos tocados; unit tests 9/9; colunas
    aplicadas em produção (idempotente 2x); frontend sem diagnostics.
  - _Requirements: 5.1_
