import { prisma } from '../../lib/prisma'
import { calcularDistanciaHaversine } from './haversine'

export interface GeocodingResult {
  success: boolean
  latitude?: number
  longitude?: number
  error?: string
}

export interface BatchGeocodingResult {
  total: number
  sucessos: number
  falhas: number
  detalhes: Array<{ clienteId: string; success: boolean; error?: string }>
}

export interface SugestaoRota {
  rotaId: string
  codigo: string
  descricao: string
  distanciaMediaKm: number
  quantidadeClientes: number
}

export interface AreaCobertura {
  rotaId: string
  codigo: string
  descricao: string
  totalClientesGeocodificados: number
  totalClientesNaoGeocodificados: number
  cidades: Array<{
    nome: string
    quantidadeClientes: number
    bairros: Array<{ nome: string; quantidadeClientes: number }>
  }>
}

export class GeoService {
  /**
   * Geocodifica o endereço de um cliente usando serviço externo (Nominatim/OpenStreetMap).
   * - Busca endereço do cliente (CEP, cidade, UF, logradouro)
   * - Consulta API externa com timeout de 10 segundos
   * - Atualiza lat/lng no banco em caso de sucesso
   * - Retorna erro 503 se serviço externo indisponível
   * - Retorna erro 422 se geocodificação não encontrar resultado
   */
  async geocodificarCliente(clienteId: string, empresaId: string): Promise<GeocodingResult> {
    const cliente = await prisma.cliente.findFirst({
      where: { id: clienteId, empresaId },
      select: {
        id: true,
        cep: true,
        cidade: true,
        uf: true,
        logradouro: true,
        numero: true,
      },
    })

    if (!cliente) {
      return { success: false, error: 'Cliente não encontrado' }
    }

    // Montar query de geocodificação a partir do endereço
    const queryParts: string[] = []
    if (cliente.logradouro) queryParts.push(cliente.logradouro)
    if (cliente.numero) queryParts.push(cliente.numero)
    if (cliente.cidade) queryParts.push(cliente.cidade)
    if (cliente.uf) queryParts.push(cliente.uf)
    if (cliente.cep) queryParts.push(cliente.cep)

    if (queryParts.length === 0) {
      return { success: false, error: 'Cliente não possui endereço cadastrado para geocodificação' }
    }

    const query = queryParts.join(', ')

    // Consultar API externa com timeout de 10 segundos
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)

