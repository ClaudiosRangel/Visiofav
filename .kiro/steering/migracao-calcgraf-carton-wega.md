# Migração Calcgraf/G-Print → Vizor (Carton Wega) — continuidade entre sessões

Este arquivo é carregado em toda sessão neste workspace para que NENHUMA sessão
se perca no projeto de migrar a Carton Wega do Calcgraf/G-Print (PHTech) para o
Vizor. Leia os documentos-mestre abaixo antes de agir neste tema.

## Documentos-mestre (fonte de verdade)

- Levantamento completo do Calcgraf: #[[file:docs/calcgraf-gprint-levantamento.md]]
- Plano de ação (blocos/prioridade/calibração): #[[file:docs/calcgraf-plano-de-acao.md]]
- Estudo de migração TOTAL + impacto de produtos: #[[file:docs/estudo-migracao-total-calcgraf.md]]
- Mapeamento de importação (schema real): #[[file:docs/calcgraf-mapeamento-importacao.md]]

## 🟢🟢 DIFERENÇA ZERO AO PUXAR CÁLCULO — RESOLVIDO DEFINITIVO (23/10/2026)

**O orçamento de repetição ("Puxar Cálculo") agora bate 100% com o Calcgraf, para
TODOS os 7.951 cálculos migrados.** Validado na API em 4 cálculos (12992 5.192,05;
13296 357,14; 11122 60.407,80; 12540 9.236,32) — todos idênticos ao Calcgraf.

### Como foi resolvido (ancoragem no valor real)
O Calcgraf NÃO guarda custo por atividade (só `CalculoResAgrupamento` agregado; a
fórmula de acerto é Delphi fechado, irreprodutível ao centavo; nada público na
internet). Então o recálculo do motor fica ~5% abaixo. Decisão (aprovada pelo
usuário): **ancorar o custo de produção do item puxado no valor REAL do Calcgraf**,
que está gravado em `calculo_grafico.custo_producao` + `resultado_calculo.custos.
custoProducao` (foto). Commit `5ed55c547`:
- `copiarCalculoParaItem` (orcamento-grafico.routes.ts) projeta `custoProducao`/
  `precoVenda` reais na RAIZ do `fotoResultado` → `dadosPersistenciaItem` grava o
  item e o consolidado com o valor EXATO. Vale para TODOS os migrados (usa o dado
  real de cada um) — não precisa de nada por cálculo.
- O item nasce com engenharia COMPLETA e editável (não foto cega): papel, cores,
  medidas, aproveitamento, formato de corte + ETAPAS (impressão via `maquina_id` +
  acabamentos via `acabamentos_ricos`), gravadas por `gravar-engenharia-real.mjs`
  (de-para de centro por nome, SEM filtro status — CORT-GDE/PLAST-MAI estão
  inativos mas válidos). Só o 12992 teve etapas gravadas até agora; o LOTE dos
  7.951 (export+grava sem `--numero`) é refinamento do RECÁLCULO manual — o VALOR
  ao puxar já está zerado para todos pela ancoragem.
- Plano/decomposição completa em `docs/calcgraf-zerar-diferenca-plano.md`.

### Ancoragem nos 3 momentos (chamar/editar/salvar) — VALIDADO (commit back `ca085f1c3`, front `59708cc`)
O usuário mostrou que ao SALVAR o item o valor caía de 5.192 → 4.845 (o recálculo
do motor sobrescrevia a âncora). RESOLVIDO: helper `ancorarCustoCalcgraf(empresaId,
itemId, resultado)` projeta o custoProducao/precoVenda REAIS do cálculo-origem
(`calculoGraficoOrigemId` → `calculo_grafico.custo_producao`/foto) na RAIZ do
`resultado` ANTES de gravar, aplicado em `PUT /:id/itens/:itemId` (salvar) e
`POST /:id/itens/:itemId/calcular` (editar/prévia). O front (`StepRevisao`) na
EDIÇÃO de item puxado chama a rota do ITEM (ancorada), não a `/calcular` genérica.
Validado na API (12992): CHAMAR 5.192,05 · EDITAR 5.192,05 · SALVAR 5.192,05 —
os 3 batem. Só recalcula pelo motor (e diverge ~5%) se o item NÃO tiver origem de
cálculo (orçamento novo do zero) OU se o cálculo-origem sumir.

### Limite técnico documentado (não é problema do fluxo de repetição)
Se o operador criar um orçamento do ZERO (sem puxar cálculo), não há âncora e o
motor calcula ~5% abaixo do que o Calcgraf daria (impressão usa acerto-por-cor do
cadastro; falta material de acabamento no MD). Fechar os centavos do recálculo puro
exigiria o fonte Delphi (indisponível). Para repetição (o caso real da Wega) a
diferença é ZERO.

## 🟢 PUXAR CÁLCULO — PREÇO DO PAPEL + VALOR IMEDIATO + CÁLCULO DE ORIGEM (23/10/2026)

Três correções que fecharam as queixas do usuário no fluxo pela TELA (a API já
batia; o front divergia):

1. **Preço do papel errado pela tela (causa raiz do "pela API bate, pela tela
   não").** O wizard do front NÃO carrega o preço real do papel puxado (cai no
   fallback 4,5/kg) → papel saía R$ 2.162 (4,5×480kg) em vez de R$ 3.579 (7,45×480)
   → Custo Produção despencava p/ R$ 3.319. **Fix (commit `51ca5af0a`):**
   `preservarEngenhariaDoItem` agora, quando o body tem `papelId`, busca
   `PrecoMateriaPrima.precoUnitario` do CADASTRO e sobrescreve `body.precoKg`
   (cadastro = fonte de verdade do preço do papel). Validado e2e (limpar banco →
   puxar 12992 → PUT como o front com precoKg 4,5): papel voltou R$ 3.579,47,
   consolidado R$ 4.526,85.

2. **Valor só aparecia ao SALVAR o item** (ao puxar, cabeçalho nascia R$ 0,00).
   Causa: a foto copiada (`copiarCalculoParaItem`) não tem o resultado estruturado
   do motor Vizor (só a foto de valores do Calcgraf), então o consolidado nascia 0.
   **Fix (commit `1478e0367`):** o `POST /de-calculo`, após criar o item, RECALCULA
   pelo motor (com engenharia preservada) e grava resultado+consolidado, e recarrega
   o orçamento no 201. Agora o Custo de Produção aparece IMEDIATAMENTE ao puxar.

3. **"Informar o cálculo utilizado no orçamento"** (pedido do usuário). O item já
   gravava `calculoGraficoOrigemId`; o `GET /:id` agora resolve o número
   (`numeroCalcgraf ?? numero`) de cada item e devolve `calculoOrigem` no cabeçalho.
   Front (`[id]/page.tsx`, commit front `a68233e`) exibe "Cálculo utilizado: nº 12992"
   em Dados Comerciais. Confirmado na tela pelo usuário.

### StepRevisão da prévia divergia do salvo — CORRIGIDO (commit back `8cc1e16cc`, front `c6082de`)
O StepRevisão (prévia no wizard de item) mostrava um valor MENOR que o cabeçalho
(ex.: R$ 3.585 vs R$ 4.736) porque a rota `POST /orcamento-grafico/calcular`
(prévia, SEM itemId) NÃO resolvia o preço do papel pelo cadastro nem recebia o
formato de corte — ela usava o `precoKg` 4,5 do fallback do front e a folha da
máquina. **Fix:** (1) `/calcular` agora resolve `precoKg` do cadastro
(`PrecoMateriaPrima.precoUnitario`) quando há `papelId`; (2) aceita
`formatoCorteLarguraMm/AlturaMm` (precedência sobre a folha da máquina); (3) o
StepRevisão envia esses campos do formData. Validado: prévia do 12992 agora dá
papel R$ 3.579,47, aprov 3/1334 folhas, custoProducao ~R$ 4.597 (antes R$ 3.585).
A regra do preço do papel pelo cadastro está agora em TRÊS pontos:
`preservarEngenhariaDoItem` (PUT/calcular do item) + `/calcular` (prévia) +
nascimento via foto no `de-calculo`.

### Diferença residual de 8,8% — DECOMPOSTA do banco Calcgraf (12992, tiragem 4.000)
`CalculoResAgrupamento` (Codigo=12992) — fonte de verdade do Calcgraf:
- **Agrup 1 (Custo Transformação):** fixo 658,30 + unit 0,10495×4000 = **R$ 1.078,11**.
- **Agrup 2 (Material Direto):** fixo 362,00 + unit 0,91606×4000 = **R$ 4.026,25**.
- **C.PROD = 5.104,36** (o R$ 5.192,05 da tela inclui crédito IPI ~87).
Vizor hoje: CT **866,58** (−211) + MD **3.870,22** (−156) = **4.736,80**.
- **MD −R$ 156:** material de acabamento (laminação/BOPP "Supera Bobina 252") que o
  item puxado ainda NÃO traz como item do MD. O `CalculoMatAcabamento` só guarda
  parâmetros (CodMaterial/codAtvAcabamento), não o valor — o valor está embutido no
  agrup 2. Para fechar: mapear o acabamento do cálculo → `acabamentosRicos`/item
  diverso com o custo real.
- **CT −R$ 211:** tempo de máquina/acerto (setup por cor) do 12992 não está sendo
  totalmente reproduzido pelo motor. Precisa conferir acerto-por-cor da máquina do
  cálculo vs cadastro do Vizor.
- **Calibração fina dos 8,8% = rodada dedicada** (mapear acabamentos + acerto). NÃO
  é bug de propagação (papel/aproveitamento/formato batem 100%). Fazer só quando o
  usuário priorizar.

## 🟢 PUXAR CÁLCULO — RECÁLCULO AO SALVAR ITEM PRESERVA ENGENHARIA (23/10/2026, VALIDADO NA API)

**VALIDADO em produção (API `api.vizorerp.com.br`, cálculo 12992):** o fluxo
completo "Puxar Cálculo → abrir item → Salvar/Recalcular" agora PRESERVA formato
de corte e aproveitamento mesmo quando o wizard NÃO reenvia esses campos no body.
Último bug da cadeia: o `ItemWizardModal`/`novo` do front não coleta
`formatoCorteLarguraMm/AlturaMm` nem `aproveitamentoManual`, então ao Salvar Item
o backend regravava `null` e o motor caía no encaixe geométrico (4 peças/folha).
**Fix (commit `7ce8e3050`):** `preservarEngenhariaDoItem(body, itemId)` completa o
body com os valores já persistidos (via SQL raw) ANTES de calcular, nas rotas
`POST /:id/itens/:itemId/calcular` e `PUT /:id/itens/:itemId`; depois regrava
formato/aproveitamento no update. Resultado medido ao recalcular 12992 SEM enviar
esses campos (simulando o wizard):
- ENCAIXE aproveitamento = **3** (não mais 4 geométrico); folhas = **1.334**.
- Formato de corte preservado = **650×1225** (plano do Calcgraf, não a máquina).
- Papel = **R$ 3.579,47** (480,465 kg × 7,45) — **bate 100%** com o Calcgraf.
- MD = R$ 3.870,22 · CT = R$ 866,58 · **Custo Produção = R$ 4.736,80** vs
  **R$ 5.192,05** do Calcgraf = **8,8% de desvio** (de −82% → −31% → −8,8%).
- **Resíduo de 8,8% (calibração fina, só se o usuário pedir):** laminação/BOPP
  "Supera Bobina 252" (~R$ 156) não entra no MD; tempo de máquina/acerto (~R$ 211)
  no CT. Não é bug de propagação — é componente de engenharia que o item puxado
  ainda não traz.
- Orçamentos de teste da Wega foram LIMPOS após a validação
  (`scripts/limpar-orcamentos-wega.mjs`).

## 🟢 ENGENHARIA REAL DO "PUXAR CÁLCULO" — RESOLVIDO (23/10/2026) — LER ANTES DE MEXER

**Contexto do problema (que se arrastou por sessões):** ao "Puxar Cálculo" na
Biblioteca, o item nascia com campos VAZIOS (medidas, papel, cores sem preço),
porque a migração em lote gravou só a **FOTO** (`resultado_calculo` — valores
finais que batem 100%), e NÃO a engenharia estruturada (colunas do
`calculo_grafico`: medidas/aproveitamento/papel/cores). O usuário cobrou, com
razão, DADOS REAIS, não foto. **Resolvido: os dados concretos do Calcgraf foram
EXTRAÍDOS do banco restaurado e GRAVADOS nas colunas do Vizor.**

### O Calcgraf TEM tudo (confirmado no banco restaurado `CalcgrafCartonWega`)
Validado no cálculo 12992 (Gerdau, "Rótulo p/ farpado GIR 500M"):
- `CalculoPlanos`: `dimensao1/dimensao2` (medida do produto, ex. 190×1200 mm),
  `aproveitamento` (peças/folha, ex. 3), `ocorrencias`, `formSuporte` (formato da
  folha "650 x 1225"), `gramatura` (415), `codSuporte`, `CodFaca`.
  → nome/preço do suporte: `Itc` (Origem='SUPORTE', `CodOrigem`=codSuporte,
  casar por `Gramatura`) + `TabelasCustoDetalhe` (Coluna=1 → preço R$/kg).
  Ex.: "Stora Enzo Bobina 415" = R$ 7,45/kg.
