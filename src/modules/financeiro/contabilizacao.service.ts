/**
 * Financeiro D4 (Contabilidade) — geração automática de lançamentos contábeis a
 * partir de eventos financeiros (provisão de título, liquidação/baixa).
 *
 * REGRA DE OURO: best-effort e NÃO-bloqueante. Se o de/para da categoria não
 * existir (ou não tiver as contas do evento), cria um lançamento PENDENTE (sem
 * partidas balanceadas) para classificação posterior; nunca lança erro que
 * interrompa o fluxo financeiro. Os chamadores ainda envolvem em try/catch.
 */
import type { PrismaClient } from '@prisma/client'
import { montarPartidas } from './contabil-core'

interface EventoContabil {
  categoriaId?: string | null
  valor: number
  data: Date
  historico: string
  refTipo?: string
  refId?: string
}

type FaseEvento = 'PROVISAO' | 'LIQUIDACAO'

async function contabilizar(prisma: PrismaClient, empresaId: string, fase: FaseEvento, ev: EventoContabil): Promise<void> {
  const valor = Math.abs(Number(ev.valor) || 0)
  if (valor <= 0) return

  let debitoId: string | null | undefined
  let creditoId: string | null | undefined

  if (ev.categoriaId) {
    const map = await prisma.mapeamentoContabil.findFirst({ where: { empresaId, categoriaId: ev.categoriaId } })
    if (map) {
      if (fase === 'PROVISAO') {
        debitoId = map.provisaoDebitoId
        creditoId = map.provisaoCreditoId
      } else {
        debitoId = map.liquidacaoDebitoId
        creditoId = map.liquidacaoCreditoId
      }
    }
  }

  // Sem de/para completo → lançamento PENDENTE para classificação posterior.
  if (!debitoId || !creditoId) {
    await prisma.lancamentoContabil.create({
      data: {
        empresaId,
        data: ev.data,
        historico: ev.historico,
        origem: fase,
        refTipo: ev.refTipo ?? null,
        refId: ev.refId ?? null,
        status: 'PENDENTE',
        valorPendente: valor,
      },
    })
    return
  }

  // Com de/para → lançamento balanceado (1 débito + 1 crédito).
  const partidas = montarPartidas(debitoId, creditoId, valor)
  await prisma.$transaction(async (tx) => {
    const lanc = await tx.lancamentoContabil.create({
      data: {
        empresaId,
        data: ev.data,
        historico: ev.historico,
        origem: fase,
        refTipo: ev.refTipo ?? null,
        refId: ev.refId ?? null,
        status: 'LANCADO',
      },
    })
    await tx.partidaContabil.createMany({
      data: partidas.map((p) => ({ lancamentoId: lanc.id, contaId: p.contaId, tipo: p.tipo, valor: p.valor })),
    })
  })
}

/** Provisão (competência): ex. despesa. Nunca lança — engole e loga em erro. */
export async function contabilizarProvisao(prisma: PrismaClient, empresaId: string, ev: EventoContabil): Promise<void> {
  try {
    await contabilizar(prisma, empresaId, 'PROVISAO', ev)
  } catch (e: any) {
    console.error('[contabilizacao] provisão falhou (não bloqueante):', e?.message)
  }
}

/** Liquidação (caixa): ex. pagamento. Nunca lança — engole e loga em erro. */
export async function contabilizarLiquidacao(prisma: PrismaClient, empresaId: string, ev: EventoContabil): Promise<void> {
  try {
    await contabilizar(prisma, empresaId, 'LIQUIDACAO', ev)
  } catch (e: any) {
    console.error('[contabilizacao] liquidação falhou (não bloqueante):', e?.message)
  }
}
