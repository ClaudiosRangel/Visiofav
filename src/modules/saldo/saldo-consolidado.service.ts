/**
 * Serviço de Saldo Consolidado por Produto.
 *
 * Consolida o estoque por PRODUTO, considerando as duas formas de armazenar
 * saldo no sistema e o reservado total (venda + produção):
 *
 *   - SaldoEndereco (WMS): saldo por endereço/lote — tem localização
 *   - Estoque (ERP): saldo global por produto — sem endereço
 *
 * Regra de origem (igual à do PCP em verificacao-estoque.service.ts): se há
 * saldo WMS (endereçado) > 0, o físico vem do WMS (com endereços); senão cai
 * para o Estoque global do ERP (sem endereço).
 *
 *   Reservado = Estoque.reservado (vendas) + Σ ReservaProducao ATIVA (produção)
 *   Disponível = Físico − Reservado (nunca negativo na exibição)
 */

import { prisma } from '../../lib/prisma'

export interface EnderecoSaldo {
  enderecoCompleto: string | null
  lote: string | null
  validade: Date | null
  quantidade: number
}

export interface ProdutoSaldoConsolidado {
  produtoId: string
  codigo: string | null
  nome: string | null
  unidade: string | null
  origem: 'WMS' | 'ERP'
  fisico: number
  reservadoVenda: number
  reservadoProducao: number
  reservado: number
  disponivel: number
  enderecos: EnderecoSaldo[] // preenchido só quando origem = 'WMS'
}

export async function listarSaldoConsolidado(
  empresaId: string,
  busca?: string,
): Promise<ProdutoSaldoConsolidado[]> {
  // 1. Saldos WMS (por endereço) não bloqueados da empresa (inclui empresaId null legado)
  const saldosWms = await prisma.saldoEndereco.findMany({
    where: {
      bloqueado: false,
      OR: [{ empresaId }, { empresaId: null }],
      ...(busca
        ? {
            produto: {
              OR: [
                { nome: { contains: busca, mode: 'insensitive' } },
                { codigo: { contains: busca, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    },
    select: {
      produtoId: true,
      quantidade: true,
      lote: true,
      validade: true,
      endereco: { select: { enderecoCompleto: true } },
      produto: { select: { codigo: true, nome: true, unidade: true } },
    },
  })

  // 2. Estoque global (ERP) da empresa
  const estoquesErp = await prisma.estoque.findMany({
    where: {
      empresaId,
      ...(busca
        ? {
            produto: {
              OR: [
                { nome: { contains: busca, mode: 'insensitive' } },
                { codigo: { contains: busca, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    },
    select: {
      produtoId: true,
      quantidade: true,
      reservado: true,
      produto: { select: { codigo: true, nome: true, unidade: true } },
    },
  })

  // 3. Reservas de produção ATIVAS agregadas por produto
  const reservasProducao = await prisma.reservaProducao.groupBy({
    by: ['produtoId'],
    where: { empresaId, status: 'ATIVA' },
    _sum: { quantidade: true },
  })
  const reservaProducaoMap = new Map(
    reservasProducao.map((r) => [r.produtoId, Number(r._sum.quantidade ?? 0)]),
  )

  // Índice por produto com físico WMS, endereços e dados do produto
  const wmsPorProduto = new Map<
    string,
    { fisico: number; enderecos: EnderecoSaldo[]; codigo: string | null; nome: string | null; unidade: string | null }
  >()
  for (const s of saldosWms) {
    const atual = wmsPorProduto.get(s.produtoId) || {
      fisico: 0,
      enderecos: [],
      codigo: s.produto?.codigo ?? null,
      nome: s.produto?.nome ?? null,
      unidade: s.produto?.unidade ?? null,
    }
    atual.fisico += Number(s.quantidade)
    atual.enderecos.push({
      enderecoCompleto: s.endereco?.enderecoCompleto ?? null,
      lote: s.lote ?? null,
      validade: s.validade ?? null,
      quantidade: Number(s.quantidade),
    })
    wmsPorProduto.set(s.produtoId, atual)
  }

  const erpPorProduto = new Map(
    estoquesErp.map((e) => [
      e.produtoId,
      {
        quantidade: Number(e.quantidade),
        reservado: Number(e.reservado),
        codigo: e.produto?.codigo ?? null,
        nome: e.produto?.nome ?? null,
        unidade: e.produto?.unidade ?? null,
      },
    ]),
  )

  // União de todos os produtos que têm saldo em algum dos dois modelos
  const todosProdutoIds = new Set<string>([...wmsPorProduto.keys(), ...erpPorProduto.keys()])

  const resultado: ProdutoSaldoConsolidado[] = []

  for (const produtoId of todosProdutoIds) {
    const wms = wmsPorProduto.get(produtoId)
    const erp = erpPorProduto.get(produtoId)
    const reservadoProducao = reservaProducaoMap.get(produtoId) ?? 0
    const reservadoVenda = erp?.reservado ?? 0
    const reservado = reservadoVenda + reservadoProducao

    // Regra de origem: WMS quando há saldo endereçado; senão ERP
    const usaWms = (wms?.fisico ?? 0) > 0
    const fisico = usaWms ? wms!.fisico : erp?.quantidade ?? 0
    const disponivel = Math.max(0, fisico - reservado)

    resultado.push({
      produtoId,
      codigo: wms?.codigo ?? erp?.codigo ?? null,
      nome: wms?.nome ?? erp?.nome ?? null,
      unidade: wms?.unidade ?? erp?.unidade ?? null,
      origem: usaWms ? 'WMS' : 'ERP',
      fisico,
      reservadoVenda,
      reservadoProducao,
      reservado,
      disponivel,
      enderecos: usaWms ? wms!.enderecos : [],
    })
  }

  // Ordena por nome do produto
  resultado.sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? ''))

  return resultado
}
