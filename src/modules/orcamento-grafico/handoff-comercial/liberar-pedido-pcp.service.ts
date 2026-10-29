/**
 * Liberação do Pedido para o PCP (R7 — spec orcamento-grafico-handoff-comercial).
 *
 * Quando o comercial libera um pedido vindo de orçamento gráfico, este serviço:
 *   1. valida a trava de AMOSTRA (se exigida e não aprovada → bloqueia);
 *   2. confirma o pedido (RASCUNHO → CONFIRMADO);
 *   3. emite a(s) OP(s) a partir dos ITENS do orçamento de origem — a OP já
 *      nasce completa (planos/etapas/materiais) via `emitirOpEmLote`, que é o
 *      mecanismo nativo existente (R7.3 já atendido por ele).
 *
 * Isolamento por `empresaId` explícito.
 */
import bcrypt from 'bcryptjs'
import { prisma } from '../../../lib/prisma'
import { liberacaoPermitidaPorAmostra } from './amostra.service'
import { emitirOpEmLote } from '../orcamento-grafico-op.service'
import { criarNotificacaoComercial } from './notificacao-comercial.service'

export class LiberacaoError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) {
    super(message)
    this.name = 'LiberacaoError'
  }
}

// Perfis autorizados a assinar a liberação ao PCP (setor de orçamento/comercial).
const PERFIS_ASSINATURA = ['ADMIN', 'SUPER_ADMIN', 'SUPERVISOR']

/** Lê se a empresa exige assinatura na liberação (Parametro). Default TRUE. */
export async function exigeAssinaturaLiberacao(empresaId: string): Promise<boolean> {
  const p = await prisma.parametro.findFirst({
    where: { empresaId, chave: 'comercial.exigir-assinatura-liberacao' },
    select: { valor: true },
  })
  // Ausente = default true (exige). "false"/"NAO"/"0" desligam.
  if (!p) return true
  const v = (p.valor || '').trim().toLowerCase()
  return !['false', 'nao', 'não', '0', 'off'].includes(v)
}

/**
 * Valida a "assinatura do setor" = senha do próprio usuário + perfil permitido.
 * Lança LiberacaoError (401 senha, 403 perfil). Não loga a senha.
 */
async function validarAssinaturaSetor(empresaId: string, usuarioId: string, senha?: string): Promise<string> {
  const usuario = await prisma.usuario.findFirst({
    where: { id: usuarioId },
    select: { id: true, nome: true, perfil: true, senha: true },
  })
  if (!usuario) throw new LiberacaoError(401, 'Usuário não encontrado')
  if (!usuario.perfil || !PERFIS_ASSINATURA.includes(usuario.perfil)) {
    throw new LiberacaoError(403, 'Seu perfil não tem permissão para liberar pedidos ao PCP.', 'SEM_PERMISSAO_LIBERACAO')
  }
  if (!senha) throw new LiberacaoError(401, 'Informe sua senha para assinar a liberação.', 'ASSINATURA_REQUERIDA')
  if (!bcrypt.compareSync(senha, usuario.senha)) {
    throw new LiberacaoError(401, 'Senha incorreta.', 'ASSINATURA_INVALIDA')
  }
  return usuario.nome
}

export interface ResultadoLiberacao {
  pedidoVendaId: string
  opsEmitidas: Array<{ itemId: string; status: string; numero?: number; motivo?: string }>
}

/**
 * Libera o pedido para o PCP (confirma + gera OPs). Idempotente quanto ao
 * status: se o pedido já está CONFIRMADO/adiante, apenas (re)emite as OPs
 * faltantes (a emissão por item é idempotente no `emitirOpDoCalculo`).
 */
export async function liberarPedidoParaPcp(
  empresaId: string,
  pedidoVendaId: string,
  usuarioId: string,
  opcoes?: { senha?: string },
): Promise<ResultadoLiberacao> {
  const pedido = await prisma.pedidoVenda.findFirst({
    where: { id: pedidoVendaId, empresaId },
    select: { id: true, status: true, exigeAmostra: true, orcamentoOrigemId: true },
  })
  if (!pedido) throw new LiberacaoError(404, 'Pedido não encontrado')
  if (pedido.status === 'CANCELADO') throw new LiberacaoError(400, 'Pedido cancelado não pode ser liberado')

  // Assinatura do setor (B6): senha do usuário + perfil permitido, se exigida.
  let assinadoPor: string | null = null
  if (await exigeAssinaturaLiberacao(empresaId)) {
    assinadoPor = await validarAssinaturaSetor(empresaId, usuarioId, opcoes?.senha)
  }

  // Trava de amostra (R5.6).
  const amostra = await liberacaoPermitidaPorAmostra(empresaId, {
    id: pedido.id,
    exigeAmostra: pedido.exigeAmostra,
    orcamentoOrigemId: pedido.orcamentoOrigemId,
  })
  if (!amostra.permitido) {
    throw new LiberacaoError(409, amostra.motivo || 'Amostra pendente', 'AMOSTRA_PENDENTE')
  }

  // Confirma o pedido (RASCUNHO → CONFIRMADO) se ainda não estiver.
  if (pedido.status === 'RASCUNHO') {
    await prisma.pedidoVenda.update({ where: { id: pedido.id }, data: { status: 'CONFIRMADO' } })
  }

  // Emite as OPs a partir dos itens do orçamento de origem (engenharia completa).
  let opsEmitidas: ResultadoLiberacao['opsEmitidas'] = []
  if (pedido.orcamentoOrigemId) {
    const itens = await prisma.itemOrcamentoGrafico.findMany({
      where: { orcamentoId: pedido.orcamentoOrigemId, empresaId },
      select: { id: true },
    })
    if (itens.length > 0) {
      const r = await emitirOpEmLote(itens.map((i) => i.id), {}, usuarioId, empresaId)
      opsEmitidas = r.map((x) => ({ itemId: x.itemId, status: x.status, numero: x.numero, motivo: x.motivo }))
    }
  }

  try {
    await criarNotificacaoComercial({
      empresaId,
      tipo: 'PEDIDO_LIBERADO_PCP',
      titulo: 'Pedido liberado para produção',
      mensagem: `O pedido foi confirmado e liberado para o PCP (${opsEmitidas.filter((o) => o.status === 'ok').length} OP(s) emitida(s))${assinadoPor ? ` — assinado por ${assinadoPor}` : ''}.`,
      referenciaTipo: 'PEDIDO_VENDA',
      referenciaId: pedido.id,
    })
  } catch {
    // não bloqueia
  }

  return { pedidoVendaId: pedido.id, opsEmitidas }
}
