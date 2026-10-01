import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { authenticate } from '../../../middleware/authenticate'
import { moduloGuard } from '../../../middleware/modulo-guard'
import {
  calcularMapa,
  depreciacaoBem,
  type CalcularMapaInput,
  type CentroInput,
} from './mapa-custo-calculo.service'

/**
 * Rotas do Mapa de Custos RKW (spec: .kiro/specs/mapa-custos-rkw).
 * Prefixo: /api/pcp/mapa-custo. Multi-tenant por empresaId EXPLÍCITO
 * (ver steering ATENCAO-pontos-verificar.md — não confiar só no prismaScoped).
 * Escrita bloqueada quando o mapa está FECHADO (exceto aplicar-orcamento).
 */

type User = { id: string; empresaId: string; perfil?: string }

// ── Helpers ──────────────────────────────────────────────────────────────
async function getMapaDaEmpresa(id: string, empresaId: string) {
  return prisma.mapaCusto.findFirst({ where: { id, empresaId } as never })
}

async function assertMapaEditavel(id: string, empresaId: string) {
  const mapa = await getMapaDaEmpresa(id, empresaId)
  if (!mapa) return { erro: 404 as const }
  if ((mapa as { status: string }).status === 'FECHADO') return { erro: 409 as const, mapa }
  return { erro: null, mapa }
}

// ── Schemas ──────────────────────────────────────────────────────────────
const criarMapaSchema = z.object({
  competencia: z.string().regex(/^\d{4}-\d{2}$/, 'Competência deve ser AAAA-MM'),
  descricao: z.string().max(200).optional(),
  percEncargos: z.number().optional(),
  horasProdutivasBase: z.number().int().optional(),
  ajustePraticarPerc: z.number().optional(),
})

const centroSchema = z.object({
  codigo: z.string().min(1).max(30),
  descricao: z.string().min(1).max(200),
  natureza: z.enum(['PRODUTIVO', 'AUXILIAR', 'ADMINISTRACAO']),
  centroProducaoId: z.string().uuid().optional().nullable(),
  usoOrcamento: z.boolean().optional(),
  unidadesProdutivas: z.number().int().optional(),
  turnos: z.number().int().optional(),
  horasExtras: z.number().int().optional(),
  chaveRateioId: z.string().uuid().optional().nullable(),
  posicao: z.number().int().optional(),
})

const bemSchema = z.object({
  centroCustoId: z.string().uuid(),
  grupo: z.string().min(1).max(60),
  descricao: z.string().min(1).max(200),
  valor: z.number(),
  estado: z.enum(['OTIMO', 'BOM', 'REGULAR']),
  anosVidaUtil: z.number().int().positive(),
  residualPerc: z.number().optional(),
})

const funcionarioSchema = z.object({
  centroCustoId: z.string().uuid().optional().nullable(),
  nome: z.string().min(1).max(200),
  cargo: z.string().max(120).optional().nullable(),
  salario: z.number(),
  ajudaCusto: z.number().optional(),
  rateado: z.boolean().optional(),
})

const despesaSchema = z.object({
  descricao: z.string().min(1).max(200),
  valor: z.number(),
  chaveRateioId: z.string().uuid(),
})

const chaveSchema = z.object({
  nome: z.string().min(1).max(120),
  tipo: z.enum(['MANUAL', 'HEADCOUNT', 'ATIVO', 'CENTRO', 'FUNCIONARIO']),
  funcionarioCustoId: z.string().uuid().optional().nullable(),
  destinos: z
    .array(z.object({ centroCustoId: z.string().uuid(), peso: z.number() }))
    .default([]),
})

