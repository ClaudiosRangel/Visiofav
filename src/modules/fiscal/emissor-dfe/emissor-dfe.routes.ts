/**
 * Rotas do Emissor de DFe — NF-e, NFC-e, CT-e, MDF-e
 *
 * Endpoints:
 * - POST /nfe/emitir          — Emitir NF-e
 * - POST /nfe/:id/cancelar    — Cancelar NF-e autorizada
 * - POST /nfe/:id/carta-correcao — Emitir CC-e
 * - POST /nfe/inutilizar      — Inutilizar faixa de numeração
 * - GET  /nfe/:id/danfe       — Gerar/baixar DANFE em PDF
 * - GET  /nfe                  — Listar NF-e com filtros
 * - POST /nfce/emitir         — Emitir NFC-e (modelo 65)
 * - POST /cte/emitir          — Emitir CT-e (modelo 57)
 *
 * Requirements: 1.1, 1.5, 1.7, 1.8, 1.9, 5.8, 6.8
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { nfeEmissaoService } from './nfe/nfe-emissao.service'
import { nfceEmissaoService } from './nfce/nfce-emissao.service'
import { danfePdfService } from './nfe/danfe-pdf.service'
import { cteRoutes } from './cte/cte.routes'
import {
  cancelar,
  cartaCorrecao,
  inutilizar,
  type DocumentoParaEvento,
  type DocumentoParaInutilizacao,
  type DependenciasEventos,
} from './nfe/nfe-eventos'
import { criarSefazClient, type SefazUrlResolver } from './sefaz/sefaz-client'
import { obterUrlWebservice } from './sefaz/sefaz-urls'
import { AmbienteSefaz, ServicoSefaz, type SefazConfig } from './sefaz/tipos'
import { certificadoService } from '../certificado/certificado.service'
import {
  emissaoNFeInputSchema,
  emissaoNFCeInputSchema,
  cancelamentoInputSchema,
  cceInputSchema,
  inutilizacaoInputSchema,
} from '../schemas'
import { ErroFiscal, CodigoErroFiscal } from '../erros'
import type { DadosNFe } from './nfe/nfe-xml-builder'
import { mdfeRoutes } from './mdfe/mdfe.routes'

// === Schemas de parâmetros e query ===

const idParamsSchema = z.object({
  id: z.string().uuid('ID deve ser um UUID válido'),
})

const listNFeQuerySchema = z.object({
  status: z.string().optional(),
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD').optional(),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD').optional(),
  destCpfCnpj: z.string().optional(),
  serie: z.coerce.number().int().min(1).optional(),
  numero: z.coerce.number().int().min(1).optional(),
  chaveAcesso: z.string().regex(/^\d{44}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

// === Plugin de rotas ===

export async function emissorDfeRoutes(app: FastifyInstance) {
  // Registrar rotas do CT-e (modelo 57)
  app.register(cteRoutes)

  // Registrar rotas do MDF-e (modelo 58)
  app.register(mdfeRoutes)

  // ==========================================================================
  // POST /nfe/emitir — Emitir NF-e
  // Requirements: 1.1
  // ==========================================================================
  app.post('/nfe/emitir', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = emissaoNFeInputSchema.parse(request.body)

      // Buscar dados da empresa emitente
      const empresa = await prisma.empresa.findUnique({
        where: { id: user.empresaId },
      })

      if (!empresa) {
        return reply.status(404).send({ message: 'Empresa não encontrada' })
      }

      // Montar dados de emissão para o serviço
      const dadosNFe = {
        serie: body.serie,
        nNF: await proximoNumeroNFe(user.empresaId, body.serie),
        naturezaOp: body.naturezaOp,
        tipoOperacao: body.tipoOperacao as 0 | 1,
        finalidade: body.finalidade as 1 | 2 | 3 | 4,
        dataEmissao: new Date(),
        dataSaida: body.tipoOperacao === 1 ? new Date() : undefined,
        ambiente: body.ambiente,
        emitente: {
          cnpj: (empresa as any).cnpj || '',
          razaoSocial: (empresa as any).razaoSocial || (empresa as any).nome || '',
          uf: (empresa as any).uf || '',
          ie: (empresa as any).ie || '',
          crt: (empresa as any).regimeTributario || 3,
          endereco: {
            logradouro: (empresa as any).logradouro || '',
            numero: (empresa as any).numero || '',
            bairro: (empresa as any).bairro || '',
            codigoMunicipio: (empresa as any).codigoMunicipio || '',
            municipio: (empresa as any).municipio || '',
            uf: (empresa as any).uf || '',
            cep: (empresa as any).cep || '',
          },
        },
        destinatario: {
          cpfCnpj: body.destCpfCnpj,
          razaoSocial: body.destRazao,
          ie: body.destIe,
          endereco: body.destEndereco
            ? {
                logradouro: body.destEndereco.logradouro,
                numero: body.destEndereco.numero,
                complemento: body.destEndereco.complemento,
                bairro: body.destEndereco.bairro,
                codigoMunicipio: body.destEndereco.codigoMunicipio,
                municipio: body.destEndereco.municipio,
                uf: body.destEndereco.uf,
                cep: body.destEndereco.cep,
              }
            : undefined,
        },
        itens: body.itens.map((item, index) => ({
          nItem: index + 1,
          produtoId: item.produtoId,
          codigoProd: item.codigoProd,
          descricao: item.descricao,
          ncm: item.ncm,
          cest: item.cest,
          cfop: item.cfop,
          unidade: item.unidade,
          quantidade: item.quantidade,
          valorUnitario: item.valorUnitario,
          valorTotal: item.quantidade * item.valorUnitario,
          valorDesconto: item.valorDesconto || 0,
        })),
        valorFrete: body.valorFrete,
        valorSeguro: body.valorSeguro,
        valorOutras: body.valorOutras,
        modalidadeFrete: body.modalidadeFrete,
        infAdicionais: body.infAdicionais,
      }

      const resultado = await nfeEmissaoService.emitir({
        empresaId: user.empresaId,
        dadosNFe: dadosNFe as unknown as DadosNFe,
      })

      const statusCode = resultado.sucesso ? 200 : 422
      return reply.status(statusCode).send(resultado)
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
  // POST /nfe/:id/cancelar — Cancelar NF-e
  // Requirements: 1.5, 1.6
  // ==========================================================================
  app.post('/nfe/:id/cancelar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)
      const body = z.object({
        justificativa: z
          .string()
          .min(15, 'Justificativa deve ter no mínimo 15 caracteres')
          .max(255, 'Justificativa deve ter no máximo 255 caracteres'),
      }).parse(request.body)

      // Buscar documento fiscal
      const documento = await prisma.documentoFiscal.findFirst({
        where: { id, empresaId: user.empresaId, tipo: 'NFE' },
        include: { eventos: true },
      })

      if (!documento) {
        return reply.status(404).send({ message: 'NF-e não encontrada' })
      }

      if (documento.status !== 'AUTORIZADO') {
        return reply.status(422).send({
          message: `Apenas NF-e com status AUTORIZADO pode ser cancelada. Status atual: ${documento.status}`,
        })
      }

      if (!documento.chaveAcesso || !documento.protocolo) {
        return reply.status(422).send({ message: 'NF-e sem chave de acesso ou protocolo de autorização' })
      }

      // Montar dados para evento
      const docEvento: DocumentoParaEvento & { protocolo: string } = {
        id: documento.id,
        chaveAcesso: documento.chaveAcesso,
        cnpjEmitente: documento.emitenteCnpj,
        ambiente: documento.ambiente,
        dataAutorizacao: documento.dataAutorizacao || documento.criadoEm,
        proximoSeqEvento: documento.eventos.length + 1,
        protocolo: documento.protocolo,
      }

      // Obter dependências (certificado e SEFAZ client)
      const deps = await obterDependenciasEventos(documento.emitenteCnpj, user.empresaId, documento.emitenteUf)

      const resultado = await cancelar(
        { documentoId: id, justificativa: body.justificativa },
        docEvento,
        deps,
      )

      // Se sucesso, atualizar status e registrar evento no banco
      if (resultado.sucesso) {
        await prisma.$transaction([
          prisma.documentoFiscal.update({
            where: { id },
            data: { status: 'CANCELADO' },
          }),
          prisma.eventoDocumentoFiscal.create({
            data: {
              documentoFiscalId: id,
              tipoEvento: '110111',
              sequencia: docEvento.proximoSeqEvento,
              dataEvento: resultado.dataEvento,
              protocolo: resultado.protocolo,
              justificativa: body.justificativa,
              status: 'REGISTRADO',
            },
          }),
        ])
      }

      return reply.status(resultado.sucesso ? 200 : 422).send(resultado)
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
  // POST /nfe/:id/carta-correcao — Emitir CC-e
  // Requirements: 1.7
  // ==========================================================================
  app.post('/nfe/:id/carta-correcao', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)
      const body = z.object({
        textoCorrecao: z
          .string()
          .min(15, 'Texto de correção deve ter no mínimo 15 caracteres')
          .max(1000, 'Texto de correção deve ter no máximo 1000 caracteres'),
      }).parse(request.body)

      // Buscar documento fiscal
      const documento = await prisma.documentoFiscal.findFirst({
        where: { id, empresaId: user.empresaId, tipo: 'NFE' },
        include: { eventos: true },
      })

      if (!documento) {
        return reply.status(404).send({ message: 'NF-e não encontrada' })
      }

      if (documento.status !== 'AUTORIZADO') {
        return reply.status(422).send({
          message: `CC-e só pode ser emitida para NF-e AUTORIZADA. Status atual: ${documento.status}`,
        })
      }

      if (!documento.chaveAcesso) {
        return reply.status(422).send({ message: 'NF-e sem chave de acesso' })
      }

      // Contar CC-e já emitidas (filtrar por tipo 110110)
      const cceExistentes = documento.eventos.filter(e => e.tipoEvento === '110110')
      const proximaSequencia = cceExistentes.length + 1

      // Montar dados para evento
      const docEvento: DocumentoParaEvento = {
        id: documento.id,
        chaveAcesso: documento.chaveAcesso,
        cnpjEmitente: documento.emitenteCnpj,
        ambiente: documento.ambiente,
        dataAutorizacao: documento.dataAutorizacao || documento.criadoEm,
        proximoSeqEvento: proximaSequencia,
      }

      // Obter dependências
      const deps = await obterDependenciasEventos(documento.emitenteCnpj, user.empresaId, documento.emitenteUf)

      const resultado = await cartaCorrecao(
        { documentoId: id, textoCorrecao: body.textoCorrecao },
        docEvento,
        deps,
      )

      // Se sucesso, registrar evento no banco
      if (resultado.sucesso) {
        await prisma.eventoDocumentoFiscal.create({
          data: {
            documentoFiscalId: id,
            tipoEvento: '110110',
            sequencia: proximaSequencia,
            dataEvento: resultado.dataEvento,
            protocolo: resultado.protocolo,
            textoCorrecao: body.textoCorrecao,
            status: 'REGISTRADO',
          },
        })
      }

      return reply.status(resultado.sucesso ? 200 : 422).send(resultado)
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
  // POST /nfe/inutilizar — Inutilizar faixa de numeração
  // Requirements: 1.8
  // ==========================================================================
  app.post('/nfe/inutilizar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = inutilizacaoInputSchema.parse(request.body)

      // Buscar dados da empresa para inutilização
      const empresa = await prisma.empresa.findUnique({
        where: { id: user.empresaId },
      })

      if (!empresa) {
        return reply.status(404).send({ message: 'Empresa não encontrada' })
      }

      const cnpjEmitente = (empresa as any).cnpj || ''
      const ufEmitente = (empresa as any).uf || ''

      const docInut: DocumentoParaInutilizacao = {
        cnpjEmitente,
        ambiente: body.ambiente,
        uf: ufEmitente,
      }

      // Obter dependências
      const deps = await obterDependenciasEventos(cnpjEmitente, user.empresaId, ufEmitente)

      const resultado = await inutilizar(
        {
          serie: body.serie,
          numeroInicial: body.numeroInicial,
          numeroFinal: body.numeroFinal,
          justificativa: body.justificativa,
          modelo: body.modelo,
        },
        docInut,
        deps,
      )

      // Se sucesso, registrar inutilização no banco
      if (resultado.sucesso) {
        // Criar registros de documento fiscal com status INUTILIZADO para a faixa
        for (let num = body.numeroInicial; num <= body.numeroFinal; num++) {
          await prisma.documentoFiscal.create({
            data: {
              empresaId: user.empresaId,
              tipo: body.modelo === 55 ? 'NFE' : 'NFCE',
              modelo: body.modelo,
              serie: body.serie,
              numero: num,
              status: 'INUTILIZADO',
              dataEmissao: new Date(),
              tipoOperacao: 1,
              emitenteCnpj: cnpjEmitente,
              emitenteRazao: (empresa as any).razaoSocial || (empresa as any).nome || '',
              emitenteUf: ufEmitente,
              ambiente: body.ambiente,
            },
          })
        }
      }

      return reply.status(resultado.sucesso ? 200 : 422).send(resultado)
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
  // GET /nfe/:id/danfe — Gerar/baixar DANFE em PDF
  // Requirements: 1.1, 1.8, 1.10
  // ==========================================================================
  app.get('/nfe/:id/danfe', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)

      const pdfBuffer = await danfePdfService.gerarDanfe(id, user.empresaId)

      reply.header('Content-Type', 'application/pdf')
      reply.header('Content-Disposition', `inline; filename="DANFE-${id}.pdf"`)
      return reply.send(pdfBuffer)
    } catch (err: any) {
      if (err instanceof ErroFiscal) {
        // 404: documento não encontrado (CAMPOS_OBRIGATORIOS_AUSENTES usado pelo service para not found)
        if (err.codigo === CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES) {
          return reply.status(404).send({ message: 'NF-e não encontrada', codigo: err.codigo })
        }
        // 422: status != AUTORIZADO (DOCUMENTO_JA_AUTORIZADO usado pelo service para status inválido)
        if (err.codigo === CodigoErroFiscal.DOCUMENTO_JA_AUTORIZADO) {
          return reply.status(422).send(err.toJSON())
        }
        // Demais ErroFiscal → 422
        return reply.status(422).send(err.toJSON())
      }
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'ID inválido', erros: err.errors })
      }
      // Falha inesperada (ex: pdfkit) → 500
      return reply.status(500).send({ message: err.message || 'Erro interno ao gerar DANFE' })
    }
  })

  // ==========================================================================
  // GET /nfe — Listar NF-e com filtros e paginação
  // Requirements: 1.1
  // ==========================================================================
  app.get('/nfe', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const filtros = listNFeQuerySchema.parse(request.query)

      const where: any = {
        empresaId: user.empresaId,
        tipo: 'NFE',
      }

      if (filtros.status) {
        where.status = filtros.status.toUpperCase()
      }

      if (filtros.dataInicio || filtros.dataFim) {
        where.dataEmissao = {}
        if (filtros.dataInicio) {
          where.dataEmissao.gte = new Date(filtros.dataInicio)
        }
        if (filtros.dataFim) {
          where.dataEmissao.lte = new Date(`${filtros.dataFim}T23:59:59.999Z`)
        }
      }

      if (filtros.destCpfCnpj) {
        where.destCpfCnpj = filtros.destCpfCnpj
      }

      if (filtros.serie) {
        where.serie = filtros.serie
      }

      if (filtros.numero) {
        where.numero = filtros.numero
      }

      if (filtros.chaveAcesso) {
        where.chaveAcesso = filtros.chaveAcesso
      }

      const skip = (filtros.page - 1) * filtros.limit

      const [dados, total] = await Promise.all([
        prisma.documentoFiscal.findMany({
          where,
          orderBy: { criadoEm: 'desc' },
          skip,
          take: filtros.limit,
          select: {
            id: true,
            serie: true,
            numero: true,
            chaveAcesso: true,
            status: true,
            naturezaOp: true,
            dataEmissao: true,
            destCpfCnpj: true,
            destRazao: true,
            valorTotal: true,
            protocolo: true,
            dataAutorizacao: true,
            contingencia: true,
            ambiente: true,
            criadoEm: true,
          },
        }),
        prisma.documentoFiscal.count({ where }),
      ])

      return {
        dados,
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
  // POST /nfce/emitir — Emitir NFC-e (modelo 65)
  // Requirements: 5.8
  // ==========================================================================
  app.post('/nfce/emitir', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = emissaoNFCeInputSchema.parse(request.body)

      // Buscar dados da empresa emitente
      const empresa = await prisma.empresa.findUnique({
        where: { id: user.empresaId },
      })

      if (!empresa) {
        return reply.status(404).send({ message: 'Empresa não encontrada' })
      }

      // Montar dados de emissão para o serviço NFC-e
      const ufEmitente = (empresa as any).uf || ''

      const dadosNFCe = {
        modelo: 65,
        serie: body.serie,
        nNF: await proximoNumeroNFCe(user.empresaId, body.serie),
        cUF: obterCodigoUF(ufEmitente),
        cNF: String(Math.floor(Math.random() * 99999999)).padStart(8, '0'),
        tpEmis: 1,
        cMunFG: (empresa as any).codigoMunicipio || '',
        naturezaOp: 'VENDA',
        tipoOperacao: 1 as const,
        finalidade: 1 as const,
        dataEmissao: new Date(),
        ambiente: body.ambiente,
        emitente: {
          cnpj: (empresa as any).cnpj || '',
          razaoSocial: (empresa as any).razaoSocial || (empresa as any).nome || '',
          uf: ufEmitente,
          ie: (empresa as any).ie || '',
          crt: (empresa as any).regimeTributario || 3,
          endereco: {
            logradouro: (empresa as any).logradouro || '',
            numero: (empresa as any).numero || '',
            bairro: (empresa as any).bairro || '',
            codigoMunicipio: (empresa as any).codigoMunicipio || '',
            municipio: (empresa as any).municipio || '',
            uf: ufEmitente,
            cep: (empresa as any).cep || '',
          },
        },
        destinatario: body.destCpf
          ? {
              cpfCnpj: body.destCpf,
              razaoSocial: body.destNome || '',
            }
          : undefined,
        itens: body.itens.map((item, index) => ({
          nItem: index + 1,
          produtoId: item.produtoId,
          codigoProd: item.codigoProd,
          descricao: item.descricao,
          ncm: item.ncm,
          cest: item.cest,
          cfop: item.cfop,
          unidade: item.unidade,
          quantidade: item.quantidade,
          valorUnitario: item.valorUnitario,
          valorTotal: item.quantidade * item.valorUnitario,
          valorDesconto: item.valorDesconto || 0,
        })),
        pagamento: {
          forma: body.formaPagamento,
          valor: body.valorPago,
          troco: body.valorTroco,
        },
      }

      const resultado = await nfceEmissaoService.emitir({
        empresaId: user.empresaId,
        dadosNFCe: dadosNFCe as any,
      })

      const statusCode = resultado.sucesso ? 200 : 422
      return reply.status(statusCode).send(resultado)
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
}

// === Helpers ===

/**
 * Obtém o próximo número de NF-e para uma série.
 */
