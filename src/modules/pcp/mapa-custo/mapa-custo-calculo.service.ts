import { Decimal } from '@prisma/client/runtime/library'

/**
 * Motor de cálculo do Mapa de Custos RKW (spec: .kiro/specs/mapa-custos-rkw).
 *
 * PURO e testável: recebe os dados do mapa (centros, bens, funcionários,
 * despesas, chaves) e retorna o resultado por centro (colunas A..G + custo/hora),
 * sem nenhum acesso a banco. A persistência fica na rota `/calcular`.
 *
 * Metodologia RKW (ver docs/calcgraf-gprint-levantamento.md §7–§13):
 *   A = Σ funcionários do centro: salario × (1 + encargos%) + ajudaCusto
 *   B = Σ depreciação mensal dos bens do centro
 *   C = Σ despesas rateadas ao centro (via chave de rateio)
 *   D = A + B + C                                   (Custo Fixo do centro)
 *   E = rateio recebido dos centros AUXILIARES      (2º nível)
 *   F = rateio recebido do(s) centro(s) ADMINISTRACAO
 *   G = D + E + F                                   (Custo Fixo Final)
 *   Custo/Hora Apurado   = G / horasProdutivas
 *   Custo/Hora A Praticar = Apurado × (1 + ajustePraticarPerc%)
 *
 * Todos os cálculos em Decimal (nunca number) para precisão monetária.
 */

// ── Constantes ──────────────────────────────────────────────────────────────
export const NATUREZA = {
  PRODUTIVO: 'PRODUTIVO',
  AUXILIAR: 'AUXILIAR',
  ADMINISTRACAO: 'ADMINISTRACAO',
} as const

export const TIPO_CHAVE = {
  MANUAL: 'MANUAL', // pesos fixos por destino
  HEADCOUNT: 'HEADCOUNT', // peso = nº de funcionários do centro-destino
  ATIVO: 'ATIVO', // peso = valor dos bens do centro-destino
  CENTRO: 'CENTRO', // 100% a um único centro-destino
  FUNCIONARIO: 'FUNCIONARIO', // rateio de um funcionário específico
} as const

// ── Tipos de entrada ─────────────────────────────────────────────────────────
export interface CentroInput {
  id: string
  codigo: string
  natureza: string // PRODUTIVO | AUXILIAR | ADMINISTRACAO
  unidadesProdutivas: number
  horasExtras: number
  /** Chave de rateio usada para distribuir este centro (auxiliar/adm) nos produtivos. */
  chaveRateioId?: string | null
}

export interface BemInput {
  id: string
  centroCustoId: string
  valor: Decimal | number | string
  estado: string // OTIMO | BOM | REGULAR
  anosVidaUtil: number
  residualPerc: Decimal | number | string
}

export interface FuncionarioInput {
  id: string
  centroCustoId?: string | null
  salario: Decimal | number | string
  ajudaCusto: Decimal | number | string
  rateado: boolean
}

export interface DespesaInput {
  id: string
  valor: Decimal | number | string
  chaveRateioId: string
}

export interface DestinoInput {
  centroCustoId: string
  peso: Decimal | number | string
}

export interface ChaveInput {
  id: string
  tipo: string
  funcionarioCustoId?: string | null
  destinos: DestinoInput[]
}

export interface MapaParametros {
  percEncargos: Decimal | number | string
  horasProdutivasBase: number
  ajustePraticarPerc: Decimal | number | string
}

export interface CalcularMapaInput {
  parametros: MapaParametros
  centros: CentroInput[]
  bens: BemInput[]
  funcionarios: FuncionarioInput[]
  despesas: DespesaInput[]
  chaves: ChaveInput[]
}

