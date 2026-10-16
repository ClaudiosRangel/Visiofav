# HANDOFF — Importador de OP do Calcgraf (ler ao iniciar nova sessão)

Documento de continuidade do projeto **agente importador de OP do Calcgraf →
Vizor** (Carton Wega). O contexto da sessão anterior encheu; este arquivo
registra TUDO que foi descoberto/decidido para a próxima sessão retomar sem
perda. Fontes relacionadas:
- `docs/agente-calcgraf-instalacao.md` — guia de instalação.
- `docs/calcgraf-mapeamento-roteiro-op.md` — mapeamento SQL do roteiro/etapas (base da próxima fase).
- Steering `.kiro/steering/migracao-calcgraf-carton-wega.md` — seção "✅ IMPORTADOR DE OP".
- Spec `.kiro/specs/importador-op-calcgraf/` — 16/16 tasks concluídas (fase 1).

---

## 1. ESTADO ATUAL (16/10/2026)

**FUNCIONANDO EM PRODUÇÃO.** O agente está instalado no servidor da PHTech e
sincronizou OPs reais da Carton Wega no Vizor de produção (Neon). 1ª sync real:
67 OPs origem `AGENTE_CALCGRAF` (faixa 3103–3174), 15 `AlteracaoOpPendente`
(OPs com produção), 3 duplicatas (corrida manual×automático) JÁ removidas.

### ✅ FASE 2 (roteiro/variações/materiais) — IMPLEMENTADA (15/10/2026, LOCAL)

Spec `.kiro/specs/importador-op-calcgraf-roteiro/` (10/10 tasks). O agente agora
traz, por OP, o ROTEIRO COMPLETO a partir do CÁLCULO (resolvido por
`OpItemEstrutura.Codigo = CalculoHeader.CodOpItemEstrutura`, maior `Codigo`):
- **Etapas** (`CalculoAtividades`) com centro resolvido/criado + tempos
  (setup = quantAcertos*tempoPorAcerto+tempoPrimeiroAcerto; operação =
  tiragem/producaoHora*60).
- **Variações** (`CalculoPlanos`) → `VariacaoOrdemProducao`.
- **Materiais**: papel/suporte + mat. acabamento (`CalculoMatAcabamento`) →
  `ItemOrdemProducao`; **tintas** (`CalculoTintas`) → texto na tag `[Cores]`
  (decisão do usuário: tintas NÃO viram item).
- **Centro**: resolve por `descricao` (case-insensitive) OU cria (regra do
  importador de PDF; `tipoProcessoId` inferido do tipo da etapa).

**Decisões do usuário (firmadas):** (1) centro inexistente → CRIAR; (2) tintas →
texto `[Cores]`; (3) mat. acabamento → entra como item. **SEM mudança de schema
Prisma** (models já existiam).

**Arquivos tocados:**
- Backend: `ingestao-op-calcgraf.pure.ts` (DTO + hash cobrem etapas/variações/
  tintas), `ingestao-op-calcgraf.service.ts` (`resolverOuCriarCentro`,
  `inferirTipoProcesso`, `criarEtapas` com tempos/centro, `criarVariacoes`, tag
  `[Cores]`), + testes `.pure.test.ts` (29/29) e `.service.test.ts` (10/10,
  golden OP 3000).
- Agente: `calcgraf-reader/calcgraf-roteiro.ts` (puras: tempos/montagem) +
  `.test.ts` (`node:test`, 7/7), `calcgraf-reader.ts` (queries do roteiro +
  `lerRoteiroEmLote`, SEQUENCIAL/somente-leitura, DTO espelhado).

**VALIDAÇÃO ponta a ponta** (backup local via sqlcmd): OP 3000 = 4 etapas
(bate com o golden), faixa 3120–3138 com 3 a 22 etapas, 0 OP sem etapas na
amostra. **Correções de coluna** descobertas e aplicadas: `CalculoPlanos` sem
`Ordem` (ordena por `codPlano`); `CalculoMatAcabamento` sem `quantidade`; nome
do material em `Itc.Descritivo` (não `Itc.Nome`). Ver doc de mapeamento.

**FALTA:** reempacotar o agente (`npm run dist` → `release/...Setup.exe`),
deployar o BACKEND primeiro (DTO aditivo = compatível com agente antigo), e
trocar o `.exe` no servidor da PHTech (janela de RDP).

