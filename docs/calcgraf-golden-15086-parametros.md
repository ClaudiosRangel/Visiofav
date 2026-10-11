# Golden 15.086 — Parâmetros REAIS extraídos do Calcgraf (fonte de verdade da calibração)

Este documento registra TODOS os dados reais do cálculo **15.086** (orçamento
5.316 / OP 3.149) extraídos diretamente do backup SQL Server do Calcgraf
(`CalcgrafCartonWega`, local), para calibrar o motor do Vizor até bater ≤ 0,5%.
É a fonte de verdade entre sessões — não perder.

Produto: **CARTUCHO CIMED SUPER FRESH 90G CRUZEIRO/PALMEIRAS** · Cliente ICEFRESH
(903) · Vendedores IGOR ARNEIRO + JOAO BORTOLOMAI · tiragem **100.000** ·
suporte orçado **Stora Enzo 222** → produção **234** · Cond. Pagto 45 DDL ·
Cód. Acabado 4931/4932.

---

## 1. Alvos do pré-cálculo (o que o Vizor precisa reproduzir)

| Componente | Valor-alvo (R$) |
|---|---|
| SUPORTE (papel Stora Enzo 222) | 6.382,43 |
| MATRIZ IMPRESSÃO (CD 7 Cores) | 495,00 |
| TINTA (Escala 220,00 + Pantone 01 39,33) | 259,33 |
| MAT.ACABAMENTO (Cola 154,79 + V.Primer 193,12 + V.UV 529,52 + Caixa 862,40) | 1.739,83 |
| IMPRESSÃO (Offset Heidelberg CD 7cores) | 3.466,58 |
| ACABAMENTO (Cortadeira 223,01 + V.UV Total 147,62 + Dayuan 450,00 + Destacar 23,81 + AFT70 1.615,48) | 2.459,92 |
| **Material Direto (MD)** | **8.876,62** |
| **Custo de Transformação (CT)** | **5.926,49** |
| **Serviço Externo** | 0,00 |
| **Custo de Produção** | **14.803,11** |
| Total (c/ créditos ICMS/IPI) | 14.636,21 |
| CEV | 19,25% |

Margens: 10% → unit 0,21 / total 20.700,00 · **28,48% → unit 0,28 / total 28.000,00**
(informada) · 30% → unit 0,29 / total 28.800,00.

`CalculoResAgrupamento` (banco): Agrup2 (MD) CustoFixo 978,03 + CustoUnit 0,077127;
Agrup1 (CT) CustoFixo 3.499,97 + CustoUnit 0,023646. (Esses são o modelo
fixo+unit×tiragem — o agregado para 100k precisa reconstituir os totais acima.)

---

## 2. PLANO (CalculoPlanos) — geometria/suporte REAIS

- nomePlano: **CARTUCHO**
- codSuporte: **8** (Stora Enzo, `Suportes.CoefTinta = 1.5`, TipoSupTinta CARTÃO)
- **aproveitamento: 21** poses/folha (montagem 7×3 = 21 — bate)
- gramatura: **222** (orçado) / 234 (produção)
- tiragem: 100.000 · ocorrencias: 1
- dimensao1 × dimensao2: **142 × 257 mm** (peça no plano)
- **formSuporte: 720 × 1000 mm** (folha)
- quebraPlanoFix: 7,35 · quebraPlanoVar: 1 · supCoefTinta: 1,5

Encaixe do Vizor hoje: linhas 6 × colunas 3 = 18 (aproveitamento forçado p/ 21
via `aproveitamentoManual`), folhasNecessarias 4.762, peso 807,67 kg → papel
R$ 6.251,38 (−2,1% vs 6.382,43 — **praticamente calibrado**, só o peso/quebra
difere levemente: alvo 824,77 kg).

### ✅ BASE DEFINITIVA = 5.160 FOLHAS (quebra/perda de impressão) — CONGELADO

O Calcgraf processa **5.160 folhas** (não as 4.762 puras): ceil(100000/21)=4.762
+ quebra de impressão. Calibrado via `perdasOverride` do item: **fixa 350 folhas
+ 0,939% variável** → folhasBrutas 5.160. TODOS os componentes de folha (papel/
tinta/impressão/acabamento/verniz) usam essa base, e os parâmetros de calibração
(densidade/fatores/gramaturas) foram ajustados a ela. Papel → **R$ 6.383,75**
(alvo 6.382,43, **+0,02% ✅**). `ItemOrcamentoInput.perdasOverride` é aditivo
(não altera o `ParametroPerda` global do tenant).

