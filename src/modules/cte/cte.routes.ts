import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { gerarChaveAcesso } from '../nfe/nfe-chave'
import { buildCTeXml, type DadosCTeXml, type ModalCTe } from './cte-xml-builder'
import { enviarCTe, cancelarCTeSefaz } from './cte-sefaz'
import { assinarXML } from '../fiscal/emissor-dfe/xml/xml-signer'
import { certificadoService } from '../fiscal/certificado/certificado.service'

const idParamsSchema = z.object({ id: z.string().uuid() })

// ─── Schema de endereço (reutilizável) ───────────────────────────────────────
const enderecoSchema = z.object({
  logradouro: z.string().min(1).max(255),
  numero: z.string().min(1).max(60),
  complemento: z.string().max(60).optional(),
  bairro: z.string().min(1).max(60),
  cMun: z.string().length(7),       // código IBGE 7 dígitos
  xMun: z.string().min(1).max(60),
  uf: z.string().length(2),
  cep: z.string().min(8).max(8),    // 8 dígitos sem traço
  pais: z.string().optional(),
  xPais: z.string().optional(),
  fone: z.string().optional(),
})

// ─── Schema de participante ──────────────────────────────────────────────────
const participanteSchema = z.object({
  cnpj: z.string().optional(),
  cpf: z.string().optional(),
  ie: z.string().optional(),
  razaoSocial: z.string().min(1).max(60),
  endereco: enderecoSchema,
})

// ─── Schema de emissão ───────────────────────────────────────────────────────
const emitirBodySchema = z.object({
  // Campos que a empresa não tem no cadastro precisam vir do body
  // (caso o cadastro já tenha, a rota usa os dados da empresa)
  cfop: z.string().length(4).optional(),     // default: 5353 intra / 6353 inter

  // Município de envio (normalmente o município do emitente)
  cMunEnv: z.string().length(7).optional(),
  xMunEnv: z.string().max(60).optional(),
  ufEnv: z.string().length(2).optional(),

  // Origem e destino do transporte
  cMunIni: z.string().length(7),
  xMunIni: z.string().max(60),
  ufIni: z.string().length(2),
  cMunFim: z.string().length(7),
  xMunFim: z.string().max(60),
  ufFim: z.string().length(2),

  retira: z.union([z.literal(0), z.literal(1)]).default(0),
  indIEToma: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(9)]).default(1),
  toma: z.union([
    z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4),
  ]).default(3),
  tomador4: z.object({
    cnpj: z.string().optional(),
    cpf: z.string().optional(),
    ie: z.string().optional(),
    razaoSocial: z.string().min(1).max(60),
    endereco: enderecoSchema,
  }).optional(),

  modal: z.enum(['01', '02', '03', '04', '05']).default('01'),
  rntrc: z.string().min(1).max(20).optional(),

  // Dados específicos do modal — obrigatório para modais não-rodoviários
  // Para modal rodoviário (01), basta informar rntrc acima
  modalAereo: z.object({
    nMinu: z.number().int().optional(),
    nOCA: z.number().int().optional(),
    dPrevAereo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    natCarga: z.object({
      xDime: z.string().max(14).optional(),
      cImp: z.string().max(2).optional(),
      cInfManuorth: z.array(z.string()).optional(),
    }),
    tarifa: z.object({
      CL: z.enum(['M', 'G', 'E']),
      cTar: z.string().max(4).optional(),
      vTar: z.number().min(0),
    }),
    peri: z.array(z.object({
      nONU: z.string().min(1).max(4),
      qTotEmb: z.string().min(1).max(20),
      infTotAP: z.object({
        qTotProd: z.number().positive(),
        uniAP: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
      }).optional(),
    })).optional(),
  }).optional(),

  modalAquaviario: z.object({
    vPrest: z.number().min(0),
    vAFRMM: z.number().min(0),
    xNavio: z.string().min(1).max(60),
    nViag: z.string().max(10).optional(),
    direc: z.enum(['N', 'S']),
    irin: z.string().min(1).max(10),
    lacres: z.array(z.object({ nLacre: z.string().min(1).max(20) })).optional(),
    balsas: z.array(z.object({ xBalsa: z.string().min(1).max(60) })).optional(),
    detCont: z.array(z.object({
      nCont: z.string().min(1).max(20),
      infDoc: z.object({
        infNFe: z.array(z.string().length(44)).optional(),
        infNF: z.array(z.object({
          serie: z.string(),
          nDoc: z.string(),
          unidRat: z.number().optional(),
        })).optional(),
      }).optional(),
    })).optional(),
  }).optional(),

  modalFerroviario: z.object({
    tpTraf: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    fluxo: z.string().min(1).max(10),
    trafMut: z.object({
      respFat: z.union([z.literal(1), z.literal(2)]),
      ferrEmi: z.union([z.literal(1), z.literal(2)]),
      vFrete: z.number().min(0),
      chCTeFerroOrigem: z.string().length(44).optional(),
      ferroEnv: z.array(z.object({
        cnpj: z.string(),
        cInt: z.string().optional(),
        ie: z.string().optional(),
        xNome: z.string().min(1).max(60),
        enderFerro: enderecoSchema,
      })).optional(),
    }).optional(),
  }).optional(),

  modalDutoviario: z.object({
    vTar: z.number().min(0),
    dIni: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).optional(),

  // Participantes (quando não buscados de clientes/fornecedores)
  remetenteId: z.string().uuid().optional(),
  destinatarioId: z.string().uuid().optional(),
  remetente: participanteSchema.optional(),
  destinatario: participanteSchema.optional(),
  expedidor: participanteSchema.optional(),
  recebedor: participanteSchema.optional(),

  // Valores
  valorTotalPrestacao: z.number().positive(),
  valorReceber: z.number().positive().optional(),
  componentes: z.array(z.object({
    xNome: z.string().min(1).max(15),
    vComp: z.number().positive(),
  })).optional(),

  // Tributação
  cst: z.enum(['00', '20', '40', '41', '51', '60', '90']).default('00'),
  vBC: z.number().optional(),
  pICMS: z.number().optional(),
  vICMS: z.number().optional(),
  pRedBC: z.number().optional(),
  vTotTrib: z.number().min(0).optional(),

  // Carga
  valorCarga: z.number().positive(),
  produtoPredominante: z.string().min(1).max(60),
  quantidades: z.array(z.object({
    cUnid: z.enum(['00', '01', '02', '03', '04', '05', '06']),
    tpMed: z.string().min(1).max(20),
    qCarga: z.number().positive(),
  })).min(1),

  // Documentos referenciados
  chavesNfeRef: z.array(z.string().length(44)).optional(),

  // Veículos novos (opcional)
  veiculosNovos: z.array(z.object({
    chassi: z.string().length(17),
    cCor: z.string().min(1).max(4),
    xCor: z.string().min(1).max(40),
    cMod: z.string().min(1).max(6),
    vUnit: z.number().positive(),
    vFrete: z.number().min(0),
  })).optional(),

  // Observações
  xObs: z.string().max(2000).optional(),
  xEmi: z.string().max(60).optional(),

  // URL QR Code (se não informada, usa o padrão do portal nacional)
  urlQrCode: z.string().url().optional(),

  transportadoraId: z.string().uuid().optional(),
})

