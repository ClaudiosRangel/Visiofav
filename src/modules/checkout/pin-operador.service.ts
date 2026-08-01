import bcrypt from 'bcryptjs'
import { prisma } from '../../lib/prisma'

/**
 * Hash e verificação do PIN de 6 dígitos do Operador (task 4.1 do spec
 * `checkout-apontamento`), e rate limiting de tentativas por Terminal
 * (task 4.2).
 *
 * Padrão de erro escolhido: classe de erro customizada `PinOperadorError`
 * com `statusCode` + `message`, seguindo o mesmo padrão já usado em
 * `EtapaOperacionalError` (`etapa-operacional.service.ts`, task 2.1 deste
 * mesmo spec) — quem chama `identificarOperadorPorPin` deve envolver a
 * chamada em `try/catch`, capturar `PinOperadorError` e responder com
 * `err.statusCode` + `{ message: err.message }`.
 *
 * IMPORTANTE — isolamento multi-tenant (Requirement 17.1): um PIN de 6
 * dígitos não é globalmente único entre empresas, só dentro da empresa do
 * Terminal. `identificarOperadorPorPin` SEMPRE filtra os candidatos por
 * `empresaId` antes de comparar qualquer hash — nunca comparar contra
 * todos os `Funcionario` do banco.
 *
 * IMPORTANTE — mensagem de erro genérica (Requirement 2.3): quando nenhum
 * `Funcionario` da empresa corresponde ao PIN informado, o erro retornado
 * é sempre o mesmo, independentemente de o PIN existir (com outro hash)
 * para um `Funcionario` de outra empresa — nunca revelar essa informação.
 *
 * Rate limiting por Terminal (Requirement 4): o design (seção "Rate
 * limiting e bloqueio") registra a decisão de reaproveitar
 * `SecurityAuditLog` com uma consulta agregada de tentativas
 * (`tipo = 'CHECKOUT_PIN_FALHA'`) nos últimos 15 minutos, em vez de criar
 * uma tabela dedicada — como `SecurityAuditLog` não tem coluna própria
 * para `sessaoTerminalId`, ele é guardado dentro de `detalhes` (JSON),
 * mesmo padrão de serialização já usado em
 * `sessao-terminal.service.ts#registrarTentativaNegada`.
 */

const SALT_ROUNDS = 10
const TIPO_TENTATIVA_FALHA = 'CHECKOUT_PIN_FALHA'
const LIMITE_TENTATIVAS = 5
const JANELA_BLOQUEIO_MS = 15 * 60 * 1000

export class PinOperadorError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
    this.name = 'PinOperadorError'
  }
}

export interface VerificacaoBloqueioTerminal {
  bloqueado: boolean
  tentativasRestantes?: number
  minutosRestantes?: number
}

/**
 * Extrai o `sessaoTerminalId` gravado dentro de `detalhes` (JSON) de uma
 * entrada de `SecurityAuditLog`. Retorna `null` se `detalhes` estiver
 * ausente ou não for um JSON válido — nunca lança exceção (dado é apenas
 * auxiliar para a agregação em memória feita pelo chamador).
 */
function extrairSessaoTerminalId(detalhes: string | null): string | null {
  if (!detalhes) return null
  try {
    const parsed = JSON.parse(detalhes) as { sessaoTerminalId?: unknown }
    return typeof parsed.sessaoTerminalId === 'string' ? parsed.sessaoTerminalId : null
  } catch {
    return null
  }
}

/**
 * Verifica se um Terminal (`sessaoTerminalId`) está bloqueado por excesso
 * de tentativas falhas de identificação de Operador (Requirement 4.1,
 * 4.3, 4.4).
 *
 * Conta as entradas de `SecurityAuditLog` do tipo `CHECKOUT_PIN_FALHA`
 * cujo `criadoEm` está dentro dos últimos 15 minutos E cujo `detalhes`
 * contém o `sessaoTerminalId` informado. Se houver 5 ou mais, o Terminal
 * está bloqueado — `minutosRestantes` é calculado a partir da tentativa
 * mais antiga da janela (é ela que, ao "sair" da janela de 15 minutos,
 * libera o bloqueio naturalmente, sem exigir nenhuma ação manual de
 * desbloqueio).
 */
export async function verificarBloqueioTerminal(
  sessaoTerminalId: string,
): Promise<VerificacaoBloqueioTerminal> {
  const agora = new Date()
  const inicioJanela = new Date(agora.getTime() - JANELA_BLOQUEIO_MS)

  const tentativasRecentes = await prisma.securityAuditLog.findMany({
    where: {
      tipo: TIPO_TENTATIVA_FALHA,
      criadoEm: { gte: inicioJanela },
    },
    select: { criadoEm: true, detalhes: true },
    orderBy: { criadoEm: 'asc' },
  })

  const tentativasDoTerminal = tentativasRecentes.filter(
    (t) => extrairSessaoTerminalId(t.detalhes) === sessaoTerminalId,
  )

  if (tentativasDoTerminal.length < LIMITE_TENTATIVAS) {
    return {
      bloqueado: false,
      tentativasRestantes: LIMITE_TENTATIVAS - tentativasDoTerminal.length,
    }
  }

  const tentativaMaisAntiga = tentativasDoTerminal[0].criadoEm
  const expiraEm = new Date(tentativaMaisAntiga.getTime() + JANELA_BLOQUEIO_MS)
  const minutosRestantes = Math.max(1, Math.ceil((expiraEm.getTime() - agora.getTime()) / 60000))

  return { bloqueado: true, minutosRestantes }
}

