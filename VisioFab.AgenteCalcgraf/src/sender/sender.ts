/**
 * Envio das OPs para a API do Vizor (Tarefa 11 / Requisitos 2.4, 8.1, 8.2, 8.3,
 * 6.3).
 *
 * Responsabilidade do `sender`:
 *  - Montar o payload versionado `{ schemaVersion: 1, ops: [...] }` a partir das
 *    OPs detectadas (novas + alteradas), cada uma com seu `hashOrigem` já
 *    calculado pelo change-detector.
 *  - Fazer `POST https://.../api/pcp/ingest-op-calcgraf` com o header
 *    `x-agente-key: <apiKeyAgente>` (credencial de máquina — Req 6.1).
 *  - Retry com BACKOFF exponencial em falhas transitórias (rede / 5xx) —
 *    Req 8.2/8.3. 401 (key inválida/revogada) e 400 (payload) NÃO são
 *    re-tentados: são erros definitivos que o próximo ciclo repetiria à toa.
 *  - Quebrar o envio em LOTES de no máximo 500 OPs (limite do backend).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  DIVISÃO DE RESPONSABILIDADE — "marca enviado só no 2xx"                  ║
 * ║                                                                          ║
 * ║  O sender NÃO toca o `state-store`. Ele apenas ENVIA e DEVOLVE o          ║
 * ║  resultado por OP vindo da API (`resultados: [{ numero, resultado }]`).   ║
 * ║  Quem registra o hash no estado local é o SCHEDULER (Tarefa 11), e SÓ     ║
 * ║  para as OPs que a API confirmou com sucesso HTTP 2xx cujo `resultado`    ║
 * ║  por OP é 'criada' | 'atualizada' | 'ignorada' | 'pendente' (todos são    ║
 * ║  "processados com sucesso" do ponto de vista de sincronização). OPs com   ║
 * ║  `resultado: 'erro'` (ou qualquer resposta não-2xx) NÃO são registradas,  ║
 * ║  de modo que o próximo ciclo as reenvia (Req 8.2 — nunca marcar enviado   ║
 * ║  sem sucesso). Essa separação mantém o sender puro quanto a I/O de estado ║
 * ║  e concentra a regra de persistência no scheduler.                       ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Rede: usa o `https` nativo do Node (sem dependência externa). HTTPS
 * obrigatório (Req 9.3). Timeout por requisição.
 */

import * as https from 'node:https'
import { URL } from 'node:url'

import type { OpOrigemDTO } from '../calcgraf-reader/calcgraf-reader'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Versão de schema do payload (deve bater com o backend). */
export const SCHEMA_VERSION = 1

/** Caminho da rota de ingestão no backend (prefixo `/api/pcp`). */
const CAMINHO_INGESTAO = '/api/pcp/ingest-op-calcgraf'

/** Limite de OPs por requisição imposto pelo backend. */
export const MAX_OPS_POR_LOTE = 500

/** Timeout padrão por requisição HTTP (ms). */
const TIMEOUT_PADRAO_MS = 30_000

/** Número padrão de tentativas (1 inicial + retries). */
const TENTATIVAS_PADRAO = 3

/** Base do backoff exponencial (ms): 1s, 2s, 4s... */
const BACKOFF_BASE_MS = 1_000

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

/** Uma OP pronta para envio: o DTO + o hash de conteúdo já calculado. */
export interface OpComHash {
  /** DTO da OP de origem (shape espelhado do backend). */
  op: OpOrigemDTO
  /** Hash determinístico calculado pelo change-detector (vai como `hashOrigem`). */
  hash: string
}

/** Resultado por OP devolvido pela API (espelho do backend). */
export type ResultadoOp = 'criada' | 'atualizada' | 'pendente' | 'ignorada' | 'erro'

/** Item da lista `resultados` da resposta da API. */
export interface ResultadoIngestaoOp {
  /** Número da OP no Calcgraf. */
  numero: number
  /** Classificação do que aconteceu com a OP no Vizor. */
  resultado: ResultadoOp
  /** Mensagem opcional (motivo de erro/pendência). */
  mensagem?: string
}

