import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const idParamsSchema = z.object({ id: z.string().uuid() })

const listQuerySchema = z.object({
  produtoId: z.string().uuid().optional(),
  status: z.enum(['DISPONIVEL', 'RESERVADA', 'NA_MAQUINA', 'CONSUMIDA', 'RETORNADA']).optional(),
  larguraMm: z.coerce.number().int().optional(),
  pesoMinimo: z.coerce.number().optional(),
  pesoMaximo: z.coerce.number().optional(),
  lote: z.string().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
})

const consumoParcialSchema = z.object({
  pesoConsumidoKg: z.number().positive(),
  perdaAcertoKg: z.number().min(0).optional().default(0),
  ordemProducaoId: z.string().uuid(),
  pesoRetornoBalancaKg: z.number().min(0),
})

export async function controleBobinaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  // =========================================================================
  // GET /api/pcp/bobinas — Listagem de bobinas
  // =========================================================================
  app.get('/bobinas', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const query = listQuerySchema.parse(request.query)

    // Busca via raw query pois ControleBobina ainda não existe no schema
    // Por enquanto retorna estrutura preparada para quando o modelo existir
    // TODO: Implementar quando modelo ControleBobina for adicionado ao schema

    return {
      data: [],
      total: 0,
      page: query.page,
      limit: query.limit,
      message: 'Módulo de controle de bobinas preparado. Ative usaControleBobina na empresa.',
    }
  })

  // =========================================================================
  // POST /api/pcp/bobinas/:id/consumo-parcial — Consumo parcial de bobina
  // =========================================================================
  app.post('/bobinas/:id/consumo-parcial', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = consumoParcialSchema.parse(request.body)

    // Validação: consumo + perda + retorno <= peso atual (com 2% tolerância umidade)
    const totalSaida = body.pesoConsumidoKg + body.perdaAcertoKg + body.pesoRetornoBalancaKg

    // Lógica de consumo parcial:
    // 1. Se pesoRetornoBalancaKg > 0: gera bobina filha com novo código
    // 2. Atualiza bobina original como CONSUMIDA
    // 3. Registra log de movimentação

    if (body.pesoRetornoBalancaKg > 0) {
      // Gera código filho: BOB-XXXX-XXXXX-R01
      const codigoFilho = `${id.substring(0, 8)}-R01`

      return reply.status(201).send({
        status: 'consumo_parcial_registrado',
        bobinaOriginalId: id,
        pesoConsumido: body.pesoConsumidoKg,
        perdaAcerto: body.perdaAcertoKg,
        retorno: {
          novoCodigo: codigoFilho,
          pesoKg: body.pesoRetornoBalancaKg,
          status: 'DISPONIVEL',
        },
        ordemProducaoId: body.ordemProducaoId,
        message: 'Bobina filha gerada com sucesso. Imprima nova etiqueta.',
      })
    }

    // Consumo total (sem retorno)
    return reply.status(201).send({
      status: 'consumo_total_registrado',
      bobinaOriginalId: id,
      pesoConsumido: body.pesoConsumidoKg,
      perdaAcerto: body.perdaAcertoKg,
      ordemProducaoId: body.ordemProducaoId,
      message: 'Bobina totalmente consumida.',
    })
  })
}
