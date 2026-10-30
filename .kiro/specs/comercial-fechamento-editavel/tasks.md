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

- [ ] 3. Schema de overrides por orçamento
  - Colunas aditivas/nullable em `OrcamentoGrafico` para overrides
    (margem/desconto/comissões/CEV/prazos) + migrate-prod idempotente.
  - _Requirements: 2.2_

- [ ] 4. Motor usa override quando presente (não-regressão)
  - O cálculo aplica o override do orçamento quando houver; sem override =
    comportamento atual IDÊNTICO. Golden 15.235 ≤0,5% travando antes de expor.
  - _Requirements: 2.3, 3.2_

- [ ] 5. UI editável no Fechamento
  - Campos editáveis (a definir: margem/desconto, comissões, CEV, prazos) +
    "Salvar e recalcular" (só este orçamento).
  - _Requirements: 2.1, 2.2_

- [ ] 6. Golden/testes da Fase 2
  - Teste: sem override, resultado idêntico ao atual; com override, recalcula
    conforme esperado. fast-check onde aplicável.
  - _Requirements: 3_