// ── Tipos de saída ────────────────────────────────────────────────────────────
export interface ResultadoCentroOutput {
  centroCustoId: string
  salariosEncargos: Decimal // A
  depreciacoes: Decimal // B
  despesas: Decimal // C
  custoFixo: Decimal // D = A+B+C
  rateioAuxiliar: Decimal // E
  rateioAdministracao: Decimal // F
  custoFixoFinal: Decimal // G = D+E+F
  horasProdutivas: Decimal // H
  custoHoraApurado: Decimal // G/H (0 se H=0)
  custoHoraPraticar: Decimal
  ajustePerc: Decimal
  /** true quando o centro produtivo não tem horas > 0 (custo/hora N/A). */
  horasIndefinidas: boolean
}

export interface TotaisMapa {
  custoFixoTotal: Decimal
  taxaAdministrativa: Decimal // % do custo fixo que é ADMINISTRACAO
  totalFuncionarios: number
  ativoImobilizado: Decimal
  depreciacaoMensal: Decimal
}

export interface CalcularMapaResult {
  resultados: ResultadoCentroOutput[]
  totais: TotaisMapa
}

const ZERO = new Decimal(0)
const CEM = new Decimal(100)

function toDec(v: Decimal | number | string): Decimal {
  return v instanceof Decimal ? v : new Decimal(v)
}

/**
 * Fator de estado do bem sobre a depreciação. Hoje NEUTRO (1.0) para todos —
 * o Calcgraf usa o "Estado" (Ótimo/Bom/Regular) mas ainda não confirmamos como
 * ele modula o cálculo (ver dúvida no steering migracao-calcgraf-carton-wega).
 * Isolado aqui para ajuste futuro sem tocar o resto do motor.
 */
export function fatorEstado(_estado: string): Decimal {
  return new Decimal(1)
}

/**
 * Task 2.2 — depreciação mensal de um bem.
 * (valor − valor × residual%/100) ÷ (anos × 12) × fatorEstado(estado)
 */
export function depreciacaoBem(bem: BemInput): Decimal {
  const valor = toDec(bem.valor)
  const residual = toDec(bem.residualPerc)
  const anos = bem.anosVidaUtil
  if (!anos || anos <= 0) return ZERO
  const base = valor.minus(valor.times(residual).dividedBy(CEM))
  const meses = new Decimal(anos).times(12)
  return base.dividedBy(meses).times(fatorEstado(bem.estado))
}

/**
 * Task 2.3 — custo de mão de obra de um funcionário.
 * salario × (1 + encargos%/100) + ajudaCusto
 */
export function custoFuncionario(
  func: FuncionarioInput,
  percEncargos: Decimal,
): Decimal {
  const salario = toDec(func.salario)
  const ajuda = toDec(func.ajudaCusto)
  const fator = new Decimal(1).plus(percEncargos.dividedBy(CEM))
  return salario.times(fator).plus(ajuda)
}

/**
 * Task 2.4 — resolve uma chave de rateio em percentuais por centro-destino.
 * Retorna Map<centroCustoId, fração (0..1)>. Σ frações = 1.
 * Lança erro se a soma dos pesos for zero (evita divisão por zero — Req 6.3).
 */
export function resolverChave(
  chave: ChaveInput,
  ctx: {
    headcountPorCentro: Map<string, number>
    ativoPorCentro: Map<string, Decimal>
  },
): Map<string, Decimal> {
  const pesos = new Map<string, Decimal>()

  for (const destino of chave.destinos) {
    let peso: Decimal
    switch (chave.tipo) {
      case TIPO_CHAVE.HEADCOUNT:
        peso = new Decimal(ctx.headcountPorCentro.get(destino.centroCustoId) ?? 0)
        break
      case TIPO_CHAVE.ATIVO:
        peso = ctx.ativoPorCentro.get(destino.centroCustoId) ?? ZERO
        break
      case TIPO_CHAVE.CENTRO:
        peso = new Decimal(1) // destino único; normaliza p/ 100%
        break
      case TIPO_CHAVE.MANUAL:
      case TIPO_CHAVE.FUNCIONARIO:
      default:
        peso = toDec(destino.peso)
        break
    }
    pesos.set(destino.centroCustoId, peso)
  }

  const soma = [...pesos.values()].reduce((a, b) => a.plus(b), ZERO)
  if (soma.lessThanOrEqualTo(0)) {
    throw new Error(
      `Chave de rateio ${chave.id} (tipo ${chave.tipo}) tem soma de pesos zero — não é possível ratear.`,
    )
  }

  const fracoes = new Map<string, Decimal>()
  for (const [centroId, peso] of pesos) {
    fracoes.set(centroId, peso.dividedBy(soma))
  }
  return fracoes
}

