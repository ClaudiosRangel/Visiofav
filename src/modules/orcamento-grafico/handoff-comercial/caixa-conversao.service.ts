/**
 * Caixa de entrada "Orçamentos a converter" (R4). Lista os orçamentos
 * APROVADOS (ainda não CONVERTIDOS) da empresa, marcando quais têm amostra
 * pendente (exigida e não aprovada). Isolamento por `empresaId` explícito.
 */
import { prisma } from '../../../lib/prisma'
import { amostraExigida } from './amostra.puro'
import { configAmostraDaEmpresa } from './converter-orcamento.service'

function extrairTag(obs: string | null, tag: string): string | null {
  if (!obs) return null
  const m = obs.match(new RegExp(`\\[${tag}\\]\\s*(.+?)(?:\\n|$)`, 'i'))
  return m ? m[1].trim() : null
}

export interface ItemCaixaConversao {
  orcamentoId: string
  numero: number
  cliente: string | null
  vendedorId: string | null
  valor: number
  criadoEm: Date
  exigeAmostra: boolean
  amostraPendente: boolean
}

export async function listarOrcamentosAConverter(
  empresaId: string,
  filtros?: { clienteId?: string; vendedorId?: string; dataInicio?: string; dataFim?: string },
): Promise<ItemCaixaConversao[]> {
  const config = await configAmostraDaEmpresa(empresaId)

  const orcamentos = await prisma.orcamentoGrafico.findMany({
    where: {
      empresaId,
      status: 'APROVADO',
      ...(filtros?.clienteId ? { clienteId: filtros.clienteId } : {}),
      ...(filtros?.vendedorId ? { vendedorId: filtros.vendedorId } : {}),
      ...(filtros?.dataInicio || filtros?.dataFim
        ? {
            criadoEm: {
              ...(filtros?.dataInicio ? { gte: new Date(`${filtros.dataInicio}T00:00:00`) } : {}),
              ...(filtros?.dataFim ? { lte: new Date(`${filtros.dataFim}T23:59:59`) } : {}),
            },
          }
        : {}),
    },
    orderBy: { aprovadoEm: 'desc' },
    select: {
      id: true, numero: true, clienteNome: true, clienteId: true, vendedorId: true,
      precoVenda: true, valorTotalConsolidado: true, observacoes: true,
      exigeAmostra: true, criadoEm: true,
    },
  })

  if (orcamentos.length === 0) return []

  // Amostras aprovadas por orçamento (para marcar amostraPendente).
  const ids = orcamentos.map((o) => o.id)
  const amostrasAprovadas = await prisma.aprovacaoAmostra.findMany({
    where: { empresaId, orcamentoId: { in: ids }, status: 'APROVADA' },
    select: { orcamentoId: true },
  })
  const temAmostraAprovada = new Set(amostrasAprovadas.map((a) => a.orcamentoId))

  return orcamentos.map((o) => {
    const tipoOp = extrairTag(o.observacoes, 'TipoOp')
    const exige = amostraExigida(config, o.exigeAmostra as boolean | null, tipoOp)
    const valor =
      o.precoVenda != null ? Number(o.precoVenda) : o.valorTotalConsolidado != null ? Number(o.valorTotalConsolidado) : 0
    return {
      orcamentoId: o.id,
      numero: o.numero,
      cliente: o.clienteNome ?? extrairTag(o.observacoes, 'Cliente'),
      vendedorId: o.vendedorId,
      valor,
      criadoEm: o.criadoEm,
      exigeAmostra: exige,
      amostraPendente: exige && !temAmostraAprovada.has(o.id),
    }
  })
}
