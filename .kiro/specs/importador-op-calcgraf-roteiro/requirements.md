# Requisitos — Importador de OP do Calcgraf: Roteiro, Variações e Materiais (Fase 2)

## Introdução

Esta é a **fase 2** do importador de OP do Calcgraf (agente desktop → Vizor,
Carton Wega). A fase 1 (spec `importador-op-calcgraf`, em produção) traz por OP
apenas cabeçalho, materiais básicos e lotes/entregas — as OPs chegam **sem
etapas (roteiro)** e **sem variações**.

A fase 2 estende o pipeline existente (reader do agente → payload HTTPS →
ingestão no backend) para que a OP importada pelo agente fique **idêntica a uma
OP importada por PDF** nas abas da tela de detalhe da OP (Etapas, Materiais,
Variações, Entregas), trazendo o roteiro de produção completo a partir do
CÁLCULO que originou a OP no Calcgraf.

Design técnico de referência: `design.md` (mesmo diretório). Mapeamento SQL
validado: `docs/calcgraf-mapeamento-roteiro-op.md` (golden case OP 3000,
cobertura ~98,8%).

### Decisões firmadas com o usuário (base dos requisitos)
1. Centro não encontrado por nome → **criar** o `CentroProducao` (regra idêntica
   ao importador de PDF).
2. Tintas → **texto** nas observações da OP (tag `[Cores]`), não viram item.
3. Materiais de acabamento → **entram** nesta fase como item (aba Materiais).

### Escopo e não-objetivos
- **Dentro**: etapas (com centro + tempos), variações/planos, papel/suporte e
  materiais de acabamento como itens, tintas como texto, idempotência por hash.
- **Fora**: cálculo de orçamento gráfico (preço/custo); vínculo formal de
  `Produto`; qualquer mudança no painel/telas (reusa o que já existe);
  reescrever a importação de PDF (coexiste). **Sem mudança de schema Prisma.**

---

## Requisito 1 — Leitura do roteiro no Calcgraf (reader do agente)

**User Story:** Como integrador da Carton Wega, quero que o agente leia o
roteiro completo (etapas, planos, materiais) do cálculo que originou cada OP, de
forma somente-leitura e segura, para que o Vizor receba a OP com todas as abas
preenchidas.

### Critérios de Aceitação
1. QUANDO o agente processa uma OP, ENTÃO o reader DEVE resolver o
   `CalculoHeader` correspondente via `OpItemEstrutura.Codigo =
   CalculoHeader.CodOpItemEstrutura`, usando o de **maior `Codigo`** (recálculo
   mais recente) quando houver mais de um.
2. QUANDO existe cálculo resolvido, ENTÃO o reader DEVE ler as etapas
   (`CalculoAtividades`), as variações/planos (`CalculoPlanos`), as tintas
   (`CalculoTintas`) e os materiais de acabamento (`CalculoMatAcabamento`) desse
   cálculo.
3. QUANDO lê etapas, ENTÃO o reader DEVE resolver o nome da operação
   (`Atividades.Nome`) e o nome do centro (`CentrosProducao.Nome`), ordenando
   por `itemSeq1, itemSeq2`.
4. QUANDO a OP **não possui cálculo** (`CalculoHeader` ausente — ~1,2% das OPs,
   avulsas), ENTÃO o reader DEVE manter o comportamento da fase 1 (cabeçalho +
   materiais básicos, SEM etapas), sem erro.
5. O reader DEVE emitir **somente comandos `SELECT`** (toda query passa por
   `assertSomenteLeitura`) e executar as consultas de forma **sequencial** (uma
   por vez; nunca `Promise.all`), por restrição do driver `tedious`.
6. As consultas DEVEM declarar o Application Name autorizado
   (`ExportadorMovimentos`) para passar pela logon trigger do Calcgraf.

---

## Requisito 2 — Cálculo de tempos das etapas (função pura)

**User Story:** Como PCP, quero que os tempos de setup e operação de cada etapa
venham calculados igual ao Calcgraf, para que a aba Etapas mostre Setup (min) e
Operação (min) corretos.

### Critérios de Aceitação
1. O **setup (min)** de uma etapa DEVE ser `quantAcertos * tempoPorAcerto +
   tempoPrimeiroAcerto`.
2. A **operação (min)** de uma etapa DEVE ser `tiragem / producaoHora * 60`.
3. QUANDO `producaoHora` é `0`, ausente ou inválida, ENTÃO a operação DEVE ser
   `0` (sem divisão por zero / sem `NaN`/`Infinity`).
4. O **nome/descrição** da etapa DEVE ser `"<Atividade.Nome> <CentroProducao.
   Nome>"` (com trim; cai para o que estiver disponível se um dos dois faltar).
5. As funções de cálculo DEVEM ser puras (sem SQL/IO), testáveis isoladamente, e
   bater com o golden case da OP 3000 (4 etapas, tempos conhecidos).

---

## Requisito 3 — Gravação de etapas no Vizor (com centro resolvido ou criado)

