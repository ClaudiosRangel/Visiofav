# ESTADO CONSOLIDADO — Orçamento Gráfico (Carton Wega)

> Documento-mestre de continuidade. Atualizar ao fim de cada rodada. Serve para
> QUALQUER sessão retomar sem perder contexto. Última atualização: 03/10/2026
> (módulo de ACABAMENTOS — motor + golden 15.235 batendo, em andamento).

## ⭐ HANDOFF (ler PRIMEIRO numa nova sessão) — validação do 15.235 na tela

Empresa Carton Wega produção (Neon): `75848e24-742e-461d-b913-1642c5b83ae9`.
Connection via `$env:DATABASE_URL` (string no steering/sessão, NUNCA em git).
Login QA: admin@visiofab.com / 987123 (SUPER_ADMIN); selecionar Wega:
`POST /empresas/:id/selecionar` body `{}` → token novo. API prod:
`https://api.vizorerp.com.br/api`. Repos SEPARimport: back `VisioFab.Wms.Back`
(github ClaudiosRangel/Visiofav), front `VisioFab.Wms.Front` (Visiofav-Front-).

### Onde o fluxo de orçamento JÁ FUNCIONA (tudo em produção/commitado)
- Wizard calcula ponta a ponta (Cliente→Tipo→Medidas→Papel→Cores→Acabamentos→Revisão).
- Suportes (78) + vínculo preço→suporte (1.710) + TabelaMargem + ParametroPerda
  padrão TODOS semeados na Wega. StepPapel em 2 níveis (Suporte→Preço, só
  preço>0). StepAcabamentos lista 67 acabamentos com tempos do cadastro.
  Paginação 50 em todo o módulo. Schema de acabamentoRico com z.coerce.number.
- KBA Rapida 75 6cores (código KBA-75-6): `acertoPorCorMin=27` setado em prod
  (impressão calibrada → R$ 1.600 em vez de R$ 273).

### O QUE FALTA p/ o 15.235 bater EXATO na TELA (decisão do usuário: fazer A agora)
Golden alvo: `docs/calcgraf-golden-15235-acabamentos.md` — MD 6.598,70 / CT
3.814,80 / C.Prod 10.413,50 / preço 30,01% = 19.960,00 (tiragem 20.000).
O MOTOR já bate (testes ≤0,5%); a TELA depende de:
1. **Encaixe/imposição real** — deu 3 peças/folha; o golden é 4-up (TR 2x2,
   5.000 folhas). O cálculo do Vizor é GEOMÉTRICO (`calcularEncaixe`), não
   reproduz a imposição do Calcgraf. É a maior fonte de divergência (papel +
   folhas). SOLUÇÃO definitiva = catálogo de facas GCad (spec B). AJUSTE
   POSSÍVEL agora: permitir o usuário informar o aproveitamento/nº de poses
   manualmente OU ajustar a planificação do tipo "Cartuchos" p/ dar 4-up na
   folha 605×620. INVESTIGAR: fórmulas do tipo Cartuchos geram peça grande.
2. **Materiais de acabamento** (Cola Branca/Vegetal, Verniz Base D'Água Fosco,
   Caixa Padrão) NÃO existem no cadastro de Acabamentos — só "Faca Nova"
   apareceu. Sem eles o MD fica incompleto (~R$ 323 a menos). FAZER: cadastrar
   esses materiais como AcabamentoGrafico (MATERIAL_KG/MATERIAL_UN) na Wega, ou
   deixá-los selecionáveis no StepAcabamentos. Valores do golden: Cola 1,14 kg
   × 29,15; Verniz 5,63 kg × 24,2; Caixa Padrão 20 un × 7,7.
3. **Escolha da máquina de impressão no wizard** — hoje o cálculo pega a 1ª
   máquina IMPRESSAO por `posicao`; o golden exige a KBA-75-6. Se a KBA não for
   a 1ª, a impressão não calibra. FAZER: adicionar seletor de máquina no wizard
   (StepCores ou StepRevisao) e enviar `maquinaId` ao /calcular e POST /.
4. **Matriz de impressão** (KBA 5 PC × 35,2 = 176,00) — no golden entra no MD;
   verificar se está sendo contemplada.
5. **Tinta** — modelo SPANKS depende da cobertura; o golden tratou tinta como
   itens diretos (Escala 137,05 + Metálica 303,60 = 440,65). Na tela a tinta
   varia com a cobertura informada. Calibrar coberturas OU oferecer entrada
   direta de consumo.
