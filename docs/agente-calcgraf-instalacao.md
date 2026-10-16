# Guia de Instalação — Agente Calcgraf (Importador de OP)

Este guia é o roteiro prático para instalar e configurar o **Agente
Calcgraf**: o app desktop que lê o banco do Calcgraf (somente leitura),
detecta OPs novas/alteradas e envia para o Vizor, eliminando a importação
manual de PDF de OP.

> Leia junto: `.kiro/specs/importador-op-calcgraf/` (requirements/design) e o
> steering `migracao-calcgraf-carton-wega.md` (seção "🆕 IMPORTADOR DE OP").

---

## 0. O que já está acertado (infra)

| Item | Situação |
|------|----------|
| **Acesso ao servidor do Calcgraf** | Via **RDP** → `sistemas.phtech.net.br:1551`. Usuário Windows criado pelo Pedro: `claudio.rangel` (senha enviada por WhatsApp). Entra na área de trabalho com os atalhos dos sistemas. |
| **Internet no servidor** | Liberada (Pedro confirmou: "não tem restrição quanto à saída pela internet"). HTTPS 443 para `api.vizorerp.com.br` OK. |
| **Instalação do app** | Autorizada pelo Pedro, com o **usuário dele / `claudio.rangel`**, mediando por RDP. Falta o **OK do Matheus**. |
| **Usuário do app Calcgraf** | Quem cria é o **Vinicius (na Wega)** — já passado ao Matheus. `Supervisor / 23787` é login **do aplicativo**, não do SQL. |
| **Credencial de LEITURA do SQL Server** | ✅ Resolvido — login SQL `sa` do próprio Calcgraf (do `CartonWega.udl`): `127.0.0.1\SQL2019Express,5520` / `sa` / `C@1cgraf`. |
| **Logon trigger do SQL (allowlist de apps)** | ✅ Resolvido no agente — ver seção "Logon trigger" abaixo. |

### Logon trigger `[connection]` — por que o agente usa Application Name

O SQL Server do Calcgraf tem uma **logon trigger** (`[connection]`, `ON ALL
SERVER FOR LOGON`) que faz `ROLLBACK` (bloqueia) qualquer conexão ao banco
`CartonWega` cujo **`program_name` (Application Name)** NÃO esteja numa
allowlist mantida pela PHTech. A lista inclui os apps do Calcgraf (`Gprint`,
`Compras`, `Faturamento`, `Producao`, `ExportadorMovimentos`, …), ferramentas
(`.NET SqlClient Data Provider`, SSMS) e os padrões `%WEBGRAF%` /
`%GPRINT_ESPECIFICOS%`.

Por isso o agente conecta via o driver **`mssql`/tedious** (TCP, 100% JS) e se
declara com o **Application Name `ExportadorMovimentos`** — um nome JÁ
AUTORIZADO na allowlist (destinado a exportação de dados). É a forma oficial
prevista pela própria trigger, não um contorno. Se a PHTech preferir outro
nome, basta trocar o default `APPLICATION_NAME_PADRAO` no reader (ou expor o
campo na tela). O `sqlcmd` NÃO declara Application Name — por isso ele é só
último recurso (serve em ambientes sem a trigger, como o backup local de dev).

### Connection string de produção (Carton Wega)

```
server=127.0.0.1\SQL2019Express,5520;Database=CartonWega;UID=sa;PWD=C@1cgraf;TrustServerCertificate=yes;
```

O reader deriva daí: host `127.0.0.1`, porta TCP `5520`, banco `CartonWega`,
login SQL `sa`, e aplica o Application Name `ExportadorMovimentos`.

### Importante — o servidor é remoto (PHTech)

O Calcgraf (e, muito provavelmente, o SQL Server dele) ficam no servidor
remoto da PHTech acessado por RDP. Portanto o agente deve ser instalado
**nesse servidor remoto** (via RDP), onde ele enxerga o SQL como `localhost`.
Não tente instalar na sua máquina conectando no SQL remoto (a PHTech teria
que abrir a porta do SQL para fora — caminho burocrático e desnecessário).

---

## 0.1 Atualização para o v0.3.0 (paridade com o importador de PDF)

O agente **v0.3.0** (spec `importador-calcgraf-paridade-pdf`) passa a enviar os
dados que faltavam para igualar o importador de PDF. A regra de negócio fica no
BACKEND (o agente é "burro"); por isso a ordem de deploy é **backend primeiro**.

