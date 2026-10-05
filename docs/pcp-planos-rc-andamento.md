# PCP — Planos / Frente-Costa / RC — ANDAMENTO (continuidade entre sessões)

> Documento de continuidade. Spec: `.kiro/specs/pcp-planos-frente-costa-rc/`.
> Módulo PCP em PRODUÇÃO (Carton Wega tem dados reais). Testes na empresa
> **VisioFab Demo** (`empresaId 59512845-a692-4429-ace4-627566065fd4`).
> NUNCA tocar a Carton Wega. PDF de teste real: `OP-3133.pdf` (raiz do back).

## Decisões do cliente (firmes)

1. **RC (Requisição de Corte)** — formulário FO-002/PCP. É uma "OP avulsa de
   corte". Botão RC **só nos grupos CORTADEIRA**. Aparece como linha na fila
   do grupo onde foi criada (coluna `centro_producao_id`), arrastável,
   ações iniciar(EM_CORTE)/reimprimir/concluir(CORTADA)/excluir, tudo sem
   refresh (atualização local otimista). Numeração NN/AAAA por empresa/ano.
2. **Planos (OS multi-componente: TAMPA/CAIXA/BOLSA)** — modelo **OPÇÃO 2**:
   cada operação do PDF que atende vários planos é DESMEMBRADA em UMA ETAPA
   POR PLANO (controle individual de iniciar/concluir por plano). A OP só
   conclui quando TODAS as etapas de TODOS os planos fecharem (regra
   `every(CONCLUIDA)` já existente).
3. **Layout pai/filho no painel** (desenho do usuário):
   - Em CADA centro: linha-PAI da OP (sem ações, mostra OP + totais = soma
     dos filhos) + SUBITENS por plano (ações habilitadas).
   - Pai aparece EXPANDIDO, podendo recolher. Arrastar o pai leva os filhos.
   - Cada SUBITEM mostra os dados do SEU plano: tiragem, cartão/material,
     gramatura, formato, peso.
4. **Material correto por plano** (ponto do Caio): o cartão é o PRINCIPAL do
   plano (NZ Fibra Longa 200/235, Billerud Board 225), NÃO o "Micro Pardo"
   do plano "(M)" de acoplagem.
5. **Tiragem correta por plano** (ponto do Caio): TAMPA=1375 (aprov 4),
   CAIXA=2750 (aprov 2), BOLSA=2750 (aprov 4). Pai = soma.

## O que JÁ está FEITO e no ar (commitado em main, deploy auto)

### Backend (VisioFab.Wms.Back) — repo github ClaudiosRangel/Visiofav
- Schema: `RequisicaoCorte` (+ `posicao_fila`, `centro_producao_id`),
  `PlanoOrdemProducao` (+ `material/gramatura/peso_kg/aproveitamento`),
  `EtapaOrdemProducao.plano_id` (nullable, SetNull) e `planos_nomes`.
  migrate-prod.ts idempotente (testado 2x local; roda no deploy do Render).
- `requisicao-corte.routes.ts` + `requisicao-corte-pdf.service.ts` (pdfkit).
  Endpoints CRUD + iniciar/concluir/reabrir/reordenar + pdf. Registrado em
  server.ts (prefixo /api/pcp). Isolamento por empresaId explícito.
- `gprint-parser.ts`: `extrairPlanos` (tabela de processo) +
  `extrairMateriaisPorPlano` (tabela Plano/Material/Quant(Kg) — pega o
  material PRINCIPAL, ignora o (M)). Desmembra operação por plano via
  sufixo `(BOLSA,CAIXA,TAMPA)` → N etapas (`extrairPlanosDoSufixo` /
  `removerSufixoPlanos`). `maquina` da etapa desmembrada = nome-base LIMPO
  (sem sufixo de plano) → nome do centro correto. 15/15 testes; script de
  regressão `scripts/testar-todos-pdfs-op.ts` (14 PDFs, 0 regressão).
- `importacao-op.routes.ts`:
  - NUNCA descarta etapa silenciosamente: só pula se `vinculoCentro.desmarcada
    === true`. Senão cria a etapa (com ou sem centro).
  - Resolve/cria centro por: nomeEditado → etapa.maquina → etapa.descricao
    (à prova de falhas). tipoProcesso inferido do tipo da etapa
    (CORTADEIRA/IMPRESSAO/COLAGEM/VERNIZ) com fallback ACABAMENTO.
  - Cria `PlanoOrdemProducao` (com material/gramatura/peso/aprov) e vincula
    `planoId` nas etapas pelo `planoNome`. FACE p/ frente-costa.
  - Reimportação apaga/recria planos junto (deleteMany).
