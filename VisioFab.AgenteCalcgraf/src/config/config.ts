/**
 * Módulo `config` do Agente Calcgraf.
 *
 * Responsabilidade (Tarefa 8 / Requisitos 7.4, 9.1, 9.2, 9.4):
 * - Persistir a configuração do agente em `config.json`, dentro de
 *   `%APPDATA%/VisioFabAgenteCalcgraf/`.
 * - Proteger os SEGREDOS em repouso (`connectionStringSqlServer` e
 *   `apiKeyAgente`): cifrados via `safeStorage` do Electron (DPAPI no Windows)
 *   quando disponível; fallback explícito (base64 marcado) quando não houver
 *   Electron/criptografia — NUNCA gravar segredo em texto plano silencioso.
 *
 * Isolamento do Electron:
 * - Todo uso de `app`/`safeStorage` fica atrás de checagens de disponibilidade
 *   (`try/catch` ao resolver o módulo + `isEncryptionAvailable()`), para o
 *   módulo compilar e rodar fora do Electron (ex.: em testes Node puros).
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

/** Configuração completa do agente. */
export interface ConfigAgente {
  /** Connection string do SQL Server local do Calcgraf (somente leitura). SEGREDO. */
  connectionStringSqlServer: string
  /** URL base da API do Vizor (ex.: https://api.vizorerp.com.br). */
  urlApiVizor: string
  /** Chave/token do agente para autenticar na API do Vizor. SEGREDO. */
  apiKeyAgente: string
  /** Intervalo de sincronização em segundo plano, em minutos. */
  intervaloSyncMinutos: number
}

/** Chaves da config que são segredos e devem ser cifradas em repouso. */
const CAMPOS_SECRETOS: ReadonlyArray<keyof ConfigAgente> = [
  'connectionStringSqlServer',
  'apiKeyAgente',
]

/** Prefixo que marca um valor que caiu no fallback base64 (NÃO é DPAPI). */
const PREFIXO_FALLBACK_B64 = 'b64:'
/** Prefixo que marca um valor cifrado via safeStorage/DPAPI. */
const PREFIXO_DPAPI = 'dpapi:'

const DIR_CONFIG = 'VisioFabAgenteCalcgraf'
const ARQUIVO_CONFIG = 'config.json'

const CONFIG_PADRAO: ConfigAgente = {
  connectionStringSqlServer: '',
  urlApiVizor: 'https://api.vizorerp.com.br',
  apiKeyAgente: '',
  intervaloSyncMinutos: 15,
}

/**
 * Tenta carregar o módulo `electron` sem quebrar fora do Electron.
 * Retorna `null` quando indisponível (processo Node puro / testes).
 */
function carregarElectron(): typeof import('electron') | null {
  try {
    // require dinâmico: fora do Electron o módulo não existe e cai no catch.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('electron') as typeof import('electron')
  } catch {
    return null
  }
}

/** Diretório onde a config é persistida. Usa `app.getPath('userData')` no Electron. */
export function obterDiretorioConfig(): string {
  const electron = carregarElectron()
  if (electron?.app && typeof electron.app.getPath === 'function') {
    try {
      // userData já aponta para %APPDATA%/<AppName>; mantemos o subdiretório fixo
      // para ficar previsível e documentável para o DevOps.
      const base = electron.app.getPath('userData')
      return base
    } catch {
      // segue para o fallback por env abaixo
    }
  }
  const appData =
    process.env.APPDATA ||
    path.join(process.env.USERPROFILE || process.env.HOME || '.', 'AppData', 'Roaming')
  return path.join(appData, DIR_CONFIG)
}

function caminhoArquivoConfig(): string {
  return path.join(obterDiretorioConfig(), ARQUIVO_CONFIG)
}

/** Resultado da verificação de disponibilidade de criptografia. */
function safeStorageDisponivel(): import('electron').SafeStorage | null {
  const electron = carregarElectron()
  if (!electron?.safeStorage) return null
  try {
    if (electron.safeStorage.isEncryptionAvailable()) {
      return electron.safeStorage
    }
  } catch {
    // isEncryptionAvailable pode lançar fora de um app Electron pronto
  }
  return null
}

/**
 * Cifra um segredo para gravação em disco.
 * - Com safeStorage disponível: `dpapi:<base64 do buffer cifrado>`.
 * - Sem safeStorage (fallback de dev): `b64:<base64 do texto>` — explicitamente
 *   marcado, para nunca confundir com texto plano nem com DPAPI real.
 */
