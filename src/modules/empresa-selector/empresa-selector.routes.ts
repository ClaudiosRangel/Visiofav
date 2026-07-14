import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { coordenadasOptionalSchema } from '../geolocalizacao/coord-validation'
import { generateAccessToken, generateRefreshToken, setAuthCookies, TokenPayload } from '../../lib/auth-tokens'
import { decidirPersistenciaLogo, filtrarEMapearEmpresasAtivas, mensagemErroLogo } from './logo-validator'

const ALL_MODULOS = ['COMPRAS', 'VENDAS', 'FINANCEIRO', 'WMS', 'CTE', 'PCP', 'FISCAL'] as const

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const ADMIN_PROFILES = ['SUPER_ADMIN', 'ADMIN', 'DIRETOR']

const empresaBodySchema = z.object({
  razaoSocial: z.string().min(1, 'Razão Social é obrigatória'),
  nomeFantasia: z.string().optional().default(''),
  cnpj: z.string().min(1, 'CNPJ é obrigatório'),
  inscEstadual: z.string().optional().default(''),
  logradouro: z.string().optional().default(''),
  numero: z.string().optional().default(''),
  complemento: z.string().optional().default(''),
  bairro: z.string().optional().default(''),
  cidade: z.string().optional().default(''),
  uf: z.string().optional().default(''),
  cep: z.string().optional().default(''),
  telefone: z.string().optional().default(''),
  email: z.string().optional().default(''),
  usaWms: z.boolean().optional().default(false),
  status: z.boolean().optional().default(true),
  // Configurações de Conferência Avançada
  conferenciaQuantidadeCega: z.boolean().optional().default(false),
  conferenciaLoteCega: z.boolean().optional().default(false),
  permiteRecebimentoParcial: z.boolean().optional().default(false),
  toleranciaQuantidadePercentualPadrao: z.number().min(0).max(100).nullable().optional(),
  logo: z.string().nullable().optional(),
})

