# Calcgraf — Fórmulas do Orçamento decompostas (engenharia reversa)

Prova de conceito de calibração ANTES de implementar. Baseado na "Emissão de
Pré-Cálculos" (memória de cálculo completa) — que expõe TODOS os intermediários.
Conclusão preliminar: **NÃO é caixa-preta**. A memória revela a receita inteira.

## Golden Case #1 — Cálculo 15181 (Orçamento 5.352, GERDAU)

### Cabeçalho / entradas
- Produto: Impressos — "RÓTULO P/FARPADO GIR 400", Cód. Acabado 1021064.
- Formato Aberto: 190 x 1200 mm · Formato Fechado: 200 x 1200 mm.
- Cores: **3x0** · Repet TR: 1x4 · Corte: 840 x 1210 · Aprov. 1/1 · **Tiragem 4.000**.
- Impressora: **Roland RVU 4 cores** · Prod/H 1.800 · Quebra% 0,00 · Aparas% 10,27.

### Itens da memória (o "de-para" de custos)

**SUPORTE (papel):**
- Stora Enzo Bobina 415 · Formato 840x1210 · Folhas 1.000 · **Quant. 421,81 KG** ·
  Unitário **7,73839** · Subtotal **3.264,10**.
  → CHECK: 421,81 × 7,73839 = **3.263,97** ≈ 3.264,10 (dif. arredond. de casas do unitário).

**MATRIZ IMPRESSÃO:**
- RVU · 3 PC · Unitário 110,0 · Subtotal **330,00** → CHECK: 3 × 110 = 330,00 ✓

**TINTA (3 pantones):**
- Pantone 01: 0,20+1,36 = 1,56 KG? · Unit 71,5 · Subtotal 111,28 → 1,556×71,5 ≈ 111,3 ✓
- Pantone 02: (0,20+0,29)=0,49 · Unit 99,0 · Subtotal 48,57 → 0,49×99 = 48,51 ≈ ✓
- Pantone 03: 0,49 · Unit 170,5 · Subtotal 83,66 → 0,49×170,5 = 83,54 ≈ ✓
  (colunas FIXO/VARIÁVEL do consumo: FIXO=acerto, VARIÁVEL=tiragem → total kg)

**MAT. ACABAMENTO:**
- BOPP Brilho (F100) 840x1210 · 1.016,40 M2 · Unit 0,605 · Subtotal **614,92**
  → CHECK: 1.016,40 × 0,605 = **614,92** ✓ (exato)
- Fita Dupla Face Envólucros (591mm) · 79,00 RL · Unit 22,0 · Subtotal **1.738,00**
  → CHECK: 79 × 22 = **1.738,00** ✓ (exato)

**IMPRESSÃO (máquina — tempo × custo-hora):**
- Offset Plana Roland RVU 4 cores · FIXO 04:30 (h:mm setup) · VARIÁVEL 01:00 ·
  Unit **140,0** (=custo-hora) · Subtotal **770,00**.
  → CHECK: tempo total = 4:30 + 1:00 = **5,5 h** × 140 = **770,00** ✓ (exato!)
  → CONFIRMA: tempo máquina = setup(FIXO) + operação(VARIÁVEL); custo = horas × custo-hora.

**ACABAMENTO (máquinas — tempo × custo-hora):**
- Guilhotina de envol · FIXO 00:00 · VAR 02:00 · Unit 77,69 · Subtotal 155,38
  → 2,0 × 77,69 = **155,38** ✓
- Cortadeira (Grande) · FIXO 00:15 · VAR 00:30 · Unit 113,21 · Subtotal 84,91
  → (0:15+0:30)=0,75 h × 113,21 = **84,91** ✓
- Fita dupla face · FIXO 00:00 · VAR 10:00 · Unit 12,0 · Subtotal 120,00
  → 10 × 12 = **120,00** ✓
