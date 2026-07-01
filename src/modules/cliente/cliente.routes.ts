import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { coordenadasOptionalSchema } from '../geolocalizacao/coord-validation'

export async function clienteRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId?: string }
    const q = z.object({
      page: z.coerce.number().default(1),
      limit: z.coerce.number().default(20),
      busca: z.string().optional(),
      search: z.string().optional(),
      status: z.string().optional(),
    }).parse(request.query)

    const search = q.busca || q.search
    const where: any = {}
    if (user.empresaId) where.empresaId = user.empresaId
    if (search) {
      where.OR = [
        { razaoSocial: { contains: search, mode: 'insensitive' } },
        { nomeFantasia: { contains: search, mode: 'insensitive' } },
        { cpfCnpj: { contains: search } },
      ]
    }
    if (q.status) where.status = q.status === 'true'

    const [data, total] = await Promise.all([
      prisma.cliente.findMany({ where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { razaoSocial: 'asc' } }),
      prisma.cliente.count({ where }),
    ])
    return { data, total }
  })

  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    const baseSchema = z.object({
      razaoSocial: z.string().min(1),
      nomeFantasia: z.string().optional(),
      cpfCnpj: z.string().min(1),
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
      rotaId: z.string().uuid().optional().nullable(),
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

    if (!user.empresaId) return reply.status(400).send({ message: 'Empresa não selecionada' })

    // Validate rotaId belongs to same empresa
    if (data.rotaId) {
      const rota = await prisma.rota.findFirst({
        where: { id: data.rotaId, empresaId: user.empresaId },
      })
      if (!rota) return reply.status(422).send({ message: 'Rota não encontrada ou não pertence a esta empresa' })
    }

    return reply.status(201).send(await prisma.cliente.create({ data: { ...data, empresaId: user.empresaId } }))
  })

  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const baseSchema = z.object({
      razaoSocial: z.string().optional(),
      nomeFantasia: z.string().optional(),
      cpfCnpj: z.string().optional(),
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
      rotaId: z.string().uuid().optional().nullable(),
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

    // Validate rotaId belongs to same empresa
    if (data.rotaId) {
      if (!user.empresaId) return reply.status(400).send({ message: 'Empresa não selecionada' })
      const rota = await prisma.rota.findFirst({
        where: { id: data.rotaId, empresaId: user.empresaId },
      })
      if (!rota) return reply.status(422).send({ message: 'Rota não encontrada ou não pertence a esta empresa' })
    }

    const updated = await prisma.cliente.update({ where: { id }, data })

    // Invalidar sequências de entrega quando coordenadas são alteradas
    if (data.latitude !== undefined || data.longitude !== undefined) {
      // Buscar documentoFiscalIds vinculadas a este cliente (via DocumentoFiscal → vendaEfetivada → pedidoVenda → clienteId)
      const nfesDoCliente = await prisma.documentoFiscal.findMany({
        where: {
          empresaId: updated.empresaId,
          vendaEfetivada: {
            pedidoVenda: {
              clienteId: id,
            },
          },
        },
        select: { id: true },
      })

      if (nfesDoCliente.length > 0) {
        const nfeIds = nfesDoCliente.map((n) => n.id)

        // Buscar MapaCarregamentos em status AGUARDANDO_SEPARACAO ou EM_CARREGAMENTO
        // que contenham NFs desse cliente e tenham sequência válida
        const mapasAfetados = await prisma.mapaCarregamento.findMany({
          where: {
            empresaId: updated.empresaId,
            sequenciaValida: true,
            status: { in: ['AGUARDANDO_SEPARACAO', 'EM_CARREGAMENTO'] },
            nfs: {
              some: {
                nfeId: { in: nfeIds },
              },
            },
          },
          select: { id: true },
        })

        if (mapasAfetados.length > 0) {
          const mapaIds = mapasAfetados.map((m) => m.id)

          await prisma.$transaction([
            // Invalidar os mapas
            prisma.mapaCarregamento.updateMany({
              where: { id: { in: mapaIds } },
              data: { sequenciaValida: false, distanciaTotalKm: null },
            }),
            // Limpar ordemEntrega e distanciaParcialKm nas NFs desses mapas
            prisma.mapaCarregamentoNf.updateMany({
              where: { mapaCarregamentoId: { in: mapaIds } },
              data: { ordemEntrega: null, distanciaParcialKm: null },
            }),
          ])
        }
      }
    }

    return updated
  })

  app.patch('/:id/inativar', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    return prisma.cliente.update({ where: { id }, data: { status: false } })
  })

  app.delete('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    await prisma.cliente.delete({ where: { id } })
    return reply.status(204).send()
  })
}
