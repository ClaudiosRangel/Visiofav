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

## 2. O ponto que FALTA fechar com exatidão: o tempo FIXO (acerto) da IMPRESSÃO

A fórmula é `tempoFixoImpressao = cores × acertoPorCorMin + tempoPrimeiroAcerto`,
POR LINHA de impressão (um cálculo pode ter 2 linhas — tira-retira/2 planos).

O problema: **`acertoPorCorMin` é um parâmetro da MÁQUINA que vive no cadastro do
Delphi (NÃO é exportado em nenhuma tabela do backup).** Reconstruindo-o a partir
do `CustoFixo` real (CalculoResAgrupamento) de 4 cálculos, obtém-se:

| Cálculo | Centro impr. | cores | linhas impr. | fixoImpr (min) | acerto/cor inferido |
|---|---|---|---|---|---|
| 15190 | 2 (CD 5c) | 4 | 1 | 100,0 | **25,0** ✅ |
| 15196 | 2 (CD 5c) | 5 | 1 | 175,0 | 35,0 (⚠️ override quantAcertos=15) |
| 15185 | 2 (CD 5c) | 4+4 | 2 | 338,9 | ~42 (2 linhas, ruído) |
| 15086 | 46 (CD 7c) | 5 | 1 | 310,0 | **56,0** |

Conclusões:
- **Centro 2 (CD 5 cores) = 25 min/cor** (confirmado pelo 15190, caso limpo).
- **Centro 46 (CD 7 cores) = 56 min/cor** (do 15086 limpo).
- 15196 é o caso ATÍPICO (operador fixou `quantAcertos=15` manualmente — o doc de
  CT já o marcou como exceção; não segue a regra por-cor).
- 15185 tem 2 linhas de impressão; o fixo é a soma das 2 (precisa separar por
  linha — a memória de cálculo mostra isso explicitamente).

### Erro corrigido nesta investigação (importante)
A calibração anterior do 15.086 usou `acertoPorCorMin=18` + um `fatorOperacao`
de folhas-equivalentes (3,53) para a produção. Isso batia o TOTAL da impressão,
mas **com a decomposição errada** (acerto subestimado, produção inflada). O certo
é `acertoPorCorMin=56` para o centro 46 e produção por folhas reais — sem fator
mágico. O `fatorOperacao` foi uma muleta; a regra real é o acerto-por-cor por
máquina + folhas reais.

## 3. Por que precisamos do cadastro de máquinas do Calcgraf (ou da memória)

Para o Vizor GERAR um orçamento novo que bata com o Calcgraf em QUALQUER produto/
máquina, precisamos do **`acertoPorCorMin` de CADA máquina de impressão** (e, por
simetria, confirmar o acerto de cada acabamento). Esses parâmetros estão no
cadastro do Delphi, acessível por:

1. **RDP no Calcgraf** (o cliente dá acesso): abrir o cadastro de cada centro de
   produção / máquina e anotar o "tempo de acerto por cor" (e tempos de acerto
   dos acabamentos). É a fonte DEFINITIVA — vira campo no cadastro de Centro do
   Vizor (já temos `acertoPorCorMin` no schema).
2. **Memória de cálculo (pré-cálculo PDF)** de ~5 cálculos variados: mostra o
   tempo de acerto de cada atividade em HH:MM, de onde se lê o acerto/cor direto
   (foi assim que o 15185 foi decifrado). Rápido e sem risco.

Com qualquer uma das duas, preenchemos uma tabela `acertoPorCorMin` por máquina e
o CT fecha EXATO para todos — sem calibração caso a caso.

## 4. Plano para "bater sempre" (recomendado)

1. **Coletar o `acertoPorCorMin` real por máquina de impressão** (RDP ou memória).
   Já sabemos: CD 5c=25, CD 7c=56. Faltam as demais máquinas que o cliente usa.
2. **Cadastrar no Vizor** (`CentroProducao.acertoPorCorMin`) — o motor já consome.
3. **REMOVER o `fatorOperacao`** da impressão/acabamentos (muleta) e usar folhas
   reais na produção. Manter `fatorOperacao` só se alguma atividade comprovar
   folhas-equivalentes reais (ex.: tira-retira = 2 passagens).
4. **Harness de validação em massa:** rodar os ~53 cálculos do backup pelo motor e
   exigir CT/MD ≤0,5% em todos (não só golden). Hoje o doc de CT já valida o
   CustoFixo em 52/53 pela fórmula de acerto — portar essa validação para o motor.
5. **Seed dos golden** (15.086 já; 15.196/15.190 após coletar o acerto/cor do
   centro 2=25, que já temos) com os parâmetros reais, sem muletas.

## 5. O que consigo fazer AGORA sem novos dados

- 15.190 (centro 2, 25 min/cor, caso limpo): tenho tudo para calibrar ≤0,5%.
- 15.196: só com a ressalva do override manual de acertos (reproduzir o override).
- Reescrever o 15.086 com acerto/cor=56 (centro 46) e folhas reais, removendo o
  `fatorOperacao` — decomposição correta, mesmo total.

## 6. Decisão pedida ao cliente/usuário
Para fechar DEFINITIVO e com garantia: **conseguir o "tempo de acerto por cor" de
cada máquina de impressão do Calcgraf** (RDP ou 3-5 memórias de cálculo). É o
único dado que falta e não está no backup. Com ele, o CT bate exato em qualquer
orçamento, e os orçamentistas verão Vizor = Calcgraf.
