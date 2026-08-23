import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { prisma } from '../../../lib/prisma'

/**
 * Serviço de autenticação do Portal do Representante.
 *
 * Responsável por:
 * - Login com validação de credenciais, bloqueio por tentativas e emissão de JWT
 * - Troca de senha (obrigatória no primeiro acesso)
 * - Refresh token para renovação de sessão
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 7.4
 */

const SALT_ROUNDS = 10
const MAX_TENTATIVAS = 5
const BLOQUEIO_MINUTOS = 15
const ACCESS_TOKEN_EXPIRY = '60m'

// ─── Tipos ──────────────────────────────────────────────────────────────────────

interface LoginResult {
  accessToken: string
  refreshToken: string
  representante: {
    id: string
    email: string
    vendedorId: string
    empresaId: string
    senhaTemporaria: boolean
  }
}

interface RefreshResult {
  accessToken: string
  refreshToken: string
}

// ─── Login ──────────────────────────────────────────────────────────────────────

/**
 * Autentica um representante pelo e-mail e senha.
 *
 * Fluxo:
 * 1. Busca credencial por email + empresaId
 * 2. Verifica status (INATIVO → rejeita; BLOQUEADO → verifica expiração)
 * 3. Valida senha com bcrypt
 * 4. Em falha: incrementa tentativasLogin; se atingir 5, bloqueia por 15min
 * 5. Em sucesso: zera tentativas, atualiza ultimoAcesso, emite JWT + refresh
 * 6. Registra LogAuditoriaRep em todos os cenários
 *
 * @throws {{ statusCode: number; message: string; code?: string }} em caso de erro
 */
export async function login(
  app: FastifyInstance,
  email: string,
  senha: string,
  empresaId: string,
  ip?: string,
): Promise<LoginResult> {
  // 1. Buscar credencial
  const credencial = await prisma.representanteCredencial.findFirst({
    where: { email, empresaId },
  })

  if (!credencial) {
    // Registrar tentativa com representanteId null (email não encontrado)
    await registrarLog(empresaId, null, 'LOGIN_FALHOU', 'E-mail não encontrado', ip)
    throw { statusCode: 401, message: 'Credenciais inválidas' }
  }

  // 2. Verificar status
  if (credencial.status === 'INATIVO') {
    await registrarLog(empresaId, credencial.id, 'LOGIN_FALHOU', 'Conta inativa', ip)
    throw { statusCode: 401, message: 'Conta inativa', code: 'CONTA_INATIVA' }
  }

  if (credencial.status === 'BLOQUEADO') {
    if (credencial.bloqueadoAte && new Date() > credencial.bloqueadoAte) {
      // Desbloquear automaticamente — tempo de bloqueio expirou
      await prisma.representanteCredencial.update({
        where: { id: credencial.id },
        data: { status: 'ATIVO', tentativasLogin: 0, bloqueadoAte: null },
      })
    } else {
      await registrarLog(empresaId, credencial.id, 'LOGIN_FALHOU', 'Conta bloqueada temporariamente', ip)
      throw {
        statusCode: 401,
        message: 'Conta bloqueada temporariamente. Tente novamente em alguns minutos.',
        code: 'CONTA_BLOQUEADA',
      }
    }
  }

  // 3. Validar senha
  const senhaValida = await bcrypt.compare(senha, credencial.senhaHash)

  if (!senhaValida) {
    // 4. Incrementar tentativas e possivelmente bloquear
    const novasTentativas = credencial.tentativasLogin + 1

    if (novasTentativas >= MAX_TENTATIVAS) {
      // Bloquear conta
      const bloqueadoAte = new Date(Date.now() + BLOQUEIO_MINUTOS * 60 * 1000)
      await prisma.representanteCredencial.update({
        where: { id: credencial.id },
        data: {
          tentativasLogin: novasTentativas,
          status: 'BLOQUEADO',
          bloqueadoAte,
        },
      })
      await registrarLog(
        empresaId,
        credencial.id,
        'BLOQUEIO',
        `Conta bloqueada após ${MAX_TENTATIVAS} tentativas consecutivas. Desbloqueio em ${BLOQUEIO_MINUTOS}min.`,
        ip,
      )
      throw {
        statusCode: 401,
        message: `Conta bloqueada por ${BLOQUEIO_MINUTOS} minutos após ${MAX_TENTATIVAS} tentativas incorretas.`,
        code: 'CONTA_BLOQUEADA',
      }
    } else {
      await prisma.representanteCredencial.update({
        where: { id: credencial.id },
        data: { tentativasLogin: novasTentativas },
      })
      await registrarLog(
        empresaId,
        credencial.id,
        'LOGIN_FALHOU',
        `Senha incorreta (tentativa ${novasTentativas}/${MAX_TENTATIVAS})`,
        ip,
      )
      throw { statusCode: 401, message: 'Credenciais inválidas' }
    }
  }

  // 5. Login com sucesso — zerar tentativas, atualizar acesso, gerar tokens
  const refreshTokenRaw = crypto.randomBytes(48).toString('hex')
  const refreshTokenHash = await bcrypt.hash(refreshTokenRaw, SALT_ROUNDS)

  await prisma.representanteCredencial.update({
    where: { id: credencial.id },
    data: {
      tentativasLogin: 0,
      ultimoAcesso: new Date(),
      tokenRefresh: refreshTokenHash,
    },
  })

  // Emitir JWT com scope portal-rep
  const accessToken = app.jwt.sign(
    {
      scope: 'portal-rep',
      empresaId: credencial.empresaId,
      vendedorId: credencial.vendedorId,
      representanteId: credencial.id,
    },
    { expiresIn: ACCESS_TOKEN_EXPIRY },
  )

  // 6. Registrar log de sucesso
  await registrarLog(empresaId, credencial.id, 'LOGIN', 'Login realizado com sucesso', ip)

  return {
    accessToken,
    refreshToken: refreshTokenRaw,
    representante: {
      id: credencial.id,
      email: credencial.email,
      vendedorId: credencial.vendedorId,
      empresaId: credencial.empresaId,
      senhaTemporaria: credencial.senhaTemporaria,
    },
  }
}

