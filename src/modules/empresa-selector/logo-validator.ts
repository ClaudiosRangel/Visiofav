export type MotivoRejeicaoLogo = 'FORMATO_INVALIDO' | 'TAMANHO_EXCEDIDO' | 'BASE64_INVALIDO'

export type ResultadoValidacaoLogo =
  | { valido: true; conteudoNormalizado: string }
  | { valido: false; motivo: MotivoRejeicaoLogo }

/** Limite do conteúdo binário decodificado (Requirement 5.3) */
export const TAMANHO_MAXIMO_LOGO_BYTES = 2_000_000

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff])

/**
 * Remove um prefixo de data-URL (data:image/...;base64,) se presente.
 * Não valida o mimetype declarado — apenas isola a porção base64.
 */
function removerPrefixoDataUrl(valor: string): string {
  const match = valor.match(/^data:[^;]+;base64,(.*)$/s)
  return match ? match[1] : valor
}

/** Detecta o formato pela assinatura binária real, ignorando qualquer metadado declarado. */
function detectarFormato(buffer: Buffer): 'png' | 'jpeg' | null {
  if (buffer.length >= PNG_MAGIC.length && buffer.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    return 'png'
  }
  if (buffer.length >= JPEG_MAGIC.length && buffer.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)) {
    return 'jpeg'
  }
  return null
}

/**
 * Validador_Logo: decodifica, valida tamanho e formato, e normaliza.
 * Função pura — mesma entrada produz sempre a mesma saída.
 *
 * Ordem de checagem (fixa e testada): base64 válido → tamanho → formato.
 * O tamanho é checado antes do formato porque é a checagem mais barata e
 * porque o Requirement 5.3 trata "tamanho excedido" como rejeição
 * independente do conteúdo ser ou não uma imagem reconhecível.
 */
export function validarLogoBase64(valor: string): ResultadoValidacaoLogo {
  const base64Puro = removerPrefixoDataUrl(valor).trim()

  let buffer: Buffer
  try {
    buffer = Buffer.from(base64Puro, 'base64')
    // Buffer.from com 'base64' não lança para lixo — validamos re-codificando
    // e comparando (ignorando padding/whitespace) para detectar entrada inválida.
    const normalizado = base64Puro.replace(/\s/g, '')
    if (normalizado.length === 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalizado)) {
      return { valido: false, motivo: 'BASE64_INVALIDO' }
    }
    if (buffer.toString('base64').replace(/=+$/, '') !== normalizado.replace(/=+$/, '')) {
      return { valido: false, motivo: 'BASE64_INVALIDO' }
    }
  } catch {
    return { valido: false, motivo: 'BASE64_INVALIDO' }
  }

  if (buffer.length === 0) {
    return { valido: false, motivo: 'BASE64_INVALIDO' }
  }

  if (buffer.length > TAMANHO_MAXIMO_LOGO_BYTES) {
    return { valido: false, motivo: 'TAMANHO_EXCEDIDO' }
  }

  const formato = detectarFormato(buffer)
  if (!formato) {
    return { valido: false, motivo: 'FORMATO_INVALIDO' }
  }

  const mimetype = formato === 'png' ? 'image/png' : 'image/jpeg'
  return { valido: true, conteudoNormalizado: `data:${mimetype};base64,${buffer.toString('base64')}` }
}

/** Mensagem 400 amigável em português para cada motivo de rejeição. */
export function mensagemErroLogo(motivo: MotivoRejeicaoLogo): string {
  switch (motivo) {
    case 'FORMATO_INVALIDO':
      return 'O arquivo enviado não é uma imagem PNG ou JPEG válida.'
    case 'TAMANHO_EXCEDIDO':
      return 'A imagem excede o tamanho máximo permitido de 2MB.'
    case 'BASE64_INVALIDO':
      return 'O conteúdo do logo não é uma string base64 válida.'
  }
}

export type DecisaoPersistenciaLogo =
  | { acao: 'manter' }
  | { acao: 'remover' }
  | { acao: 'persistir'; conteudoNormalizado: string }
  | { acao: 'rejeitar'; motivo: MotivoRejeicaoLogo }

/**
 * Função pura de orquestração, reaproveitada pelos 3 handlers de escrita.
 * Decide o que fazer com o campo `logo` a partir do valor recebido no body
 * (que pode estar ausente — `undefined` — ou ser `null` ou uma string).
 */
export function decidirPersistenciaLogo(logoDoBody: string | null | undefined): DecisaoPersistenciaLogo {
  if (logoDoBody === undefined) return { acao: 'manter' }
  if (logoDoBody === null) return { acao: 'remover' }

  const resultado = validarLogoBase64(logoDoBody)
  if (!resultado.valido) return { acao: 'rejeitar', motivo: resultado.motivo }
  return { acao: 'persistir', conteudoNormalizado: resultado.conteudoNormalizado }
}

/** Vínculo usuário-empresa, com os dados da Empresa relevantes para a listagem GET /minhas. */
export interface VinculoComEmpresa {
  empresa: {
    id: string
    razaoSocial: string
    nomeFantasia: string | null
    cnpj: string
    logo: string | null
    status: boolean
  }
}

/** Item retornado por GET /minhas para cada Empresa ativa vinculada ao usuário. */
export interface EmpresaListagemMinhas {
  id: string
  razaoSocial: string
  nomeFantasia: string | null
  cnpj: string
  logo: string | null
}

/**
 * Filtra os vínculos usuário-empresa mantendo apenas os que apontam para uma
 * Empresa com status ativo (status === true), e mapeia cada um para o
 * formato de retorno de GET /minhas. Função pura, sem I/O.
 */
export function filtrarEMapearEmpresasAtivas(vinculos: VinculoComEmpresa[]): EmpresaListagemMinhas[] {
  return vinculos
    .filter((v) => v.empresa.status === true)
    .map((v) => ({
      id: v.empresa.id,
      razaoSocial: v.empresa.razaoSocial,
      nomeFantasia: v.empresa.nomeFantasia,
      cnpj: v.empresa.cnpj,
      logo: v.empresa.logo,
    }))
}
