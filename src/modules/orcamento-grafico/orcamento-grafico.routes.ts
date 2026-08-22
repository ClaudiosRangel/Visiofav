import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'

export async function orcamentoGraficoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // ═══════════════════════════════════════════════════════════════════════════
  // TIPO EMBALAGEM (Especialistas de cálculo)
  // ═══════════════════════════════════════════════════════════════════════════

  const tipoEmbalagemSelect = {
    id: true,
    empresaId: true,
    codigo: true,
    descricao: true,
    formulaLargura: true,
    formulaAltura: true,
    parametros: true,
    processosObrigatorios: true,
    abaColagemMm: true,
    sangriaMm: true,
    pincaMm: true,
    imagemUrl: true,
    status: true,
    criadoEm: true,
    atualizadoEm: true,
  } as const

  /**
   * GET /api/orcamento-grafico/tipos-embalagem
   * Lista tipos de embalagem da empresa. Por padrão retorna apenas ativos.
   */
  app.get('/tipos-embalagem', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const query = z.object({
      busca: z.string().optional(),
      status: z.enum(['true', 'false']).optional(),
      page: z.coerce.number().int().positive().optional().default(1),
      limit: z.coerce.number().int().positive().max(100).optional().default(50),
    }).parse(request.query)

    const where: any = { empresaId: user.empresaId }
    // Default: mostra apenas ativos; se query.status informado, filtra pelo valor
    if (query.status !== undefined) {
      where.status = query.status === 'true'
    } else {
      where.status = true
    }
    if (query.busca) {
      where.OR = [
        { codigo: { contains: query.busca, mode: 'insensitive' } },
        { descricao: { contains: query.busca, mode: 'insensitive' } },
      ]
    }

    const [data, total] = await Promise.all([
      prisma.tipoEmbalagem.findMany({
        where,
        select: tipoEmbalagemSelect,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { codigo: 'asc' },
      }),
      prisma.tipoEmbalagem.count({ where }),
    ])
    return { data, total, page: query.page, limit: query.limit }
  })

  /**
   * POST /api/orcamento-grafico/tipos-embalagem
   * Cria um novo tipo de embalagem.
   */
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

    const existe = await prisma.tipoEmbalagem.findUnique({
      where: { empresaId_codigo: { empresaId: user.empresaId, codigo: body.codigo } },
    })
    if (existe) return reply.status(409).send({ message: `Código '${body.codigo}' já existe` })

    const tipo = await prisma.tipoEmbalagem.create({
      data: { ...body, empresaId: user.empresaId },
      select: tipoEmbalagemSelect,
    })
    return reply.status(201).send(tipo)
  })

  /**
   * PUT /api/orcamento-grafico/tipos-embalagem/:id
   * Atualiza um tipo de embalagem existente.
   */
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

    // Verificar conflito de código se estiver alterando
    if (body.codigo !== existe.codigo) {
      const conflito = await prisma.tipoEmbalagem.findUnique({
        where: { empresaId_codigo: { empresaId: user.empresaId, codigo: body.codigo } },
      })
      if (conflito && conflito.id !== id) {
        return reply.status(409).send({ message: `Código '${body.codigo}' já existe` })
      }
    }

    const atualizado = await prisma.tipoEmbalagem.update({
      where: { id },
      data: body,
      select: tipoEmbalagemSelect,
    })
    return atualizado
  })

  /**
   * DELETE /api/orcamento-grafico/tipos-embalagem/:id
   * Soft delete — marca status = false (inativa o tipo).
   */
  app.delete('/tipos-embalagem/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const existe = await prisma.tipoEmbalagem.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!existe) return reply.status(404).send({ message: 'Tipo de embalagem não encontrado' })

    await prisma.tipoEmbalagem.update({
      where: { id },
      data: { status: false },
    })
    return reply.status(204).send()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // PREÇO MATÉRIA-PRIMA
  // ═══════════════════════════════════════════════════════════════════════════

  const precoMateriaPrimaSelect = {
    id: true,
    empresaId: true,
    produtoId: true,
    descricao: true,
    tipo: true,
    unidade: true,
    precoUnitario: true,
    fornecedorId: true,
    dataVigencia: true,
    status: true,
    criadoEm: true,
    atualizadoEm: true,
  } as const

  /**
   * GET /api/orcamento-grafico/precos-mp
   * Lista preços de matéria-prima da empresa. Por padrão retorna apenas ativos.
   */
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
    if (query.status !== undefined) {
      where.status = query.status === 'true'
    } else {
      where.status = true
    }
    if (query.busca) {
      where.descricao = { contains: query.busca, mode: 'insensitive' }
    }

    const [data, total] = await Promise.all([
      prisma.precoMateriaPrima.findMany({
        where,
        select: precoMateriaPrimaSelect,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { descricao: 'asc' },
      }),
      prisma.precoMateriaPrima.count({ where }),
    ])
    return { data, total, page: query.page, limit: query.limit }
  })

  /**
   * POST /api/orcamento-grafico/precos-mp
   * Cria um novo preço de matéria-prima.
   */
  app.post('/precos-mp', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = z.object({
      descricao: z.string().min(1).max(200),
      tipo: z.enum(['PAPEL', 'TINTA', 'VERNIZ', 'COLA', 'FACA', 'BOPP', 'OUTRO']),
      unidade: z.string().min(1).max(6),
      precoUnitario: z.number().min(0),
      produtoId: z.string().uuid().optional().nullable(),
      fornecedorId: z.string().uuid().optional().nullable(),
      dataVigencia: z.coerce.date().optional(),
    }).parse(request.body)

    const preco = await prisma.precoMateriaPrima.create({
      data: { ...body, empresaId: user.empresaId },
      select: precoMateriaPrimaSelect,
    })
    return reply.status(201).send(preco)
  })

  /**
   * PUT /api/orcamento-grafico/precos-mp/:id
   * Atualiza um preço de matéria-prima existente.
   */
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
      dataVigencia: z.coerce.date().optional(),
      status: z.boolean().optional(),
    }).parse(request.body)

    const existe = await prisma.precoMateriaPrima.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!existe) return reply.status(404).send({ message: 'Preço não encontrado' })

    const atualizado = await prisma.precoMateriaPrima.update({
      where: { id },
      data: body,
      select: precoMateriaPrimaSelect,
    })
    return atualizado
  })

  /**
   * DELETE /api/orcamento-grafico/precos-mp/:id
   * Soft delete — marca status = false (inativa o preço).
   */
  app.delete('/precos-mp/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const existe = await prisma.precoMateriaPrima.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!existe) return reply.status(404).send({ message: 'Preço não encontrado' })

    await prisma.precoMateriaPrima.update({
      where: { id },
      data: { status: false },
    })
    return reply.status(204).send()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // PARÂMETRO PERDA
  // ═══════════════════════════════════════════════════════════════════════════

  const parametroPerdaSelect = {
    id: true,
    empresaId: true,
    tipoProcessoId: true,
    centroProducaoId: true,
    perdaFixaFolhas: true,
    perdaVariavel: true,
    criadoEm: true,
  } as const

  /**
   * GET /api/orcamento-grafico/parametros-perda
   * Lista todos os parâmetros de perda da empresa.
   */
  app.get('/parametros-perda', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const data = await prisma.parametroPerda.findMany({
      where: { empresaId: user.empresaId },
      select: parametroPerdaSelect,
      orderBy: { criadoEm: 'asc' },
    })
    return { data }
  })

  /**
   * POST /api/orcamento-grafico/parametros-perda
   * Cria um novo parâmetro de perda (upsert se já existir combinação única).
   */
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
      where: {
        empresaId: user.empresaId,
        tipoProcessoId: body.tipoProcessoId ?? null,
        centroProducaoId: body.centroProducaoId ?? null,
      },
    })

    if (existe) {
      const atualizado = await prisma.parametroPerda.update({
        where: { id: existe.id },
        data: { perdaFixaFolhas: body.perdaFixaFolhas, perdaVariavel: body.perdaVariavel },
        select: parametroPerdaSelect,
      })
      return atualizado
    }

    const criado = await prisma.parametroPerda.create({
      data: { ...body, empresaId: user.empresaId },
      select: parametroPerdaSelect,
    })
    return reply.status(201).send(criado)
  })

  /**
   * PUT /api/orcamento-grafico/parametros-perda/:id
   * Atualiza um parâmetro de perda existente.
   */
  app.put('/parametros-perda/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      tipoProcessoId: z.string().uuid().optional().nullable(),
      centroProducaoId: z.string().uuid().optional().nullable(),
      perdaFixaFolhas: z.number().int().min(0),
      perdaVariavel: z.number().min(0).max(100),
    }).parse(request.body)

    const existe = await prisma.parametroPerda.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!existe) return reply.status(404).send({ message: 'Parâmetro de perda não encontrado' })

    // Verificar conflito de unique constraint se tipoProcessoId ou centroProducaoId mudou
    const tipoProcessoChanged = (body.tipoProcessoId ?? null) !== existe.tipoProcessoId
    const centroProducaoChanged = (body.centroProducaoId ?? null) !== existe.centroProducaoId
    if (tipoProcessoChanged || centroProducaoChanged) {
      const conflito = await prisma.parametroPerda.findFirst({
        where: {
          empresaId: user.empresaId,
          tipoProcessoId: body.tipoProcessoId ?? null,
          centroProducaoId: body.centroProducaoId ?? null,
        },
      })
      if (conflito && conflito.id !== id) {
        return reply.status(409).send({ message: 'Já existe um parâmetro de perda para esta combinação de processo/centro' })
      }
    }

    const atualizado = await prisma.parametroPerda.update({
      where: { id },
      data: body,
      select: parametroPerdaSelect,
    })
    return atualizado
  })

  /**
   * DELETE /api/orcamento-grafico/parametros-perda/:id
   * Hard delete — remove permanentemente o parâmetro de perda.
   */
  app.delete('/parametros-perda/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const existe = await prisma.parametroPerda.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!existe) return reply.status(404).send({ message: 'Parâmetro de perda não encontrado' })

    await prisma.parametroPerda.delete({ where: { id } })
    return reply.status(204).send()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // TABELA MARGEM (Política Comercial)
  // ═══════════════════════════════════════════════════════════════════════════

  const tabelaMargemSelect = {
    id: true,
    empresaId: true,
    nome: true,
    markup: true,
    impostos: true,
    comissao: true,
    despAdm: true,
    descontoMax: true,
    status: true,
    criadoEm: true,
  } as const

  /**
   * GET /api/orcamento-grafico/tabelas-margem
   * Lista tabelas de margem da empresa. Por padrão retorna apenas ativas.
   */
  app.get('/tabelas-margem', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const query = z.object({
      busca: z.string().optional(),
      status: z.enum(['true', 'false']).optional(),
      page: z.coerce.number().int().positive().optional().default(1),
      limit: z.coerce.number().int().positive().max(100).optional().default(50),
    }).parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (query.status !== undefined) {
      where.status = query.status === 'true'
    } else {
      where.status = true
    }
    if (query.busca) {
      where.nome = { contains: query.busca, mode: 'insensitive' }
    }

    const [data, total] = await Promise.all([
      prisma.tabelaMargem.findMany({
        where,
        select: tabelaMargemSelect,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { nome: 'asc' },
      }),
      prisma.tabelaMargem.count({ where }),
    ])
    return { data, total, page: query.page, limit: query.limit }
  })

  /**
   * POST /api/orcamento-grafico/tabelas-margem
   * Cria uma nova tabela de margem.
   */
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

    const tabela = await prisma.tabelaMargem.create({
      data: { ...body, empresaId: user.empresaId },
      select: tabelaMargemSelect,
    })
    return reply.status(201).send(tabela)
  })

  /**
   * PUT /api/orcamento-grafico/tabelas-margem/:id
   * Atualiza uma tabela de margem existente.
   */
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

    // Verificar conflito de nome se estiver alterando
    if (body.nome !== existe.nome) {
      const conflito = await prisma.tabelaMargem.findFirst({
        where: { empresaId: user.empresaId, nome: body.nome },
      })
      if (conflito && conflito.id !== id) {
        return reply.status(409).send({ message: `Tabela '${body.nome}' já existe` })
      }
    }

    const atualizado = await prisma.tabelaMargem.update({
      where: { id },
      data: body,
      select: tabelaMargemSelect,
    })
    return atualizado
  })

  /**
   * DELETE /api/orcamento-grafico/tabelas-margem/:id
   * Soft delete — marca status = false (inativa a tabela).
   */
  app.delete('/tabelas-margem/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const existe = await prisma.tabelaMargem.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!existe) return reply.status(404).send({ message: 'Tabela não encontrada' })

    await prisma.tabelaMargem.update({
      where: { id },
      data: { status: false },
    })
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
      precoKgPapel: z.number().positive().optional(),
      precoKg: z.number().positive().optional(),
      maquinaId: z.string().uuid().optional(),
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

    const precoKgPapel = body.precoKgPapel || body.precoKg
    if (!precoKgPapel) return reply.status(400).send({ message: 'Preço do papel (precoKgPapel ou precoKg) é obrigatório' })

    // Buscar tipo de embalagem
    const tipo = await prisma.tipoEmbalagem.findFirst({ where: { id: body.tipoEmbalagemId, empresaId: user.empresaId } })
    if (!tipo) return reply.status(404).send({ message: 'Tipo de embalagem não encontrado' })

    // Buscar máquina (específica ou primeira de impressão da empresa como default)
    let maquina: any = null
    if (body.maquinaId) {
      maquina = await prisma.centroProducao.findFirst({ where: { id: body.maquinaId, empresaId: user.empresaId } })
    }
    if (!maquina) {
      maquina = await prisma.centroProducao.findFirst({
        where: { empresaId: user.empresaId, status: true, tipoProcesso: { codigo: 'IMPRESSAO' } },
        orderBy: { posicao: 'asc' },
      })
    }
    if (!maquina) return reply.status(404).send({ message: 'Nenhuma máquina de impressão encontrada. Cadastre um Centro de Produção do tipo Impressão.' })

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
      papel: { gramatura: body.gramatura, precoKg: precoKgPapel },
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

  // ═══════════════════════════════════════════════════════════════════════════
  // CRIAR ORÇAMENTO (salva no banco)
  // ═══════════════════════════════════════════════════════════════════════════

  const orcamentoGraficoSelect = {
    id: true,
    empresaId: true,
    numero: true,
    versao: true,
    clienteId: true,
    clienteNome: true,
    vendedorId: true,
    tipoEmbalagemId: true,
    medidas: true,
    resultadoCalculo: true,
    papelId: true,
    papelDescricao: true,
    gramatura: true,
    numCores: true,
    cores: true,
    acabamentos: true,
    quantidade: true,
    custoMaterial: true,
    custoMaquina: true,
    custoAcabamento: true,
    custoTotal: true,
    precoVenda: true,
    precoUnitario: true,
    margemReal: true,
    status: true,
    validadeAte: true,
    motivoRecusa: true,
    aprovadoEm: true,
    pedidoVendaId: true,
    variacoes: true,
    observacoes: true,
    criadoPorId: true,
    criadoEm: true,
    atualizadoEm: true,
  } as const

  /**
   * POST /api/orcamento-grafico
   * Cria e salva um orçamento gráfico.
   * Se `resultadoCalculo` for fornecido diretamente, salva sem recalcular.
   * Caso contrário, executa o cálculo a partir dos parâmetros informados.
   */
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { calcularOrcamentoGrafico: calcular } = await import('./orcamento-grafico-calculo.service')

    const body = z.object({
      // Dados do cliente
      clienteId: z.string().uuid().optional().nullable(),
      clienteNome: z.string().max(200).optional().nullable(),
      vendedorId: z.string().uuid().optional().nullable(),
      // Tipo e medidas
      tipoEmbalagemId: z.string().uuid(),
      medidas: z.record(z.number()),
      // Papel
      papelId: z.string().uuid().optional().nullable(),
      papelDescricao: z.string().max(200).optional().nullable(),
      gramatura: z.number().positive().optional(),
      numCores: z.number().int().min(0).default(4),
      cores: z.array(z.object({
        nome: z.string(),
        tipo: z.enum(['CMYK', 'PANTONE']),
        coberturaPercent: z.number().min(0).max(100),
        precoKg: z.number().min(0),
        rendimentoM2Kg: z.number().positive().default(25),
      })).optional().nullable(),
      acabamentos: z.array(z.object({
        tipo: z.string(),
        custoHora: z.number().min(0),
        velocidade: z.number().positive(),
        setupMinutos: z.number().min(0).default(0),
        custoMaterialM2: z.number().min(0).optional(),
        custoMaterialUn: z.number().min(0).optional(),
      })).optional().nullable(),
      quantidade: z.number().int().positive(),
      // Parâmetros de cálculo (opcionais — só necessários se não vier resultadoCalculo)
      precoKgPapel: z.number().positive().optional(),
      maquinaId: z.string().uuid().optional(),
      tabelaMargemId: z.string().uuid().optional(),
      // Resultado pré-calculado (se o frontend já chamou /calcular)
      resultadoCalculo: z.any().optional().nullable(),
      // Extras
      variacoes: z.any().optional().nullable(),
      observacoes: z.string().optional().nullable(),
      validadeAte: z.coerce.date().optional().nullable(),
      status: z.enum(['RASCUNHO', 'ENVIADO']).default('RASCUNHO'),
    }).parse(request.body)

    // Verificar tipo de embalagem
    const tipo = await prisma.tipoEmbalagem.findFirst({
      where: { id: body.tipoEmbalagemId, empresaId: user.empresaId },
    })
    if (!tipo) return reply.status(404).send({ message: 'Tipo de embalagem não encontrado' })

    // Se resultadoCalculo não foi fornecido, calcular agora
    let resultadoCalculo = body.resultadoCalculo
    let custoMaterial: number | null = null
    let custoMaquina: number | null = null
    let custoAcabamento: number | null = null
    let custoTotal: number | null = null
    let precoVenda: number | null = null
    let precoUnitario: number | null = null
    let margemReal: number | null = null

    if (!resultadoCalculo && body.gramatura && body.precoKgPapel && body.maquinaId) {
      // Buscar máquina
      const maquina = await prisma.centroProducao.findFirst({
        where: { id: body.maquinaId, empresaId: user.empresaId },
      })
      if (!maquina) return reply.status(404).send({ message: 'Máquina não encontrada' })

      // Buscar tabela de margem
      let margem = { impostos: 15, comissao: 5, despAdm: 5, markup: 30 }
      if (body.tabelaMargemId) {
        const tabela = await prisma.tabelaMargem.findFirst({
          where: { id: body.tabelaMargemId, empresaId: user.empresaId },
        })
        if (tabela) {
          margem = {
            impostos: Number(tabela.impostos),
            comissao: Number(tabela.comissao),
            despAdm: Number(tabela.despAdm),
            markup: Number(tabela.markup),
          }
        }
      }

      // Buscar perdas
      const perdasParam = await prisma.parametroPerda.findMany({
        where: { empresaId: user.empresaId },
      })
      const perdaImpressao = perdasParam.find(p => !p.centroProducaoId)
      const perdas = {
        impressaoPercent: perdaImpressao ? Number(perdaImpressao.perdaVariavel) : 5,
        impressaoFixaFolhas: perdaImpressao ? perdaImpressao.perdaFixaFolhas : 50,
        corteVincoPercent: 3,
        colagemPercent: 2,
      }

      const resultado = calcular({
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
        cores: (body.cores || []) as Array<{ nome: string; tipo: 'CMYK' | 'PANTONE'; coberturaPercent: number; precoKg: number; rendimentoM2Kg: number }>,
        acabamentos: (body.acabamentos || []) as Array<{ tipo: string; custoHora: number; velocidade: number; setupMinutos: number; custoMaterialM2?: number; custoMaterialUn?: number }>,
        quantidade: body.quantidade,
        perdas,
        margem,
      })

      resultadoCalculo = resultado
      custoMaterial = resultado.papel.custo + resultado.tinta.custoTotal
      custoMaquina = resultado.maquinas.custoTotal
      custoAcabamento = resultado.acabamentos.custoTotal
      custoTotal = resultado.custoTotal
      precoVenda = resultado.precoVenda
      precoUnitario = resultado.precoUnitario
      margemReal = resultado.margemReal
    } else if (resultadoCalculo) {
      // Extrair valores do resultado pré-calculado
      custoMaterial = (resultadoCalculo.papel?.custo ?? 0) + (resultadoCalculo.tinta?.custoTotal ?? 0)
      custoMaquina = resultadoCalculo.maquinas?.custoTotal ?? null
      custoAcabamento = resultadoCalculo.acabamentos?.custoTotal ?? null
      custoTotal = resultadoCalculo.custoTotal ?? null
      precoVenda = resultadoCalculo.precoVenda ?? null
      precoUnitario = resultadoCalculo.precoUnitario ?? null
      margemReal = resultadoCalculo.margemReal ?? null
    }

    // Gerar número sequencial por empresa
    const ultimo = await prisma.orcamentoGrafico.findFirst({
      where: { empresaId: user.empresaId },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    })
    const numero = (ultimo?.numero ?? 0) + 1

    // Criar o orçamento
    const orcamento = await prisma.orcamentoGrafico.create({
      data: {
        empresaId: user.empresaId,
        numero,
        versao: 1,
        clienteId: body.clienteId ?? null,
        clienteNome: body.clienteNome ?? null,
        vendedorId: body.vendedorId ?? null,
        tipoEmbalagemId: body.tipoEmbalagemId,
        medidas: body.medidas,
        resultadoCalculo: resultadoCalculo ?? undefined,
        papelId: body.papelId ?? null,
        papelDescricao: body.papelDescricao ?? null,
        gramatura: body.gramatura ?? null,
        numCores: body.numCores,
        cores: body.cores ?? undefined,
        acabamentos: body.acabamentos ?? undefined,
        quantidade: body.quantidade,
        custoMaterial,
        custoMaquina,
        custoAcabamento,
        custoTotal,
        precoVenda,
        precoUnitario,
        margemReal,
        status: body.status,
        validadeAte: body.validadeAte ?? null,
        variacoes: body.variacoes ?? undefined,
        observacoes: body.observacoes ?? null,
        criadoPorId: user.id,
      },
      select: orcamentoGraficoSelect,
    })

    return reply.status(201).send(orcamento)
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // LISTAR ORÇAMENTOS (paginado com filtros)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/orcamento-grafico
   * Lista orçamentos gráficos da empresa com paginação e filtros.
   */
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const query = z.object({
      page: z.coerce.number().int().positive().optional().default(1),
      limit: z.coerce.number().int().positive().max(100).optional().default(20),
      status: z.enum(['RASCUNHO', 'ENVIADO', 'APROVADO', 'RECUSADO', 'VENCIDO']).optional(),
      clienteId: z.string().uuid().optional(),
      clienteNome: z.string().optional(),
      vendedorId: z.string().uuid().optional(),
      dataInicio: z.coerce.date().optional(),
      dataFim: z.coerce.date().optional(),
      busca: z.string().optional(),
    }).parse(request.query)

    const where: any = { empresaId: user.empresaId }

    if (query.status) where.status = query.status
    if (query.clienteId) where.clienteId = query.clienteId
    if (query.vendedorId) where.vendedorId = query.vendedorId

    if (query.clienteNome) {
      where.clienteNome = { contains: query.clienteNome, mode: 'insensitive' }
    }

    if (query.dataInicio || query.dataFim) {
      where.criadoEm = {}
      if (query.dataInicio) where.criadoEm.gte = query.dataInicio
      if (query.dataFim) where.criadoEm.lte = query.dataFim
    }

    if (query.busca) {
      where.OR = [
        { numero: { equals: isNaN(Number(query.busca)) ? undefined : Number(query.busca) } },
        { clienteNome: { contains: query.busca, mode: 'insensitive' } },
      ].filter(c => Object.values(c)[0] !== undefined)
    }

    // Usa orcamentoGraficoSelect mas exclui resultadoCalculo (pode ser JSON grande)
    // e inclui tipoEmbalagem para exibir na listagem
    const listSelect = {
      ...orcamentoGraficoSelect,
      resultadoCalculo: false,
      tipoEmbalagem: {
        select: { id: true, codigo: true, descricao: true },
      },
    } as const

    const [data, total] = await Promise.all([
      prisma.orcamentoGrafico.findMany({
        where,
        select: listSelect,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { criadoEm: 'desc' },
      }),
      prisma.orcamentoGrafico.count({ where }),
    ])

    return { data, total, page: query.page, limit: query.limit }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // DETALHE COMPLETO (GET /:id)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/orcamento-grafico/:id
   * Retorna orçamento completo por ID, incluindo resultadoCalculo e tipoEmbalagem.
   */
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const orcamento = await prisma.orcamentoGrafico.findFirst({
      where: { id, empresaId: user.empresaId },
      select: {
        ...orcamentoGraficoSelect,
        tipoEmbalagem: {
          select: { id: true, codigo: true, descricao: true, formulaLargura: true, formulaAltura: true, parametros: true },
        },
      },
    })

    if (!orcamento) return reply.status(404).send({ message: 'Orçamento não encontrado' })
    return orcamento
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // ATUALIZAR ORÇAMENTO EM RASCUNHO (PUT /:id)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * PUT /api/orcamento-grafico/:id
   * Atualiza orçamento — só permitido se status for RASCUNHO.
   * Se parâmetros de cálculo mudarem e forem suficientes, recalcula.
   */
  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const { calcularOrcamentoGrafico: calcular } = await import('./orcamento-grafico-calculo.service')

    const body = z.object({
      clienteId: z.string().uuid().optional().nullable(),
      clienteNome: z.string().max(200).optional().nullable(),
      vendedorId: z.string().uuid().optional().nullable(),
      tipoEmbalagemId: z.string().uuid().optional(),
      medidas: z.record(z.number()).optional(),
      papelId: z.string().uuid().optional().nullable(),
      papelDescricao: z.string().max(200).optional().nullable(),
      gramatura: z.number().positive().optional().nullable(),
      numCores: z.number().int().min(0).optional(),
      cores: z.array(z.object({
        nome: z.string(),
        tipo: z.enum(['CMYK', 'PANTONE']),
        coberturaPercent: z.number().min(0).max(100),
        precoKg: z.number().min(0),
        rendimentoM2Kg: z.number().positive().default(25),
      })).optional().nullable(),
      acabamentos: z.array(z.object({
        tipo: z.string(),
        custoHora: z.number().min(0),
        velocidade: z.number().positive(),
        setupMinutos: z.number().min(0).default(0),
        custoMaterialM2: z.number().min(0).optional(),
        custoMaterialUn: z.number().min(0).optional(),
      })).optional().nullable(),
      quantidade: z.number().int().positive().optional(),
      precoKgPapel: z.number().positive().optional(),
      maquinaId: z.string().uuid().optional(),
      tabelaMargemId: z.string().uuid().optional(),
      resultadoCalculo: z.any().optional().nullable(),
      variacoes: z.any().optional().nullable(),
      observacoes: z.string().optional().nullable(),
      validadeAte: z.coerce.date().optional().nullable(),
    }).parse(request.body)

    // Buscar orçamento existente
    const existente = await prisma.orcamentoGrafico.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true, status: true, tipoEmbalagemId: true, quantidade: true, medidas: true },
    })
    if (!existente) return reply.status(404).send({ message: 'Orçamento não encontrado' })
    if (existente.status !== 'RASCUNHO') {
      return reply.status(400).send({ message: 'Só é possível editar orçamentos em RASCUNHO' })
    }

    // Preparar dados de atualização
    const updateData: any = {}
    if (body.clienteId !== undefined) updateData.clienteId = body.clienteId
    if (body.clienteNome !== undefined) updateData.clienteNome = body.clienteNome
    if (body.vendedorId !== undefined) updateData.vendedorId = body.vendedorId
    if (body.tipoEmbalagemId !== undefined) updateData.tipoEmbalagemId = body.tipoEmbalagemId
    if (body.medidas !== undefined) updateData.medidas = body.medidas
    if (body.papelId !== undefined) updateData.papelId = body.papelId
    if (body.papelDescricao !== undefined) updateData.papelDescricao = body.papelDescricao
    if (body.gramatura !== undefined) updateData.gramatura = body.gramatura
    if (body.numCores !== undefined) updateData.numCores = body.numCores
    if (body.cores !== undefined) updateData.cores = body.cores ?? undefined
    if (body.acabamentos !== undefined) updateData.acabamentos = body.acabamentos ?? undefined
    if (body.quantidade !== undefined) updateData.quantidade = body.quantidade
    if (body.variacoes !== undefined) updateData.variacoes = body.variacoes ?? undefined
    if (body.observacoes !== undefined) updateData.observacoes = body.observacoes
    if (body.validadeAte !== undefined) updateData.validadeAte = body.validadeAte

    // Recalcular se temos parâmetros suficientes
    const tipoEmbalagemId = body.tipoEmbalagemId ?? existente.tipoEmbalagemId
    const quantidade = body.quantidade ?? existente.quantidade
    const medidas = body.medidas ?? (existente.medidas as Record<string, number>)

    if (body.resultadoCalculo) {
      // Resultado pré-calculado fornecido
      updateData.resultadoCalculo = body.resultadoCalculo
      updateData.custoMaterial = (body.resultadoCalculo.papel?.custo ?? 0) + (body.resultadoCalculo.tinta?.custoTotal ?? 0)
      updateData.custoMaquina = body.resultadoCalculo.maquinas?.custoTotal ?? null
      updateData.custoAcabamento = body.resultadoCalculo.acabamentos?.custoTotal ?? null
      updateData.custoTotal = body.resultadoCalculo.custoTotal ?? null
      updateData.precoVenda = body.resultadoCalculo.precoVenda ?? null
      updateData.precoUnitario = body.resultadoCalculo.precoUnitario ?? null
      updateData.margemReal = body.resultadoCalculo.margemReal ?? null
    } else if (body.gramatura && body.precoKgPapel && body.maquinaId) {
      // Recalcular com os novos parâmetros
      const tipo = await prisma.tipoEmbalagem.findFirst({ where: { id: tipoEmbalagemId, empresaId: user.empresaId } })
      if (!tipo) return reply.status(404).send({ message: 'Tipo de embalagem não encontrado' })

      const maquina = await prisma.centroProducao.findFirst({ where: { id: body.maquinaId, empresaId: user.empresaId } })
      if (!maquina) return reply.status(404).send({ message: 'Máquina não encontrada' })

      let margem = { impostos: 15, comissao: 5, despAdm: 5, markup: 30 }
      if (body.tabelaMargemId) {
        const tabela = await prisma.tabelaMargem.findFirst({ where: { id: body.tabelaMargemId, empresaId: user.empresaId } })
        if (tabela) margem = { impostos: Number(tabela.impostos), comissao: Number(tabela.comissao), despAdm: Number(tabela.despAdm), markup: Number(tabela.markup) }
      }

      const perdasParam = await prisma.parametroPerda.findMany({ where: { empresaId: user.empresaId } })
      const perdaImpressao = perdasParam.find(p => !p.centroProducaoId)
      const perdas = {
        impressaoPercent: perdaImpressao ? Number(perdaImpressao.perdaVariavel) : 5,
        impressaoFixaFolhas: perdaImpressao ? perdaImpressao.perdaFixaFolhas : 50,
        corteVincoPercent: 3,
        colagemPercent: 2,
      }

      const resultado = calcular({
        tipoEmbalagem: {
          formulaLargura: tipo.formulaLargura,
          formulaAltura: tipo.formulaAltura,
          abaColagemMm: Number(tipo.abaColagemMm),
          sangriaMm: Number(tipo.sangriaMm),
          pincaMm: Number(tipo.pincaMm),
        },
        medidas,
        papel: { gramatura: body.gramatura, precoKg: body.precoKgPapel },
        maquinaImpressao: {
          velocidade: Number(maquina.velocidade) || 6000,
          custoHora: Number(maquina.custoHora) || 250,
          formatoLargura: maquina.formatoFolhaLargura || 660,
          formatoAltura: maquina.formatoFolhaAltura || 960,
          pinca: Number(maquina.pincaMm) || 10,
          setupMinutos: 30,
        },
        cores: (body.cores || []) as Array<{ nome: string; tipo: 'CMYK' | 'PANTONE'; coberturaPercent: number; precoKg: number; rendimentoM2Kg: number }>,
        acabamentos: (body.acabamentos || []) as Array<{ tipo: string; custoHora: number; velocidade: number; setupMinutos: number; custoMaterialM2?: number; custoMaterialUn?: number }>,
        quantidade,
        perdas,
        margem,
      })

      updateData.resultadoCalculo = resultado
      updateData.custoMaterial = resultado.papel.custo + resultado.tinta.custoTotal
      updateData.custoMaquina = resultado.maquinas.custoTotal
      updateData.custoAcabamento = resultado.acabamentos.custoTotal
      updateData.custoTotal = resultado.custoTotal
      updateData.precoVenda = resultado.precoVenda
      updateData.precoUnitario = resultado.precoUnitario
      updateData.margemReal = resultado.margemReal
    }

    const atualizado = await prisma.orcamentoGrafico.update({
      where: { id },
      data: updateData,
      select: orcamentoGraficoSelect,
    })

    return atualizado
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // ENVIAR PROPOSTA (POST /:id/enviar)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/orcamento-grafico/:id/enviar
   * Muda status de RASCUNHO para ENVIADO. Define validadeAte se não definido (+30 dias).
   */
  app.post('/:id/enviar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const orcamento = await prisma.orcamentoGrafico.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true, status: true, validadeAte: true },
    })
    if (!orcamento) return reply.status(404).send({ message: 'Orçamento não encontrado' })
    if (orcamento.status !== 'RASCUNHO') {
      return reply.status(400).send({ message: 'Só é possível enviar orçamentos em RASCUNHO' })
    }

    const validadeAte = orcamento.validadeAte ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

    const atualizado = await prisma.orcamentoGrafico.update({
      where: { id },
      data: { status: 'ENVIADO', validadeAte },
      select: orcamentoGraficoSelect,
    })

    return atualizado
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // APROVAR ORÇAMENTO (POST /:id/aprovar)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/orcamento-grafico/:id/aprovar
   * Muda status de ENVIADO para APROVADO. Gera PedidoVenda se possível.
   */
  app.post('/:id/aprovar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const orcamento = await prisma.orcamentoGrafico.findFirst({
      where: { id, empresaId: user.empresaId },
      select: {
        id: true,
        status: true,
        clienteId: true,
        clienteNome: true,
        vendedorId: true,
        precoVenda: true,
        quantidade: true,
        precoUnitario: true,
      },
    })
    if (!orcamento) return reply.status(404).send({ message: 'Orçamento não encontrado' })
    if (orcamento.status !== 'ENVIADO') {
      return reply.status(400).send({ message: 'Só é possível aprovar orçamentos com status ENVIADO' })
    }

    const updateData: any = {
      status: 'APROVADO',
      aprovadoEm: new Date(),
    }

    // Se tem clienteId, tentar gerar PedidoVenda
    if (orcamento.clienteId) {
      // Buscar tabelaPreco padrão da empresa (primeira ativa)
      const tabelaPreco = await prisma.tabelaPreco.findFirst({
        where: { empresaId: user.empresaId, status: true },
        select: { id: true },
      })

      if (tabelaPreco) {
        // Gerar número de pedido
        const ultimoPedido = await prisma.pedidoVenda.findFirst({
          where: { empresaId: user.empresaId },
          orderBy: { numero: 'desc' },
          select: { numero: true },
        })
        const numeroPedido = (ultimoPedido?.numero ?? 0) + 1

        const pedido = await prisma.pedidoVenda.create({
          data: {
            empresaId: user.empresaId,
            numero: numeroPedido,
            clienteId: orcamento.clienteId,
            vendedorId: orcamento.vendedorId,
            tabelaPrecoId: tabelaPreco.id,
            valorTotal: orcamento.precoVenda ?? 0,
            status: 'RASCUNHO',
            origemPedido: 'ORCAMENTO_GRAFICO',
            orcamentoOrigemId: id,
          },
          select: { id: true, numero: true },
        })

        updateData.pedidoVendaId = pedido.id
      }
    }

    const atualizado = await prisma.orcamentoGrafico.update({
      where: { id },
      data: updateData,
      select: orcamentoGraficoSelect,
    })

    return atualizado
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // RECUSAR ORÇAMENTO (POST /:id/recusar)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/orcamento-grafico/:id/recusar
   * Muda status de ENVIADO para RECUSADO. Exige motivoRecusa.
   */
  app.post('/:id/recusar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const body = z.object({
      motivoRecusa: z.string().min(1, 'Motivo da recusa é obrigatório'),
    }).parse(request.body)

    const orcamento = await prisma.orcamentoGrafico.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true, status: true },
    })
    if (!orcamento) return reply.status(404).send({ message: 'Orçamento não encontrado' })
    if (orcamento.status !== 'ENVIADO') {
      return reply.status(400).send({ message: 'Só é possível recusar orçamentos com status ENVIADO' })
    }

    const atualizado = await prisma.orcamentoGrafico.update({
      where: { id },
      data: { status: 'RECUSADO', motivoRecusa: body.motivoRecusa },
      select: orcamentoGraficoSelect,
    })

    return atualizado
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // COPIAR ORÇAMENTO (POST /:id/copiar)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/orcamento-grafico/:id/copiar
   * Duplica o orçamento como nova versão (mesmo numero, versao + 1), status RASCUNHO.
   */
  app.post('/:id/copiar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const original = await prisma.orcamentoGrafico.findFirst({
      where: { id, empresaId: user.empresaId },
      select: orcamentoGraficoSelect,
    })
    if (!original) return reply.status(404).send({ message: 'Orçamento não encontrado' })

    // Descobrir a maior versão desse número
    const ultimaVersao = await prisma.orcamentoGrafico.findFirst({
      where: { empresaId: user.empresaId, numero: original.numero },
      orderBy: { versao: 'desc' },
      select: { versao: true },
    })
    const novaVersao = (ultimaVersao?.versao ?? 1) + 1

    const copia = await prisma.orcamentoGrafico.create({
      data: {
        empresaId: user.empresaId,
        numero: original.numero,
        versao: novaVersao,
        clienteId: original.clienteId ?? null,
        clienteNome: original.clienteNome ?? null,
        vendedorId: original.vendedorId ?? null,
        tipoEmbalagemId: original.tipoEmbalagemId,
        medidas: original.medidas as any,
        resultadoCalculo: original.resultadoCalculo as any ?? undefined,
        papelId: original.papelId ?? null,
        papelDescricao: original.papelDescricao ?? null,
        gramatura: original.gramatura ?? null,
        numCores: original.numCores,
        cores: original.cores as any ?? undefined,
        acabamentos: original.acabamentos as any ?? undefined,
        quantidade: original.quantidade,
        custoMaterial: original.custoMaterial ?? null,
        custoMaquina: original.custoMaquina ?? null,
        custoAcabamento: original.custoAcabamento ?? null,
        custoTotal: original.custoTotal ?? null,
        precoVenda: original.precoVenda ?? null,
        precoUnitario: original.precoUnitario ?? null,
        margemReal: original.margemReal ?? null,
        status: 'RASCUNHO',
        variacoes: original.variacoes as any ?? undefined,
        observacoes: original.observacoes ?? null,
        criadoPorId: user.id,
      },
      select: orcamentoGraficoSelect,
    })

    return reply.status(201).send(copia)
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // PROPOSTA COMERCIAL PDF (GET /:id/proposta-pdf) — Task 10.2
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/orcamento-grafico/:id/proposta-pdf
   * Gera e retorna PDF da proposta comercial.
   * Somente para RASCUNHO (preview), ENVIADO ou APROVADO.
   */
  app.get('/:id/proposta-pdf', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const orcamento = await prisma.orcamentoGrafico.findFirst({
      where: { id, empresaId: user.empresaId },
      select: {
        ...orcamentoGraficoSelect,
        tipoEmbalagem: { select: { descricao: true } },
      },
    })
    if (!orcamento) return reply.status(404).send({ message: 'Orçamento não encontrado' })

    const statusPermitidos = ['RASCUNHO', 'ENVIADO', 'APROVADO']
    if (!statusPermitidos.includes(orcamento.status)) {
      return reply.status(400).send({ message: 'PDF disponível apenas para orçamentos em Rascunho, Enviado ou Aprovado' })
    }

    // Buscar dados da empresa
    const empresa = await prisma.empresa.findUnique({
      where: { id: user.empresaId },
      select: { razaoSocial: true, cnpj: true, telefone: true, email: true },
    })

    // Buscar dados do cliente se houver clienteId
    let clienteData: { nome: string; cnpj?: string | null } = {
      nome: orcamento.clienteNome || 'Cliente não informado',
    }
    if (orcamento.clienteId) {
      const cliente = await prisma.cliente.findFirst({
        where: { id: orcamento.clienteId, empresaId: user.empresaId },
        select: { razaoSocial: true, cpfCnpj: true },
      })
      if (cliente) {
        clienteData = { nome: cliente.razaoSocial, cnpj: cliente.cpfCnpj }
      }
    }

    const { gerarPropostaPdf } = await import('./orcamento-grafico-proposta-pdf.service')

    const pdfBuffer = await gerarPropostaPdf({
      orcamento: {
        numero: orcamento.numero,
        versao: orcamento.versao,
        tipoEmbalagem: (orcamento as any).tipoEmbalagem?.descricao || 'N/A',
        papelDescricao: orcamento.papelDescricao,
        gramatura: orcamento.gramatura ? Number(orcamento.gramatura) : null,
        numCores: orcamento.numCores,
        cores: orcamento.cores as any,
        acabamentos: orcamento.acabamentos as any,
        quantidade: orcamento.quantidade,
        custoMaterial: orcamento.custoMaterial ? Number(orcamento.custoMaterial) : null,
        custoMaquina: orcamento.custoMaquina ? Number(orcamento.custoMaquina) : null,
        custoAcabamento: orcamento.custoAcabamento ? Number(orcamento.custoAcabamento) : null,
        custoTotal: orcamento.custoTotal ? Number(orcamento.custoTotal) : null,
        precoVenda: orcamento.precoVenda ? Number(orcamento.precoVenda) : null,
        precoUnitario: orcamento.precoUnitario ? Number(orcamento.precoUnitario) : null,
        margemReal: orcamento.margemReal ? Number(orcamento.margemReal) : null,
        variacoes: orcamento.variacoes as any,
        validadeAte: orcamento.validadeAte,
        observacoes: orcamento.observacoes,
        criadoEm: orcamento.criadoEm,
      },
      cliente: clienteData,
      empresa: {
        razaoSocial: empresa?.razaoSocial || 'Empresa',
        cnpj: empresa?.cnpj,
        telefone: empresa?.telefone,
        email: empresa?.email,
      },
    })

    const filename = `proposta-${orcamento.numero}-v${orcamento.versao}.pdf`
    reply.header('Content-Type', 'application/pdf')
    reply.header('Content-Disposition', `inline; filename="${filename}"`)
    return reply.send(pdfBuffer)
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // ENVIAR PROPOSTA POR E-MAIL (POST /:id/enviar-email) — Task 10.3
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/orcamento-grafico/:id/enviar-email
   * Gera PDF e envia por e-mail via SMTP configurado da empresa.
   */
  app.post('/:id/enviar-email', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const body = z.object({
      destinatario: z.string().email('E-mail de destino inválido'),
      mensagem: z.string().optional(),
    }).parse(request.body)

    const orcamento = await prisma.orcamentoGrafico.findFirst({
      where: { id, empresaId: user.empresaId },
      select: {
        ...orcamentoGraficoSelect,
        tipoEmbalagem: { select: { descricao: true } },
      },
    })
    if (!orcamento) return reply.status(404).send({ message: 'Orçamento não encontrado' })

    // Buscar dados da empresa
    const empresa = await prisma.empresa.findUnique({
      where: { id: user.empresaId },
      select: { razaoSocial: true, cnpj: true, telefone: true, email: true },
    })

    // Buscar dados do cliente
    let clienteData: { nome: string; cnpj?: string | null } = {
      nome: orcamento.clienteNome || 'Cliente',
    }
    if (orcamento.clienteId) {
      const cliente = await prisma.cliente.findFirst({
        where: { id: orcamento.clienteId, empresaId: user.empresaId },
        select: { razaoSocial: true, cpfCnpj: true },
      })
      if (cliente) clienteData = { nome: cliente.razaoSocial, cnpj: cliente.cpfCnpj }
    }

    // Gerar PDF
    const { gerarPropostaPdf } = await import('./orcamento-grafico-proposta-pdf.service')
    const pdfBuffer = await gerarPropostaPdf({
      orcamento: {
        numero: orcamento.numero,
        versao: orcamento.versao,
        tipoEmbalagem: (orcamento as any).tipoEmbalagem?.descricao || 'N/A',
        papelDescricao: orcamento.papelDescricao,
        gramatura: orcamento.gramatura ? Number(orcamento.gramatura) : null,
        numCores: orcamento.numCores,
        cores: orcamento.cores as any,
        acabamentos: orcamento.acabamentos as any,
        quantidade: orcamento.quantidade,
        custoMaterial: orcamento.custoMaterial ? Number(orcamento.custoMaterial) : null,
        custoMaquina: orcamento.custoMaquina ? Number(orcamento.custoMaquina) : null,
        custoAcabamento: orcamento.custoAcabamento ? Number(orcamento.custoAcabamento) : null,
        custoTotal: orcamento.custoTotal ? Number(orcamento.custoTotal) : null,
        precoVenda: orcamento.precoVenda ? Number(orcamento.precoVenda) : null,
        precoUnitario: orcamento.precoUnitario ? Number(orcamento.precoUnitario) : null,
        margemReal: orcamento.margemReal ? Number(orcamento.margemReal) : null,
        variacoes: orcamento.variacoes as any,
        validadeAte: orcamento.validadeAte,
        observacoes: orcamento.observacoes,
        criadoEm: orcamento.criadoEm,
      },
      cliente: clienteData,
      empresa: {
        razaoSocial: empresa?.razaoSocial || 'Empresa',
        cnpj: empresa?.cnpj,
        telefone: empresa?.telefone,
        email: empresa?.email,
      },
    })

    // Buscar config SMTP
    const configSmtp = await prisma.configSmtp.findUnique({
      where: { empresaId: user.empresaId },
    })

    if (!configSmtp) {
      console.warn(`[orcamento-grafico] SMTP não configurado para empresa ${user.empresaId}. E-mail não enviado.`)
      return { sucesso: true, message: 'PDF gerado, mas SMTP não configurado. Configure em Configurações > E-mail.' }
    }

    try {
      const nodemailer = require('nodemailer')
      const transporter = nodemailer.createTransport({
        host: configSmtp.host,
        port: configSmtp.porta,
        secure: configSmtp.porta === 465,
        auth: { user: configSmtp.usuario, pass: configSmtp.senha },
        tls: configSmtp.usarTls ? { rejectUnauthorized: false } : undefined,
      })

      const filename = `proposta-${orcamento.numero}-v${orcamento.versao}.pdf`
      const assunto = `Proposta Comercial #${orcamento.numero} — ${empresa?.razaoSocial || 'Vizor ERP'}`
      const mensagemHtml = body.mensagem
        ? `<p>${body.mensagem.replace(/\n/g, '<br>')}</p>`
        : `<p>Prezado(a) ${clienteData.nome},</p><p>Segue em anexo nossa proposta comercial #${orcamento.numero}.</p><p>Atenciosamente,<br>${empresa?.razaoSocial || ''}</p>`

      await transporter.sendMail({
        from: configSmtp.emailFrom || configSmtp.usuario,
        to: body.destinatario,
        subject: assunto,
        html: mensagemHtml,
        attachments: [{
          filename,
          content: pdfBuffer,
          contentType: 'application/pdf',
        }],
      })

      return { sucesso: true, message: `Proposta enviada para ${body.destinatario}` }
    } catch (err: any) {
      console.error('[orcamento-grafico] Erro ao enviar email:', err.message)
      return reply.status(422).send({ message: `Falha ao enviar e-mail: ${err.message}` })
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // IMPORTAÇÃO EM MASSA — Task 11
  // ═══════════════════════════════════════════════════════════════════════════

  // Cache de importação (TTL 30 min)
  const cacheImportacao = new Map<string, { registros: any[]; expira: number }>()

  function limparCacheImportacaoExpirado() {
    const agora = Date.now()
    for (const [key, val] of cacheImportacao) {
      if (val.expira < agora) cacheImportacao.delete(key)
    }
  }

  /**
   * POST /api/orcamento-grafico/importar
   * Upload de CSV para importação de materiais/preços.
   * Retorna preview com validação (não salva).
   */
  app.post('/importar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    limparCacheImportacaoExpirado()

    const file = await request.file()
    if (!file) {
      return reply.status(400).send({ message: 'Nenhum arquivo enviado. Envie um CSV via multipart/form-data.' })
    }

    const nomeArquivo = file.filename.toLowerCase()
    if (!nomeArquivo.endsWith('.csv') && !nomeArquivo.endsWith('.xlsx') && !nomeArquivo.endsWith('.xls')) {
      return reply.status(400).send({ message: 'Formato inválido. Envie CSV (.csv) ou Excel (.xlsx/.xls).' })
    }

    const buffer = await file.toBuffer()
    if (buffer.length > 5 * 1024 * 1024) {
      return reply.status(400).send({ message: 'Arquivo excede o limite de 5MB.' })
    }

    // Parse CSV (suporte básico — linhas separadas por \n, colunas por ; ou ,)
    let registros: Array<{
      descricao: string
      tipo: string
      unidade: string
      precoUnitario: number
      dataVigencia?: string
      valido: boolean
      erros: string[]
    }> = []

    try {
      if (nomeArquivo.endsWith('.csv')) {
        registros = parseCsv(buffer.toString('utf-8'))
      } else {
        // Para xlsx, tentar parse simples (header row + data rows)
        registros = parseXlsx(buffer)
      }
    } catch (err: any) {
      return reply.status(400).send({ message: `Erro ao processar arquivo: ${err.message}` })
    }

    if (registros.length === 0) {
      return reply.status(400).send({ message: 'Nenhum registro válido encontrado no arquivo.' })
    }

    // Gerar ID de importação e cachear
    const importacaoId = randomUUID()
    cacheImportacao.set(importacaoId, {
      registros,
      expira: Date.now() + 30 * 60 * 1000,
    })

    const totalValidos = registros.filter(r => r.valido).length
    const totalErros = registros.filter(r => !r.valido).length

    return {
      importacaoId,
      totalRegistros: registros.length,
      totalValidos,
      totalErros,
      registros: registros.slice(0, 100), // Limita preview a 100 registros
    }
  })

  /**
   * POST /api/orcamento-grafico/importar/confirmar
   * Confirma importação e grava registros válidos como PrecoMateriaPrima.
   */
  app.post('/importar/confirmar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }

    const body = z.object({
      importacaoId: z.string().uuid(),
    }).parse(request.body)

    const cached = cacheImportacao.get(body.importacaoId)
    if (!cached || cached.expira < Date.now()) {
      cacheImportacao.delete(body.importacaoId)
      return reply.status(404).send({ message: 'Importação não encontrada ou expirada. Faça o upload novamente.' })
    }

    const registrosValidos = cached.registros.filter(r => r.valido)
    if (registrosValidos.length === 0) {
      return reply.status(400).send({ message: 'Nenhum registro válido para importar.' })
    }

    // Criar registros em lote
    let criados = 0
    for (const reg of registrosValidos) {
      try {
        await prisma.precoMateriaPrima.create({
          data: {
            empresaId: user.empresaId,
            descricao: reg.descricao,
            tipo: reg.tipo,
            unidade: reg.unidade,
            precoUnitario: reg.precoUnitario,
            dataVigencia: reg.dataVigencia ? new Date(reg.dataVigencia) : new Date(),
          },
        })
        criados++
      } catch (err: any) {
        // Ignora erros individuais (ex: duplicate) e continua
        console.warn(`[importar] Erro ao criar registro "${reg.descricao}": ${err.message}`)
      }
    }

    cacheImportacao.delete(body.importacaoId)

    return {
      sucesso: true,
      message: `${criados} de ${registrosValidos.length} registros importados com sucesso.`,
      totalImportados: criados,
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // DASHBOARD COMERCIAL — Task 12
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/orcamento-grafico/dashboard
   * Retorna indicadores comerciais do módulo de orçamento gráfico.
   */
  app.get('/dashboard', async (request) => {
    const user = request.user as { id: string; empresaId: string }

    const query = z.object({
      periodo: z.enum(['30', '90', '365']).optional().default('90'),
    }).parse(request.query)

    const diasAtras = parseInt(query.periodo)
    const dataInicio = new Date(Date.now() - diasAtras * 24 * 60 * 60 * 1000)

    const whereBase = { empresaId: user.empresaId }
    const wherePeriodo = { empresaId: user.empresaId, criadoEm: { gte: dataInicio } }

    // Contagem total e por status
    const [total, convertidos, statusCounts, aprovadosComPreco] = await Promise.all([
      prisma.orcamentoGrafico.count({ where: wherePeriodo }),
      prisma.orcamentoGrafico.count({ where: { ...wherePeriodo, status: 'APROVADO' } }),
      prisma.orcamentoGrafico.groupBy({
        by: ['status'],
        where: wherePeriodo,
        _count: { id: true },
      }),
      prisma.orcamentoGrafico.findMany({
        where: { ...wherePeriodo, status: 'APROVADO', precoVenda: { not: null } },
        select: { precoVenda: true },
      }),
    ])

    // Taxa de conversão
    const taxaConversao = total > 0 ? Math.round((convertidos / total) * 10000) / 100 : 0

    // Ticket médio
    const somaAprovados = aprovadosComPreco.reduce((acc, o) => acc + Number(o.precoVenda || 0), 0)
    const ticketMedio = convertidos > 0 ? Math.round(somaAprovados / convertidos * 100) / 100 : 0

    // Pipeline (funil) — contagem global (sem filtro de período)
    const pipeline = await prisma.orcamentoGrafico.groupBy({
      by: ['status'],
      where: whereBase,
      _count: { id: true },
    })

    const pipelineMap: Record<string, number> = {}
    for (const p of pipeline) {
      pipelineMap[p.status] = p._count.id
    }

    // Ranking de clientes por volume (top 10)
    const clientesAprovados = await prisma.orcamentoGrafico.findMany({
      where: { empresaId: user.empresaId, status: 'APROVADO', precoVenda: { not: null } },
      select: { clienteNome: true, clienteId: true, precoVenda: true, margemReal: true },
    })

    const clienteAgg: Record<string, { nome: string; volume: number; margem: number; count: number }> = {}
    for (const orc of clientesAprovados) {
      const key = orc.clienteId || orc.clienteNome || 'Sem cliente'
      if (!clienteAgg[key]) {
        clienteAgg[key] = { nome: orc.clienteNome || 'Sem nome', volume: 0, margem: 0, count: 0 }
      }
      clienteAgg[key].volume += Number(orc.precoVenda || 0)
      clienteAgg[key].margem += Number(orc.margemReal || 0)
      clienteAgg[key].count++
    }

    const rankingVolume = Object.values(clienteAgg)
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 10)
      .map(c => ({ nome: c.nome, volume: Math.round(c.volume * 100) / 100, count: c.count }))

    const rankingMargem = Object.values(clienteAgg)
      .map(c => ({ nome: c.nome, margemMedia: c.count > 0 ? Math.round((c.margem / c.count) * 100) / 100 : 0, count: c.count }))
      .sort((a, b) => b.margemMedia - a.margemMedia)
      .slice(0, 10)

    // Por status (para o período)
    const porStatus: Record<string, number> = {}
    for (const s of statusCounts) {
      porStatus[s.status] = s._count.id
    }

    return {
      periodo: `${diasAtras} dias`,
      total,
      convertidos,
      taxaConversao,
      ticketMedio,
      porStatus,
      pipeline: {
        rascunho: pipelineMap['RASCUNHO'] || 0,
        enviado: pipelineMap['ENVIADO'] || 0,
        aprovado: pipelineMap['APROVADO'] || 0,
        recusado: pipelineMap['RECUSADO'] || 0,
        vencido: pipelineMap['VENCIDO'] || 0,
      },
      rankingVolume,
      rankingMargem,
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SIMULAR TIRAGENS (POST /simular-tiragens)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/orcamento-grafico/simular-tiragens
   * Executa cálculo para múltiplas quantidades sem salvar.
   * Retorna array de { quantidade, custoTotal, precoVenda, precoUnitario }.
   */
  app.post('/simular-tiragens', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { calcularOrcamentoGrafico: calcular } = await import('./orcamento-grafico-calculo.service')

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
      quantidades: z.array(z.number().int().positive()).min(1).max(20),
      tabelaMargemId: z.string().uuid().optional(),
    }).parse(request.body)

    // Buscar tipo de embalagem
    const tipo = await prisma.tipoEmbalagem.findFirst({ where: { id: body.tipoEmbalagemId, empresaId: user.empresaId } })
    if (!tipo) return reply.status(404).send({ message: 'Tipo de embalagem não encontrado' })

    // Buscar máquina
    const maquina = await prisma.centroProducao.findFirst({ where: { id: body.maquinaId, empresaId: user.empresaId } })
    if (!maquina) return reply.status(404).send({ message: 'Máquina não encontrada' })

    // Buscar tabela de margem
    let margem = { impostos: 15, comissao: 5, despAdm: 5, markup: 30 }
    if (body.tabelaMargemId) {
      const tabela = await prisma.tabelaMargem.findFirst({ where: { id: body.tabelaMargemId, empresaId: user.empresaId } })
      if (tabela) margem = { impostos: Number(tabela.impostos), comissao: Number(tabela.comissao), despAdm: Number(tabela.despAdm), markup: Number(tabela.markup) }
    }

    // Buscar perdas
    const perdasParam = await prisma.parametroPerda.findMany({ where: { empresaId: user.empresaId } })
    const perdaImpressao = perdasParam.find(p => !p.centroProducaoId)
    const perdas = {
      impressaoPercent: perdaImpressao ? Number(perdaImpressao.perdaVariavel) : 5,
      impressaoFixaFolhas: perdaImpressao ? perdaImpressao.perdaFixaFolhas : 50,
      corteVincoPercent: 3,
      colagemPercent: 2,
    }

    // Calcular para cada quantidade
    const simulacoes = body.quantidades.map(quantidade => {
      const resultado = calcular({
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
        acabamentos: body.acabamentos as Array<{ tipo: string; custoHora: number; velocidade: number; setupMinutos: number; custoMaterialM2?: number; custoMaterialUn?: number }>,
        quantidade,
        perdas,
        margem,
      })

      return {
        quantidade,
        custoTotal: resultado.custoTotal,
        precoVenda: resultado.precoVenda,
        precoUnitario: resultado.precoUnitario,
      }
    })

    return { simulacoes }
  })
}


// ═══════════════════════════════════════════════════════════════════════════
// Funções auxiliares de parsing (CSV/XLSX) — Task 11.2
// ═══════════════════════════════════════════════════════════════════════════

const TIPOS_VALIDOS = ['PAPEL', 'TINTA', 'VERNIZ', 'COLA', 'FACA', 'BOPP', 'OUTRO']
const UNIDADES_VALIDAS = ['KG', 'M2', 'UN', 'LT', 'ML', 'M', 'PC', 'FL', 'RS']

interface RegistroImportacao {
  descricao: string
  tipo: string
  unidade: string
  precoUnitario: number
  dataVigencia?: string
  valido: boolean
  erros: string[]
}

function parseCsv(conteudo: string): RegistroImportacao[] {
  const linhas = conteudo.split(/\r?\n/).filter(l => l.trim())
  if (linhas.length < 2) return [] // precisa de header + pelo menos 1 linha

  // Detectar separador (;  ou  ,)
  const primeiraLinha = linhas[0]
  const separador = primeiraLinha.includes(';') ? ';' : ','

  const header = linhas[0].split(separador).map(h => h.trim().toLowerCase().replace(/['"]/g, ''))

  // Mapear índices de colunas esperadas
  const idxDescricao = header.findIndex(h => h.includes('descri'))
  const idxTipo = header.findIndex(h => h === 'tipo')
  const idxUnidade = header.findIndex(h => h.includes('unid'))
  const idxPreco = header.findIndex(h => h.includes('preco') || h.includes('preço') || h.includes('valor'))
  const idxData = header.findIndex(h => h.includes('data') || h.includes('vigencia') || h.includes('vigência'))

  if (idxDescricao === -1 || idxPreco === -1) {
    throw new Error('Colunas obrigatórias não encontradas. Esperado: descricao, precoUnitario. Opcional: tipo, unidade, dataVigencia')
  }

  const registros: RegistroImportacao[] = []

  for (let i = 1; i < linhas.length; i++) {
    const cols = linhas[i].split(separador).map(c => c.trim().replace(/^['"]|['"]$/g, ''))
    if (cols.length < 2) continue

    const erros: string[] = []
    const descricao = cols[idxDescricao] || ''
    let tipo = (idxTipo >= 0 ? cols[idxTipo] : 'OUTRO').toUpperCase()
    let unidade = (idxUnidade >= 0 ? cols[idxUnidade] : 'UN').toUpperCase()
    const precoStr = cols[idxPreco] || '0'
    const dataVigencia = idxData >= 0 ? cols[idxData] : undefined

    // Validações
    if (!descricao) erros.push('Descrição vazia')

    if (!TIPOS_VALIDOS.includes(tipo)) {
      erros.push(`Tipo inválido: "${tipo}". Válidos: ${TIPOS_VALIDOS.join(', ')}`)
      tipo = 'OUTRO'
    }

    if (!UNIDADES_VALIDAS.includes(unidade)) {
      erros.push(`Unidade inválida: "${unidade}". Válidas: ${UNIDADES_VALIDAS.join(', ')}`)
      unidade = 'UN'
    }

    // Limpar preço (aceita vírgula como decimal, remover ponto de milhar)
    const precoLimpo = precoStr.replace(/\./g, '').replace(',', '.')
    const precoUnitario = parseFloat(precoLimpo)
    if (isNaN(precoUnitario) || precoUnitario < 0) {
      erros.push(`Preço inválido: "${precoStr}"`)
    }

    registros.push({
      descricao,
      tipo,
      unidade,
      precoUnitario: isNaN(precoUnitario) ? 0 : precoUnitario,
      dataVigencia,
      valido: erros.length === 0 && !!descricao,
      erros,
    })
  }

  return registros
}

function parseXlsx(buffer: Buffer): RegistroImportacao[] {
  // Fallback simples: tenta ler como CSV (caso o usuário envie .csv com extensão errada)
  // Para .xlsx real, seria necessário o pacote 'xlsx' — como não está no package.json,
  // retornamos erro orientando o upload em CSV
  try {
    const texto = buffer.toString('utf-8')
    // Se começar com PK (magic bytes de ZIP/XLSX), não é CSV
    if (buffer[0] === 0x50 && buffer[1] === 0x4B) {
      throw new Error('Formato XLSX detectado. Por favor, exporte o arquivo como CSV (separado por ; ou ,) e reenvie.')
    }
    return parseCsv(texto)
  } catch (err: any) {
    if (err.message.includes('XLSX')) throw err
    throw new Error('Não foi possível processar o arquivo. Envie como CSV (separado por ; ou ,).')
  }
}
