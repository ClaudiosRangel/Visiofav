import { EmpresaEncontrada } from './prospeccao-provider'

/**
 * Enriquecimento de UM CNPJ conhecido via API pública gratuita.
 *
 * As APIs gratuitas (CNPJá Open, BrasilAPI) consultam um CNPJ por vez — não
 * fazem busca por CNAE+UF. Servem para completar dados de um prospect já
 * encontrado (situação atualizada, telefone, e-mail, CNAE detalhado).
 *
 * Usa fetch nativo (Node 18+). Tenta CNPJá Open primeiro; se falhar, BrasilAPI.
 * Nunca lança — retorna null em erro (enriquecimento é best-effort).
 */

const soDigitos = (v: string) => (v || '').replace(/\D/g, '')

interface RespostaCnpjaOpen {
  taxId?: string
  company?: { name?: string }
  alias?: string
  status?: { text?: string }
  mainActivity?: { id?: number; text?: string }
  address?: {
    street?: string
    number?: string
    details?: string
    district?: string
    city?: string
    state?: string
    zip?: string
  }
  phones?: Array<{ area?: string; number?: string }>
  emails?: Array<{ address?: string }>
}

interface RespostaBrasilApi {
  cnpj?: string
  razao_social?: string
  nome_fantasia?: string
  descricao_situacao_cadastral?: string
  cnae_fiscal?: number
  cnae_fiscal_descricao?: string
  logradouro?: string
  numero?: string
  complemento?: string
  bairro?: string
  municipio?: string
  uf?: string
  cep?: string
  ddd_telefone_1?: string
  email?: string
}

async function fetchJson(url: string, timeoutMs = 12000): Promise<unknown | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const resp = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    clearTimeout(timer)
    if (!resp.ok) return null
    return await resp.json()
  } catch {
    return null
  }
}

export async function enriquecerCnpj(cnpjRaw: string): Promise<EmpresaEncontrada | null> {
  const cnpj = soDigitos(cnpjRaw)
  if (cnpj.length !== 14) return null

  // 1) CNPJá Open (grátis, sem cadastro)
  const cnpja = (await fetchJson(`https://open.cnpja.com/office/${cnpj}`)) as RespostaCnpjaOpen | null
  if (cnpja && cnpja.company?.name) {
    const tel = cnpja.phones?.[0]
    return {
      cnpj,
      razaoSocial: cnpja.company.name,
      nomeFantasia: cnpja.alias || null,
      cnaePrincipal: cnpja.mainActivity?.id ? String(cnpja.mainActivity.id) : null,
      cnaeDescricao: cnpja.mainActivity?.text || null,
      situacao: cnpja.status?.text || null,
      porte: null,
      logradouro: cnpja.address?.street || null,
      numero: cnpja.address?.number || null,
      complemento: cnpja.address?.details || null,
      bairro: cnpja.address?.district || null,
      cidade: cnpja.address?.city || null,
      uf: cnpja.address?.state || null,
      cep: cnpja.address?.zip || null,
      telefone: tel ? `${tel.area || ''}${tel.number || ''}`.trim() || null : null,
      email: cnpja.emails?.[0]?.address || null,
    }
  }

  // 2) Fallback BrasilAPI
  const br = (await fetchJson(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`)) as RespostaBrasilApi | null
  if (br && br.razao_social) {
    return {
      cnpj,
      razaoSocial: br.razao_social,
      nomeFantasia: br.nome_fantasia || null,
      cnaePrincipal: br.cnae_fiscal ? String(br.cnae_fiscal) : null,
      cnaeDescricao: br.cnae_fiscal_descricao || null,
      situacao: br.descricao_situacao_cadastral || null,
      porte: null,
      logradouro: br.logradouro || null,
      numero: br.numero || null,
      complemento: br.complemento || null,
      bairro: br.bairro || null,
      cidade: br.municipio || null,
      uf: br.uf || null,
      cep: br.cep || null,
      telefone: br.ddd_telefone_1 || null,
      email: br.email || null,
    }
  }

  return null
}
