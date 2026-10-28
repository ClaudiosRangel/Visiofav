# Design Document

Várias Tiragens por Item (grade Tiragem × Margem) — P1

## Overview

O operador informa, por ITEM, uma lista de tiragens separadas por vírgula (ex.:
"10.000, 20.000, 50.000"). O Vizor calcula o preço de cada faixa e exibe uma
**grade Tiragem × Margem** na Revisão do item; o operador **escolhe uma faixa**,
que vira a `quantidade` oficial do item (e o preço do item). Confirmado com o
usuário (WhatsApp): "às vezes o cliente quer o orçamento de diferentes
quantidades… no final ele escolhe só uma".

**Decisões (confirmadas):**
1. Grade **por item** (cada item tem suas próprias faixas).
2. Operador **digita** as tiragens, separadas por vírgula (não mais só as
   automáticas).
3. **Sem persistência de N faixas / sem schema novo** — a grade é de
   comparação; ao escolher uma faixa, grava a `quantidade` escolhida no item
   (exatamente como o Calcgraf, que só grava a tiragem selecionada e recalcula
   as demais na tela).

**Princípio de menor risco:** reaproveitar 100% o cálculo por faixa que já
existe no backend (rotas `simular-tiragens`), sem tocar o `Motor_Calculo` nem o
`schema.prisma`. A mudança é essencialmente de FRONTEND (entrada das faixas +
grade + seleção). Nenhuma migração.

## Investigação do que já existe (confirmado no código)

- `POST /orcamento-grafico/simular-tiragens` (nível OS) e
  `POST /orcamento-grafico/:id/itens/:itemId/simular-tiragens` (nível item) já
  calculam o preço de uma lista de `quantidades` (1..20) SEM persistir, usando o
  mesmo `Motor_Calculo` do `/calcular` (mesma máquina, margem, perdas, paridade
  Calcgraf). Retornam por faixa: `quantidade`, `custoTotal`, `precoVenda`/
  `precoUnitario`, `precoTotal`.
- O `StepRevisao` já chama `simularTiragens()` e exibe um "Comparativo por
  Tiragem" com quantidades AUTOMÁTICAS (0,5× / 1× / 2× / 5× / 10× a quantidade).
  Hoje o operador NÃO digita as faixas.
- `ItemOrcamentoGrafico` tem UMA `quantidade` e UM resultado — é o que será
  gravado ao escolher a faixa. Nenhuma coluna nova é necessária.

## Modelo do Calcgraf (registro — Req 5)

Steering `migracao-calcgraf-carton-wega`: o Calcgraf grava o `valorTotal` da
tiragem SELECIONADA em `CalculoTiragens`; as demais faixas (e as 3 margens) são
RECALCULADAS na tela a partir de `CalculoMargens` (gross-up). Ou seja, o próprio
Calcgraf não persiste todas as faixas — valida a decisão (3) de não criar tabela
nova no Vizor. **Conclusão: esta spec NÃO altera schema** (Req 5.4).

## Componentes e mudanças

### Frontend (`VisioFab.Wms.Front`)

**`novo/StepRevisao.tsx`** (reusado pelo `ItemWizardModal`):

1. **Entrada das faixas (Req 1):** adicionar um campo de texto "Tiragens
   (separadas por vírgula)" ao lado da "Tiragem". O operador digita
   "10.000, 20.000, 50.000". Um parser converte para `number[]` (remove pontos
   de milhar, aceita vírgula/; como separador, ignora vazios, dedup, ordena,
   limita a 20 — limite do backend). Se o campo estiver vazio, mantém as faixas
   AUTOMÁTICAS atuais (não-regressão — Req 1.3). A `quantidade` atual do item é
   sempre incluída e destacada (Req 1.4).

