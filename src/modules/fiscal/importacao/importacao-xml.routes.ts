import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ImportacaoXmlService } from './importacao-xml.service'
import { ErroFiscal } from '../erros'
import { prisma } from '../../../lib/prisma'

const importacaoXmlService = new ImportacaoXmlService()

const idParamsSchema = z.object({
  id: z.string().uuid('ID deve ser um UUID válido'),
})

const listQuerySchema = z.object({
  status: z.enum(['PENDENTE', 'PROCESSADO', 'ENTRADA_GERADA']).optional(),
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD').optional(),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD').optional(),
  fornecedorCnpj: z.string().regex(/^\d{14}$/, 'CNPJ deve conter 14 dígitos').optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export async function importacaoXmlRoutes(app: FastifyInstance) {
  // ==========================================================================
  // POST /upload — Upload de XML de NF-e de entrada
  // Requirements: 28.1
  // Valida estrutura do XML, verifica assinatura digital e consulta situação na SEFAZ.
  // Aceita multipart/form-data (arquivo) ou JSON body com xmlContent.
  // ==========================================================================
  app.post('/upload', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      let xmlContent: string | null = null
      const contentType = request.headers['content-type'] || ''

      if (contentType.includes('multipart/form-data')) {
        // Upload via multipart: arquivo XML
        const parts = request.parts()

        for await (const part of parts) {
          if (part.type === 'file') {
            const validMimes = [
              'application/xml',
              'text/xml',
              'application/octet-stream',
            ]
            if (!validMimes.includes(part.mimetype)) {
              return reply.status(400).send({
                message: 'Formato de arquivo inválido. Envie um arquivo XML.',
              })
            }

            const buffer = await part.toBuffer()

            // Limite de 5 MB para XML
            if (buffer.length > 5 * 1024 * 1024) {
              return reply.status(400).send({
                message: 'Arquivo XML excede o limite de 5 MB.',
              })
            }

            xmlContent = buffer.toString('utf-8')
          }
        }
      } else {
        // Upload via JSON body com campo xmlContent
        const bodySchema = z.object({
          xmlContent: z.string().min(1, 'Conteúdo XML é obrigatório'),
        })

        const parsed = bodySchema.safeParse(request.body)
        if (!parsed.success) {
          return reply.status(400).send({
            message: 'Dados inválidos',
            erros: parsed.error.errors,
          })
        }

        xmlContent = parsed.data.xmlContent
      }

      if (!xmlContent || xmlContent.trim().length === 0) {
        return reply.status(400).send({
          message: 'Conteúdo XML é obrigatório. Envie via multipart/form-data ou campo xmlContent no JSON body.',
        })
      }

      const resultado = await importacaoXmlService.importar({
        empresaId: user.empresaId,
        xml: xmlContent,
        origem: 'UPLOAD',
      })

      return reply.status(201).send(resultado)
    } catch (err: any) {
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET / — Listar XMLs importados com filtros e paginação
  // Requirements: 28.2
  // Filtros: status (PENDENTE|PROCESSADO|ENTRADA_GERADA), período, fornecedor CNPJ
  // ==========================================================================
  app.get('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const filtros = listQuerySchema.parse(request.query)

      // Montar condições de filtro
      const where: any = { empresaId: user.empresaId }

      // Filtro por status derivado do campo documentoEntradaId
      if (filtros.status === 'ENTRADA_GERADA') {
        where.documentoEntradaId = { not: null }
      } else if (filtros.status === 'PENDENTE') {
        where.documentoEntradaId = null
        where.manifestacao = null
      } else if (filtros.status === 'PROCESSADO') {
        where.documentoEntradaId = null
        where.manifestacao = { not: null }
      }

      // Filtro por período (data de emissão)
      if (filtros.dataInicio || filtros.dataFim) {
        where.dataEmissao = {}
        if (filtros.dataInicio) {
          where.dataEmissao.gte = new Date(filtros.dataInicio)
        }
        if (filtros.dataFim) {
          where.dataEmissao.lte = new Date(`${filtros.dataFim}T23:59:59.999Z`)
        }
      }

      // Filtro por fornecedor (emitente CNPJ)
      if (filtros.fornecedorCnpj) {
        where.emitenteCnpj = filtros.fornecedorCnpj
      }

      const [data, total] = await Promise.all([
        prisma.xmlImportado.findMany({
          where,
          skip: (filtros.page - 1) * filtros.limit,
          take: filtros.limit,
          orderBy: { criadoEm: 'desc' },
          select: {
            id: true,
            chaveAcesso: true,
            tipo: true,
            emitenteCnpj: true,
            emitenteRazao: true,
            valorTotal: true,
            dataEmissao: true,
            origem: true,
            manifestacao: true,
            documentoEntradaId: true,
            criadoEm: true,
          },
        }),
        prisma.xmlImportado.count({ where }),
      ])

      // Derivar status para resposta
      const items = data.map((item) => ({
        ...item,
        valorTotal: Number(item.valorTotal),
        status: item.documentoEntradaId
          ? 'ENTRADA_GERADA'
          : item.manifestacao
            ? 'PROCESSADO'
            : 'PENDENTE',
      }))

      return {
        data: items,
        total,
        page: filtros.page,
        limit: filtros.limit,
        totalPages: Math.ceil(total / filtros.limit),
      }
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Parâmetros inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /:id/gerar-entrada — Gerar documento fiscal de entrada a partir do XML importado
  // Requirements: 28.2
  // Cria um DocumentoFiscal do tipo entrada com dados pré-preenchidos do XML.
  // ==========================================================================
  app.post('/:id/gerar-entrada', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)

      // Buscar XML importado
      const xmlImportado = await prisma.xmlImportado.findFirst({
        where: { id, empresaId: user.empresaId },
      })

      if (!xmlImportado) {
        return reply.status(404).send({ message: 'XML importado não encontrado' })
      }

      // Verificar se já possui entrada gerada
      if (xmlImportado.documentoEntradaId) {
        return reply.status(409).send({
          message: 'Entrada já gerada para este XML',
          documentoEntradaId: xmlImportado.documentoEntradaId,
        })
      }

      // Extrair dados do XML para gerar a entrada
      const dadosExtraidos = importacaoXmlService.extrairDadosDetalhados(xmlImportado.xmlCompleto)

      // Criar o documento fiscal de entrada
      const documentoEntrada = await prisma.documentoFiscal.create({
        data: {
          empresaId: user.empresaId,
          tipo: 'NFE',
          modelo: 55,
          serie: 1,
          numero: 0, // Será preenchido pelo número do documento de origem
          chaveAcesso: xmlImportado.chaveAcesso,
          status: 'ENTRADA_PENDENTE',
          naturezaOp: 'COMPRA DE MERCADORIA',
          dataEmissao: xmlImportado.dataEmissao,
          tipoOperacao: 0, // 0 = Entrada
          finalidade: 1,
          emitenteCnpj: dadosExtraidos.emitente.cnpj,
          emitenteRazao: dadosExtraidos.emitente.razaoSocial,
          emitenteUf: dadosExtraidos.emitente.uf,
          destCpfCnpj: dadosExtraidos.destinatario.cpfCnpj,
          destRazao: dadosExtraidos.destinatario.razaoSocial,
          destUf: dadosExtraidos.destinatario.uf,
          valorProdutos: dadosExtraidos.totais.valorProdutos,
          valorFrete: dadosExtraidos.totais.valorFrete,
          valorSeguro: dadosExtraidos.totais.valorSeguro,
          valorDesconto: dadosExtraidos.totais.valorDesconto,
          valorOutras: dadosExtraidos.totais.valorOutras,
          valorTotal: dadosExtraidos.totais.valorTotal,
          valorIcms: dadosExtraidos.totais.valorICMS,
          valorIpi: dadosExtraidos.totais.valorIPI,
          valorPis: dadosExtraidos.totais.valorPIS,
          valorCofins: dadosExtraidos.totais.valorCOFINS,
          xmlAutorizado: xmlImportado.xmlCompleto,
          protocolo: dadosExtraidos.protocolo || null,
          ambiente: 1,
        },
      })

      // Vincular o documento de entrada ao XML importado
      await prisma.xmlImportado.update({
        where: { id: xmlImportado.id },
        data: { documentoEntradaId: documentoEntrada.id },
      })

      return reply.status(201).send({
        id: documentoEntrada.id,
        importacaoXmlId: xmlImportado.id,
        chaveAcesso: xmlImportado.chaveAcesso,
        status: documentoEntrada.status,
        emitente: {
          cnpj: dadosExtraidos.emitente.cnpj,
          razaoSocial: dadosExtraidos.emitente.razaoSocial,
        },
        itens: dadosExtraidos.itens.length,
        valorTotal: dadosExtraidos.totais.valorTotal,
        criadoEm: documentoEntrada.dataEmissao.toISOString(),
      })
    } catch (err: any) {
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Parâmetros inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })
}
