/**
 * Rotas do CT-e (Conhecimento de Transporte Eletrônico) — Módulo Completo
 *
 * Endpoints:
 * - GET  /cte           — Listar CT-e com filtros e paginação
 * - GET  /cte/:id       — Detalhe de um CT-e
 * - POST /cte/emitir    — Emitir CT-e modelo 57
 * - POST /cte/:id/cancelar       — Cancelar CT-e autorizado
 * - POST /cte/:id/carta-correcao — Emitir CC-e para CT-e
 * - POST /cte/inutilizar         — Inutilizar faixa de numeração
 * - GET  /cte/:id/dacte          — Gerar DACTE em PDF
 * - GET  /cte/:id/xml            — Baixar XML autorizado
 * - POST /cte/:id/duplicar       — Duplicar CT-e existente
 *
 * Requirements: 6.8
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../../lib/prisma'
import { cteEmissaoService } from './cte-emissao.service'
import { gerarDactePdf } from './cte-dacte-pdf.service'
import { parseNFeXml, autoCadastrarParticipante } from './cte-importar-nfe.service'
import { extrairTextoDanfePdf, parseDanfeTexto } from './cte-danfe-parser.service'
import { ErroFiscal, CodigoErroFiscal } from '../../erros'
import type { DadosCTe } from './cte-xml-builder'

// === Schemas Zod ===

const idParamsSchema = z.object({
  id: z.string().uuid('ID deve ser um UUID válido'),
})

const listCteQuerySchema = z.object({
  status: z.string().optional(),
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  tomadorCpfCnpj: z.string().optional(),
  serie: z.coerce.number().int().min(0).optional(),
  numero: z.coerce.number().int().min(1).optional(),
  chaveAcesso: z.string().regex(/^\d{44}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

const enderecoSchema = z.object({
  logradouro: z.string().min(1).max(60),
  numero: z.string().min(1).max(10),
  complemento: z.string().max(60).optional(),
  bairro: z.string().min(1).max(60),
  codigoMunicipio: z.string().regex(/^\d{7}$/),
  municipio: z.string().min(1).max(60),
  uf: z.string().length(2).regex(/^[A-Z]{2}$/),
  cep: z.string().regex(/^\d{8}$/),
  codigoPais: z.string().optional(),
  pais: z.string().optional(),
})

const participanteSchema = z.object({
  cnpj: z.string().regex(/^\d{14}$/).optional(),
  cpf: z.string().regex(/^\d{11}$/).optional(),
  ie: z.string().max(20).optional(),
  razaoSocial: z.string().min(1).max(200),
  nomeFantasia: z.string().max(200).optional(),
  endereco: enderecoSchema,
  email: z.string().email().max(200).optional(),
  telefone: z.string().max(20).optional(),
})

const componenteValorSchema = z.object({
  nome: z.string().min(1).max(60),
  valor: z.number().min(0),
})

const infQuantidadeSchema = z.object({
  cUnid: z.string().regex(/^\d{2}$/),
  tpMed: z.string().min(1).max(20),
  qCarga: z.number().positive(),
})

const infNFeVinculadaSchema = z.object({
  chave: z.string().regex(/^\d{44}$/),
})

const veiculoSchema = z.object({
  placa: z.string().min(7).max(7),
  uf: z.string().length(2).regex(/^[A-Z]{2}$/),
  RENAVAM: z.string().max(11).optional(),
  tpProp: z.number().int().min(0).max(2).optional(),
  cpfCnpjProp: z.string().max(14).optional(),
  RNTRCProp: z.string().max(8).optional(),
  tpRod: z.string().max(2).optional(),
  tpCar: z.string().max(2).optional(),
})

const seguroSchema = z.object({
  respSeg: z.number().int().min(0).max(5),
  xSeg: z.string().max(30).optional(),
  nApol: z.string().max(20).optional(),
  nAver: z.string().max(40).optional(),
  vCarga: z.number().min(0).optional(),
})

const valePedagioSchema = z.object({
  cnpjForn: z.string().regex(/^\d{14}$/),
  cnpjPg: z.string().regex(/^\d{14}$/).optional(),
  cpfPg: z.string().regex(/^\d{11}$/).optional(),
  nCompra: z.string().max(20),
  vValePed: z.number().min(0),
})

const veiculoNovoSchema = z.object({
  chassi: z.string().length(17, 'Chassi deve ter 17 caracteres'),
  cCor: z.string().max(4),
  xCor: z.string().max(40),
  cMod: z.string().max(6),
  vUnit: z.number().min(0),
  vFrete: z.number().min(0),
})

const emissaoCTeInputSchema = z.object({
  serie: z.number().int().min(0).max(999),
  cfop: z.string().regex(/^\d{4}$/),
  naturezaOp: z.string().min(1).max(100),
  tpServ: z.number().int().min(0).max(4),
  tpCTe: z.number().int().min(0).max(3).default(0),
  modal: z.string().regex(/^0[1-6]$/),
  tpEmis: z.number().int().min(1).max(9).default(1),

  // Municípios início/fim
  cMunIni: z.string().regex(/^\d{7}$/),
  xMunIni: z.string().min(1).max(60),
  ufIni: z.string().length(2).regex(/^[A-Z]{2}$/),
  cMunFim: z.string().regex(/^\d{7}$/),
  xMunFim: z.string().min(1).max(60),
  ufFim: z.string().length(2).regex(/^[A-Z]{2}$/),

  // Tomador
  tpTom: z.number().int().min(0).max(4),
  indIEToma: z.number().int().refine(v => [1, 2, 9].includes(v)),
  tomadorOutros: participanteSchema.optional(),

  // Participantes
  remetente: participanteSchema,
  destinatario: participanteSchema,
  expedidor: participanteSchema.optional(),
  recebedor: participanteSchema.optional(),

  // Valor da prestação
  vPrest: z.object({
    vTPrest: z.number().min(0),
    vRec: z.number().min(0),
    componentes: z.array(componenteValorSchema).optional(),
  }),

  // Impostos
  impostos: z.object({
    icms: z.object({
      cst: z.string().regex(/^(00|20|40|41|51|60|90|SN)$/),
      baseCalculo: z.number().min(0).optional(),
      aliquota: z.number().min(0).max(100).optional(),
      valor: z.number().min(0).optional(),
      percentualReducao: z.number().min(0).max(100).optional(),
      vCred: z.number().min(0).optional(),
      pDif: z.number().min(0).max(100).optional(),
      vICMSDif: z.number().min(0).optional(),
    }),
    vTotTrib: z.number().min(0).optional(),
    infAdFisco: z.string().max(2000).optional(),
  }),

  // CT-e Normal — Carga e Documentos
  infCTeNorm: z.object({
    infCarga: z.object({
      vCarga: z.number().min(0),
      proPred: z.string().min(1).max(60),
      xOutCat: z.string().max(30).optional(),
      infQ: z.array(infQuantidadeSchema).min(1),
    }),
    infDoc: z.object({
      infNFe: z.array(infNFeVinculadaSchema).optional(),
      infOutros: z.array(z.object({
        tpDoc: z.string().max(2),
        descOutros: z.string().max(100).optional(),
        nDoc: z.string().max(20).optional(),
        dEmi: z.string().optional(),
      })).optional(),
    }),
    infModal: z.object({
      RNTRC: z.string().min(1).max(8),
      veiculos: z.array(veiculoSchema).optional(),
    }).optional(),
    seguro: z.array(seguroSchema).optional(),
    valePedagio: z.array(valePedagioSchema).optional(),
    veicNovos: z.array(veiculoNovoSchema).optional(),
  }),

  // Complemento (opcional)
  complemento: z.object({
    xCaracAd: z.string().max(15).optional(),
    xCaracSer: z.string().max(30).optional(),
    xObs: z.string().max(2000).optional(),
  }).optional(),

  // Informações adicionais
  infAdFisco: z.string().max(2000).optional(),
  infCpl: z.string().max(5000).optional(),

  // Ambiente e contingência
  ambiente: z.number().int().min(1).max(2).default(2),
  forcarContingencia: z.boolean().default(false),
})

export type EmissaoCTeInput = z.infer<typeof emissaoCTeInputSchema>

// === Helpers ===

async function proximoNumeroCTe(empresaId: string, serie: number): Promise<number> {
  const ultimo = await prisma.documentoFiscal.findFirst({
    where: { empresaId, tipo: 'CTE', serie },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  })
  return (ultimo?.numero || 0) + 1
}

function gerarCodigoNumerico(): string {
  return String(Math.floor(Math.random() * 99999999)).padStart(8, '0')
}

function obterCodigoUF(uf: string): number {
  const UF_CODES: Record<string, number> = {
    RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17,
    MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27,
    SE: 28, BA: 29, MG: 31, ES: 32, RJ: 33, SP: 35,
    PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53,
  }
  return UF_CODES[uf.toUpperCase()] || 35
}

// === Plugin de rotas ===

export async function cteRoutes(app: FastifyInstance) {

  // ==========================================================================
  // GET /cte/defaults — Retorna configurações padrão da empresa para pré-preencher
  // ==========================================================================
  app.get('/cte/defaults', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    const empresa = await prisma.empresa.findUnique({
      where: { id: user.empresaId },
      select: {
        rntrc: true,
        serieCTe: true,
        ambienteNFe: true,
        uf: true,
        cidade: true,
        cep: true,
        inscEstadual: true,
        razaoSocial: true,
        nomeFantasia: true,
        cnpj: true,
        logradouro: true,
        numero: true,
        complemento: true,
        bairro: true,
      },
    })

    if (!empresa) {
      return reply.status(404).send({ message: 'Empresa não encontrada' })
    }

    // Buscar parâmetros CT-e da tabela Parametro
    const parametros = await prisma.parametro.findMany({
      where: { empresaId: user.empresaId, chave: { startsWith: 'cte.' } },
    })
    const params: Record<string, string> = {}
    for (const p of parametros) {
      params[p.chave] = p.valor
    }

    return {
      rntrc: empresa.rntrc || '',
      serie: empresa.serieCTe || 1,
      ambiente: empresa.ambienteNFe || 2,
      ufEmitente: empresa.uf || '',
      // Padrões configuráveis (tabela Parametro, prefixo cte.)
      naturezaOp: params['cte.naturezaOp'] || 'PRESTACAO DE SERVICO DE TRANSPORTE',
      modal: params['cte.modal'] || '01',
      cstIcms: params['cte.cstIcms'] || '00',
      aliqIcms: params['cte.aliqIcms'] ? Number(params['cte.aliqIcms']) : 12,
      seguradora: params['cte.seguradora'] || '',
      apolice: params['cte.apolice'] || '',
    }
  })

  // ==========================================================================
  // PUT /cte/defaults — Salvar configurações padrão CT-e da empresa
  // ==========================================================================
  app.put('/cte/defaults', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    const body = z.object({
      naturezaOp: z.string().max(100).optional(),
      modal: z.string().max(2).optional(),
      cstIcms: z.string().max(3).optional(),
      aliqIcms: z.number().min(0).max(100).optional(),
      seguradora: z.string().max(30).optional(),
      apolice: z.string().max(20).optional(),
    }).parse(request.body)

    // Salvar cada campo como parâmetro
    const campos = Object.entries(body).filter(([_, v]) => v != null)
    for (const [chave, valor] of campos) {
      await prisma.parametro.upsert({
        where: { empresaId_chave: { empresaId: user.empresaId, chave: `cte.${chave}` } },
        create: { empresaId: user.empresaId, chave: `cte.${chave}`, valor: String(valor) },
        update: { valor: String(valor) },
      })
    }

    return { sucesso: true }
  })

  // ==========================================================================
  // GET /cte/buscar-participante/:cpfCnpj — Busca cliente/fornecedor pelo CPF/CNPJ
  // ==========================================================================
  app.get('/cte/buscar-participante/:cpfCnpj', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    const { cpfCnpj } = z.object({ cpfCnpj: z.string().min(11).max(14) }).parse(request.params)

    // Buscar no cadastro de Clientes
    const cliente = await prisma.cliente.findFirst({
      where: { empresaId: user.empresaId, cpfCnpj: { contains: cpfCnpj } },
    })

    if (cliente) {
      return {
        encontrado: true,
        tipo: 'cliente',
        cnpj: (cliente as any).cpfCnpj || '',
        razaoSocial: (cliente as any).razaoSocial || (cliente as any).nome || '',
        nomeFantasia: (cliente as any).nomeFantasia || '',
        ie: (cliente as any).inscEstadual || '',
        logradouro: (cliente as any).logradouro || '',
        numero: (cliente as any).numero || '',
        complemento: (cliente as any).complemento || '',
        bairro: (cliente as any).bairro || '',
        codigoMunicipio: (cliente as any).codigoMunicipio || '',
        municipio: (cliente as any).cidade || '',
        uf: (cliente as any).uf || '',
        cep: (cliente as any).cep || '',
        email: (cliente as any).email || '',
        telefone: (cliente as any).telefone || '',
      }
    }

    // Buscar no cadastro de Fornecedores
    const fornecedor = await prisma.fornecedor.findFirst({
      where: { empresaId: user.empresaId, cnpj: { contains: cpfCnpj } },
    })

    if (fornecedor) {
      return {
        encontrado: true,
        tipo: 'fornecedor',
        cnpj: (fornecedor as any).cnpj || '',
        razaoSocial: (fornecedor as any).razaoSocial || (fornecedor as any).nome || '',
        nomeFantasia: (fornecedor as any).nomeFantasia || '',
        ie: (fornecedor as any).inscEstadual || '',
        logradouro: (fornecedor as any).logradouro || '',
        numero: (fornecedor as any).numero || '',
        complemento: (fornecedor as any).complemento || '',
        bairro: (fornecedor as any).bairro || '',
        codigoMunicipio: (fornecedor as any).codigoMunicipio || '',
        municipio: (fornecedor as any).cidade || '',
        uf: (fornecedor as any).uf || '',
        cep: (fornecedor as any).cep || '',
        email: (fornecedor as any).email || '',
        telefone: (fornecedor as any).telefone || '',
      }
    }

    return { encontrado: false }
  })

  // ==========================================================================
  // POST /cte/importar-nfe — Importar NF-e (XML) para gerar CT-e automático
  // ==========================================================================
  app.post('/cte/importar-nfe', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = z.object({
        xml: z.string().min(100, 'XML inválido ou vazio'),
      }).parse(request.body)

      // Parsear XML da NF-e
      const dados = parseNFeXml(body.xml)

      if (!dados.chaveAcesso) {
        return reply.status(422).send({ message: 'Não foi possível extrair a chave de acesso do XML' })
      }

      // Auto-cadastrar remetente e destinatário
      const remetenteId = await autoCadastrarParticipante(user.empresaId, dados.remetente)
      const destinatarioId = await autoCadastrarParticipante(user.empresaId, dados.destinatario)

      // Buscar defaults da empresa
      const empresa = await prisma.empresa.findUnique({
        where: { id: user.empresaId },
        select: { rntrc: true, serieCTe: true, uf: true },
      })

      const parametros = await prisma.parametro.findMany({
        where: { empresaId: user.empresaId, chave: { startsWith: 'cte.' } },
      })
      const params: Record<string, string> = {}
      for (const p of parametros) params[p.chave] = p.valor

      return {
        sucesso: true,
        dadosExtraidos: dados,
        cadastros: {
          remetenteId,
          destinatarioId,
          remetenteCadastrado: !!remetenteId,
          destinatarioCadastrado: !!destinatarioId,
        },
        ctePrePreenchido: {
          serie: empresa?.serieCTe || 1,
          cfop: dados.cfopSugerido,
          naturezaOp: params['cte.naturezaOp'] || 'PRESTACAO DE SERVICO DE TRANSPORTE',
          modal: params['cte.modal'] || '01',
          tpServ: 0,
          tpTom: 0, // Remetente como tomador (padrão transporte)
          cMunIni: dados.origemCMun,
          xMunIni: dados.origemMun,
          ufIni: dados.origemUf,
          cMunFim: dados.destinoCMun,
          xMunFim: dados.destinoMun,
          ufFim: dados.destinoUf,
          remetente: dados.remetente,
          destinatario: dados.destinatario,
          infCarga: {
            vCarga: dados.valorCarga,
            proPred: dados.produtos,
            pesoBruto: dados.pesoBruto,
          },
          nfesVinculadas: [{ chave: dados.chaveAcesso }],
          veicNovos: dados.veiculosNovos,
          rntrc: empresa?.rntrc || '',
          cstIcms: params['cte.cstIcms'] || '00',
          aliqIcms: params['cte.aliqIcms'] ? Number(params['cte.aliqIcms']) : 12,
        },
      }
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro ao processar NF-e' })
    }
  })

  // ==========================================================================
  // POST /cte/importar-danfe-pdf — Importar DANFE (PDF) para gerar CT-e
  // ==========================================================================
  app.post('/cte/importar-danfe-pdf', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      // Receber o PDF como base64 no body (simples, sem multipart)
      const body = z.object({
        pdfBase64: z.string().min(100, 'PDF inválido ou vazio'),
      }).parse(request.body)

      // Converter base64 para Buffer
      const base64Data = body.pdfBase64.replace(/^data:application\/pdf;base64,/, '')
      const pdfBuffer = Buffer.from(base64Data, 'base64')

      // Extrair texto do PDF
      const texto = await extrairTextoDanfePdf(pdfBuffer)

      if (!texto || texto.trim().length < 50) {
        return reply.status(422).send({ message: 'Não foi possível extrair texto do PDF. O arquivo pode ser uma imagem (escaneado).' })
      }

      // Parsear dados do DANFE
      const dados = parseDanfeTexto(texto)

      if (!dados.chaveAcesso) {
        return reply.status(422).send({
          message: 'Não foi possível encontrar a chave de acesso de 44 dígitos no PDF. Verifique se é um DANFE válido.',
          textoExtraido: texto.substring(0, 500),
        })
      }

      // Montar resposta similar à importação de XML
      const origemUf = dados.emitente.uf
      const destinoUf = dados.destinatario.uf
      const cfopSugerido = origemUf && destinoUf ? (origemUf === destinoUf ? '5353' : '6353') : '5353'

      // Buscar defaults
      const empresa = await prisma.empresa.findUnique({
        where: { id: user.empresaId },
        select: { rntrc: true, serieCTe: true },
      })
      const parametros = await prisma.parametro.findMany({
        where: { empresaId: user.empresaId, chave: { startsWith: 'cte.' } },
      })
      const params: Record<string, string> = {}
      for (const p of parametros) params[p.chave] = p.valor

      return {
        sucesso: true,
        origem: 'PDF',
        cadastros: {
          remetenteCadastrado: false,
          destinatarioCadastrado: false,
        },
        dadosExtraidos: {
          chaveAcesso: dados.chaveAcesso,
          numero: dados.numero,
          serie: dados.serie,
          remetente: dados.emitente,
          destinatario: dados.destinatario,
          valorCarga: dados.valorTotal,
          pesoBruto: dados.pesoBruto,
          produtos: dados.produtos || 'MERCADORIAS',
          origemMun: dados.emitente.municipio,
          origemUf,
          destinoMun: dados.destinatario.municipio,
          destinoUf,
          veiculosNovos: [],
        },
        ctePrePreenchido: {
          serie: empresa?.serieCTe || 1,
          cfop: cfopSugerido,
          naturezaOp: params['cte.naturezaOp'] || 'PRESTACAO DE SERVICO DE TRANSPORTE',
          modal: params['cte.modal'] || '01',
          tpServ: 0,
          tpTom: 0,
          cMunIni: '',
          xMunIni: dados.emitente.municipio,
          ufIni: origemUf,
          cMunFim: '',
          xMunFim: dados.destinatario.municipio,
          ufFim: destinoUf,
          remetente: {
            cnpj: dados.emitente.cnpj,
            cpf: '',
            razaoSocial: dados.emitente.razaoSocial,
            nomeFantasia: '',
            ie: dados.emitente.ie,
            logradouro: '', numero: '', complemento: '', bairro: '',
            codigoMunicipio: '', municipio: dados.emitente.municipio,
            uf: origemUf, cep: '', email: '', telefone: '',
          },
          destinatario: {
            cnpj: dados.destinatario.cnpj,
            cpf: dados.destinatario.cpf,
            razaoSocial: dados.destinatario.razaoSocial,
            nomeFantasia: '',
            ie: dados.destinatario.ie,
            logradouro: '', numero: '', complemento: '', bairro: '',
            codigoMunicipio: '', municipio: dados.destinatario.municipio,
            uf: destinoUf, cep: '', email: '', telefone: '',
          },
          infCarga: {
            vCarga: dados.valorTotal,
            proPred: dados.produtos || 'MERCADORIAS',
            pesoBruto: dados.pesoBruto,
          },
          nfesVinculadas: [{ chave: dados.chaveAcesso }],
          veicNovos: [],
          rntrc: empresa?.rntrc || '',
          cstIcms: params['cte.cstIcms'] || '00',
          aliqIcms: params['cte.aliqIcms'] ? Number(params['cte.aliqIcms']) : 12,
        },
      }
    } catch (err: any) {
      return reply.status(500).send({ message: err.message || 'Erro ao processar PDF' })
    }
  })

  // ==========================================================================
  // GET /cte — Listar CT-e com filtros e paginação
  // ==========================================================================
  app.get('/cte', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const filtros = listCteQuerySchema.parse(request.query)

      const where: any = { empresaId: user.empresaId, tipo: 'CTE' }

      if (filtros.status) where.status = filtros.status.toUpperCase()
      if (filtros.serie != null) where.serie = filtros.serie
      if (filtros.numero) where.numero = filtros.numero
      if (filtros.chaveAcesso) where.chaveAcesso = filtros.chaveAcesso
      if (filtros.tomadorCpfCnpj) where.destCpfCnpj = filtros.tomadorCpfCnpj

      if (filtros.dataInicio || filtros.dataFim) {
        where.dataEmissao = {}
        if (filtros.dataInicio) where.dataEmissao.gte = new Date(filtros.dataInicio)
        if (filtros.dataFim) where.dataEmissao.lte = new Date(`${filtros.dataFim}T23:59:59.999Z`)
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
            valorFrete: true,
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
        data: dados.map(d => ({
          ...d,
          tomadorRazao: d.destRazao,
          valorTotal: Number(d.valorTotal),
        })),
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
  // GET /cte/:id — Detalhe de um CT-e
  // ==========================================================================
  app.get('/cte/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)

      const doc = await prisma.documentoFiscal.findFirst({
        where: { id, empresaId: user.empresaId, tipo: 'CTE' },
        include: {
          eventos: { orderBy: { dataEvento: 'desc' } },
        },
      })

      if (!doc) {
        return reply.status(404).send({ message: 'CT-e não encontrado' })
      }

      return {
        ...doc,
        valorTotal: Number(doc.valorTotal),
        valorFrete: Number(doc.valorFrete),
        valorIcms: Number(doc.valorIcms),
        xmlEnviado: undefined, // Não retornar XML pesado na listagem
        xmlAutorizado: undefined,
        xmlRetorno: undefined,
      }
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'ID inválido', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /cte/emitir — Emitir CT-e modelo 57
  // ==========================================================================
  app.post('/cte/emitir', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = emissaoCTeInputSchema.parse(request.body)

      const empresa = await prisma.empresa.findUnique({
        where: { id: user.empresaId },
      })

      if (!empresa) {
        return reply.status(404).send({ message: 'Empresa não encontrada' })
      }

      const ufEmitente = empresa.uf || ''
      const nCT = await proximoNumeroCTe(user.empresaId, body.serie)

      const dadosCTe: DadosCTe = {
        cUF: obterCodigoUF(ufEmitente),
        cCT: gerarCodigoNumerico(),
        nCT,
        serie: body.serie,
        modelo: 57,
        tpEmis: body.tpEmis,
        ambiente: body.ambiente,
        cfop: body.cfop,
        naturezaOp: body.naturezaOp,
        tpServ: body.tpServ,
        dataEmissao: new Date(),
        tpCTe: body.tpCTe,
        modal: body.modal,
        cMunIni: body.cMunIni,
        xMunIni: body.xMunIni,
        ufIni: body.ufIni,
        cMunFim: body.cMunFim,
        xMunFim: body.xMunFim,
        ufFim: body.ufFim,
        tpTom: body.tpTom,
        indIEToma: body.indIEToma,
        emitente: {
          cnpj: empresa.cnpj || '',
          ie: empresa.inscEstadual || '',
          razaoSocial: empresa.razaoSocial || '',
          nomeFantasia: empresa.nomeFantasia || undefined,
          endereco: {
            logradouro: empresa.logradouro || '',
            numero: empresa.numero || '',
            complemento: empresa.complemento || undefined,
            bairro: empresa.bairro || '',
            codigoMunicipio: empresa.cidade || '',
            municipio: empresa.cidade || '',
            uf: ufEmitente,
            cep: empresa.cep || '',
          },
        },

        remetente: body.remetente as any,
        destinatario: body.destinatario as any,
        expedidor: body.expedidor as any,
        recebedor: body.recebedor as any,
        vPrest: body.vPrest as any,
        impostos: body.impostos as any,
        infCTeNorm: {
          infCarga: body.infCTeNorm.infCarga,
          infDoc: {
            infNFe: body.infCTeNorm.infDoc.infNFe,
            infOutros: body.infCTeNorm.infDoc.infOutros?.map(o => ({
              ...o,
              dEmi: o.dEmi ? new Date(o.dEmi) : undefined,
            })),
          },
          infModal: body.infCTeNorm.infModal,
          veicNovos: body.infCTeNorm.veicNovos,
        },
        complemento: body.complemento,
        infAdFisco: body.infAdFisco,
        infCpl: body.infCpl,
        tomadorOutros: body.tomadorOutros,
      }

      const resultado = await cteEmissaoService.emitir({
        empresaId: user.empresaId,
        dadosCTe,
        forcarContingencia: body.forcarContingencia,
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
  // POST /cte/:id/cancelar — Cancelar CT-e autorizado
  // ==========================================================================
  app.post('/cte/:id/cancelar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)
      const body = z.object({
        justificativa: z.string().min(15).max(255),
      }).parse(request.body)

      // Validar pertence à empresa
      const doc = await prisma.documentoFiscal.findFirst({
        where: { id, empresaId: user.empresaId, tipo: 'CTE' },
      })
      if (!doc) {
        return reply.status(404).send({ message: 'CT-e não encontrado' })
      }

      const resultado = await cteEmissaoService.cancelar({
        documentoFiscalId: id,
        justificativa: body.justificativa,
      })

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
  // POST /cte/:id/carta-correcao — Emitir CC-e para CT-e
  // ==========================================================================
  app.post('/cte/:id/carta-correcao', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)
      const body = z.object({
        textoCorrecao: z.string().min(15).max(1000),
        grupoAlterado: z.string().max(50).optional(),
        campoAlterado: z.string().max(50).optional(),
      }).parse(request.body)

      const doc = await prisma.documentoFiscal.findFirst({
        where: { id, empresaId: user.empresaId, tipo: 'CTE' },
      })
      if (!doc) {
        return reply.status(404).send({ message: 'CT-e não encontrado' })
      }

      const resultado = await cteEmissaoService.cartaCorrecao({
        documentoFiscalId: id,
        textoCorrecao: body.textoCorrecao,
        grupoAlterado: body.grupoAlterado,
        campoAlterado: body.campoAlterado,
      })

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
  // POST /cte/inutilizar — Inutilizar faixa de numeração de CT-e
  // ==========================================================================
  app.post('/cte/inutilizar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = z.object({
        serie: z.number().int().min(0).max(999),
        numeroInicial: z.number().int().min(1),
        numeroFinal: z.number().int().min(1),
        justificativa: z.string().min(15).max(255),
        ambiente: z.number().int().min(1).max(2).default(2),
      }).parse(request.body)

      if (body.numeroFinal < body.numeroInicial) {
        return reply.status(400).send({
          message: 'Número final deve ser >= número inicial',
        })
      }

      if (body.numeroFinal - body.numeroInicial > 999) {
        return reply.status(400).send({
          message: 'Faixa máxima permitida: 1000 números por vez',
        })
      }

      const empresa = await prisma.empresa.findUnique({
        where: { id: user.empresaId },
      })
      if (!empresa) {
        return reply.status(404).send({ message: 'Empresa não encontrada' })
      }

      // Registrar inutilização no banco
      for (let num = body.numeroInicial; num <= body.numeroFinal; num++) {
        await prisma.documentoFiscal.create({
          data: {
            empresaId: user.empresaId,
            tipo: 'CTE',
            modelo: 57,
            serie: body.serie,
            numero: num,
            status: 'INUTILIZADO',
            dataEmissao: new Date(),
            tipoOperacao: 1,
            emitenteCnpj: empresa.cnpj || '',
            emitenteRazao: empresa.razaoSocial || '',
            emitenteUf: empresa.uf || '',
            ambiente: body.ambiente,
          },
        })
      }

      return reply.status(200).send({
        sucesso: true,
        serie: body.serie,
        numeroInicial: body.numeroInicial,
        numeroFinal: body.numeroFinal,
        quantidadeInutilizada: body.numeroFinal - body.numeroInicial + 1,
      })
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /cte/:id/dacte — Gerar DACTE em PDF
  // ==========================================================================
  app.get('/cte/:id/dacte', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)

      const doc = await prisma.documentoFiscal.findFirst({
        where: { id, empresaId: user.empresaId, tipo: 'CTE' },
        include: { empresa: true },
      })

      if (!doc) {
        return reply.status(404).send({ message: 'CT-e não encontrado' })
      }

      if (!['AUTORIZADO', 'CANCELADO'].includes(doc.status)) {
        return reply.status(422).send({
          message: `DACTE só disponível para CT-e AUTORIZADO ou CANCELADO. Status: ${doc.status}`,
        })
      }

      const pdfBuffer = await gerarDactePdf(doc, doc.empresa)

      reply.header('Content-Type', 'application/pdf')
      reply.header('Content-Disposition', `inline; filename="DACTE-${doc.numero}-${doc.serie}.pdf"`)
      return reply.send(pdfBuffer)
    } catch (err: any) {
      return reply.status(500).send({ message: err.message || 'Erro ao gerar DACTE' })
    }
  })

  // ==========================================================================
  // GET /cte/:id/xml — Baixar XML autorizado
  // ==========================================================================
  app.get('/cte/:id/xml', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)

      const doc = await prisma.documentoFiscal.findFirst({
        where: { id, empresaId: user.empresaId, tipo: 'CTE' },
        select: { xmlAutorizado: true, xmlEnviado: true, numero: true, serie: true, chaveAcesso: true },
      })

      if (!doc) {
        return reply.status(404).send({ message: 'CT-e não encontrado' })
      }

      const xml = doc.xmlAutorizado || doc.xmlEnviado
      if (!xml) {
        return reply.status(422).send({ message: 'XML não disponível para este CT-e' })
      }

      const nomeArquivo = doc.chaveAcesso
        ? `${doc.chaveAcesso}-cte.xml`
        : `CTe-${doc.serie}-${doc.numero}.xml`

      reply.header('Content-Type', 'application/xml')
      reply.header('Content-Disposition', `attachment; filename="${nomeArquivo}"`)
      return reply.send(xml)
    } catch (err: any) {
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /cte/:id/duplicar — Duplicar CT-e existente (facilita emissão)
  // ==========================================================================
  app.post('/cte/:id/duplicar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)

      const doc = await prisma.documentoFiscal.findFirst({
        where: { id, empresaId: user.empresaId, tipo: 'CTE' },
        select: {
          naturezaOp: true,
          destCpfCnpj: true,
          destRazao: true,
          destUf: true,
          valorTotal: true,
          valorFrete: true,
        },
      })

      if (!doc) {
        return reply.status(404).send({ message: 'CT-e não encontrado' })
      }

      // Retorna dados para preenchimento do formulário (frontend usa para pré-popular)
      return {
        naturezaOp: doc.naturezaOp,
        tomador: {
          cpfCnpj: doc.destCpfCnpj,
          razaoSocial: doc.destRazao,
          uf: doc.destUf,
        },
        valorTotal: Number(doc.valorTotal),
        valorFrete: Number(doc.valorFrete),
      }
    } catch (err: any) {
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

} // fim cteRoutes
