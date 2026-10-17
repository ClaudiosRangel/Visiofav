/**
 * Processo principal do Agente Calcgraf (Electron).
 *
 * Tarefa 12 (UI + IPC + segundo plano):
 *  - Carrega a janela com um PRELOAD (`contextIsolation: true`,
 *    `nodeIntegration: false`) que expõe `window.agenteApi` ao renderer.
 *  - Registra os handlers `ipcMain.handle(...)` que a UI consome:
 *      lerConfig / salvarConfig / sincronizarAgora / lerLog.
 *  - Monta as `SyncDeps` do scheduler a partir da config (configSender,
 *    conexaoCalcgraf derivada da connection string, estado = new EstadoLocal()).
 *  - Inicia `iniciarSegundoPlano` com o intervalo da config e repassa cada
 *    `ResumoSync` ao renderer (`webContents.send`) + a um buffer de log em
 *    memória, persistido em `%APPDATA%/VisioFabAgenteCalcgraf/log.json`.
 *  - Auto-start em segundo plano via `setLoginItemSettings` (Req 7.1/9).
 *
 * Os tipos do pacote `electron` são resolvidos por `src/electron.d.ts` (ambient
 * module) enquanto o Electron não está instalado, mantendo `tsc --noEmit` verde.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'

import { lerConfig, salvarConfig, obterDiretorioConfig } from './config/config'
import type { ConfigAgente } from './config/config'
import { EstadoLocal } from './state-store/state-store'
import { sincronizarAgora } from './scheduler/scheduler'
import type { SyncDeps, ResumoSync, HandleSegundoPlano } from './scheduler/scheduler'
import type { ConfigSender } from './sender/sender'
import type { ConfigConexaoCalcgraf } from './calcgraf-reader/calcgraf-reader'
import { CANAIS } from './ipc-canais'
import type { EntradaLog, InfoVersao } from './ipc-canais'

/**
 * Identificação deste build para a UI. `trazRoteiro: true` marca que esta é a
 * FASE 2+ (envia etapas/variações do Calcgraf). Em um build fase 1 isso seria
 * false — é o jeito à prova de dúvida de saber qual versão está instalada.
 *
 * v0.3.0 (paridade PDF — spec importador-calcgraf-paridade-pdf): além do
 * roteiro, o reader passou a enviar os dados que faltavam para igualar o
 * importador de PDF — CNPJ do cliente (vínculo por documento, acaba o
 * "ACTUAL"), programação de entrega (via PedidoItemEntrega — resolve a
 * "entrega em branco"), código do centro por etapa (de-para → centro real,
 * não cria máquina irreal) e planos/componentes com cores e frente/verso.
 *
 * v0.4.0 (observações — spec op-visualizacao-observacoes-calcgraf): o reader
 * passou a trazer a OBSERVAÇÃO textual da OP (campo memo `TabelaMemos`,
 * NomeTabela='CalculoOp') — Serviço Novo/Repetição + bobinas "em estoque/
 * encomendado (N kg)" + LXL + Montagem. Com isso a regra "Aguardando Cartão"
 * passa a funcionar também nas OPs sincronizadas (antes só nas de PDF).
 */
const INFO_VERSAO: Omit<InfoVersao, 'versao'> = {
  fase: 'Fase 2+ — Paridade PDF + Observações da OP',
  trazRoteiro: true,
}

/** Referência à janela principal (evita coleta pelo GC). */
let janela: BrowserWindow | null = null

/** Handle do loop de segundo plano (para parar no shutdown). */
let handleSegundoPlano: HandleSegundoPlano | null = null

/**
 * Lock GLOBAL de sincronização: garante que NUNCA rodem dois ciclos ao mesmo
 * tempo (manual via botão + automático do segundo plano). Sem isso, um clique
 * "Sincronizar agora" durante um ciclo automático processava a mesma OP em
 * paralelo e criava OPs DUPLICADAS (o match por referência não via a criação
 * concorrente). Promise encadeada = serialização simples e segura.
 */
let cadeiaSincronizacao: Promise<ResumoSync> = Promise.resolve(null as unknown as ResumoSync)

/** Buffer de log em memória (mais recentes primeiro). Limitado a MAX_LOG. */
const bufferLog: EntradaLog[] = []
const MAX_LOG = 200

/** Caminho do arquivo de log persistido. */
function caminhoArquivoLog(): string {
  return path.join(obterDiretorioConfig(), 'log.json')
}

// ---------------------------------------------------------------------------
// Montagem das dependências do scheduler a partir da config
// ---------------------------------------------------------------------------