---

## 1.1 INCIDENTE 15–16/10/2026 — sync do agente ANTIGO zerou o roteiro de 61 OPs

**O que aconteceu:** a sincronização de 15/10 rodou com o agente **da fase 1**
(ainda instalado no servidor, sem roteiro no payload). O `atualizarOp` fazia
*substituição total* e, como o payload vinha **sem etapas**, apagou as etapas/
variações de **61 OPs** que já tinham roteiro (vindo de importação de PDF),
deixando-as com 0 etapas e fora da programação (ex.: a "OP #3164" da tela).

**Diagnóstico-chave (LIÇÃO):** a identidade visível na tela e entre os sistemas
é a **`referencia_externa`** (= número do Calcgraf / `OpHeader.Numero`), **NÃO**
o `numero` interno (sequencial próprio do Vizor). Eles **não batem** nesta base
(ex.: ref 3164 = numero interno 3171; ref 3152 = interno 3164; OPs nascidas do
agente usam internos na faixa 10xxx). O backend de ingestão SEMPRE casou certo
(por `referencia_externa`); o problema foi o conteúdo vazio, não a identidade.
**Qualquer reparo/consulta de OP deve usar `referencia_externa`, nunca `numero`.**

**Reparo executado (16/10):** recriadas etapas + materiais de **60 das 61 OPs**
a partir do **PDF salvo no banco** (`pdf_data`), reusando o parser real
(`parseGprintPdf`) + a regra de resolver/criar `CentroProducao` por `descricao`.
Script temporário (removido). Restou **1 OP: ref 3138** (interno 10013) — nasceu
do agente (origem `AGENTE_CALCGRAF`), **nunca teve PDF**; será recuperada quando
o **agente fase 2** sincronizar (traz o roteiro do Calcgraf, não depende de PDF).

**Cinto de segurança (commit `3c5919927`):** `atualizarOp` agora **só substitui
etapas/variações/itens quando o payload REALMENTE traz etapas**. Payload sem
etapas → preserva o roteiro e atualiza só o cabeçalho. Impede a regressão mesmo
se um agente antigo rodar. +2 testes (service 12/12).

**Pendências do incidente:** (a) recuperar ref 3138 via agente fase 2; (b) subir
o backend (Render) — o cinto já está commitado — e trocar o agente no servidor
pela versão fase 2; **até lá manter o agente PARADO** (o antigo reincidiria).

## 2. CREDENCIAIS E ACESSOS (CRÍTICO — guardar)

### Connection string do SQL do Calcgraf (produção, no servidor da PHTech)
```
server=127.0.0.1\SQL2019Express,5520;Database=CartonWega;UID=sa;PWD=C@1cgraf;TrustServerCertificate=yes;
```
- Instância `SQL2019Express`, **porta TCP 5520** (não 1433), banco **`CartonWega`** (W).
- Login `sa` / senha `C@1cgraf` — do próprio Calcgraf (lido do
  `C:\CALCGRAF\GPRINT\UDL\CartonVega.udl`). **É a senha do cliente/PHTech.**

### Acesso ao servidor da PHTech (RDP via AnyDesk)
- Endereço RDP: `sistemas.phtech.net.br:1551`. Usuário Windows: `claudio.rangel`
  (criado pelo Pedro) OU `Administrator`. Acesso mediado por AnyDesk com o Pedro.
- Pedro = DevOps (só servidor/acesso). Matheus/Vinicius = lado Wega/Calcgraf.

### API key do agente (Carton Wega) — Vizor produção
- Empresa Carton Wega: `75848e24-742e-461d-b913-1642c5b83ae9`.
- Token embutido no agente (`index.html`): `4149d0e3a2c4db0946ccaa175d12a3958ca478fa45b71ac9c197f3163c228428`.
- Gerenciar em: Vizor → PCP → Importador Calcgraf → API keys.

### Connection string de PRODUÇÃO do Vizor (Neon) — usar SÓ via env, nunca hardcode
```
postgresql://neondb_owner:npg_qy58nLxvrMhj@ep-withered-mountain-aqtjul2j-pooler.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```
> SEGURANÇA: tanto a senha do `sa` quanto a do Neon circularam no chat/UDL.
> Recomendado rotacionar quando o projeto estabilizar.

