import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { getProspeccaoProvider, enriquecerCnpj } from './provider'

/**
 * Módulo "Prospectar Clientes" — prospecção de leads B2B a partir da base
 * oficial de CNPJ (filtrada por CNAE + UF). Multi-tenant: filtro manual por
 * empresaId em todas as queries (padrão do projeto, ver cliente.routes.ts e
 * ATENCAO-pontos-verificar.md).
 *
 * Protegido: JWT (authenticate) + perfil ADMIN/SUPER_ADMIN (preHandler),
 * mesmo padrão do qa-seed/admin-pcp.
 *
 * Ver docs/prospeccao-clientes.md.
 */
const soDigitos = (v: string) => (v || '').replace(/\D/g, '')

const STATUS_FUNIL = ['NOVO', 'EM_CONTATO', 'QUALIFICADO', 'DESCARTADO', 'CONVERTIDO'] as const

export async function prospeccaoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // Exige perfil ADMIN/SUPER_ADMIN (mesmo padrão de adminPcpRoutes/qaSeed).
  app.addHook('preHandler', async (request, reply) => {
    const user = request.user as { perfil?: string } | undefined
    if (user?.perfil !== 'ADMIN' && user?.perfil !== 'SUPER_ADMIN') {
      return reply.status(403).send({ message: 'Prospecção de Clientes requer perfil ADMIN/SUPER_ADMIN' })
    }
  })

  // ===========================================================================
  // CONFIGURAÇÕES DE PROSPECÇÃO (o "negócio a prospectar")
  // ===========================================================================

  app.get('/configuracoes', async (request) => {
    const user = request.user as { empresaId?: string }
    const q = z.object({
      page: z.coerce.number().default(1),
      limit: z.coerce.number().default(50),
      busca: z.string().optional(),
    }).parse(request.query)

    const where: any = {}
    if (user.empresaId) where.empresaId = user.empresaId
    if (q.busca) where.nome = { contains: q.busca, mode: 'insensitive' }

    const [data, total] = await Promise.all([
      prisma.configuracaoProspeccao.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { criadoEm: 'desc' },
        include: { _count: { select: { prospects: true } } },
      }),
      prisma.configuracaoProspeccao.count({ where }),
    ])
    return { data, total }
  })

  const configSchema = z.object({
    nome: z.string().min(1),
    descricao: z.string().optional().nullable(),
    cnaes: z.array(z.string()).min(1, 'Informe ao menos um CNAE'),
    uf: z.string().length(2).optional().nullable(),
    cidade: z.string().optional().nullable(),
    portes: z.array(z.string()).optional().default([]),
    situacao: z.string().optional().default('ATIVA'),
  })

  app.post('/configuracoes', async (request, reply) => {
    const user = request.user as { empresaId?: string }
    if (!user.empresaId) return reply.status(400).send({ message: 'Empresa não selecionada' })
    const body = configSchema.parse(request.body)

    const criado = await prisma.configuracaoProspeccao.create({
      data: {
        empresaId: user.empresaId,
        nome: body.nome,
        descricao: body.descricao || null,
        cnaes: body.cnaes.map((c) => soDigitos(c)).filter(Boolean).join(','),
        uf: body.uf || null,
        cidade: body.cidade || null,
        portes: (body.portes || []).join(',') || null,
        situacao: body.situacao || 'ATIVA',
      },
    })
    return reply.status(201).send(criado)
  })

  app.put('/configuracoes/:id', async (request, reply) => {
    const user = request.user as { empresaId?: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = configSchema.partial().parse(request.body)

    // Garante que a config pertence à empresa do usuário.
    const existente = await prisma.configuracaoProspeccao.findFirst({
      where: { id, ...(user.empresaId ? { empresaId: user.empresaId } : {}) },
    })
    if (!existente) return reply.status(404).send({ message: 'Configuração não encontrada' })

    const data: any = {}
    if (body.nome !== undefined) data.nome = body.nome
    if (body.descricao !== undefined) data.descricao = body.descricao || null
    if (body.cnaes !== undefined) data.cnaes = body.cnaes.map((c) => soDigitos(c)).filter(Boolean).join(',')
    if (body.uf !== undefined) data.uf = body.uf || null
    if (body.cidade !== undefined) data.cidade = body.cidade || null
    if (body.portes !== undefined) data.portes = (body.portes || []).join(',') || null
    if (body.situacao !== undefined) data.situacao = body.situacao || 'ATIVA'

    return prisma.configuracaoProspeccao.update({ where: { id }, data })
  })

  app.delete('/configuracoes/:id', async (request, reply) => {
    const user = request.user as { empresaId?: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const existente = await prisma.configuracaoProspeccao.findFirst({
      where: { id, ...(user.empresaId ? { empresaId: user.empresaId } : {}) },
    })
    if (!existente) return reply.status(404).send({ message: 'Configuração não encontrada' })
    await prisma.configuracaoProspeccao.delete({ where: { id } })
    return reply.status(204).send()
  })

  // ===========================================================================
  // DISPARAR BUSCA (executa a prospecção com base numa configuração)
  // ===========================================================================

  app.post('/configuracoes/:id/buscar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    if (!user.empresaId) return reply.status(400).send({ message: 'Empresa não selecionada' })

    const config = await prisma.configuracaoProspeccao.findFirst({
      where: { id, empresaId: user.empresaId },
    })
    if (!config) return reply.status(404).send({ message: 'Configuração não encontrada' })

    const execucao = await prisma.execucaoProspeccao.create({
      data: {
        empresaId: user.empresaId,
        configuracaoId: config.id,
        status: 'EXECUTANDO',
        usuarioId: user.id,
      },
    })

    try {
      const provider = getProspeccaoProvider()
      const resultado = await provider.buscar({
        cnaes: (config.cnaes || '').split(',').filter(Boolean),
        uf: config.uf,
        cidade: config.cidade,
        situacao: config.situacao,
        portes: (config.portes || '').split(',').filter(Boolean),
        limite: 1000,
      })

      let novos = 0
      for (const emp of resultado.empresas) {
        const cnpj = soDigitos(emp.cnpj)
        if (cnpj.length !== 14) continue
        // Não recria prospect já existente (unique empresaId+cnpj).
        const jaExiste = await prisma.prospect.findFirst({
          where: { empresaId: user.empresaId, cnpj },
          select: { id: true },
        })
        if (jaExiste) continue

        await prisma.prospect.create({
          data: {
            empresaId: user.empresaId,
            configuracaoId: config.id,
            cnpj,
            razaoSocial: emp.razaoSocial,
            nomeFantasia: emp.nomeFantasia || null,
            cnaePrincipal: emp.cnaePrincipal || null,
            cnaeDescricao: emp.cnaeDescricao || null,
            situacao: emp.situacao || null,
            porte: emp.porte || null,
            logradouro: emp.logradouro || null,
            numero: emp.numero || null,
            complemento: emp.complemento || null,
            bairro: emp.bairro || null,
            cidade: emp.cidade || null,
            uf: emp.uf || null,
            cep: emp.cep || null,
            telefone: emp.telefone || null,
            email: emp.email || null,
            statusFunil: 'NOVO',
          },
        })
        novos++
      }

      const finalizada = await prisma.execucaoProspeccao.update({
        where: { id: execucao.id },
        data: {
          status: 'CONCLUIDA',
          totalEncontrado: resultado.empresas.length,
          totalNovo: novos,
          finalizadoEm: new Date(),
        },
      })

      return {
        execucao: finalizada,
        totalEncontrado: resultado.empresas.length,
        totalNovo: novos,
        avisos: resultado.avisos,
      }
    } catch (err: any) {
      await prisma.execucaoProspeccao.update({
        where: { id: execucao.id },
        data: { status: 'ERRO', erro: err?.message || 'Erro desconhecido', finalizadoEm: new Date() },
      })
      return reply.status(500).send({ message: 'Falha na busca de prospecção', detalhe: err?.message })
    }
  })

  app.get('/execucoes', async (request) => {
    const user = request.user as { empresaId?: string }
    const where: any = {}
    if (user.empresaId) where.empresaId = user.empresaId
    return prisma.execucaoProspeccao.findMany({
      where,
      orderBy: { criadoEm: 'desc' },
      take: 50,
      include: { configuracao: { select: { nome: true } } },
    })
  })

  // ===========================================================================
  // PROSPECTS (leads encontrados) — listagem, atualização de status, exclusão
  // ===========================================================================

  app.get('/prospects', async (request) => {
    const user = request.user as { empresaId?: string }
    const q = z.object({
      page: z.coerce.number().default(1),
      limit: z.coerce.number().default(20),
      busca: z.string().optional(),
      statusFunil: z.string().optional(),
      configuracaoId: z.string().uuid().optional(),
    }).parse(request.query)

    const where: any = {}
    if (user.empresaId) where.empresaId = user.empresaId
    if (q.statusFunil) where.statusFunil = q.statusFunil
    if (q.configuracaoId) where.configuracaoId = q.configuracaoId
    if (q.busca) {
      where.OR = [
        { razaoSocial: { contains: q.busca, mode: 'insensitive' } },
        { nomeFantasia: { contains: q.busca, mode: 'insensitive' } },
        { cnpj: { contains: soDigitos(q.busca) } },
      ]
    }

    const [data, total] = await Promise.all([
      prisma.prospect.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: [{ statusFunil: 'asc' }, { razaoSocial: 'asc' }],
      }),
      prisma.prospect.count({ where }),
    ])
    return { data, total }
  })

  app.patch('/prospects/:id', async (request, reply) => {
    const user = request.user as { empresaId?: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      statusFunil: z.enum(STATUS_FUNIL).optional(),
      observacoes: z.string().optional().nullable(),
    }).parse(request.body)

    const existente = await prisma.prospect.findFirst({
      where: { id, ...(user.empresaId ? { empresaId: user.empresaId } : {}) },
    })
    if (!existente) return reply.status(404).send({ message: 'Prospect não encontrado' })

    const data: any = {}
    if (body.statusFunil !== undefined) data.statusFunil = body.statusFunil
    if (body.observacoes !== undefined) data.observacoes = body.observacoes || null

    return prisma.prospect.update({ where: { id }, data })
  })

  app.delete('/prospects/:id', async (request, reply) => {
    const user = request.user as { empresaId?: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const existente = await prisma.prospect.findFirst({
      where: { id, ...(user.empresaId ? { empresaId: user.empresaId } : {}) },
    })
    if (!existente) return reply.status(404).send({ message: 'Prospect não encontrado' })
    await prisma.prospect.delete({ where: { id } })
    return reply.status(204).send()
  })

  // Enriquece um prospect com dados atualizados da API pública (best-effort).
  app.post('/prospects/:id/enriquecer', async (request, reply) => {
    const user = request.user as { empresaId?: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const prospect = await prisma.prospect.findFirst({
      where: { id, ...(user.empresaId ? { empresaId: user.empresaId } : {}) },
    })
    if (!prospect) return reply.status(404).send({ message: 'Prospect não encontrado' })

    const dados = await enriquecerCnpj(prospect.cnpj)
    if (!dados) return reply.status(422).send({ message: 'Não foi possível enriquecer este CNPJ na API pública no momento.' })

    return prisma.prospect.update({
      where: { id },
      data: {
        razaoSocial: dados.razaoSocial || prospect.razaoSocial,
        nomeFantasia: dados.nomeFantasia ?? prospect.nomeFantasia,
        cnaePrincipal: dados.cnaePrincipal ?? prospect.cnaePrincipal,
        cnaeDescricao: dados.cnaeDescricao ?? prospect.cnaeDescricao,
        situacao: dados.situacao ?? prospect.situacao,
        logradouro: dados.logradouro ?? prospect.logradouro,
        numero: dados.numero ?? prospect.numero,
        complemento: dados.complemento ?? prospect.complemento,
        bairro: dados.bairro ?? prospect.bairro,
        cidade: dados.cidade ?? prospect.cidade,
        uf: dados.uf ?? prospect.uf,
        cep: dados.cep ?? prospect.cep,
        telefone: dados.telefone ?? prospect.telefone,
        email: dados.email ?? prospect.email,
      },
    })
  })

  // ===========================================================================
  // CONVERTER PROSPECT EM CLIENTE (reaproveita o cadastro de Cliente existente)
  // ===========================================================================

  app.post('/prospects/:id/converter', async (request, reply) => {
    const user = request.user as { empresaId?: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    if (!user.empresaId) return reply.status(400).send({ message: 'Empresa não selecionada' })

    const prospect = await prisma.prospect.findFirst({
      where: { id, empresaId: user.empresaId },
    })
    if (!prospect) return reply.status(404).send({ message: 'Prospect não encontrado' })
    if (prospect.statusFunil === 'CONVERTIDO' && prospect.clienteId) {
      return reply.status(409).send({ message: 'Prospect já convertido em cliente', clienteId: prospect.clienteId })
    }

    // Reaproveita cliente com mesmo CNPJ se já existir (unique empresaId+cpfCnpj).
    const clienteExistente = await prisma.cliente.findFirst({
      where: { empresaId: user.empresaId, cpfCnpj: prospect.cnpj },
    })

    const cliente = clienteExistente
      ? clienteExistente
      : await prisma.cliente.create({
          data: {
            empresaId: user.empresaId,
            razaoSocial: prospect.razaoSocial,
            nomeFantasia: prospect.nomeFantasia,
            cpfCnpj: prospect.cnpj,
            logradouro: prospect.logradouro,
            numero: prospect.numero,
            complemento: prospect.complemento,
            bairro: prospect.bairro,
            cidade: prospect.cidade,
            uf: prospect.uf,
            cep: prospect.cep,
            telefone: prospect.telefone,
            email: prospect.email,
          },
        })

    await prisma.prospect.update({
      where: { id },
      data: { statusFunil: 'CONVERTIDO', clienteId: cliente.id },
    })

    return reply.status(201).send({ cliente, reaproveitado: !!clienteExistente })
  })
}