**User Story:** Como operador, quero ver as etapas da OP importada pelo agente
na aba Etapas e no painel de Programação, cada uma no centro/máquina correto,
para operar a produção normalmente.

### Critérios de Aceitação
1. QUANDO a OP é criada/atualizada com etapas, ENTÃO o backend DEVE gravar uma
   `EtapaOrdemProducao` por etapa com `sequencia`, `descricao`,
   `tempoSetupMinutos`, `tempoOperacaoCalculado`, `tempoEsperaMinutos = 0` e
   `status = 'PENDENTE'`.
2. QUANDO a etapa referencia um centro, ENTÃO o backend DEVE **resolver** o
   `CentroProducao` por `descricao` (case-insensitive; menor `codigo` =
   determinístico) e reusá-lo.
3. QUANDO o centro **não existe**, ENTÃO o backend DEVE **criá-lo** com código
   sanitizado único, `tipo = 'MAQUINA'` e `tipoProcessoId` inferido do tipo da
   etapa (`I` → IMPRESSAO; demais → ACABAMENTO; fallback: primeiro Tipo de
   Processo ativo da empresa), igual ao importador de PDF.
4. Toda etapa DEVE ficar com um centro (resolvido ou criado) — nenhuma etapa
   pode ficar invisível no painel por falta de centro (regressão conhecida da OS
   3133). SE não houver nenhum Tipo de Processo cadastrado na empresa, ENTÃO a
   ingestão DEVE falhar com mensagem clara (mesmo comportamento do PDF).
5. A criação/reuso de centro DEVE filtrar/gravar por `empresaId` da OP real
   (isolamento multi-tenant), nunca de outra empresa.

---

## Requisito 4 — Variações/planos no Vizor

**User Story:** Como PCP, quero ver os planos/componentes da OP (quando houver)
na aba Variações, para entender a composição do produto.

### Critérios de Aceitação
1. QUANDO o cálculo tem planos (`CalculoPlanos`), ENTÃO o backend DEVE gravar uma
   `VariacaoOrdemProducao` por plano com `codigoProduto`, `descricao`,
   `quantidade`, `sequencia` e `observacao` (gramatura/dimensão/aproveitamento
   como texto).
2. QUANDO a OP é de **plano único** (ex.: OP 3155), ENTÃO a aba Variações PODE
   ficar com 0 registros, sem erro (comportamento esperado).
3. As variações DEVEM ser escopadas pela `ordemProducaoId` da OP real.

---

## Requisito 5 — Materiais na aba Materiais (papel + acabamento) e tintas como texto

**User Story:** Como almoxarifado/PCP, quero ver os materiais físicos da OP
(papel e materiais de acabamento) na aba Materiais, e as cores/tintas no
cabeçalho, igual a uma OP de PDF.

### Critérios de Aceitação
1. QUANDO o cálculo tem papel/suporte (`CalculoPlanos.codSuporte`), ENTÃO o
   backend DEVE gravar `ItemOrdemProducao` tipo PAPEL com a descrição do suporte
   e quantidade, aparecendo na aba Materiais.
2. QUANDO o cálculo tem materiais de acabamento (`CalculoMatAcabamento`), ENTÃO o
   backend DEVE gravá-los como `ItemOrdemProducao` (aba Materiais), com
   `descricaoExterna` guardando o código externo.
3. Os itens de material DEVEM nascer com `quantidadeLiberada`,
   `quantidadeConsumida`, `quantidadePerda` = 0 e `status = 'PENDENTE'`
   (colunas Liberado/Consumido/Perda/Status zeradas na tela).