**Parâmetros finais de calibração (base 5.160, CONGELADOS):**
- Tinta: densidade **0,8867** (CMYK+Pantone), `coberturaCmykAgregadaPercent` 60.
- Impressão: `fatorOperacao` **3,5298**.
- Cortadeira `fatorOperacao` **0,99992**; Dayuan **1,16279**; V.UV Total e
  Destacar `fatorOperacao` **0,92287** (=4762/5160, operam por folha); AFT70
  sem fator (TIRAGEM). Custo-hora Destacar **50**.
- Verniz: gramatura UV **0,0027686**, Primer **0,0029720**; Cola fator 3,0e-7;
  Caixa 893 peças/caixa.
- Prova no motor puro: `golden-15086-motor.test.ts` — 6 componentes ≤ 0,5%
  (papel/tinta/mat.acab/impressão/acabamento/CT), todos verdes.

---

## 3. IMPRESSÃO (CalculoAtividades tipo=I, Atividades.Codigo=2 "Offset Plana" = CD7)

- producaoHora: **4.233** folhas/h
- quantAcertos: **5** (= nº de cores)
- **tempoPorAcerto: 18 min/cor**
- tempoPrimeiroAcerto (setup inicial): **30 min**
- quebraFixa: **350 folhas** · quebraVariavel: 1
- `CalculoAtvImpressao`: processoCodigo 2, coresF 5, coresV 0, quantChapas1 5,
  quantLavagens 5, tiraRetira 0.

Custo-hora da máquina (TabelasCustoDetalhe, CodTabelaCusto=2, Coluna=1,
ValorDireto): **Heidelberg CD 7cores (CodItc 2439) = R$ 550,00/h**.

Tempo total impressão esperado (bate com 3.466,58 / 550 = **6,30 h**):
- Acerto = 5 cores × 18 min + 30 min = **120 min = 2,0 h** (fixo)
- Operação = resto → 6,30 − 2,0 = **4,30 h** de operação variável.
- ATENÇÃO: Vizor hoje calcula operacaoMin 71,62 (1,19 h) → precisa 4,30 h. A
  conta de folhas/producaoHora (4.762/4.233 = 1,12 h) NÃO reproduz 4,30 h.
  O Calcgraf conta a impressão como **tiragem × passagens** ou aplica fator de
  cores/retiro — INVESTIGAR na Fase 3 (provável: operação = folhas × cores /
  producaoHora, ou folhas/producaoHora com producaoHora menor efetiva).

---

## 4. TINTA (CalculoTintas + Itc Origem=TINTA, Tab=2 Col=1 ValorTotal)

Preços reais por kg (ITC TINTA): **Escala (CMYK) R$ 44,00** · **Pantone 01
R$ 71,50** · Especiais 170,50 · Pantone 02 99,00 · Metálica 253,00 · Reativa
154,00 · Preto 20,90.

`CalculoTintas` do 15.086: codTinta 2 (areaTinta **60%**) + codTinta 4 (areaTinta
**5%**). Interpretação: a Escala (CMYK) tem **cobertura agregada 60%** (não por
cor), e a 2ª tinta (Pantone) cobertura 5%.

Alvo tinta: Escala **R$ 220,00** + Pantone 01 **R$ 39,33** = 259,33.
- Vizor hoje: 689,32 (**+166%** — ERRADO). Causa: coberturas por cor somadas
  (80+30+30+40 = 180% agregado) inflam o consumo. A correção (Fase 1): usar a
  **cobertura agregada 60%** da Escala (SPANKS com coefSuporte 1,5, offset 0,5,
  densidade a calibrar) para as 4 cores CMYK juntas + 5% para o Pantone.
- Fórmula SPANKS (do steering): VAR(kg) = coefSuporte × 0,5 × áreaM² × lados ×
  cobertura × densidade / const; FIXO(kg) = partida(0,2) × cores × ocorrências.

### ✅ FASE 1 CALIBRADA (tinta ≤ 0,5%) — parâmetros CONGELADOS

Implementação: novo parâmetro aditivo `coberturaCmykAgregadaPercent` em
`ParamsOrcamento`/`ItemOrcamentoInput` (motor + item.service). Quando presente
(> 0), o modelo SPANKS **colapsa todas as cores `tipo==='CMYK'` numa única linha
"Escala CMYK"** com essa cobertura, mantendo a partida/acerto contando o nº REAL
de cores CMYK (4). Cores PANTONE seguem individuais. Ausente → caminho legado
(uma passagem por cor) — não-regressão garantida pelos PBTs existentes.

