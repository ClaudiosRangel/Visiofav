/**
 * Serviço de Sugestão de Compra (Ponto 4 da Análise de Produção).
 *
 * Gera sugestões de compra (requisições) para os materiais em falta de uma OP.
 * A sugestão é a "requisição" que antecede o Pedido de Compra — o comprador
 * revisa, agrupa por fornecedor e converte em pedido.
 *
 * Fornecedor sugerido: buscado via DeparaProdutoFornecedor (vínculo produto→
 * fornecedor). Lead time default aplicado (configurável no futuro).
 *
 * Referência: docs/visao-analise-pedido-para-op.md (Ponto 5)
 */

import { prisma } from '../../../lib/prisma'
import { verificarEstoqueOp } from './verificacao-estoque.service'

const LEAD_TIME_DEFAULT_DIAS = 5 // dias — usado quando não há cadastro específico

export interface ResultadoSugestaoCompra {
  ordemProducaoId: string
  sugestoesCriadas: number
  sugestoesIgnoradas: number
  detalhes: Array<{
    produtoId: string | null
    descricao: string
    quantidade: number
    fornecedorNome: string | null
    gerada: boolean
    motivo?: string
  }>
}

/**
 * Gera sugestões de compra para os materiais em falta de uma OP.
 *
 * Usa a verificação de estoque (Ponto 1) para saber o que falta.
 * Idempotente: não duplica sugestões PENDENTES para o mesmo produto/OP.
 *
 * @param opId ID da ordem de produção
 * @param empresaId empresa
 */
export async function gerarSugestoesCompra(
  opId: string,
  empresaId: string,
): Promise<ResultadoSugestaoCompra> {
  // Reaproveita a verificação de estoque para obter os materiais em falta
  const verificacao = await verificarEstoqueOp(opId, empresaId)

  const detalhes: ResultadoSugestaoCompra['detalhes'] = []
  let criadas = 0
  let ignoradas = 0

  for (const material of verificacao.materiais) {
    // Só gera sugestão para materiais com falta
    if (material.falta <= 0) {
      continue
    }

    // Material sem cadastro — não dá para gerar sugestão vinculada a produto
    if (!material.produtoComponenteId) {
      ignoradas++
      detalhes.push({
        produtoId: null,
        descricao: material.descricao,
        quantidade: material.falta,
        fornecedorNome: null,
        gerada: false,
        motivo: 'Material sem cadastro de produto',
      })
      continue
    }

    // Idempotência: já existe sugestão PENDENTE para este produto+OP?
    const existente = await prisma.sugestaoCompra.findFirst({
      where: {
        empresaId,
        ordemProducaoId: opId,
        produtoId: material.produtoComponenteId,
        status: 'PENDENTE',
      },
      select: { id: true },
    })
    if (existente) {
      ignoradas++
      detalhes.push({
        produtoId: material.produtoComponenteId,
        descricao: material.descricao,
        quantidade: material.falta,
        fornecedorNome: null,
        gerada: false,
        motivo: 'Já existe sugestão pendente para este material',
      })
      continue
    }

    // Buscar fornecedor sugerido via De/Para produto→fornecedor
    const depara = await prisma.deparaProdutoFornecedor.findFirst({
      where: { empresaId, produtoId: material.produtoComponenteId, status: true },
      select: { fornecedorId: true, fornecedor: { select: { razaoSocial: true, nomeFantasia: true } } },
    })
    const fornecedorId = depara?.fornecedorId ?? null
    const fornecedorNome = depara?.fornecedor?.nomeFantasia || depara?.fornecedor?.razaoSocial || null

    // Datas: necessidade = hoje + lead time (aproximação; Ponto 3 refina)
    const hoje = new Date()
    const dataNecessidade = new Date(hoje)
    dataNecessidade.setDate(dataNecessidade.getDate() + LEAD_TIME_DEFAULT_DIAS)

    await prisma.sugestaoCompra.create({
      data: {
        empresaId,
        ordemProducaoId: opId,
        produtoId: material.produtoComponenteId,
        descricao: material.descricao,
        quantidade: material.falta,
        unidadeMedida: material.unidade,
        fornecedorId,
        fornecedorNome,
        dataNecessidade,
        dataPedidoSugerida: hoje,
        leadTimeDias: LEAD_TIME_DEFAULT_DIAS,
        status: 'PENDENTE',
        observacao: `Gerada pela Análise de Produção da OP #${verificacao.numero}`,
      },
    })
    criadas++
    detalhes.push({
      produtoId: material.produtoComponenteId,
      descricao: material.descricao,
      quantidade: material.falta,
      fornecedorNome,
      gerada: true,
    })
  }

  return {
    ordemProducaoId: opId,
    sugestoesCriadas: criadas,
    sugestoesIgnoradas: ignoradas,
    detalhes,
  }
}

/**
 * Lista sugestões de compra de uma empresa (opcionalmente por status/OP/
 * fornecedor/busca por produto). Enriquece com código/nome do produto e o
 * número da OP de origem para exibição na tela de Requisições de Compra.
 */
export async function listarSugestoesCompra(
  empresaId: string,
  filtros?: { status?: string; ordemProducaoId?: string; fornecedorId?: string; busca?: string },
) {
  const where: Record<string, unknown> = { empresaId }
  if (filtros?.status) where.status = filtros.status
  if (filtros?.ordemProducaoId) where.ordemProducaoId = filtros.ordemProducaoId
  if (filtros?.fornecedorId) where.fornecedorId = filtros.fornecedorId
  if (filtros?.busca) {
    where.descricao = { contains: filtros.busca, mode: 'insensitive' }
  }

  const sugestoes = await prisma.sugestaoCompra.findMany({
    where,
    orderBy: { criadoEm: 'desc' },
    include: {
      ordemProducao: { select: { numero: true, referenciaExterna: true } },
    },
  })

  // Enriquecer com código/nome do produto (produtoId → Produto)
  const produtoIds = [...new Set(sugestoes.map((s) => s.produtoId))]
  const produtos = await prisma.produto.findMany({
    where: { id: { in: produtoIds }, empresaId },
    select: { id: true, codigo: true, nome: true },
  })
  const produtoMap = new Map(produtos.map((p) => [p.id, p]))

  return sugestoes.map((s) => ({
    ...s,
    produtoCodigo: produtoMap.get(s.produtoId)?.codigo ?? null,
    produtoNome: produtoMap.get(s.produtoId)?.nome ?? null,
    opNumero: s.ordemProducao?.referenciaExterna || s.ordemProducao?.numero || null,
  }))
}
