# Harness de Calibração do Orçamento Gráfico (Bloco 2)

Objetivo: calibrar o motor de orçamento do Vizor (`orcamento-grafico-calculo.service.ts`)
até reproduzir o preço/custo do Calcgraf com tolerância ≤ 0,5% no unitário,
usando os ~11.561 cálculos REAIS do backup restaurado como massa de teste.
Depois congelar os casos como testes Vitest (regressão).

Fonte de verdade da fórmula: `docs/calcgraf-golden-cases-precalculo.md`
(Preço = Custo-base ÷ (1 − margem% − CEV%); CEV = ICMS+Juros+Pis/Cofins+Comissão).

## Mapa das tabelas do Calcgraf (banco CalcgrafCartonWega, SQL Server local)

Todas ligadas por `Codigo = CalculoHeader.Codigo` (= NumCalculo).

### Entrada (parâmetros do cálculo)
- `CalculoHeader`: AliqIcms, AliqIpi, TaxaJurosAplicacao, CustoFinProducaoPerc
  (0,13), TiragemBase, ItemTiragem, CodNome (cliente), CodLinhaProduto.
- `CalculoPlanos` (1+ por cálculo): papel/encaixe —
  `nomePlano, codSuporte, aproveitamento, gramatura, tiragem, dimensao1,
  dimensao2 (peça), formSuporte (ex. "600 x 730"), quebraPlanoFix/Var,
  custoUnitFolhaSup, ocorrencias, FlagMicro, SentidoOnda, CodFaca`.
- `CalculoTintas`: cores (cobertura, kg, preço).
- `CalculoAtvImpressao`: etapas de impressão (máquina, tempo fixo/variável).
- `CalculoAtvAcabamento`: etapas de acabamento (máquina/atividade, tempos).
- `CalculoMatAcabamento`: materiais de acabamento (cola, verniz, faca, colagem manual).
- `CalculoItensDiversos` / `CalculoItensFornecidos` / `CalculoAtividades`.

### Resultado JÁ CALCULADO pelo Calcgraf (o alvo da calibração)
- `CalculoResAgrupamento` (Codigo + CodAgrupamento): **CustoFixo + CustoUnitario
  por agrupamento (origem de custo)**. ← custo decomposto por componente.
  CodAgrupamento é numérico (negativos e positivos) — DECODIFICAR o significado
  (provável: 1=Suporte, 2=Impressão, ... ; negativos = CEV/impostos). Pendente.
- `CalculoTiragens` (1 linha por tiragem): **ValorTotalVenda** (preço final),
  **AliqMargem** (margem aplicada), **ValorContMarginal** (CM$). É o ALVO final.
- `CalculoTaxas` (CodTaxa, Aliquota): CEV — ex. −7=comissão 3,0, 2=Pis/Cofins 9,25.

## Estratégia de calibração (2 níveis, do mais fácil ao mais fino)

### Nível A — validar a FÓRMULA DE PREÇO (já confirmada, só congelar)
Dado o custo-base real (de CalculoResAgrupamento) + AliqMargem + CEV → o preço
deve bater com ValorTotalVenda. Como a fórmula já foi confirmada 2×, isto é um
teste de regressão direto: lê N cálculos, aplica `formarPrecoVenda`, compara.

### Nível B — reproduzir o CUSTO-BASE componente a componente (o trabalho fino)
Para cada cálculo, alimentar o motor do Vizor com os parâmetros de entrada
(planos/tintas/atividades) e comparar o CUSTO que o Vizor calcula com o
`CustoUnitario`/`CustoFixo` de `CalculoResAgrupamento`, por componente:
- Papel: kg = f(formato corte, gramatura, folhas, quebra/aparas, aproveitamento).
- Tinta: kg por cor × preço.
- Máquina: (setup + variável) × custo/hora.
- Acabamento: por hora e por unidade.
Ajustar parâmetros de perda/velocidade/arredondamento até ≤ 0,5%.

## Plano do harness (script)

`scripts/calibrar-orcamento.ts` (lê o banco via sqlcmd+JSON OU exporta antes):
1. Seleciona um conjunto de cálculos de teste (começar por 5-10 variados:
   cartucho simples, caixa, impresso multi-montagem — ex. 15168, 15182, ...).
