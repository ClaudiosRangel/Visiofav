# Migração Calcgraf/G-Print → Vizor (Carton Wega) — continuidade entre sessões

Este arquivo é carregado em toda sessão neste workspace para que NENHUMA sessão
se perca no projeto de migrar a Carton Wega do Calcgraf/G-Print (PHTech) para o
Vizor. Leia os documentos-mestre abaixo antes de agir neste tema.

## Documentos-mestre (fonte de verdade)

- Levantamento completo do Calcgraf: #[[file:docs/calcgraf-gprint-levantamento.md]]
- Plano de ação (blocos/prioridade/calibração): #[[file:docs/calcgraf-plano-de-acao.md]]
- Estudo de migração TOTAL + impacto de produtos: #[[file:docs/estudo-migracao-total-calcgraf.md]]

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
  1. TINTA isolada: `CalculoTintas` tem `codTinta` + `areaTinta` (cobertura %;
     ex. 15182: tinta 4=70%, 5=20%, 6=10%). O consumo kg = f(area impressa × %
     × rendimento). Rendimento vem do cadastro de tinta (Itc/tabela). Buscar o
     rendimento e validar vs motor `calcularTinta` (rendimentoM2Kg). BAIXO peso
     (~4% do custo) — o MD agregado JÁ bate; isto é refino.
  2. MÁQUINA/C.Transf: tempos em `CalculoAtvImpressao`/`CalculoAtvAcabamento`
     (confirmar unidade de tempo). Calcgraf dá tempo pronto; Vizor recalcula por
     velocidade/setup — calibrar por centro. É o componente que mais pode divergir
     ao gerar orçamento NOVO (quando não se tem o tempo pronto do Calcgraf).
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
