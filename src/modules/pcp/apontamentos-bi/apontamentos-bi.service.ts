/**
 * Service de AGREGAÇÃO dos Apontamentos (spec pcp-apontamentos-dashboards-
 * relatorios). Fonte única consumida por dashboard, produtividade, histórico e
 * PDFs — tela e impressão nunca divergem.
 *
 * Fonte de verdade: ApontamentoEtapa → etapaOrdemProducao → ordemProducao
 * (empresaId) + centroProducao (tipoProcesso, custoHora). Isolamento
 * multi-tenant por empresaId EXPLÍCITO da OP real (nunca só prismaScoped —
 * bypass SUPER_ADMIN). Só centros ATIVOS e disponíveis para programação.
 */
import { prisma } from '../../../lib/prisma'
import { baseContagem } from '../base-contagem.service'
import {
  valorizar,
  percentualAtingido,
  mesCivilBrasilia,
  dataCivilBrasilia,
} from './apontamentos-valorizacao.service'

export interface FiltroApontamentos {
  dataInicio?: string
  dataFim?: string
  centroId?: string
  operadorId?: string
  tipoProcessoId?: string
}

export interface SerieDiaria {
  data: string
  produzido: number
  valorRs: number
}

export interface DashboardCentroDTO {
  centroId: string
  centroDescricao: string
  tipoProcessoCodigo: string | null
  base: 'UNIDADE' | 'TIRAGEM'
  produzido: number
  perda: number
  retrabalho: number
  paradaMinutos: number
  valorRs: number
  metaQuantidade: number | null
  metaValorRs: number | null
  percentualAtingido: number | null
  serieDiaria: SerieDiaria[]
}

/** Resolve o intervalo [dataInicio, dataFim]; default = últimos 30 dias. */
export function resolverPeriodo(filtro: FiltroApontamentos): { inicio: Date; fim: Date } {
  const fim = filtro.dataFim ? new Date(`${filtro.dataFim}T23:59:59`) : new Date()
  const inicio = filtro.dataInicio
    ? new Date(`${filtro.dataInicio}T00:00:00`)
    : new Date(fim.getTime() - 29 * 86400000)
  if (inicio.getTime() > fim.getTime()) {
    const err = new Error('Período inválido: dataInicio posterior a dataFim') as Error & { statusCode?: number }
    err.statusCode = 400
    throw err
  }
  return { inicio, fim }
}

/** where base dos apontamentos: empresa da OP real + centro ativo/disponível. */
function whereApontamentos(empresaId: string, filtro: FiltroApontamentos, inicio: Date, fim: Date) {
  return {
    empresaId,
    dataHora: { gte: inicio, lte: fim },
    ...(filtro.operadorId ? { funcionarioId: filtro.operadorId } : {}),
    etapaOrdemProducao: {
      ordemProducao: { empresaId },
      centroProducao: {
        status: true,
        disponivelProgramacao: true,
        ...(filtro.centroId ? { id: filtro.centroId } : {}),
        ...(filtro.tipoProcessoId ? { tipoProcessoId: filtro.tipoProcessoId } : {}),
      },
    },
  }
}

/**
 * Dashboard por centro (Req 3): totais por centro + série diária, com meta e
 * % atingido. tempoProdutivo derivado de setupDuracao não entra; a valorização
 * usa custoHora × horas apontadas de produção estimadas pelo tempo das etapas
 * — aqui aproximamos pelo tempoParada ausente: usamos a soma de horas entre
 * apontamentos de produção não é confiável, então valorizamos por quantidade
 * quando houver valorUnitario; caso contrário por custoHora × (minutos de
 * produção / 60) usando setupDuracao+parada como proxy quando disponível.
 */
