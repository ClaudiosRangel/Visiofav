import { prisma } from '../../lib/prisma'

let workerInterval: NodeJS.Timeout | null = null
let initialTimeout: NodeJS.Timeout | null = null

const INTERVALO_VERIFICACAO = 60 * 60 * 1000 // 1 hora
const DIAS_ANTES_VENCIMENTO = 30

/**
 * Worker do Portal 3PL — verifica contratos prestes a vencer
 * e gera notificações CONTRATO_VENCENDO para os usuários do portal.
 *
 * Executa a cada 1 hora com delay inicial de 70s.
 */
export function startPortalWorker() {
  console.log('🌐 Portal Worker iniciado — verificação a cada 1h')

  initialTimeout = setTimeout(() => {
    verificarContratosVencendo().catch((err) =>
      console.error('[Portal Worker] Erro na execução inicial:', err),
    )

    workerInterval = setInterval(() => {
      verificarContratosVencendo().catch((err) =>
        console.error('[Portal Worker] Erro na execução periódica:', err),
      )
    }, INTERVALO_VERIFICACAO)
  }, 70_000)
}

export function stopPortalWorker() {
  if (initialTimeout) { clearTimeout(initialTimeout); initialTimeout = null }
  if (workerInterval) { clearInterval(workerInterval); workerInterval = null }
  console.log('🌐 Portal Worker parado')
}

/**
 * Verifica contratos de armazenagem com vencimento nos próximos 30 dias
 * e cria notificações CONTRATO_VENCENDO para os usuários do portal do cliente.
 */
async function verificarContratosVencendo() {
  try {
    const agora = new Date()
    const limiteVencimento = new Date()
    limiteVencimento.setDate(limiteVencimento.getDate() + DIAS_ANTES_VENCIMENTO)

    // Buscar contratos ativos que vencem nos próximos 30 dias
    const contratos = await prisma.contratoArmazenagem.findMany({
      where: {
        status: 'ATIVO',
        dataFim: {
          gte: agora,
          lte: limiteVencimento,
        },
      },
      select: {
        id: true,
        empresaId: true,
        clienteId: true,
        numero: true,
        dataFim: true,
      },
    })

    if (contratos.length === 0) return

    let notificacoesCriadas = 0

    for (const contrato of contratos) {
      // Verificar se já existe notificação recente (últimas 24h) para este contrato
      const notificacaoExistente = await prisma.notificacaoPortal.findFirst({
        where: {
          empresaId: contrato.empresaId,
          clienteId: contrato.clienteId,
          tipo: 'CONTRATO_VENCENDO',
          referenciaId: contrato.id,
          criadoEm: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      })

      if (notificacaoExistente) continue

      // Buscar todos os usuários do portal deste cliente
      const usuarios = await prisma.portalUsuario.findMany({
        where: {
          empresaId: contrato.empresaId,
          clienteId: contrato.clienteId,
          status: 'ATIVO',
        },
        select: { id: true },
      })

      const diasRestantes = Math.ceil(
        (contrato.dataFim.getTime() - agora.getTime()) / (1000 * 60 * 60 * 24),
      )

      // Criar notificação para cada usuário do portal
      for (const usuario of usuarios) {
        await prisma.notificacaoPortal.create({
          data: {
            empresaId: contrato.empresaId,
            clienteId: contrato.clienteId,
            portalUsuarioId: usuario.id,
            tipo: 'CONTRATO_VENCENDO',
            titulo: 'Contrato próximo do vencimento',
            mensagem: `O contrato ${contrato.numero || contrato.id} vence em ${diasRestantes} dia(s) (${contrato.dataFim.toLocaleDateString('pt-BR')}).`,
            referenciaId: contrato.id,
            lida: false,
          },
        })
        notificacoesCriadas++
      }
    }

    if (notificacoesCriadas > 0) {
      console.log(`[Portal Worker] ${notificacoesCriadas} notificação(ões) de contrato criadas.`)
    }
  } catch (err) {
    console.error('[Portal Worker] Erro ao verificar contratos:', err)
  }
}
