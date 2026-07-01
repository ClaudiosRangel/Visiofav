/**
 * Rotas do CT-e (Conhecimento de Transporte Eletrônico)
 *
 * Endpoints:
 * - POST /cte/emitir — Emitir CT-e modelo 57
 *
 * Requirements: 6.8
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../../lib/prisma'
import { cteEmissaoService } from './cte-emissao.service'
import { ErroFiscal } from '../../erros'
import type { DadosCTe } from './cte-xml-builder'

// === Schemas Zod ===

const enderecoSchema = z.object({
  logradouro: z.string().min(1).max(60),
  numero: z.string().min(1).max(10),
  complemento: z.string().max(60).optional(),
  bairro: z.string().min(1).max(60),
  codigoMunicipio: z.string().regex(/^\d{7}$/, 'Código IBGE do município deve ter 7 dígitos'),
  municipio: z.string().min(1).max(60),
  uf: z.string().length(2).regex(/^[A-Z]{2}$/),
  cep: z.string().regex(/^\d{8}$/, 'CEP deve conter 8 dígitos'),
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
  cUnid: z.string().regex(/^\d{2}$/, 'Código de unidade deve ter 2 dígitos'),
  tpMed: z.string().min(1).max(20),
  qCarga: z.number().positive(),
})

const infNFeVinculadaSchema = z.object({
  chave: z.string().regex(/^\d{44}$/, 'Chave de acesso deve conter 44 dígitos'),
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

const emissaoCTeInputSchema = z.object({
  // Campos de identificação
  serie: z.number().int().min(0).max(999),
  cfop: z.string().regex(/^\d{4}$/, 'CFOP deve conter 4 dígitos'),
  naturezaOp: z.string().min(1).max(100),
  tpServ: z.number().int().min(0).max(4),
  tpCTe: z.number().int().min(0).max(3).default(0),
  modal: z.string().regex(/^0[1-6]$/, 'Modal deve ser 01-06'),
  tpEmis: z.number().int().min(1).max(9).default(1),

  // Municípios início/fim
  cMunIni: z.string().regex(/^\d{7}$/, 'Código município deve ter 7 dígitos'),
  xMunIni: z.string().min(1).max(60),
  ufIni: z.string().length(2).regex(/^[A-Z]{2}$/),
  cMunFim: z.string().regex(/^\d{7}$/, 'Código município deve ter 7 dígitos'),
  xMunFim: z.string().min(1).max(60),
  ufFim: z.string().length(2).regex(/^[A-Z]{2}$/),

  // Tomador
  tpTom: z.number().int().min(0).max(4),
  indIEToma: z.number().int().refine(v => [1, 2, 9].includes(v), 'indIEToma deve ser 1, 2 ou 9'),
  tomadorOutros: participanteSchema.optional(),

  // Remetente e Destinatário
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
      cst: z.string().regex(/^(00|20|40|41|51|60|90|SN)$/, 'CST inválida para CT-e'),
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

  // CT-e Normal
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

  // Ambiente
  ambiente: z.number().int().min(1).max(2).default(2),

  // Forçar contingência
  forcarContingencia: z.boolean().default(false),
})

export type EmissaoCTeInput = z.infer<typeof emissaoCTeInputSchema>

// === Helpers ===

/** Obtém o próximo número de CT-e para uma série */
async function proximoNumeroCTe(empresaId: string, serie: number): Promise<number> {
  const ultimo = await prisma.documentoFiscal.findFirst({
    where: { empresaId, tipo: 'CTE', serie },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  })
  return (ultimo?.numero || 0) + 1
}

/** Gera código numérico aleatório de 8 dígitos */
function gerarCodigoNumerico(): string {
  return String(Math.floor(Math.random() * 99999999)).padStart(8, '0')
}

/** Obtém código UF IBGE a partir da sigla */
function obterCodigoUF(uf: string): number {
  const UF_CODES: Record<string, number> = {
    RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17,
    MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27,
    SE: 28, BA: 29, MG: 31, ES: 32, RJ: 33, SP: 35,
    PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53,
  }
  return UF_CODES[uf.toUpperCase()] || 35 // Default SP
}

// === Plugin de rotas ===

export async function cteRoutes(app: FastifyInstance) {
  // ==========================================================================
  // POST /cte/emitir — Emitir CT-e
  // Requirements: 6.8
  // ==========================================================================
  app.post('/cte/emitir', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = emissaoCTeInputSchema.parse(request.body)

      // Buscar dados da empresa emitente
      const empresa = await prisma.empresa.findUnique({
        where: { id: user.empresaId },
      })

      if (!empresa) {
        return reply.status(404).send({ message: 'Empresa não encontrada' })
      }

      const ufEmitente = (empresa as any).uf || ''
      const nCT = await proximoNumeroCTe(user.empresaId, body.serie)

      // Montar DadosCTe para o serviço
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
          cnpj: (empresa as any).cnpj || '',
          ie: (empresa as any).ie || '',
          razaoSocial: (empresa as any).razaoSocial || (empresa as any).nome || '',
          nomeFantasia: (empresa as any).nomeFantasia || undefined,
          endereco: {
            logradouro: (empresa as any).logradouro || '',
            numero: (empresa as any).numero || '',
            complemento: (empresa as any).complemento || undefined,
            bairro: (empresa as any).bairro || '',
            codigoMunicipio: (empresa as any).codigoMunicipio || '',
            municipio: (empresa as any).municipio || '',
            uf: ufEmitente,
            cep: (empresa as any).cep || '',
          },
        },
        remetente: body.remetente,
        destinatario: body.destinatario,
        expedidor: body.expedidor,
        recebedor: body.recebedor,
        vPrest: body.vPrest,
        impostos: body.impostos,
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
}