/**
 * Task 2.1 + 2.5 + 2.6 + 2.7 + 2.8 + 2.9 — cálculo completo do mapa.
 * Idempotente (não muta a entrada; sempre recalcula do zero).
 */
export function calcularMapa(input: CalcularMapaInput): CalcularMapaResult {
  const percEncargos = toDec(input.parametros.percEncargos)
  const ajustePerc = toDec(input.parametros.ajustePraticarPerc)
  const horasBase = new Decimal(input.parametros.horasProdutivasBase)

  const centroPorId = new Map(input.centros.map((c) => [c.id, c]))
  const chavePorId = new Map(input.chaves.map((k) => [k.id, k]))

  // Acumuladores por centro
  const A = new Map<string, Decimal>() // salários+encargos
  const B = new Map<string, Decimal>() // depreciações
  const C = new Map<string, Decimal>() // despesas
  const headcount = new Map<string, number>()
  const ativoPorCentro = new Map<string, Decimal>()
  for (const c of input.centros) {
    A.set(c.id, ZERO)
    B.set(c.id, ZERO)
    C.set(c.id, ZERO)
    headcount.set(c.id, 0)
    ativoPorCentro.set(c.id, ZERO)
  }
  const add = (m: Map<string, Decimal>, id: string, v: Decimal) => {
    if (!m.has(id)) return // ignora ids fora do mapa
    m.set(id, m.get(id)!.plus(v))
  }

  // ── Depreciação (B) + ativo por centro ────────────────────────────────────
  let depreciacaoMensalTotal = ZERO
  let ativoImobilizadoTotal = ZERO
  for (const bem of input.bens) {
    const dep = depreciacaoBem(bem)
    add(B, bem.centroCustoId, dep)
    depreciacaoMensalTotal = depreciacaoMensalTotal.plus(dep)
    ativoImobilizadoTotal = ativoImobilizadoTotal.plus(toDec(bem.valor))
    if (ativoPorCentro.has(bem.centroCustoId)) {
      ativoPorCentro.set(bem.centroCustoId, ativoPorCentro.get(bem.centroCustoId)!.plus(toDec(bem.valor)))
    }
  }

  // ── Funcionários diretos (A) + headcount; rateados tratados depois ─────────
  let totalFuncionarios = 0
  for (const func of input.funcionarios) {
    totalFuncionarios += 1
    if (func.rateado) continue // rateados entram via chave FUNCIONARIO
    if (func.centroCustoId) {
      add(A, func.centroCustoId, custoFuncionario(func, percEncargos))
      if (headcount.has(func.centroCustoId)) {
        headcount.set(func.centroCustoId, (headcount.get(func.centroCustoId) ?? 0) + 1)
      }
    }
  }

  const ctxChave = { headcountPorCentro: headcount, ativoPorCentro }

  // ── Funcionários RATEADOS (A) via chave FUNCIONARIO (Task 2.5) ─────────────
  for (const func of input.funcionarios) {
    if (!func.rateado) continue
    const chave = input.chaves.find(
      (k) => k.tipo === TIPO_CHAVE.FUNCIONARIO && k.funcionarioCustoId === func.id,
    )
    if (!chave) continue // sem chave definida → ignorado (validado na rota)
    const custo = custoFuncionario(func, percEncargos)
    const fracoes = resolverChave(chave, ctxChave)
    for (const [centroId, frac] of fracoes) {
      add(A, centroId, custo.times(frac))
    }
  }

  // ── Despesas (C) via chave (Task 2.5) ──────────────────────────────────────
  for (const desp of input.despesas) {
    const chave = chavePorId.get(desp.chaveRateioId)
    if (!chave) {
      throw new Error(`Despesa ${desp.id} referencia chave de rateio inexistente (${desp.chaveRateioId}).`)
    }
    const valor = toDec(desp.valor)
    const fracoes = resolverChave(chave, ctxChave)
    for (const [centroId, frac] of fracoes) {
      add(C, centroId, valor.times(frac))
    }
  }

  // ── Custo Fixo D = A + B + C (Task 2.6) ────────────────────────────────────
  const D = new Map<string, Decimal>()
  for (const c of input.centros) {
    D.set(c.id, A.get(c.id)!.plus(B.get(c.id)!).plus(C.get(c.id)!))
  }

  // ── Rateio 2º nível: auxiliares (E) e administração (F) → produtivos ───────
  const E = new Map<string, Decimal>()
  const F = new Map<string, Decimal>()
  for (const c of input.centros) {
    E.set(c.id, ZERO)
    F.set(c.id, ZERO)
  }
  for (const centro of input.centros) {
    const isAux = centro.natureza === NATUREZA.AUXILIAR
    const isAdm = centro.natureza === NATUREZA.ADMINISTRACAO
    if (!isAux && !isAdm) continue
    if (!centro.chaveRateioId) continue // sem chave → custo fica retido (avisado na rota)
    const chave = chavePorId.get(centro.chaveRateioId)
    if (!chave) continue
    const valorCentro = D.get(centro.id)!
    const fracoes = resolverChave(chave, ctxChave)
    for (const [centroDestinoId, frac] of fracoes) {
      const destino = centroPorId.get(centroDestinoId)
      if (!destino || destino.natureza !== NATUREZA.PRODUTIVO) continue
      const parcela = valorCentro.times(frac)
      if (isAux) add(E, centroDestinoId, parcela)
      else add(F, centroDestinoId, parcela)
    }
  }

  // ── Custo/Hora por centro produtivo (Task 2.7) ─────────────────────────────
  const resultados: ResultadoCentroOutput[] = []
  let custoFixoTotal = ZERO
  let custoAdmTotal = ZERO

  for (const centro of input.centros) {
    const a = A.get(centro.id)!
    const b = B.get(centro.id)!
    const c = C.get(centro.id)!
    const d = D.get(centro.id)!
    const e = E.get(centro.id)!
    const f = F.get(centro.id)!
    const g = d.plus(e).plus(f)

    custoFixoTotal = custoFixoTotal.plus(d)
    if (centro.natureza === NATUREZA.ADMINISTRACAO) custoAdmTotal = custoAdmTotal.plus(d)

    const isProdutivo = centro.natureza === NATUREZA.PRODUTIVO
    const horas = isProdutivo
      ? horasBase.times(centro.unidadesProdutivas).plus(centro.horasExtras)
      : ZERO
    const horasIndefinidas = isProdutivo && horas.lessThanOrEqualTo(0)
    const custoHoraApurado = horasIndefinidas || !isProdutivo ? ZERO : g.dividedBy(horas)
    const custoHoraPraticar = custoHoraApurado.times(new Decimal(1).plus(ajustePerc.dividedBy(CEM)))

    resultados.push({
      centroCustoId: centro.id,
      salariosEncargos: a,
      depreciacoes: b,
      despesas: c,
      custoFixo: d,
      rateioAuxiliar: e,
      rateioAdministracao: f,
      custoFixoFinal: g,
      horasProdutivas: horas,
      custoHoraApurado,
      custoHoraPraticar,
      ajustePerc,
      horasIndefinidas,
    })
  }

  // ── Totais consolidados (Task 2.8) ─────────────────────────────────────────
  const taxaAdministrativa = custoFixoTotal.lessThanOrEqualTo(0)
    ? ZERO
    : custoAdmTotal.dividedBy(custoFixoTotal).times(CEM)

  return {
    resultados,
    totais: {
      custoFixoTotal,
      taxaAdministrativa,
      totalFuncionarios,
      ativoImobilizado: ativoImobilizadoTotal,
      depreciacaoMensal: depreciacaoMensalTotal,
    },
  }
}
