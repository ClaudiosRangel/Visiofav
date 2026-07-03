import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { relatoriosVendasService } from './relatorios-vendas.service'

const filtroQuerySchema = z.object({
  dataInicio: z.string().optional(),
  dataFim: z.string().optional(),
  vendedorId: z.string().uuid().optional(),
  clienteId: z.string().uuid().optional(),
})

export async function relatoriosVendasRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('VENDAS'))

  // GET /resumo — KPIs gerais
  app.get('/resumo', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const filtros = filtroQuerySchema.parse(request.query)
    return relatoriosVendasService.resumo(user.empresaId, filtros)
  })

  // GET /por-periodo — vendas agrupadas por dia/semana/mês
  app.get('/por-periodo', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const query = z.object({
      ...filtroQuerySchema.shape,
      agrupamento: z.enum(['dia', 'semana', 'mes']).optional().default('dia'),
    }).parse(request.query)
    return relatoriosVendasService.vendasPorPeriodo(user.empresaId, query)
  })

  // GET /por-vendedor — ranking de vendedores
  app.get('/por-vendedor', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const filtros = filtroQuerySchema.parse(request.query)
    return relatoriosVendasService.vendasPorVendedor(user.empresaId, filtros)
  })

  // GET /por-cliente — top clientes
  app.get('/por-cliente', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const query = z.object({
      ...filtroQuerySchema.shape,
      top: z.coerce.number().int().positive().max(100).optional().default(20),
    }).parse(request.query)
    return relatoriosVendasService.vendasPorCliente(user.empresaId, query)
  })

  // GET /curva-abc — classificação ABC de produtos
  app.get('/curva-abc', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const filtros = filtroQuerySchema.parse(request.query)
    return relatoriosVendasService.curvaABC(user.empresaId, filtros)
  })
}