export async function empresaSelectorRoutes(app: FastifyInstance) {
  // Todas as rotas exigem autenticação
  app.addHook('onRequest', authenticate)

  /**
   * GET /api/empresas
   * Lista TODAS as empresas (somente para perfis admin).
   */
  app.get('/', async (request, reply) => {
    const user = request.user as { id: string; perfil: string }
    const perfilUpper = (user.perfil || '').toUpperCase()
    if (!ADMIN_PROFILES.includes(perfilUpper)) {
      return reply.status(403).send({ message: `Acesso negado (perfil: ${user.perfil})` })
    }

    const empresas = await prisma.empresa.findMany({
      orderBy: { razaoSocial: 'asc' },
      select: {
        id: true,
        razaoSocial: true,
        nomeFantasia: true,
        cnpj: true,
        inscEstadual: true,
        logradouro: true,
        numero: true,
        complemento: true,
        bairro: true,
        cidade: true,
        uf: true,
        cep: true,
        telefone: true,
        email: true,
        usaWms: true,
        status: true,
        criadoEm: true,
      },
    })

    return { data: empresas }
  })

  /**
   * POST /api/empresas
   * Cria nova empresa (somente para perfis admin).
   */
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; perfil: string }
    if (!ADMIN_PROFILES.includes(user.perfil)) {
      return reply.status(403).send({ message: 'Acesso negado' })
    }

    const body = empresaBodySchema.parse(request.body)

    const decisao = decidirPersistenciaLogo(body.logo)
    if (decisao.acao === 'rejeitar') {
      return reply.status(400).send({ message: mensagemErroLogo(decisao.motivo) })
    }
    const logoParaPersistir = decisao.acao === 'persistir' ? decisao.conteudoNormalizado : null

    // Verificar CNPJ duplicado
    const existe = await prisma.empresa.findUnique({ where: { cnpj: body.cnpj } })
    if (existe) {
      return reply.status(409).send({ message: 'Já existe uma empresa com este CNPJ' })
    }

    const empresa = await prisma.empresa.create({ data: { ...body, logo: logoParaPersistir } })

    // Vincular o usuário criador à nova empresa
    await prisma.usuarioEmpresa.create({
      data: {
        usuarioId: user.id,
        empresaId: empresa.id,
        modulos: '*',
      },
    })

    return reply.status(201).send(empresa)
  })

  /**
   * PUT /api/empresas/:id
   * Atualiza empresa existente (somente para perfis admin).
   */
  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; perfil: string }
    if (!ADMIN_PROFILES.includes(user.perfil)) {
      return reply.status(403).send({ message: 'Acesso negado' })
    }

    const { id } = paramsSchema.parse(request.params)
    const body = empresaBodySchema.partial().parse(request.body)

    const decisao = decidirPersistenciaLogo(body.logo)
    if (decisao.acao === 'rejeitar') {
      return reply.status(400).send({ message: mensagemErroLogo(decisao.motivo) })
    }

    // Se cnpj alterado, verificar duplicidade
    if (body.cnpj) {
      const existe = await prisma.empresa.findFirst({
        where: { cnpj: body.cnpj, id: { not: id } },
      })
      if (existe) {
        return reply.status(409).send({ message: 'Já existe uma empresa com este CNPJ' })
      }
    }

    const data: typeof body = { ...body }
    if (decisao.acao === 'remover') {
      data.logo = null
    } else if (decisao.acao === 'persistir') {
      data.logo = decisao.conteudoNormalizado
    } else {
      delete data.logo
    }

    const empresa = await prisma.empresa.update({
      where: { id },
      data,
    })

    return empresa
  })

  /**
   * DELETE /api/empresas/:id
   * Soft-delete: inativa a empresa (somente para perfis admin).
   */
  app.delete('/:id', async (request, reply) => {
    const user = request.user as { id: string; perfil: string }
    if (!ADMIN_PROFILES.includes(user.perfil)) {
      return reply.status(403).send({ message: 'Acesso negado' })
    }

    const { id } = paramsSchema.parse(request.params)

    await prisma.empresa.update({
      where: { id },
      data: { status: false },
    })

    return reply.status(204).send()
  })

  /**
   * GET /api/empresas/minhas
   * Lista empresas ativas vinculadas ao usuário autenticado.
   */
  app.get('/minhas', async (request) => {
    const user = request.user as { id: string }

    const vinculos = await prisma.usuarioEmpresa.findMany({
      where: { usuarioId: user.id },
      include: {
        empresa: {
          select: {
            id: true,
            razaoSocial: true,
            nomeFantasia: true,
            cnpj: true,
            logo: true,
            status: true,
          },
        },
      },
    })

    return filtrarEMapearEmpresasAtivas(vinculos)
  })

  /**
   * GET /api/empresas/:id/modulos
   * Retorna módulos autorizados para o usuário na empresa.
   */
  app.get('/:id/modulos', async (request, reply) => {
    const { id: empresaId } = paramsSchema.parse(request.params)
    const user = request.user as { id: string }

    const vinculo = await prisma.usuarioEmpresa.findUnique({
      where: {
        usuarioId_empresaId: { usuarioId: user.id, empresaId },
      },
    })

    if (!vinculo) {
      return reply.status(403).send({ message: 'Sem acesso à empresa' })
    }

    const modulos =
      vinculo.modulos === '*'
        ? [...ALL_MODULOS]
        : vinculo.modulos.split(',').map((m) => m.trim()).filter(Boolean)

    return { modulos }
  })

  /**
   * POST /api/empresas/:id/selecionar
   * Registra seleção de empresa e retorna token JWT atualizado com empresaId.
   */
  app.post('/:id/selecionar', async (request, reply) => {
    const { id: empresaId } = paramsSchema.parse(request.params)
    const user = request.user as { id: string; nome: string; perfil: string }

    const vinculo = await prisma.usuarioEmpresa.findUnique({
      where: {
        usuarioId_empresaId: { usuarioId: user.id, empresaId },
      },
      include: {
        empresa: { select: { status: true } },
      },
    })

    if (!vinculo) {
      return reply.status(403).send({ message: 'Sem acesso à empresa' })
    }

    if (!vinculo.empresa.status) {
      return reply.status(400).send({ message: 'Empresa inativa' })
    }

    const usuarioDb = await prisma.usuario.findUnique({
      where: { id: user.id },
      select: { senhaAlterada: true },
    })

    const payload: TokenPayload = {
      id: user.id,
      nome: user.nome,
      perfil: user.perfil,
      empresaId,
      primeiroLogin: !usuarioDb?.senhaAlterada,
    }

    // Gerar access token (curta duração) e refresh token (longa duração),
    // seguindo o mesmo padrão do /auth/login — necessário para o keep-alive
    // automático e o refresh de token do frontend funcionarem após troca de empresa.
    const accessToken = generateAccessToken(app, payload)
    const refreshToken = generateRefreshToken()

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    await prisma.refreshToken.upsert({
      where: { usuarioId: user.id },
      update: { token: refreshToken, expiresAt, revoked: false, empresaId },
      create: { usuarioId: user.id, token: refreshToken, expiresAt, empresaId },
    }).catch(() => {
      // Tabela pode não existir ainda — fallback: funciona sem refresh token
    })

    setAuthCookies(reply, accessToken, refreshToken)

    return { token: accessToken, refreshToken }
  })

  /**
   * GET /api/empresas/minha
   * Retorna os dados da empresa selecionada pelo usuário autenticado (incluindo coordenadas).
   */
  app.get('/minha', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }

    if (!user.empresaId) {
      return reply.status(400).send({ message: 'Empresa não selecionada' })
    }

    const empresa = await prisma.empresa.findUnique({
      where: { id: user.empresaId },
      select: {
        id: true,
        razaoSocial: true,
        nomeFantasia: true,
        cnpj: true,
        inscEstadual: true,
        logradouro: true,
        numero: true,
        complemento: true,
        bairro: true,
        cidade: true,
        uf: true,
        cep: true,
        telefone: true,
        email: true,
        logo: true,
        usaWms: true,
        status: true,
        latitude: true,
        longitude: true,
        regimeTributario: true,
        ambienteNFe: true,
        serieNFe: true,
        proximoNumeroNFe: true,
        serieCTe: true,
        proximoNumeroCTe: true,
        conferenciaQuantidadeCega: true,
        conferenciaLoteCega: true,
        permiteRecebimentoParcial: true,
        toleranciaQuantidadePercentualPadrao: true,
      },
    })

    if (!empresa) {
      return reply.status(404).send({ message: 'Empresa não encontrada' })
    }

    return {
      ...empresa,
      toleranciaQuantidadePercentualPadrao: empresa.toleranciaQuantidadePercentualPadrao != null
        ? Number(empresa.toleranciaQuantidadePercentualPadrao) : null,
    }
  })

  /**
   * PUT /api/empresas/minha
   * Atualiza os dados da empresa selecionada pelo usuário autenticado (incluindo coordenadas).
   */
  app.put('/minha', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }

    if (!user.empresaId) {
      return reply.status(400).send({ message: 'Empresa não selecionada' })
    }

    const baseSchema = z.object({
      razaoSocial: z.string().optional(),
      nomeFantasia: z.string().optional(),
      inscEstadual: z.string().optional(),
      logradouro: z.string().optional(),
      numero: z.string().optional(),
      complemento: z.string().optional(),
      bairro: z.string().optional(),
      cidade: z.string().optional(),
      uf: z.string().optional(),
      cep: z.string().optional(),
      telefone: z.string().optional(),
      email: z.string().optional(),
      // Fiscal / NF-e
      regimeTributario: z.number().int().min(1).max(3).optional(),
      ambienteNFe: z.number().int().min(1).max(2).optional(),
      serieNFe: z.number().int().min(0).optional(),
      proximoNumeroNFe: z.number().int().min(1).optional(),
      serieCTe: z.number().int().min(0).optional(),
      proximoNumeroCTe: z.number().int().min(1).optional(),
      // Módulos
      usaWms: z.boolean().optional(),
      // Configurações de Conferência Avançada
      conferenciaQuantidadeCega: z.boolean().optional(),
      conferenciaLoteCega: z.boolean().optional(),
      permiteRecebimentoParcial: z.boolean().optional(),
      toleranciaQuantidadePercentualPadrao: z.number().min(0).max(100).nullable().optional(),
      logo: z.string().nullable().optional(),
    })

    const schema = baseSchema.merge(coordenadasOptionalSchema.innerType()).refine(
      (data) => {
        const hasLat = data.latitude !== undefined && data.latitude !== null
        const hasLng = data.longitude !== undefined && data.longitude !== null
        return hasLat === hasLng
      },
      { message: 'Latitude e longitude devem ser fornecidas em conjunto' }
    )

    const data = schema.parse(request.body)

    const decisao = decidirPersistenciaLogo(data.logo)
    if (decisao.acao === 'rejeitar') {
      return reply.status(400).send({ message: mensagemErroLogo(decisao.motivo) })
    }

    if (decisao.acao === 'remover') {
      data.logo = null
    } else if (decisao.acao === 'persistir') {
      data.logo = decisao.conteudoNormalizado
    } else {
      delete data.logo
    }

    const empresa = await prisma.empresa.update({
      where: { id: user.empresaId },
      data,
    })

    return empresa
  })
}
