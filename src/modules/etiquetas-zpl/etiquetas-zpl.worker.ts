import { prisma } from '../../lib/prisma'
import { enviarZplParaImpressora, testarConexaoImpressora } from './etiquetas-zpl.printer'
import { etiquetasZplService } from './etiquetas-zpl.service'

const MAX_TENTATIVAS = 3
const INTERVALO_FILA_MS = 2000
const INTERVALO_HEALTH_CHECK_MS = 5 * 60 * 1000 // 5 minutos

let filaIntervalId: ReturnType<typeof setInterval> | null = null
let healthCheckIntervalId: ReturnType<typeof setInterval> | null = null
let processando = false

/**
 * Inicia o worker de processamento da fila de impressão e o health-check de impressoras.
 */
export function iniciarEtiquetasWorker() {
  // Worker da fila de impressão — a cada 2 segundos
  filaIntervalId = setInterval(async () => {
    if (processando) return
    processando = true
    try {
      await processarProximoItemFila()
    } catch (err) {
      console.error('[EtiquetasWorker] Erro ao processar fila:', err)
    } finally {
      processando = false
    }
  }, INTERVALO_FILA_MS)

  // Health-check de impressoras — a cada 5 minutos
  healthCheckIntervalId = setInterval(async () => {
    try {
      await verificarSaudeImpressoras()
    } catch (err) {
      console.error('[EtiquetasWorker] Erro no health-check:', err)
    }
  }, INTERVALO_HEALTH_CHECK_MS)

  console.log('[EtiquetasWorker] Worker de impressão iniciado')
}

/**
 * Para o worker de processamento da fila de impressão.
 */
export function pararEtiquetasWorker() {
  if (filaIntervalId) {
    clearInterval(filaIntervalId)
    filaIntervalId = null
  }
  if (healthCheckIntervalId) {
    clearInterval(healthCheckIntervalId)
    healthCheckIntervalId = null
  }
  console.log('[EtiquetasWorker] Worker de impressão parado')
}

/**
 * Processa o próximo item PENDENTE da fila de impressão.
 * Ordenado por prioridade (URGENTE > NORMAL > BAIXA) e criadoEm.
 */
async function processarProximoItemFila() {
  // Buscar próximo item pendente (prioridade + criadoEm)
  const item = await prisma.filaImpressao.findFirst({
    where: { status: 'PENDENTE' },
    orderBy: [
      { prioridade: 'asc' }, // URGENTE < NORMAL < BAIXA em ordem alfa, mas ajustamos no raw
      { criadoEm: 'asc' },
    ],
  })

  if (!item) return

  // Reordenar por prioridade real: URGENTE primeiro
  const proximoItem = await prisma.filaImpressao.findFirst({
    where: { status: 'PENDENTE' },
    orderBy: [{ criadoEm: 'asc' }],
  })

  // Buscar com lógica correta de prioridade
  const itemUrgente = await prisma.filaImpressao.findFirst({
    where: { status: 'PENDENTE', prioridade: 'URGENTE' },
    orderBy: { criadoEm: 'asc' },
  })
  const itemNormal = !itemUrgente
    ? await prisma.filaImpressao.findFirst({
        where: { status: 'PENDENTE', prioridade: 'NORMAL' },
        orderBy: { criadoEm: 'asc' },
      })
    : null
  const itemBaixa = !itemUrgente && !itemNormal
    ? await prisma.filaImpressao.findFirst({
        where: { status: 'PENDENTE', prioridade: 'BAIXA' },
        orderBy: { criadoEm: 'asc' },
      })
    : null

  const itemParaProcessar = itemUrgente || itemNormal || itemBaixa
  if (!itemParaProcessar) return

  // Marcar como PROCESSANDO
  await prisma.filaImpressao.update({
    where: { id: itemParaProcessar.id },
    data: { status: 'PROCESSANDO' },
  })

  try {
    // Carregar template
    const template = await prisma.templateEtiqueta.findUnique({
      where: { id: itemParaProcessar.templateId },
    })
    if (!template) {
      await marcarComoFalha(itemParaProcessar.id, 'Template não encontrado')
      return
    }

    // Carregar impressora
    const impressora = await prisma.impressoraRede.findUnique({
      where: { id: itemParaProcessar.impressoraId },
    })
    if (!impressora) {
      await marcarComoFalha(itemParaProcessar.id, 'Impressora não encontrada')
      return
    }

    // Substituir placeholders
    const dadosVariaveis = (itemParaProcessar.dadosVariaveis as Record<string, string>) || {}
    const zplRenderizado = etiquetasZplService.substituirPlaceholders(
      template.codigoZpl,
      dadosVariaveis,
    )

    // Gerar ZPL para quantidade > 1 (repetir etiqueta)
    const zplFinal =
      itemParaProcessar.quantidade > 1
        ? Array(itemParaProcessar.quantidade).fill(zplRenderizado).join('\n')
        : zplRenderizado

    // Enviar ZPL para impressora via TCP
    const resultado = await enviarZplParaImpressora(impressora.ip, impressora.porta, zplFinal)

    if (resultado.sucesso) {
      await prisma.filaImpressao.update({
        where: { id: itemParaProcessar.id },
        data: {
          status: 'SUCESSO',
          processadoEm: new Date(),
          tentativas: itemParaProcessar.tentativas + 1,
        },
      })

      // Atualizar status da impressora como ONLINE
      await prisma.impressoraRede.update({
        where: { id: impressora.id },
        data: { status: 'ONLINE', ultimoCheck: new Date() },
      })
    } else {
      await tratarFalha(itemParaProcessar.id, itemParaProcessar.tentativas, resultado.erro || 'Erro desconhecido', itemParaProcessar.empresaId, itemParaProcessar.impressoraId)
    }
  } catch (err: any) {
    await tratarFalha(itemParaProcessar.id, itemParaProcessar.tentativas, err.message || 'Erro interno', itemParaProcessar.empresaId, itemParaProcessar.impressoraId)
  }
}

