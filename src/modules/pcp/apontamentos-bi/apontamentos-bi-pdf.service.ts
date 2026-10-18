/**
 * Geração de PDFs do módulo Apontamentos (spec pcp-apontamentos-dashboards-
 * relatorios), via pdfkit. Consome a MESMA agregação do dashboard/histórico
 * (fonte única — Property 3), de modo que a impressão nunca diverge da tela.
 *
 *  - gerarRelatorioDiarioPdf: Relatório de Produção Diária (seção por dia;
 *    máquina / operador / produção / observação), Req 6.
 *  - gerarDashboardPdf: totais por centro no período, Req 7.
 */
import PDFDocument from 'pdfkit'
import { prisma } from '../../../lib/prisma'
import {
  agregarDashboard,
  listarHistorico,
  resolverPeriodo,
  type FiltroApontamentos,
} from './apontamentos-bi.service'

const COR_PRIMARIA = '#1f3d5a'

function fmtNum(v: unknown): string {
  return Number(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}
function fmtRs(v: unknown): string {
  return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function fmtData(s: string): string {
  const [a, m, d] = s.split('-')
  return `${d}/${m}/${a}`
}

async function nomeEmpresa(empresaId: string): Promise<string> {
  const e = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { nomeFantasia: true, razaoSocial: true } })
  return e?.nomeFantasia || e?.razaoSocial || 'Empresa'
}

function novoDoc(): { doc: PDFKit.PDFDocument; pronto: Promise<Buffer> } {
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true })
  const chunks: Buffer[] = []
  const pronto = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
  return { doc, pronto }
}

function cabecalho(doc: PDFKit.PDFDocument, titulo: string, empresa: string, periodo: string): number {
  const left = 40
  const w = doc.page.width - 80
  doc.rect(left, 40, w, 54).fill(COR_PRIMARIA)
  doc.fillColor('#fff').fontSize(16).font('Helvetica-Bold').text(empresa, left + 12, 50)
  doc.fontSize(11).font('Helvetica').text(titulo, left + 12, 70)
  doc.fillColor('#000').fontSize(9).font('Helvetica').text(`Período: ${periodo}`, left, 100)
  return 118
}

/**
 * Relatório de Produção Diária (Req 6): agrupa o histórico por data civil e,
 * dentro de cada dia, lista máquina / operador / produção / observação.
 */
export async function gerarRelatorioDiarioPdf(
  empresaId: string,
  filtro: FiltroApontamentos,
): Promise<Buffer> {
  const { inicio, fim } = resolverPeriodo(filtro)
  const empresa = await nomeEmpresa(empresaId)
  // Busca o histórico completo do período (paginação grande — relatório).
  const { itens } = await listarHistorico(empresaId, filtro, 1, 100000)

  // Agrupa por data (dd/mm/aaaa a partir do dataHora, fuso local BRT).
  const porDia = new Map<string, typeof itens>()
  for (const it of itens) {
    const d = new Date(it.dataHora.getTime() - 3 * 60 * 60 * 1000)
    const chave = `${String(d.getUTCFullYear())}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    const arr = porDia.get(chave) ?? []
    arr.push(it)
    porDia.set(chave, arr)
  }

  const { doc, pronto } = novoDoc()
  const periodoTxt = `${inicio.toLocaleDateString('pt-BR')} a ${fim.toLocaleDateString('pt-BR')}`
  let y = cabecalho(doc, 'RELATÓRIO DE PRODUÇÃO DIÁRIA', empresa, periodoTxt)
  const left = 40
  const w = doc.page.width - 80

  const dias = [...porDia.keys()].sort()
  if (dias.length === 0) {
    doc.fontSize(11).font('Helvetica').text('Nenhum apontamento no período.', left, y + 10)
  }

  for (const dia of dias) {
    if (y > doc.page.height - 120) { doc.addPage(); y = 50 }
    doc.rect(left, y, w, 20).fill('#e8edf2')
    doc.fillColor('#000').fontSize(11).font('Helvetica-Bold').text(fmtData(dia), left + 6, y + 5)
    y += 24
    // Cabeçalho da tabela
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#333')
    doc.text('MÁQUINA', left + 4, y)
    doc.text('OPERADOR', left + 150, y)
    doc.text('PRODUÇÃO', left + 280, y)
    doc.text('OBSERVAÇÕES', left + 360, y)
    y += 14
    doc.font('Helvetica').fillColor('#000').fontSize(8)
    for (const it of porDia.get(dia)!) {
      if (y > doc.page.height - 60) { doc.addPage(); y = 50 }
      const obs = it.observacao || (it.motivo ? it.motivo : '')
      doc.text(it.centroDescricao ?? '—', left + 4, y, { width: 142 })
      doc.text(it.operadorId ?? '—', left + 150, y, { width: 125 })
      doc.text(fmtNum(it.quantidade), left + 280, y, { width: 75 })
      doc.text(obs, left + 360, y, { width: w - 360 })
      y += 14
    }
    y += 8
  }

  doc.end()
  return pronto
}

/**
 * PDF de dashboard (Req 7): tabela de totais por centro no período
 * (produzido, perda, retrabalho, parada, R$, meta, % atingido).
 */
export async function gerarDashboardPdf(
  empresaId: string,
  filtro: FiltroApontamentos,
): Promise<Buffer> {
  const { inicio, fim } = resolverPeriodo(filtro)
  const empresa = await nomeEmpresa(empresaId)
  const dados = await agregarDashboard(empresaId, filtro)

  const { doc, pronto } = novoDoc()
  const periodoTxt = `${inicio.toLocaleDateString('pt-BR')} a ${fim.toLocaleDateString('pt-BR')}`
  let y = cabecalho(doc, 'APONTAMENTOS — TOTAIS POR CENTRO', empresa, periodoTxt)
  const left = 40
  const w = doc.page.width - 80

  doc.fontSize(8).font('Helvetica-Bold').fillColor('#333')
  doc.text('CENTRO', left + 4, y)
  doc.text('PRODUZIDO', left + 160, y)
  doc.text('PERDA', left + 240, y)
  doc.text('PARADA(min)', left + 300, y)
  doc.text('VALOR R$', left + 380, y)
  doc.text('META%', left + 470, y)
  y += 14
  doc.font('Helvetica').fillColor('#000').fontSize(8)

  for (const c of dados) {
    if (y > doc.page.height - 60) { doc.addPage(); y = 50 }
    doc.text(c.centroDescricao, left + 4, y, { width: 150 })
    doc.text(fmtNum(c.produzido), left + 160, y, { width: 75 })
    doc.text(fmtNum(c.perda), left + 240, y, { width: 55 })
    doc.text(fmtNum(c.paradaMinutos), left + 300, y, { width: 75 })
    doc.text(fmtRs(c.valorRs), left + 380, y, { width: 85 })
    doc.text(c.percentualAtingido != null ? `${fmtNum(c.percentualAtingido)}%` : '—', left + 470, y, { width: 60 })
    y += 14
  }

  doc.end()
  return pronto
}