- `etapa-operacional.routes.ts` (painel): expõe `plano` por etapa com
  `{ id, nome, tipo, tiragem, material, gramatura, pesoKg, formato, montagem }`.
  RCs ABERTA/EM_CORTE anexadas aos centros (por `centroProducaoId`).
  Endpoint `/programacao/reordenar-fila-cortadeira` (reordena etapa+RC juntos).

### Frontend (VisioFab.Wms.Front) — repo ClaudiosRangel/Visiofav-Front-
- `pcp/importar-op/page.tsx`: preview preenche `maquina` com nome do PDF
  (não deixa vazio); fallback na confirmação; flag `desmarcada`.
- `pcp/programacao/page.tsx`:
  - RC na fila (modal, intercalada, drag combinado, ações sem refresh).
    Botão RC só em CORTADEIRA.
  - Badges de plano nas etapas.
  - `agruparFilaPorOp()`: insere linha-PAI por OP + subitens. Aplicado nos
    DOIS ramos (Cortadeira e Impressão/Acabamento).
  - Colunas tiragem/cartão/gramatura/formato/kg priorizam `etapa.plano?.*`.

## PENDÊNCIAS / BUGS CONHECIDOS (continuar aqui)

1. **BUG ATUAL (investigando): "várias Cortadeiras".** No teste da OP-3133 na
   VisioFab Demo apareceram 3 cards "Cortadeira" separados, cada um com 1
   plano (BOLSA / CAIXA / TAMPA), em vez de 1 card Cortadeira com os 3
   filhos. Suspeita: as 3 etapas de Cortadeira caíram em centros DIFERENTES
   (há vários centros tipo CORTADEIRA no cadastro — Doin/Coin/Makpel/Pequena,
   ou o parser/confirmação criou centros distintos). O correto: as 3 etapas
   "Cortadeira (Grande)" devem cair no MESMO centro. Verificar em qual
   `centro_producao_id` cada etapa da OP-3133 ficou e por quê. CARTÃO e
   TIRAGEM por plano JÁ estão corretos (pontos 1 e 2 do Caio resolvidos).
2. **Refinamento pai/filho (não feito):** o pai NÃO é recolhível ainda; o
   drag do pai NÃO leva os filhos juntos (cada filho arrasta individual).
   Usuário quer: expandido podendo recolher + arrastar pai leva filhos.
3. **4 operações sem plano por quebra de linha no PDF** (Dayuan, Fechadora
   de Caixa, Verniz, Bimac): o sufixo `(...)` quebrou em outra linha visual
   do texto reconstruído e o parser não amarrou o plano. Entram como etapa
   única sem badge. Refinar o parser p/ "costurar" linhas quebradas se o
   usuário pedir.

## Procedimentos usados nesta sessão (replicar)

- **Excluir OP 3133 da VisioFab Demo** (só leitura/escrita nessa empresa,
  guarda `if (!/visiofab/i.test(nome)) ABORTA`): script temp `_tmp-*` com
  `prisma.$queryRawUnsafe`/`$executeRawUnsafe`, DATABASE_URL de produção
  (Neon) passada só na env da execução (connection_limit=1&pool_timeout=30),
  deletando em cascata apontamento_etapa→etapa→plano→item→prog→log→OP, e
  centros com nome ruim vazios. SEMPRE remover o _tmp depois. Neon frio:
  1ª conexão dá timeout, repetir.
- Connection string de produção fornecida pelo usuário — NUNCA commitar,
  usar só via env na execução.
- Deploy: push na main (back e front repos separados). git push escreve no
  stderr e dá exit 1 no PowerShell mesmo com sucesso — confirmar pela linha
  `xxx..yyy main -> main` OU comparar `git rev-parse HEAD` vs `origin/main`.
- Verificação: `get_diagnostics`; `npm run build` (back = prisma generate;
  front = next build ~4min); testes do parser `npx vitest run
  src/modules/pcp/importacao-op/parsers/gprint-parser.test.ts --reporter=dot`.
