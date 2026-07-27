/**
 * Resolução do código interno de Produto para itens de XML de NF-e usados na
 * criação de `ItemNotaEntrada` (fluxos de Portaria/Agenda que criam a nota a
 * partir do XML da compra efetivada, fora do fluxo de Compras → Importar XML).
 *
 * Problema que este serviço resolve: `ItemNotaEntrada.codigoProduto` é uma
 * coluna de texto livre — toda a Conferência de Entrada (exigeLote,
 * shelfLifeMinimo, tolerância de quantidade) faz lookup de `Produto` por
 * `codigo: { in: [...codigosProduto] }` usando esse valor como chave. Se o
 * XML gravar o código do fornecedor (`cProd`) sem resolução, esse lookup não
 * encontra nenhum Produto e as regras de negócio configuradas silenciosamente
 * deixam de ser aplicadas (ver `conferencia-entrada.routes.ts`).
 *
 * Estratégia de resolução (mesma prioridade usada em
 * `depara-fornecedor/resolution.service.ts` e `produto/produto-import.service.ts`,
 * reaproveitada aqui para não duplicar a regra de negócio):
 * 1. `DeparaProdutoFornecedor` ativo (fornecedorId + cProd)
 * 2. `Produto.cEAN` — prioridade cEANTrib > cEAN
 * 3. `Sku.codigoBarra` — prioridade cEANTrib > cEAN, menor sequência
 * 4. Não resolvido — mantém o código do fornecedor como fallback (o item
 *    fica com `codigoProduto` fora do padrão interno; ver `codigoResolvido:
 *    false` no retorno para o chamador decidir como sinalizar isso)
 *
 * Este serviço NÃO cria Produto novo (diferente de `resolverOuCriarProduto`)
 * — nos fluxos que o utilizam, a nota é criada a partir de uma compra já
 * efetivada, e o produto deveria ter sido cadastrado/resolvido naquele
 * momento. Se não resolver aqui, é sinal de inconsistência a ser tratada
 * manualmente (item pendente de vínculo).
 */

import type { PrismaClient } from '@prisma/client'

type PrismaTransaction = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0] | PrismaClient

export interface ItemXmlParaResolucaoCodigo {
  codigoProduto: string
  cEAN?: string | null
  cEANTrib?: string | null
}

export interface CodigoResolvido {
  /** Código interno do Produto (`Produto.codigo`) quando resolvido; caso
   * contrário, o próprio `codigoProduto` do fornecedor (fallback). */
  codigoProduto: string
  /** true quando a resolução encontrou um Produto correspondente. */
  codigoResolvido: boolean
  produtoId: string | null
  resolvidoPor: 'DEPARA' | 'EAN' | 'EAN_TRIB' | 'NAO_RESOLVIDO'
}

/**
 * Resolve o `codigoProduto` de cada item de XML para o código interno do
 * Produto correspondente, usando a cadeia De-Para → EAN/GTIN → SKU.
 *
 * `fornecedorId` é opcional — se ausente, a etapa de De-Para é pulada (não
 * há como escopar por fornecedor) e a resolução segue direto para EAN/SKU.
 */
