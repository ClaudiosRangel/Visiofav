# Requirements — Fechamento do Orçamento (Bloco B9 / P17)

## Introdução

Reproduzir o "Fechamento" do Calcgraf como uma tela POR ORÇAMENTO, com 4 abas
(Preço de Venda / Taxas de Produção / Custos Diretos de Venda / Diversos),
mostrando a decomposição completa e — numa segunda fase — permitindo editar
taxas/comissões/margem e **recalcular o preço SÓ desse orçamento** (override
local). É o bloco de MAIOR risco: mexe na formação de preço calibrada contra o
Calcgraf (golden 15.235 ≤0,5%). Por isso é FASEADO.

Fonte de verdade: `docs/PROJETO-MODULO-COMERCIAL.md` (B9) + backlog P17.

## Faseamento

- **Fase 1 (risco zero):** as 4 abas em modo SOMENTE LEITURA, lendo o
  `resultadoCalculo` que já existe no orçamento (MD/CT/SE, CEV decomposto,
  comissões, CM, margem). Nenhuma mudança no motor.
- **Fase 2 (risco controlado):** overrides por orçamento (margem/desconto,
  comissões, CEV, prazos) persistidos; o motor usa o override quando presente,
  senão o default do cadastro (aditivo). Golden travando a não-regressão ANTES
  de expor a edição.

## Requisitos

### Requisito 1: Tela de Fechamento com 4 abas (Fase 1 — leitura)

1. O detalhe do orçamento DEVE ter uma visão "Fechamento" com 4 abas:
   - **Preço de Venda**: quantidade, valor unitário, valor total, margem%, CM% e
     CM$ (grade por tiragem quando houver variações — reusa simular-tiragens).
   - **Taxas de Produção**: Materiais Diretos, Transformação, Serviços Externos,
     Créditos (Pis/Cofins, ICMS, IPI), Custo Financeiro, Custo de Produção.
   - **Custos Diretos de Venda**: ICMS, PIS/COFINS, Comissões, Juros (cada um com
     %/base/valor) — do CEV decomposto.
   - **Diversos**: prazos (quando existirem), margem de lucro, totais.
2. A tela DEVE ler o `resultadoCalculo` salvo (sem recalcular) e os campos de
   decomposição já expostos (`materialDireto`, `custoTransformacao`,
   `servicoExterno`, `custoProducao`, `cevPerc`, `cevValor`, `cev{...}`,
   `contribuicaoMarginal*`, `margem{...}`).
3. QUANDO um dado não existir no resultado ENTÃO a aba DEVE omitir a linha (sem
   erro).

### Requisito 2: Edição com recálculo por orçamento (Fase 2)

1. O Fechamento DEVE permitir editar (quando a Fase 2 for liberada): margem/
   desconto, comissões, alíquotas do CEV (ICMS/PIS/COFINS/juros), prazos.
2. QUANDO o usuário salvar os overrides ENTÃO o sistema DEVE recalcular o preço
   SÓ desse orçamento, persistindo os overrides no próprio orçamento.
3. O motor DEVE usar o override quando presente; sem override, o comportamento
   DEVE ser IDÊNTICO ao atual (não-regressão — golden 15.235 ≤0,5%).

### Requisito 3: Não-regressão e segurança

1. Fase 1 NÃO toca o motor nem o schema.
2. Fase 2 trava a paridade com golden ANTES de expor a edição; overrides são
   aditivos (null = comportamento atual).
3. Isolamento `empresaId` em toda query.
