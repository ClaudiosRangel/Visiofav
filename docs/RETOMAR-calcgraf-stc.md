# RETOMAR — implementar importação do `CalculoSTC` (bater o motor item a item)

> Ponto de partida da próxima sessão sobre o orçamento gráfico / Calcgraf.
> Contexto completo em `.kiro/steering/migracao-calcgraf-carton-wega.md`
> (seção "🏆 ACHADO QUE RESOLVE DE VERDADE — tabela CalculoSTC").

## O que já está pronto e no ar
- "Puxar Cálculo" (repetição) funciona ponta a ponta: puxar → editar → salvar →
  enviar → aprovar → gera Pedido de Venda. Valor ao cliente = EXATO do Calcgraf
  via ANCORAGEM (`ancorarCustoCalcgraf`), validado em 12992/13296/11122/12540.
- Preço do papel resolvido pelo cadastro; StepRevisão alinhado; "Cálculo
  utilizado nº" exibido; tabela de preço padrão criada na Wega.

## O ACHADO (a virada)
A tabela **`CalculoSTC`** do Calcgraf (banco local restaurado `CalcgrafCartonWega`)
grava o **custo final de CADA componente, por cálculo** — não é fórmula/caixa-preta.
Para o 12992 a soma dos itens = **R$ 5.192,05 EXATO**:
papel 3.010,75 · impressão 732,79 · BOPP 581,82 · matriz 300 · guilhotina 155,38 ·
pantones 221,37 · laminação 100 · cortadeira 89,94.
Colunas úteis: `Codigo` (= max Codigo do NumCalculo), `CodigoItc`, `Descricao`,
`ValorTotal` (custo final), `QuantFixa`, `QuantVariavel`, `ValorCm`,
`ManValorUnitario` (−1 = não editado), `AliqCredIcms/Ipi`. Classificação do item
pelo `Itc.Origem` (join `Itc.Codigo = CalculoSTC.CodigoItc`):
SUPORTE=papel · TINTA=tinta · CENTRO DE CUSTO=máquina (CT) ·
MAT.ACABAMENTO/MATRIZ IMPRESSÃO=Material Direto.

## O QUE DIZER NA NOVA SESSÃO (copie/cole)
> "Implementar a importação do CalculoSTC do Calcgraf para o orçamento gráfico,
> conforme docs/RETOMAR-calcgraf-stc.md e a seção CalculoSTC do steering
> migracao-calcgraf-carton-wega.md. Objetivo: o item puxado mostrar e recalcular
> a decomposição real (papel/tinta/impressão/acabamentos) com o custo de cada
> componente vindo do CalculoSTC, batendo item a item com o Calcgraf. Validar no
> 12992 (soma = R$ 5.192,05). Manter a ancoragem como rede de segurança."

## ✅ ESTADO (implementado — falta só gravar em produção + validar na API)
Implementado nesta sessão (back, LOCAL/não commitado conforme política do usuário):
1. **Schema**: coluna `CalculoGrafico.custosCalcgraf` (Json, `custos_calcgraf`) +
   `migrate-prod.ts` idempotente (`ADD COLUMN IF NOT EXISTS`). Roda no deploy.
2. **Exportador** (`scripts/exportar-engenharia-calcgraf.mjs`): bloco `custosCalcgraf`
   por cálculo lendo `CalculoSTC` + `Itc.Origem` (MD/CT + componentes). VALIDADO
   no 12992: MD 4.113,94 + CT 1.078,11 = **5.192,05 EXATO**.
3. **Gravador** (`scripts/gravar-engenharia-real.mjs`): grava `custos_calcgraf`
   no `calculo_grafico` (flag `--arquivo <json>` para alvo único; resumo mostra
   `custosCalcgrafStc`).
4. **Backend**: módulo puro `calculo-grafico/decomposicao-stc.service.ts`
   (`aplicarDecomposicaoStc`/`normalizarCustosStc`/`limparDescStc`). A
   `ancorarCustoCalcgraf` (orcamento-grafico.routes.ts) agora, além de ancorar o
   TOTAL, projeta MD/CT + detalhe por componente (papel/tinta por cor/máquinas/
   acabamentos) no `resultado` do item puxado — bate ITEM A ITEM.
5. **Testes**: `decomposicao-stc.service.test.ts` (golden 12992 + não-regressão +
   fast-check) — **14/14**. Suíte orcamento-grafico inteira: **242 passed** (0 falhas).

### ✅ GRAVADO EM PRODUÇÃO (26/10/2026)
- Coluna `custos_calcgraf` criada no Neon (`ADD COLUMN IF NOT EXISTS`).
- Export completo (`exportar-engenharia-calcgraf.mjs`) + grava via
  **`scripts/gravar-custos-stc.mjs`** (dedicado, UPDATE em lote `FROM (VALUES)`,
  ~1 min) → **7.926/7.951** cálculos com `custos_calcgraf` (25 sem linha STC).
  VERIFICADO: 12992 soma 10 componentes = **5.192,05 EXATO** no banco.
