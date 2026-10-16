# Plano de Implementação — Paridade do Importador Calcgraf com o PDF

Ordem pensada para MÁXIMA segurança (não repetir o incidente de perda de
programação): primeiro extrair o motor sem mudar comportamento do PDF (com
testes de não-regressão), depois plugar o agente, validar contra o backup, e só
então ir a produção com rollout monitorado.

**Invariantes em TODA tarefa (cintos S1–S4 do design):** nunca apagar bloco
ausente no payload; nunca tocar OP com produção; nunca sobrescrever fila manual;
idempotência real. Sem mudança de schema por padrão.

---

- [~] 1. Extrair o motor de regras (começando pelo CENTRO — a correção central)
  - [x] 1.1 Criado `op-montagem.service.ts` com `resolverOuCriarCentro` (de-para
    `DeParaImportacao` → reuso por nome → criar) + `inferirTipoProcessoId`
    (aceita vocabulário PDF `IMPRESSAO/...` e Calcgraf `I/A`). Fiel ao PDF.
  - [x] 1.2 Agente (`ingestao-op-calcgraf.service.ts`) passou a usar o motor
    (`resolverOuCriarCentro`) — agora consulta o DE-PARA antes de criar, parando
    de gerar centro irreal. DTO ganhou `EtapaOpOrigemDTO.centroCodigo` (aditivo).
    Testes: service 12/12, pure 29/29.
  - [ ] 1.2b (ADIADO por cautela) Plugar o motor em `importacao-op.routes.ts`
    (PDF). NÃO feito agora para não arriscar o fluxo de PDF estável em produção;
    fica para janela de teste dedicada. O PDF segue com sua lógica (idêntica); o
    motor já é a fonte oficial usada pelo agente.
  - [ ] 1.3 (quando fizer 1.2b) rodar `scripts/testar-todos-pdfs-op.ts` antes/
    depois para garantir não-regressão do PDF.
  - _Requisitos: 2.1, 2.3, 3.1, 3.2, 3.3, 3.4_

- [x] 2. Resolver CLIENTE no motor (determinístico, sem "ACTUAL")
  - [x] 2.1 `resolverCliente(tx, empresaId, { clienteDoc, clienteCodigo,
    clienteNome })` em `op-montagem.service.ts`: CNPJ (dígitos, ignora
    placeholder `0+`) → de-para CLIENTE → NULL + tag `[Cliente]`. Nunca cria
    cliente nem usa placeholder. Helper `soDigitos`.
  - [x] 2.2 Testes puros no `op-montagem.service.test.ts` (match por CNPJ,
    desempate por filial, sem match, placeholder ignorado).
  - _Requisitos: 4.1, 4.2, 4.3, 9.2_

- [x] 3. Resolver CENTRO e ENTREGAS no motor
  - [x] 3.1 `resolverOuCriarCentro` consulta `DeParaImportacao` (CENTRO_PRODUCAO)
    ANTES de reusar/criar; `ResultadoCentro.criouNovo` sinaliza criação. Isolado
    por `empresaId`. (Já na T1.)
  - [x] 3.2 `montarEntregas(programacaoEntrega)` (puro) → lista ordenada +
    MENOR data como `dataEntregaPrevista`; sem data → nulo (chamador faz
    fallback do lote).
  - [x] 3.3 Testes puros no `op-montagem.service.test.ts`.
  - _Requisitos: 3.1, 3.2, 3.3, 3.4, 5.1, 5.2, 5.3, 5.4, 9.2_

- [x] 4. Estender o DTO (aditivo) + hash — backend `.pure.ts`
  - [x] 4.1 `OpOrigemDTO` ganhou `clienteCodigo`, `clienteDoc`, `produtoCodigo`,
    `programacaoEntrega[]` (EntregaOpOrigemDTO), `planos[]` (PlanoOpOrigemDTO com
    `retiracao`/`coresFrente`/`coresVerso`), `matriz`, `formato`,
    `bobinasTexto[]`; `EtapaOpOrigemDTO.centroCodigo` (na T1).
  - [x] 4.2 Hash cobre os campos novos de forma estável (ordem-insensível).
  - [x] 4.3 Testes de hash (fast-check) **29/29** no `.pure.test.ts`.
  - _Requisitos: 8.1, 8.2, 8.3, 9.3_

- [x] 5. Ingestão do agente usa o motor + cintos S1–S4
  - [x] 5.1 `criarOp`/`atualizarOp` chamam `resolverCliente`,
    `resolverOuCriarCentro` (nas etapas), `criarPlanos`, `criarProgramacaoEntrega`
    (via `montarEntregas`), `montarObservacoes` (tags `[Cliente]`/`[Produto]`/
    `[Cores]`/`[Matriz]`/`[Formato]`/`[Bobina]`). `PlanoOrdemProducao` substitui
    `VariacaoOrdemProducao` (fallback de transição converte `variacoes` antigas
    em planos COMPONENTE preservando suporte/dimensao/aproveitamento).
    `montarObsVariacao` removido (código morto).
  - [x] 5.2 Cintos reforçados: payload sem etapas PRESERVA roteiro/planos (mas
    atualiza entregas se vierem); produção → pendente; finalizada → ignorada;
    idempotência por hash.
  - [x] 5.3 Testes do service **20/20** (`ingestao-op-calcgraf.service.test.ts`):
    cinto sem etapas preserva (etapas+planos), substituição com etapas,
    cliente por CNPJ (vincula/placeholder/sem match não cria), retiração
    frente/verso (2 FACES, VERSO→FRENTE), 2+ planos COMPONENTE, programação de
    entrega (menor data = prevista; atualiza sem tocar roteiro), tags de
    cabeçalho. Fake Prisma ganhou `planoOrdemProducao`/`programacaoEntrega`/
    `cliente`.
  - _Requisitos: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.3, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1_

