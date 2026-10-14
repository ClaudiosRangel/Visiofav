/**
 * Scheduler — orquestração do ciclo de sincronização (Tarefa 11 / Requisitos
 * 7.1, 7.2, 8.1, 8.2).
 *
 * Orquestra UM ciclo de sincronização juntando os módulos já prontos:
 *   1. abre a conexão do `calcgraf-reader`, lê as OPs candidatas, fecha;
 *   2. `detectarMudancas` contra o `EstadoLocal` (NOVA/ALTERADA/INALTERADA);
 *   3. envia novas+alteradas via `sender` (em lotes, com retry/backoff);
 *   4. para cada OP CONFIRMADA pela API (resultado != 'erro'), chama
 *      `estado.registrarEnvio(numero, hash)` — "marca enviado só no 2xx";
 *   5. devolve um RESUMO do ciclo (contadores + mensagens de erro).
 *
 * Dois modos de execução (Req 7):
 *  - `sincronizarAgora(deps)`: gatilho MANUAL (sob demanda), usado pela UI
 *    (Tarefa 12). Roda um ciclo e devolve o resumo.
 *  - `iniciarSegundoPlano(deps, intervaloMinutos)`: loop em SEGUNDO PLANO. A
 *    cada tick dispara `sincronizarAgora`, captura erros do ciclo sem derrubar o
 *    loop (Req 8.2 — falha de rede mantém as OPs pendentes, porque o estado só
 *    registra no sucesso; o próximo ciclo reenvia) e evita ciclos SOBREPOSTOS
 *    (se um ciclo ainda roda, o tick é pulado).
 *
 * Injeção de dependências (`SyncDeps`): config, estado e as FUNÇÕES de leitura/
 * envio são injetáveis. Isso mantém o scheduler testável e desacoplado do
 * Electron e da rede reais — o `main.ts` (processo principal) monta as deps com
 * as implementações concretas; os testes passam fakes.
 */

import type { ConfigConexaoCalcgraf, OpOrigemDTO } from '../calcgraf-reader/calcgraf-reader'
import { lerOpsEComFechar } from '../calcgraf-reader/calcgraf-reader'
import type { FiltroOps } from '../calcgraf-reader/calcgraf-reader'
import { detectarMudancas } from '../change-detector/change-detector'
import type { OpClassificada } from '../change-detector/change-detector'
import { EstadoLocal } from '../state-store/state-store'
import {
  enviarOps,
  foiConfirmada,
  AuthAgenteError,
} from '../sender/sender'
import type { ConfigSender, OpComHash, OpcoesEnvio, RespostaIngestao } from '../sender/sender'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Resumo de um ciclo de sincronização (devolvido à UI / log). */
export interface ResumoSync {
  /** Quantidade de OPs classificadas como novas. */
  novas: number
  /** Quantidade de OPs classificadas como alteradas. */
  alteradas: number
  /** Quantidade de OPs inalteradas (não enviadas). */
  inalteradas: number
  /** Quantas OPs foram confirmadas pela API e registradas no estado. */
  enviadas: number
  /** Quantas OPs voltaram como 'pendente' (alteração que exige revisão no Vizor). */
  pendentes: number
  /** Quantas OPs voltaram com erro (não registradas; reenviadas no próximo ciclo). */
  erros: number
  /** Mensagens de erro do ciclo (erros por OP + falha geral do ciclo, se houver). */
  mensagensErro: string[]
  /** Instante de início do ciclo (ISO). */
  iniciadoEm: string
  /** Instante de término do ciclo (ISO). */
  terminadoEm: string
}

/**
 * Leitor de OPs injetável. Default: abre a conexão, lê e fecha
 * (`lerOpsEComFechar` do calcgraf-reader). Injetável para testes.
 */
export type LeitorOps = (
  conexao: ConfigConexaoCalcgraf,
  filtro: FiltroOps,
) => Promise<OpOrigemDTO[]>

/**
 * Enviador de OPs injetável. Default: `enviarOps` do sender. Injetável para
 * testes (evita rede real).
 */
export type EnviadorOps = (
  cfg: ConfigSender,
  ops: OpComHash[],
  opcoes?: OpcoesEnvio,
) => Promise<RespostaIngestao>