const cancelarBodySchema = z.object({
  justificativa: z.string().min(15, 'Justificativa deve ter no mínimo 15 caracteres'),
})

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Determina CFOP: 5xxx = mesma UF, 6xxx = outra UF */
function determinarCfop(ufIni: string, ufFim: string, cfopInformado?: string): string {
  if (cfopInformado) return cfopInformado
  const intraestadual = ufIni.toUpperCase() === ufFim.toUpperCase()
  return intraestadual ? '5353' : '6353'
}

/** Converte os campos do body em ModalCTe (union type) */
function resolverModalDados(body: any): ModalCTe {
  switch (body.modal) {
    case '02':
      if (!body.modalAereo) throw new Error('modalAereo é obrigatório para modal aéreo (02)')
      return { tipo: '02', ...body.modalAereo }
    case '03':
      if (!body.modalAquaviario) throw new Error('modalAquaviario é obrigatório para modal aquaviário (03)')
      return { tipo: '03', ...body.modalAquaviario }
    case '04':
      if (!body.modalFerroviario) throw new Error('modalFerroviario é obrigatório para modal ferroviário (04)')
      return { tipo: '04', ...body.modalFerroviario }
    case '05':
      if (!body.modalDutoviario) throw new Error('modalDutoviario é obrigatório para modal dutoviário (05)')
      return { tipo: '05', ...body.modalDutoviario }
    case '01':
    default:
      return { tipo: '01', rntrc: body.rntrc || '' }
  }
}

