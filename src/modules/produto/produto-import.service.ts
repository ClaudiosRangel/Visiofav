/**
 * Validação de GTIN/EAN para enriquecimento de SKU via catálogo externo.
 *
 * Aceita apenas strings numéricas com 8, 12, 13 ou 14 dígitos.
 * Rejeita valores vazios/ausentes e o placeholder "SEM GTIN".
 */
export function gtinValido(valor: string | null | undefined): valor is string {
  if (!valor) return false
  const v = valor.trim().toUpperCase()
  if (v === '' || v === 'SEM GTIN') return false
  return /^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(v)
}

// ─────────────────────────────────────────────────────────────────────────
// resolverOuCriarProduto — orquestração (Requirement 2)
// ─────────────────────────────────────────────────────────────────────────

import type { PrismaClient } from '@prisma/client'
import { gerarProximoCodigo } from './codigo-sequencial.service'
import { buscarCatalogoPorGtin } from './catalogo-externo.service'

type PrismaTransaction = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

/**
 * Subconjunto dos campos do item retornado por `parseNfeXml` (ver
 * `nota-entrada/nfe-xml-parser.ts`) necessários para resolver ou criar o
 * Produto/SKU correspondente. `codigoProduto` corresponde a `cProd` do XML.
 */
export interface ItemXmlParaResolucao {
  codigoProduto: string
  descricao: string
  unidade: string
  ncm: string
  cEAN: string | null
  cEANTrib: string | null
}

export interface ResolverOuCriarProdutoInput {
  item: ItemXmlParaResolucao
  fornecedorId: string
  empresaId: string
  usaWms: boolean
}

export interface ResolverOuCriarProdutoResult {
  produtoId: string
  skuId: string
  criado: boolean
}

/** Prioridade cEANTrib > cEAN, igual à usada em `depara-fornecedor/resolution.service.ts`. */
function extrairEansParaMatch(item: ItemXmlParaResolucao): string[] {
  return [item.cEANTrib, item.cEAN].filter((v): v is string => !!v && v.trim() !== '')
}

/** Retorna o primeiro GTIN/EAN do item (prioridade cEANTrib > cEAN) que seja válido, ou `null`. */
function extrairGtinValidoDoItem(item: ItemXmlParaResolucao): string | null {
  if (item.cEANTrib && gtinValido(item.cEANTrib)) return item.cEANTrib
  if (item.cEAN && gtinValido(item.cEAN)) return item.cEAN
  return null
}

/**
 * Garante um `skuId` para um Produto já existente: reutiliza `skuIdPreferido`
 * (ex.: `DeparaProdutoFornecedor.skuId`) quando presente; caso contrário busca
 * o SKU de menor `sequencia` do Produto; se nenhum existir (situação de dados
 * legados sem SKU), cria um SKU vazio como fallback.
 */
async function garantirSkuId(
  tx: PrismaTransaction,
  produtoId: string,
  skuIdPreferido: string | null | undefined,
  empresaId: string,
  unidadeFallback?: string
): Promise<string> {
  if (skuIdPreferido) return skuIdPreferido

  const skuExistente = await tx.sku.findFirst({
    where: { produtoId },
    orderBy: { sequencia: 'asc' },
  })
  if (skuExistente) return skuExistente.id

  const unidade =
    unidadeFallback ??
    (await tx.produto.findUniqueOrThrow({ where: { id: produtoId }, select: { unidade: true } })).unidade

  const skuCriado = await tx.sku.create({
    data: { produtoId, empresaId, sequencia: 1, unidade },
  })
  return skuCriado.id
}

/** Cria o SKU padrão vazio (Requirements 2.6, 2.7, 2.9): apenas `sequencia = 1` e `unidade` copiada do Produto. */
async function criarSkuVazio(tx: PrismaTransaction, produtoId: string, empresaId: string, unidade: string) {
  return tx.sku.create({
    data: { produtoId, empresaId, sequencia: 1, unidade },
  })
}

/**
 * Resolve o Produto/SKU correspondente a um item de XML de NFe de compra ou,
 * se não houver resolução possível, cria um novo Produto (código sequencial)
 * e decide o enriquecimento do SKU.
 *
 * Fluxo (ver design.md, "Requirement 2 — Código sequencial + enriquecimento
 * SKU", diagrama "Fluxo 2"):
 * 1. Tenta resolução via De-Para ativo (fornecedorId + cProd) e, na
 *    ausência de De-Para, via GTIN/EAN (`cEAN`/`cEANTrib`) já cadastrado em
 *    Produto ou SKU da Empresa (Requirement 2.8) — quando resolvido, retorna
 *    sem gerar código sequencial nem consultar o catálogo externo.
 * 2. Caso não resolvido, gera o próximo código sequencial (`gerarProximoCodigo`)
 *    e cria o Produto. `CodigoSequencialEsgotadoError` propaga sem ser
 *    capturado aqui — o chamador trata por item (Requirement 2.10).
 * 3. Decide o SKU do Produto recém-criado: `usaWms=false` → SKU vazio sem
 *    consultar catálogo; `usaWms=true` com GTIN válido → consulta
 *    `buscarCatalogoPorGtin` (sucesso → SKU enriquecido; falha/timeout →
 *    SKU vazio + `motivoFalhaEnriquecimentoSku`); `usaWms=true` com GTIN
 *    inválido → SKU vazio sem consultar.
 * 4. Registra o `cProd` do fornecedor como De-Para (Requirement 2.3),
 *    preservando a rastreabilidade da origem do código sem usá-lo como
 *    código interno do Produto.
 */