### O que muda no v0.3.0 (vs v0.2.1)
- **CNPJ do cliente** (`clienteDoc`): o backend vincula a OP ao cadastro de
  Cliente por CNPJ (só dígitos). Acaba o cliente placeholder "ACTUAL".
- **Programação de entrega**: lida de `PedidoItemEntrega` (todas as parcelas) —
  resolve a "data de entrega em branco" (o `OpLote.DataPrometida` é NULL na
  prática). A menor data vira a `dataEntregaPrevista`.
- **Código do centro por etapa** (`centroCodigo`): o backend resolve o centro
  REAL via de-para (`DeParaImportacao`) antes de reusar por nome/criar — para de
  criar "máquina irreal".
- **Planos/componentes + frente/verso**: multi-plano (TAMPA/CAIXA/BOLSA) e
  retiração (cores NxM de `CalculoAtvImpressao`) viram `PlanoOrdemProducao`.
  Nomenclatura exibida: "VERSO" (valor técnico `FACE`).
- Selo na UI: **"Fase 2+ — Paridade PDF (cliente/entrega/centro/planos)"**.

### Ordem de deploy (OBRIGATÓRIA — backend antes do agente)
1. **Deploy do backend no Render** (`VisioFab.Wms.Back`, branch `main`): as
   regras novas (cliente por CNPJ, planos, programação de entrega, tipo 'M'→
   VERNIZ, cinto de segurança) precisam estar em produção ANTES. Os campos são
   ADITIVOS — um backend novo com agente antigo continua funcionando; um agente
   novo com backend antigo só não aproveita os campos (não quebra).
2. **Validar** no Vizor que o backend novo subiu (ex.: importar/alterar 1 OP e
   conferir cliente/entrega/planos).
3. **Trocar o agente no servidor PHTech (uma vez, via RDP)**:
   - Instalador: `release/VisioFab Agente Calcgraf Setup 0.3.0.exe` (~166 MB).
   - Fechar o agente atual (bandeja), rodar o Setup 0.3.0, reabrir.
   - Conferir na UI o selo **0.3.0 · Fase 2+ — Paridade PDF**.
4. **Monitorar a 1ª sincronização** (ver seção de monitoramento / T10): contagem
   criadas/atualizadas/pendentes; nenhuma perda de etapa/fila (cinto S1 ativo:
   payload sem etapas NÃO zera o roteiro).

### Rede de segurança já embutida (não repetir o incidente das 61 OPs)
- O backend **só substitui roteiro/planos quando o payload traz etapas** (cinto
  S1). Payload sem etapas preserva tudo (atualiza só cabeçalho/entregas).
- OP com produção → vira `AlteracaoOpPendente` (revisão manual), nunca é
  sobrescrita (cinto S2).
- Identidade da OP = `referencia_externa` (nº Calcgraf). Idempotência por hash.

---

## 1. Pré-requisitos no servidor (via RDP)

1. Entrar no servidor por RDP (`sistemas.phtech.net.br:1551`, usuário
   `claudio.rangel`).
2. Confirmar que o **Calcgraf está instalado e aberto** nesse servidor (os
   atalhos dos sistemas estão na área de trabalho).
3. Descobrir **a instância e o nome real do banco** do SQL Server (ver
   seção 2.1). No backup local o banco interno chama-se `GPrint`; em produção
   pode ter outro nome e a instância pode ser `localhost`,
   `localhost\SQLEXPRESS`, `.\CALCGRAF`, etc.

---

## 2. Credencial de leitura do SQL Server (o que falta)

O agente lê o SQL **direto**, sem passar pelo app Calcgraf. Então o
`Supervisor / 23787` (login do app) **não serve** por si só. Há duas formas
de autenticar no SQL — **qualquer uma funciona**, basta uma:

### Opção A — Autenticação Windows (recomendada neste cenário)

Como o app roda com o usuário Windows `claudio.rangel` **no próprio
servidor**, o mais simples é autorizar essa conta Windows a ler o banco
(`db_datareader`). Quem faz: Matheus/Vinicius (ou a PHTech, admin do SQL).
Connection string fica **sem usuário/senha**:

```
Server=localhost;Database=GPrint;Trusted_Connection=yes;Encrypt=false;TrustServerCertificate=true;
```

### Opção B — Usuário SQL dedicado de leitura

Matheus/Vinicius criam um login SQL com perfil `db_datareader` (ex.:
`vizor_leitura`). Connection string:

```
Server=localhost;Database=GPrint;User Id=vizor_leitura;Password=<senha>;Encrypt=false;TrustServerCertificate=true;
```