6. Lembrar: tiragem 20.000 (não 10.000).

### SPEC B (próxima — multi-item) — NÃO começar sem o usuário pedir
Orçamento multi-item (PARTE 01 + PARTE 02…), como o 15.185 (Cartucho Composto —
caixa mãe + cartuchos, 4 suportes). Hoje 1 orçamento = 1 item. Levantamento do
fluxo em `docs/calcgraf-fluxo-manutencao-orcamento.md`. Também no backlog:
catálogo de facas GCad (encaixe real), restrições por acabamento. O usuário
pediu para deixar o multi-item como "B" e tratar depois.

### Golden 15.185 (2º caso, multi-item — para a spec B)
Print recebida: Cartucho Composto "Caixa Mãe p/ 12 cartuchos" 280×270×178,
PARTE 01 + PARTE 02, suportes Stora Enzo 191 + Micro Pardo 230, Heidelberg CD
5cores, tintas Escala, HotStamping, Cola Vegetal, Faca Nova etc. C.Prod
44.005,36 / Total 43.400,65. Transcrever para doc golden quando iniciar a spec B.

## 0. EM ANDAMENTO — Módulo de Acabamentos (spec orcamento-grafico-acabamentos)

Objetivo: Vizor emitir relatório IGUAL ao Calcgraf e bater valores. Golden alvo:
`docs/calcgraf-golden-15235-acabamentos.md` (pré-cálculo 15.235).

FEITO (NÃO commitado ainda — tudo local):
- **Motor** (`orcamento-grafico-calculo.service.ts`): tipos ricos de acabamento
  (`ItemAcabamentoRico`: HORA_MAQUINA | MATERIAL_KG | MATERIAL_UN | CUSTO_FIXO),
  bloco MAT.ACABAMENTO somado ao MD, cadeia de centros no CT. Estendido com
  `tempoFixoHoras`/`tempoVarHoras` DIRETOS no HORA_MAQUINA (paridade hh:mm do
  pré-cálculo — modo direto; sem eles, modo derivado via calcularCustoTransformacao).
  Aditivo: sem itens ricos, resultado idêntico ao congelado (testado).
- **Golden 15.235** passa ≤0,5%: `calibracao/golden-acabamentos-15235.{fixture,test}.ts`.
  MD 6598,79 / CT 3813,40 / CProd 10412,19 / Total 10425,73; margens 14.440/16.760/
  19.957; cada centro e material exatos. TINTA do caso modelada como itens diretos
  (itensDiversos) — consumo fino de tinta já calibrado no 15185. Suíte 108/108.
- **Schema**: model `AcabamentoGrafico` (VARCHAR p/ enums) + migrate-prod idempotente
  + relation em CentroProducao + `prisma generate` OK.
- **Rotas**: CRUD `GET/POST/PUT/DELETE /orcamento-grafico/acabamentos` (multi-tenant).

FEITO TAMBÉM (backend completo — rodada 2):
- **4.2** `/calcular` e `/simular-tiragens` aceitam `acabamentosRicos[]` e resolvem o
  cadastro por `acabamentoId` (`montarAcabamentosRicos` em orcamento-grafico.routes.ts;
  overrides do orçamento têm precedência sobre o cadastro).
- **4.3** `GET /:id/relatorio` → `orcamento-grafico-relatorio.service.ts`
  (`montarRelatorio`: seções cabeçalho/suporte/matriz/tinta/matAcabamento/impressão/
  acabamento/custoProducao/cev/margens).
- **5.1** `GET /:id/relatorio.pdf` → `orcamento-grafico-relatorio-pdf.service.ts`
  (pdfkit, layout do pré-cálculo).
- **6.1** fase `acabamentos` em `importar-calcgraf.ts` (lê Atividades.json ATIVO/FIXO,
  de-para CG-ACAB-<Codigo>, idempotente, --dry-run; guarda no main() p/ import seguro).
- **6.2** `scripts/calcgraf-acabamentos.test.ts` (naturezaDefaultAcabamento +
  de-para determinístico). Função pura em `calcgraf-dedup.ts`. Suíte 122 verde
  (corrigido: "coladeira" não vira MATERIAL_KG).