export async function resolverOuCriarProduto(
  tx: PrismaTransaction,
  input: ResolverOuCriarProdutoInput
): Promise<ResolverOuCriarProdutoResult> {
  const { item, fornecedorId, empresaId, usaWms } = input

  // ── Passo 1a — De-Para ativo (fornecedorId + cProd) ──────────────────────
  const depara = await tx.deparaProdutoFornecedor.findFirst({
    where: {
      empresaId,
      fornecedorId,
      codigoProdutoFornecedor: item.codigoProduto,
      status: true,
    },
  })

  if (depara) {
    const skuId = await garantirSkuId(tx, depara.produtoId, depara.skuId, empresaId)
    return { produtoId: depara.produtoId, skuId, criado: false }
  }

  // ── Passo 1b — GTIN/EAN já cadastrado em Produto ou SKU da Empresa ──────
  // `Sku` não possui relação Prisma para `Produto` (apenas `produtoId` solto),
  // então o match por SKU é escopado à Empresa filtrando por `produtoId` dos
  // Produtos já carregados dessa Empresa — mesmo padrão usado em
  // `nota-entrada/importar-xml-depara.routes.ts`.
  const eansParaMatch = extrairEansParaMatch(item)
  if (eansParaMatch.length > 0) {
    const produtoPorEan = await tx.produto.findFirst({
      where: { empresaId, cEAN: { in: eansParaMatch } },
    })
    if (produtoPorEan) {
      const skuId = await garantirSkuId(tx, produtoPorEan.id, null, empresaId, produtoPorEan.unidade)
      return { produtoId: produtoPorEan.id, skuId, criado: false }
    }

    const produtosDaEmpresa = await tx.produto.findMany({
      where: { empresaId },
      select: { id: true },
    })
    const produtoIdsDaEmpresa = produtosDaEmpresa.map((p) => p.id)

    const skuPorEan = await tx.sku.findFirst({
      where: { codigoBarra: { in: eansParaMatch }, produtoId: { in: produtoIdsDaEmpresa } },
      orderBy: { sequencia: 'asc' },
    })
    if (skuPorEan) {
      return { produtoId: skuPorEan.produtoId, skuId: skuPorEan.id, criado: false }
    }
  }

  // ── Passo 2 — não resolvido: gerar código sequencial e criar o Produto ──
  // CodigoSequencialEsgotadoError propaga sem ser capturado (tratado pelo chamador, por item).
  const codigo = await gerarProximoCodigo(tx, empresaId)
  const eanParaProduto = eansParaMatch[0] ?? null
  const unidade = item.unidade || 'UN'

  const produto = await tx.produto.create({
    data: {
      empresaId,
      codigo,
      nome: item.descricao || `Produto ${item.codigoProduto}`,
      descricao: item.descricao || null,
      unidade,
      ncm: item.ncm || null,
      cEAN: eanParaProduto,
    },
  })

  // ── Passo 3 — decidir o SKU do produto recém-criado ──────────────────────
  let sku: { id: string }
  let motivoFalhaEnriquecimentoSku: string | null = null

  if (!usaWms) {
    sku = await criarSkuVazio(tx, produto.id, empresaId, unidade)
  } else {
    const gtinValidoDoItem = extrairGtinValidoDoItem(item)
    if (!gtinValidoDoItem) {
      sku = await criarSkuVazio(tx, produto.id, empresaId, unidade)
    } else {
      const catalogo = await buscarCatalogoPorGtin(gtinValidoDoItem)
      if (catalogo) {
        sku = await tx.sku.create({
          data: {
            produtoId: produto.id,
            empresaId,
            sequencia: 1,
            descricao: catalogo.descricao,
            unidade: catalogo.unidade || unidade,
            codigoBarra: catalogo.codigoBarra,
            largura: catalogo.largura ?? null,
            altura: catalogo.altura ?? null,
            comprimento: catalogo.comprimento ?? null,
            pesoLiquido: catalogo.pesoLiquido ?? null,
            pesoBruto: catalogo.pesoBruto ?? null,
          },
        })
      } else {
        motivoFalhaEnriquecimentoSku = `Consulta ao catálogo externo não retornou dados para o GTIN/EAN ${gtinValidoDoItem}`
        sku = await criarSkuVazio(tx, produto.id, empresaId, unidade)
      }
    }
  }

  if (motivoFalhaEnriquecimentoSku) {
    await tx.produto.update({
      where: { id: produto.id },
      data: { motivoFalhaEnriquecimentoSku },
    })
  }

  // ── Passo 4 — registrar o cProd do fornecedor como De-Para (Requirement 2.3) ──
  await tx.deparaProdutoFornecedor.create({
    data: {
      empresaId,
      fornecedorId,
      codigoProdutoFornecedor: item.codigoProduto,
      descricaoFornecedor: item.descricao || null,
      produtoId: produto.id,
      skuId: sku.id,
      unidadeFornecedor: unidade,
      fatorConversao: 1,
      cEAN: item.cEAN || null,
      cEANTrib: item.cEANTrib || null,
      status: true,
    },
  })

  return { produtoId: produto.id, skuId: sku.id, criado: true }
}
