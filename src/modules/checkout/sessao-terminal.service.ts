import bcrypt from 'bcryptjs'
import { prisma } from '../../lib/prisma'

/**
 * Cria/gerencia a `SessaoTerminal` (Requirement 1) — sessão de turno que
 * vincula um Terminal do chão de fábrica a um `Centro_Producao`,
 * autenticada por um Supervisor (perfil `ADMIN`/`SUPERVISOR` do model
 * `Usuario`).
 *
 * Padrão de erro: classe de erro customizada `SessaoTerminalError` com
 * `statusCode` + `message`, seguindo o mesmo padrão já usado em
 * `EtapaOperacionalError` (`etapa-operacional.service.ts`, task 2.1 deste
 * spec) — o "caminho feliz" retorna o dado diretamente, e quem chama estas
 * funções (rotas) deve capturar `SessaoTerminalError` e responder com
 * `err.statusCode` + `{ message: err.message }`.
 *
 * Padrão de validação de credenciais: segue `validar-supervisor.service.ts`
 * (`src/modules/conferencia-entrada/`) — busca `Usuario` por email, exige
 * vínculo com a empresa via `UsuarioEmpresa`, exige perfil autorizado, e só
 * então valida a senha com bcrypt. Mensagens de erro são sempre genéricas
 * ("Credenciais inválidas") para não revelar qual campo especificamente
 * está incorreto (email inexistente vs senha errada vs sem vínculo com a
 * empresa) — mesma prática de `auth.routes.ts` (`POST /login`).
 *
 * Toda tentativa com credenciais inválidas OU perfil não autorizado é
 * registrada em `SecurityAuditLog` (Requirement 1.2, 1.3), com fallback
 * `'unknown'` para `ip`/`userAgent` quando não informados pelo chamador —
 * o schema exige `ip` como `String` obrigatório.
 */

export class SessaoTerminalError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
    this.name = 'SessaoTerminalError'
  }
}

const PERFIS_AUTORIZADOS = ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR']
const ERRO_CREDENCIAIS_INVALIDAS = 'Credenciais inválidas'
const ERRO_PERFIL_NAO_AUTORIZADO = 'Perfil não autorizado para autenticar um Terminal'
const DOZE_HORAS_MS = 12 * 60 * 60 * 1000

export interface CriarSessaoTerminalResult {
  sessaoTerminalId: string
  empresaId: string
  centroProducaoId: string
  autenticadaPorUsuarioId: string
  expiraEm: Date
}

/**
 * Registra, de forma best-effort, uma tentativa negada de criação de
 * Sessão_Terminal no `SecurityAuditLog`. Nunca lança exceção — uma falha
 * de auditoria não deve impedir a resposta de erro já decidida.
 */
async function registrarTentativaNegada(dados: {
  tipo: string
  usuarioId?: string
  email?: string
  ip: string
  userAgent: string
  detalhes?: Record<string, unknown>
}) {
  try {
    await prisma.securityAuditLog.create({
      data: {
        tipo: dados.tipo,
        usuarioId: dados.usuarioId,
        email: dados.email,
        ip: dados.ip,
        userAgent: dados.userAgent,
        detalhes: dados.detalhes ? JSON.stringify(dados.detalhes) : undefined,
      },
    })
  } catch (err) {
    console.error('[Checkout] Erro ao registrar tentativa negada de Sessão_Terminal no SecurityAuditLog:', err)
  }
}

/**
 * Valida as credenciais de um Supervisor (Usuario com perfil `ADMIN` ou
 * `SUPERVISOR`) vinculado à empresa informada, registrando toda tentativa
 * negada no `SecurityAuditLog`.
 *
 * Extraída de `criarSessaoTerminal` para ser reutilizada também por
 * `trocarCentroSessao` (Requirement 1.6, que exige nova autenticação de
 * Supervisor) — evita duplicar a sequência de validação (busca por email →
 * vínculo com a empresa via UsuarioEmpresa → senha via bcrypt → perfil
 * autorizado) em dois lugares.
 *
 * Retorna o `Usuario` autenticado em caso de sucesso, ou lança
 * `SessaoTerminalError` (401/403) em caso de falha.
 *
 * Exportada (além de reutilizada internamente por `trocarCentroSessao`)
 * para ser reaproveitada por `checkout.service.ts` na autorização de
 * conclusão de etapa fora da ordem de sequência (Requirement 9.4,
 * task 10.9) — mesma validação de Supervisor, sem duplicar a sequência
 * busca-por-email → vínculo com empresa → senha → perfil.
 */
