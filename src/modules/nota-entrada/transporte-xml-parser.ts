/**
 * Parser do bloco <transp> do XML de NF-e.
 * Extrai placa, UF do veículo, RNTC e nome do motorista/transportadora
 * de forma tolerante: qualquer tag ausente resulta em `null`, nunca lança exceção.
 */

export interface DadosTransporteXml {
  placa: string | null
  ufVeiculo: string | null
  rntc: string | null
  motorista: string | null
}

function getTag(tag: string, source: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i')
  const match = source.match(regex)
  return match ? match[1].trim() : ''
}

function getBlock(tag: string, source: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  const match = source.match(regex)
  return match ? match[1] : ''
}

/** Retorna o valor truncado no tamanho máximo informado, ou `null` se vazio/ausente. */
function truncarOuNulo(valor: string, tamanhoMaximo: number): string | null {
  const limpo = valor.trim()
  if (limpo === '') return null
  return limpo.slice(0, tamanhoMaximo)
}

const VAZIO: DadosTransporteXml = {
  placa: null,
  ufVeiculo: null,
  rntc: null,
  motorista: null,
}

/**
 * Extrai placa (até 8 chars), UF do veículo (2 chars) e RNTC (até 20 chars)
 * de `<transp><veicTransp>`, e o nome do motorista/transportadora (até 100 chars)
 * de `<transp><transporta><xNome>`.
 *
 * Nunca lança exceção: qualquer erro de parsing ou tag ausente resulta em `null`
 * para o(s) campo(s) afetado(s).
 */
export function extrairBlocoTransporte(xml: string): DadosTransporteXml {
  try {
    if (!xml || typeof xml !== 'string') return { ...VAZIO }

    const transp = getBlock('transp', xml)
    if (!transp) return { ...VAZIO }

    const veicTransp = getBlock('veicTransp', transp)
    const transporta = getBlock('transporta', transp)

    const placa = truncarOuNulo(getTag('placa', veicTransp), 8)
    const ufVeiculo = truncarOuNulo(getTag('UF', veicTransp), 2)
    const rntc = truncarOuNulo(getTag('RNTC', veicTransp), 20)
    const motorista = truncarOuNulo(getTag('xNome', transporta), 100)

    return { placa, ufVeiculo, rntc, motorista }
  } catch {
    return { ...VAZIO }
  }
}
