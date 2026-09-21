import { prisma } from '../../lib/prisma'

/**
 * Resolve os IDs das folhas (SUBCATEGORIA) descendentes de um nível da
 * Hierarquia Mercadológica, para filtrar produtos/saldos por qualquer nível
 * da árvore (Fase 2 — filtro por prefixo de codigoHierarquico).
 *
 * Retorna:
 *  - `null` se o `nivelId` não existir na empresa (o chamador deve tratar como
 *    filtro inválido / retornar vazio ou 400).
 *  - array de IDs de folhas (o próprio nível se já for folha, ou todos os
 *    descendentes SUBCATEGORIA). Pode ser vazio se o nível não tiver folhas.
 *
 * Isolamento explícito por `empresaId` (não confiar só no prismaScoped).
 */
export async function resolverFolhasDoNivel(
  db: any,
  empresaId: string | undefined,
  nivelId: string,
): Promise<string[] | null> {
  const nivel = await db.nivelMercadologico.findFirst({
    where: { id: nivelId, ...(empresaId ? { empresaId } : {}) },
    select: { codigoHierarquico: true },
  })
  if (!nivel) return null

  const folhas = await db.nivelMercadologico.findMany({
    where: {
      ...(empresaId ? { empresaId } : {}),
      tipo: 'SUBCATEGORIA',
      OR: [
        { codigoHierarquico: nivel.codigoHierarquico },
        { codigoHierarquico: { startsWith: `${nivel.codigoHierarquico}.` } },
      ],
    },
    select: { id: true },
  })
  return folhas.map((f: { id: string }) => f.id)
}

export { prisma }
