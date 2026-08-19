/**
 * Rotas de Exportação de Arquivos Fiscais (XML e PDF)
 * 
 * GET /exportar-xml/resumo — Resumo de documentos disponíveis por período
 * GET /exportar-xml — Download ZIP com XMLs do período
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'

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

    // Gerar ZIP usando formato simples (concatenar XMLs comprimidos individualmente)
    // Usar estrutura ZIP mínima nativa
    const files: Array<{ name: string; content: Buffer }> = []
    for (const doc of docs) {
      if (!doc.xmlAutorizado) continue
      const nomeArquivo = doc.chaveAcesso
        ? `${doc.chaveAcesso}-${doc.tipo.toLowerCase()}.xml`
        : `${doc.tipo}-${doc.serie}-${doc.numero}.xml`
      files.push({ name: nomeArquivo, content: Buffer.from(doc.xmlAutorizado, 'utf-8') })
    }

    // Criar ZIP minimal usando o formato ZIP padrão (store, sem compressão para simplicidade)
    const zipBuffer = criarZipSimples(files)

    reply.header('Content-Type', 'application/zip')
    reply.header('Content-Disposition', `attachment; filename="XMLs_${filtros.tipo}_${filtros.dataInicio}_a_${filtros.dataFim}.zip"`)
    return reply.send(zipBuffer)
  })
}

/**
 * Cria um ZIP mínimo (método STORE, sem compressão) usando apenas Buffer.
 * Compatível com qualquer descompactador padrão.
 */
function criarZipSimples(files: Array<{ name: string; content: Buffer }>): Buffer {
  const localHeaders: Buffer[] = []
  const centralHeaders: Buffer[] = []
  let offset = 0

  for (const file of files) {
    const nameBuffer = Buffer.from(file.name, 'utf-8')
    const content = file.content
    const crc = crc32(content)

    // Local file header (30 bytes + name + content)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)  // signature
    localHeader.writeUInt16LE(20, 4)           // version needed
    localHeader.writeUInt16LE(0, 6)            // flags
    localHeader.writeUInt16LE(0, 8)            // compression (STORE)
    localHeader.writeUInt16LE(0, 10)           // mod time
    localHeader.writeUInt16LE(0, 12)           // mod date
    localHeader.writeUInt32LE(crc, 14)         // crc-32
    localHeader.writeUInt32LE(content.length, 18) // compressed size
    localHeader.writeUInt32LE(content.length, 22) // uncompressed size
    localHeader.writeUInt16LE(nameBuffer.length, 26) // filename length
    localHeader.writeUInt16LE(0, 28)           // extra field length

    const localEntry = Buffer.concat([localHeader, nameBuffer, content])
    localHeaders.push(localEntry)

    // Central directory header (46 bytes + name)
    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)  // signature
    centralHeader.writeUInt16LE(20, 4)           // version made by
    centralHeader.writeUInt16LE(20, 6)           // version needed
    centralHeader.writeUInt16LE(0, 8)            // flags
    centralHeader.writeUInt16LE(0, 10)           // compression
    centralHeader.writeUInt16LE(0, 12)           // mod time
    centralHeader.writeUInt16LE(0, 14)           // mod date
    centralHeader.writeUInt32LE(crc, 16)         // crc-32
    centralHeader.writeUInt32LE(content.length, 20) // compressed size
    centralHeader.writeUInt32LE(content.length, 24) // uncompressed size
    centralHeader.writeUInt16LE(nameBuffer.length, 28) // filename length
    centralHeader.writeUInt16LE(0, 30)           // extra field length
    centralHeader.writeUInt16LE(0, 32)           // comment length
    centralHeader.writeUInt16LE(0, 34)           // disk number
    centralHeader.writeUInt16LE(0, 36)           // internal attributes
    centralHeader.writeUInt32LE(0, 38)           // external attributes
    centralHeader.writeUInt32LE(offset, 42)      // local header offset

    centralHeaders.push(Buffer.concat([centralHeader, nameBuffer]))
    offset += localEntry.length
  }

  const centralDir = Buffer.concat(centralHeaders)
  const centralDirOffset = offset

  // End of central directory (22 bytes)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)        // signature
  eocd.writeUInt16LE(0, 4)                  // disk number
  eocd.writeUInt16LE(0, 6)                  // central dir disk
  eocd.writeUInt16LE(files.length, 8)       // entries on this disk
  eocd.writeUInt16LE(files.length, 10)      // total entries
  eocd.writeUInt32LE(centralDir.length, 12) // central dir size
  eocd.writeUInt32LE(centralDirOffset, 16)  // central dir offset
  eocd.writeUInt16LE(0, 20)                 // comment length

  return Buffer.concat([...localHeaders, centralDir, eocd])
}

/** CRC-32 simples para ZIP */
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