/** Dependências de um ciclo de sincronização (injetáveis). */
export interface SyncDeps {
  /** Config do sender (URL + API key). */
  configSender: ConfigSender
  /** Config de conexão ao Calcgraf (modo/connection string/servidor...). */
  conexaoCalcgraf: ConfigConexaoCalcgraf
  /** Estado local (hash por OP). O ciclo registra os envios confirmados aqui. */
  estado: EstadoLocal
  /** Filtro opcional de OPs candidatas (faixa de número/data). */
  filtroOps?: FiltroOps
  /** Opções de resiliência do envio (tentativas/backoff/timeout/lote). */
  opcoesEnvio?: OpcoesEnvio
  /** Leitor de OPs (default: lerOpsEComFechar). Injetável para testes. */
  lerOps?: LeitorOps
  /** Enviador de OPs (default: enviarOps). Injetável para testes. */
  enviar?: EnviadorOps
  /** Logger (default: console). Injetável para testes/UI. */
  log?: LoggerCiclo
}

/** Logger simples do ciclo (console por ora; arquivo = TODO — Req 8.3). */
export interface LoggerCiclo {
  info(msg: string): void
  erro(msg: string): void
}

/** Handle do loop de segundo plano. */
export interface HandleSegundoPlano {
  /** Para o loop (cancela o próximo tick; não interrompe um ciclo em curso). */
  parar(): void
}

const loggerPadrao: LoggerCiclo = {
  info: (msg) => console.log(`[scheduler] ${msg}`),
  erro: (msg) => console.error(`[scheduler] ${msg}`),
}

// ---------------------------------------------------------------------------
// Ciclo único — sincronizar agora (gatilho manual)
// ---------------------------------------------------------------------------

/**
 * Executa UM ciclo completo de sincronização e devolve o resumo.
 *
 * Fluxo (ver cabeçalho). Pontos-chave de resiliência:
 *  - O estado só é tocado DEPOIS do envio, e SÓ para OPs confirmadas pela API
 *    (resultado != 'erro'). Falha de rede/API ⇒ nenhuma OP registrada ⇒
 *    reenviadas no próximo ciclo (Req 8.2).
 *  - O hash registrado é o MESMO calculado pelo change-detector (vem anotado em
 *    `OpClassificada.hash`), sem recálculo — garante casar com o que foi enviado.
 */
export async function sincronizarAgora(deps: SyncDeps): Promise<ResumoSync> {
  const log = deps.log ?? loggerPadrao
  const lerOps = deps.lerOps ?? lerOpsEComFechar
  const enviar = deps.enviar ?? enviarOps
  const iniciadoEm = new Date().toISOString()

  const resumo: ResumoSync = {
    novas: 0,
    alteradas: 0,
    inalteradas: 0,
    enviadas: 0,
    pendentes: 0,
    erros: 0,
    mensagensErro: [],
    iniciadoEm,
    terminadoEm: iniciadoEm,
  }

  try {
    // 1) Ler OPs candidatas da origem (abre conexão só-leitura, lê, fecha).
    const ops = await lerOps(deps.conexaoCalcgraf, deps.filtroOps ?? {})
    log.info(`lidas ${ops.length} OP(s) candidata(s) do Calcgraf.`)

    // 2) Detectar mudanças contra o estado local.
    const deteccao = detectarMudancas(ops, deps.estado)
    resumo.novas = deteccao.novas.length
    resumo.alteradas = deteccao.alteradas.length
    resumo.inalteradas = deteccao.inalteradas.length
    log.info(
      `detecção: ${resumo.novas} nova(s), ${resumo.alteradas} alterada(s), ` +
        `${resumo.inalteradas} inalterada(s).`,
    )

    // Monta a lista a enviar (novas + alteradas) preservando o hash já calculado.
    const paraEnviar: Array<OpComHash & { numero: number }> = deteccao.classificadas
      .filter((c: OpClassificada) => c.classificacao !== 'INALTERADA')
      .map((c) => ({ op: c.op, hash: c.hash, numero: c.op.numero }))

    if (paraEnviar.length === 0) {
      log.info('nada a enviar neste ciclo.')
      resumo.terminadoEm = new Date().toISOString()
      return resumo
    }

    // 3) Enviar (em lotes, com retry/backoff). O sender NÃO toca o estado.
    const resposta = await enviar(
      deps.configSender,
      paraEnviar.map(({ op, hash }) => ({ op, hash })),
      deps.opcoesEnvio,
    )

    // Index hash por número para registrar o MESMO hash enviado (sem recálculo).
    const hashPorNumero = new Map<number, string>()
    for (const p of paraEnviar) hashPorNumero.set(p.numero, p.hash)

    // 4) Registrar no estado SÓ as OPs confirmadas (resultado != 'erro').
    for (const r of resposta.resultados) {
      if (r.resultado === 'pendente') resumo.pendentes++
      if (foiConfirmada(r.resultado)) {
        const hash = hashPorNumero.get(r.numero)
        if (hash !== undefined) {
          deps.estado.registrarEnvio(r.numero, hash)
          resumo.enviadas++
        }
      } else {
        // resultado === 'erro' (por OP): não registra; será reenviada.
        resumo.erros++
        resumo.mensagensErro.push(
          `OP ${r.numero}: ${r.mensagem ?? 'erro ao processar no Vizor.'}`,
        )
      }
    }

    log.info(
      `envio concluído: ${resumo.enviadas} confirmada(s), ${resumo.pendentes} pendente(s), ` +
        `${resumo.erros} com erro.`,
    )
  } catch (err) {
    // Falha GERAL do ciclo (sem conexão SQL, sem internet, API fora, 401, lote
    // esgotado...). NÃO registra nada no estado ⇒ tudo reenviado no próximo
    // ciclo (Req 8.2). O erro é refletido no resumo, não propagado (o loop de
    // segundo plano não deve cair — Req 8.2).
    const msg = err instanceof Error ? err.message : 'erro desconhecido no ciclo de sincronização.'
    resumo.erros++
    resumo.mensagensErro.push(msg)
    if (err instanceof AuthAgenteError) {
      // 401: destaca para a UI alertar e o usuário reconfigurar (Req 6.3).
      log.erro(`autenticação rejeitada — ${msg}`)
    } else {
      log.erro(`ciclo falhou — ${msg}`)
    }
  }

  resumo.terminadoEm = new Date().toISOString()
  return resumo
}