export async function agregarDashboard(
  empresaId: string,
  filtro: FiltroApontamentos,
): Promise<DashboardCentroDTO[]> {
  const { inicio, fim } = resolverPeriodo(filtro)

  const apontamentos = await prisma.apontamentoEtapa.findMany({
    where: whereApontamentos(empresaId, filtro, inicio, fim),
    select: {
      tipo: true,
      quantidadeProduzida: true,
      quantidadePerda: true,
      quantidadeRetrabalho: true,
      tempoParadaMinutos: true,
      setupDuracaoMinutos: true,
      dataHora: true,
      etapaOrdemProducao: {
        select: {
          tempoRealMinutos: true,
          centroProducao: {
            select: {
              id: true,
              descricao: true,
              custoHora: true,
              tipoProcesso: { select: { codigo: true } },
            },
          },
        },
      },
    },
  })

  // Metas vigentes no período, por centro.
  const metas = await prisma.metaProducaoCentro.findMany({
    where: {
      empresaId,
      vigenciaInicio: { lte: fim },
      OR: [{ vigenciaFim: null }, { vigenciaFim: { gte: inicio } }],
    },
    orderBy: { vigenciaInicio: 'desc' },
  })
  const metaPorCentro = new Map<string, { qtd: number; valor: number | null }>()
  for (const m of metas) {
    if (!metaPorCentro.has(m.centroProducaoId)) {
      metaPorCentro.set(m.centroProducaoId, {
        qtd: Number(m.metaQuantidadeDia),
        valor: m.metaValorDia != null ? Number(m.metaValorDia) : null,
      })
    }
  }

  interface Acc {
    centroId: string
    centroDescricao: string
    tipoProcessoCodigo: string | null
    custoHora: number | null
    produzido: number
    perda: number
    retrabalho: number
    paradaMinutos: number
    minutosProducao: number
    serie: Map<string, { produzido: number; minutos: number }>
  }
  const porCentro = new Map<string, Acc>()

  for (const a of apontamentos) {
    const centro = a.etapaOrdemProducao?.centroProducao
    if (!centro) continue
    let acc = porCentro.get(centro.id)
    if (!acc) {
      acc = {
        centroId: centro.id,
        centroDescricao: centro.descricao,
        tipoProcessoCodigo: centro.tipoProcesso?.codigo ?? null,
        custoHora: centro.custoHora != null ? Number(centro.custoHora) : null,
        produzido: 0,
        perda: 0,
        retrabalho: 0,
        paradaMinutos: 0,
        minutosProducao: 0,
        serie: new Map(),
      }
      porCentro.set(centro.id, acc)
    }
    acc.produzido += Number(a.quantidadeProduzida)
    acc.perda += Number(a.quantidadePerda)
    acc.retrabalho += Number(a.quantidadeRetrabalho)
    acc.paradaMinutos += a.tempoParadaMinutos ?? 0
    // Minutos de produção (proxy p/ valorização por custoHora): tempoReal da
    // etapa quando disponível, senão setupDuracao. Apenas apontamentos de
    // produção contribuem.
    if (a.tipo === 'PRODUCAO') {
      const min = a.etapaOrdemProducao?.tempoRealMinutos ?? a.setupDuracaoMinutos ?? 0
      acc.minutosProducao += min
      const dia = dataCivilBrasilia(a.dataHora)
      const s = acc.serie.get(dia) ?? { produzido: 0, minutos: 0 }
      s.produzido += Number(a.quantidadeProduzida)
      s.minutos += min
      acc.serie.set(dia, s)
    }
  }

  const resultado: DashboardCentroDTO[] = []
  for (const acc of porCentro.values()) {
    const base = baseContagem(acc.tipoProcessoCodigo ?? '')
    const valorRs = valorizar({
      tempoProdutivoHoras: acc.minutosProducao / 60,
      custoHora: acc.custoHora,
      quantidade: acc.produzido,
    })
    const meta = metaPorCentro.get(acc.centroId)
    const serieDiaria: SerieDiaria[] = [...acc.serie.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([data, v]) => ({
        data,
        produzido: v.produzido,
        valorRs: valorizar({ tempoProdutivoHoras: v.minutos / 60, custoHora: acc.custoHora, quantidade: v.produzido }),
      }))
    resultado.push({
      centroId: acc.centroId,
      centroDescricao: acc.centroDescricao,
      tipoProcessoCodigo: acc.tipoProcessoCodigo,
      base,
      produzido: acc.produzido,
      perda: acc.perda,
      retrabalho: acc.retrabalho,
      paradaMinutos: acc.paradaMinutos,
      valorRs,
      metaQuantidade: meta?.qtd ?? null,
      metaValorRs: meta?.valor ?? null,
      percentualAtingido: percentualAtingido(acc.produzido, meta?.qtd ?? null),
      serieDiaria,
    })
  }
  resultado.sort((a, b) => a.centroDescricao.localeCompare(b.centroDescricao))
  return resultado
}

export interface ProdutividadeLinhaDTO {
  chaveId: string
  nome: string
  meses: { mes: string; quantidade: number }[]
  totalQuantidade: number
}

/**
 * Produtividade por operador OU por máquina, agrupada por mês civil (-3h).
 * Req 4. Apontamento sem funcionarioId cai em "Sem operador".
 */
