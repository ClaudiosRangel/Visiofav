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

- [ ] 2. Resolver CLIENTE no motor (determinístico, sem "ACTUAL")
  - [ ] 2.1 Implementar `resolverCliente(tx, empresaId, { clienteDoc,
    clienteCodigo, clienteNome })` em `op-montagem.service.ts`: CNPJ (dígitos) →
    de-para CLIENTE → NULL + tag `[Cliente]`. Nunca cria cliente nem usa
    placeholder.
  - [ ] 2.2 Testes puros (vitest + fast-check): match por CNPJ, múltiplas
    filiais (desempate por CNPJ), sem match (tag), entrada vazia.
  - _Requisitos: 4.1, 4.2, 4.3, 9.2_

- [ ] 3. Resolver CENTRO e ENTREGAS no motor
  - [ ] 3.1 `resolverCentro` consulta `DeParaImportacao` (CENTRO_PRODUCAO) ANTES
    de reusar/criar; registra aviso quando cria. Isolado por `empresaId`.
  - [ ] 3.2 `montarEntregas(programacaoEntrega)` → lista de `ProgramacaoEntrega`
    + 1ª data como `dataEntregaPrevista`; fallback lote; sem data → nulo.
  - [ ] 3.3 Testes puros das duas (ordem de resolução de centro; 1ª data;
    fallback; vazio).
  - _Requisitos: 3.1, 3.2, 3.3, 3.4, 5.1, 5.2, 5.3, 5.4, 9.2_

- [ ] 4. Estender o DTO (aditivo) + hash — backend `.pure.ts`
  - [ ] 4.1 Adicionar ao `OpOrigemDTO`: `clienteCodigo`, `clienteDoc`,
    `produtoCodigo` (popular), `programacaoEntrega[]`, `planos[]` (com
    `retiracao`/`coresFrente`/`coresVerso`), `matriz`, `formato`,
    `bobinasTexto[]`; `EtapaOpOrigemDTO.centroCodigo`.
  - [ ] 4.2 Estender a normalização de hash para cobrir planos/entregas/cliente
    de forma estável (ordem-insensível) — sem reclassificação espúria.
  - [ ] 4.3 Testes de hash (fast-check): ordem-insensível; mudar entrega/plano/
    cliente muda o hash; reenvio idêntico não muda.
  - _Requisitos: 8.1, 8.2, 8.3, 9.3_

- [ ] 5. Ingestão do agente usa o motor + cintos S1–S4
  - [ ] 5.1 `criarOp`/`atualizarOp` passam a chamar `resolverCliente`,
    `resolverCentro` (nas etapas), `criarPlanos`, `montarEntregas`,
    `montarTagsObservacao`. Descontinuar `VariacaoOrdemProducao` em favor de
    `PlanoOrdemProducao`.
  - [ ] 5.2 Reforçar os cintos: só substitui o bloco X se o payload trouxe X;
    preservar `posicaoFila`/`ordemManual=true`; produção → pendente; finalizada
    → ignorada.
  - [ ] 5.3 Testes do service (estender `ingestao-op-calcgraf.service.test.ts`):
    S1 (payload sem planos/entregas preserva), S2 (produção→pendente), S3 (fila
    manual preservada), S4 (idempotência), cliente por CNPJ, centro por de-para.
  - _Requisitos: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.3, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1_

- [ ] 6. Agente (reader) — enviar os dados crus que faltam
  - [ ] 6.1 Reader lê e envia: `programacaoEntrega[]` (todas as datas),
    `planos[]` + retiração (de `CalculoPlanos`/cores NxM), `centroCodigo` por
    etapa, `clienteCodigo`/`clienteDoc` (pedido→Nomes), `matriz`/`formato`/
    `bobinasTexto`. Espelhar o DTO (ordem/nomes idênticos).
  - [ ] 6.2 Tudo SEQUENCIAL e SOMENTE SELECT (restrições do tedious/trigger).
  - [ ] 6.3 Funções puras de montagem do reader testadas (`node:test`) contra o
    golden OP 3000 + um caso com retiração + um com entregas múltiplas.
  - _Requisitos: 4.4, 5.1, 6.1, 6.2, 7.2, 8.1, 8.2_

- [ ] 7. Validação ponta a ponta contra o backup local
  - [ ] 7.1 Script `_tmp-` (removido após uso): rodar o reader contra
    `CalcgrafCartonWega` para golden cases (OP 3000; OP multi-plano 3154; uma com
    retiração; uma com entregas múltiplas) e conferir centro resolvido por
    de-para, cliente por CNPJ, planos/frente-verso, datas.
  - [ ] 7.2 Confirmar que OP sem pedido/plano não quebra (fallbacks). Remover o
    script.
  - _Requisitos: 9.4_

- [ ] 8. Frontend — nomenclatura "Verso" (ajuste de labels)
  - [ ] 8.1 No front (`VisioFab.Wms.Front`), trocar textos exibidos "COSTA" →
    "VERSO" nos badges/labels de plano FACE (sem mudar o valor técnico `FACE`).
    Validar `get_diagnostics` do(s) arquivo(s) tocado(s).
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