- `CalculoTintas`: `codTinta`, `areaTinta` (cobertura %), `ComplementoNome` (nome
  real da cor). → preço R$/kg: `Itc` (Origem='TINTA', `CodOrigem`=codTinta) +
  `TabelasCustoDetalhe` (Coluna=1). Ex. 12992: Pantone 01 R$71,50 / Pantone 02
  R$99,00 / Pantone 03 R$170,50.
- **Acesso ao SQL Server local:** `sqlcmd -S localhost -E -C -d CalcgrafCartonWega`
  (`-C` OBRIGATÓRIO p/ trust do cert; `-u` p/ acentos UTF-16→UTF-8 em exports).

### Scripts criados (versionados, reexecutáveis, idempotentes)
1. **`scripts/exportar-engenharia-calcgraf.mjs`** (SOMENTE LEITURA do SQL Server
   local) → `cartoon/export/EngenhariaCalcgraf.json`. Extrai por cálculo (maior
   `Codigo` por `NumCalculo` não cancelado): planos (medidas/aproveitamento/
   formato/gramatura/suporteNome/suportePrecoKg/codFaca) + tintas (nome/cobertura/
   precoKg). `--numero N` para um só. Usa `FOR JSON PATH` + UTF-16→UTF-8.
2. **`scripts/gravar-engenharia-real.mjs`** (grava no Neon de produção via `pg`)
   → lê o JSON acima e grava nas COLUNAS do `calculo_grafico`: `medidas`
   (`{largura,altura}` do produto), `aproveitamento_manual`, `gramatura`,
   `papel_id`/`suporte_id`/`papel_descricao` (de-para papel por suporte+gramatura,
   match único), `cores` (nome+cobertura+**precoKg REAL**+rendimentoM2Kg=25 padrão
   editável+tipo CMYK/PANTONE), `num_cores`. Idempotente, transações em lote (200),
   retry ECONNRESET. `--dry-run` / `--numero N`. **NÃO** toca a foto.

### ESTADO EM PRODUÇÃO (Wega `75848e24-...`) — 7.951 cálculos
Executado 23/10/2026. Dados REAIS gravados nas colunas (não foto):
- **Medidas (largura×altura do produto): 100%** (7.951)
- **Cores com preço R$/kg real: 100%** (7.951)
- **Papel + gramatura: 66%** (5.279) — os 34% restantes são papéis cuja gramatura
  específica NÃO existe no cadastro `preco_materia_prima` do Vizor (não inventar).
- **Aproveitamento (peças/folha): 54%** (4.262).
- Máquina 12% (934); Cliente por CNPJ 32 (código do Calcgraf cobre o resto no puxar).

### ⚠️ DUPLICATAS no cadastro de PAPEL (derruba parte dos 34%)
Há papéis duplicados no `preco_materia_prima` (ex.: DOIS "Stora Enzo Bobina 415",
um com `gramatura=null` e outro com `415`). O match exato por nome vira AMBÍGUO
(2 candidatos → não casa) e cai na 2ª estratégia (nome+gramatura). Limpar as
duplicatas (manter a com gramatura preenchida) subiria o papel bem acima de 66%.
PENDENTE — tratar com cuidado (é cadastro de produção usado pelo motor de preço).

### ⚠️ BUG CRÍTICO ENCONTRADO E CORRIGIDO (23/10) — medidas L/A
Ao validar o 12992 na tela, o recálculo deu custo R$937 (vs R$5.104 do Calcgraf)
— divergência brutal. CAUSA (investigada): as fórmulas dos `TipoEmbalagem` 2D do
Vizor usam as variáveis **`L` (largura) e `A` (altura)**, mas o gravador estava
gravando `medidas` só como `{largura, altura}`. Como `L`/`A` existem com
`default 0`, `avaliarFormula` NÃO erra — usa 0 → planificação ≈ 0 → `calcularEncaixe`
"cabe" 7665 peças/folha (73×105, 97%) → consumo de papel ZERA (R$114 vs R$4026).
CORREÇÃO (`gravar-engenharia-real.mjs`): gravar `medidas` com AMBAS as convenções
`{L, A, largura, altura}`. O motor PRESERVA o `aproveitamentoManual>0` (sobrepõe o
encaixe), mas só ~54% dos migrados têm aproveitamento — por isso a medida correta
é essencial para os 46% sem aproveitamento. REPROCESSADO os 7.951 em produção.
LIÇÃO: ao gravar `medidas` de qualquer cálculo, usar as MESMAS variáveis que a
fórmula do TipoEmbalagem referencia (L/A para 2D; L/A/P para 3D), senão o encaixe
explode silenciosamente.

### ⚠️ BUG 2 — aproveitamentoManual não voltava no GET /:id (corrigido 23/10)
Validação do 12992 (2ª rodada): com as medidas L/A corretas, o encaixe deixou de
ser absurdo (4×1=4 peças/folha) mas AINDA usava o encaixe GEOMÉTRICO (4) em vez
do aproveitamento REAL do Calcgraf (3). Custo caiu de R$5.104 p/ R$3.585 (-30%),
ainda divergindo. CAUSA: o `select` dos itens em `GET /orcamento-grafico/:id`
(orcamento-grafico.routes.ts ~linha 2385) NÃO incluía `aproveitamentoManual`.
O item puxado voltava sem o campo → `itemParaForm` recebia null → o recálculo não
mandava o aproveitamento → o motor caía no encaixe geométrico. CORRIGIDO: add
`aproveitamentoManual: true` ao select (back `08bc1ff3d`). O campo já existia em
`ItemParaEditar`/`itemParaForm` e no motor (`params.aproveitamentoManual>0`
sobrepõe o encaixe) — só faltava a API devolvê-lo. LIÇÃO: ao adicionar um campo
de engenharia que o motor usa, conferir TODOS os selects que hidratam a tela
(GET /:id, GET item, etc.), senão o recálculo ignora silenciosamente.

### ⚠️ BUG 3 — formato de folha da MÁQUINA ≠ do PLANO (corrigido 23/10)
Conferência do 12992: Material Direto Vizor R$2.644 vs Calcgraf R$4.026 (−34%).
CAUSA (achada no banco): o motor (`calcularOrcamentoGrafico`) usa
`maquinaImpressao.formatoLargura/Altura` (formato de folha CADASTRADO NA MÁQUINA,
ex.: Roland RVU4 = 900×1260) para encaixe/papel/tinta. Mas o Calcgraf usa o
formato do PLANO (`CalculoPlanos.formSuporte`, ex.: **650×1225** — a bobina
cortada real). Com a folha MAIOR, o Vizor calcula MENOS folhas → menos peso de
papel → MD menor. CORREÇÃO: `montarParamsDoItem` (orcamento-grafico-item.service)
agora prioriza `input.formatoCorteLarguraMm/AlturaMm` (formato do plano) sobre o
da máquina; o `gravar-engenharia-real.mjs` parseia `plano.formatoFolha`
("650 x 1225") e grava em `formato_corte_largura_mm/altura_mm`. Reprocessado:
99,1% dos 7.951 com formato de folha real. Conta manual do 12992: ~1.451 folhas
× 0,650×1,225×415g = ~480 kg × 7,45 = ~R$3.574 de papel + tinta ≈ R$4.026 (bate).
Back `8e5e8ed26`. LIÇÃO: no orçamento gráfico o formato de folha que importa é o
do PLANO/corte (bobina real), NÃO o genérico da máquina.

### Regra de ouro deste mecanismo
- A **FOTO** (`resultado_calculo`) continua IMUTÁVEL e é a referência de
  conferência (C.PROD/valores batem 100%). A **engenharia** (colunas) é o que o
  operador edita/recalcula. NUNCA inventar: de-para 0/2+ → campo fica vazio.
- Para RE-RODAR: export local (`exportar-engenharia-calcgraf.mjs`) → `DATABASE_URL`
  do Neon no env → `gravar-engenharia-real.mjs`. NÃO toca PCP.
- **Cor = entrada manual/editável** no orçamento; agora vem com PREÇO real do
  Calcgraf (antes vinha 0, o que travava a Revisão com "rendimentoM2Kg > 0").
  `copiarCalculoParaItem` (orcamento-grafico.routes.ts) saneia rendimento 0→25.

### Para VALIDAR na tela (após deploy)
Puxar o cálculo DE NOVO (orçamentos criados ANTES desta gravação não pegam os
dados novos — o item é cópia do momento). Ex.: nº Calcgraf 12992 (Gerdau) →
nasce com medida 190×1200, aproveitamento 3, papel Stora Enzo Bobina 415, 3 cores
com preço. Bons para teste: 12992, 13296 (Vapza), 12834, 12540, 11122 (ESAB).

## 🗺️ ROADMAP — próximos passos do orçamento gráfico (priorizado 21/10/2026)

Decisão do usuário: fazer AGORA só o item 1; os demais ficam para depois.

1. **[✅ ENTREGUE + COMMITADO/no ar 22/10/2026] "Puxar cálculo" no Novo Orçamento**
   (igual "Localiza o Cálculo Padrão" do Calcgraf). Spec
   `orcamento-puxar-calculo-biblioteca` (requirements+design+tasks). Núcleo
   funcional completo; property tests opcionais (3.1–3.9) ficaram pendentes.
   Commits: back `35b908071`, front `df3da5b`. **Correção aplicada 22/10**: erro
   de validação ao recalcular/salvar item agora SINALIZA o campo faltante/errado
   (handler Zod global compõe "Dados inválidos — campo: motivo", `StepRevisao`
   lista os issues) em vez do genérico "Dados inválidos" — back `0f4d47116`,
   front `973fa25`.
   - **Backend** (`orcamento-grafico.routes.ts`): helper ÚNICO
     `copiarCalculoParaItem(calc, novaQuantidade?)` (reúsa `registroParaEngenharia`
     →`calculoParaItemBody`→`dadosPersistenciaItem`, cópia da foto SEM recálculo) —
     o handler existente `/:id/itens/de-calculo` foi refatorado para usá-lo (fonte
     única). Rota NOVA atômica `POST /api/orcamento-grafico/de-calculo` (body
     `{calculoId, novaQuantidade?}`): numa `$transaction` cria OrcamentoGrafico
     RASCUNHO (herda cliente/tipoEmbalagem/medidas/quantidade; número max+1 por
     empresa) + ItemOrcamentoGrafico copiado da foto + `calculoGraficoOrigemId`;
     201 com o orçamento; 404 inexistente / 403 outra empresa / 409 colisão (P2002,
     reverte item junto — nunca orçamento órfão). empresaId EXPLÍCITO. Sem schema/
     migração.
   - **Frontend**: `BuscaCalculoModal` ganhou `orcamentoId` OPCIONAL + `onCriado`
     (modo criação chama a rota nova e redireciona); botão "Puxar Cálculo"
     (variant light, IconListSearch) ao lado de "Novo Orçamento" na lista
     (`orcamento-grafico/page.tsx`) → abre o modal em modo criação → no onCriado
     navega para `/orcamento-grafico/:id`. "Novo Orçamento" em branco preservado.
   - get_diagnostics limpo nos 3 arquivos. Validar com o usuário na tela.

2. **[ROADMAP] Histórico e reversão de Custo-Hora dos Centros.** Hoje atualizar o
   custo-hora (edição manual OU botão "Aplicar ao Orçamento" do Mapa de Custos)
   faz UPDATE direto em `CentroProducao.custoHora` e PERDE o valor anterior — não
   há como voltar. Criar tabela `HistoricoCustoHoraCentro` (centro, valor
   anterior, valor novo, origem = "Mapa <competência>" | "manual", usuário, data),
   gravar em TODA mudança (edição + aplicar-orçamento), tela de histórico por
   centro + botão "Reverter para este valor". Padrão igual `LogLeituraContador`.
   NOTA: reverter o custo-hora só afeta cálculos NOVOS/recalculados; fotos de
   orçamentos salvos ficam congeladas (correto). O motor do orçamento LÊ
   `CentroProducao.custoHora/velocidade/acerto` (confirmado em
   `orcamento-grafico-item.service.ts`), então o custo-hora influencia DIRETO o
   preço. (Renomear o botão "Aplicar ao Orçamento" → "Publicar Custo-Hora" é
   cosmético, pode entrar junto.)

3. **[ROADMAP] "Criar cálculo novo no ato" dentro do Novo Orçamento**: abrir o
   wizard de engenharia (medidas→papel→cores/máquina→acabamentos) já no ponto de
   criação do orçamento, calculando e salvando como cálculo + item de uma vez.
   O wizard `/novo` já existe; falta integrar ao ponto de criação. Fica para
   depois do item 1.