- API (código antigo no ar): puxar 12992 → item `custoProducao` = 5.192,05
  (ancoragem OK). A decomposição item a item (MD 4.113,94/CT 1.078,11 +
  `resultado.custosCalcgraf`) entra ao DEPLOYAR o backend novo (hoje o recalc usa
  motor antigo MD 3.870,22/CT 975,63). Provado pelos 14/14 testes locais.

### FALTA
- **Deploy**: commit único com `schema.prisma` + `migrate-prod.ts` + código
  (decomposicao-stc.service.ts, ancoragem, exportador/gravador). Push → Render.
- **Reconferir na tela** após o deploy (puxar 12992, abrir item, ver a
  decomposição com papel 3.010,75 / tintas 221,37 / Roland 732,79 / ... ).
- **Front** (opcional): a seção "Decomposição do Custo" já lê MD/CT/C.Prod; o
  detalhe por componente vem em `resultado.custosCalcgraf` (exibir se quiser o
  quadro completo estilo memória Calcgraf).

## PLANO DE IMPLEMENTAÇÃO (passos)
1. **Exportador** (`scripts/exportar-engenharia-calcgraf.mjs` — já traz etapas/
   matriz/BOPP): adicionar um bloco `custosStc[]` por cálculo lendo
   `CalculoSTC` + `Itc.Origem`. Query base (por cálculo, Codigo = max por NumCalculo):
   `SELECT s.CodigoItc, i.Origem, s.Descricao, s.ValorTotal, s.QuantFixa,
    s.QuantVariavel, s.ValorCm FROM CalculoSTC s LEFT JOIN Itc i ON i.Codigo=s.CodigoItc
    WHERE s.Codigo IN (<lote>)`.
2. **Gravador** (`scripts/gravar-engenharia-real.mjs`): gravar os custos reais do
   STC no `calculo_grafico` — decidir destino: (a) campos do resultado/engenharia
   (papel.custo, tinta por cor, acabamentosRicos com custo fixo, itensDiversos p/
   matriz/BOPP), OU (b) um JSON `custosCalcgraf` no cálculo que o motor usa como
   fonte de verdade por componente. Preferir que o item PUXADO nasça com esses
   custos e o recálculo os preserve (NÃO deixar o motor recalcular por cima —
   usar os valores STC como âncora POR COMPONENTE, não só total).
3. **Backend** (`orcamento-grafico.routes.ts`): no `de-calculo`/`/calcular`/PUT,
   quando o item tem origem com custos STC, usar a decomposição real (MD/CT/
   componentes) do STC em vez do motor cru. A função `ancorarCustoCalcgraf` já
   ancora o TOTAL; estender para ancorar também MD/CT/itens por componente.
4. **Validar** 12992 pela API: cada componente + soma = R$ 5.192,05. Depois rodar
   o lote dos 7.951 (export sem `--numero` + grava).

## ARMADILHAS (não repetir)
- **sqlcmd**: NÃO usar `-W -s "|"` (corrompe a saída com o título do terminal).
  Usar `-i arq.sql -o arq.out` SEM `-s`, ou `pg` direto num `.mjs` quando em lote.
- Acesso ao SQL Server local: `sqlcmd -S localhost -E -C -d CalcgrafCartonWega`
  (`-C` obrigatório; `-u` p/ acentos UTF-16→UTF-8 nos exports). Via SSMS/Azure
  Data Studio: servidor `localhost`, Autenticação Windows, marcar "Certificado do
  Servidor de Confiança".
- **Máquina trava**: `npx tsx`/`tsc`/`node` interativo travam. Usar
  `control_pwsh_process` (background) + `get_process_output`; validar com
  `get_diagnostics`. Produção via `pg` direto. Terminal reusado às vezes NÃO
  reexecuta — se a saída não mudar, pare o terminal e abra um novo.
- **DATABASE_URL Neon** (fora do git): está no steering (bloco do pooler). Pooler
  derruba conexão (ECONNRESET/ETIMEDOUT) — retry; se DNS falhar, repetir.
- Empresa Wega (produção Neon): `75848e24-742e-461d-b913-1642c5b83ae9`.
  Login API de teste: admin@visiofab.com / 987123 → selecionar a Wega.
- Scripts temporários prefixo `_tmp-`, REMOVER após uso. Limpar orçamentos de
  teste com `scripts/limpar-orcamentos-wega.mjs`.
- `cartoon/` é gitignored (dados sensíveis) — o JSON de export NÃO sobe ao git.

## CUIDADO DE NÃO-REGRESSÃO
A ANCORAGEM atual (total) já entrega diferença ZERO ao cliente. A importação do
STC é REFINAMENTO (decompor e recalcular item a item). Garantir que ao adicionar
o STC o valor final continue batendo (não introduzir divergência). Validar 12992
a cada passo antes do lote.