FEITO — Frontend (rodada 3) + COMMIT/PUSH:
- **7.1** tela `cadastros/acabamentos/page.tsx` (CRUD) + item "Acabamentos" no ModuleSidebar.
- **7.2** `StepAcabamentos.tsx` lê do cadastro `/acabamentos` (acabamentosRicos no
  WizardFormData; StepRevisao + salvar enviam ao backend; POST / resolve e persiste
  no resultadoCalculo).
- **7.3** botão "Relatório (Calcgraf)" no detalhe do orçamento → abre o PDF.
- COMMITADO: back `8edc07fdb..413f3b47e`, front `f9d029e..ac78fde` (deploy automático).

### ✅ 8.3 — Acabamentos importados em PRODUÇÃO com CUSTOS/TEMPOS REAIS (03/10/2026)
Deploy aplicado (tabela `acabamento_grafico` criada). Importados **67 acabamentos**
na empresa Wega `75848e24-...` (idempotente). CORRIGIDO o ponto levantado pelo
usuário: os custos/tempos NÃO precisam de default heurístico — EXISTEM no banco
Calcgraf e foram puxados:
- **Tempos de acerto + produção/hora**: tabela `CalculoAtividades` do SQL Server
  local (84k linhas, 53 atividades) → moda por atividade → `cartoon/export/
  CalculoAtividadesParams.json`.
- **Custo-hora por centro**: `Itc` (Origem='CENTRO DE CUSTO') + `TabelasCustoDetalhe`
  (Tabela de Custos **2**, coluna 1) → `cartoon/export/CentroCustoHora.json`.
- O importador (fase `acabamentos`) cruza por `codAtividade` e por nome e grava
  `producaoHora/quantAcertos/tempoPorAcertoMin/tempoPrimeiroAcertoMin/custoHora/
  unidadeBase`. Resultado em produção: 34 com tempos/produção reais, 26 com
  custo-hora real. Validado: Cortadeira 113,21/15min · Bobst E 300/150min ·
  Guilhotina 77,69 · AFT70 320/90min · Destacar 50 — TODOS batem o golden 15.235.
- Não sobrescreve calibração manual (só preenche campos nulos no update).
- Materiais (kg/un) e alguns centros sem match de nome ficam para ajuste na tela.
- Os JSONs de export ficam em `cartoon/` (gitignored — dados sensíveis); a lógica
  de enriquecimento está em `scripts/importar-calcgraf.ts` (commitável).

### ✅ 8.4 — Bug da busca de PAPEL na tela corrigido + sessão dos ACABAMENTOS esclarecida (03/10/2026)
Pontos levantados pelo usuário ao tentar criar o 15.235 na tela:
- **Papel não achava "Duplex/Triplex 280" (só mostrava "Accurate Freeze")**: BUG REAL
  no front. `StepPapel.tsx` carregava só os primeiros 50 papéis (de ~1.700) UMA vez e
  filtrava client-side — os alfabeticamente posteriores (Klabin Triplex 280 etc.) nunca
  apareciam. CORRIGIDO: busca server-side com `useDebouncedValue` (padrão do StepCliente),
  manda o termo digitado como `busca` ao backend `/precos-mp` (que já suportava
  `busca`+`limit`). Confirmado em produção: "Triplex 280" → 4 resultados incl.
  "Klabin Advanced Triplex 280" (preço 8,3, = o "DUPLEX 280" do golden). NOTA: no
  Calcgraf o nome é TRIPLEX, não DUPLEX — operador busca por "Triplex 280".
- **Acabamentos "Nenhum cadastrado" (passo 6)**: NÃO é bug de backend. Confirmado em
  produção que `GET /acabamentos` retorna 67 quando a Wega está selecionada no token
  (`POST /empresas/:id/selecionar` com body `{}` → token novo com empresaId Wega). O
  vazio na tela era SESSÃO (SUPER_ADMIN + sessionStorage por aba): a aba precisa ter a
  Wega efetivamente selecionada. Backend expõe `naturezaCusto` corretamente no select.
- Arquivo tocado: `VisioFab.Wms.Front/src/app/(interna)/orcamento-grafico/novo/StepPapel.tsx`.
  COMMITADO/pushed: front `ac78fde..e3f225d` (1ª tentativa) e `e3f225d..7f7f805` (fix definitivo).
