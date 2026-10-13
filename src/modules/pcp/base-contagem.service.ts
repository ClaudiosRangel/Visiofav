/**
 * Base de Contagem por Tipo de Processo (spec `base-contagem-por-tipo-processo`).
 *
 * FONTE ÚNICA DE VERDADE da regra: a base de contagem de produção (Tiragem vs
 * Unidade) é derivada EXCLUSIVAMENTE do código do Tipo de Processo do centro.
 *
 *   - COLAGEM            → base UNIDADE  (peças montadas finais)
 *   - qualquer outro     → base TIRAGEM  (folhas/passagens planejadas)
 *
 * Funções PURAS (sem Prisma), 100% testáveis. Toda superfície (painel,
 * dashboard, quadro, apontamentos, checkout) deve anexar o objeto derivado
 * `contagem` chamando `resolverPlanejadoDaEtapa`, para que o frontend apenas
 * renderize `contagem.*` — nunca reimplemente a regra (Requirement 6).
 *
 * Decisões travadas (ver requirements.md/design.md):
 *   - D1: Unidade = quantidade da OP (plano único/implícito; colagem no produto final).
 *   - D2: base derivada do Tipo de Processo ATUAL (sem persistir base no apontamento,
 *         sem mudança de schema). O dado bruto apontado NUNCA é convertido (R3).
 */

/** Código do Tipo de Processo que conta em Unidade (único). Reservado/semântico. */
export const CODIGO_PROCESSO_UNIDADE = 'COLAGEM'

export type BaseContagem = 'UNIDADE' | 'TIRAGEM'

/**
 * Regra travada: só COLAGEM conta em Unidade; todo o resto (incl. Cortadeira,
 * Impressão, Acabamento, Acoplagem, Corte Vinco, Verniz, códigos arbitrários e
 * null/undefined) conta em Tiragem (base padrão).
 */
export function baseContagem(codigo: string | null | undefined): BaseContagem {
  return codigo === CODIGO_PROCESSO_UNIDADE ? 'UNIDADE' : 'TIRAGEM'
}

/** Plano de produção (ou plano implícito da OP) relevante para a base. */
export interface PlanoLike {
  /** Folhas/passagens planejadas do plano (base TIRAGEM). */
  tiragem: number | null
  /** Peças planejadas do plano (base UNIDADE); ausente → usar a quantidade da OP. */
  unidade?: number | null
}

/** Ordem de Produção (usada como plano implícito quando a etapa não tem plano). */
export interface OpLike {
  /** Peças planejadas da OP (unidade da OP). */
  quantidade: number
}

export interface EtapaLike {
  /** Código do Tipo de Processo do centro da etapa. */
  tipoProcessoCodigo: string | null
  /** > 0 marca etapa resultante de desmembramento (sobrepõe o planejado). */
  quantidadePrevista: number
  /** Dado bruto apontado — NUNCA convertido em função da base (R3). */
  quantidadeProduzida: number
}

export interface ContagemResolvida {
  base: BaseContagem
  /** Denominador do progresso, na base do processo. */
  planejado: number
  /** = quantidadeProduzida bruto, sem conversão. */
  apontado: number
  /** 0..100; 0 quando planejado <= 0. */
  progresso: number
}

/** Erro de regra de negócio da base de contagem (ex.: escopo multi-tenant ausente). */
export class BaseContagemError extends Error {
  statusCode: number
  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'BaseContagemError'
    this.statusCode = statusCode
  }
}

/**
 * Garante o escopo multi-tenant (R14.3): toda agregação/resolução que dependa de
 * `empresaId` deve recusar explicitamente quando o escopo não puder ser
 * determinado — nunca retornar vazio nem assumir empresa padrão.
 */
export function exigirEmpresaId(empresaId: string | null | undefined): string {
  if (!empresaId || typeof empresaId !== 'string' || empresaId.trim() === '') {
    throw new BaseContagemError(
      'Escopo de empresa (empresaId) obrigatório para agregar produção.',
      400,
    )
  }
  return empresaId
}

/** Número finito e não-negativo, ou 0. */
function naoNegativo(n: number | null | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Resolve o planejado/progresso de uma etapa na base do seu Tipo de Processo.
 *
 * - base = baseContagem(tipoProcessoCodigo)
 * - plano implícito: `plano == null` usa a OP como plano único (R5 — não-regressão)
 * - UNIDADE: usa `plano.unidade` (se > 0) senão `op.quantidade`
 * - TIRAGEM: usa `plano.tiragem` (se > 0) senão fallback de não-regressão
 *   (`quantidadePrevista > 0 ? quantidadePrevista : op.quantidade`)
 * - desmembramento: `quantidadePrevista > 0` SEMPRE sobrepõe o planejado
 * - `apontado` = `quantidadeProduzida` bruto (R3), `progresso` = 0..100 (0 se planejado<=0)
 */
export function resolverPlanejadoDaEtapa(
  etapa: EtapaLike,
  plano: PlanoLike | null,
  op: OpLike,
): ContagemResolvida {
  const base = baseContagem(etapa.tipoProcessoCodigo)
  const apontado = naoNegativo(etapa.quantidadeProduzida)
  const prevista = naoNegativo(etapa.quantidadePrevista)
  const qtdOp = naoNegativo(op?.quantidade)

  let planejado: number
  if (prevista > 0) {
    // Desmembramento: a parte define o planejado, independentemente da base.
    planejado = prevista
  } else if (base === 'UNIDADE') {
    const unidadePlano = naoNegativo(plano?.unidade)
    planejado = unidadePlano > 0 ? unidadePlano : qtdOp
  } else {
    // TIRAGEM
    const tiragemPlano = naoNegativo(plano?.tiragem)
    planejado = tiragemPlano > 0 ? tiragemPlano : qtdOp
  }

  const progresso =
    planejado > 0 ? Math.min(100, Math.round((apontado / planejado) * 100 * 100) / 100) : 0

  return { base, planejado, apontado, progresso }
}
