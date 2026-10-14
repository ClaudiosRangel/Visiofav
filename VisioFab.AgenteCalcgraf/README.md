# VisioFab — Agente Calcgraf

Aplicativo desktop (Electron + TypeScript) instalado no servidor/terminal (TS)
onde o **Calcgraf** está instalado. Lê o banco **SQL Server do Calcgraf em modo
somente leitura**, detecta as **OPs novas e alteradas** e as envia pela internet
(HTTPS) para a **API do Vizor**, que cria/atualiza as Ordens de Produção.

Elimina a importação manual de PDF de OP. Spec:
`.kiro/specs/importador-op-calcgraf/`.

> Este app é um projeto Electron **independente** (package.json/tsconfig
> próprios), fisicamente dentro do repo `VisioFab.Wms.Back` — mesmo padrão do
> `VisioFab.Checkout`.

## Como configurar

Na primeira execução, abra a tela de configuração e informe:

1. **Connection string do SQL Server (somente leitura)** — conexão ao banco
   local do Calcgraf no TS. Recomendado um usuário SQL com role `db_datareader`
   (só-leitura), definido pelo DevOps. É um **segredo**, cifrado em repouso.
2. **URL da API do Vizor** — `https://api.vizorerp.com.br` (padrão).
3. **Chave do agente (API key)** — gerada no Vizor em **PCP → Agente API Keys**
   (exibida apenas uma vez na criação). É um **segredo**, cifrado em repouso.
4. **Intervalo de sincronização (minutos)** — periodicidade da sincronização em
   segundo plano.

A configuração fica em `%APPDATA%/VisioFabAgenteCalcgraf/config.json`. Os
segredos (connection string e API key) são cifrados via **DPAPI** (`safeStorage`
do Electron); nunca gravados em texto plano.

## Requisitos de infraestrutura (DevOps)

- **Saída HTTPS (porta 443)** liberada do TS para `api.vizorerp.com.br`
  (firewall/proxy). Requisito 9.3.
- Acesso **somente leitura** ao SQL Server local do Calcgraf (named pipes /
  shared memory — a instância pode não expor TCP/1433).

## Scripts

| Script | Ação |
|--------|------|
| `npm run build` | Compila o TypeScript (`tsc -p tsconfig.json`) para `dist/`. |
| `npm run typecheck` | `tsc --noEmit` (checagem de tipos sem emitir). |
| `npm start` / `npm run dev` | Executa o app no Electron (`electron .`). |
| `npm run dist` | Gera o instalável Windows (`electron-builder --win`, target NSIS). |

## Como rodar em desenvolvimento

```powershell
npm install          # instala Electron + electron-builder (devDependencies)
npm run build        # compila src/*.ts → dist/ (inclui main.js e preload.js)
npm start            # abre a janela do agente (Electron)
```

O `main` do app é `dist/main.js` (ver `package.json`), então **sempre rodar
`npm run build` antes de `npm start`** após mexer no TypeScript. A UI
(`src/ui/index.html` + `src/ui/renderer.js`) é estática/JS puro — não precisa de
build; o renderer conversa com o processo principal só via `window.agenteApi`.

## Como gerar o instalável (Windows)

```powershell
npm run build && npm run dist
```

- `npm run build` compila o TypeScript para `dist/`.
- `npm run dist` roda o `electron-builder --win` (target **NSIS**) e gera o
  instalável em `dist/` (ou `release/`, conforme a config padrão do
  electron-builder). O bloco `build` do `package.json` empacota `dist/**/*`
  (inclui `main.js` + `preload.js`), `src/ui/**/*` (HTML + renderer) e o
  `package.json`. O NSIS está configurado para permitir escolher a pasta de
  instalação e criar atalhos (menu Iniciar + área de trabalho).

> O instalável não é gerado automaticamente neste repositório — rode o
> `npm run dist` na máquina Windows do DevOps quando for distribuir.

## Fluxo de uso

1. **Configurar** (card "Configuração"): informe a connection string do SQL
   Server (somente leitura), a URL da API do Vizor, a chave do agente e o
   intervalo; clique em **Salvar configuração**. Os segredos vão em claro da UI
   para o processo principal via IPC e são persistidos **cifrados** (DPAPI) —
   o renderer nunca toca disco nem a cifra.
2. **Sincronização em segundo plano**: ao salvar (e no próximo login do
   Windows, via auto-start), o agente passa a sincronizar automaticamente no
   intervalo configurado. Cada ciclo detecta OPs novas/alteradas e envia ao
   Vizor; o resultado aparece no painel e no log em tempo real.
3. **Sincronizar agora** (card "Sincronização"): dispara um ciclo sob demanda e
   mostra o **painel de resultado** — contadores de **novas / alteradas /
   enviadas / pendentes / erros** — e eventuais mensagens de erro por OP.
4. **Log de sincronizações**: histórico dos ciclos (manual e automático), com
   contadores resumidos por linha. Persistido em
   `%APPDATA%/VisioFabAgenteCalcgraf/log.json`.

## IPC seguro (preload + contextBridge)

