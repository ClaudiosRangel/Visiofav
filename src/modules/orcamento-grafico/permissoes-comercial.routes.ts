import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'

/**
 * Permissões granulares do módulo COMERCIAL, por usuário e por empresa
 * (spec comercial-permissoes, bloco B10). Mesmo padrão do PCP
 * (`permissoes-pcp.routes.ts`): armazenadas na tabela `Parametro` com chave
 * `comercial.permissoes.<usuarioId>` (JSON). ADMIN/SUPER_ADMIN bypass. Default
 * = TUDO LIBERADO (não-regressão). Só ADMIN lê/escreve as de outros; qualquer
 * usuário lê as PRÓPRIAS (para o front mostrar/ocultar botões).
 */

export interface PermissoesComercialUsuario {
  // Ações do módulo Comercial (flags globais)
  podeVerComercial: boolean
  podeCriarOrcamento: boolean
  podeEnviarProposta: boolean
  podeAprovarOrcamento: boolean
  podeConverterPedido: boolean
  podeAplicarDesconto: boolean
  podeLiberarPcp: boolean
  podeGerenciarAmostras: boolean
  podeEditarCadastros: boolean
  // Acesso por menu (habilitar/ocultar cada tela). Se ausente, tudo liberado.
  acessoMenus?: Record<string, { habilitado?: boolean }>
}

export const DEFAULT_PERMISSOES_COMERCIAL: PermissoesComercialUsuario = {
  podeVerComercial: true,
  podeCriarOrcamento: true,
  podeEnviarProposta: true,
  podeAprovarOrcamento: true,
  podeConverterPedido: true,
  podeAplicarDesconto: true,
  podeLiberarPcp: true,
  podeGerenciarAmostras: true,
  podeEditarCadastros: true,
}

function chave(usuarioId: string) {
  return `comercial.permissoes.${usuarioId}`
}

export async function getPermissoesComercial(empresaId: string, usuarioId: string): Promise<PermissoesComercialUsuario> {
  const param = await prisma.parametro.findUnique({
    where: { empresaId_chave: { empresaId, chave: chave(usuarioId) } },
  })
  if (!param || !param.valor) return { ...DEFAULT_PERMISSOES_COMERCIAL }
  try {
    return { ...DEFAULT_PERMISSOES_COMERCIAL, ...JSON.parse(param.valor) }
  } catch {
    return { ...DEFAULT_PERMISSOES_COMERCIAL }
  }
}

/**
 * Verifica uma ação do Comercial. ADMIN/SUPER_ADMIN sempre true. Caso contrário,
 * lê a flag (default true quando ausente). Usado para proteger rotas sensíveis.
 */
export async function verificarPermissaoComercial(
  empresaId: string,
  usuarioId: string,
  perfil: string | undefined,
  acao: keyof Omit<PermissoesComercialUsuario, 'acessoMenus'>,
): Promise<boolean> {
  if (perfil === 'SUPER_ADMIN' || perfil === 'ADMIN') return true
  const p = await getPermissoesComercial(empresaId, usuarioId)
  return p[acao] ?? true
}

const permissoesSchema = z.object({
  podeVerComercial: z.boolean().optional(),
  podeCriarOrcamento: z.boolean().optional(),
  podeEnviarProposta: z.boolean().optional(),
  podeAprovarOrcamento: z.boolean().optional(),
  podeConverterPedido: z.boolean().optional(),
  podeAplicarDesconto: z.boolean().optional(),
  podeLiberarPcp: z.boolean().optional(),
  podeGerenciarAmostras: z.boolean().optional(),
  podeEditarCadastros: z.boolean().optional(),
  acessoMenus: z.record(z.string(), z.object({ habilitado: z.boolean().optional() })).optional(),
})

export async function permissoesComercialRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // GET /permissoes/minha — permissões do usuário logado (qualquer perfil)
  app.get('/permissoes/minha', async (request) => {
    const user = request.user as { id: string; empresaId: string; perfil: string }
    if (['SUPER_ADMIN', 'ADMIN'].includes(user.perfil)) {
      return { ...DEFAULT_PERMISSOES_COMERCIAL, isAdmin: true }
    }
    const permissoes = await getPermissoesComercial(user.empresaId, user.id)
    return { ...permissoes, isAdmin: false }
  })

  // GET /permissoes — lista permissões de todos os usuários da empresa (só ADMIN)
  app.get('/permissoes', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil: string }
    if (!['SUPER_ADMIN', 'ADMIN'].includes(user.perfil)) {
      return reply.status(403).send({ message: 'Apenas administradores' })
    }
    let usuarios: Array<{ id: string; nome: string; email: string; perfil: string; status: boolean }> = []
    if (user.empresaId) {
      const vinculos = await prisma.usuarioEmpresa.findMany({
        where: { empresaId: user.empresaId },
        include: { usuario: { select: { id: true, nome: true, email: true, perfil: true, status: true } } },
      })
      usuarios = vinculos.filter((v) => v.usuario.status).map((v) => v.usuario)
    }
    if (usuarios.length === 0) {
      usuarios = await prisma.usuario.findMany({
        where: { status: true },
        select: { id: true, nome: true, email: true, perfil: true, status: true },
      })
    }
    return Promise.all(
      usuarios.map(async (u) => ({
        usuarioId: u.id,
        nome: u.nome,
        email: u.email,
        perfil: u.perfil,
        permissoes: await getPermissoesComercial(user.empresaId, u.id),
      })),
    )
  })

  // PUT /permissoes/:usuarioId — define permissões de um usuário (só ADMIN)
  app.put('/permissoes/:usuarioId', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil: string }
    if (!['SUPER_ADMIN', 'ADMIN'].includes(user.perfil)) {
      return reply.status(403).send({ message: 'Apenas administradores' })
    }
    const { usuarioId } = z.object({ usuarioId: z.string().uuid() }).parse(request.params)
    const body = permissoesSchema.parse(request.body)
    const atual = await getPermissoesComercial(user.empresaId, usuarioId)
    const novas = { ...atual, ...body }
    await prisma.parametro.upsert({
      where: { empresaId_chave: { empresaId: user.empresaId, chave: chave(usuarioId) } },
      create: { empresaId: user.empresaId, chave: chave(usuarioId), valor: JSON.stringify(novas) },
      update: { valor: JSON.stringify(novas) },
    })
    return { message: 'Permissões atualizadas', permissoes: novas }
  })
}
