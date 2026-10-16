# Requisitos — Paridade do Importador Calcgraf com o Importador de PDF

## Introdução

O agente Calcgraf cria/atualiza OPs com qualidade inferior à do importador de
PDF (mesma origem de dados). Esta feature unifica as regras de negócio numa
fonte única (motor no backend/API) e faz o agente trazer os dados crus que
faltam, para que uma OP sincronizada do Calcgraf fique **idêntica** a uma
importada por PDF: centro correto (de-para), cliente vinculado ao cadastro,
data de entrega preenchida, planos e frente/verso, tags estruturadas.

**Princípio:** regra de negócio na API; agente apenas lê dados crus e envia.
**Nomenclatura:** "costa" exibida como **"verso"** (valor técnico `FACE` mantido).

Referência: `design.md` (mesmo diretório). Fluxo-modelo: `importacao-op.routes.ts`.

### Contexto de risco (incidente anterior)
A sincronização do agente antigo já **zerou o roteiro de 61 OPs e bagunçou a
programação** (perda de ordem de fila). Por isso a segurança/preservação é
requisito de primeira classe (Requisito 1), não um detalhe.

---

## Requisito 1 — Segurança: nunca bagunçar/perder a programação

**User Story:** Como PCP, quero que a sincronização nunca destrua etapas, ordem
de fila ou produção já existente, para que o incidente de perda de programação
nunca se repita.

### Critérios de Aceitação
1. QUANDO o payload de uma OP **não traz** um bloco (etapas, planos ou
   programação de entrega), ENTÃO o backend DEVE **preservar** o bloco existente
   dessa OP (não apagar). (S1)
2. QUANDO a OP de destino tem produção (apontamento registrado OU etapa
   EM_ANDAMENTO/CONCLUIDA), ENTÃO a mudança NÃO DEVE sobrescrever a OP; DEVE
   virar `AlteracaoOpPendente`. (S2)
3. QUANDO uma etapa tem `ordemManual = true` ou `posicaoFila` definida por
   humano, ENTÃO a sincronização NÃO DEVE sobrescrever essa posição; etapas
   novas entram no fim da fila do centro. (S3)
4. QUANDO a mesma OP é reenviada sem alteração de conteúdo, ENTÃO o resultado
   DEVE ser `ignorada` (idempotência; hash cobre os campos novos). (S4)
5. QUANDO a OP está finalizada (CONCLUIDA/CANCELADA), ENTÃO ela DEVE ser
   `ignorada` (nunca reaberta).
6. Toda ação de sincronização DEVE gerar `LogOrdemProducao` indicando o que foi
   criado, atualizado ou **preservado** e por quê. (S6)

---

## Requisito 2 — Motor único de regras (paridade PDF ↔ agente)

**User Story:** Como mantenedor, quero que PDF e agente usem as MESMAS funções
de regra de negócio, para acabar com a divergência entre os dois fluxos.

### Critérios de Aceitação
1. As regras de montagem (centro, cliente, planos, entregas, tags) DEVEM ser
   extraídas para um service compartilhado (`op-montagem.service.ts`), usado
   tanto pela confirmação de PDF quanto pela ingestão do agente.
2. A extração do PDF DEVE ser **comportamentalmente neutra**: a importação de
   PDF produz o MESMO resultado antes e depois da refatoração (não-regressão).
3. A ingestão do agente DEVE chamar as mesmas funções do motor (sem
   reimplementar regra em paralelo).

---

## Requisito 3 — De-para de centro de produção (não criar máquina irreal)

**User Story:** Como operador, quero que as etapas caiam no centro de produção
REAL que a fábrica opera, para não aparecerem máquinas inexistentes no painel.

### Critérios de Aceitação
1. QUANDO uma etapa chega com `centroCodigo`, ENTÃO o backend DEVE resolver o
   centro na ordem: (1) `DeParaImportacao` (CENTRO_PRODUCAO, `codigoExterno =
   centroCodigo`); (2) reuso por `descricao` case-insensitive; (3) criar com
   `tipoProcessoId` inferido — criando SÓ em último caso.
2. QUANDO o centro é resolvido por de-para ou reuso, ENTÃO NENHUM centro novo
   DEVE ser criado.
3. Toda etapa DEVE ficar vinculada a um centro (nunca invisível no painel).
4. A resolução/criação DEVE filtrar/gravar por `empresaId` da OP real.

---

## Requisito 4 — Cliente vinculado ao cadastro (sem "ACTUAL", sem adivinhar)

**User Story:** Como vendas/PCP, quero que a OP aponte para o cliente real do
cadastro, para relatórios e filtros por cliente funcionarem.

### Critérios de Aceitação
1. QUANDO a OP chega com `clienteDoc` (CNPJ), ENTÃO o backend DEVE vincular
   `clienteId` ao cliente do cadastro com o mesmo CNPJ (só dígitos); havendo
   múltiplas filiais, o CNPJ exato desempata.
2. QUANDO não há CNPJ mas há `clienteCodigo`, ENTÃO DEVE tentar o
   `DeParaImportacao` (CLIENTE).
3. QUANDO nenhum match é encontrado, ENTÃO o backend DEVE gravar a tag
   `[Cliente] <nome>` e deixar `clienteId` nulo — NUNCA criar cliente nem usar
   placeholder "ACTUAL".
