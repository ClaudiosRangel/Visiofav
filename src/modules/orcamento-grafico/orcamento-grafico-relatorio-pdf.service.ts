import PDFDocument from 'pdfkit'
import type { RelatorioOrcamento, RelatorioSecaoLinha } from './orcamento-grafico-relatorio.service'

/**
 * Gera o PDF do RELATÓRIO de orçamento gráfico no layout do pré-cálculo do
 * Calcgraf (ver docs/calcgraf-golden-15235-acabamentos.md). Recebe a estrutura
 * já montada por `montarRelatorio` e devolve um Buffer. Layout em uma coluna,
 * seções na ordem: Cabeçalho → Suporte → Matriz → Tinta → Mat.Acabamento →
 * Impressão → Acabamento → Custo de Produção → CEV → Margens.
 */
export function gerarRelatorioPdf(rel: RelatorioOrcamento): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 36 })
      const chunks: Buffer[] = []
      doc.on('data', (c: Buffer) => chunks.push(c))
      doc.on('end', () => resolve(Buffer.concat(chunks)))

      const money = (v: number | undefined) =>
        v == null ? '' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      const num = (v: number | undefined, dec = 2) =>
        v == null ? '' : v.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec })

      const left = doc.page.margins.left
      const right = doc.page.width - doc.page.margins.right
      const width = right - left

      // ── Cabeçalho ──
      doc.fontSize(13).font('Helvetica-Bold').text(rel.cabecalho.empresa || 'Orçamento Gráfico', left, doc.y)
      doc.fontSize(8).font('Helvetica').fillColor('#555')
      const cab = rel.cabecalho
      doc.text(`Data: ${cab.data}${cab.numero ? `   ·   Orçamento nº ${cab.numero}` : ''}`)
      if (cab.cliente) doc.text(`Cliente: ${cab.cliente}`)
      if (cab.produto) doc.text(`Produto: ${cab.produto}`)
      if (cab.descricao) doc.text(`Descrição: ${cab.descricao}`)
      if (cab.formatoFinal) doc.text(`Formato Final: ${cab.formatoFinal}`)
      doc.text(`Quantidade: ${cab.quantidade.toLocaleString('pt-BR')}`)
      doc.fillColor('#000').moveDown(0.5)

      // Helper de seção com tabela (item | unid | fixo | var | unit | subtotal)
      const colX = [left, left + width * 0.42, left + width * 0.52, left + width * 0.63, left + width * 0.74, left + width * 0.86]
      const drawSecao = (titulo: string, linhas: RelatorioSecaoLinha[]) => {
        if (!linhas || linhas.length === 0) return
        if (doc.y > doc.page.height - 120) doc.addPage()
        doc.moveDown(0.3)
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#1F3D2B').text(titulo, left)
        doc.fillColor('#000').fontSize(7.5).font('Helvetica-Oblique')
        const hy = doc.y + 1
        doc.text('Item', colX[0], hy)
        doc.text('Un', colX[1], hy)
        doc.text('Fixo', colX[2], hy, { width: width * 0.1, align: 'right' })
        doc.text('Variável', colX[3], hy, { width: width * 0.1, align: 'right' })
        doc.text('Unitário', colX[4], hy, { width: width * 0.1, align: 'right' })
        doc.text('Subtotal', colX[5], hy, { width: width * 0.14, align: 'right' })
        doc.moveTo(left, doc.y + 1).lineTo(right, doc.y + 1).strokeColor('#ccc').stroke()
        doc.font('Helvetica').fontSize(8)
        for (const l of linhas) {
          const y = doc.y + 2
          doc.text(l.item, colX[0], y, { width: width * 0.4 })
          const yl = y // mesma linha
          doc.text(l.unidade || '', colX[1], yl)
          doc.text(num(l.fixo), colX[2], yl, { width: width * 0.1, align: 'right' })
          doc.text(num(l.variavel), colX[3], yl, { width: width * 0.1, align: 'right' })
          doc.text(num(l.unitario), colX[4], yl, { width: width * 0.1, align: 'right' })
          doc.text(money(l.subtotal), colX[5], yl, { width: width * 0.14, align: 'right' })
        }
      }

      drawSecao('SUPORTE', rel.suporte)
      drawSecao('MATRIZ IMPRESSÃO', rel.matrizImpressao)
      drawSecao('TINTA', rel.tinta)
      drawSecao('MAT.ACABAMENTO', rel.matAcabamento)
      drawSecao('IMPRESSÃO', rel.impressao)
      drawSecao('ACABAMENTO', rel.acabamento)

      // ── Custo de Produção ──
      if (doc.y > doc.page.height - 160) doc.addPage()
      doc.moveDown(0.5)
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#1F3D2B').text('CUSTO DE PRODUÇÃO', left)
      doc.fillColor('#000').font('Helvetica').fontSize(8.5)
      const cp = rel.custoProducao
      const linhaCP = (rotulo: string, valor: number, bold = false) => {
        const y = doc.y + 2
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica')
        doc.text(rotulo, left, y)
        doc.text(`R$ ${money(valor)}`, left, y, { width, align: 'right' })
      }
      linhaCP('Material Direto (MD)', cp.materialDireto)
      linhaCP('Custo de Transformação (CT)', cp.custoTransformacao)
      if (cp.servicoExterno > 0) linhaCP('Serviço Externo (SE)', cp.servicoExterno)
      linhaCP('Custo de Produção (MD + CT + SE)', cp.custoProducao, true)
      if (cp.encargoFinanceiro) linhaCP('Encargo Financeiro', cp.encargoFinanceiro)
      linhaCP('Total', cp.total, true)

      // ── CEV ──
      doc.moveDown(0.4)
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#1F3D2B').text('CEV (CUSTOS DE VENDA)', left)
      doc.fillColor('#000').font('Helvetica').fontSize(8.5)
      const cev = rel.cev
      const partes: string[] = []
      if (cev.icms != null) partes.push(`ICMS ${num(cev.icms)}%`)
      if (cev.juros != null) partes.push(`Juros ${num(cev.juros)}%`)
      if (cev.pisCofins != null) partes.push(`PIS/COFINS ${num(cev.pisCofins)}%`)
      if (cev.comissoes != null) partes.push(`Comissões ${num(cev.comissoes)}%`)
      doc.text(`${partes.join('  ·  ')}${partes.length ? '  →  ' : ''}Total CEV ${num(cev.totalPerc)}%`, left)

      // ── Margens por tiragem ──
      doc.moveDown(0.5)
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#1F3D2B').text('MARGEM / CONTRIBUIÇÃO MARGINAL', left)
      doc.fillColor('#000').fontSize(7.5).font('Helvetica-Oblique')
      const mcol = [left, left + width * 0.18, left + width * 0.38, left + width * 0.56, left + width * 0.78]
      const my = doc.y + 1
      doc.text('Margem %', mcol[0], my)
      doc.text('Margem $', mcol[1], my, { width: width * 0.18, align: 'right' })
      doc.text('C.Marg. %', mcol[2], my, { width: width * 0.16, align: 'right' })
      doc.text('C.Marg. $', mcol[3], my, { width: width * 0.2, align: 'right' })
      doc.text('Unit. / Total', mcol[4], my, { width: width * 0.22, align: 'right' })
      doc.moveTo(left, doc.y + 1).lineTo(right, doc.y + 1).strokeColor('#ccc').stroke()
      doc.font('Helvetica').fontSize(8)
      for (const m of rel.margens) {
        const y = doc.y + 2
        doc.text(`${num(m.markupPerc)}%`, mcol[0], y)
        doc.text(money(m.margemValor), mcol[1], y, { width: width * 0.18, align: 'right' })
        doc.text(`${num(m.cmPerc)}%`, mcol[2], y, { width: width * 0.16, align: 'right' })
        doc.text(money(m.cmValor), mcol[3], y, { width: width * 0.2, align: 'right' })
        doc.text(`${num(m.precoUnitario, 3)} / ${money(m.precoTotal)}`, mcol[4], y, { width: width * 0.22, align: 'right' })
      }

      doc.end()
    } catch (e) {
      reject(e)
    }
  })
}