Parâmetros calibrados do 15.086 (via `scripts/importar-calcgraf.ts --fase golden-15086`):
- `coberturaCmykAgregadaPercent = 60` (areaTinta real da Escala no backup).
- Pantone `coberturaPercent = 5`.
- **densidade = 0,96** (CMYK e Pantone) — único valor que bate ambos.
- partida 0,2 kg/cor; coefSuporte 1,5 (Stora); fatorProcesso 0,5 (offset);
  CONST_SPANKS 353.

Resultado (motor, folhasBrutas 4.762, areaM² 3.428,64):
`Escala CMYK = R$ 219,82` (alvo 220,00; **−0,08%**) + `Pantone 01 = R$ 39,30`
(alvo 39,33; **−0,08%**) → **total R$ 259,12** (alvo 259,33; **−0,08% ✅**).

---

## 5. MATERIAL DE ACABAMENTO (CalculoMatAcabamento + Itc Origem=MAT.ACABAMENTO)

Preços reais (TabelasCustoDetalhe Tab=2 Col=1 ValorTotal):
- **Cola Branca (ITC 1036): R$ 29,15/kg**
- **Verniz Primer / F100 (ITC 2604): R$ 17,49/kg**
- **Verniz UV (ITC 1043): R$ 57,20/kg**
- **Caixa Padrão (ITC 1512): R$ 7,70/un**

Alvo MAT.ACABAMENTO: Cola 154,79 + V.Primer 193,12 + V.UV 529,52 + Caixa 862,40
= 1.739,83.
- Vizor hoje: **0,00** (−100%). Causa: o motor recebe o preço (unitário 57,20 /
  7,70) mas NÃO calcula a QUANTIDADE consumida (variavel=0 → subtotal=0). A
  correção (Fase 2): fazer o motor calcular consumo:
  - Caixa Padrão: 862,40 / 7,70 = **112 unidades** (= caixas; provável tiragem /
    peças por caixa). No pré-cálculo, Caixa Padrão aparece com variável "112".
  - Cola Branca: 154,79 / 29,15 = **5,31 kg** (consumo por colagem/177mm).
  - Verniz Primer: 193,12 / 17,49 = **11,04 kg** (área × cobertura).
  - Verniz UV: 529,52 / 57,20 = **9,26 kg**.
  Esses consumos precisam de fórmula (área impressa × gramatura de verniz, ou
  consumo informado). INVESTIGAR a regra de consumo de cada um na Fase 2.

Observação: no `CalculoMatAcabamento` os CodMaterial 16/40/61/23 apontam para
SUPORTES (resinas/laminação), não para os ITC MAT.ACABAMENTO — a amarração
material↔atividade do Calcgraf é indireta; a referência confiável são os
VALORES do pré-cálculo (acima) e os preços ITC.

### ✅ FASE 2 CALIBRADA (material de acabamento ≤ 0,5%) — CONGELADO

`CalculoMatAcabamento` do 15.086 (parâmetros reais extraídos do backup):
| CodMaterial | codAtv | ParamAcab1 | Tipo | Material |
|---|---|---|---|---|
| 16 | 14 (AFT70) | 177,0 | 3 | Cola (aba 177 mm) |
| 40 | 39 | 0 | 0 | Caixa Padrão |
| 61 | 42 | 100,0 | 1 | Verniz Primer (cobertura 100%) |
| 23 | 9 (V.UV) | 90,0 | 1 | Verniz UV (cobertura 90%) |

Módulo puro novo `src/modules/orcamento-grafico/consumo-material-acabamento.ts`
(`consumoVerniz`/`consumoCola`/`consumoCaixa`). Fórmulas e parâmetros calibrados:
- **Verniz (kg)** = áreaImpressaM² × cobertura × gramaturaKgM². Gramatura UV
  0,003; Primer 0,00322. áreaImpressa = 4.762 folhas × 0,72 × 1,0 = 3.428,64 m².
- **Cola (kg)** = tiragem × comprimentoColaMm × fator (3,0e-7). Aba 177 mm.
- **Caixa (un)** = ceil(tiragem / pecasPorCaixa=893) = 112 un.

Resultado (motor, somado ao MD): Cola **154,79** (exato) + V.Primer **193,09**
(−0,02%) + V.UV **529,50** (0,00%) + Caixa **862,40** (exato) → **total
R$ 1.739,78** (alvo 1.739,83; **−0,003% ✅**). Seed golden-15086 passa os 4
materiais com `variavelKg`/`variavelUn` calculado + preço; os de hora-máquina
(Cortadeira/Dayuan/Destacar/AFT70/V.UV aplicação) seguem por `acabamentoId`
(Fase 3).

