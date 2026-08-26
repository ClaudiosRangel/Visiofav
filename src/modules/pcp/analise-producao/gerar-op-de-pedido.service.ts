/**
 * Serviço de Geração de OP a partir de Pedido de Venda (Aba 1 da Análise).
 *
 * Regras de origem dos materiais/etapas:
 *  - Se o pedido veio de um ORÇAMENTO GRÁFICO (orcamentoOrigemId) → usa o
 *    resultadoCalculo do orçamento (reaproveita gerarOpFromOrcamento) — opção 3
 *  - Senão → exige BOM (EstruturaProduto ATIVA) e Roteiro (RoteiroProducao
 *    ATIVO) do produto; se faltar, bloqueia com aviso claro — opção 2
 *
 * Referência: docs/visao-analise-pedido-para-op.md
 */

import { prisma } from '../../../lib/prisma'
import {
  proximoNumeroOp,
  explodirBomParaOp,
  gerarEtapasOp,
} from '../../ordem-producao/ordem-producao.service'
import { gerarOpFromOrcamento } from '../../orcamento-grafico/orcamento-grafico-integracao.service'

export interface PedidoElegivel {
  id: string
  numero: number
  clienteNome: string | null
  valorTotal: number
  origemPedido: string
  origemOrcamentoGrafico: boolean
  criadoEm: string
  itens: Array<{
    id: string
    produtoId: string
    produtoNome: string
    quantidade: number
    unidade: string
  }>
}

export interface ResultadoGerarOp {
  ordemProducaoId: string
  numero: number
  origem: 'ORCAMENTO_GRAFICO' | 'BOM_ROTEIRO'
  materiaisGerados: number
  etapasGeradas: number
}

/**
 * Lista pedidos de venda APROVADOS/CONFIRMADOS que ainda NÃO possuem OP ativa.
 * Estes são os candidatos da Aba 1 (Gerar OP).
 */
export async function listarPedidosElegiveis(empresaId: string): Promise<PedidoElegivel[]> {
  // Status de pedido considerados "aprovados/prontos para produzir"
  const statusAprovados = ['CONFIRMADO', 'APROVADO', 'EM_PRODUCAO', 'FATURADO']

  const pedidos = await prisma.pedidoVenda.findMany({
    where: {
      empresaId,
      status: { in: statusAprovados },
    },
    select: {
      id: true,
      numero: true,
      valorTotal: true,
      origemPedido: true,
      orcamentoOrigemId: true,
      criadoEm: true,
      cliente: { select: { razaoSocial: true, nomeFantasia: true } },
      itens: {
        select: {
          id: true,
          produtoId: true,
          quantidade: true,
          unidade: true,
          produto: { select: { codigo: true, nome: true } },
        },
      },
    },
    orderBy: { criadoEm: 'desc' },
  })

  // Descobrir quais pedidos já têm OP ativa (não CANCELADA)
  const pedidoIds = pedidos.map((p) => p.id)
  const opsExistentes = await prisma.ordemProducao.findMany({
    where: {
      empresaId,
      pedidoVendaId: { in: pedidoIds },
      status: { not: 'CANCELADA' },
    },
    select: { pedidoVendaId: true },
  })
  const pedidosComOp = new Set(opsExistentes.map((o) => o.pedidoVendaId))

  return pedidos
    .filter((p) => !pedidosComOp.has(p.id))
    .map((p) => ({
      id: p.id,
      numero: p.numero,
      clienteNome: p.cliente?.nomeFantasia || p.cliente?.razaoSocial || null,
      valorTotal: Number(p.valorTotal),
      origemPedido: p.origemPedido,
      origemOrcamentoGrafico: !!p.orcamentoOrigemId,
      criadoEm: p.criadoEm.toISOString(),
      itens: p.itens.map((i) => ({
        id: i.id,
        produtoId: i.produtoId,
        produtoNome: i.produto ? `${i.produto.codigo} - ${i.produto.nome}` : 'Produto',
        quantidade: Number(i.quantidade),
        unidade: i.unidade,
      })),
    }))
}

/**
 * Gera OP(s) a partir de um pedido de venda.
 *
 * @param pedidoVendaId ID do pedido
 * @param empresaId empresa
 * @param usuarioId usuário
 */
