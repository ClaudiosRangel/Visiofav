/**
 * Agregação do Relatório Mensal de Produção (spec pcp-relatorio-gerencial-
 * producao, Task 5). Fonte: ApontamentoEtapa → etapa → OP (empresaId) +
 * centro (tipoProcesso, custoHora, velocidade). Valorização SOMENTE por custo.
 * Isolamento por empresaId explícito. Base de contagem por processo
 * (COLAGEM = UNIDADE; demais = TIRAGEM).
 */
import { prisma } from '../../../lib/prisma'
import { baseContagem } from '../base-contagem.service'
import { valorizar, horasPorVelocidade, dataCivilBrasilia, mesCivilBrasilia } from '../apontamentos-bi/apontamentos-valorizacao.service'
import { kgFabricado, parseFormatoMm, parseGramatura } from './kg-fabricado.service'

/** Intervalo [inicio, fim] de um mês (1-12) e ano. */
export function intervaloMes(ano: number, mes: number): { inicio: Date; fim: Date } {
  const inicio = new Date(Date.UTC(ano, mes - 1, 1, 3, 0, 0)) // 00:00 BRT
  const fim = new Date(Date.UTC(ano, mes, 1, 3, 0, 0) - 1) // último ms do mês BRT
  return { inicio, fim }
}

interface ApontamentoAgg {
  tipo: string
  quantidadeProduzida: unknown
  quantidadePerda: unknown
  tempoParadaMinutos: number | null
  tempoOperacaoCalculado: unknown
  setupDuracaoMinutos: number | null
  codigoParadaId: string | null
  motivoParada: string | null
  dataHora: Date
  centroId: string
  centroDescricao: string
  custoHora: number | null
  velocidade: number | null
  tipoProcessoId: string | null
  tipoProcessoCodigo: string | null
}

/** Busca os apontamentos do mês já achatados (empresa + centro ativo/disp). */
async function buscarApontamentosMes(empresaId: string, inicio: Date, fim: Date): Promise<ApontamentoAgg[]> {
  const rows = await prisma.apontamentoEtapa.findMany({
    where: {
      empresaId,
      dataHora: { gte: inicio, lte: fim },
      etapaOrdemProducao: {
        ordemProducao: { empresaId },
        centroProducao: { status: true, disponivelProgramacao: true },
      },
    },
    select: {
      tipo: true, quantidadeProduzida: true, quantidadePerda: true,
      tempoParadaMinutos: true, setupDuracaoMinutos: true,
      codigoParadaId: true, motivoParada: true, dataHora: true,
      etapaOrdemProducao: {
        select: {
          tempoOperacaoCalculado: true,
          centroProducao: {
            select: {
              id: true, descricao: true, custoHora: true, velocidade: true,
              tipoProcessoId: true, tipoProcesso: { select: { codigo: true } },
            },
          },
        },
      },
    },
  })
  const out: ApontamentoAgg[] = []
  for (const r of rows) {
    const c = r.etapaOrdemProducao?.centroProducao
    if (!c) continue
    out.push({
      tipo: r.tipo,
      quantidadeProduzida: r.quantidadeProduzida,
      quantidadePerda: r.quantidadePerda,
      tempoParadaMinutos: r.tempoParadaMinutos,
      tempoOperacaoCalculado: r.etapaOrdemProducao?.tempoOperacaoCalculado,
      setupDuracaoMinutos: r.setupDuracaoMinutos,
      codigoParadaId: r.codigoParadaId,
      motivoParada: r.motivoParada,
      dataHora: r.dataHora,
      centroId: c.id,
      centroDescricao: c.descricao,
      custoHora: c.custoHora != null ? Number(c.custoHora) : null,
      velocidade: c.velocidade != null ? Number(c.velocidade) : null,
      tipoProcessoId: c.tipoProcessoId ?? null,
      tipoProcessoCodigo: c.tipoProcesso?.codigo ?? null,
    })
  }
  return out
}

function valorApontamento(a: ApontamentoAgg, qtd: number): number {
  const horas = horasPorVelocidade(qtd, a.velocidade) ?? (a.tempoOperacaoCalculado != null ? Number(a.tempoOperacaoCalculado) : (a.setupDuracaoMinutos ?? 0)) / 60
  return valorizar({ tempoProdutivoHoras: horas, custoHora: a.custoHora, quantidade: qtd })
}

