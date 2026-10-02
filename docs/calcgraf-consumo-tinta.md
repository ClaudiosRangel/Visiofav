# Consumo de TINTA — paridade Calcgraf (DECIFRADO)

Engenharia reversa de como o Calcgraf/G-Print calcula o consumo (kg) e o custo
de tinta em impressão offset. Resolvida combinando a memória de cálculo
(pré-cálculo 5355/15185) com a fórmula clássica da indústria gráfica **SPANKS**
(pesquisa web) e o parâmetro global do Calcgraf "Partida de consumo de tinta".

Implementação: `src/modules/orcamento-grafico/consumo-tinta.ts`
Testes: `src/modules/orcamento-grafico/calibracao/golden-consumo-tinta.{fixture,test}.ts`

## 1. O que faltava e como foi destravado

Na sessão anterior a tinta estava "bloqueada" porque o **rendimento (m²/kg)**
não está em nenhuma tabela do backup. A chave foi perceber que o Calcgraf usa a
fórmula padrão da indústria (**SPANKS**) e que o `CoefTinta` por tipo de suporte
(`DefTipoSuportesxCoefTinta` / `Suportes.CoefTinta`) **é o fator "Stock" do
SPANKS**. Prova: os valores batem com a tabela clássica do SPANKS —
KRAFT=2,2=rough cartridge, JORNAL=1,8=newsprint, CARTÃO 1,5≈smooth cartridge.

## 2. Modelo (validado no 15185 — desvio ~1,3% no custo)

```
consumoVar_kg = (S × P × A × N × K × D) / 353        (fórmula SPANKS)
  S = CoefTinta do suporte (Stock)        — ex. CARTÃO 1,5
  P = fator processo                       — offset 0,5 ; tipografia 1,0
  A = área impressa em m² (folhas × formato do suporte)
  N = nº de lados impressos                — 4x0 → 1
  K = cobertura 0..1                       — CalculoTintas.areaTinta/100 (0,80)
  D = densidade da tinta                   — preto 1,0 ; process CMYK 1,3 ; branco 2,0
  353 = constante clássica do SPANKS

consumoFixo_kg = partidaConsumoKg × cores × ocorrencias
  partidaConsumoKg = 0,2 kg  (parâmetro Calcgraf "Partida de consumo de tinta" = 200 g)

custo = (consumoFixo_kg + consumoVar_kg) × precoKg
```

### Validação 15185 (tinta Escala, Stora/CARTÃO, cobertura 80%, 4 cores, 2 partes)
| | calc | real (memória) | desvio |
|---|---|---|---|
| FIXO (kg) | 1,60 | 1,60 | **exato** (0,2 × 4 × 2) |
| VAR (kg)  | 12,64 | 12,46 | 1,4% |
| custo (R$) | 626,51 | 618,48 | 1,3% |

Preço Escala 44,0/kg (`TabelasCustoDetalhe`). O resíduo de ~1,4% vem do
arredondamento das folhas na memória (10.400/5.400) e/ou da constante exata (um
ajuste fino: VAR bate 0,0% com constante 358 ou cobertura efetiva 78,9%). Para
fins práticos adota-se **353** (canônico) + densidade 1,0.

## 3. De onde vem cada dado no Calcgraf
- **S (CoefTinta)**: `Suportes.CoefTinta` (do suporte do plano) /
  `DefTipoSuportesxCoefTinta` (por tipo). CARTÃO 1,5; KRAFT 2,2; OFFSET 1,6; etc.
- **P (processo)**: offset 0,5 (impressão plana).
- **A (área)**: folhas impressas × formato do suporte (`CalculoPlanos.formSuporte`).
  O motor do Vizor já calcula folhas (congelado no Nível B — papel).
- **N (lados)**: do padrão de cores (ex.: 4x0 = 1 lado).
- **K (cobertura)**: `CalculoTintas.areaTinta` (%). No 15185 = 80%.
- **D (densidade)**: não exportada; usar 1,0 (base) ou 1,3 (process). No 15185
  bate com 1,0. Refinar por tipo de tinta se necessário.
- **Partida**: `Parametros` "Partida de consumo de tinta" = 200 g = 0,2 kg.

## 4. Pontos a refinar (quando houver mais pré-cálculos)
1. **Densidade (D)** por tipo de tinta (preto/process/pantone/branco) — hoje 1,0.
2. **Constante exata** (353 vs 358) e cálculo preciso das folhas (quebra/aparas)
   — o resíduo de ~1,4% está nessa faixa.
3. Validar em ≥2 pré-cálculos adicionais (só temos o 5355/15185). Pedir ao
   usuário mais "Emissão de Pré-Cálculos" variados (preto puro, pantone, verso).

## 5. Estado
Modelo COMPLETO identificado e implementado (função pura + teste de calibração;
suíte orcamento-grafico 77/77). Saiu de "bloqueado/sem fórmula" para ~1,3% no
custo total — faixa de refino, não mais de incógnita estrutural. O motor do
Vizor (`calcularTinta`) usa `rendimentoM2Kg`; o SPANKS é a forma de DERIVAR esse
rendimento efetivo a partir de suporte/cobertura/densidade quando não há um valor
cadastrado por tinta.