export async function agregarProdutividade(
  empresaId: string,
  filtro: FiltroApontamentos,
  por: 'operador' | 'maquina',
): Promise<ProdutividadeLinhaDTO[]> {
  const { inicio, fim } = resolverPeriodo(filtro)
  const apontamentos = await prisma.apontamentoEtapa.findMany({
    where: { ...whereApontamentos(empresaId, filtro, inicio, fim), tipo: 'PRODUCAO' },
    select: {
      funcionarioId: true,
      quantidadeProduzida: true,
      dataHora: true,
      etapaOrdemProducao: {
        select: { centroProducao: { select: { id: true, descricao: true } } },
      },
    },
  })

  interface Acc {
    chaveId: string
    nome: string
    meses: Map<string, number>
    total: number
  }
  const grupos = new Map<string, Acc>()
  const operadorIds = new Set<string>()

  for (const a of apontamentos) {
    const mes = mesCivilBrasilia(a.dataHora)
    const qtd = Number(a.quantidadeProduzida)
    let chaveId: string
    let nome: string
    if (por === 'maquina') {
      const c = a.etapaOrdemProducao?.centroProducao
      chaveId = c?.id ?? 'sem-centro'
      nome = c?.descricao ?? 'Sem centro'
    } else {
      chaveId = a.funcionarioId ?? 'sem-operador'
      nome = chaveId
      if (a.funcionarioId) operadorIds.add(a.funcionarioId)
    }
    let g = grupos.get(chaveId)
    if (!g) {
      g = { chaveId, nome, meses: new Map(), total: 0 }
      grupos.set(chaveId, g)
    }
    g.meses.set(mes, (g.meses.get(mes) ?? 0) + qtd)
    g.total += qtd
  }

  // Resolve nomes de operador (pode ser Usuario ou Funcionario).
  if (por === 'operador' && operadorIds.size > 0) {
    const ids = [...operadorIds]
    const [usuarios, funcionarios] = await Promise.all([
      prisma.usuario.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } }),
      prisma.funcionario.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } }),
    ])
    const nomePorId = new Map<string, string>()
    for (const f of funcionarios) nomePorId.set(f.id, f.nome)
    for (const u of usuarios) if (!nomePorId.has(u.id)) nomePorId.set(u.id, u.nome)
    for (const g of grupos.values()) {
      if (g.chaveId === 'sem-operador') g.nome = 'Sem operador'
      else g.nome = nomePorId.get(g.chaveId) ?? g.chaveId
    }
  }

  return [...grupos.values()]
    .map((g) => ({
      chaveId: g.chaveId,
      nome: g.nome,
      meses: [...g.meses.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mes, quantidade]) => ({ mes, quantidade })),
      totalQuantidade: g.total,
    }))
    .sort((a, b) => b.totalQuantidade - a.totalQuantidade)
}

export interface HistoricoItemDTO {
  id: string
  dataHora: Date
  centroDescricao: string | null
  operadorId: string | null
  opNumero: number | null
  referenciaExterna: string | null
  tipo: string
  quantidade: number
  motivo: string | null
  observacao: string | null
}

/** Histórico paginado (Req 5). */
export async function listarHistorico(
  empresaId: string,
  filtro: FiltroApontamentos & { tipo?: string; opId?: string },
  page = 1,
  pageSize = 50,
): Promise<{ total: number; page: number; pageSize: number; itens: HistoricoItemDTO[] }> {
  const { inicio, fim } = resolverPeriodo(filtro)
  const where = {
    ...whereApontamentos(empresaId, filtro, inicio, fim),
    ...(filtro.tipo ? { tipo: filtro.tipo } : {}),
    ...(filtro.opId
      ? {
          etapaOrdemProducao: {
            ordemProducao: { empresaId, id: filtro.opId },
            centroProducao: { status: true, disponivelProgramacao: true },
          },
        }
      : {}),
  }
  const [total, rows] = await Promise.all([
    prisma.apontamentoEtapa.count({ where }),
    prisma.apontamentoEtapa.findMany({
      where,
      orderBy: { dataHora: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        dataHora: true,
        tipo: true,
        quantidadeProduzida: true,
        quantidadePerda: true,
        quantidadeRetrabalho: true,
        motivoPerda: true,
        motivoParada: true,
        observacao: true,
        funcionarioId: true,
        etapaOrdemProducao: {
          select: {
            centroProducao: { select: { descricao: true } },
            ordemProducao: { select: { numero: true, referenciaExterna: true } },
          },
        },
      },
    }),
  ])

  const itens: HistoricoItemDTO[] = rows.map((r) => {
    const qtd =
      r.tipo === 'PERDA'
        ? Number(r.quantidadePerda)
        : r.tipo === 'RETOMADA'
          ? 0
          : Number(r.quantidadeProduzida) || Number(r.quantidadeRetrabalho)
    return {
      id: r.id,
      dataHora: r.dataHora,
      centroDescricao: r.etapaOrdemProducao?.centroProducao?.descricao ?? null,
      operadorId: r.funcionarioId,
      opNumero: r.etapaOrdemProducao?.ordemProducao?.numero ?? null,
      referenciaExterna: r.etapaOrdemProducao?.ordemProducao?.referenciaExterna ?? null,
      tipo: r.tipo,
      quantidade: qtd,
      motivo: r.motivoPerda ?? r.motivoParada ?? null,
      observacao: r.observacao ?? null,
    }
  })
  return { total, page, pageSize, itens }
}