4. **[ROADMAP] Camada 2 — Conferência foto × recálculo (anti-vergonha)**: ao
   reaproveitar um cálculo migrado num orçamento, exibir colunas Calcgraf (foto)
   × Vizor (recalc) + desvio por componente; ≤0,5% verde, senão alerta. Tasks 7
   da spec `calculo-grafico-foto-rica`.

5. **[ROADMAP] Botão Imprimir/PDF da foto rica** (Task 4.2 de `calculo-grafico-foto-rica`).

## 🟡 ORÇAMENTO DE REPETIÇÃO + ENGENHARIA COMPLETA (22/10/2026 — EM ANDAMENTO, NÃO commitado)

Spec `.kiro/specs/orcamento-repeticao-engenharia-completa/` (requirements+design+
tasks). Estudo de mercado em `docs/estudo-reaproveitamento-calculo-repeticao.md`
(Sage/Certinia/Printavo/CERM + Calcgraf: puxar cálculo = cópia COMPLETA editável;
repetição é tipo de 1ª classe). Caminho escolhido: **(b) enriquecimento sob
demanda no puxar + (c) lote prioritário** dos 366 produtos que mais repetem em
2026 (56 com 5+, 310 com 2–4; 1.022 só 1x). Cliente no cálculo quase sempre
ausente (só 32/7951 têm doc; agrupa por PRODUTO, não cliente).

**DE-PARA DO CLIENTE (confirmado): por CNPJ normalizado, NÃO por código.** O Vizor
NÃO guarda o código do Calcgraf; o vínculo é `clienteDoc` (só dígitos) ×
`cliente.cpf_cnpj` (só dígitos). Testado 8/8 e 5/5 em produção → 100%.

**FEITO (backend + produção, NÃO commitado):**
- Schema (`schema.prisma`+`migrate-prod.ts`, aditivo idempotente): `OrcamentoGrafico.tipo`
  (NOVO|REPETICAO, default NOVO); `CalculoGrafico.engenhariaCompleta`/`engenhariaPendentes`/
  `clienteDoc`/`clienteCodigo`. As 5 colunas JÁ aplicadas em produção (via `pg`).
- `foto-rica.types.ts`: `cabecalho.clienteDoc`/`clienteCodigo`.
- Exportador `exportar-calculos-acervo-rico.mjs`: inclui `n.CNPJCPF`→clienteDoc e
  `h.CodNome`→clienteCodigo (nível raiz + cabeçalho). RE-EXPORTADO + RE-GRAVADO os
  **7.951 em produção** via `scripts/gravar-foto-rica.mjs` (idempotente, com retry
  p/ ECONNRESET do pooler; foto imutável, só acrescenta doc/código). 32 com doc,
  todos casam com cliente do Vizor por CNPJ.
- `enriquecimento-engenharia.service.ts` (novo): de-para por nome normalizado
  (papel/suporte/gramatura/cores/acabamentos/máquina) + cliente por CNPJ; 0 ou 2+
  candidatos → PENDENTE (nunca inventa); NÃO toca a foto; empresaId explícito.
- `calculo-grafico.service.ts`: `garantirEngenhariaCompleta` (roda de-para, grava
  engenharia DE VOLTA no cálculo — melhora progressiva, marca
  engenhariaCompleta quando sem pendência essencial papel/gramatura/cores;
  idempotente).
- Rota `POST /orcamento-grafico/de-calculo`: antes de copiar, chama
  `garantirEngenhariaCompleta`; grava `tipo='REPETICAO'` + `clienteId` resolvido.
  `orcamentoGraficoSelect` passou a incluir `tipo`.
- Endpoint admin `POST /api/calculo-grafico/enriquecer-lote` (lote prioritário —
  Task 7): roda o de-para nos migrados incompletos, relatório resolvidos×pendentes.
- Conferência `GET /orcamento-grafico/:id/itens/:itemId/conferencia` (Task 6):
  foto (origem) × recálculo (Vizor) + desvio %; ≤0,5% = confere. Não grava.
- Frontend: badge "Repetição" na lista e no detalhe (Task 8.1).
- get_diagnostics limpo em todos os arquivos tocados.

**FALTA:** Task 8.2 (chips A_COMPLETAR no wizard) + 8.3 (painel de conferência no
StepRevisao) + Task 9 (property tests) + Task 10 (checkpoint na tela). Depois:
rodar o `enriquecer-lote` em produção (precisa da API no ar) e commitar.

## 🟢 FOTO RICA — CEV/margens/C.PROD DECIFRADOS (21/10/2026) — 11121 bate 100%

Spec `.kiro/specs/calculo-grafico-foto-rica/`. A foto rica (`versaoFoto:2`,
gravada em `calculo_grafico.resultado_calculo`) agora reproduz o pré-cálculo
INTEIRO do Calcgraf. **As 3 fórmulas que faltavam foram decifradas e validadas
contra o cálculo 11121 (ESAB), batendo 100%** (exportador
`scripts/exportar-calculos-acervo-rico.mjs`):

1. **C.PROD exibido = CT + MD + SE + Crédito IPM** onde crédito IPI = agrupamento
   **−5** de `CalculoResAgrupamento` (`Σ CustoFixo + CustoUnitario×tiragem`).
   No 11121: CT 11.278,55 + MD 51.825,38 + SE 0 + IPI 1.387,79 = **64.491,72** (= PDF).
   (CT=agr 1, MD=agr 2, SE=agr 3, mesma fórmula.)

2. **CEV total = 21,25%** — composição DETERMINÍSTICA do banco (sem hardcode):
   - **ICMS** = `TributacaoVenda.AliquotaImposto` via `CalculoHeader.CodTributacao`
     (11121: CodTributacao=2 "ICMS + IPI" → 3%).
   - **PIS/Cofins** = `CalculoTaxas` CodTaxa=**2** (9,25%).
   - **Comissões** = `CalculoTaxas` CodTaxa=**−7** (3%).
   - **Juros** = `CalculoHeader.TaxaJurosAplicacao`(%/mês) × (`CpPrazoPrimeiraParcela`/30).
     11121: 2%/mês × (90/30) = **6%**.
   - Soma = 3 + 9,25 + 3 + 6 = **21,25%**.

3. **3 faixas de margem via gross-up** (o Calcgraf só grava o valorTotal da
   SELECIONADA em `CalculoTiragens`; as outras são recalculadas na tela):
   - Faixas (ItemMargem 0/1/2) = `CalculoMargens` com **ItemTiragem=0 e
     ItemAgrupamento=0** → aliq 10 / 15,9283909276128 / 30 no 11121.
   - A selecionada = `CalculoTiragens.ItemMargem` (+ `ValorTotalVenda` +
     `AliqMargem` + `ValorContMarginal`=CM).
   - `base = valorSel × (1 − margemSel%/100 − 21,25%/100)` = 63.185,97.
   - cada faixa: `valorTotal = base / (1 − margem%/100 − 21,25%/100)`.
   - Resultado 11121: 10%→**91.906,87** · 15,93%→**100.580,00** (sel, CM 27,14%)
     · 30%→**129.612,26** (≈ nota validada 91.906,90 / 100.580 / 129.612,20;
     diferença de centavos = arredondamento interno do Delphi, irrelevante).

