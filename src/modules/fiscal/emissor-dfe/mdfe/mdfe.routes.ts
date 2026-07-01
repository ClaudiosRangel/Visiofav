/**
 * Rotas do MDF-e (Manifesto Eletrônico de Documentos Fiscais)
 *
 * Endpoints:
 * - POST /mdfe/emitir          — Emitir MDF-e
 * - POST /mdfe/:id/encerrar    — Encerrar MDF-e autorizado
 *
 * Requirements: 7.7
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { mdfeEmissaoService } from './mdfe-emissao.service'
import { ErroFiscal, CodigoErroFiscal } from '../../erros'
import type { DadosMDFe } from './mdfe-xml-builder'

// === Schemas Zod ===

const idParamsSchema = z.object({
  id: z.string().uuid('ID deve ser um UUID válido'),
})

const municipioCarregaSchema = z.object({
  cMunCarrega: z.string().regex(/^\d{7}$/, 'Código IBGE do município deve ter 7 dígitos'),
  xMunCarrega: z.string().min(1).max(60),
})

const enderecoMDFeSchema = z.object({
  logradouro: z.string().min(1).max(60),
  numero: z.string().min(1).max(10),
  complemento: z.string().max(60).optional(),
  bairro: z.string().min(1).max(60),
  codigoMunicipio: z.string().regex(/^\d{7}$/, 'Código IBGE do município deve ter 7 dígitos'),
  municipio: z.string().min(1).max(60),
  uf: z.string().length(2).regex(/^[A-Z]{2}$/, 'UF deve conter 2 letras maiúsculas'),
  cep: z.string().regex(/^\d{8}$/, 'CEP deve conter 8 dígitos'),
  codigoPais: z.string().optional(),
  pais: z.string().optional(),
  telefone: z.string().optional(),
  email: z.string().email().optional(),
})

const emitenteSchema = z.object({
  cnpj: z.string().regex(/^\d{14}$/, 'CNPJ deve conter 14 dígitos'),
  ie: z.string().min(1).max(14),
  razaoSocial: z.string().min(1).max(200),
  nomeFantasia: z.string().max(60).optional(),
  endereco: enderecoMDFeSchema,
})

const infDocSchema = z.object({
  cMunDescarga: z.string().regex(/^\d{7}$/, 'Código IBGE do município deve ter 7 dígitos'),
  xMunDescarga: z.string().min(1).max(60),
  infCTe: z.array(z.string().length(44)).optional(),
  infNFe: z.array(z.string().length(44)).optional(),
})

const seguroSchema = z.object({
  respSeg: z.number().int().min(1).max(2),
  cnpjResp: z.string().regex(/^\d{14}$/).optional(),
  cpfResp: z.string().regex(/^\d{11}$/).optional(),
  xSeg: z.string().min(1).max(100),
  nApol: z.string().max(20).optional(),
  nAver: z.array(z.string().max(40)).optional(),
})

const prodPredSchema = z.object({
  tpCarga: z.number().int().min(1).max(99),
  xProd: z.string().min(1).max(120),
  cEAN: z.string().optional(),
  ncm: z.string().regex(/^\d{8}$/).optional(),
})

const totaisSchema = z.object({
  qCTe: z.number().int().min(0).default(0),
  qNFe: z.number().int().min(0).default(0),
  vCarga: z.number().min(0),
  cUnid: z.number().int().min(1).max(2).default(1), // 1=KG, 2=TON
  qCarga: z.number().min(0),
})

const veiculoTracaoSchema = z.object({
  placa: z.string().min(7).max(7),
  renavam: z.string().max(11).optional(),
  tara: z.number().int().min(0),
  capKG: z.number().int().min(0).optional(),
  capM3: z.number().int().min(0).optional(),
  tpRod: z.string().optional(),
  tpCar: z.string().optional(),
  uf: z.string().length(2).optional(),
})

const condutorSchema = z.object({
  cpf: z.string().regex(/^\d{11}$/, 'CPF deve conter 11 dígitos'),
  xNome: z.string().min(1).max(60),
})

const veiculoReboqueSchema = z.object({
  placa: z.string().min(7).max(7),
  renavam: z.string().max(11).optional(),
  tara: z.number().int().min(0),
  capKG: z.number().int().min(0).optional(),
  capM3: z.number().int().min(0).optional(),
  tpCar: z.string().optional(),
  uf: z.string().length(2).optional(),
})

const infCIOTSchema = z.object({
  ciot: z.string().min(12).max(12),
  cnpj: z.string().regex(/^\d{14}$/).optional(),
  cpf: z.string().regex(/^\d{11}$/).optional(),
})

const valePedagioSchema = z.object({
  cnpjForn: z.string().regex(/^\d{14}$/),
  cnpjPg: z.string().regex(/^\d{14}$/).optional(),
  cpfPg: z.string().regex(/^\d{11}$/).optional(),
  nCompra: z.string().min(1).max(14),
  vValePed: z.number().min(0),
})

const emitirMDFeInputSchema = z.object({
  cUF: z.number().int().min(11).max(53),
  cMDF: z.string().regex(/^\d{8}$/, 'Código numérico deve ter 8 dígitos'),
  nMDF: z.number().int().min(1).max(999999999),
  serie: z.number().int().min(1).max(999),
  tpEmis: z.number().int().min(1).max(2).default(1),
  ambiente: z.number().int().min(1).max(2).default(2),
  tpEmit: z.number().int().min(1).max(3),
  tpTransp: z.number().int().min(1).max(3).optional(),
  modal: z.number().int().min(1).max(4).default(1),
  dhEmi: z.string().datetime().optional(),
  ufIni: z.string().length(2).regex(/^[A-Z]{2}$/),
  ufFim: z.string().length(2).regex(/^[A-Z]{2}$/),
  infMunCarrega: z.array(municipioCarregaSchema).min(1, 'Deve informar ao menos um município de carregamento'),
  infPercurso: z.array(z.string().length(2).regex(/^[A-Z]{2}$/)).optional(),
  emitente: emitenteSchema,
  infDoc: z.array(infDocSchema).min(1, 'Deve vincular ao menos um documento fiscal'),
  seg: z.array(seguroSchema).optional(),
  prodPred: prodPredSchema.optional(),
  totais: totaisSchema,
  infAdic: z.string().max(5000).optional(),
  veicTracao: veiculoTracaoSchema.optional(),
  condutores: z.array(condutorSchema).optional(),
  veicReboque: z.array(veiculoReboqueSchema).optional(),
  lacres: z.array(z.string().max(60)).optional(),
  infCIOT: z.array(infCIOTSchema).optional(),
  valePed: z.array(valePedagioSchema).optional(),
  forcarContingencia: z.boolean().default(false),
})

const encerrarMDFeInputSchema = z.object({
  ufEncerramento: z.string().length(2).regex(/^[A-Z]{2}$/, 'UF deve conter 2 letras maiúsculas'),
  cMunEncerramento: z.string().regex(/^\d{7}$/, 'Código IBGE do município deve ter 7 dígitos'),
  dtEnc: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD').optional(),
})

// === Plugin de rotas ===

export async function mdfeRoutes(app: FastifyInstance) {
  // ==========================================================================
  // POST /mdfe/emitir — Emitir MDF-e
  // Requirements: 7.7
  // ==========================================================================
  app.post('/mdfe/emitir', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = emitirMDFeInputSchema.parse(request.body)

      const dadosMDFe: DadosMDFe = {
        cUF: body.cUF,
        cMDF: body.cMDF,
        nMDF: body.nMDF,
        serie: body.serie,
        tpEmis: body.tpEmis,
        ambiente: body.ambiente,
        tpEmit: body.tpEmit,
        tpTransp: body.tpTransp,
        modal: body.modal,
        dhEmi: body.dhEmi ? new Date(body.dhEmi) : new Date(),
        ufIni: body.ufIni,
        ufFim: body.ufFim,
        infMunCarrega: body.infMunCarrega,
        infPercurso: body.infPercurso,
        emitente: body.emitente,
        infDoc: body.infDoc,
        seg: body.seg as any,
        prodPred: body.prodPred as any,
        totais: { ...body.totais, cUnid: String(body.totais.cUnid).padStart(2, '0') },
        infAdic: body.infAdic,
        veicTracao: body.veicTracao as any,
        condutores: body.condutores as any,
        veicReboque: body.veicReboque as any,
        lacres: body.lacres,
        infCIOT: body.infCIOT as any,
        valePed: body.valePed as any,
      }

      const resultado = await mdfeEmissaoService.emitir({
        empresaId: user.empresaId,
        dadosMDFe,
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
      return reply.status(500).send({ message: err.message || 'Erro interno ao emitir MDF-e' })
    }
  })

  // ==========================================================================
  // POST /mdfe/:id/encerrar — Encerrar MDF-e autorizado
  // Requirements: 7.7
  // ==========================================================================
  app.post('/mdfe/:id/encerrar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)
      const body = encerrarMDFeInputSchema.parse(request.body)

      const resultado = await mdfeEmissaoService.encerrar({
        empresaId: user.empresaId,
        documentoFiscalId: id,
        ufEncerramento: body.ufEncerramento,
        cMunEncerramento: body.cMunEncerramento,
        dtEnc: body.dtEnc ? new Date(body.dtEnc) : undefined,
      })

      const statusCode = resultado.sucesso ? 200 : 422
      return reply.status(statusCode).send(resultado)
    } catch (err: any) {
      if (err instanceof ErroFiscal) {
        if (err.codigo === CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES) {
          return reply.status(404).send({ message: err.message, codigo: err.codigo })
        }
        return reply.status(422).send(err.toJSON())
      }
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno ao encerrar MDF-e' })
    }
  })
}
