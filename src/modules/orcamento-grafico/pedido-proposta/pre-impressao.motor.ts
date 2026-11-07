/**
 * Motor PURO do Board da Pré-Impressão (spec comercial-pre-impressao-board).
 * Sem Prisma/IO. Etapas, status, caminho e regra de "board concluído".
 */

export type EtapaPre = 'MOCKUP' | 'ARTE' | 'PADRAO' | 'FICHA_TECNICA'
export type StatusEtapa = 'PENDENTE' | 'EM_ANDAMENTO' | 'CONCLUIDA'
export type Caminho = 'CONFERENCIA' | 'PARCIAL' | 'COMPLETA'

export class PreImpressaoError extends Error {
  constructor(public statusCode: number, message: string, public code: string) {
    super(message)
    this.name = 'PreImpressaoError'
  }
}

/** Ordem fixa das etapas do board. */
export const ETAPAS: EtapaPre[] = ['MOCKUP', 'ARTE', 'PADRAO', 'FICHA_TECNICA']

export const STATUS_VALIDOS: StatusEtapa[] = ['PENDENTE', 'EM_ANDAMENTO', 'CONCLUIDA']

/** Rótulos legíveis das etapas (para eventos/exibição auxiliar). */
export const ETAPA_LABEL: Record<EtapaPre, string> = {
  MOCKUP: 'Mockup',
  ARTE: 'Arte',
  PADRAO: 'Padrão',
  FICHA_TECNICA: 'Ficha Técnica',
}

/**
 * Etapas RELEVANTES por caminho (define quando o board é considerado concluído).
 * As 4 etapas sempre existem no board; "relevantes" filtra por tipo de pedido.
 *  - COMPLETA (produto novo): as 4.
 *  - PARCIAL (alteração): sem Mockup.
 *  - CONFERENCIA (repetição): conferir Arte e Ficha Técnica.
 */
export function etapasRelevantes(caminho: Caminho): EtapaPre[] {
  switch (caminho) {
    case 'COMPLETA':
      return ['MOCKUP', 'ARTE', 'PADRAO', 'FICHA_TECNICA']
    case 'PARCIAL':
      return ['ARTE', 'PADRAO', 'FICHA_TECNICA']
    case 'CONFERENCIA':
      return ['ARTE', 'FICHA_TECNICA']
  }
}

/** Board concluído quando todas as etapas relevantes do caminho estão CONCLUIDA. */
export function boardConcluido(
  caminho: Caminho,
  statusPorEtapa: Partial<Record<EtapaPre, StatusEtapa>>,
): boolean {
  const relevantes = etapasRelevantes(caminho)
  return relevantes.every((e) => statusPorEtapa[e] === 'CONCLUIDA')
}

/** Valida/normaliza um status; lança PreImpressaoError (400) se inválido. */
export function validarStatus(s: string): StatusEtapa {
  if ((STATUS_VALIDOS as string[]).includes(s)) return s as StatusEtapa
  throw new PreImpressaoError(400, `Status de etapa inválido: ${s}`, 'STATUS_ETAPA_INVALIDO')
}

/** Valida uma etapa; lança PreImpressaoError (400) se inválida. */
export function validarEtapa(e: string): EtapaPre {
  if ((ETAPAS as string[]).includes(e)) return e as EtapaPre
  throw new PreImpressaoError(400, `Etapa inválida: ${e}`, 'ETAPA_INVALIDA')
}

// ── Resumo de etapas para o tooltip da listagem (função pura) ────────────────

export interface EtapaResumoTooltip {
  etapa: EtapaPre
  label: string
  status: StatusEtapa
  relevante: boolean
  atual: boolean // 1ª etapa relevante não concluída
}

/**
 * Monta o resumo das etapas na ordem fixa, marcando a ETAPA ATUAL (a primeira
 * relevante ainda não concluída). Usado no hint ao passar o mouse no status.
 */
export function resumoEtapasTooltip(
  caminho: Caminho,
  statusPorEtapa: Partial<Record<EtapaPre, StatusEtapa>>,
): EtapaResumoTooltip[] {
  const relevantes = new Set(etapasRelevantes(caminho))
  const atual = etapasRelevantes(caminho).find((e) => statusPorEtapa[e] !== 'CONCLUIDA') ?? null
  return ETAPAS.map((etapa) => ({
    etapa,
    label: ETAPA_LABEL[etapa],
    status: statusPorEtapa[etapa] ?? 'PENDENTE',
    relevante: relevantes.has(etapa),
    atual: etapa === atual,
  }))
}
