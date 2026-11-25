import { prisma } from '../../lib/prisma'
import type { ResultadoOrcamento } from './orcamento-grafico-calculo.service'
import { resolverPapelDoPlano } from './papel-do-plano'

/**
 * Camadas do plano (microondulado e capa interna) no custo do orçamento.
 *
 * No Calcgraf um plano de Cartucho Composto vira de 1 a 3 linhas de cálculo (capa externa,
 * microondulado, capa interna). O motor do Vizor calcula UMA folha por plano (a capa); sem este
 * módulo o papel das demais camadas ficava fora do custo (no cálculo 15185 o micro vale ~31%).
 *
 * Escopo da v1 (documentado em docs/orcamento-grafico-linhas-de-produto.md §14):
 *  - entra o PAPEL de cada camada: folhas da capa x área da folha do suporte x gramatura x R$/kg;
 *  - as atividades de acabamento e o material (cola) já entram pelo plano e não são duplicados;
 *  - impressão da capa interna e perda fixa própria de cada camada NÃO entram (ainda).
 * Hipótese: a camada usa as mesmas folhas da capa (mesma imposição). Paridade esperada ~5%.
 */

export type NomeCamada = 'microondulado' | 'capaInterna'

export interface CamadaCusto {
  nome: NomeCamada
  suporteId: string
  folhas: number
  larguraMm: number
  alturaMm: number
  gramatura: number
  precoKg: number
  pesoKg: number
  custo: number
}

const r2 = (x: number) => Math.round(x * 100) / 100
const r3 = (x: number) => Math.round(x * 1000) / 1000

/** Folhas brutas que o motor usou na capa, derivadas do peso (o resultado não expõe as folhas). */
export function folhasDaCapa(
  resultado: Pick<ResultadoOrcamento, 'papel' | 'encaixe'>,
  gramaturaCapa: number,
): number {
  const lay = resultado.encaixe?.layout
  if (!lay || !(gramaturaCapa > 0) || !(resultado.papel?.pesoKg > 0)) return 0
  const areaM2 = (lay.folhaLarguraMm / 1000) * (lay.folhaAlturaMm / 1000)
  if (!(areaM2 > 0)) return 0
  return Math.round(resultado.papel.pesoKg / (areaM2 * (gramaturaCapa / 1000)))
}

/** Custo do papel de uma camada. Puro. */
export function custoPapelCamada(p: {
  folhas: number
  larguraMm: number
  alturaMm: number
  gramatura: number
  precoKg: number
}): { pesoKg: number; custo: number } {
  if (!(p.folhas > 0) || !(p.larguraMm > 0) || !(p.alturaMm > 0) || !(p.gramatura > 0) || !(p.precoKg > 0)) {
    return { pesoKg: 0, custo: 0 }
  }
  const pesoKg = p.folhas * (p.larguraMm / 1000) * (p.alturaMm / 1000) * (p.gramatura / 1000)
  return { pesoKg: r3(pesoKg), custo: r2(pesoKg * p.precoKg) }
}

/** Ids de suporte (PrecoMateriaPrima) das camadas informadas na especificação do plano. */
export function suportesDasCamadas(especificacao: unknown): Array<{ nome: NomeCamada; suporteId: string }> {
  const esp = (especificacao ?? {}) as Record<string, { suporteId?: unknown; fornecido?: unknown } | null | undefined>
  const saida: Array<{ nome: NomeCamada; suporteId: string }> = []
  for (const nome of ['microondulado', 'capaInterna'] as const) {
    const b = esp[nome]
    if (b && typeof b.suporteId === 'string' && b.suporteId && b.fornecido !== true) {
      saida.push({ nome, suporteId: b.suporteId })
    }
  }
  return saida
}

/** `orc.camadasPlano = false` desliga (default ligado). */
async function camadasLigadas(empresaId: string): Promise<boolean> {
  const p = await prisma.parametro.findFirst({ where: { empresaId, chave: 'orc.camadasPlano' }, select: { valor: true } })
  return !(p && String(p.valor).trim().toLowerCase() === 'false')
}

