/**
 * Contrato de IPC compartilhado entre o `main` e o `preload`.
 *
 * POR QUE ESTE MÓDULO EXISTE (separado do preload)
 * ------------------------------------------------
 * O `preload.ts` tem um EFEITO COLATERAL no topo do módulo:
 * `contextBridge.exposeInMainWorld(...)`. Esse `contextBridge` SÓ existe no
 * processo de preload/renderer — no processo MAIN ele é `undefined`.
 *
 * Se o `main.ts` importar QUALQUER valor de `./preload` (ex.: as constantes de
 * canais), o Node carrega o módulo `preload` inteiro no processo main e executa
 * o `exposeInMainWorld` ali → crash "Cannot read properties of undefined
 * (reading 'exposeInMainWorld')". Foi exatamente o erro observado.
 *
 * Solução: as constantes/tipos de contrato (sem efeito colateral) vivem AQUI.
 * Tanto o `main` quanto o `preload` importam deste módulo neutro. O `preload`
 * continua sendo o ÚNICO a chamar `contextBridge`, e o `main` nunca mais
 * carrega o preload como módulo.
 */

import type { ConfigAgente } from './config/config'
import type { ResumoSync } from './scheduler/scheduler'

/** Nomes dos canais IPC — fonte única compartilhada por main e preload. */
export const CANAIS = {
  lerConfig: 'agente:lerConfig',
  salvarConfig: 'agente:salvarConfig',
  sincronizarAgora: 'agente:sincronizarAgora',
  lerLog: 'agente:lerLog',
  /** Evento push: o main envia um ResumoSync a cada ciclo de segundo plano. */
  eventoResumo: 'agente:resumo',
} as const

/**
 * Entrada do log em memória/arquivo exposta à UI. Cada ciclo de sincronização
 * (manual ou de segundo plano) gera uma entrada.
 */
export interface EntradaLog {
  /** Instante da entrada (ISO). */
  em: string
  /** Origem do ciclo: manual (botão) ou segundo plano. */
  origem: 'manual' | 'segundo-plano'
  /** O resumo do ciclo correspondente. */
  resumo: ResumoSync
}

/**
 * Superfície segura exposta ao renderer como `window.agenteApi`. Tipagem forte:
 * o renderer importa este tipo para ter autocomplete e checagem.
 */
export interface AgenteApi {
  /** Lê a config atual (segredos já decifrados pelo main). */
  lerConfig(): Promise<ConfigAgente>
  /** Salva um subconjunto da config (o main cifra os segredos em repouso). */
  salvarConfig(parcial: Partial<ConfigAgente>): Promise<ConfigAgente>
  /** Dispara uma sincronização sob demanda e devolve o resumo do ciclo. */
  sincronizarAgora(): Promise<ResumoSync>
  /** Lê o log de ciclos (mais recentes primeiro). */
  lerLog(): Promise<EntradaLog[]>
  /**
   * Assina os eventos de resumo do segundo plano. Retorna uma função para
   * cancelar a assinatura (remover o listener).
   */
  onResumo(cb: (entrada: EntradaLog) => void): () => void
}