2. **Grade Tiragem × Margem (Req 2):** a tabela "Comparativo por Tiragem" atual
   evolui para a grade, com colunas: Quantidade, Valor Unitário, Valor Total,
   Margem (%), Contribuição Marginal (% e $). **Primeiro Mil / Mil Seguinte
   (Req 2.3):** derivados no FRONTEND a partir das faixas já calculadas
   (interpolação marginal entre faixas consecutivas: `milSeguinte =
   (valorTotal[n] − valorTotal[n−1]) / ((qtd[n] − qtd[n−1]) / 1000)`;
   `primeiroMil = valorTotal da menor faixa / (menor qtd / 1000)`), SEM alterar o
   backend — é a opção de menor risco (Req 4.2). Linha com falha de cálculo é
   marcada sem quebrar as demais (Req 2.5).

3. **Seleção da faixa (Req 3):** cada linha tem um controle (radio/botão
   "Usar"). Ao selecionar, `updateForm({ quantidade: faixa.quantidade })` — o
   `StepRevisao` já recalcula o item ao mudar `formData.quantidade` (o
   `useEffect` depende de `formData.quantidade`), então o resultado exibido passa
   a ser o da faixa escolhida. Ao SALVAR o item (fluxo já existente do
   `ItemWizardModal`/wizard), a `quantidade` escolhida é persistida com seu
   resultado (Req 3.2). Sem seleção → mantém a quantidade atual (Req 3.4).

4. A CM (% e $) por faixa: o retorno de `simular-tiragens` tem `custoTotal` e
   `precoVenda`/`precoTotal`; a CM pode ser derivada (`cm$ = precoTotal −
   custoTotal`; `cm% = cm$/precoTotal`) OU, se o retorno já trouxer, usar direto.
   O design prioriza derivar no front para não tocar o backend; se faltar algum
   número essencial, avaliar expor no retorno (Req 4.2).

**Estado (StepRevisao):** `faixasTexto` (string do input), `faixasManuais`
(number[] parseado), `faixaSelecionada` (number|null). O `simularTiragens()`
passa a enviar `quantidades = faixasManuais.length ? faixasManuais : automáticas`
(sempre com a quantidade atual incluída).

### Backend (`VisioFab.Wms.Back`)

**Nenhuma mudança obrigatória.** As rotas `simular-tiragens` já aceitam
`quantidades: number[]` (1..20) e já retornam por faixa. Isolamento `empresaId`
já presente. Sem schema, sem migração.

- Only-if-needed: se a CM / Primeiro Mil / Mil Seguinte não puderem ser
  derivados no front com fidelidade, adicionar esses campos ao retorno de
  `simular-tiragens` (aditivo, sem quebrar o shape atual). Decidir na
  implementação medindo o que o retorno já traz.

## Data Models

**Nenhuma alteração.** `ItemOrcamentoGrafico.quantidade` (existente) recebe a
faixa escolhida. Sem tabela nova, sem `schema.prisma`/`migrate-prod.ts`.

## Error Handling

- Parser de faixas: entradas inválidas (não-numéricas) são ignoradas; se sobrar
  0 faixas válidas, cai nas automáticas. Limite 20 (corta o excedente com aviso).
- Falha de cálculo de uma faixa: a linha correspondente é marcada como "—"/erro,
  demais faixas seguem exibidas (Req 2.5).
- Multi-tenant: as rotas usadas já filtram `empresaId` (Req 6.3).

## Testing Strategy

Natureza da mudança: entrada/parse + exibição + seleção (frontend), reusando
cálculo existente. Avaliação de PBT: o parser de faixas (texto → number[]
normalizado) é uma função pura com propriedades claras (idempotência de
normalização, dedup, ordenação, limite) — **candidato a 1 teste unitário/
property** se extraído para um util puro (ex.: `parseFaixasTiragem`). O cálculo
em si já é coberto pelos testes do motor; não se recria. Verificação:
`get_diagnostics` nos arquivos tocados + conferência manual na tela (digitar
faixas, ver a grade, escolher uma, salvar e confirmar a quantidade persistida).
Seção Correctness Properties: incluída só para o parser puro, se extraído.
