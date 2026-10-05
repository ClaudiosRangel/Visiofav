# Requirements Document

PCP: Planos de Produção, Frente/Costa e Requisição de Corte (RC)

## Glossary

- **OS/OP**: Ordem de Serviço / Ordem de Produção (usados como sinônimos aqui).
- **Plano**: componente de uma OS gráfica (ex.: TAMPA, CAIXA, BOLSA), cada um
  com formato, cores, tiragem e roteiro de acabamento próprios.
- **FACE**: tipo de plano para impressão em retiração (FRENTE/COSTA).
- **RC**: Requisição de Corte de Cartão (formulário FO-002/PCP).
- **planoId NULL**: etapa sem plano = "plano único", comportamento legado.

## Introduction

Este documento especifica três ajustes no módulo PCP do Vizor, pedidos pela
Carton Wega, para que o painel de Programação reflita fielmente a estrutura
de uma OS gráfica real do GPrint/Calcgraf:

1. **Planos de produção** — uma mesma OS pode ter vários "planos"
   (ex.: TAMPA, CAIXA, BOLSA), cada um com seu próprio formato, cores,
   tiragem e **roteiro de acabamento independente**. Hoje o Vizor achata
   todas as etapas numa lista única por OP, perdendo a noção de a qual
   componente cada etapa pertence.
2. **Frente e Costa** — trabalhos impressos em retiração (tira-retira), onde
   a mesma folha passa duas vezes na impressora. Detectado quando a coluna
   Cores é `NxM` com N≠0 e M≠0 (ex.: `7x5`), tipicamente com a tiragem
   expressa como `qtd x 2`. Deve gerar dois planos tipo FACE (FRENTE/COSTA)
   dentro da MESMA OP (número único — sem duplicar a OP).
3. **Requisição de Corte (RC)** — formulário de qualidade (FO-002/PCP) para
   solicitar corte de cartão, criado a partir da aba Cortadeira do painel,
   com os campos do documento padrão da Carton Wega e geração de PDF
   imprimível (1ª via).

### Restrições de projeto (CRÍTICAS — módulo em produção com cliente real)

- O módulo PCP **já está em uso em produção** (Carton Wega). Nenhuma mudança
  pode quebrar OPs já importadas, apontamentos existentes, filas ajustadas
  manualmente ou o fluxo de conclusão de OP.
- **Compatibilidade retroativa obrigatória**: etapas antigas ficam com
  `planoId = NULL` ("plano único / sem plano") e devem continuar funcionando
  exatamente como hoje, sem mudança visual nem de comportamento.
- **Não haverá migração automática** de OPs antigas para planos. A única via
  de organizar uma OP antiga em planos é **reimportar o PDF** (fluxo que já
  existe, com todas as travas de confirmação atuais preservadas).
- A OP continua sendo **um único registro** (número único, 1 cliente, 1
  entrega, 1 pedido, 1 NF-e). Planos NÃO duplicam a OP.
- Alteração de `schema.prisma` exige atualização idempotente do
  `migrate-prod.ts` no mesmo commit (regra do projeto).
- Toda query nova respeita isolamento multi-tenant por `empresaId`
  (direto ou via relacionamento com a OP).

---

## Requirements

## Requisito 1 — Modelo de dados de Plano de Produção

**User Story:** Como sistema, quero representar os planos de uma OS e vincular
cada etapa ao seu plano, para que o roteiro de acabamento de cada componente
seja controlado de forma independente sem quebrar o legado.

### Critérios de Aceitação

1. QUANDO o schema for alterado, ENTÃO DEVE existir um model
   `PlanoOrdemProducao` com: `id`, `ordemProducaoId` (FK, cascade delete),
   `empresaId`, `nome` (ex.: "TAMPA", "FRENTE"), `tipo`
   (`COMPONENTE | FACE`), `formato` (nullable), `cores` (nullable),
   `tiragem` (Decimal nullable), `montagem` (nullable),
   `faceDeId` (FK nullable para o próprio model — a COSTA aponta para a
   FRENTE), `sequencia` (Int), timestamps.
2. QUANDO o schema for alterado, ENTÃO `EtapaOrdemProducao` DEVE ganhar um
   campo `planoId` (FK **nullable** para `PlanoOrdemProducao`,
   `onDelete: SetNull`).
3. QUANDO uma etapa tiver `planoId = NULL`, ENTÃO ela DEVE ser tratada como
   "sem plano / plano único" em toda a lógica (painel, conclusão, filas).
