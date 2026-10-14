/**
 * Preload do Agente Calcgraf (Tarefa 12).
 *
 * POR QUE EXISTE
 * --------------
 * O padrão seguro do Electron é `contextIsolation: true` + `nodeIntegration:
 * false`: o renderer (a tela HTML) NÃO tem acesso a Node nem ao filesystem.
 * Para a tela conversar com o processo principal (ler/salvar config, disparar
 * sincronização, receber o resumo do segundo plano, ler o log) usamos:
 *   - `contextBridge.exposeInMainWorld` → expõe um objeto tipado e MÍNIMO
 *     (`window.agenteApi`) no renderer, sem vazar o `ipcRenderer` cru;
 *   - `ipcRenderer.invoke`/`on` → ponte de mensagens para o `ipcMain` do main.
 *
 * IMPORTANTE: este módulo tem EFEITO COLATERAL no topo (`exposeInMainWorld`),
 * que SÓ pode rodar no processo de preload/renderer. Por isso o contrato de IPC
 * (constantes de canais + tipos) foi extraído para `./ipc-canais` — um módulo
 * NEUTRO que o `main` pode importar sem carregar este preload. NÃO reintroduzir
 * `export const CANAIS`/tipos aqui: o main importa de `ipc-canais`.
 *
 * Segurança dos segredos: a UI envia os valores EM CLARO para o main via IPC
 * (connection string / API key), e o MAIN persiste cifrado (DPAPI) via
 * `config.salvarConfig`. O renderer nunca toca disco nem a cifra.
 */

import { contextBridge, ipcRenderer } from 'electron'

import { CANAIS } from './ipc-canais'
import type { AgenteApi, EntradaLog } from './ipc-canais'

// ---------------------------------------------------------------------------
// Implementação da ponte (contextBridge)
// ---------------------------------------------------------------------------

const api: AgenteApi = {
  lerConfig: () => ipcRenderer.invoke(CANAIS.lerConfig),
  salvarConfig: (parcial) => ipcRenderer.invoke(CANAIS.salvarConfig, parcial),
  sincronizarAgora: () => ipcRenderer.invoke(CANAIS.sincronizarAgora),
  lerLog: () => ipcRenderer.invoke(CANAIS.lerLog),
  onResumo: (cb) => {
    // Encapsula o listener para NÃO vazar o objeto `event` do IPC ao renderer.
    const handler = (_event: unknown, entrada: EntradaLog): void => cb(entrada)
    ipcRenderer.on(CANAIS.eventoResumo, handler)
    return () => ipcRenderer.removeListener(CANAIS.eventoResumo, handler)
  },
}

contextBridge.exposeInMainWorld('agenteApi', api)