export async function mapaCustoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  // ══════════════════════════════════════════════════════════════════════
  // MapaCusto — CRUD + ciclo de vida
  // ══════════════════════════════════════════════════════════════════════

  // GET /mapa-custo — lista por competência/status
  app.get('/mapa-custo', async (request) => {
    const user = request.user as User
    const q = z
      .object({ status: z.enum(['RASCUNHO', 'FECHADO']).optional() })
      .parse(request.query)
    const mapas = await prisma.mapaCusto.findMany({
      where: { empresaId: user.empresaId, ...(q.status ? { status: q.status } : {}) } as never,
      orderBy: { competencia: 'desc' } as never,
    })
    return mapas
  })

  // POST /mapa-custo — cria mapa
  app.post('/mapa-custo', async (request, reply) => {
    const user = request.user as User
    const body = criarMapaSchema.parse(request.body)
    const existe = await prisma.mapaCusto.findFirst({
      where: { empresaId: user.empresaId, competencia: body.competencia } as never,
    })
    if (existe) {
      return reply.status(409).send({ message: `Já existe mapa para a competência ${body.competencia}` })
    }
    const mapa = await prisma.mapaCusto.create({
      data: {
        empresaId: user.empresaId,
        competencia: body.competencia,
        descricao: body.descricao ?? null,
        ...(body.percEncargos !== undefined ? { percEncargos: body.percEncargos } : {}),
        ...(body.horasProdutivasBase !== undefined ? { horasProdutivasBase: body.horasProdutivasBase } : {}),
        ...(body.ajustePraticarPerc !== undefined ? { ajustePraticarPerc: body.ajustePraticarPerc } : {}),
      } as never,
    })
    return reply.status(201).send(mapa)
  })

  // GET /mapa-custo/:id — detalhe + cadastros + resultados
  app.get('/mapa-custo/:id', async (request, reply) => {
    const user = request.user as User
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const mapa = await prisma.mapaCusto.findFirst({
      where: { id, empresaId: user.empresaId } as never,
      include: {
        centros: { orderBy: { posicao: 'asc' } },
        bens: true,
        funcionarios: true,
        despesas: true,
        chaves: { include: { destinos: true } },
        resultados: true,
      } as never,
    })
    if (!mapa) return reply.status(404).send({ message: 'Mapa não encontrado' })
    return mapa
  })

  // PATCH /mapa-custo/:id — atualiza parâmetros/descrição (só RASCUNHO)
  app.patch('/mapa-custo/:id', async (request, reply) => {
    const user = request.user as User
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z
      .object({
        descricao: z.string().max(200).optional(),
        percEncargos: z.number().optional(),
        horasProdutivasBase: z.number().int().optional(),
        ajustePraticarPerc: z.number().optional(),
      })
      .parse(request.body)
    const chk = await assertMapaEditavel(id, user.empresaId)
    if (chk.erro === 404) return reply.status(404).send({ message: 'Mapa não encontrado' })
    if (chk.erro === 409) return reply.status(409).send({ message: 'Mapa fechado — não editável' })
    const mapa = await prisma.mapaCusto.update({ where: { id }, data: body as never })
    return mapa
  })

  // POST /mapa-custo/:id/duplicar — cria nova competência copiando cadastros
  app.post('/mapa-custo/:id/duplicar', async (request, reply) => {
    const user = request.user as User
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({ competencia: z.string().regex(/^\d{4}-\d{2}$/) }).parse(request.body)

    const origem = await prisma.mapaCusto.findFirst({
      where: { id, empresaId: user.empresaId } as never,
      include: { centros: true, bens: true, funcionarios: true, despesas: true, chaves: { include: { destinos: true } } } as never,
    })
    if (!origem) return reply.status(404).send({ message: 'Mapa de origem não encontrado' })
    const existe = await prisma.mapaCusto.findFirst({
      where: { empresaId: user.empresaId, competencia: body.competencia } as never,
    })
    if (existe) return reply.status(409).send({ message: `Já existe mapa para ${body.competencia}` })

    const o = origem as never as {
      percEncargos: unknown; horasProdutivasBase: number; ajustePraticarPerc: unknown; descricao: string | null
      centros: Array<Record<string, unknown>>; bens: Array<Record<string, unknown>>
      funcionarios: Array<Record<string, unknown>>; despesas: Array<Record<string, unknown>>
      chaves: Array<{ id: string; nome: string; tipo: string; funcionarioCustoId: string | null; destinos: Array<{ centroCustoId: string; peso: unknown }> }>
    }

    const novo = await prisma.$transaction(async (tx) => {
      const mapa = await tx.mapaCusto.create({
        data: {
          empresaId: user.empresaId,
          competencia: body.competencia,
          descricao: o.descricao,
          percEncargos: o.percEncargos,
          horasProdutivasBase: o.horasProdutivasBase,
          ajustePraticarPerc: o.ajustePraticarPerc,
        } as never,
      })
      const mapaId = (mapa as { id: string }).id
      // Mapear ids antigos -> novos para preservar vínculos (centro, chave, funcionário)
      const mapCentro = new Map<string, string>()
      const mapFunc = new Map<string, string>()
      const mapChave = new Map<string, string>()

      for (const c of o.centros) {
        const novoC = await tx.mapaCentro.create({
          data: { ...stripIds(c), empresaId: user.empresaId, mapaCustoId: mapaId } as never,
        })
        mapCentro.set(c.id as string, (novoC as { id: string }).id)
      }
      for (const f of o.funcionarios) {
        const novoF = await tx.funcionarioCusto.create({
          data: {
            ...stripIds(f),
            empresaId: user.empresaId,
            mapaCustoId: mapaId,
            centroCustoId: f.centroCustoId ? mapCentro.get(f.centroCustoId as string) ?? null : null,
          } as never,
        })
        mapFunc.set(f.id as string, (novoF as { id: string }).id)
      }
      for (const k of o.chaves) {
        const novoK = await tx.chaveRateio.create({
          data: {
            empresaId: user.empresaId,
            mapaCustoId: mapaId,
            nome: k.nome,
            tipo: k.tipo,
            funcionarioCustoId: k.funcionarioCustoId ? mapFunc.get(k.funcionarioCustoId) ?? null : null,
            destinos: {
              create: k.destinos.map((d) => ({
                centroCustoId: mapCentro.get(d.centroCustoId) ?? d.centroCustoId,
                peso: d.peso,
              })),
            },
          } as never,
        })
        mapChave.set(k.id, (novoK as { id: string }).id)
      }
      for (const b of o.bens) {
        await tx.bemDepreciar.create({
          data: {
            ...stripIds(b),
            empresaId: user.empresaId,
            mapaCustoId: mapaId,
            centroCustoId: mapCentro.get(b.centroCustoId as string) ?? (b.centroCustoId as string),
          } as never,
        })
      }
      for (const d of o.despesas) {
        await tx.despesaCusto.create({
          data: {
            ...stripIds(d),
            empresaId: user.empresaId,
            mapaCustoId: mapaId,
            chaveRateioId: mapChave.get(d.chaveRateioId as string) ?? (d.chaveRateioId as string),
          } as never,
        })
      }
      return mapa
    })
    return reply.status(201).send(novo)
  })

  // POST /mapa-custo/:id/fechar — torna imutável
  app.post('/mapa-custo/:id/fechar', async (request, reply) => {
    const user = request.user as User
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const mapa = await getMapaDaEmpresa(id, user.empresaId)
    if (!mapa) return reply.status(404).send({ message: 'Mapa não encontrado' })
    const atualizado = await prisma.mapaCusto.update({
      where: { id },
      data: { status: 'FECHADO', fechadoEm: new Date() } as never,
    })
    return atualizado
  })

  // ══════════════════════════════════════════════════════════════════════
  // Cadastros do mapa — CRUD (todos exigem mapa RASCUNHO)
  // ══════════════════════════════════════════════════════════════════════

  function calcHorasProdutivas(natureza: string, unidades: number, extras: number, base: number): number | null {
    if (natureza !== 'PRODUTIVO') return null
    return unidades * base + extras
  }

  // --- Centros ---
  app.post('/mapa-custo/:id/centros', async (request, reply) => {
    const user = request.user as User
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = centroSchema.parse(request.body)
    const chk = await assertMapaEditavel(id, user.empresaId)
    if (chk.erro === 404) return reply.status(404).send({ message: 'Mapa não encontrado' })
    if (chk.erro === 409) return reply.status(409).send({ message: 'Mapa fechado' })
    const base = (chk.mapa as { horasProdutivasBase: number }).horasProdutivasBase
    const horas = calcHorasProdutivas(body.natureza, body.unidadesProdutivas ?? 1, body.horasExtras ?? 0, base)
    const centro = await prisma.mapaCentro.create({
      data: { ...body, empresaId: user.empresaId, mapaCustoId: id, horasProdutivas: horas } as never,
    })
    return reply.status(201).send(centro)
  })

  app.put('/mapa-custo/:id/centros/:centroId', async (request, reply) => {
    const user = request.user as User
    const { id, centroId } = z.object({ id: z.string().uuid(), centroId: z.string().uuid() }).parse(request.params)
    const body = centroSchema.partial().parse(request.body)
    const chk = await assertMapaEditavel(id, user.empresaId)
    if (chk.erro === 404) return reply.status(404).send({ message: 'Mapa não encontrado' })
    if (chk.erro === 409) return reply.status(409).send({ message: 'Mapa fechado' })
    const atual = await prisma.mapaCentro.findFirst({ where: { id: centroId, mapaCustoId: id } as never })
    if (!atual) return reply.status(404).send({ message: 'Centro não encontrado' })
    const a = atual as { natureza: string; unidadesProdutivas: number; horasExtras: number }
    const base = (chk.mapa as { horasProdutivasBase: number }).horasProdutivasBase
    const horas = calcHorasProdutivas(
      body.natureza ?? a.natureza,
      body.unidadesProdutivas ?? a.unidadesProdutivas,
      body.horasExtras ?? a.horasExtras,
      base,
    )
    const centro = await prisma.mapaCentro.update({ where: { id: centroId }, data: { ...body, horasProdutivas: horas } as never })
    return centro
  })

  app.delete('/mapa-custo/:id/centros/:centroId', async (request, reply) => {
    const user = request.user as User
    const { id, centroId } = z.object({ id: z.string().uuid(), centroId: z.string().uuid() }).parse(request.params)
    const chk = await assertMapaEditavel(id, user.empresaId)
    if (chk.erro === 404) return reply.status(404).send({ message: 'Mapa não encontrado' })
    if (chk.erro === 409) return reply.status(409).send({ message: 'Mapa fechado' })
    await prisma.mapaCentro.deleteMany({ where: { id: centroId, mapaCustoId: id } as never })
    return reply.status(204).send()
  })

  // --- Bens ---
  app.post('/mapa-custo/:id/bens', async (request, reply) => {
    const user = request.user as User
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = bemSchema.parse(request.body)
    const chk = await assertMapaEditavel(id, user.empresaId)
    if (chk.erro === 404) return reply.status(404).send({ message: 'Mapa não encontrado' })
    if (chk.erro === 409) return reply.status(409).send({ message: 'Mapa fechado' })
    const dep = depreciacaoBem({ id: '', centroCustoId: body.centroCustoId, valor: body.valor, estado: body.estado, anosVidaUtil: body.anosVidaUtil, residualPerc: body.residualPerc ?? 0 })
    const bem = await prisma.bemDepreciar.create({
      data: { ...body, residualPerc: body.residualPerc ?? 0, empresaId: user.empresaId, mapaCustoId: id, depreciacaoMensal: dep } as never,
    })
    return reply.status(201).send(bem)
  })

  app.put('/mapa-custo/:id/bens/:bemId', async (request, reply) => {
    const user = request.user as User
    const { id, bemId } = z.object({ id: z.string().uuid(), bemId: z.string().uuid() }).parse(request.params)
    const body = bemSchema.partial().parse(request.body)
    const chk = await assertMapaEditavel(id, user.empresaId)
    if (chk.erro === 404) return reply.status(404).send({ message: 'Mapa não encontrado' })
    if (chk.erro === 409) return reply.status(409).send({ message: 'Mapa fechado' })
    const atual = await prisma.bemDepreciar.findFirst({ where: { id: bemId, mapaCustoId: id } as never })
    if (!atual) return reply.status(404).send({ message: 'Bem não encontrado' })
    const a = atual as { centroCustoId: string; valor: unknown; estado: string; anosVidaUtil: number; residualPerc: unknown }
    const dep = depreciacaoBem({
      id: '', centroCustoId: body.centroCustoId ?? a.centroCustoId,
      valor: body.valor ?? (a.valor as number), estado: body.estado ?? a.estado,
      anosVidaUtil: body.anosVidaUtil ?? a.anosVidaUtil, residualPerc: body.residualPerc ?? (a.residualPerc as number),
    })
    const bem = await prisma.bemDepreciar.update({ where: { id: bemId }, data: { ...body, depreciacaoMensal: dep } as never })
    return bem
  })

  app.delete('/mapa-custo/:id/bens/:bemId', async (request, reply) => {
    const user = request.user as User
    const { id, bemId } = z.object({ id: z.string().uuid(), bemId: z.string().uuid() }).parse(request.params)
    const chk = await assertMapaEditavel(id, user.empresaId)
    if (chk.erro === 404) return reply.status(404).send({ message: 'Mapa não encontrado' })
    if (chk.erro === 409) return reply.status(409).send({ message: 'Mapa fechado' })
    await prisma.bemDepreciar.deleteMany({ where: { id: bemId, mapaCustoId: id } as never })
    return reply.status(204).send()
  })

  // --- Funcionários ---
  app.post('/mapa-custo/:id/funcionarios', async (request, reply) => {
    const user = request.user as User
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = funcionarioSchema.parse(request.body)
    const chk = await assertMapaEditavel(id, user.empresaId)
    if (chk.erro === 404) return reply.status(404).send({ message: 'Mapa não encontrado' })
    if (chk.erro === 409) return reply.status(409).send({ message: 'Mapa fechado' })
    const func = await prisma.funcionarioCusto.create({
      data: { ...body, ajudaCusto: body.ajudaCusto ?? 0, rateado: body.rateado ?? false, empresaId: user.empresaId, mapaCustoId: id } as never,
    })
    return reply.status(201).send(func)
  })

  app.put('/mapa-custo/:id/funcionarios/:funcId', async (request, reply) => {
    const user = request.user as User
    const { id, funcId } = z.object({ id: z.string().uuid(), funcId: z.string().uuid() }).parse(request.params)
    const body = funcionarioSchema.partial().parse(request.body)
    const chk = await assertMapaEditavel(id, user.empresaId)
    if (chk.erro === 404) return reply.status(404).send({ message: 'Mapa não encontrado' })
    if (chk.erro === 409) return reply.status(409).send({ message: 'Mapa fechado' })
    const atual = await prisma.funcionarioCusto.findFirst({ where: { id: funcId, mapaCustoId: id } as never })
    if (!atual) return reply.status(404).send({ message: 'Funcionário não encontrado' })
    const func = await prisma.funcionarioCusto.update({ where: { id: funcId }, data: body as never })
    return func
  })

  app.delete('/mapa-custo/:id/funcionarios/:funcId', async (request, reply) => {
    const user = request.user as User
    const { id, funcId } = z.object({ id: z.string().uuid(), funcId: z.string().uuid() }).parse(request.params)
    const chk = await assertMapaEditavel(id, user.empresaId)
    if (chk.erro === 404) return reply.status(404).send({ message: 'Mapa não encontrado' })
    if (chk.erro === 409) return reply.status(409).send({ message: 'Mapa fechado' })
    await prisma.funcionarioCusto.deleteMany({ where: { id: funcId, mapaCustoId: id } as never })
    return reply.status(204).send()
  })

  // --- Despesas ---
  app.post('/mapa-custo/:id/despesas', async (request, reply) => {
    const user = request.user as User
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = despesaSchema.parse(request.body)
    const chk = await assertMapaEditavel(id, user.empresaId)
    if (chk.erro === 404) return reply.status(404).send({ message: 'Mapa não encontrado' })
    if (chk.erro === 409) return reply.status(409).send({ message: 'Mapa fechado' })
    const desp = await prisma.despesaCusto.create({
      data: { ...body, empresaId: user.empresaId, mapaCustoId: id } as never,
    })
    return reply.status(201).send(desp)
  })

  app.put('/mapa-custo/:id/despesas/:despId', async (request, reply) => {
    const user = request.user as User
    const { id, despId } = z.object({ id: z.string().uuid(), despId: z.string().uuid() }).parse(request.params)
    const body = despesaSchema.partial().parse(request.body)
    const chk = await assertMapaEditavel(id, user.empresaId)
    if (chk.erro === 404) return reply.status(404).send({ message: 'Mapa não encontrado' })
    if (chk.erro === 409) return reply.status(409).send({ message: 'Mapa fechado' })
    const atual = await prisma.despesaCusto.findFirst({ where: { id: despId, mapaCustoId: id } as never })
    if (!atual) return reply.status(404).send({ message: 'Despesa não encontrada' })
    const desp = await prisma.despesaCusto.update({ where: { id: despId }, data: body as never })
    return desp
  })

  app.delete('/mapa-custo/:id/despesas/:despId', async (request, reply) => {
    const user = request.user as User
    const { id, despId } = z.object({ id: z.string().uuid(), despId: z.string().uuid() }).parse(request.params)
    const chk = await assertMapaEditavel(id, user.empresaId)
    if (chk.erro === 404) return reply.status(404).send({ message: 'Mapa não encontrado' })
    if (chk.erro === 409) return reply.status(409).send({ message: 'Mapa fechado' })
    await prisma.despesaCusto.deleteMany({ where: { id: despId, mapaCustoId: id } as never })
    return reply.status(204).send()
  })

  // --- Chaves de Rateio ---
  app.post('/mapa-custo/:id/chaves', async (request, reply) => {
    const user = request.user as User
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = chaveSchema.parse(request.body)
    const chk = await assertMapaEditavel(id, user.empresaId)
    if (chk.erro === 404) return reply.status(404).send({ message: 'Mapa não encontrado' })
    if (chk.erro === 409) return reply.status(409).send({ message: 'Mapa fechado' })
    const chave = await prisma.chaveRateio.create({
      data: {
        empresaId: user.empresaId, mapaCustoId: id, nome: body.nome, tipo: body.tipo,
        funcionarioCustoId: body.funcionarioCustoId ?? null,
        destinos: { create: body.destinos.map((d) => ({ centroCustoId: d.centroCustoId, peso: d.peso })) },
      } as never,
      include: { destinos: true } as never,
    })
    return reply.status(201).send(chave)
  })

  app.put('/mapa-custo/:id/chaves/:chaveId', async (request, reply) => {
    const user = request.user as User
    const { id, chaveId } = z.object({ id: z.string().uuid(), chaveId: z.string().uuid() }).parse(request.params)
    const body = chaveSchema.partial().parse(request.body)
    const chk = await assertMapaEditavel(id, user.empresaId)
    if (chk.erro === 404) return reply.status(404).send({ message: 'Mapa não encontrado' })
    if (chk.erro === 409) return reply.status(409).send({ message: 'Mapa fechado' })
    const atual = await prisma.chaveRateio.findFirst({ where: { id: chaveId, mapaCustoId: id } as never })
    if (!atual) return reply.status(404).send({ message: 'Chave não encontrada' })
    // Se vierem destinos, substitui todos
    const chave = await prisma.$transaction(async (tx) => {
      if (body.destinos) {
        await tx.destinoRateio.deleteMany({ where: { chaveRateioId: chaveId } as never })
      }
      return tx.chaveRateio.update({
        where: { id: chaveId },
        data: {
          ...(body.nome ? { nome: body.nome } : {}),
          ...(body.tipo ? { tipo: body.tipo } : {}),
          ...(body.funcionarioCustoId !== undefined ? { funcionarioCustoId: body.funcionarioCustoId } : {}),
          ...(body.destinos ? { destinos: { create: body.destinos.map((d) => ({ centroCustoId: d.centroCustoId, peso: d.peso })) } } : {}),
        } as never,
        include: { destinos: true } as never,
      })
    })
    return chave
  })

  app.delete('/mapa-custo/:id/chaves/:chaveId', async (request, reply) => {
    const user = request.user as User
    const { id, chaveId } = z.object({ id: z.string().uuid(), chaveId: z.string().uuid() }).parse(request.params)
    const chk = await assertMapaEditavel(id, user.empresaId)
    if (chk.erro === 404) return reply.status(404).send({ message: 'Mapa não encontrado' })
    if (chk.erro === 409) return reply.status(409).send({ message: 'Mapa fechado' })
    await prisma.chaveRateio.deleteMany({ where: { id: chaveId, mapaCustoId: id } as never })
    return reply.status(204).send()
  })

  // ══════════════════════════════════════════════════════════════════════
  // Cálculo, integração e relatórios
  // ══════════════════════════════════════════════════════════════════════

  // Carrega os cadastros do mapa e monta o input do motor.
  async function carregarInput(mapaId: string, empresaId: string): Promise<{ input: CalcularMapaInput; mapa: Record<string, unknown> } | null> {
    const mapa = await prisma.mapaCusto.findFirst({
      where: { id: mapaId, empresaId } as never,
      include: { centros: true, bens: true, funcionarios: true, despesas: true, chaves: { include: { destinos: true } } } as never,
    })
    if (!mapa) return null
    const m = mapa as never as {
      percEncargos: unknown; horasProdutivasBase: number; ajustePraticarPerc: unknown
      centros: Array<{ id: string; codigo: string; natureza: string; unidadesProdutivas: number; horasExtras: number; chaveRateioId: string | null }>
      bens: Array<{ id: string; centroCustoId: string; valor: unknown; estado: string; anosVidaUtil: number; residualPerc: unknown }>
      funcionarios: Array<{ id: string; centroCustoId: string | null; salario: unknown; ajudaCusto: unknown; rateado: boolean }>
      despesas: Array<{ id: string; valor: unknown; chaveRateioId: string }>
      chaves: Array<{ id: string; tipo: string; funcionarioCustoId: string | null; destinos: Array<{ centroCustoId: string; peso: unknown }> }>
    }
    const input: CalcularMapaInput = {
      parametros: { percEncargos: m.percEncargos as number, horasProdutivasBase: m.horasProdutivasBase, ajustePraticarPerc: m.ajustePraticarPerc as number },
      centros: m.centros.map((c): CentroInput => ({ id: c.id, codigo: c.codigo, natureza: c.natureza, unidadesProdutivas: c.unidadesProdutivas, horasExtras: c.horasExtras, chaveRateioId: c.chaveRateioId })),
      bens: m.bens.map((b) => ({ id: b.id, centroCustoId: b.centroCustoId, valor: b.valor as number, estado: b.estado, anosVidaUtil: b.anosVidaUtil, residualPerc: b.residualPerc as number })),
      funcionarios: m.funcionarios.map((f) => ({ id: f.id, centroCustoId: f.centroCustoId, salario: f.salario as number, ajudaCusto: f.ajudaCusto as number, rateado: f.rateado })),
      despesas: m.despesas.map((d) => ({ id: d.id, valor: d.valor as number, chaveRateioId: d.chaveRateioId })),
      chaves: m.chaves.map((k) => ({ id: k.id, tipo: k.tipo, funcionarioCustoId: k.funcionarioCustoId, destinos: k.destinos.map((x) => ({ centroCustoId: x.centroCustoId, peso: x.peso as number })) })),
    }
    return { input, mapa: mapa as Record<string, unknown> }
  }

  // POST /mapa-custo/:id/calcular — roda o motor e persiste ResultadoCentro + totais
  app.post('/mapa-custo/:id/calcular', async (request, reply) => {
    const user = request.user as User
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const carga = await carregarInput(id, user.empresaId)
    if (!carga) return reply.status(404).send({ message: 'Mapa não encontrado' })
    let calc
    try {
      calc = calcularMapa(carga.input)
    } catch (e) {
      return reply.status(400).send({ message: (e as Error).message })
    }
    await prisma.$transaction(async (tx) => {
      // idempotente: apaga resultados anteriores e recria
      await tx.resultadoCentro.deleteMany({ where: { mapaCustoId: id } as never })
      for (const r of calc.resultados) {
        await tx.resultadoCentro.create({
          data: {
            empresaId: user.empresaId, mapaCustoId: id, centroCustoId: r.centroCustoId,
            salariosEncargos: r.salariosEncargos, depreciacoes: r.depreciacoes, despesas: r.despesas,
            custoFixo: r.custoFixo, rateioAuxiliar: r.rateioAuxiliar, rateioAdministracao: r.rateioAdministracao,
            custoFixoFinal: r.custoFixoFinal, horasProdutivas: r.horasProdutivas,
            custoHoraApurado: r.custoHoraApurado, custoHoraPraticar: r.custoHoraPraticar, ajustePerc: r.ajustePerc,
          } as never,
        })
      }
      await tx.mapaCusto.update({
        where: { id },
        data: {
          custoFixoTotal: calc.totais.custoFixoTotal,
          taxaAdministrativa: calc.totais.taxaAdministrativa,
          totalFuncionarios: calc.totais.totalFuncionarios,
          ativoImobilizado: calc.totais.ativoImobilizado,
          depreciacaoMensal: calc.totais.depreciacaoMensal,
        } as never,
      })
    })
    return { resultados: calc.resultados, totais: calc.totais }
  })

  // POST /mapa-custo/:id/aplicar-orcamento — grava custoHoraPraticar em CentroProducao
  // (permitido mesmo com mapa FECHADO)
  app.post('/mapa-custo/:id/aplicar-orcamento', async (request, reply) => {
    const user = request.user as User
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const mapa = await prisma.mapaCusto.findFirst({
      where: { id, empresaId: user.empresaId } as never,
      include: { centros: true, resultados: true } as never,
    })
    if (!mapa) return reply.status(404).send({ message: 'Mapa não encontrado' })
    const m = mapa as never as {
      centros: Array<{ id: string; centroProducaoId: string | null; descricao: string }>
      resultados: Array<{ centroCustoId: string; custoHoraPraticar: unknown }>
    }
    const resPorCentro = new Map(m.resultados.map((r) => [r.centroCustoId, r.custoHoraPraticar]))
    const aplicados: string[] = []
    const pulados: string[] = []
    for (const c of m.centros) {
      const valor = resPorCentro.get(c.id)
      if (!c.centroProducaoId || valor === undefined) {
        pulados.push(c.descricao)
        continue
      }
      // garante que o CentroProducao é da mesma empresa
      const upd = await prisma.centroProducao.updateMany({
        where: { id: c.centroProducaoId, empresaId: user.empresaId } as never,
        data: { custoHora: valor } as never,
      })
      if (upd.count > 0) aplicados.push(c.descricao)
      else pulados.push(c.descricao)
    }
    return { aplicados, pulados, totalAplicados: aplicados.length, totalPulados: pulados.length }
  })

  // --- Relatórios ---
  app.get('/mapa-custo/:id/relatorios/composicao', async (request, reply) => {
    const user = request.user as User
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const mapa = await prisma.mapaCusto.findFirst({
      where: { id, empresaId: user.empresaId } as never,
      include: { centros: { orderBy: { posicao: 'asc' } }, resultados: true } as never,
    })
    if (!mapa) return reply.status(404).send({ message: 'Mapa não encontrado' })
    const m = mapa as never as { centros: Array<{ id: string; codigo: string; descricao: string; natureza: string }>; resultados: Array<Record<string, unknown>> }
    const resPorCentro = new Map(m.resultados.map((r) => [r.centroCustoId as string, r]))
    const linhas = m.centros.map((c) => ({ centro: c, resultado: resPorCentro.get(c.id) ?? null }))
    return { linhas }
  })

  app.get('/mapa-custo/:id/relatorios/distribuicao', async (request, reply) => {
    const user = request.user as User
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const mapa = await prisma.mapaCusto.findFirst({
      where: { id, empresaId: user.empresaId } as never,
      include: { centros: true, resultados: true } as never,
    })
    if (!mapa) return reply.status(404).send({ message: 'Mapa não encontrado' })
    const m = mapa as never as { custoFixoTotal: unknown; centros: Array<{ id: string; descricao: string }>; resultados: Array<{ centroCustoId: string; custoFixo: unknown }> }
    const total = Number(m.custoFixoTotal ?? 0)
    const nomePorCentro = new Map(m.centros.map((c) => [c.id, c.descricao]))
    const linhas = m.resultados
      .map((r) => ({ centro: nomePorCentro.get(r.centroCustoId) ?? r.centroCustoId, valor: Number(r.custoFixo), percentual: total > 0 ? (Number(r.custoFixo) / total) * 100 : 0 }))
      .sort((a, b) => b.valor - a.valor)
    return { total, linhas }
  })

  app.get('/mapa-custo/:id/relatorios/custo-hora', async (request, reply) => {
    const user = request.user as User
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const mapa = await prisma.mapaCusto.findFirst({
      where: { id, empresaId: user.empresaId } as never,
      include: { centros: { orderBy: { posicao: 'asc' } }, resultados: true } as never,
    })
    if (!mapa) return reply.status(404).send({ message: 'Mapa não encontrado' })
    const m = mapa as never as { centros: Array<{ id: string; descricao: string; natureza: string }>; resultados: Array<Record<string, unknown>> }
    const resPorCentro = new Map(m.resultados.map((r) => [r.centroCustoId as string, r]))
    const linhas = m.centros
      .filter((c) => c.natureza === 'PRODUTIVO')
      .map((c) => {
        const r = resPorCentro.get(c.id) as Record<string, unknown> | undefined
        return {
          centro: c.descricao,
          custoFixoFinal: Number(r?.custoFixoFinal ?? 0),
          horasProdutivas: Number(r?.horasProdutivas ?? 0),
          custoHoraApurado: Number(r?.custoHoraApurado ?? 0),
          custoHoraPraticar: Number(r?.custoHoraPraticar ?? 0),
          ajustePerc: Number(r?.ajustePerc ?? 0),
        }
      })
    return { linhas }
  })
}

/** Remove campos de identidade/relacionamento ao copiar um registro. */
function stripIds(row: Record<string, unknown>): Record<string, unknown> {
  const { id, empresaId, mapaCustoId, centroCustoId, chaveRateioId, funcionarioCustoId, ...rest } = row
  void id; void empresaId; void mapaCustoId; void centroCustoId; void chaveRateioId; void funcionarioCustoId
  return rest
}
