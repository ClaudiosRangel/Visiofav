/**
 * Aprovação de arte pelo cliente — I/O (spec comercial-aprovacao-arte-cliente).
 *
 * Gera/lista/cancela links (lado interno autenticado) e serve a leitura pública
 * + decisão (lado do cliente, por token). A decisão reflete no Pedido via o
 * Servico_Eventos da Fundação (sem alterar a máquina de estados).
 *
 * Isolamento: empresaId EXPLÍCITO no lado interno. No lado público, a
 * autorização é o próprio token (opaco/não-enumerável); grava-se sempre o
 * empresaId REAL do Pedido.
 */
import { randomUUID } from 'node:crypto'
import { prisma } from '../../../lib/prisma'
import {
  AprovacaoArteError,
  avaliarLink,
  calcularExpiracao,
  validarDecisao,
  type DecisaoCliente,
  type StatusLink,
} from './aprovacao-arte.motor'
import { registrarEvento, solicitarTransicao } from './servico-eventos.service'
import { isTerminal, type Situacao } from './status-fiel.motor'
import { publicarFichaDoPedido } from './pre-impressao.service'

function basePublica(): string {
  return (process.env.PUBLIC_WEB_URL || 'https://visiofav-front-wofr.vercel.app').replace(/\/+$/, '')
}

export interface GerarResult {
  token: string
  url: string
  expiraEm: Date
  reaproveitado: boolean
}

/** Gera (ou reusa) um link de aprovação para um pedido. `novo` força um novo. */
export async function gerarLink(
  empresaId: string,
  pedidoId: string,
  usuarioId: string,
  novo = false,
): Promise<GerarResult> {
  const pedido = await prisma.pedidoProposta.findFirst({
    where: { id: pedidoId, empresaId },
    select: { id: true },
  })
  if (!pedido) throw new AprovacaoArteError(404, 'Pedido não encontrado.', 'NAO_ENCONTRADO')

  const agora = new Date()

  if (novo) {
    await prisma.linkAprovacaoArte.updateMany({
      where: { empresaId, pedidoPropostaId: pedidoId, status: 'PENDENTE' },
      data: { status: 'CANCELADO' },
    })
  } else {
    // reuso de um PENDENTE não expirado
    const existente = await prisma.linkAprovacaoArte.findFirst({
      where: { empresaId, pedidoPropostaId: pedidoId, status: 'PENDENTE' },
      orderBy: { criadoEm: 'desc' },
      select: { token: true, expiraEm: true },
    })
    if (existente && avaliarLink('PENDENTE', existente.expiraEm, agora).estado === 'PENDENTE') {
      return {
        token: existente.token,
        url: `${basePublica()}/aprovar-arte/${existente.token}`,
        expiraEm: existente.expiraEm,
        reaproveitado: true,
      }
    }
  }

  const token = randomUUID()
  const expiraEm = calcularExpiracao(agora)
  await prisma.linkAprovacaoArte.create({
    data: { empresaId, pedidoPropostaId: pedidoId, token, status: 'PENDENTE', expiraEm, criadoPorId: usuarioId },
  })

  // Evento best-effort (não derruba a geração).
  try {
    await registrarEvento({
      empresaId,
      pedidoId,
      tipoEvento: 'LINK_APROVACAO_GERADO',
      origem: `usuario:${usuarioId}`,
      dados: { token },
      idempotenciaChave: `link-${token}`,
    })
  } catch (e) {
    console.error('⚠️ [aprovacao-arte] evento LINK_APROVACAO_GERADO falhou (ignorado):', (e as Error)?.message)
  }

  return { token, url: `${basePublica()}/aprovar-arte/${token}`, expiraEm, reaproveitado: false }
}

export interface LinkResumo {
  id: string
  tokenAbreviado: string
  status: StatusLink
  estado: string
  expiraEm: Date
  decididoEm: Date | null
  decididoNome: string | null
  url: string
}

