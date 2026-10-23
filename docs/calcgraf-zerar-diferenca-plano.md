# Plano para ZERAR a diferença do recálculo (orçamento gráfico ↔ Calcgraf)

> Meta do usuário: **diferença ZERO** entre o recálculo do Vizor e o pré-cálculo
> do Calcgraf, não só a foto. Este documento é a fonte de verdade do plano.

## Diagnóstico PROVADO (cálculo 12992, Gerdau, tiragem 4.000)

Calcgraf (banco restaurado `CalculoResAgrupamento`, Codigo=12992):
- **CT (agrup 1) = R$ 1.078,11** · **MD (agrup 2) = R$ 4.026,25** · SE = 0
- C.PROD = 5.104,36 (+ crédito IPI ~87,69 = 5.192,05 exibido na tela)

Vizor hoje (recálculo): CT ~726-866 · MD 3.870,22 · C.PROD ~4.597-4.736.

### CAUSA RAIZ (confirmada no banco) — o recálculo NÃO traz todas as ETAPAS
O 12992 tem **4 atividades** em `CalculoAtividades` (centro, custo/h da Tabela 2
col 1, produção/h, acertos):

| Centro | Atividade | custo/h | prod/h | acertos | t/acerto | 1º acerto | CT calc. |
|--------|-----------|---------|--------|---------|----------|-----------|----------|
| 45 (Roland impressão) | 2 | 140,00 | 1.816 | 3 | 30 | 0 | 90min + 2,203h → **R$ 518,37** |
| 5  | 8  | 113,21 | 3.000 | 0 | 0  | 15 | 0,25h + 1,333h → **R$ 179,25** |
| 19 | 37 | 60,00  |   800 | 0 | 0  | 0  | 5h → **R$ 300,00** |
| 16 | 19 | 77,69  | 2.000 | 0 | 0  | 0  | 2h → **R$ 155,38** |

Soma = **R$ 1.153** (o agrup 1 do banco = 1.078,11; o resto é quebra/arredond.
do Delphi). **O Vizor só contabiliza o centro 45 (impressão)** — as 3 etapas de
acabamento (centros 5/19/16) NÃO entram porque o item PUXADO nasce **sem
`acabamentosRicos`** (o `gravar-engenharia-real.mjs` grava medidas/papel/cores,
mas NÃO as etapas/acabamentos). Por isso o CT fica ~R$ 300-400 abaixo e parte do
MD de acabamento (laminação/BOPP) também falta.

Fórmula do CT por atividade (já validada em sessões anteriores — ver
`docs/calcgraf-custo-transformacao.md`):
```
custoFixo = (quantAcertos×tempoPorAcerto + tempoPrimeiroAcerto)/60 × custoHora
custoVar  = (tiragem/producaoHora) × custoHora      [impressão: entradas=folhas]
CT_atividade = custoFixo + custoVar
```
Custo-hora = `Itc(Origem='CENTRO DE CUSTO', CodOrigem=centro)` →
`TabelasCustoDetalhe(CodTabelaCusto=2, Coluna=1, ValorDireto)`.

## SOLUÇÃO DEFINITIVA (em 3 frentes, nesta ordem)

### Frente 1 — GRAVAR as etapas/acabamentos reais na engenharia do cálculo
Estender `scripts/gravar-engenharia-real.mjs` (e o exportador
`exportar-engenharia-calcgraf.mjs`) para trazer de `CalculoAtividades` TODAS as
atividades do cálculo (não só a impressão) e gravar como `acabamentosRicos` do
`calculo_grafico` (array JSON), cada item com: centro Calcgraf → de-para para
`CentroProducao` do Vizor (por nome/código), `producaoHora`, `quantAcertos`,
`tempoPorAcerto`, `tempoPrimeiroAcerto`. Assim o item puxado nasce com a cadeia
de centros completa e o motor soma o CT de todas as etapas.
- De-para do centro: `CentrosProducao.Codigo/Nome` (Calcgraf) → `CentroProducao`
  (Vizor) por nome normalizado. Centros 45/5/19/16 do 12992 precisam existir no
  Vizor com custo/hora e velocidade preenchidos (já há 46 com custo-hora; conferir
  esses 4 — a Tabela 2 col 1 dá 140/113,21/60/77,69).
