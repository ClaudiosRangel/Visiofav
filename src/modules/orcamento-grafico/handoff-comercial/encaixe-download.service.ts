/**
 * Download do encaixe/imposição como documentação (R11). Lê o `encaixe.layout`
 * do `resultadoCalculo` de um item (ou do cabeçalho single-item) do orçamento e
 * gera SVG (puro) ou PDF (pdfkit, desenho direto dos retângulos). Isolamento por
 * `empresaId` explícito. Sem layout → `ENCAIXE_NAO_GERADO`.
 */
import PDFDocument from 'pdfkit'
import { prisma } from '../../../lib/prisma'
import { encaixeParaSvg, type EncaixeLayout, type EncaixeLegenda } from './encaixe-svg.puro'

export class EncaixeError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) {
    super(message)
    this.name = 'EncaixeError'
  }
}

interface EncaixeResolvido {
  layout: EncaixeLayout
  legenda: EncaixeLegenda
}

function extrairLayout(resultado: unknown): { layout: EncaixeLayout; aproveitamento?: number; folhas?: number } | null {
  const r = resultado as { encaixe?: { layout?: EncaixeLayout; aproveitamento?: number; folhasNecessarias?: number } } | null
  const layout = r?.encaixe?.layout
  if (!layout) return null
  return { layout, aproveitamento: r?.encaixe?.aproveitamento, folhas: r?.encaixe?.folhasNecessarias }
}

/**
 * Resolve o encaixe de um item do orçamento. Se `itemId` for omitido, usa o
 * cabeçalho do orçamento (single-item legado). 403/404 cross-tenant.
 */
export async function resolverEncaixe(
  empresaId: string,
  orcamentoId: string,
  itemId?: string | null,
): Promise<EncaixeResolvido> {
  const orc = await prisma.orcamentoGrafico.findFirst({
    where: { id: orcamentoId, empresaId },
    select: { id: true, numero: true, resultadoCalculo: true, papelDescricao: true },
  })
  if (!orc) throw new EncaixeError(404, 'Orçamento não encontrado')

  let resultado: unknown = orc.resultadoCalculo
  let descricao: string | null = orc.papelDescricao ?? null

  if (itemId) {
    const item = await prisma.itemOrcamentoGrafico.findFirst({
      where: { id: itemId, orcamentoId, empresaId },
      select: { resultadoCalculo: true, descricao: true },
    })
    if (!item) throw new EncaixeError(404, 'Item não encontrado')
    resultado = item.resultadoCalculo
    descricao = item.descricao ?? descricao
  }

  const ext = extrairLayout(resultado)
  if (!ext) throw new EncaixeError(404, 'Encaixe ainda não foi gerado para este item', 'ENCAIXE_NAO_GERADO')

  return {
    layout: ext.layout,
    legenda: {
      orcamentoNumero: orc.numero,
      itemDescricao: descricao,
      aproveitamento: ext.aproveitamento,
      folhasNecessarias: ext.folhas,
    },
  }
}

/** Gera o SVG do encaixe (string). */
export async function gerarEncaixeSvg(empresaId: string, orcamentoId: string, itemId?: string | null): Promise<string> {
  const { layout, legenda } = await resolverEncaixe(empresaId, orcamentoId, itemId)
  const svg = encaixeParaSvg(layout, legenda)
  if (!svg) throw new EncaixeError(404, 'Encaixe inválido', 'ENCAIXE_NAO_GERADO')
  return svg
}

/** Gera o PDF do encaixe (Buffer) desenhando os retângulos com pdfkit. */
export async function gerarEncaixePdf(empresaId: string, orcamentoId: string, itemId?: string | null): Promise<Buffer> {
  const { layout, legenda } = await resolverEncaixe(empresaId, orcamentoId, itemId)

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 36 })
      const chunks: Buffer[] = []
      doc.on('data', (c: Buffer) => chunks.push(c))
      doc.on('end', () => resolve(Buffer.concat(chunks)))

      const pageW = doc.page.width - 72 // margens
      const escala = pageW / layout.folhaLarguraMm
      const folhaW = layout.folhaLarguraMm * escala
      const folhaH = layout.folhaAlturaMm * escala
      const x0 = 36
      const y0 = 80

      doc.fontSize(14).fillColor('#212529').text(
        `Encaixe / Imposição — Orçamento ${legenda.orcamentoNumero ?? ''}`.trim(), 36, 40,
      )
      doc.fontSize(9).fillColor('#495057').text(
        [
          legenda.itemDescricao || '',
          `Folha ${layout.folhaLarguraMm}×${layout.folhaAlturaMm} mm`,
          `Peça ${layout.pecaLarguraMm}×${layout.pecaAlturaMm} mm`,
          `Aproveitamento ${legenda.aproveitamento ?? layout.colunas * layout.linhas} pç/folha`,
          legenda.folhasNecessarias != null ? `${legenda.folhasNecessarias} folhas` : '',
        ].filter(Boolean).join('   ·   '),
        36, 60,
      )

      // Folha
      doc.rect(x0, y0, folhaW, folhaH).fillAndStroke('#f6f8fa', '#868e96')

      // Peças (grade colunas × linhas)
      const pw = layout.pecaLarguraMm * escala
      const ph = layout.pecaAlturaMm * escala
      for (let c = 0; c < layout.colunas; c++) {
        for (let l = 0; l < layout.linhas; l++) {
          const x = x0 + c * pw
          const y = y0 + l * ph
          if (x + pw > x0 + folhaW + 0.5 || y + ph > y0 + folhaH + 0.5) continue
          doc.rect(x, y, pw, ph).fillAndStroke('#cfe3ff', '#1f6feb')
        }
      }

      doc.end()
    } catch (e) {
      reject(e)
    }
  })
}
