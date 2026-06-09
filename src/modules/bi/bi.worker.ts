import { prisma } from '../../lib/prisma'

// ===========================================================================
// INTERVALS
// ===========================================================================

const INTERVALO_SNAPSHOT = 24 * 60 * 60 * 1000   // 24h
const INTERVALO_CUSTO = 24 * 60 * 60 * 1000      // 24h
const INTERVALO_ALERTA = 6 * 60 * 60 * 1000      // 6h
const DELAY_INICIAL = 15_000                       // 15s para server carregar

let snapshotInterval: NodeJS.Timeout | null = null
let custoInterval: NodeJS.Timeout | null = null
let alertaInterval: NodeJS.Timeout | null = null
let snapshotTimeout: NodeJS.Timeout | null = null
let custoTimeout: NodeJS.Timeout | null = null
let alertaTimeout: NodeJS.Timeout | null = null

// ===========================================================================
// UNIFIED START/STOP
// ===========================================================================

export function startBiWorkers() {
  console.log('📊 BI Workers iniciados')

  // Snapshot daily (24h) - after 40s initial delay
  snapshotTimeout = setTimeout(() => {
    executarSnapshot().catch(console.error)
    snapshotInterval = setInterval(() => executarSnapshot().catch(console.error), INTERVALO_SNAPSHOT)
  }, 40_000)

  // Custo daily (24h) - after 50s
  custoTimeout = setTimeout(() => {
    executarCusto().catch(console.error)
    custoInterval = setInterval(() => executarCusto().catch(console.error), INTERVALO_CUSTO)
  }, 50_000)

  // Alerta correlação every 6h - after 60s
  alertaTimeout = setTimeout(() => {
    executarAlertaCorrelacao().catch(console.error)
    alertaInterval = setInterval(() => executarAlertaCorrelacao().catch(console.error), INTERVALO_ALERTA)
  }, 60_000)
}

export function stopBiWorkers() {
  if (snapshotTimeout) { clearTimeout(snapshotTimeout); snapshotTimeout = null }
  if (custoTimeout) { clearTimeout(custoTimeout); custoTimeout = null }
  if (alertaTimeout) { clearTimeout(alertaTimeout); alertaTimeout = null }
  if (snapshotInterval) { clearInterval(snapshotInterval); snapshotInterval = null }
  if (custoInterval) { clearInterval(custoInterval); custoInterval = null }
  if (alertaInterval) { clearInterval(alertaInterval); alertaInterval = null }
  console.log('📊 BI Workers parados')
}

// ===========================================================================
// SNAPSHOT WORKER — Calcula indicadores diários por empresa
// ===========================================================================

