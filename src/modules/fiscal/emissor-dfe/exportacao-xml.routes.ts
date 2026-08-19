/**
 * Exportação de XMLs/PDFs em lote (ZIP) — Baixar ou Enviar por E-mail
 *
 * Endpoints:
 * - GET  /fiscal/exportar-xml/resumo — Resumo do que será exportado
 * - GET  /fiscal/exportar-xml — Download ZIP (XML e/ou PDF)
 * - POST /fiscal/exportar-xml/enviar-email — Envia ZIP por e-mail
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'

const exportarQuerySchema = z.object({
  tipo: z.enum(['NFE', 'NFCE', 'CTE', 'MDFE', 'NFSE', 'TODOS']).default('TODOS'),
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.string().optional(),
  formato: z.enum(['xml', 'pdf', 'ambos']).default('xml'),
})

export async function exportacaoXmlRoutes(app: FastifyInstance) {

  // GET /fiscal/exportar-xml/resumo
  app.get('/exportar-xml/resumo', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(403).send({ message: 'Sem empresa' })

    const params = exportarQuerySchema.parse(request.query)
    const where: any = {
      empresaId: user.empresaId,
      dataEmissao: { gte: new Date(params.dataInicio), lte: new Date(`${params.dataFim}T23:59:59.999Z`) },
      xmlAutorizado: { not: null },
    }
    if (params.tipo !== 'TODOS') where.tipo = params.tipo
    where.status = params.status ? { in: params.status.split(',').map(s => s.trim().toUpperCase()) } : { in: ['AUTORIZADO', 'CANCELADO'] }

    const agrupado = await prisma.documentoFiscal.groupBy({
      by: ['tipo', 'status'],
      where,
      _count: { id: true },
    })
    const total = agrupado.reduce((acc, g) => acc + g._count.id, 0)

    return {
      periodo: { inicio: params.dataInicio, fim: params.dataFim },
      tipoFiltro: params.tipo,
      total,
      porTipo: agrupado.map(g => ({ tipo: g.tipo, status: g.status, quantidade: g._count.id })),
    }
  })

  // GET /fiscal/exportar-xml — Download ZIP
  app.get('/exportar-xml', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(403).send({ message: 'Sem empresa' })

    const params = exportarQuerySchema.parse(request.query)
    const where: any = {
      empresaId: user.empresaId,
      dataEmissao: { gte: new Date(params.dataInicio), lte: new Date(`${params.dataFim}T23:59:59.999Z`) },
      xmlAutorizado: { not: null },
    }
    if (params.tipo !== 'TODOS') where.tipo = params.tipo
    where.status = params.status ? { in: params.status.split(',').map(s => s.trim().toUpperCase()) } : { in: ['AUTORIZADO', 'CANCELADO'] }

    const documentos = await prisma.documentoFiscal.findMany({
      where,
      select: { id: true, tipo: true, serie: true, numero: true, chaveAcesso: true, xmlAutorizado: true, status: true },
      orderBy: [{ tipo: 'asc' }, { numero: 'asc' }],
    })

    if (documentos.length === 0) {
      return reply.status(404).send({ message: 'Nenhum documento encontrado no período' })
    }

    // Montar arquivos para o ZIP
    const files: Array<{ name: string; content: Buffer }> = []
    const querPdfDownload = params.formato === 'pdf' || params.formato === 'ambos'

    // Buscar empresa e configurações de layout do DACTE uma única vez
    let empresa: any = null
    let dacteModelo: '1' | '2' = '1'
    let dacteOrientacao: 'retrato' | 'paisagem' = 'retrato'
    if (querPdfDownload) {
      empresa = await prisma.empresa.findUnique({ where: { id: user.empresaId! } })
      const paramsDacte = await prisma.parametro.findMany({
        where: { empresaId: user.empresaId!, chave: { in: ['cte.dacteModelo', 'cte.dacteOrientacao'] } },
      })
      for (const p of paramsDacte) {
        if (p.chave === 'cte.dacteModelo') dacteModelo = (p.valor as '1' | '2') || '1'
        if (p.chave === 'cte.dacteOrientacao') dacteOrientacao = (p.valor as 'retrato' | 'paisagem') || 'retrato'
      }
    }

    for (const doc of documentos) {
      if (!doc.xmlAutorizado) continue
      const pasta = doc.tipo
      const sufixo = doc.status === 'CANCELADO' ? '-cancelado' : ''
      const baseName = doc.chaveAcesso
        ? `${doc.chaveAcesso}${sufixo}`
        : `${doc.tipo}-${doc.serie}-${doc.numero}${sufixo}`

      // XML
      if (params.formato === 'xml' || params.formato === 'ambos') {
        files.push({ name: `${pasta}/${baseName}.xml`, content: Buffer.from(doc.xmlAutorizado, 'utf-8') })
      }

      // PDF (gerar DACTE on-the-fly para CT-e, respeitando modelo/orientação configurados)
      if (querPdfDownload && doc.tipo === 'CTE' && empresa) {
        try {
          const { gerarDactePdf } = await import('./cte/cte-dacte-pdf.service')
          const docCompleto = await prisma.documentoFiscal.findUnique({ where: { id: doc.id } })
          if (docCompleto) {
            const pdfBuffer = await gerarDactePdf(docCompleto as any, empresa as any, { modelo: dacteModelo, orientacao: dacteOrientacao })
            files.push({ name: `${pasta}/${baseName}.pdf`, content: pdfBuffer })
          }
        } catch { /* PDF não gerado — silencioso */ }
      }
    }

    // Resumo TXT
    const resumo = [
      `Exportação — Vizor ERP`,
      `Período: ${params.dataInicio} a ${params.dataFim}`,
      `Tipo: ${params.tipo} | Total: ${documentos.length}`,
    ].join('\n')
    files.push({ name: 'RESUMO.txt', content: Buffer.from(resumo, 'utf-8') })

    const zipBuffer = criarZipSimples(files)
    const nomeArquivo = `XMLs_${params.tipo}_${params.dataInicio}_a_${params.dataFim}.zip`

    reply.header('Content-Type', 'application/zip')
    reply.header('Content-Disposition', `attachment; filename="${nomeArquivo}"`)
    return reply.send(zipBuffer)
  })

  // POST /fiscal/exportar-xml/enviar-email — Envia ZIP por e-mail
  app.post('/exportar-xml/enviar-email', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(403).send({ message: 'Sem empresa' })

    const body = z.object({
      tipo: z.enum(['NFE', 'NFCE', 'CTE', 'MDFE', 'NFSE', 'TODOS']).default('TODOS'),
      dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      formato: z.enum(['xml', 'pdf', 'ambos']).default('xml'),
      emails: z.array(z.string().email()).min(1),
    }).parse(request.body)

    const where: any = {
      empresaId: user.empresaId,
      dataEmissao: { gte: new Date(body.dataInicio), lte: new Date(`${body.dataFim}T23:59:59.999Z`) },
      xmlAutorizado: { not: null },
    }
    if (body.tipo !== 'TODOS') where.tipo = body.tipo
    where.status = { in: ['AUTORIZADO', 'CANCELADO'] }

    const documentos = await prisma.documentoFiscal.findMany({
      where,
      select: { id: true, tipo: true, serie: true, numero: true, chaveAcesso: true, xmlAutorizado: true, status: true },
      orderBy: [{ tipo: 'asc' }, { numero: 'asc' }],
    })

    if (documentos.length === 0) {
      return reply.status(404).send({ message: 'Nenhum documento encontrado no período' })
    }

    // Montar ZIP (respeitando o formato: xml, pdf ou ambos)
    const files: Array<{ name: string; content: Buffer }> = []
    const querPdf = body.formato === 'pdf' || body.formato === 'ambos'
    const empresa = await prisma.empresa.findUnique({
      where: { id: user.empresaId! },
      select: { id: true, razaoSocial: true, nomeFantasia: true, cnpj: true, logo: true },
    })

    // Buscar configurações de layout do DACTE (modelo e orientação)
    let dacteModelo: '1' | '2' = '1'
    let dacteOrientacao: 'retrato' | 'paisagem' = 'retrato'
    if (querPdf) {
      const paramsDacte = await prisma.parametro.findMany({
        where: { empresaId: user.empresaId!, chave: { in: ['cte.dacteModelo', 'cte.dacteOrientacao'] } },
      })
      for (const p of paramsDacte) {
        if (p.chave === 'cte.dacteModelo') dacteModelo = (p.valor as '1' | '2') || '1'
        if (p.chave === 'cte.dacteOrientacao') dacteOrientacao = (p.valor as 'retrato' | 'paisagem') || 'retrato'
      }
    }

    for (const doc of documentos) {
      if (!doc.xmlAutorizado) continue
      const pasta = doc.tipo
      const sufixo = doc.status === 'CANCELADO' ? '-cancelado' : ''
      const baseName = doc.chaveAcesso
        ? `${doc.chaveAcesso}${sufixo}`
        : `${doc.tipo}-${doc.serie}-${doc.numero}${sufixo}`

      // XML
      if (body.formato === 'xml' || body.formato === 'ambos') {
        files.push({ name: `${pasta}/${baseName}.xml`, content: Buffer.from(doc.xmlAutorizado, 'utf-8') })
      }

      // PDF (gerar DACTE on-the-fly para CT-e, respeitando modelo/orientação configurados)
      if (querPdf && doc.tipo === 'CTE' && empresa) {
        try {
          const { gerarDactePdf } = await import('./cte/cte-dacte-pdf.service')
          const docCompleto = await prisma.documentoFiscal.findUnique({ where: { id: doc.id } })
          if (docCompleto) {
            const pdfBuffer = await gerarDactePdf(docCompleto as any, empresa, { modelo: dacteModelo, orientacao: dacteOrientacao })
            files.push({ name: `${pasta}/${baseName}.pdf`, content: pdfBuffer })
          }
        } catch { /* PDF não gerado — silencioso */ }
      }
    }
    const zipBuffer = criarZipSimples(files)

    // Enviar por e-mail via SMTP
    try {
      const smtpHost = process.env.SMTP_HOST
      const smtpUser = process.env.SMTP_USER
      const smtpPass = process.env.SMTP_PASS
      const smtpPort = Number(process.env.SMTP_PORT || 587)
      const smtpFrom = process.env.SMTP_FROM || smtpUser

      if (!smtpHost || !smtpUser) {
        return reply.status(422).send({ message: 'SMTP não configurado. Configure as variáveis SMTP_HOST, SMTP_USER e SMTP_PASS no servidor.' })
      }

      const nodemailer = require('nodemailer')
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
      })

      const nomeZip = `Arquivos_${body.tipo}_${body.dataInicio}_a_${body.dataFim}.zip`

      const tipoDocLabel: Record<string, string> = {
        NFE: 'NF-e',
        NFCE: 'NFC-e',
        CTE: 'CT-e',
        MDFE: 'MDF-e',
        NFSE: 'NFS-e',
        TODOS: 'Documentos Fiscais',
      }
      const labelTipo = tipoDocLabel[body.tipo] || body.tipo
      const nomeEmpresa = empresa?.nomeFantasia || empresa?.razaoSocial || 'Empresa'
      const formatoLabel = body.formato === 'xml' ? 'XML' : body.formato === 'pdf' ? 'PDF' : 'XML e PDF'

      const subject = `${labelTipo} — ${nomeEmpresa} — ${body.dataInicio} a ${body.dataFim}`
      const textoEmail = [
        `Prezado(a),`,
        ``,
        `Segue em anexo os arquivos ${formatoLabel} referentes à emissão de ${labelTipo} da empresa ${nomeEmpresa}, no período de ${body.dataInicio} a ${body.dataFim}.`,
        ``,
        `Total: ${documentos.length} documento(s).`,
        ``,
        `Enviado automaticamente pelo Vizor ERP.`,
      ].join('\n')

      await transporter.sendMail({
        from: smtpFrom,
        to: body.emails.join(', '),
        subject,
        text: textoEmail,
        attachments: [{ filename: nomeZip, content: zipBuffer }],
      })

      return { sucesso: true, message: `Enviado para ${body.emails.length} e-mail(s)` }
    } catch (err: any) {
      return reply.status(500).send({ message: `Erro ao enviar e-mail: ${err.message}` })
    }
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// ZIP nativo (sem dependências externas)
// ═══════════════════════════════════════════════════════════════════════════

