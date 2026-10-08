/**
 * Validação de unicidade de código de barras do SKU (Ocorrência 6 do
 * "3 - Relatório de Ocorrências e Ajustes", 01/10/2026).
 *
 * Problema reportado pelo QA: o sistema permitiu salvar dois produtos com o
 * MESMO EAN-13 (Leite Condensado reusando o EAN do K-Othrine), o que gera
 * entrada/separação/inventário no item errado — o EAN é a "identidade digital"
 * do produto.
 *
 * Padrão de mercado (GS1/SAP): um GTIN é atribuído UMA ÚNICA VEZ; configurações
 * de embalagem distintas exigem GTINs distintos. SAP impede a criação de
 * material com EAN duplicado (KBA 2665140); SAP B1 tem trava padrão. Logo, o
 * correto é BLOQUEAR o salvamento, não só avisar.
 *
 * Escopo: unicidade POR EMPRESA (multi-tenant — o mesmo EAN pode coexistir em
 * empresas diferentes do mesmo banco). Cobre os três códigos do SKU
 * (EAN-13 `codigoBarra`, EAN-14/DUN `codigoBarraDun`, display
 * `codigoBarraDisplay`) com colisão cruzada entre eles.
 */

import type { PrismaClient } from '@prisma/client'

type Db = PrismaClient | any

export interface CodigosBarraCandidatos {
  codigoBarra?: string | null
  codigoBarraDun?: string | null
  codigoBarraDisplay?: string | null
}

export interface ConflitoCodigoBarra {
  /** O código que colidiu. */
  codigo: string
  /** Em qual campo do SKU existente o código já estava gravado. */
  campoConflitante: 'codigoBarra' | 'codigoBarraDun' | 'codigoBarraDisplay'
  skuIdConflitante: string
  produtoId: string
  produtoCodigo: string
  produtoNome: string
}

/** Normaliza um código: trim; vazio/nulo vira null (não participa da checagem). */
function normalizar(v: string | null | undefined): string | null {
  if (v == null) return null
  const t = String(v).trim()
  return t === '' ? null : t
}

/**
 * Verifica se algum dos códigos candidatos já está em uso por outro SKU da
 * mesma empresa. Retorna o PRIMEIRO conflito encontrado ou `null` se nenhum.
 *
 * @param skuIdIgnorar  Em edição, o id do próprio SKU (não acusa conflito consigo).
 */
export async function verificarCodigoBarraDuplicado(
  db: Db,
  empresaId: string,
  candidatos: CodigosBarraCandidatos,
  skuIdIgnorar?: string | null
): Promise<ConflitoCodigoBarra | null> {
  const codigos = [
    normalizar(candidatos.codigoBarra),
    normalizar(candidatos.codigoBarraDun),
    normalizar(candidatos.codigoBarraDisplay),
  ].filter((c): c is string => c !== null)

  // Dedup — o mesmo código informado em dois campos do payload não precisa de
  // dupla consulta (a unicidade cruzada contra OUTROS SKUs é o que importa).
  const unicos = Array.from(new Set(codigos))
  if (unicos.length === 0) return null

  // SKUs da MESMA empresa cujo QUALQUER campo de código ∈ candidatos.
  // Sku.empresaId é nullable (legado) — cobrir também SKUs sem empresaId cujo
  // Produto pai pertence à empresa.
  const where: any = {
    AND: [
      {
        OR: [
          { codigoBarra: { in: unicos } },
          { codigoBarraDun: { in: unicos } },
          { codigoBarraDisplay: { in: unicos } },
        ],
      },
      {
        OR: [
          { empresaId },
          { empresaId: null, produto: { empresaId } },
        ],
      },
    ],
  }
  if (skuIdIgnorar) where.AND.push({ id: { not: skuIdIgnorar } })

  const candidatosExistentes = await db.sku.findMany({
    where,
    select: {
      id: true,
      produtoId: true,
      codigoBarra: true,
      codigoBarraDun: true,
      codigoBarraDisplay: true,
      produto: { select: { codigo: true, nome: true, empresaId: true } },
    },
    orderBy: { sequencia: 'asc' },
  })

  for (const codigo of unicos) {
    for (const sku of candidatosExistentes) {
      // Guard extra de isolamento: se o SKU veio por produto, confirmar empresa.
      if (sku.produto && sku.produto.empresaId !== empresaId) continue

      let campo: ConflitoCodigoBarra['campoConflitante'] | null = null
      if (sku.codigoBarra && sku.codigoBarra.trim() === codigo) campo = 'codigoBarra'
      else if (sku.codigoBarraDun && sku.codigoBarraDun.trim() === codigo) campo = 'codigoBarraDun'
      else if (sku.codigoBarraDisplay && sku.codigoBarraDisplay.trim() === codigo) campo = 'codigoBarraDisplay'

      if (campo) {
        return {
          codigo,
          campoConflitante: campo,
          skuIdConflitante: sku.id,
          produtoId: sku.produtoId,
          produtoCodigo: sku.produto?.codigo ?? '',
          produtoNome: sku.produto?.nome ?? '',
        }
      }
    }
  }

  return null
}

/** Monta a mensagem de erro amigável (HTTP 409) para o conflito. */
export function mensagemConflito(conflito: ConflitoCodigoBarra): string {
  const label =
    conflito.campoConflitante === 'codigoBarra'
      ? 'EAN-13'
      : conflito.campoConflitante === 'codigoBarraDun'
        ? 'EAN-14/DUN'
        : 'código de display'
  return `O código de barras "${conflito.codigo}" já está em uso (${label}) pelo produto ${conflito.produtoCodigo} - ${conflito.produtoNome}. Cada código deve ser único.`
}
