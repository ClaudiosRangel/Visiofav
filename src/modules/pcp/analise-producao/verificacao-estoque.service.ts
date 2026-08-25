/**
 * Serviço de Verificação de Estoque para PCP (Ponto 1 da Análise de Produção).
 *
 * Calcula a disponibilidade de:
 *  - Produto Acabado (PA): quanto já existe em estoque vs quanto precisa produzir
 *  - Matéria-Prima / Materiais (MP): quanto há disponível vs o necessário pela BOM
 *
 * Fontes de estoque (em ordem de prioridade):
 *  1. WMS — soma de SaldoEndereco não-bloqueado (físico real endereçado)
 *  2. ERP — model Estoque (quantidade - reservado) como fallback/complemento
 *
 * A disponibilidade considera reservas para não prometer o mesmo saldo duas vezes.
 *
 * Referência conceitual: SAP ATP (Available-to-Promise) — ver
 * docs/visao-analise-pedido-para-op.md
 */

import { prisma } from '../../../lib/prisma'
import { somarReservasAtivas } from './reserva-producao.service'

// ─── Tipos ──────────────────────────────────────────────────────────────────

export type SituacaoEstoque = 'SUFICIENTE' | 'PARCIAL' | 'SEM_ESTOQUE'

export interface DisponibilidadeProdutoAcabado {
  produtoId: string | null
  descricao: string
  unidade: string
  quantidadePedido: number
  estoqueDisponivel: number
  aProduzir: number
  atendeDoEstoque: boolean
}

export interface DisponibilidadeMaterial {
  produtoComponenteId: string | null
  descricao: string
  tipoMaterial: string | null
  unidade: string
  quantidadeNecessaria: number
  estoqueFisico: number
  estoqueReservado: number
  saldoDisponivel: number
  falta: number
  situacao: SituacaoEstoque
  origemEstoque: 'WMS' | 'ERP' | 'NENHUM'
}

export interface ResultadoVerificacaoEstoque {
  ordemProducaoId: string
  numero: number
  produtoAcabado: DisponibilidadeProdutoAcabado | null
  materiais: DisponibilidadeMaterial[]
  resumo: {
    totalMateriais: number
    materiaisSuficientes: number
    materiaisComFalta: number
    todosDisponiveis: boolean
  }
}

// ─── Helpers de saldo ────────────────────────────────────────────────────────

/**
 * Calcula o saldo físico e reservado de um produto, combinando WMS (SaldoEndereco)
 * e ERP (Estoque). Prioriza o WMS quando há saldo endereçado; senão usa o ERP.
 */
async function calcularSaldo(
  empresaId: string,
  produtoId: string,
  opIdAtual?: string,
): Promise<{ fisico: number; reservado: number; origem: 'WMS' | 'ERP' | 'NENHUM' }> {
  // 1. Saldo WMS: soma de SaldoEndereco não bloqueado
  const saldosWms = await prisma.saldoEndereco.findMany({
    where: { produtoId, bloqueado: false, OR: [{ empresaId }, { empresaId: null }] },
    select: { quantidade: true },
  })
  const fisicoWms = saldosWms.reduce((acc, s) => acc + Number(s.quantidade), 0)

  // 2. Saldo ERP: model Estoque agregado
  const estoqueErp = await prisma.estoque.findUnique({
    where: { empresaId_produtoId: { empresaId, produtoId } },
    select: { quantidade: true, reservado: true },
  })
  const fisicoErp = estoqueErp ? Number(estoqueErp.quantidade) : 0
  const reservadoErp = estoqueErp ? Number(estoqueErp.reservado) : 0

  // 3. Reservas de produção ATIVAS de OUTRAS OPs (empenho PCP)
  const reservadoProducao = await somarReservasAtivas(empresaId, produtoId, opIdAtual)

  // Reservado total = reservas de vendas (ERP) + reservas de produção (PCP)
  const reservadoTotal = reservadoErp + reservadoProducao

  // Preferir WMS quando há saldo endereçado; senão usar ERP
  if (fisicoWms > 0) {
    return { fisico: fisicoWms, reservado: reservadoTotal, origem: 'WMS' }
  }
  if (fisicoErp > 0 || reservadoTotal > 0) {
    return { fisico: fisicoErp, reservado: reservadoTotal, origem: 'ERP' }
  }
  return { fisico: 0, reservado: 0, origem: 'NENHUM' }
}