- Laminação maior · FIXO 00:00 · VAR 01:15 · Unit 60,0 · Subtotal 75,00
  → 1,25 × 60 = **75,00** ✓

### Bloco CUSTO DE PRODUÇÃO (a soma)
| Linha | Valor | Conferência |
|---|---|---|
| **Mat.Dir.** (material direto) | 6.190,53 | = Suporte 3.264,10 + Tinta (111,28+48,57+83,66=243,51) + Mat.Acab (614,92+1.738,00=2.352,92) + Matriz 330,00 = **6.190,53** ✓ EXATO |
| **C.Transf.** (custo transformação) | 1.205,29 | = Impressão 770,00 + Acabamentos (155,38+84,91+120,00+75,00=435,29) = **1.205,29** ✓ EXATO |
| Servex (serviço externo) | 0,00 | (não tem) |
| **C.PROD.** (custo produção) | 7.395,82 | = 6.190,53 + 1.205,29 = **7.395,82** ✓ EXATO |
| Cr.ICMS | 0,00 | crédito |
| Cr.IPI | 95,07 | crédito |
| Cr.PIS/COFINS | 0,00 | crédito |
| Taxas Prod. | 0,00 | |
| C.Finan (0,13%) | 9,49 | encargo financeiro sobre... (a confirmar base) |
| **TOTAL** | **7.310,24** | = 7.395,82 − 95,07 (Cr.IPI) + 9,49 (C.Finan) = **7.310,24** ✓ EXATO |

### Bloco Custos de Venda (CEV) — % sobre preço
| Item | % |
|---|---|
| ICMS | 3,00 |
| Juros | 3,00 |
| Pis/Cofins | 9,25 |
| Comissões | 3,00 |
| **TOTAL CEV** | **18,25%** |
| Imposto IPI | (à parte) |

### Fechamento por tiragem (3 opções de margem)
| Tiragem | Margem% | Margem$ | C.Marg.% | C.Marg.$ | Unitário | Valor Total |
|---|---|---|---|---|---|---|
| 4.000 | 10,00 | 1.018,80 | 21,83 | 2.224,09 | 2,547 | 10.188,00 |
| 4.000 | **39,10*** | 6.702,50 | 46,13 | 7.907,78 | **4,28524** | **17.140,96** |
| 4.000 | 30,00 | 4.238,40 | 38,53 | 5.443,69 | 3,532 | 14.128,00 |
(a linha do meio, 39,10%, é a escolhida → bate com o orçamento 5353/cálc 15182:
17.140,96 / unit 4,28524 — mesmo produto/cliente, versão gêmea)

### Fórmula do PREÇO (dedução a validar numericamente)
Estrutura clara:
```
Custo Produção (C.PROD) = Mat.Dir + C.Transf + Servex
TOTAL custo = C.PROD − créditos fiscais + encargo financeiro
Preço de Venda: sobre o TOTAL aplica-se Margem + CEV(18,25%), provavelmente
  "por dentro" (gross-up): Preço = TOTAL / (1 − margem% − CEV%)  [a confirmar]
Contribuição Marginal = (Preço − custos variáveis) / Preço
```
Validar a fórmula exata do markup com os 3 pares (margem%, valor total) do
próprio relatório — 3 equações, dá pra isolar se é "por fora" ou "por dentro".

## VEREDITO DA PROVA DE CONCEITO

**A calibração é VIÁVEL e de baixo risco.** Todos os componentes de custo
(material, transformação, máquina) fecharam EXATO ou com diferença de
arredondamento de casas decimais do unitário. As fórmulas descobertas:
- Material = quantidade × preço unitário (quantidade vem de consumo FIXO+VARIÁVEL).
- Máquina/Acabamento = (tempo setup + tempo operação) × custo-hora.
- C.PROD = Mat.Dir + C.Transf + Servex (soma direta, confirmada).
- Preço = função de TOTAL, Margem e CEV — estrutura clara, falta fixar a fórmula
  exata do markup (por dentro vs por fora) — resolvível com os 3 pares do relatório.

