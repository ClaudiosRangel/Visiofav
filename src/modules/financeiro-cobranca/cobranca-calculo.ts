/**
 * Financeiro Onda 2 — núcleo puro de cálculo (FEBRABAN + PIX EMV).
 * Determinístico, sem I/O. Base dos property tests.
 */

/** Módulo 10 (boleto — campos da linha digitável). Retorna o DV (0–9). */
export function modulo10(campo: string): number {
  let soma = 0
  let peso = 2
  for (let i = campo.length - 1; i >= 0; i--) {
    let parcial = Number(campo[i]) * peso
    if (parcial > 9) parcial = Math.floor(parcial / 10) + (parcial % 10)
    soma += parcial
    peso = peso === 2 ? 1 : 2
  }
  const resto = soma % 10
  return resto === 0 ? 0 : 10 - resto
}

/** Módulo 11 (boleto — DV geral do código de barras). Retorna 1–9 (1 se inválido). */
export function modulo11(campo: string, base = 9): number {
  let soma = 0
  let peso = 2
  for (let i = campo.length - 1; i >= 0; i--) {
    soma += Number(campo[i]) * peso
    peso++
    if (peso > base) peso = 2
  }
  const resto = soma % 11
  const dv = 11 - resto
  if (dv === 0 || dv === 10 || dv === 11) return 1
  return dv
}

/**
 * Fator de vencimento FEBRABAN (4 dígitos). Base 07/10/1997.
 * A FEBRABAN reciclou o fator ao atingir 9999 (em 21/02/2025): a partir de
 * 22/02/2025 o fator reinicia em 1000. Este cálculo aplica o módulo 9000 com
 * offset 1000 para manter sempre 4 dígitos (1000–9999), conforme a nota
 * técnica de recomposição do fator de vencimento.
 */
export function fatorVencimento(vencimento: Date): string {
  const base = new Date(Date.UTC(1997, 9, 7)) // 07/10/1997
  const dias = Math.floor((vencimento.getTime() - base.getTime()) / 86400000)
  if (dias <= 9999) return String(dias).padStart(4, '0')
  // Recomposição: após 9999, cicla no intervalo 1000–9999 (9000 valores)
  const reciclado = 1000 + ((dias - 10000) % 9000)
  return String(reciclado).padStart(4, '0')
}

/** Valor formatado com 10 posições, sem ponto/vírgula, centavos no fim. */
function valorFormatado(valor: number): string {
  return Math.round(valor * 100).toString().padStart(10, '0')
}

export interface DadosBoleto {
  codigoBanco: string    // 3 dígitos (ex: "341" Itaú)
  moeda: number          // 9 = real
  vencimento: Date
  valor: number
  campoLivre: string     // 25 posições (específico de cada banco/carteira)
}

/**
 * Código de barras FEBRABAN: 44 posições.
 * Posições: banco(3) + moeda(1) + DV(1) + fatorVenc(4) + valor(10) + campoLivre(25)
 */
export function montarCodigoBarras(d: DadosBoleto): string {
  const banco = d.codigoBanco.padStart(3, '0').substring(0, 3)   // 3
  const moeda = String(d.moeda).substring(0, 1)                  // 1
  const fator = fatorVencimento(d.vencimento)                    // 4
  const val = valorFormatado(d.valor)                            // 10
  const campoLivre = d.campoLivre.padEnd(25, '0').substring(0, 25) // 25
  // 43 posições sem o DV. DV (módulo 11) calculado sobre banco+moeda+fator+valor+campoLivre.
  const semDv = banco + moeda + fator + val + campoLivre         // 43
  const dv = modulo11(semDv)
  // Insere o DV na 5ª posição (após banco+moeda): total 44
  return banco + moeda + String(dv) + fator + val + campoLivre
}

/**
 * Linha digitável (47 posições com DVs de campo — módulo 10).
 * Campo1(10) + Campo2(11) + Campo3(11) + Campo4(1 — DV geral) + Campo5(14 — fator+valor)
 */
export function montarLinhaDigitavel(codigoBarras: string): string {
  // Campo 1: banco(3) + moeda(1) + campoLivre[0..4](5) + DV10
  const c1base = codigoBarras.substring(0, 4) + codigoBarras.substring(19, 24)
  const c1dv = modulo10(c1base)
  const campo1 = c1base + c1dv

  // Campo 2: campoLivre[5..14](10) + DV10
  const c2base = codigoBarras.substring(24, 34)
  const c2dv = modulo10(c2base)
  const campo2 = c2base + c2dv

  // Campo 3: campoLivre[15..24](10) + DV10
  const c3base = codigoBarras.substring(34, 44)
  const c3dv = modulo10(c3base)
  const campo3 = c3base + c3dv

  // Campo 4: DV geral (posição 4 do código de barras)
  const campo4 = codigoBarras[4]

  // Campo 5: fator vencimento(4) + valor(10)
  const campo5 = codigoBarras.substring(5, 19)

  return campo1 + campo2 + campo3 + campo4 + campo5
}

// ── PIX EMV ──

/**
 * CRC16-CCITT (polinômio 0x1021, init 0xFFFF) — padrão PIX BR Code.
 * Recebe o payload SEM o CRC (ou com "6304" no fim, sem os 4 hex).
 */
export function crc16(payload: string): string {
  let crc = 0xFFFF
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xFFFF
      else crc = (crc << 1) & 0xFFFF
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/** Monta um campo TLV (Tag + Length + Value) no formato EMV. */
function tlv(tag: string, value: string): string {
  return tag + String(value.length).padStart(2, '0') + value
}

export interface DadosPix {
  chave: string          // chave PIX do recebedor
  nome: string           // nome do recebedor (máx 25)
  cidade: string         // cidade do recebedor (máx 15)
  valor: number          // valor da cobrança
  txid?: string          // identificador da transação (máx 25)
}

/**
 * Monta BR Code PIX (EMV) com CRC16 no fim. Determinístico.
 */
export function montarBrCodePix(d: DadosPix): string {
  const gui = tlv('00', 'br.gov.bcb.pix')
  const chave = tlv('01', d.chave)
  let merchantAccountInfo = gui + chave
  if (d.txid) merchantAccountInfo += tlv('05', d.txid.substring(0, 25))

  let payload = ''
  payload += tlv('00', '01')                                        // payload format indicator
  payload += tlv('26', merchantAccountInfo)                         // merchant account info
  payload += tlv('52', '0000')                                      // MCC
  payload += tlv('53', '986')                                       // moeda (BRL)
  if (d.valor > 0) payload += tlv('54', d.valor.toFixed(2))         // valor
  payload += tlv('58', 'BR')                                        // país
  payload += tlv('59', d.nome.substring(0, 25))                     // nome
  payload += tlv('60', d.cidade.substring(0, 15))                   // cidade
  payload += tlv('62', tlv('05', d.txid?.substring(0, 25) ?? '***'))// additional data (txid)
  payload += '6304'                                                  // CRC tag+length (sem valor ainda)
  payload += crc16(payload)                                          // CRC value (4 hex)
  return payload
}