export async function validarCredenciaisSupervisorTerminal(
  credenciais: { email: string; senha: string },
  empresaId: string,
  ip: string,
  userAgent: string,
) {
  // 1. Busca Usuario por email.
  const usuario = await prisma.usuario.findUnique({ where: { email: credenciais.email } })

  if (!usuario) {
    await registrarTentativaNegada({
      tipo: 'CHECKOUT_SESSAO_CREDENCIAIS_INVALIDAS',
      email: credenciais.email,
      ip,
      userAgent,
    })
    throw new SessaoTerminalError(401, ERRO_CREDENCIAIS_INVALIDAS)
  }

  // 2. Exige vínculo do Usuario com a empresa informada — um Supervisor só
  // pode autenticar um Terminal para uma empresa à qual ele pertence.
  const vinculo = await prisma.usuarioEmpresa.findFirst({
    where: { usuarioId: usuario.id, empresaId },
  })

  if (!vinculo) {
    await registrarTentativaNegada({
      tipo: 'CHECKOUT_SESSAO_CREDENCIAIS_INVALIDAS',
      usuarioId: usuario.id,
      email: credenciais.email,
      ip,
      userAgent,
    })
    throw new SessaoTerminalError(401, ERRO_CREDENCIAIS_INVALIDAS)
  }

  // 3. Valida senha com bcrypt (mesmo padrão de auth.routes.ts / validar-supervisor.service.ts).
  const senhaValida = await bcrypt.compare(credenciais.senha, usuario.senha)

  if (!senhaValida) {
    await registrarTentativaNegada({
      tipo: 'CHECKOUT_SESSAO_CREDENCIAIS_INVALIDAS',
      usuarioId: usuario.id,
      email: credenciais.email,
      ip,
      userAgent,
    })
    throw new SessaoTerminalError(401, ERRO_CREDENCIAIS_INVALIDAS)
  }

  // 4. Exige perfil ADMIN ou SUPERVISOR.
  if (!PERFIS_AUTORIZADOS.includes(usuario.perfil)) {
    await registrarTentativaNegada({
      tipo: 'CHECKOUT_SESSAO_PERFIL_NAO_AUTORIZADO',
      usuarioId: usuario.id,
      email: credenciais.email,
      ip,
      userAgent,
      detalhes: { perfil: usuario.perfil },
    })
    throw new SessaoTerminalError(403, ERRO_PERFIL_NAO_AUTORIZADO)
  }

  return usuario
}

/**
 * Cria uma nova `SessaoTerminal`, autenticando um Supervisor (Usuario com
 * perfil `ADMIN` ou `SUPERVISOR`) e vinculando-a a um `Centro_Producao` da
 * empresa informada.
 *
 * `ip`/`userAgent` são opcionais aqui porque esta função é pura de
 * negócio (sem depender de `FastifyRequest`) — a rota que a chamar (task
 * 8.1) deve extrair esses valores de `request.ip`/
 * `request.headers['user-agent']` e passá-los explicitamente.
 *
 * Requirements: 1.1, 1.2, 1.3
 */
export async function criarSessaoTerminal(
  credenciais: { email: string; senha: string },
  empresaId: string,
  centroProducaoId: string,
  ip?: string,
  userAgent?: string,
): Promise<CriarSessaoTerminalResult> {
  const ipRegistrado = ip || 'unknown'
  const userAgentRegistrado = userAgent || 'unknown'

  const usuario = await validarCredenciaisSupervisorTerminal(
    credenciais,
    empresaId,
    ipRegistrado,
    userAgentRegistrado,
  )

  // Valida que o Centro_Producao pertence à empresa informada.
  const centroProducao = await prisma.centroProducao.findFirst({
    where: { id: centroProducaoId, empresaId },
  })

  if (!centroProducao) {
    throw new SessaoTerminalError(404, 'Centro de produção não encontrado para esta empresa')
  }

  // Cria a SessaoTerminal (status ATIVA, expira em 12h).
  const agora = new Date()
  const expiraEm = new Date(agora.getTime() + DOZE_HORAS_MS)

  const sessaoTerminal = await prisma.sessaoTerminal.create({
    data: {
      empresaId,
      centroProducaoId,
      autenticadaPorUsuarioId: usuario.id,
      status: 'ATIVA',
      criadaEm: agora,
      expiraEm,
    },
  })

  return {
    sessaoTerminalId: sessaoTerminal.id,
    empresaId: sessaoTerminal.empresaId,
    centroProducaoId: sessaoTerminal.centroProducaoId,
    autenticadaPorUsuarioId: sessaoTerminal.autenticadaPorUsuarioId,
    expiraEm: sessaoTerminal.expiraEm,
  }
}

