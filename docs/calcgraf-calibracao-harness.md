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

## 🔶 NÍVEL B — passo 2: MÁQUINA / Custo de Transformação (EM ANDAMENTO)

Investigação da sessão de 02/10/2026. Objetivo: validar que `calcularMaquinas`
do Vizor reproduz o Custo de Transformação (CodAgrupamento=1) do Calcgraf.
Decisão de método: a TINTA (passo 1) foi PULADA — ~4% do custo, exige o
rendimento base (m²/kg) que não está em nenhum export e cuja fórmula
(area×cobertura×CoefTinta→kg) está no Delphi fechado; o MD agregado já bate
0,001%, então é baixo retorno/alto risco (mesma decisão da tinta registrada no
steering). Fomos direto ao CT, que é o componente que mais diverge ao gerar
orçamento NOVO.

### Tabelas-fonte do CT MAPEADAS (banco CalcgrafCartonWega, SQL local)

- **`CalculoAtividades`** (ligada por `Codigo` = NumCalculo) — é a tabela do CT
  (NÃO `CalculoAtvImpressao`/`CalculoAtvAcabamento`, que têm parametrização mas
  não os tempos). Colunas-chave por atividade:
  - `codAtividade` (FK → `Atividades.Codigo`: nome + TipoAtividade Impressão/Acabamento)
  - `codCentroCusto` (FK → centro; vira custo-hora via Itc, ver abaixo)
  - `entradas` (nº de passagens/entradas do material)
  - `producaoHora` (velocidade em unid/hora) — equivale ao `etapa.velocidade` do Vizor
  - `quantAcertos`, `tempoPorAcerto`, `tempoPrimeiroAcerto` (setup, em MINUTOS)
  - `tiragem`
  - versões `man*` (override manual; 0 = usa o automático)
- **Custo-hora por centro**: `Itc` (Origem='CENTRO DE CUSTO', Unidade='H',
  `CodOrigem` = codCentroCusto) → `Codigo` do Itc → `TabelasCustoDetalhe`
  (`CodItc`, `Coluna=1`, campo **`ValorDireto`** = R$/hora). ATENÇÃO: há 2
  TabelasCusto (join traz 2 linhas por Itc; usar CodTabelaCusto=1).
- `CalculoResAgrupamento` (Codigo + CodAgrupamento) = ALVO agregado:
  CustoFixo + CustoUnitario. NÃO há detalhamento por atividade (o Delphi calcula
  em runtime) — só o agregado por agrupamento.

### Golden case 15182 (dados reais confirmados)
5 atividades: Offset Plana (CC4, 64,59/h), Cortadeira Grande (CC5, 113,21/h),
Guilhotina envol (CC16, 77,69/h), Fita dupla face (CC25, 12,00/h), Laminação
maior (CC19, 60,00/h). Alvo CT (resAgr agrup 1): CustoFixo=478,3025 +
CustoUnit=0,2566279 → CT total (tir 4000) = **1504,81**.

### Resultado da fórmula do motor Vizor (candidata)
`tempoAcertoH = (quantAcertos×tempoPorAcerto + tempoPrimeiroAcerto)/60`;
`custoFixoAtv = tempoAcertoH × custoHora`;
`horasPorUnidade = entradas/producaoHora`; `custoUnitAtv = horasPorUnidade × custoHora`.

- **CT total: 1469,87 calc vs 1504,81 real = desvio 2,32%** (estrutura certa, perto)
- CustoFixo: 125,19 calc vs 478,30 real (73,8% abaixo) ← PRINCIPAL DIVERGÊNCIA
- CustoUnit: 0,33617 calc vs 0,25663 real (31% acima)

### Diagnóstico (onde está a diferença — resolver na próxima rodada)
1. **Setup/acerto está muito subestimado**: os 4 acabamentos vieram com
   `tempoPorAcerto=0`/`quantAcertos=1` → fixo 0, mas o Calcgraf cobra ~478 de
   fixo. Hipóteses: (a) existe um tempo-de-acerto PADRÃO por centro (em
   `CentrosProducao`/`Atividades`/tabela de parâmetros) que o Delphi aplica
   quando a atividade não tem acerto próprio; (b) parte do que chamo "variável"
   o Calcgraf trata como fixo (ex. 1ª puxada/entrada = setup).
2. **`entradas` da impressão**: Offset tem entradas=2 — confirmar se é
   nº de puxadas/lados (frente+verso) ou passadas de cor; afeta o custoUnit.
3. **Arredondamento Delphi** (minutos inteiros? ceil de puxadas?).

### Dados-fonte para a próxima rodada (não reinvestigar)
- SQL CT do 15182: `SELECT codAtividade,codCentroCusto,entradas,producaoHora,
  quantAcertos,tempoPorAcerto,tempoPrimeiroAcerto,tiragem FROM CalculoAtividades
  WHERE Codigo=15182`.
- Custo-hora: `TabelasCustoDetalhe` via `Itc` (Origem='CENTRO DE CUSTO').
- Procurar tempo-de-acerto padrão: investigar `CentrosProducao`,
  `Atividades`, `CentrosProducaoxTiragensProdHora` e tabelas `Def*`/`Par*` de
  parâmetro de acerto por centro (ainda NÃO localizado).
- Validar a hipótese em ≥2 cálculos (15168 também, p/ não overfitar no 15182).

### Status — ✅ RESOLVIDO (02/10/2026)
A divergência era a **Tabela de Custos errada** (usava a Tabela 1 antiga; os
cálculos de 2026 usam a **Tabela 2**). Com o custo-hora correto + o modelo de
setup decifrado (impressão = cores×acertoPorCor; acabamento =
quantAcertos×tempoPorAcerto), o **CustoFixo bate ≤1% em 52/53 cálculos** e o
CustoUnitário em 0,05%. Congelado em teste:
`src/modules/orcamento-grafico/custo-transformacao.ts` +
`calibracao/golden-custo-transformacao.{fixture,test}.ts` (6/6; suíte 71/71).
Documento definitivo: `docs/calcgraf-custo-transformacao.md`.

Tinta: fórmula de custo confirmada, mas BLOQUEADA pelo rendimento (m²/kg) que
não existe no backup — ver `docs/calcgraf-custo-transformacao.md` §7.
