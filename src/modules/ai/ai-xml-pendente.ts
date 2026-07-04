/**
 * Vizor AI — Cache temporário de XML pendente de importação.
 *
 * Quando o usuário envia um XML no chat, o conteúdo é grande demais para
 * trafegar de volta e para para o LLM (function calling não recebe o XML
 * inteiro como argumento). Guardamos o XML em memória, por empresa, para que
 * a tool "importar_xml_compras_real" possa recuperá-lo quando o usuário
 * confirmar a importação em uma mensagem seguinte (ex: "sim, importar").
 *
 * TTL curto (30 min) — é apenas um buffer de conversação, não um storage
 * definitivo. Se o processo reiniciar (deploy no Render), o cache é perdido
 * e o usuário simplesmente precisa reenviar o XML.
 */

interface XmlPendenteEntry {
  xml: string
  criadoEm: number
}

const TTL_MS = 30 * 60 * 1000 // 30 minutos

const cache = new Map<string, XmlPendenteEntry>()

function limparExpirados() {
  const agora = Date.now()
  for (const [key, entry] of cache) {
    if (agora - entry.criadoEm > TTL_MS) {
      cache.delete(key)
    }
  }
}

export function salvarXmlPendente(empresaId: string, xml: string): void {
  limparExpirados()
  cache.set(empresaId, { xml, criadoEm: Date.now() })
}

export function obterXmlPendente(empresaId: string): string | null {
  limparExpirados()
  const entry = cache.get(empresaId)
  return entry ? entry.xml : null
}

export function limparXmlPendente(empresaId: string): void {
  cache.delete(empresaId)
}
