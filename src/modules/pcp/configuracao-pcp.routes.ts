import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

/**
 * Flags de configuração PCP por empresa.
 * Armazenados na tabela Parametro com prefixo "pcp."
 */
const FLAGS_PCP = [
  'pcp.usaControleBobina',
  'pcp.usaLoteCorrespondencia',
  'pcp.usaEstoqueTerceiro',
  'pcp.usaPaletizacaoDinamica',
  'pcp.usaControleApara',
  'pcp.usaControleUmidade',
  'pcp.usaZonaSegregada',
  // Habilita/desabilita as cores de status (pendente/andamento/pausada/
  // concluída/atrasada) da fila de programação nos dois layouts (Grid e
  // Detalhado). A cor de OP Avulsa (rosa) é fixa e NUNCA é afetada por essa
  // flag — ver getRowBackground nos dois componentes do frontend.
  'pcp.usaCoresStatusProgramacao',
  // Decide se a conclusão da ÚLTIMA etapa de uma OP dispara automaticamente
  // a criação de NotaEntrada (tipo PRODUCAO) no WMS. Distinta de
  // Empresa.usaWms (que só indica que a empresa usa o módulo WMS em geral)
  // — uma empresa pode usar WMS para compras/vendas mas preferir lançar a
  // entrada de produção manualmente. Ver etapa-operacional.routes.ts
  // (integracaoWmsAutomaticaAtiva) e ATENCAO-pontos-verificar.md.
  'pcp.integracaoWmsAutomatica',
] as const

const patchConfigSchema = z.object({
  usaControleBobina: z.boolean().optional(),
  usaLoteCorrespondencia: z.boolean().optional(),
  usaEstoqueTerceiro: z.boolean().optional(),
  usaPaletizacaoDinamica: z.boolean().optional(),
  usaControleApara: z.boolean().optional(),
  usaControleUmidade: z.boolean().optional(),
  usaZonaSegregada: z.boolean().optional(),
  usaCoresStatusProgramacao: z.boolean().optional(),
  integracaoWmsAutomatica: z.boolean().optional(),
})

/**
 * Verifica se a integração automática PCP → WMS (criação de NotaEntrada de
 * produção ao concluir a última etapa de uma OP) está habilitada para a
 * empresa. Default `true` quando o parâmetro não está configurado (ver
 * mesmo default em GET /configuracao), para preservar o comportamento já
 * existente em empresas que não alteraram essa configuração.
 *
 * Usada por `etapa-operacional.routes.ts` — extraída aqui para não duplicar
 * a leitura de `Parametro` em dois módulos diferentes.
 */
export async function integracaoWmsAutomaticaAtiva(empresaId: string): Promise<boolean> {
  const param = await prisma.parametro.findUnique({
    where: { empresaId_chave: { empresaId, chave: 'pcp.integracaoWmsAutomatica' } },
  })
  if (!param) return true
  return param.valor === 'true'
}

