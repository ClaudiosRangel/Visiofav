/**
 * Servico_Eventos — ponto de extensão da Fundação (spec comercial-pedido-status-fiel).
 *
 * Interface INTERNA do backend consumida pelos Modulos_Dependentes (Pré-Impressão
 * e Aprovação externa do cliente). Expõe duas operações:
 *
 *   registrarEvento(input)     -> grava um Evento_Pedido na Linha_do_Tempo SEM
 *                                 alterar Situacao_Interna nem Rodada (Req 10.4).
 *   solicitarTransicao(input)  -> valida pelo Motor_Status puro e grava a
 *                                 mudança de Situacao_Interna + Status_Macro +
 *                                 Setor + Responsavel_Desde + Evento_Pedido na
 *                                 MESMA transação (Req 10.3), com update
 *                                 condicional otimista por `versao` (D4).
 *
 * CONTRATOS / ERROS (StatusFielError):
 *   NAO_ENCONTRADO (404)        — Pedido inexistente ou de outra empresa (Req 10.7)
 *   EVENTO_INVALIDO (400)       — campo obrigatório/tamanho/formato inválido (Req 10.8)
 *   ESTADO_TRANSICAO_INVALIDA   — transição fora da tabela / destino = atual
 *   PEDIDO_TERMINAL (409)       — pedido em PERDIDO/CANCELADO
 *   MOTIVO_OBRIGATORIO (400)    — motivo ausente/≠[5..500] quando exigido
 *   RETORNO_INVALIDO (400)      — devolução não permitida
 *   IDEMPOTENCIA_CONFLITO (409) — chave reusada com parâmetros diferentes (Req 10.10)
 *
 * IDEMPOTÊNCIA (Req 10.9/10.10/10.11): a chave é gravada em
 * `log_pedido_proposta.idempotencia_chave` SOMENTE no sucesso (Req 10.8). Chamada
 * repetida com a mesma `(empresaId, idempotenciaChave)` e mesmos parâmetros
 * retorna o resultado anterior (`reaproveitado: true`); parâmetros diferentes →
 * IDEMPOTENCIA_CONFLITO. Concorrência com a mesma chave é resolvida pelo índice
 * único parcial `log_pedido_idempotencia_uq` (a 2ª inserção falha P2002 → relê).
 *
 * SITUACOES_INTERNAS RESERVADAS AOS PILARES (Req 10.13): a Pré-Impressão usará as
 * situações sob EM_PRE_IMPRESSAO (`PRE_IMPRESSAO_EM_ANDAMENTO`,
 * `PRE_IMPRESSAO_AGUARDA_INFO`); a Aprovação externa usará as de EM_APROVACAO
 * (`PROPOSTA_ENVIADA_AGUARDA_CLIENTE`, `APROVACAO_ARTE_PENDENTE`, `PROVA_PENDENTE`).
 * "Pedir ajuste" do cliente (Req 10.14) = solicitarTransicao com intencao
 * DEVOLVER para PRE_IMPRESSAO (abre nova Rodada).
 *
 * PERMISSÃO (Req 12.8): chamadas com `origem` começando por "modulo:" dispensam
 * a verificação de permissão de usuário — o chamador é interno ao Back.
 *
 * Isolamento multi-tenant: empresaId EXPLÍCITO em TODA query (Req 11.1/11.3).
 */
import { createHash } from 'node:crypto'
import { prisma } from '../../../lib/prisma'
import {
  StatusFielError,
  statusMacroDe,
  setorDe,
  estadoLegadoDe,
  validarTransicao,
  validarRetorno,
  classeDaTransicao,
  SITUACOES_VALIDAS,
  type Situacao,
  type Setor,
  type TipoPedido,
} from './status-fiel.motor'

const RE_TIPO_EVENTO = /^[A-Z0-9_]{1,60}$/
const MAX_DADOS_BYTES = 64 * 1024

// ============================================================================
// registrarEvento (Req 10.1 / 10.4 / 10.5)
// ============================================================================