/**
 * Deriva a `ConfigConexaoCalcgraf` a partir da connection string salva. Em
 * produção (TS do Calcgraf) o modo é `auto` (tenta o driver msnodesqlv8 com a
 * connection string ODBC; cai no sqlcmd se indisponível).
 */
function montarConexaoCalcgraf(config: ConfigAgente): ConfigConexaoCalcgraf {
  return {
    modo: 'auto',
    connectionString: config.connectionStringSqlServer,
  }
}

/** Monta a config do sender (URL + API key) a partir da config do agente. */
function montarConfigSender(config: ConfigAgente): ConfigSender {
  return {
    urlApiVizor: config.urlApiVizor,
    apiKeyAgente: config.apiKeyAgente,
  }
}

/**
 * Monta as `SyncDeps` completas para um ciclo. Reusa UM `EstadoLocal` por
 * processo (passado por parâmetro) para não reabrir o arquivo a cada ciclo.
 */
function montarDeps(config: ConfigAgente, estado: EstadoLocal): SyncDeps {
  return {
    configSender: montarConfigSender(config),
    conexaoCalcgraf: montarConexaoCalcgraf(config),
    estado,
  }
}

// ---------------------------------------------------------------------------
// Log em memória + arquivo
// ---------------------------------------------------------------------------

/** Carrega o log persistido no boot (se existir). */
function carregarLog(): void {
  try {
    const arquivo = caminhoArquivoLog()
    if (!fs.existsSync(arquivo)) return
    const parsed = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as EntradaLog[]
    if (Array.isArray(parsed)) {
      bufferLog.splice(0, bufferLog.length, ...parsed.slice(0, MAX_LOG))
    }
  } catch (erro) {
    console.warn('[main] falha ao ler log.json, iniciando vazio:', erro)
  }
}

/** Persiste o log (best-effort; falha de escrita não derruba o agente). */
function salvarLog(): void {
  try {
    const dir = obterDiretorioConfig()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(caminhoArquivoLog(), JSON.stringify(bufferLog, null, 2), 'utf8')
  } catch (erro) {
    console.warn('[main] falha ao gravar log.json:', erro)
  }
}

/**
 * Registra uma entrada de log (resumo de um ciclo), empurra para o renderer
 * (se a janela existir) e persiste. Mantém o buffer no limite `MAX_LOG`.
 */
function registrarResumo(origem: EntradaLog['origem'], resumo: ResumoSync): void {
  const entrada: EntradaLog = { em: new Date().toISOString(), origem, resumo }
  bufferLog.unshift(entrada)
  if (bufferLog.length > MAX_LOG) bufferLog.length = MAX_LOG
  salvarLog()
  // Push para o renderer (eventos de resumo do segundo plano / manual).
  if (janela && !janela.isDestroyed()) {
    janela.webContents.send(CANAIS.eventoResumo, entrada)
  }
}

// ---------------------------------------------------------------------------
// IPC handlers (consumidos pelo preload → window.agenteApi)
// ---------------------------------------------------------------------------

/**
 * Registra os handlers IPC. Cada handler faz o mínimo e delega aos módulos de
 * negócio. Segredos: `lerConfig` devolve decifrado (a UI reexibe/edita);
 * `salvarConfig` persiste cifrado (o main é o único a tocar DPAPI/disco).
 */
/**
 * Executa um ciclo de sincronização SERIALIZADO pelo lock global: encadeia na
 * `cadeiaSincronizacao` para que manual e automático nunca rodem em paralelo
 * (evita OPs duplicadas por corrida). Registra o resumo com a `origem` dada.
 */
function sincronizarSerializado(estado: EstadoLocal, origem: EntradaLog['origem']): Promise<ResumoSync> {
  cadeiaSincronizacao = cadeiaSincronizacao.then(async () => {
    const config = lerConfig()
    const resumo = await sincronizarAgora(montarDeps(config, estado))
    registrarResumo(origem, resumo)
    return resumo
  })
  return cadeiaSincronizacao
}

function registrarHandlersIpc(estado: EstadoLocal): void {
  ipcMain.handle(CANAIS.lerVersao, (): InfoVersao => {
    const versao = typeof app.getVersion === 'function' ? app.getVersion() : '0.0.0'
    return { versao, ...INFO_VERSAO }
  })

  ipcMain.handle(CANAIS.lerConfig, () => {
    return lerConfig()
  })

  ipcMain.handle(CANAIS.salvarConfig, (_event, parcial) => {
    salvarConfig((parcial ?? {}) as Partial<ConfigAgente>)
    // Reinicia o segundo plano com o novo intervalo/credenciais.
    reiniciarSegundoPlano(estado)
    return lerConfig()
  })

  ipcMain.handle(CANAIS.sincronizarAgora, async () => {
    // Serializado pelo lock global (nunca em paralelo com o ciclo automático).
    return sincronizarSerializado(estado, 'manual')
  })

  ipcMain.handle(CANAIS.lerLog, () => {
    return bufferLog
  })
}

