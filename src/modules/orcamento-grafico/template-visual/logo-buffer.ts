/**
 * Converte o logo da empresa (base64 / dataURL / URL http) em Buffer para o
 * pdfkit. Best-effort: retorna null em qualquer erro (o elemento LOGO é omitido
 * sem quebrar o PDF). Spec comercial-editor-visual-templates.
 */
export async function resolverLogoBuffer(logoUrl?: string | null): Promise<Buffer | null> {
  if (!logoUrl || typeof logoUrl !== 'string') return null
  const v = logoUrl.trim()
  try {
    if (v.startsWith('data:')) {
      return Buffer.from(v.substring(v.indexOf(',') + 1), 'base64')
    }
    if (v.startsWith('http://') || v.startsWith('https://')) {
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), 8000)
      const resp = await fetch(v, { signal: controller.signal })
      clearTimeout(t)
      if (!resp.ok) return null
      return Buffer.from(await resp.arrayBuffer())
    }
    if (v.length > 100 && /^[A-Za-z0-9+/=\s]+$/.test(v)) {
      return Buffer.from(v, 'base64')
    }
    return null
  } catch {
    return null
  }
}
