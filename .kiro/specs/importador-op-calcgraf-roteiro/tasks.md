# Plano de Implementação — Importador de OP do Calcgraf: Roteiro (Fase 2)

Ordem pensada para reduzir risco: primeiro as funções PURAS (testáveis sem SQL
nem produção), depois o backend (que não depende do agente para ser testado),
depois o reader do agente, por fim validação ponta a ponta e implantação.

**Lembrete de contexto (handoff):** sem mudança de schema Prisma; DTO espelhado
entre agente e backend; queries do agente SEQUENCIAIS e somente-leitura;
isolamento multi-tenant por `empresaId` da OP real.

---

- [x] 1. Estender o DTO e a normalização de hash (backend `.pure.ts`)
  - [x] 1.1 Em `ingestao-op-calcgraf.pure.ts`, estender `EtapaOpOrigemDTO` com
    `tipo?`, `setupMinutos?`, `operacaoMinutos?`; criar `VariacaoOpOrigemDTO`;
    adicionar `variacoes?` e `tintasTexto?` a `OpOrigemDTO`.
  - [x] 1.2 Estender `normalizarEtapa` (incluir campos novos), criar
    `normalizarVariacao`, e incluir `variacoes` (ordenado estável) + `tintasTexto`
    no objeto canônico de `normalizarOpParaHash`.
  - _Requisitos: 6.1, 6.4_

- [x] 2. Testes das funções puras de hash (backend)
  - [x] 2.1 Em `ingestao-op-calcgraf.pure.test.ts`, adicionar propriedades
    (fast-check): etapas/variações embaralhadas → mesmo hash (ordem-insensível);
    mudar `setupMinutos`/`operacaoMinutos` → hash muda; add/remover variação →
    hash muda; add/remover tinta (`tintasTexto`) → hash muda.
  - [x] 2.2 Rodar `npx vitest run ingestao-op-calcgraf.pure.test.ts --reporter=dot`
    e confirmar verde (29/29 passando, incl. propriedades existentes).
  - _Requisitos: 6.1, 6.2, 6.3, 9.1_

- [x] 3. Backend — resolver/criar centro e gravar etapas com tempos
  - [x] 3.1 Em `ingestao-op-calcgraf.service.ts`, implementar helpers
    `inferirTipoProcesso(tx, empresaId, tipoEtapa)` e `resolverOuCriarCentro(tx,
    empresaId, nomeCentro, tipoEtapa)` espelhando a regra de
    `importacao-op.routes.ts` (reuso por `descricao` case-insensitive; criação
    com código sanitizado único + `tipoProcessoId` inferido; erro claro se não
    houver Tipo de Processo).
  - [x] 3.2 Reescrever `criarEtapas` para receber `empresaId`, resolver/criar o
    centro por etapa, gravar `tempoSetupMinutos`, `tempoOperacaoCalculado`,
    `tempoEsperaMinutos = 0`, `status PENDENTE` e definir `posicaoFila` (append na
    fila do centro, como o PDF).
  - [x] 3.3 Atualizar as chamadas em `criarOp` e `atualizarOp` para a nova
    assinatura (`empresaId`).
  - _Requisitos: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. Backend — variações, materiais (papel + acabamento) e tintas como texto
  - [x] 4.1 Implementar `criarVariacoes(tx, ordemProducaoId, dto)` gravando
    `VariacaoOrdemProducao` (codigoProduto/descricao/quantidade/sequencia +
    observacao com gramatura/dimensão/aproveitamento). Chamar em `criarOp`; em
    `atualizarOp` adicionar `variacaoOrdemProducao.deleteMany` antes de recriar.
  - [x] 4.2 Itens de PAPEL/suporte e MAT. ACABAMENTO chegam em `dto.itens`
    (enriquecidos pelo reader — task 7) e são gravados por `criarItens` com
    `tipoMaterial` detectado + `descricaoExterna`; Liberado/Consumido/Perda = 0;
    status PENDENTE; vínculo manual de produto preservado por descrição em
    `atualizarOp`.
  - [x] 4.3 Incluir a tag `[Cores]` em `montarObservacoes` a partir de
    `dto.tintasTexto` (tintas NÃO viram item).
  - _Requisitos: 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 5. Testes do serviço de ingestão (backend, golden OP 3000)
  - [x] 5.1 Em `ingestao-op-calcgraf.service.test.ts`, montar um `OpOrigemDTO`
    com as 4 etapas/variações/materiais da OP 3000 e validar (mock Prisma no
    padrão do arquivo): 4 `EtapaOrdemProducao` com tempos/centros corretos; 1
    variação; itens de papel + acabamento; tag `[Cores]` nas observações.
    (+ reuso de centro por nome; + OP sem cálculo mantém fase 1.)
  - [x] 5.2 Proteções já cobertas pelos testes existentes (produção → pendente;
    idempotência → ignorada; sem produção + hash difere → atualizada) — seguem
    verdes com os campos novos.
  - [x] 5.3 `npx vitest run ...service.test.ts --reporter=dot` → 10/10 verde.
    `get_diagnostics` sem erros.
  - _Requisitos: 7.1, 7.2, 7.3, 7.4, 8.1, 9.3_

