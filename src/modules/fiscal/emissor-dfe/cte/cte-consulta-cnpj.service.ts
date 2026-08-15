/**
 * Serviço de consulta de CNPJ para preenchimento automático de participantes CT-e
 * Usa BrasilAPI como fonte primária, CNPJa como fallback
 */

export interface DadosCnpj {
  cnpj: string
  razaoSocial: string
  nomeFantasia: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
  cep: string
  telefone: string
  email: string
}

export async function consultarCnpj(cnpj: string): Promise<DadosCnpj | null> {
  const cnpjLimpo = cnpj.replace(/\D/g, '')
  if (cnpjLimpo.length !== 14) return null

  try {
    // BrasilAPI
    const resp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpjLimpo}`)
    if (resp.ok) {
      const raw = await resp.json() as any
      return {
        cnpj: cnpjLimpo,
        razaoSocial: raw.razao_social || '',
        nomeFantasia: raw.nome_fantasia || '',
        logradouro: raw.logradouro || '',
        numero: raw.numero || '',
        complemento: raw.complemento || '',
        bairro: raw.bairro || '',
        cidade: raw.municipio || '',
        uf: raw.uf || '',
        cep: (raw.cep || '').replace(/\D/g, ''),
        telefone: raw.ddd_telefone_1 || '',
        email: raw.email || '',
      }
    }
  } catch { /* fallback */ }

  try {
    // CNPJa fallback
    const resp2 = await fetch(`https://open.cnpja.com/office/${cnpjLimpo}`)
    if (resp2.ok) {
      const raw = await resp2.json() as any
      return {
        cnpj: cnpjLimpo,
        razaoSocial: raw.company?.name || raw.alias || '',
        nomeFantasia: raw.alias || '',
        logradouro: raw.address?.street || '',
        numero: raw.address?.number || '',
        complemento: raw.address?.details || '',
        bairro: raw.address?.district || '',
        cidade: raw.address?.city || '',
        uf: raw.address?.state || '',
        cep: (raw.address?.zip || '').replace(/\D/g, ''),
        telefone: raw.phones?.[0] ? `${raw.phones[0].area}${raw.phones[0].number}` : '',
        email: raw.emails?.[0]?.address || '',
      }
    }
  } catch { /* silencioso */ }

  return null
}
