import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { calcularConsumoPlana, calcularConsumoRotativa } from './calculo-consumo-grafico.service'

const calculoPlanaSchema = z.object({
  tipo: z.literal('PLANA'),
  qtdPedida: z.number().int().positive(),
  aproveitamento: z.number().int().positive('Aproveitamento deve ser > 0 (quantos produtos cabem em 1 folha)'),
  percentualPerda: z.number().min(0).max(100).default(10),
  larguraFolhaMm: z.number().positive(),
  comprimentoFolhaMm: z.number().positive(),
  gramaturaGm2: z.number().positive(),
})

const calculoRotativaSchema = z.object({
  tipo: z.literal('ROTATIVA'),
  qtdPedida: z.number().int().positive(),
  repeticaoCorteMm: z.number().positive('Repetição de corte (passo do cilindro) deve ser > 0'),
  produtosPorPuxada: z.number().int().positive('Produtos por puxada deve ser > 0'),
  metrosAcertoFixo: z.number().min(0).default(50),
  larguraBobinaMm: z.number().positive(),
  gramaturaGm2: z.number().positive(),
})

const calculoSchema = z.discriminatedUnion('tipo', [calculoPlanaSchema, calculoRotativaSchema])

export async function calculoConsumoGraficoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  /**
   * POST /api/pcp/calculo-consumo
   *
   * Calcula o consumo teórico de matéria-prima para uma OP gráfica.
   * Retorna: folhas ou metros lineares + peso em KG para reserva no WMS.
   *
   * Tipo PLANA: impressão offset/digital em folhas
   * Tipo ROTATIVA: impressão flexo/rotogravura em bobinas
   */
  app.post('/calculo-consumo', async (request, reply) => {
    const body = calculoSchema.parse(request.body)

    try {
      if (body.tipo === 'PLANA') {
        const resultado = calcularConsumoPlana(body)
        return resultado
      } else {
        const resultado = calcularConsumoRotativa(body)
        return resultado
      }
    } catch (err: any) {
      return reply.status(400).send({ message: err.message || 'Erro no cálculo' })
    }
  })

  /**
   * GET /api/pcp/calculo-consumo/exemplos
   *
   * Retorna exemplos de payloads para cada tipo de cálculo (documentação inline).
   */
  app.get('/calculo-consumo/exemplos', async () => {
    return {
      plana: {
        descricao: 'Impressão Plana (Offset/Digital) — Cálculo de Folhas Físicas',
        formula: 'Folhas = Ceil(QtdPedida/Aproveitamento × (1 + %Perda/100))',
        formulaPeso: 'Peso(kg) = Largura(m) × Comprimento(m) × Gramatura(g/m²) × TotalFolhas / 1000',
        exemplo: {
          tipo: 'PLANA',
          qtdPedida: 10000,
          aproveitamento: 8,
          percentualPerda: 10,
          larguraFolhaMm: 660,
          comprimentoFolhaMm: 960,
          gramaturaGm2: 150,
        },
        resultadoEsperado: {
          folhasFisicas: 1375,
          pesoTotalKg: 130.68,
        },
      },
      rotativa: {
        descricao: 'Impressão Rotativa/Flexografia — Cálculo de Metros Lineares',
        formula: 'Metros = (QtdPedida/ProdutosPorPuxada × RepetiçãoCorte(mm) / 1000) + MetrosAcerto',
        formulaPeso: 'Peso(kg) = LarguraBobina(m) × TotalMetros × Gramatura(g/m²) / 1000',
        exemplo: {
          tipo: 'ROTATIVA',
          qtdPedida: 50000,
          repeticaoCorteMm: 250,
          produtosPorPuxada: 4,
          metrosAcertoFixo: 50,
          larguraBobinaMm: 1000,
          gramaturaGm2: 80,
        },
        resultadoEsperado: {
          metrosLineares: 3175,
          pesoTotalKg: 254,
        },
      },
    }
  })
}