- **CAUSA RAIZ DEFINITIVA (2ª rodada)**: a 1ª correção manteve o Mantine `Autocomplete`,
  que SEMPRE refiltra as `data` client-side pelo `value` digitado — mostrava sempre os
  mesmos "Accurate Freeze" (primeiros em memória). TROCADO por `Select searchable` com
  `filter={({ options }) => options}` (desliga o filtro client-side) + `searchValue`/
  `onSearchChange` ligados ao termo que vai ao backend. Agora o dropdown mostra EXATAMENTE
  o que o backend retornou. `value` = `papelId` (id, não descrição). Preserva seleção ao
  voltar o passo (injeta a option selecionada se não estiver na lista atual).
- Onde fica o CADASTRO de papel (resposta ao usuário): Orçamento Gráfico → Cadastros →
  Preços de Materiais (`cadastros/precos-materiais`, tabela `preco_materia_prima` tipo
  PAPEL) — essa tela já busca server-side corretamente.

### ✅ 8.5 — Encoding corrompido dos nomes de material corrigido em PRODUÇÃO (03/10/2026)
Usuário reportou nomes com `�` no cadastro ("Al�a Gorgur�o", "Couch� 115"). Causa: o
export JSON do SQL Server (`_tmp-exportar-calcgraf.mjs`) estragou acentos → 42
`PrecoMateriaPrima` gravados corrompidos. CORRIGIDO direto no banco de produção
cruzando com re-export CORRETO (`sqlcmd -u` UTF-16→UTF-8). 42/42 corrigidos
(Couchê, Alça, Gorgurão, Metálica, Ilhós, Botão, Pressão, Papelão, Paraná, Água,
Holográfico, Poliéster…), 0 ambíguos, 0 sem match. Verificado: 0 corrompidos restantes.
Scripts temporários (`_tmp-*`) removidos. Lição documentada no steering
`migracao-calcgraf-carton-wega.md`. (Confirmado também que NÃO existe "Duplex" no
cadastro — só "Triplex"; o papel do golden 15.235 é Triplex 280.)

PENDENTE (próxima sessão):
- **2.4** PBT opcional (custo fixo não escala / composição exata).
- **Validação final com o usuário**: criar o orçamento do 15.235 no Vizor
  produção (tipo cartucho + papel "Triplex 280" + cores + os acabamentos do cadastro,
  informando consumos/tempos) e abrir o Relatório (Calcgraf) para conferir lado a lado.
  Calibrar na tela os custos/tempos dos 67 acabamentos (semeados com default).
  Confirmar com o usuário que, após logout/login + reselecionar Wega + hard refresh,
  os acabamentos aparecem no passo 6.

### ✅ 9 — Spec orcamento-grafico-suporte-fechamento (paridade Suporte/Fechamento) — IMPLEMENTADA (local, 03/10/2026)
Após análise das telas reais do Calcgraf (orçamento + pré-cálculo 15.235 + Fechamento),
foi criada e implementada a spec `.kiro/specs/orcamento-grafico-suporte-fechamento`
(requirements+design+tasks). CAUSA RAIZ resolvida: o Calcgraf separa SUPORTE (tabela
`Suportes`, 78 regs, com CoefTinta — Duplex EXISTE aqui, cód 1051) de PREÇO do papel
(Itc/PrecoMateriaPrima). O Vizor fundia os dois no passo Papel; por isso "Duplex" não
aparecia e o CoefTinta do suporte não era aplicado. SEM mudança de schema (os 4 models
já existiam). Implementado (NÃO commitado — aguardando pedido do usuário):
- **Importador** (`scripts/importar-calcgraf.ts` + `calcgraf-dedup.ts`): função pura
  `mapearSuporte` (CG-SUP-<Codigo>, coefTinta, gramaturas, tipoSuporte derivado) +
  fase `suportes` (de-para idempotente, --dry-run, ignora inválidos) + `semearTabelaMargem`
  (CEV 17,75% = impostos 14,75 [ICMS 3+juros 2,5+PisCofins 9,25] + comissao 3; markup 30;
  preserva tabela ajustada à mão). Lê `Suportes.json` (PRIMÁRIO — tem CoefTinta real; o
  Full não tem). Roteado em `--fase suportes` | `--fase seed-margem`.
- **Backend** (`orcamento-grafico.routes.ts`): GET /precos-mp aceita filtro `suporteId`;
  bloqueios em /calcular e POST / (`validarPreCondicoesCalculo`): suporte sem preço PAPEL
  vinculado → 400; sem ParametroPerda → 400 (defesa em profundidade; motor puro intacto).