/** Resposta agregada da ingestão (um ou mais lotes somados). */
export interface RespostaIngestao {
  /** Resultado por OP, na ordem de envio (todos os lotes concatenados). */
  resultados: ResultadoIngestaoOp[]
}

/** Config mínima que o sender precisa (subconjunto de `ConfigAgente`). */
export interface ConfigSender {
  /** URL base da API do Vizor (ex.: https://api.vizorerp.com.br). */
  urlApiVizor: string
  /** Token/chave do agente (header `x-agente-key`). */
  apiKeyAgente: string
}

/** Opções de resiliência do envio (todas com default sensato). */
export interface OpcoesEnvio {
  /** Número total de tentativas por lote (1 + retries). Default 3. */
  tentativas?: number
  /** Base do backoff exponencial em ms. Default 1000 (1s/2s/4s). */
  backoffBaseMs?: number
  /** Timeout por requisição em ms. Default 30000. */
  timeoutMs?: number
  /** Tamanho máximo de cada lote. Default/limite 500. */
  tamanhoLote?: number
  /**
   * Função de espera (injetável para testes — evita esperar de verdade). Recebe
   * os ms e resolve após o atraso. Default: setTimeout.
   */
  aguardar?: (ms: number) => Promise<void>
  /**
   * Executor HTTP de baixo nível (injetável para testes — evita rede real).
   * Default: `postHttps` (usa o módulo `https` nativo).
   */
  executarHttp?: ExecutorHttp
}

/** Resposta HTTP crua (status + corpo em texto). */
export interface RespostaHttp {
  /** Código de status HTTP. */
  status: number
  /** Corpo da resposta como texto. */
  corpo: string
}

/** Assinatura do executor HTTP (injetável). */
export type ExecutorHttp = (
  url: string,
  apiKey: string,
  corpoJson: string,
  timeoutMs: number,
) => Promise<RespostaHttp>

// ---------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------

/** Erro de envio do sender. `semRetentar` marca erros definitivos (401/400). */
export class SenderError extends Error {
  /** Status HTTP associado (quando houver). */
  readonly status?: number
  /** Quando `true`, o erro é definitivo e NÃO deve ser re-tentado. */
  readonly semRetentar: boolean

  constructor(message: string, opts: { status?: number; semRetentar?: boolean } = {}) {
    super(message)
    this.name = 'SenderError'
    this.status = opts.status
    this.semRetentar = opts.semRetentar ?? false
  }
}

/** Erro específico de autenticação (401) — key ausente/inválida/revogada. */
export class AuthAgenteError extends SenderError {
  constructor(message: string) {
    super(message, { status: 401, semRetentar: true })
    this.name = 'AuthAgenteError'
  }
}

// ---------------------------------------------------------------------------
// Montagem do payload
// ---------------------------------------------------------------------------

/**
 * Monta o payload versionado a partir das OPs com hash. Cada OP vira um objeto
 * com os campos do DTO + `hashOrigem` = hash calculado (idempotência).
 */
export function montarPayload(ops: OpComHash[]): {
  schemaVersion: number
  ops: Array<OpOrigemDTO & { hashOrigem: string }>
} {
  return {
    schemaVersion: SCHEMA_VERSION,
    ops: ops.map(({ op, hash }) => ({ ...op, hashOrigem: hash })),
  }
}

/** Quebra uma lista em pedaços de no máximo `tamanho` elementos. */
export function dividirEmLotes<T>(itens: T[], tamanho: number): T[][] {
  const limite = Math.max(1, Math.min(tamanho, MAX_OPS_POR_LOTE))
  const lotes: T[][] = []
  for (let i = 0; i < itens.length; i += limite) {
    lotes.push(itens.slice(i, i + limite))
  }
  return lotes
}

// ---------------------------------------------------------------------------
// Executor HTTP padrão (https nativo)
// ---------------------------------------------------------------------------

/**
 * POST HTTPS usando o módulo `https` nativo do Node. Resolve com
 * `{ status, corpo }` para QUALQUER status HTTP (inclusive 4xx/5xx) — a decisão
 * de retentar/erro fica na camada acima. Rejeita apenas em falha de
 * rede/timeout (que SÃO retentáveis).
 */
