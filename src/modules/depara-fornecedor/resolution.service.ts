/**
 * Serviço de resolução De-Para — lógica pura (sem I/O).
 * Recebe dados pré-buscados e retorna resultado de resolução.
 */

export interface XmlItem {
  codigoProdutoFornecedor: string  // cProd
  descricao: string                // xProd
  unidade: string                  // uCom
  quantidade: number               // qCom
  valorUnitario: number            // vUnCom
  valorTotal: number               // vProd
  ncm: string
  cEAN: string | null
  cEANTrib: string | null
  uTrib: string | null
  qTrib: number | null
}

export interface DeparaRecord {
  id: string
  fornecedorId: string
  codigoProdutoFornecedor: string
  produtoId: string
  skuId: string | null
  fatorConversao: number
  unidadeFornecedor: string
  status: boolean
}

export interface ProdutoRecord {
  id: string
  codigo: string
  nome: string
  unidade: string
  cEAN: string | null
}

export interface SkuRecord {
  id: string
  produtoId: string
  sequencia: number
  codigoBarra: string | null
  unidade: string
}

export interface ResolvedItem {
  xmlItem: XmlItem
  produtoId: string
  produtoNome: string
  skuId: string | null
  fatorConversao: number
  quantidadeOriginal: number
  quantidadeConvertida: number
  unidadeInterna: string
  resolvidoPor: 'DEPARA' | 'EAN_TRIB' | 'EAN'
}

export interface PendingItem {
  xmlItem: XmlItem
  sugestoes: Array<{ produtoId: string; nome: string; cEAN: string | null }>
}

export interface ResolutionResult {
  resolvidos: ResolvedItem[]
  pendentes: PendingItem[]
}

/**
 * Resolve itens do XML usando cadeia de prioridade:
 * 1. De-Para ativo (fornecedorId + cProd)
 * 2. cEANTrib match em Produto.cEAN ou SKU.codigoBarra
 * 3. cEAN match em Produto.cEAN ou SKU.codigoBarra
 * 4. Pendente
 */
export function resolveItems(
  items: XmlItem[],
  deparas: DeparaRecord[],
  produtos: ProdutoRecord[],
  skus: SkuRecord[]
): ResolutionResult {
  const resolvidos: ResolvedItem[] = []
  const pendentes: PendingItem[] = []

  for (const item of items) {
    // 1. Buscar De-Para ativo
    const depara = deparas.find(
      d => d.status && d.codigoProdutoFornecedor === item.codigoProdutoFornecedor
    )

    if (depara) {
      const produto = produtos.find(p => p.id === depara.produtoId)
      const sku = depara.skuId ? skus.find(s => s.id === depara.skuId) : null
      const unidadeInterna = sku?.unidade || produto?.unidade || item.unidade
      const fator = Number(depara.fatorConversao)

      resolvidos.push({
        xmlItem: item,
        produtoId: depara.produtoId,
        produtoNome: produto?.nome || '',
        skuId: depara.skuId,
        fatorConversao: fator,
        quantidadeOriginal: item.quantidade,
        quantidadeConvertida: item.quantidade * fator,
        unidadeInterna,
        resolvidoPor: 'DEPARA',
      })
      continue
    }

    // 2. Buscar por cEANTrib
    if (item.cEANTrib) {
      const match = findByEan(item.cEANTrib, produtos, skus)
      if (match) {
        resolvidos.push({
          xmlItem: item,
          produtoId: match.produtoId,
          produtoNome: match.produtoNome,
          skuId: match.skuId,
          fatorConversao: 1,
          quantidadeOriginal: item.quantidade,
          quantidadeConvertida: item.quantidade,
          unidadeInterna: match.unidadeInterna,
          resolvidoPor: 'EAN_TRIB',
        })
        continue
      }
    }

    // 3. Buscar por cEAN
    if (item.cEAN) {
      const match = findByEan(item.cEAN, produtos, skus)
      if (match) {
        resolvidos.push({
          xmlItem: item,
          produtoId: match.produtoId,
          produtoNome: match.produtoNome,
          skuId: match.skuId,
          fatorConversao: 1,
          quantidadeOriginal: item.quantidade,
          quantidadeConvertida: item.quantidade,
          unidadeInterna: match.unidadeInterna,
          resolvidoPor: 'EAN',
        })
        continue
      }
    }

    // 4. Pendente — gerar sugestões baseadas em nome parcial
    pendentes.push({
      xmlItem: item,
      sugestoes: [],
    })
  }

  return { resolvidos, pendentes }
}

interface EanMatch {
  produtoId: string
  produtoNome: string
  skuId: string | null
  unidadeInterna: string
}

function findByEan(
  ean: string,
  produtos: ProdutoRecord[],
  skus: SkuRecord[]
): EanMatch | null {
  // Buscar em Produto.cEAN
  const produtoMatch = produtos.find(p => p.cEAN === ean)
  if (produtoMatch) {
    return {
      produtoId: produtoMatch.id,
      produtoNome: produtoMatch.nome,
      skuId: null,
      unidadeInterna: produtoMatch.unidade,
    }
  }

  // Buscar em SKU.codigoBarra — selecionar o de menor sequência
  const skuMatches = skus
    .filter(s => s.codigoBarra === ean)
    .sort((a, b) => a.sequencia - b.sequencia)

  if (skuMatches.length > 0) {
    const sku = skuMatches[0]
    const produto = produtos.find(p => p.id === sku.produtoId)
    return {
      produtoId: sku.produtoId,
      produtoNome: produto?.nome || '',
      skuId: sku.id,
      unidadeInterna: sku.unidade,
    }
  }

  return null
}