- **Frontend** (`novo/StepPapel.tsx`, `page.tsx`, `StepRevisao.tsx`): StepPapel em 2 níveis
  (Suporte → Preço vinculado por suporteId); suporteId/suporteNome no WizardFormData;
  bloqueio de avanço (canAdvance exige suporteId+papelId); suporteId enviado em salvar/
  calcular/simular. Alerta quando suporte sem preço.
- **Validação**: get_diagnostics limpo nos 6 arquivos; suíte orcamento-grafico **108/108**
  (não-regressão OK). Tarefas 1–5 (implementação) FEITAS; testes PBT (1.3-1.5, 2.2-2.3,
  3.2, 4.3, 6.x), golden 15.235 (8.1) e execução em produção (10.1, manual) são OPCIONAIS
  e ficaram pendentes. Req 6 (comissões por agente/juros) fora do MVP.
- ✅ COMMITADO: back `e7b9d4d24..693a8d9ee`, front `7f7f805..950bfb6` (deploy automático).
- ✅ EXECUTADO EM PRODUÇÃO (task 10.1, 03/10/2026): `--fase suportes --empresa 75848e24-...`
  criou **78 SuporteGrafico** (CoefTinta reais: Duplex 1,5 / Couchê 1,0 / Kraft Senges 2,2 /
  Triplex 1,5) + **TabelaMargem "Padrão Carton Wega (Calcgraf)"** (markup 30 + CEV 17,75% =
  impostos 14,75 + comissão 3). Idempotência confirmada (2ª exec: 0 criados/78 atualizados;
  margem no-op/preservada). Encoding de 3 suportes corrigido no banco (Couchê, Papelão Couro/
  Paraná). "Duplex" (CG-SUP-1051) agora aparece na tela. PENDENTE: usuário validar o 15.235
  na tela (Suporte "Duplex" → preço Triplex/Duplex 280 R$ 8,30 → cores → acabamentos →
  qtd 20.000) conferindo MD 6.598,70 / C.Prod 10.413,50 / preço 30,01% 19.960,00.

### ✅ 10 — Vínculo preço→suporte + paginação 50 + fix acabamentos no wizard (03/10/2026)
- **Vínculo preço→suporte**: fase `vincular-suportes` no importador (de-para
  `Itc.CodOrigem`→`Suportes.Codigo`); rodada em produção, **1.710 papéis
  vinculados** ao SuporteGrafico. Destravou o passo Papel (Suporte→Preço).
  Commit back `89c9c0c55`.
- **Paginação 50/página em TODO o módulo**: backend retorna `totalPages` em
  todas as 6 listagens (`/precos-mp`, `/suportes`, `/acabamentos`,
  `/tipos-embalagem`, `/tabelas-margem`, `/`), limit default 50, e
  `/parametros-perda` passou a ser paginado. Frontend: `Pagination` do Mantine
  (50/pág) em orçamentos + 6 telas de cadastro. Commits back `9a7d50209`,
  front `feb52ab`.
- **FIX acabamentos "Nenhum cadastrado"**: CAUSA RAIZ encontrada — o
  `StepAcabamentos.tsx` pedia `/acabamentos?limit=200`, mas o Zod do backend
  limita `limit` a `max(100)` → 400 silencioso (`.catch` zerava a lista). Os 67
  acabamentos ESTAVAM lá; era o limit 200 que estourava. Corrigido para 100
  (cobre os 67 numa página). Commit front `f8ccaa0`. **Lição**: nunca pedir
  `limit > 100` nas rotas do módulo (o Zod rejeita).
- Documento de levantamento do fluxo multi-item do Calcgraf criado:
  `docs/calcgraf-fluxo-manutencao-orcamento.md` (backlog: multi-item,
  restrições por acabamento, catálogo de facas GCad, UI de itens diversos).

### 🔴 HANDOFF PARA A PRÓXIMA SESSÃO (03/10/2026 — contexto cheio, retomar AQUI)

Estado: o fluxo do wizard de orçamento gráfico FUNCIONA ponta a ponta na tela
(Cliente→Tipo→Medidas→Papel→Cores→Acabamentos→Revisão calcula sem erro). Vários
bugs foram corrigidos nesta sessão (ver abaixo). FALTA fazer o 15.235 BATER EXATO
na tela e implementar o multi-item. Empresa Wega produção `75848e24-742e-461d-b913-1642c5b83ae9`.
Connection Neon via `$env:DATABASE_URL` (nunca commitar).

