# PROGRESSO — Paridade Importador Calcgraf × PDF (fonte de verdade entre sessões)

> Ler este arquivo ao retomar. Resume o que foi feito, o que falta e as decisões.
> Spec: design.md / requirements.md / tasks.md neste diretório.

## Objetivo
Fazer o agente Calcgraf criar OPs com a MESMA qualidade do importador de PDF
(mesma origem de dados). Regra de negócio na API (agente "burro"). Sem bagunçar
programação (cintos S1–S4). "Costa" exibida como "Verso".

## Credenciais/infra (lembrete)
- Neon prod: `postgresql://neondb_owner:npg_qy58nLxvrMhj@ep-withered-mountain-aqtjul2j-pooler.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require` (usar via DATABASE_URL; nunca commitar).
- Empresa Carton Wega: `75848e24-742e-461d-b913-1642c5b83ae9`.
- Backup local Calcgraf: `sqlcmd -S localhost -E -C -d CalcgrafCartonWega` (vai até OP ~3138).
- Repos SEPARADOS: back `VisioFab.Wms.Back`, front `VisioFab.Wms.Front`.
- Scripts temporários: prefixo `_tmp-`, remover após uso. `pg` instalado no back.

## STATUS DAS TAREFAS (resumo)
- [x] **T1 (núcleo)** — motor `op-montagem.service.ts` com `resolverOuCriarCentro`
  (DE-PARA → reuso nome → criar) + `inferirTipoProcessoId` (aceita `I/A` do
  Calcgraf e `IMPRESSAO/...` do PDF). Agente passou a usar o motor. DTO ganhou
  `EtapaOpOrigemDTO.centroCodigo`. Testes: service 12/12, pure 29/29. **COMMIT PENDENTE.**
  - ADIADO (cautela): plugar o motor no PDF (`importacao-op.routes.ts`) — fica
    para janela de teste dedicada; PDF segue estável e intocado.
- [x] **T2** — `resolverCliente` no motor (CNPJ dígitos → de-para CLIENTE → tag; nunca cria/ACTUAL) + `soDigitos`. Testes `op-montagem.service.test.ts` (8). **COMMIT PENDENTE junto T3.**
- [x] **T3** — `montarEntregas` (todas as datas válidas, ordenadas → 1ª = prevista; vazio→null fallback do chamador) no motor + testes (4). Total motor: 12/12.
- [x] **T4** — DTO aditivo (clienteCodigo/clienteDoc/produtoCodigo/programacaoEntrega[]/planos[]/matriz/formato/bobinasTexto) + hash cobre novos + testes (pure 29/29). **COMMIT PENDENTE junto T5.**
- [x] **T5** — ingestão do agente usa resolverCliente/montarEntregas/criarPlanos + cintos reforçados; `PlanoOrdemProducao` substitui `VariacaoOrdemProducao` (fallback de transição converte `variacoes` antigas em planos COMPONENTE, preservando suporte/dimensao/aproveitamento); `montarObsVariacao` removido (código morto). Novas tags `[Matriz]`/`[Formato]`/`[Bobina]` em `montarObservacoes`. Nova `criarProgramacaoEntrega` (resolve "entrega em branco" usando a MENOR data). `atualizarOp`: sem etapas preserva roteiro MAS atualiza entregas se vierem. Testes service **20/20** (fake Prisma ganhou models `planoOrdemProducao`, `programacaoEntrega`, `cliente`). Motor+hash **48/48**. get_diagnostics limpo. **COMMIT PENDENTE.**
  - Regra de plano (paridade PDF): materializa `PlanoOrdemProducao` só com 2+ planos OU retiração (frente/verso = 2 FACES, VERSO.faceDeId→FRENTE); plano único sem retiração = legado (não cria).
- [~] **T6** — agente (reader) envia os dados crus novos (SEQUENCIAL/SELECT).
  - [x] **T6a FEITO**: reader espelha o DTO novo e já ENVIA: `clienteDoc` (CNPJ
    do cliente via pedido→Nomes.CNPJCPF — já era lido, agora vai no DTO, resolve
    o "ACTUAL"); `programacaoEntrega[]` (TODAS as datas dos lotes OpLote, não só
    a 1ª — resolve "entrega em branco") via `montarProgramacaoDeLotes` (puro);
    `centroCodigo` por etapa (`CalculoAtividades.codCentroCusto` → de-para de
    centro no backend). Build do agente OK; testes `node:test` **12/12**
    (`calcgraf-roteiro.test.ts`, +5 novos). get_diagnostics limpo.
  - [ ] **T6b ADIADO para a T7 (validação contra backup)**: `planos[]` +
    retiração (frente/verso), `clienteCodigo`, `matriz`/`formato`/`bobinasTexto`.
    Motivo: dependem de descobrir as COLUNAS REAIS no backup `CalcgrafCartonWega`
    (cores NxM p/ retiração; de onde vêm matriz/formato/bobina) — escrever a
    query sem inspecionar o schema real arriscaria quebrar no servidor. Será
    feito na T7, inspecionando o schema antes. O backend JÁ aceita esses campos
    (aditivos); a ausência preserva (cinto S1). **COMMIT PENDENTE (T6a).**
- [ ] **T7** — validar contra backup (golden 3000, multi-plano 3154, retiração, entregas múltiplas); remover scripts.
- [ ] **T8** — front: "COSTA" → "VERSO" nos labels (valor técnico FACE mantido).
- [ ] **T9** — empacotar agente v0.3.0; selo de versão; doc de deploy.
- [ ] **T10** — deploy monitorado + reparo retroativo opcional; commit/push; atualizar HANDOFF/steering.

## ARQUIVOS JÁ TOCADOS (T1)
- `src/modules/pcp/importador-calcgraf/op-montagem.service.ts` (NOVO)
- `src/modules/pcp/importador-calcgraf/ingestao-op-calcgraf.service.ts` (usa motor)
- `src/modules/pcp/importador-calcgraf/ingestao-op-calcgraf.pure.ts` (DTO +centroCodigo)
- `src/modules/pcp/importador-calcgraf/ingestao-op-calcgraf.service.test.ts` (fake deParaImportacao)

## PENDÊNCIAS GERAIS DO PROJETO (fora desta spec, não esquecer)
- Agente v0.2.1 em `release/` com cliente+roteiro; **servidor pode estar com versão antiga** (3175/3176 vieram sem etapas = agente fase 1 rodou). Trocar no servidor.
- Backend precisa de DEPLOY no Render (cinto de segurança do commit 3c5919927, fix cliente, desmembrar por tiragem, e agora o motor de centro) — nada disso está em produção até deployar.
- 331 OPs "ACTUAL" já corrigidas retroativamente (vínculo por CNPJ). ref 3138 sem PDF (recupera via agente novo).
- Desmembrar por Tiragem: back+front commitados (precisam deploy).
- Caminho do cliente no Calcgraf: OpItem→OpItemxPedidoItem→PedidoItem→PedidoHeader.CodNome→Nomes (RazaoSocial/NomePrincipal/CNPJCPF).

## REGRA DE MATCH (importante)
- OP: identidade = `referencia_externa` (nº Calcgraf), NÃO `numero` interno (não batem!).
- Cliente: CNPJ só dígitos é a chave; nome do Calcgraf pode diferir do cadastro (filiais).
