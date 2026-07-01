/**
 * Rotas SPED — Geração de obrigações acessórias
 *
 * POST /fiscal/sped/fiscal        — Gerar EFD ICMS/IPI
 * POST /fiscal/sped/contribuicoes — Gerar EFD PIS/COFINS
 * POST /fiscal/sped/ecd           — Gerar ECD (Escrituração Contábil Digital)
 * POST /fiscal/sped/ecf           — Gerar ECF (Escrituração Contábil Fiscal)
 * POST /fiscal/sped/reinf/transmitir — Transmitir EFD-Reinf
 * GET  /fiscal/sped/:id/download  — Download de arquivo SPED gerado
 *
 * Requirements: 14.1, 15.1, 16.1, 17.1, 18.1
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { SpedFiscalGenerator } from './sped-fiscal.generator'
import { SpedContribuicoesGenerator } from './sped-contribuicoes.generator'
import { SpedECDGenerator } from './sped-ecd.generator'
import { SpedECFGenerator } from './sped-ecf.generator'
import { ErroFiscal, CodigoErroFiscal } from '../erros'
import type { PeriodoParams, ArquivoSPED } from './tipos'

// === Zod Schemas ===

const gerarSpedBodySchema = z.object({
  empresaId: z.string().uuid('empresaId deve ser um UUID válido'),
  mes: z.number().int().min(1).max(12, 'Mês deve ser entre 1 e 12'),
  ano: z.number().int().min(2000).max(2100, 'Ano deve ser entre 2000 e 2100'),
  versaoLayout: z.string().optional(),
  finalidade: z.enum(['ORIGINAL', 'RETIFICADORA']).optional(),
})

export type GerarSpedBody = z.infer<typeof gerarSpedBodySchema>

const downloadParamsSchema = z.object({
  id: z.string().min(1, 'ID do arquivo é obrigatório'),
})

// === In-memory store for generated files (production would use object storage) ===

interface ArquivoGerado {
  id: string
  tipo: string
  nomeArquivo: string
  conteudo: Buffer
  totalRegistros: number
  blocos: Record<string, number>
  valido: boolean
  geradoEm: Date
  empresaId: string
}

const arquivosGerados = new Map<string, ArquivoGerado>()

// === Helper: generate unique ID ===

function gerarId(): string {
  return `sped_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}

// === Helper: build PeriodoParams from request body ===

function buildParams(body: GerarSpedBody): PeriodoParams {
  return {
    empresaId: body.empresaId,
    mes: body.mes,
    ano: body.ano,
    versaoLayout: body.versaoLayout,
    finalidade: body.finalidade,
  }
}

// === Routes ===

export async function spedRoutes(app: FastifyInstance) {
  // ==========================================================================
  // POST /fiscal — Gerar EFD ICMS/IPI (SPED Fiscal)
  // Requirements: 14.1
  // ==========================================================================
  app.post('/fiscal', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }

    try {
      const body = gerarSpedBodySchema.parse(request.body)
      const params = buildParams(body)

      const generator = new SpedFiscalGenerator()
      const resultado = await generator.gerar(params)

      const id = gerarId()
      arquivosGerados.set(id, {
        id,
        tipo: 'EFD_ICMS_IPI',
        nomeArquivo: resultado.nomeArquivo,
        conteudo: resultado.conteudo,
        totalRegistros: resultado.totalRegistros,
        blocos: resultado.blocos,
        valido: resultado.valido,
        geradoEm: new Date(),
        empresaId: body.empresaId,
      })

      return reply.status(201).send({
        id,
        tipo: 'EFD_ICMS_IPI',
        nomeArquivo: resultado.nomeArquivo,
        totalRegistros: resultado.totalRegistros,
        blocos: resultado.blocos,
        valido: resultado.valido,
        geradoEm: new Date().toISOString(),
      })
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      return reply.status(500).send({ message: err.message || 'Erro ao gerar SPED Fiscal' })
    }
  })

  // ==========================================================================
  // POST /contribuicoes — Gerar EFD PIS/COFINS (SPED Contribuições)
  // Requirements: 15.1
  // ==========================================================================
  app.post('/contribuicoes', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }

    try {
      const body = gerarSpedBodySchema.parse(request.body)
      const params = buildParams(body)

      const generator = new SpedContribuicoesGenerator()
      const resultado = await generator.gerar(params)

      const id = gerarId()
      arquivosGerados.set(id, {
        id,
        tipo: 'EFD_CONTRIBUICOES',
        nomeArquivo: resultado.nomeArquivo,
        conteudo: resultado.conteudo,
        totalRegistros: resultado.totalRegistros,
        blocos: resultado.blocos,
        valido: resultado.valido,
        geradoEm: new Date(),
        empresaId: body.empresaId,
      })

      return reply.status(201).send({
        id,
        tipo: 'EFD_CONTRIBUICOES',
        nomeArquivo: resultado.nomeArquivo,
        totalRegistros: resultado.totalRegistros,
        blocos: resultado.blocos,
        valido: resultado.valido,
        geradoEm: new Date().toISOString(),
      })
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      return reply.status(500).send({ message: err.message || 'Erro ao gerar SPED Contribuições' })
    }
  })

  // ==========================================================================
  // POST /ecd — Gerar ECD (Escrituração Contábil Digital)
  // Requirements: 16.1
  // ==========================================================================
  app.post('/ecd', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }

    try {
      const body = gerarSpedBodySchema.parse(request.body)
      const params = buildParams(body)

      const generator = new SpedECDGenerator()
      const resultado = await generator.gerar(params)

      const id = gerarId()
      arquivosGerados.set(id, {
        id,
        tipo: 'ECD',
        nomeArquivo: resultado.nomeArquivo,
        conteudo: resultado.conteudo,
        totalRegistros: resultado.totalRegistros,
        blocos: resultado.blocos,
        valido: resultado.valido,
        geradoEm: new Date(),
        empresaId: body.empresaId,
      })

      return reply.status(201).send({
        id,
        tipo: 'ECD',
        nomeArquivo: resultado.nomeArquivo,
        totalRegistros: resultado.totalRegistros,
        blocos: resultado.blocos,
        valido: resultado.valido,
        geradoEm: new Date().toISOString(),
      })
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      return reply.status(500).send({ message: err.message || 'Erro ao gerar ECD' })
    }
  })

  // ==========================================================================
  // POST /ecf — Gerar ECF (Escrituração Contábil Fiscal)
  // Requirements: 17.1
  // ==========================================================================
  app.post('/ecf', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }

    try {
      const body = gerarSpedBodySchema.parse(request.body)
      const params = buildParams(body)

      const generator = new SpedECFGenerator()
      const resultado = await generator.gerar(params)

      const id = gerarId()
      arquivosGerados.set(id, {
        id,
        tipo: 'ECF',
        nomeArquivo: resultado.nomeArquivo,
        conteudo: resultado.conteudo,
        totalRegistros: resultado.totalRegistros,
        blocos: resultado.blocos,
        valido: resultado.valido,
        geradoEm: new Date(),
        empresaId: body.empresaId,
      })

      return reply.status(201).send({
        id,
        tipo: 'ECF',
        nomeArquivo: resultado.nomeArquivo,
        totalRegistros: resultado.totalRegistros,
        blocos: resultado.blocos,
        valido: resultado.valido,
        geradoEm: new Date().toISOString(),
      })
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      return reply.status(500).send({ message: err.message || 'Erro ao gerar ECF' })
    }
  })

  // ==========================================================================
  // POST /reinf/transmitir — Transmitir EFD-Reinf
  // Requirements: 18.1
  // Nota: O gerador SpedReinfGenerator será implementado na task 18.4.
  // Por enquanto, esta rota retorna 501 (Not Implemented) se o módulo
  // ainda não estiver disponível.
  // ==========================================================================
  app.post('/reinf/transmitir', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }

    try {
      const body = gerarSpedBodySchema.parse(request.body)

      // Tenta importar o gerador Reinf dinamicamente (pode não existir ainda)
      let SpedReinfGenerator: any
      try {
        const mod = await import('./sped-reinf.generator')
        SpedReinfGenerator = mod.SpedReinfGenerator ?? mod.spedReinfGenerator
      } catch {
        return reply.status(501).send({
          message: 'Módulo EFD-Reinf ainda não implementado',
          codigo: 'REINF_NAO_DISPONIVEL',
        })
      }

      const params = buildParams(body)

      const generator = typeof SpedReinfGenerator === 'function'
        ? new SpedReinfGenerator()
        : SpedReinfGenerator

      if (!generator || typeof generator.gerar !== 'function') {
        return reply.status(501).send({
          message: 'Módulo EFD-Reinf ainda não implementado',
          codigo: 'REINF_NAO_DISPONIVEL',
        })
      }

      const resultado = await generator.gerar(params)

      const id = gerarId()
      arquivosGerados.set(id, {
        id,
        tipo: 'REINF',
        nomeArquivo: resultado.nomeArquivo ?? `REINF_${body.ano}${String(body.mes).padStart(2, '0')}.xml`,
        conteudo: resultado.conteudo,
        totalRegistros: resultado.totalRegistros ?? 0,
        blocos: resultado.blocos ?? {},
        valido: resultado.valido ?? true,
        geradoEm: new Date(),
        empresaId: body.empresaId,
      })

      return reply.status(201).send({
        id,
        tipo: 'REINF',
        nomeArquivo: resultado.nomeArquivo,
        totalRegistros: resultado.totalRegistros ?? 0,
        valido: resultado.valido ?? true,
        geradoEm: new Date().toISOString(),
      })
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      return reply.status(500).send({ message: err.message || 'Erro ao transmitir EFD-Reinf' })
    }
  })

  // ==========================================================================
  // GET /:id/download — Download de arquivo SPED gerado
  // Requirements: 14.1, 15.1, 16.1, 17.1, 18.1
  // ==========================================================================
  app.get('/:id/download', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }

    try {
      const { id } = downloadParamsSchema.parse(request.params)

      const arquivo = arquivosGerados.get(id)
      if (!arquivo) {
        return reply.status(404).send({ message: 'Arquivo SPED não encontrado' })
      }

      reply.header('Content-Type', 'application/octet-stream')
      reply.header('Content-Disposition', `attachment; filename="${arquivo.nomeArquivo}"`)
      reply.header('Content-Length', arquivo.conteudo.length)

      return reply.send(arquivo.conteudo)
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Parâmetros inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro ao fazer download' })
    }
  })
}