> Troque `Database=GPrint` pelo nome real do banco em produção e `Server=`
> pela instância correta (ver 2.1).

### 2.1 Como descobrir instância e nome do banco (no servidor, via RDP)

Abrir o **Prompt de Comando** no servidor e rodar:

```cmd
sqlcmd -S localhost -E -C -Q "SELECT name FROM sys.databases"
```

- `-E` = autenticação Windows; `-C` = confiar no certificado (obrigatório no
  ODBC Driver 18).
- Se `localhost` não conectar, tentar `localhost\SQLEXPRESS` ou perguntar à
  PHTech a instância.
- O nome do banco do Calcgraf aparece na lista (procurar algo como `GPrint`,
  `Calcgraf`, `CartonWega`...).

### Texto pronto para pedir ao Matheus/Vinicius

> Pessoal, para o agente do Vizor ler as OPs do Calcgraf, preciso de **acesso
> de leitura ao SQL Server** no servidor onde o Calcgraf roda. Serve uma das
> duas opções: (A) autorizar a conta Windows `claudio.rangel` com perfil
> `db_datareader` no banco do Calcgraf, OU (B) criar um login SQL de leitura
> (`db_datareader`) e me passar usuário/senha. É **somente leitura** (só
> SELECT, não grava nada). Também preciso confirmar o **nome do banco** e a
> **instância** do SQL (ex.: `localhost` ou `localhost\SQLEXPRESS`).

---

## 3. API key da Carton Wega — JÁ CRIADA E EMBUTIDA

A migração do importador **já foi aplicada em produção** (Neon) e uma **API
key ATIVA da Carton Wega** já foi gerada (empresa
`75848e24-742e-461d-b913-1642c5b83ae9`, nome "Agente TS PHTech (Calcgraf)").
Essa chave **já vem pré-preenchida** no campo do agente — não precisa gerar
outra para instalar.

> **Nota de segurança:** a chave viaja embutida no instalador (facilita a
> instalação pelo Pedro). Se o `.exe`/repositório for compartilhado
> amplamente, convém **revogar e gerar outra** depois pela tela do Vizor
> (PCP → Importador Calcgraf → API keys). Lá também dá para revogar/criar
> novas chaves a qualquer momento.

Para gerar/revogar uma chave manualmente (opcional):
1. Vizor logado na **Carton Wega**, perfil **ADMIN/SUPER_ADMIN**.
2. Menu **PCP → Importador Calcgraf → API keys**.
3. **Gerar chave** → copiar o token (só aparece uma vez) → colar no agente.

---

## 4. Instalar o agente no servidor (via RDP)

### 4.1 Instalador (recomendado para produção)

1. Gerar o instalador localmente (na sua máquina de dev):
   ```powershell
   cd c:\Source\VisioFab.Wms.Back\VisioFab.AgenteCalcgraf
   npm install
   npm run dist
   ```
   Gera o instalador NSIS em
   `dist\VisioFab Agente Calcgraf Setup 0.1.0.exe` (~156 MB).

   > **Armadilha resolvida (symlink / winCodeSign):** sem assinatura de código,
   > o electron-builder tentava extrair o pacote `winCodeSign` (que contém
   > symlinks macOS) e falhava no Windows sem privilégio de admin
   > (`Cannot create symbolic link`). O `package.json` já traz
   > `win.signAndEditExecutable: false` + `forceCodeSigning: false`, que pulam
   > essa etapa. Não removê-los (a menos que vá assinar o executável com
   > certificado de code signing).
2. Copiar o `.exe` para o servidor (pela sessão RDP, área de transferência
   ou pasta compartilhada) e executar a instalação (permite escolher a pasta
   e cria atalho na área de trabalho).

### 4.2 Modo dev (para testar antes, na sua máquina)

Aponta para o backup local `CalcgrafCartonWega` e, se quiser, para o back
local (`http://localhost:3333`):

```powershell
cd c:\Source\VisioFab.Wms.Back\VisioFab.AgenteCalcgraf
npm install
npm run build
npm start
```

> O driver `msnodesqlv8` é `optionalDependency` e pode não compilar sem os
> Build Tools do Visual Studio. Se faltar, o leitor cai automaticamente no
> **fallback `sqlcmd`** (o mesmo que você já usou para explorar o backup).