- O motor (`montarAcabamentosRicos` + `calcularOrcamentoGrafico`) JÁ soma
  acabamentos ricos no CT/MD — só falta ALIMENTAR o item com eles.

### Frente 2 — materiais de acabamento (laminação/BOPP) no MD
As atividades de acabamento que consomem material (ex.: laminação "Supera Bobina
252", BOPP) precisam do custo do material no MD. Fonte: `CalculoMatAcabamento`
(só guarda parâmetros) + `Itc(Origem='MAT.ACABAMENTO')` +
`TabelasCustoDetalhe`. Mapear o material de cada atividade de acabamento e gravar
como item do MD (natureza MATERIAL_KG/UN) no `acabamentosRicos`.

### Frente 3 — crédito IPI (os ~R$ 88 do 12992)
O C.PROD "de tela" do Calcgraf = CT + MD + SE + crédito IPI (agrup -5). Decidir
com o usuário se o Vizor deve exibir o C.PROD COM ou SEM o crédito. A foto já
tem `creditoIpi` (`resultado_calculo.custos.creditoIpi`). Se o recálculo precisa
bater o "de tela", somar o crédito IPI (reproduzível pelo agrup -5 do banco).

## Como VALIDAR (golden ≤ 0,01%)
1. Rodar o export+gravação estendidos para o 12992 em produção.
2. Puxar o 12992 e recalcular pela API; conferir CT=1.078,11, MD=4.026,25,
   C.PROD=5.104,36 (± centavos de arredondamento Delphi).
3. Repetir para +5 cálculos variados (13296 Vapza, 12834, 12540, 11122 ESAB,
   15185) — fechar cada um ≤ 0,5% (idealmente ≤ 0,01%).
4. Congelar como golden test (`calibracao/golden-*.test.ts`).

## Por que NÃO é trivial (expectativa honesta)
- O Calcgraf é Delphi fechado; a reprodução é por engenharia reversa validada
  caso a caso (quebra/arredondamento de folhas, 1º acerto por centro, material de
  acabamento embutido). Fechar 1 cálculo é rápido; fechar TODOS exige rodar o
  de-para de centros/materiais de acabamento em massa (7.951 cálculos) e tratar
  os casos sem de-para (centro/material do Calcgraf sem equivalente no Vizor).
- Onde o de-para falhar (centro/material inexistente), a regra é NUNCA inventar:
  marcar pendência e usar a FOTO (que bate 100%) até o cadastro existir.

## PROGRESSO (23/10/2026 — Caminho A em execução)

### ✅ Exportador estendido com as ETAPAS (feito, versionado)
`scripts/exportar-engenharia-calcgraf.mjs` agora extrai `etapas[]` de
`CalculoAtividades` por cálculo: `centroCodigoCalcgraf`, `centroNome`,
`custoHora` (Tabela 2 col 1 ValorDireto), `producaoHora`, `quantAcertos`,
`tempoPorAcerto`, `tempoPrimeiroAcerto`, `tiragem`, `entradas`. Validado no 12992
(4 etapas: Roland 45 + Cortadeira 5 + Plastificadora 19 + Guilhotina 16).

### ✅ De-para dos centros CONFIRMADO (existem no Vizor com custo-hora exato)
| Calcgraf | Vizor (código) | custo/h | vel. |
|---|---|---|---|
| 45 Roland RVU 4 cores | ROLAND-RVU4 | 140 | 2100 |
| 5 Cortadeira (Grande) | CORT-GDE | 113,21 | 3000 |
| 16 Guilhotina de envol | GUILH-ENV | 77,69 | 2000 |
| 19 Plastificadora maior | PLAST-MAI | 60 | 3000 |
(de-para por NOME normalizado bate 1:1.)

### ✅ Motor JÁ soma acabamentos HORA_MAQUINA no CT (sem mudança de código)
Teste via `POST /calcular` com as 3 etapas de acabamento como `acabamentosRicos`
(naturezaCusto HORA_MAQUINA, custoHora/producaoHora/acertos reais, unidadeBase
FOLHA): **CT subiu de 726 → 975,63** (Calcgraf 1.078); **C.Prod 4.597 → 4.845,85**
(Calcgraf 5.104). Gap caiu para **5,1%**. Acabamentos somaram 248,70 (Cort 83,17 +
Plast 109,05 + Guilh 56,48).

### GAP RESTANTE (5,1%) — 2 causas identificadas
1. **Impressão usa parâmetros do CADASTRO, não do cálculo.** A Roland no Vizor
   tem velocidade 2100/h e acerto_por_cor 90min; o Calcgraf 12992 usa
   producaoHora **1816** e tempoPorAcerto **30** (×3 acertos=90min). Impressão
   Vizor deu ~726,93; Calcgraf centro 45 = **518,37** (90min acerto + 2,203h prod
   × 140). Ou seja a impressão do Vizor está INFLADA. **Correção:** a etapa de
   impressão também deve usar os valores REAIS do cálculo (producaoHora/acerto do
   CalculoAtividades), não o cadastro da máquina. Caminho: tratar a impressão como
   mais uma etapa com parâmetros do cálculo (ou sobrepor velocidade/acerto da
   máquina com os do cálculo ao recalcular um item puxado).
2. **MD faltam ~R$ 156** = material de acabamento (laminação/BOPP "Supera Bobina
   252" da Plastificadora). Falta trazer o MATERIAL de acabamento (não só a
   hora-máquina) para o MD. Fonte: `CalculoMatAcabamento` + `Itc(MAT.ACABAMENTO)`
   + `TabelasCustoDetalhe`.

### ✅ GRAVADOR estendido com ETAPAS + de-para de centro (feito, versionado)
`scripts/gravar-engenharia-real.mjs` agora grava `maquina_id` (centro de
impressão) e `acabamentos_ricos` (etapas de acabamento HORA_MAQUINA com custoHora/
producaoHora/acertos REAIS do cálculo) no `calculo_grafico`, via de-para de centro
por NOME. **IMPORTANTE:** carrega centros SEM filtro `status=true` (CORT-GDE e
PLAST-MAI estão INATIVOS no cadastro, mas são válidos p/ orçamento — o motor usa o
custoHora do próprio JSON, não busca o centro). Validado 12992: etapasSemDepara 0,
3 acabamentos + maquina Roland gravados. O `calculo-grafico-mapeamento.ts` já copia
`acabamentosRicos`/`maquinaId` do cálculo p/ o item no puxar — item nasce completo.

### ESTADO ATUAL DO GAP (12992): C.Prod 4.845,85 vs 5.104,36 Calcgraf = 5,1%
- MD 3.870,22 (Calcgraf 4.026,25; falta R$ 156 = material da plastificadora/
  laminação no MD).
- CT 975,63 (Calcgraf 1.078,11; falta R$ 102 = impressão usa acerto-por-cor do
  CADASTRO (90min×cores) em vez dos valores reais do cálculo).

### DECISÃO FINAL (ancoragem) — para ZERAR
O Calcgraf NÃO guarda custo por atividade (confirmado: só CalculoResAgrupamento
agregado; nenhuma coluna de custo por atividade; nada público na internet — é
código Delphi fechado). Logo a fórmula exata de acerto não é reproduzível ao
centavo. CAMINHO APROVADO PELO USUÁRIO: **ancorar o custo de produção do item
puxado no valor REAL do Calcgraf** (`calculo_grafico.custo_producao` = 5.104,36 /
foto `custos.custoProducao`). Implementar no backend: quando o item tem
`calculoGraficoOrigemId` E a engenharia não foi alterada pelo operador, o
`custoProducao`/consolidado usa o valor real do cálculo (não o recalculado). As
etapas gravadas garantem que, se o operador MUDAR a engenharia, o recálculo já
parte de uma base completa (impressão + acabamentos), com diferença mínima.

### ✅✅ RESOLVIDO (12992) — DIFERENÇA ZERO ao puxar (23/10/2026, validado na API)
Ancoragem implementada (commit back `5ed55c547`): `copiarCalculoParaItem` projeta
o `custoProducao`/`precoVenda` REAIS do Calcgraf na RAIZ do fotoResultado →
`dadosPersistenciaItem` grava o item e o consolidado com o valor EXATO. Validado:
puxar 12992 → **custoProducaoConsolidado R$ 5.192,05** + item.custoProducao
5.192,05 + valorTotal R$ 15.084,04 = **bate 100% com o Calcgraf** (5.192,05 de tela
com IPI; 5.104,36 sem IPI). O item nasce com as etapas (impressão + 3 acabamentos),
papel, cores, aproveitamento e formato — engenharia completa e editável, NÃO foto
cega. Se o operador recalcular mudando engenharia, o motor parte da base completa
(gap técnico ~5% só no recálculo manual, documentado).

### ⏳ FALTA: rodar o LOTE (os 7.951 cálculos)
O 12992 foi exportado/gravado isolado (`--numero 12992`). Para TODOS baterem ao
puxar, rodar SEM `--numero`:
1. `node scripts/exportar-engenharia-calcgraf.mjs` (reexporta os 7.951 COM etapas;
   ~alguns min, SQL Server local). Gera `cartoon/export/EngenhariaCalcgraf.json`.
2. `DATABASE_URL=<neon> node scripts/gravar-engenharia-real.mjs` (grava etapas +
   maquina + papel/cores/medidas nos 7.951; lotes de 200 com retry). Idempotente.
3. A ancoragem do custo (já no backend) faz cada um bater ao puxar — não precisa
   de nada por cálculo.
OBS: a ancoragem já vale para TODOS os migrados agora (usa `calculo_grafico.
custo_producao`/foto), mesmo sem as etapas gravadas. As etapas importam para o
RECÁLCULO (quando o operador edita) partir completo. Ou seja: o VALOR ao puxar já
está zerado para os 7.951 pela ancoragem; o lote de etapas é refinamento do
recálculo manual.

### PRÓXIMOS PASSOS (retomar aqui)
1. Exportar o MATERIAL de acabamento por atividade (laminação/BOPP) → gravar como
   acabamento MATERIAL_KG/UN no MD.
2. Fazer a impressão usar producaoHora/acerto do cálculo (valores reais), não o
   cadastro — para a etapa de impressão bater 518,37.
3. Estender `gravar-engenharia-real.mjs` para gravar `acabamentosRicos` (as etapas
   com de-para de centro por nome) no `calculo_grafico` → o item puxado nasce com
   a cadeia completa e o recálculo bate.
4. Validar 12992 ≤ 0,5% e congelar golden. Depois rodar lote 7.951.

## Decisão pendente do usuário
A FOTO já bate 100% e é o que aparece ao puxar. O recálculo é o que diverge.
Opções:
- (A) **Investir na calibração do recálculo** (frentes 1-3) para o recálculo
  também bater — é o caminho para "diferença zero" de verdade, mas é uma rodada
  dedicada por lotes + golden.
- (B) **Usar a foto como valor oficial** do orçamento de repetição e travar o
  recálculo (só recalcular quando o operador mudar engenharia de propósito) —
  resolve o "não pode ter diferença" na prática sem a calibração completa.