/**
 * Registra uma tentativa falha de identificação de Operador por PIN no
 * `SecurityAuditLog` (Requirement 4.2), guardando o `sessaoTerminalId`
 * dentro de `detalhes` (JSON) — `SecurityAuditLog` não tem coluna própria
 * para o Terminal.
 *
 * Best-effort: uma falha ao registrar a auditoria não deve impedir a
 * resposta de erro já decidida por quem chamou (mesmo padrão de
 * `sessao-terminal.service.ts#registrarTentativaNegada`).
 */
export async function registrarTentativaFalha(
  sessaoTerminalId: string,
  ip: string,
  userAgent?: string,
): Promise<void> {
  try {
    await prisma.securityAuditLog.create({
      data: {
        tipo: TIPO_TENTATIVA_FALHA,
        ip,
        userAgent,
        detalhes: JSON.stringify({ sessaoTerminalId }),
      },
    })
  } catch (err) {
    console.error('[Checkout] Erro ao registrar tentativa falha de PIN no SecurityAuditLog:', err)
  }
}

/**
 * Gera o hash do PIN do Operador para persistir em `Funcionario.pinHash`.
 * Nunca armazenar o PIN em texto puro.
 */
export async function criarHashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, SALT_ROUNDS)
}

/**
 * Identifica um Operador (`Funcionario`) a partir do PIN digitado no
 * Terminal, restrito à empresa da Sessão_Terminal.
 *
 * Busca todos os `Funcionario` ativos (`status: true`, `pinAtivo: true`,
 * `pinHash` não nulo) da empresa informada e compara o hash do PIN de cada
 * candidato com `bcrypt.compare` — não há como comparar hash diretamente
 * num `WHERE` SQL. O volume de funcionários por empresa não é grande o
 * suficiente para essa iteração em memória ser um problema de performance
 * neste ERP.
 *
 * Antes de tentar validar o PIN, verifica se o Terminal (`sessaoTerminalId`)
 * está bloqueado por excesso de tentativas falhas (Requirement 4.3) — se
 * estiver, lança `PinOperadorError` 429 com o tempo restante, sem nem
 * chegar a consultar os candidatos.
 *
 * Retorna `{ funcionarioId, nome }` do primeiro `Funcionario` cujo hash
 * corresponde ao PIN. Se nenhum corresponder, registra a tentativa falha
 * (Requirement 4.2) e lança `PinOperadorError` com mensagem genérica (401),
 * sem revelar se o PIN existe para outro `Funcionario` — inclusive de
 * outra empresa.
 *
 * `sessaoTerminalId` é obrigatório (é a chave de agregação do rate
 * limiting); `ip`/`userAgent` são opcionais e recebem fallback `'unknown'`
 * ao registrar a tentativa falha — mesmo padrão de
 * `sessao-terminal.service.ts#registrarTentativaNegada`, já que
 * `SecurityAuditLog.ip` é `String` obrigatório no schema.
 */
export async function identificarOperadorPorPin(
  empresaId: string,
  pin: string,
  sessaoTerminalId: string,
  ip?: string,
  userAgent?: string,
): Promise<{ funcionarioId: string; nome: string }> {
  const bloqueio = await verificarBloqueioTerminal(sessaoTerminalId)
  if (bloqueio.bloqueado) {
    throw new PinOperadorError(
      429,
      `Terminal bloqueado por excesso de tentativas. Tente novamente em ${bloqueio.minutosRestantes} minuto(s).`,
    )
  }

  const candidatos = await prisma.funcionario.findMany({
    where: {
      empresaId,
      status: true,
      pinAtivo: true,
      pinHash: { not: null },
    },
    select: { id: true, nome: true, pinHash: true },
  })

  for (const candidato of candidatos) {
    // pinHash nunca é null aqui (filtrado na query), mas o TypeScript não
    // sabe disso a partir do `where` — guarda defensiva sem custo real.
    if (!candidato.pinHash) continue

    const corresponde = await bcrypt.compare(pin, candidato.pinHash)
    if (corresponde) {
      return { funcionarioId: candidato.id, nome: candidato.nome }
    }
  }

  // Mensagem genérica — não revela se o PIN existe para outro Funcionario
  // (da mesma empresa ou de outra empresa). Ver Requirement 2.3, 17.1.
  await registrarTentativaFalha(sessaoTerminalId, ip || 'unknown', userAgent)
  throw new PinOperadorError(401, 'PIN inválido')
}