2. Para cada: lê entrada (planos/tintas/atividades) + resultado
   (ResAgrupamento + Tiragens).
3. Monta o `ParamsOrcamento` do Vizor e roda `calcularOrcamentoGrafico`.
4. Compara componente a componente e o preço final; imprime desvio %.
5. Relatório: quais componentes batem (≤0,5%) e quais divergem (p/ calibrar).

## ✅ CONCLUSÃO FECHADA (análise de 4 cálculos reais do banco)

Analisados 15168 (3 tir), 15182 (1), 14879 (3), 14878 (3). A relação é EXATA e
consistente:

**Custo-base(tiragem) = Σ CustoFixo + Σ CustoUnitario × tiragem** — dos
agrupamentos POSITIVOS de `CalculoResAgrupamento` (os negativos espelham com
crédito de imposto). **Preço = Custo-base / (1 − margem%/100 − CEV%/100)**.

Prova: o "CEV implícito" (resolvido a partir de base e VT reais) é CONSTANTE
dentro de cada cálculo nas 3 tiragens:
- 14879: 16,66% / 16,63% / 16,62% (≈ constante)
- 14878: 16,76% / 16,69% / 16,79%
- 15168: 19,32% nas três
- 15182: 18,30%

→ Confirma, com dados do banco, que a fórmula do Vizor (`formarPrecoVenda`,
gross-up divisor único) está CORRETA. O CEV varia por cálculo (composição das
`CalculoTaxas` + juros/ICMS do header) mas é fixo entre tiragens do mesmo cálc.

CodAgrupamento: POSITIVOS (1,2,3...) = custo por origem; NEGATIVOS (−1,−2...) =
mesma origem com crédito fiscal. Usar os POSITIVOS como custo-base.

## ✅ CodAgrupamento DECODIFICADO (tabela `Agrupamentos`)
- **1 = Custo de Transformação** (máquinas: impressão + acabamento, horas×custo/h)
- **2 = Materiais Diretos** (papel + tinta + materiais de acabamento)
- **3 = Serviços Externos**
(negativos = mesma coisa com crédito de imposto). Bate com Mat.Dir/C.Transf/
Servex do rodapé do pré-cálculo E com a saída do motor do Vizor
(`materialDireto`/`custoTransformacao`/`servicoExterno`).

VALIDADO ponta a ponta no 15182 (tir 4000): CT=1504,81 + MD=5029,24 =
C.Prod 6534,05 → preço = 6534,05/(1−0,43581−0,183) = **17.141,20** vs real
**17.140,96** (desvio 0,001%). ✅

## PRÓXIMO — testes de regressão (Nível A) e calibração fina (Nível B)
- NÍVEL A (congelar a fórmula): teste Vitest que, dado o custo-base real
  (ResAgrupamento) + margem + CEV, reproduz ValorTotalVenda ≤ 0,01%. Já validado
  acima; falta escrever o `.test.ts` lendo as fixtures `golden-orcamento.json`.
- NÍVEL B (motor reproduz o custo): fazer `calcularOrcamentoGrafico` gerar os
  mesmos CustoFixo/CustoUnitario por componente que o Calcgraf gravou. É a
  calibração de perdas/velocidade/custo-hora, cálculo a cálculo.
- CEV residual: o CEV implícito do 15168 (19,32%) e 15182 (18,30%) é MAIOR que a
  soma visível das taxas (14,25% / 14,25%) — há uma taxa adicional por cálculo
  (ex. IPI/ICMS específico). Mapear a composição completa do CEV ao escrever o
  Nível B (não bloqueia o Nível A, que usa o CEV implícito/real por cálculo).

## Decisão de abordagem (IMPORTANTE)
O encaixe/imposição do Calcgraf é complexo (Delphi fechado), mas o
`aproveitamento` JÁ VEM CALCULADO em `CalculoPlanos.aproveitamento`. Logo, para
calibrar CUSTO, podemos ALIMENTAR o motor do Vizor com o aproveitamento real do
Calcgraf (em vez de recalcular o encaixe) — isola o teste no que importa (preço/
custo) e evita perseguir a imposição Delphi. O encaixe próprio do Vizor é
validado à parte, com casos simples. Isso torna a calibração VIÁVEL e cirúrgica.