### Backup local do Calcgraf (para desenvolvimento/exploração)
- SQL Server local: instância default `MSSQLSERVER` (conecta como `localhost`,
  só named pipes — SEM TCP; por isso o tedious NÃO conecta local, só o `sqlcmd`).
- Banco restaurado: **`CalcgrafCartonWega`**. Vai até a OP **3138** (3193 ativas).
  As OPs 3157/3170/3174 (importadas em produção) são MAIS NOVAS que o backup.
- Explorar via: `sqlcmd -S localhost -E -C -d CalcgrafCartonWega -h -1 -W -Q "..."`.

---

## 3. A LOGON TRIGGER `[connection]` (o grande bloqueio, resolvido)

O SQL do Calcgraf tem uma **logon trigger** (`ON ALL SERVER FOR LOGON`) que faz
`ROLLBACK` (bloqueia) qualquer conexão ao `CartonWega` cujo **`program_name`
(Application Name)** NÃO esteja numa allowlist da PHTech:
`Comissoes, Compras, CRM, Estoque, Faturamento, Financeiro, Gerencial,
CalculoWeb, Gprint, Pedido, Producao, Apontamento, Gcad, ExportadorMovimentos,
Sintegra, ... , .NET SqlClient Data Provider, ...` + `LIKE '%WEBGRAF%'` + `LIKE
'%GPRINT_ESPECIFICOS%'`. (Grava tentativas em `CartonWega.dbo.LogApp`.)

**Solução no agente**: conectar declarando Application Name **`ExportadorMovimentos`**
(já autorizado na allowlist). Constante `APPLICATION_NAME_PADRAO` no reader. É a
forma oficial prevista pela própria trigger (não um contorno).

---

## 4. ARQUITETURA TÉCNICA DO AGENTE (decisões que custaram caro)

Projeto: `VisioFab.AgenteCalcgraf/` (Electron + TS), DENTRO do repo back.

- **Driver = `tedious`** (puro JS, TCP, declara `appName` nativo). NÃO usar
  `msnodesqlv8` (nativo: falhava no servidor sem ODBC e travava o empacotamento).
  NÃO usar `mssql` (arrasta `@azure/*`, incha 269MB e trava o build). `tedious`
  direto é leve.
- **Queries SEQUENCIAIS** no reader (tedious só aceita 1 request por conexão —
  `Promise.all` dá "Requests can only be made in the LoggedIn state").
- **Lock GLOBAL no `main.ts`** (`cadeiaSincronizacao`): serializa sync manual +
  automática (sem ele, 3 OPs duplicaram por corrida).
- **Empacotamento**: `electron-builder` com **`asar: false`** (asar travava com
  os muitos arquivos do tedious) + saída em **`release/`** (não `dist/` — lock de
  arquivo). `signAndEditExecutable:false` + `forceCodeSigning:false` (evita o
  download do winCodeSign que falha por symlink sem admin).
- **Build**: `npm run build` (tsc→dist) e `npm run dist` (electron-builder→release).
  Instalador: `release/VisioFab Agente Calcgraf Setup 0.1.0.exe` (~166 MB).
- **Preload**: contrato IPC em `src/ipc-canais.ts` (módulo neutro); o `main` NÃO
  importa valor do `preload` (senão `contextBridge` undefined no main). Janela com
  `sandbox:false` (preload precisa `require` de módulos locais).
- **sqlcmd** é só último recurso (não declara Application Name → é barrado pela
  trigger; só serve em ambiente sem trigger, ex.: backup local de dev).

### Instalação no servidor (passo a passo à prova de falha)
1. Fechar o agente + matar processos `VisioFab Agente Calcgraf` no Gerenciador.
   Desinstalar a versão atual (Painel de Controle).
2. Copiar o `.exe` da pasta **`release/`** (conferir 166 MB / ~163.700.000 bytes).
3. Instalar, abrir, colar a connection string (seção 2), Salvar, Sincronizar.
4. O erro "due to trigger execution" NÃO deve mais aparecer (appName resolve).

---

## 5. REGRAS DE INGESTÃO (backend `ingestao-op-calcgraf.service.ts`)