**JÁ CORRIGIDO nesta sessão (tudo commitado/pushed + aplicado em produção):**
- Vínculo preço→suporte (1.710 papéis) — fase `vincular-suportes` no importador.
- Paginação 50/página em todo o módulo (back `totalPages` + front `Pagination`).
- StepAcabamentos: limit 100 (era 200 → estourava Zod → lista vazia).
- Seed de ParametroPerda padrão na Wega (destrava o bloqueio Req 5.4 que dava
  "Dados inválidos" na Revisão). `scripts/importar-calcgraf.ts --fase seed-margem`.
- Bug "Expected number, received string": StepAcabamentos converte Decimals-string
  do cadastro p/ number + schema Zod com `z.coerce.number()` (back).
- Filtro `comPreco=true` em /precos-mp (StepPapel só lista papéis com preço>0; o
  "Klabin Advanced Triplex 280" genérico tem preço 0, os com bobina têm 8,30).
- StepRevisao exibe acabamentos ricos (centros CT + Mat.Acabamento MD).
- Máquina KBA-75-6 em produção: `acertoPorCorMin=27` (impressão calibrada do
  golden: 5 cores × 27 = 135min = 02:15 → R$ 1.600 em vez de R$ 273 legado).

**FAZER AGORA (ajustes que AFETAM o resultado — pedido do usuário "bater exato"):**
1. **Materiais de acabamento JÁ EXISTEM no cadastro** (confirmado 03/10: 44
   HORA_MAQUINA + 21 MATERIAL_KG + 2 MATERIAL_UN). Para o 15.235 use:
   - Cola → "Colagem Manual" (CG-ACAB-54, MATERIAL_KG) ou cadastrar "Cola Branca"
   - Verniz → "Verniz BA Fosco" (CG-ACAB-55, MATERIAL_KG) = Verniz Base D'Água Fosco
   - Caixa → "Caixa Padrão" (CG-ACAB-39, MATERIAL_UN)
   PORÉM: todos com `preco_unitario=null` (Calcgraf não exportou o preço do
   material de acabamento). Na tela o operador informa consumo (kg/un) E preço —
   OU cadastrar o preço nos AcabamentoGrafico. O usuário só viu a Faca Nova porque
   não rolou/marcou os demais (eles aparecem na lista, basta marcar). → DECIDIR:
   preencher `precoUnitario` desses materiais no cadastro (de onde? Itc
   Origem=MAT.ACABAMENTO tem preço — cruzar) ou deixar o operador digitar sempre.
2. **Escolha de máquina de impressão no wizard** — hoje o /calcular pega a 1ª
   máquina de impressão por `posicao`. O golden exige a KBA-75-6. Se a KBA não
   for a 1ª, a impressão não calibra. → Adicionar seletor de máquina no wizard
   (StepTipo ou StepRevisao) + enviar `maquinaId`. As máquinas de IMPRESSAO da
   Wega: HEID-CD5(440), HEID-CD7(550), KBA-75-6(480,acerto27), ROLAND-RVU4(140),
   ROLAND-RZU2(100), HEID-SM2(155), HEID-LETTER(155) + algumas sem vel/custo
   (códigos 19/2/10/21/39 — legados sem parâmetros, ignorar/inativar).
3. **Encaixe/imposição real** — o cálculo geométrico dá 3 peças/folha; o golden é
   4 (TR 2x2). Isso faz o PAPEL e as FOLHAS divergirem. É o item estrutural =
   catálogo de FACAS (GCad). Entra junto do multi-item (item B abaixo).
4. Tiragem: o usuário testou com 10.000; o golden é 20.000 (lembrar na validação).

**ITEM B — PRÓXIMA GRANDE SPEC (decisão do usuário): MULTI-ITEM + GCad**
Orçamento com várias PARTES (ex.: 15.185 "Caixa Mãe p/ 12 cartuchos" = PARTE 01 +
PARTE 02, 4 suportes). Hoje Vizor = 1 item/orçamento. Junto vem o catálogo de
FACAS/GCad (imposição real: dimensões/repetição/formato de corte/suporte por
modelo) — resolve o encaixe (item 3). Levantamento do fluxo multi-item do Calcgraf
em `docs/calcgraf-fluxo-manutencao-orcamento.md`. Golden composto: 15.185 (print
transcrever quando for implementar).