// ─── Rotas ───────────────────────────────────────────────────────────────────

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

  // POST / — emitir CT-e
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = emitirBodySchema.parse(request.body)

    const empresa = await prisma.empresa.findUnique({ where: { id: user.empresaId } })
    if (!empresa) return reply.status(404).send({ message: 'Empresa não encontrada' })

    // ── Resolver remetente ────────────────────────────────────────────────
    let remetenteParticipante = body.remetente
    if (!remetenteParticipante && body.remetenteId) {
      const rem = await prisma.cliente.findFirst({ where: { id: body.remetenteId, empresaId: user.empresaId } })
        ?? await prisma.fornecedor.findFirst({ where: { id: body.remetenteId, empresaId: user.empresaId } })
      if (!rem) return reply.status(404).send({ message: 'Remetente não encontrado' })
      remetenteParticipante = {
        cnpj: (rem as any).cnpj ?? undefined,
        cpf: (rem as any).cpf ?? undefined,
        ie: (rem as any).inscEstadual ?? undefined,
        razaoSocial: rem.razaoSocial,
        endereco: {
          logradouro: (rem as any).logradouro || 'NÃO INFORMADO',
          numero: (rem as any).numero || 'S/N',
          complemento: (rem as any).complemento ?? undefined,
          bairro: (rem as any).bairro || 'NÃO INFORMADO',
          cMun: (rem as any).codMunicipio || body.cMunIni,
          xMun: (rem as any).cidade || body.xMunIni,
          uf: (rem as any).uf || body.ufIni,
          cep: ((rem as any).cep || '').replace(/\D/g, '') || '00000000',
          fone: (rem as any).fone ?? undefined,
        },
      }
    }
    if (!remetenteParticipante) {
      return reply.status(422).send({ message: 'Informe remetenteId ou remetente completo' })
    }

    // ── Resolver destinatário ─────────────────────────────────────────────
    let destinatarioParticipante = body.destinatario
    if (!destinatarioParticipante && body.destinatarioId) {
      const dest = await prisma.cliente.findFirst({ where: { id: body.destinatarioId, empresaId: user.empresaId } })
        ?? await prisma.fornecedor.findFirst({ where: { id: body.destinatarioId, empresaId: user.empresaId } })
      if (!dest) return reply.status(404).send({ message: 'Destinatário não encontrado' })
      destinatarioParticipante = {
        cnpj: (dest as any).cnpj ?? undefined,
        cpf: (dest as any).cpf ?? undefined,
        ie: (dest as any).inscEstadual ?? undefined,
        razaoSocial: dest.razaoSocial,
        endereco: {
          logradouro: (dest as any).logradouro || 'NÃO INFORMADO',
          numero: (dest as any).numero || 'S/N',
          complemento: (dest as any).complemento ?? undefined,
          bairro: (dest as any).bairro || 'NÃO INFORMADO',
          cMun: (dest as any).codMunicipio || body.cMunFim,
          xMun: (dest as any).cidade || body.xMunFim,
          uf: (dest as any).uf || body.ufFim,
          cep: ((dest as any).cep || '').replace(/\D/g, '') || '00000000',
          fone: (dest as any).fone ?? undefined,
        },
      }
    }
    if (!destinatarioParticipante) {
      return reply.status(422).send({ message: 'Informe destinatarioId ou destinatario completo' })
    }

    // ── Numeração e chave ─────────────────────────────────────────────────
    const numero = empresa.proximoNumeroCTe
    const serie = empresa.serieCTe
    const dataEmissao = new Date()

    const chaveAcesso = gerarChaveAcesso({
      uf: empresa.uf || 'SP',
      dataEmissao,
      cnpj: empresa.cnpj,
      modelo: 57,
      serie,
      numero,
    })

    // Dados do emitente (da empresa)
    const emitenteXml: DadosCTeXml['emitente'] = {
      cnpj: empresa.cnpj,
      ie: empresa.inscEstadual || undefined,
      razaoSocial: empresa.razaoSocial,
      crt: (['1', '2', '3'].includes(String(empresa.crt)) ? Number(empresa.crt) : 3) as 1 | 2 | 3,
      endereco: {
        logradouro: empresa.logradouro || 'NÃO INFORMADO',
        numero: empresa.numero || 'S/N',
        complemento: empresa.complemento || undefined,
        bairro: empresa.bairro || 'NÃO INFORMADO',
        cMun: empresa.codMunicipio || '9999999',
        xMun: empresa.cidade || 'NÃO INFORMADO',
        uf: empresa.uf || 'SP',
        cep: (empresa.cep || '').replace(/\D/g, '') || '00000000',
        fone: empresa.fone || undefined,
      },
    }

    // CFOP automático se não informado
    const cfop = determinarCfop(body.ufIni, body.ufFim, body.cfop)

    // Município de envio: usa o do emitente quando não informado
    const cMunEnv = body.cMunEnv ?? emitenteXml.endereco.cMun
    const xMunEnv = body.xMunEnv ?? emitenteXml.endereco.xMun
    const ufEnv = body.ufEnv ?? emitenteXml.endereco.uf

    // Data com offset local (Brasil = -03:00)
    const dhEmi = dataEmissao.toISOString().replace('Z', '-03:00')

    // ── Montar dados e gerar XML ──────────────────────────────────────────
    const dadosXml: DadosCTeXml = {
      chaveAcesso,
      numero,
      serie,
      dataEmissao: dhEmi,
      tpAmb: empresa.ambienteNFe as 1 | 2,
      cfop,
      cMunEnv,
      xMunEnv,
      ufEnv,
      cMunIni: body.cMunIni,
      xMunIni: body.xMunIni,
      ufIni: body.ufIni,
      cMunFim: body.cMunFim,
      xMunFim: body.xMunFim,
      ufFim: body.ufFim,
      retira: body.retira,
      indIEToma: body.indIEToma,
      toma: body.toma,
      tomador4: body.tomador4 as DadosCTeXml['tomador4'],
      modal: body.modal,
      modalDados: resolverModalDados(body),
      rntrc: body.rntrc,
      emitente: emitenteXml,
      remetente: remetenteParticipante,
      expedidor: body.expedidor,
      recebedor: body.recebedor,
      destinatario: destinatarioParticipante,
      valorTotalPrestacao: body.valorTotalPrestacao,
      valorReceber: body.valorReceber ?? body.valorTotalPrestacao,
      componentes: body.componentes,
      cst: body.cst,
      vBC: body.vBC,
      pICMS: body.pICMS,
      vICMS: body.vICMS,
      pRedBC: body.pRedBC,
      vTotTrib: body.vTotTrib ?? 0,
      valorCarga: body.valorCarga,
      produtoPredominante: body.produtoPredominante,
      quantidades: body.quantidades,
      chavesNfeRef: body.chavesNfeRef,
      veiculosNovos: body.veiculosNovos,
      xObs: body.xObs,
      xEmi: body.xEmi,
      urlQrCode: body.urlQrCode,
    }

    const xml = buildCTeXml(dadosXml)

    // ── Assinar XML com certificado digital A1 ────────────────────────────
    let xmlAssinado: string
    try {
      const certificado = await certificadoService.obterParaAssinatura(empresa.cnpj, user.empresaId)
      const resultado = assinarXML({
        xml,
        pfxBuffer: certificado.pfxBuffer,
        senha: certificado.senha,
        tagParaAssinar: 'infCte',
      })
      xmlAssinado = resultado.xmlAssinado
    } catch (errCert: any) {
      // Se não há certificado cadastrado e estamos em homologação, seguir sem assinatura
      if (empresa.ambienteNFe === 2) {
        xmlAssinado = xml
      } else {
        return reply.status(422).send({
          message: `Não foi possível assinar o CT-e: ${errCert.message || 'Certificado digital não encontrado ou inválido'}`,
        })
      }
    }

    const resposta = await enviarCTe({
      xmlAssinado,
      ambiente: empresa.ambienteNFe,
      ufEmitente: empresa.uf || 'SP',
      cnpjEmitente: empresa.cnpj,
      empresaId: user.empresaId,
    })

    const cte = await prisma.$transaction(async (tx) => {
      const record = await tx.cte.create({
        data: {
          empresaId: user.empresaId,
          numero,
          serie,
          chaveAcesso,
          remetenteId: body.remetenteId ?? null,
          destinatarioId: body.destinatarioId ?? null,
          transportadoraId: body.transportadoraId ?? null,
          descricaoCarga: body.produtoPredominante,
          valorCarga: body.valorCarga,
          valorFrete: body.valorTotalPrestacao,
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

  // POST /:id/cancelar
  app.post('/:id/cancelar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const { justificativa } = cancelarBodySchema.parse(request.body)

    const cte = await prisma.cte.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!cte) return reply.status(404).send({ message: 'CT-e não encontrado' })
    if (cte.status !== 'AUTORIZADO') {
      return reply.status(422).send({ message: 'Apenas CT-e autorizados podem ser cancelados' })
    }

    const empresa = await prisma.empresa.findUnique({ where: { id: user.empresaId } })

    const resposta = await cancelarCTeSefaz({
      chaveAcesso: cte.chaveAcesso || '',
      protocolo: cte.protocolo || '',
      justificativa,
      ambiente: cte.ambiente,
      ufEmitente: empresa?.uf || 'SP',
      cnpjEmitente: empresa?.cnpj || '',
      empresaId: user.empresaId,
    })

    if (resposta.sucesso) {
      await prisma.cte.update({ where: { id }, data: { status: 'CANCELADO' } })
    }

    return { sucesso: resposta.sucesso, sefaz: resposta }
  })
}
