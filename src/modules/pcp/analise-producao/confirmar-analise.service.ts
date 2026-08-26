/**
 * Serviço de Confirmação da Análise de Produção (Ponto 5).
 *
 * Orquestra as ações finais do painel de Análise de Produção:
 *  1. Reserva os materiais disponíveis (empenho)
 *  2. Gera sugestões de compra para os materiais em falta
 *  3. Registra a data de entrega calculada na OP
 *  4. Opcionalmente avança o status da OP para PROGRAMADA
 *
 * É o "Gerar Ordem de Produção" do painel — consolida os pontos 1-4.
 *
 * Referência: docs/visao-analise-pedido-para-op.md (Ponto 5)
 */

import { prisma } from '../../../lib/prisma'
import { criarReservasOp } from './reserva-producao.service'
import { gerarSugestoesCompra } from './sugestao-compra.service'
import { calcularDataEntrega } from './calculo-data-entrega.service'

export interface ResultadoConfirmacao {
  ordemProducaoId: string
  numero: number
  reservasCriadas: number
  sugestoesCompraCriadas: number
  dataEntregaCalculada: string | null
  statusAnterior: string
  statusNovo: string
  avisos: string[]
}

/**
 * Confirma a análise de uma OP: reserva materiais, gera compras da falta,
 * grava a data de entrega calculada e avança o status.
 *
 * @param opId ID da OP
 * @param empresaId empresa
 * @param usuarioId usuário que confirmou (para log)
 * @param opcoes { reservar, gerarCompras, avancarStatus }
 */
export async function confirmarAnalise(
  opId: string,
  empresaId: string,
  usuarioId: string,
  opcoes: { reservar?: boolean; gerarCompras?: boolean; avancarStatus?: boolean } = {},
): Promise<ResultadoConfirmacao> {
  const { reservar = true, gerarCompras = true, avancarStatus = true } = opcoes

  const op = await prisma.ordemProducao.findFirst({
    where: { id: opId, empresaId },
    select: { id: true, numero: true, status: true },
  })
  if (!op) {
    throw { statusCode: 404, message: 'Ordem de produção não encontrada' }
  }

  const avisos: string[] = []
  let reservasCriadas = 0
  let sugestoesCompraCriadas = 0
  let dataEntregaCalculada: string | null = null

  // 1. Reservar materiais disponíveis
  if (reservar) {
    try {
      const r = await criarReservasOp(opId, empresaId)
      reservasCriadas = r.reservasCriadas
      if (r.reservasIgnoradas > 0) {
        avisos.push(`${r.reservasIgnoradas} material(is) não reservado(s) (sem cadastro ou já reservado).`)
      }
    } catch (e: any) {
      avisos.push(`Falha ao reservar materiais: ${e.message || e}`)
    }
  }

  // 2. Gerar sugestões de compra da falta
  if (gerarCompras) {
    try {
      const s = await gerarSugestoesCompra(opId, empresaId)
      sugestoesCompraCriadas = s.sugestoesCriadas
    } catch (e: any) {
      avisos.push(`Falha ao gerar sugestões de compra: ${e.message || e}`)
    }
  }

  // 3. Calcular e gravar data de entrega
  try {
    const data = await calcularDataEntrega(opId, empresaId)
    dataEntregaCalculada = data.dataEntregaViavel
    // Grava a data prevista se ela ainda não existir (não sobrescreve manual)
    const opAtual = await prisma.ordemProducao.findUnique({
      where: { id: opId },
      select: { dataEntregaPrevista: true },
    })
    if (!opAtual?.dataEntregaPrevista) {
      await prisma.ordemProducao.update({
        where: { id: opId },
        data: { dataEntregaPrevista: new Date(data.dataEntregaViavel) },
      })
    }
    if (data.atendeDataDesejada === false) {
      avisos.push(`Atenção: entrega viável ${data.diasAtraso} dia(s) após a data desejada.`)
    }
  } catch (e: any) {
    avisos.push(`Falha ao calcular data de entrega: ${e.message || e}`)
  }

  // 4. Avançar status (RASCUNHO/PLANEJADA → PROGRAMADA)
  let statusNovo = op.status
  if (avancarStatus && (op.status === 'RASCUNHO' || op.status === 'PLANEJADA')) {
    // RASCUNHO precisa passar por PLANEJADA antes de PROGRAMADA
    const alvo = op.status === 'RASCUNHO' ? 'PLANEJADA' : 'PROGRAMADA'
    try {
      await prisma.ordemProducao.update({
        where: { id: opId },
        data: { status: alvo },
      })
      await prisma.logOrdemProducao.create({
        data: {
          ordemProducaoId: opId,
          statusAnterior: op.status,
          statusNovo: alvo,
          usuarioId,
          observacao: 'Transição via Análise de Produção (confirmação)',
        },
      })
      statusNovo = alvo
    } catch (e: any) {
      avisos.push(`Falha ao avançar status: ${e.message || e}`)
    }
  }

  return {
    ordemProducaoId: opId,
    numero: op.numero,
    reservasCriadas,
    sugestoesCompraCriadas,
    dataEntregaCalculada,
    statusAnterior: op.status,
    statusNovo,
    avisos,
  }
}