4. O agente DEVE enviar `clienteNome`, `clienteDoc` (CNPJ) e `clienteCodigo` a
   partir do pedido associado (OpItem → PedidoHeader.CodNome → Nomes).

---

## Requisito 5 — Data de entrega e programação de entrega

**User Story:** Como PCP, quero a data de entrega preenchida e as entregas
parciais registradas, para programar a produção pela urgência.

### Critérios de Aceitação
1. O agente DEVE ler TODAS as datas de programação de entrega da OP no Calcgraf
   (não só a do lote principal) e enviá-las em `programacaoEntrega[]`.
2. QUANDO a OP tem `programacaoEntrega`, ENTÃO o backend DEVE criar uma
   `ProgramacaoEntrega` por data e definir `dataEntregaPrevista` como a 1ª
   (menor) data.
3. QUANDO não há programação de entrega, ENTÃO DEVE usar `OpLote.DataPrometida`
   do lote principal como fallback (comportamento atual).
4. QUANDO nenhuma data existe, ENTÃO `dataEntregaPrevista` fica nula sem erro
   (não inventar data).

---

## Requisito 6 — Planos e Frente/Verso (retiração)

**User Story:** Como PCP, quero que OPs multi-componente e de retiração venham
com os planos e as faces (frente/verso), para o painel refletir a OS real.

### Critérios de Aceitação
1. QUANDO o cálculo tem 2+ planos OU 1 plano com retiração, ENTÃO o backend DEVE
   criar `PlanoOrdemProducao` (mesma regra do PDF) e vincular cada etapa ao seu
   plano.
2. QUANDO há retiração, ENTÃO DEVE criar 2 FACES (FRENTE e VERSO), com
   VERSO.`faceDeId` apontando para a FRENTE.
3. A nomenclatura exibida DEVE usar **"VERSO"** (não "COSTA"); o valor técnico
   `tipo = 'FACE'` é mantido.
4. QUANDO a OP é de plano único, ENTÃO nenhum plano é criado (etapas com
   `planoId` nulo — comportamento legado).
5. O modelo `VariacaoOrdemProducao` (usado hoje pelo agente) DEVE ser
   descontinuado em favor de `PlanoOrdemProducao`, unificando com o PDF.

---

## Requisito 7 — Tags estruturadas de observação

**User Story:** Como PCP, quero as mesmas tags do PDF nas OPs do agente, para a
tela mostrar matriz, formato, cores e bobina.

### Critérios de Aceitação
1. QUANDO disponíveis, as observações DEVEM incluir as tags `[Cliente]`,
   `[Produto]`, `[Tiragem]`, `[Cores]`, `[Matriz]`, `[Formato]`, `[Montagem]`,
   `[TipoOp]` e `[Bobina]` (mesmo padrão do PDF).
2. O agente DEVE enviar os dados crus necessários (matriz, formato, bobinas).

---

## Requisito 8 — Contrato de dados aditivo e compatível

**User Story:** Como responsável pela implantação, quero que o backend novo
funcione com o agente antigo e vice-versa, para um rollout sem downtime.

### Critérios de Aceitação
1. Os campos novos do DTO DEVEM ser **opcionais/aditivos**; o backend novo
   DEVE funcionar com um agente antigo (campos ausentes = preserva o existente).
2. O DTO DEVE ser espelhado agente↔backend (mesma ordem/nomes) para a
   normalização de hash casar.
3. O hash DEVE cobrir os campos novos relevantes (planos, entregas, cliente) só
   o suficiente para detectar alteração real — sem gerar reclassificação
   espúria.

---

## Requisito 9 — Qualidade, validação e implantação

**User Story:** Como mantenedor, quero validação forte antes de produção, para
não repetir incidentes.

### Critérios de Aceitação
1. A refatoração do PDF DEVE ser coberta por testes de não-regressão
   (`scripts/testar-todos-pdfs-op.ts` + testes do fluxo).
2. O motor unificado DEVE ter testes (vitest + fast-check) para
   `resolverCliente`, `montarEntregas` e a inferência de centro/tipo de processo.
3. A ingestão DEVE ter testes dos cintos S1–S4 (payload sem bloco preserva; com
   produção vira pendente; fila manual preservada; idempotência).
4. As regras novas DEVEM ser validadas contra o backup local (golden: OP 3000,
   OP multi-plano 3154, uma com retiração, uma com entregas múltiplas) ANTES do
   deploy.
5. A implantação DEVE ser: backend primeiro (retrocompatível) → validação →
   agente novo (v0.3.0, uma reinstalação) → monitorar 1ª sync → reparo
   retroativo opcional.
6. Scripts temporários DEVEM usar prefixo `_tmp-` e ser removidos; credenciais
   nunca commitadas. Mudança de schema (se houver) segue o steering
   `database-migrations` (schema + migrate-prod no mesmo commit).

---

## Rastreabilidade (requisito → design)

| Requisito | Seção(ões) do design |
|---|---|
| R1 Segurança/preservação | §2, §5.5, §6 |
| R2 Motor único | §3, §5 |
| R3 De-para de centro | §5.1 |
| R4 Cliente | §5.2 |
| R5 Data/programação de entrega | §5.4 |
| R6 Planos/frente-verso | §5.3, §1 (nomenclatura) |
| R7 Tags | §5.5 |
| R8 Contrato aditivo | §4 |
| R9 Qualidade/implantação | §6, §7, §8 |
