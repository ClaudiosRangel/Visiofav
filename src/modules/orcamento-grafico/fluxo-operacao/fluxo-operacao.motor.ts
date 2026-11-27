/**
 * Motor PURO do "Fluxo por operação" do Comercial (sem Prisma/IO).
 *
 * Para cada operação (Novo Pedido, Repetição, Mostruário, Alteração) o Comercial
 * define a ORDEM das etapas, quais etapas são puladas e, em cada etapa, QUAIS
 * SETORES FICAM BLOQUEADOS (só leitura) enquanto ela não for concluída.
 *
 * Etapas: Comercial, Orçamento, Pré-impressão, OP/PCP e Faturamento.
 *  - A etapa inicial é Comercial OU Orçamento (nunca Pré-impressão).
 *  - Pré-impressão atende as duas: pode vir antes ou depois de qualquer uma, ou ser pulada.
 *  - OP/PCP e Faturamento são sempre as duas últimas, nessa ordem.
 *  - O desbloqueio é SÓ por configuração: não existe "liberar" pontual.
 *  - A SEQUÊNCIA define quem espera quem: setor cuja etapa vem depois da etapa em andamento aguarda
 *    a vez (só ações; todos continuam vendo o pedido). Os bloqueios marcados somam a isso (ex.: uma
 *    etapa posterior impedir que um setor anterior altere o que já entregou).
 */

export const OPERACOES = ['NOVO', 'REPETICAO', 'MOSTRUARIO', 'ALTERACAO'] as const
export type Operacao = (typeof OPERACOES)[number]

export const ETAPAS_FLUXO = ['COMERCIAL', 'ORCAMENTO', 'PRE_IMPRESSAO', 'OP_PCP', 'FATURAMENTO'] as const
export type EtapaFluxo = (typeof ETAPAS_FLUXO)[number]

/** Setores que podem ser bloqueados (são os que trabalham o pedido nas 3 primeiras etapas). */
export const SETORES_BLOQUEAVEIS = ['COMERCIAL', 'ORCAMENTO', 'PRE_IMPRESSAO'] as const
export type SetorBloqueavel = (typeof SETORES_BLOQUEAVEIS)[number]

/** Etapas de setor (reordenáveis entre si) e etapas finais (posição fixa). */
export const ETAPAS_DE_SETOR: EtapaFluxo[] = ['COMERCIAL', 'ORCAMENTO', 'PRE_IMPRESSAO']
export const ETAPAS_FINAIS: EtapaFluxo[] = ['OP_PCP', 'FATURAMENTO']
/** Etapas em que o pedido pode ENTRAR (a primeira ativa deve ser uma destas). */
export const ETAPAS_INICIAIS: EtapaFluxo[] = ['COMERCIAL', 'ORCAMENTO']

export const ROTULO_OPERACAO: Record<Operacao, string> = {
  NOVO: 'Novo Pedido',
  REPETICAO: 'Repetição',
  MOSTRUARIO: 'Mostruário',
  ALTERACAO: 'Alteração (arte ou faca)',
}

export const ROTULO_ETAPA: Record<EtapaFluxo, string> = {
  COMERCIAL: 'Comercial',
  ORCAMENTO: 'Orçamento',
  PRE_IMPRESSAO: 'Pré-Impressão',
  OP_PCP: 'OP / PCP',
  FATURAMENTO: 'Faturamento',
}

export interface EtapaConfig {
  etapa: EtapaFluxo
  /** false = a etapa é pulada nesta operação. */
  ativa: boolean
  /** Setores que NÃO podem agir no pedido enquanto esta etapa não for concluída. */
  bloqueia: SetorBloqueavel[]
  /** So OP_PCP: ao concluir a(s) OP(s), o pedido avanca sozinho para o Faturamento. Sem isso, e preciso encaminhar manualmente. */
  automatica?: boolean
}

export interface FluxoOperacao {
  operacao: Operacao
  etapas: EtapaConfig[]
}

export class FluxoOperacaoError extends Error {
  constructor(public statusCode: number, message: string, public code: string, public erros: string[] = []) {
    super(message)
    this.name = 'FluxoOperacaoError'
  }
}

export function ehOperacao(v: unknown): v is Operacao {
  return typeof v === 'string' && (OPERACOES as readonly string[]).includes(v)
}

/**
 * Fluxo inicial de cada operação. Neutro (todas as etapas, sem bloqueios): é só o
 * ponto de partida; o Comercial ajusta conforme a realidade de cada operação.
 */
export function fluxoPadrao(operacao: Operacao): FluxoOperacao {
  return {
    operacao,
    etapas: ETAPAS_FLUXO.map((etapa) => ({ etapa, ativa: true, bloqueia: [] as SetorBloqueavel[] })),
  }
}

// ============================================================================
// Validação / normalização
// ============================================================================

export type ResultadoValidacao =
  | { ok: true; etapas: EtapaConfig[] }
  | { ok: false; erros: string[] }

