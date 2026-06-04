import { prisma } from '../../lib/prisma'

/**
 * Serviço de integração PCP ↔ WMS.
 * Conecta os fluxos de produção com o armazém via chamadas internas.
 */

/**
 * Cria uma Nota de Entrada de tipo PRODUCAO quando produto acabado é concluído.
 * Isso dispara o fluxo WMS existente: Conferência → Endereçamento → Estoque.
 */
export async function criarEntradaProducao(params: {
  empresaId: string
  ordemProducaoId: string
  produtoId: string
  quantidade: number
  lote?: string
}) {
  const { empresaId, ordemProducaoId, produtoId, quantidade, lote } = params

  const produto = await prisma.produto.findFirst({
    where: { id: produtoId, empresaId },
    select: { codigo: true, nome: true, unidade: true },
  })

  if (!produto) return null

  // Busca próximo número de nota interna
  const ultimaNota = await prisma.notaEntrada.findFirst({
    where: { empresaId, tipo: 'PRODUCAO' },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  })
  const proximoNumero = (ultimaNota?.numero ?? 900000) + 1

  const notaEntrada = await prisma.notaEntrada.create({
    data: {
      numero: proximoNumero,
      serie: 'INT',
      fornecedor: 'PRODUÇÃO INTERNA',
      fornecedorDoc: empresaId.substring(0, 14),
      dataEmissao: new Date(),
      dataEntrada: new Date(),
      tipo: 'PRODUCAO',
      status: 'PENDENTE',
      empresaId,
      itens: {
        create: [{
          item: 1,
          descricao: `${produto.codigo} - ${produto.nome}`,
          codigoProduto: produto.codigo,
          unidade: produto.unidade,
          quantidade,
          lote: lote ?? null,
        }],
      },
    },
    include: { itens: true },
  })

  return notaEntrada
}

/**
 * Registra retorno de sobra de material ao estoque WMS.
 * Cria movimentação de entrada para o material devolvido.
 */
export async function registrarRetornoSobra(params: {
  empresaId: string
  ordemProducaoId: string
  produtoId: string
  quantidade: number
  usuarioId: string
  lote?: string
}) {
  const { empresaId, produtoId, quantidade, usuarioId } = params

  // Incrementa estoque agregado
  const estoque = await prisma.estoque.findUnique({
    where: { empresaId_produtoId: { empresaId, produtoId } },
  })

  if (estoque) {
    await prisma.estoque.update({
      where: { id: estoque.id },
      data: { quantidade: { increment: quantidade } },
    })
  } else {
    await prisma.estoque.create({
      data: { empresaId, produtoId, quantidade },
    })
  }

  return { produtoId, quantidadeRetornada: quantidade, status: 'estoque_atualizado' }
}

/**
 * Consulta estoque de materiais para verificação de disponibilidade PCP.
 */
export async function consultarEstoqueMateriais(empresaId: string, produtoIds: string[]) {
  const estoques = await prisma.estoque.findMany({
    where: { empresaId, produtoId: { in: produtoIds } },
  })

  const mapa: Record<string, { quantidade: number; reservado: number; disponivel: number }> = {}

  for (const produtoId of produtoIds) {
    const est = estoques.find((e) => e.produtoId === produtoId)
    const qtd = est ? Number(est.quantidade) : 0
    const res = est ? Number(est.reservado) : 0
    mapa[produtoId] = { quantidade: qtd, reservado: res, disponivel: qtd - res }
  }

  return mapa
}
