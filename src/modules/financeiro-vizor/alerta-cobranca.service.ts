/**
 * Service de alerta de cobrança do Financeiro Vizor (billing do SaaS).
 *
 * Dispara o alerta de inadimplência para os ADMINs da empresa devedora,
 * reusando o módulo de notificação EXISTENTE (`Notificacao` +
 * `NotificacaoDestinatario`, o mesmo sino consumido por
 * `notificacao.routes.ts`). Chamado pelo job diário de recálculo quando uma
 * empresa atinge o limiar de dias em atraso (Req 6.6, 6.8, 6.9).
 *
 * IDEMPOTÊNCIA (Req 6.10): no máximo UMA notificação por dia por
 * [empresaId, tipoAlerta, dataEnvio]. Garantida pela unique
 * `@@unique([empresaId, tipoAlerta, dataEnvio])` de `ControleAlertaCobranca`:
 * tentamos criar o registro de controle PRIMEIRO; se o Postgres rejeitar por
 * violação de unicidade (P2002), o alerta já foi enviado hoje e nada mais é
 * feito. Só quando o controle é criado com sucesso a `Notificacao` é gerada,
 * ambos dentro da mesma transação (atômico).
 *
 * ISOLAMENTO (Req 10.4): o alerta contém APENAS dados da própria empresa
 * devedora (`empresaId`) — os destinatários são exclusivamente os usuários
 * ADMIN vinculados a ESSA empresa, e a `Notificacao` é gravada com o
 * `empresaId` da devedora. Nunca há dado de terceiros no alerta. Usa o Prisma
 * GLOBAL (módulo de controle do SUPER_ADMIN), com filtro explícito por
 * `empresaId` em toda query.
 *
 * Ver design em `.kiro/specs/financeiro-vizor/design.md`
 * (Components and Interfaces item 6).
 */

import { Prisma } from '@prisma/client'

import { prisma } from '../../lib/prisma'
import { DIAS_BLOQUEIO } from './financeiro.types'
import type { StatusFinanceiro } from './financeiro.types'

/**
 * Tipo do alerta gravado em `ControleAlertaCobranca.tipoAlerta` e usado na
 * chave de idempotência diária.
 */
type TipoAlerta = 'ALERTA_10D' | 'SOMENTE_LEITURA_30D'

/** Remetente sintético do sistema para o alerta automático de cobrança. */
const REMETENTE_SISTEMA = 'SISTEMA_FINANCEIRO_VIZOR'

/**
 * Formata uma data como "YYYY-MM-DD" (dia do envio), usada na chave de
 * idempotência diária. Deriva do `agora` recebido (sem relógio global) e usa
 * os componentes UTC para ser determinístico e estável.
 */
function formatarDataEnvio(agora: Date): string {
  const ano = agora.getUTCFullYear().toString().padStart(4, '0')
  const mes = (agora.getUTCMonth() + 1).toString().padStart(2, '0')
  const dia = agora.getUTCDate().toString().padStart(2, '0')
  return `${ano}-${mes}-${dia}`
}

/**
 * Decide o tipo de alerta a partir dos dias em atraso. A partir do limiar de
 * bloqueio (30 dias) o alerta é de somente-leitura; entre o limiar de alerta e
 * o de bloqueio é o alerta comum de 10 dias.
 */
function determinarTipoAlerta(diasEmAtraso: number): TipoAlerta {
  return diasEmAtraso >= DIAS_BLOQUEIO ? 'SOMENTE_LEITURA_30D' : 'ALERTA_10D'
}

/**
 * Monta o título e a mensagem do alerta, contendo apenas dados da própria
 * empresa devedora (dias em atraso) — nunca dados de terceiros.
 */
function montarConteudo(diasEmAtraso: number, tipoAlerta: TipoAlerta): {
  titulo: string
  mensagem: string
} {
  if (tipoAlerta === 'SOMENTE_LEITURA_30D') {
    return {
      titulo: 'Acesso em modo somente-visualização por inadimplência',
      mensagem:
        `Sua empresa está com faturas em atraso há ${diasEmAtraso} dias. ` +
        'O acesso foi limitado ao modo somente-visualização. Regularize o ' +
        'pagamento para restabelecer o acesso completo.',
    }
  }
  return {
    titulo: 'Fatura em atraso',
    mensagem:
      `Sua empresa possui fatura(s) em atraso há ${diasEmAtraso} dias. ` +
      'Regularize o pagamento para evitar o bloqueio do acesso.',
  }
}

/**
 * Cria a `Notificacao` (tipo `ALERTA`, `empresaId` da devedora) + os
 * `NotificacaoDestinatario` para os ADMINs da empresa, no máximo 1x/dia por
 * tipo/empresa via `ControleAlertaCobranca` (Req 6.6, 6.8, 6.9, 6.10, 10.4).
 *
 * Não faz nada quando:
 * - a empresa está `INATIVADO` (o job não alerta empresas inativadas — Req 6.9);
 * - já houve alerta do mesmo tipo hoje (idempotência diária — Req 6.10);
 * - a empresa não tem nenhum ADMIN ativo (não há a quem notificar).
 */
export async function enviarAlertaSeNecessario(params: {
  empresaId: string
  diasEmAtraso: number
  status: StatusFinanceiro
  agora: Date
}): Promise<void> {
  const { empresaId, diasEmAtraso, status, agora } = params

  // Empresas inativadas não recebem alerta de cobrança pelo job (Req 6.9).
  if (status === 'INATIVADO') return

  const tipoAlerta = determinarTipoAlerta(diasEmAtraso)
  const dataEnvio = formatarDataEnvio(agora)

  // Destinatários: SOMENTE os ADMINs ativos DESTA empresa (isolamento — Req 10.4).
  const vinculos = await prisma.usuarioEmpresa.findMany({
    where: {
      empresaId,
      usuario: { perfil: 'ADMIN', status: true },
    },
    select: { usuarioId: true },
  })

  const usuarioIds = [...new Set(vinculos.map((v) => v.usuarioId))]

  // Sem ADMIN ativo para notificar: nada a fazer.
  if (usuarioIds.length === 0) return

  const { titulo, mensagem } = montarConteudo(diasEmAtraso, tipoAlerta)

  try {
    await prisma.$transaction(async (tx) => {
      // Registro de controle PRIMEIRO: a unique
      // [empresaId, tipoAlerta, dataEnvio] é o guard de idempotência diária.
      // Se já existe (P2002), a transação aborta e o catch abaixo silencia.
      await tx.controleAlertaCobranca.create({
        data: { empresaId, tipoAlerta, dataEnvio },
      })

      // Só chega aqui na PRIMEIRA vez do dia: cria a notificação + destinatários.
      await tx.notificacao.create({
        data: {
          empresaId, // dado exclusivo da própria empresa devedora (Req 10.4)
          remetenteId: REMETENTE_SISTEMA,
          tipo: 'ALERTA',
          titulo,
          mensagem,
          destinatarios: {
            create: usuarioIds.map((usuarioId) => ({ usuarioId })),
          },
        },
      })
    })
  } catch (erro) {
    // Violação da unique de controle => alerta já enviado hoje (idempotência).
    // Qualquer outra causa é repropagada para o job tratar/registrar.
    if (
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === 'P2002'
    ) {
      return
    }
    throw erro
  }
}
