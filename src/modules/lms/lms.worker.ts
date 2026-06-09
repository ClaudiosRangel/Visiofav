import { prisma } from '../../lib/prisma'

let workerInterval: NodeJS.Timeout | null = null

const LMS_ALERTA_NOME = 'LMS — Tempo Excedido 3x Meta'
const LMS_ALERTA_DESCRICAO = 'Alerta automático: tarefa em execução há mais de 3x o tempo meta'
const MULTIPLICADOR_ALERTA = 3

/**
 * Worker de alerta LMS para tarefas com tempo excedido.
 * Executa a cada 5 minutos:
 * - Busca OS em status EXECUTANDO com horaInicio preenchido
 * - Para cada OS, calcula o tempo decorrido
 * - Compara com a MetaOperacao do tipo de operação
 * - Se tempo > 3× meta → gera AlertaKpi com severidade WARNING
 */
export function startLmsWorker() {
  console.log('⚡ LMS Worker iniciado — verificação a cada 5 minutos')

  // Primeira execução após 20 segundos (dar tempo pro server carregar)
  setTimeout(() => {
    verificarAlertasTempo().catch((err) =>
      console.error('[LMS Worker] Erro na execução inicial:', err),
    )
  }, 20_000)

  workerInterval = setInterval(() => {
    verificarAlertasTempo().catch((err) =>
      console.error('[LMS Worker] Erro na execução periódica:', err),
    )
  }, 5 * 60 * 1000)
}

export function stopLmsWorker() {
  if (workerInterval) {
    clearInterval(workerInterval)
    workerInterval = null
    console.log('⚡ LMS Worker parado')
  }
}

/**
 * Busca ou cria a RegraKpi do tipo PRODUTIVIDADE/TEMPO_EXCEDIDO para a empresa.
 * Usada como referência para os alertas gerados pelo worker LMS.
 */
async function obterRegraLmsAlerta(empresaId: string): Promise<string> {
  // Buscar regra existente para esta empresa
  const regraExistente = await prisma.regraKpi.findFirst({
    where: {
      empresaId,
      entidade: 'PRODUTIVIDADE',
      condicao: 'TEMPO_EXCEDIDO',
      nome: LMS_ALERTA_NOME,
    },
    select: { id: true },
  })

  if (regraExistente) {
    return regraExistente.id
  }

  // Criar regra de referência para alertas LMS
  const novaRegra = await prisma.regraKpi.create({
    data: {
      empresaId,
      nome: LMS_ALERTA_NOME,
      descricao: LMS_ALERTA_DESCRICAO,
      entidade: 'PRODUTIVIDADE',
      condicao: 'TEMPO_EXCEDIDO',
      threshold: MULTIPLICADOR_ALERTA,
      unidade: 'MINUTOS',
      cooldownMinutos: 30,
      severidade: 'WARNING',
      acoes: ['NOTIFICACAO_APP'],
      destinatarios: [],
      ativo: true,
      criadoPorId: 'SYSTEM',
    },
  })

  return novaRegra.id
}

/**
 * Ciclo principal de verificação de alertas de tempo.
 */
export async function verificarAlertasTempo() {
  const inicio = Date.now()

  try {
    // Buscar todas as OS em execução com horaInicio definido
    const osExecutando = await prisma.ordemServicoWms.findMany({
      where: {
        status: 'EXECUTANDO',
        horaInicio: { not: null },
      },
      select: {
        id: true,
        empresaId: true,
        numero: true,
        operacao: true,
        horaInicio: true,
      },
    })

    if (osExecutando.length === 0) {
      return
    }

    // Agrupar por empresa para buscar metas de forma eficiente
    const osPorEmpresa = new Map<string, typeof osExecutando>()
    for (const os of osExecutando) {
      const lista = osPorEmpresa.get(os.empresaId) || []
      lista.push(os)
      osPorEmpresa.set(os.empresaId, lista)
    }

    let alertasGerados = 0

    for (const [empresaId, listaOs] of osPorEmpresa) {
      // Buscar todas as metas ativas da empresa
      const metas = await prisma.metaOperacao.findMany({
        where: { empresaId, ativo: true },
        select: {
          tipoOperacao: true,
          tempoMetaMinutos: true,
          categoriaProduto: true,
        },
      })

      if (metas.length === 0) {
        continue
      }

      // Criar mapa de meta por tipo de operação (priorizar meta genérica sem categoria)
      const metaPorOperacao = new Map<string, number>()
      for (const meta of metas) {
        // Usar meta genérica (sem categoria) como base
        // Se já existe uma meta para essa operação, manter a genérica (categoriaProduto = null)
        if (!meta.categoriaProduto || !metaPorOperacao.has(meta.tipoOperacao)) {
          metaPorOperacao.set(meta.tipoOperacao, Number(meta.tempoMetaMinutos))
        }
      }

      let regraKpiId: string | null = null

      for (const os of listaOs) {
        const tempoMetaMinutos = metaPorOperacao.get(os.operacao)

        // Se não há meta para esta operação → pular
        if (!tempoMetaMinutos) {
          continue
        }

        // Calcular tempo decorrido em minutos
        const agora = new Date()
        const tempoDecorridoMinutos =
          (agora.getTime() - os.horaInicio!.getTime()) / (1000 * 60)

        // Se tempo decorrido > 3 × meta → gerar alerta
        const limiteAlerta = MULTIPLICADOR_ALERTA * tempoMetaMinutos

        if (tempoDecorridoMinutos <= limiteAlerta) {
          continue
        }

        // Verificar cooldown — se já existe alerta ABERTO recente para esta OS
        const alertaExistente = await prisma.alertaKpi.findFirst({
          where: {
            empresaId,
            entidadeId: os.id,
            status: 'ABERTO',
            criadoEm: { gt: new Date(Date.now() - 30 * 60 * 1000) }, // cooldown 30 min
          },
        })

        if (alertaExistente) {
          continue
        }

        // Obter/criar regra de referência (lazy, uma vez por empresa)
        if (!regraKpiId) {
          regraKpiId = await obterRegraLmsAlerta(empresaId)
        }

        // Gerar alerta
        const mensagem =
          `Tarefa OS#${os.numero} está há ${Math.round(tempoDecorridoMinutos)} minutos ` +
          `(meta: ${tempoMetaMinutos} min) — tempo excedido em mais de 3x`

        await prisma.alertaKpi.create({
          data: {
            empresaId,
            regraKpiId,
            severidade: 'WARNING',
            valorAtual: Math.round(tempoDecorridoMinutos),
            threshold: limiteAlerta,
            entidadeId: os.id,
            mensagem,
            status: 'ABERTO',
          },
        })

        alertasGerados++
      }
    }

    if (alertasGerados > 0) {
      const duracao = ((Date.now() - inicio) / 1000).toFixed(2)
      console.log(
        `[LMS Worker] Ciclo concluído em ${duracao}s — ${alertasGerados} alerta(s) gerado(s).`,
      )
    }
  } catch (err) {
    console.error('[LMS Worker] Erro no ciclo de verificação:', err)
  }
}