- [x] 6. Agente — funções puras de cálculo de etapa
  - [x] 6.1 Módulo novo `calcgraf-reader/calcgraf-roteiro.ts`: `calcularSetupMin`,
    `calcularOperacaoMin` (guarda `producaoHora <= 0`), `montarNomeEtapa`,
    `montarEtapaDTO`, `montarVariacaoDTO`, `montarTextoTintas` — puras.
  - [x] 6.2 Teste `calcgraf-roteiro.test.ts` com `node:test` (sem dep nova):
    7/7 verde cobrindo golden OP 3000 e `producaoHora = 0`
    (`node --test dist/calcgraf-reader/calcgraf-roteiro.test.js`).
  - _Requisitos: 2.1, 2.2, 2.3, 2.4, 2.5, 9.2_

- [x] 7. Agente — espelhar o DTO e estender a leitura (SEQUENCIAL, somente-leitura)
  - [x] 7.1 Espelhado no `calcgraf-reader.ts`: `EtapaOpOrigemDTO` estendida,
    `VariacaoOpOrigemDTO`, `variacoes`, `tintasTexto` (ordem/nomes idênticos ao
    backend → hash casa).
  - [x] 7.2 Queries `montarQueryCalculoDaOp` (maior `Codigo`),
    `...CalculoAtividades` (JOIN Atividades + CentrosProducao),
    `...CalculoPlanos` (JOIN Suportes), `...CalculoTintas`,
    `...CalculoMatAcabamento` (JOIN Itc) + `lerRoteiroEmLote` — tudo via
    `consultar` (passa por `assertSomenteLeitura`), SEQUENCIAL.
  - [x] 7.3 Integrado em `lerOpsCandidatas`: roteiro resolvido preenche
    `etapas/variacoes/tintasTexto` + mat.acabamento em `itens`; OP sem cálculo
    mantém fase 1 (sem etapas). `npm run build` verde; testes do agente 7/7.
  - _Requisitos: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 4.1, 5.1, 5.2, 5.4_

- [x] 8. Validação ponta a ponta contra o backup local
  - [x] 8.1 Script `_tmp-validar-roteiro.mjs` rodou o reader via sqlcmd contra
    `CalcgrafCartonWega` (OPs 3000 e 3120–3138). Resultado: OP 3000 = 4 etapas
    (centros/tempos/variação/tintas batendo com o golden); faixa 3120–3138 com
    3 a 22 etapas (coerente com a varredura ~3 a 21); 0 OPs sem etapas na
    amostra. Descobertas corrigidas: `CalculoPlanos` sem coluna `Ordem` (ordena
    por `codPlano`); `CalculoMatAcabamento` sem `quantidade`; nome do material
    em `Itc.Descritivo` (não `Itc.Nome`).
  - [x] 8.2 Script temporário removido. Nenhuma credencial commitada.
  - _Requisitos: 1.4, 8.1, 8.5, 9.4_

- [x] 9. Empacotar o agente e preparar implantação
  - [x] 9.1 `npm run build` + `npm run dist` → instalador gerado em
    `release/VisioFab Agente Calcgraf Setup 0.1.0.exe` (**165,7 MB**, timestamp
    atual). Build acompanhado via `control_pwsh_process`.
  - [x] 9.2 HANDOFF atualizado: deployar o BACKEND antes de trocar o agente
    (DTO aditivo = compatível com agente antigo); troca do `.exe` = passo de
    janela de RDP.
  - _Requisitos: 9.5, 9.6_

- [ ] 10. Commit, push e atualização de documentação
  - [ ] 10.1 Backend: commitar `.pure.ts`/`.service.ts`/testes na `main`
    (confirmar `xxx..yyy main -> main`). Sem `schema.prisma`/`migrate-prod.ts`.
  - [ ] 10.2 Atualizar `docs/importador-calcgraf-HANDOFF.md` (fase 2 concluída,
    o que mudou, estado do instalador) e a seção do steering
    `migracao-calcgraf-carton-wega.md`.
  - _Requisitos: 8.1, 9.5, 9.6_
```
