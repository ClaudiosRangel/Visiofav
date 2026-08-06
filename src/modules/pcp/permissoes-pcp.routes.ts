import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

/**
 * Permissões granulares do PCP Programação, por usuário e por empresa.
 * Armazenadas na tabela `Parametro` com chave `pcp.permissoes.<usuarioId>`,
 * valor é um JSON stringificado com a estrutura `PermissoesPcpUsuario`.
 *
 * Apenas ADMIN/SUPER_ADMIN podem ler/escrever permissões de outros usuários.
 * Qualquer usuário pode ler suas PRÓPRIAS permissões (necessário para o
 * frontend decidir o que mostrar/ocultar).
 */

export interface PermissoesPcpUsuario {
  // Tipos de processo que o usuário pode visualizar (array de tipoProcessoId)
  // Se vazio ou ausente, pode ver todos
  tiposProcessoVisiveis: string[]
  // Ações permitidas na Programação
  podeIniciar: boolean
  podeFinalizar: boolean
  podePausar: boolean
  podeApontar: boolean
  podeMover: boolean
  podeDesmembrar: boolean
  podeReextrair: boolean
  podeAlterarPrioridade: boolean
  podePostergarEntrega: boolean
  podeEditarObservacao: boolean
  // Permissão para drag-and-drop (reordenar fila)
  podeReordenarFila: boolean
  podeReordenarGrupos: boolean
  // Permissão para criar novo grupo
  podeCriarGrupo: boolean
  // Flag: funcionário de pré-impressão (habilita ação "pintar matriz")
  isPreImpressao: boolean
}

const DEFAULT_PERMISSOES: PermissoesPcpUsuario = {
  tiposProcessoVisiveis: [],
  podeIniciar: true,
  podeFinalizar: true,
  podePausar: true,
  podeApontar: true,
  podeMover: true,
  podeDesmembrar: true,
  podeReextrair: true,
  podeAlterarPrioridade: true,
  podePostergarEntrega: true,
  podeEditarObservacao: true,
  podeReordenarFila: true,
  podeReordenarGrupos: true,
  podeCriarGrupo: true,
  isPreImpressao: false,
}

function chavePermissoes(usuarioId: string) {
  return `pcp.permissoes.${usuarioId}`
}

async function getPermissoes(empresaId: string, usuarioId: string): Promise<PermissoesPcpUsuario> {
  const param = await prisma.parametro.findUnique({
    where: { empresaId_chave: { empresaId, chave: chavePermissoes(usuarioId) } },
  })
  if (!param || !param.valor) return { ...DEFAULT_PERMISSOES }
  try {
    return { ...DEFAULT_PERMISSOES, ...JSON.parse(param.valor) }
  } catch {
    return { ...DEFAULT_PERMISSOES }
  }
}

const permissoesSchema = z.object({
  tiposProcessoVisiveis: z.array(z.string()).optional(),
  podeIniciar: z.boolean().optional(),
  podeFinalizar: z.boolean().optional(),
  podePausar: z.boolean().optional(),
  podeApontar: z.boolean().optional(),
  podeMover: z.boolean().optional(),
  podeDesmembrar: z.boolean().optional(),
  podeReextrair: z.boolean().optional(),
  podeAlterarPrioridade: z.boolean().optional(),
  podePostergarEntrega: z.boolean().optional(),
  podeEditarObservacao: z.boolean().optional(),
  podeReordenarFila: z.boolean().optional(),
  podeReordenarGrupos: z.boolean().optional(),
  podeCriarGrupo: z.boolean().optional(),
  isPreImpressao: z.boolean().optional(),
})