async function executarSnapshot() {
  try {
    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)

    const empresas = await prisma.empresa.findMany({ select: { id: true } })

    for (const { id: empresaId } of empresas) {
      // Idempotência: pular se já existe snapshot para hoje
      const existente = await prisma.snapshotBI.findFirst({
        where: { empresaId, data: hoje },
      })
      if (existente) continue

      // --- THROUGHPUT: sum LogMovimentacao tipo SAIDA hoje ---
      const fimDia = new Date(hoje)
      fimDia.setHours(23, 59, 59, 999)

      const throughputResult = await prisma.logMovimentacao.aggregate({
        where: {
          empresaId,
          tipo: 'SAIDA',
          criadoEm: { gte: hoje, lte: fimDia },
        },
        _sum: { quantidade: true },
      })
      const throughput = Number(throughputResult._sum.quantidade || 0)

      // --- ACURACIA: inventários sem divergência / total ---
      const inventariosConcluidos = await prisma.inventario.findMany({
        where: { empresaId, status: 'CONCLUIDO' },
        select: { id: true },
      })

      let acuracia = 0
      if (inventariosConcluidos.length > 0) {
        let semDivergencia = 0
        for (const inv of inventariosConcluidos) {
          const divergente = await prisma.itemInventario.count({
            where: { inventarioId: inv.id, status: 'DIVERGENTE' },
          })
          if (divergente === 0) semDivergencia++
        }
        acuracia = Number(((semDivergencia / inventariosConcluidos.length) * 100).toFixed(2))
      }

      // --- OCUPACAO: saldoEndereco count / enderecos count × 100 ---
      const [totalEnderecos, enderecosOcupados] = await Promise.all([
        prisma.endereco.count({ where: { empresaId } }),
        prisma.saldoEndereco.groupBy({
          by: ['enderecoId'],
          where: { empresaId, quantidade: { gt: 0 } },
        }),
      ])
      const ocupacao = totalEnderecos > 0
        ? Number(((enderecosOcupados.length / totalEnderecos) * 100).toFixed(2))
        : 0

      // --- PRODUTIVIDADE_MEDIA: avg RegistroProdutividade.indiceProdutividade ---
      const prodResult = await prisma.registroProdutividade.aggregate({
        where: { empresaId },
        _avg: { indiceProdutividade: true },
      })
      const produtividade = Number(prodResult._avg.indiceProdutividade || 0)

      // Criar snapshots
      const indicadores = [
        { indicador: 'THROUGHPUT', valor: throughput },
        { indicador: 'ACURACIA', valor: acuracia },
        { indicador: 'OCUPACAO', valor: ocupacao },
        { indicador: 'PRODUTIVIDADE_MEDIA', valor: produtividade },
      ]

      for (const { indicador, valor } of indicadores) {
        await prisma.snapshotBI.create({
          data: { empresaId, data: hoje, indicador, valor },
        })
      }
    }
  } catch (err) {
    console.error('[BI Snapshot Worker] Erro:', err)
  }
}

export function startSnapshotWorker() {
  console.log('📊 BI Snapshot Worker iniciado — execução a cada 24h')
  setTimeout(() => {
    executarSnapshot()
    setInterval(executarSnapshot, INTERVALO_SNAPSHOT)
  }, DELAY_INICIAL)
}

// ===========================================================================
// CUSTO WORKER — Calcula custos operacionais diários
// ===========================================================================

async function executarCusto() {
  try {
    // Ontem (dia completo)
    const ontem = new Date()
    ontem.setDate(ontem.getDate() - 1)
    ontem.setHours(0, 0, 0, 0)
    const fimOntem = new Date(ontem)
    fimOntem.setHours(23, 59, 59, 999)

    // Empresas com ConfigCusto
    const configs = await prisma.configCusto.findMany()

    for (const config of configs) {
      const empresaId = config.empresaId

      // OS concluídas ontem agrupadas por operação
      const osConcluidas = await prisma.ordemServicoWms.findMany({
        where: {
          empresaId,
          status: 'CONCLUIDO',
          horaFim: { gte: ontem, lte: fimOntem },
        },
        select: { id: true, operacao: true, horaInicio: true, horaFim: true },
      })

      // Agrupar por operação
      const porOperacao = new Map<string, typeof osConcluidas>()
      for (const os of osConcluidas) {
        const lista = porOperacao.get(os.operacao) || []
        lista.push(os)
        porOperacao.set(os.operacao, lista)
      }

      // Total de posições para custo de espaço
      const [totalEnderecos, enderecosUsados] = await Promise.all([
        prisma.endereco.count({ where: { empresaId } }),
        prisma.saldoEndereco.groupBy({
          by: ['enderecoId'],
          where: { empresaId, quantidade: { gt: 0 } },
        }),
      ])

      const custoEspacoDia = totalEnderecos > 0
        ? Number(((enderecosUsados.length / totalEnderecos) * Number(config.custoM2Mes) / 30).toFixed(2))
        : 0

      for (const [operacao, listaOS] of porOperacao) {
        // Calcular total de horas das OS
        let totalHoras = 0
        for (const os of listaOS) {
          if (os.horaInicio && os.horaFim) {
            const diffMs = new Date(os.horaFim).getTime() - new Date(os.horaInicio).getTime()
            totalHoras += diffMs / (1000 * 60 * 60)
          }
        }

        const custoMaoObra = Number((totalHoras * Number(config.custoHoraOperador)).toFixed(2))
        const custoEquipamento = Number((totalHoras * Number(config.custoHoraEquipamento) * Number(config.depreciacao) / 100).toFixed(2))
        const custoTotal = Number((custoMaoObra + custoEquipamento + custoEspacoDia).toFixed(2))
        const quantidadeOperacoes = listaOS.length
        const custoUnitario = quantidadeOperacoes > 0
          ? Number((custoTotal / quantidadeOperacoes).toFixed(4))
          : 0

        // Mapear operação de OS para tipoOperacao do CustoOperacao
        const tipoOperacao = mapOperacaoToTipo(operacao)

        // Upsert (idempotente por unique constraint)
        await prisma.custoOperacao.upsert({
          where: {
            empresaId_data_tipoOperacao: {
              empresaId,
              data: ontem,
              tipoOperacao,
            },
          },
          create: {
            empresaId,
            data: ontem,
            tipoOperacao,
            custoMaoObra,
            custoEquipamento,
            custoEspaco: custoEspacoDia,
            custoTotal,
            quantidadeOperacoes,
            custoUnitario,
          },
          update: {
            custoMaoObra,
            custoEquipamento,
            custoEspaco: custoEspacoDia,
            custoTotal,
            quantidadeOperacoes,
            custoUnitario,
          },
        })
      }
    }
  } catch (err) {
    console.error('[BI Custo Worker] Erro:', err)
  }
}

