/**
 * Geração da chave de acesso da NF-e (44 dígitos)
 * Formato: cUF(2) + AAMM(4) + CNPJ(14) + mod(2) + serie(3) + nNF(9) + tpEmis(1) + cNF(8) + cDV(1)
 */

const UF_CODES: Record<string, string> = {
  AC: '12', AL: '27', AP: '16', AM: '13', BA: '29', CE: '23', DF: '53',
  ES: '32', GO: '52', MA: '21', MT: '51', MS: '50', MG: '31', PA: '15',
  PB: '25', PR: '41', PE: '26', PI: '22', RJ: '33', RN: '24', RS: '43',
  RO: '11', RR: '14', SC: '42', SP: '35', SE: '28', TO: '17',
}

function pad(value: number | string, length: number): string {
  return String(value).padStart(length, '0')
}

function calcularDV(chave43: string): string {
  const pesos = [2, 3, 4, 5, 6, 7, 8, 9]
  let soma = 0
  let pesoIdx = 0

  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += parseInt(chave43[i]) * pesos[pesoIdx % pesos.length]
    pesoIdx++
  }

  const resto = soma % 11
  const dv = resto < 2 ? 0 : 11 - resto
  return String(dv)
}

function gerarCNF(): string {
  return pad(Math.floor(Math.random() * 99999999), 8)
}

export interface DadosChaveAcesso {
  uf: string          // sigla UF (ex: 'SP')
  dataEmissao: Date
  cnpj: string        // 14 dígitos
  modelo: number      // 55 = NF-e, 65 = NFC-e
  serie: number
  numero: number
  tipoEmissao?: number // 1 = normal
}

export function gerarChaveAcesso(dados: DadosChaveAcesso): string {
  const cUF = UF_CODES[dados.uf] || '35'
  const AAMM = pad(dados.dataEmissao.getFullYear() % 100, 2) + pad(dados.dataEmissao.getMonth() + 1, 2)
  const cnpj = dados.cnpj.replace(/\D/g, '').padStart(14, '0')
  const mod = pad(dados.modelo, 2)
  const serie = pad(dados.serie, 3)
  const nNF = pad(dados.numero, 9)
  const tpEmis = String(dados.tipoEmissao ?? 1)
  const cNF = gerarCNF()

  const chave43 = `${cUF}${AAMM}${cnpj}${mod}${serie}${nNF}${tpEmis}${cNF}`
  const cDV = calcularDV(chave43)

  return `${chave43}${cDV}`
}
