import { prisma } from '../../lib/prisma'

/**
 * Papel (PrecoMateriaPrima) de um bloco do plano: preço/kg e gramatura que entram no cálculo.
 *
 * A tela do plano grava o id do PAPEL. Planos gravados antes guardavam o id do SUPORTE (a família, em
 * `suporte_grafico`, sem preço): nesse caso procura o papel daquele suporte com preço, pela gramatura
 * informada; sem gramatura, só aceita quando o suporte tem um único papel com preço. Nunca inventa.
 */
export interface PapelResolvido {
  id: string
  precoKg: number
  gramatura: number | null
}

export async function resolverPapelDoPlano(
  empresaId: string,
  id: string | null | undefined,
  gramatura?: number | null,
): Promise<PapelResolvido | null> {
  if (!id) return null
  const direto = await prisma.precoMateriaPrima.findFirst({
    where: { id, empresaId },
    select: { id: true, precoUnitario: true, gramatura: true },
  })
  if (direto) return paraResolvido(direto)

  const suporte = await prisma.suporteGrafico.findFirst({ where: { id, empresaId }, select: { id: true } })
  if (!suporte) return null
  const papeis = await prisma.precoMateriaPrima.findMany({
    where: { empresaId, suporteId: id, status: true, precoUnitario: { gt: 0 } },
    select: { id: true, precoUnitario: true, gramatura: true },
  })
  const g = Number(gramatura ?? 0)
  const escolhido =
    g > 0 ? papeis.find((p) => Number(p.gramatura ?? 0) === g) : papeis.length === 1 ? papeis[0] : undefined
  return escolhido ? paraResolvido(escolhido) : null
}

function paraResolvido(p: { id: string; precoUnitario: unknown; gramatura: unknown }): PapelResolvido {
  const g = Number(p.gramatura ?? 0)
  return { id: p.id, precoKg: Number(p.precoUnitario) || 0, gramatura: g > 0 ? g : null }
}
