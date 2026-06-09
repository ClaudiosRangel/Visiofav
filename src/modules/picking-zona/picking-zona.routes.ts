import { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { pickingZonaService } from './picking-zona.service'
import { prisma } from '../../lib/prisma'
import {
  createZonaSchema,
  updateZonaSchema,
  listZonasSchema,
  vincularEnderecosSchema,
  atribuirSeparadorSchema,
  createPontoSchema,
  listSubOndasSchema,
  dividirOndaSchema,
  painelZonasSchema,
  idParamsSchema,
} from './picking-zona.schemas'

// === Audit helper (fire-and-forget) ===
function audit(empresaId: string, entidade: string, entidadeId: string, acao: string, descricao: string, usuarioId: string, dados?: object) {
  prisma.auditLog.create({
    data: { empresaId, entidade, entidadeId, acao, descricao, dados: dados ? JSON.stringify(dados) : null, usuarioId }
  }).catch(() => {})
}

export async function pickingZonaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // ==========================================================================
  // GET /zonas — Listar zonas de picking
  // ==========================================================================
  app.get('/zonas', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const filters = listZonasSchema.parse(request.query)
      const resultado = await pickingZonaService.listarZonas(user.empresaId, filters)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /zonas — Criar zona de picking
  // ==========================================================================
  app.post('/zonas', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = createZonaSchema.parse(request.body)
      // cdId vem do header ou do contexto do CD ativo — usamos o primeiro CD da empresa como fallback
      const cdId = (request.headers['x-cd-id'] as string) || ''
      if (!cdId) {
        return reply.status(400).send({ message: 'Header x-cd-id é obrigatório' })
      }
      const resultado = await pickingZonaService.criarZona(user.empresaId, { ...body, cdId })
      audit(user.empresaId, 'ZonaPicking', resultado.id, 'CRIAR_ZONA', 'Zona de picking criada', user.id, { nome: body.nome, cdId })
      return reply.status(201).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /zonas/:id — Buscar zona por ID
  // ==========================================================================
  app.get('/zonas/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)
      const resultado = await pickingZonaService.buscarZona(user.empresaId, id)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /zonas/:id — Atualizar zona de picking
  // ==========================================================================
  app.put('/zonas/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)
      const body = updateZonaSchema.parse(request.body)
      const resultado = await pickingZonaService.atualizarZona(user.empresaId, id, body)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /zonas/:id/enderecos — Vincular endereços à zona
  // ==========================================================================
  app.post('/zonas/:id/enderecos', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)
      const { enderecoIds } = vincularEnderecosSchema.parse(request.body)
      const resultado = await pickingZonaService.vincularEnderecos(user.empresaId, id, enderecoIds)
      audit(user.empresaId, 'ZonaPicking', id, 'VINCULAR_ENDERECOS', 'Endereços vinculados à zona', user.id, { enderecoIds })
      return reply.status(201).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // DELETE /zonas/:id/enderecos/:enderecoId — Desvincular endereço da zona
  // ==========================================================================
  app.delete('/zonas/:id/enderecos/:enderecoId', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const params = request.params as { id: string; enderecoId: string }
      const { id } = idParamsSchema.parse({ id: params.id })
      const enderecoId = params.enderecoId
      const resultado = await pickingZonaService.desvincularEndereco(user.empresaId, id, enderecoId)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /separadores — Listar separadores de zona
  // ==========================================================================
  app.get('/separadores', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const query = request.query as { zonaId?: string }
      const resultado = await pickingZonaService.listarSeparadores(user.empresaId, query.zonaId)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /separadores — Atribuir separador a zona
  // ==========================================================================
  app.post('/separadores', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = atribuirSeparadorSchema.parse(request.body)
      const resultado = await pickingZonaService.atribuirSeparador(user.empresaId, body)
      audit(user.empresaId, 'SeparadorZona', resultado.id, 'ATRIBUIR_SEPARADOR', 'Separador atribuído à zona', user.id, { zonaId: body.zonaId, usuarioId: body.usuarioId })
      return reply.status(201).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // DELETE /separadores/:id — Remover separador de zona
  // ==========================================================================
  app.delete('/separadores/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)
      const resultado = await pickingZonaService.removerSeparador(user.empresaId, id)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /pontos-consolidacao — Listar pontos de consolidação
  // ==========================================================================
  app.get('/pontos-consolidacao', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const query = request.query as { cdId?: string }
      const resultado = await pickingZonaService.listarPontosConsolidacao(user.empresaId, query.cdId)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /pontos-consolidacao — Criar ponto de consolidação
  // ==========================================================================
  app.post('/pontos-consolidacao', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = createPontoSchema.parse(request.body)
      const resultado = await pickingZonaService.criarPontoConsolidacao(user.empresaId, body)
      return reply.status(201).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /sub-ondas — Listar sub-ondas (TBD, basic list)
  // ==========================================================================
  app.get('/sub-ondas', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const filters = listSubOndasSchema.parse(request.query)
      const page = filters.page
      const limit = filters.limit
      const skip = (page - 1) * limit

      const where: any = { empresaId: user.empresaId }
      if (filters.ondaSeparacaoId) where.ondaSeparacaoId = filters.ondaSeparacaoId
      if (filters.zonaPickingId) where.zonaPickingId = filters.zonaPickingId
      if (filters.status) where.status = filters.status

      const [data, total] = await Promise.all([
        prisma.subOnda.findMany({
          where,
          skip,
          take: limit,
          orderBy: { criadoEm: 'desc' },
          include: {
            zonaPicking: { select: { id: true, nome: true, codigo: true, cor: true } },
          },
        }),
        prisma.subOnda.count({ where }),
      ])

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /ondas/:ondaId/dividir — Dividir onda por zona
  // ==========================================================================
  app.post('/ondas/:ondaId/dividir', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { ondaId } = dividirOndaSchema.parse(request.params)
      const resultado = await pickingZonaService.dividirOndaPorZona(user.empresaId, ondaId)
      audit(user.empresaId, 'SubOnda', ondaId, 'DIVIDIR_ONDA', 'Onda dividida por zona', user.id, { ondaId, subOndas: resultado.length })
      return reply.status(201).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /ondas/:ondaId/balancear — Balancear sub-ondas entre separadores
  // ==========================================================================
  app.post('/ondas/:ondaId/balancear', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { ondaId } = dividirOndaSchema.parse(request.params)
      const resultado = await pickingZonaService.balancearSubOndas(user.empresaId, ondaId)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /painel — Painel de acompanhamento por zona
  // ==========================================================================
  app.get('/painel', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { cdId } = painelZonasSchema.parse(request.query)
      const resultado = await pickingZonaService.painelZonas(user.empresaId, cdId)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })
}