**Golden de item único (validar primeiro):** 15.235 em
`docs/calcgraf-golden-15235-acabamentos.md`. Alvo: MD 6.598,70 / CT 3.814,80 /
C.Prod 10.413,50 / preço 30,01% = 19.960,00 (tiragem 20.000, papel Triplex 280
R$ 8,30, 5 cores 5x0+V, 5 acabamentos HORA_MAQUINA + materiais). O MOTOR bate
≤0,5% nos testes (suíte orcamento-grafico 130 verde); a TELA depende dos itens
1-3 acima.

**Specs do módulo (todas feitas, exceto multi-item):**
- orcamento-grafico-acabamentos (motor + relatório) ✅
- orcamento-grafico-suporte-fechamento (suporte/preço/margem/perda) ✅ 130 testes
- orcamento-grafico-multi-item-gcad — A CRIAR (item B).

### Extensão do motor nesta rodada (importante)
`ItemAcabamentoRico` HORA_MAQUINA ganhou `tempoFixoHoras`/`tempoVarHoras`
DIRETOS (opcionais) — reproduzem os hh:mm do pré-cálculo exatamente; sem eles,
cálculo derivado (producaoHora/acertos) continua. `producaoHora`/`unidadeBase`
viraram opcionais. Aditivo, não-regressão mantida.

---


## 1. Visão geral do que foi construído (em ordem)

1. **Calibração Calcgraf (módulos puros + testes)** — CONGELADO
   - Custo de Transformação: `src/modules/orcamento-grafico/custo-transformacao.ts`
     (acerto-por-cor + produção × custo-hora). Doc: `docs/calcgraf-custo-transformacao.md`.
     Validado 52/53 cálculos ≤1% no CustoFixo.
   - Consumo de Tinta: `src/modules/orcamento-grafico/consumo-tinta.ts` (SPANKS +
     partida). Doc: `docs/calcgraf-consumo-tinta.md`. 15185: custo 1,3%.
   - Testes: `calibracao/golden-custo-transformacao.*`, `golden-consumo-tinta.*`,
     `golden-componentes.*` (papel), `golden-precos.*` (preço/decomposição).
   - COMMITADO (back `70d330ca1`).

2. **Finalização — integração ao motor + cadastros + vendedores** — CONCLUÍDA e COMMITADA
   - Spec: `.kiro/specs/orcamento-grafico-finalizacao/` (requirements+design+tasks,
     todas as tasks marcadas; 2.5 e 5.3 opcionais PBT ficaram pendentes).
   - Motor `orcamento-grafico-calculo.service.ts`: tinta→SPANKS e máquina→acerto-
     por-cor quando parâmetros presentes; fallback legado; flag `modeloCalculo`.
   - Schema: `CentroProducao` (acertoPorCorMin, tempoSetupMin), model
     `SuporteGrafico` (coefTinta), `PrecoMateriaPrima` (suporteId, gramatura,
     densidadeTinta). `migrate-prod.ts` idempotente (roda no deploy).
   - Rotas: CRUD `/orcamento-grafico/suportes`; `/calcular` e `/simular-tiragens`
     unificados lendo os campos novos; `/precos-mp` estendido; `/centros-producao`
     aceita acerto/setup.
   - Frontend: tela `cadastros/suportes/`, item no `ModuleSidebar`, campos de
     acerto/setup em `pcp/cadastros/centros/`, vínculo papel→suporte + densidade
     em `cadastros/precos-materiais/`.
   - Importador: fase `vendedores` em `scripts/importar-calcgraf.ts`.
   - Commits back `d29082891`, `6b6c18bdb` (fix revisão); front `3f650ea`.

3. **Encaixe gráfico (SVG, retângulo em grade)** — CONCLUÍDO e COMMITADO
   - Backend expõe `encaixe.layout` (colunas/linhas/dimensões/pinça).
   - Front: `src/app/(interna)/orcamento-grafico/novo/EncaixeVisual.tsx` desenha
     a folha + peças em tempo real no `StepRevisao`.
   - Commits back `5502a0ed6`, front `73bb815`; docs/steering `7a926781b`.

