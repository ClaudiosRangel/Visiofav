import { prisma } from '../../lib/prisma'
import bcrypt from 'bcryptjs'

// ─── Tipos ─────────────────────────────────────────────────────────────────────

export interface ValidacaoSupervisorInput {
  usuario: string
  senha: string
  empresaId: string
}

export interface ValidacaoSupervisorResult {
  valido: boolean
  supervisorId?: string
  erro?: string
}

// ─── Constantes ────────────────────────────────────────────────────────────────

const PERFIS_AUTORIZADOS = ['SUPERVISOR', 'ADMIN']

const ERRO_CREDENCIAIS_INVALIDAS = 'Credenciais inválidas'

// ─── Função ────────────────────────────────────────────────────────────────────

/**
 * Valida credenciais de supervisor para liberação de divergências.
 *
 * Fluxo:
 * 1. Busca usuário por email/login
 * 2. Verifica se possui vínculo com a empresa (via UsuarioEmpresa)
 * 3. Verifica se o perfil é SUPERVISOR ou ADMIN
 * 4. Valida senha com bcrypt
 *
 * Retorna mensagens genéricas para não revelar qual campo está incorreto.
 *
 * Requirements: 4.2, 4.3, 4.5, 4.6
 */
export async function validarCredenciaisSupervisor(
  input: ValidacaoSupervisorInput,
): Promise<ValidacaoSupervisorResult> {
  const { usuario, senha, empresaId } = input

  // 1. Buscar usuário por email/login
  const user = await prisma.usuario.findUnique({
    where: { email: usuario },
  })

  if (!user) {
    return { valido: false, erro: ERRO_CREDENCIAIS_INVALIDAS }
  }

  // 2. Verificar vínculo com a empresa
  const vinculo = await prisma.usuarioEmpresa.findFirst({
    where: {
      usuarioId: user.id,
      empresaId,
    },
  })

  if (!vinculo) {
    return { valido: false, erro: ERRO_CREDENCIAIS_INVALIDAS }
  }

  // 3. Verificar perfil SUPERVISOR ou ADMIN
  if (!PERFIS_AUTORIZADOS.includes(user.perfil)) {
    return { valido: false, erro: 'Perfil insuficiente para autorizar esta operação' }
  }

  // 4. Validar senha com bcrypt
  const senhaValida = await bcrypt.compare(senha, user.senha)

  if (!senhaValida) {
    return { valido: false, erro: ERRO_CREDENCIAIS_INVALIDAS }
  }

  return { valido: true, supervisorId: user.id }
}
