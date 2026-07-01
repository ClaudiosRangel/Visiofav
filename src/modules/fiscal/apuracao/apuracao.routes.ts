/**
 * Rotas de apuração de impostos
 *
 * POST /fiscal/apuracao/icms       — Executar apuração de ICMS
 * POST /fiscal/apuracao/icms-st    — Executar apuração de ICMS-ST
 * POST /fiscal/apuracao/pis-cofins — Executar apuração de PIS/COFINS
 * POST /fiscal/apuracao/ipi        — Executar apuração de IPI
 * GET  /fiscal/apuracao/:tipo/:periodo — Consultar resultado de apuração
 * POST /fiscal/apuracao/:id/fechar — Fechar período de apuração
 *
 * Requirements: 20.1, 21.1, 22.1, 23.1
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { apuracaoICMSService } from './apuracao-icms.service'
import { ApuracaoIcmsStService } from './apuracao-icms-st.service'
import { apuracaoPisCofinsService } from './apuracao-pis-cofins.service'
import { apuracaoIPIService } from './apuracao-ipi.service'
import { ErroFiscal } from '../erros'
import { prisma } from '../../../lib/prisma'

// === Zod Schemas ===

const apuracaoBodySchema = z.object({
  empresaId: z.string().uuid('empresaId deve ser um UUID válido'),
  periodo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Período deve estar no formato YYYY-MM'),
})

const ajusteSchema = z.object({
  tipo: z.enum(['ESTORNO_DEB', 'ESTORNO_CRED', 'AJUSTE']),
  valor: z.number().positive('Valor do ajuste deve ser positivo'),
  descricao: z.string().min(1, 'Descrição é obrigatória'),
  documentoFiscalId: z.string().uuid().optional(),
})

const apuracaoIcmsBodySchema = apuracaoBodySchema.extend({
  ajustes: z.array(ajusteSchema).optional(),
})

const apuracaoPisCofinsBodySchema = apuracaoBodySchema.extend({
  regime: z.enum(['NAO_CUMULATIVO', 'CUMULATIVO'], {
    errorMap: () => ({ message: 'Regime deve ser NAO_CUMULATIVO ou CUMULATIVO' }),
  }),
})

const consultaParamsSchema = z.object({
  tipo: z.enum(['ICMS', 'ICMS_ST', 'PIS', 'COFINS', 'IPI'], {
    errorMap: () => ({ message: 'Tipo deve ser ICMS, ICMS_ST, PIS, COFINS ou IPI' }),
  }),
  periodo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Período deve estar no formato YYYY-MM'),
})

const fecharParamsSchema = z.object({
  id: z.string().uuid('ID deve ser um UUID válido'),
})

// === Service instances ===

const apuracaoIcmsStService = new ApuracaoIcmsStService()

// === Routes ===

export async function apuracaoRoutes(app: FastifyInstance) {
  // ==========================================================================
  // POST /icms — Executar apuração de ICMS
  // Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6
  // Calcula débitos (saídas), créditos (entradas), estornos, ajustes.
  // Transporta saldo credor do período anterior.
  // ==========================================================================
  app.post('/icms', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = apuracaoIcmsBodySchema.parse(request.body)
      const resultado = await apuracaoICMSService.apurar(
        { empresaId: body.empresaId, periodo: body.periodo },
        body.ajustes ?? [],
      )
      return reply.status(201).send(resultado)
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      return reply.status(500).send({ message: err.message || 'Erro ao executar apuração de ICMS' })
    }
  })

  // ==========================================================================
  // POST /icms-st — Executar apuração de ICMS-ST
  // Requirements: 21.1, 21.2, 21.3, 21.4
  // Calcula débitos ST e créditos ST por UF destino, ressarcimento.
  // ==========================================================================
  app.post('/icms-st', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = apuracaoBodySchema.parse(request.body)
      const resultado = await apuracaoIcmsStService.apurar({
        empresaId: body.empresaId,
        periodo: body.periodo,
      })
      return reply.status(201).send(resultado)
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      return reply.status(500).send({ message: err.message || 'Erro ao executar apuração de ICMS-ST' })
    }
  })

  // ==========================================================================
  // POST /pis-cofins — Executar apuração de PIS/COFINS
  // Requirements: 22.1, 22.2, 22.3, 22.4, 22.5
  // Calcula débitos sobre receitas, créditos sobre aquisições.
  // Valor líquido = débitos - créditos (separado PIS e COFINS).
  // ==========================================================================
  app.post('/pis-cofins', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = apuracaoPisCofinsBodySchema.parse(request.body)
      const resultado = await apuracaoPisCofinsService.apurar({
        empresaId: body.empresaId,
        periodo: body.periodo,
        regime: body.regime,
      })
      return reply.status(201).send(resultado)
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      return reply.status(500).send({ message: err.message || 'Erro ao executar apuração de PIS/COFINS' })
    }
  })

  // ==========================================================================
  // POST /ipi — Executar apuração de IPI
  // Requirements: 23.1, 23.2, 23.3, 23.4
  // Calcula débitos (saídas tributadas), créditos (insumos/MP).
  // Transporta saldo credor anterior. Gera registros E520 para SPED.
  // ==========================================================================
  app.post('/ipi', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = apuracaoBodySchema.parse(request.body)
      const resultado = await apuracaoIPIService.apurar({
        empresaId: body.empresaId,
        periodo: body.periodo,
      })
      return reply.status(201).send(resultado)
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      return reply.status(500).send({ message: err.message || 'Erro ao executar apuração de IPI' })
    }
  })

  // ==========================================================================
  // GET /:tipo/:periodo — Consultar resultado de apuração
  // Requirements: 20.1, 21.1, 22.1, 23.1
  // Retorna dados da apuração persistida para o tipo e período informados.
  // ==========================================================================
  app.get('/:tipo/:periodo', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const params = consultaParamsSchema.parse(request.params)

      const apuracao = await prisma.apuracaoFiscal.findUnique({
        where: {
          empresaId_tipo_periodo: {
            empresaId: user.empresaId,
            tipo: params.tipo,
            periodo: params.periodo,
          },
        },
        include: {
          detalhes: {
            orderBy: { tipo: 'asc' },
          },
        },
      })

      if (!apuracao) {
        return reply.status(404).send({
          message: `Apuração de ${params.tipo} para o período ${params.periodo} não encontrada`,
        })
      }

      return {
        id: apuracao.id,
        empresaId: apuracao.empresaId,
        tipo: apuracao.tipo,
        periodo: apuracao.periodo,
        totalDebitos: Number(apuracao.totalDebitos),
        totalCreditos: Number(apuracao.totalCreditos),
        estornoDebitos: Number(apuracao.estornoDebitos),
        estornoCreditos: Number(apuracao.estornoCreditos),
        ajustes: Number(apuracao.ajustes),
        saldoAnterior: Number(apuracao.saldoAnterior),
        saldoFinal: Number(apuracao.saldoFinal),
        valorRecolher: Number(apuracao.valorRecolher),
        fechado: apuracao.fechado,
        detalhes: apuracao.detalhes.map((d) => ({
          id: d.id,
          tipo: d.tipo,
          valor: Number(d.valor),
          descricao: d.descricao,
          documentoFiscalId: d.documentoFiscalId,
        })),
      }
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Parâmetros inválidos', erros: err.errors })
      }
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      return reply.status(500).send({ message: err.message || 'Erro ao consultar apuração' })
    }
  })

  // ==========================================================================
  // POST /:id/fechar — Fechar período de apuração
  // Requirements: 20.1, 21.1, 22.1, 23.1
  // Impede alterações posteriores na apuração.
  // ==========================================================================
  app.post('/:id/fechar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = fecharParamsSchema.parse(request.params)

      const apuracao = await prisma.apuracaoFiscal.findUnique({
        where: { id },
      })

      if (!apuracao) {
        return reply.status(404).send({ message: 'Apuração não encontrada' })
      }

      if (apuracao.empresaId !== user.empresaId) {
        return reply.status(403).send({ message: 'Acesso negado a esta apuração' })
      }

      if (apuracao.fechado) {
        return { message: 'Apuração já está fechada', id: apuracao.id, fechado: true }
      }

      await prisma.apuracaoFiscal.update({
        where: { id },
        data: { fechado: true },
      })

      return {
        message: 'Apuração fechada com sucesso',
        id: apuracao.id,
        tipo: apuracao.tipo,
        periodo: apuracao.periodo,
        fechado: true,
      }
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Parâmetros inválidos', erros: err.errors })
      }
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      return reply.status(500).send({ message: err.message || 'Erro ao fechar apuração' })
    }
  })
}