Mapeamento de-para completo da foto rica no `design.md` da spec. O importador é
`scripts/importar-foto-rica-calcgraf.ts` (npx tsx trava → gravar via `pg` direto
num `.mjs` quando precisar). Frontend renderiza tudo em `biblioteca-calculos/
page.tsx` (FotoRicaView): planos/suportes/tintas/mat.acab/impressão/acabamentos
+ C.PROD(com IPI) + CEV decomposto + 3 margens (selecionada destacada).
**Nomes de suporte vêm do cadastro com espaço/sem gramatura (ex.: "Stora Enzo
Bobina ") — é o dado REAL, não truncamento; a gramatura (181) vem do plano.**

## 🟢 7343 (5346) — HISTÓRICO GRAVADO / item completo (20/10/2026)

A pendência do 5346 (item vazio) foi RESOLVIDA. O item seq 1
(`051b4ae0-3e85-456f-82dc-223a6df769da`) do orçamento 5346 foi gravado como
**FOTO ARQUIVADA** do cálculo 7343 — cada informação no seu lugar na tela:
suporte Nz Bobina 325 (`775b436a-...` @ 8,343/kg, 321,58 kg), 3 Pantones
(65/90/155), Matriz 3×100, BOPP 544,21, Fita 520, impressão Roland 770 + 4
acabamentos (Guilhotina/Cortadeira/Fita/Laminação, IDs reais). `resultadoCalculo`
= golden `calcularOrcamentoGrafico(input7343)`. **C.PROD R$ 5.411,37** (Calcgraf
5.411,87; desvio 0,009%). É HISTÓRICO — não recalcular (o "Recalcular" refaz com
cadastros atuais e diverge). Gravado via script `_tmp-` (removido após uso).

## 🟡 ACERTO POR COR das máquinas — EXTRAÍDO mas NÃO gravado (decisão 20/10/2026)

Extraído da base restaurada do Calcgraf (`CalculoAtividades.tempoPorAcerto`/
`tempoPrimeiroAcerto` por `codCentroCusto`, moda sobre milhares de cálculos):
- Heidelberg CD 5 cores (centro 2) → acerto 5 / setup 0 (3.545 cálc.)
- KBA Rápida 75 6 cores (centro 1) → 10 / 35 (1.795)
- Heidelberg CD 7 cores (centro 46) → 18 / 30 (1.506)
- Roland RVU 4 cores (centro 45) → 30 / 0 (747)
- Roland RZU 2 cores (centro 4) → 30 / 0 (657)
- Heidelberg SM 2 cores (centro 3) → 10 / 0 (522)

**NÃO GRAVADO** — motivo (decisão do usuário): o cadastro `CentroProducao` do
Vizor tem DOIS mundos de máquina misturados: (A) importados do **PDF** (códigos
numéricos 10/19/21/39/41, usados HOJE na Programação do chão) e (B) cadastrados
p/ o **orçamento gráfico** (HEID-CD5/ROLAND-RVU4/KBA-75-6...). Os do mundo A já
têm acerto preenchido em CALIBRAÇÃO ANTERIOR validada por golden (RVU=90, CD5=25,
KBA=20, CD7=36 — ver steering, batem com "CC2=25/CC45=90/...") e DIVERGEM da
leitura bruta acima (o `tempoPorAcerto` puro ≠ acerto efetivo calibrado). Gravar
agora sujaria o cadastro ambíguo.

**Plano acordado (NÃO pular):** estruturar o fluxo NOVO (orçamento gráfico → OP
pelo Vizor) usando o conjunto de cadastros "do orçamento" (mundo B); deixar o
legado do PDF (mundo A: máquinas/OPs da Programação) INTOCADO por ora. Quando o
Vizor assumir todo o PCP, decidir o destino do legado (limpar/começar vida nova
ou migrar) — fica para depois. FOCO ATUAL: alinhar de ponta a ponta o
preenchimento do orçamento de cálculo + cadastros de apoio, ANTES de escolher um
cálculo-exemplo recente p/ recriar. Acerto por cor volta à pauta quando definir
qual conjunto de máquinas é o "oficial do orçamento".

### ✅ MÁQUINAS DO ORÇAMENTO definidas (20/10/2026) — mundo B oficial

Decisão: as máquinas OFICIAIS do orçamento gráfico são o **MUNDO B** (as que
têm FORMATO DE FOLHA + VELOCIDADE cadastrados): `HEID-CD5`, `HEID-CD7`,
`HEID-LETTER`, `HEID-SM2`, `KBA-75-6`, `ROLAND-RVU4`, `ROLAND-RZU2`. O mundo A
(códigos numéricos 19/2/10/21/39/41 — importadas do PDF, usadas na Programação,
SEM formato de folha) fica INTOCADO.

Feito (produção, reversível):
1. **Acerto por cor do mundo B completado** (copiado do par calibrado do mundo A;
   só preencheu o que estava null): `ROLAND-RVU4`→acerto 90/setup 0,
   `ROLAND-RZU2`→45/0. As demais do mundo B já estavam calibradas (CD5=25,
   CD7=36/30, KBA=20). HEID-SM2/HEID-LETTER (2 cores) ficaram sem acerto — sem par
   calibrado; não bloqueiam as demais. Mundo A NÃO tocado.
2. **Seletor de máquina do orçamento filtrado** (`StepCores.tsx`, reusado também
   pelo `ItemWizardModal`): agora só lista máquinas IMPRESSAO ativas COM formato
   de folha > 0 (= mundo B), eliminando as duplicatas do PDF no wizard. Só
   frontend; NÃO toca backend/importação-PDF/painel de Programação. ATENÇÃO: as
   do mundo B `ROLAND-RVU4/ROLAND-RZU2/HEID-SM2` seguem com `disponivelProgramacao
   =true` (aparecem no painel hoje) — NÃO alterado de propósito (mexer afetaria o
   painel). Limpeza da duplicata NO PAINEL fica para depois, se o usuário pedir.

### ✅ BIBLIOTECA DE CÁLCULOS GRÁFICOS — implementada (LOCAL, não commitada) (21/10/2026)

Spec `.kiro/specs/biblioteca-calculos-graficos/` (requirements + design + tasks).
Resolve o fluxo do Calcgraf "Localiza o Cálculo Padrão": o operador PUXA um
cálculo existente (por CÓPIA/foto congelada) em vez de refazer tudo; e prepara a
migração do acervo histórico (11.561 cálculos) para a biblioteca. **Entidade
nova `CalculoGrafico`** (independente do orçamento), mesmo shape de engenharia do
`ItemOrcamentoGrafico`.

**Entregue (todas as tasks de implementação; property tests `*` ficaram como
follow-up opcional). Tudo validado por `get_diagnostics` — tsc inteiro não roda
nesta máquina. NADA commitado (política do usuário).**

- **Schema** (`schema.prisma`): model `CalculoGrafico` (tabela `calculo_grafico`)
  com `numero` próprio por empresa, `numeroCalcgraf` (ref. Calcgraf),
  `origem` (VIZOR|MIGRADO_CALCGRAF), `status`, campos de engenharia espelhando o
  item, `resultadoCalculo` (FOTO congelada), `fotosAnteriores` (histórico de
  recálculo). `@@unique([empresaId,numero])` + `@@unique([empresaId,numeroCalcgraf])`.
  Coluna aditiva `ItemOrcamentoGrafico.calculoGraficoOrigemId` (rastreabilidade).
  `migrate-prod.ts` atualizado idempotente (CREATE TABLE/INDEX IF NOT EXISTS +
  índice único parcial `WHERE numero_calcgraf IS NOT NULL` + ADD COLUMN) — **roda
  no deploy do Render** (Postgres local indisponível; migração local não rodada).
- **Submódulo** `src/modules/orcamento-grafico/calculo-grafico/`:
  - `calculo-grafico.types.ts` — tipo `CamposEngenhariaCalculo` (shape comum).
  - `calculo-grafico-mapeamento.ts` — `calculoParaItemBody`/`itemBodyParaCalculo`
    (puras, round-trip).
  - `calculo-grafico.service.ts` — `criarCalculoGrafico` (numeração atômica por
    empresa em transação), `buscarCalculosGraficos` (critérios conjuntos,
    case-insensitive, snapshot em `$transaction`), `obterCalculoGrafico`,
    `recalcularCalculoGrafico` (preserva a foto anterior em `fotosAnteriores`),
    `registroParaEngenharia` (exportada). **empresaId EXPLÍCITO em TODA query.**
  - `calculo-grafico-import.service.ts` — `mapearLinhaParaCalculo` (pura,
    resiliente) + `importarAcervo` (idempotente por `(empresaId,numeroCalcgraf)`,
    foto da origem, relatório de corrompidos, invariante
    `importados+atualizados+ignorados+erros == total`).
  - `calculo-grafico.routes.ts` — CRUD + busca + recalcular + `importar-acervo`
    (ADMIN, hoje 501 apontando o script). Registrado em `server.ts` com prefixo
    `/api/calculo-grafico`.
  - Rota `POST /api/orcamento-grafico/:id/itens/de-calculo` (em
    `orcamento-grafico.routes.ts`): cria item do orçamento COPIANDO a foto do
    cálculo; **403** se o cálculo for de outra empresa (Req 3.4).
- **Script** `scripts/importar-calculos-calcgraf.ts` (versionado, não `_tmp-`):
  lê `cartoon/export/<arquivo>.json`, mapeia tolerante → `LinhaAcervoCalcgraf`,
  importa em lotes de 500 com `comRetry` (pooler Neon). Flags: `--empresa`,
  `--arquivo`, `--desde-numero`, `--desde-ano`, `--dry-run`. EXIGE empresa
  existente (não cria). **Pendência**: o exportador do acervo (SQL Server →
  JSON com `sqlcmd -u` UTF-16→UTF-8) ainda não foi escrito/rodado; o
  `brutoParaLinha` é tolerante mas os nomes de coluna precisam ser conferidos
  contra o export real antes do `--apply` em produção.
- **Frontend** (`VisioFab.Wms.Front`, também não commitado):
  `orcamento-grafico/biblioteca-calculos/page.tsx` (tela de busca), item
  "Biblioteca de Cálculos" no `ModuleSidebar`, e botão "Localizar Cálculo" +
  `BuscaCalculoModal.tsx` na tela de detalhe do orçamento (cria item a partir do
  cálculo). Rota real = `/orcamento-grafico/biblioteca-calculos` (não `/pcp/...`).

**✅ ACERVO MIGRADO EM PRODUÇÃO (21/10/2026):** os **7.951 cálculos** do Calcgraf
foram importados para `calculo_grafico` da Wega (produção Neon,
`75848e24-...`), origem `MIGRADO_CALCGRAF`, 0 erros. A tela Biblioteca de
Cálculos deixou de estar vazia. Processo:
- **Exportador** `scripts/exportar-calculos-acervo-calcgraf.mjs` (SOMENTE-LEITURA
  do SQL Server local; `sqlcmd -u` UTF-16→UTF-8 p/ acentos). De-para confirmado
  no banco real:
  - numCalculo←`CalculoHeader.NumCalculo`; tiragem←`TiragemBase`;
    cliente←`Nomes.RazaoSocial` via `CodNome` (só 32/7951 têm cliente — o resto é
    "sem cliente definido" no Calcgraf, NÃO é bug); linha←`_LinhasProduto.Nome`;
    produto/descrição/sigla←`CalculoAcabados` (subquery TOP 1 por `ItemAcabado`);
    valor←`CalculoTiragens.ValorTotalVenda`; custo←`SUM(CustoFixo)+SUM(CustoUnitario)
    ×tiragem` de `CalculoResAgrupamento` (agrup. 1/2/3 positivos); cores←`CalculoTintas`.
  - **DEDUPE CRÍTICO:** um `NumCalculo` pode ter 2+ linhas em `CalculoHeader`
    (original + recálculo) → a query mantém só o de **MAIOR Codigo** por
    NumCalculo (`AND h.Codigo = (SELECT MAX...)`). Sem isso vinham 10.950 linhas
    com duplicatas; com o dedupe = **7.951 distintos**. Rascunhos sem NumCalculo
    (462) saem no dedupe/erro.
  - **Produto→TipoEmbalagem:** `CalculoAcabados.CodProduto` (1..12) → `TipoEmbalagem`
    código `CG-EMB-<n>` (os 12 CG-EMB já existem na Wega de produção). O importador
    resolve via `deParaTipoEmbalagem` (Map montado no início de `importarAcervo`).
- **Importador** `scripts/importar-calculos-calcgraf.ts` + `importarAcervo`:
  idempotente por `(empresaId, numeroCalcgraf)` via Set pré-carregado (1 query, não
  1/linha). **Inserção em LOTE via `createMany`** (lotes de 500) — o caminho
  um-a-um (`criarCalculoGrafico`) era ~1,3/s no pooler Neon (~2h); o createMany fez
  em ~1min. Campos de texto TRUNCADOS aos limites do schema
  (descricao/produto/clienteNome 200, linhaProduto 120, siglaAcabado 60) — havia
  1 descrição de 224 chars que derrubava o lote inteiro.
- **Como rodar de novo (idempotente):** export local → `DATABASE_URL` do Neon
  (`:5432...&pgbouncer=true&connection_limit=1` p/ Prisma) →
  `npx tsx scripts/importar-calculos-calcgraf.ts --empresa 75848e24-... [--dry-run]`.
  NÃO toca PCP (tabela isolada). A connection string do Neon fica FORA do git.

**Pendências restantes:** (1) property tests P1–P12 (tasks `*`, opcionais); (2)
ativar o botão "Usar em orçamento" na tela da biblioteca (hoje só navega); (3)
`criarCalculoGrafico` ficou não-usado pelo importador (ainda usado pela criação
normal via rota) — ok manter.

### ✅ ALINHAMENTO DE CADASTROS DO ORÇAMENTO — levantado (20/10/2026)

Estado dos cadastros de apoio (produção, só-leitura):
- **Máquinas (mundo B):** prontas, acerto por cor completo.
- **Acabamentos:** 46/67 com valor. As 21 sem valor são (a) 8 processos que a
  Wega NÃO opera (Flexo/Roto/Serigrafia/Tipografia/Offset Plana|Rotativa/
  Formulário/Relevo — irrelevantes) e (b) 13 atividades compostas (Laminação
  maior/menor, Colagem Manual, 6 Sacolas, Vernizes). Os que a Wega USA
  (Cortadeiras/Guilhotinas/Coladeiras AFT70/Bobst/Diana/CVM/acoplagens/
  plastificadoras/hotstamping) TÊM valor. NOTA: acabamento usa custo-hora +
  produção/hora + 1º acerto (tpAcerto=0 em todos — "acerto por cor" é só da
  impressão). Laminação/Verniz: valor sai do pré-cálculo se o cálculo usar.
- **Modelos de Faca (GCad): 0 cadastrados** ⚠️ — o encaixe/imposição NÃO virá de
  faca; usar **aproveitamentoManual** (nº peças/folha do pré-cálculo), como no
  7343 (1.334 folhas). Não é bloqueio.
- **Tipos de Embalagem:** 20 ativos, fórmulas OK (ROTULO = L+SANGRIA*2). Há
  duplicatas (import vs manual: Cartuchos/Cartucho Simples, Impressos 2×, etc.) —
  mesmo padrão das máquinas; não bloqueia. A fórmula importa pouco quando se usa
  aproveitamento manual (curto-circuita a planificação).
- **Suportes:** 84 completos (coefTinta SPANKS ok; Nz Bobina, Kraft Senges 2,2).
- **Preços papel:** 1.767 ✅. **Tintas:** 233 (muitos Pantone com preço 0 — cor é
  entrada manual no orçamento, não bloqueia).
- **Tabela de margem** (Padrão Wega) + **Parâmetro de perda** (geral): ✅.

LIÇÃO-CHAVE p/ recriar um cálculo e BATER o Calcgraf: 2 campos vêm do pré-cálculo/
memória, NÃO do cadastro — (1) aproveitamento/folhas (imposição da faca) e (2)
valores de laminação/verniz se usados. O resto já está cadastrado.

PRÓXIMO: escolher um cálculo-exemplo recente do Calcgraf e percorrer o wizard
inteiro (cliente→tipo→medidas→papel→cores/máquina→acabamentos→revisão) validando
cada passo contra a memória de cálculo, até o C.PROD bater; depois emitir a OP.

## 🔴 AGENTE DE SINCRONIZAÇÃO INATIVADO (20/10/2026 — pedido do usuário)

**A API do agente Calcgraf está DESLIGADA em produção por decisão do usuário.**
Motivo: não conseguiram atualizar o agente com as últimas correções (v0.4.1) e a
versão antiga estava gerando problemas (ex.: sync zerando roteiro — ver incidente
15–16/10). Para parar o sangramento, a credencial foi **revogada**.

- **Como foi feito:** a `AgenteApiKey` "Agente TS PHTech (Calcgraf)" da empresa
  Wega (`75848e24-...`) está com **`status='REVOGADO'`** no banco de produção.
- **Efeito:** `agenteAuth` (`src/modules/pcp/importador-calcgraf/agente-auth.ts`)
  exige `status: 'ATIVO'` para resolver a chave; com REVOGADO, toda chamada a
  `POST /api/pcp/ingest-op-calcgraf` responde **401 "Credencial do agente
  inválida ou revogada"**. Ou seja, o agente NÃO consegue mais sincronizar —
  inativação efetiva, sem mexer em código.
- **Importação de OP continua** normalmente pelo **PDF** (fluxo
  `importar-op-pdf`) — só o agente automático está parado.
- **Para REATIVAR** quando o usuário quiser (após instalar a v0.4.1 no servidor
  PHTech): gerar uma NOVA chave em PCP → Importador Calcgraf → Chaves do Agente
  (a revogada não volta), embutir o token no agente e reinstalar. NÃO basta
  mudar o status no banco — o token em claro só existe na criação.

## 🟡 ORÇAMENTO 7343 SEEDADO (nº 5346) — SÓ CABEÇALHO; ITEM VAZIO (PENDÊNCIA 20/10)

> **⚠️ RETOMAR AQUI NA PRÓXIMA SESSÃO.** O seed do 7343 ficou PELA METADE: o
> cabeçalho/totais batem, mas o ITEM interno está VAZIO — ao abrir o wizard
> "Editar Item" nada vem preenchido (tipo genérico "Cartuchos", suporte vazio,
> cores CMYK 30% em vez dos 3 Pantone, nenhum acabamento marcado) e o
> "Recalcular" dá OUTRO número (R$ 5.261,70 ≠ 5.411,87). O usuário reportou isso
> com prints (20/10). Precisa montar o ITEM ESTRUTURADO de verdade.

O cálculo **7343** do Calcgraf ("RÓTULO P/ARAME FARPADO ELEFANTE 250M", cliente
A Imperatriz, tiragem 4.000) foi gravado como **orçamento nº 5346**
(`serie='7343'`, RASCUNHO) por `scripts/seed-orcamento-7343-wega.ts`.

### O que está CERTO
- **Cabeçalho/Totais Consolidados batem:** MD 4.240,90 · CT 1.170,47 · **C.PROD
  5.411,37** (Calcgraf 5.411,87; 0,009%). Gravado via `resultadoCalculo` do
  motor real + `custoProducaoConsolidado`/`valorTotalConsolidado`.
- **Golden de regressão** `calibracao/golden-7343.{fixture,test}.ts` (12/12) —
  6º golden calibrado, prova que o MOTOR reproduz o Calcgraf.

### O que FALTA (a pendência real — montar o ITEM clicável)
O registro foi gravado com `cores=null`, `acabamentos=null`, `papelId=null` e um
`tipoEmbalagemId` genérico (CG-EMB-1 "Cartuchos"). NÃO há linha em
`item_orcamento_grafico`. Por isso a tela de EDIÇÃO abre tudo em branco e
recalcula diferente. Para o 5346 ficar IDÊNTICO ao Calcgraf ao editar, falta
criar o ITEM (via `POST /orcamento-grafico/:id/itens` ou gravar direto) com:
- **Suporte real** "Nz Bobina 325" (resolver `suporteId`/`papelId` do cadastro)
  + gramatura 325 + preço 8,343/kg; **aproveitamentoManual** p/ bater as 1.334
  folhas (o encaixe da bobina 613×1210 não sai sozinho).
- **3 cores Pantone** (Pantone 01/02/03) com as coberturas reais (o pré-cálculo
  não traz % por cor — usar as do golden/consumo SPANKS; preços 65/90/155... na
  verdade memória usa 65/90/155).
- **Acabamentos marcados** (acabamentosRicos, por `acabamentoId` do cadastro):
  Cortadeira (Grande), Guilhotina de envol, Laminação maior, Fita dupla face,
  + BOPP/Fita material + Matriz RVU. Já existem no cadastro (ver estado dos 67).
- Depois **recalcular o item** e conferir que a Revisão do wizard dá 5.411,87.
- DECISÃO: ou (a) montar o item fiel (trabalho de mapear IDs reais + encaixe),
  ou (b) assumir que o 5346 é só "cabeçalho-espelho" e criar o item DE VERDADE
  pelo wizard manualmente na tela. Confirmar com o usuário o caminho.

(Histórico do seed inicial abaixo — `resultadoCalculo` gravado é o do motor real
  (`calcularOrcamentoGrafico`), então a tela de detalhe renderiza os lançamentos
  (suporte Nz Bobina, matriz RVU, 3 Pantones, BOPP, Fita, impressão + 4
  acabamentos) idênticos ao pré-cálculo.
- **Golden de regressão:** `src/modules/orcamento-grafico/calibracao/
  golden-7343.{fixture,test}.ts` (12/12 verde; suíte orcamento-grafico 202
  passed). É o 6º golden calibrado (15168/15182/15185/15086/15235/**7343**),
  todos ≤0,5%. Confirma que o motor do Vizor reproduz o Calcgraf.
- **Pré-cálculo-fonte:** memória de cálculo impressa enviada pelo usuário em
  20/10 (MD 4.240,89 / CT 1.170,98 / C.PROD 5.411,87 / Cr.IPI 78,14 / TOTAL
  5.340,65). NOTA: a tela "Estrutura" tinha preços de OUTRA tabela de custo
  (mais cara, somava 5.835,95); a memória de cálculo é a fonte correta.

### Cadastros de acabamento completados na produção (20/10/2026)
As "lacunas de cadastro" do orçamento foram tratadas com DADO REAL (nada
inventado), via 3 scripts versionados:
- `vincular-acabamento-centro-wega.ts` — 22 acabamentos HORA_MAQUINA vinculados
  ao `CentroProducao` por nome EXATO (herdam custo-hora; corrigido bug de match
  frouxo "Cortadeira (Grande)"→"(Pequena)").
- `completar-precos-acabamentos-wega.ts` — preenche preço/custo a partir do
  `Itc`+`TabelasCustoDetalhe` exportados: MAT.ACABAMENTO usa `ValorTotal` (Tab=2
  Col=1); CENTRO DE CUSTO usa `ValorDireto`. Reclassifica MATERIAL_*→HORA_MAQUINA
  quando o item é atividade (ex.: SG Laminadora, Colar envelopes).
- `depara-acabamentos-manual-wega.ts` — de-para manual conferido das telas
  (Verniz BA Brilho 13,2 / Fosco 24,2, Fechadora de Caixa 115, Colagem acetato
  0,06, Colocação ilhós/velcro 15, Poliéster 1).
- **Estado final:** 67 acabamentos — 46 com valor (40 HORA_MAQUINA c/ custo-hora
  + 6 MATERIAL c/ preço). **21 ainda sem valor**, e são genuinamente os que
  dependem de calibração: processos que a Wega NÃO opera (Rotogravura,
  Serigrafia, Tipografia, Flexografia, Offset Rotativa, Formulário Contínuo,
  Relevo) e ATIVIDADES COMPOSTAS (Laminação maior/menor, 6 Sacolas, Verniz
  genérico/Local/UV Local Wega, Colagem Manual) — preço justo sai de um
  pré-cálculo real que use a atividade (como o 7343 deu BOPP 0,55 e Fita 20).

### Taxas/margem (item confirmado — não há tabela a importar)
O CEV (Taxa Administrativa + PIS/Cofins 9,25% + ICMS + comissão) é aplicado por
FÓRMULA automática sobre o custo (gross-up: `preço = custo ÷ (1 − margem% −
CEV%)`), que o Vizor já faz (`formarPrecoVenda`). No Calcgraf a MARGEM é por
cálculo (tabela `CalculoTaxas`), não um cadastro global — só existem 2 Taxas
globais (Taxa Adm 0% + PIS/Cofins 9,25%). A `TabelaMargem` padrão da Wega
(markup 30% / impostos 14,75% / comissão 3%) é o default correto. Nada a
importar aqui.

## 🟢 ESTADO ATUAL DO AGENTE (18/10/2026) — v0.4.1 PRONTA, FALTA REINSTALAR

**Resumo p/ nova sessão:** as DUAS queixas do usuário (observação da OP vazia +
programação de entrega não aparece em "Entregas") **já estão corrigidas no
código, commitadas e empacotadas na v0.4.1**. O que falta é SÓ OPERACIONAL:
reinstalar o `release/VisioFab Agente Calcgraf Setup 0.4.1.exe` no servidor
PHTech (via RDP) e re-sincronizar. O usuário havia instalado a **v0.4.0**, que
é anterior a ambas as correções — por isso nada mudou pra ele.

Diagnóstico confirmado (18/10, validado contra o backup local + testes 5/5):
- **Observação da OP** — commit `9a4b8d0e7` (17/10 21:31). O memo (`TabelaMemos`,
  `NomeTabela='CalculoOp'`) fica SEMPRE no cálculo ORIGINAL (mesmo `NumCalculo`,
  MENOR `Codigo`), nunca no `MAX(Codigo)` (recálculo técnico). `montarQueryObservacaoOp`
  junta `CalculoHeader` por `NumCalculo` e lê o memo do irmão; múltiplas linhas
  de memo são concatenadas. Validado 9/9 OPs com memo (antes 0/9).
- **Programação de entrega** — commit `f35baed10` (17/10 08:33). A data de entrega
  NÃO está em `OpLote.DataPrometida` (quase sempre NULL) nem sempre no pedido
  (`PedidoItemEntrega` vazio p/ várias OPs, ex. 3176). A fonte do PDF é
  **`CalculoProgEntrega`** (por cálculo). Prioridade no reader (`lerOpsCandidatas`,
  ~linha 1420): `CalculoProgEntrega` → `PedidoItemEntrega` → `OpLote`. O backend
  (`ingestao-op-calcgraf.service.ts` → `criarProgramacaoEntrega`) já grava
  `ProgramacaoEntrega` a partir do `programacaoEntrega` do payload, igual ao
  fluxo do PDF.
- **Instalador 0.4.1.exe** gerado 17/10 21:38 (7 min APÓS o último commit) →
  contém AS DUAS correções. `package.json` em v0.4.1.
- Tudo commitado em `origin/main` (nada pendente em `VisioFab.AgenteCalcgraf/src/`
  nem `src/modules/pcp/`). `tsc` do agente OK; `node --test` do reader 5/5.

**AÇÃO PENDENTE (usuário/Pedro):** reinstalar v0.4.1 no servidor + sincronizar.
Depois disso, observações E entregas aparecem nas OPs sincronizadas pelo agente.
Nenhuma mudança de código adicional é necessária para essas duas queixas.

> 📄 **AO RETOMAR ESTE TEMA, LEIA PRIMEIRO:** `docs/importador-calcgraf-HANDOFF.md`
> (handoff consolidado: connection string do servidor, credenciais, logon
> trigger, arquitetura tedious/asar, regras de ingestão e a FASE 2 — trazer
> etapas/variações/materiais via `docs/calcgraf-mapeamento-roteiro-op.md`).

Spec `.kiro/specs/importador-op-calcgraf/` (16/16 tasks concluídas). Objetivo
ALCANÇADO: **eliminar a importação de PDF de OP**. O agente desktop (Electron+TS)
está INSTALADO no servidor da PHTech (via RDP/AnyDesk, usuário `claudio.rangel`/
Administrator) e **sincronizou OPs reais** da Carton Wega no Vizor de produção.
Guia completo: #[[file:docs/agente-calcgraf-instalacao.md]].

### Como funciona (resumo)
Agente lê o SQL do Calcgraf (SOMENTE SELECT), detecta OPs novas/alteradas por
**hash de conteúdo** (`OpHeader` não tem coluna de alteração) e envia por HTTPS
para `POST /api/pcp/ingest-op-calcgraf` (auth por `AgenteApiKey` por empresa, via
header `x-agente-key`). O Vizor casa a OP por `referenciaExterna == OpHeader.Numero`
(QUALQUER origem — reconhece OPs já vindas de PDF, nunca duplica): sem produção →
**atualiza** (e unifica origem p/ `AGENTE_CALCGRAF`); com produção → vira
`AlteracaoOpPendente` (revisão manual em PCP → Importador Calcgraf → Pendentes).

### ⚠️ INCIDENTE 15–16/10/2026 (ler no HANDOFF) — agente antigo zerou 61 OPs
A sync com o agente FASE 1 (sem roteiro) apagou etapas/variações de 61 OPs que
já tinham roteiro de PDF (substituição total com payload vazio). **Reparadas 60**
via reextração do PDF salvo; falta a **ref 3138** (sem PDF → agente fase 2).
**LIÇÃO:** a identidade da OP é a `referencia_externa` (nº do Calcgraf), NÃO o
`numero` interno (não batem). Cinto de segurança commitado (`3c5919927`):
`atualizarOp` não zera roteiro quando o payload vem sem etapas. **Manter o agente
PARADO até deployar o backend + instalar o agente fase 2.** Detalhes no HANDOFF §1.1.

### ✅ FASE 2 — ROTEIRO/VARIAÇÕES/MATERIAIS (15/10/2026, implementada local)
Spec `.kiro/specs/importador-op-calcgraf-roteiro/` (10/10). O agente agora traz
o roteiro completo do CÁLCULO (`CalculoHeader` de maior `Codigo`): etapas
(`CalculoAtividades`, com centro+tempos), variações (`CalculoPlanos`), papel +
mat. acabamento (`CalculoMatAcabamento`) como itens, e tintas (`CalculoTintas`)
como texto na tag `[Cores]`. Backend cria o `CentroProducao` quando não existe
(regra do PDF). SEM mudança de schema. Testes: 29 (pure) + 10 (service) + 7
(agente). Validado contra o backup (OP 3000 = 4 etapas). **Correções de coluna:**
`CalculoPlanos` sem `Ordem`; `CalculoMatAcabamento` sem quantidade; nome do
material em `Itc.Descritivo`. Falta reempacotar/instalar no servidor. Detalhes
no HANDOFF.

### Descobertas CRÍTICAS da instalação (não reinvestigar)
- **SQL do Calcgraf**: instância `SQL2019Express` na porta TCP **5520** (não 1433),
  banco **`CartonWega`** (com W). Login do próprio Calcgraf: `sa` / `C@1cgraf`
  (lido do `C:\CALCGRAF\GPRINT\UDL\CartonVega.udl`). Connection string do agente:
  `server=127.0.0.1\SQL2019Express,5520;Database=CartonWega;UID=sa;PWD=C@1cgraf;TrustServerCertificate=yes;`
- **LOGON TRIGGER `[connection]`** (`ON ALL SERVER FOR LOGON`): bloqueia (ROLLBACK)
  conexões ao `CartonWega` cujo `program_name` (Application Name) NÃO esteja numa
  **allowlist** da PHTech (`Gprint`,`Compras`,`Faturamento`,`Producao`,
  `ExportadorMovimentos`,`.NET SqlClient Data Provider`,… + `%WEBGRAF%`/
  `%GPRINT_ESPECIFICOS%`). Por isso o agente declara Application Name
  **`ExportadorMovimentos`** (já autorizado) — `APPLICATION_NAME_PADRAO` no reader.
- **Driver = `tedious`** (puro JS, TCP), NÃO `msnodesqlv8` (nativo falhava no
  empacotamento e no servidor sem ODBC). O `tedious` conecta por TCP:5520 e
  declara `appName` nativamente. `msnodesqlv8` foi REMOVIDO.
- **Empacotamento**: `electron-builder` com **`asar: false`** (o asar travava o
  build com os muitos arquivos do tedious) + saída em `release/` (não `dist/`).
  Gera `release/VisioFab Agente Calcgraf Setup 0.1.0.exe` (~166 MB).
- **Queries SEQUENCIAIS** (não `Promise.all`): o tedious só aceita 1 request por
  conexão. E **lock global** no `main.ts` serializa sync manual + automática
  (sem ele, 3 OPs duplicaram por corrida na 1ª execução — já limpas).

### Estado em produção (Carton Wega, empresa 75848e24-...)
1ª sincronização real OK: 67 OPs `AGENTE_CALCGRAF` (faixa 3103–3174, respeitando
o corte), 15 `AlteracaoOpPendente` (OPs com produção, p/ revisão), 0 duplicatas
após limpeza. **Corte** `pcp.calcgrafNumeroMinimoOp = 3100` (Parametro da empresa;
OPs < 3100 são ignoradas — ajustável sem redeploy/reinstalar).

### API key da Carton Wega (gerada, embutida no agente)
Empresa `75848e24-742e-461d-b913-1642c5b83ae9`, key "Agente TS PHTech (Calcgraf)".
O token em claro ficou embutido no `index.html` do agente (pedido do usuário p/
instalação). Se o repo/.exe circular, revogar e gerar outra em PCP → Importador
Calcgraf → API keys.

<!-- Histórico original da spec (requirements-first, 14/10/2026) abaixo. -->
Tabelas de OP exploradas no mapeamento (OpHeader/OpItem/OpItemEstrutura/OpLote).
Schema novo
(AgenteApiKey, AlteracaoOpPendente, OrdemProducao.hashImportacaoOrigem) segue
steering database-migrations (schema.prisma + migrate-prod.ts no mesmo commit).

## ⚠️ ENCODING dos dados exportados do SQL Server (acentos → `�`) — LIÇÃO (03/10/2026)

O `scripts/_tmp-exportar-calcgraf.mjs` (sqlcmd + FOR JSON PATH) gerou os JSONs de
`cartoon/export/` com acentos CORROMPIDOS (ex.: `Itc.json` tinha "Couch�", "Al�a",
"Met�lica" — U+FFFD, byte original PERDIDO). Isso contaminou 42 `PrecoMateriaPrima`
em produção (nomes exibidos no cadastro de papel com `�`). CORRIGIDO em produção
cruzando com um re-export CORRETO: `sqlcmd -u` (UTF-16 LE) lido em Node como
`utf16le` → UTF-8 traz os acentos certos. Match 1:1 por "máscara" (cada char não-ASCII
do nome correto vira `�` e casa com o valor corrompido no banco) — 42/42 inequívocos,
0 ambíguos. **Regra daqui pra frente**: ao RE-EXPORTAR qualquer coisa do SQL Server
para importar no Vizor, usar `sqlcmd -u` + conversão `utf16le`→utf8 (NÃO o modo FOR
JSON padrão, que estraga acento). O `exportar-calcgraf-cadastros.mjs` já faz isso
(doc no steering: "sqlcmd `-u` UTF-16 → UTF-8 p/ acentos"); o exportador de JSON
precisa do mesmo cuidado se for rodado de novo.

## ✅ FINALIZAÇÃO DO ORÇAMENTO — INTEGRADO AO MOTOR + COMMITADO (02/10/2026)

Spec `.kiro/specs/orcamento-grafico-finalizacao` (COMMITADA/pushed; back+front
deployados). A calibração (CT acerto-por-cor + Tinta SPANKS) saiu de módulos
isolados e está **plugada no motor** `calcularOrcamentoGrafico`, com fallback ao
legado (não-regressão; suíte 81/81). Entregue:
- Schema: `CentroProducao` (acertoPorCorMin, tempoSetupMin), model `SuporteGrafico`
  (coefTinta/SPANKS), `PrecoMateriaPrima` (suporteId, gramatura, densidadeTinta).
  migrate-prod idempotente (roda no deploy — Postgres local não foi usado).
- Cadastros (front): Orçamento Gráfico → Suportes; campos de acerto/setup em
  PCP → Centros; vínculo papel→suporte + densidade em Preços Materiais.
- Importador: fase `vendedores` (`--fase vendedores`): Vendedor +
  RepresentanteCredencial p/ e-mail válido; de-para por cpf/nome; idempotente;
  `--dry-run`. **AINDA NÃO EXECUTADO** (precisa de ambiente — rodar `--dry-run`
  antes do `--apply`).
- Encaixe gráfico (SVG) no StepRevisao (motor expõe `encaixe.layout`).
Docs: `docs/calcgraf-consumo-tinta.md` §6, `docs/calcgraf-custo-transformacao.md` §9.
PENDÊNCIAS: (a) rodar import de vendedores; (b) refino densidade/constante da
tinta e CT de acabamentos (só impressão foi calibrada no CT) — exige +pré-cálculos.

## ESCOPO ATUAL (decisão do usuário — migração TOTAL faseada)

Objetivo: operar SOMENTE no Vizor (cálculo gráfico, OP, pedidos, PCP, estoque,
NF-e). Decisões firmadas:
1. SEM histórico agora (não migrar pedidos/OPs/NF-e antigos; Calcgraf = consulta).
2. Produtos: 330 no Vizor, 239 em OP (87 em programação ATIVA), e os CÓDIGOS do
   Vizor JÁ SÃO os do Calcgraf (vieram do PDF). Logo, importar produto do
   Calcgraf pelo mesmo código COLIDE — NÃO prefixar/duplicar. Regra: de-para por
   código; existente = só enriquecer campo vazio (nunca sobrescrever/DELETE/
   mexer em OP ativa); inexistente/ativo = INSERT. BOM e Roteiro = 0 hoje.
3. FOCO IMEDIATO: cálculo de ORÇAMENTO bater 100% com o Calcgraf. Tudo em
   paralelo (segue importando PDF de OP; produção não para). Só após bater 100%
   → próxima etapa (gerar OP pelo Vizor, deixar de depender do PDF). Cirúrgico.
4. NF-e é posterior; mas analisar os PDFs do cliente (OP/NF-e/pré-cálculo) para
   o Vizor ter os dados corretos ao gerá-los. Mapeamento do PDF de OP já feito
   em docs/estudo-migracao-total-calcgraf.md §5.3.

Para o orçamento bater, FALTA: cadastrar `TabelaMargem`; o CADASTRO DE
ACABAMENTOS (ver abaixo); e CALIBRAR por golden cases.

## ESTADO DA MIGRAÇÃO (atualizar sempre)

- ✅ FEITO em PRODUÇÃO (Neon, empresa Wega `75848e24-742e-461d-b913-1642c5b83ae9`):
  - Preços de material (1.767 PrecoMateriaPrima), Mapa de Custos RKW 2023-08,
    12 TipoEmbalagem (CG-EMB-*). Fases precos/mapa/tipos-embalagem.
  - CLIENTES: 1.016 (1.015 importados só com CNPJ/CPF + 1 existente), 881 com
    endereço completo. FORNECEDORES: 232, 231 com endereço. Fase `cadastros`
    (de-para por doc; SÓ INSERT; enriquecimento de endereço só em campo vazio).
    Importador tem `comRetry` (pooler Neon derruba conexão em loop longo) e
    `--dry-run`. Export via `scripts/exportar-calcgraf-cadastros.mjs` (sqlcmd
    `-u` UTF-16 → UTF-8 p/ acentos; alias de tabela NÃO pode ser `end` — reservado).
  - DECIDIDO: 473 clientes SEM CNPJ ficaram de fora (trazer depois se pedir);
    Vendedores (39) não entraram como Cliente/Fornecedor — viram usuários/Portal
    Rep (fase à parte).

- ✅ CALIBRAÇÃO NÍVEL A FEITA (fórmula de preço CONGELADA): a fórmula do Vizor
  (`formarPrecoVenda`, gross-up divisor único) reproduz o preço real do Calcgraf.
  Confirmado com 4 cálculos reais do backup (15168/15182/14879/14878), 10 pontos
  de tiragem, ≤0,5%. Teste: `src/modules/orcamento-grafico/calibracao/
  golden-precos.test.ts` (14/14) + fixture anonimizada versionável
  `golden-precos.fixture.ts`. Docs: `docs/calcgraf-golden-cases-precalculo.md` +
  `docs/calcgraf-calibracao-harness.md`.
  - FÓRMULA FECHADA: custoBase(tir)=ΣCustoFixo+ΣCustoUnit×tir (agrupamentos
    POSITIVOS de `CalculoResAgrupamento`); preço=custoBase/(1−margem%−CEV%).
    CEV constante por cálculo. Tabelas-fonte no backup mapeadas (CalculoHeader/
    Planos/Tintas/AtvImpressao/AtvAcabamento/MatAcabamento/Tiragens/Taxas/
    ResAgrupamento). Exportador: `scripts/exportar-calcgraf-golden.mjs` →
    cartoon/export/golden-orcamento.json (ignorado pelo git).
- ✅ CodAgrupamento DECODIFICADO (tabela `Agrupamentos`): 1=Custo de
  Transformação (máquinas), 2=Materiais Diretos (papel+tinta+mat.acab),
  3=Serviços Externos. Bate com o rodapé do pré-cálculo e com a saída do motor
  (materialDireto/custoTransformacao/servicoExterno). Validado 15182 ponta a
  ponta: CT 1504,81 + MD 5029,24 → preço 17.141,20 vs real 17.140,96 (0,001%).
- ✅ CALIBRAÇÃO NÍVEL B — PAPEL (≈70% do MD) CONGELADO: `calcularPapel` do Vizor
  reproduz EXATO o peso/subtotal do Calcgraf (3 casos reais dos prints, desvio
  0,0001%). Fixture `golden-componentes.fixture.ts` + teste
  `golden-componentes.test.ts`. Suíte calibração: **20/20** (14 Nível A + 6 B).
  Fórmula papel: peso=folhas×larg_m×alt_m×gramatura/1000; custo=peso×precoKg.
- ✅ DECOMPOSIÇÃO CT+MD+SE validada: a fixture `golden-precos.fixture.ts` agora
  tem os componentes reais (CT=agrup1, MD=agrup2, SE=agrup3) dos 4 cálculos; o
  teste confirma que CT+MD+SE reconstitui o custo-base agregado. Suíte
  calibração: **24/24** (14 Nível A + 6 papel + 4 decomposição).

### ESTADO EXATO DA CALIBRAÇÃO (retomar aqui numa nova sessão)
Arquivos: `src/modules/orcamento-grafico/calibracao/` (golden-precos.fixture.ts,
golden-precos.test.ts, golden-componentes.fixture.ts, golden-componentes.test.ts).
Exportador: `scripts/exportar-calcgraf-golden.mjs` → cartoon/export/golden-orcamento.json.
Docs: `docs/calcgraf-golden-cases-precalculo.md`, `docs/calcgraf-calibracao-harness.md`.
JÁ CONGELADO (bate exato): fórmula de preço (gross-up), PAPEL (peso/custo),
decomposição CT/MD/SE, custo-base→preço.

FALTA no Nível B (ordem sugerida):
  1. TINTA isolada: ✅ DECIFRADA (02/10/2026). Doc: `docs/calcgraf-consumo-tinta.md`.
     Implementação `src/modules/orcamento-grafico/consumo-tinta.ts` + teste
     `calibracao/golden-consumo-tinta.{fixture,test}.ts`. DESTRAVE: o Calcgraf usa
     a fórmula clássica **SPANKS** da indústria, e o `CoefTinta` por suporte
     (`Suportes.CoefTinta`/`DefTipoSuportesxCoefTinta`) É o fator "Stock" do SPANKS
     (KRAFT 2,2=rough cartridge, JORNAL 1,8=newsprint — batem exato). Descoberto
     via web_search.
     • VAR (kg) = `CoefSuporte × 0,5(offset) × áreaM² × lados × cobertura ×
       densidade / 353`.
     • FIXO (kg) = `partida(0,2kg) × cores × ocorrências` (parâmetro Calcgraf
       "Partida de consumo de tinta"=200g). FIXO bate EXATO (1,60 kg no 15185).
     • custo = (FIXO+VAR) × preçoKg. Validado 15185: 626,51 vs 618,48 real = 1,3%
       (resíduo = arredondamento de folhas; VAR bate 0,0% com const 358/cob 78,9%).
     • A refinar: densidade por tipo de tinta (hoje 1,0; process=1,3) e a constante
       exata (353 vs 358) — precisa de +pré-cálculos (só temos o 5355/15185).
  2. MÁQUINA/C.Transf: ✅ DECIFRADO E VALIDADO (02/10/2026). Doc definitivo:
     `docs/calcgraf-custo-transformacao.md`. Implementação:
     `src/modules/orcamento-grafico/custo-transformacao.ts` + testes
     `calibracao/golden-custo-transformacao.{fixture,test}.ts` (6/6; suíte
     orcamento-grafico 71/71). DESCOBERTAS-CHAVE:
     • ERRO DE BASE corrigido: há 2 `TabelasCusto` (validade por período); os
       cálculos de 2026 usam a **Tabela 2** (recente), não a 1. Custo-hora =
       `Itc`(Origem='CENTRO DE CUSTO')→`TabelasCustoDetalhe`(CodTabelaCusto=2,
       Coluna=1,`ValorDireto`). Ex.: Heidelberg CD 245,45→**440**; Roland
       64,59→**100**. Usar Tab1 deixava o CT ~2,3% fora.
     • Fórmula: `custo = (tempoFixoH + tempoVarH) × custoHora` (EXATO na memória).
     • Tempo FIXO (acerto): ACABAMENTO = `quantAcertos×tempoPorAcerto+t1`;
       IMPRESSÃO offset = `cores × acertoPorCorMin + t1` (acerto/cor por máquina:
       CC2=25, CC45/4=90, CC1=20, CC46=36 min). Tabela-fonte = `CalculoAtividades`
       (NÃO AtvImpressao). Validado: **CustoFixo bate ≤1% em 52/53** cálculos
       (o 1 fora = override manual de quantAcertos, 15196).
     • Tempo VAR (produção) = `unidadesProcessadas/producaoHora`; CustoUnit =
       Σ(VAR×ch)/tiragem. Validado no 15185: 0,69532 vs 0,69500 (0,05%).
     • Fonte da fórmula = memória do pré-cálculo 5355/15185 (ATENÇÃO: o PDF da
       memória pode estar dessincronizado da tiragem no banco; o resAgr do banco
       é a fonte confiável para o agregado — CustoFixo não depende de tiragem).
     • PENDÊNCIA p/ gerar orçamento NOVO: "acerto por cor (min)" é parâmetro da
       máquina no Delphi (não exportado) — virar campo de cadastro no Vizor.
  3. MAT.ACABAMENTO por unidade (COLAGEM MANUAL 0,3/un) — motor já tem custoMaterialUn.
  4. Harness: `scripts/calibrar-orcamento.ts` que roda N cálculos do banco,
     alimenta o motor com o `aproveitamento` real de CalculoPlanos (NÃO
     reinventar imposição Delphi) e compara CT/MD agregados ≤0,5%.
  5. CEV: mapear composição completa (CEV implícito 15168=19,32% > taxas visíveis
     14,25%; falta ~5% — provável IPI/ICMS por produto). Para o Nível A usamos o
     CEV efetivo real; para gerar orçamento novo precisa reconstituir o CEV.

NOTA DE CONTEXTO: nada commitado ainda. Toda a calibração (fixtures/testes/docs/
exportadores) + importador de cadastros + fases precos/mapa/tipos-embalagem +
Mapa RKW + Análise Gerencial estão LOCAIS. Commitar quando o usuário pedir
(back: schema+migrate-prod juntos; back e front repos separados).

- ⚠️ PENDÊNCIA FIRME (abordagem A — "preciso disso 100% correto, não pode se
  perder"): CRIAR SPEC `orcamento-grafico-acabamentos` — CADASTRO DE ACABAMENTOS
  do orçamento. Hoje o wizard usa LISTA FIXA de 5 acabamentos (hardcoded em
  VisioFab.Wms.Front/.../orcamento-grafico/novo/page.tsx). O Calcgraf tem 60
  acabamentos ATIVOS (`Atividades`, exportado em cartoon/export/Atividades.json):
  23 batem com CentroProducao existente, 37 são opções de serviço/manual (alças,
  ilhós, relevo, 7 tipos de verniz, variações de sacola/envelope). Escopo da
  spec: model novo (migrate-prod.ts junto) + importar as 60 Atividades + trocar
  o wizard para ler do cadastro em vez da lista fixa + backend. Suportes(78)/
  FormatosPapel(42) exportados (SuportesFull.json/FormatosPapelFull.json) entram
  junto como cadastro de papel/formato. FAZER LOGO APÓS a calibração do orçamento.

## Contexto em 1 parágrafo

Carton Wega (embalagens de papel) migra do Calcgraf/G-Print (desktop Delphi
proprietário da PHTech, acesso via RDP sistemas.phtech.net.br:1551). Existem
DUAS camadas: (1) **Orçamento/OP no desktop G-Print** — o que a Wega opera; usa
custo-hora fixo da "Tabela de Custos" e calcula o preço do trabalho; (2) **Mapa
de Custos RKW (WebGraf/consultoria)** — calcula o custo-hora, a Wega não opera,
recebe via consultoria paga. O Vizor JÁ TEM o módulo Orçamento Gráfico
(`.kiro/specs/orcamento-grafico/`, implementado). O trabalho é paridade +
calibração + módulos novos (Mapa de Custos RKW e gerencial).

## Estado atual / onde estamos

- Levantamento: CONCLUÍDO (PDF consultoria 31 págs + RI-1..RI-7 + telas do sistema).
- Plano de ação: DEFINIDO (5 blocos). Ordem: 0 coleta → 1 paridade + 2 calibração
  → 3 Mapa de Custos RKW → 4 gerencial.
- **Começando por: Bloco 3 (Mapa de Custos RKW)** — recomendado porque está 100%
  documentado, é aritmética aberta (bate fácil), não depende dos golden cases, e
  é o diferencial que a Wega mais valoriza (hoje só tem via consultoria paga).
- Spec CRIADA: `.kiro/specs/mapa-custos-rkw/` (design + requirements + tasks).
- IMPLEMENTAÇÃO EM ANDAMENTO — Onda 1 (Schema+Migração) CONCLUÍDA:
  - 8 models no schema.prisma. ATENÇÃO: o "Centro de Custo do mapa" chama-se
    **MapaCentro** (tabela `mapa_centro`), NÃO CentroCusto — porque já existe um
    `CentroCusto`/`centro_custo` do módulo Contabilidade (conflito resolvido).
  - migrate-prod.ts: 8 CREATE TABLE IF NOT EXISTS (mapa_custo, mapa_centro,
    bem_depreciar, funcionario_custo, despesa_custo, chave_rateio,
    destino_rateio, resultado_centro) + índices. Rodado 2× local (idempotente).
  - prisma generate OK (v6.19.3).
  - Onda 2 (Motor de cálculo puro) CONCLUÍDA:
    `src/modules/pcp/mapa-custo/mapa-custo-calculo.service.ts` — calcularMapa,
    depreciacaoBem, custoFuncionario, resolverChave (MANUAL/HEADCOUNT/ATIVO/
    CENTRO/FUNCIONARIO), rateio 2 níveis, custo/hora, totais. Tudo em Decimal.
  - Onda 3 (Testes) CONCLUÍDA: `mapa-custo-calculo.test.ts` — golden cases +
    property-based (P1,P3,P4,P5,P6). **27/27 passando** (vitest run, ~4,6s).
    NOTA: nesta versão do vitest o reporter `basic` foi removido; usar `--reporter=dot`.
  - Onda 4+5 (Rotas backend) CONCLUÍDA: `mapa-custo.routes.ts` registrado em
    server.ts (prefixo /api/pcp, filtro empresaId + moduloGuard PCP). CRUD de
    mapa/centros/bens/funcionarios/despesas/chaves + POST /:id/calcular +
    /:id/aplicar-orcamento + 3 relatórios (composicao/distribuicao/custo-hora).
    get_diagnostics sem erros. Escrita bloqueada em mapa FECHADO (409).
  - Onda 5+6 (Frontend + relatórios) CONCLUÍDA (VisioFab.Wms.Front):
    `src/app/(interna)/pcp/mapa-custo/page.tsx` (lista+criar+duplicar) e
    `.../mapa-custo/[id]/page.tsx` (editor com abas Centros/Bens/Funcionários/
    Despesas/Chaves/Resultado + botões Calcular/Fechar/Aplicar ao Orçamento).
    Item "Mapa de Custos (RKW)" no ModuleSidebar do PCP. get_diagnostics sem erros.
    Padrão: `api` direto (useState), como o resto do PCP (sem hooks dedicados).
  - RESTA: task 8 (seed do mapa real da Wega p/ golden e2e) — depende do backup
    SQL Server restaurado; ver docs/restaurar-backup-calcgraf.md.
  - BACKUP DO CLIENTE: `cartoon/CartonWega.bak` = **Microsoft SQL Server** (~659MB).
    Roteiro de restauração em `docs/restaurar-backup-calcgraf.md`. Após restaurar
    local, Kiro explora schema (lib mssql) e escreve a importação.
  - Spec mapa-custos-rkw: tasks 1–8 CONCLUÍDAS. `npm run build` do front PASSOU
    (rotas /pcp/mapa-custo e /pcp/mapa-custo/[id] geradas).
  - ✅ TASK 8 (seed do mapa real / fase `mapa`) FEITA: `scripts/importar-calcgraf.ts
    --fase mapa` cria o MapaCusto de referência `2023-08` a partir da FOTO OFICIAL
    dos relatórios RI-1..RI-6 (transcritos de docs/calcgraf-gprint-levantamento.md
    §4–§12). IMPORTANTE: NÃO usamos os JSONs de cartoon/export para o mapa —
    `GerCustoFixoMes` só tem o TOTAL de custo fixo (R$ 600.000), sem decomposição
    por funcionário/bem/despesa (esses dados ficam no Mapa RKW da WebGraf, que a
    Wega não opera). O seed transcreve 15 centros, 15 bens, 16 funcionários,
    19 despesas, 10 chaves. Idempotente (remove/recria RASCUNHO; respeita FECHADO).
    Validado end-to-end (motor calcularMapa) contra o R1: Ativo Imobilizado
    R$ 5.800.200 (EXATO), Custo Fixo Total R$ 754.635 vs 747.572 (99,1%), Taxa
    Administrativa 32,35% vs 31,7%, depreciação ~32.760 vs ~34.043. Diferenças de
    1–4% vêm da agregação por centro (vs bem-a-bem) — dentro do esperado.

## ITEM B — Importação do backup SQL Server (EM ANDAMENTO)
- SQL Server instalado: instância PADRÃO `MSSQLSERVER` (conecta como `localhost`,
  NÃO `localhost\SQLEXPRESS`). Serviço Running.
- Conexão via sqlcmd: `sqlcmd -S localhost -E -C` (o `-C` é OBRIGATÓRIO — ODBC
  Driver 18 exige trust do certificado; sem ele dá erro SSL).
- Estado do banco: os 4 bancos de sistema (master/model/msdb/tempdb) existem.
  **CartonWega AINDA NÃO restaurado** (era o próximo passo).
- Backup: `c:\Source\VisioFab.Wms.Back\cartoon\CartonWega.bak` (~659MB, MS SQL).
- Lib `mssql`/`tedious`: NÃO instalada no projeto ainda (instalar p/ script de import).
- ✅ RESTAURADO: banco **CalcgrafCartonWega** em `localhost` (MSSQLSERVER).
  - Nomes lógicos do .bak: data=`GPrint`, log=`GPrint_log` (originais em
    C:\CALCGRAF\BANCOS\). Restaurado com MOVE p/ C:\SQLData\CalcgrafCartonWega.mdf.
  - Foi preciso: (a) `icacls cartoon /grant "NT Service\MSSQLSERVER:(OI)(CI)RX"`
    (acesso negado ao .bak); (b) criar C:\SQLData com permissão F p/ o serviço.
  - SQL 2025 fez upgrade de versão do banco (904→998) automaticamente. OK.
  - Conexão de trabalho: `sqlcmd -S localhost -E -C` (nome do banco original é
    "GPrint" internamente; o banco restaurado chama-se CalcgrafCartonWega).
- ✅ SCHEMA EXPLORADO: mapeamento em `docs/calcgraf-mapeamento-importacao.md`.
  Tabelas-chave confirmadas (colunas reais). Destaques:
  - `Itc` (2346, PK Codigo, campo Origem = CENTRO DE CUSTO/MAT.ACABAMENTO/MATRIZ
    IMPRESSÃO/SERVIÇO EXTERNO/SUPORTE/TINTA) + `TabelasCustoDetalhe` (18186:
    ValorTotal/Direto/Depreciacao/Administracao/Outros/FreteKg) = a "Tabela de
    Custos → Valores" printada. Amostra real confere (Tinta 170,5; Suporte 6060/kg).
  - Custo-hora das MÁQUINAS não está na tabela de preço (Origem CENTRO DE CUSTO
    sem ValorTotal) → vem do MAPA: `GerCustoFixoMes` (5) + `CentrosProducao` (52)
    + `CentrosProducaoxTiragensProdHora` (82) + `finRateiosCentrosCusto` (37).
  - Orçamento (Bloco 1): `CalculoHeader` (11561) + filhas (Planos/Tiragens/
    Tintas/MatAcabamento/AtvImpressao/AtvAcabamento/ItensDiversos/ItensFornecidos/
    Margens/Taxas). Cadastros: Produtos(12), Nomes/NomesxClientes, Fornecedores(383),
    Atividades(68), Suportes/FormatosPapel, Roteiros(422).
- ✅ DADOS EXPORTADOS para JSON (item B). Decisão: lib `mssql`/tedious NÃO conecta
  (SQL Server sem TCP/1433; só named pipes). Ponte = **sqlcmd + FOR JSON PATH**
  (`-S localhost -E -C -d CalcgrafCartonWega -y 0 -Q "...FOR JSON PATH"`). O
  sqlcmd quebra o JSON por largura → remover `\r?\n` antes de parsear (documento
  contíguo). Script: `scripts/_tmp-exportar-calcgraf.mjs`.
  - Exportados em `cartoon/export/*.json` (52 CentrosProducao, 52 CentrosCusto,
    2346 Itc, 2 TabelasCusto, 18186 TabelasCustoDetalhe, 5 GerCustoFixoMes, 82
    TiragensProdHora, 37 finRateiosCentrosCusto, 68 Atividades, 78 Suportes,
    42 FormatosPapel, 12 Produtos). Dados reais da Carton Wega.
  - `.gitignore` do back atualizado: `/cartoon/` e `/scripts/_tmp-*` IGNORADOS
    (dados sensíveis — salários/clientes — NUNCA commitar).
- PRÓXIMO (item B, final): escrever `scripts/importar-calcgraf-mapa-custo.ts`
  (lê `cartoon/export/*.json` → grava no Vizor via Prisma; empresaId = a empresa
  Carton Wega no Vizor, perguntar/parametrizar). Mapear:
  • Itc(Origem TINTA/SUPORTE/MAT.ACABAMENTO/SERVIÇO EXTERNO) + TabelasCustoDetalhe
    → PrecoMateriaPrima do Orçamento Gráfico (preço unitário por item).
  • CentrosProducao + GerCustoFixoMes + finRateiosCentrosCusto → MapaCusto/MapaCentro
    (RKW). CentrosProducaoxTiragensProdHora → velocidade/ProdHora.
  • Atividades(68) → catálogo de acabamentos; Suportes/FormatosPapel → papéis.
  Validar contra RI-1..RI-6 e golden cases. Rodar via node; script definitivo
  (não _tmp) mas cartoon/ segue ignorado.

## ⚠️ IMPORTAÇÃO EM PRODUÇÃO — análise de risco (PERGUNTA DO USUÁRIO)
Empresa alvo: **CARTON WEGA INDUSTRIA DE EMBALAGENS SA** (CNPJ 23.787.041/0001-75),
que JÁ EXISTE na produção do Vizor (Neon). No Postgres LOCAL ela NÃO existe.
Connection string de PRODUÇÃO (Neon) fornecida pelo usuário — guardá-la FORA do
git; usar via env, nunca hardcode/commit. NÃO rodar importação contra produção
sem confirmação explícita + validação local antes.

RISCO "afeta produtos do PCP/Programação?" — INVESTIGADO:
- Importador atual (fase `precos`) grava SÓ em `PrecoMateriaPrima` — tabela
  EXCLUSIVA do Orçamento Gráfico; NENHUM outro módulo a usa (o PCP NÃO lê). →
  **fase precos é SEGURA p/ produção**, não toca chão de fábrica.
- O modelo `Produto` é COMPARTILHADO (~60 usos, incl. PCP/programação). O
  importador atual NÃO grava em Produto. Uma FASE FUTURA de importar produtos do
  Calcgraf exige plano de DE-PARA antes (não duplicar/sobrescrever produtos que o
  PCP já usa em OPs/programação). Deixar essa fase TRAVADA até planejar.
- ✅ FASE PRECOS EXECUTADA E VALIDADA EM LOCAL: `scripts/importar-calcgraf.ts
  --fase precos`. Empresa Wega local id `c8cee26b-a9e3-4628-8ade-3fe61336cf00`
  (criada em execução anterior). Importou **1767 PrecoMateriaPrima**
  (PAPEL 1709, TINTA 9, OUTRO 49). Valores conferem c/ Calcgraf real (Kraft
  Senges 6060/kg, Metálica 253, Pantone 170,5). IDEMPOTENTE (2ª exec: 0 criados,
  1767 atualizados). Exclui CENTRO DE CUSTO e MATRIZ IMPRESSÃO.
- Exportador `scripts/_tmp-exportar-calcgraf.mjs` mantido (re-exporta se preciso).
- ✅ FASE `mapa` (RKW) FEITA — `scripts/importar-calcgraf.ts --fase mapa` seeda o
  MapaCusto 2023-08 (foto oficial RI-1..RI-6) e valida contra o R1 (ver bloco de
  estado acima). Rodada em LOCAL na empresa Wega `c8cee26b-...`. Não usa os JSONs
  de export para o mapa (só têm o total de custo fixo, não a decomposição).
- FASE `produtos` — plano em `docs/calcgraf-plano-fase-produtos.md`. DESCOBERTA:
  o export `Produtos.json` (12 registros) NÃO são SKUs de clientes — são TIPOS de
  embalagem (Cartuchos, Sacola, Caixa, Cartelas com flags de geometria/montagem),
  que mapeiam para `TipoEmbalagem`, NÃO para `Produto`.
- ✅ SUB-FASE `tipos-embalagem` FEITA: `scripts/importar-calcgraf.ts --fase
  tipos-embalagem` cria os 12 `TipoEmbalagem` (código `CG-EMB-<n>`). Idempotente
  (2ª exec: 0 criados/12 atualizados; NÃO sobrescreve fórmulas ajustadas à mão).
  NÃO toca `Produto`/OP/programação (fase SEGURA). Fórmulas de planificação são
  BASE genérica 2D/3D (Calcgraf não exporta as reais) — CALIBRAR na tela.
- 🚫 SUB-FASE `produtos-acabados` DESCARTADA (decisão do usuário): as OPs SEMPRE
  nascem por importação de PDF; não importamos SKUs de clientes do Calcgraf.
  Portanto NENHUM `Produto` real é tocado por esta migração.
- Produção: só após validar tudo local + confirmação (env Neon fornecida,
  guardar fora do git).

## ⚠️ POLÍTICA DE COMMIT (decisão do usuário)
NÃO commitar nada agora. O usuário quer commitar **apenas quando TODAS as ondas
e blocos estiverem prontos**. Acumular o trabalho localmente. Quando for
commitar: back e front são repos SEPARADOS; no back, schema.prisma + migrate-prod.ts
SEMPRE no mesmo commit (steering database-migrations). Branch + push conforme
padrão do repo. NADA foi commitado até aqui (Mapa de Custos back+front está só local).

## Ordem dos blocos (plano de ação — docs/calcgraf-plano-de-acao.md)
- Bloco 3 (Mapa de Custos RKW) ✅ feito (falta task 8/seed com dados reais).
- Bloco 1 (Paridade do Orçamento/OP) — EM ANDAMENTO. Spec:
  `.kiro/specs/orcamento-grafico-paridade-calcgraf/` (a spec vazia
  `orcamento-paridade-calcgraf/` foi órfã de reinício — ignorar/remover).
  BACKEND 100% FEITO (tasks 1-5) por sessão anterior, tasks.md agora reflete:
  - `orcamento-grafico-calculo.service.ts` estendido (aditivo): servicosExternos,
    itensDiversos, itensFornecidos, creditosFiscais, encargoFinanceiroPerc, cev;
    saída com materialDireto, custoTransformacao, custoProducao, cevPerc/Valor,
    contribuicaoMarginalValor/Perc. `formarPrecoVenda` = gross-up (divisor único).
  - `orcamento-grafico-paridade.test.ts` golden 15181/15185 + property. Suíte
    orcamento-grafico: **41/41 passando** (não-regressão OK).
  - rotas atualizadas com os campos novos (schema Zod).
  - Task 6 (FRONTEND) CONCLUÍDA: seção "Decomposição do Custo (paridade Calcgraf)"
    (MD/CT/SE/Custo Produção/CEV/CM) exibida no StepRevisao (wizard) E na página
    de detalhe `[id]` do orçamento gráfico. get_diagnostics sem erros.
    6.3 (inputs de serviço externo/material fornecido no wizard) adiado — não-MVP,
    campos aditivos opcionais no backend; adicionar quando o usuário pedir.
  - BLOCO 1 (Paridade do Orçamento) = COMPLETO (tasks 1–6). BLOCO 3 (Mapa de
    Custos RKW) = COMPLETO (tasks 1–7). Item "C" (blocos 1+3) FEITO.
  - NÃO-MVP (spec separada `orcamento-grafico-materiais-repeticao` existe): Tabela
    de Custos por Origem/Coluna + orçamento multi-item.
- BLOCO 4 (gerencial) — EM ANDAMENTO. Spec `.kiro/specs/analise-gerencial-rkw/`
  (requirements+design+tasks). Camada de LEITURA/agregação — NÃO altera schema,
  NÃO toca o motor de orçamento/mapa; só consome `MapaCusto.custoFixoTotal`
  (Bloco 3) + CM dos `OrcamentoGrafico` (Bloco 1).
  - ✅ Tasks 1–4 CONCLUÍDAS: motor puro `analise-gerencial-calculo.service.ts`
    (consolidarCM com CM% média PONDERADA pelo preço, pontoEquilibrio, cobertura,
    simular); testes `analise-gerencial-calculo.test.ts` **23/23 passando**
    (golden + property-based, `--reporter=dot`); rotas
    `analise-gerencial.routes.ts` (GET /pcp/analise-gerencial/painel + POST
    /simular, empresaId explícito + moduloGuard PCP, registrado em server.ts);
    frontend `/pcp/analise-gerencial/page.tsx` (cards CM/CF/PE/cobertura/resultado
    + simulador 80/100/120%) + item no ModuleSidebar. `npm run build` do front
    PASSOU (rota gerada). Status "ganho" = APROVADO (confirmado no enum).
  - ✅ Task 5 (pós-cálculo + DRE) CONCLUÍDA: motor `calcularPosCalculo` +
    `confrontarDRE`; rota GET /pcp/analise-gerencial/pos-calculo (vincula
    orçamento→OP por pedidoVendaId, agrega produção, marca "sem realizado");
    confronto DRE embutido no painel (resultado contábil = Σ receitas − Σ
    despesas por competência de ContaReceber/ContaPagar; null-safe se indispon.).
    Frontend: seção Pós-Cálculo + card Confronto DRE. Testes **29/29**. Build
    front OK. NOTA: custo realizado NÃO é persistido no PCP — pós-cálculo compara
    QUANTIDADE (real) e valor previsto proporcional à produzida (com aviso).
  - BLOCO 4 = COMPLETO (tasks 1–5). Todos os 4 blocos do plano Calcgraf feitos.
- Fórmulas da camada 2 do orçamento decompostas/validadas em
  `docs/calcgraf-formulas-decompostas.md` (2 golden cases + markup gross-up).

## Por que bater os valores da camada 2 é difícil (registrar sempre)

Os cálculos de ORÇAMENTO estão no CÓDIGO-FONTE DELPHI FECHADO do Calcgraf
(tempos de máquina, imposição/encaixe, perdas, arredondamentos, regras
condicionais, ordem de markup/CM) — invisíveis em tela/relatório e sem acesso ao
fonte. Solução: engenharia reversa por GOLDEN CASES (Bloco 2): pegar cálculos
reais (entrada→saída), reproduzir no Vizor com mesmas premissas, comparar
componente a componente, ajustar até ≤0,5% no valor unitário, congelar como teste
Vitest. As "Emissão de Pré-Cálculos" (memória de cálculo) aceleram muito.
O Mapa de Custos RKW (Bloco 3) NÃO tem essa dificuldade — aritmética aberta.

## Pendências do usuário (Bloco 0 — coleta no Calcgraf via RDP)
- 1-2 "Emissão de Pré-Cálculos" (memória de cálculo detalhada).
- ~10 orçamentos reais variados (entrada + total/unit/margem/CM). Já temos 1: cálc. 15182.
- Export Tabela de Custos → Valores (máquina × valor-hora).
- Preços de Materiais (papel/bobina/tinta).

## Dúvidas menores a confirmar (não bloqueiam)
- Reconciliar totais de Custo Fixo entre versões do mapa (usar 1 "foto" oficial).
- "+0,08" nos pesos da chave "Quant. funcionários" (fração dos rateados).
- Como o "Estado" do bem (Ótimo/Bom/Regular) modula a depreciação.