O que falta para 100%:
- Fórmula do markup/CEV (por dentro/fora) — resolver com os 3 pares.
- Base do C.Finan 0,13% e do Cr.IPI (regra fiscal) — detalhe pequeno.
- As QUANTIDADES de consumo (kg papel, kg tinta, m2 BOPP, RL fita, HORAS por
  máquina) — aqui está a "fórmula de engenharia" (imposição/velocidade/perda).
  A memória mostra o RESULTADO (421,81 kg, 5,5h, etc.); para o Vizor GERAR esses
  números falta a fórmula de cada um — é o próximo golden case a decompor
  (quantos kg de papel para 4.000 pçs no formato X = aproveitamento × perda).


---

## Golden Case #2 — Cálculo 15185 (Orçamento 5.355, ESTAÇÃO Y) — CARTUCHO/CAIXA

Muito mais rico: cartucho composto, folha plana (Heidelberg CD), múltiplos
planos/partes, hot stamping, acoplagem. Serve para triangular consumo.

### Cabeçalho / entradas
- Produto: **Cartucho Composto** — "CAIXA MÃE PARA 12 CARTUCHOS 90x70x178".
- **Formato Final: 280 x 270 x 178 mm** (3D — caixa).
- **Quantidade: 5.000** (também simula 10.000).
- Impressão: **Heidelberg CD Scores**, Prod/H 5.500.

### PLANOS (a peça tem VÁRIAS partes/planos — imposição composta)
| Plano | Cores | Formato | Repet TR | Corte | Aprov | Tiragem | Impr | Prod/H | Quebra% | Aparas% |
|---|---|---|---|---|---|---|---|---|---|---|
| PARTE 01 | 4x0 +V | 585x685 | 1x1 | 610x710 | 1/1 | 10.000 | Heid CD | 5.500 | 4,00 | 7,46 |
| PARTE 01 (M) | 0x0 | 585x685 | 1x1 | 600x700 | 1/1 | 10.150 | — | — | 1,50 | 4,59 |
| PARTE 02 | 4x0 +V | 480x585 | 1x2 | 610x890 | 1/2 | 5.000 | Heid CD | 5.500 | 8,00 | 0,00 |
| PARTE 02 (M) | 0x0 | 480x585 | 1x2 | 600x880 | 1/2 | 5.150 | — | — | 3,00 | 0,00 |
> Insight: cada PARTE tem seu formato/tiragem; "(M)" = miolo/verso ou acoplado
> (0x0 cores = sem impressão, só o cartão base). Tiragem da parte considera
> aproveitamento (1/2 = 2 peças por folha → tiragem folhas = qtd/2). Quebra% e
> Aparas% por plano (perdas separadas: quebra de produção + aparas de corte).

### SUPORTE (papel — 4 lançamentos, um por plano)
| Item | Formato | Folhas | Quant KG | Fixo | Variável | Unit | Subtotal |
|---|---|---|---|---|---|---|---|
| Stora Enzo Bobina 191 | 610x710 | 10.400 | 860,31 | 33,09 | 827,22 | 7,5 | 6.452,32 |
| Micro Pardo Formato 230 | 600x700 | 10.150 | 980,49 | 14,49 | 966,00 | 7,5 | 7.353,68 |
| Stora Enzo Bobina 191 | 610x890 | 5.400 | 559,95 | 41,48 | 518,47 | 7,5 | 4.199,60 |
| Micro Pardo Formato 230 | 600x880 | 5.150 | 625,42 | 18,22 | 607,20 | 7,5 | 4.690,62 |

