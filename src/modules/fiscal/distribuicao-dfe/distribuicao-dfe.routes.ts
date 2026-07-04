/**
 * Rotas de Distribuição DFe — verificação e download de NF-e/CT-e
 * emitidas contra o CNPJ da empresa logada, direto na SEFAZ (Ambiente Nacional).
 *
 * Fluxo:
 * 1. POST /consultar — consulta o webservice NFeDistribuicaoDFe usando o
 *    certificado digital ativo da empresa, baixa os documentos novos desde
 *    o último NSU processado e grava em XmlImportado (mesma tabela usada
 *    pelo upload manual de XML).
 * 2. GET /  — lista os documentos já baixados (reaproveita o service de
 *    importação de XML existente via prisma direto).
 * 3. POST /:id/gerar-entrada — gera o documento fiscal de entrada a partir
 *    de um XML baixado (delega para o mesmo fluxo do módulo de importação).
 *
 * Pré-requisito: a empresa precisa ter um certificado digital A1 ativo
 * cadastrado (módulo certificado) para o CNPJ correspondente.
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { certificadoService } from '../certificado/certificado.service'
import { criarSefazClient, type SefazUrlResolver } from '../emissor-dfe/sefaz/sefaz-client'
import { obterUrlWebservice } from '../emissor-dfe/sefaz/sefaz-urls'
import { AmbienteSefaz, ServicoSefaz, type SefazConfig } from '../emissor-dfe/sefaz/tipos'
import { criarDistribuicaoDFeService } from '../emissor-dfe/sefaz/distribuicao-dfe'
import { ErroFiscal } from '../erros'

const listQuerySchema = z.object({
  status: z.enum(['PENDENTE', 'PROCESSADO', 'ENTRADA_GERADA']).optional(),
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

export async function distribuicaoDfeRoutes(app: FastifyInstance) {
  // ==========================================================================
  // POST /consultar — Consulta a SEFAZ e baixa NF-e/CT-e novas contra o CNPJ
  // ==========================================================================
  app.post('/consultar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    const empresa = await prisma.empresa.findUnique({
      where: { id: user.empresaId },
      select: { cnpj: true, uf: true },
    })
    if (!empresa) {
      return reply.status(404).send({ message: 'Empresa não encontrada' })
    }

    const cnpjLimpo = (empresa.cnpj || '').replace(/\D/g, '')
    if (cnpjLimpo.length !== 14) {
      return reply.status(422).send({ message: 'CNPJ da empresa inválido ou não configurado' })
    }

    try {
      const certificado = await certificadoService.obterParaAssinatura(cnpjLimpo, user.empresaId)

      const ambiente = Number(process.env.SEFAZ_AMBIENTE) || 2
      const sefazConfig: SefazConfig = {
        ambiente: ambiente === 1 ? AmbienteSefaz.PRODUCAO : AmbienteSefaz.HOMOLOGACAO,
        uf: empresa.uf || 'SP',
        timeoutMs: Number(process.env.SEFAZ_TIMEOUT_MS) || 30000,
        maxRetentativas: 3,
        intervaloRetentativaMs: 5000,
        certificadoPfx: certificado.pfxBuffer,
        certificadoSenha: certificado.senha,
      }

      const urlResolver: SefazUrlResolver = {
        resolverUrl: (uf: string, servico: ServicoSefaz, amb: number) =>
          obterUrlWebservice(uf, servico, amb as AmbienteSefaz),
      }

      const sefazClient = criarSefazClient(sefazConfig, urlResolver)
      const distribuicaoService = criarDistribuicaoDFeService(sefazClient, prisma as any)

      const resultado = await distribuicaoService.consultarEBaixar({
        cnpj: cnpjLimpo,
        empresaId: user.empresaId,
      })

      return reply.status(200).send({
        documentosProcessados: resultado.documentosProcessados,
        chavesAcesso: resultado.chavesAcesso,
        ultimoNsu: resultado.ultimoNsu,
        hasMaisDocumentos: resultado.hasMaisDocumentos,
        erros: resultado.erros,
        mensagem: resultado.documentosProcessados > 0
          ? `${resultado.documentosProcessados} nova(s) nota(s) encontrada(s) e baixada(s).`
          : 'Nenhuma nota nova encontrada desde a última consulta.',
      })
    } catch (err: any) {
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      return reply.status(500).send({ message: err.message || 'Erro ao consultar a SEFAZ' })
    }
  })

  // ==========================================================================
  // GET / — Lista os documentos já baixados (NF-e/CT-e contra o CNPJ)
  // ==========================================================================
  app.get('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const filtros = listQuerySchema.parse(request.query)

      const where: any = {
        empresaId: user.empresaId,
        origem: 'DISTRIBUICAO_DFE',
      }

      if (filtros.status === 'ENTRADA_GERADA') {
        where.documentoEntradaId = { not: null }
      } else if (filtros.status === 'PENDENTE') {
        where.documentoEntradaId = null
        where.manifestacao = null
      } else if (filtros.status === 'PROCESSADO') {
        where.documentoEntradaId = null
        where.manifestacao = { not: null }
      }

      if (filtros.dataInicio || filtros.dataFim) {
        where.dataEmissao = {}
        if (filtros.dataInicio) where.dataEmissao.gte = new Date(filtros.dataInicio)
        if (filtros.dataFim) where.dataEmissao.lte = new Date(`${filtros.dataFim}T23:59:59.999Z`)
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
            manifestacao: true,
            documentoEntradaId: true,
            criadoEm: true,
          },
        }),
        prisma.xmlImportado.count({ where }),
      ])

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
  // GET /status — Último NSU consultado e resumo de pendências
  // ==========================================================================
  app.get('/status', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    const parametro = await prisma.parametro.findFirst({
      where: { empresaId: user.empresaId, chave: 'DIST_DFE_ULTIMO_NSU' },
    })

    const pendentes = await prisma.xmlImportado.count({
      where: {
        empresaId: user.empresaId,
        origem: 'DISTRIBUICAO_DFE',
        documentoEntradaId: null,
      },
    })

    return {
      ultimoNsu: parametro?.valor || '0',
      documentosPendentesLancamento: pendentes,
    }
  })

  // ==========================================================================
  // POST /:id/gerar-entrada — Gera documento fiscal de entrada a partir do XML
  // Reaproveita a mesma lógica do módulo de importação manual de XML.
  // ==========================================================================
  app.post('/:id/gerar-entrada', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)

      const xmlImportado = await prisma.xmlImportado.findFirst({
        where: { id, empresaId: user.empresaId },
      })

      if (!xmlImportado) {
        return reply.status(404).send({ message: 'Documento não encontrado' })
      }

      if (xmlImportado.documentoEntradaId) {
        return reply.status(409).send({
          message: 'Entrada já gerada para este documento',
          documentoEntradaId: xmlImportado.documentoEntradaId,
        })
      }

      const { ImportacaoXmlService } = await import('../importacao/importacao-xml.service')
      const importacaoXmlService = new ImportacaoXmlService()
      const dadosExtraidos = importacaoXmlService.extrairDadosDetalhados(xmlImportado.xmlCompleto)

      const documentoEntrada = await prisma.documentoFiscal.create({
        data: {
          empresaId: user.empresaId,
          tipo: xmlImportado.tipo === 'CTE' ? 'CTE' : 'NFE',
          modelo: xmlImportado.tipo === 'CTE' ? 57 : 55,
          serie: 1,
          numero: 0,
          chaveAcesso: xmlImportado.chaveAcesso,
          status: 'ENTRADA_PENDENTE',
          naturezaOp: 'COMPRA DE MERCADORIA',
          dataEmissao: xmlImportado.dataEmissao,
          tipoOperacao: 0,
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
          ambiente: 1,
        },
      })

      await prisma.xmlImportado.update({
        where: { id: xmlImportado.id },
        data: { documentoEntradaId: documentoEntrada.id },
      })

      return reply.status(201).send({
        id: documentoEntrada.id,
        xmlImportadoId: xmlImportado.id,
        chaveAcesso: xmlImportado.chaveAcesso,
        status: documentoEntrada.status,
        emitente: {
          cnpj: dadosExtraidos.emitente.cnpj,
          razaoSocial: dadosExtraidos.emitente.razaoSocial,
        },
        itens: dadosExtraidos.itens.length,
        valorTotal: dadosExtraidos.totais.valorTotal,
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
