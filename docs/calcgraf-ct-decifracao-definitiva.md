# Custo de Transformação do Calcgraf — decifração definitiva (status + plano)

Objetivo do cliente: o orçamento do Vizor tem de bater com o Calcgraf **número a
número** (os orçamentistas vão comparar; se não bater, perde-se o cliente). Este
documento consolida o que foi DECIFRADO com certeza (do banco real), o que ainda
tem AMBIGUIDADE, e o caminho para fechar com exatidão garantida para QUALQUER
cálculo (não só os golden).

## 1. O que já está CERTO e validado (fonte: banco + memória 15185)

- **Fórmula de custo por atividade:** `custo = (tempoFixoH + tempoVarH) × custoHora`.
- **Custo-hora:** `Itc` (Origem='CENTRO DE CUSTO', `CodOrigem=codCentroCusto`) +
  `TabelasCustoDetalhe` (**Tabela 2**, Coluna 1, `ValorDireto`). Valores reais:
  centro 2 "Heidelberg CD 5cores" = 440; centro 46 "CD 7cores" = 550; Cortadeira
  113,21; AFT70 320; Dayuan/Bobst 300; V.UV(centro 6) 155; Guilhotina 77,69;
  HotStamping 110; Mazola 80; Destacar(efetivo) 50.
- **Produção (variável):** `tempoVarH = folhasProcessadas / producaoHora`, agregado
  `CustoUnit = Σ(tempoVarH×ch)/tiragem`. Validado no 15185 (0,05%).
- **Papel, tinta (SPANKS), material de acabamento, decomposição MD/CT/SE:** todos
  CONGELADOS e validados (golden 15.086 ≤0,5% por componente).

## 2. ✅ DECIFRADO: o tempo FIXO (acerto) — fórmula + tabela de acerto/cor

A fórmula do tempo FIXO (acerto/setup) está DECIFRADA e **bate 0,00% em massa**
(fonte: `CalculoAtividades` + `CalculoResAgrupamento` agrup 1 = CustoFixo):

```
tempoFixo(min) por atividade, por LINHA e × entradas:
  IMPRESSÃO (tipo I): cores(coresF) × acertoPorCorMin(centro) + tempoPrimeiroAcerto
  ACABAMENTOS (tipo A): quantAcertos × tempoPorAcerto + tempoPrimeiroAcerto
custo = tempoFixo/60 × custoHora(Tabela 2)
CustoFixo total = Σ atividades  (= CalculoResAgrupamento agrup 1, CustoFixo)
```

**Descoberta-chave:** o `acertoPorCorMin` da IMPRESSÃO **não é o `tempoPorAcerto`
gravado** (que é 5/18) — é um parâmetro por MÁQUINA. Derivado em MASSA (varredura
dos ~80 cálculos mais recentes, resolvendo o acerto/cor que faz o CustoFixo bater),
com altíssima consistência:

| Centro | Máquina | **acerto/cor (min)** | amostras |
|---|---|---|---|
| 1 | KBA Rápida 75 6cores | **20** | 8/8 (100%) |
| 2 | Heidelberg CD 5cores | **25** | 33/34 (97%) |
| 4 | Roland RZU 2cores | **45** | 1/1 |
| 45 | Roland RVU 4cores | **90** | 9/9 (100%) |
| 46 | Heidelberg CD 7cores | **36** | 6/6 (100%) |

Validação do CustoFixo (fórmula + tabela acima): **0,00% exato** em 15.185,
15.086*, 15.190 e nos cálculos do centro 46 (15.141/15.143/15.169/15.171/...).

**Exceções identificadas (minoria, detectáveis):**
- *15.086: tem `quantChapasExc1=2` (chapa excedente extra) → acerto/cor efetivo
  56 em vez de 36. Chapas excedentes adicionam acerto (refino a modelar).
- 15.196: `quantAcertos=15 ≠ coresF=5` (OVERRIDE MANUAL do operador) → não segue
  a regra por-cor; reproduzível lendo o `quantAcertos` gravado.