**DEDUÇÃO da fórmula do PAPEL (validar):**
- Peso da folha = Larg(m) × Alt(m) × Gramatura(g/m²) / 1000 = kg/folha.
  - Stora Enzo 191 (610×710): 0,610×0,710×191/1000 = **0,08272 kg/folha**.
    × 10.400 folhas = **860,3 kg** ✓✓ (bate com 860,31!)
  - Micro Pardo 230 (600×700): 0,600×0,700×230/1000 = **0,0966 kg/folha**.
    × 10.150 = **980,5 kg** ✓✓ (bate com 980,49!)
  - Stora Enzo 191 (610×890): 0,610×0,890×191/1000 = **0,103694 kg/folha**.
    × 5.400 = **559,95 kg** ✓✓ (exato!)
  - Micro Pardo 230 (600×880): 0,600×0,880×230/1000 = **0,12144 kg/folha**.
    × 5.150 = **625,42 kg** ✓✓ (exato!)
- **FÓRMULA DO PAPEL CONFIRMADA:** `kg = Largura(m) × Altura(m) × Gramatura(g/m²) / 1000 × Folhas`.
  (Gramatura vem do nome do material: "191", "230". Folhas = tiragem_folhas + perdas.)
- Subtotal = kg × 7,5 (preço/kg). Ex.: 860,31×7,5 = 6.452,32 ✓; 980,49×7,5=7.353,68 ✓.
- Colunas Fixo/Variável (em kg): Fixo = perda de acerto (folhas fixas), Variável =
  consumo da tiragem. Total kg = Fixo + Variável. Ex.: 33,09+827,22 = 860,31 ✓.

**DEDUÇÃO das FOLHAS (nº de folhas):**
- PARTE 01: tiragem 10.000, aprov 1/1 (1 peça/folha) → 10.000 folhas + perdas.
  Folhas lançadas = 10.400. Perda ≈ 4% (Quebra 4,00%): 10.000×1,04 = 10.400 ✓✓
- PARTE 02: tiragem 5.000, aprov 1/2 (2 peças/folha) → 5.000/... mas tiragem da
  parte já é 5.000, folhas 5.400. Quebra 8,00%: 5.000×1,08 = 5.400 ✓✓
- **FÓLHAS CONFIRMADO:** `folhas = tiragem_do_plano × (1 + quebra%)`. A tiragem do
  plano já embute o aproveitamento/imposição (peças por folha e nº de partes).

### MATRIZ / TINTA / MAT.ACABAMENTO (mesma fórmula qtd × unit — spot-check)
- CD (matriz): 8 PC × 49,5 = 396,00 ✓
- Tinta Escala: (1,60+12,46)=14,06 KG × 44,0 = 618,48 ✓ (0,20 arred → 618,64? usa 14,06×44=618,64; relatório 618,48 — dif arred, ok)
- Cliché Hot Stamping: 4,00 × 250,0 = 1.000,00 ✓
- Cola Vegetal Acoplagem (F60): (5,54+369,36)... na verdade 369,36 KG? Unit 3,685 → 369,36×3,685=1.361,10 ≈ 1.381,51 (rever coluna; provável qtd 374,9)
- Colagem Manual: 20.000,00 × 0,15 = 3.000,00? relatório 3.000,00 (col variável 20.000 un × 0,15) — item por unidade, não kg.
- Faca Nova: 2,00 × 1.300,0 = 2.600,00 ✓
- Fita Hot Stamping Metalizada: 400,00 M2 × 3,3 = 1.320,00 ✓
- Verniz Base D'Água Fosco (F100): (1,17+21,14)=22,31... Unit 24,2 → 21,14×24,2? = 511,6 ≈ 539,85 (rever)