- **Match por `referenciaExterna`** (= número da OP) em QUALQUER origem: OP que
  já veio de PDF (`PDF_GPRINT`) é reconhecida, NUNCA duplica. Sem produção →
  atualiza (unifica origem p/ `AGENTE_CALCGRAF`); com produção → `AlteracaoOpPendente`.
- **Corte por número**: `Parametro pcp.calcgrafNumeroMinimoOp` por empresa
  (Carton Wega = **3100**). OPs < corte são ignoradas. Ajustável sem redeploy.
- OP nova entra como **PLANEJADA** (confirmado em produção: 3157/3170/3174).
- Rota: `POST /api/pcp/ingest-op-calcgraf` (auth `x-agente-key`). Revisão de
  pendentes: `GET/POST /api/pcp/alteracoes-op-pendentes/...`. Tudo em produção.

---

## 6. PRÓXIMA FASE (Opção B) — trazer ETAPAS/VARIAÇÕES/MATERIAIS completos

Mapeamento SQL completo e VALIDADO em `docs/calcgraf-mapeamento-roteiro-op.md`.
Resumo do caminho (golden case OP 3000, bateu 100% com Vizor + PDF):

```
OP (OpHeader.Numero) → OpHeader.Codigo → OpItemEstrutura.Codigo
CalculoHeader.CodOpItemEstrutura = OpItemEstrutura.Codigo  (usar MAIOR Codigo = recálculo)
  → CalculoAtividades  = ETAPAS (tipo I/A, codAtividade→Atividades.Nome,
      codCentroCusto→CentrosProducao.Nome, setup = quantAcertos*tempoPorAcerto+
      tempoPrimeiroAcerto, operação = tiragem/producaoHora*60)
  → CalculoPlanos      = VARIAÇÕES/planos + papel (codSuporte, aproveitamento)
  → CalculoTintas      = tintas (codTinta, areaTinta%, ComplementoNome Pantone)
  → CalculoMatAcabamento = materiais de acabamento (CodMaterial, codAtvAcabamento)
OpLote = ENTREGAS (já implementado)
```

Validação: 3193 OPs ativas → 39 sem cálculo (OP avulsa, mantém comportamento
atual) + 0 com cálculo sem etapas ⇒ cobertura ~98,8%.

### Plano de implementação (sugerido: criar spec `importador-op-calcgraf-roteiro`)
1. **Reader** (`calcgraf-reader.ts`): resolver o cálculo por OP e ler
   CalculoAtividades/Planos/Tintas/MatAcabamento (SEQUENCIAL). Resolver nomes
   (Atividades, CentrosProducao, cadastro de suporte, tinta). Montar DTO com
   `etapas[]` (sequencia/centro/descricao/setupMin/operacaoMin), `variacoes[]`,
   `materiais[]` enriquecidos.
2. **Backend** (`ingestao-op-calcgraf.service.ts`): gravar etapas com centro+tempos
   (resolver `CentroProducao` por nome como o importador de PDF faz) + criar
   `VariacaoOrdemProducao`.
3. **Hash** (`.pure.ts` dos dois lados): incluir etapas/variações para a
   idempotência refletir mudança de roteiro.
4. Validar contra OP 3000 (4 etapas) e outras do backup.
5. Reempacotar + QA do instalador + atualizar no servidor.

---

## 7. COMO TRABALHAR (lições desta jornada)

- Scripts temporários de SQL/produção: prefixo `_tmp-`, ler `NEON_URL` do env,
  `new pg.Client({ connectionString, ssl:{rejectUnauthorized:false} })`.
  **SEMPRE remover após usar.** Nunca commitar o UDL/senha.
- `git push` no PowerShell escreve stderr/exit 1 mesmo com sucesso — confirmar
  por `xxx..yyy main -> main` ou `git status -sb`.
- Commitar na `main` (back e front são repos SEPARADOS).
- Build do agente demora; rodar via `control_pwsh_process` e acompanhar com
  `get_process_output`; parar o processo ao terminar. Confirmar `.exe` por tamanho.
- Último commit relevante (back): docs/steering + fix tedious/lock. Instalador
  novo (com lock anti-duplicação + queries sequenciais) está em `release/`,
  AINDA NÃO instalado no servidor — trocar na próxima janela de acesso.
