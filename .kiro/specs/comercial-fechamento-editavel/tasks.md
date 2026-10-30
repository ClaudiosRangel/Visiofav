# Implementation Plan — Fechamento do Orçamento (B9 / P17)

## Fase 1 — 4 abas SOMENTE LEITURA (risco zero) — FEITA

- [x] 1. Componente de Fechamento (4 abas)
  - `[id]/FechamentoOrcamento.tsx`: abas Preço de Venda / Taxas de Produção /
    Custos Diretos de Venda (CEV decomposto: ICMS/PIS-COFINS/Comissões/Juros com
    alíquota×base=valor) / Diversos (margem, custo total, valor de venda). Lê o
    `resultadoCalculo` salvo; trata ausência de dado (omite linha); sem CEV
    decomposto mostra só o total. NÃO recalcula, NÃO toca motor.
  - _Requirements: 1_

- [x] 2. Plugar no detalhe do orçamento
  - Botão "Fechamento" na barra de ações → modal com as 4 abas. Tipo
    `ResultadoCalculo` estendido com `cev`/`margem`/créditos/encargo. Multi-item
    usa consolidado como fallback. get_diagnostics limpo.
  - _Requirements: 1_

## Fase 2 — Edição com recálculo por orçamento (ALTO RISCO) — PENDENTE

> AGUARDA definição do usuário (quais campos editáveis) + golden travando a
> paridade ANTES de expor a edição. O usuário pediu para revisar o conjunto do
> Controle de Proposta ANTES de fazer a Fase 2.

- [x] 3. Schema de override por orçamento
  - `OrcamentoGrafico.fechamentoOverride Json?` + migrate-prod idempotente
    (ADD COLUMN IF NOT EXISTS). prisma generate OK.
  - _Requirements: 2.2_

- [x] 4. Motor aceita override (não-regressão)
  - `ItemOrcamentoInput.margemOverride` + aplicação em `montarParamsDoItem`
    (mescla sobre a tabela/default; ausente = idêntico). Abordagem de MENOR RISCO
    na Fase 2: a rota de Fechamento NÃO recalcula custos (engenharia calibrada
    intacta) — reaplica só a FÓRMULA DE PREÇO (`fechamento-preco.service.ts`,
    PURO) sobre o custo já salvo. Golden 15.235 preservado (sem override).
  - _Requirements: 2.3, 3.2_

- [x] 5. Rota + UI editável no Fechamento
  - `GET/PUT /:id/fechamento` (persiste override + reaplica preço; bloqueia
    CONVERTIDO/RECUSADO; desconto exige permissão). UI: aba "Preço de Venda"
    ganhou campos editáveis (markup/comissão/impostos/despAdm/desconto) +
    "Salvar e recalcular" quando status permite. Recarrega o orçamento.
  - _Requirements: 2.1, 2.2_

- [x] 6. Testes da Fase 2
  - `fechamento-preco.service.test.ts` (mesclarMargem + reaplicarPreco):
    golden gross-up + desconto no divisor + fator ≥100% erro + 2 property tests.
  - _Requirements: 3_