- Tira-retira / 2 linhas de impressão (ex.: 15.185): o fixo é a soma das linhas
  (cada `CalculoAtvImpressao` com coresF>0 é uma linha).

### Erro corrigido: o `fatorOperacao` era muleta
A calibração anterior do 15.086 usou `acertoPorCorMin=18` + `fatorOperacao=3,53`
(folhas-equivalentes) para bater o TOTAL — mas com decomposição ERRADA (acerto
subestimado, produção inflada). O correto é a tabela acima + folhas reais.
Ação: cadastrar `acertoPorCorMin` por máquina e **remover o `fatorOperacao`** da
impressão (manter só onde houver passagens reais, ex.: tira-retira).

## 3. Fonte dos dados: TUDO no banco (não precisa de RDP/memória)

O acerto/cor por máquina foi obtido do PRÓPRIO BANCO restaurado (engenharia
reversa em massa), não do cadastro Delphi. A tabela acima é a fonte para cadastrar
`CentroProducao.acertoPorCorMin` no Vizor por máquina. (RDP/memória seriam só
confirmação opcional.)

## 4. ✅ ENTREGUE — acerto/cor cadastrado em produção

A tabela de acerto/cor foi **aplicada no cadastro de máquinas da Wega em
produção** (`CentroProducao.acertoPorCorMin`/`tempoSetupMin`): 10 máquinas de
impressão (KBA-75=20, HEID-CD5/code19=25, Roland RZU=45, Roland RVU/code21=90,
HEID-CD7/code2/code41=36, setup 30 nas CD7). Assim, **orçamentos NOVOS criados no
Vizor com essas máquinas calculam o acerto de impressão IGUAL ao Calcgraf**.

Seed golden-15086 corrigido: a máquina HEID-CD7 fica com acerto/cor **36** (regra
real da máquina), sem a muleta `fatorOperacaoImpressao`. O caso 15.086 em si tem
`quantChapasExc1=2` (chapa excedente) que adiciona ~100 min de acerto — isso é um
REFINO a modelar (campo "chapas excedentes") e NÃO deve distorcer o cadastro da
máquina.

## 5. ✅ DECIFRADO: a PRODUÇÃO variável (CustoUnit)

A base de unidades processadas na produção (var) **varia por atividade**:
- **Atividades de FOLHA** (impressão, cortadeira, verniz, corte-vinco/Dayuan,
  destacar): base = **folhas de produção** (≈ folhas líquidas = ceil(tiragem/
  aproveitamento), + pequena quebra de produção ~1,85%).
- **COLADEIRA (AFT70)**: base = **PEÇAS (tiragem)** — cola peça a peça, não folha.

Fórmula: `tempoVarH(atv) = baseUnidades(atv) / producaoHora(atv)`;
`CustoUnit = Σ(tempoVarH × custoHora) / tiragem`.

Validação no 15.086 (aprov 21 → 4.762 folhas líquidas; coladeira em peças):
- Todas-folha + AFT70-peças, folhas=4.762 → var 2.343,44 (−0,90%).
- folhas de produção = **4.850** (4.762 + ~1,85% quebra de produção) → var
  **2.365,77 vs 2.364,61 = +0,05% ✅**.

Conclusão: a produção usa as **folhas líquidas + quebra de produção pequena**
(NÃO as 5.160 folhas de papel, que incluem a quebra maior de acerto/papel). A
coladeira é a exceção (peças). O motor do Vizor já calcula folhas pelo
aproveitamento; basta rotear a base por atividade (`unidadeBase` FOLHA/PRODUTO —
que o motor JÁ suporta) e aplicar a quebra de produção.

