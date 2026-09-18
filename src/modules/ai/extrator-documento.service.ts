/**
 * Vizor AI (D2) — extração de campos de documento financeiro a partir de
 * arquivo (PDF ou imagem). Estratégia:
 *  1) PDF com texto → extrai texto (pdfjs-dist, reuso do parser de OP) e aplica
 *     o núcleo puro `extrairCamposDocumento`.
 *  2) PDF escaneado / imagem → visão multimodal do Claude (se ANTHROPIC_API_KEY);
 *     sem API key, retorna vazio (o caminho determinístico continua válido).
 */
import { extrairTextoPdf } from '../pcp/importacao-op/pdf-extractor.service'
import { extrairCamposDocumento, type CamposDocumento } from './extrair-campos-documento'

const MODELO_VISAO = 'claude-3-5-sonnet-20241022'

/** Extrai campos de um documento financeiro (PDF/imagem). Nunca lança. */
export async function extrairDocumentoFinanceiro(buffer: Buffer, mime: string): Promise<CamposDocumento & { textoOriginal?: string }> {
  const isPdf = mime === 'application/pdf' || mime.endsWith('/pdf')
  const isImagem = mime.startsWith('image/')

  // 1) PDF com texto
  if (isPdf) {
    try {
      const res = await extrairTextoPdf(buffer)
      if (res.temTexto) {
        const campos = extrairCamposDocumento(res.texto)
        return corrigirTipoConcessionaria({ ...campos, textoOriginal: res.texto.substring(0, 4000) })
      }
    } catch {
      // segue para visão
    }
  }

  // 2) Visão multimodal (imagem ou PDF escaneado)
  if (isImagem || isPdf) {
    const porVisao = await extrairPorVisao(buffer, isPdf ? 'application/pdf' : mime).catch(() => null)
    if (porVisao) return corrigirTipoConcessionaria(porVisao)
  }

  return { confianca: 0 }
}

/**
 * Reforço determinístico: se o beneficiário/texto indica uma CONCESSIONÁRIA de
 * serviço público (energia/água/telefone/gás), o documento é uma conta de
 * consumo (DESPESA) — nunca IMPOSTO, mesmo que destaque ICMS. Sobrepõe um
 * eventual palpite errado do modelo de visão. Não lança.
 */
function corrigirTipoConcessionaria<T extends { beneficiario?: string; tipoSugerido?: any; textoOriginal?: string }>(campos: T): T {
  const alvo = `${campos.beneficiario ?? ''} ${campos.textoOriginal ?? ''}`
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const ehConcessionaria =
    /energia|eletric|\blight\b|\benel\b|cemig|copel|celesc|\bcpfl\b|neoenergia|equatorial|energisa/.test(alvo) ||
    /agua|esgoto|saneament|sabesp|cedae|copasa|sanepar|caesb|\bagespisa\b/.test(alvo) ||
    /telefon|internet|banda larga|\bvivo\b|\bclaro\b|\btim\b|\boi\b/.test(alvo) ||
    /\bgas\b|comgas|naturgy|ultragaz/.test(alvo)
  if (ehConcessionaria && campos.tipoSugerido === 'IMPOSTO') {
    return { ...campos, tipoSugerido: 'DESPESA' }
  }
  return campos
}

/**
 * Usa a visão do Claude para extrair campos de um documento (imagem/PDF).
 * Retorna null se a API não estiver configurada ou falhar.
 */
async function extrairPorVisao(buffer: Buffer, mime: string): Promise<(CamposDocumento & { textoOriginal?: string }) | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  // Claude aceita imagens (png/jpg/webp/gif) e PDFs (document) via base64.
  const isPdf = mime === 'application/pdf'
  const mediaType = isPdf ? 'application/pdf' : mime
  const base64 = buffer.toString('base64')

  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const prompt = `Você é um extrator de dados de documentos financeiros brasileiros (boleto, fatura, conta de consumo como luz/água/telefone, DARF/guia, nota).
Extraia e responda APENAS um JSON com as chaves: valor (número, o TOTAL A PAGAR), vencimento (YYYY-MM-DD), linhaDigitavel (string só dígitos da linha/código de barras, ou null), beneficiario (nome de quem RECEBE o pagamento — a empresa/concessionária emissora, ex.: "Light", "Enel", "Sabesp"; NÃO o cliente/consumidor; ou null), documento (CNPJ/CPF do beneficiário só dígitos ou null), numeroDocumento (número da nota fiscal/fatura/documento, ex.: o "NOTA FISCAL Nº" — só dígitos, ou null), tipoSugerido (um de: NF, NFS, BOLETO, DESPESA, IMPOSTO, FINANCIAMENTO, OUTRO).
REGRA IMPORTANTE sobre tipoSugerido: conta de CONCESSIONÁRIA de serviço público — energia elétrica (Light, Enel, Cemig, Copel, CPFL, Neoenergia, Equatorial), água/esgoto (Sabesp, Cedae, Copasa), telefone/internet (Vivo, Claro, Tim, Oi), gás — é SEMPRE tipo "DESPESA" (fatura de consumo), NUNCA "IMPOSTO", mesmo que a conta destaque ICMS ou outros tributos no corpo. Só use "IMPOSTO" para guias tributárias propriamente ditas (DARF, DAS, GPS, GARE, GNRE, boleto de tributo). Se não encontrar um campo, use null. Não escreva mais nada além do JSON.`

  const contentBlock: any = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } }

  try {
    const resp = await anthropic.messages.create({
      model: MODELO_VISAO,
      max_tokens: 500,
      messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: prompt }] }],
    })
    const txt = resp.content.find((c: any) => c.type === 'text') as any
    const jsonStr = (txt?.text ?? '').match(/\{[\s\S]*\}/)?.[0]
    if (!jsonStr) return null
    const parsed = JSON.parse(jsonStr)
    let achados = 0
    const valor = typeof parsed.valor === 'number' ? parsed.valor : undefined
    const vencimento = parsed.vencimento ? new Date(parsed.vencimento) : undefined
    if (valor !== undefined) achados++
    if (vencimento && !isNaN(vencimento.getTime())) achados++
    if (parsed.linhaDigitavel) achados++
    if (parsed.documento) achados++
    return {
      valor,
      vencimento: vencimento && !isNaN(vencimento.getTime()) ? vencimento : undefined,
      linhaDigitavel: parsed.linhaDigitavel ? String(parsed.linhaDigitavel).replace(/\D/g, '') : undefined,
      beneficiario: parsed.beneficiario ?? undefined,
      documento: parsed.documento ? String(parsed.documento).replace(/\D/g, '') : undefined,
      numeroDocumento: parsed.numeroDocumento ? String(parsed.numeroDocumento).replace(/\D/g, '') : undefined,
      tipoSugerido: parsed.tipoSugerido ?? undefined,
      confianca: Math.min(1, achados / 4),
    }
  } catch {
    return null
  }
}
