/**
 * Rotas de GNRE e Consulta de Situação na SEFAZ
 *
 * GNRE:
 * - POST /gnre/gerar              — Gerar GNRE para documento fiscal
 * - GET  /gnre                    — Listar GNREs com filtros
 * - POST /gnre/:id/pagar          — Registrar pagamento de uma GNRE
 * - POST /gnre/consolidar         — Consolidar GNREs por UF/período
 * - POST /gnre/pagar-consolidado  — Registrar pagamento consolidado
 *
 * Consulta SEFAZ:
 * - GET  /documentos/:id/consultar-sefaz — Consultar situação do documento na SEFAZ
 *
 * Requirements: 25.1, 26.1
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { gnreService } from './gnre.service'
import { ErroFiscal } from '../erros'
import { prisma } from '../../../lib/prisma'
import { criarSefazClient, type SefazUrlResolver } from '../emissor-dfe/sefaz/sefaz-client'
import { obterUrlWebservice } from '../emissor-dfe/sefaz/sefaz-urls'
import { AmbienteSefaz, ServicoSefaz, type SefazConfig } from '../emissor-dfe/sefaz/tipos'
import { certificadoService } from '../certificado/certificado.service'

// === Zod Schemas ===

const gerarGnreBodySchema = z.object({
  empresaId: z.string().uuid('empresaId deve ser um UUID válido'),
  documentoFiscalId: z.string().uuid('documentoFiscalId deve ser um UUID válido'),
})

const listarGnreQuerySchema = z.object({
  status: z.string().optional(),
  ufDestino: z.string().length(2, 'UF deve ter 2 caracteres').optional(),
  periodo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Período deve estar no formato YYYY-MM').optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
})

const pagarGnreParamsSchema = z.object({
  id: z.string().uuid('ID deve ser um UUID válido'),
})

const pagarGnreBodySchema = z.object({
  empresaId: z.string().uuid('empresaId deve ser um UUID válido'),
  dataPagamento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD'),
  nossoNumero: z.string().optional(),
})

const consolidarBodySchema = z.object({
  empresaId: z.string().uuid('empresaId deve ser um UUID válido'),
  ufDestino: z.string().length(2, 'UF deve ter 2 caracteres'),
  periodo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Período deve estar no formato YYYY-MM'),
})

const pagarConsolidadoBodySchema = z.object({
  empresaId: z.string().uuid('empresaId deve ser um UUID válido'),
  ufDestino: z.string().length(2, 'UF deve ter 2 caracteres'),
  periodo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Período deve estar no formato YYYY-MM'),
  dataPagamento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD'),
  nossoNumero: z.string().optional(),
})

const consultarSefazParamsSchema = z.object({
  id: z.string().uuid('ID deve ser um UUID válido'),
})

// === Routes ===

export async function gnreRoutes(app: FastifyInstance) {
  // ==========================================================================
  // POST /gnre/gerar — Gerar GNRE para documento fiscal
  // Requirement: 25.1
  // Gera GNRE automaticamente para NF-e com ICMS-ST interestadual.
  // ==========================================================================
  app.post('/gnre/gerar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = gerarGnreBodySchema.parse(request.body)
      const gnre = await gnreService.gerarParaDocumento({
        empresaId: body.empresaId,
        documentoFiscalId: body.documentoFiscalId,
      })
      return reply.status(201).send(gnre)
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      return reply.status(500).send({ message: err.message || 'Erro ao gerar GNRE' })
    }
  })

  // ==========================================================================
  // GET /gnre — Listar GNREs com filtros
  // Requirement: 25.1
  // Retorna GNREs da empresa com paginação e filtros opcionais.
  // ==========================================================================
  app.get('/gnre', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const query = listarGnreQuerySchema.parse(request.query)
      const resultado = await gnreService.listar({
        empresaId: user.empresaId,
        status: query.status,
        ufDestino: query.ufDestino,
        periodo: query.periodo,
        page: query.page,
        pageSize: query.pageSize,
      })
      return reply.status(200).send(resultado)
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Parâmetros inválidos', erros: err.errors })
      }
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      return reply.status(500).send({ message: err.message || 'Erro ao listar GNREs' })
    }
  })

  // ==========================================================================
  // POST /gnre/:id/pagar — Registrar pagamento de uma GNRE
  // Requirement: 25.1
  // Atualiza status para PAGO com data e nosso número.
  // ==========================================================================
  app.post('/gnre/:id/pagar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = pagarGnreParamsSchema.parse(request.params)
      const body = pagarGnreBodySchema.parse(request.body)
      const gnre = await gnreService.registrarPagamento({
        gnreId: id,
        empresaId: body.empresaId,
        dataPagamento: new Date(body.dataPagamento),
        nossoNumero: body.nossoNumero,
      })
      return reply.status(200).send(gnre)
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      return reply.status(500).send({ message: err.message || 'Erro ao registrar pagamento de GNRE' })
    }
  })

  // ==========================================================================
  // POST /gnre/consolidar — Consolidar GNREs por UF/período
  // Requirement: 25.1 (25.4 - consolidação por UF)
  // Agrupa GNREs pendentes de uma UF/período para pagamento em lote.
  // ==========================================================================
  app.post('/gnre/consolidar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = consolidarBodySchema.parse(request.body)
      const resultado = await gnreService.consolidarPorUf({
        empresaId: body.empresaId,
        ufDestino: body.ufDestino,
        periodo: body.periodo,
      })
      return reply.status(200).send(resultado)
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      return reply.status(500).send({ message: err.message || 'Erro ao consolidar GNREs' })
    }
  })

  // ==========================================================================
  // POST /gnre/pagar-consolidado — Registrar pagamento consolidado
  // Requirement: 25.1 (25.3, 25.4)
  // Marca todas as GNREs pendentes da UF/período como pagas.
  // ==========================================================================
  app.post('/gnre/pagar-consolidado', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = pagarConsolidadoBodySchema.parse(request.body)
      const resultado = await gnreService.registrarPagamentoConsolidado({
        empresaId: body.empresaId,
        ufDestino: body.ufDestino,
        periodo: body.periodo,
        dataPagamento: new Date(body.dataPagamento),
        nossoNumero: body.nossoNumero,
      })
      return reply.status(200).send(resultado)
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      return reply.status(500).send({ message: err.message || 'Erro ao registrar pagamento consolidado' })
    }
  })

  // ==========================================================================
  // GET /documentos/:id/consultar-sefaz — Consultar situação do documento na SEFAZ
  // Requirement: 26.1
  // Consulta o webservice da SEFAZ pela chave de acesso e retorna status atualizado.
  // Atualiza o status local se divergente.
  // ==========================================================================
  app.get('/documentos/:id/consultar-sefaz', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = consultarSefazParamsSchema.parse(request.params)

      // Buscar o documento fiscal
      const documento = await prisma.documentoFiscal.findFirst({
        where: {
          id,
          empresaId: user.empresaId,
        },
      })

      if (!documento) {
        return reply.status(404).send({ message: 'Documento fiscal não encontrado' })
      }

      if (!documento.chaveAcesso) {
        return reply.status(422).send({
          message: 'Documento não possui chave de acesso para consulta na SEFAZ',
        })
      }

      // Obter certificado da empresa para comunicação com a SEFAZ
      const certificado = await certificadoService.obterParaAssinatura(
        documento.emitenteCnpj,
        user.empresaId,
      )

      const ambiente = Number(process.env.SEFAZ_AMBIENTE) || 2

      const sefazConfig: SefazConfig = {
        ambiente: ambiente === 1 ? AmbienteSefaz.PRODUCAO : AmbienteSefaz.HOMOLOGACAO,
        uf: documento.emitenteUf,
        timeoutMs: Number(process.env.SEFAZ_TIMEOUT_MS) || 30000,
        maxRetentativas: 3,
        intervaloRetentativaMs: 5000,
        certificadoPfx: certificado.pfxBuffer,
        certificadoSenha: certificado.senha,
      }

      const urlResolver: SefazUrlResolver = {
        resolverUrl: (uf: string, servico: ServicoSefaz, amb: number) => {
          return obterUrlWebservice(uf, servico, amb as AmbienteSefaz)
        },
      }

      const sefazClient = criarSefazClient(sefazConfig, urlResolver)

      // Consultar situação na SEFAZ
      const situacao = await sefazClient.consultarProtocolo(documento.chaveAcesso)

      // Mapear código de status para status legível
      const statusSefaz = mapearStatusSefaz(situacao.codigoStatus)

      // Atualizar status local se divergente (Requirement 26.1 - AC 2)
      if (statusSefaz && statusSefaz !== documento.status) {
        await prisma.documentoFiscal.update({
          where: { id },
          data: {
            status: statusSefaz,
          },
        })
      }

      return reply.status(200).send({
        documentoFiscalId: id,
        chaveAcesso: documento.chaveAcesso,
        statusLocal: documento.status,
        statusSefaz: statusSefaz || documento.status,
        codigoStatus: situacao.codigoStatus,
        motivoStatus: situacao.motivoStatus,
        protocolo: situacao.protocolo,
        dataAutorizacao: situacao.dataAutorizacao,
        divergente: statusSefaz !== null && statusSefaz !== documento.status,
        consultadoEm: new Date(),
      })
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Parâmetros inválidos', erros: err.errors })
      }
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      return reply.status(500).send({ message: err.message || 'Erro ao consultar situação na SEFAZ' })
    }
  })
}

// === Helpers ===

/**
 * Mapeia código de status da SEFAZ para o status interno do documento.
 * Retorna null se o código não corresponder a um status mapeável.
 */
function mapearStatusSefaz(codigoStatus: number): string | null {
  switch (codigoStatus) {
    case 100: // Autorizada
      return 'AUTORIZADO'
    case 101: // Cancelada
      return 'CANCELADO'
    case 110: // Denegada
      return 'DENEGADO'
    case 301: // Denegada por irregularidade do emitente
    case 302: // Denegada por irregularidade do destinatário
      return 'DENEGADO'
    case 217: // NF-e não consta na base da SEFAZ
    case 562: // NF-e não encontrada
      return null
    default:
      return null
  }
}