function mapOperacaoToTipo(operacao: string): string {
  const mapa: Record<string, string> = {
    CONFERENCIA: 'RECEBIMENTO',
    ENDERECAMENTO: 'ENDERECAMENTO',
    SEPARACAO: 'SEPARACAO',
    REPOSICAO: 'ENDERECAMENTO',
    MUDANCA_ENDERECO: 'ENDERECAMENTO',
    INVENTARIO: 'INVENTARIO',
  }
  return mapa[operacao] || 'EXPEDICAO'
}

export function startCustoWorker() {
  console.log('💰 BI Custo Worker iniciado — execução a cada 24h')
  setTimeout(() => {
    executarCusto()
    setInterval(executarCusto, INTERVALO_CUSTO)
  }, DELAY_INICIAL + 5_000) // +5s offset para não colidir com snapshot
}

// ===========================================================================
// ALERTA CORRELAÇÃO WORKER — Detecta anomalias e correlações
// ===========================================================================

async function executarAlertaCorrelacao() {
  try {
    const empresas = await prisma.empresa.findMany({ select: { id: true } })

    for (const { id: empresaId } of empresas) {
      // Últimos 3 dias
      const tresDiasAtras = new Date()
      tresDiasAtras.setDate(tresDiasAtras.getDate() - 3)
      tresDiasAtras.setHours(0, 0, 0, 0)

      // Últimos 30 dias (para média e desvio)
      const trintaDiasAtras = new Date()
      trintaDiasAtras.setDate(trintaDiasAtras.getDate() - 30)
      trintaDiasAtras.setHours(0, 0, 0, 0)

      const [snapshotsRecentes, snapshotsHistorico] = await Promise.all([
        prisma.snapshotBI.findMany({
          where: { empresaId, data: { gte: tresDiasAtras } },
        }),
        prisma.snapshotBI.findMany({
          where: { empresaId, data: { gte: trintaDiasAtras } },
        }),
      ])

      if (snapshotsHistorico.length === 0) continue

      // Calcular média e desvio padrão por indicador (30 dias)
      const indicadores = ['THROUGHPUT', 'ACURACIA', 'OCUPACAO', 'PRODUTIVIDADE_MEDIA']
      const stats = new Map<string, { media: number; stddev: number }>()

      for (const indicador of indicadores) {
        const valores = snapshotsHistorico
          .filter((s) => s.indicador === indicador)
          .map((s) => Number(s.valor))

        if (valores.length < 5) continue

        const media = valores.reduce((a, b) => a + b, 0) / valores.length
        const variancia = valores.reduce((acc, v) => acc + Math.pow(v - media, 2), 0) / valores.length
        const stddev = Math.sqrt(variancia)

        stats.set(indicador, { media, stddev })
      }

      // Médias recentes (últimos 3 dias)
      const mediasRecentes = new Map<string, number>()
      for (const indicador of indicadores) {
        const valores = snapshotsRecentes
          .filter((s) => s.indicador === indicador)
          .map((s) => Number(s.valor))
        if (valores.length > 0) {
          mediasRecentes.set(indicador, valores.reduce((a, b) => a + b, 0) / valores.length)
        }
      }

      // --- CORRELAÇÃO: throughput cai >15% E produtividade cai >10% ---
      const throughputStats = stats.get('THROUGHPUT')
      const prodStats = stats.get('PRODUTIVIDADE_MEDIA')
      const throughputRecente = mediasRecentes.get('THROUGHPUT')
      const prodRecente = mediasRecentes.get('PRODUTIVIDADE_MEDIA')

      if (throughputStats && prodStats && throughputRecente !== undefined && prodRecente !== undefined) {
        const quedaThroughput = throughputStats.media > 0
          ? ((throughputStats.media - throughputRecente) / throughputStats.media) * 100
          : 0
        const quedaProd = prodStats.media > 0
          ? ((prodStats.media - prodRecente) / prodStats.media) * 100
          : 0

        if (quedaThroughput > 15 && quedaProd > 10) {
          // Verificar se já existe alerta ABERTO similar recente (últimas 24h)
          const alertaExistente = await prisma.alertaCorrelacao.findFirst({
            where: {
              empresaId,
              tipo: 'CORRELACAO',
              status: 'ABERTO',
              criadoEm: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
            },
          })

          if (!alertaExistente) {
            await prisma.alertaCorrelacao.create({
              data: {
                empresaId,
                tipo: 'CORRELACAO',
                indicador1: 'THROUGHPUT',
                valor1: throughputRecente,
                indicador2: 'PRODUTIVIDADE_MEDIA',
                valor2: prodRecente,
                mensagem: `Queda correlacionada detectada: Throughput -${quedaThroughput.toFixed(1)}% e Produtividade -${quedaProd.toFixed(1)}% nos últimos 3 dias`,
                severidade: 'ALTA',
                status: 'ABERTO',
              },
            })
          }
        }
      }

      // --- ANOMALIA: qualquer indicador desvia >2 stddev ---
      for (const indicador of indicadores) {
        const indicadorStats = stats.get(indicador)
        const valorRecente = mediasRecentes.get(indicador)

        if (!indicadorStats || valorRecente === undefined) continue
        if (indicadorStats.stddev === 0) continue

        const desvios = Math.abs(valorRecente - indicadorStats.media) / indicadorStats.stddev

        if (desvios > 2) {
          // Verificar se já existe alerta ABERTO similar recente
          const alertaExistente = await prisma.alertaCorrelacao.findFirst({
            where: {
              empresaId,
              tipo: 'ANOMALIA',
              indicador1: indicador,
              status: 'ABERTO',
              criadoEm: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) },
            },
          })

          if (!alertaExistente) {
            const direcao = valorRecente > indicadorStats.media ? 'acima' : 'abaixo'
            await prisma.alertaCorrelacao.create({
              data: {
                empresaId,
                tipo: 'ANOMALIA',
                indicador1: indicador,
                valor1: valorRecente,
                mensagem: `Anomalia detectada: ${indicador} está ${desvios.toFixed(1)} desvios padrão ${direcao} da média (valor: ${valorRecente.toFixed(2)}, média: ${indicadorStats.media.toFixed(2)})`,
                severidade: desvios > 3 ? 'ALTA' : 'MEDIA',
                status: 'ABERTO',
              },
            })
          }
        }
      }
    }
  } catch (err) {
    console.error('[BI Alerta Correlação Worker] Erro:', err)
  }
}

export function startAlertaCorrelacaoWorker() {
  console.log('🔔 BI Alerta Correlação Worker iniciado — execução a cada 6h')
  setTimeout(() => {
    executarAlertaCorrelacao()
    setInterval(executarAlertaCorrelacao, INTERVALO_ALERTA)
  }, DELAY_INICIAL + 10_000) // +10s offset
}
