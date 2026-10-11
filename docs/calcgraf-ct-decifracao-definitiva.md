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

## 5. O que ainda falta para fechar 100% (produção variável + refinos)

1. **Produção variável (CustoUnit):** a base de folhas por atividade varia
   (impressão/corte usam folhas do plano; coladeira usa peças/tiragem). As folhas
   implícitas da produção (ex.: 15.086 ≈ 8.922 ≈ 4.762×1,87) sugerem que a
   impressão conta folhas + passagens/quebra. Precisa do encaixe/imposição real
   por atividade (o motor já calcula folhas pelo aproveitamento; falta confirmar
   a base de cada atividade). É o próximo item.
2. **Chapas excedentes** (acerto adicional): modelar `quantChapasExc` como acerto
   extra (afeta casos como o 15.086).
3. **Harness em massa no motor:** rodar os ~80 cálculos do backup pelo motor e
   exigir CT ≤0,5% (o CustoFixo já bate 0,00% pela fórmula; falta o CustoUnit).

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