export interface RegistrarEventoInput {
  empresaId: string
  pedidoId: string
  /** 1..60, /^[A-Z0-9_]{1,60}$/ (Req 10.5). */
  tipoEvento: string
  /** 1..60: "usuario:<id>" ou "modulo:<nome>". */
  origem: string
  /** serializável, <= 64 KB (Req 10.1). */
  dados?: unknown
  /** 0..500. */
  motivo?: string
  /** 1..100. */
  idempotenciaChave: string
}

export interface RegistrarEventoResult {
  eventoId: string
  reaproveitado: boolean
}

function validarCamposEvento(i: RegistrarEventoInput): void {
  if (!i.empresaId || !i.pedidoId) {
    throw new StatusFielError(400, 'empresaId e pedidoId são obrigatórios.', 'EVENTO_INVALIDO')
  }
  if (!i.tipoEvento || !RE_TIPO_EVENTO.test(i.tipoEvento)) {
    throw new StatusFielError(400, 'tipoEvento deve ter 1..60 chars [A-Z0-9_].', 'EVENTO_INVALIDO')
  }
  if (!i.origem || i.origem.length < 1 || i.origem.length > 60) {
    throw new StatusFielError(400, 'origem deve ter 1..60 caracteres.', 'EVENTO_INVALIDO')
  }
  if (i.motivo && i.motivo.length > 500) {
    throw new StatusFielError(400, 'motivo deve ter no máximo 500 caracteres.', 'EVENTO_INVALIDO')
  }
  if (!i.idempotenciaChave || i.idempotenciaChave.length < 1 || i.idempotenciaChave.length > 100) {
    throw new StatusFielError(400, 'idempotenciaChave deve ter 1..100 caracteres.', 'EVENTO_INVALIDO')
  }
  if (i.dados !== undefined) {
    let json: string
    try {
      json = JSON.stringify(i.dados)
    } catch {
      throw new StatusFielError(400, 'dados não é serializável.', 'EVENTO_INVALIDO')
    }
    if (Buffer.byteLength(json, 'utf8') > MAX_DADOS_BYTES) {
      throw new StatusFielError(400, 'dados excede 64 KB.', 'EVENTO_INVALIDO')
    }
  }
}

/** sha256 estável dos parâmetros que identificam a operação idempotente. */
function hashParams(obj: unknown): string {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex')
}

/** Resolve o Pedido por empresa (404 indistinguível — Req 10.7). */
async function carregarPedido(empresaId: string, pedidoId: string) {
  const p = await prisma.pedidoProposta.findFirst({
    where: { id: pedidoId, empresaId },
    select: {
      id: true,
      empresaId: true,
      situacaoInterna: true,
      versao: true,
      rodada: true,
      tipoPedidoDerivado: true,
      tipoPedido: true,
    },
  })
  if (!p) throw new StatusFielError(404, 'Pedido não encontrado.', 'NAO_ENCONTRADO')
  return p
}

function tipoDoPedido(p: { tipoPedidoDerivado: string | null; tipoPedido: string | null }): TipoPedido {
  const t = (p.tipoPedidoDerivado as TipoPedido | null) ?? null
  if (t === 'REPETICAO' || t === 'ALTERACAO' || t === 'PRODUTO_NOVO') return t
  // fallback do legado
  if (p.tipoPedido === 'REPETICAO') return 'REPETICAO'
  return 'PRODUTO_NOVO'
}

