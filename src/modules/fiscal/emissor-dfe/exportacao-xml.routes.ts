/**
 * Exportação de XMLs em lote (ZIP) para envio ao contador
 *
 * Endpoints:
 * - GET /fiscal/exportar-xml — Gera ZIP com todos os XMLs do período
 *
 * Parâmetros:
 * - tipo: NFE, NFCE, CTE, MDFE, NFSE (ou "TODOS")
 * - dataInicio: YYYY-MM-DD
 * - dataFim: YYYY-MM-DD
 * - status: AUTORIZADO, CANCELADO (default: ambos)
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import archiver from 'archiver'
import { prisma } from '../../../lib/prisma'

const exportarQuerySchema = z.object({
  tipo: z.enum(['NFE', 'NFCE', 'CTE', 'MDFE', 'NFSE', 'TODOS']).default('TODOS'),
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.string().optional(),
})

export async function exportacaoXmlRoutes(app: FastifyInstance) {

  // GET /fiscal/exportar-xml — Gera ZIP com XMLs do período
  app.get('/exportar-xml', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    const params = exportarQuerySchema.parse(request.query)

    const where: any = {
      empresaId: user.empresaId,
      dataEmissao: {
        gte: new Date(params.dataInicio),
        lte: new Date(`${params.dataFim}T23:59:59.999Z`),
      },
      xmlAutorizado: { not: null },
    }

    if (params.tipo !== 'TODOS') {
      where.tipo = params.tipo
    }

    if (params.status) {
      const statusList = params.status.split(',').map(s => s.trim().toUpperCase())
      where.status = { in: statusList }
    } else {
      where.status = { in: ['AUTORIZADO', 'CANCELADO'] }
    }

    const documentos = await prisma.documentoFiscal.findMany({
      where,
      select: {
        tipo: true,
        serie: true,
        numero: true,
        chaveAcesso: true,
        xmlAutorizado: true,
        dataEmissao: true,
        status: true,
      },
      orderBy: [{ tipo: 'asc' }, { numero: 'asc' }],
    })

    if (documentos.length === 0) {
      return reply.status(404).send({
        message: 'Nenhum documento encontrado no período informado',
      })
    }

    // Gerar ZIP
    const nomeArquivo = `XMLs_${params.tipo}_${params.dataInicio}_a_${params.dataFim}.zip`

    reply.header('Content-Type', 'application/zip')
    reply.header('Content-Disposition', `attachment; filename="${nomeArquivo}"`)

    const archive = archiver('zip', { zlib: { level: 6 } })

    // Stream direto para a resposta
    reply.raw.on('close', () => archive.abort())
    archive.pipe(reply.raw)

    // Organizar XMLs em pastas por tipo
    for (const doc of documentos) {
      if (!doc.xmlAutorizado) continue

      const pasta = doc.tipo // NFE, CTE, etc.
      const sufixo = doc.status === 'CANCELADO' ? '-cancelado' : ''
      const nome = doc.chaveAcesso
        ? `${doc.chaveAcesso}${sufixo}.xml`
        : `${doc.tipo}-${doc.serie}-${doc.numero}${sufixo}.xml`

      archive.append(doc.xmlAutorizado, { name: `${pasta}/${nome}` })
    }

    // Adicionar resumo em TXT
    const resumo = [
      `Exportação de XMLs — Vizor ERP`,
      `Período: ${params.dataInicio} a ${params.dataFim}`,
      `Tipo: ${params.tipo}`,
      `Total de documentos: ${documentos.length}`,
      '',
      'Detalhamento:',
      ...documentos.map(d =>
        `  ${d.tipo} Série ${d.serie} Nº ${d.numero} — ${d.status} — ${new Date(d.dataEmissao).toLocaleDateString('pt-BR')}`
      ),
    ].join('\n')
    archive.append(resumo, { name: 'RESUMO.txt' })

    await archive.finalize()
    return reply
  })

  // GET /fiscal/exportar-xml/resumo — Resumo do que será exportado (sem gerar ZIP)
  app.get('/exportar-xml/resumo', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    const params = exportarQuerySchema.parse(request.query)

    const where: any = {
      empresaId: user.empresaId,
      dataEmissao: {
        gte: new Date(params.dataInicio),
        lte: new Date(`${params.dataFim}T23:59:59.999Z`),
      },
      xmlAutorizado: { not: null },
    }

    if (params.tipo !== 'TODOS') {
      where.tipo = params.tipo
    }

    if (params.status) {
      const statusList = params.status.split(',').map(s => s.trim().toUpperCase())
      where.status = { in: statusList }
    } else {
      where.status = { in: ['AUTORIZADO', 'CANCELADO'] }
    }

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
      porTipo: agrupado.map(g => ({
        tipo: g.tipo,
        status: g.status,
        quantidade: g._count.id,
      })),
    }
  })
}