export async function permissoesPcpRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  // =========================================================================
  // GET /api/pcp/permissoes/minha — Retorna as permissões do usuário logado
  // (qualquer perfil pode acessar — é para o frontend saber o que mostrar)
  // =========================================================================
  app.get('/permissoes/minha', async (request) => {
    const user = request.user as { id: string; empresaId: string; perfil: string }
    // ADMIN/SUPER_ADMIN tem todas as permissões sempre
    if (['SUPER_ADMIN', 'ADMIN'].includes(user.perfil)) {
      return { ...DEFAULT_PERMISSOES, isAdmin: true }
    }
    const permissoes = await getPermissoes(user.empresaId, user.id)
    return { ...permissoes, isAdmin: false }
  })

  // =========================================================================
  // GET /api/pcp/permissoes — Lista permissões de todos os usuários da empresa
  // (só ADMIN)
  // =========================================================================
  app.get('/permissoes', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil: string }
    if (!['SUPER_ADMIN', 'ADMIN'].includes(user.perfil)) {
      return reply.status(403).send({ message: 'Apenas administradores' })
    }

    let usuarios: Array<{ id: string; nome: string; email: string; perfil: string; status: boolean }> = []

    // Tentar buscar via UsuarioEmpresa se empresaId existe
    if (user.empresaId) {
      const vinculos = await prisma.usuarioEmpresa.findMany({
        where: { empresaId: user.empresaId },
        include: { usuario: { select: { id: true, nome: true, email: true, perfil: true, status: true } } },
      })
      usuarios = vinculos.filter(v => v.usuario.status).map(v => v.usuario)
    }

    // Fallback: buscar todos os usuários ativos
    if (usuarios.length === 0) {
      usuarios = await prisma.usuario.findMany({
        where: { status: true },
        select: { id: true, nome: true, email: true, perfil: true, status: true },
      })
    }

    const empresaId = user.empresaId || 'default'
    const resultado = await Promise.all(
      usuarios.map(async (u) => {
          const permissoes = await getPermissoes(empresaId, u.id)
          return {
            usuarioId: u.id,
            nome: u.nome,
            email: u.email,
            perfil: u.perfil,
            permissoes,
          }
        })
    )

    return resultado
  })

  // =========================================================================
  // PUT /api/pcp/permissoes/:usuarioId — Define permissões de um usuário
  // (só ADMIN)
  // =========================================================================
  app.put('/permissoes/:usuarioId', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil: string }
    if (!['SUPER_ADMIN', 'ADMIN'].includes(user.perfil)) {
      return reply.status(403).send({ message: 'Apenas administradores' })
    }

    const { usuarioId } = z.object({ usuarioId: z.string().uuid() }).parse(request.params)
    const body = permissoesSchema.parse(request.body)

    // Mesclar com as permissões existentes
    const atual = await getPermissoes(user.empresaId, usuarioId)
    const novas = { ...atual, ...body }

    await prisma.parametro.upsert({
      where: { empresaId_chave: { empresaId: user.empresaId, chave: chavePermissoes(usuarioId) } },
      create: { empresaId: user.empresaId, chave: chavePermissoes(usuarioId), valor: JSON.stringify(novas) },
      update: { valor: JSON.stringify(novas) },
    })

    return { message: 'Permissões atualizadas', permissoes: novas }
  })

  // =========================================================================
  // POST /api/pcp/programacao/pintar-matriz — Marca uma etapa como "matriz
  // aprovada" (pré-impressão) — seta flag visual no campo observacaoOperador
  // =========================================================================
  app.post('/programacao/pintar-matriz', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { etapaId } = z.object({ etapaId: z.string().uuid() }).parse(request.body)

    // Verificar permissão de pré-impressão
    const permissoes = await getPermissoes(user.empresaId, user.id)
    if (!permissoes.isPreImpressao && !['SUPER_ADMIN', 'ADMIN'].includes((user as any).perfil)) {
      return reply.status(403).send({ message: 'Apenas funcionários de pré-impressão podem usar esta ação' })
    }

    // Verificar que a etapa pertence à empresa
    const etapa = await prisma.etapaOrdemProducao.findFirst({
      where: { id: etapaId, ordemProducao: { empresaId: user.empresaId } },
      select: { id: true, observacaoOperador: true },
    })

    if (!etapa) {
      return reply.status(404).send({ message: 'Etapa não encontrada' })
    }

    // Toggle: se já tem a tag [MATRIZ_OK], remove; senão adiciona
    const TAG = '[MATRIZ_OK]'
    const obsAtual = etapa.observacaoOperador || ''
    const jaTemTag = obsAtual.includes(TAG)

    await prisma.etapaOrdemProducao.update({
      where: { id: etapaId },
      data: {
        observacaoOperador: jaTemTag
          ? obsAtual.replace(TAG, '').trim()
          : (obsAtual ? `${obsAtual} ${TAG}` : TAG),
      },
    })

    return { matrizOk: !jaTemTag }
  })
}
