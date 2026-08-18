/**
 * CRUD de Cores de Veículo para CT-e
 * Cadastro do código DENATRAN (cCor) + descrição (xCor)
 *
 * GET    /cte/cores         — Listar cores da empresa
 * POST   /cte/cores         — Criar cor (ou auto-cadastrar)
 * PUT    /cte/cores/:id     — Atualizar cor
 * DELETE /cte/cores/:id     — Excluir cor
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../../lib/prisma'

// Seed: cores padrão DENATRAN mais comuns
const CORES_PADRAO = [
  { codigo: '01', descricao: 'BRANCA' },
  { codigo: '02', descricao: 'PRETA' },
  { codigo: '03', descricao: 'CINZA' },
  { codigo: '04', descricao: 'PRATA' },
  { codigo: '05', descricao: 'VERMELHA' },
  { codigo: '06', descricao: 'AZUL' },
  { codigo: '07', descricao: 'AMARELA' },
  { codigo: '08', descricao: 'VERDE' },
  { codigo: '09', descricao: 'MARROM' },
]

export async function cteCoresRoutes(app: FastifyInstance) {

  // GET /cte/cores — Listar todas as cores da empresa
  app.get('/cte/cores', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })

    const cores = await prisma.corVeiculo.findMany({
      where: { empresaId: user.empresaId },
      orderBy: { codigo: 'asc' },
    })

    return cores
  })

  // POST /cte/cores — Criar cor
  app.post('/cte/cores', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })

    const body = z.object({
      codigo: z.string().min(1).max(4).transform(v => v.toUpperCase()),
      descricao: z.string().min(1).max(60).transform(v => v.toUpperCase()),
    }).parse(request.body)

    // Upsert — se já existe com mesmo código, atualiza descrição (auto-cadastro)
    const cor = await prisma.corVeiculo.upsert({
      where: { empresaId_codigo: { empresaId: user.empresaId, codigo: body.codigo } },
      create: { empresaId: user.empresaId, codigo: body.codigo, descricao: body.descricao },
      update: { descricao: body.descricao },
    })

    return reply.status(201).send(cor)
  })

  // PUT /cte/cores/:id — Atualizar cor
  app.put('/cte/cores/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })

    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      codigo: z.string().min(1).max(4).transform(v => v.toUpperCase()).optional(),
      descricao: z.string().min(1).max(60).transform(v => v.toUpperCase()).optional(),
    }).parse(request.body)

    const existente = await prisma.corVeiculo.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!existente) return reply.status(404).send({ message: 'Cor não encontrada' })

    const cor = await prisma.corVeiculo.update({
      where: { id },
      data: { ...body },
    })

    return cor
  })

  // DELETE /cte/cores/:id — Excluir cor
  app.delete('/cte/cores/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })

    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const existente = await prisma.corVeiculo.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!existente) return reply.status(404).send({ message: 'Cor não encontrada' })

    await prisma.corVeiculo.delete({ where: { id } })
    return { sucesso: true }
  })

  // POST /cte/cores/seed — Popular cores padrão DENATRAN (se ainda não existirem)
  app.post('/cte/cores/seed', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })

    let criadas = 0
    for (const cor of CORES_PADRAO) {
      const existe = await prisma.corVeiculo.findUnique({
        where: { empresaId_codigo: { empresaId: user.empresaId, codigo: cor.codigo } },
      })
      if (!existe) {
        await prisma.corVeiculo.create({ data: { empresaId: user.empresaId, ...cor } })
        criadas++
      }
    }

    return { sucesso: true, criadas, total: CORES_PADRAO.length }
  })
}
