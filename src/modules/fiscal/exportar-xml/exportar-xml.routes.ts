/**
 * Rotas de Exportação de Arquivos Fiscais (XML e PDF)
 * 
 * GET /exportar-xml/resumo — Resumo de documentos disponíveis por período
 * GET /exportar-xml — Download ZIP com XMLs do período
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'

// archiver não tem ESM export compatível com tsx — usar require
const archiver = require('archiver') as typeof import('archiver')

const filtrosSchema = z.object({
  tipo: z.string().default('TODOS'),
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export async function exportarXmlRoutes(app: FastifyInstance) {

  // GET /exportar-xml/resumo — Resumo de documentos com XML no período
  app.get('/exportar-xml/resumo', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(403).send({ message: 'Sem empresa' })

    const filtros = filtrosSchema.parse(request.query)
    const dataIni = new Date(filtros.dataInicio + 'T00:00:00')
    const dataFim = new Date(filtros.dataFim + 'T23:59:59')

    const where: any = {
      empresaId: user.empresaId,
      dataEmissao: { gte: dataIni, lte: dataFim },
      xmlAutorizado: { not: null },
    }
    if (filtros.tipo !== 'TODOS') where.tipo = filtros.tipo

    // Agrupar por tipo + status
    const docs = await prisma.documentoFiscal.groupBy({
      by: ['tipo', 'status'],
      where,
      _count: { id: true },
    })

    const total = docs.reduce((sum, d) => sum + d._count.id, 0)
    const porTipo = docs.map(d => ({ tipo: d.tipo, status: d.status, quantidade: d._count.id }))

    return {
      total,
      periodo: { inicio: filtros.dataInicio, fim: filtros.dataFim },
      porTipo,
    }
  })

  // GET /exportar-xml — Download ZIP com XMLs
  app.get('/exportar-xml', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(403).send({ message: 'Sem empresa' })

    const filtros = filtrosSchema.parse(request.query)
    const dataIni = new Date(filtros.dataInicio + 'T00:00:00')
    const dataFim = new Date(filtros.dataFim + 'T23:59:59')

    const where: any = {
      empresaId: user.empresaId,
      dataEmissao: { gte: dataIni, lte: dataFim },
      xmlAutorizado: { not: null },
    }
    if (filtros.tipo !== 'TODOS') where.tipo = filtros.tipo

    const docs = await prisma.documentoFiscal.findMany({
      where,
      select: { id: true, tipo: true, serie: true, numero: true, chaveAcesso: true, xmlAutorizado: true },
      orderBy: { numero: 'asc' },
    })

    if (docs.length === 0) {
      return reply.status(404).send({ message: 'Nenhum documento com XML encontrado no período' })
    }

    // Gerar ZIP em memória
    reply.header('Content-Type', 'application/zip')
    reply.header('Content-Disposition', `attachment; filename="XMLs_${filtros.tipo}_${filtros.dataInicio}_a_${filtros.dataFim}.zip"`)

    const archive = archiver('zip', { zlib: { level: 5 } })
    const chunks: Buffer[] = []

    archive.on('data', (chunk) => chunks.push(chunk))
    archive.on('end', () => {
      reply.send(Buffer.concat(chunks))
    })
    archive.on('error', (err) => {
      reply.status(500).send({ message: 'Erro ao gerar ZIP: ' + err.message })
    })

    for (const doc of docs) {
      if (!doc.xmlAutorizado) continue
      const nomeArquivo = doc.chaveAcesso
        ? `${doc.chaveAcesso}-${doc.tipo.toLowerCase()}.xml`
        : `${doc.tipo}-${doc.serie}-${doc.numero}.xml`
      archive.append(doc.xmlAutorizado, { name: nomeArquivo })
    }

    await archive.finalize()
  })
}