export interface ResumoProcessoDTO {
  tipoProcessoId: string | null
  tipoProcessoCodigo: string | null
  base: 'UNIDADE' | 'TIRAGEM'
  produzido: number
  valorRs: number
  metaQuantidade: number | null
  percentualAtingido: number | null
}

/** Resumo por processo do mês (Req 5.1). */
export async function resumoPorProcesso(empresaId: string, ano: number, mes: number): Promise<ResumoProcessoDTO[]> {
  const { inicio, fim } = intervaloMes(ano, mes)
  const apts = await buscarApontamentosMes(empresaId, inicio, fim)
  const metas = await prisma.metaProducaoProcesso.findMany({
    where: { empresaId, vigenciaInicio: { lte: fim }, OR: [{ vigenciaFim: null }, { vigenciaFim: { gte: inicio } }] },
    orderBy: { vigenciaInicio: 'desc' },
  })
  const metaPorTp = new Map<string, number>()
  for (const m of metas) if (!metaPorTp.has(m.tipoProcessoId)) metaPorTp.set(m.tipoProcessoId, Number(m.metaQuantidadeDia))

  const porTp = new Map<string, ResumoProcessoDTO>()
  for (const a of apts) {
    if (a.tipo !== 'PRODUCAO') continue
    const key = a.tipoProcessoId ?? 'sem'
    let r = porTp.get(key)
    if (!r) {
      r = {
        tipoProcessoId: a.tipoProcessoId, tipoProcessoCodigo: a.tipoProcessoCodigo,
        base: baseContagem(a.tipoProcessoCodigo ?? ''), produzido: 0, valorRs: 0,
        metaQuantidade: a.tipoProcessoId ? metaPorTp.get(a.tipoProcessoId) ?? null : null,
        percentualAtingido: null,
      }
      porTp.set(key, r)
    }
    const q = Number(a.quantidadeProduzida)
    r.produzido += q
    r.valorRs += valorApontamento(a, q)
  }
  for (const r of porTp.values()) {
    r.valorRs = Math.round(r.valorRs * 100) / 100
    if (r.metaQuantidade && r.metaQuantidade > 0) {
      r.percentualAtingido = Math.round((r.produzido / r.metaQuantidade) * 10000) / 100
    }
  }
  return [...porTp.values()].sort((a, b) => (a.tipoProcessoCodigo ?? '').localeCompare(b.tipoProcessoCodigo ?? ''))
}

export interface SerieDiaDTO { data: string; produzido: number; valorRs: number }
export interface DiariaConsolidadaDTO {
  serie: SerieDiaDTO[]
  pico: SerieDiaDTO | null
  segundoMaior: SerieDiaDTO | null
  terceiroMaior: SerieDiaDTO | null
  mediaDiaria: number
  menorDia: SerieDiaDTO | null
}

/** Produção diária consolidada do mês com pico/2º/3º/média/menor (Req 5.2). */
export async function serieDiariaConsolidada(empresaId: string, ano: number, mes: number): Promise<DiariaConsolidadaDTO> {
  const { inicio, fim } = intervaloMes(ano, mes)
  const apts = await buscarApontamentosMes(empresaId, inicio, fim)
  const porDia = new Map<string, { produzido: number; valorRs: number }>()
  for (const a of apts) {
    if (a.tipo !== 'PRODUCAO') continue
    const dia = dataCivilBrasilia(a.dataHora)
    const s = porDia.get(dia) ?? { produzido: 0, valorRs: 0 }
    const q = Number(a.quantidadeProduzida)
    s.produzido += q
    s.valorRs += valorApontamento(a, q)
    porDia.set(dia, s)
  }
  const serie: SerieDiaDTO[] = [...porDia.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([data, v]) => ({ data, produzido: v.produzido, valorRs: Math.round(v.valorRs * 100) / 100 }))
  const ordenado = [...serie].sort((a, b) => b.produzido - a.produzido)
  const mediaDiaria = serie.length ? Math.round(serie.reduce((s, d) => s + d.produzido, 0) / serie.length) : 0
  return {
    serie,
    pico: ordenado[0] ?? null,
    segundoMaior: ordenado[1] ?? null,
    terceiroMaior: ordenado[2] ?? null,
    mediaDiaria,
    menorDia: ordenado.length ? ordenado[ordenado.length - 1] : null,
  }
}