4. QUANDO o `migrate-prod.ts` rodar, ENTÃO DEVE criar a tabela
   `plano_ordem_producao` e a coluna `plano_id` em `etapa_ordem_producao`
   de forma idempotente (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT
   EXISTS`, FK em try/catch), sem perder dado existente, e rodar 2× sem erro.
5. QUANDO uma OP for excluída, ENTÃO seus planos DEVEM ser excluídos em
   cascata; QUANDO um plano for excluído, ENTÃO as etapas vinculadas DEVEM
   ter `planoId` setado para NULL (nunca excluir a etapa por tabela).

---

## Requisito 2 — Parser do GPrint extrai planos e amarra etapas

**User Story:** Como usuário que importa o PDF de OP, quero que o sistema
reconheça cada linha da tabela "Plano" como um plano separado e distribua as
etapas de acabamento para o plano correto, para que o painel mostre o roteiro
de cada componente.

### Critérios de Aceitação

1. QUANDO o PDF tiver a tabela "Plano" com múltiplas linhas (ex.: TAMPA,
   TAMPA (M), CAIXA, CAIXA (M), BOLSA), ENTÃO o parser DEVE retornar um array
   `planos[]`, cada item com `nome`, `formato`, `cores`, `tiragem`,
   `montagem` e as `etapas[]` daquele plano.
2. QUANDO uma linha de plano tiver a coluna Acabamento preenchida, ENTÃO as
   etapas descritas (ex.: "Cortadeira (Grande), Guilhotina maior, Verniz,
   SG (Laminadora), Dayuan (Corte e Vinc), Destacar") DEVEM ser associadas
   APENAS a esse plano.
3. QUANDO o PDF tiver um único plano (OS simples atual), ENTÃO o parser DEVE
   continuar retornando as etapas como hoje, com um único plano implícito
   (ou lista achatada compatível) — SEM REGRESSÃO no comportamento atual.
4. QUANDO a coluna Cores de um plano for `NxM` com N≠0 e M≠0 (ex.: `7x5`),
   ENTÃO o parser DEVE marcar esse plano como candidato a frente/costa
   (ver Requisito 3).
5. QUANDO qualquer regex do parser for alterado, ENTÃO o script de regressão
   `scripts/testar-todos-pdfs-op.ts` DEVE ser rodado antes e depois e a
   contagem de etapas de cada PDF versionado NÃO pode regredir sem intenção.
6. QUANDO o parser for alterado, ENTÃO DEVE haver testes unitários cobrindo:
   OS multi-plano (3 planos), OS de plano único (não-regressão) e OS
   frente/costa (`7x5`).

---

## Requisito 3 — Frente e Costa (planos tipo FACE)

**User Story:** Como impressor, quero ver a frente e a costa de um trabalho
de retiração como duas passagens distintas no painel, para apontar e concluir
cada passagem separadamente, sem que isso crie uma segunda OP.

### Critérios de Aceitação

1. QUANDO um plano for detectado como frente/costa (Cores `NxM`, N≠0, M≠0),
   ENTÃO na confirmação da importação DEVE gerar dois planos tipo `FACE`:
   "FRENTE" (cores `Nx0`) e "COSTA" (cores `Mx0`), com a COSTA tendo
   `faceDeId` apontando para a FRENTE.
2. QUANDO a tiragem vier como `qtd x 2`, ENTÃO ambos os planos FACE DEVEM
   receber a mesma tiragem base `qtd` (não duplicar a quantidade da OP).
3. QUANDO os dois planos FACE forem criados, ENTÃO a OP DEVE permanecer com
   um único `numero` (sem violar `@@unique([empresaId, numero])`).
4. QUANDO o painel exibir uma OP com planos FACE, ENTÃO DEVE mostrar cada
   face como uma linha própria (ex.: "OP 2.849 · FRENTE", "OP 2.849 · COSTA"),
   cada uma com fila/apontamento/conclusão independentes.
5. QUANDO a OS NÃO for de retiração (Cores `Nx0`), ENTÃO nenhum plano FACE
   DEVE ser criado (comportamento normal, 1 plano COMPONENTE ou nenhum).

---

## Requisito 4 — Painel de Programação exibe o plano

**User Story:** Como operador, quero ver a qual plano cada etapa pertence no
painel, para não confundir a Cortadeira da TAMPA com a Cortadeira da CAIXA.

### Critérios de Aceitação

1. QUANDO uma etapa tiver `planoId`, ENTÃO o painel DEVE exibir o nome do
   plano junto da OP (ex.: "OP 3.133 · CAIXA") como um badge/sufixo.
2. QUANDO uma etapa tiver `planoId = NULL` (legado), ENTÃO o painel DEVE
   exibi-la exatamente como hoje, sem badge de plano e sem alteração visual.
3. QUANDO várias etapas da mesma OP e mesmo centro pertencerem a planos
   diferentes, ENTÃO cada uma DEVE aparecer como uma linha independente na
   fila daquele centro.
4. QUANDO todas as etapas de todos os planos de uma OP estiverem CONCLUÍDAS,
   ENTÃO a conclusão automática da OP (integração WMS) DEVE disparar
   exatamente como hoje — a regra `every(status === CONCLUIDA)` abrange todas
   as etapas independente de plano.
5. QUANDO o endpoint do painel (`GET /pcp/programacao/painel`) retornar
   etapas, ENTÃO DEVE incluir os dados do plano (nome, tipo) de forma
   performática (sem N+1), filtrando por `empresaId` da OP.

---

## Requisito 5 — Reimportação cria/atualiza planos com segurança

**User Story:** Como usuário, quero reimportar o PDF de uma OS já existente
para organizá-la em planos, com as mesmas travas de confirmação que já
existem, para não destruir produção em andamento por acidente.

### Critérios de Aceitação

1. QUANDO uma OP for reimportada, ENTÃO a substituição total existente DEVE
   também recriar os planos a partir do novo PDF (apagar planos antigos e
   recriar), mantendo todas as travas atuais de confirmação
   (`CONFIRMACAO_NECESSARIA`, bloqueio de CONCLUIDA/CANCELADA, aviso de
   apontamentos descartados).
2. QUANDO a reimportação apagar e recriar etapas, ENTÃO cada etapa recriada
   DEVE ser vinculada ao plano correto do novo PDF.
3. QUANDO a OP estiver CONCLUIDA ou CANCELADA, ENTÃO a reimportação DEVE
   continuar bloqueada (nenhuma mudança nesse comportamento).
4. QUANDO não houver reimportação, ENTÃO OPs antigas DEVEM permanecer
   intocadas (planoId NULL em todas as etapas).

---

## Requisito 6 — Requisição de Corte (RC)

**User Story:** Como requisitante na Cortadeira, quero criar uma Requisição
de Corte de Cartão a partir do painel, preencher os campos do formulário
padrão e imprimir a 1ª via, para formalizar o pedido de corte.

### Critérios de Aceitação

1. QUANDO o schema for alterado, ENTÃO DEVE existir um model
   `RequisicaoCorte` com: `id`, `empresaId`, `numero` (ex.: "49/2026"),
   `ordemProducaoId` (FK nullable), `dataSolicitacao`, `dataCorte`
   (nullable), `requisitante`, `fabricanteCartao`, `fornecedor` (nullable),
   `larguraBobinaCm`, `gramaturaG`, `tamanhoCorteCm`, `formatoCorte`,
   `qtdFolhasCortadeira`, `textoGuilhotina` (nullable),
   `qtdFolhasGuilhotina` (nullable), `nomeProduto`, `nomeServico`, `pesoKg`,
   `instrucoesRefile` (Text), `status`, `criadoPorId`, timestamps.
2. QUANDO o `migrate-prod.ts` rodar, ENTÃO DEVE criar a tabela
   `requisicao_corte` de forma idempotente, rodando 2× sem erro.
3. QUANDO o usuário clicar "Adicionar RC" na aba Cortadeira, ENTÃO DEVE abrir
   um formulário com todos os campos do documento FO-002/PCP, com o
   `numero` sugerido automaticamente no formato `NN/AAAA` (sequencial por
   empresa/ano).
4. QUANDO o usuário salvar a RC, ENTÃO DEVE persistir via rota backend
   filtrada por `empresaId`, retornando o registro criado.
5. QUANDO o usuário clicar "Salvar e Imprimir", ENTÃO DEVE gerar um PDF
   (pdfkit) fiel ao formulário FO-002/PCP com o selo "1ª via", servido para
   abertura/impressão.
6. QUANDO a RC referenciar uma OP, ENTÃO o vínculo DEVE ser opcional (RC
   avulsa também é válida).
7. QUANDO uma RC já existir, ENTÃO DEVE ser possível listá-la, reabrir e
   reimprimir (CRUD mínimo: criar, listar, obter, imprimir; editar/excluir
   desejáveis).

---

## Fora de escopo (desta spec)

- "Organizar em planos sem reimportar" (Caminho 2) — descartado pelo usuário.
- Migração automática em massa de OPs antigas para planos.
- Duplicação real da OP para frente/costa (decidido: 1 OP + planos FACE).
- Cálculo de consumo/custo por plano (segue o cálculo atual da OP).
- Alteração do fluxo fiscal/NF-e (continua 1 nota por OP).