// ---------------------------------------------------------------------------
// Loop de segundo plano
// ---------------------------------------------------------------------------

/**
 * Inicia o loop de sincronização em segundo plano no intervalo configurável.
 *
 * - Usa `setTimeout` recursivo (reagenda ao fim de cada ciclo) em vez de
 *   `setInterval`, para NÃO sobrepor ciclos: o próximo tick só é agendado depois
 *   que o ciclo atual termina. Um flag `rodando` protege contra reentrância caso
 *   o relógio dispare durante um ciclo mais longo que o intervalo.
 * - Erros do ciclo NÃO derrubam o loop (`sincronizarAgora` já captura e devolve
 *   no resumo; aqui ainda há um try/catch defensivo).
 * - `parar()` cancela o próximo tick (um ciclo em curso termina normalmente).
 *
 * @param intervaloMinutos intervalo entre ciclos (minutos). Mínimo efetivo 1 min.
 * @param aoResumo callback opcional chamado com o resumo de cada ciclo (a UI usa
 *   para atualizar o painel — Tarefa 12).
 */
export function iniciarSegundoPlano(
  deps: SyncDeps,
  intervaloMinutos: number,
  aoResumo?: (resumo: ResumoSync) => void,
): HandleSegundoPlano {
  const log = deps.log ?? loggerPadrao
  const intervaloMs = Math.max(1, intervaloMinutos) * 60_000

  let parado = false
  let rodando = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const agendarProximo = (): void => {
    if (parado) return
    timer = setTimeout(() => {
      void executarTick()
    }, intervaloMs)
  }

  const executarTick = async (): Promise<void> => {
    if (parado) return
    // Evita ciclos sobrepostos: se um ciclo ainda roda, pula este tick.
    if (rodando) {
      log.info('tick ignorado — ciclo anterior ainda em execução.')
      agendarProximo()
      return
    }
    rodando = true
    try {
      const resumo = await sincronizarAgora(deps)
      if (aoResumo) {
        try {
          aoResumo(resumo)
        } catch (e) {
          log.erro(`callback de resumo lançou: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    } catch (e) {
      // sincronizarAgora não deve lançar, mas por garantia o loop não cai.
      log.erro(`erro inesperado no tick: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      rodando = false
      agendarProximo()
    }
  }

  log.info(`segundo plano iniciado (intervalo de ${Math.max(1, intervaloMinutos)} min).`)
  // Primeiro ciclo imediato (sem esperar o primeiro intervalo).
  void executarTick()

  return {
    parar(): void {
      parado = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      log.info('segundo plano parado.')
    },
  }
}