async function proximoNumeroNFe(empresaId: string, serie: number): Promise<number> {
  const ultimo = await prisma.documentoFiscal.findFirst({
    where: { empresaId, tipo: 'NFE', serie },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  })

  return (ultimo?.numero || 0) + 1
}

/**
 * Obtém o próximo número de NFC-e para uma série.
 */
async function proximoNumeroNFCe(empresaId: string, serie: number): Promise<number> {
  const ultimo = await prisma.documentoFiscal.findFirst({
    where: { empresaId, tipo: 'NFCE', serie },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  })

  return (ultimo?.numero || 0) + 1
}

/**
 * Obtém código UF IBGE a partir da sigla.
 */
function obterCodigoUF(uf: string): number {
  const codes: Record<string, number> = {
    RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17,
    MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27,
    SE: 28, BA: 29, MG: 31, ES: 32, RJ: 33, SP: 35,
    PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53,
  }
  return codes[uf.toUpperCase()] || 35 // Default SP
}

/**
 * Obtém as dependências necessárias para eventos (certificado + SEFAZ client).
 */
async function obterDependenciasEventos(
  cnpjEmitente: string,
  empresaId: string,
  ufEmitente: string,
): Promise<DependenciasEventos> {
  const certificado = await certificadoService.obterParaAssinatura(cnpjEmitente, empresaId)

  const ambiente = Number(process.env.SEFAZ_AMBIENTE) || 2

  const sefazConfig: SefazConfig = {
    ambiente: ambiente === 1 ? AmbienteSefaz.PRODUCAO : AmbienteSefaz.HOMOLOGACAO,
    uf: ufEmitente,
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

  return {
    sefazClient,
    certificado: {
      pfxBuffer: certificado.pfxBuffer,
      senha: certificado.senha,
    },
  }
}