export async function listarLinks(empresaId: string, pedidoId: string): Promise<LinkResumo[]> {
  const links = await prisma.linkAprovacaoArte.findMany({
    where: { empresaId, pedidoPropostaId: pedidoId },
    orderBy: { criadoEm: 'desc' },
    select: { id: true, token: true, status: true, expiraEm: true, decididoEm: true, decididoNome: true },
  })
  const agora = new Date()
  return links.map((l) => ({
    id: l.id,
    tokenAbreviado: `${l.token.slice(0, 8)}…`,
    status: l.status as StatusLink,
    estado: avaliarLink(l.status as StatusLink, l.expiraEm, agora).estado,
    expiraEm: l.expiraEm,
    decididoEm: l.decididoEm,
    decididoNome: l.decididoNome,
    url: `${basePublica()}/aprovar-arte/${l.token}`,
  }))
}

export async function cancelarLinksPendentes(empresaId: string, pedidoId: string): Promise<number> {
  const pedido = await prisma.pedidoProposta.findFirst({ where: { id: pedidoId, empresaId }, select: { id: true } })
  if (!pedido) throw new AprovacaoArteError(404, 'Pedido não encontrado.', 'NAO_ENCONTRADO')
  const r = await prisma.linkAprovacaoArte.updateMany({
    where: { empresaId, pedidoPropostaId: pedidoId, status: 'PENDENTE' },
    data: { status: 'CANCELADO' },
  })
  return r.count
}

// ============================================================================
// Lado público (por token)
// ============================================================================

export interface DadosPublicos {
  estado: string
  numero: number
  produto: string | null
  cliente: string | null
  imagens: Array<{ id: string; nome: string }>
  decididoEm: Date | null
  motivoAjuste: string | null
}

async function carregarPorToken(token: string) {
  const link = await prisma.linkAprovacaoArte.findUnique({
    where: { token },
    select: {
      id: true, empresaId: true, pedidoPropostaId: true, status: true, expiraEm: true,
      decididoEm: true, motivoAjuste: true,
    },
  })
  if (!link) throw new AprovacaoArteError(404, 'Link não encontrado.', 'NAO_ENCONTRADO')
  return link
}

export async function obterPublico(token: string): Promise<DadosPublicos> {
  const link = await carregarPorToken(token)
  const agora = new Date()
  const { estado } = avaliarLink(link.status as StatusLink, link.expiraEm, agora)

  const pedido = await prisma.pedidoProposta.findFirst({
    where: { id: link.pedidoPropostaId, empresaId: link.empresaId },
    select: {
      numero: true, produtoNome: true, tipoEmbalagem: true, clienteNome: true,
      anexos: { select: { id: true, nome: true, tipo: true }, orderBy: { criadoEm: 'asc' } },
    },
  })
  if (!pedido) throw new AprovacaoArteError(404, 'Pedido não encontrado.', 'NAO_ENCONTRADO')

  return {
    estado, // PENDENTE | EXPIRADO | APROVADA | AJUSTE_SOLICITADO | CANCELADO
    numero: pedido.numero,
    produto: pedido.produtoNome || pedido.tipoEmbalagem || null,
    cliente: pedido.clienteNome || null,
    imagens: (pedido.anexos || [])
      .filter((a) => (a.tipo || '').startsWith('image/'))
      .map((a) => ({ id: a.id, nome: a.nome })),
    decididoEm: link.decididoEm,
    motivoAjuste: link.motivoAjuste,
  }
}

export async function obterImagemPublica(token: string, anexoId: string): Promise<{ dados: Buffer; tipo: string; nome: string }> {
  const link = await carregarPorToken(token)
  const anexo = await prisma.anexoPedidoProposta.findFirst({
    where: { id: anexoId, pedidoPropostaId: link.pedidoPropostaId, empresaId: link.empresaId },
    select: { dados: true, tipo: true, nome: true },
  })
  if (!anexo) throw new AprovacaoArteError(404, 'Imagem não encontrada.', 'NAO_ENCONTRADO')
  return { dados: Buffer.from(anexo.dados), tipo: anexo.tipo, nome: anexo.nome }
}

export interface ResultadoDecisao {
  estado: string
  pedidoAtualizado: boolean
}

