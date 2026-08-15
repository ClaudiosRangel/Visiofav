/**
 * Rota de busca de municípios por nome/UF
 * Usa a API pública do IBGE (servicodados.ibge.gov.br)
 * 
 * GET /cte/municipios?nome=NITEROI&uf=RJ
 * Retorna: { codigo: '3303302', nome: 'Niterói', uf: 'RJ' }
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'

// Cache em memória (TTL 24h) — evita chamadas repetidas à API do IBGE
const cache = new Map<string, { data: any[]; ts: number }>()
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

export async function buscarMunicipiosIBGE(uf: string): Promise<Array<{ codigo: string; nome: string; uf: string }>> {
  const cacheKey = `mun_${uf}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data
  }

  try {
    const url = `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`
    const response = await fetch(url)
    if (!response.ok) return []
    const dados = await response.json() as any[]

    const municipios = dados.map(m => ({
      codigo: String(m.id),
      nome: m.nome as string,
      uf: uf.toUpperCase(),
    }))

    cache.set(cacheKey, { data: municipios, ts: Date.now() })
    return municipios
  } catch {
    return []
  }
}

export async function cteMunicipiosRoutes(app: FastifyInstance) {

  // GET /cte/municipios?nome=NITEROI&uf=RJ
  app.get('/cte/municipios', async (request, reply) => {
    const params = z.object({
      nome: z.string().min(2).optional(),
      uf: z.string().length(2),
    }).parse(request.query)

    const municipios = await buscarMunicipiosIBGE(params.uf)

    if (params.nome) {
      const busca = params.nome.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      const filtrados = municipios.filter(m => {
        const nomeNorm = m.nome.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        return nomeNorm.includes(busca) || nomeNorm.startsWith(busca)
      })
      // Priorizar match exato
      filtrados.sort((a, b) => {
        const aNorm = a.nome.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        const bNorm = b.nome.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        if (aNorm === busca) return -1
        if (bNorm === busca) return 1
        return aNorm.localeCompare(bNorm)
      })
      return filtrados.slice(0, 20)
    }

    return municipios
  })
}
