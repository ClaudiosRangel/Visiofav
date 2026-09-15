/**
 * Vizor AI (D2) — extração determinística de campos de documento financeiro a
 * partir de TEXTO (boleto, fatura, DARF/guia). Núcleo puro, sem I/O nem LLM.
 * Prioriza a linha digitável quando presente (via interpretarLinhaDigitavel).
 */
import { interpretarLinhaDigitavel, type TipoDocumento } from '../financeiro/inclusao-titulo.service'
import { normalizarDoc, validarDocumento } from '../financeiro/documento-validacao'

export interface CamposDocumento {
  valor?: number
  vencimento?: Date
  linhaDigitavel?: string
  beneficiario?: string
  documento?: string
  tipoSugerido?: TipoDocumento
  confianca: number
}

/** Extrai a primeira linha digitável de boleto (47 dígitos) do texto. */
function acharLinhaDigitavel(texto: string): string | null {
  // sequências longas de dígitos/pontos/espaços que somam 47 dígitos
  const candidatos = texto.match(/[\d.\s]{47,60}/g) || []
  for (const c of candidatos) {
    const d = c.replace(/\D/g, '')
    if (d.length === 47) return d
  }
  return null
}

/** Extrai o maior valor monetário no formato BRL (R$ 1.234,56 ou 1234,56). */
function acharValor(texto: string): number | null {
  const matches = texto.match(/(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}/g) || []
  let maior: number | null = null
  for (const m of matches) {
    const v = Number(m.replace(/[R$\s.]/g, '').replace(',', '.'))
    if (!isNaN(v) && (maior === null || v > maior)) maior = v
  }
  return maior
}

/** Extrai a primeira data dd/mm/aaaa (ou dd/mm/aa) do texto. */
function acharData(texto: string): Date | null {
  const m = texto.match(/(\d{2})\/(\d{2})\/(\d{2,4})/)
  if (!m) return null
  const dia = Number(m[1]); const mes = Number(m[2]) - 1
  let ano = Number(m[3]); if (ano < 100) ano += 2000
  const d = new Date(Date.UTC(ano, mes, dia))
  return isNaN(d.getTime()) ? null : d
}

/** Extrai o primeiro CNPJ/CPF válido do texto. */
function acharDocumento(texto: string): string | null {
  const candidatos = texto.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g) || []
  for (const c of candidatos) {
    if (validarDocumento(c).valido) return normalizarDoc(c)
  }
  return null
}

/** Sugere o tipo de documento por palavras-chave. */
function sugerirTipo(texto: string): TipoDocumento | undefined {
  const t = texto.toLowerCase()
  if (/\bdarf\b|\bgps\b|\bdas\b|\bgare\b|\bguia\b|imposto|tributo/.test(t)) return 'IMPOSTO'
  if (/nota fiscal de servi|\bnfs-?e\b|\bnfse\b/.test(t)) return 'NFS'
  if (/nota fiscal|\bnf-?e\b|\bdanfe\b/.test(t)) return 'NF'
  if (/boleto|linha digit|ficha de compensa/.test(t)) return 'BOLETO'
  if (/financiamento|presta|parcela/.test(t)) return 'FINANCIAMENTO'
  return undefined
}

export function extrairCamposDocumento(texto: string): CamposDocumento {
  const t = texto ?? ''
  const linhaDigitavel = acharLinhaDigitavel(t) ?? undefined
  const tipoSugerido = sugerirTipo(t)
  const documento = acharDocumento(t) ?? undefined

  let valor: number | undefined
  let vencimento: Date | undefined

  // Prioriza a linha digitável (valor/vencimento do boleto)
  if (linhaDigitavel) {
    const interp = interpretarLinhaDigitavel(linhaDigitavel)
    if (interp) {
      if (interp.valor > 0) valor = interp.valor
      vencimento = interp.vencimento
    }
  }
  // Fallback para valor/data do texto
  if (valor === undefined) valor = acharValor(t) ?? undefined
  if (vencimento === undefined) vencimento = acharData(t) ?? undefined

  // Confiança: quantos campos-chave foram encontrados
  let achados = 0
  if (valor !== undefined) achados++
  if (vencimento !== undefined) achados++
  if (linhaDigitavel) achados++
  if (documento) achados++
  const confianca = Math.min(1, achados / 4)

  return { valor, vencimento, linhaDigitavel, documento, tipoSugerido, confianca }
}