export function postHttps(
  url: string,
  apiKey: string,
  corpoJson: string,
  timeoutMs: number,
): Promise<RespostaHttp> {
  return new Promise<RespostaHttp>((resolve, reject) => {
    let alvo: URL
    try {
      alvo = new URL(url)
    } catch {
      reject(new SenderError(`URL inválida: ${url}`, { semRetentar: true }))
      return
    }
    if (alvo.protocol !== 'https:') {
      reject(
        new SenderError(
          `A URL da API deve usar HTTPS (recebido: ${alvo.protocol}).`,
          { semRetentar: true },
        ),
      )
      return
    }

    const corpo = Buffer.from(corpoJson, 'utf8')
    const req = https.request(
      {
        protocol: alvo.protocol,
        hostname: alvo.hostname,
        port: alvo.port || 443,
        path: alvo.pathname + alvo.search,
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-length': corpo.length,
          'x-agente-key': apiKey,
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            corpo: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )

    req.setTimeout(timeoutMs, () => {
      // Timeout é transitório → destrói o socket; o `error` abaixo rejeita.
      req.destroy(new Error(`Timeout de ${timeoutMs}ms excedido ao enviar ao Vizor.`))
    })
    req.on('error', (err) => {
      // Falha de rede/timeout: retentável (semRetentar fica false por padrão).
      reject(new SenderError(`Falha de rede ao enviar ao Vizor: ${err.message}`))
    })

    req.write(corpo)
    req.end()
  })
}

// ---------------------------------------------------------------------------
// Envio de UM lote com retry/backoff
// ---------------------------------------------------------------------------

/** Espera padrão baseada em setTimeout. */
function aguardarPadrao(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Interpreta a resposta HTTP e devolve os resultados por OP, OU lança um
 * `SenderError` classificando se é retentável:
 *  - 2xx           → parseia `{ resultados }` e retorna.
 *  - 401           → AuthAgenteError (definitivo, NÃO retenta — Req 6.3).
 *  - 400           → SenderError definitivo (payload malformado — Req 8.4).
 *  - 5xx           → SenderError retentável (erro transitório do servidor).
 *  - outros 4xx    → SenderError definitivo (não adianta repetir).
 */
function interpretarResposta(resp: RespostaHttp): ResultadoIngestaoOp[] {
  const { status, corpo } = resp

  if (status >= 200 && status < 300) {
    let json: unknown
    try {
      json = JSON.parse(corpo || '{}')
    } catch {
      throw new SenderError(
        `Resposta 2xx do Vizor não é JSON válido: ${corpo.slice(0, 200)}`,
        { status, semRetentar: true },
      )
    }
    const resultados = (json as { resultados?: unknown }).resultados
    if (!Array.isArray(resultados)) {
      throw new SenderError(
        'Resposta 2xx do Vizor sem a lista `resultados`.',
        { status, semRetentar: true },
      )
    }
    return resultados as ResultadoIngestaoOp[]
  }

  if (status === 401) {
    throw new AuthAgenteError(
      'Autenticação do agente rejeitada (401): a chave (x-agente-key) está ausente, ' +
        'inválida ou revogada. Reconfigure o agente — o envio não será retentado.',
    )
  }

  if (status === 400) {
    throw new SenderError(
      `Payload rejeitado pelo Vizor (400): ${corpo.slice(0, 500)}`,
      { status, semRetentar: true },
    )
  }

  if (status >= 500) {
    // Erro transitório do servidor → retentável.
    throw new SenderError(`Erro do servidor Vizor (${status}): ${corpo.slice(0, 200)}`, {
      status,
    })
  }

  // Demais 4xx (403/404/413/429...): definitivo por padrão (repetir não resolve).
  // 429 poderia ser retentável, mas sem Retry-After confiável tratamos como
  // definitivo neste MVP para não mascarar problema de configuração.
  throw new SenderError(`Resposta inesperada do Vizor (${status}): ${corpo.slice(0, 200)}`, {
    status,
    semRetentar: true,
  })
}

/**
 * Envia UM lote (≤ 500 OPs) com retry + backoff exponencial. Retorna os
 * resultados por OP do lote. Lança `SenderError`/`AuthAgenteError` quando
 * esgota as tentativas ou encontra um erro definitivo (401/400/outros 4xx).
 */
export async function enviarLote(
  cfg: ConfigSender,
  lote: OpComHash[],
  opcoes: OpcoesEnvio = {},
): Promise<ResultadoIngestaoOp[]> {
  const tentativasMax = Math.max(1, opcoes.tentativas ?? TENTATIVAS_PADRAO)
  const backoffBase = opcoes.backoffBaseMs ?? BACKOFF_BASE_MS
  const timeout = opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS
  const aguardar = opcoes.aguardar ?? aguardarPadrao
  const executarHttp = opcoes.executarHttp ?? postHttps

  const url = montarUrlIngestao(cfg.urlApiVizor)
  const corpoJson = JSON.stringify(montarPayload(lote))

  let ultimoErro: SenderError | undefined
  for (let tentativa = 1; tentativa <= tentativasMax; tentativa++) {
    try {
      const resp = await executarHttp(url, cfg.apiKeyAgente, corpoJson, timeout)
      return interpretarResposta(resp)
    } catch (err) {
      const senderErr =
        err instanceof SenderError
          ? err
          : new SenderError(err instanceof Error ? err.message : 'Erro desconhecido no envio.')
      ultimoErro = senderErr

      // Erro definitivo (401/400/4xx): não adianta retentar.
      if (senderErr.semRetentar) throw senderErr

      // Transitório: se ainda há tentativas, aguarda o backoff e repete.
      if (tentativa < tentativasMax) {
        const atraso = backoffBase * Math.pow(2, tentativa - 1) // 1s, 2s, 4s...
        await aguardar(atraso)
        continue
      }
    }
  }

  // Esgotou as tentativas em erro transitório.
  throw (
    ultimoErro ??
    new SenderError('Falha ao enviar o lote ao Vizor após as tentativas configuradas.')
  )
}

// ---------------------------------------------------------------------------
// Envio de TODAS as OPs (quebra em lotes e concatena os resultados)
// ---------------------------------------------------------------------------

/**
 * Envia todas as OPs (novas + alteradas) ao Vizor, quebrando em lotes de até
 * 500 e concatenando os resultados por OP. Cada lote tem seu próprio retry.
 *
 * IMPORTANTE: esta função NÃO toca o `state-store`. Ela só retorna o resultado
 * por OP devolvido pela API — a decisão de registrar no estado (só no 2xx, só
 * para resultado != 'erro') é do scheduler. Veja o cabeçalho deste arquivo.
 *
 * Se um lote falhar de forma definitiva/esgotada, o erro é propagado (o
 * scheduler captura e mantém pendentes as OPs ainda não confirmadas, para o
 * próximo ciclo).
 */
export async function enviarOps(
  cfg: ConfigSender,
  ops: OpComHash[],
  opcoes: OpcoesEnvio = {},
): Promise<RespostaIngestao> {
  if (ops.length === 0) {
    return { resultados: [] }
  }

  const tamanhoLote = opcoes.tamanhoLote ?? MAX_OPS_POR_LOTE
  const lotes = dividirEmLotes(ops, tamanhoLote)

  const resultados: ResultadoIngestaoOp[] = []
  for (const lote of lotes) {
    const parciais = await enviarLote(cfg, lote, opcoes)
    resultados.push(...parciais)
  }

  return { resultados }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Junta a URL base com o caminho da rota, evitando `//` duplicado. */
export function montarUrlIngestao(urlBase: string): string {
  const base = urlBase.replace(/\/+$/, '')
  return `${base}${CAMINHO_INGESTAO}`
}

/**
 * Conjunto de resultados por OP que contam como "processado com sucesso" para
 * fins de sincronização (o scheduler registra o hash no estado para estes).
 * Apenas 'erro' fica de fora — essa OP será reenviada no próximo ciclo.
 */
export const RESULTADOS_CONFIRMADOS: ReadonlySet<ResultadoOp> = new Set<ResultadoOp>([
  'criada',
  'atualizada',
  'pendente',
  'ignorada',
])

/** `true` se o resultado por OP conta como sincronizado com sucesso. */
export function foiConfirmada(resultado: ResultadoOp): boolean {
  return RESULTADOS_CONFIRMADOS.has(resultado)
}