/**
 * Registra a decisão do cliente (APROVADA | AJUSTE_SOLICITADO). Idempotente a
 * reenvios: se o link já não está PENDENTE, retorna o estado atual. A decisão
 * é gravada primeiro (fonte da evidência); o status fiel é acionado best-effort.
 */
export async function decidir(
  token: string,
  decisao: DecisaoCliente,
  nome: string,
  motivo?: string,
  ip?: string,
): Promise<ResultadoDecisao> {
  const link = await carregarPorToken(token)
  const agora = new Date()

  // Idempotência: já respondido com a MESMA decisão → devolve o estado atual.
  if (link.status !== 'PENDENTE') {
    const estadoAtual = avaliarLink(link.status as StatusLink, link.expiraEm, agora).estado
    if (link.status === decisao) return { estado: estadoAtual, pedidoAtualizado: false }
    // status diferente (ou cancelado/expirado) → valida (vai lançar 409/410)
  }

  validarDecisao(link.status as StatusLink, link.expiraEm, agora, decisao, motivo)

  // Grava a decisão no Link (fonte da evidência).
  await prisma.linkAprovacaoArte.update({
    where: { id: link.id },
    data: {
      status: decisao,
      decididoEm: agora,
      decididoNome: nome?.slice(0, 160) || null,
      decididoIp: ip?.slice(0, 64) || null,
      motivoAjuste: decisao === 'AJUSTE_SOLICITADO' ? (motivo?.trim().slice(0, 500) ?? null) : null,
    },
  })

  // Reflete no status fiel do Pedido (best-effort — não reverte a decisão).
  let pedidoAtualizado = false
  try {
    // Se o pedido estiver terminal, não aplica transição (Req 4.4).
    const pedido = await prisma.pedidoProposta.findFirst({
      where: { id: link.pedidoPropostaId, empresaId: link.empresaId },
      select: { situacaoInterna: true },
    })
    const sit = (pedido?.situacaoInterna as Situacao) ?? null
    const terminal = sit ? isTerminal(sit) : false

    if (decisao === 'APROVADA') {
      await registrarEvento({
        empresaId: link.empresaId,
        pedidoId: link.pedidoPropostaId,
        tipoEvento: 'APROVACAO_ARTE',
        origem: 'modulo:aprovacao-cliente',
        dados: { forma: 'CLIENTE_LINK', nome, token },
        idempotenciaChave: `aprov-arte-${token}`,
      })
      if (!terminal) {
        await prisma.pedidoProposta.update({
          where: { id: link.pedidoPropostaId },
          data: { aprovacaoArteEm: agora, aprovacaoArteForma: 'CLIENTE_LINK' } as never,
        })
        pedidoAtualizado = true
        // Cliente aprovou a arte → a Ficha Master (rascunho) passa a valer no cadastro do produto.
        try {
          await publicarFichaDoPedido(link.empresaId, link.pedidoPropostaId)
        } catch (e) {
          console.error('⚠️ [aprovacao-arte] publicar ficha falhou (ignorado):', (e as Error)?.message)
        }
      }
    } else {
      // Pedir ajuste → devolve para a pré-impressão (nova rodada), se não terminal.
      if (!terminal) {
        await solicitarTransicao({
          empresaId: link.empresaId,
          pedidoId: link.pedidoPropostaId,
          destino: { setor: 'PRE_IMPRESSAO' },
          origem: 'modulo:aprovacao-cliente',
          motivo: motivo?.trim(),
          idempotenciaChave: `ajuste-arte-${token}`,
          intencao: 'DEVOLVER',
        })
        pedidoAtualizado = true
      } else {
        await registrarEvento({
          empresaId: link.empresaId,
          pedidoId: link.pedidoPropostaId,
          tipoEvento: 'AJUSTE_ARTE_CLIENTE',
          origem: 'modulo:aprovacao-cliente',
          dados: { token, motivo: motivo?.trim() },
          idempotenciaChave: `ajuste-arte-term-${token}`,
        })
      }
    }
  } catch (e) {
    console.error('⚠️ [aprovacao-arte] reflexo no status falhou (ignorado):', (e as Error)?.message)
  }

  return { estado: decisao, pedidoAtualizado }
}
