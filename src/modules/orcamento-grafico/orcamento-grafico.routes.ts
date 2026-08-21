import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'

export async function orcamentoGraficoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // ═══════════════════════════════════════════════════════════════════════════
  // TIPO EMBALAGEM (Especialistas de cálculo)
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/tipos-embalagem', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const query = z.object({
      status: z.enum(['true', 'false']).optional(),
      page: z.coerce.number().int().positive().optional().default(1),
      limit: z.coerce.number().int().positive().max(100).optional().default(50),
    }).parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (query.status) where.status = query.status === 'true'

    const [data, total] = await Promise.all([
      prisma.tipoEmbalagem.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: { codigo: 'asc' } }),
      prisma.tipoEmbalagem.count({ where }),
    ])
    return { data, total, page: query.page, limit: query.limit }
  })

  app.post('/tipos-embalagem', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = z.object({
      codigo: z.string().min(1).max(30),
      descricao: z.string().min(1).max(200),
      formulaLargura: z.string().min(1),
      formulaAltura: z.string().min(1),
      parametros: z.array(z.any()),
      processosObrigatorios: z.array(z.string()).default([]),
      abaColagemMm: z.number().min(0).default(15),
      sangriaMm: z.number().min(0).default(3),
      pincaMm: z.number().min(0).default(10),
      imagemUrl: z.string().optional(),
    }).parse(request.body)

    const existe = await prisma.tipoEmbalagem.findFirst({ where: { empresaId: user.empresaId, codigo: body.codigo } })
    if (existe) return reply.status(409).send({ message: `Código '${body.codigo}' já existe` })

    const tipo = await prisma.tipoEmbalagem.create({ data: { ...body, empresaId: user.empresaId } })
    return reply.status(201).send(tipo)
  })

  app.put('/tipos-embalagem/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      codigo: z.string().min(1).max(30),
      descricao: z.string().min(1).max(200),
      formulaLargura: z.string().min(1),
      formulaAltura: z.string().min(1),
      parametros: z.array(z.any()),
      processosObrigatorios: z.array(z.string()).default([]),
      abaColagemMm: z.number().min(0),
      sangriaMm: z.number().min(0),
      pincaMm: z.number().min(0),
      imagemUrl: z.string().optional().nullable(),
      status: z.boolean().optional(),
    }).parse(request.body)

    const existe = await prisma.tipoEmbalagem.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!existe) return reply.status(404).send({ message: 'Tipo de embalagem não encontrado' })

    const atualizado = await prisma.tipoEmbalagem.update({ where: { id }, data: body })
    return atualizado
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // PREÇO MATÉRIA-PRIMA
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/precos-mp', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const query = z.object({
      tipo: z.string().optional(),
      busca: z.string().optional(),
      status: z.enum(['true', 'false']).optional(),
      page: z.coerce.number().int().positive().optional().default(1),
      limit: z.coerce.number().int().positive().max(100).optional().default(50),
    }).parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (query.tipo) where.tipo = query.tipo
    if (query.status) where.status = query.status === 'true'
    if (query.busca) where.descricao = { contains: query.busca, mode: 'insensitive' }

    const [data, total] = await Promise.all([
      prisma.precoMateriaPrima.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: { descricao: 'asc' } }),
      prisma.precoMateriaPrima.count({ where }),
    ])
    return { data, total, page: query.page, limit: query.limit }
  })

  app.post('/precos-mp', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = z.object({
      descricao: z.string().min(1).max(200),
      tipo: z.enum(['PAPEL', 'TINTA', 'VERNIZ', 'COLA', 'FACA', 'BOPP', 'OUTRO']),
      unidade: z.string().min(1).max(6),
      precoUnitario: z.number().min(0),
      produtoId: z.string().uuid().optional().nullable(),
      fornecedorId: z.string().uuid().optional().nullable(),
    }).parse(request.body)

    const preco = await prisma.precoMateriaPrima.create({ data: { ...body, empresaId: user.empresaId } })
    return reply.status(201).send(preco)
  })

  app.put('/precos-mp/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      descricao: z.string().min(1).max(200),
      tipo: z.enum(['PAPEL', 'TINTA', 'VERNIZ', 'COLA', 'FACA', 'BOPP', 'OUTRO']),
      unidade: z.string().min(1).max(6),
      precoUnitario: z.number().min(0),
      produtoId: z.string().uuid().optional().nullable(),
      fornecedorId: z.string().uuid().optional().nullable(),
      status: z.boolean().optional(),
    }).parse(request.body)

    const existe = await prisma.precoMateriaPrima.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!existe) return reply.status(404).send({ message: 'Preço não encontrado' })

    const atualizado = await prisma.precoMateriaPrima.update({ where: { id }, data: body })
    return atualizado
  })

  app.delete('/precos-mp/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    await prisma.precoMateriaPrima.deleteMany({ where: { id, empresaId: user.empresaId } })
    return reply.status(204).send()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // PARÂMETRO PERDA
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/parametros-perda', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const data = await prisma.parametroPerda.findMany({ where: { empresaId: user.empresaId } })
    return { data }
  })

  app.post('/parametros-perda', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = z.object({
      tipoProcessoId: z.string().uuid().optional().nullable(),
      centroProducaoId: z.string().uuid().optional().nullable(),
      perdaFixaFolhas: z.number().int().min(0).default(0),
      perdaVariavel: z.number().min(0).max(100).default(5),
    }).parse(request.body)

    // Upsert por (empresaId, tipoProcessoId, centroProducaoId)
    const existe = await prisma.parametroPerda.findFirst({
      where: { empresaId: user.empresaId, tipoProcessoId: body.tipoProcessoId || null, centroProducaoId: body.centroProducaoId || null },
    })

    if (existe) {
      const atualizado = await prisma.parametroPerda.update({ where: { id: existe.id }, data: { perdaFixaFolhas: body.perdaFixaFolhas, perdaVariavel: body.perdaVariavel } })
      return atualizado
    }

    const criado = await prisma.parametroPerda.create({ data: { ...body, empresaId: user.empresaId } })
    return reply.status(201).send(criado)
  })

  app.delete('/parametros-perda/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    await prisma.parametroPerda.deleteMany({ where: { id, empresaId: user.empresaId } })
    return reply.status(204).send()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // TABELA MARGEM
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/tabelas-margem', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const data = await prisma.tabelaMargem.findMany({ where: { empresaId: user.empresaId }, orderBy: { nome: 'asc' } })
    return { data }
  })

  app.post('/tabelas-margem', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = z.object({
      nome: z.string().min(1).max(100),
      markup: z.number().min(0).max(500).default(30),
      impostos: z.number().min(0).max(100).default(15),
      comissao: z.number().min(0).max(100).default(5),
      despAdm: z.number().min(0).max(100).default(5),
      descontoMax: z.number().min(0).max(100).default(10),
    }).parse(request.body)

    const existe = await prisma.tabelaMargem.findFirst({ where: { empresaId: user.empresaId, nome: body.nome } })
    if (existe) return reply.status(409).send({ message: `Tabela '${body.nome}' já existe` })

    const tabela = await prisma.tabelaMargem.create({ data: { ...body, empresaId: user.empresaId } })
    return reply.status(201).send(tabela)
  })

  app.put('/tabelas-margem/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      nome: z.string().min(1).max(100),
      markup: z.number().min(0).max(500),
      impostos: z.number().min(0).max(100),
      comissao: z.number().min(0).max(100),
      despAdm: z.number().min(0).max(100),
      descontoMax: z.number().min(0).max(100),
      status: z.boolean().optional(),
    }).parse(request.body)

    const existe = await prisma.tabelaMargem.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!existe) return reply.status(404).send({ message: 'Tabela não encontrada' })

    const atualizado = await prisma.tabelaMargem.update({ where: { id }, data: body })
    return atualizado
  })

  app.delete('/tabelas-margem/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    await prisma.tabelaMargem.deleteMany({ where: { id, empresaId: user.empresaId } })
    return reply.status(204).send()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // CÁLCULO (preview sem salvar)
  // ═══════════════════════════════════════════════════════════════════════════

  app.post('/calcular', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { calcularOrcamentoGrafico } = await import('./orcamento-grafico-calculo.service')

    const body = z.object({
      tipoEmbalagemId: z.string().uuid(),
      medidas: z.record(z.number()),
      papelId: z.string().uuid().optional(),
      gramatura: z.number().positive(),
      precoKgPapel: z.number().positive(),
      maquinaId: z.string().uuid(),
      cores: z.array(z.object({
        nome: z.string(),
        tipo: z.enum(['CMYK', 'PANTONE']),
        coberturaPercent: z.number().min(0).max(100),
        precoKg: z.number().min(0),
        rendimentoM2Kg: z.number().positive().default(25),
      })),
      acabamentos: z.array(z.object({
        tipo: z.string(),
        custoHora: z.number().min(0),
        velocidade: z.number().positive(),
        setupMinutos: z.number().min(0).default(0),
        custoMaterialM2: z.number().min(0).optional(),
        custoMaterialUn: z.number().min(0).optional(),
      })).default([]),
      quantidade: z.number().int().positive(),
      tabelaMargemId: z.string().uuid().optional(),
    }).parse(request.body)

    // Buscar tipo de embalagem
    const tipo = await prisma.tipoEmbalagem.findFirst({ where: { id: body.tipoEmbalagemId, empresaId: user.empresaId } })
    if (!tipo) return reply.status(404).send({ message: 'Tipo de embalagem não encontrado' })

    // Buscar máquina
    const maquina = await prisma.centroProducao.findFirst({ where: { id: body.maquinaId, empresaId: user.empresaId } })
    if (!maquina) return reply.status(404).send({ message: 'Máquina não encontrada' })

    // Buscar tabela de margem (ou usar default)
    let margem = { impostos: 15, comissao: 5, despAdm: 5, markup: 30 }
    if (body.tabelaMargemId) {
      const tabela = await prisma.tabelaMargem.findFirst({ where: { id: body.tabelaMargemId, empresaId: user.empresaId } })
      if (tabela) margem = { impostos: Number(tabela.impostos), comissao: Number(tabela.comissao), despAdm: Number(tabela.despAdm), markup: Number(tabela.markup) }
    }

    // Buscar perdas
    const perdasParam = await prisma.parametroPerda.findMany({ where: { empresaId: user.empresaId } })
    const perdaImpressao = perdasParam.find(p => !p.centroProducaoId) // default geral
    const perdas = {
      impressaoPercent: perdaImpressao ? Number(perdaImpressao.perdaVariavel) : 5,
      impressaoFixaFolhas: perdaImpressao ? perdaImpressao.perdaFixaFolhas : 50,
      corteVincoPercent: 3,
      colagemPercent: 2,
    }

    const resultado = calcularOrcamentoGrafico({
      tipoEmbalagem: {
        formulaLargura: tipo.formulaLargura,
        formulaAltura: tipo.formulaAltura,
        abaColagemMm: Number(tipo.abaColagemMm),
        sangriaMm: Number(tipo.sangriaMm),
        pincaMm: Number(tipo.pincaMm),
      },
      medidas: body.medidas,
      papel: { gramatura: body.gramatura, precoKg: body.precoKgPapel },
      maquinaImpressao: {
        velocidade: Number(maquina.velocidade) || 6000,
        custoHora: Number(maquina.custoHora) || 250,
        formatoLargura: maquina.formatoFolhaLargura || 660,
        formatoAltura: maquina.formatoFolhaAltura || 960,
        pinca: Number(maquina.pincaMm) || 10,
        setupMinutos: 30,
      },
      cores: body.cores,
      acabamentos: body.acabamentos,
      quantidade: body.quantidade,
      perdas,
      margem,
    })

    return resultado
  })
}