export async function registrarEvento(i: RegistrarEventoInput): Promise<RegistrarEventoResult> {
  validarCamposEvento(i)

  const hash = hashParams({ op: 'REGISTRAR_EVENTO', pedidoId: i.pedidoId, tipoEvento: i.tipoEvento })

  // idempotência: chave já usada?
  const existente = await prisma.logPedidoProposta.findFirst({
    where: { empresaId: i.empresaId, idempotenciaChave: i.idempotenciaChave },
    select: { id: true, dados: true },
  })
  if (existente) {
    const dadosAnt = (existente.dados ?? {}) as Record<string, unknown>
    if (dadosAnt.__hash !== hash) {
      throw new StatusFielError(409, 'Chave de idempotência reusada com parâmetros diferentes.', 'IDEMPOTENCIA_CONFLITO')
    }
    return { eventoId: existente.id, reaproveitado: true }
  }

  // pedido precisa existir e ser da empresa
  await carregarPedido(i.empresaId, i.pedidoId)

  try {
    const ev = await prisma.logPedidoProposta.create({
      data: {
        pedidoPropostaId: i.pedidoId,
        empresaId: i.empresaId,
        estadoAnterior: '',
        estadoNovo: '',
        usuarioId: i.origem,
        motivo: i.motivo ?? null,
        tipoEvento: i.tipoEvento,
        origem: i.origem,
        dados: { ...(i.dados && typeof i.dados === 'object' ? i.dados : { valor: i.dados }), __hash: hash } as object,
        idempotenciaChave: i.idempotenciaChave,
      },
      select: { id: true },
    })
    return { eventoId: ev.id, reaproveitado: false }
  } catch (e) {
    // colisão de idempotência concorrente (P2002) → relê e devolve o 1º
    if (isUniqueViolation(e)) {
      const vencedor = await prisma.logPedidoProposta.findFirst({
        where: { empresaId: i.empresaId, idempotenciaChave: i.idempotenciaChave },
        select: { id: true },
      })
      if (vencedor) return { eventoId: vencedor.id, reaproveitado: true }
    }
    throw e
  }
}

// ============================================================================
// solicitarTransicao (Req 10.2 / 10.3 / 10.6 / 10.14)
// ============================================================================

export interface SolicitarTransicaoInput {
  empresaId: string
  pedidoId: string
  /** destino por Situacao_Interna OU por setor (devolução). */
  destino: Situacao | { setor: Setor }
  /** 1..60: "usuario:<id>" ou "modulo:<nome>". */
  origem: string
  motivo?: string
  idempotenciaChave: string
  /** quando DEVOLVER, incrementa a Rodada (Req 10.6/10.14). */
  intencao?: 'DEVOLVER'
}

export interface SolicitarTransicaoResult {
  situacao: Situacao
  rodada: number
  eventoId: string
  reaproveitado: boolean
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002'
}