export interface DadosCentroDiaDTO {
  centros: { id: string; descricao: string }[]
  dias: { data: string; porCentro: Record<string, number>; total: number }[]
  metaQuantidade: number | null
}

/** Matriz data × centro de um processo (Req 5.5). */
export async function dadosDiariosPorCentro(empresaId: string, ano: number, mes: number, tipoProcessoId: string): Promise<DadosCentroDiaDTO> {
  const { inicio, fim } = intervaloMes(ano, mes)
  const apts = (await buscarApontamentosMes(empresaId, inicio, fim)).filter((a) => a.tipoProcessoId === tipoProcessoId && a.tipo === 'PRODUCAO')
  const centrosMap = new Map<string, string>()
  const porDia = new Map<string, Record<string, number>>()
  for (const a of apts) {
    centrosMap.set(a.centroId, a.centroDescricao)
    const dia = dataCivilBrasilia(a.dataHora)
    const linha = porDia.get(dia) ?? {}
    linha[a.centroId] = (linha[a.centroId] ?? 0) + Number(a.quantidadeProduzida)
    porDia.set(dia, linha)
  }
  const centros = [...centrosMap.entries()].map(([id, descricao]) => ({ id, descricao })).sort((a, b) => a.descricao.localeCompare(b.descricao))
  const dias = [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([data, porCentro]) => ({
    data, porCentro, total: Object.values(porCentro).reduce((s, v) => s + v, 0),
  }))
  const meta = await prisma.metaProducaoProcesso.findFirst({
    where: { empresaId, tipoProcessoId, vigenciaInicio: { lte: fim }, OR: [{ vigenciaFim: null }, { vigenciaFim: { gte: inicio } }] },
    orderBy: { vigenciaInicio: 'desc' },
  })
  return { centros, dias, metaQuantidade: meta ? Number(meta.metaQuantidadeDia) : null }
}

// `minutos` = total de minutos de parada do motivo no período (pedido do Caio:
// "Acerto de Máquina – 500 min em Outubro"). `ocorrencias` = nº de paradas
// (mantido para contexto). Ordenação por minutos (desc).
export interface ParetoItemDTO { codigo: string; descricao: string; minutos: number; ocorrencias: number }

/**
 * Pareto de paradas do mês por código cadastrado (fallback motivoParada).
 * Soma o TOTAL DE MINUTOS por motivo (R4) + conta as ocorrências. Minutos nulos
 * contam como 0 na soma (a ocorrência ainda é contada). (Req 4.1–4.4)
 */
export async function paretoParadas(empresaId: string, ano: number, mes: number): Promise<ParetoItemDTO[]> {
  const { inicio, fim } = intervaloMes(ano, mes)
  const apts = (await buscarApontamentosMes(empresaId, inicio, fim)).filter((a) => a.tipo === 'PARADA')
  const codigos = await prisma.codigoParada.findMany({ where: { empresaId } })
  const descPorId = new Map(codigos.map((c) => [c.id, { codigo: c.codigo, descricao: c.descricao }]))
  return paretoParadasPuro(apts, descPorId)
}

/**
 * Núcleo PURO do Pareto (testável sem Prisma). Soma minutos por motivo e conta
 * ocorrências; ordena por minutos desc (empate → mais ocorrências).
 */
export function paretoParadasPuro(
  apts: Array<{ codigoParadaId?: string | null; motivoParada?: string | null; tempoParadaMinutos: number | null }>,
  descPorId: Map<string, { codigo: string; descricao: string }>,
): ParetoItemDTO[] {
  const cont = new Map<string, { codigo: string; descricao: string; minutos: number; n: number }>()
  for (const a of apts) {
    let codigo: string, descricao: string
    if (a.codigoParadaId && descPorId.has(a.codigoParadaId)) {
      const d = descPorId.get(a.codigoParadaId)!
      codigo = d.codigo; descricao = d.descricao
    } else {
      codigo = a.motivoParada ?? 'OUTRO'; descricao = a.motivoParada ?? 'Outro'
    }
    const k = `${codigo}::${descricao}`
    const e = cont.get(k) ?? { codigo, descricao, minutos: 0, n: 0 }
    const min = Number(a.tempoParadaMinutos)
    e.minutos += Number.isFinite(min) && min > 0 ? min : 0
    e.n++
    cont.set(k, e)
  }
  return [...cont.values()]
    .map((e) => ({ codigo: e.codigo, descricao: e.descricao, minutos: e.minutos, ocorrencias: e.n }))
    .sort((a, b) => b.minutos - a.minutos || b.ocorrencias - a.ocorrencias)
}