> **Lições de runtime já resolvidas (não regredir):**
> - O `main` NÃO importa valores do `preload` (isso carregaria o preload no
>   processo main e quebraria em `contextBridge.exposeInMainWorld`). O contrato
>   de IPC fica em `src/ipc-canais.ts` (módulo neutro, sem efeito colateral).
> - A janela usa `webPreferences.sandbox: false` (com `contextIsolation: true`
>   + `nodeIntegration: false`). No Electron 31 o sandbox é `true` por padrão e
>   um preload sandboxed não consegue `require()` de módulos locais — isso
>   deixava `window.agenteApi` indisponível ("preload não carregado").

---

## 5. Configurar o agente (tela de configuração)

Ao abrir o agente pela 1ª vez, **os 4 campos já vêm pré-preenchidos** com os
defaults da Carton Wega. Só é preciso **conferir/ajustar a connection string**
(o nome do banco/instância do SQL no servidor real) e clicar em **Salvar
configuração**. Os valores são persistidos em
`%APPDATA%/VisioFabAgenteCalcgraf/config.json` (segredos cifrados via DPAPI).

| Campo | Default embutido | Ação |
|-------|------------------|------|
| **Connection string do SQL Server** | `server=localhost;Database=GPrint;Trusted_Connection=yes;TrustServerCertificate=yes;` | **Conferir** o nome do banco (`GPrint`) e a instância (`localhost`) no servidor real — ver seção 2.1. Ajustar se diferente. |
| **URL da API do Vizor** | `https://api.vizorerp.com.br` | Manter. |
| **API key do agente** | *(chave da Carton Wega já preenchida)* | Manter (ou trocar se gerou outra). |
| **Intervalo de sincronização (min)** | `15` | Ajustar se quiser. |

> Se o SQL do servidor NÃO aceitar autenticação Windows (`Trusted_Connection`),
> troque para usuário SQL de leitura:
> `server=localhost;Database=GPrint;UID=<usuario>;PWD=<senha>;TrustServerCertificate=yes;`
> (ver seção 2, Opção B).

---

## 6. Primeira sincronização e validação

1. Clicar em **"Sincronizar agora"**.
2. Ler o painel de resultado: **novas / alteradas / pendentes / erros**.
3. No Vizor (empresa Carton Wega): abrir **PCP → Ordens de Produção** e
   confirmar que as OPs chegaram (origem `AGENTE_CALCGRAF`).
4. Rodar a sincronização **de novo**: as mesmas OPs devem vir como
   **ignoradas** (idempotência por hash — nada é duplicado).

### Checklist de "deu certo"

- [ ] Primeira sync traz as OPs em programação como **novas**.
- [ ] As OPs aparecem na lista de Ordens de Produção da **Carton Wega**.
- [ ] Segunda sync (sem alterar nada no Calcgraf) traz tudo como
      **ignorada** (0 duplicadas).
- [ ] Alterar uma OP no Calcgraf → próxima sync traz **alterada** (se a OP
      ainda não tem produção) ou **pendente** (se já tem produção).

---

## 7. Alterações pendentes (OP que já tem produção)

Se uma OP já tem apontamento/produção no Vizor e muda no Calcgraf, o agente
**NÃO sobrescreve** automaticamente — vira uma **alteração pendente** para
revisão manual:

1. Vizor → **PCP → Importador Calcgraf → Pendentes**
   (`/pcp/importador-calcgraf/pendentes`).
2. Revisar e escolher **Aplicar** (força a atualização da OP) ou
   **Descartar** (mantém a OP como está).

---

## 8. Segurança e escopo (resumo)

- **Somente leitura** no Calcgraf: o agente só faz `SELECT`, nunca grava no
  banco de origem.
- **Isolamento por empresa**: a API key pertence à Carton Wega; as OPs são
  gravadas **sempre** sob a empresa da key (nunca vêm do corpo da requisição).
  Um agente com key da Carton Wega não consegue escrever em outra empresa.
- **Segredos cifrados em repouso** (connection string e API key) via DPAPI do
  Windows.
- **Resiliência**: falha de rede mantém a OP pendente e reenvia na próxima
  sync; só marca enviado após resposta 2xx do Vizor.

---

## 9. Pendências / próximos passos

- [ ] OK do **Matheus** para a instalação.
- [ ] Credencial de **leitura do SQL** (seção 2) — Matheus/Vinicius/PHTech.
- [ ] Confirmar **nome do banco** e **instância** do SQL em produção (2.1).
- [ ] Rodar a **migração** no Vizor em produção (sai automática no deploy do
      Render via `migrate-prod.ts`; idempotente). Validar que as tabelas
      `agente_api_key` e `alteracao_op_pendente` existem.
- [ ] Instalar + configurar + validar a primeira sync (seções 4–6).
