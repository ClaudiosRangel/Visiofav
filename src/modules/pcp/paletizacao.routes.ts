import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const calcularPaletizacaoSchema = z.object({
  itens: z.array(z.object({
    produtoId: z.string().uuid().optional(),
    descricao: z.string().optional(),
    quantidade: z.number().int().positive(),
    pesoUnitarioKg: z.number().positive(),
    larguraCm: z.number().positive(),
    alturaCm: z.number().positive(),
    profundidadeCm: z.number().positive(),
  })).min(1),
  tipoPalete: z.enum(['MADEIRA_1000x1200', 'MADEIRA_800x1200', 'PLASTICO', 'CUSTOMIZADO']).optional().default('MADEIRA_1000x1200'),
  pesoMaximoPaleteKg: z.number().positive().optional().default(1000),
  alturaMaximaPaleteCm: z.number().positive().optional().default(180),
})

// Peso do palete vazio por tipo (kg)
const PESO_PALETE: Record<string, number> = {
  MADEIRA_1000x1200: 25,
  MADEIRA_800x1200: 20,
  PLASTICO: 15,
  CUSTOMIZADO: 20,
}

// Dimensões do palete (cm)
const DIMENSOES_PALETE: Record<string, { largura: number; profundidade: number }> = {
  MADEIRA_1000x1200: { largura: 100, profundidade: 120 },
  MADEIRA_800x1200: { largura: 80, profundidade: 120 },
  PLASTICO: { largura: 100, profundidade: 120 },
  CUSTOMIZADO: { largura: 100, profundidade: 120 },
}

interface ItemPalete {
  descricao?: string
  quantidade: number
  pesoTotalKg: number
  alturaCm: number
}

interface PaleteCalculado {
  numero: number
  itens: ItemPalete[]
  pesoItensKg: number
  pesoPaleteKg: number
  pesoTotalKg: number
  alturaUtilCm: number
  alturaTotalCm: number
  percentualOcupacaoAltura: number
  percentualOcupacaoPeso: number
}

export async function paletizacaoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  // =========================================================================
  // POST /api/pcp/paletizacao/calcular — Cálculo de paletização dinâmica
  // =========================================================================
  app.post('/paletizacao/calcular', async (request) => {
    const body = calcularPaletizacaoSchema.parse(request.body)

    const pesoPaleteVazio = PESO_PALETE[body.tipoPalete]
    const pesoMaximoUtil = body.pesoMaximoPaleteKg - pesoPaleteVazio
    const alturaMaximaUtil = body.alturaMaximaPaleteCm - 15 // 15cm para o palete em si

    const paletes: PaleteCalculado[] = []
    let paleteAtual: PaleteCalculado = criarPalete(1, pesoPaleteVazio)

    for (const item of body.itens) {
      let quantidadeRestante = item.quantidade

      while (quantidadeRestante > 0) {
        // Quantas unidades cabem no palete atual?
        const pesoDisponivel = pesoMaximoUtil - paleteAtual.pesoItensKg
        const alturaDisponivel = alturaMaximaUtil - paleteAtual.alturaUtilCm

        const maxPorPeso = Math.floor(pesoDisponivel / item.pesoUnitarioKg)
        const maxPorAltura = Math.floor(alturaDisponivel / item.alturaCm)
        const maxCabe = Math.min(maxPorPeso, maxPorAltura, quantidadeRestante)

        if (maxCabe <= 0) {
          // Palete cheio — fecha e abre novo
          paletes.push(finalizarPalete(paleteAtual, pesoMaximoUtil, alturaMaximaUtil))
          paleteAtual = criarPalete(paletes.length + 1, pesoPaleteVazio)
          continue
        }

        // Adiciona ao palete atual
        paleteAtual.itens.push({
          descricao: item.descricao,
          quantidade: maxCabe,
          pesoTotalKg: Math.round(maxCabe * item.pesoUnitarioKg * 1000) / 1000,
          alturaCm: Math.round(maxCabe * item.alturaCm * 100) / 100,
        })
        paleteAtual.pesoItensKg += maxCabe * item.pesoUnitarioKg
        paleteAtual.alturaUtilCm += maxCabe * item.alturaCm
        quantidadeRestante -= maxCabe
      }
    }

    // Fecha último palete se tem itens
    if (paleteAtual.itens.length > 0) {
      paletes.push(finalizarPalete(paleteAtual, pesoMaximoUtil, alturaMaximaUtil))
    }

    // Totais
    const pesoTotalExpedicao = paletes.reduce((acc, p) => acc + p.pesoTotalKg, 0)
    const volumeTotalM3 = paletes.length * (
      (DIMENSOES_PALETE[body.tipoPalete].largura / 100) *
      (DIMENSOES_PALETE[body.tipoPalete].profundidade / 100) *
      (body.alturaMaximaPaleteCm / 100)
    )

    return {
      tipoPalete: body.tipoPalete,
      configuracao: {
        pesoMaximoPaleteKg: body.pesoMaximoPaleteKg,
        alturaMaximaPaleteCm: body.alturaMaximaPaleteCm,
        pesoPaleteVazioKg: pesoPaleteVazio,
      },
      numeroPaletes: paletes.length,
      paletes,
      totais: {
        pesoTotalExpedicaoKg: Math.round(pesoTotalExpedicao * 1000) / 1000,
        volumeTotalM3: Math.round(volumeTotalM3 * 1000) / 1000,
        quantidadeTotalItens: body.itens.reduce((acc, i) => acc + i.quantidade, 0),
      },
    }
  })
}

function criarPalete(numero: number, pesoPaleteVazio: number): PaleteCalculado {
  return {
    numero,
    itens: [],
    pesoItensKg: 0,
    pesoPaleteKg: pesoPaleteVazio,
    pesoTotalKg: pesoPaleteVazio,
    alturaUtilCm: 0,
    alturaTotalCm: 15, // altura do palete vazio
    percentualOcupacaoAltura: 0,
    percentualOcupacaoPeso: 0,
  }
}

function finalizarPalete(palete: PaleteCalculado, pesoMaxUtil: number, alturaMaxUtil: number): PaleteCalculado {
  palete.pesoTotalKg = Math.round((palete.pesoItensKg + palete.pesoPaleteKg) * 1000) / 1000
  palete.pesoItensKg = Math.round(palete.pesoItensKg * 1000) / 1000
  palete.alturaTotalCm = Math.round((palete.alturaUtilCm + 15) * 100) / 100
  palete.percentualOcupacaoAltura = Math.round((palete.alturaUtilCm / alturaMaxUtil) * 100)
  palete.percentualOcupacaoPeso = Math.round((palete.pesoItensKg / pesoMaxUtil) * 100)
  return palete
}