4. **Planificação visual (contorno da caixa aberta)** — CONCLUÍDA
   - Spec: `.kiro/specs/orcamento-grafico-planificacao-visual/` (requirements+design+tasks, tasks marcadas; 2.2 e 3.3 opcionais ficaram pendentes).
   - DECISÃO DO USUÁRIO: alvo **(a)** — desenho ESQUEMÁTICO paramétrico por
     família (cartucho, caixa, cartela) a partir de L×A×P + abas. NÃO é faca
     técnica real (b). É só visual (não muda custo/rendimento).
   - Backend: `TipoEmbalagem.gabaritoPlanificacao String?` (schema +
     migrate-prod `ADD COLUMN IF NOT EXISTS`); select + Zod POST/PUT de
     `/tipos-embalagem` estendidos.
   - Frontend: gerador puro `novo/planificacao-gabaritos.ts` (CARTUCHO/
     CAIXA_FUNDO_AUTO/CARTELA/RETANGULO); `EncaixeVisual.tsx` desenha o contorno
     (corte sólido + vinco tracejado) repetido na grade, respeitando orientação;
     `StepRevisao.tsx` monta a planificação por `useMemo` (leitura robusta das
     medidas por aliases L/largura/altura/profundidade); Select "Gabarito de
     planificação" no cadastro `cadastros/tipos-embalagem`.
   - Validação: suíte `orcamento-grafico` 81/81; diagnostics limpos.

## 2. Estado de commits

Etapas 1–3 commitadas e pushed. Etapa 4 (planificação visual) é o commit
corrente desta rodada — back `main` (schema+migrate+rotas+spec+docs) e front
`main` (gerador+EncaixeVisual+StepRevisao+cadastro).

## 3. PENDÊNCIAS conhecidas (ordem de prioridade)

1. **PBT opcionais** — 2.5 e 5.3 da finalizacao FEITAS (ver abaixo). Restam só
   2.2 e 3.3 da planificacao-visual (testes de UI puramente visuais).
2. **Refino tinta/CT** — densidade/constante da tinta e CT dos acabamentos (hoje
   só impressão calibrada no CT; acabamentos seguem legado) — exige +pré-cálculos.
3. **Validar orçamento em produção** — próximo passo combinado com o usuário:
   pegar um orçamento real do Calcgraf como base e gerar idêntico no Vizor em
   produção (empresa Wega `75848e24-...`), comparando componente a componente.

### ✅ Vendedores importados em PRODUÇÃO (02/10/2026)
`scripts/importar-calcgraf.ts --fase vendedores --empresa 75848e24-...`:
39 vendedores + 11 RepresentanteCredencial criados; 2ª execução idempotente
(0 criados, 39 intactos). Estado: 40 vendedores (39 import + 1 pré-existente),
32 placeholder `SEM-DOC`, 12 credenciais. Bug corrigido: enriquecimento tentava
gravar `telefone` (campo que o model Vendedor não tem) — removido (vendedor
existente agora só conta como `intacto`).

### PBTs adicionadas (02/10/2026)
- `src/modules/orcamento-grafico/calibracao/pbt-equivalencia-legado.test.ts`
  (Property 1): sem campos calibrados → sempre LEGADO; campos neutros (0) ≡
  ausentes (mesmo resultado). 600 runs.
- `scripts/calcgraf-dedup.ts` (funções puras extraídas do importador) +
  `scripts/calcgraf-dedup.test.ts` (Properties 4 e 5): de-para determinístico,
  normalização idempotente, não-sobrescrita de endereço. 8 propriedades.
- Suíte orcamento-grafico + PBTs: **91/91 verde** (eram 81 + 10 novas).

## 4. Armadilhas/decisões a lembrar

- Densidade de tinta default = **1,0** (NÃO 1,3) — foi o que calibrou no 15185.
- Custo-hora do Calcgraf = **Tabela de Custos 2** (vigente), não a 1 (antiga).
- Produtos/SKUs do Calcgraf: **fora de escopo** (decisão do usuário; `Produto` é
  compartilhado com PCP/produção).
- Build/tsc completos TRAVAM nesta máquina — validar por `get_diagnostics` + a
  suíte vitest (`npx vitest run src/modules/orcamento-grafico --reporter=dot`).
- Postgres local parado (precisa admin); migração roda em produção no deploy.
- git push no PowerShell: stderr + exit 1 mesmo com sucesso — confirmar pela
  linha `xxx..yyy main -> main`. DNS falha às vezes; retentar.
- Suíte orcamento-grafico: **81/81** (último estado verde).
