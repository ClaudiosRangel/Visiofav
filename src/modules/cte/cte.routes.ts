import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { gerarChaveAcesso } from '../nfe/nfe-chave'
import { assinarXml } from '../nfe/nfe-assinatura'
import { buildCTeXml } from './cte-xml-builder'
import { enviarCTe, cancelarCTeSefaz } from './cte-sefaz'

const idParamsSchema = z.object({ id: z.string().uuid() })

const emitirBodySchema = z.object({
  remetenteId: z.string().uuid(),
  destinatarioId: z.string().uuid(),
  transportadoraId: z.string().uuid().optional(),
  descricaoCarga: z.string().min(1).max(300),
  valorCarga: z.number().positive(),
  valorFrete: z.number().positive(),
  chavesNfeRef: z.array(z.string().length(44)).optional(),
})

const cancelarBodySchema = z.object({
  justificativa: z.string().min(15, 'Justificativa deve ter no mínimo 15 caracteres'),
})

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
})

export async function cteRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('CTE'))

  // GET / — lista CT-e
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { page, limit } = listQuerySchema.parse(request.query)

    const where = { empresaId: user.empresaId }
    const [data, total] = await Promise.all([
      prisma.cte.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { criadoEm: 'desc' },
        include: { nfesReferencia: true },
      }),
      prisma.cte.count({ where }),
    ])

    return { data, total }
  })

  // POST / — emitir CT-e
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = emitirBodySchema.parse(request.body)

    const empresa = await prisma.empresa.findUnique({ where: { id: user.empresaId } })
    if (!empresa) return reply.status(404).send({ message: 'Empresa não encontrada' })

    // Buscar remetente e destinatário (podem ser clientes ou fornecedores)
    const remetente = await prisma.cliente.findFirst({ where: { id: body.remetenteId } })
      ?? await prisma.fornecedor.findFirst({ where: { id: body.remetenteId } })
    const destinatario = await prisma.cliente.findFirst({ where: { id: body.destinatarioId } })
      ?? await prisma.fornecedor.findFirst({ where: { id: body.destinatarioId } })

    if (!remetente) return reply.status(404).send({ message: 'Remetente não encontrado' })
    if (!destinatario) return reply.status(404).send({ message: 'Destinatário não encontrado' })

    const numero = empresa.proximoNumeroCTe
    const serie = empresa.serieCTe

    const chaveAcesso = gerarChaveAcesso({
      uf: empresa.uf || 'SP',
      dataEmissao: new Date(),
      cnpj: empresa.cnpj,
      modelo: 57,
      serie,
      numero,
    })

    const xml = buildCTeXml({
      chaveAcesso,
      numero,
      serie,
      dataEmissao: new Date().toISOString(),
      tpAmb: empresa.ambienteNFe,
      emitente: {
        cnpj: empresa.cnpj,
        razaoSocial: empresa.razaoSocial,
        inscEstadual: empresa.inscEstadual || undefined,
        logradouro: empresa.logradouro || undefined,
        numero: empresa.numero || undefined,
        bairro: empresa.bairro || undefined,
        cidade: empresa.cidade || undefined,
        uf: empresa.uf || undefined,
        cep: empresa.cep || undefined,
      },
      remetente: {
        cpfCnpj: (remetente as any).cpfCnpj || (remetente as any).cnpj || '',
        razaoSocial: remetente.razaoSocial,
        cidade: (remetente as any).cidade,
        uf: (remetente as any).uf,
      },
      destinatario: {
        cpfCnpj: (destinatario as any).cpfCnpj || (destinatario as any).cnpj || '',
        razaoSocial: destinatario.razaoSocial,
        cidade: (destinatario as any).cidade,
        uf: (destinatario as any).uf,
      },
      descricaoCarga: body.descricaoCarga,
      valorCarga: body.valorCarga,
      valorFrete: body.valorFrete,
      chavesNfeRef: body.chavesNfeRef || [],
    })

    const xmlAssinado = assinarXml(xml)
    const resposta = await enviarCTe(xmlAssinado, empresa.ambienteNFe)

    const cte = await prisma.$transaction(async (tx) => {
      const record = await tx.cte.create({
        data: {
          empresaId: user.empresaId,
          numero,
          serie,
          chaveAcesso,
          remetenteId: body.remetenteId,
          destinatarioId: body.destinatarioId,
          transportadoraId: body.transportadoraId,
          descricaoCarga: body.descricaoCarga,
          valorCarga: body.valorCarga,
          valorFrete: body.valorFrete,
          xmlEnviado: xmlAssinado,
          xmlRetorno: resposta.xmlRetorno,
          protocolo: resposta.protocolo,
          status: resposta.sucesso ? 'AUTORIZADO' : 'REJEITADO',
          ambiente: empresa.ambienteNFe,
          nfesReferencia: body.chavesNfeRef?.length ? {
            create: body.chavesNfeRef.map((chave) => ({ chaveNfe: chave })),
          } : undefined,
        },
      })

      await tx.empresa.update({
        where: { id: user.empresaId },
        data: { proximoNumeroCTe: numero + 1 },
      })

      return record
    })

    return reply.status(201).send({ cte, sefaz: resposta })
  })

  // GET /:id — detalhe
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const cte = await prisma.cte.findFirst({
      where: { id, empresaId: user.empresaId },
      include: { nfesReferencia: true },
    })

    if (!cte) return reply.status(404).send({ message: 'CT-e não encontrado' })
    return cte
  })

  // POST /:id/cancelar
  app.post('/:id/cancelar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const { justificativa } = cancelarBodySchema.parse(request.body)

    const cte = await prisma.cte.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!cte) return reply.status(404).send({ message: 'CT-e não encontrado' })
    if (cte.status !== 'AUTORIZADO') return reply.status(422).send({ message: 'Apenas CT-e autorizados podem ser cancelados' })

    const resposta = await cancelarCTeSefaz(cte.chaveAcesso || '', cte.protocolo || '', justificativa, cte.ambiente)

    if (resposta.sucesso) {
      await prisma.cte.update({ where: { id }, data: { status: 'CANCELADO' } })
    }

    return { sucesso: resposta.sucesso, sefaz: resposta }
  })
}