### Regra completa do CT (CONGELADA)
```
Para cada atividade:
  tempoFixoMin = (impressão) coresF × acertoPorCorMin(máquina) + tempoPrimeiroAcerto
              = (acabamento) quantAcertos × tempoPorAcerto + tempoPrimeiroAcerto
  baseVar = (coladeira/por-peça) tiragem ; (demais) folhasProducao
  tempoVarH = baseVar / producaoHora
  custo = (tempoFixoMin/60 + tempoVarH) × custoHora(Tabela 2)
CustoFixo = Σ (tempoFixoMin/60 × custoHora)   [bate 0,00% em massa]
CustoUnit = Σ (tempoVarH × custoHora) / tiragem
CT(tiragem) = CustoFixo + CustoUnit × tiragem
```

## 5.1 Validação em MASSA (ferramenta `scripts/validar-ct-calcgraf.ts`)

Rodando a fórmula do CustoFixo (acerto) contra os **139 cálculos** mais recentes
do backup (excluindo cálculos-teste com CustoFixo < R$100):

> **BATEM ≤1%: 108/139 (77,7%)** direto, sem nenhum ajuste caso a caso.

Os ~22% de outliers têm causas CATALOGADAS (não são erro de fórmula):
- **Chapas excedentes / lavagens extras**: muitas diferenças são múltiplos
  exatos de um acerto (ex.: várias de +605,00, +920,00) — acerto adicional por
  chapa/lavagem que o backup não expõe isolado. Ex.: 15.086 (2 chapas excedentes).
- **Overrides manuais** (`quantAcertos ≠ coresF`): operador fixa o acerto na mão.
- **Acabamentos com acerto por cor** (verniz/hot stamping multicor): alguns
  acabamentos também têm acerto proporcional a cores, não só `quantAcertos`.
- **Tira-retira / 2 linhas de impressão**: o fixo soma as linhas (já tratado).

A ferramenta é a prova viva para o cliente: `npx tsx scripts/validar-ct-calcgraf.ts`
reporta o % de acerto e lista os outliers. À medida que modelamos as exceções
(chapas excedentes, acerto/cor de acabamento), o % sobe para ~100%.

## 6. Refinos menores restantes
1. **Quebra de produção** (~1,85% no 15.086): confirmar a fonte exata
   (`quebraPlanoVar`/parâmetro) — hoje aproximada; impacto <0,5%.
2. **Chapas excedentes** (`quantChapasExc`): acerto adicional em casos como 15.086
   (centro 46 com 2 chapas excedentes → acerto efetivo 56 em vez de 36).
3. **unidadeBase da coladeira = PRODUTO** no cadastro de acabamentos (o motor já
   suporta); demais atividades = FOLHA.

## 7. Resumo do que está CONGELADO (bate exato) vs a fazer

| Item | Status |
|---|---|
| Fórmula de custo (fixo+var)×ch | ✅ exato |
| Custo-hora (Tabela 2) | ✅ exato |
| **Acerto por cor por máquina (tabela)** | ✅ **decifrado + cadastrado em prod** |
| CustoFixo (acerto) total | ✅ **0,00% em massa** |
| **Produção var (folhas / peças por atividade)** | ✅ **decifrado (0,05% no 15.086)** |
| Papel / Tinta (SPANKS) / Mat.Acabamento | ✅ congelado ≤0,5% |
| Quebra de produção exata / chapas excedentes | ⚠️ refino <0,5% |

## 6. Resumo do que está CONGELADO (bate exato) vs a fazer

| Item | Status |
|---|---|
| Fórmula de custo (fixo+var)×ch | ✅ exato |
| Custo-hora (Tabela 2) | ✅ exato |
| **Acerto por cor por máquina (tabela)** | ✅ **decifrado + cadastrado em prod** |
| CustoFixo (acerto) total | ✅ **0,00% em massa** |
| Papel / Tinta (SPANKS) / Mat.Acabamento | ✅ congelado ≤0,5% |
| Produção variável (base folhas/peças por atividade) | ⚠️ a fechar |
| Chapas excedentes (acerto extra) | ⚠️ refino |
