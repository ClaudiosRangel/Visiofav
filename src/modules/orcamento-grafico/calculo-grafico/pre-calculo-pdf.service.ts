// PDF do Pré-Cálculo (memória de cálculo) de um Cálculo Gráfico.
//
// Spec: orcamento-grafico-paridade-fluxo-legado (Req 15.2–15.7). Montado da
// FOTO (`resultadoCalculo`) e da Decomposição STC (`custosCalcgraf`, mesma fonte
// de `GET /:id/memoria-stc`). Sem marca do sistema legado em texto, cabeçalho,
// rodapé, nomes de seção ou propriedades do arquivo.

import PDFDocument from 'pdfkit'
import type { FotoRicaCalculo } from './foto-rica.types'
import { montarMemoriaStc, type MemoriaStc } from './decomposicao-stc.service'

export const NOME_SISTEMA_PDF = 'Vizor ERP'
export const MSG_SEM_MEMORIA = 'Cálculo sem memória de cálculo disponível'

export interface PreCalculoEntrada {
  numero: number
  resultadoCalculo: unknown
  custosCalcgraf: unknown
  cliente?: string | null
  produto?: string | null
  descricao?: string | null
  quantidade?: number | null
  empresaNome?: string | null
}

/** Formato pt-BR com 2 casas (igual ao da tela). */
export function fmt2(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '-'
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function foto(raw: unknown): FotoRicaCalculo | null {
  const f = raw as Partial<FotoRicaCalculo> | null
  if (!f || typeof f !== 'object') return null
  if (!f.custos && !Array.isArray(f.margens)) return null
  return f as FotoRicaCalculo
}

/** Há conteúdo para montar o pré-cálculo (Foto com custos/margens ou STC)? */
export function temMemoriaParaPdf(e: Pick<PreCalculoEntrada, 'resultadoCalculo' | 'custosCalcgraf'>): boolean {
  return foto(e.resultadoCalculo) !== null || montarMemoriaStc(e.custosCalcgraf).temMemoria
}

export async function gerarPdfPreCalculo(e: PreCalculoEntrada): Promise<Buffer> {
  const f = foto(e.resultadoCalculo)
  const stc: MemoriaStc = montarMemoriaStc(e.custosCalcgraf)

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const pdf = new PDFDocument({
        size: 'A4',
        margin: 40,
        info: {
          Title: `Pré-Cálculo nº ${e.numero}`,
          Author: NOME_SISTEMA_PDF,
          Subject: `Memória de cálculo nº ${e.numero}`,
          Creator: NOME_SISTEMA_PDF,
          Producer: NOME_SISTEMA_PDF,
        },
      })
      const chunks: Buffer[] = []
      pdf.on('data', (c: Buffer) => chunks.push(c))
      pdf.on('end', () => resolve(Buffer.concat(chunks)))
      pdf.on('error', reject)

      const left = 40
      const right = 555
      const xValor = right - 110

      const secao = (titulo: string) => {
        if (pdf.y > 740) pdf.addPage()
        pdf.moveDown(0.8)
        pdf.font('Helvetica-Bold').fontSize(11).text(titulo, left)
        const y = pdf.y + 2
        pdf.moveTo(left, y).lineTo(right, y).stroke()
        pdf.moveDown(0.4)
      }
      const linha = (rotulo: string, valor: string, negrito = false) => {
        if (pdf.y > 780) pdf.addPage()
        const y = pdf.y
        pdf.font(negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(9)
        pdf.text(rotulo, left, y, { width: xValor - left - 10 })
        const yFim = pdf.y
        pdf.text(valor, xValor, y, { width: right - xValor, align: 'right' })
        pdf.y = Math.max(yFim, pdf.y)
      }

      // Cabeçalho
      pdf.font('Helvetica-Bold').fontSize(15).text(`Pré-Cálculo nº ${e.numero}`, left, 40)
      pdf.font('Helvetica').fontSize(9)
      if (e.empresaNome) pdf.text(e.empresaNome)
      const cab: string[] = []
      const cliente = e.cliente ?? f?.cabecalho?.cliente
      const produto = e.produto ?? f?.cabecalho?.produto
      const descricao = e.descricao ?? f?.cabecalho?.descricao
      const tiragem = e.quantidade ?? f?.cabecalho?.tiragem
      if (cliente) cab.push(`Cliente: ${cliente}`)
      if (produto) cab.push(`Produto: ${produto}`)
      if (descricao) cab.push(`Descrição: ${descricao}`)
      if (tiragem) cab.push(`Tiragem: ${Number(tiragem).toLocaleString('pt-BR')}`)
      cab.forEach((t) => pdf.text(t))

      // Material Direto
      secao('Material Direto')
      const mdItens = stc.componentes.filter((c) => c.grupo === 'MD')
      mdItens.forEach((c) => linha(c.descricao, fmt2(c.valorTotal)))
      const md = stc.temMemoria ? stc.materialDireto : f?.custos?.materialDireto
      linha('Total Material Direto', fmt2(md), true)

      // Custo de Transformação
      secao('Custo de Transformação')
      const ctItens = stc.componentes.filter((c) => c.grupo !== 'MD')
      ctItens.forEach((c) => linha(c.descricao, fmt2(c.valorTotal)))
      const ct = stc.temMemoria ? stc.custoTransformacao + stc.servicoExterno : (f?.custos?.custoTransformacao ?? 0) + (f?.custos?.servicoExterno ?? 0)
      linha('Total Custo de Transformação', fmt2(ct), true)

      // Custo de Produção e Margens
      secao('Custo de Produção e Margens')
      const cp = f?.custos?.custoProducao ?? (stc.temMemoria ? stc.custoProducao : null)
      linha('Custo de Produção', fmt2(cp), true)
      const cev = f?.cev?.totalPercent
      if (cev !== null && cev !== undefined) linha('Custos de venda (%)', fmt2(cev))
      const margens = f?.margens ?? []
      if (margens.length) {
        pdf.moveDown(0.3)
        margens.forEach((m) => {
          const marca = m.selecionada ? ' (selecionada)' : ''
          linha(
            `Margem ${fmt2(m.margemPercent)}%${marca} — unitário ${fmt2(m.valorUnitario)}`,
            fmt2(m.valorTotal),
            !!m.selecionada,
          )
        })
      }

      pdf.end()
    } catch (err) {
      reject(err)
    }
  })
}