export async function gerarOpDePedido(
  pedidoVendaId: string,
  empresaId: string,
  usuarioId: string,
): Promise<{ opsGeradas: ResultadoGerarOp[]; avisos: string[] }> {
  const pedido = await prisma.pedidoVenda.findFirst({
    where: { id: pedidoVendaId, empresaId },
    select: {
      id: true,
      numero: true,
      clienteId: true,
      orcamentoOrigemId: true,
      itens: {
        select: { id: true, produtoId: true, quantidade: true, unidade: true },
      },
    },
  })

  if (!pedido) {
    throw { statusCode: 404, message: 'Pedido de venda não encontrado' }
  }

  // Bloqueio de duplicidade: pedido já tem OP ativa?
  const opExistente = await prisma.ordemProducao.findFirst({
    where: { empresaId, pedidoVendaId, status: { not: 'CANCELADA' } },
    select: { id: true, numero: true },
  })
  if (opExistente) {
    throw {
      statusCode: 400,
      message: `Este pedido já possui a OP #${opExistente.numero}. Não é possível gerar outra.`,
      code: 'OP_JA_EXISTE',
    }
  }

  const opsGeradas: ResultadoGerarOp[] = []
  const avisos: string[] = []

  // ─── OPÇÃO 3: pedido veio de Orçamento Gráfico ────────────────────────
  if (pedido.orcamentoOrigemId) {
    const r = await gerarOpFromOrcamento(pedido.orcamentoOrigemId, pedidoVendaId, empresaId, usuarioId)
    if (r) {
      opsGeradas.push({
        ordemProducaoId: r.ordemProducaoId,
        numero: r.numero,
        origem: 'ORCAMENTO_GRAFICO',
        materiaisGerados: 0, // orçamento gráfico gera etapas, não BOM formal
        etapasGeradas: r.etapasGeradas,
      })
      if (r.etapasGeradas === 0) {
        avisos.push('OP gerada do orçamento gráfico, mas sem etapas (verifique o cálculo do orçamento).')
      }
      return { opsGeradas, avisos }
    }
    avisos.push('Não foi possível gerar OP a partir do orçamento gráfico (verifique se ainda não existe).')
    return { opsGeradas, avisos }
  }

  // ─── OPÇÃO 2: pedido normal — exige BOM + Roteiro por item ────────────
  for (const item of pedido.itens) {
    // Verificar BOM ativa
    const estrutura = await prisma.estruturaProduto.findFirst({
      where: { empresaId, produtoId: item.produtoId, status: 'ATIVA' },
      select: { id: true },
    })
    if (!estrutura) {
      avisos.push(`Item ${item.produtoId.slice(0, 8)}: produto sem Estrutura (BOM) ATIVA — OP não gerada.`)
      continue
    }

    // Verificar Roteiro ativo
    const roteiro = await prisma.roteiroProducao.findFirst({
      where: { empresaId, produtoId: item.produtoId, status: 'ATIVO' },
      select: { id: true },
    })
    if (!roteiro) {
      avisos.push(`Item ${item.produtoId.slice(0, 8)}: produto sem Roteiro ATIVO — OP não gerada.`)
      continue
    }

    // Criar OP
    const numero = await proximoNumeroOp(empresaId)
    const op = await prisma.ordemProducao.create({
      data: {
        empresaId,
        numero,
        produtoId: item.produtoId,
        estruturaProdutoId: estrutura.id,
        quantidade: Number(item.quantidade),
        unidadeMedida: item.unidade,
        status: 'PLANEJADA',
        prioridade: 'NORMAL',
        pedidoVendaId,
        clienteId: pedido.clienteId,
        origemImportacao: 'MANUAL',
        criadoPorId: usuarioId,
      },
      select: { id: true, numero: true },
    })

    // Explodir BOM (materiais) e gerar etapas do roteiro
    const bom = await explodirBomParaOp(op.id, estrutura.id, Number(item.quantidade), empresaId)
    const etapas = await gerarEtapasOp(op.id, item.produtoId, Number(item.quantidade), empresaId)

    await prisma.logOrdemProducao.create({
      data: {
        ordemProducaoId: op.id,
        statusAnterior: '',
        statusNovo: 'PLANEJADA',
        usuarioId,
        observacao: `Gerada a partir do pedido de venda #${pedido.numero} (Análise de Produção)`,
      },
    })

    opsGeradas.push({
      ordemProducaoId: op.id,
      numero: op.numero,
      origem: 'BOM_ROTEIRO',
      materiaisGerados: bom.total,
      etapasGeradas: etapas.total,
    })
  }

  if (opsGeradas.length === 0 && avisos.length > 0) {
    throw {
      statusCode: 400,
      message: 'Nenhuma OP pôde ser gerada. ' + avisos.join(' '),
      code: 'SEM_BOM_ROTEIRO',
    }
  }

  return { opsGeradas, avisos }
}
