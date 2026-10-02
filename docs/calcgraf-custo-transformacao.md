# Custo de Transformação (CT) — paridade Calcgraf (DECIFRADO E VALIDADO)

Documento da engenharia reversa do **Custo de Transformação** (tempo/custo de
máquina) do Calcgraf/G-Print, feita sobre o banco restaurado
`CalcgrafCartonWega` (SQL Server local) + a memória de cálculo do pré-cálculo
`5355/15185`. Fecha o passo 2 do Nível B da calibração.

Implementação: `src/modules/orcamento-grafico/custo-transformacao.ts`
Testes: `src/modules/orcamento-grafico/calibracao/golden-custo-transformacao.{fixture,test}.ts`

## 1. Descoberta de base (o que mascarava a calibração)

Existem DUAS Tabelas de Custos no Calcgraf, com validade por período
(`TabelasCusto`): Tabela **1** "Padrão" (até 02/12/2024) e Tabela **2** "Teste"
(desde 03/12/2024). Os cálculos de 2026 usam a **Tabela 2** (a mais recente).

O custo-hora de cada máquina está em `TabelasCustoDetalhe` (`CodItc`, `Coluna=1`,
campo **`ValorDireto`**), onde o `CodItc` vem de `Itc` com `Origem='CENTRO DE
CUSTO'` e `CodOrigem = codCentroCusto`. **Usar sempre a Tabela 2.** Exemplos
reais (Tab1 → Tab2): Heidelberg CD 245,45 → **440,00**; Roland RZU 64,59 →
**100,00**; HotStamping 50 → **110**; Bobst E 100 → **300**. Cortadeira/
Guilhotina/Fita/Laminação não mudaram.

Usar a Tabela 1 (antiga) era o erro que deixava o CT ~2,3% fora.

## 2. Fórmula de custo (confirmada EXATA na memória)

Para cada atividade de máquina (impressão + acabamentos):

```
custo_atividade = (tempoFixoHoras + tempoVarHoras) × custoHora
```

Validação direta na memória do 15185 (desvios só de arredondamento HH:MM):
Guilhotina (0:00+4:01)×77,69 = 312,05 ✓ · Cortadeira (0:30+4:08)×113,21 =
524,54 vs 524,67 · Offset (3:20+2:44)×440 = 2669 vs 2666,67 · Bobst
(5:00+3:00)×300 = 2400 ✓. Soma dos subtotais = **10.453,30** = C.Transf do
rodapé do pré-cálculo (EXATO).

## 3. Tempo FIXO (acerto / setup) — a regra decifrada

Fonte: tabela `CalculoAtividades` (NÃO `CalculoAtvImpressao`/`AtvAcabamento`).
Campos: `quantAcertos`, `tempoPorAcerto` (min), `tempoPrimeiroAcerto` (min),
`producaoHora`, `entradas`, `codCentroCusto`, `codAtividade` (=2 → impressão
offset). Multiplicado pelo nº de ocorrências (partes do plano que repetem a atv).

- **Acabamentos** (e máquinas em geral):
  `tempoFixo = quantAcertos × tempoPorAcerto + tempoPrimeiroAcerto`
  → validado EXATO em 7/8 atividades do 15185 e em massa (ver §5).
- **Impressão offset** (regra especial — depende das cores):
  `tempoFixo = cores × acertoPorCorMin + tempoPrimeiroAcerto`
  onde `cores` = `coresF` (= `quantChapas1` = `quantLavagens` nos casos normais)
  e `acertoPorCorMin` é o **tempo de acerto por cor DA MÁQUINA**.

### Tempo de acerto por cor por máquina (parâmetro do Calcgraf)
Derivado empiricamente (dominante, estável por centro):

| Centro de custo | Máquina            | acerto/cor (min) |
|-----------------|--------------------|------------------|
| 2               | Heidelberg CD 5c   | 25               |
| 45 / 4          | Roland / impr.     | 90               |
| 1               | KBA Rápida 75      | 20               |
| 46              | (impressão)        | 36               |

> Este valor NÃO está exportado numa tabela — é um parâmetro por máquina do
> cadastro do Calcgraf (fica no app Delphi). Para o Vizor GERAR orçamento novo,
> deve virar um campo de cadastro da máquina ("acerto por cor, min"). Para
> REPRODUZIR cálculos, usa-se o valor efetivo observado por centro.

### Casos atípicos (ruído conhecido)
Quando o operador ajusta `quantAcertos` manualmente para um valor ≠ cores
(ex.: 15196 com quantAcertos=15, coresF=5), a regra por-cor não se aplica —
é override manual. São minoria.

## 4. Tempo VARIÁVEL (produção)

```
tempoVarHoras = unidadesProcessadas / producaoHora      (producaoHora em unid/h)
```

`unidadesProcessadas` depende do tipo de atividade (folhas impressas no suporte,
folhas cortadas, peças montadas) — vem do **encaixe/aproveitamento** do plano.
O motor do Vizor já calcula folhas a partir do `aproveitamento` real dos planos
(congelado no Nível B — papel). A agregação:

```
CustoUnitario = Σ (tempoVarHoras × custoHora) / tiragem
```

Validado no 15185: Σ(VAR×ch)/10000 = 0,69532 vs `CustoUnitario` real 0,69500
(0,05%, só arredondamento HH:MM).

## 5. Agregação e validação em MASSA

O Calcgraf grava em `CalculoResAgrupamento` (agrupamento **1** = Custo de
Transformação): `CustoFixo` + `CustoUnitario`. `CT(tiragem) = CustoFixo +
CustoUnitario × tiragem`.

Varredura de 53 cálculos reais (últimos com impressão), aplicando a regra de
FIXO (acerto por cor para impressão + quantAcertos×tempoPorAcerto para
acabamentos) com custo-hora da Tabela 2:

> **CustoFixo bate ≤1% em 52/53 cálculos.** O único fora (15196) é o override
> manual de quantAcertos citado em §3.

## 6. Estado por componente do Nível B

| Componente        | Status | Desvio |
|-------------------|--------|--------|
| Fórmula de preço (gross-up) | ✅ congelado | exato |
| Papel (peso/custo) | ✅ congelado | 0,0001% |
| Decomposição CT/MD/SE | ✅ congelado | — |
| **CT — fórmula de custo** | ✅ **validado** | exato |
| **CT — tempo FIXO (acerto)** | ✅ **validado** | 52/53 ≤1% |
| **CT — tempo VAR (produção)** | ✅ **validado** | 0,05% |
| Tinta | ⚠️ bloqueado | ver §7 |

## 7. Tinta — estado (bloqueado por dado ausente)

A fórmula de custo da tinta é `custo = (fixo_kg + var_kg) × preço_kg` (confirmado
na memória: Escala 1,60+12,46 kg × 44/kg = 618,64). O consumo variável em kg é:
`consumo ≈ área_impressa_m² × cobertura × (algo) / rendimento`. 

- Cobertura por tinta: `CalculoTintas.areaTinta` (ex. 15185 Escala = 80%). ✅
- Coef. de tinta por suporte: `Suportes.CoefTinta` / `DefTipoSuportesxCoefTinta`
  (Stora/CARTÃO = 1,5). ✅
- Preço/kg: `TabelasCustoDetalhe` (Escala = 44). ✅
- Parâmetro global `Parametros`: **"Partida de consumo de tinta" = 200** (consumo
  de arranque/fixo). ✅
- **FALTA**: o rendimento variável (m²/kg) por tinta. No 15185 o consumo real
  implica ~**477 m²/kg a 100% de cobertura** (≈2,1 g/m²), mas nenhuma tabela do
  backup guarda esse rendimento — está no cadastro de tinta do Delphi ou embutido
  no código. Nenhuma combinação de área×cobertura×CoefTinta÷{200, coef} reproduz
  os 12,46 kg observados.

O motor do Vizor JÁ suporta `rendimentoM2Kg` por cor (`calcularTinta`), então
basta o VALOR correto quando for obtido (coletar do cadastro de tinta no Calcgraf
via RDP, ou pedir ao cliente). Peso da tinta no custo ≈ 4% e o MD agregado já
bate 0,001% — por isso é refino, não bloqueia o orçamento.

## 8. Próximos passos
1. Para gerar orçamento NOVO: adicionar "acerto por cor (min)" ao cadastro da
   máquina de impressão no Vizor (hoje usamos o valor efetivo por centro).
2. Tinta: coletar o rendimento (m²/kg) por tinta do Calcgraf (RDP) e preencher
   `rendimentoM2Kg`; validar contra a memória (Escala ⇒ ~477 a 100%).
3. Harness em massa opcional: estender a validação do CustoFixo (52/53) para o
   CustoUnitário usando as folhas calculadas pelo motor (aproveitamento real).

## 9. INTEGRADO AO MOTOR (02/10/2026)

O modelo de acerto-por-cor está **plugado no motor** (`calcularOrcamentoGrafico`):
quando a máquina de impressão (`CentroProducao`) tem `acertoPorCorMin` cadastrado,
o Custo de Transformação da impressão usa `cores × acertoPorCorMin + tempoSetupMin`
(+ produção = folhas/velocidade × custoHora); senão, cai no modelo legado (setup
fixo). Cadastro: tela **PCP → Cadastros → Centros** (campos "Acerto por cor (min)"
e "Setup fixo / 1º acerto (min)"). As rotas `/calcular` e `/simular-tiragens`
foram unificadas e leem esses campos. Flag `modeloCalculo.maquina` no resultado
indica CALIBRADO vs LEGADO. Spec: `.kiro/specs/orcamento-grafico-finalizacao`.
PENDENTE de refino: hoje modela a impressão como 1 etapa; acabamentos no CT ainda
usam o caminho legado (`calcularAcabamentos`) — ampliar para o modelo calibrado
por centro quando o usuário pedir.