/** Valida a configuração de um fluxo e devolve a forma normalizada (ou a lista de erros em português). */
export function validarEtapas(entrada: unknown): ResultadoValidacao {
  const erros: string[] = []
  if (!Array.isArray(entrada)) return { ok: false, erros: ['Informe a lista de etapas do fluxo.'] }

  const vistas = new Set<string>()
  const lidas: Array<{ etapa: EtapaFluxo; ativa: boolean; bloqueia: unknown; automatica: boolean }> = []
  for (const item of entrada) {
    const e = item as { etapa?: unknown; ativa?: unknown; bloqueia?: unknown; automatica?: unknown }
    if (!e || typeof e.etapa !== 'string' || !(ETAPAS_FLUXO as readonly string[]).includes(e.etapa)) {
      erros.push('Há uma etapa desconhecida na configuração.')
      continue
    }
    if (vistas.has(e.etapa)) {
      erros.push(`A etapa ${ROTULO_ETAPA[e.etapa as EtapaFluxo]} aparece mais de uma vez.`)
      continue
    }
    vistas.add(e.etapa)
    lidas.push({ etapa: e.etapa as EtapaFluxo, ativa: e.ativa === true, bloqueia: e.bloqueia, automatica: e.automatica === true })
  }
  for (const etapa of ETAPAS_FLUXO) {
    if (!vistas.has(etapa)) erros.push(`Falta a etapa ${ROTULO_ETAPA[etapa]}.`)
  }
  if (erros.length > 0) return { ok: false, erros }

  // OP/PCP e Faturamento são sempre as duas últimas, nessa ordem.
  const ordem = lidas.map((l) => l.etapa)
  if (ordem[3] !== 'OP_PCP' || ordem[4] !== 'FATURAMENTO') {
    erros.push('OP / PCP e Faturamento devem ser as duas últimas etapas, nessa ordem.')
  }

  const porEtapa = new Map(lidas.map((l) => [l.etapa, l]))
  if (!porEtapa.get('COMERCIAL')!.ativa) {
    erros.push('A etapa Comercial não pode ser pulada: todo pedido passa pelo Comercial.')
  }
  const primeiraAtiva = lidas.find((l) => l.ativa)?.etapa
  if (primeiraAtiva && !ETAPAS_INICIAIS.includes(primeiraAtiva)) {
    erros.push('A etapa inicial deve ser Comercial ou Orçamento. A Pré-Impressão atende as duas, mas não abre o pedido.')
  }

  const etapas: EtapaConfig[] = lidas.map((l) => {
    let bloqueia: SetorBloqueavel[] = []
    if (l.ativa) {
      const brutos = Array.isArray(l.bloqueia) ? l.bloqueia : []
      for (const s of brutos) {
        if (typeof s !== 'string' || !(SETORES_BLOQUEAVEIS as readonly string[]).includes(s)) {
          erros.push(`Setor de bloqueio inválido na etapa ${ROTULO_ETAPA[l.etapa]}.`)
          continue
        }
        if (s === l.etapa) {
          erros.push(`A etapa ${ROTULO_ETAPA[l.etapa]} não pode bloquear o próprio setor (ninguém conseguiria concluí-la).`)
          continue
        }
        const alvo = porEtapa.get(s as EtapaFluxo)
        if (!alvo?.ativa) {
          erros.push(`A etapa ${ROTULO_ETAPA[l.etapa]} bloqueia ${ROTULO_ETAPA[s as EtapaFluxo]}, que está pulada neste fluxo.`)
          continue
        }
        if (!bloqueia.includes(s as SetorBloqueavel)) bloqueia.push(s as SetorBloqueavel)
      }
      // forma canônica (ordem fixa) para comparar/gravar sem ruído
      bloqueia = SETORES_BLOQUEAVEIS.filter((s) => bloqueia.includes(s))
    }
    const cfg: EtapaConfig = { etapa: l.etapa, ativa: l.ativa, bloqueia }
    if (l.etapa === 'OP_PCP' && l.ativa && l.automatica) cfg.automatica = true
    return cfg
  })

  return erros.length > 0 ? { ok: false, erros } : { ok: true, etapas }
}

// ============================================================================
// Consultas sobre um fluxo já validado
// ============================================================================

export function etapasAtivas(etapas: readonly EtapaConfig[]): EtapaFluxo[] {
  return etapas.filter((e) => e.ativa).map((e) => e.etapa)
}

/** Etapa em que o pedido entra (a primeira ativa). */
export function etapaInicial(etapas: readonly EtapaConfig[]): EtapaFluxo | null {
  return etapasAtivas(etapas)[0] ?? null
}

