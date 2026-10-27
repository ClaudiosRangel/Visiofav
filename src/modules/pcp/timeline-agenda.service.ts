/**
 * Motor de agendamento da timeline de produção — NÚCLEO PURO (sem Prisma/I/O).
 *
 * Spec pcp-gantt-travar-mover. Extraído da lógica inline de
 * `timeline-producao.routes.ts` para ser testável (vitest) e para introduzir,
 * de forma controlada, a regra da ÂNCORA DE AGENDA (APS pin):
 *
 *  - Etapa TRAVADA (`agendaTravada=true`, `inicioAgendadoManual` definido):
 *    é um PONTO FIXO — seu início é exatamente `inicioAgendadoManual`, e o fim
 *    deriva do início + duração respeitando o turno. NÃO depende da fila.
 *  - Etapa NÃO travada: calculada pela fila do centro (cascata), como hoje,
 *    MAS pulando as janelas já ocupadas por etapas travadas do mesmo centro.
 *
 * Invariante de NÃO-REGRESSÃO (Req 6.1): sem nenhuma etapa travada, a saída é
 * idêntica ao cálculo atual (fila + cascata + turno).
 *
 * Determinístico (Req 6.6): mesmas entradas ⇒ mesma saída.
 */

/** Turno de trabalho de um centro (igual ao usado hoje no motor). */
export interface TurnoAgenda {
  horaInicio: string // "07:00"
  horaFim: string // "17:00"
  diasSemana: number[] // 1=seg ... 7=dom
  duracaoMinutos: number
}

/**
 * Exceção de calendário de um centro numa data específica (spec
 * pcp-excecoes-calendario-gantt). Sobrepõe o turno-base NAQUELA data.
 *  - HORA_EXTRA / DIA_EXTRA: janela [horaInicio, horaFim] é a trabalhável do dia.
 *  - NAO_TRABALHO: o dia inteiro não é trabalhável (horaInicio/horaFim ignorados).
 */
export interface ExcecaoCalendario {
  data: string // "2026-10-24" (dia civil local)
  tipo: 'HORA_EXTRA' | 'DIA_EXTRA' | 'NAO_TRABALHO'
  horaInicio: string | null // "17:00"
  horaFim: string | null // "20:00"
}

/** Janela trabalhável resolvida de um dia: minutos do dia (0..1439) ou dia bloqueado. */
export interface JanelaDia {
  trabalha: boolean
  inicioMin: number
  fimMin: number
}

