import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { listarSaldoConsolidado } from './saldo-consolidado.service'

function getDb(request: any) { return request.prismaScoped || prisma }

// Filtro explícito por empresaId — camada obrigatória além do prismaScoped.
// O tenant-context dá bypass para SUPER_ADMIN (usa prisma global sem filtro),
// então rotas que dependem SÓ do prismaScoped vazam dados de todas as empresas
// quando um SUPER_ADMIN está logado (bug real: empresa nova MPL exibindo saldos
// da VisioFab Testes). Sempre filtrar por user.empresaId aqui.
function getEmpresaId(request: any): string | undefined {
  return (request.user as { empresaId?: string } | undefined)?.empresaId
}

export async function saldoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // GET /saldos/consolidado — visão por produto com origem (WMS/ERP),
  // reservado (venda + produção) e disponível. Endereços detalhados quando WMS.
  app.get('/consolidado', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const q = z.object({ busca: z.string().optional() }).parse(request.query)
    try {
      const data = await listarSaldoConsolidado(user.empresaId, q.busca)
      return reply.status(200).send({ data, total: data.length })
    } catch (err: any) {
      return reply.status(err.statusCode || 500).send({ message: err.message || 'Erro ao consolidar saldos' })
    }
  })

  app.get('/', async (request) => {
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
    const q = z.object({
      page: z.coerce.number().default(1),
      limit: z.coerce.number().default(50),
      search: z.string().optional(),
    }).parse(request.query)

    // Isola por empresa da sessão (inclui saldos legados com empresaId null,
    // mesma tolerância do saldo-consolidado.service.ts). Usa AND para não
    // conflitar com o OR do filtro de busca.
    const filtros: any[] = []
    if (empresaId) {
      filtros.push({ OR: [{ empresaId }, { empresaId: null }] })
    }
    if (q.search) {
      filtros.push({
        OR: [
          { endereco: { enderecoCompleto: { contains: q.search, mode: 'insensitive' } } },
          { produto: { nome: { contains: q.search, mode: 'insensitive' } } },
          { produto: { codigo: { contains: q.search, mode: 'insensitive' } } },
        ],
      })
    }
    const where: any = filtros.length > 0 ? { AND: filtros } : {}

    const [data, total] = await Promise.all([
      db.saldoEndereco.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: {
          endereco: { select: { enderecoCompleto: true } },
          produto: { select: { nome: true, codigo: true, unidade: true } },
        },
        orderBy: { atualizadoEm: 'desc' },
      }),
      db.saldoEndereco.count({ where }),
    ])

    return { data, total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) }
  })

  // Resumo de estoque
  app.get('/resumo', async (request) => {
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
    const where: any = empresaId ? { OR: [{ empresaId }, { empresaId: null }] } : {}
    const total = await db.saldoEndereco.count({ where })
    const totalQtd = await db.saldoEndereco.aggregate({ _sum: { quantidade: true }, where })
    const produtosComSaldo = await db.saldoEndereco.groupBy({ by: ['produtoId'], _count: true, where })
    return {
      totalRegistros: total,
      quantidadeTotal: totalQtd._sum.quantidade || 0,
      produtosDistintos: produtosComSaldo.length,
    }
  })
}