export interface OpsEmitidasDTO { ano: number; meses: number[] } // meses[0..11]

/** OPs emitidas por mês/ano (Req 5.6). */
export async function opsEmitidasPorMes(empresaId: string, anos: number[]): Promise<OpsEmitidasDTO[]> {
  const out: OpsEmitidasDTO[] = []
  for (const ano of anos) {
    const inicio = new Date(Date.UTC(ano, 0, 1, 3, 0, 0))
    const fim = new Date(Date.UTC(ano + 1, 0, 1, 3, 0, 0) - 1)
    const ops = await prisma.ordemProducao.findMany({
      where: { empresaId, criadoEm: { gte: inicio, lte: fim } },
      select: { criadoEm: true },
    })
    const meses = new Array(12).fill(0)
    for (const o of ops) {
      const mesKey = mesCivilBrasilia(o.criadoEm) // YYYY-MM
      const m = parseInt(mesKey.split('-')[1], 10) - 1
      if (m >= 0 && m < 12) meses[m]++
    }
    out.push({ ano, meses })
  }
  return out
}

export interface TrabalhoMaquinaDTO { opNumero: number | null; referenciaExterna: string | null; cliente: string | null; centroDescricao: string }

/** Trabalhos (OPs/clientes) em máquina num dia/centro (Req 5.8). */
export async function trabalhosEmMaquina(empresaId: string, dataIso: string, centroId?: string): Promise<TrabalhoMaquinaDTO[]> {
  const inicio = new Date(`${dataIso}T00:00:00-03:00`)
  const fim = new Date(`${dataIso}T23:59:59-03:00`)
  const rows = await prisma.apontamentoEtapa.findMany({
    where: {
      empresaId, tipo: 'PRODUCAO', dataHora: { gte: inicio, lte: fim },
      etapaOrdemProducao: {
        ordemProducao: { empresaId },
        ...(centroId ? { centroProducaoId: centroId } : {}),
        centroProducao: { status: true, disponivelProgramacao: true },
      },
    },
    select: {
      etapaOrdemProducao: {
        select: {
          centroProducao: { select: { descricao: true } },
          ordemProducao: { select: { numero: true, referenciaExterna: true, observacoes: true } },
        },
      },
    },
  })
  const vistos = new Set<string>()
  const out: TrabalhoMaquinaDTO[] = []
  for (const r of rows) {
    const op = r.etapaOrdemProducao?.ordemProducao
    const centro = r.etapaOrdemProducao?.centroProducao?.descricao ?? ''
    const chave = `${op?.numero}-${centro}`
    if (vistos.has(chave)) continue
    vistos.add(chave)
    // Cliente da tag [Cliente] em observacoes (padrão do PCP).
    const m = op?.observacoes?.match(/\[Cliente\]\s*(.+?)(?:\n|$)/)
    out.push({
      opNumero: op?.numero ?? null,
      referenciaExterna: op?.referenciaExterna ?? null,
      cliente: m ? m[1].trim() : null,
      centroDescricao: centro,
    })
  }
  return out
}

export interface ProducaoFinanceiraMaquinaDTO {
  centroId: string
  centroDescricao: string
  tipoProcessoCodigo: string | null
  base: 'UNIDADE' | 'TIRAGEM'
  produzido: number
  valorRs: number
  kgFabricado: number
}

/**
 * R$ por máquina + KG fabricado por máquina no mês (R7 — pedido #7 do Caio).
 * ACESSO RESTRITO (perfilGuard ADMIN/SUPERVISOR na rota; OPERADOR → 403).
 *
 * - R$: reusa a valorização por custo já usada no relatório gerencial
 *   (`valorApontamento`): custoHora × horas (velocidade) com fallback.
 * - KG: só para base TIRAGEM (folhas). O formato/gramatura vêm do PLANO da
 *   etapa (formato) e das observações da OP (tags [Formato]/[Bobina]). Quando
 *   faltam, o KG daquela máquina fica 0 (relatório segue — Req 7.6).
 * Isolamento por empresaId explícito da OP real.
 */