- [~] 6. Agente (reader) — enviar os dados crus que faltam
  - [x] 6.1a Reader JÁ envia (T6a): `clienteDoc` (CNPJ via pedido→Nomes.CNPJCPF),
    `programacaoEntrega[]` (TODAS as datas dos lotes, `montarProgramacaoDeLotes`
    puro), `centroCodigo` por etapa (`CalculoAtividades.codCentroCusto`). DTO
    espelhado (mesma ordem/nomes do backend). SEQUENCIAL + SELECT (tedious).
  - [x] 6.1b FEITO (na T7): `planos[]` + cores/retiração + `formato` (de
    `CalculoAtvImpressao.coresF/coresV/tiraRetira` por `processoCodPlano`).
    `programacaoEntrega` migrada para a fonte CORRETA `PedidoItemEntrega` (a
    data NÃO está no OpLote). Pendente menor: `clienteCodigo`, `matriz`
    (CodFaca), `bobinasTexto` — baixo valor, não bloqueiam.
  - [x] 6.2 Tudo SEQUENCIAL e SOMENTE SELECT (restrições do tedious/trigger).
  - [x] 6.3 Funções puras testadas (`node:test` **16/16**): golden OP 3000,
    `centroCodigo`, `montarProgramacaoDeLotes`, `agregarCoresPorPlano`,
    `montarPlanosDTO` (plano único→undefined, multi-plano OP 3133, retiração).
  - _Requisitos: 4.4, 5.1, 6.1, 6.2, 7.2, 8.1, 8.2_

- [x] 7. Validação ponta a ponta contra o backup local
  - [x] 7.1 Validado via reader (sqlcmd) contra `CalcgrafCartonWega`: OPs
    3000 (1 plano, 4 etapas, cliente MORLAN+CNPJ, entrega 25/08), 3133
    (5 planos multi-componente, cliente MARBRAN+CNPJ, entrega 05/10, 21 etapas),
    3130/3131 (3 parcelas de entrega cada). centro por centroCodigo, cliente por
    CNPJ, planos/cores/formato, datas — todos conferidos. Script `_tmp-` removido.
  - [x] 7.2 OP sem pedido (3137/3138 = avulsas) → sem cliente/entrega, NÃO quebra
    (fallbacks graciosos). DESCOBERTA: data de entrega vem de `PedidoItemEntrega`
    (não OpLote); tipo de etapa 'M' = verniz → mapeado no backend.
  - _Requisitos: 9.4_

- [ ] 7. Validação ponta a ponta contra o backup local
  - [ ] 7.1 Script `_tmp-` (removido após uso): rodar o reader contra
    `CalcgrafCartonWega` para golden cases (OP 3000; OP multi-plano 3154; uma com
    retiração; uma com entregas múltiplas) e conferir centro resolvido por
    de-para, cliente por CNPJ, planos/frente-verso, datas.
  - [ ] 7.2 Confirmar que OP sem pedido/plano não quebra (fallbacks). Remover o
    script.
  - _Requisitos: 9.4_

- [x] 8. Frontend — nomenclatura "Verso" (ajuste de labels)
  - [x] 8.1 BACK: importador de PDF grava o nome exibido "(VERSO)" (era
    "(COSTA)") no plano de retiração; chave de vínculo interna 'COSTA' mantida.
    FRONT (`VisioFab.Wms.Front`): helper `rotuloPlano()` normaliza "(COSTA)"→
    "(VERSO)" na exibição dos badges do painel de Programação (2 pontos),
    cobrindo o legado sem tocar dados. Valor técnico `FACE` inalterado.
    get_diagnostics limpo nos dois arquivos.
  - _Requisitos: 6.3_

- [ ] 9. Empacotar agente v0.3.0 e preparar implantação
  - [ ] 9.1 Bump para `0.3.0`; `npm run build` + `npm run dist`; conferir o
    instalador em `release/`. Atualizar o selo de versão/fase na UI do agente.
  - [ ] 9.2 Documentar a ordem de deploy: backend primeiro (retrocompatível) →
    validação → trocar agente no servidor (uma vez) → monitorar 1ª sync.
  - _Requisitos: 9.5_

- [ ] 10. Deploy monitorado + reparo retroativo opcional
  - [ ] 10.1 Após deploy do backend e troca do agente, monitorar a 1ª sync
    (contagem criadas/atualizadas/pendentes; nenhuma perda de etapa/fila).
  - [ ] 10.2 (Opcional) Reparo retroativo das OPs do agente já pobres (centro
    errado/sem cliente/sem data/sem plano): reprocessar com o motor novo, com os
    cintos S1–S4, em lote monitorado — uma validação antes.
  - [ ] 10.3 Commit + push na `main` (back e front separados); atualizar HANDOFF
    e steering `migracao-calcgraf-carton-wega.md`.
  - _Requisitos: 1.1, 9.5, 9.6_
```
