/**
 * Cliente HTTP para o Serviço_Busca_Catálogo_Externo (Requirement 2 — Código
 * sequencial + enriquecimento SKU via GTIN/EAN), usando a API pública de
 * consulta por GTIN/EAN da Cosmos Bluesoft (gratuita para baixo volume,
 * amplamente utilizada no Brasil para esse fim — ver design.md, "Requirement
 * 2 — Código sequencial + enriquecimento SKU").
 *
 * Endpoint consultado: `GET https://cosmos.bluesoft.com.br/api/gtins/{gtin}`,
 * autenticado via header `X-Cosmos-Token` (variável de ambiente opcional
 * `COSMOS_BLUESOFT_TOKEN` — a ausência do token é apenas mais uma causa
 * possível de falha da consulta, tratada como qualquer outro erro HTTP:
 * resulta em `null`, nunca em exceção).
 *
 * `buscarCatalogoPorGtin` NUNCA lança exceção: qualquer indisponibilidade,
 * erro de rede, timeout, resposta não-2xx, GTIN não encontrado ou erro de
 * parsing do corpo da resposta resulta em `null`, permitindo que o chamador
 * (`produto-import.service.ts`, task 4.7) sempre crie um SKU vazio como
 * fallback sem bloquear a importação (Requirement 2.6).
 */

/**
 * Dados de catálogo de um produto obtidos por GTIN/EAN na fonte externa,
 * usados para enriquecer automaticamente o SKU criado a partir de um novo
 * Produto (Requirement 2.5). `descricao`, `unidade` e `codigoBarra` são
 * sempre preenchidos quando a consulta é bem-sucedida; os campos de
 * dimensões e peso são preenchidos apenas quando fornecidos pela fonte
 * externa para o GTIN consultado.
 */
export interface DadosCatalogo {
  descricao: string
  unidade: string
  codigoBarra: string
  largura?: number
  altura?: number
  comprimento?: number
  pesoLiquido?: number
  pesoBruto?: number
}

/** Timeout padrão da consulta, em milissegundos (Requirement 2.6). */
const TIMEOUT_MS_PADRAO = 5000

const COSMOS_BLUESOFT_URL = 'https://cosmos.bluesoft.com.br/api/gtins'

/** Unidade padrão quando a fonte externa não informa a unidade comercial do GTIN. */
const UNIDADE_PADRAO = 'UN'

/**
 * Formato (parcial, apenas os campos usados) da resposta de
 * `GET /api/gtins/{gtin}` da API Cosmos Bluesoft.
 */
interface RespostaCosmosBluesoft {
  description?: string
  gtin?: string
  width?: number | string | null
  height?: number | string | null
  length?: number | string | null
  net_weight?: number | string | null
  gross_weight?: number | string | null
  gtins?: Array<{
    gtin?: string
    commercial_unit?: {
      type_packaging?: string
    }
  }>
}

function paraNumeroOuUndefined(valor: number | string | null | undefined): number | undefined {
  if (valor === null || valor === undefined) return undefined
  const n = typeof valor === 'number' ? valor : Number(valor)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Converte a resposta da Cosmos Bluesoft em `DadosCatalogo`, retornando
 * `null` quando o corpo não tem a estrutura mínima esperada (sem
 * `description`, por exemplo — o que também cobre o caso de a fonte
 * retornar "GTIN não encontrado" com um corpo vazio/incompleto).
 */
function mapearResposta(gtin: string, body: RespostaCosmosBluesoft): DadosCatalogo | null {
  if (!body || typeof body.description !== 'string' || body.description.trim() === '') {
    return null
  }

  const unidadeComercial = body.gtins?.find((g) => g.gtin === gtin)?.commercial_unit?.type_packaging

  return {
    descricao: body.description.trim(),
    unidade: unidadeComercial?.trim() || UNIDADE_PADRAO,
    codigoBarra: body.gtin?.trim() || gtin,
    largura: paraNumeroOuUndefined(body.width),
    altura: paraNumeroOuUndefined(body.height),
    comprimento: paraNumeroOuUndefined(body.length),
    pesoLiquido: paraNumeroOuUndefined(body.net_weight),
    pesoBruto: paraNumeroOuUndefined(body.gross_weight),
  }
}

/**
 * Consulta dados de catálogo de um produto por GTIN/EAN na Cosmos Bluesoft.
 *
 * Retorna `null` (nunca lança exceção) quando:
 * - a consulta excede `timeoutMs` (padrão 5000ms, via `AbortController`);
 * - ocorre erro de rede/indisponibilidade do serviço externo;
 * - a resposta HTTP não é 2xx (incluindo 401/403 por token ausente/inválido
 *   em `COSMOS_BLUESOFT_TOKEN`, ou 404/GTIN não encontrado, ou 429 por
 *   limite de requisições excedido);
 * - o corpo da resposta não pode ser interpretado como JSON, ou não contém
 *   os campos mínimos esperados (`description`).
 */
export async function buscarCatalogoPorGtin(
  gtin: string,
  timeoutMs: number = TIMEOUT_MS_PADRAO
): Promise<DadosCatalogo | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    const token = process.env.COSMOS_BLUESOFT_TOKEN
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (token) {
      headers['X-Cosmos-Token'] = token
    }

    response = await fetch(`${COSMOS_BLUESOFT_URL}/${encodeURIComponent(gtin)}`, {
      signal: controller.signal,
      headers,
    })
  } catch {
    // Timeout (AbortError), erro de rede ou serviço indisponível.
    return null
  } finally {
    clearTimeout(timeoutId)
  }

  if (!response.ok) {
    return null
  }

  try {
    const body = (await response.json()) as RespostaCosmosBluesoft
    return mapearResposta(gtin, body)
  } catch {
    return null
  }
}
