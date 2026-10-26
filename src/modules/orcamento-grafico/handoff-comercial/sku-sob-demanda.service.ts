/**
 * SKU sob demanda (D1 — spec orcamento-grafico-handoff-comercial, R3).
 *
 * Na conversão do orçamento gráfico em pedido, cada item precisa de um
 * `Produto` (SKU) real para que o pedido possa ser faturado (NF-e) e produzido
 * (OP). Este módulo concentra:
 *   - funções PURAS (geração/validação de código, montagem do payload do SKU)
 *     — testáveis sem Prisma;
 *   - a resolução com persistência (`resolverProdutoDoItemGrafico`), que reusa
 *     um produto existente quando possível e, ao criar, respeita a SALVAGUARDA
 *     ANTI-COLISÃO (nunca cria/edita um Produto que já tenha OP/estrutura/saldo/
 *     pedido — padrão de docs/calcgraf-fase-produtos-plano.md).
 *
 * Isolamento multi-tenant: `empresaId` explícito em toda query.
 */
import { prisma } from '../../../lib/prisma'
import {
  PREFIXO_SKU,
  gerarCodigoSku,
  montarProdutoDoCalculo,
  type DadosParaSku,
} from './sku-sob-demanda.puro'

// Reexporta as funções/tipos puros (compat. com imports existentes).
export { gerarCodigoSku, montarProdutoDoCalculo }
export type { DadosParaSku, ProdutoSkuPayload } from './sku-sob-demanda.puro'

/**
 * Verifica (no banco) se um `Produto` pode ser recriado/editado com segurança —
 * ou seja, se NÃO tem nenhum vínculo que a salvaguarda anti-colisão proíbe
 * tocar: Ordem de Produção, Estrutura (BOM), saldo de estoque ou item de pedido.
 * Retorna `true` quando o produto é "livre" (seguro). `empresaId` explícito.
 */
export async function produtoLivreDeVinculos(empresaId: string, produtoId: string): Promise<boolean> {
  const [op, estrutura, saldo, itemPedido, estoque] = await Promise.all([
    prisma.ordemProducao.count({ where: { produtoId, empresaId } }),
    prisma.estruturaProduto.count({ where: { produtoId } }),
    prisma.saldoEndereco.count({ where: { produtoId, empresaId } }),
    prisma.itemPedidoVenda.count({ where: { produtoId } }),
    prisma.estoque.count({ where: { produtoId, empresaId } }),
  ])
  return op === 0 && estrutura === 0 && saldo === 0 && itemPedido === 0 && estoque === 0
}

/**
 * Resolve o `Produto` para um item gráfico na conversão:
 *  1. Se o item/orçamento já referencia um `produtoId` existente na empresa →
 *     reutiliza (repetição por produto cadastrado).
 *  2. Senão, cria um SKU novo (`GRAF-NNNN`) a partir dos dados do cálculo, com
 *     código único por empresa. NUNCA edita um produto existente (anti-colisão:
 *     a criação é sempre de um registro novo, nunca um update de produto com
 *     vínculos).
 *
 * @returns o `produtoId` resolvido/criado.
 */
export async function resolverProdutoDoItemGrafico(
  empresaId: string,
  entrada: { produtoId?: string | null; dados: DadosParaSku },
): Promise<string> {
  // 1. Reutiliza produto já vinculado (repetição) — valida pertencimento.
  if (entrada.produtoId) {
    const existente = await prisma.produto.findFirst({
      where: { id: entrada.produtoId, empresaId },
      select: { id: true },
    })
    if (existente) return existente.id
  }

  // 2. Cria SKU novo com código único por empresa.
  const codigosExistentes = await prisma.produto.findMany({
    where: { empresaId, codigo: { startsWith: PREFIXO_SKU } },
    select: { codigo: true },
  })
  const codigo = gerarCodigoSku(codigosExistentes.map((p) => p.codigo))
  const payload = montarProdutoDoCalculo(empresaId, codigo, entrada.dados)

  const criado = await prisma.produto.create({
    data: {
      empresaId: payload.empresaId,
      codigo: payload.codigo,
      nome: payload.nome,
      descricao: payload.descricao,
      unidade: payload.unidade,
      classificacaoPcp: payload.classificacaoPcp,
      ncm: payload.ncm,
      cfopEstadual: payload.cfopEstadual,
      cfopInterest: payload.cfopInterest,
      cst: payload.cst,
      csosn: payload.csosn,
      status: payload.status,
    },
    select: { id: true },
  })
  return criado.id
}