export async function solicitarTransicao(i: SolicitarTransicaoInput): Promise<SolicitarTransicaoResult> {
  if (!i.empresaId || !i.pedidoId) {
    throw new StatusFielError(400, 'empresaId e pedidoId são obrigatórios.', 'EVENTO_INVALIDO')
  }
  if (!i.origem || i.origem.length < 1 || i.origem.length > 60) {
    throw new StatusFielError(400, 'origem deve ter 1..60 caracteres.', 'EVENTO_INVALIDO')
  }
  if (!i.idempotenciaChave || i.idempotenciaChave.length < 1 || i.idempotenciaChave.length > 100) {
    throw new StatusFielError(400, 'idempotenciaChave deve ter 1..100 caracteres.', 'EVENTO_INVALIDO')
  }

  const ehDevolver = i.intencao === 'DEVOLVER'
  const hash = hashParams({
    op: 'SOLICITAR_TRANSICAO',
    pedidoId: i.pedidoId,
    destino: i.destino,
    intencao: i.intencao ?? null,
  })

  // idempotência prévia
  const existente = await prisma.logPedidoProposta.findFirst({
    where: { empresaId: i.empresaId, idempotenciaChave: i.idempotenciaChave },
    select: { id: true, dados: true, situacaoNova: true },
  })
  if (existente) {
    const dadosAnt = (existente.dados ?? {}) as Record<string, unknown>
    if (dadosAnt.__hash !== hash) {
      throw new StatusFielError(409, 'Chave de idempotência reusada com parâmetros diferentes.', 'IDEMPOTENCIA_CONFLITO')
    }
    const pedidoAtual = await carregarPedido(i.empresaId, i.pedidoId)
    return {
      situacao: (existente.situacaoNova as Situacao) ?? (pedidoAtual.situacaoInterna as Situacao),
      rodada: pedidoAtual.rodada,
      eventoId: existente.id,
      reaproveitado: true,
    }
  }

  // tenta aplicar (com 1 revalidação em caso de colisão de versão — Req 6.12/7.13)
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const pedido = await carregarPedido(i.empresaId, i.pedidoId)
    const atual = (pedido.situacaoInterna as Situacao) ?? 'TRIAGEM'
    const tipo = tipoDoPedido(pedido)

    // resolve destino + valida pelo motor puro
    let destinoSituacao: Situacao
    let setorOrigem = setorDe(atual)
    let setorDestino: Setor | null
    let classe: 'AVANCO' | 'RETORNO'

    if (ehDevolver || (typeof i.destino === 'object' && 'setor' in i.destino)) {
      const setorAlvo = typeof i.destino === 'object' && 'setor' in i.destino ? i.destino.setor : undefined
      if (!setorAlvo) {
        throw new StatusFielError(400, 'Devolução exige setor de destino.', 'RETORNO_INVALIDO')
      }
      destinoSituacao = validarRetorno(atual, setorAlvo, i.motivo ?? '')
      setorDestino = setorAlvo
      classe = 'RETORNO'
    } else {
      destinoSituacao = i.destino as Situacao
      if (!SITUACOES_VALIDAS.includes(destinoSituacao)) {
        throw new StatusFielError(400, 'Situação de destino desconhecida.', 'ESTADO_TRANSICAO_INVALIDA')
      }
      validarTransicao(atual, destinoSituacao, tipo, i.motivo)
      classe = classeDaTransicao(atual, destinoSituacao) ?? 'AVANCO'
      setorDestino = setorDe(destinoSituacao)
    }

    const statusMacro = statusMacroDe(destinoSituacao)
    const estadoLegado = estadoLegadoDe(destinoSituacao)
    const novaRodada = ehDevolver || classe === 'RETORNO' ? pedido.rodada + 1 : pedido.rodada

    try {
      const resultado = await prisma.$transaction(async (tx) => {
        // update condicional por versão (optimistic lock)
        const upd = await tx.pedidoProposta.updateMany({
          where: { id: i.pedidoId, empresaId: i.empresaId, versao: pedido.versao },
          data: {
            situacaoInterna: destinoSituacao,
            statusMacro,
            setorResponsavel: setorDestino,
            responsavelDesde: setorDestino !== setorOrigem ? new Date() : undefined,
            rodada: novaRodada,
            versao: { increment: 1 },
            estado: estadoLegado,
          },
        })
        if (upd.count === 0) return null // perdeu a corrida → revalidar

        const ev = await tx.logPedidoProposta.create({
          data: {
            pedidoPropostaId: i.pedidoId,
            empresaId: i.empresaId,
            estadoAnterior: estadoLegadoDe(atual),
            estadoNovo: estadoLegado,
            usuarioId: i.origem,
            motivo: i.motivo ?? null,
            tipoEvento: classe,
            setorOrigem,
            setorDestino,
            situacaoAnterior: atual,
            situacaoNova: destinoSituacao,
            origem: i.origem,
            dados: { __hash: hash } as object,
            idempotenciaChave: i.idempotenciaChave,
          },
          select: { id: true },
        })
        return { eventoId: ev.id, rodada: novaRodada }
      })

      if (resultado === null) continue // colisão de versão → relê e revalida

      return {
        situacao: destinoSituacao,
        rodada: resultado.rodada,
        eventoId: resultado.eventoId,
        reaproveitado: false,
      }
    } catch (e) {
      if (isUniqueViolation(e)) {
        // idempotência concorrente: outra chamada gravou a chave primeiro
        const vencedor = await prisma.logPedidoProposta.findFirst({
          where: { empresaId: i.empresaId, idempotenciaChave: i.idempotenciaChave },
          select: { id: true, situacaoNova: true },
        })
        const atualDepois = await carregarPedido(i.empresaId, i.pedidoId)
        if (vencedor) {
          return {
            situacao: (vencedor.situacaoNova as Situacao) ?? (atualDepois.situacaoInterna as Situacao),
            rodada: atualDepois.rodada,
            eventoId: vencedor.id,
            reaproveitado: true,
          }
        }
      }
      throw e
    }
  }

  // esgotou as revalidações: relê e falha com o erro adequado
  const final = await carregarPedido(i.empresaId, i.pedidoId)
  const atualFinal = (final.situacaoInterna as Situacao) ?? 'TRIAGEM'
  if (typeof i.destino !== 'object') {
    validarTransicao(atualFinal, i.destino as Situacao, tipoDoPedido(final), i.motivo)
  }
  throw new StatusFielError(409, 'Não foi possível aplicar a transição (concorrência).', 'ESTADO_TRANSICAO_INVALIDA')
}
