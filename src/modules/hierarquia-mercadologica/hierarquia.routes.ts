import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import {
  validarCodigoSegmento,
  composeCodigoHierarquico,
  montarCaminhoCompleto,
  TIPO_PAI_OBRIGATORIO,
  TIPOS_NIVEL,
  type TipoNivel,
} from './hierarquia.service'

function getDb(request: any) { return request.prismaScoped || prisma }
function getEmpresaId(request: any): string | undefined {
  return (request.user as { empresaId?: string } | undefined)?.empresaId
}
function isAdmin(request: any): boolean {
  const perfil = (request.user as { perfil?: string } | undefined)?.perfil
  return ['ADMIN', 'SUPER_ADMIN'].includes(perfil ?? '')
}

const tipoEnum = z.enum(TIPOS_NIVEL as [TipoNivel, ...TipoNivel[]])

export async function hierarquiaMercadologicaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // GET / — lista níveis com filtros (tipo, paiId, status, search). Inclui 1 nível de pai.
  app.get('/', async (request) => {
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
    const q = z.object({
      tipo: tipoEnum.optional(),
      paiId: z.string().uuid().optional(),
      status: z.coerce.boolean().optional(),
      search: z.string().optional(),
      page: z.coerce.number().default(1),
      limit: z.coerce.number().default(100),
    }).parse(request.query)

    const where: any = {}
    if (empresaId) where.empresaId = empresaId
    if (q.tipo) where.tipo = q.tipo
    if (q.paiId) where.paiId = q.paiId
    if (q.status !== undefined) where.status = q.status
    if (q.search) {
      where.OR = [
        { descricao: { contains: q.search, mode: 'insensitive' as const } },
        { codigoHierarquico: { contains: q.search } },
      ]
    }

    const [data, total] = await Promise.all([
      db.nivelMercadologico.findMany({
        where, skip: (q.page - 1) * q.limit, take: q.limit,
        orderBy: [{ tipo: 'asc' }, { codigoHierarquico: 'asc' }],
        include: { pai: { select: { id: true, tipo: true, codigo: true, codigoHierarquico: true, descricao: true } } },
      }),
      db.nivelMercadologico.count({ where }),
    ])
    return { data, total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) }
  })

  // GET /:id — detalhe com caminho completo (Departamento → … → nível).
  app.get('/:id', async (request, reply) => {
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const nivel = await db.nivelMercadologico.findFirst({
      where: empresaId ? { id, empresaId } : { id },
      include: {
        pai: { include: { pai: { include: { pai: { include: { pai: true } } } } } },
      },
    })
    if (!nivel) return reply.status(404).send({ message: 'Nível não encontrado' })

    const caminho = montarCaminhoCompleto(nivel as any)
    return { ...nivel, caminho }
  })

  // POST / — cria nível (ADMIN/SUPER_ADMIN).
  app.post('/', async (request, reply) => {
    if (!isAdmin(request)) return reply.status(403).send({ message: 'Somente administradores podem cadastrar níveis mercadológicos' })
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
    if (!empresaId) return reply.status(400).send({ message: 'Empresa não selecionada' })

    const body = z.object({
      tipo: tipoEnum,
      codigo: z.string().min(1),
      descricao: z.string().min(1),
      paiId: z.string().uuid().optional().nullable(),
    }).parse(request.body)

    // Validação de largura do segmento.
    const valSeg = validarCodigoSegmento(body.tipo, body.codigo)
    if (!valSeg.valido) return reply.status(400).send({ message: valSeg.erro })

    // Validação do pai conforme o tipo.
    const tipoPaiEsperado = TIPO_PAI_OBRIGATORIO[body.tipo]
    let codigoHierarquicoPai: string | null = null

    if (body.tipo === 'DEPARTAMENTO') {
      // Departamento não tem pai — ignora paiId se enviado.
    } else {
      if (!body.paiId) {
        return reply.status(400).send({ message: `O nível ${body.tipo} exige um pai do tipo ${tipoPaiEsperado}.` })
      }
      const pai = await db.nivelMercadologico.findFirst({
        where: empresaId ? { id: body.paiId, empresaId } : { id: body.paiId },
        select: { id: true, tipo: true, codigoHierarquico: true },
      })
      if (!pai) return reply.status(400).send({ message: 'Nível pai não encontrado.' })
      if (pai.tipo !== tipoPaiEsperado) {
        return reply.status(400).send({ message: `O pai de um nível ${body.tipo} deve ser do tipo ${tipoPaiEsperado} (recebido: ${pai.tipo}).` })
      }
      codigoHierarquicoPai = pai.codigoHierarquico
    }

    const codigoHierarquico = composeCodigoHierarquico(body.tipo, codigoHierarquicoPai, body.codigo)

    try {
      const criado = await db.nivelMercadologico.create({
        data: {
          tipo: body.tipo,
          codigo: body.codigo,
          codigoHierarquico,
          descricao: body.descricao,
          paiId: body.tipo === 'DEPARTAMENTO' ? null : body.paiId,
          ...(empresaId ? { empresaId } : {}),
        },
      })
      return reply.status(201).send(criado)
    } catch (err: any) {
      if (err?.code === 'P2002') {
        return reply.status(409).send({ message: `Já existe um nível com o código hierárquico "${codigoHierarquico}" nesta empresa.` })
      }
      request.log.error({ err }, 'Falha ao criar nível mercadológico')
      return reply.status(500).send({ message: `Falha ao criar nível: ${err?.message ?? 'erro desconhecido'}` })
    }
  })

  // PUT /:id — atualiza descrição e status (código hierárquico é imutável).
  app.put('/:id', async (request, reply) => {
    if (!isAdmin(request)) return reply.status(403).send({ message: 'Somente administradores podem editar níveis mercadológicos' })
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const existente = await db.nivelMercadologico.findFirst({ where: empresaId ? { id, empresaId } : { id } })
    if (!existente) return reply.status(404).send({ message: 'Nível não encontrado' })

    const body = z.object({
      descricao: z.string().min(1).optional(),
      status: z.boolean().optional(),
    }).parse(request.body)
    return db.nivelMercadologico.update({ where: { id }, data: body })
  })

  // PATCH /:id/status — ativa/inativa.
  app.patch('/:id/status', async (request, reply) => {
    if (!isAdmin(request)) return reply.status(403).send({ message: 'Somente administradores podem alterar o status' })
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const { status } = z.object({ status: z.boolean() }).parse(request.body)
    const existente = await db.nivelMercadologico.findFirst({ where: empresaId ? { id, empresaId } : { id } })
    if (!existente) return reply.status(404).send({ message: 'Nível não encontrado' })
    return db.nivelMercadologico.update({ where: { id }, data: { status } })
  })

  // DELETE /:id — recusa se há filhos ou produtos vinculados.
  app.delete('/:id', async (request, reply) => {
    if (!isAdmin(request)) return reply.status(403).send({ message: 'Somente administradores podem excluir níveis mercadológicos' })
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const existente = await db.nivelMercadologico.findFirst({ where: empresaId ? { id, empresaId } : { id } })
    if (!existente) return reply.status(404).send({ message: 'Nível não encontrado' })

    const [filhos, produtos] = await Promise.all([
      db.nivelMercadologico.count({ where: { paiId: id } }),
      prisma.produto.count({ where: { familiaId: id } }),
    ])
    if (filhos > 0) {
      return reply.status(409).send({ message: `Não é possível excluir: este nível possui ${filhos} nível(is) filho(s). Inative em vez de excluir.` })
    }
    if (produtos > 0) {
      return reply.status(409).send({ message: `Não é possível excluir: este nível está vinculado a ${produtos} produto(s). Inative em vez de excluir.` })
    }
    await db.nivelMercadologico.delete({ where: { id } })
    return reply.status(204).send()
  })
}