export async function configuracaoPcpRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  // =========================================================================
  // GET /api/pcp/configuracao — Retorna flags ativos
  // =========================================================================
  app.get('/configuracao', async (request) => {
    const user = request.user as { id: string; empresaId: string }

    const parametros = await prisma.parametro.findMany({
      where: {
        empresaId: user.empresaId,
        chave: { startsWith: 'pcp.' },
      },
    })

    const config: Record<string, boolean> = {
      usaControleBobina: false,
      usaLoteCorrespondencia: false,
      usaEstoqueTerceiro: false,
      usaPaletizacaoDinamica: false,
      usaControleApara: false,
      usaControleUmidade: false,
      usaZonaSegregada: false,
      // Default TRUE — comportamento visual já existente hoje (cores
      // habilitadas), a flag serve para desabilitar, não para habilitar.
      usaCoresStatusProgramacao: true,
      // Default TRUE — preserva o comportamento automático já existente
      // (baseado antes só em Empresa.usaWms) para não quebrar empresas que
      // já dependem do lançamento automático hoje. Empresas que preferem
      // lançar manualmente desabilitam esta flag no Configurador.
      integracaoWmsAutomatica: true,
    }

    for (const param of parametros) {
      const key = param.chave.replace('pcp.', '')
      if (key in config) {
        config[key] = param.valor === 'true'
      }
    }

    return { empresaId: user.empresaId, configuracao: config }
  })

  // =========================================================================
  // PATCH /api/pcp/configuracao — Atualiza flags
  // =========================================================================
  app.patch('/configuracao', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil?: string }
    const body = patchConfigSchema.parse(request.body)

    // Verifica se é admin (apenas SUPER_ADMIN ou ADMIN podem alterar)
    const usuario = await prisma.usuario.findUnique({
      where: { id: user.id },
      select: { perfil: true },
    })

    if (!usuario || !['SUPER_ADMIN', 'ADMIN'].includes(usuario.perfil)) {
      return reply.status(403).send({ message: 'Apenas administradores podem alterar configurações PCP' })
    }

    const atualizados: string[] = []

    for (const [key, value] of Object.entries(body)) {
      if (value === undefined) continue

      const chave = `pcp.${key}`

      await prisma.parametro.upsert({
        where: { empresaId_chave: { empresaId: user.empresaId, chave } },
        create: { empresaId: user.empresaId, chave, valor: String(value) },
        update: { valor: String(value) },
      })

      atualizados.push(`${key} = ${value}`)
    }

    return { message: 'Configuração atualizada', atualizados }
  })

  // =========================================================================
  // GET /api/pcp/permissoes/minha — Retorna permissões do usuário logado
  // =========================================================================
  app.get('/permissoes/minha', async (request) => {
    const user = request.user as { id: string; empresaId: string; perfil: string }
    // Buscar permissões salvas do usuário (mesmo para admin, pois pode ter isPreImpressao)
    const param = await prisma.parametro.findFirst({
      where: { empresaId: user.empresaId, chave: `pcp.permissoes.${user.id}` },
    })
    let salvas: any = {}
    if (param?.valor) { try { salvas = JSON.parse(param.valor) } catch {} }

    if (['SUPER_ADMIN', 'ADMIN'].includes(user.perfil)) {
      return { tiposProcessoVisiveis: [], podeIniciar: true, podeFinalizar: true, podePausar: true, podeApontar: true, podeMover: true, podeDesmembrar: true, podeReextrair: true, podeAlterarPrioridade: true, podePostergarEntrega: true, podeEditarObservacao: true, podeReordenarFila: true, podeReordenarGrupos: true, podeCriarGrupo: true, isPreImpressao: salvas.isPreImpressao || false, isAdmin: true }
    }
    const defaults = { tiposProcessoVisiveis: [], podeIniciar: true, podeFinalizar: true, podePausar: true, podeApontar: true, podeMover: true, podeDesmembrar: true, podeReextrair: true, podeAlterarPrioridade: true, podePostergarEntrega: true, podeEditarObservacao: true, podeReordenarFila: true, podeReordenarGrupos: true, podeCriarGrupo: true, isPreImpressao: false }
    if (!param || !param.valor) return { ...defaults, isAdmin: false }
    try { return { ...defaults, ...salvas, isAdmin: false } } catch { return { ...defaults, isAdmin: false } }
  })

  // =========================================================================
  // GET /api/pcp/permissoes — Lista permissões de todos os usuários (ADMIN)
  // =========================================================================
  app.get('/permissoes', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil: string }
    if (!['SUPER_ADMIN', 'ADMIN'].includes(user.perfil)) {
      return reply.status(403).send({ message: 'Apenas administradores' })
    }
    // Buscar usuários vinculados à empresa atual
    const empresaId = user.empresaId || 'default'
    const vinculos = await prisma.usuarioEmpresa.findMany({
      where: { empresaId: user.empresaId },
      include: { usuario: { select: { id: true, nome: true, email: true, perfil: true, status: true } } },
    })
    let usuarios = vinculos.filter(v => v.usuario.status).map(v => v.usuario)
    // Se não encontrou vínculos (empresa sem UsuarioEmpresa), busca por usuario logado
    if (usuarios.length === 0) {
      const meuUsuario = await prisma.usuario.findUnique({ where: { id: user.id }, select: { id: true, nome: true, email: true, perfil: true } })
      if (meuUsuario) usuarios = [{ ...meuUsuario, status: true }]
    }
    const resultado = await Promise.all(
      usuarios.map(async (u) => {
        const param = await prisma.parametro.findFirst({
          where: { empresaId, chave: `pcp.permissoes.${u.id}` },
        })
        const defaults = { tiposProcessoVisiveis: [] as string[], permissoesPorProcesso: {} as Record<string, any>, podeReordenarFila: true, podeReordenarGrupos: true, podeCriarGrupo: true, isPreImpressao: false }
        let permissoes = defaults
        if (param?.valor) { try { permissoes = { ...defaults, ...JSON.parse(param.valor) } } catch {} }
        return { usuarioId: u.id, nome: u.nome, email: u.email, perfil: u.perfil, permissoes }
      })
    )
    return resultado
  })

  // =========================================================================
  // PUT /api/pcp/permissoes/:usuarioId — Define permissões de um usuário (ADMIN)
  // =========================================================================
  app.put('/permissoes/:usuarioId', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil: string }
    if (!['SUPER_ADMIN', 'ADMIN'].includes(user.perfil)) {
      return reply.status(403).send({ message: 'Apenas administradores' })
    }
    const { usuarioId } = z.object({ usuarioId: z.string().uuid() }).parse(request.params)
    const body = request.body as any
    const empresaId = user.empresaId || 'default'
    const chave = `pcp.permissoes.${usuarioId}`
    // Mesclar com existente
    const existente = await prisma.parametro.findFirst({ where: { empresaId, chave } })
    let atual: any = {}
    if (existente?.valor) { try { atual = JSON.parse(existente.valor) } catch {} }
    const novas = { ...atual, ...body }
    await prisma.parametro.upsert({
      where: { empresaId_chave: { empresaId, chave } },
      create: { empresaId, chave, valor: JSON.stringify(novas) },
      update: { valor: JSON.stringify(novas) },
    })
    return { message: 'Permissões atualizadas', permissoes: novas }
  })
}