/**
 * Trata falha de impressão: retry ou marca como FALHA definitiva.
 * Se falha definitiva, tenta impressora alternativa na mesma zona.
 */
async function tratarFalha(
  filaItemId: string,
  tentativasAtuais: number,
  erro: string,
  empresaId: string,
  impressoraIdOriginal: string,
) {
  const novasTentativas = tentativasAtuais + 1

  if (novasTentativas < MAX_TENTATIVAS) {
    // Reenfileirar para retry
    await prisma.filaImpressao.update({
      where: { id: filaItemId },
      data: {
        status: 'PENDENTE',
        tentativas: novasTentativas,
        erro,
      },
    })
  } else {
    // Falha definitiva — tentar impressora alternativa na mesma zona
    const impressoraOriginal = await prisma.impressoraRede.findUnique({
      where: { id: impressoraIdOriginal },
    })

    if (impressoraOriginal?.zonaId) {
      const impressoraAlternativa = await prisma.impressoraRede.findFirst({
        where: {
          empresaId,
          zonaId: impressoraOriginal.zonaId,
          id: { not: impressoraIdOriginal },
          ativo: true,
          status: { not: 'ERRO' },
        },
      })

      if (impressoraAlternativa) {
        // Redirecionar para impressora alternativa com tentativas zeradas
        await prisma.filaImpressao.update({
          where: { id: filaItemId },
          data: {
            status: 'PENDENTE',
            impressoraId: impressoraAlternativa.id,
            tentativas: 0,
            erro: `Redirecionado de ${impressoraOriginal.nome} para ${impressoraAlternativa.nome}: ${erro}`,
          },
        })
        return
      }
    }

    // Sem impressora alternativa — falha definitiva
    await marcarComoFalha(filaItemId, erro)
  }
}

/**
 * Marca um item da fila como FALHA definitiva.
 */
async function marcarComoFalha(filaItemId: string, erro: string) {
  await prisma.filaImpressao.update({
    where: { id: filaItemId },
    data: {
      status: 'FALHA',
      erro,
      processadoEm: new Date(),
      tentativas: MAX_TENTATIVAS,
    },
  })
}

/**
 * Health-check: verifica conexão de todas as impressoras ativas.
 * Atualiza status e ultimoCheck.
 */
async function verificarSaudeImpressoras() {
  const impressoras = await prisma.impressoraRede.findMany({
    where: { ativo: true },
  })

  for (const impressora of impressoras) {
    try {
      const resultado = await testarConexaoImpressora(impressora.ip, impressora.porta)
      await prisma.impressoraRede.update({
        where: { id: impressora.id },
        data: {
          status: resultado.sucesso ? 'ONLINE' : 'OFFLINE',
          ultimoCheck: new Date(),
        },
      })
    } catch {
      await prisma.impressoraRede.update({
        where: { id: impressora.id },
        data: {
          status: 'ERRO',
          ultimoCheck: new Date(),
        },
      })
    }
  }
}
