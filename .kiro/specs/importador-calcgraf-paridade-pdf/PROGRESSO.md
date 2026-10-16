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
- [ ] **T2** — `resolverCliente` no motor (CNPJ dígitos → de-para CLIENTE → tag; nunca cria/ACTUAL) + testes puros.
- [ ] **T3** — `montarEntregas` (todas as datas → ProgramacaoEntrega + 1ª data) no motor + testes.
- [ ] **T4** — DTO aditivo (clienteCodigo/clienteDoc/produtoCodigo/programacaoEntrega[]/planos[]/matriz/formato/bobinasTexto) + hash cobre novos + testes.
- [ ] **T5** — ingestão do agente usa resolverCliente/montarEntregas/criarPlanos + cintos S1–S4 reforçados; descontinuar VariacaoOrdemProducao em favor de PlanoOrdemProducao; testes.
- [ ] **T6** — agente (reader) envia os dados crus novos (SEQUENCIAL/SELECT); funções puras testadas.
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