function classificarSituacao(saldoDisponivel: number, necessario: number): SituacaoEstoque {
  if (saldoDisponivel <= 0) return 'SEM_ESTOQUE'
  if (saldoDisponivel >= necessario) return 'SUFICIENTE'
  return 'PARCIAL'
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}

// ─── Função principal ────────────────────────────────────────────────────────

/**
 * Verifica a disponibilidade de estoque de uma OP: produto acabado + materiais.
 *
 * @param opId ID da ordem de produção
 * @param empresaId empresa (isolamento multi-tenant)
 */
export async function verificarEstoqueOp(
  opId: string,
  empresaId: string,
): Promise<ResultadoVerificacaoEstoque> {
  const op = await prisma.ordemProducao.findFirst({
    where: { id: opId, empresaId },
    select: {
      id: true,
      numero: true,
      produtoId: true,
      quantidade: true,
      unidadeMedida: true,
      itens: {
        select: {
          produtoComponenteId: true,
          descricaoProduto: true,
          tipoMaterial: true,
          unidadeMedida: true,
          quantidade: true,
          quantidadeLiberada: true,
        },
      },
    },
  })

  if (!op) {
    throw { statusCode: 404, message: 'Ordem de produção não encontrada' }
  }

  // ─── Produto Acabado ───────────────────────────────────────────────────
  let produtoAcabado: DisponibilidadeProdutoAcabado | null = null
  if (op.produtoId) {
    const produto = await prisma.produto.findUnique({
      where: { id: op.produtoId },
      select: { codigo: true, nome: true },
    })
    const saldoPa = await calcularSaldo(empresaId, op.produtoId, op.id)
    const disponivelPa = Math.max(0, saldoPa.fisico - saldoPa.reservado)
    const qtdPedido = Number(op.quantidade)
    const aProduzir = Math.max(0, qtdPedido - disponivelPa)

    produtoAcabado = {
      produtoId: op.produtoId,
      descricao: produto ? `${produto.codigo} - ${produto.nome}` : 'Produto',
      unidade: op.unidadeMedida,
      quantidadePedido: round4(qtdPedido),
      estoqueDisponivel: round4(disponivelPa),
      aProduzir: round4(aProduzir),
      atendeDoEstoque: aProduzir === 0,
    }
  }

  // ─── Materiais (MP) ────────────────────────────────────────────────────
  const materiais: DisponibilidadeMaterial[] = []
  for (const item of op.itens) {
    const necessario = Number(item.quantidade) - Number(item.quantidadeLiberada)

    // Material sem cadastro (produtoComponenteId null) — não dá para verificar estoque
    if (!item.produtoComponenteId) {
      materiais.push({
        produtoComponenteId: null,
        descricao: item.descricaoProduto,
        tipoMaterial: item.tipoMaterial,
        unidade: item.unidadeMedida,
        quantidadeNecessaria: round4(Math.max(0, necessario)),
        estoqueFisico: 0,
        estoqueReservado: 0,
        saldoDisponivel: 0,
        falta: round4(Math.max(0, necessario)),
        situacao: 'SEM_ESTOQUE',
        origemEstoque: 'NENHUM',
      })
      continue
    }

    const saldo = await calcularSaldo(empresaId, item.produtoComponenteId, op.id)
    const disponivel = Math.max(0, saldo.fisico - saldo.reservado)
    const situacao = classificarSituacao(disponivel, necessario)
    const falta = Math.max(0, necessario - disponivel)

    materiais.push({
      produtoComponenteId: item.produtoComponenteId,
      descricao: item.descricaoProduto,
      tipoMaterial: item.tipoMaterial,
      unidade: item.unidadeMedida,
      quantidadeNecessaria: round4(Math.max(0, necessario)),
      estoqueFisico: round4(saldo.fisico),
      estoqueReservado: round4(saldo.reservado),
      saldoDisponivel: round4(disponivel),
      falta: round4(falta),
      situacao,
      origemEstoque: saldo.origem,
    })
  }

  const materiaisSuficientes = materiais.filter((m) => m.situacao === 'SUFICIENTE').length
  const materiaisComFalta = materiais.filter((m) => m.situacao !== 'SUFICIENTE').length

  return {
    ordemProducaoId: op.id,
    numero: op.numero,
    produtoAcabado,
    materiais,
    resumo: {
      totalMateriais: materiais.length,
      materiaisSuficientes,
      materiaisComFalta,
      todosDisponiveis: materiaisComFalta === 0 && materiais.length > 0,
    },
  }
}