function cifrarSegredo(valor: string): string {
  if (valor === '') return ''
  const ss = safeStorageDisponivel()
  if (ss) {
    const buf = ss.encryptString(valor)
    return PREFIXO_DPAPI + buf.toString('base64')
  }
  // Fallback de desenvolvimento: NÃO é seguro, só evita texto plano silencioso.
  // Em produção (Windows/TS com Electron) o caminho DPAPI sempre é usado.
  console.warn(
    '[config] safeStorage/DPAPI indisponível — gravando segredo com fallback base64 (NÃO seguro, apenas desenvolvimento).',
  )
  return PREFIXO_FALLBACK_B64 + Buffer.from(valor, 'utf8').toString('base64')
}

/** Decifra um segredo lido do disco, tratando ambos os formatos. */
function decifrarSegredo(valorGravado: string): string {
  if (!valorGravado) return ''
  if (valorGravado.startsWith(PREFIXO_DPAPI)) {
    const ss = safeStorageDisponivel()
    const b64 = valorGravado.slice(PREFIXO_DPAPI.length)
    if (!ss) {
      // Segredo foi cifrado com DPAPI mas não há como decifrar aqui.
      console.warn(
        '[config] segredo cifrado com DPAPI, mas safeStorage indisponível neste processo — retornando vazio.',
      )
      return ''
    }
    return ss.decryptString(Buffer.from(b64, 'base64'))
  }
  if (valorGravado.startsWith(PREFIXO_FALLBACK_B64)) {
    const b64 = valorGravado.slice(PREFIXO_FALLBACK_B64.length)
    return Buffer.from(b64, 'base64').toString('utf8')
  }
  // Compatibilidade defensiva: valor sem prefixo é tratado como texto plano legado.
  return valorGravado
}

/** Garante que o diretório de config exista. */
function garantirDiretorio(): void {
  const dir = obterDiretorioConfig()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * Lê a configuração do disco. Campos ausentes caem no padrão.
 * Segredos são decifrados antes de retornar.
 */
export function lerConfig(): ConfigAgente {
  const arquivo = caminhoArquivoConfig()
  let bruto: Partial<Record<keyof ConfigAgente, unknown>> = {}
  try {
    if (fs.existsSync(arquivo)) {
      bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as Partial<
        Record<keyof ConfigAgente, unknown>
      >
    }
  } catch (erro) {
    console.warn('[config] falha ao ler/parsear config.json, usando padrão:', erro)
    bruto = {}
  }

  const config: ConfigAgente = { ...CONFIG_PADRAO }

  if (typeof bruto.urlApiVizor === 'string' && bruto.urlApiVizor) {
    config.urlApiVizor = bruto.urlApiVizor
  }
  if (typeof bruto.intervaloSyncMinutos === 'number' && Number.isFinite(bruto.intervaloSyncMinutos)) {
    config.intervaloSyncMinutos = bruto.intervaloSyncMinutos
  }
  if (typeof bruto.connectionStringSqlServer === 'string') {
    config.connectionStringSqlServer = decifrarSegredo(bruto.connectionStringSqlServer)
  }
  if (typeof bruto.apiKeyAgente === 'string') {
    config.apiKeyAgente = decifrarSegredo(bruto.apiKeyAgente)
  }

  return config
}

/**
 * Salva um subconjunto da config (merge com o que já existe no disco).
 * Segredos são cifrados em repouso antes de gravar.
 */
export function salvarConfig(parcial: Partial<ConfigAgente>): void {
  garantirDiretorio()
  const atual = lerConfig()
  const novo: ConfigAgente = { ...atual, ...parcial }

  // Monta o objeto a persistir, cifrando os campos secretos.
  const paraGravar: Record<keyof ConfigAgente, unknown> = {
    connectionStringSqlServer: '',
    urlApiVizor: novo.urlApiVizor,
    apiKeyAgente: '',
    intervaloSyncMinutos: novo.intervaloSyncMinutos,
  }
  for (const campo of CAMPOS_SECRETOS) {
    paraGravar[campo] = cifrarSegredo(novo[campo] as string)
  }

  const arquivo = caminhoArquivoConfig()
  fs.writeFileSync(arquivo, JSON.stringify(paraGravar, null, 2), { encoding: 'utf8' })
}
