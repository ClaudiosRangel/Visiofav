/**
 * Catálogo comercial ÚNICO — fonte das listas de seleção usadas tanto no
 * Portal do Representante quanto em Pedidos/Propostas (alinhamento reunião
 * 24/11/2026). Garante que os dois formulários ofereçam exatamente as mesmas
 * opções: tipos de embalagem e acabamentos marcados com `exibirComercial`,
 * suportes (cartão / microondulado), acondicionamentos e prazos de pagamento.
 *
 * Isolamento: empresaId EXPLÍCITO em toda query.
 */
import { prisma } from '../../../lib/prisma'

export interface CatalogoComercial {
  tiposEmbalagem: Array<{ id: string; codigo: string; descricao: string }>
  acabamentos: Array<{ id: string; codigo: string; nome: string }>
  acondicionamentos: Array<{ id: string; nome: string }>
  suportes: Array<{ id: string; descricao: string; tipoSuporte: string; gramaturas: string[] }>
  prazos: Array<{ id: string; descricao: string }>
}

function gramaturasDe(texto: string | null): string[] {
  if (!texto) return []
  return texto
    .split(/[,;\s]+/)
    .map((g) => g.trim())
    .filter(Boolean)
}

/** Remove itens com a mesma descrição (mantém o primeiro). */
function unicosPor<T>(itens: T[], chave: (i: T) => string): T[] {
  const vistos = new Set<string>()
  return itens.filter((i) => {
    const k = chave(i).trim().toLowerCase()
    if (!k || vistos.has(k)) return false
    vistos.add(k)
    return true
  })
}

export async function obterCatalogoComercial(empresaId: string): Promise<CatalogoComercial> {
  const [tipos, acabs, acond, suportes, prazos] = await Promise.all([
    prisma.tipoEmbalagem.findMany({
      where: { empresaId, status: true, exibirComercial: true } as never,
      select: { id: true, codigo: true, descricao: true },
      orderBy: { descricao: 'asc' },
    }),
    prisma.acabamentoGrafico.findMany({
      where: {
        empresaId, status: true, exibirComercial: true,
        tipoAtividade: 'ACABAMENTO', acondicionamento: false,
      } as never,
      select: { id: true, codigo: true, nome: true },
      orderBy: { nome: 'asc' },
    }),
    prisma.acabamentoGrafico.findMany({
      where: { empresaId, status: true, exibirComercial: true, acondicionamento: true } as never,
      select: { id: true, nome: true },
      orderBy: { nome: 'asc' },
    }),
    prisma.suporteGrafico.findMany({
      where: { empresaId, status: true },
      select: { id: true, descricao: true, tipoSuporte: true, gramaturas: true },
      orderBy: { descricao: 'asc' },
    }),
    prisma.condicaoPagamentoComercial.findMany({
      where: { empresaId, status: true },
      select: { id: true, descricao: true },
      orderBy: [{ dias: 'asc' }, { descricao: 'asc' }],
    }),
  ])

  return {
    tiposEmbalagem: unicosPor(tipos as CatalogoComercial['tiposEmbalagem'], (t) => t.descricao),
    acabamentos: unicosPor(acabs as CatalogoComercial['acabamentos'], (a) => a.nome),
    acondicionamentos: unicosPor(acond as CatalogoComercial['acondicionamentos'], (a) => a.nome),
    suportes: suportes.map((s) => ({
      id: s.id,
      descricao: s.descricao,
      tipoSuporte: s.tipoSuporte,
      gramaturas: gramaturasDe(s.gramaturas),
    })),
    prazos,
  }
}
