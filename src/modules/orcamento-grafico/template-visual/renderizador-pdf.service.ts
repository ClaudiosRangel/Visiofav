/**
 * Renderizador_PDF — interpreta um LayoutDocumento por COORDENADAS (pt) via
 * pdfkit, produzindo o Buffer do PDF. Spec comercial-editor-visual-templates.
 *
 * Os elementos são desenhados NA ORDEM do array `elementos` (Req 1.6). Cada
 * tipo despacha para a operação pdfkit correspondente NAS coordenadas do
 * elemento (Req 2.3–2.9). LOGO ausente/inválido = best-effort (omite, não quebra).
 */
import PDFDocument from 'pdfkit'
import type { Elemento, EstiloTexto, LayoutDocumento } from './layout-json.types'
import {
  type ContextoGeracao,
  resolverBinding,
  resolverTabela,
} from './binding-resolver.service'

export interface ContextoRender extends ContextoGeracao {
  /** Logo da empresa já resolvido em Buffer (ou null). */
  logoBuffer?: Buffer | null
}

const ESTILO_PADRAO: EstiloTexto = {
  fonte: 'Helvetica',
  tamanhoPt: 10,
  alinhamento: 'left',
  negrito: false,
  cor: '#000000',
}

function aplicarEstilo(doc: PDFKit.PDFDocument, estilo?: EstiloTexto): EstiloTexto {
  const e = estilo ?? ESTILO_PADRAO
  const fonte = e.negrito && e.fonte === 'Helvetica' ? 'Helvetica-Bold' : e.fonte
  doc.font(fonte).fontSize(e.tamanhoPt).fillColor(e.cor || '#000000')
  return e
}

/**
 * Renderiza o layout num PDF. Resolve em um Buffer completo.
 */
export function renderizarLayout(
  layout: LayoutDocumento,
  ctx: ContextoRender,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: [layout.pagina.larguraPt, layout.pagina.alturaPt],
        margin: 0, // posicionamento é 100% absoluto por coordenadas
      })
      const chunks: Buffer[] = []
      doc.on('data', (c: Buffer) => chunks.push(c))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      for (const el of layout.elementos) {
        desenharElemento(doc, el, ctx)
      }

      doc.end()
    } catch (err) {
      reject(err)
    }
  })
}

function desenharElemento(doc: PDFKit.PDFDocument, el: Elemento, ctx: ContextoRender): void {
  switch (el.tipo) {
    case 'LOGO':
      if (ctx.logoBuffer) {
        try {
          doc.image(ctx.logoBuffer, el.xPt, el.yPt, { width: el.larguraPt, height: el.alturaPt })
        } catch {
          /* logo inválido → omite (best-effort) */
        }
      }
      return

    case 'TEXTO': {
      const estilo = aplicarEstilo(doc, el.estilo)
      doc.text(el.textoEstatico ?? '', el.xPt, el.yPt, {
        width: el.larguraPt,
        align: estilo.alinhamento,
      })
      return
    }

    case 'CAMPO_DINAMICO': {
      const estilo = aplicarEstilo(doc, el.estilo)
      const r = resolverBinding(el.binding ?? '', ctx)
      doc.text(r.texto ?? '', el.xPt, el.yPt, {
        width: el.larguraPt,
        align: estilo.alinhamento,
      })
      return
    }

    case 'BLOCO_CONDICOES': {
      const estilo = aplicarEstilo(doc, el.estilo)
      doc.text(el.textoEstatico ?? '', el.xPt, el.yPt, {
        width: el.larguraPt,
        align: estilo.alinhamento,
      })
      return
    }

    case 'LINHA':
      doc
        .moveTo(el.xPt, el.yPt)
        .lineTo(el.xPt + el.larguraPt, el.yPt)
        .strokeColor(el.estilo?.cor || '#000000')
        .stroke()
      return

    case 'ASSINATURA': {
      // Linha da assinatura + rótulo logo abaixo.
      doc
        .moveTo(el.xPt, el.yPt)
        .lineTo(el.xPt + el.larguraPt, el.yPt)
        .strokeColor('#000000')
        .stroke()
      const estilo = aplicarEstilo(doc, el.estilo)
      doc.text(el.rotuloAssinatura ?? 'Assinatura', el.xPt, el.yPt + 4, {
        width: el.larguraPt,
        align: estilo.alinhamento,
      })
      return
    }

    case 'TABELA':
      desenharTabela(doc, el, ctx)
      return

    default:
      return
  }
}

function desenharTabela(doc: PDFKit.PDFDocument, el: Elemento, ctx: ContextoRender): void {
  const tab = el.tabela
  if (!tab || !Array.isArray(tab.colunas) || tab.colunas.length === 0) return
  const estilo = el.estilo ?? ESTILO_PADRAO
  const alturaLinha = Math.max(14, estilo.tamanhoPt + 4)
  let y = el.yPt

  // Cabeçalho (negrito).
  doc.font('Helvetica-Bold').fontSize(estilo.tamanhoPt).fillColor('#000000')
  let x = el.xPt
  for (const col of tab.colunas) {
    doc.text(col.titulo, x, y, { width: col.larguraPt, align: col.alinhamento })
    x += col.larguraPt
  }
  y += alturaLinha

  // Linhas de dados.
  const bindings = tab.colunas.map((c) => c.binding)
  const linhas = resolverTabela(tab.fonteDados, bindings, ctx)
  doc.font(estilo.fonte).fontSize(estilo.tamanhoPt).fillColor(estilo.cor || '#000000')
  for (const linha of linhas) {
    x = el.xPt
    for (let i = 0; i < tab.colunas.length; i++) {
      const col = tab.colunas[i]
      doc.text(linha[i] ?? '', x, y, { width: col.larguraPt, align: col.alinhamento })
      x += col.larguraPt
    }
    y += alturaLinha
  }
}
