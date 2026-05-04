import { prisma } from '../../lib/prisma'
import { createHmac } from 'crypto'

/**
 * Dispara webhooks para eventos do WMS.
 * Busca webhooks configurados para o evento na empresa e envia POST.
 * Implementa retry com backoff exponencial (1min, 5min, 30min).
 */
export async function dispararWebhook(empresaId: string, evento: string, dados: Record<string, unknown>) {
  const webhooks = await prisma.webhookConfig.findMany({
    where: { empresaId, ativo: true },
  })

  const webhooksDoEvento = webhooks.filter((w) =>
    w.eventos.split(',').map((e) => e.trim()).includes(evento),
  )

  for (const webhook of webhooksDoEvento) {
    // Buscar secret da API Key da empresa (usar primeira ativa)
    const apiKey = await prisma.apiKey.findFirst({
      where: { empresaId, revogada: false },
      select: { secret: true },
    })

    const payload = JSON.stringify({
      evento,
      timestamp: new Date().toISOString(),
      empresaId,
      dados,
    })

    const assinatura = apiKey
      ? createHmac('sha256', apiKey.secret).update(payload).digest('hex')
      : ''

    // Registrar entrega
    const entrega = await prisma.webhookEntrega.create({
      data: {
        webhookConfigId: webhook.id,
        evento,
        payload,
        tentativas: 0,
      },
    })

    // Enviar (fire-and-forget com retry)
    enviarComRetry(webhook.url, payload, assinatura, entrega.id, 0)
  }
}

async function enviarComRetry(url: string, payload: string, assinatura: string, entregaId: string, tentativa: number) {
  const MAX_TENTATIVAS = 3
  const DELAYS = [60000, 300000, 1800000] // 1min, 5min, 30min

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': assinatura,
      },
      body: payload,
      signal: AbortSignal.timeout(10000),
    })

    await prisma.webhookEntrega.update({
      where: { id: entregaId },
      data: {
        statusHttp: response.status,
        tentativas: tentativa + 1,
        sucesso: response.ok,
        ultimaTentativa: new Date(),
      },
    })

    if (!response.ok && tentativa < MAX_TENTATIVAS - 1) {
      setTimeout(() => enviarComRetry(url, payload, assinatura, entregaId, tentativa + 1), DELAYS[tentativa])
    }
  } catch {
    await prisma.webhookEntrega.update({
      where: { id: entregaId },
      data: {
        statusHttp: 0,
        tentativas: tentativa + 1,
        sucesso: false,
        ultimaTentativa: new Date(),
      },
    })

    if (tentativa < MAX_TENTATIVAS - 1) {
      setTimeout(() => enviarComRetry(url, payload, assinatura, entregaId, tentativa + 1), DELAYS[tentativa])
    }
  }
}