export async function resolverCodigosProdutoItensXml(
  tx: PrismaTransaction,
  empresaId: string,
  fornecedorId: string | null,
  itens: ItemXmlParaResolucaoCodigo[]
): Promise<Map<string, CodigoResolvido>> {
  const resultado = new Map<string, CodigoResolvido>()
  if (itens.length === 0) return resultado

  const codigosFornecedor = itens.map((i) => i.codigoProduto)

  // ── Passo 1: De-Para ativo (fornecedorId + cProd) ──────────────────────
  const deparas = fornecedorId
    ? await tx.deparaProdutoFornecedor.findMany({
        where: {
          empresaId,
          fornecedorId,
          codigoProdutoFornecedor: { in: codigosFornecedor },
          status: true,
        },
        include: { produto: { select: { id: true, codigo: true } } },
      })
    : []
  const deparaPorCodigo = new Map(deparas.map((d) => [d.codigoProdutoFornecedor, d]))

  // ── Passo 2/3: EAN/GTIN em Produto ou SKU da Empresa ────────────────────
  const eansParaBuscar = Array.from(
    new Set(
      itens.flatMap((i) => [i.cEANTrib, i.cEAN]).filter((v): v is string => !!v && v.trim() !== '')
    )
  )

  const produtosPorEan = eansParaBuscar.length > 0
    ? await tx.produto.findMany({
        where: { empresaId, cEAN: { in: eansParaBuscar } },
        select: { id: true, codigo: true, cEAN: true },
      })
    : []
  const produtoPorEanMap = new Map(produtosPorEan.map((p) => [p.cEAN as string, p]))

  let skuPorEanMap = new Map<string, { produtoId: string; codigoProduto: string }>()
  if (eansParaBuscar.length > 0) {
    const skusMatch = await tx.sku.findMany({
      where: { codigoBarra: { in: eansParaBuscar } },
      orderBy: { sequencia: 'asc' },
      select: { codigoBarra: true, produtoId: true },
    })
    if (skusMatch.length > 0) {
      const produtoIds = Array.from(new Set(skusMatch.map((s) => s.produtoId)))
      const produtosDosSkus = await tx.produto.findMany({
        where: { id: { in: produtoIds }, empresaId },
        select: { id: true, codigo: true },
      })
      const produtoCodigoPorId = new Map(produtosDosSkus.map((p) => [p.id, p.codigo]))
      for (const sku of skusMatch) {
        const codigo = produtoCodigoPorId.get(sku.produtoId)
        if (!codigo) continue // SKU de produto de outra empresa — ignorar
        const chave = sku.codigoBarra as string
        if (!skuPorEanMap.has(chave)) {
          skuPorEanMap.set(chave, { produtoId: sku.produtoId, codigoProduto: codigo })
        }
      }
    }
  }

  // ── Resolver cada item ────────────────────────────────────────────────
  for (const item of itens) {
    const depara = deparaPorCodigo.get(item.codigoProduto)
    if (depara) {
      resultado.set(item.codigoProduto, {
        codigoProduto: depara.produto.codigo,
        codigoResolvido: true,
        produtoId: depara.produto.id,
        resolvidoPor: 'DEPARA',
      })
      continue
    }

    if (item.cEANTrib) {
      const produtoMatch = produtoPorEanMap.get(item.cEANTrib)
      if (produtoMatch) {
        resultado.set(item.codigoProduto, {
          codigoProduto: produtoMatch.codigo,
          codigoResolvido: true,
          produtoId: produtoMatch.id,
          resolvidoPor: 'EAN_TRIB',
        })
        continue
      }
      const skuMatch = skuPorEanMap.get(item.cEANTrib)
      if (skuMatch) {
        resultado.set(item.codigoProduto, {
          codigoProduto: skuMatch.codigoProduto,
          codigoResolvido: true,
          produtoId: skuMatch.produtoId,
          resolvidoPor: 'EAN_TRIB',
        })
        continue
      }
    }

    if (item.cEAN) {
      const produtoMatch = produtoPorEanMap.get(item.cEAN)
      if (produtoMatch) {
        resultado.set(item.codigoProduto, {
          codigoProduto: produtoMatch.codigo,
          codigoResolvido: true,
          produtoId: produtoMatch.id,
          resolvidoPor: 'EAN',
        })
        continue
      }
      const skuMatch = skuPorEanMap.get(item.cEAN)
      if (skuMatch) {
        resultado.set(item.codigoProduto, {
          codigoProduto: skuMatch.codigoProduto,
          codigoResolvido: true,
          produtoId: skuMatch.produtoId,
          resolvidoPor: 'EAN',
        })
        continue
      }
    }

    // Não resolvido — mantém código do fornecedor como fallback
    resultado.set(item.codigoProduto, {
      codigoProduto: item.codigoProduto,
      codigoResolvido: false,
      produtoId: null,
      resolvidoPor: 'NAO_RESOLVIDO',
    })
  }

  return resultado
}
