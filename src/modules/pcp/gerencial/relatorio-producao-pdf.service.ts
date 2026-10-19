/**
 * PDF do Relatório Mensal de Produção (spec pcp-relatorio-gerencial-producao,
 * Task 8). Usa a MESMA agregação da tela (fonte única). pdfkit.
 */
import PDFDocument from 'pdfkit'
import { prisma } from '../../../lib/prisma'
import {
  resumoPorProcesso,
  serieDiariaConsolidada,
  paretoParadas,
} from './relatorio-producao.service'

const COR = '#1f3d5a'
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

function num(v: unknown): string { return Number(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) }
function brl(v: unknown): string { return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }

export async function gerarRelatorioMensalPdf(empresaId: string, ano: number, mes: number): Promise<Buffer> {
  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { nomeFantasia: true, razaoSocial: true } })
  const nomeEmpresa = empresa?.nomeFantasia || empresa?.razaoSocial || 'Empresa'
  const [resumo, diaria, pareto] = await Promise.all([
    resumoPorProcesso(empresaId, ano, mes),
    serieDiariaConsolidada(empresaId, ano, mes),
    paretoParadas(empresaId, ano, mes),
  ])

  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true })
  const chunks: Buffer[] = []
  const pronto = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  const left = 40
  const w = doc.page.width - 80
  // Cabeçalho
  doc.rect(left, 40, w, 54).fill(COR)
  doc.fillColor('#fff').fontSize(16).font('Helvetica-Bold').text(nomeEmpresa, left + 12, 50)
  doc.fontSize(12).font('Helvetica').text(`Relatório Mensal de Produção — ${MESES[mes - 1]}/${ano}`, left + 12, 72)
  let y = 110

  // Resumo por processo
  doc.fillColor('#000').fontSize(13).font('Helvetica-Bold').text('Resumo por Processo', left, y); y += 20
  doc.fontSize(9).font('Helvetica-Bold')
  doc.text('PROCESSO', left + 4, y); doc.text('BASE', left + 180, y); doc.text('PRODUZIDO', left + 260, y); doc.text('VALOR R$', left + 360, y); doc.text('META%', left + 470, y)
  y += 14
  doc.font('Helvetica')
  for (const r of resumo) {
    if (y > doc.page.height - 60) { doc.addPage(); y = 50 }
    doc.text(r.tipoProcessoCodigo ?? '—', left + 4, y, { width: 170 })
    doc.text(r.base === 'UNIDADE' ? 'Peças' : 'Folhas', left + 180, y)
    doc.text(num(r.produzido), left + 260, y)
    doc.text(brl(r.valorRs), left + 360, y)
    doc.text(r.percentualAtingido != null ? `${num(r.percentualAtingido)}%` : '—', left + 470, y)
    y += 14
  }
  y += 10

  // Produção diária consolidada (resumo)
  if (y > doc.page.height - 120) { doc.addPage(); y = 50 }
  doc.fontSize(13).font('Helvetica-Bold').text('Produção Diária Consolidada', left, y); y += 20
  doc.fontSize(10).font('Helvetica')
  doc.text(`Pico do mês: ${diaria.pico ? `${diaria.pico.data} — ${num(diaria.pico.produzido)}` : '—'}`, left + 4, y); y += 14
  doc.text(`2º maior: ${diaria.segundoMaior ? `${diaria.segundoMaior.data} — ${num(diaria.segundoMaior.produzido)}` : '—'}`, left + 4, y); y += 14
  doc.text(`3º maior: ${diaria.terceiroMaior ? `${diaria.terceiroMaior.data} — ${num(diaria.terceiroMaior.produzido)}` : '—'}`, left + 4, y); y += 14
  doc.text(`Média diária: ${num(diaria.mediaDiaria)}`, left + 4, y); y += 14
  doc.text(`Menor dia: ${diaria.menorDia ? `${diaria.menorDia.data} — ${num(diaria.menorDia.produzido)}` : '—'}`, left + 4, y); y += 20

  // Pareto de paradas
  if (y > doc.page.height - 120) { doc.addPage(); y = 50 }
  doc.fontSize(13).font('Helvetica-Bold').text('Pareto de Paradas', left, y); y += 20
  doc.fontSize(9).font('Helvetica-Bold')
  doc.text('CÓDIGO', left + 4, y); doc.text('DESCRIÇÃO', left + 70, y); doc.text('OCORR.', left + 420, y)
  y += 14
  doc.font('Helvetica')
  for (const p of pareto) {
    if (y > doc.page.height - 60) { doc.addPage(); y = 50 }
    doc.text(p.codigo, left + 4, y, { width: 60 })
    doc.text(p.descricao, left + 70, y, { width: 340 })
    doc.text(String(p.ocorrencias), left + 420, y)
    y += 14
  }

  doc.end()
  return pronto
}