export async function producaoFinanceiraPorMaquina(
  empresaId: string,
  ano: number,
  mes: number,
): Promise<ProducaoFinanceiraMaquinaDTO[]> {
  const { inicio, fim } = intervaloMes(ano, mes)
  const rows = await prisma.apontamentoEtapa.findMany({
    where: {
      empresaId,
      tipo: 'PRODUCAO',
      dataHora: { gte: inicio, lte: fim },
      etapaOrdemProducao: {
        ordemProducao: { empresaId },
        centroProducao: { status: true, disponivelProgramacao: true },
      },
    },
    select: {
      quantidadeProduzida: true,
      setupDuracaoMinutos: true,
      etapaOrdemProducao: {
        select: {
          tempoOperacaoCalculado: true,
          plano: { select: { formato: true } },
          centroProducao: {
            select: {
              id: true, descricao: true, custoHora: true, velocidade: true,
              tipoProcesso: { select: { codigo: true } },
            },
          },
          ordemProducao: { select: { observacoes: true } },
        },
      },
    },
  })

  interface Acc {
    centroId: string
    centroDescricao: string
    tipoProcessoCodigo: string | null
    produzido: number
    valorRs: number
    kg: number
  }
  const porCentro = new Map<string, Acc>()

  for (const r of rows) {
    const etapa = r.etapaOrdemProducao
    const c = etapa?.centroProducao
    if (!c) continue
    const tipoProcessoCodigo = c.tipoProcesso?.codigo ?? null
    const base = baseContagem(tipoProcessoCodigo ?? '')
    const q = Number(r.quantidadeProduzida)

    // R$ por custo (mesma regra do relatório gerencial).
    const velocidade = c.velocidade != null ? Number(c.velocidade) : null
    const custoHora = c.custoHora != null ? Number(c.custoHora) : null
    const horas =
      horasPorVelocidade(q, velocidade) ??
      (etapa?.tempoOperacaoCalculado != null
        ? Number(etapa.tempoOperacaoCalculado)
        : r.setupDuracaoMinutos ?? 0) / 60
    const valorRs = valorizar({ tempoProdutivoHoras: horas, custoHora, quantidade: q })

    // KG: só faz sentido para base TIRAGEM (folhas).
    let kg = 0
    if (base === 'TIRAGEM') {
      const obs = etapa?.ordemProducao?.observacoes ?? null
      const fmt = parseFormatoMm(etapa?.plano?.formato ?? null) ?? parseFormatoMmTag(obs)
      const gramatura = parseGramatura(obs)
      if (fmt && gramatura) kg = kgFabricado(q, fmt.larguraMm, fmt.alturaMm, gramatura)
    }

    let acc = porCentro.get(c.id)
    if (!acc) {
      acc = { centroId: c.id, centroDescricao: c.descricao, tipoProcessoCodigo, produzido: 0, valorRs: 0, kg: 0 }
      porCentro.set(c.id, acc)
    }
    acc.produzido += q
    acc.valorRs += valorRs
    acc.kg += kg
  }

  return [...porCentro.values()]
    .map((a) => ({
      centroId: a.centroId,
      centroDescricao: a.centroDescricao,
      tipoProcessoCodigo: a.tipoProcessoCodigo,
      base: baseContagem(a.tipoProcessoCodigo ?? ''),
      produzido: a.produzido,
      valorRs: Math.round(a.valorRs * 100) / 100,
      kgFabricado: Math.round(a.kg * 100) / 100,
    }))
    .sort((a, b) => b.valorRs - a.valorRs)
}

/** Extrai o formato da tag [Formato] das observações da OP (ex.: "600 x 910"). */
function parseFormatoMmTag(obs: string | null): { larguraMm: number; alturaMm: number } | null {
  if (!obs) return null
  const m = obs.match(/\[Formato\]\s*(.+?)(?:\n|$)/)
  return m ? parseFormatoMm(m[1].trim()) : null
}