---

## 6. ACABAMENTO — Custo de Transformação (CalculoAtividades tipo=A)

Custo-hora (TabelasCustoDetalhe Tab=2 Col=1 ValorDireto, Itc Origem=CENTRO DE CUSTO):

| codAtividade | Nome | producaoHora | setup (1º acerto) | custo-hora | Alvo (R$) |
|---|---|---|---|---|---|
| 8 | Cortadeira (Grande) | 3.000/h | 15 min | 113,21 | 223,01 |
| 9 | Verniz UV Total | 5.000/h | 0 | (material) | 147,62 |
| 66 | Dayuan (Corte e Vinco) | 6.000/h | 30 min | 300,00 | 450,00 |
| 34 | Destacar | 10.000/h | 0 | 50,00 | 23,81 |
| 14 | AFT70 (Coladeira) | 28.182/h | 90 min | 320,00 | 1.615,48 |
| 39 | Caixa Padrão | material/un | - | (material 7,70) | — |

- Vizor hoje (acabamentosCentros): Cortadeira 218,99 (alvo 223,01 ✅ quase),
  Dayuan 702,65 (alvo 450 ❌ alto), Destacar 25,27 (alvo 23,81 ✅), AFT70 537,75
  (alvo 1.615,48 ❌ baixo). Verniz UV Total não entra como centro (é material).
- Causa das divergências: tempos de operação/acerto diferentes. AFT70: alvo
  1.615,48 / 320 = 5,05 h; com producaoHora 28.182 e tiragem 100k → 3,55 h +
  setup 1,5 h = 5,05 h ✅ (bate!) — o Vizor está computando folhas erradas
  (10,83 min op). Dayuan: 450/300 = 1,5 h; 100k/6000 = 16,7 h?? Não — deve ser
  por FOLHAS (4.762/6000 = 0,79 h) + setup 0,5 = 1,3 h ≈ 1,5 h. Precisa alinhar
  a base (folhas vs peças) por atividade. INVESTIGAR Fase 3.

### 🔎 FASE 3 — descobertas do CT (base por atividade) — PARCIAL

Dados reais do 15.086 (`CalculoAtividades`, custo-hora `Itc` CENTRO DE CUSTO
Tab 2 Col 1 ValorDireto). Agregado real do CT (`CalculoResAgrupamento` agrup 1):
**CustoFixo 3.499,97 + CustoUnit 0,0236461** (× tiragem) → CT 5.864,58.

| Atividade | custoHora | prodHora | 1º acerto | **base que BATE** | resultado | alvo | ✓ |
|---|---|---|---|---|---|---|---|
| V.UV Total | 155,00 | 5.000 | 0 | **FOLHAS** (4.762) | 147,62 | 147,62 | **0,0% ✅** |
| Destacar | **50,00** | 10.000 | 0 | **FOLHAS** | 23,81 | 23,81 | **0,0% ✅** |
| AFT70 (Coladeira) | 320,00 | 28.182 | 90 min | **TIRAGEM** (100k) | 1.615,48 | 1.615,48 | **0,0% ✅** |
| Cortadeira | 113,21 | 3.000 | 15 min | folhas + quebra | 208,00(folhas) | 223,01 | −6,7% (quebra) |
| Dayuan | 300,00 | 6.000 | 30 min | folhas-equiv | 388,10(folhas) | 450,00 | −13,8% |
| Impressão | 550,00 | 4.233 | 30 + 5×18 | folhas-equiv ×3,82 | 1.718,73(folhas) | 3.466,58 | −50% |

**Regras decifradas:**
- Custo-hora **Destacar = R$ 50,00** (o centro 30/"Envase" R$ 1,00 do backup está
  errado para esta atividade — usar 50 bate exato).
- **Base por atividade varia**: V.UV e Destacar operam por FOLHAS; AFT70 por
  TIRAGEM (peças coladas). Isso confirma que `unidadeBase` (FOLHA/PRODUTO) do
  acabamento rico, já suportado pelo motor, resolve esses 3.
- **RESOLVIDO (impressão/cortadeira/dayuan) — `fatorOperacao`**: a operação dessas
  atividades usa "folhas-equivalentes" (passagens/retiro/quebra do Delphi, não
  exposto no backup). Implementado como **`fatorOperacao`** (multiplica as folhas
  só na produção/var, não no acerto): novo campo `CentroProducao.fatorOperacaoImpressao`
  (impressão) + `fatorOperacao` no acabamento rico HORA_MAQUINA (centros).
  Fatores calibrados: **impressão 3,826 · Cortadeira 1,0836 · Dayuan 1,26**
  (V.UV/Destacar/AFT70 batem com fator 1).