/** Chave "YYYY-MM-DD" (dia civil LOCAL) de um instante — base do match de exceção. */
function chaveDiaLocal(d: Date): string {
  const ano = d.getFullYear()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${ano}-${mes}-${dia}`
}

function hhmmParaMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/**
 * Janela trabalhável EFETIVA de um dia: a exceção da data (se houver) sobrepõe
 * o turno-base. Prioridade: exceção > turno-base. Sem turno e sem exceção
 * trabalhável ⇒ `null` (tratar como operação linear/24h no chamador).
 *
 * Regras:
 *  - NAO_TRABALHO ⇒ { trabalha:false }.
 *  - HORA_EXTRA/DIA_EXTRA com janela válida ⇒ usa [horaInicio, horaFim].
 *    (janela inválida/ausente é ignorada defensivamente → cai no turno-base.)
 *  - Sem exceção ⇒ turno-base: trabalha se o diaSemana está em diasSemana.
 */
export function janelaDoDia(
  data: Date,
  turnoBase: TurnoAgenda | null,
  excecoes: ExcecaoCalendario[],
): JanelaDia | null {
  const chave = chaveDiaLocal(data)
  const exc = excecoes.find((e) => e.data === chave)

  if (exc) {
    if (exc.tipo === 'NAO_TRABALHO') {
      return { trabalha: false, inicioMin: 0, fimMin: 0 }
    }
    // HORA_EXTRA | DIA_EXTRA: usa a janela da exceção se válida.
    if (exc.horaInicio && exc.horaFim) {
      const ini = hhmmParaMin(exc.horaInicio)
      const fim = hhmmParaMin(exc.horaFim)
      if (fim > ini) return { trabalha: true, inicioMin: ini, fimMin: fim }
    }
    // Janela inválida → ignora a exceção e cai no turno-base (defensivo).
  }

  if (!turnoBase) return null

  const diaConvertido = data.getDay() === 0 ? 7 : data.getDay()
  if (!turnoBase.diasSemana.includes(diaConvertido)) {
    return { trabalha: false, inicioMin: 0, fimMin: 0 }
  }
  return {
    trabalha: true,
    inicioMin: hhmmParaMin(turnoBase.horaInicio),
    fimMin: hhmmParaMin(turnoBase.horaFim),
  }
}

/** Entrada do motor por etapa (subconjunto puro do que a rota carrega). */
export interface EtapaAgenda {
  id: string
  ordemProducaoId: string
  centroProducaoId: string | null
  posicaoFila: number | null
  /** sequência dentro da OP (ordem da cascata). */
  sequencia: number
  tempoSetupMinutos: number
  tempoOperacaoMinutos: number
  tempoEsperaMinutos: number
  status: string // PENDENTE | EM_ANDAMENTO | CONCLUIDA | PAUSADA
  dataInicioReal: Date | null
  dataFimReal: Date | null
  turno: TurnoAgenda | null
  // Exceções de calendário do centro (spec pcp-excecoes-calendario-gantt).
  // Opcional: ausente/vazio ⇒ comportamento legado (só turno-base).
  excecoes?: ExcecaoCalendario[]
  // ── Âncora de agenda (spec pcp-gantt-travar-mover) ──
  agendaTravada: boolean
  inicioAgendadoManual: Date | null
}

/** Saída do motor por etapa: os instantes previstos calculados. */
export interface ResultadoAgenda {
  etapaId: string
  inicioPrevisto: Date
  fimPrevisto: Date
}

/**
 * Calcula o fim de uma operação a partir do início, "andando" no tempo dentro
 * do turno (pula períodos fora do expediente). CÓPIA FIEL da função usada hoje
 * em timeline-producao.routes.ts (mesma semântica → não-regressão).
 */
export function calcularFimComTurno(
  inicio: Date,
  duracaoMinutos: number,
  turno: TurnoAgenda,
  excecoes: ExcecaoCalendario[] = [],
): Date {
  if (duracaoMinutos <= 0) return new Date(inicio)

  let restante = duracaoMinutos
  let cursor = new Date(inicio)
  const maxIteracoes = 365 * 24
  let iteracoes = 0

  while (restante > 0 && iteracoes < maxIteracoes) {
    iteracoes++

    // Janela trabalhável EFETIVA do dia atual (exceção da data > turno-base).
    const janela = janelaDoDia(cursor, turno, excecoes)
    const [hBaseI, mBaseI] = turno.horaInicio.split(':').map(Number)

    if (!janela || !janela.trabalha) {
      // Dia não trabalhável (fim de semana sem exceção, ou NAO_TRABALHO):
      // pula para o começo do próximo dia (às horas-base, ajustado no próx. laço).
      cursor.setDate(cursor.getDate() + 1)
      cursor.setHours(hBaseI, mBaseI, 0, 0)
      continue
    }

    const minAtual = cursor.getHours() * 60 + cursor.getMinutes()

    if (minAtual < janela.inicioMin) {
      cursor.setHours(Math.floor(janela.inicioMin / 60), janela.inicioMin % 60, 0, 0)
      continue
    }
    if (minAtual >= janela.fimMin) {
      cursor.setDate(cursor.getDate() + 1)
      cursor.setHours(hBaseI, mBaseI, 0, 0)
      continue
    }

    const minutosAteFimJanela = janela.fimMin - minAtual
    if (restante <= minutosAteFimJanela) {
      cursor = new Date(cursor.getTime() + restante * 60000)
      restante = 0
    } else {
      restante -= minutosAteFimJanela
      cursor.setDate(cursor.getDate() + 1)
      cursor.setHours(hBaseI, mBaseI, 0, 0)
    }
  }
  return cursor
}

/** Soma `minutos` a um instante, respeitando o turno (ou linear se sem turno). */
function avancar(inicio: Date, minutos: number, turno: TurnoAgenda | null, excecoes: ExcecaoCalendario[] = []): Date {
  if (minutos <= 0) return new Date(inicio)
  return turno ? calcularFimComTurno(inicio, minutos, turno, excecoes) : new Date(inicio.getTime() + minutos * 60000)
}

/**
 * "Snap" de um instante para o PRÓXIMO horário de trabalho válido do turno
 * (padrão APS/DHTMLX/IBM: ao fixar/soltar fora do expediente, o início efetivo
 * rola para o próximo início de expediente). Se o instante já está dentro do
 * turno, retorna-o inalterado. Sem turno → retorna o próprio instante.
 *
 * Isso garante que a barra do Gantt comece no primeiro instante PRODUTIVO
 * (não desenha o vão ocioso entre a âncora fora do turno e o início real).
 */
export function ajustarParaTurno(instante: Date, turno: TurnoAgenda | null, excecoes: ExcecaoCalendario[] = []): Date {
  if (!turno) return new Date(instante)

  const [hBaseI, mBaseI] = turno.horaInicio.split(':').map(Number)

  let cursor = new Date(instante)
  const maxIteracoes = 365
  let iteracoes = 0

  while (iteracoes < maxIteracoes) {
    iteracoes++
    const janela = janelaDoDia(cursor, turno, excecoes)

    if (!janela || !janela.trabalha) {
      cursor.setDate(cursor.getDate() + 1)
      cursor.setHours(hBaseI, mBaseI, 0, 0)
      continue
    }
    const minAtual = cursor.getHours() * 60 + cursor.getMinutes()
    if (minAtual < janela.inicioMin) {
      cursor.setHours(Math.floor(janela.inicioMin / 60), janela.inicioMin % 60, 0, 0)
      return cursor
    }
    if (minAtual >= janela.fimMin) {
      cursor.setDate(cursor.getDate() + 1)
      cursor.setHours(hBaseI, mBaseI, 0, 0)
      continue
    }
    // Já está dentro da janela trabalhável.
    return cursor
  }
  return cursor
}

/** Duração total prevista de uma etapa (setup + operação). */
function duracao(e: EtapaAgenda): number {
  return (Number(e.tempoSetupMinutos) || 0) + (Number(e.tempoOperacaoMinutos) || 0)
}

/** Opções de cálculo da agenda (aditivas, não-regressivas). */
export interface OpcoesAgenda {
  /**
   * Regra de NÃO-SOBREPOSIÇÃO por máquina (capacidade finita = 1 operação por
   * vez por centro). Quando ligada, etapas NÃO travadas são empurradas para o
   * primeiro instante livre da raia (ver `resolverNoOverlap`).
   *
   * NÃO-REGRESSÃO (design — Property 1): como o empurrão é
   * `inicioFinal = max(inicioAtual, cursorLivre)` e, SEM colisão,
   * `cursorLivre <= inicioAtual`, a saída é IDÊNTICA à de hoje quando não há
   * sobreposição nas entradas. Por isso o default pode ser `true` com segurança.
   */
  noOverlap?: boolean
}

/** Entrada mínima do no-overlap: início já calculado por etapa de UM centro. */
export interface EtapaComInicio {
  etapa: EtapaAgenda
  inicio: Date
}

/**
 * REGRA DE NÃO-SOBREPOSIÇÃO POR MÁQUINA (capacidade finita = 1 operação por vez
 * por centro) — spec pcp-gantt-melhorias, Requirement 4 (subseção 4b).
 *
 * Dado o conjunto de etapas de UM centro com seus inícios já calculados (já
 * ajustados a turno/exceções por `calcularInicioPorFila`), empurra as etapas
 * NÃO travadas para o primeiro instante livre, garantindo que não haja
 * sobreposição temporal `[inicio, fim)` na mesma máquina.
 *
 * Determinismo (Req 4.6): percorre em ordem do início efetivo, com desempate
 * ESTÁVEL por `posicaoFila` → `sequencia` → `id`.
 *
 * Regra por etapa (na ordem acima):
 *  - TRAVADA (`agendaTravada` + `inicioAgendadoManual`): é PONTO FIXO, não se
 *    move; apenas avança o `cursorLivre` para `max(cursorLivre, fimDela)`. Se
 *    duas travadas colidirem entre si, ambas são respeitadas como estão (trava
 *    é decisão humana — nunca movemos uma travada).
 *  - NÃO travada: `inicioFinal = max(inicioAtual, cursorLivre)`; recalcula o
 *    fim com `avancar`/`calcularFimComTurno` respeitando turno + exceções;
 *    `cursorLivre = fim`.
 *
 * NÃO-REGRESSÃO (Property 1): sem colisão, `cursorLivre <= inicioAtual` para
 * toda etapa não travada ⇒ `max(inicioAtual, cursorLivre) == inicioAtual` ⇒
 * saída idêntica à atual.
 *
 * Retorna um mapa `etapaId → inicioFinal` (só para as etapas recebidas).
 * As travadas voltam com o MESMO início recebido (ponto fixo).
 */
export function resolverNoOverlap(
  etapasDoCentro: EtapaComInicio[],
  turno: TurnoAgenda | null,
  excecoes: ExcecaoCalendario[] = [],
): Map<string, Date> {
  const resultado = new Map<string, Date>()

  // Ordena por início efetivo; desempate estável por posicaoFila → sequencia → id.
  const ordenadas = [...etapasDoCentro].sort((a, b) => {
    const di = a.inicio.getTime() - b.inicio.getTime()
    if (di !== 0) return di
    const pa = a.etapa.posicaoFila ?? 999
    const pb = b.etapa.posicaoFila ?? 999
    if (pa !== pb) return pa - pb
    if (a.etapa.sequencia !== b.etapa.sequencia) return a.etapa.sequencia - b.etapa.sequencia
    return a.etapa.id < b.etapa.id ? -1 : a.etapa.id > b.etapa.id ? 1 : 0
  })

  let cursorLivre = -Infinity // ms do fim da última etapa alocada no centro
  const maxIteracoes = ordenadas.length + 1 // guarda defensiva (laço linear, sem retrocesso)
  let iteracoes = 0

  for (const { etapa: e, inicio } of ordenadas) {
    if (iteracoes++ > maxIteracoes) break

    if (e.agendaTravada && e.inicioAgendadoManual) {
      // Ponto fixo: não se move. Apenas estende o cursor.
      const fim = avancar(inicio, duracao(e), turno, excecoes).getTime()
      cursorLivre = Math.max(cursorLivre, fim)
      resultado.set(e.id, inicio)
      continue
    }

    // Não travada: empurra para o primeiro instante livre.
    const iniMs = Math.max(inicio.getTime(), cursorLivre === -Infinity ? inicio.getTime() : cursorLivre)
    const iniFinal = new Date(iniMs)
    const fim = avancar(iniFinal, duracao(e), turno, excecoes)
    cursorLivre = fim.getTime()
    resultado.set(e.id, iniFinal)
  }

  return resultado
}

/**
 * Calcula o `inicioPrevisto` de cada etapa com base na FILA do centro
 * (`posicaoFila`), a partir de `agora`, respeitando o turno — e tratando as
 * etapas TRAVADAS como pontos fixos que ocupam a janela e empurram as não
 * travadas. Reproduz o `inicioPrevistoMap` do motor atual + a regra da âncora.
 *
 * Retorna um mapa `etapaId → inicioPrevisto`.
 */
export function calcularInicioPorFila(
  etapas: EtapaAgenda[],
  agora: Date,
  opts: OpcoesAgenda = {},
): Map<string, Date> {
  const inicioPorEtapa = new Map<string, Date>()

  // Agrupa por centro.
  const porCentro = new Map<string, EtapaAgenda[]>()
  for (const e of etapas) {
    if (!e.centroProducaoId) continue
    const arr = porCentro.get(e.centroProducaoId) ?? []
    arr.push(e)
    porCentro.set(e.centroProducaoId, arr)
  }

  for (const [, fila] of porCentro) {
    // Ordena pela posição na fila (igual ao motor atual).
    fila.sort((a, b) => (a.posicaoFila ?? 999) - (b.posicaoFila ?? 999))
    const turno = fila[0]?.turno ?? null
    // Exceções são por CENTRO — iguais para toda a fila; usa as da 1ª etapa.
    const excecoes = fila[0]?.excecoes ?? []

    // Janelas ocupadas por etapas TRAVADAS deste centro (pontos fixos).
    // A âncora é "snapada" para o próximo horário válido do turno (APS pin):
    // se o planejador travou fora do expediente, o início efetivo rola para o
    // próximo início de turno (a barra começa no 1º instante produtivo).
    const janelasTravadas: Array<{ ini: number; fim: number }> = []
    for (const e of fila) {
      if (e.agendaTravada && e.inicioAgendadoManual) {
        const ini = ajustarParaTurno(e.inicioAgendadoManual, turno, excecoes)
        const fim = avancar(ini, duracao(e), turno, excecoes)
        janelasTravadas.push({ ini: ini.getTime(), fim: fim.getTime() })
        inicioPorEtapa.set(e.id, ini)
      }
    }
    janelasTravadas.sort((a, b) => a.ini - b.ini)

    // Empurra um início para fora de qualquer janela travada que ele cruze.
    const empurrar = (iniMs: number, durMin: number): number => {
      let ini = iniMs
      let mudou = true
      // Repete até não colidir com nenhuma janela (as janelas estão ordenadas).
      while (mudou) {
        mudou = false
        const fim = avancar(new Date(ini), durMin, turno, excecoes).getTime()
        for (const j of janelasTravadas) {
          // Sobreposição [ini,fim) × [j.ini,j.fim): empurra para o fim da janela.
          if (ini < j.fim && fim > j.ini) {
            ini = j.fim
            mudou = true
            break
          }
        }
      }
      return ini
    }

    let cursor = new Date(agora)
    for (const e of fila) {
      if (e.agendaTravada && e.inicioAgendadoManual) {
        // Já posicionada (ponto fixo). O cursor avança para o fim dela se for
        // além do cursor atual, para as próximas não travadas virem depois.
        const iniAjustado = ajustarParaTurno(e.inicioAgendadoManual, turno, excecoes)
        const fim = avancar(iniAjustado, duracao(e), turno, excecoes)
        cursor = new Date(Math.max(cursor.getTime(), fim.getTime()))
        continue
      }

      if (e.status === 'CONCLUIDA' && e.dataFimReal) {
        cursor = new Date(Math.max(cursor.getTime(), e.dataFimReal.getTime()))
        inicioPorEtapa.set(e.id, e.dataInicioReal ?? cursor)
        continue
      }

      if (e.status === 'EM_ANDAMENTO' && e.dataInicioReal) {
        inicioPorEtapa.set(e.id, e.dataInicioReal)
        cursor = avancar(e.dataInicioReal, duracao(e), turno, excecoes)
        continue
      }

      // PENDENTE/PAUSADA: início = cursor, empurrado para fora de travadas.
      const iniMs = empurrar(cursor.getTime(), duracao(e))
      const ini = new Date(iniMs)
      inicioPorEtapa.set(e.id, ini)
      cursor = avancar(ini, duracao(e), turno, excecoes)
    }

    // ── Não-sobreposição por máquina (capacidade finita) — spec pcp-gantt-melhorias ──
    // Aplicada POR CENTRO, sobre os inícios já calculados acima. A integração
    // aqui (e não em `calcularAgenda`) torna a NÃO-REGRESSÃO trivial de provar:
    // sem colisão, `resolverNoOverlap` devolve exatamente os mesmos inícios
    // (`max(inicio, cursorLivre) == inicio`), logo a saída é idêntica à atual.
    if (opts.noOverlap) {
      const comInicio: EtapaComInicio[] = []
      for (const e of fila) {
        const ini = inicioPorEtapa.get(e.id)
        if (ini) comInicio.push({ etapa: e, inicio: ini })
      }
      const resolvido = resolverNoOverlap(comInicio, turno, excecoes)
      for (const [id, ini] of resolvido) inicioPorEtapa.set(id, ini)
    }
  }

  return inicioPorEtapa
}

/**
 * Calcula a timeline (início/fim previstos) de uma OP, encadeando a cascata
 * sequencial das etapas e cruzando com o `inicioPorFila` (que já respeita as
 * âncoras). Reproduz o laço por etapa do motor atual:
 *   inicioPrevisto = max(cursorCascataOP, inicioFromFila)
 * — exceto quando a etapa está TRAVADA, caso em que o início é a âncora exata.
 */
export function calcularTimelineOp(
  etapasDaOp: EtapaAgenda[],
  inicioPorFila: Map<string, Date>,
  agora: Date,
): ResultadoAgenda[] {
  const etapas = [...etapasDaOp].sort((a, b) => a.sequencia - b.sequencia)
  const resultado: ResultadoAgenda[] = []

  // Base da cascata: se a 1ª etapa já iniciou, usa o início real.
  let cursor = etapas[0]?.dataInicioReal ? new Date(etapas[0].dataInicioReal) : new Date(agora)

  for (const e of etapas) {
    const turno = e.turno
    const excecoes = e.excecoes ?? []
    const dur = duracao(e)
    const espera = Number(e.tempoEsperaMinutos) || 0

    let inicio: Date
    if (e.agendaTravada && e.inicioAgendadoManual) {
      // Ponto fixo: início na âncora, "snapado" ao próximo horário válido do
      // turno (não desenha vão ocioso fora do expediente). Não cruza a cascata.
      inicio = ajustarParaTurno(e.inicioAgendadoManual, turno, excecoes)
    } else {
      const fromFila = inicioPorFila.get(e.id)
      inicio = fromFila ? new Date(Math.max(cursor.getTime(), fromFila.getTime())) : new Date(cursor)
    }

    const fim = avancar(inicio, dur, turno, excecoes)
    resultado.push({ etapaId: e.id, inicioPrevisto: inicio, fimPrevisto: fim })

    // Próxima etapa da OP começa após o fim + espera.
    cursor = avancar(fim, espera, turno, excecoes)
  }

  return resultado
}

/**
 * Função de alto nível (ainda pura): calcula a timeline de TODAS as etapas,
 * agrupando por OP. Retorna um mapa `etapaId → { inicioPrevisto, fimPrevisto }`.
 * É o ponto único que a rota chama.
 */
export function calcularAgenda(
  etapas: EtapaAgenda[],
  agora: Date,
  opts: OpcoesAgenda = { noOverlap: true },
): Map<string, ResultadoAgenda> {
  // Default do app: no-overlap LIGADO. Não-regressivo por construção (Property 1):
  // sem colisão nas entradas, `resolverNoOverlap` não altera nenhum início.
  const inicioPorFila = calcularInicioPorFila(etapas, agora, opts)

  // Agrupa por OP preservando a ordem de entrada.
  const porOp = new Map<string, EtapaAgenda[]>()
  for (const e of etapas) {
    const arr = porOp.get(e.ordemProducaoId) ?? []
    arr.push(e)
    porOp.set(e.ordemProducaoId, arr)
  }

  const saida = new Map<string, ResultadoAgenda>()
  for (const [, etapasOp] of porOp) {
    for (const r of calcularTimelineOp(etapasOp, inicioPorFila, agora)) {
      saida.set(r.etapaId, r)
    }
  }
  return saida
}