/**
 * Verifica se uma `SessaoTerminal` está ativa: `status === 'ATIVA'` E
 * `expiraEm` ainda não passou.
 *
 * Efeito colateral de expiração "lazy" (Requirement 1.5): se a sessão está
 * com `status === 'ATIVA'` mas `expiraEm` já passou, esta função também
 * atualiza o registro para `status: 'EXPIRADA'` antes de retornar `false`
 * — evita a necessidade de um cron job dedicado só para expirar sessões.
 *
 * Retorna `false` se a sessão não existir.
 *
 * Requirements: 1.5
 */
export async function sessaoEstaAtiva(sessaoTerminalId: string): Promise<boolean> {
  const sessao = await prisma.sessaoTerminal.findUnique({ where: { id: sessaoTerminalId } })

  if (!sessao) {
    return false
  }

  if (sessao.status !== 'ATIVA') {
    return false
  }

  if (sessao.expiraEm.getTime() <= Date.now()) {
    await prisma.sessaoTerminal.update({
      where: { id: sessaoTerminalId },
      data: { status: 'EXPIRADA' },
    })
    return false
  }

  return true
}

/**
 * Troca o `Centro_Producao` vinculado a uma `SessaoTerminal` já ativa,
 * exigindo nova autenticação de Supervisor (Requirement 1.6) — reutiliza a
 * mesma validação de credenciais de `criarSessaoTerminal` via
 * `validarCredenciaisSupervisorTerminal`.
 *
 * `ip`/`userAgent` seguem o mesmo padrão opcional de `criarSessaoTerminal`.
 *
 * Requirements: 1.5, 1.6
 */
export async function trocarCentroSessao(
  sessaoTerminalId: string,
  novoCentroProducaoId: string,
  credenciaisSupervisor: { email: string; senha: string },
  ip?: string,
  userAgent?: string,
): Promise<CriarSessaoTerminalResult> {
  const ipRegistrado = ip || 'unknown'
  const userAgentRegistrado = userAgent || 'unknown'

  const sessao = await prisma.sessaoTerminal.findUnique({ where: { id: sessaoTerminalId } })

  if (!sessao) {
    throw new SessaoTerminalError(404, 'Sessão de Terminal não encontrada')
  }

  const ativa = await sessaoEstaAtiva(sessaoTerminalId)

  if (!ativa) {
    throw new SessaoTerminalError(404, 'Sessão de Terminal não encontrada')
  }

  const usuario = await validarCredenciaisSupervisorTerminal(
    credenciaisSupervisor,
    sessao.empresaId,
    ipRegistrado,
    userAgentRegistrado,
  )

  // Valida que o novo Centro_Producao pertence à mesma empresa da sessão.
  const centroProducao = await prisma.centroProducao.findFirst({
    where: { id: novoCentroProducaoId, empresaId: sessao.empresaId },
  })

  if (!centroProducao) {
    throw new SessaoTerminalError(404, 'Centro de produção não encontrado para esta empresa')
  }

  const sessaoAtualizada = await prisma.sessaoTerminal.update({
    where: { id: sessaoTerminalId },
    data: {
      centroProducaoId: novoCentroProducaoId,
      autenticadaPorUsuarioId: usuario.id,
    },
  })

  return {
    sessaoTerminalId: sessaoAtualizada.id,
    empresaId: sessaoAtualizada.empresaId,
    centroProducaoId: sessaoAtualizada.centroProducaoId,
    autenticadaPorUsuarioId: sessaoAtualizada.autenticadaPorUsuarioId,
    expiraEm: sessaoAtualizada.expiraEm,
  }
}