// ---------------------------------------------------------------------------
// Segundo plano
// ---------------------------------------------------------------------------

/**
 * (Re)inicia o loop de sincronização em segundo plano com o intervalo atual da
 * config. Para o loop anterior (se houver) antes de iniciar o novo.
 */
function reiniciarSegundoPlano(estado: EstadoLocal): void {
  if (handleSegundoPlano) {
    handleSegundoPlano.parar()
    handleSegundoPlano = null
  }
  const config = lerConfig()
  // Sem credenciais mínimas não adianta rodar o loop (evita 401 em loop).
  if (!config.apiKeyAgente || !config.connectionStringSqlServer) {
    console.warn('[main] segundo plano não iniciado — configuração incompleta.')
    return
  }

  // Loop próprio em cima do LOCK GLOBAL (`sincronizarSerializado`): cada tick
  // enfileira um ciclo que NUNCA roda em paralelo com o manual nem com outro
  // tick (resolve a corrida que duplicava OPs). Usa setTimeout recursivo para
  // não sobrepor: o próximo tick só agenda após o ciclo terminar.
  const intervaloMs = Math.max(1, config.intervaloSyncMinutos) * 60_000
  let parado = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const tick = async (): Promise<void> => {
    if (parado) return
    try {
      await sincronizarSerializado(estado, 'segundo-plano')
    } catch (e) {
      console.error('[main] erro no ciclo de segundo plano:', e instanceof Error ? e.message : String(e))
    } finally {
      if (!parado) timer = setTimeout(() => void tick(), intervaloMs)
    }
  }

  // Primeiro ciclo imediato (como o scheduler fazia).
  void tick()

  handleSegundoPlano = {
    parar(): void {
      parado = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Janela
// ---------------------------------------------------------------------------

/** Cria a janela de configuração/painel do agente, com o preload seguro. */
function criarJanela(): void {
  janela = new BrowserWindow({
    width: 860,
    height: 720,
    title: 'VisioFab — Agente Calcgraf',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox DESLIGADO de propósito: no Electron 31 o padrão é sandbox=true,
      // e um preload sandboxed NÃO consegue `require()` de módulos locais
      // (ex.: ./ipc-canais) — o preload falhava silenciosamente e
      // `window.agenteApi` nunca era exposto ("preload não carregado").
      // A segurança do renderer continua garantida por contextIsolation=true +
      // nodeIntegration=false (a tela não acessa Node direto, só a ponte
      // tipada window.agenteApi). O preload roda em contexto Node confiável.
      sandbox: false,
    },
  })

  // A UI (src/ui/index.html) é estática e conversa com o main só via o preload.
  void janela.loadFile(path.join(__dirname, '..', 'src', 'ui', 'index.html'))

  janela.on('closed', () => {
    janela = null
  })
}

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------

async function iniciar(): Promise<void> {
  // Garante instância única (um agente por máquina).
  const temLock = typeof app.requestSingleInstanceLock === 'function' ? app.requestSingleInstanceLock() : true
  if (!temLock) {
    app.quit()
    return
  }

  await app.whenReady()

  // Estado local único por processo (hash por OP). Reusado em todos os ciclos.
  const estado = new EstadoLocal()

  carregarLog()
  registrarHandlersIpc(estado)

  const config = lerConfig()
  if (!config.apiKeyAgente || !config.connectionStringSqlServer) {
    console.warn('[main] configuração incompleta — abra a tela de configuração.')
  }

  // Auto-start no login do Windows (segundo plano). Mantém o agente ativo após
  // reboot do TS sem intervenção (Req 7.1/9).
  if (typeof app.setLoginItemSettings === 'function') {
    app.setLoginItemSettings({ openAtLogin: true })
  }

  criarJanela()

  // Inicia o loop de sincronização em segundo plano (intervalo da config).
  reiniciarSegundoPlano(estado)

  app.on('window-all-closed', () => {
    // No Windows, o agente poderia seguir em segundo plano (tray). Para o MVP,
    // encerramos ao fechar a janela (sem deixar processo órfão). O auto-start
    // garante que o agente volte no próximo login.
    if (handleSegundoPlano) handleSegundoPlano.parar()
    app.quit()
  })
}

void iniciar()