/** Próxima etapa ATIVA depois de `atual` (pula as desativadas); null no fim do fluxo. */
export function proximaEtapa(etapas: readonly EtapaConfig[], atual: EtapaFluxo): EtapaFluxo | null {
  const i = etapas.findIndex((e) => e.etapa === atual)
  if (i < 0) return null
  for (let j = i + 1; j < etapas.length; j++) if (etapas[j].ativa) return etapas[j].etapa
  return null
}

export interface ResultadoAcesso {
  permitido: boolean
  /** Etapa em andamento que está bloqueando o setor. */
  bloqueadoPor?: EtapaFluxo
  mensagem?: string
}

/**
 * O `setor` pode agir no pedido enquanto ele está em `etapaAtual`? Só a etapa em
 * andamento bloqueia. Etapa que não está no fluxo (ex.: removida depois) não bloqueia.
 */
export function setorPodeAgir(
  etapas: readonly EtapaConfig[],
  etapaAtual: EtapaFluxo | null,
  setor: SetorBloqueavel,
): ResultadoAcesso {
  if (!etapaAtual) return { permitido: true }
  const cfg = etapas.find((e) => e.etapa === etapaAtual)
  if (cfg?.ativa && (cfg.bloqueia.includes(setor) || aguardaPelaSequencia(etapas, etapaAtual, setor))) {
    return {
      permitido: false,
      bloqueadoPor: etapaAtual,
      mensagem: `${ROTULO_ETAPA[setor]} aguarda a conclusão de ${ROTULO_ETAPA[etapaAtual]}.`,
    }
  }
  return { permitido: true }
}

/**
 * A SEQUÊNCIA define quem espera quem: o setor cuja etapa (ativa) vem DEPOIS da etapa em andamento
 * ainda não chegou a vez dele e aguarda. Ele continua VENDO o pedido (só as ações são barradas).
 * Setor com etapa pulada no fluxo não espera pela sequência (só por bloqueio marcado).
 */
export function aguardaPelaSequencia(
  etapas: readonly EtapaConfig[],
  etapaAtual: EtapaFluxo,
  setor: SetorBloqueavel,
): boolean {
  if (setor === etapaAtual) return false
  const iAtual = etapas.findIndex((e) => e.etapa === etapaAtual)
  const iSetor = etapas.findIndex((e) => e.etapa === setor)
  if (iAtual < 0 || iSetor < 0 || !etapas[iSetor].ativa) return false
  return iSetor > iAtual
}

/**
 * Setores bloqueados enquanto o pedido está em `etapaAtual` (para telas mostrarem o aviso): os
 * marcados na etapa + os que ainda aguardam a vez pela sequência.
 */
export function setoresBloqueados(etapas: readonly EtapaConfig[], etapaAtual: EtapaFluxo | null): SetorBloqueavel[] {
  if (!etapaAtual) return []
  const cfg = etapas.find((e) => e.etapa === etapaAtual)
  if (!cfg?.ativa) return []
  return SETORES_BLOQUEAVEIS.filter((s) => cfg.bloqueia.includes(s) || aguardaPelaSequencia(etapas, etapaAtual, s))
}

/** Setores que aguardam a vez (pela sequência) enquanto `etapa` estiver em andamento — para a visão do fluxo. */
export function setoresQueAguardam(etapas: readonly EtapaConfig[], etapa: EtapaFluxo): SetorBloqueavel[] {
  const cfg = etapas.find((e) => e.etapa === etapa)
  if (!cfg?.ativa) return []
  return SETORES_BLOQUEAVEIS.filter((s) => aguardaPelaSequencia(etapas, etapa, s))
}

// ============================================================================
// Em qual operação o pedido se enquadra
// ============================================================================

export interface DadosOperacaoPedido {
  tipoPedido?: string | null
  tipoPedidoDerivado?: string | null
  exigeAmostra?: boolean | null
  exigeProva?: boolean | null
  situacaoArte?: string | null
  alteracaoImpressao?: string | null
  /** Marcado no portal/pedido: solicitar alteracao de arte ou faca. */
  solicitaAlteracao?: boolean | null
}

/**
 * Classifica o pedido numa das 4 operações, por prioridade:
 * Mostruário (amostra/prova) → Alteração (arte/faca/impressão alterada) → Repetição → Novo Pedido.
 */
export function operacaoDoPedido(p: DadosOperacaoPedido): Operacao {
  if (p.tipoPedido === 'MOSTRUARIO' || p.exigeAmostra === true || p.exigeProva === true) return 'MOSTRUARIO'
  if (
    p.solicitaAlteracao === true ||
    p.tipoPedidoDerivado === 'ALTERACAO' ||
    p.situacaoArte === 'EXISTENTE_COM_ALTERACAO' ||
    p.situacaoArte === 'CLIENTE_ENVIA' ||
    (p.alteracaoImpressao ?? '').trim() !== ''
  ) {
    return 'ALTERACAO'
  }
  if (p.tipoPedido === 'REPETICAO' || p.tipoPedidoDerivado === 'REPETICAO') return 'REPETICAO'
  return 'NOVO'
}