    let response: Response
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=br`
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'VisioFab-WMS/1.0',
        },
      })
    } catch (err: any) {
      clearTimeout(timeoutId)
      if (err.name === 'AbortError') {
        const error = new Error('Serviço de geocodificação indisponível. Tente novamente mais tarde')
        ;(error as any).statusCode = 503
        throw error
      }
      const error = new Error('Serviço de geocodificação indisponível. Tente novamente mais tarde')
      ;(error as any).statusCode = 503
      throw error
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      const error = new Error('Serviço de geocodificação indisponível. Tente novamente mais tarde')
      ;(error as any).statusCode = 503
      throw error
    }

    let data: Array<{ lat: string; lon: string }>
    try {
      data = (await response.json()) as Array<{ lat: string; lon: string }>
    } catch {
      const error = new Error('Serviço de geocodificação indisponível. Tente novamente mais tarde')
      ;(error as any).statusCode = 503
      throw error
    }

    if (!data || data.length === 0) {
      const error = new Error('Não foi possível geocodificar o endereço fornecido')
      ;(error as any).statusCode = 422
      throw error
    }

    const latitude = parseFloat(data[0].lat)
    const longitude = parseFloat(data[0].lon)

    // Atualizar coordenadas no banco
    await prisma.cliente.update({
      where: { id: clienteId },
      data: { latitude, longitude },
    })

    return { success: true, latitude, longitude }
  }

  /**
   * Geocodifica endereços em lote (batch).
   * Processa cada cliente sequencialmente; falha em um item não interrompe o lote.
   * Retorna resumo com total, sucessos, falhas e detalhes por cliente.
   */
  async geocodificarBatch(clienteIds: string[], empresaId: string): Promise<BatchGeocodingResult> {
    const detalhes: BatchGeocodingResult['detalhes'] = []
    let sucessos = 0
    let falhas = 0

    for (const clienteId of clienteIds) {
      try {
        const result = await this.geocodificarCliente(clienteId, empresaId)
        if (result.success) {
          sucessos++
          detalhes.push({ clienteId, success: true })
        } else {
          falhas++
          detalhes.push({ clienteId, success: false, error: result.error })
        }
      } catch (err: any) {
        falhas++
        detalhes.push({ clienteId, success: false, error: err.message || 'Erro desconhecido' })
      }
    }

    return {
      total: clienteIds.length,
      sucessos,
      falhas,
      detalhes,
    }
  }

  /**
   * Geocodifica o endereço da empresa usando serviço externo (Nominatim/OpenStreetMap).
   * - Busca endereço da empresa (CEP, cidade, UF, logradouro, número)
   * - Consulta API externa com timeout de 10 segundos
   * - Atualiza lat/lng no banco em caso de sucesso
   * - Retorna erro 503 se serviço externo indisponível
   * - Retorna erro 422 se geocodificação não encontrar resultado
   */
  async geocodificarEmpresa(empresaId: string): Promise<GeocodingResult> {
    const empresa = await prisma.empresa.findFirst({
      where: { id: empresaId },
      select: {
        id: true,
        cep: true,
        cidade: true,
        uf: true,
        logradouro: true,
        numero: true,
      },
    })

    if (!empresa) {
      return { success: false, error: 'Empresa não encontrada' }
    }

    // Montar query de geocodificação a partir do endereço
    const queryParts: string[] = []
    if (empresa.logradouro) queryParts.push(empresa.logradouro)
    if (empresa.numero) queryParts.push(empresa.numero)
    if (empresa.cidade) queryParts.push(empresa.cidade)
    if (empresa.uf) queryParts.push(empresa.uf)
    if (empresa.cep) queryParts.push(empresa.cep)

    if (queryParts.length === 0) {
      return { success: false, error: 'Empresa não possui endereço cadastrado para geocodificação' }
    }

    const query = queryParts.join(', ')

    // Consultar API externa com timeout de 10 segundos
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)

    let response: Response
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=br`
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'VisioFab-WMS/1.0',
        },
      })
    } catch (err: any) {
      clearTimeout(timeoutId)
      if (err.name === 'AbortError') {
        const error = new Error('Serviço de geocodificação indisponível. Tente novamente mais tarde')
        ;(error as any).statusCode = 503
        throw error
      }
      const error = new Error('Serviço de geocodificação indisponível. Tente novamente mais tarde')
      ;(error as any).statusCode = 503
      throw error
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      const error = new Error('Serviço de geocodificação indisponível. Tente novamente mais tarde')
      ;(error as any).statusCode = 503
      throw error
    }

    let data: Array<{ lat: string; lon: string }>
    try {
      data = (await response.json()) as Array<{ lat: string; lon: string }>
    } catch {
      const error = new Error('Serviço de geocodificação indisponível. Tente novamente mais tarde')
      ;(error as any).statusCode = 503
      throw error
    }

    if (!data || data.length === 0) {
      const error = new Error('Não foi possível geocodificar o endereço fornecido')
      ;(error as any).statusCode = 422
      throw error
    }

    const latitude = parseFloat(data[0].lat)
    const longitude = parseFloat(data[0].lon)

    // Atualizar coordenadas no banco
    await prisma.empresa.update({
      where: { id: empresaId },
      data: { latitude, longitude },
    })

    return { success: true, latitude, longitude }
  }

  /**
   * Retorna a área de cobertura de uma rota específica.
   * Agrupa clientes ativos da rota por cidade e bairro, contando geocodificados e não-geocodificados.
   */
  async areaCoberturaRota(rotaId: string, empresaId: string): Promise<AreaCobertura> {
    // Buscar a rota
    const rota = await prisma.rota.findFirst({
      where: { id: rotaId, empresaId },
      select: { id: true, codigo: true, descricao: true },
    })

    if (!rota) {
      const error = new Error('Rota não encontrada')
      ;(error as any).statusCode = 404
      throw error
    }

    // Buscar todos os clientes ativos da rota
    const clientes = await prisma.cliente.findMany({
      where: { empresaId, rotaId, status: true },
      select: {
        id: true,
        cidade: true,
        bairro: true,
        latitude: true,
        longitude: true,
      },
    })

    // Contar geocodificados e não-geocodificados
    let totalGeocodificados = 0
    let totalNaoGeocodificados = 0

    // Agrupar por cidade → bairro
    const cidadeMap = new Map<string, Map<string, number>>()

    for (const cliente of clientes) {
      if (cliente.latitude !== null && cliente.longitude !== null) {
        totalGeocodificados++
      } else {
        totalNaoGeocodificados++
      }

      const cidadeNome = cliente.cidade || 'Não informado'
      const bairroNome = cliente.bairro || 'Não informado'

      if (!cidadeMap.has(cidadeNome)) {
        cidadeMap.set(cidadeNome, new Map<string, number>())
      }
      const bairroMap = cidadeMap.get(cidadeNome)!
      bairroMap.set(bairroNome, (bairroMap.get(bairroNome) || 0) + 1)
    }

    // Montar resultado
    const cidades: AreaCobertura['cidades'] = []
    for (const [cidadeNome, bairroMap] of cidadeMap) {
      const bairros: Array<{ nome: string; quantidadeClientes: number }> = []
      let totalCidade = 0
      for (const [bairroNome, count] of bairroMap) {
        bairros.push({ nome: bairroNome, quantidadeClientes: count })
        totalCidade += count
      }
      cidades.push({
        nome: cidadeNome,
        quantidadeClientes: totalCidade,
        bairros,
      })
    }

    return {
      rotaId: rota.id,
      codigo: rota.codigo,
      descricao: rota.descricao,
      totalClientesGeocodificados: totalGeocodificados,
      totalClientesNaoGeocodificados: totalNaoGeocodificados,
      cidades,
    }
  }

  /**
   * Retorna a área de cobertura consolidada de todas as rotas ativas da empresa.
   * Identifica sobreposições: cidades/bairros atendidos por mais de uma rota.
   */
  async areaCoberturaConsolidada(empresaId: string): Promise<{
    rotas: AreaCobertura[]
    sobreposicoes: Array<{ cidade: string; bairro: string; rotaIds: string[] }>
  }> {
    // Buscar todas as rotas ativas da empresa
    const rotas = await prisma.rota.findMany({
      where: { empresaId, status: true },
      select: { id: true, codigo: true, descricao: true },
    })

    // Calcular cobertura individual de cada rota
    const coberturas: AreaCobertura[] = []
    // Mapa de cidade+bairro → rotaIds para identificar sobreposições
    const sobreposicaoMap = new Map<string, string[]>()

    for (const rota of rotas) {
      const cobertura = await this.areaCoberturaRota(rota.id, empresaId)
      coberturas.push(cobertura)

      // Registrar cidade/bairro → rotaId
      for (const cidade of cobertura.cidades) {
        for (const bairro of cidade.bairros) {
          const chave = `${cidade.nome}||${bairro.nome}`
          if (!sobreposicaoMap.has(chave)) {
            sobreposicaoMap.set(chave, [])
          }
          sobreposicaoMap.get(chave)!.push(rota.id)
        }
      }
    }

    // Filtrar apenas sobreposições (mais de uma rota atende o mesmo cidade/bairro)
    const sobreposicoes: Array<{ cidade: string; bairro: string; rotaIds: string[] }> = []
    for (const [chave, rotaIds] of sobreposicaoMap) {
      if (rotaIds.length > 1) {
        const [cidade, bairro] = chave.split('||')
        sobreposicoes.push({ cidade, bairro, rotaIds })
      }
    }

    return { rotas: coberturas, sobreposicoes }
  }

  /**
   * Sugere rotas para um cliente por proximidade geográfica.
   * Calcula a distância média (Haversine) entre o cliente-alvo e os clientes geocodificados de cada rota ativa.
   * Retorna até 5 sugestões ordenadas por menor distância média.
   */
  async sugerirRotas(clienteId: string, empresaId: string): Promise<SugestaoRota[]> {
    // Buscar o cliente e verificar se possui coordenadas
    const cliente = await prisma.cliente.findFirst({
      where: { id: clienteId, empresaId },
      select: {
        id: true,
        latitude: true,
        longitude: true,
      },
    })

    if (!cliente) {
      const error = new Error('Cliente não encontrado')
      ;(error as any).statusCode = 404
      throw error
    }

    if (cliente.latitude === null || cliente.longitude === null) {
      const error = new Error('O cliente precisa ter geolocalização para receber sugestões de rota')
      ;(error as any).statusCode = 422
      throw error
    }

    const clienteCoord = {
      latitude: Number(cliente.latitude),
      longitude: Number(cliente.longitude),
    }

    // Buscar todas as rotas ativas da empresa
    const rotas = await prisma.rota.findMany({
      where: { empresaId, status: true },
      select: {
        id: true,
        codigo: true,
        descricao: true,
      },
    })

    if (rotas.length === 0) {
      return []
    }

    // Buscar todos os clientes ativos e geocodificados que possuem rotaId
    const clientesGeocodificados = await prisma.cliente.findMany({
      where: {
        empresaId,
        status: true,
        latitude: { not: null },
        longitude: { not: null },
        rotaId: { not: null },
      },
      select: {
        id: true,
        rotaId: true,
        latitude: true,
        longitude: true,
      },
    })

    // Agrupar clientes por rotaId
    const clientesPorRota = new Map<string, Array<{ latitude: number; longitude: number }>>()
    for (const c of clientesGeocodificados) {
      if (!c.rotaId) continue
      const coords = clientesPorRota.get(c.rotaId) || []
      coords.push({
        latitude: Number(c.latitude),
        longitude: Number(c.longitude),
      })
      clientesPorRota.set(c.rotaId, coords)
    }

    // Para cada rota com clientes geocodificados, calcular distância média
    const sugestoes: SugestaoRota[] = []

    for (const rota of rotas) {
      const clientesDaRota = clientesPorRota.get(rota.id)
      if (!clientesDaRota || clientesDaRota.length === 0) continue

      const somaDistancias = clientesDaRota.reduce((soma, coord) => {
        return soma + calcularDistanciaHaversine(clienteCoord, coord)
      }, 0)

      const distanciaMedia = somaDistancias / clientesDaRota.length

      sugestoes.push({
        rotaId: rota.id,
        codigo: rota.codigo,
        descricao: rota.descricao,
        distanciaMediaKm: Math.round(distanciaMedia * 100) / 100,
        quantidadeClientes: clientesDaRota.length,
      })
    }

    // Ordenar por menor distância média e limitar a 5
    sugestoes.sort((a, b) => a.distanciaMediaKm - b.distanciaMediaKm)

    return sugestoes.slice(0, 5)
  }
}