function criarZipSimples(files: Array<{ name: string; content: Buffer }>): Buffer {
  const localHeaders: Buffer[] = []
  const centralHeaders: Buffer[] = []
  let offset = 0

  for (const file of files) {
    const nameBuffer = Buffer.from(file.name, 'utf-8')
    const content = file.content
    const crc = crc32(content)

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0, 6)
    localHeader.writeUInt16LE(0, 8)
    localHeader.writeUInt16LE(0, 10)
    localHeader.writeUInt16LE(0, 12)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(content.length, 18)
    localHeader.writeUInt32LE(content.length, 22)
    localHeader.writeUInt16LE(nameBuffer.length, 26)
    localHeader.writeUInt16LE(0, 28)

    const localEntry = Buffer.concat([localHeader, nameBuffer, content])
    localHeaders.push(localEntry)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0, 8)
    centralHeader.writeUInt16LE(0, 10)
    centralHeader.writeUInt16LE(0, 12)
    centralHeader.writeUInt16LE(0, 14)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(content.length, 20)
    centralHeader.writeUInt32LE(content.length, 24)
    centralHeader.writeUInt16LE(nameBuffer.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)

    centralHeaders.push(Buffer.concat([centralHeader, nameBuffer]))
    offset += localEntry.length
  }

  const centralDir = Buffer.concat(centralHeaders)
  const centralDirOffset = offset

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralDir.length, 12)
  eocd.writeUInt32LE(centralDirOffset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...localHeaders, centralDir, eocd])
}

function crc32(buf: Buffer): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}