async function calcularCamadasDoPlanoBruto(
  empresaId: string,
  especificacao: unknown,
  resultado: ResultadoOrcamento,
  gramaturaCapa: number,
): Promise<CamadaCusto[]> {
  const alvos = suportesDasCamadas(especificacao)
  if (alvos.length === 0) return []
  if (!(await camadasLigadas(empresaId))) return []
  const folhas = folhasDaCapa(resultado, gramaturaCapa)
  if (folhas <= 0) return []

  // Id do papel (ou id antigo do suporte, resolvido para o papel desse suporte).
  const resolvidos = await Promise.all(alvos.map((a) => resolverPapelDoPlano(empresaId, a.suporteId)))
  const idsPapel = resolvidos.filter((r): r is NonNullable<typeof r> => !!r).map((r) => r.id)
  const precos = idsPapel.length
    ? await prisma.precoMateriaPrima.findMany({
        where: { empresaId, id: { in: idsPapel } },
        select: { id: true, precoUnitario: true, gramatura: true, suporteId: true },
      })
    : []
  const papelDoAlvo = new Map(alvos.map((a, i) => [a.suporteId, resolvidos[i]?.id ?? null]))
  const suporteIds = precos.map((p) => p.suporteId).filter((x): x is string => !!x)
  const suportes = suporteIds.length
    ? await prisma.suporteGrafico.findMany({
        where: { empresaId, id: { in: suporteIds } },
        select: { id: true, formatoLarguraMm: true, formatoAlturaMm: true },
      })
    : []
  const suportePorId = new Map(suportes.map((s) => [s.id, s]))
  const precoPorId = new Map(precos.map((p) => [p.id, p]))

  const lay = resultado.encaixe.layout
  if (!lay) return []
  const saida: CamadaCusto[] = []
  for (const a of alvos) {
    const idPapel = papelDoAlvo.get(a.suporteId)
    const preco = idPapel ? precoPorId.get(idPapel) : undefined
    if (!preco) continue
    const sup = preco.suporteId ? suportePorId.get(preco.suporteId) : undefined
    // Sem formato cadastrado no suporte, assume a folha da capa (mesma imposição).
    const larguraMm = Number(sup?.formatoLarguraMm ?? 0) || lay.folhaLarguraMm
    const alturaMm = Number(sup?.formatoAlturaMm ?? 0) || lay.folhaAlturaMm
    const gramatura = Number(preco.gramatura ?? 0)
    const precoKg = Number(preco.precoUnitario)
    const { pesoKg, custo } = custoPapelCamada({ folhas, larguraMm, alturaMm, gramatura, precoKg })
    if (custo > 0) {
      saida.push({ nome: a.nome, suporteId: a.suporteId, folhas, larguraMm, alturaMm, gramatura, precoKg, pesoKg, custo })
    }
  }
  return saida
}

/** Falha ao buscar o cadastro não derruba o cálculo do plano: segue sem camadas. */
export async function calcularCamadasDoPlano(...args: Parameters<typeof calcularCamadasDoPlanoBruto>): Promise<CamadaCusto[]> {
  try {
    return await calcularCamadasDoPlanoBruto(...args)
  } catch (err) {
    console.warn('[camadas-plano] camadas ignoradas:', err instanceof Error ? err.message : err)
    return []
  }
}

/** Soma o custo das camadas ao resultado do plano (material direto e totais). Muta e devolve. */
export function somarCamadasAoResultado(resultado: ResultadoOrcamento, camadas: CamadaCusto[]): ResultadoOrcamento {
  if (camadas.length === 0) return resultado
  const extra = r2(camadas.reduce((s, c) => s + c.custo, 0))
  resultado.materialDireto = r2(resultado.materialDireto + extra)
  resultado.custoProducao = r2(resultado.custoProducao + extra)
  resultado.custoTotal = r2(resultado.custoTotal + extra)
  ;(resultado as ResultadoOrcamento & { camadas?: CamadaCusto[] }).camadas = camadas
  return resultado
}

/** Atalho usado pelas rotas de plano. */
export async function aplicarCamadasAoResultado(
  empresaId: string,
  especificacao: unknown,
  resultado: ResultadoOrcamento,
  gramaturaCapa: number,
): Promise<ResultadoOrcamento> {
  const camadas = await calcularCamadasDoPlano(empresaId, especificacao, resultado, gramaturaCapa)
  return somarCamadasAoResultado(resultado, camadas)
}