// ─── Troca de Senha ─────────────────────────────────────────────────────────────

/**
 * Troca a senha do representante.
 *
 * Valida a senha atual, atualiza para a nova hash e marca senhaTemporaria = false.
 * Requirement 1.2: troca obrigatória no primeiro acesso.
 */
export async function trocarSenha(
  representanteId: string,
  senhaAtual: string,
  novaSenha: string,
): Promise<void> {
  const credencial = await prisma.representanteCredencial.findFirst({
    where: { id: representanteId },
  })

  if (!credencial) {
    throw { statusCode: 404, message: 'Credencial não encontrada' }
  }

  // Validar senha atual
  const senhaValida = await bcrypt.compare(senhaAtual, credencial.senhaHash)
  if (!senhaValida) {
    throw { statusCode: 401, message: 'Senha atual incorreta' }
  }

  // Atualizar para nova senha
  const novaSenhaHash = await bcrypt.hash(novaSenha, SALT_ROUNDS)

  await prisma.representanteCredencial.update({
    where: { id: representanteId },
    data: {
      senhaHash: novaSenhaHash,
      senhaTemporaria: false,
    },
  })
}

// ─── Refresh Token ──────────────────────────────────────────────────────────────

/**
 * Valida o refresh token e emite um novo par (access + refresh).
 *
 * O refresh token é comparado contra o hash armazenado no banco.
 * Requirement 7.4 (manter sessão ativa) e 7.6 (renovação automática).
 */
export async function refreshToken(
  app: FastifyInstance,
  token: string,
  representanteId: string,
): Promise<RefreshResult> {
  const credencial = await prisma.representanteCredencial.findFirst({
    where: { id: representanteId },
  })

  if (!credencial || !credencial.tokenRefresh) {
    throw { statusCode: 401, message: 'Refresh token inválido' }
  }

  // Verificar status
  if (credencial.status !== 'ATIVO') {
    throw { statusCode: 401, message: 'Conta inativa ou bloqueada' }
  }

  // Validar refresh token contra hash armazenado
  const tokenValido = await bcrypt.compare(token, credencial.tokenRefresh)
  if (!tokenValido) {
    throw { statusCode: 401, message: 'Refresh token inválido' }
  }

  // Gerar novo par de tokens
  const novoRefreshRaw = crypto.randomBytes(48).toString('hex')
  const novoRefreshHash = await bcrypt.hash(novoRefreshRaw, SALT_ROUNDS)

  await prisma.representanteCredencial.update({
    where: { id: credencial.id },
    data: { tokenRefresh: novoRefreshHash },
  })

  const accessToken = app.jwt.sign(
    {
      scope: 'portal-rep',
      empresaId: credencial.empresaId,
      vendedorId: credencial.vendedorId,
      representanteId: credencial.id,
    },
    { expiresIn: ACCESS_TOKEN_EXPIRY },
  )

  return {
    accessToken,
    refreshToken: novoRefreshRaw,
  }
}

// ─── Log de Auditoria ───────────────────────────────────────────────────────────

/**
 * Registra uma entrada no log de auditoria do portal do representante.
 * Requirement 7.4: registrar login, tentativa de acesso negado e ações relevantes.
 */
async function registrarLog(
  empresaId: string,
  representanteId: string | null,
  acao: string,
  detalhes: string,
  ip?: string,
): Promise<void> {
  await prisma.logAuditoriaRep.create({
    data: {
      empresaId,
      representanteId,
      acao,
      detalhes,
      ip: ip || null,
    },
  })
}