4. QUANDO o cálculo tem tintas (`CalculoTintas`), ENTÃO o backend NÃO DEVE
   gravá-las como item; em vez disso DEVE registrá-las como **texto** nas
   observações da OP via tag `[Cores]` (ex.: "AMARELO 123C (85%), VERDE CW0138
   (15%)"), no mesmo padrão de tags do importador de PDF.
5. Os itens de material DEVEM ser escopados pela `ordemProducaoId`/`empresaId`
   da OP real.

---

## Requisito 6 — Idempotência e detecção de alteração (hash dos dois lados)

**User Story:** Como responsável pela integração, quero que reenviar a mesma OP
não gere mudanças, mas que uma alteração real de roteiro no Calcgraf seja
detectada, para manter o Vizor fiel sem retrabalho.

### Critérios de Aceitação
1. O hash da OP (`calcularHashOp`) DEVE cobrir os campos novos: tempos e tipo das
   etapas, as variações e o texto de tintas (`tintasTexto`).
2. QUANDO a mesma OP é reenviada sem alteração, ENTÃO o resultado DEVE ser
   `ignorada` (idempotência) — mesmo com os arrays em ordem diferente (hash
   ordem-insensível).
3. QUANDO muda o roteiro no Calcgraf (tempo, centro, etapa a mais/menos,
   variação, cores), ENTÃO o hash DEVE mudar e a OP DEVE ser reclassificada.
4. A normalização de hash DEVE ser **idêntica** no agente e no backend (DTO
   espelhado) — a mesma OP produz o mesmo hash nos dois lados.
5. É aceito e esperado que, após esta fase, OPs já importadas na fase 1 (sem
   etapas) tenham hash diferente e sejam **reclassificadas** (atualizada se sem
   produção; pendente se com produção) — é o mecanismo que injeta as etapas que
   faltam.

---

## Requisito 7 — Preservar as proteções da fase 1 (produção, finalização, origem)

**User Story:** Como PCP, quero que a chegada do roteiro nunca sobrescreva uma OP
que já está sendo produzida, para não perder apontamentos.

### Critérios de Aceitação
1. QUANDO a OP de destino tem produção (apontamento registrado OU etapa
   EM_ANDAMENTO/CONCLUIDA), ENTÃO a mudança de roteiro NÃO DEVE sobrescrever a
   OP; DEVE virar `AlteracaoOpPendente` (com o payload de etapas/variações) para
   revisão manual.
2. QUANDO a OP está finalizada (CONCLUIDA/CANCELADA), ENTÃO ela DEVE ser
   `ignorada` (nunca reaberta).
3. QUANDO a OP existe sem produção e o hash difere, ENTÃO ela DEVE ser
   `atualizada`: substituição total de itens/etapas/**variações**, preservando o
   status atual (sem regressão) e os vínculos manuais de produto por descrição.
4. QUANDO uma `AlteracaoOpPendente` é aplicada manualmente, ENTÃO ela DEVE gravar
   as etapas/variações do payload (reusa a lógica de `atualizarOp`).
5. O match da OP DEVE continuar por `referenciaExterna` (número) em qualquer
   origem (nunca duplica OP já vinda de PDF); o corte por
   `pcp.calcgrafNumeroMinimoOp` por empresa DEVE continuar válido.

---

## Requisito 8 — Paridade de tela e validação ponta a ponta

**User Story:** Como usuário da Carton Wega, quero que uma OP importada pelo
agente abra na tela igual a uma de PDF, para confiar na migração.

### Critérios de Aceitação
1. Para a OP 3000 do backup (golden case), a ingestão DEVE produzir **4 etapas**
   com os centros e tempos esperados, as variações do cálculo e os materiais
   (papel + acabamento), batendo com o print do Vizor.
2. A aba Etapas DEVE exibir `Seq | Operação | Centro | Setup (min) | Operação
   (min) | Espera (min) | Status`, sem alteração de frontend (reusa a tela
   existente).
3. A aba Materiais DEVE exibir os itens com `Quantidade | Unidade | Liberado |
   Consumido | Perda | Status`.
4. A aba Entregas DEVE continuar preenchida (comportamento da fase 1).
5. A validação DEVE ser reproduzível contra o backup local
   (`CalcgrafCartonWega`) para um conjunto de OPs (ex.: 3000, 3120–3138),
   conferindo a contagem de etapas por OP contra a varredura do mapeamento.

---

## Requisito 9 — Qualidade, testes e implantação

**User Story:** Como mantenedor, quero testes automatizados e um caminho de
implantação seguro, para não quebrar o que já roda em produção.

### Critérios de Aceitação
1. As funções puras de hash (backend) DEVEM ter testes (vitest + fast-check)
   cobrindo: ordem-insensível, mudança de tempo de etapa muda o hash, add/remove
   variação muda o hash, add/remove tinta muda o hash.
2. As funções puras de cálculo de tempo (agente) DEVEM ter testes cobrindo setup,
   operação e o caso `producaoHora = 0`.
3. O serviço de ingestão DEVE ter teste (golden OP 3000) validando a gravação de
   etapas (com tempos/centro), variações e materiais.
4. Scripts temporários de exploração/validação DEVEM usar prefixo `_tmp-` e ser
   **removidos** após o uso; credenciais nunca são commitadas.
5. A implantação DEVE prever reempacotar o agente (`npm run dist` →
   `release/...Setup.exe`) e trocar no servidor da PHTech (janela de RDP), com o
   backend deployado antes (compatível com agente antigo e novo — campos do DTO
   são aditivos/opcionais).
6. NÃO DEVE haver alteração de `schema.prisma`/`migrate-prod.ts` nesta fase (os
   models de destino já existem).

---

## Rastreabilidade (requisito → design)

| Requisito | Seção(ões) do design |
|---|---|
| R1 Leitura do roteiro | §3, §4.2, §4.4 |
| R2 Cálculo de tempos | §4.3 |
| R3 Etapas + centro | §5.1 |
| R4 Variações | §5.2 |
| R5 Materiais/tintas | §4.4 (decisões 2 e 3), §5 |
| R6 Hash/idempotência | §6 |
| R7 Proteções da fase 1 | §5.3, §5.4 |
| R8 Paridade de tela | §1 (resultado esperado), §8 |
| R9 Testes/implantação | §2 (princípios), §7, §8 |