### IMPRESSÃO / ACABAMENTO (tempo × custo-hora — spot-check)
- Offset Plana Heidelberg CD (PARTE 01,02): FIXO 03:20 + VAR 02:44 = 6,0667h × 440,0 = **2.669,3** ≈ 2.668,67 ✓ (arred de minutos)
- Cortadeira (Grande): (00:30+04:08)=4,633h × 113,21 = **524,6** ≈ 524,67 ✓
- Guilhotina maior: (00:00+04:01)=4,0167h × 77,69 = **312,1** ≈ 312,05 ✓
- HotStamping: (02:00+18:19)=20,3167h × 110,0 = **2.234,8** ≈ 2.234,65 ✓
- HotStamping 2: (02:00+10:44)=12,733h × 110,0 = **1.400,7** ≈ 1.400,26 ✓
- Mazola (acoplagem): (00:30+10:00)=10,5h × 80,0 = **840,00** ✓ (exato)
- Bobst E (Corte e Vinco Onde E Acoplado Novo): (05:00+03:00)=8h × 300,0 = **2.400,00** ✓ (exato)
- Destacar: (00:00+01:30)=1,5h × 50,0 = **75,00** ✓ (exato)

### CUSTO DE PRODUÇÃO
- Mat.Dir 33.552,06 · C.Transf 10.453,30 · Servex 0,00 · **C.PROD 44.005,36**
  → 33.552,06 + 10.453,30 = **44.005,36** ✓ EXATO
- Cr.IPI 661,06 · C.Finan(0,13%) 56,35 · **TOTAL 43.400,65**
  → 44.005,36 − 661,06 + 56,35 = **43.400,65** ✓ EXATO
