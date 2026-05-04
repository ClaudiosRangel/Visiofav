import { prisma } from '../../lib/prisma'

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ItemMonitorSeparacao {
  id: string
  produtoNome: string
  enderecoOrigem: string
  quantidadeSolicitada: number
  quantidadeSeparada: number
  status: 'Pendente' | 'Em Andamento' | 'Concluído'
}

export interface ProgressoSeparacao {
  ondaId: string
  total: number
  concluidos: number
  pendentes: number
  emAndamento: number
  percentual: number
  itens: ItemMonitorSeparacao[]
  timestamp: string
}

export interface VolumeMonitor {
  volumeId: string
  codigo: number
  tipo: string
  totalItens: number
  percentualConcluido: number
}

export interface ProgressoEmbalagem {
  ondaId: string
  totalItensSeparados: number
  itensEmbalados: number
  itensPendentes: number
  percentual: number
  volumes: VolumeMonitor[]
  timestamp: string
}

export interface VolumeCarregamentoMonitor {
  sequencia: number
  volumeCodigo: number
  tipo: string
  pesoKg: number
  status: 'Pendente' | 'Concluído'
}

export interface ProgressoCarregamento {
  carregamentoId: string
  totalVolumes: number
  volumesCarregados: number
  volumesPendentes: number
  percentual: number
  volumes: VolumeCarregamentoMonitor[]
  timestamp: string
}

// ---------------------------------------------------------------------------
// MonitorService
// ---------------------------------------------------------------------------

export class MonitorService {
  async getProgressoSeparacao(ondaId: string): Promise<ProgressoSeparacao> {
    // Fetch all items from the onda
    const itensSeparacao = await prisma.itemSeparacao.findMany({
      where: { ordemSeparacao: { ondaSeparacaoId: ondaId } },
      select: {
        id: true,
        produtoId: true,
        enderecoOrigemId: true,
        quantidadeSolicitada: true,
        quantidadeSeparada: true,
        status: true,
      },
    })

    // Enrich with product names and addresses
    const produtoIds = [...new Set(itensSeparacao.map((i) => i.produtoId))]
    const enderecoIds = [...new Set(itensSeparacao.map((i) => i.enderecoOrigemId))]

    const [produtos, enderecos] = await Promise.all([
      prisma.produto.findMany({
        where: { id: { in: produtoIds } },
        select: { id: true, nome: true },
      }),
      prisma.endereco.findMany({
        where: { id: { in: enderecoIds } },
        select: { id: true, enderecoCompleto: true },
      }),
    ])

    const produtoMap = new Map(produtos.map((p) => [p.id, p.nome]))
    const enderecoMap = new Map(enderecos.map((e) => [e.id, e.enderecoCompleto ?? '']))

    const total = itensSeparacao.length
    const concluidos = itensSeparacao.filter((i) =>
      ['SEPARADO', 'SEPARADO_PARCIAL'].includes(i.status),
    ).length
    const pendentes = itensSeparacao.filter((i) => i.status === 'PENDENTE').length
    const emAndamento = total - concluidos - pendentes

    const mapStatus = (status: string): 'Pendente' | 'Em Andamento' | 'Concluído' => {
      if (status === 'PENDENTE') return 'Pendente'
      if (['SEPARADO', 'SEPARADO_PARCIAL'].includes(status)) return 'Concluído'
      return 'Em Andamento'
    }

    const itens: ItemMonitorSeparacao[] = itensSeparacao.map((i) => ({
      id: i.id,
      produtoNome: produtoMap.get(i.produtoId) ?? '—',
      enderecoOrigem: enderecoMap.get(i.enderecoOrigemId) ?? '—',
      quantidadeSolicitada: Number(i.quantidadeSolicitada),
      quantidadeSeparada: Number(i.quantidadeSeparada),
      status: mapStatus(i.status),
    }))

    return {
      ondaId,
      total,
      concluidos,
      pendentes,
      emAndamento,
      percentual: total > 0 ? Math.round((concluidos / total) * 100) : 0,
      itens,
      timestamp: new Date().toISOString(),
    }
  }

  async getProgressoEmbalagem(ondaId: string): Promise<ProgressoEmbalagem> {
    // Fetch separated items
    const itensSeparados = await prisma.itemSeparacao.findMany({
      where: {
        ordemSeparacao: { ondaSeparacaoId: ondaId },
        status: { in: ['SEPARADO', 'SEPARADO_PARCIAL'] },
      },
      select: { id: true, quantidadeSeparada: true },
    })

    const totalItensSeparados = itensSeparados.length

    // Check how many are fully packed
    let itensEmbalados = 0
    for (const item of itensSeparados) {
      const vinculado = await prisma.itemVolume.aggregate({
        where: { itemSeparacaoId: item.id },
        _sum: { quantidade: true },
      })
      if (Number(vinculado._sum.quantidade || 0) >= Number(item.quantidadeSeparada)) {
        itensEmbalados++
      }
    }

    const itensPendentes = totalItensSeparados - itensEmbalados

    // Fetch volumes
    const volumes = await prisma.volume.findMany({
      where: { ondaSeparacaoId: ondaId },
      select: { id: true, codigo: true, tipo: true },
    })

    const volumeMonitors: VolumeMonitor[] = await Promise.all(
      volumes.map(async (vol) => {
        const itensVolume = await prisma.itemVolume.findMany({
          where: { volumeId: vol.id },
          select: { quantidade: true, itemSeparacaoId: true },
        })
        const totalItens = itensVolume.length

        // Calculate completion: how many items are fully packed in this volume
        let completos = 0
        for (const iv of itensVolume) {
          const itemSep = await prisma.itemSeparacao.findUnique({
            where: { id: iv.itemSeparacaoId },
            select: { quantidadeSeparada: true },
          })
          if (itemSep && Number(iv.quantidade) >= Number(itemSep.quantidadeSeparada)) {
            completos++
          }
        }

        return {
          volumeId: vol.id,
          codigo: vol.codigo,
          tipo: vol.tipo,
          totalItens,
          percentualConcluido: totalItens > 0 ? Math.round((completos / totalItens) * 100) : 0,
        }
      }),
    )

    return {
      ondaId,
      totalItensSeparados,
      itensEmbalados,
      itensPendentes,
      percentual: totalItensSeparados > 0 ? Math.round((itensEmbalados / totalItensSeparados) * 100) : 0,
      volumes: volumeMonitors,
      timestamp: new Date().toISOString(),
    }
  }

  async getProgressoCarregamento(carregamentoId: string): Promise<ProgressoCarregamento> {
    const cvs = await prisma.carregamentoVolume.findMany({
      where: { carregamentoId },
      include: {
        volume: { select: { codigo: true, tipo: true, pesoKg: true } },
      },
      orderBy: { sequencia: 'asc' },
    })

    const totalVolumes = cvs.length
    const volumesCarregados = cvs.filter((cv) => cv.carregadoEm !== null).length
    const volumesPendentes = totalVolumes - volumesCarregados

    const volumes: VolumeCarregamentoMonitor[] = cvs.map((cv) => ({
      sequencia: cv.sequencia,
      volumeCodigo: cv.volume.codigo,
      tipo: cv.volume.tipo,
      pesoKg: Number(cv.volume.pesoKg),
      status: cv.carregadoEm ? 'Concluído' as const : 'Pendente' as const,
    }))

    return {
      carregamentoId,
      totalVolumes,
      volumesCarregados,
      volumesPendentes,
      percentual: totalVolumes > 0 ? Math.round((volumesCarregados / totalVolumes) * 100) : 0,
      volumes,
      timestamp: new Date().toISOString(),
    }
  }
}