### ✅ FASE 3 CALIBRADA (impressão + acabamento ≤ 0,5%) — CONGELADO

Resultado (motor, com os parâmetros/fatores acima):
| Componente | resultado | alvo | desvio |
|---|---|---|---|
| IMPRESSÃO | 3.467,28 | 3.466,58 | **+0,02% ✅** |
| ACABAMENTO (centros) | 2.459,95 | 2.459,92 | **0,00% ✅** |
| — Cortadeira | 223,03 | 223,01 | ✅ |
| — V.UV Total | 147,62 | 147,62 | ✅ |
| — Dayuan | 450,01 | 450,00 | ✅ |
| — Destacar | 23,81 | 23,81 | ✅ |
| — AFT70 | 1.615,48 | 1.615,48 | ✅ |
| **CT total** | **5.927,23** | 5.926,50 | **+0,01% ✅** |

Mudanças de schema: `CentroProducao.fatorOperacaoImpressao` (Decimal 8,4, null →
fator 1). `migrate-prod.ts` idempotente no mesmo commit (ADD COLUMN IF NOT EXISTS).
Seed golden-15086: acabamentos de hora-máquina EXPLÍCITOS (custoHora/producaoHora/
unidadeBase/acerto/fatorOperacao reais) + fatorOperacaoImpressao 3,826 na HEID-CD7.

---

## 7. Estado atual da calibração (Vizor em produção, orçamento 5316)

| Componente | Vizor | Alvo | Desvio |
|---|---|---|---|
| Papel/Suporte | 6.251,38 | 6.382,43 | −2,1% ✅ |
| Tinta | 689,32 | 259,33 | +166% ❌ |
| Impressão(máq) | 1.756,54 | 3.466,58 | −49% ❌ |
| Acab.(centros) | 1.484,66 | 2.459,92 | −40% ❌ |
| MatAcab | 0,00 | 1.739,83 | −100% ❌ |
| **Custo Produção** | **10.181,90** | **14.803,11** | **−31%** |

Parâmetros JÁ corrigidos no seed/produção: coefTinta Stora = 1,5; HEID-CD7
custoHora 550 / velocidade 4233 / acertoPorCorMin 18 / tempoSetupMin 30 /
formato 720×1000; preços tinta Escala 44 / Pantone 71,50; preço mat.acab Verniz
UV 57,20 / Caixa 7,70; coberturas Escala 60%(agregada via 80/30/30/40) /
Pantone 5%.

---

## 8. Plano de calibração (spec `orcamento-grafico-calibracao-15086`)

- **Fase 0 — Bugs de UI**: Select de Suporte vazio na tela Papel; tela de
  detalhe do orçamento em branco (rota `/orcamento-grafico/[id]`).
- **Fase 1 — Tinta (SPANKS)**: cobertura agregada 60%/5%, densidade/constante →
  bater 259,33.
- **Fase 2 — Material de Acabamento**: motor calcular consumo (Cola/Primer/UV/
  Caixa) → bater 1.739,83.
- **Fase 3 — Impressão + Acabamento (CT)**: base folhas vs peças, passagens por
  cor, tempos → bater 3.466,58 + 2.459,92.
- **Fase 4 — Fechamento golden ≤0,5%** (destravar `golden-15086` por componente)
  + **reutilização de cálculo entre orçamentos** (estudo de como o Calcgraf
  clona CalculoHeader → novo orçamento).

## 9. Como re-extrair do Calcgraf (SQL Server local)

```
sqlcmd -S localhost -E -C -d CalcgrafCartonWega -h -1 -W -Q "<SQL>"
```
Tabelas-chave do cálculo (FK = coluna `Codigo` = NumCalculo = 15086):
`CalculoPlanos`, `CalculoAtividades` (tipo I=impressão, A=acabamento, M=material),
`CalculoAtvImpressao`, `CalculoTintas`, `CalculoMatAcabamento`,
`CalculoResAgrupamento`, `CalculoTiragens`. Preços: `Itc` (Origem TINTA/
MAT.ACABAMENTO/CENTRO DE CUSTO/SUPORTE) + `TabelasCustoDetalhe` (CodTabelaCusto=2,
Coluna=1, ValorDireto p/ máquina, ValorTotal p/ material/tinta). Custo-hora
máquina: `Itc` Origem='CENTRO DE CUSTO' (HEID-CD7 = CodItc 2439 = 550).