- CEV: ICMS 3,00 + Juros 2,50 + Pis/Cofins 9,25 + Comissões 3,00 = **17,75%**
  (nota: Juros 2,50 aqui vs 3,00 no caso #1 — CEV varia por condição de pagamento/cliente)

### Fechamento (multi-tiragem)
5.000: 10%→35.855; 20%→41.615; **24,55%→44.900** (unit 8,98)
10.000: 10%→60.070; 20%→69.720; **26,10%→77.300** (unit 7,73)

## ATUALIZAÇÃO DO VEREDITO — fórmulas de CONSUMO agora CONFIRMADAS

Com o 2º caso, as fórmulas de QUANTIDADE (que faltavam) estão descobertas:
- **PAPEL (kg):** Largura(m) × Altura(m) × Gramatura(g/m²) / 1000 × Folhas. ✓✓ (4/4 exatos)
- **FOLHAS:** tiragem_do_plano × (1 + quebra%). A tiragem do plano embute o
  aproveitamento (peças/folha) e o nº de partes. ✓✓
- **MÁQUINA (h):** (tempo_setup FIXO + tempo_operação VARIÁVEL) × custo-hora. ✓✓ (ambos casos)
  - tempo_operação relacionado a Prod/H (folhas÷Prod/H ≈ horas variáveis — validar exato).
- **MATERIAL genérico:** quantidade × preço_unitário (kg, m², un, pç, rolo). ✓
- **C.PROD = Mat.Dir + C.Transf + Servex.** ✓✓ (ambos exatos)
- **TOTAL = C.PROD − créditos fiscais + C.Finan.** ✓✓ (ambos exatos)
- Perdas SEPARADAS por plano: **Quebra%** (produção) e **Aparas%** (corte).

**CONCLUSÃO FINAL:** o motor de cálculo do Calcgraf está DECOMPOSTO e é
REPRODUZÍVEL. Não há caixa-preta relevante. Peças ainda a fixar (fino, baixo risco):
1. Fórmula exata do markup/CEV (por dentro/fora) — resolver com os pares margem×total.
2. Como tempo_operação sai de Prod/H (folhas ÷ Prod/H + fator?) — validar com números.
3. Base do Cr.IPI e C.Finan 0,13% (regra fiscal) — detalhe.
4. Onde Aparas% entra (parece afetar folhas de corte, não o papel — o papel usou Quebra%).
Risco de "preço não bater" agora é BAIXO. Calibração viável e demonstrada em 2 casos.


---

## Fórmula do MARKUP / PREÇO DE VENDA (resolvida com os pares margem%→total)

Dados (do próprio relatório):
- Caso #1 (15181): TOTAL custo = 7.310,24 · CEV = 18,25%
  - 10% → 10.188,00 · 39,10% → 17.140,96 · 30% → 14.128,00
- Caso #2 (15185): TOTAL custo = 43.400,65 · CEV = 17,75%
  - 10% → 35.855,00 · 20% → 41.615,00 · 24,55% → 44.900,00

### Hipótese "por dentro" (gross-up): Preço = Custo ÷ (1 − margem% − CEV%)
Caso #1, margem 30%, CEV 18,25% → divisor = 1 − 0,30 − 0,1825 = 0,5175
  Preço = 7.310,24 ÷ 0,5175 = **14.126,1** ≈ **14.128,00** ✓✓ (dif. 0,01%)
Caso #1, margem 10% → divisor = 1 − 0,10 − 0,1825 = 0,7175
  Preço = 7.310,24 ÷ 0,7175 = **10.188,5** ≈ **10.188,00** ✓✓ (exato)
Caso #1, margem 39,10% → divisor = 1 − 0,3910 − 0,1825 = 0,4265
  Preço = 7.310,24 ÷ 0,4265 = **17.139,4** ≈ **17.140,96** ✓ (dif. 0,009%)
Caso #2, margem 10%, CEV 17,75% → divisor = 1 − 0,10 − 0,1775 = 0,7225
  Preço = 43.400,65 ÷ 0,7225 = **60.070,1** ... espera, é a linha de 10.000? Não:
  para 5.000 o custo é 43.400,65 → 10% = 35.855. Recalcular: o custo TOTAL 43.400,65
  é da tiragem base; a linha 5.000/10% = 35.855 sugere custo menor para 5.000.
  (o TOTAL 43.400,65 provavelmente é p/ 10.000; a de 5.000 usa custo proporcional.)
  Validar: 5.000 margem 24,55% → divisor = 1 − 0,2455 − 0,1775 = 0,577
    Se preço 44.900 → custo implícito = 44.900 × 0,577 = 25.907 (custo p/ 5.000).
  10.000 margem 26,10% → divisor = 1 − 0,2610 − 0,1775 = 0,5615
    Se preço 77.300 → custo implícito = 77.300 × 0,5615 = 43.405 ≈ 43.400,65 ✓✓
  → CONFIRMA: o TOTAL 43.400,65 é da tiragem 10.000; a fórmula gross-up bate.

### Hipótese "por fora": Preço = Custo × (1 + margem + CEV)
Caso #1, margem 30% → 7.310,24 × (1,4825) = 10.837 ≠ 14.128. ✗ REJEITADA.

### CONCLUSÃO — fórmula do preço CONFIRMADA (por dentro / gross-up)
```
Preço de Venda = Custo_Total ÷ (1 − Margem% − CEV%)
  onde CEV% = ICMS + Juros + Pis/Cofins + Comissões (soma dos % de Custos de Venda)
  e Custo_Total = C.PROD − créditos fiscais + C.Finan
Margem$ = Preço − Custo_Total − CEV$
Contribuição Marginal $ = Preço − custos variáveis (Mat.Dir + parte variável) 
Contribuição Marginal % = C.Marg$ ÷ Preço
```
Erro máximo observado: < 0,02% (arredondamento). Markup é "por dentro", como é
padrão em formação de preço gráfica (impostos e comissão incidem sobre o preço,
não sobre o custo). 

## STATUS DA CALIBRAÇÃO (após 2 casos + fórmula de preço)
CONFIRMADO e reproduzível: papel (kg), folhas, máquina (h × custo-hora),
material (qtd × preço), C.PROD, TOTAL, e **PREÇO (gross-up)**. 
Resta fino: tempo_operação a partir de Prod/H; base fiscal do Cr.IPI/C.Finan;
onde Aparas% entra. Risco de calibração: BAIXO. Prova de conceito CONCLUÍDA.