A tela roda com `contextIsolation: true` + `nodeIntegration: false` (padrão
seguro do Electron). O `src/preload.ts` expõe, via `contextBridge`, um objeto
**mínimo e tipado** `window.agenteApi` com só o necessário —
`lerConfig()`, `salvarConfig(parcial)`, `sincronizarAgora()`, `lerLog()` e
`onResumo(cb)` — por cima de `ipcRenderer.invoke`/`on`. O `src/main.ts` registra
os `ipcMain.handle(...)` correspondentes, monta as `SyncDeps` do scheduler a
partir da config e empurra cada `ResumoSync` do segundo plano ao renderer via
`webContents.send`. O `ipcRenderer` cru **não** é exposto ao renderer.

### Auto-start em segundo plano

O `main.ts` chama `app.setLoginItemSettings({ openAtLogin: true })` na
inicialização, de modo que o agente volte a rodar automaticamente após o login
do Windows no TS — garantindo a sincronização contínua sem intervenção manual.

> Os tipos do pacote `electron` são resolvidos por `src/electron.d.ts` (ambient
> module) enquanto o Electron não está instalado, mantendo `tsc --noEmit` verde.
> Ao instalar o Electron de verdade (para rodar/empacotar), os tipos oficiais
> prevalecem.

## Estrutura

```
src/
  main.ts                      processo principal (janela + preload + IPC + scheduler + auto-start)
  preload.ts                   ponte segura (contextBridge) → window.agenteApi tipado
  electron.d.ts                ambient module mínimo do 'electron' (fallback de tooling)
  config/config.ts             leitura/gravação da config + cifra de segredos (DPAPI)
  calcgraf-reader/
    calcgraf-reader.ts         leitor SOMENTE LEITURA do SQL Server (DTO + queries de OP)
    msnodesqlv8.d.ts           ambient module mínimo do 'msnodesqlv8' (fallback de tooling)
  change-detector/             detecção de mudança por hash + classificação NOVA/ALTERADA
  state-store/                 estado local (hash por OP) em %APPDATA%
  sender/                      envio HTTPS autenticado (retry/backoff, lotes)
  scheduler/                   ciclo de sincronização (sincronizarAgora + segundo plano)
  ui/
    index.html                 tela funcional (config + sincronização + resultado + log)
    renderer.js                lógica da tela (JS puro; consome window.agenteApi)
```

## Leitor do Calcgraf (`calcgraf-reader`)

Lê o SQL Server do Calcgraf em **modo somente leitura** e monta o
`OpOrigemDTO` — o MESMO shape consumido pelo backend do Vizor
(`src/modules/pcp/importador-calcgraf/ingestao-op-calcgraf.pure.ts`). O DTO é
duplicado localmente (`OpOrigemDTO` + filhas) porque agente e backend são
projetos separados que não compartilham tipos; **manter o espelho em sincronia**
(mesma ordem/nomes de campos — o hash dos dois lados precisa casar).

**Somente leitura (Requisito 1.1):** o leitor só emite `SELECT`. Não há método
de escrita, e toda query passa por `assertSomenteLeitura()`, que rejeita qualquer
comando que não comece por SELECT/WITH/SET. Em produção, recomenda-se ainda um
usuário SQL `db_datareader` (Requisito 1.2) — dupla camada.

**Abstração de conexão (dois modos, interface única):**
- **Driver primário `msnodesqlv8`** (named pipes / ODBC; Trusted ou usuário SQL).
  É uma **optionalDependency** — não precisa estar instalado nesta fase; os tipos
  são resolvidos pelo ambient `msnodesqlv8.d.ts` (mesmo padrão do `electron.d.ts`),
  mantendo `tsc --noEmit` verde sem instalar.
- **Fallback `sqlcmd` + `FOR JSON PATH`** (child_process). Reconstrói o JSON que o
  sqlcmd quebra por largura de coluna (remove as quebras de linha).
- Escolha por `modo: 'driver' | 'sqlcmd' | 'auto'` (padrão `auto`: tenta o driver,
  cai no sqlcmd).

**Queries de OP** (colunas conferidas com `docs/calcgraf-mapeamento-importacao.md`):
OpHeader (candidatas: `Ativo <> 'N'` + filtro opcional por faixa de Numero/
DataHoraEmissao), OpItem, OpItemEstrutura e OpLote (JOIN por `CodOpItemEstrutura`
para tiragem/DataPrometida/OrdemFilaOp/Status). Produto/cliente ficam best-effort
(TODO documentado no código — vínculo `CodItemEstoque`/pedido é risco/pendência).

**Como validar** contra o backup local `CalcgrafCartonWega` (quando houver SQL
Server acessível), usando o fallback sqlcmd (golden: OP 3138/3137):
```ts
import { lerOpsEComFechar } from './calcgraf-reader/calcgraf-reader'
const ops = await lerOpsEComFechar(
  { modo: 'sqlcmd', servidor: 'localhost', database: 'CalcgrafCartonWega' },
  { numeroMinimo: 3137, numeroMaximo: 3138 },
)
```
Equivale a:
```
sqlcmd -S localhost -E -C -d CalcgrafCartonWega -y 0 \
  -Q "SET NOCOUNT ON; SELECT Codigo, Numero, DataHoraEmissao, Descricao
      FROM OpHeader WHERE Ativo <> 'N' AND Numero >= 3137 AND Numero <= 3138
      ORDER BY Numero FOR JSON PATH"
```

Próximas fases da spec: detecção por hash + estado local, envio/scheduler e
UI/empacotamento.
